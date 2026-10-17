import { execFile } from 'node:child_process';
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { extractGeneric, isAnalysisFile, isExtractionFile, type Fragment, type SourceInventory } from '@archwoven/extract';
import { detectFramework, useGenericAnalysis } from './detect';
import { isVendor, type UnpackCaps } from './unpack';
import type { IngestResult } from './ingest';
import { summarizeSkipped } from './disclosures';
import { isSafeSubdir, scopedEvidence } from './scope';

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

/** Select the scope before enumeration. An explicitly selected scope cannot
 * follow a link, including links in an ancestor of the selected directory. */
function scopeDirectory(root: string, subdir?: string): string {
  if (subdir && !isSafeSubdir(subdir)) throw new Error('Invalid subdir: choose a relative source directory without traversal, hidden or excluded folders.');
  if (subdir && isVendor(subdir)) throw new Error('Invalid subdir: generated and vendor directories are excluded from analysis.');
  let selected = root;
  for (const part of subdir?.split('/') ?? []) {
    selected = join(selected, part);
    let stat;
    try { stat = lstatSync(selected); } catch { throw new Error('Invalid subdir: the selected directory does not exist.'); }
    if (stat.isSymbolicLink()) throw new Error('Invalid subdir: symlinked directories are not followed.');
    if (!stat.isDirectory()) throw new Error('Invalid subdir: select a directory, not a file.');
    if (realpathSync(selected) !== selected) throw new Error('Invalid subdir: a directory was redirected or replaced.');
  }
  return selected;
}

/** Symlinks are never followed. Counts and bytes apply only to selected files;
 * paths in the returned inventory/disclosures remain repository-relative. */
export async function walkLocal(dir: string, caps: UnpackCaps, opts: { subdir?: string } = {}): Promise<{ files: string[]; skipped: { path: string; reason: string }[] }> {
  return scanLocal(realpathSync(resolve(dir)), caps, opts.subdir || undefined);
}

/** Ingest already canonicalized its root. Do not follow it again after async
 * git/stage work: a replacement link must fail the directory identity checks. */
function scanLocal(root: string, caps: UnpackCaps, subdir?: string): { files: string[]; skipped: { path: string; reason: string }[] } {
  const selected = scopeDirectory(root, subdir);
  const files: string[] = [], skipped: { path: string; reason: string }[] = [];
  let totalBytes = 0;
  const walk = (abs: string, rel: string) => {
    let entries;
    try {
      const before = lstatSync(abs);
      if (!before.isDirectory() || realpathSync(abs) !== abs) throw new Error('redirected');
      entries = readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      const after = lstatSync(abs);
      if (before.dev !== after.dev || before.ino !== after.ino || realpathSync(abs) !== abs) throw new Error('changed');
    } catch {
      skipped.push({ path: rel || '.', reason: 'directory unreadable, changed or redirected (not followed)' });
      return;
    }
    for (const ent of entries) {
      const childRel = rel ? `${rel}/${ent.name}` : ent.name, childAbs = join(abs, ent.name);
      if (ent.isSymbolicLink()) { skipped.push({ path: childRel, reason: 'symlink (not followed)' }); continue; }
      if (isVendor(childRel)) { skipped.push({ path: childRel, reason: ent.isDirectory() ? 'vendor directory' : 'vendor file' }); continue; }
      if (ent.isDirectory()) { walk(childAbs, childRel); continue; }
      if (!ent.isFile()) { skipped.push({ path: childRel, reason: 'non-regular file' }); continue; }
      let size: number;
      try { size = lstatSync(childAbs).size; } catch { skipped.push({ path: childRel, reason: 'file changed before inventory' }); continue; }
      if (size > caps.maxFileBytes) { skipped.push({ path: childRel, reason: `over per-file size cap (${size} bytes)` }); continue; }
      if (files.length >= caps.maxFiles) { skipped.push({ path: childRel, reason: 'over file cap' }); continue; }
      if (totalBytes + size > caps.maxTotalBytes) { skipped.push({ path: childRel, reason: 'over total size cap' }); continue; }
      files.push(childRel); totalBytes += size;
    }
  };
  walk(selected, subdir || '');
  return { files, skipped };
}

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
  const subdir = opts.subdir || undefined;
  if (subdir && !isSafeSubdir(subdir)) return { ok: false, reason: 'invalid-subdir', message: 'Invalid subdir: choose a relative source directory without traversal, hidden or excluded folders.' };
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
  let inventory: Awaited<ReturnType<typeof walkLocal>>;
  try { inventory = scanLocal(abs, caps, subdir); } catch (e) { return { ok: false, reason: 'invalid-subdir', message: e instanceof Error ? e.message : 'Could not open the selected directory.' }; }
  const { files, skipped } = inventory;
  const gaps: string[] = summarizeSkipped(skipped);
  if (files.length === 0) return { ok: false, reason: subdir ? 'empty-subdir' : 'empty-repository', message: 'The selected directory has no analyzable source files after safety filtering.' };

  const scoped = subdir ? files.map(f => f.slice(subdir.length + 1)) : files;
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
      : scopedEvidence(framework === 'spring-boot' ? await deps.extractSpringBoot(extractDir, sources) : await deps.extractFastApi(extractDir, sources), subdir);
    return { ok: true, sha, framework, fragment, gaps: [...gaps, ...fragment.gaps], filesScanned: scoped.length };
  } catch (e) {
    return { ok: false, reason: 'extraction-failed', message: e instanceof Error ? e.message : String(e) };
  }
}
