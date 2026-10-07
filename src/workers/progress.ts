// Worker side of the progress channel: one MessagePort per worker, at most
// ~10 updates a second per job. The pool hands the port over with `attach`.
const INTERVAL_MS = 100;

let port: MessagePort | null = null;
const lastSent = new Map<string, number>();
const waiting = new Map<string, { fraction: number; timer: ReturnType<typeof setTimeout> }>();

export function attachProgress(next: MessagePort): void {
  port = next;
}

// Throttled, but the latest value is never lost: it is sent once the interval has passed.
export function reportProgress(jobId: string, fraction: number): void {
  const now = performance.now();
  const done = fraction >= 1;
  const wait = INTERVAL_MS - (now - (lastSent.get(jobId) ?? -Infinity));
  const queued = waiting.get(jobId);
  if (!done && wait > 0) {
    if (queued) queued.fraction = fraction;
    else waiting.set(jobId, { fraction, timer: setTimeout(() => flush(jobId), wait) });
    return;
  }
  if (queued) clearTimeout(queued.timer);
  waiting.delete(jobId);
  send(jobId, fraction, now);
  if (done) lastSent.delete(jobId);
}

function flush(jobId: string): void {
  const queued = waiting.get(jobId);
  waiting.delete(jobId);
  if (queued) send(jobId, queued.fraction, performance.now());
}

function send(jobId: string, fraction: number, now: number): void {
  lastSent.set(jobId, now);
  port?.postMessage({ jobId, fraction: Math.min(1, Math.max(0, fraction)) });
}
