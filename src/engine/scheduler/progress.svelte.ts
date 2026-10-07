// Main-thread side of the progress channel. Updates from every worker are
// coalesced and applied once per animation frame.
export type ProgressMessage = { jobId: string; fraction: number };

export class ProgressHub {
  latest = $state.raw<ReadonlyMap<string, number>>(new Map());
  private pending = new Map<string, number>();
  private frame = 0;
  private listeners = new Set<(jobId: string) => void>();

  listen(port: MessagePort): void {
    port.onmessage = (event: MessageEvent<ProgressMessage>) =>
      this.report(event.data.jobId, event.data.fraction);
  }

  report(jobId: string, fraction: number): void {
    this.pending.set(jobId, fraction);
    for (const listener of this.listeners) listener(jobId);
    if (!this.frame) this.frame = requestAnimationFrame(() => this.flush());
  }

  onReport(listener: (jobId: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  forget(jobId: string): void {
    this.pending.delete(jobId);
    if (!this.latest.has(jobId)) return;
    const next = new Map(this.latest);
    next.delete(jobId);
    this.latest = next;
  }

  private flush(): void {
    this.frame = 0;
    const next = new Map(this.latest);
    for (const [jobId, fraction] of this.pending) next.set(jobId, fraction);
    this.pending.clear();
    this.latest = next;
  }
}
