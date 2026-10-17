import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractFastApi, extractSpringBoot } from '@archwoven/extract';
import { gitRevParse, ingestLocal } from './local';
import { commitFixture, fixtureGit } from './git-fixtures';

const dirs: string[] = [];
const tmp = () => { const dir = mkdtempSync(join(tmpdir(), 'aw-commit-')); dirs.push(dir); return dir; };
afterAll(() => dirs.forEach(dir => rmSync(dir, { recursive: true, force: true })));
const deps = { revParse: gitRevParse, extractFastApi, extractSpringBoot };
const app = (name: string) => `from fastapi import FastAPI\n${name} = FastAPI()\n`;
const tree = () => {
  const dir = tmp();
  mkdirSync(join(dir, 'api'));
  writeFileSync(join(dir, 'api/main.py'), app('Committed'));
  return { dir, sha: commitFixture(dir) };
};

describe('local commit evidence uses actual git objects', () => {
  it('analyzes committed content while ignoring staged, unstaged and untracked replacements', async () => {
    const { dir, sha } = tree();
    writeFileSync(join(dir, 'api/main.py'), app('Staged'));
    fixtureGit(dir, 'add', 'api/main.py');
    writeFileSync(join(dir, 'api/main.py'), app('Unstaged'));
    writeFileSync(join(dir, 'api/untracked.py'), app('Untracked'));
    const result = await ingestLocal(dir, deps, { subdir: 'api' });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.sha).toBe(sha);
    expect(result.fragment.nodes.map(node => node.label)).toEqual(['Committed']);
    expect(result.gaps.join(' ')).toMatch(/uncommitted.*untracked.*not analyzed/i);
    expect(readFileSync(join(dir, 'api/main.py'), 'utf8')).toBe(app('Unstaged'));
    expect(fixtureGit(dir, 'show', ':api/main.py')).toBe(app('Staged').trim());
  });

  it('still analyzes a committed directory deleted from the working tree', async () => {
    const { dir, sha } = tree();
    rmSync(join(dir, 'api'), { recursive: true });
    const result = await ingestLocal(dir, deps, { subdir: 'api' });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.sha).toBe(sha);
    expect(result.fragment.nodes.map(node => node.label)).toEqual(['Committed']);
  });

  it('does not mix a newer HEAD or changed working files into an already pinned analysis', async () => {
    const { dir, sha } = tree();
    const result = await ingestLocal(dir, deps, { subdir: 'api', onStage: stage => {
      if (stage !== 'fetching') return;
      writeFileSync(join(dir, 'api/main.py'), app('LaterCommit'));
      commitFixture(dir);
    } });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.sha).toBe(sha);
    expect(fixtureGit(dir, 'rev-parse', 'HEAD')).not.toBe(sha);
    expect(result.fragment.nodes.map(node => node.label)).toEqual(['Committed']);
  });

  it('cannot follow a working-tree directory link instead of reading the pinned tree', async () => {
    const { dir } = tree(), outside = tmp();
    writeFileSync(join(outside, 'main.py'), app('Outside'));
    renameSync(join(dir, 'api'), join(dir, 'saved'));
    symlinkSync(outside, join(dir, 'api'));
    const result = await ingestLocal(dir, deps, { subdir: 'api' });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) expect(result.fragment.nodes.map(node => node.label)).toEqual(['Committed']);
  });

  it('rejects a nested working directory rather than publishing root-relative evidence for another file', async () => {
    const { dir } = tree();
    const result = await ingestLocal(join(dir, 'api'), deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/root.*subdirectory/i);
  });

  it('ignores replacement refs that would substitute different bytes under the pinned commit', async () => {
    const { dir, sha } = tree();
    writeFileSync(join(dir, 'api/main.py'), app('Replacement'));
    const replacement = commitFixture(dir);
    fixtureGit(dir, 'update-ref', 'refs/replace/' + sha, replacement);
    fixtureGit(dir, 'update-ref', 'HEAD', sha);
    const result = await ingestLocal(dir, deps, { subdir: 'api' });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) expect(result.fragment.nodes.map(node => node.label)).toEqual(['Committed']);
  });
});

it('does not run configured filters, textconv or archive substitutions', async () => {
  const { dir } = tree();
  rmSync(join(dir, 'api/main.py'));
  writeFileSync(join(dir, 'api/main.go'), 'package main');
  writeFileSync(join(dir, 'api/readme.md'), '$Format:%H$\n');
  writeFileSync(join(dir, '.gitattributes'), 'api/* filter=external diff=external export-subst\n');
  const sha = commitFixture(dir), marker = join(dir, 'helper-ran');
  fixtureGit(dir, 'config', 'filter.external.smudge', 'touch ' + marker);
  fixtureGit(dir, 'config', 'diff.external.textconv', 'touch ' + marker);
  const result = await ingestLocal(dir, deps, { subdir: 'api' });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) return;
  expect(result.sha).toBe(sha);
  expect(result.fragment.sourceContext?.samples.find(sample => sample.path === 'api/readme.md')?.text).toBe('$Format:%H$\n');
  expect(() => readFileSync(marker)).toThrow();
});

it('rejects an unavailable committed blob instead of silently reading its working copy', async () => {
  const { dir, sha } = tree();
  const blob = fixtureGit(dir, 'rev-parse', sha + ':api/main.py');
  rmSync(join(dir, '.git/objects', blob.slice(0, 2), blob.slice(2)));
  const result = await ingestLocal(dir, deps, { subdir: 'api' });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.message).toMatch(/unavailable locally/);
});

it('ignores missing generated blobs before requesting file sizes or source bytes', async () => {
  const { dir } = tree();
  mkdirSync(join(dir, 'api/generated'));
  writeFileSync(join(dir, 'api/generated/large.py'), 'generated');
  const sha = commitFixture(dir), blob = fixtureGit(dir, 'rev-parse', sha + ':api/generated/large.py');
  rmSync(join(dir, '.git/objects', blob.slice(0, 2), blob.slice(2)));
  const result = await ingestLocal(dir, deps, { subdir: 'api', caps: { maxFiles: 1, maxTotalBytes: 1000, maxFileBytes: 1000 } });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (result.ok) expect(result.fragment.nodes.map(node => node.label)).toEqual(['Committed']);
});

it('does not treat a committed LFS pointer as implementation source', async () => {
  const { dir } = tree();
  writeFileSync(join(dir, 'api/pointer.py'), 'version https://git-lfs.github.com/spec/v1\noid sha256:' + 'a'.repeat(64) + '\nsize 1234\n');
  commitFixture(dir);
  const result = await ingestLocal(dir, deps, { subdir: 'api' });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) return;
  expect(result.fragment.nodes.map(node => node.label)).toEqual(['Committed']);
  expect(result.gaps.join(' ')).toMatch(/LFS pointer.*not downloaded or analyzed/);
});

it('honors cancellation before any snapshot read', async () => {
  const { dir } = tree();
  const controller = new AbortController(); controller.abort();
  await expect(ingestLocal(dir, deps, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
});

it('supports SHA-256 repositories without shortening their commit evidence', async () => {
  const dir = tmp();
  fixtureGit(dir, 'init', '-q', '--object-format=sha256');
  writeFileSync(join(dir, 'main.go'), 'package main');
  const sha = commitFixture(dir);
  expect(sha).toHaveLength(64);
  const result = await ingestLocal(dir, deps);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (result.ok) { expect(result.sha).toBe(sha); expect(result.fragment.sourceContext?.inventory).toEqual(['main.go']); }
});

it('reads the actual commit of a linked git worktree', async () => {
  const { dir, sha } = tree(), worktree = join(tmp(), 'linked');
  fixtureGit(dir, 'worktree', 'add', '--detach', '-q', worktree, sha);
  writeFileSync(join(worktree, 'api/main.py'), app('WorkingChange'));
  const result = await ingestLocal(worktree, deps, { subdir: 'api' });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (result.ok) { expect(result.sha).toBe(sha); expect(result.fragment.nodes.map(node => node.label)).toEqual(['Committed']); }
});

it('preserves unusual committed filenames without splitting inventory records', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'a\tfile.py'), 'value = 1\n');
  writeFileSync(join(dir, '日本語.py'), 'value = 2\n');
  commitFixture(dir);
  const result = await ingestLocal(dir, deps);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (result.ok) expect(new Set(result.fragment.sourceContext?.inventory)).toEqual(new Set(['a\tfile.py', '日本語.py']));
});


function rawTree(dir: string, records: Buffer): string {
  return execFileSync('git', ['mktree', '-z'], { cwd: dir, input: records, encoding: 'utf8' }).trim();
}
function useTree(dir: string, tree: string): string {
  const sha = fixtureGit(dir, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit-tree', tree, '-m', 'raw fixture');
  fixtureGit(dir, 'update-ref', 'HEAD', sha);
  return sha;
}

it('prunes a large generated tree before it can consume the bounded inventory', async () => {
  const dir = tmp(); writeFileSync(join(dir, 'main.go'), 'package main');
  const initial = commitFixture(dir), blob = fixtureGit(dir, 'rev-parse', initial + ':main.go');
  const records = Buffer.from(Array.from({ length: 40000 }, (_, index) => `100644 blob ${blob}\t${'x'.repeat(180)}${index}.go\0`).join(''));
  const generated = rawTree(dir, records);
  const root = rawTree(dir, Buffer.from(`040000 tree ${generated}\tgenerated\0` + `100644 blob ${blob}\tmain.go\0`));
  useTree(dir, root);
  const result = await ingestLocal(dir, deps, { caps: { maxFiles: 1, maxTotalBytes: 1000, maxFileBytes: 1000 } });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (result.ok) expect(result.fragment.sourceContext?.inventory).toEqual(['main.go']);
}, 15000);

it('discloses invalid UTF-8 paths without inventing replacement-character citations', async () => {
  const dir = tmp(); writeFileSync(join(dir, 'main.go'), 'package main');
  const initial = commitFixture(dir), blob = fixtureGit(dir, 'rev-parse', initial + ':main.go');
  const root = rawTree(dir, Buffer.concat([
    Buffer.from(`100644 blob ${blob}\ta`), Buffer.from([255]), Buffer.from(`.go\0` + `100644 blob ${blob}\tmain.go\0`),
  ]));
  useTree(dir, root);
  const result = await ingestLocal(dir, deps);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) return;
  expect(result.fragment.sourceContext?.inventory).toEqual(['main.go']);
  expect(result.gaps.join(' ')).toMatch(/non-UTF-8.*not analyzed/);
});

it('never invokes a promisor transport helper to fetch a missing blob', async () => {
  const { dir, sha } = tree(), marker = join(dir, 'transport-ran');
  const blob = fixtureGit(dir, 'rev-parse', sha + ':api/main.py');
  fixtureGit(dir, 'config', 'remote.origin.promisor', 'true');
  fixtureGit(dir, 'config', 'remote.origin.url', 'ext::touch ' + marker);
  fixtureGit(dir, 'config', 'protocol.ext.allow', 'always');
  rmSync(join(dir, '.git/objects', blob.slice(0, 2), blob.slice(2)));
  const result = await ingestLocal(dir, deps, { subdir: 'api' });
  expect(result.ok).toBe(false);
  expect(() => readFileSync(marker)).toThrow();
  expect(() => readFileSync(join(dir, '.git/objects', blob.slice(0, 2), blob.slice(2)))).toThrow();
});
