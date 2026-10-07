// While any job runs: keep the screen on, warn before the tab is closed, and notice if the browser froze the tab.
class WakeLock {
  busy = $state(false);
  frozeDuringWork = $state(false);
  private holders = new Set<string>();
  private sentinel: WakeLockSentinel | null = null;

  constructor() {
    if (typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.sync();
    });
    // Chromium freezes hidden, busy tabs; work stops until `resume`.
    document.addEventListener('resume', () => {
      if (this.busy) this.frozeDuringWork = true;
    });
    window.addEventListener('beforeunload', (event) => {
      if (this.busy) event.preventDefault();
    });
  }

  hold(id: string): void {
    this.holders.add(id);
    this.busy = true;
    void this.sync();
  }

  release(id: string): void {
    this.holders.delete(id);
    this.busy = this.holders.size > 0;
    if (!this.busy) this.frozeDuringWork = false;
    void this.sync();
  }

  private async sync(): Promise<void> {
    if (this.holders.size === 0) {
      const sentinel = this.sentinel;
      this.sentinel = null;
      await sentinel?.release().catch(() => {});
      return;
    }
    if (this.sentinel && !this.sentinel.released) return;
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
    } catch {
      // Denied, e.g. on battery saver.
    }
  }
}

export const wakeLock = new WakeLock();
