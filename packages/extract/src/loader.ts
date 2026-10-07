import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Parser, Language } from 'web-tree-sitter';
import type { Node as SyntaxNode } from 'web-tree-sitter';
import type { Evidence } from '@archwoven/model';

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
    if (statSync(full).isDirectory()) out.push(...walkFiles(full, ext));
    else if (entry.endsWith(ext)) out.push(full);
  }
  return out;
}

export async function parseSource(parser: Parser, filePath: string, rootDir: string) {
  const source = readFileSync(filePath, 'utf8');
  const tree = await parser.parse(source);
  if (!tree) throw new Error(`parse failed: ${filePath}`);
  return {
    source,
    relPath: relative(rootDir, filePath).split('\\').join('/'),
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
