import { messageOf } from '../engine/errors';
import { isMemoryFailure } from '../engine/scheduler/scheduler.svelte';

export function plainError(error: unknown): string {
  const message = messageOf(error);
  if (
    isMemoryFailure(error) ||
    /out of memory|OOM|Cannot enlarge memory|Maximum memory size/i.test(message)
  ) {
    return 'Your browser ran out of memory. Try a smaller size, or close other tabs and try again.';
  }
  if (
    /unsupported image format|not a known file format|no decode delegate|is not a known/i.test(
      message,
    )
  ) {
    return "This file couldn't be decoded. It may be damaged or use a variant this app can't read.";
  }
  if (/Couldn't download|Failed to fetch|NetworkError|engine list/i.test(message)) {
    return "The converter couldn't be downloaded. Check your connection and try again.";
  }
  return message || 'Something went wrong.';
}
