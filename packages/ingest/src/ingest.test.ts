import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Fragment } from '@archwoven/extract';
import { ingestRepo, type IngestDeps } from './ingest';
import { tarEntry, tar } from './tar-fixtures';

const SHA = '0123456789abcdef0123456789abcdef01234567';

const emptyFragment = (): Fragment => ({ nodes: [], edges: [], endpoints: [], gaps: [] });

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'aw-ingest-')); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/** canned fetcher: api.github.com → sha, codeload → tar bytes */
function cannedFetcher(entries: Uint8Array[]): IngestDeps['fetcher'] {
  const buf = tar(entries);
  return async (url) => {
    if (url.includes('codeload')) return new Response(buf);
    if (url.includes('/commits/')) return Response.json({ sha: SHA });
    return Response.json({ default_branch: 'main' });
  };
}

const SPRING_TAR = [
  tarEntry('shop-main/pom.xml', '<project><groupId>org.springframework.boot</groupId></project>'),
  tarEntry('shop-main/src/main/java/App.java', '@SpringBootApplication public class App {}'),
  tarEntry('shop-main/node_modules/x/index.js', 'evil()'),
];

describe('ingestRepo (pin → fetch → unpack → detect → extract)', () => {
  it('happy spring-boot path: fragment + pinned sha + gap list', async () => {
    let extractedDir: string | null = null;
    const deps: IngestDeps = {
      fetcher: cannedFetcher(SPRING_TAR),
      extractSpringBoot: async (dir) => { extractedDir = dir; return { ...emptyFragment(), nodes: [{ id: 'svc.app', kind: 'service', label: 'App', provenance: 'source-supported', evidence: [{ path: 'src/main/java/App.java', lines: [1, 1] }] }] }; },
      extractFastApi: async () => { throw new Error('must not run'); },
      tmpRoot: tmp(),
    };
    const r = await ingestRepo({ owner: 'foo', repo: 'shop' }, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sha).toBe(SHA);
    expect(r.framework).toBe('spring-boot');
    expect(r.fragment.nodes.map((n) => n.id)).toEqual(['svc.app']);
    expect(r.filesScanned).toBe(2); // node_modules skipped
    expect(r.gaps.some((g) => g.includes('node_modules') && g.includes('vendor'))).toBe(true);
    // extraction ran inside a temp dir, not cwd
    expect(extractedDir).toContain('aw-ingest-');
  });

  it('runs the fastapi extractor for a fastapi repo', async () => {
    const deps: IngestDeps = {
      fetcher: cannedFetcher([tarEntry('api-main/main.py', 'from fastapi import FastAPI\napp = FastAPI()')]),
      extractSpringBoot: async () => { throw new Error('must not run'); },
      extractFastApi: async () => ({ ...emptyFragment(), gaps: ['no ORM detected'] }),
      tmpRoot: tmp(),
    };
    const r = await ingestRepo({ owner: 'foo', repo: 'api' }, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.framework).toBe('fastapi');
    expect(r.gaps).toContain('no ORM detected');
  });

  it('mixed repo → error asking for a subdir, no extraction', async () => {
    const deps: IngestDeps = {
      fetcher: cannedFetcher([
        tarEntry('m-main/pom.xml', '<project><groupId>org.springframework.boot</groupId></project>'),
        tarEntry('m-main/src/main/java/A.java', '@SpringBootApplication class A {}'),
        tarEntry('m-main/main.py', 'from fastapi import FastAPI\napp = FastAPI()'),
      ]),
      extractSpringBoot: async () => { throw new Error('must not run'); },
      extractFastApi: async () => { throw new Error('must not run'); },
      tmpRoot: tmp(),
    };
    const r = await ingestRepo({ owner: 'foo', repo: 'm' }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('mixed-frameworks');
      expect(r.message).toMatch(/subdir/i);
    }
  });

  it('unsupported repo → explicit reason', async () => {
    const deps: IngestDeps = {
      fetcher: cannedFetcher([tarEntry('x-main/README.md', '# docs only')]),
      extractSpringBoot: async () => { throw new Error('no'); },
      extractFastApi: async () => { throw new Error('no'); },
      tmpRoot: tmp(),
    };
    const r = await ingestRepo({ owner: 'foo', repo: 'x' }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unsupported-framework');
  });

  it('.gitmodules and LFS attributes become explicit gaps', async () => {
    const deps: IngestDeps = {
      fetcher: cannedFetcher([
        tarEntry('r-main/pom.xml', '<project><groupId>org.springframework.boot</groupId></project>'),
        tarEntry('r-main/src/main/java/A.java', '@SpringBootApplication class A {}'),
        tarEntry('r-main/.gitmodules', '[submodule "lib"]'),
        tarEntry('r-main/.gitattributes', '*.bin filter=lfs'),
      ]),
      extractSpringBoot: async () => emptyFragment(),
      extractFastApi: async () => { throw new Error('no'); },
      tmpRoot: tmp(),
    };
    const r = await ingestRepo({ owner: 'foo', repo: 'r' }, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.gaps.some((g) => /submodule/i.test(g))).toBe(true);
    expect(r.gaps.some((g) => /lfs/i.test(g))).toBe(true);
  });

  it('pin failure propagates without fetching', async () => {
    let codeload = false;
    const deps: IngestDeps = {
      fetcher: async (url) => {
        if (url.includes('codeload')) { codeload = true; return new Response(''); }
        return Response.json({ message: 'Not Found' }, { status: 404 });
      },
      extractSpringBoot: async () => emptyFragment(),
      extractFastApi: async () => emptyFragment(),
      tmpRoot: tmp(),
    };
    const r = await ingestRepo({ owner: 'foo', repo: 'gone' }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not-found-or-private');
    expect(codeload).toBe(false);
  });

  it('extractor crash → ok:false, never a throw', async () => {
    const deps: IngestDeps = {
      fetcher: cannedFetcher([
        tarEntry('r-main/pom.xml', '<project><groupId>org.springframework.boot</groupId></project>'),
        tarEntry('r-main/src/main/java/A.java', '@SpringBootApplication class A {}'),
      ]),
      extractSpringBoot: async () => { throw new Error('grammar blew up'); },
      extractFastApi: async () => emptyFragment(),
      tmpRoot: tmp(),
    };
    const r = await ingestRepo({ owner: 'foo', repo: 'r' }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/grammar blew up/);
  });

  it('subdir narrows the extraction scope', async () => {
    let seenDir = '';
    const deps: IngestDeps = {
      fetcher: cannedFetcher([
        tarEntry('r-main/services/api/main.py', 'from fastapi import FastAPI\napp = FastAPI()'),
        tarEntry('r-main/services/api/routes.py', 'x = 1'),
        tarEntry('r-main/other/main.py', 'print(2)'),
      ]),
      extractSpringBoot: async () => { throw new Error('no'); },
      extractFastApi: async (dir) => { seenDir = dir; return emptyFragment(); },
      tmpRoot: tmp(),
    };
    const r = await ingestRepo({ owner: 'foo', repo: 'r', subdir: 'services/api' }, deps);
    expect(r.ok).toBe(true);
    expect(seenDir).toContain(join('services', 'api'));
    if (r.ok) expect(r.filesScanned).toBe(2);
  });
});
