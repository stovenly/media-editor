// FFmpeg in a worker: a fresh instance per job from one compiled module, input mounted with WORKERFS.
import type { FfmpegJob } from './plan';

type LogEvent = { type: string; message: string };

type Core = {
  exec(...args: string[]): number;
  reset(): void;
  setLogger(logger: (event: LogEvent) => void): void;
  // progress: 0..1 against the input's duration; time: output position in microseconds.
  setProgress(handler: (event: { progress: number; time: number }) => void): void;
  FS: {
    mkdir(path: string): void;
    mount(type: unknown, options: { files: File[] }, path: string): void;
    readFile(path: string): Uint8Array;
    readdir(path: string): string[];
    writeFile(path: string, data: Uint8Array | string): void;
    filesystems: Record<string, unknown>;
  };
};

type Factory = (options: Record<string, unknown>) => Promise<Core>;

let compiled: Promise<WebAssembly.Module> | undefined;

function compile(url: string): Promise<WebAssembly.Module> {
  compiled ??= WebAssembly.compileStreaming(fetch(url)).catch(async () => {
    const response = await fetch(url);
    return WebAssembly.compile(await response.arrayBuffer());
  });
  compiled.catch(() => (compiled = undefined));
  return compiled;
}

export async function runFfmpeg(
  dir: string,
  files: File[],
  job: FfmpegJob,
  duration: number | null,
  onProgress: (fraction: number) => void,
  writes: readonly { path: string; data: string }[] = [],
): Promise<Uint8Array> {
  const wasmUrl = `${dir}ffmpeg-core.wasm`;
  const [module, factory] = await Promise.all([
    compile(wasmUrl),
    import(/* @vite-ignore */ `${dir}ffmpeg-core.js`).then((m: { default: Factory }) => m.default),
  ]);
  const core = await factory({
    mainScriptUrlOrBlob: `${dir}ffmpeg-core.js#${btoa(JSON.stringify({ wasmURL: wasmUrl, workerURL: '' }))}`,
    instantiateWasm(
      imports: WebAssembly.Imports,
      receive: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
    ) {
      void WebAssembly.instantiate(module, imports).then((instance) => receive(instance, module));
      return {};
    },
  });

  const log: string[] = [];
  core.setLogger(({ message }) => {
    log.push(message);
    if (log.length > 40) log.shift();
  });
  // FFmpeg's own status line ends in a carriage return, so it never reaches the logger until the end.
  // Each command of the job gets an equal share of the progress, measured by the output's time or, when
  // that stands still, by how much of the input has been read.
  const commands = [...(job.before ?? []), job.args];
  let pass = 0;
  let shown = 0;
  const show = (fraction: number) => {
    const overall = Math.min(0.99, (pass + Math.min(1, fraction)) / commands.length);
    if (overall < shown + 0.005) return;
    shown = overall;
    onProgress(overall);
  };
  core.setProgress(({ progress, time }) => {
    const fraction = duration && time > 0 ? time / 1_000_000 / duration : progress;
    if (Number.isFinite(fraction) && fraction > 0) show(fraction);
  });

  const total = files.reduce((sum, file) => sum + file.size, 0);
  let read = 0;
  const tracked = files.map((file) => {
    const copy = new File([file], file.name, { type: file.type, lastModified: file.lastModified });
    const slice = copy.slice.bind(copy);
    // WORKERFS reads by slicing the file, synchronously inside exec.
    copy.slice = (start?: number, end?: number, type?: string) => {
      read += Math.max(0, (end ?? copy.size) - (start ?? 0));
      if (total) show(read / total);
      return slice(start, end, type);
    };
    return copy;
  });

  core.FS.mkdir('/in');
  core.FS.mount(core.FS.filesystems.WORKERFS, { files: tracked }, '/in');
  for (const write of writes) core.FS.writeFile(write.path, write.data);
  core.FS.mkdir('/out');
  if (job.zip) core.FS.mkdir(job.zip);
  for (const command of commands) {
    const code = core.exec(...command);
    if (code !== 0) throw new Error(failureFrom(log));
    core.reset();
    pass++;
    read = 0;
  }
  let bytes: Uint8Array;
  if (job.zip) {
    const dir = job.zip;
    const names = core.FS.readdir(dir).filter((name) => !name.startsWith('.'));
    const { makeZip } = await import('../../io/zip');
    bytes = await makeZip(
      names.map((name) => ({ name, bytes: core.FS.readFile(`${dir}/${name}`) })),
    );
  } else {
    bytes = core.FS.readFile(job.output);
  }
  onProgress(1);
  return bytes;
}

function failureFrom(log: readonly string[]): string {
  const interesting = log.filter((line) =>
    /error|invalid|not supported|unknown|could not|failed|no such/i.test(line),
  );
  const last = (interesting.at(-1) ?? log.at(-1) ?? '').trim();
  return last ? `FFmpeg couldn't convert this file: ${last}` : "FFmpeg couldn't convert this file";
}
