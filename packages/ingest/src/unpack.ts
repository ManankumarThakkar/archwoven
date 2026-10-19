import { isVendor } from './exclusions';
import { isSafeSubdir, withinScope } from './scope';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { createGunzip } from 'node:zlib';

/**
 * Safe tar unpack — an explicit ustar block reader, not a library
 * extractor. Security-critical boundary: every entry's raw path, typeflag,
 * size and checksum are validated BEFORE any write; symlinks/hardlinks/
 * devices are refused, never followed; binary content is sniffed in memory
 * and dropped. Owning the parser means no hidden path-rewriting, no
 * stream-order surprises, and every refusal is gap-listed explicitly.
 */
export interface UnpackResult {
  files: string[];
  skipped: { path: string; reason: string }[];
  /** Bounded root metadata notices retained without materializing outside files. */
  declarations?: { submodules: boolean; lfs: boolean };
}

export interface UnpackCaps {
  maxFiles: number;
  /** cap on the COMPRESSED download (fetch side) */
  maxTotalBytes: number;
  maxFileBytes: number;
  /** cap on the DECOMPRESSED archive (gzip-bomb guard); default 100 MB */
  maxExpandedBytes?: number;
}

const MAX_EXPANDED_DEFAULT = 100 * 1024 * 1024;

export { isVendor } from './exclusions';

const looksBinary = (body: Uint8Array): boolean => body.subarray(0, Math.min(8192, body.length)).includes(0);

/** streaming inflate with an incremental cap: a gzip bomb is destroyed the
 *  moment its expansion passes the cap — the full expansion never exists. */
function inflateCapped(buf: Uint8Array, cap: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    const gunzip = createGunzip();
    gunzip.on('data', (c: Buffer) => {
      total += c.length;
      if (total > cap) {
        if (done) return;
        done = true;
        gunzip.destroy();
        reject(new Error(`oversized: decompressed archive exceeds ${cap} bytes`));
        return;
      }
      chunks.push(c);
    });
    gunzip.on('error', (e) => { if (!done) { done = true; reject(e); } });
    gunzip.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks, total)); } });
    gunzip.end(buf);
  });
}

const octal = (b: Uint8Array): number => {
  const s = new TextDecoder().decode(b).replace(/\0.*$/, '').trim();
  return s ? parseInt(s, 8) : 0;
};

/** strip the codeload "{repo}-{sha}/" root prefix GitHub always adds */
const normalize = (raw: string): string => raw.replace(/^\.\//, '').replace(/^[^/]+-(?:[0-9a-f]{7,40}|[\w.-]+)\//, '');

export async function unpackTarball(tarball: ArrayBufferView | ArrayBuffer, destDir: string, caps: UnpackCaps, opts: { subdir?: string } = {}): Promise<UnpackResult> {
  const subdir = opts.subdir || undefined;
  if (subdir && !isSafeSubdir(subdir)) throw new Error('Invalid subdir: choose a relative source directory without traversal, hidden or excluded folders.');
  mkdirSync(destDir, { recursive: true });
  let buf = ArrayBuffer.isView(tarball)
    ? new Uint8Array(tarball.buffer, tarball.byteOffset, tarball.byteLength)
    : new Uint8Array(tarball);
  // codeload serves .tar.gz — inflate before the block reader, capping the
  // DECOMPRESSED size incrementally (a small gzip can hide a big bomb).
  const expandedCap = caps.maxExpandedBytes ?? MAX_EXPANDED_DEFAULT;
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    buf = await inflateCapped(buf, expandedCap);
  }
  if (buf.length > expandedCap) throw new Error(`oversized: decompressed archive exceeds ${expandedCap} bytes`);
  const declarations = { submodules: false, lfs: false };
  const files: string[] = [];
  const skipped: { path: string; reason: string }[] = [];
  let totalWritten = 0;
  let countCapped = false;
  let off = 0;
  let pendingPaxPath: string | null = null;

  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break; // end-of-archive

    const checksum = octal(header.subarray(148, 156));
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : header[i]!;
    if (checksum !== sum) { skipped.push({ path: `<block@${off}>`, reason: 'bad-checksum' }); break; }

    let name = new TextDecoder().decode(header.subarray(0, 100)).replace(/\0.*$/, '');
    const size = octal(header.subarray(124, 136));
    const typeflag = String.fromCharCode(header[156] ?? 0x30);
    const prefix = new TextDecoder().decode(header.subarray(345, 500)).replace(/\0.*$/, '');
    if (prefix) name = `${prefix}/${name}`;

    if (!Number.isSafeInteger(size) || size < 0 || off + 512 + Math.ceil(size / 512) * 512 > buf.length) throw new Error('Invalid or truncated archive entry size.');
    off += 512;
    const body = buf.subarray(off, off + size);
    off += Math.ceil(size / 512) * 512;

    // PAX extended headers: take the long-path override, then continue.
    if (typeflag === 'x' || typeflag === 'g') {
      const text = new TextDecoder().decode(body);
      const m = /(?:^|\n)\d+ path=([^\n]+)/.exec(text);
      if (typeflag === 'x' && m) pendingPaxPath = m[1]!;
      continue;
    }

    const raw = pendingPaxPath ?? name;
    pendingPaxPath = null;
    const rel = normalize(raw);
    const gapPath = rel || raw; // gaps speak the same repo-relative language as files[]

    if (raw.includes('..')) { skipped.push({ path: gapPath, reason: 'traversal' }); continue; }
    if (raw.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw)) { skipped.push({ path: gapPath, reason: 'absolute-path' }); continue; }
    if (!withinScope(rel, subdir)) {
      // These repository-wide notices are useful in a scoped analysis, but
      // metadata must neither consume its file budget nor become an outside file.
      if ((typeflag === '0' || typeflag === '7') && size <= Math.min(caps.maxFileBytes, 65536) && !looksBinary(body)) {
        if (rel === '.gitmodules') declarations.submodules = true;
        if (rel === '.gitattributes' && /filter=lfs/.test(new TextDecoder().decode(body))) declarations.lfs = true;
      }
      continue;
    }
    if (typeflag === '2') { skipped.push({ path: gapPath, reason: 'symlink' }); continue; }
    if (typeflag === '1') { skipped.push({ path: gapPath, reason: 'hardlink' }); continue; }
    // Directories carry no source content; files create their own parents.
    // Validate raw paths above, then ignore these normal archive records.
    if (typeflag === '5') continue;
    if (typeflag !== '0' && typeflag !== '7') { skipped.push({ path: gapPath, reason: `type:${typeflag}` }); continue; }

    if (!rel) continue; // the stripped root prefix itself
    if (isVendor(rel)) { skipped.push({ path: gapPath, reason: 'vendor' }); continue; }

    if (countCapped || files.length >= caps.maxFiles) {
      if (!countCapped) { skipped.push({ path: gapPath, reason: 'file-count-cap' }); countCapped = true; }
      continue;
    }
    if (size > caps.maxFileBytes) { skipped.push({ path: gapPath, reason: `size:${size}>${caps.maxFileBytes}` }); continue; }
    if (totalWritten + size > (caps.maxExpandedBytes ?? MAX_EXPANDED_DEFAULT)) { skipped.push({ path: gapPath, reason: 'expanded-size-cap' }); continue; }
    if (looksBinary(body)) { skipped.push({ path: gapPath, reason: 'binary' }); continue; }

    const abs = join(destDir, rel);
    if (!abs.startsWith(destDir + posix.sep)) { skipped.push({ path: gapPath, reason: 'traversal' }); continue; }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
    totalWritten += size;
    files.push(rel);
  }

  return { files, skipped, ...(subdir ? { declarations } : {}) };
}

export function cleanupDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
