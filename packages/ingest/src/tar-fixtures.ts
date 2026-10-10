/** Test-only: hand-assembled ustar buffers for malicious/safe tar fixtures. */
export function tarEntry(name: string, body: string | Uint8Array, typeflag = '0', linkname = ''): Uint8Array {
  const header = new Uint8Array(512);
  const enc = (s: string, off: number, len: number) => { const b = new TextEncoder().encode(s); header.set(b.subarray(0, Math.min(len, b.length)), off); };
  enc(name, 0, 100);
  enc('0000644\0', 100, 8);
  enc('0000000\0', 108, 8);
  enc('0000000\0', 116, 8);
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  enc(bytes.byteLength.toString(8).padStart(11, '0') + '\0', 124, 12);
  enc(typeflag, 156, 1);
  if (linkname) enc(linkname, 157, 100);
  header.fill(0x20, 148, 156);
  let sum = 0; for (let i = 0; i < 512; i++) sum += header[i]!;
  enc(sum.toString(8).padStart(7, '0') + '\0 ', 148, 8);
  const pad = new Uint8Array(Math.ceil(bytes.byteLength / 512) * 512);
  pad.set(bytes);
  return new Uint8Array([...header, ...pad]);
}

export function tar(entries: Uint8Array[]): ArrayBuffer {
  let total = 0; for (const e of entries) total += e.byteLength;
  const out = new Uint8Array(total + 1024);
  let off = 0; for (const e of entries) { out.set(e, off); off += e.byteLength; }
  return out.buffer;
}
