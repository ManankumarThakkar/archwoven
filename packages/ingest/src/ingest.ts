import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractGeneric, isAnalysisFile, isExtractionFile, type Fragment, type SourceInventory } from '@archwoven/extract';
import { pinCommit, fetchTarball, type GithubApiFetch } from './fetch';
import { unpackTarball, cleanupDir, type UnpackCaps } from './unpack';
import { detectFramework, useGenericAnalysis } from './detect';
import { isSafeSubdir, scopedEvidence } from './scope';
import { summarizeSkipped } from './disclosures';

/**
 * Repo ingest orchestration: pin → fetch → unpack → detect → extract.
 * The SHA pinned here is the analysis's only truth; temp files are removed
 * in `finally` (temporary clones are deleted after the job).
 */
export interface IngestDeps {
  fetcher: GithubApiFetch;
  extractSpringBoot: (dir: string, sources: SourceInventory) => Promise<Fragment>;
  extractFastApi: (dir: string, sources: SourceInventory) => Promise<Fragment>;
  tmpRoot?: string;
}

export type IngestResult =
  | { ok: true; sha: string; framework: string; fragment: Fragment; gaps: string[]; filesScanned: number }
  | { ok: false; reason: string; message: string };

const DEFAULT_CAPS: UnpackCaps = {
  maxFiles: 3000,
  maxTotalBytes: 25 * 1024 * 1024,
  maxFileBytes: 512 * 1024,
};

export async function ingestRepo(
  parsed: { owner: string; repo: string; ref?: string; subdir?: string },
  deps: IngestDeps,
  opts: { signal?: AbortSignal; caps?: UnpackCaps; onStage?: (stage: 'fetching' | 'extracting') => void } = {},
): Promise<IngestResult> {
  const caps = opts.caps ?? DEFAULT_CAPS;
  if (parsed.subdir && !isSafeSubdir(parsed.subdir)) return { ok: false, reason: 'invalid-subdir', message: 'Invalid subdir: choose a relative source directory without traversal, hidden or excluded folders.' };

  opts.onStage?.('fetching');
  const pinned = await pinCommit(deps.fetcher, { owner: parsed.owner, repo: parsed.repo }, parsed.ref, opts.signal);
  if (!pinned.ok) return { ok: false, reason: pinned.reason, message: pinned.message };

  let tarball: ArrayBuffer;
  try {
    tarball = await fetchTarball(deps.fetcher, { owner: parsed.owner, repo: parsed.repo }, pinned.sha, { maxBytes: caps.maxTotalBytes, signal: opts.signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    return { ok: false, reason: 'fetch-failed', message: e instanceof Error ? e.message : String(e) };
  }

  const workDir = mkdtempSync(join(deps.tmpRoot ?? tmpdir(), 'aw-ingest-'));
  try {
    const { files, skipped, declarations } = await unpackTarball(tarball, workDir, caps, { subdir: parsed.subdir });
    const gaps: string[] = summarizeSkipped(skipped);

    if (files.length === 0) return { ok: false, reason: parsed.subdir ? 'empty-subdir' : 'empty-repository', message: 'The selected repository directory has no analyzable source files after safety filtering.' };

    // A requested subdir narrows both detection and source analysis.
    const scoped = parsed.subdir ? files.filter((f) => f.startsWith(parsed.subdir + '/')).map((f) => f.slice(parsed.subdir!.length + 1)) : files;
    if (scoped.length === 0) return { ok: false, reason: 'empty-subdir', message: `No files under ${parsed.subdir} after safety filtering.` };

    if (declarations?.submodules || files.includes('.gitmodules')) gaps.push('submodule(s) declared — codeload excludes submodule contents; they were not analyzed');
    if (declarations?.lfs || (files.includes('.gitattributes') && /filter=lfs/.test(readSafe(workDir, '.gitattributes')))) gaps.push('Git LFS pointers — large binary files were not downloaded');

    const sources = new Map(scoped.filter(isExtractionFile).map((rel) => [rel, readSafe(workDir, joinDir(parsed.subdir, rel))]));
    const read = (rel: string) => sources.get(rel) ?? '';
    const readable = [...sources.keys()].filter(isAnalysisFile);
    const detected = detectFramework(readable, read);
    const framework = useGenericAnalysis(readable, detected) ? 'generic' : detected;

    const extractDir = parsed.subdir ? join(workDir, parsed.subdir) : workDir;
    opts.onStage?.('extracting');
    try {
      const fragment = framework === 'generic'
        ? extractGeneric(scoped, read, { pathPrefix: parsed.subdir })
        : scopedEvidence(framework === 'spring-boot' ? await deps.extractSpringBoot(extractDir, sources) : await deps.extractFastApi(extractDir, sources), parsed.subdir);
      return { ok: true, sha: pinned.sha, framework, fragment, gaps: [...gaps, ...fragment.gaps], filesScanned: scoped.length };
    } catch (e) {
      return { ok: false, reason: 'extraction-failed', message: e instanceof Error ? e.message : String(e) };
    }
  } finally {
    cleanupDir(workDir);
  }
}

const readSafe = (dir: string, rel: string): string => {
  try { return readFileSync(join(dir, rel), 'utf8'); } catch { return ''; }
};
const joinDir = (subdir: string | undefined, rel: string): string => (subdir ? join(subdir, rel) : rel);
