import { execFile } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { promisify } from 'node:util';
import { isExtractionFile } from '@archwoven/extract';
import { isVendor } from './exclusions';
import type { UnpackCaps } from './unpack';

const execFileP = promisify(execFile);
const OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const METADATA_LIMIT = 8 * 1024 * 1024;

/** Do not inherit a server's repository override or run transport/filter helpers.
 * Raw object reads deliberately bypass checkout conversions and replacement refs. */
function gitEnv(): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '', GIT_TERMINAL_PROMPT: '0' };
}

function gitReader(dir: string, signal?: AbortSignal) {
  const identity = lstatSync(dir);
  const check = () => {
    signal?.throwIfAborted();
    const now = lstatSync(dir);
    if (!now.isDirectory() || now.dev !== identity.dev || now.ino !== identity.ino || realpathSync(dir) !== dir) throw new Error('The clone directory changed or was redirected; retry from its root.');
  };
  return async (args: string[], maxBuffer = METADATA_LIMIT, input?: string): Promise<Buffer> => {
    check();
    const pending = execFileP('git', ['--no-replace-objects', '--literal-pathspecs', '-c', 'protocol.allow=never', '-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: dir, env: gitEnv(), encoding: 'buffer', timeout: 10000, maxBuffer, signal,
    });
    // Only fixed-format object ids enter the batch protocol, never source paths.
    pending.child.stdin?.on('error', () => { /* process rejection reports an early exit */ });
    pending.child.stdin?.end(input);
    const result = await pending;
    check();
    return result.stdout;
  };
}

export async function gitRevParse(dir: string, opts: { signal?: AbortSignal } = {}): Promise<string> {
  const read = gitReader(realpathSync(dir), opts.signal);
  const sha = (await read(['rev-parse', '--verify', 'HEAD^{commit}'], 1024)).toString('utf8').trim();
  if (!OBJECT_ID.test(sha)) throw new Error('Could not pin the checked-out commit.');
  return sha;
}

export class InvalidCommitScope extends Error {}

interface Entry { mode: string; type: string; oid: string; path: string }
type Skipped = { path: string; reason: string };
function entries(buffer: Buffer, prefix: string, skipped: Skipped[]): Entry[] {
  const result: Entry[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const end = buffer.indexOf(0, offset);
    if (end < 0) throw new Error('Incomplete committed source inventory.');
    let record: string;
    try { record = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(offset, end)); }
    catch { skipped.push({ path: '<non-UTF-8 path>', reason: 'non-UTF-8 filename; not analyzed' }); offset = end + 1; continue; }
    offset = end + 1;
    const match = /^([0-7]{6}) (blob|tree|commit) ([a-f0-9]{40}|[a-f0-9]{64})\t([\s\S]+)$/.exec(record);
    if (!match) throw new Error('Invalid committed source inventory.');
    const path = prefix + match[4]!;
    if (path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe path in committed source inventory.');
    result.push({ mode: match[1]!, type: match[2]!, oid: match[3]!, path });
  }
  return result;
}

/** Enumerate only the pinned subtree, then capture bounded raw blobs. No working
 * files, index entries, checkout filters, export substitutions or temp copies. */
export async function readCommit(dir: string, sha: string, caps: UnpackCaps, subdir?: string, signal?: AbortSignal) {
  if (!OBJECT_ID.test(sha)) throw new Error('Invalid pinned commit.');
  const read = gitReader(dir, signal);
  const top = (await read(['rev-parse', '--show-toplevel'], METADATA_LIMIT)).toString('utf8').trim();
  if (realpathSync(top) !== dir) throw new Error('Choose the git clone root and use the Subdirectory field to select a folder.');
  const tree = subdir ? `${sha}:${subdir}` : `${sha}^{tree}`;
  if (subdir) {
    let type: string;
    try { type = (await read(['cat-file', '-t', tree], 1024)).toString('utf8').trim(); }
    catch (error) { signal?.throwIfAborted(); throw new InvalidCommitScope('The subdirectory does not exist in the pinned commit.'); }
    if (type !== 'tree') throw new InvalidCommitScope('Choose a directory in the pinned commit; file and symlink scopes are not followed.');
  }
  const skipped: Skipped[] = [];
  const candidates: Entry[] = [];
  let metadataBytes = 0;
  const walk = async (object: string, prefix: string): Promise<void> => {
    const remaining = METADATA_LIMIT - metadataBytes;
    if (remaining <= 0) throw new Error('Committed source inventory exceeds its metadata limit; narrow the subdirectory.');
    const buffer = await read(['ls-tree', '-z', object], remaining);
    metadataBytes += buffer.length;
    for (const entry of entries(buffer, prefix, skipped)) {
      // Prune before descent: excluded generated/vendor metadata cannot exhaust
      // the selected source inventory, even if its objects are unavailable.
      if (isVendor(entry.path)) { skipped.push({ path: entry.path, reason: 'vendor file or folder' }); continue; }
      if (entry.type === 'tree' && entry.mode === '040000') { await walk(entry.oid, entry.path + '/'); continue; }
      if (entry.mode === '120000') { skipped.push({ path: entry.path, reason: 'symlink (not followed)' }); continue; }
      if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) { skipped.push({ path: entry.path, reason: 'non-regular file' }); continue; }
      candidates.push(entry);
    }
  };
  await walk(tree, subdir ? subdir + '/' : '');
  // A separate, bounded metadata pass avoids asking Git for sizes of excluded
  // generated files, symlink targets or submodules (including missing objects).
  const ids = [...new Set(candidates.map(entry => entry.oid))];
  const sizes = new Map<string, number>();
  if (ids.length) {
    const info = await read(['cat-file', '--batch-check'], METADATA_LIMIT, ids.join('\n') + '\n');
    const lines = info.toString('utf8').trimEnd().split('\n');
    if (lines.length !== ids.length) throw new Error('Incomplete committed source metadata.');
    lines.forEach((line, index) => {
      const match = /^([a-f0-9]{40}|[a-f0-9]{64}) blob ([0-9]+)$/.exec(line);
      const size = match ? Number(match[2]) : NaN;
      if (!match || match[1] !== ids[index] || !Number.isSafeInteger(size)) throw new Error('Committed source objects are unavailable locally; fetch the repository contents yourself, then retry.');
      sizes.set(match[1]!, size);
    });
  }
  const files: string[] = [];
  let bytes = 0;
  const accepted = candidates.filter(entry => {
    const size = sizes.get(entry.oid)!;
    let reason: string | undefined;
    if (size > caps.maxFileBytes) reason = `over per-file size cap (${size} bytes)`;
    else if (files.length >= caps.maxFiles) reason = 'over file cap';
    else if (bytes + size > caps.maxTotalBytes) reason = 'over total size cap';
    if (reason) { skipped.push({ path: entry.path, reason }); return false; }
    files.push(entry.path); bytes += size; return true;
  });
  const sourceIds = [...new Set(accepted.filter(entry => isExtractionFile(entry.path)).map(entry => entry.oid))];
  const blobs = new Map<string, Buffer>();
  if (sourceIds.length) {
    const size = sourceIds.reduce((sum, id) => sum + sizes.get(id)!, 0);
    const batch = await read(['cat-file', '--batch'], size + sourceIds.length * 256 + 1024, sourceIds.join('\n') + '\n');
    let offset = 0;
    for (const oid of sourceIds) {
      const newline = batch.indexOf(10, offset);
      const header = batch.subarray(offset, newline).toString('utf8');
      if (newline < 0 || header !== `${oid} blob ${sizes.get(oid)}`) throw new Error('Committed source capture did not match its pinned object.');
      offset = newline + 1;
      const end = offset + sizes.get(oid)!;
      if (end >= batch.length || batch[end] !== 10) throw new Error('Truncated committed source capture.');
      blobs.set(oid, batch.subarray(offset, end)); offset = end + 1;
    }
    if (offset !== batch.length) throw new Error('Unexpected bytes in committed source capture.');
  }
  const sources = new Map<string, string>();
  for (const entry of accepted) {
    const body = blobs.get(entry.oid);
    if (!body) continue;
    if (body.includes(0)) { skipped.push({ path: entry.path, reason: 'binary' }); continue; }
    const text = body.toString('utf8');
    if (text.startsWith('version https://git-lfs.github.com/spec/v1\n')) { skipped.push({ path: entry.path, reason: 'Git LFS pointer; contents not downloaded or analyzed' }); continue; }
    sources.set(entry.path, text);
  }
  return { files, skipped, sources };
}
