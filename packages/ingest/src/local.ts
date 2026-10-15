import { execFile } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Fragment } from '@archwoven/extract';
import { detectFramework } from './detect';
import { isVendor, type UnpackCaps } from './unpack';
import type { IngestResult } from './ingest';

/**
 * Local-clone ingest (§8 private flow): reads the user's own directory — no
 * tarball, no network, no temp copy (nothing to retain). Same vendor/binary
 * filtering and caps as the hosted unpack, same IngestResult contract.
 */
export interface LocalIngestDeps {
  revParse: (dir: string) => Promise<string>;
  extractSpringBoot: (dir: string) => Promise<Fragment>;
  extractFastApi: (dir: string) => Promise<Fragment>;
}

const DEFAULT_CAPS: UnpackCaps = { maxFiles: 3000, maxTotalBytes: 25 * 1024 * 1024, maxFileBytes: 512 * 1024 };

const execFileP = promisify(execFile);
/** Production revParse: git CLI on the user's own clone — fixed argv, no shell;
 *  rev-parse never executes repo hooks. */
export const gitRevParse = (dir: string): Promise<string> =>
  execFileP('git', ['rev-parse', 'HEAD'], { cwd: dir }).then((r) => r.stdout.trim());

/** Recursive walk with the same safety filter as the tarball unpack.
 *  Symlinks are refused, never followed; caps bound the scan. */
export async function walkLocal(dir: string, caps: UnpackCaps): Promise<{ files: string[]; skipped: { path: string; reason: string }[] }> {
  const files: string[] = [];
  const skipped: { path: string; reason: string }[] = [];
  const walk = (abs: string, rel: string) => {
    for (const ent of readdirSafe(abs)) {
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      const childAbs = join(abs, ent.name);
      if (ent.isSymbolicLink()) { skipped.push({ path: childRel, reason: 'symlink (not followed)' }); continue; }
      if (ent.isDirectory()) {
        if (isVendor(childRel)) { skipped.push({ path: childRel, reason: 'vendor directory' }); continue; }
        walk(childAbs, childRel);
        continue;
      }
      if (!ent.isFile()) { skipped.push({ path: childRel, reason: 'non-regular file' }); continue; }
      if (isVendor(childRel)) { skipped.push({ path: childRel, reason: 'vendor file' }); continue; }
      const size = sizeOf(childAbs);
      if (size > caps.maxFileBytes) { skipped.push({ path: childRel, reason: `over per-file size cap (${size} bytes)` }); continue; }
      if (files.length >= caps.maxFiles) { skipped.push({ path: childRel, reason: 'over file cap' }); continue; }
      files.push(childRel);
    }
  };
  walk(dir, '');
  return { files, skipped };
}

const readdirSafe = (abs: string) => {
  try { return readdirSync(abs, { withFileTypes: true }); } catch { return []; }
};
const sizeOf = (abs: string): number => { try { return lstatSync(abs).size; } catch { return 0; } };

export async function ingestLocal(
  dir: string,
  deps: LocalIngestDeps,
  opts: { subdir?: string; caps?: UnpackCaps; onStage?: (stage: 'fetching' | 'extracting') => void } = {},
): Promise<IngestResult> {
  const caps = opts.caps ?? DEFAULT_CAPS;
  const abs = resolve(dir);

  let isDir = false;
  try { isDir = statSync(abs).isDirectory(); } catch { isDir = false; }
  if (!isDir) return { ok: false, reason: 'not-a-directory', message: 'The local path does not exist or is not a directory.' };

  let sha: string;
  try {
    sha = await deps.revParse(abs);
  } catch (e) {
    return { ok: false, reason: 'not-a-git-clone', message: `Could not read the clone's HEAD: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!sha) return { ok: false, reason: 'not-a-git-clone', message: 'The directory is not a git clone (no HEAD).' };

  opts.onStage?.('fetching'); // local read stands in for the hosted fetch stage
  const { files, skipped } = await walkLocal(abs, caps);
  const gaps: string[] = skipped.map((s) => `${s.path}: ${s.reason}`);
  if (files.length === 0) return { ok: false, reason: 'empty-repository', message: 'The directory has no analyzable source files after safety filtering.' };

  const scoped = opts.subdir ? files.filter((f) => f.startsWith(opts.subdir + '/')).map((f) => f.slice(opts.subdir!.length + 1)) : files;
  if (scoped.length === 0) return { ok: false, reason: 'empty-subdir', message: `No files under ${opts.subdir} after safety filtering.` };

  const read = (rel: string): string => { try { return readFileSync(join(abs, opts.subdir ?? '', rel), 'utf8'); } catch { return ''; } };
  const framework = detectFramework(scoped, read);
  if (framework === 'mixed') return { ok: false, reason: 'mixed-frameworks', message: 'This directory contains both Spring Boot and FastAPI services — narrow to one service subdirectory.' };
  if (framework === 'unsupported') return { ok: false, reason: 'unsupported-framework', message: 'No Spring Boot or FastAPI constructs found — M3 supports those two frameworks.' };

  const extractDir = opts.subdir ? join(abs, opts.subdir) : abs;
  opts.onStage?.('extracting');
  try {
    const fragment = framework === 'spring-boot' ? await deps.extractSpringBoot(extractDir) : await deps.extractFastApi(extractDir);
    return { ok: true, sha, framework, fragment, gaps: [...gaps, ...fragment.gaps], filesScanned: scoped.length };
  } catch (e) {
    return { ok: false, reason: 'extraction-failed', message: e instanceof Error ? e.message : String(e) };
  }
}
