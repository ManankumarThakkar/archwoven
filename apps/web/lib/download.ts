/** Revoking in the same task as the click has cancelled Safari downloads (WebKit 185531); 40 s matches FileSaver.js. */
const REVOKE_AFTER_MS = 40_000;

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url; a.download = fileName; a.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  }
}
