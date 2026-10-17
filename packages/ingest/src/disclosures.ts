/** Skipped-file reasons, grouped into short disclosures a reader can act on. */
const CATEGORIES: { test: (reason: string) => boolean; describe: (count: number, list: string) => string }[] = [
  { test: r => r.startsWith('vendor'), describe: (n, l) => `Skipped ${n} vendored, generated or lock ${n === 1 ? 'file or folder' : 'files and folders'}: ${l}.` },
  { test: r => r.startsWith('over per-file size cap') || r.startsWith('size:'), describe: (n, l) => `Skipped ${n} ${n === 1 ? 'file' : 'files'} over the per-file size limit: ${l}.` },
  { test: r => r === 'binary', describe: (n, l) => `Skipped ${n} binary ${n === 1 ? 'file' : 'files'}: ${l}.` },
  { test: r => r === 'over file cap' || r === 'file-count-cap', describe: (n, l) => `Stopped at the file limit; ${n} ${n === 1 ? 'file was' : 'files were'} not analyzed: ${l}.` },
  { test: r => r === 'over total size cap' || r === 'expanded-size-cap', describe: (n, l) => `Stopped at the total size limit; ${n} ${n === 1 ? 'file was' : 'files were'} not analyzed: ${l}.` },
  { test: r => r.startsWith('symlink') || r === 'hardlink' || r === 'non-regular file' || r.startsWith('type:'), describe: (n, l) => `Skipped ${n} ${n === 1 ? 'link or special file' : 'links or special files'}, not followed for safety: ${l}.` },
  { test: r => r === 'traversal' || r === 'bad-checksum', describe: (n, l) => `Rejected ${n} unsafe archive ${n === 1 ? 'entry' : 'entries'}: ${l}.` },
];

const examples = (paths: string[]): string =>
  paths.length > 3 ? `${paths.slice(0, 3).join(', ')} and ${paths.length - 3} more` : paths.join(', ');

/** A local clone's `.git` folder is expected to be skipped and is not a gap. */
const isGitMetadata = (path: string): boolean => path === '.git' || path.startsWith('.git/');

export function summarizeSkipped(skipped: { path: string; reason: string }[]): string[] {
  const groups = new Map<string, { describe: (count: number, list: string) => string; paths: string[] }>();
  for (const { path, reason } of skipped) {
    if (isGitMetadata(path)) continue;
    const index = CATEGORIES.findIndex(c => c.test(reason));
    const key = index >= 0 ? `#${index}` : reason;
    const group = groups.get(key) ?? { describe: index >= 0 ? CATEGORIES[index]!.describe : (n, l) => `Skipped ${n} ${n === 1 ? 'file' : 'files'} (${reason}): ${l}.`, paths: [] };
    group.paths.push(path);
    groups.set(key, group);
  }
  return [...groups.values()].map(g => g.describe(g.paths.length, examples(g.paths)));
}
