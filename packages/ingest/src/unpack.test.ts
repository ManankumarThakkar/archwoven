import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Gunzip } from 'node:zlib';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { unpackTarball, cleanupDir } from './unpack';
import { tarEntry, tar } from './tar-fixtures';

// Pass-through wrapper that records every inflate stream and the bytes it emits.
const inflates = vi.hoisted(() => [] as { stream: Gunzip; emitted: number }[]);
vi.mock('node:zlib', async (importOriginal) => {
  const zlib = await importOriginal<typeof import('node:zlib')>();
  return { ...zlib, createGunzip: (...args: Parameters<typeof zlib.createGunzip>) => {
    const stream = zlib.createGunzip(...args);
    const record = { stream, emitted: 0 };
    stream.on('data', (c: Buffer) => { record.emitted += c.length; });
    inflates.push(record);
    return stream;
  } };
});

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

  it('ignores ordinary directory headers without hiding unsafe directory paths', async () => {
    const dest = mkDest();
    const buf = tar([
      tarEntry('repo-a/', '', '5'), tarEntry('repo-a/src/', '', '5'),
      tarEntry('repo-a/../../escape/', '', '5'), tarEntry('/outside/', '', '5'),
      tarEntry('repo-a/src/main.py', 'app = 1'),
    ]);
    const r = await unpackTarball(buf, dest, CAPS);
    expect(r.files).toEqual(['src/main.py']);
    expect(r.skipped.map((s) => s.reason)).toEqual(['traversal', 'absolute-path']);
    expect(existsSync(join(dest, 'src/main.py'))).toBe(true);
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

  it('accepts gzip-compressed tarballs (codeload serves .tar.gz)', async () => {
    const dest = mkDest();
    const gz = gzipSync(Buffer.from(tar([tarEntry('repo-a/pom.xml', '<project/>'), tarEntry('repo-a/../evil', 'x')])));
    const r = await unpackTarball(gz, dest, CAPS);
    expect(r.files).toEqual(['pom.xml']);
    expect(r.skipped.some((s) => s.reason === 'traversal')).toBe(true);
  });

  it('rejects a decompressed archive over maxExpandedBytes (gzip bomb guard)', async () => {
    const dest = mkDest();
    const gz = gzipSync(Buffer.from(tar([tarEntry('repo-a/big.txt', 'x'.repeat(100 * 1024))])));
    await expect(unpackTarball(gz, dest, { ...CAPS, maxExpandedBytes: 64 * 1024 })).rejects.toThrow(/oversized/i);
  });

  it('aborts inflate incrementally — never allocates the full expansion (I2)', async () => {
    const dest = mkDest();
    // 1 GB of zeros → ~1 MB gzip. Counting emitted bytes instead of timing keeps
    // this deterministic under load: the stream must pass the 32 MB cap (so the
    // streaming guard ran) and stop within a few chunks of it, not at 1 GB.
    const cap = 32 * 1024 * 1024;
    const bomb = gzipSync(Buffer.alloc(1024 * 1024 * 1024));
    const before = inflates.length;
    await expect(unpackTarball(bomb, dest, { ...CAPS, maxExpandedBytes: cap })).rejects.toThrow(/oversized/i);
    const [inflate] = inflates.slice(before);
    expect(inflate, 'unpack inflated through a stream').toBeDefined();
    if (!inflate!.stream.closed) await new Promise((resolve) => inflate!.stream.once('close', resolve));
    expect(inflate!.emitted).toBeGreaterThan(cap);
    expect(inflate!.emitted, `inflated ${inflate!.emitted} bytes for a ${cap}-byte cap`).toBeLessThan(cap + 4 * 1024 * 1024);
  }, 60_000);

  it('inflates past maxTotalBytes when the expanded size stays under maxExpandedBytes', async () => {
    const dest = mkDest();
    const gz = gzipSync(Buffer.from(tar([
      tarEntry('repo-a/f1.txt', 'x'.repeat(40 * 1024)),
      tarEntry('repo-a/f2.txt', 'y'.repeat(40 * 1024)),
      tarEntry('repo-a/f3.txt', 'z'.repeat(40 * 1024)),
    ])));
    expect(gz.byteLength).toBeLessThan(64 * 1024); // compressed well under the fetch cap
    const r = await unpackTarball(gz, dest, { ...CAPS, maxTotalBytes: 64 * 1024 });
    expect(r.files).toEqual(['f1.txt', 'f2.txt', 'f3.txt']); // 120KB expanded < default 100MB
  });

  it('cleanupDir removes the temp dir', async () => {
    const dest = mkDest();
    cleanupDir(dest);
    expect(existsSync(dest)).toBe(false);
  });
});


describe('scope before materialization and file limits',()=>{
  it('never writes or charges out-of-scope entries against the selected file count',async()=>{
    const dest=mkDest();const result=await unpackTarball(tar([
      tarEntry('repo-a/outside/a.go','package outside'),tarEntry('repo-a/api-sibling/large.go','x'.repeat(200)),tarEntry('repo-a/api/large.go','x'.repeat(200)),
      tarEntry('repo-a/api/main.go','package api'),tarEntry('repo-a/outside/link','','2','/'),
    ]),dest,{...CAPS,maxFiles:1,maxFileBytes:100},{subdir:'api'});
    expect(result.files).toEqual(['api/main.go']);expect(existsSync(join(dest,'outside'))).toBe(false);expect(existsSync(join(dest,'api-sibling'))).toBe(false);
    expect(result.skipped).toEqual([{path:'api/large.go',reason:'size:200>100'}]);
  });
  it('keeps archive integrity limits global even for a tiny selected folder',async()=>{
    const buf=gzipSync(new Uint8Array(tar([tarEntry('repo-a/outside/huge.go','x'.repeat(100000)),tarEntry('repo-a/api/main.go','package api')])));
    await expect(unpackTarball(buf,mkDest(),{...CAPS,maxExpandedBytes:10000},{subdir:'api'})).rejects.toThrow(/oversized/i);
  });
  it.each(['../escape','/escape','api/../escape','api\\escape'])('rejects unsafe unpack scope %s',async subdir=>{
    await expect(unpackTarball(tar([tarEntry('repo-a/main.go','package main')]),mkDest(),CAPS,{subdir})).rejects.toThrow(/subdir/i);
  });
  it('skips generated outputs before the cap while keeping ordinary source names',async()=>{
    const entries=['.next-dev/cache/a.ts','dist/a.ts','out/a.ts','coverage/a.ts','__generated__/a.ts','generated/a.ts','.nuxt-build/a.ts','a.generated.d.ts','a.generated.ts','a.js.map','a.tsbuildinfo'].map(n=>tarEntry('repo-a/'+n,'x'));
    const result=await unpackTarball(tar([...entries,tarEntry('repo-a/src/next.ts','source')]),mkDest(),{...CAPS,maxFiles:1});
    expect(result.files).toEqual(['src/next.ts']);expect(result.skipped.filter(s=>s.reason==='file-count-cap')).toEqual([]);
  });
});


it('rejects truncated out-of-scope bodies instead of silently ending the selected inventory',async()=>{
  const broken=tar([tarEntry('repo-a/outside/huge.go','x'.repeat(1000))]).slice(0,600);
  await expect(unpackTarball(broken,mkDest(),CAPS,{subdir:'api'})).rejects.toThrow(/truncated|archive/i);
});
it('enforces the expanded archive guard for uncompressed library input too',async()=>{
  await expect(unpackTarball(tar([tarEntry('repo-a/outside/huge.go','x'.repeat(10000))]),mkDest(),{...CAPS,maxExpandedBytes:3000},{subdir:'api'})).rejects.toThrow(/oversized/i);
});
