import { describe, expect, it } from 'vitest';
import { summarizeSkipped } from './disclosures';

describe('summarizeSkipped', () => {
  it('groups skipped files by reason into readable disclosures with examples', () => {
    expect(summarizeSkipped([
      { path: 'pnpm-lock.yaml', reason: 'vendor file' },
      { path: 'apps/web/public/fonts/inter-400.woff2', reason: 'vendor file' },
      { path: 'node_modules', reason: 'vendor directory' },
      { path: 'apps/web/public/resvg/index_bg.wasm', reason: 'over per-file size cap (2478606 bytes)' },
      { path: 'docs/diagram.png', reason: 'binary' },
    ])).toEqual([
      'Skipped 3 vendored, generated or lock files and folders: pnpm-lock.yaml, apps/web/public/fonts/inter-400.woff2, node_modules.',
      'Skipped 1 file over the per-file size limit: apps/web/public/resvg/index_bg.wasm.',
      'Skipped 1 binary file: docs/diagram.png.',
    ]);
  });

  it('never reports the .git folder of a local clone as a gap', () => {
    expect(summarizeSkipped([{ path: '.git', reason: 'vendor directory' }, { path: '.git/hooks/pre-commit', reason: 'vendor file' }])).toEqual([]);
  });

  it('shows three examples and counts the rest', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ path: `vendor/lib${i}.js`, reason: 'vendor file' }));
    expect(summarizeSkipped(many)).toEqual(['Skipped 7 vendored, generated or lock files and folders: vendor/lib0.js, vendor/lib1.js, vendor/lib2.js and 4 more.']);
  });

  it.each([
    [{ path: 'a.txt', reason: 'over file cap' }, /Stopped at the file limit; 1 file was not analyzed: a\.txt/],
    [{ path: 'b.txt', reason: 'file-count-cap' }, /Stopped at the file limit/],
    [{ path: 'c.txt', reason: 'over total size cap' }, /Stopped at the total size limit; 1 file was not analyzed/],
    [{ path: 'd.txt', reason: 'expanded-size-cap' }, /Stopped at the total size limit/],
    [{ path: 'link', reason: 'symlink (not followed)' }, /Skipped 1 link or special file, not followed for safety: link/],
    [{ path: 'dev', reason: 'type:3' }, /link or special file/],
    [{ path: '../evil', reason: 'traversal' }, /Rejected 1 unsafe archive entry: \.\.\/evil/],
    [{ path: 'x.py', reason: 'changed during capture' }, /Skipped 1 file \(changed during capture\): x\.py/],
  ])('describes %j', (entry, message) => {
    expect(summarizeSkipped([entry]).join(' ')).toMatch(message);
  });

  it('keeps distinct unknown reasons apart', () => {
    expect(summarizeSkipped([{ path: 'a', reason: 'redirected' }, { path: 'b', reason: 'changed during capture' }])).toHaveLength(2);
  });

  it('returns nothing when nothing was skipped', () => {
    expect(summarizeSkipped([])).toEqual([]);
  });
});
