/**
 * Selftest helper: a fixed copy of the model validator bundle. A build running at the same time
 * truncates and rewrites packages/model/dist/index.js, and a child process that imports it
 * mid-write fails for reasons unrelated to the harness under test.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '../packages/model/dist/index.js');

/** Path of a snapshot that read identically twice and imports cleanly; its folder is the caller's to remove. */
export async function stableValidator() {
  const dir = mkdtempSync(join(tmpdir(), 'aw-validator-'));
  for (let attempt = 0; attempt < 100; attempt++) {
    const first = readFileSync(DIST);
    await new Promise((r) => setTimeout(r, 25));
    if (first.length > 0 && first.equals(readFileSync(DIST))) {
      const file = join(dir, `validator-${attempt}.mjs`);
      writeFileSync(file, first);
      try { await import(pathToFileURL(file).href); return file; } catch { /* caught mid-write; try again */ }
    }
  }
  throw new Error('packages/model/dist/index.js never settled; is a build looping?');
}
