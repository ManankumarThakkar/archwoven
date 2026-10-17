import { lstatSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { extractGeneric, isAnalysisFile, type Fragment, type SourceInventory } from '@archwoven/extract';
import { detectFramework, useGenericAnalysis } from './detect';
import { isVendor, type UnpackCaps } from './unpack';
import type { IngestResult } from './ingest';
import { summarizeSkipped } from './disclosures';
import { isSafeSubdir, scopedEvidence } from './scope';
import { readCommit, InvalidCommitScope } from './commit';
export { gitRevParse } from './commit';

/**
 * Local-clone ingest (§8 private flow): reads the pinned commit in the user's clone — no
 * tarball, no network, no temp copy (nothing to retain). Same vendor/binary
 * filtering and caps as the hosted unpack, same IngestResult contract.
 */
export interface LocalIngestDeps {
  revParse: (dir: string, opts?: { signal?: AbortSignal }) => Promise<string>;
  extractSpringBoot: (dir: string, sources: SourceInventory) => Promise<Fragment>;
  extractFastApi: (dir: string, sources: SourceInventory) => Promise<Fragment>;
}

const DEFAULT_CAPS: UnpackCaps = { maxFiles: 3000, maxTotalBytes: 25 * 1024 * 1024, maxFileBytes: 512 * 1024 };

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

/** Standalone working-directory walker; commit ingestion never reads through it. */
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

export async function ingestLocal(
  dir: string,
  deps: LocalIngestDeps,
  opts: { subdir?: string; signal?: AbortSignal; caps?: UnpackCaps; onStage?: (stage: 'fetching' | 'extracting') => void } = {},
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
    sha = await deps.revParse(abs, { signal: opts.signal });
  } catch (e) {
    opts.signal?.throwIfAborted();
    return { ok: false, reason: 'not-a-git-clone', message: `Could not read the clone's HEAD: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!sha) return { ok: false, reason: 'not-a-git-clone', message: 'The directory is not a git clone (no HEAD).' };

  opts.onStage?.('fetching'); // local read stands in for the hosted fetch stage
  let inventory: Awaited<ReturnType<typeof readCommit>>;
  try { inventory = await readCommit(abs, sha, caps, subdir, opts.signal); }
  catch (error) {
    opts.signal?.throwIfAborted();
    return { ok: false, reason: error instanceof InvalidCommitScope ? 'invalid-subdir' : 'commit-unavailable', message: error instanceof Error ? error.message : 'Could not read the pinned commit.' };
  }
  const { files, skipped } = inventory;
  const gaps = [`Analyzed committed snapshot ${sha}. Uncommitted and untracked files were not analyzed.`, ...summarizeSkipped(skipped)];
  if (files.length === 0) return { ok: false, reason: subdir ? 'empty-subdir' : 'empty-repository', message: 'The selected commit directory has no analyzable source files after safety filtering.' };
  const scoped = subdir ? files.map(file => file.slice(subdir.length + 1)) : files;
  const sources = new Map([...inventory.sources].map(([path, text]) => [subdir ? path.slice(subdir.length + 1) : path, text]));
  const extractDir = subdir ? join(abs, subdir) : abs;
  const read = (rel: string): string => sources.get(rel) ?? '';
  const readable = [...sources.keys()].filter(isAnalysisFile);
  const detected = detectFramework(readable, read);
  const framework = useGenericAnalysis(readable, detected) ? 'generic' : detected;

  opts.onStage?.('extracting');
  try {
    const fragment = framework === 'generic'
      ? extractGeneric(scoped, read, { pathPrefix: subdir })
      : scopedEvidence(framework === 'spring-boot' ? await deps.extractSpringBoot(extractDir, sources) : await deps.extractFastApi(extractDir, sources), subdir);
    return { ok: true, sha, framework, fragment, gaps: [...gaps, ...fragment.gaps], filesScanned: scoped.length };
  } catch (e) {
    return { ok: false, reason: 'extraction-failed', message: e instanceof Error ? e.message : String(e) };
  }
}
