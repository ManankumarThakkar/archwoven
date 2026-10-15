import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Fragment } from '@archwoven/extract';
import { ingestLocal, walkLocal } from './local';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'aw-local-')); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const emptyFragment = (): Fragment => ({ nodes: [], edges: [], endpoints: [], gaps: [] });
const cannedRev = async () => 'deadbeefcafe';

const springTree = (): string => {
  const d = tmp();
  mkdirSync(join(d, 'src/main/java/com/shop'), { recursive: true });
  writeFileSync(join(d, 'pom.xml'), '<project><parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId></parent></project>');
  writeFileSync(join(d, 'src/main/java/com/shop/ApiController.java'), '@RestController public class ApiController { private final OrderService orderService; }');
  return d;
};

describe('ingestLocal (private clone import, §8)', () => {
  it('spring tree → fragment + injected sha + framework', async () => {
    const d = springTree();
    const r = await ingestLocal(d, { revParse: cannedRev, extractSpringBoot: async () => ({ ...emptyFragment(), nodes: [{ id: 'svc.app', kind: 'service', label: 'App', provenance: 'source-supported', evidence: [] }], endpoints: [{ method: 'GET', path: '/api/x', controller: 'ApiController' }] }), extractFastApi: async () => emptyFragment() });
    expect(r.ok, JSON.stringify(r.ok ? '' : r)).toBe(true);
    if (!r.ok) return;
    expect(r.sha).toBe('deadbeefcafe');
    expect(r.framework).toBe('spring-boot');
    expect(r.fragment.nodes.map((n) => n.id)).toEqual(['svc.app']);
  });

  it('vendor dirs and binary extensions never appear in files', async () => {
    const d = springTree();
    mkdirSync(join(d, 'node_modules/pkg'), { recursive: true });
    mkdirSync(join(d, 'target'), { recursive: true });
    writeFileSync(join(d, 'node_modules/pkg/index.js'), 'x');
    writeFileSync(join(d, 'target/App.class'), 'x');
    const { files } = await walkLocal(d, { maxFiles: 100, maxTotalBytes: 1e6, maxFileBytes: 1e5 });
    expect(files).toContain('src/main/java/com/shop/ApiController.java');
    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
    expect(files.some((f) => f.endsWith('.class'))).toBe(false);
  });

  it('non-directory → not-a-directory', async () => {
    const d = tmp();
    const f = join(d, 'file.txt');
    writeFileSync(f, 'x');
    const r = await ingestLocal(f, { revParse: cannedRev, extractSpringBoot: async () => emptyFragment(), extractFastApi: async () => emptyFragment() });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('not-a-directory');
  });

  it('symlinks are skipped, never followed', async () => {
    const d = tmp();
    const outside = tmp();
    writeFileSync(join(outside, 'secret.txt'), 'secret');
    mkdirSync(join(d, 'sub'), { recursive: true });
    symlinkSync(join(outside, 'secret.txt'), join(d, 'sub', 'link.txt'));
    writeFileSync(join(d, 'main.py'), 'from fastapi import FastAPI\napp = FastAPI()');
    const { files, skipped } = await walkLocal(d, { maxFiles: 100, maxTotalBytes: 1e6, maxFileBytes: 1e5 });
    expect(files.some((f) => f.includes('link.txt'))).toBe(false);
    expect(skipped.some((s) => s.path.includes('link.txt') && s.reason.includes('symlink'))).toBe(true);
  });

  it('oversized file is skipped and gap-listed, not read into the walk', async () => {
    const d = tmp();
    writeFileSync(join(d, 'big.java'), 'x'.repeat(5000));
    writeFileSync(join(d, 'ok.java'), 'class Ok {}');
    const { files, skipped } = await walkLocal(d, { maxFiles: 100, maxTotalBytes: 1e6, maxFileBytes: 1000 });
    expect(files).toEqual(['ok.java']);
    expect(skipped.some((s) => s.path === 'big.java' && s.reason.includes('size'))).toBe(true);
  });

  it('missing dir → not-a-directory before any git call', async () => {
    let gitCalled = false;
    const r = await ingestLocal(join(tmp(), 'ghost'), { revParse: async () => { gitCalled = true; return 'x'; }, extractSpringBoot: async () => emptyFragment(), extractFastApi: async () => emptyFragment() });
    expect(r.ok).toBe(false);
    expect(gitCalled).toBe(false);
  });
});
