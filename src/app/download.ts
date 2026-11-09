// Hand a file to the browser's downloads.

export function downloadBlob(data: BlobPart, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // Revoke after the click has been handled, not synchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
