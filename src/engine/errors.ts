export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message: unknown }).message;
    if (Array.isArray(message)) return message.join(': ').trim();
    return String(message);
  }
  return String(error);
}
