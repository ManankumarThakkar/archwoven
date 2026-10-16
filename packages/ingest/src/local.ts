import { execFile } from 'node:child_process';
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { extractGeneric, isAnalysisFile, isExtractionFile, type Fragment, type SourceInventory } from '@archwoven/extract';
import { detectFramework, useGenericAnalysis } from './detect';
import { isVendor, type UnpackCaps } from './unpack';
import type { IngestResult } from './ingest';

/**
 * Local-clone ingest (§8 private flow): reads the user's own directory — no
 * tarball, no network, no temp copy (nothing to retain). Same vendor/binary
 * filtering and caps as the hosted unpack, same IngestResult contract.
 */
export interface LocalIngestDeps {
  revParse: (dir: string) => Promise<string>;
  extractSpringBoot: (dir: string, sources: SourceInventory) => Promise<Fragment>;
  extractFastApi: (dir: string, sources: SourceInventory) => Promise<Fragment>;
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
  let totalBytes = 0;
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
      if (totalBytes + size > caps.maxTotalBytes) { skipped.push({ path: childRel, reason: 'over total size cap' }); continue; }
      files.push(childRel);
      totalBytes += size;
    }
  };
  walk(dir, '');
  return { files, skipped };
}

const readdirSafe = (abs: string) => {
  try { return readdirSync(abs, { withFileTypes: true }); } catch { return []; }
};
const sizeOf = (abs: string): number => { try { return lstatSync(abs).size; } catch { return 0; } };

/** Capture once before detection/extraction. Refuse changed links, non-regular
 * files and growth beyond the budget; parsers receive text, never live paths. */
function captureSource(root: string, rel: string, maxBytes: number): Buffer {
  const path = join(root, rel);
  const expected = lstatSync(path);
  if (!expected.isFile()) throw new Error('symlink or non-regular file (not followed)');
  if (realpathSync(path) !== path) throw new Error('symlink or redirected path (not followed)');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    // O_NOFOLLOW covers only the final filename. Bind the descriptor to the
    // checked identity and recheck ancestry before consuming any source bytes.
    if (before.dev !== expected.dev || before.ino !== expected.ino) throw new Error('file changed before capture');
    if (realpathSync(path) !== path) throw new Error('symlink or redirected path before capture');
    if (!before.isFile()) throw new Error('non-regular file');
    if (before.size > maxBytes) throw new Error('over capture size cap');
    // One extra byte detects growth without ever allocating/reading an
    // unbounded file, even when the working tree changes after inventorying.
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const n = readSync(fd, bytes, length, bytes.length - length, length);
      if (!n) break;
      length += n;
    }
    const after = fstatSync(fd);
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('file changed during capture');
    const text = bytes.subarray(0, length);
    if (text.includes(0)) throw new Error('binary file');
    return text;
  } finally { closeSync(fd); }
}

export async function ingestLocal(
  dir: string,
  deps: LocalIngestDeps,
  opts: { subdir?: string; caps?: UnpackCaps; onStage?: (stage: 'fetching' | 'extracting') => void } = {},
): Promise<IngestResult> {
  const caps = opts.caps ?? DEFAULT_CAPS;
  let abs = resolve(dir);

  let isDir = false;
  try { isDir = statSync(abs).isDirectory(); } catch { isDir = false; }
  if (!isDir) return { ok: false, reason: 'not-a-directory', message: 'The local path does not exist or is not a directory.' };
  abs = realpathSync(abs);

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

  const extractDir = opts.subdir ? join(abs, opts.subdir) : abs;
  const sources = new Map<string, string>();
  let capturedBytes = 0;
  for (const rel of scoped.filter(isExtractionFile)) {
    try {
      const bytes = captureSource(abs, opts.subdir ? `${opts.subdir}/${rel}` : rel, Math.min(caps.maxFileBytes, caps.maxTotalBytes - capturedBytes));
      sources.set(rel, bytes.toString('utf8'));
      capturedBytes += bytes.length;
    } catch (e) {
      gaps.push(`${opts.subdir ? opts.subdir + '/' : ''}${rel}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const read = (rel: string): string => sources.get(rel) ?? '';
  const readable = [...sources.keys()].filter(isAnalysisFile);
  const detected = detectFramework(readable, read);
  const framework = useGenericAnalysis(readable, detected) ? 'generic' : detected;

  opts.onStage?.('extracting');
  try {
    const fragment = framework === 'generic'
      ? extractGeneric(scoped, read, { pathPrefix: opts.subdir })
      : framework === 'spring-boot' ? await deps.extractSpringBoot(extractDir, sources) : await deps.extractFastApi(extractDir, sources);
    return { ok: true, sha, framework, fragment, gaps: [...gaps, ...fragment.gaps], filesScanned: scoped.length };
  } catch (e) {
    return { ok: false, reason: 'extraction-failed', message: e instanceof Error ? e.message : String(e) };
  }
}
