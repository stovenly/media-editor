// Keeps the screen on while any job runs, and re-acquires the lock when the tab becomes visible again.
class WakeLock {
  private holders = new Set<string>();
  private sentinel: WakeLockSentinel | null = null;

  constructor() {
    if (typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.sync();
    });
  }

  hold(id: string): void {
    this.holders.add(id);
    void this.sync();
  }

  release(id: string): void {
    this.holders.delete(id);
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
