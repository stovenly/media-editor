import { imagePool, inspectPool, scheduler } from '../engine';
import { suggestions, target, targetsFor, type Facts } from '../engine/targets';
import type { MediaKind } from '../io/formats';
import type { Inspection } from '../io/inspect';
import { isEmptyEdit, type ImageEdit } from '../project/image-edit';
import { DEFAULT_OPTIONS, optionsKey, type ConvertOptions } from './options';
import { estimateBytes } from '../engine/av/plan';
import { avSettings, startJob, type Job, type Output } from './run';
import { messageOf } from '../engine/errors';
import { plainError } from './errors';
import { wakeLock } from './wake-lock.svelte';
import { downloadBlob } from '../io/download';

export type JobState =
  | { status: 'idle' }
  | { status: 'waiting'; key: string }
  | { status: 'running'; key: string; taskId: string; started: number }
  | { status: 'done'; key: string; output: Output }
  | { status: 'failed'; key: string; message: string; detail: string };

export type Estimate = { key: string; bytes: number | null; exact: boolean; output?: Output };

export type FileItem = {
  id: string;
  file: File;
  status: 'inspecting' | 'ready' | 'unsupported' | 'error';
  inspection?: Inspection;
  error?: string;
  target: string | null;
  options: ConvertOptions;
  edit: ImageEdit | null;
  job: JobState;
  estimate: Estimate | null;
};

const SAMPLED_ESTIMATES = 3;
const ESTIMATE_DELAY_MS = 400;

let nextId = 0;

const AUTO_DOWNLOAD_KEY = 'auto-download';

class Files {
  items = $state.raw<FileItem[]>([]);
  defaults = $state.raw<Record<MediaKind, string | null>>({
    image: null,
    audio: null,
    video: null,
    subtitle: null,
  });
  // The settings a newly added file starts with: whatever was last chosen.
  options = $state.raw<ConvertOptions>(loadOptions());
  selected = $state<string | null>(null);
  autoDownload = $state(localStorage.getItem(AUTO_DOWNLOAD_KEY) !== '0');

  private jobs = new Map<string, Job>();
  private estimating = new Map<string, Job>();
  private estimateTimer: ReturnType<typeof setTimeout> | undefined;

  add(files: File[]): FileItem[] {
    if (files.length === 0) return [];
    const added = files.map((file): FileItem => ({
      id: `file-${++nextId}`,
      file,
      status: 'inspecting',
      target: null,
      options: this.options,
      edit: null,
      job: { status: 'idle' },
      estimate: null,
    }));
    this.items = [...this.items, ...added];
    if (!this.selectedItem()) this.selected = added[0]!.id;
    for (const item of added) this.inspect(item);
    return added;
  }

  remove(id: string): void {
    this.cancel(id);
    this.estimating.get(id)?.cancel();
    const index = this.items.findIndex((item) => item.id === id);
    this.items = this.items.filter((item) => item.id !== id);
    if (this.selected === id)
      this.selected = (this.items[index] ?? this.items[index - 1] ?? null)?.id ?? null;
  }

  select(id: string): void {
    this.selected = id;
  }

  selectedItem(): FileItem | null {
    return this.items.find((item) => item.id === this.selected) ?? null;
  }

  clear(): void {
    for (const item of this.items) this.remove(item.id);
    this.items = [];
  }

  kinds(): MediaKind[] {
    const kinds = new Set<MediaKind>();
    for (const item of this.items)
      if (item.status === 'ready' && item.inspection?.sniffed.kind)
        kinds.add(item.inspection.sniffed.kind);
    return (['image', 'video', 'audio', 'subtitle'] as const).filter((kind) => kinds.has(kind));
  }

  targetOf(item: FileItem): string | null {
    const kind = item.inspection?.sniffed.kind;
    if (!kind) return null;
    const chosen = item.target;
    return chosen && targetsFor(kind, factsOf(item.inspection)).some((t) => t.id === chosen)
      ? chosen
      : null;
  }

  keyOf(item: FileItem): string | null {
    const id = this.targetOf(item);
    return id ? optionsKey(id, item.options, item.edit) : null;
  }

  // Later files of the same kind start with this choice too.
  setTarget(id: string, targetId: string | null): void {
    const kind = this.find(id)?.inspection?.sniffed.kind;
    this.update(id, { target: targetId });
    if (kind && targetId) this.defaults = { ...this.defaults, [kind]: targetId };
    this.scheduleEstimates();
  }

  // Gives every file of the selected file's kind its format and options.
  applyToKind(): void {
    const source = this.selectedItem();
    const kind = source?.inspection?.sniffed.kind;
    if (!source || !kind) return;
    this.items = this.items.map((item) =>
      item.id !== source.id && item.inspection?.sniffed.kind === kind
        ? { ...item, target: source.target, options: source.options }
        : item,
    );
    this.scheduleEstimates();
  }

  setEdit(id: string, edit: ImageEdit | null): void {
    this.update(id, { edit: isEmptyEdit(edit) ? null : edit });
    this.scheduleEstimates();
  }

  // The same edit for every still image; crops and redactions are fractions, so they scale to each.
  applyEditToAll(edit: ImageEdit): void {
    const value = isEmptyEdit(edit) ? null : edit;
    this.items = this.items.map((item) =>
      item.inspection?.sniffed.kind === 'image' && item.inspection.pages <= 1
        ? { ...item, edit: value }
        : item,
    );
    this.scheduleEstimates();
  }

  setOptions(patch: Partial<ConvertOptions>): void {
    const item = this.selectedItem();
    if (!item) return;
    const options = { ...item.options, ...patch };
    this.update(item.id, { options });
    this.options = options;
    saveOptions(options);
    this.scheduleEstimates();
  }

  resetOptions(keys: readonly (keyof ConvertOptions)[]): void {
    const patch: Partial<ConvertOptions> = {};
    for (const key of keys) Object.assign(patch, { [key]: DEFAULT_OPTIONS[key] });
    this.setOptions(patch);
  }

  // Ready items whose output differs from what they already produced.
  pending(): FileItem[] {
    return this.items.filter((item) => {
      const key = this.keyOf(item);
      if (item.status !== 'ready' || !key) return false;
      const job = item.job;
      return (
        job.status === 'idle' ||
        (job.status !== 'waiting' && job.status !== 'running' && job.key !== key)
      );
    });
  }

  setAutoDownload(on: boolean): void {
    this.autoDownload = on;
    localStorage.setItem(AUTO_DOWNLOAD_KEY, on ? '1' : '0');
  }

  private deliver(output: Output): void {
    if (this.autoDownload) downloadBlob(output.blob, output.name);
  }

  convertAll(): void {
    for (const item of this.pending()) this.convert(item.id);
  }

  convert(id: string): void {
    const item = this.find(id);
    const key = item && this.keyOf(item);
    const targetId = item && this.targetOf(item);
    if (!item || !key || !targetId || !item.inspection) return;
    if (item.estimate?.key === key && item.estimate.output) {
      this.update(id, { job: { status: 'done', key, output: item.estimate.output } });
      this.deliver(item.estimate.output);
      return;
    }
    this.update(id, { job: { status: 'waiting', key } });
    const job = startJob({
      file: item.file,
      inspection: item.inspection,
      edit: item.edit,
      targetId,
      options: item.options,
      threads: this.threadsPerJob(),
      onTask: (taskId) =>
        this.update(id, { job: { status: 'running', key, taskId, started: performance.now() } }),
    });
    this.jobs.set(id, job);
    wakeLock.hold(id);
    job.result.then(
      (output) => {
        this.finish(id, key, { status: 'done', key, output });
        if (this.find(id)?.job.status === 'done') this.deliver(output);
      },
      (error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError')
          this.finish(id, key, { status: 'idle' });
        else
          this.finish(id, key, {
            status: 'failed',
            key,
            message: plainError(error),
            detail: messageOf(error),
          });
      },
    );
  }

  cancel(id: string): void {
    this.jobs.get(id)?.cancel();
  }

  cancelAll(): void {
    for (const id of [...this.jobs.keys()]) this.cancel(id);
  }

  outputs(): Output[] {
    return this.items.flatMap((item) => (item.job.status === 'done' ? [item.job.output] : []));
  }

  private finish(id: string, key: string, job: JobState): void {
    this.jobs.delete(id);
    wakeLock.release(id);
    const item = this.find(id);
    if (!item) return;
    const current = item.job;
    if (current.status !== 'idle' && 'key' in current && current.key !== key) return;
    const estimate =
      job.status === 'done'
        ? { key, bytes: job.output.blob.size, exact: true, output: job.output }
        : item.estimate;
    this.update(id, { job, estimate });
  }

  // Image engines are few and multithreaded, so their threads share out the slot limit.
  private threadsPerJob(): number {
    const active = this.items.filter((item) => item.status === 'ready').length;
    const workers = Math.min(active, imagePool.maxWorkers);
    return Math.max(1, Math.floor(scheduler.limit / Math.max(1, workers)));
  }

  private find(id: string): FileItem | undefined {
    return this.items.find((item) => item.id === id);
  }

  private inspect(item: FileItem): void {
    const task = scheduler.submit({
      pool: inspectPool,
      memory: 32 * 1024 * 1024,
      run: (api) => api.inspect(item.file),
    });
    task.result.then(
      (inspection) => {
        const kind = inspection.sniffed.kind;
        const first = kind
          ? suggestions(inspection.sniffed.format ?? '', kind, factsOf(inspection))[0]
          : undefined;
        const fallback = kind ? this.defaults[kind] : null;
        const usable =
          kind && fallback && targetsFor(kind, factsOf(inspection)).some((t) => t.id === fallback);
        this.update(item.id, {
          inspection,
          status: kind ? 'ready' : 'unsupported',
          target: usable ? fallback : (first?.id ?? null),
        });
        this.scheduleEstimates();
      },
      (error: unknown) => this.update(item.id, { status: 'error', error: plainError(error) }),
    );
  }

  private scheduleEstimates(): void {
    clearTimeout(this.estimateTimer);
    this.estimateTimer = setTimeout(() => this.refreshEstimates(), ESTIMATE_DELAY_MS);
  }

  // Images are encoded for real: the first few per output exactly, the rest extrapolated by input size.
  private refreshEstimates(): void {
    const sampled = new Map<string, FileItem[]>();
    for (const item of this.items) {
      const key = this.keyOf(item);
      const targetId = this.targetOf(item);
      if (!key || !targetId || item.status !== 'ready' || !item.inspection) continue;
      if (item.estimate?.key === key) continue;
      if (item.inspection.sniffed.kind === 'subtitle') continue;
      if (item.inspection.sniffed.kind !== 'image') {
        const probe = item.inspection.av;
        const bytes = probe ? estimateBytes(probe, avSettings(targetId, item.options)) : null;
        this.update(item.id, { estimate: bytes === null ? null : { key, bytes, exact: false } });
        continue;
      }
      const group = sampled.get(targetId) ?? [];
      sampled.set(targetId, group);
      if (group.length >= SAMPLED_ESTIMATES) continue;
      group.push(item);
      this.estimate(item, key, targetId);
    }
    this.extrapolate();
  }

  private estimate(item: FileItem, key: string, targetId: string): void {
    this.estimating.get(item.id)?.cancel();
    this.update(item.id, { estimate: { key, bytes: null, exact: false } });
    const job = startJob({
      file: item.file,
      inspection: item.inspection!,
      edit: item.edit,
      targetId,
      options: item.options,
      threads: this.threadsPerJob(),
      onTask: () => {},
    });
    this.estimating.set(item.id, job);
    job.result.then(
      (output) => {
        if (this.estimating.get(item.id) === job) this.estimating.delete(item.id);
        const current = this.find(item.id);
        if (!current || this.keyOf(current) !== key) return;
        this.update(item.id, { estimate: { key, bytes: output.blob.size, exact: true, output } });
        this.extrapolate();
      },
      () => {
        if (this.estimating.get(item.id) === job) this.estimating.delete(item.id);
        const current = this.find(item.id);
        if (current?.estimate?.key === key) this.update(item.id, { estimate: null });
      },
    );
  }

  private extrapolate(): void {
    const ratios = new Map<string, number[]>();
    for (const item of this.items) {
      const key = this.keyOf(item);
      if (
        key &&
        item.estimate?.key === key &&
        item.estimate.exact &&
        item.estimate.bytes !== null
      ) {
        const list = ratios.get(key) ?? [];
        list.push(item.estimate.bytes / Math.max(1, item.file.size));
        ratios.set(key, list);
      }
    }
    let changed = false;
    const next = this.items.map((item) => {
      const key = this.keyOf(item);
      if (!key || item.inspection?.sniffed.kind !== 'image') return item;
      if (item.estimate?.key === key && (item.estimate.exact || this.estimating.has(item.id)))
        return item;
      const list = ratios.get(key);
      if (!list?.length) return item;
      const ratio = list.reduce((a, b) => a + b, 0) / list.length;
      changed = true;
      return {
        ...item,
        estimate: { key, bytes: Math.round(ratio * item.file.size), exact: false },
      };
    });
    if (changed) this.items = next;
  }

  private update(id: string, patch: Partial<FileItem>): void {
    this.items = this.items.map((item) => (item.id === id ? { ...item, ...patch } : item));
  }
}

const OPTIONS_KEY = 'options';

function loadOptions(): ConvertOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}') as Partial<ConvertOptions>;
    return { ...DEFAULT_OPTIONS, ...saved, targetMb: null, trimStart: null, trimEnd: null };
  } catch {
    return DEFAULT_OPTIONS;
  }
}

function saveOptions(options: ConvertOptions): void {
  localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
}

export const files = new Files();

export function factsOf(inspection: Inspection | undefined): Facts {
  return {
    animated: (inspection?.pages ?? 1) > 1,
    motion: inspection?.motionOffset !== undefined,
    subtitles:
      inspection?.sniffed.kind === 'subtitle' ||
      Boolean(inspection?.av?.subtitles.some((track) => track.text)),
  };
}

export function targetLabel(id: string | null): string {
  return id ? target(id).label : '';
}
