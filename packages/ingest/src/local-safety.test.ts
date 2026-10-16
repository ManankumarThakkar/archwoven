import { afterAll, describe, expect, it, vi } from 'vitest';
import fs, { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractFastApi, extractSpringBoot } from '@archwoven/extract';
import { ingestLocal, walkLocal } from './local';

const dirs: string[] = [];
const tmp = () => { const dir = mkdtempSync(join(tmpdir(), 'aw-source-safety-')); dirs.push(dir); return dir; };
afterAll(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });
const deps = { revParse: async () => '0123456789abcdef0123456789abcdef01234567', extractFastApi, extractSpringBoot };
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

it('rejects an ancestor directory swapped after canonicalization but before open', async () => {
  const dir = fs.realpathSync(tmp());
  const outside = tmp();
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/main.py'), 'from fastapi import FastAPI\nApproved = FastAPI()');
  writeFileSync(join(outside, 'main.py'), 'from fastapi import FastAPI\nOutside = FastAPI()');
  const realpath = fs.realpathSync;
  let swapped = false;
  const spy = vi.spyOn(fs, 'realpathSync').mockImplementation((path, ...args) => {
    const canonical = realpath(path, ...args);
    if (path === join(dir, 'src/main.py') && !swapped) {
      swapped = true;
      renameSync(join(dir, 'src'), join(dir, 'saved'));
      symlinkSync(outside, join(dir, 'src'));
    }
    return canonical;
  });
  syncBuiltinESMExports();
  try {
    const result = await ingestLocal(dir, deps);
    expect(swapped).toBe(true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fragment.nodes.some((node) => node.label === 'Outside')).toBe(false);
    expect(result.gaps.join(' ')).toMatch(/changed|redirected|symlink/);
  } finally {
    spy.mockRestore();
    syncBuiltinESMExports();
  }
});
