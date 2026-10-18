import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Fragment } from '@archwoven/extract';
import { ingestLocal, walkLocal } from './local';
import { commitFixture } from './git-fixtures';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'aw-local-')); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const emptyFragment = (): Fragment => ({ nodes: [], edges: [], endpoints: [], gaps: [] });
const cannedRev = async (dir: string) => commitFixture(dir);

const springTree = (): string => {
  const d = tmp();
  mkdirSync(join(d, 'src/main/java/com/shop'), { recursive: true });
  writeFileSync(join(d, 'pom.xml'), '<project><parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId></parent></project>');
  writeFileSync(join(d, 'src/main/java/com/shop/ApiController.java'), '@RestController public class ApiController { private final OrderService orderService; }');
  return d;
};

describe('ingestLocal (private clone import)', () => {
  it('uses bounded generic analysis for local Go repos without executing source', async () => {
    const d = tmp();
    writeFileSync(join(d, 'main.go'), 'package main\nfunc main() {}');
    const r = await ingestLocal(d, { revParse: cannedRev, extractSpringBoot: async () => { throw new Error('must not run'); }, extractFastApi: async () => { throw new Error('must not run'); } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.framework).toBe('generic');
    expect(r.fragment.nodes[0]).toMatchObject({ label: 'main.go', kind: 'component' });
  });
  it('committed spring tree → fragment + pinned sha + framework', async () => {
    const d = springTree();
    const r = await ingestLocal(d, { revParse: cannedRev, extractSpringBoot: async () => ({ ...emptyFragment(), nodes: [{ id: 'svc.app', kind: 'service', label: 'App', provenance: 'source-supported', evidence: [] }], endpoints: [{ method: 'GET', path: '/api/x', controller: 'ApiController' }] }), extractFastApi: async () => emptyFragment() });
    expect(r.ok, JSON.stringify(r.ok ? '' : r)).toBe(true);
    if (!r.ok) return;
    expect(r.sha).toMatch(/^[a-f0-9]{40}$/);
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

describe('ingestLocal disclosures', () => {
  it('summarizes skipped files and never reports the clone\'s .git folder', async () => {
    const d = tmp();
    mkdirSync(join(d, '.git/objects'), { recursive: true });
    writeFileSync(join(d, '.git/HEAD'), 'ref: refs/heads/main');
    writeFileSync(join(d, 'main.go'), 'package main\nfunc main() {}');
    writeFileSync(join(d, 'go.sum'), 'example.com/x v1.0.0 h1:abc=');
    writeFileSync(join(d, 'package-lock.json'), '{}');
    const r = await ingestLocal(d, { revParse: cannedRev, extractSpringBoot: async () => emptyFragment(), extractFastApi: async () => emptyFragment() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.gaps.join('\n')).not.toMatch(/\.git\b(?!\w)/);
    expect(r.gaps.filter(g => g.startsWith('Skipped'))).toEqual(['Skipped 2 vendored, generated or lock files and folders: go.sum, package-lock.json.']);
  });
});


const scopedDeps = { revParse: cannedRev, extractSpringBoot: async () => emptyFragment(), extractFastApi: async () => emptyFragment() };
describe('subdirectory-first local scan',()=>{
  it('does not let outside files or warnings consume the selected scope budget',async()=>{
    const d=tmp();mkdirSync(join(d,'a-outside'));mkdirSync(join(d,'services/api'),{recursive:true});
    writeFileSync(join(d,'a-outside/a.py'),'x'.repeat(60));writeFileSync(join(d,'outside.bin'),'x'.repeat(100));
    symlinkSync(tmp(),join(d,'outside-link'));writeFileSync(join(d,'services/api/main.go'),'package main');
    const result=await ingestLocal(d,scopedDeps,{subdir:'services/api',caps:{maxFiles:1,maxTotalBytes:40,maxFileBytes:80}});
    expect(result.ok,JSON.stringify(result)).toBe(true);if(!result.ok)return;
    expect(result.filesScanned).toBe(1);expect(result.fragment.sourceContext?.inventory).toEqual(['services/api/main.go']);
    expect(result.gaps.join(' ')).not.toMatch(/outside|file limit|size limit|symlink/);
  });
  it('rejects a symlinked selected scope rather than reading it or treating it as an empty folder',async()=>{
    const d=tmp(),outside=tmp();writeFileSync(join(outside,'main.go'),'package main');symlinkSync(outside,join(d,'api'));
    const result=await ingestLocal(d,scopedDeps,{subdir:'api'});expect(result.ok).toBe(false);if(result.ok)return;expect(result.message).toMatch(/symlink|link/i);
  });
  it.each(['../outside','/outside','api/../../outside','api\\outside','api//nested','api/./nested','htmlcov','api/htmlcov','api/a.generated.d.ts'])('refuses unsafe direct-library scope %s before git',async subdir=>{
    let git=false;const result=await ingestLocal(tmp(),{...scopedDeps,revParse:async()=>{git=true;return 'sha';}},{subdir});
    expect(result.ok).toBe(false);expect(git).toBe(false);
  });
  it('reports in-scope omissions with full repository-relative paths only',async()=>{
    const d=tmp();mkdirSync(join(d,'api'));writeFileSync(join(d,'api/a.go'),'package api');writeFileSync(join(d,'api/b.go'),'package api');writeFileSync(join(d,'outside.go'),'package outside');
    const result=await ingestLocal(d,scopedDeps,{subdir:'api',caps:{maxFiles:1,maxTotalBytes:1000,maxFileBytes:500}});
    expect(result.ok).toBe(true);if(!result.ok)return;expect(result.gaps.join(' ')).toContain('api/b.go');expect(result.gaps.join(' ')).not.toContain('outside.go');
  });
  it.each(['missing','main.go'])('reports a missing or non-directory scope: %s',async subdir=>{
    const d=tmp();writeFileSync(join(d,'main.go'),'package main');const result=await ingestLocal(d,scopedDeps,{subdir});expect(result.ok).toBe(false);if(result.ok)return;expect(result.reason).toBe('invalid-subdir');
  });
  it('excludes generated directories and files before counting or reading source',async()=>{
    const d=tmp();for(const folder of ['.next-hosted','dist','out','coverage','__generated__','generated','.turbo']){mkdirSync(join(d,folder));writeFileSync(join(d,folder,'index.ts'),'export const generated=true;');}
    writeFileSync(join(d,'a.generated.d.ts'),'export const a=1;');writeFileSync(join(d,'a.generated.ts'),'export const generated=true;');writeFileSync(join(d,'a.js.map'),'{}');writeFileSync(join(d,'a.tsbuildinfo'),'{}');writeFileSync(join(d,'main.go'),'package main');
    const result=await ingestLocal(d,scopedDeps,{caps:{maxFiles:1,maxTotalBytes:30,maxFileBytes:1000}});
    expect(result.ok).toBe(true);if(!result.ok)return;expect(result.filesScanned).toBe(1);expect(result.fragment.sourceContext?.inventory).toEqual(['main.go']);expect(result.gaps.join(' ')).not.toContain('file limit');
  });
});
