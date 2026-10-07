// Undo and redo over immutable state. Each command records its label and the states either side of it.
export type Command<T> = { label: string; before: T; after: T };

const LIMIT = 200;
const MERGE_MS = 600;

export class History<T> {
  state = $state.raw<T>() as T;
  private done = $state.raw<Command<T>[]>([]);
  private undone = $state.raw<Command<T>[]>([]);
  private lastAt = 0;

  constructor(initial: T) {
    this.state = initial;
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  get undoLabel(): string | null {
    return this.done.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.undone.at(-1)?.label ?? null;
  }

  // Repeated commands with the same label in quick succession (slider drags) merge into one step.
  apply(label: string, next: T): void {
    if (next === this.state) return;
    const now = performance.now();
    const last = this.done.at(-1);
    if (last && last.label === label && now - this.lastAt < MERGE_MS) {
      this.done = [...this.done.slice(0, -1), { label, before: last.before, after: next }];
    } else {
      this.done = [...this.done, { label, before: this.state, after: next }].slice(-LIMIT);
    }
    this.lastAt = now;
    this.undone = [];
    this.state = next;
  }

  undo(): void {
    const command = this.done.at(-1);
    if (!command) return;
    this.done = this.done.slice(0, -1);
    this.undone = [...this.undone, command];
    this.state = command.before;
    this.lastAt = 0;
  }

  redo(): void {
    const command = this.undone.at(-1);
    if (!command) return;
    this.undone = this.undone.slice(0, -1);
    this.done = [...this.done, command];
    this.state = command.after;
    this.lastAt = 0;
  }

  reset(initial: T): void {
    this.state = initial;
    this.done = [];
    this.undone = [];
  }
}
