import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { unpackTarball, cleanupDir } from './unpack';

/** Hand-assembled tar blocks — exact control over malicious entries. */
function tarEntry(name: string, body: string | Uint8Array, typeflag = '0', linkname = ''): Uint8Array {
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
  header.fill(0x20, 148, 156); // checksum field is spaces while summing (ustar)
  let sum = 0; for (let i = 0; i < 512; i++) sum += header[i]!;
  enc(sum.toString(8).padStart(7, '0') + '\0 ', 148, 8);
  const pad = new Uint8Array(Math.ceil(bytes.byteLength / 512) * 512);
  pad.set(bytes);
  return new Uint8Array([...header, ...pad]);
}

function tar(entries: Uint8Array[]): ArrayBuffer {
  const end = new Uint8Array(1024);
  let total = 0; for (const e of entries) total += e.byteLength;
  const out = new Uint8Array(total + end.byteLength);
  let off = 0; for (const e of entries) { out.set(e, off); off += e.byteLength; }
  return out.buffer;
}

const dirs: string[] = [];
const mkDest = () => { const d = mkdtempSync(join(tmpdir(), 'aw-unpack-')); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const CAPS = { maxFiles: 100, maxTotalBytes: 1024 * 1024, maxFileBytes: 64 * 1024 };

describe('unpackTarball (§14 tarball safety)', () => {
  it('rejects path traversal without writing outside dest', async () => {
    const dest = mkDest();
    const buf = tar([tarEntry('repo-abc/../../evil.txt', 'pwned'), tarEntry('repo-abc/ok.txt', 'fine')]);
    const r = await unpackTarball(buf, dest, CAPS);
    expect(r.files).toEqual(['ok.txt']);
    expect(r.skipped.find((s) => s.path.includes('..'))?.reason).toMatch(/traversal/i);
    expect(existsSync(join(dest, '..', 'evil.txt'))).toBe(false);
    expect(readFileSync(join(dest, 'ok.txt'), 'utf8')).toBe('fine');
  });

  it('rejects absolute paths', async () => {
    const dest = mkDest();
    const buf = tar([tarEntry('/etc/passwd', 'x'), tarEntry('repo-a/pom.xml', '<project/>')]);
    const r = await unpackTarball(buf, dest, CAPS);
    expect(r.files).toEqual(['pom.xml']);
    expect(r.skipped.find((s) => s.path === '/etc/passwd')?.reason).toMatch(/absolute/i);
  });

  it('rejects symlinks and hardlinks, gap-lists them, never follows', async () => {
    const dest = mkDest();
    const buf = tar([tarEntry('repo-a/escape', '', '2', '/'), tarEntry('repo-a/hard', '', '1', '/etc/passwd'), tarEntry('repo-a/main.py', 'app = 1')]);
    const r = await unpackTarball(buf, dest, CAPS);
    expect(r.files).toEqual(['main.py']);
    expect(r.skipped.find((s) => s.path === 'escape')?.reason).toMatch(/symlink/i);
    expect(r.skipped.find((s) => s.path === 'hard')?.reason).toMatch(/hardlink/i);
  });

  it('skips a file over maxFileBytes with a gap', async () => {
    const dest = mkDest();
    const big = 'x'.repeat(100 * 1024);
    const buf = tar([tarEntry('repo-a/big.bin', big), tarEntry('repo-a/small.txt', 'ok')]);
    const r = await unpackTarball(buf, dest, { ...CAPS, maxFileBytes: 64 * 1024 });
    expect(r.files).toEqual(['small.txt']);
    expect(r.skipped.find((s) => s.path === 'big.bin')?.reason).toMatch(/size/i);
  });

  it('stops at maxFiles and records the gap', async () => {
    const dest = mkDest();
    const entries = Array.from({ length: 5 }, (_, i) => tarEntry(`repo-a/f${i}.txt`, 'x'));
    const r = await unpackTarball(tar(entries), dest, { ...CAPS, maxFiles: 3 });
    expect(r.files.length).toBe(3);
    expect(r.skipped.some((s) => s.reason === 'file-count-cap')).toBe(true);
  });

  it('skips binary files (NUL sniff) with a gap', async () => {
    const dest = mkDest();
    const bin = new Uint8Array(1024); bin.set([1, 2, 3, 0, 5], 10); // NUL at byte 10
    const buf = tar([tarEntry('repo-a/blob.png', bin), tarEntry('repo-a/App.java', 'class App {}')]);
    const r = await unpackTarball(buf, dest, CAPS);
    expect(r.files).toEqual(['App.java']);
    expect(r.skipped.find((s) => s.path === 'blob.png')?.reason).toMatch(/binary/i);
  });

  it('skips vendor paths with gaps', async () => {
    const dest = mkDest();
    const buf = tar([
      tarEntry('repo-a/node_modules/pkg/index.js', 'x'),
      tarEntry('repo-a/target/classes/App.class', 'x'),
      tarEntry('repo-a/package-lock.json', '{}'),
      tarEntry('repo-a/src/main/java/App.java', 'class App {}'),
    ]);
    const r = await unpackTarball(buf, dest, CAPS);
    expect(r.files).toEqual(['src/main/java/App.java']);
    expect(r.skipped.map((s) => s.reason)).toEqual(['vendor', 'vendor', 'vendor']);
  });

  it('strips the codeload {repo}-{sha}/ prefix', async () => {
    const dest = mkDest();
    const buf = tar([tarEntry('spring-petclinic-abc123/src/main/java/App.java', 'x')]);
    const r = await unpackTarball(buf, dest, CAPS);
    expect(r.files).toEqual(['src/main/java/App.java']);
  });

  it('cleanupDir removes the temp dir', async () => {
    const dest = mkDest();
    cleanupDir(dest);
    expect(existsSync(dest)).toBe(false);
  });
});
