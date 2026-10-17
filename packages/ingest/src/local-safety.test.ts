import { afterAll, describe, expect, it, vi } from 'vitest';
import fs, { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractFastApi, extractSpringBoot } from '@archwoven/extract';
import { ingestLocal, walkLocal } from './local';
import { commitFixture } from './git-fixtures';

const dirs: string[] = [];
const tmp = () => { const dir = mkdtempSync(join(tmpdir(), 'aw-source-safety-')); dirs.push(dir); return dir; };
afterAll(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });
const deps = { revParse: async (dir: string) => commitFixture(dir), extractFastApi, extractSpringBoot };
const caps = { maxFiles: 100, maxTotalBytes: 10000, maxFileBytes: 1000 };

for (const framework of ['fastapi', 'spring-boot'] as const) {
  const ext = framework === 'fastapi' ? '.py' : '.java';
  const source = (name: string) => framework === 'fastapi'
    ? `from fastapi import FastAPI\n${name} = FastAPI()\n`
    : `@SpringBootApplication @RestController public class ${name} {}\n`;
  const tree = () => { const dir = tmp(); writeFileSync(join(dir, `a-main${ext}`), source('Approved')); return dir; };
  const labels = async (dir: string, opts: Parameters<typeof ingestLocal>[2] = {}) => {
    const result = await ingestLocal(dir, deps, { caps, ...opts });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.framework).toBe(framework);
    return result.fragment.nodes.map((node) => node.label);
  };

  describe(`${framework} approved source inventory`, () => {
    it('does not parse a file symlink to an outside source', async () => {
      const dir = tree();
      const outside = join(tmp(), `Outside${ext}`);
      writeFileSync(outside, source('Outside'));
      symlinkSync(outside, join(dir, `linked${ext}`));
      expect(await labels(dir)).toEqual(['Approved']);
    });

    it('does not parse source under a directory symlink', async () => {
      const dir = tree();
      const outside = tmp();
      writeFileSync(join(outside, `Outside${ext}`), source('Outside'));
      symlinkSync(outside, join(dir, 'linked-directory'));
      expect(await labels(dir)).toEqual(['Approved']);
    });

    it('does not parse excluded vendor or sensitive source files', async () => {
      const dir = tree();
      mkdirSync(join(dir, 'target'));
      writeFileSync(join(dir, 'target', `Vendor${ext}`), source('Vendor'));
      writeFileSync(join(dir, `credentials${ext}`), source('Credentials'));
      expect(await labels(dir)).toEqual(['Approved']);
    });

    it('does not parse binary source content', async () => {
      const dir = tree();
      writeFileSync(join(dir, `Binary${ext}`), source('Binary') + '\0');
      expect(await labels(dir)).toEqual(['Approved']);
    });

    it('does not parse a source rejected by the per-file cap', async () => {
      const dir = tree();
      writeFileSync(join(dir, `Large${ext}`), source('Large') + (framework === 'fastapi' ? '#' : '//') + 'x'.repeat(1200));
      expect(await labels(dir)).toEqual(['Approved']);
    });

    it('does not rediscover sources rejected by the file-count cap', async () => {
      const dir = tree();
      writeFileSync(join(dir, `z-extra${ext}`), source('Extra'));
      expect(await labels(dir, { caps: { ...caps, maxFiles: 1 } })).toEqual(['Approved']);
    });

    it('parses captured text when an accepted path is replaced before extraction', async () => {
      const dir = tree();
      const outside = join(tmp(), `Outside${ext}`);
      writeFileSync(outside, source('Outside'));
      expect(await labels(dir, { onStage: (stage) => {
        if (stage !== 'extracting') return;
        rmSync(join(dir, `a-main${ext}`));
        symlinkSync(outside, join(dir, `a-main${ext}`));
      } })).toEqual(['Approved']);
    });
  });
}

it('preserves approved Spring datasource configuration and its full evidence path', async () => {
  const dir = tmp();
  mkdirSync(join(dir, 'src/main/resources'), { recursive: true });
  writeFileSync(join(dir, 'App.java'), '@SpringBootApplication @RestController public class App {}');
  writeFileSync(join(dir, 'src/main/resources/application.yml'), 'spring:\n  datasource:\n    url: jdbc:postgresql://localhost/shop\n');
  const result = await ingestLocal(dir, deps);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.fragment.nodes.find((node) => node.label === 'PostgreSQL')).toMatchObject({ evidence: [{ path: 'src/main/resources/application.yml', lines: [3, 3] }] });
});

it('does not parse excluded Spring datasource configuration', async () => {
  const dir = tmp();
  const outside = tmp();
  writeFileSync(join(dir, 'App.java'), '@SpringBootApplication @RestController public class App {}');
  writeFileSync(join(outside, 'application.yml'), 'url: jdbc:mysql://localhost/outside');
  symlinkSync(join(outside, 'application.yml'), join(dir, 'application.yml'));
  writeFileSync(join(dir, 'application-secrets.properties'), 'url=jdbc:postgresql://localhost/private');
  const result = await ingestLocal(dir, deps);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.fragment.nodes.map((node) => node.label)).toEqual(['App']);
});

it.each([extractFastApi, extractSpringBoot])('an explicit empty inventory never falls back to reading a directory', async (extract) => {
  expect((await extract('/directory-that-does-not-exist', new Map())).nodes).toEqual([]);
});

it('bounds the combined size of accepted local files and discloses omissions', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'a.py'), 'a'.repeat(60));
  writeFileSync(join(dir, 'b.py'), 'b'.repeat(60));
  const result = await walkLocal(dir, { maxFiles: 10, maxTotalBytes: 100, maxFileBytes: 80 });
  expect(result.files).toEqual(['a.py']);
  expect(result.skipped).toEqual([expect.objectContaining({ path: 'b.py', reason: expect.stringMatching(/total.*cap/i) })]);
});

it('reads committed sources when the working directory is redirected before capture', async () => {
  const dir = fs.realpathSync(tmp()), outside = tmp();
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/main.py'), 'from fastapi import FastAPI\nApproved = FastAPI()');
  writeFileSync(join(outside, 'main.py'), 'from fastapi import FastAPI\nOutside = FastAPI()');
  const result = await ingestLocal(dir, deps, { onStage: stage => {
    if (stage !== 'fetching') return;
    renameSync(join(dir, 'src'), join(dir, 'saved'));
    symlinkSync(outside, join(dir, 'src'));
  } });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (result.ok) expect(result.fragment.nodes.map(node => node.label)).toEqual(['Approved']);
});


it.each(['fastapi','spring-boot'] as const)('scoped %s parser evidence remains repository-relative',async framework=>{
  const dir=tmp();mkdirSync(join(dir,'services/api'),{recursive:true});
  const filename=framework==='fastapi'?'main.py':'App.java';
  writeFileSync(join(dir,'services/api',filename),framework==='fastapi'?'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/ping")\ndef ping(): return "ok"':'@SpringBootApplication @RestController class App { @GetMapping("/ping") public String ping() { return "ok"; } }');
  const result=await ingestLocal(dir,deps,{subdir:'services/api'});expect(result.ok).toBe(true);if(!result.ok)return;expect(result.framework).toBe(framework);
  const paths=[...result.fragment.nodes.flatMap(n=>n.evidence),...result.fragment.edges.flatMap(e=>e.evidence),...result.fragment.endpoints.map(e=>e.evidence)].map(e=>e.path).filter(Boolean);
  expect(paths.length).toBeGreaterThan(0);expect(new Set(paths)).toEqual(new Set(['services/api/'+filename]));
});


it.each(['.hidden','tests','__generated__'])('a selected %s directory cannot bypass the repository path policy',async subdir=>{
  const dir=tmp();mkdirSync(join(dir,subdir));writeFileSync(join(dir,subdir,'main.go'),'package main');
  const result=await ingestLocal(dir,deps,{subdir});expect(result.ok).toBe(false);
});
it('does not follow a clone root replaced with a directory symlink before enumeration',async()=>{
  const parent=fs.realpathSync(tmp()),dir=join(parent,'clone'),outside=tmp();mkdirSync(dir);writeFileSync(join(dir,'main.go'),'package approved');writeFileSync(join(outside,'outside.go'),'package outside');
  const result=await ingestLocal(dir,deps,{onStage:stage=>{if(stage==='fetching'){renameSync(dir,join(parent,'saved'));symlinkSync(outside,dir);}}});
  expect(result.ok).toBe(false);
});


it('never enumerates a sibling directory during a scoped import',async()=>{
  const dir=fs.realpathSync(tmp());mkdirSync(join(dir,'outside'));mkdirSync(join(dir,'api'));writeFileSync(join(dir,'outside/a.go'),'package outside');writeFileSync(join(dir,'api/main.go'),'package api');
  const original=fs.readdirSync;const visited:string[]=[];const spy=vi.spyOn(fs,'readdirSync').mockImplementation(((path:fs.PathLike,...args:unknown[])=>{visited.push(String(path));return Reflect.apply(original,fs,[path,...args]);}) as typeof fs.readdirSync);
  syncBuiltinESMExports();try{const result=await ingestLocal(dir,deps,{subdir:'api'});expect(result.ok).toBe(true);expect(visited).toEqual([]);}finally{spy.mockRestore();syncBuiltinESMExports();}
});
