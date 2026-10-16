import { posix } from 'node:path';
import { createHash } from 'node:crypto';
import type { Evidence } from '@archwoven/model';
import type { Fragment, SourceContext } from './fragment';

export interface SourceAnalysisCaps {
  maxFiles: number;
  maxFileChars: number;
  maxTotalChars: number;
  maxInventory: number;
  maxEdges: number;
}

const DEFAULT_CAPS: SourceAnalysisCaps = { maxFiles: 20, maxFileChars: 2400, maxTotalChars: 24000, maxInventory: 160, maxEdges: 30 };
const SOURCE = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|kts|cs|c|h|cc|cpp|hpp|rb|php|swift|scala|sh|ex|exs|erl|fs|fsx|clj|cljs|vue|svelte)$/i;
const MANIFEST = /^(?:package\.json|pyproject\.toml|requirements\.txt|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(?:\.kts)?|Gemfile|composer\.json|mix\.exs|.*\.csproj)$/i;
const DOC = /^(?:readme|architecture)(?:\.[^/]*)?$/i;
const NOISE = new Set(['node_modules', 'vendor', 'vendors', 'third_party', 'third-party', 'target', 'build', 'dist', 'coverage', '.git', '.next', '.nuxt', '.gradle', '__pycache__', 'venv', '.venv', 'test', 'tests', '__tests__', 'fixtures', '__fixtures__', 'testdata', 'generated', '.cache', '.idea', '.vscode']);
const SENSITIVE = /(?:^|[._-])(?:credentials?|secrets?|private[-_]?key|id_rsa|id_ed25519)(?:[._-]|$)/i;
const base = (path: string) => posix.basename(path);
const manifest = (path: string) => MANIFEST.test(base(path));
const source = (path: string) => SOURCE.test(path);

/** Shared before-read allowlist. Unknown binary/config files and sensitive names
 * never enter the source inventory or snippets. The input paths are untrusted. */
export function isAnalysisFile(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path)) return false;
  const parts = path.split('/');
  if (parts.some((part) => part === '..' || part === '.' || NOISE.has(part.toLowerCase()) || part.startsWith('.'))) return false;
  const name = base(path);
  if (SENSITIVE.test(name) || /\.(?:test|spec|generated|min)\.[^.]+$/i.test(name) || /^(?:test_.+|.+_test)\.(?:py|go)$/i.test(name)) return false;
  return source(path) || manifest(path) || DOC.test(name);
}

const idFor = (path: string): string => `module.${path.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '').slice(0, 65)}.${createHash('sha256').update(path).digest('hex').slice(0, 8)}`;
const labelFor = (path: string): string => path.length <= 40 ? path : `…${path.slice(-39)}`;
const priority = (path: string): number => manifest(path) ? 0 : DOC.test(base(path)) ? 1 : /^(?:main|index|app|cli|__main__|lib)\./i.test(base(path)) ? 2 : base(path) === '__init__.py' ? 4 : 3;
const examplePath = (path: string): boolean => /(?:^|\/)(?:examples?|demos?|samples?|docs?|documentation|benchmarks?)(?:\/|$)/i.test(path);
// Round-robin by source directory, so a lexically early package cannot consume
// the whole budget of a mixed-language monorepo.
function sampleOrder(paths: string[], maxFiles: number): string[] {
  const headers = paths.filter((path) => priority(path) < 2).sort((a, b) => priority(a) - priority(b) || a.localeCompare(b, 'en'));
  const headerCount = Math.floor(maxFiles / 3);
  const head = headers.slice(0, headerCount);
  const groups = new Map<string, string[]>();
  for (const path of paths.filter((path) => priority(path) >= 2 && priority(path) < 4)) {
    const group = posix.dirname(path);
    const entries = groups.get(group) ?? [];
    entries.push(path);
    groups.set(group, entries);
  }
  for (const entries of groups.values()) entries.sort((a, b) => priority(a) - priority(b) || a.localeCompare(b, 'en'));
  for (const examples of [false, true]) {
    const keys = [...groups.keys()].filter((key) => examplePath(key) === examples).sort();
    for (let round = 0; keys.some((key) => groups.get(key)![round]); round++) {
      for (const key of keys) { const path = groups.get(key)![round]; if (path) head.push(path); }
    }
  }
  head.push(...paths.filter((path) => priority(path) === 4), ...headers.slice(headerCount));
  return head;
}

function resolvePath(stem: string, paths: Map<string, string>): string | undefined {
  const candidates = [stem, ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '/index.ts', '/index.tsx', '/index.js', '/__init__.py', '/mod.rs', '/src/index.ts', '/src/index.js'].map((suffix) => stem + suffix)];
  const exact = candidates.find((candidate) => paths.has(candidate));
  if (exact) return exact;
  if (/\.[cm]?js$/.test(stem)) return candidates.map((candidate) => candidate.replace(/\.[cm]?js$/, '.ts')).find((candidate) => paths.has(candidate));
  return undefined;
}

const LIMITATIONS = [
  'Bounded static source sample only; omitted files and truncated tails were not analyzed. Repository code was never executed.',
  'Imports establish source dependencies only; runtime calls, deployment topology, persistence, and dynamically loaded modules are not established.',
  'Documentation contains claims, not proof of implemented services or runtime relationships. Unknown aliases and external imports remain unresolved.',
];

/** Generic fallback for arbitrary text-based repositories. No parser or build
 * execution is required. It deliberately extracts components and static imports,
 * leaving higher-level interpretation to the bounded, untrusted assembly input. */
export function extractGeneric(
  files: string[],
  read: (rel: string) => string,
  opts: { pathPrefix?: string; caps?: Partial<SourceAnalysisCaps> } = {},
): Fragment {
  const caps = { ...DEFAULT_CAPS };
  for (const key of Object.keys(caps) as (keyof SourceAnalysisCaps)[]) {
    const value = opts.caps?.[key];
    if (value !== undefined && Number.isFinite(value)) caps[key] = Math.max(0, Math.min(DEFAULT_CAPS[key], Math.floor(value)));
  }
  const eligible = [...new Set(files.filter(isAnalysisFile))].sort();
  const prefix = opts.pathPrefix ? `${opts.pathPrefix.replace(/\/+$/, '')}/` : '';
  const context: SourceContext = { kind: 'bounded-source-analysis', inventory: eligible.slice(0, caps.maxInventory).map((path) => prefix + path), eligibleFiles: eligible.length, sampledFiles: 0, omittedFiles: 0, truncatedFiles: 0, samples: [], limits: caps, limitations: [...LIMITATIONS] };
  const fragment: Fragment = { nodes: [], edges: [], endpoints: [], gaps: [], sourceContext: context };
  const selected = new Map<string, { text: string; lines: number; path: string }>();
  let remaining = caps.maxTotalChars;
  let unreadable = 0;
  const pending = sampleOrder(eligible, caps.maxFiles);
  const eligibleNodes = new Map(eligible.filter(source).map((path) => [path, path]));
  let prioritized = 0;
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const path = pending[cursor]!;
    if (selected.has(path)) continue;
    if (selected.size >= caps.maxFiles || remaining <= 0) break;
    let full: string;
    try { full = read(path); } catch { unreadable++; continue; }
    if (full.includes('\0')) { unreadable++; continue; }
    if (!full.trim()) continue;
    const limit = Math.min(caps.maxFileChars, remaining);
    if (limit === 0) break;
    let text = full.slice(0, limit);
    const truncated = text.length < full.length;
    // Drop a partial last line when possible; no import may be inferred from
    // a partially observed statement. Single long lines remain visibly truncated.
    if (truncated && text.includes('\n')) text = text.slice(0, text.lastIndexOf('\n') + 1);
    const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    const repoPath = prefix + path;
    selected.set(path, { text, lines, path: repoPath });
    context.samples.push({ path: repoPath, lines: [1, Math.max(1, lines)], text, truncated });
    if (truncated) context.truncatedFiles++;
    remaining -= text.length;
    // Reserve only a third of slots for dependencies of entrypoints. Following
    // arbitrary import chains would otherwise erase monorepo coverage.
    if (priority(path) === 2) {
      const dependencies = [...new Set(imports(path, text).map((dependency) => resolveImport(path, dependency.specifier, dependency.kind, (stem) => resolvePath(stem, eligibleNodes), eligibleNodes, new Map(), [])).filter((target): target is string => !!target && !selected.has(target)))];
      dependencies.sort((a, b) => Number(base(a) === '__init__.py') - Number(base(b) === '__init__.py') || a.split('/').length - b.split('/').length || a.localeCompare(b, 'en'));
      const count = Math.max(0, Math.floor(caps.maxFiles / 3) - prioritized);
      const next = dependencies.slice(0, count);
      pending.splice(cursor + 1, 0, ...next);
      prioritized += next.length;
    }
  }
  context.sampledFiles = selected.size;
  context.omittedFiles = files.length - selected.size;
  const code = [...selected.keys()].filter(source);
  const nodePaths = code.length ? code : [...selected.keys()].filter((path) => DOC.test(base(path)) || manifest(path));
  for (const path of nodePaths) {
    const sample = selected.get(path)!;
    const evidence: Evidence = { path: sample.path, lines: [1, Math.max(1, sample.lines)], note: source(path) ? 'Sampled source module; deployed service boundaries are not established.' : 'Documentation only; implementation is not established.' };
    fragment.nodes.push({ id: idFor(sample.path), kind: 'component', label: labelFor(path), provenance: 'source-supported', evidence: [evidence] });
  }
  const nodes = new Map(nodePaths.map((path) => [path, idFor(selected.get(path)!.path)]));
  const workspaces = new Map<string, string>();
  const goModules: { path: string; dir: string }[] = [];
  for (const [path, sample] of selected) {
    if (base(path) === 'package.json') {
      try { const pkg = JSON.parse(sample.text) as { name?: unknown }; if (typeof pkg.name === 'string') workspaces.set(pkg.name, posix.dirname(path)); } catch { /* incomplete manifests remain untrusted snippets */ }
    }
    if (base(path) === 'go.mod') { const match = /^module\s+(\S+)/m.exec(sample.text); if (match) goModules.push({ path: match[1]!, dir: posix.dirname(path) }); }
  }
  const resolve = (stem: string): string | undefined => resolvePath(stem, nodes);
  let unresolved = 0;
  let capped = 0;
  const seenEdges = new Set<string>();
  for (const path of code) {
    const sample = selected.get(path)!;
    for (const dependency of imports(path, sample.text)) {
      const target = resolveImport(path, dependency.specifier, dependency.kind, resolve, nodes, workspaces, goModules);
      if (!target || target === path) { unresolved++; continue; }
      const key = `${path}\0${target}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      if (fragment.edges.length >= caps.maxEdges) { capped++; continue; }
      fragment.edges.push({ id: `import.${fragment.edges.length + 1}`, from: nodes.get(path)!, to: nodes.get(target)!, type: 'relation', label: 'imports', provenance: 'source-supported', evidence: [{ path: sample.path, lines: [dependency.line, dependency.endLine ?? dependency.line], note: 'Static import; runtime invocation is not established.' }] });
    }
  }
  fragment.gaps.push(...LIMITATIONS);
  if (!code.length) fragment.gaps.push('No implementation source in the selected sample; only repository documentation or manifests are available.');
  if (context.omittedFiles || context.truncatedFiles) fragment.gaps.push(`Source coverage: ${selected.size} sampled files; ${context.omittedFiles} files omitted by exclusions or sampling caps; ${context.truncatedFiles} sampled files truncated; ${Math.max(0, eligible.length - context.inventory.length)} eligible paths omitted from inventory.`);
  if (unreadable) fragment.gaps.push(`${unreadable} selected files were unreadable or binary and were not analyzed.`);
  if (unresolved) fragment.gaps.push(`Unresolved imports: ${unresolved} import declarations target external, unsampled, ambiguous, or unsupported modules; no runtime edges were inferred.`);
  if (capped) fragment.gaps.push(`Import edge cap: ${capped} additional source dependencies omitted.`);
  return fragment;
}

type Import = { specifier: string; line: number; endLine?: number; kind: 'python' | 'js' | 'go' | 'rust' };

/** Hide comment/template bodies while preserving line positions and quoted
 * specifiers. This is intentionally conservative: template interpolation and
 * strings spanning lines are never treated as static import declarations. */
function maskNonCode(text: string): string {
  let out = '';
  let blockDepth = 0;
  let lineComment = false;
  let quote = '';
  let template = false;
  let visibleQuote = true;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    const next = text[index + 1];
    if (char === '\n') { out += '\n'; lineComment = false; if (quote) visibleQuote = false; continue; }
    if (lineComment) { out += ' '; continue; }
    if (blockDepth) {
      if (char === '/' && next === '*') { blockDepth++; out += '  '; index++; }
      else if (char === '*' && next === '/') { blockDepth--; out += '  '; index++; }
      else out += ' ';
      continue;
    }
    if (template) {
      out += ' ';
      if (char === '\\' && next !== undefined && next !== '\n') { out += ' '; index++; }
      else if (char === '`') template = false;
      continue;
    }
    if (quote) {
      out += visibleQuote ? char : ' ';
      if (char === '\\' && next !== undefined && next !== '\n') { out += visibleQuote ? next : ' '; index++; }
      else if (char === quote) { quote = ''; visibleQuote = true; }
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; out += '  '; index++; }
    else if (char === '/' && next === '*') { blockDepth = 1; out += '  '; index++; }
    else if (char === '`') { template = true; out += ' '; }
    else { out += char; if (char === '"' || char === "'") { quote = char; visibleQuote = true; } }
  }
  return out;
}

function imports(path: string, text: string): Import[] {
  const result: Import[] = [];
  let triple = '';
  let goBlock = false;
  let jsPending: { text: string; line: number } | undefined;
  const observed = path.endsWith('.py') ? text : maskNonCode(text);
  for (const [index, original] of observed.split('\n').entries()) {
    let line = original.trim();
    if (path.endsWith('.py')) {
      // Conservatively omit triple-quoted regions, including example imports.
      const delimiter = /('''|""")/.exec(line)?.[0];
      if (triple) { if (line.includes(triple)) triple = ''; continue; }
      if (delimiter) { if (line.indexOf(delimiter) === line.lastIndexOf(delimiter)) triple = delimiter; continue; }
      if (line.startsWith('#')) continue;
      const from = /^from\s+([.\w]+)\s+import\s+(?:\(\s*)?([\w*]+)?/.exec(line);
      if (from) { if (!from[1]!.endsWith('.') || from[2]) result.push({ specifier: from[1]!.endsWith('.') ? from[1]! + from[2]! : from[1]!, line: index + 1, kind: 'python' }); continue; }
      const imported = /^import\s+([\w.]+)/.exec(line);
      if (imported) result.push({ specifier: imported[1]!, line: index + 1, kind: 'python' });
      continue;
    }
    if (/\.[cm]?[jt]sx?$/.test(path)) {
      if (jsPending) {
        jsPending.text += ' ' + line;
        const from = /\}\s*from\s*["']([^"']+)["']/.exec(jsPending.text);
        if (from) { result.push({ specifier: from[1]!, line: jsPending.line, endLine: index + 1, kind: 'js' }); jsPending = undefined; }
        else if (index + 1 - jsPending.line > 20 || line.includes(';')) jsPending = undefined;
        continue;
      }
      const match = /^(?:import|export)\s+(?:[^;]*?\s+from\s*)?["']([^"']+)["']/.exec(line)
        ?? /^(?:const|let|var)\s+[^;]*?=\s*require\(\s*["']([^"']+)["']\s*\)/.exec(line)
        ?? /^(?:module\.exports|exports\.[\w$]+)\s*=\s*require\(\s*["']([^"']+)["']\s*\)/.exec(line);
      if (match) result.push({ specifier: match[1]!, line: index + 1, kind: 'js' });
      else if (/^(?:import|export)\s+(?:type\s+)?\{/.test(line)) jsPending = { text: line, line: index + 1 };
    } else if (path.endsWith('.go')) {
      if (/^import\s*\(/.test(line)) { goBlock = true; continue; }
      if (goBlock && line.startsWith(')')) { goBlock = false; continue; }
      const match = (goBlock ? /^(?:[\w._]+\s+)?"([^"]+)"/ : /^import\s+(?:[\w._]+\s+)?"([^"]+)"/).exec(line);
      if (match) result.push({ specifier: match[1]!, line: index + 1, kind: 'go' });
    } else if (path.endsWith('.rs')) {
      const match = /^(?:pub\s+)?mod\s+(\w+)\s*;/.exec(line);
      if (match) result.push({ specifier: match[1]!, line: index + 1, kind: 'rust' });
    }
  }
  return result;
}

function resolveImport(path: string, specifier: string, kind: Import['kind'], resolve: (stem: string) => string | undefined, nodes: Map<string, string>, workspaces: Map<string, string>, goModules: { path: string; dir: string }[]): string | undefined {
  const dir = posix.dirname(path);
  if (kind === 'python') {
    if (specifier.startsWith('.')) {
      const dots = /^\.+/.exec(specifier)![0].length;
      return resolve(posix.normalize(posix.join(dir, ...Array<string>(dots - 1).fill('..'), specifier.slice(dots).replace(/\./g, '/'))));
    }
    const stem = specifier.replace(/\./g, '/');
    return resolve(stem) ?? resolve(`src/${stem}`) ?? resolve(posix.join(dir, stem));
  }
  if (kind === 'js') {
    if (specifier.startsWith('.')) return resolve(posix.normalize(posix.join(dir, specifier)));
    for (const [name, root] of workspaces) {
      if (specifier === name || specifier.startsWith(name + '/')) return resolve(posix.join(root, specifier.slice(name.length)));
    }
  }
  if (kind === 'go') {
    for (const module of goModules) {
      if (!specifier.startsWith(module.path + '/')) continue;
      const packageDir = posix.join(module.dir, specifier.slice(module.path.length + 1));
      return [...nodes.keys()].filter((candidate) => candidate.endsWith('.go') && posix.dirname(candidate) === packageDir).sort()[0];
    }
  }
  if (kind === 'rust') return resolve(posix.join(dir, specifier));
  return undefined;
}
