// FFmpeg in a worker: a fresh instance per job from one compiled module, input mounted with WORKERFS.
import type { FfmpegJob } from './plan';

type LogEvent = { type: string; message: string };

type Core = {
  exec(...args: string[]): number;
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
  core.setProgress(({ progress, time }) => {
    const fraction = duration && time > 0 ? time / 1_000_000 / duration : progress;
    if (Number.isFinite(fraction) && fraction > 0) onProgress(Math.min(0.99, fraction));
  });

  core.FS.mkdir('/in');
  core.FS.mount(core.FS.filesystems.WORKERFS, { files }, '/in');
  for (const write of writes) core.FS.writeFile(write.path, write.data);
  core.FS.mkdir('/out');
  if (job.zip) core.FS.mkdir(job.zip);
  const code = core.exec(...job.args);
  if (code !== 0) throw new Error(failureFrom(log));
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
