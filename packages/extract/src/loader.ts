import { createRequire } from 'node:module';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Parser, Language } from 'web-tree-sitter';
import type { Node as SyntaxNode } from 'web-tree-sitter';
import type { Evidence } from '@archwoven/model';
import { isExtractionFile } from './generic';

/** Accepted, captured text keyed by analysis-root-relative path. Supplying even
 * an empty inventory disables filesystem discovery in framework parsers. */
export type SourceInventory = ReadonlyMap<string, string>;

const require = createRequire(import.meta.url);

let initialized = false;
const parsers = new Map<string, Parser>();

export async function getParser(lang: 'java' | 'python'): Promise<Parser> {
  if (!initialized) {
    await Parser.init();
    initialized = true;
  }
  let parser = parsers.get(lang);
  if (!parser) {
    const wasm = require.resolve(`tree-sitter-${lang}/tree-sitter-${lang}.wasm`);
    const language = await Language.load(wasm);
    parser = new Parser();
    parser.setLanguage(language);
    parsers.set(lang, parser);
  }
  return parser;
}

export function walkFiles(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) out.push(...walkFiles(full, ext));
    else if (stat.isFile() && entry.endsWith(ext)) out.push(full);
  }
  return out;
}

export function loadSources(dir: string, extensions: string[], inventory?: SourceInventory): SourceInventory {
  if (inventory !== undefined) return new Map([...inventory].filter(([path]) => extensions.some((ext) => path.endsWith(ext))));
  // Standalone fixture/probe callers retain directory-based extraction. Ingest
  // always supplies captured text and never takes this discovery path.
  const files = extensions.flatMap((ext) => walkFiles(dir, ext));
  return new Map(files.flatMap((file) => {
    const rel = relative(dir, file).split('\\').join('/');
    return isExtractionFile(rel) ? [[rel, readFileSync(file, 'utf8')] as const] : [];
  }));
}

export async function parseSource(parser: Parser, source: string, relPath: string) {
  const tree = await parser.parse(source);
  if (!tree) throw new Error(`parse failed: ${relPath}`);
  return {
    source,
    relPath,
    tree,
  };
}

/** Find a child by type (some grammars attach `modifiers` without a field name). */
export function childOfType(node: SyntaxNode, type: string): SyntaxNode | undefined {
  return node.children.find((c) => c.type === type);
}

export function evidence(relPath: string, node: SyntaxNode): Evidence {
  return { path: relPath, lines: [node.startPosition.row + 1, node.endPosition.row + 1] };
}

/** Depth-first visit of all nodes of a given grammar type. */
export function visit(node: SyntaxNode, type: string, fn: (n: SyntaxNode) => void): void {
  if (node.type === type) fn(node);
  for (const child of node.children) visit(child, type, fn);
}

/** Text of a named child field, or null. */
export function childText(node: SyntaxNode, field: string): string | null {
  const c = node.childForFieldName(field);
  return c ? c.text : null;
}
