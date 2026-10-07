export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function canShare(files: File[]): boolean {
  const coarse = matchMedia('(pointer: coarse)').matches;
  return coarse && typeof navigator.canShare === 'function' && navigator.canShare({ files });
}

export async function shareFiles(files: File[]): Promise<void> {
  try {
    await navigator.share({ files });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    throw error;
  }
}
