import { describe, expect, it } from 'vitest';
import { extractGeneric } from './generic';

const analyze = (files: Record<string, string>, opts?: Parameters<typeof extractGeneric>[2]) =>
  extractGeneric(Object.keys(files), (path) => files[path] ?? '', opts);

describe('bounded generic repository analysis', () => {
  it('maps Python CLI modules and actual import lines without inventing runtime calls', () => {
    const fragment = analyze({
      'pyproject.toml': '[project]\nname = "observatory"',
      'analyzer/cli.py': '"""Command line entry."""\nfrom analyzer.scanner import scan\nfrom .report import render\n',
      'analyzer/scanner.py': 'def scan():\n    return []',
      'analyzer/report.py': 'def render():\n    return "report"',
    });
    expect(fragment.nodes.map((node) => node.label)).toEqual(expect.arrayContaining(['analyzer/cli.py', 'analyzer/scanner.py', 'analyzer/report.py']));
    const cli = fragment.nodes.find((node) => node.label === 'analyzer/cli.py')!;
    const scanner = fragment.nodes.find((node) => node.label === 'analyzer/scanner.py')!;
    expect(fragment.edges).toContainEqual(expect.objectContaining({ from: cli.id, to: scanner.id, type: 'relation', label: 'imports', evidence: [{ path: 'analyzer/cli.py', lines: [2, 2], note: 'Static import; runtime invocation is not established.' }] }));
    expect(fragment.edges).toHaveLength(2);
    expect(fragment.nodes.every((node) => node.kind === 'component')).toBe(true);
    expect(fragment.gaps.join(' ')).toMatch(/runtime.*not established/i);
    expect(fragment.endpoints).toEqual([]);
  });

  it('resolves TS/JS relative imports, index modules and package workspace imports', () => {
    const fragment = analyze({
      'packages/ui/package.json': '{"name":"@demo/ui"}',
      'packages/ui/src/index.ts': 'export const ui = true;',
      'apps/web/main.ts': 'import { ui } from "@demo/ui";\nimport { db } from "./db";\nconst config = require("./config.js");',
      'apps/web/db/index.ts': 'export const db = true;',
      'apps/web/config.ts': 'export default {};',
    });
    const main = fragment.nodes.find((node) => node.label === 'apps/web/main.ts')!;
    const targets = fragment.edges.filter((edge) => edge.from === main.id).map((edge) => fragment.nodes.find((node) => node.id === edge.to)!.label);
    expect(targets).toEqual(['packages/ui/src/index.ts', 'apps/web/db/index.ts', 'apps/web/config.ts']);
  });

  it('resolves observed multiline Python and JavaScript imports with their actual ranges', () => {
    const python = analyze({ 'main.py': 'from worker import (\n    run,\n)', 'worker.py': 'def run(): pass' });
    expect(python.edges).toHaveLength(1);
    expect(python.edges[0]!.evidence[0]).toMatchObject({ path: 'main.py', lines: [1, 1] });
    const typescript = analyze({ 'main.ts': 'import {\n run,\n} from "./worker";', 'worker.ts': 'export function run() {}' });
    expect(typescript.edges).toHaveLength(1);
    expect(typescript.edges[0]!.evidence[0]).toMatchObject({ path: 'main.ts', lines: [1, 3] });
  });

  it('maps Go module imports and Rust module declarations to sampled local source', () => {
    const go = analyze({ 'go.mod': 'module example.com/demo\n', 'main.go': 'package main\nimport (\n "example.com/demo/store"\n "fmt"\n)', 'store/store.go': 'package store\n' });
    expect(go.edges).toHaveLength(1);
    expect(go.edges[0]!.evidence[0]).toMatchObject({ path: 'main.go', lines: [3, 3] });
    const rust = analyze({ 'Cargo.toml': '[package]\nname = "demo"', 'src/main.rs': 'mod scanner;\nuse crate::scanner::scan;', 'src/scanner.rs': 'pub fn scan() {}' });
    expect(rust.edges).toHaveLength(1);
    expect(rust.edges[0]!.evidence[0]).toMatchObject({ path: 'src/main.rs', lines: [1, 1] });
  });

  it('keeps unresolved aliases, external imports, and documentation claims explicit', () => {
    const fragment = analyze({ 'src/main.ts': 'import { db } from "@/db";\nimport http from "axios";', 'src/db.ts': 'export const db = {};', 'README.md': '# Demo\nClaims to use PostgreSQL.' });
    expect(fragment.edges).toEqual([]);
    expect(fragment.nodes.some((node) => node.kind === 'datastore')).toBe(false);
    expect(fragment.gaps.join(' ')).toMatch(/unresolved.*2/i);
    expect(fragment.sourceContext!.limitations.join(' ')).toMatch(/documentation.*claims/i);
  });

  it('analyzes documentation-only repos without pretending they implement services', () => {
    const fragment = analyze({ 'README.md': '# Architecture handbook\nAn example queue is described here.' });
    expect(fragment.nodes).toHaveLength(1);
    expect(fragment.nodes[0]).toMatchObject({ kind: 'component', label: 'README.md', evidence: [{ path: 'README.md', lines: [1, 2], note: 'Documentation only; implementation is not established.' }] });
    expect(fragment.edges).toEqual([]);
    expect(fragment.gaps.join(' ')).toMatch(/no implementation source/i);
  });

  it('excludes secrets, vendor, generated, tests, fixtures, binaries and locks before reading', () => {
    const paths = ['src/main.ts', '.env', '.env.local', 'credentials.json', 'private-key.pem', 'node_modules/pkg/main.ts', 'vendor/pkg/a.go', 'dist/main.js', 'tests/main.py', 'src/foo.test.ts', '__fixtures__/sample.py', 'package-lock.json', 'image.png', '../outside.ts'];
    const reads: string[] = [];
    const fragment = extractGeneric(paths, (path) => { reads.push(path); return 'export const x = true;'; });
    expect(reads).toEqual(['src/main.ts']);
    expect(fragment.sourceContext!.inventory).toEqual(['src/main.ts']);
    expect(fragment.sourceContext!.omittedFiles).toBe(13);
    expect(JSON.stringify(fragment)).not.toContain('private-key');
  });

  it('is deterministic and fairly samples multiple modules under file and text caps', () => {
    const files = Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`packages/${index < 10 ? 'a' : 'b'}/file${index}.ts`, ('export const value = 1;\n').repeat(20)]));
    const read = (path: string) => files[path]!;
    const caps = { maxFiles: 4, maxFileChars: 100, maxTotalChars: 300, maxInventory: 5, maxEdges: 2 };
    const a = extractGeneric(Object.keys(files), read, { caps });
    const b = extractGeneric(Object.keys(files).reverse(), read, { caps });
    expect(a).toEqual(b);
    expect(a.sourceContext!.samples.length).toBeLessThanOrEqual(4);
    expect(a.sourceContext!.samples.some((sample) => sample.path.includes('/b/'))).toBe(true);
    expect(a.sourceContext!.samples.reduce((sum, sample) => sum + sample.text.length, 0)).toBeLessThanOrEqual(300);
    expect(a.sourceContext!.inventory).toHaveLength(5);
    expect(a.sourceContext!.omittedFiles).toBeGreaterThan(0);
    expect(a.gaps.join(' ')).toMatch(/omitted|truncated/i);
    for (const sample of a.sourceContext!.samples) expect(sample.truncated).toBe(true);
  });

  it('keeps implementation and entrypoint dependencies ahead of excess manifests and package marker files', () => {
    const files: Record<string, string> = { 'app/cli.py': 'from app.scanner import scan', 'app/scanner.py': 'def scan(): pass' };
    for (let index = 0; index < 35; index++) {
      files[`packages/p${index}/package.json`] = '{"name":"package"}';
      files[`packages/p${index}/__init__.py`] = '"""Package documentation."""';
    }
    const fragment = analyze(files);
    expect(fragment.nodes.map((node) => node.label)).toEqual(expect.arrayContaining(['app/cli.py', 'app/scanner.py']));
    expect(fragment.edges).toHaveLength(1);
  });

  it('prioritizes Express-shaped production core and CommonJS re-exports ahead of examples', () => {
    const files: Record<string, string> = {
      'index.js': 'module.exports = require("./lib/express");',
      'lib/express.js': 'var app = require("./application");\nexports.app = app;',
      'lib/application.js': 'exports.init = function () {};',
      'lib/request.js': 'exports.req = true;',
      'lib/response.js': 'exports.res = true;',
    };
    for (let index = 0; index < 30; index++) files[`examples/demo${index}/index.js`] = 'console.log("example");';
    const fragment = analyze(files, { caps: { maxFiles: 4 } });
    expect(fragment.nodes.map((node) => node.label)).toEqual(['index.js', 'lib/express.js', 'lib/application.js', 'lib/request.js']);
    expect(fragment.edges).toHaveLength(2);
    expect(fragment.edges[0]!.evidence[0]).toMatchObject({ path: 'index.js', lines: [1, 1] });
  });

  it('does not cite imports outside truncated snippets and applies repository-relative prefixes', () => {
    const fragment = analyze({ 'main.py': '# header\n'.repeat(50) + 'from worker import run', 'worker.py': 'def run(): pass' }, { pathPrefix: 'tools/cli', caps: { maxFileChars: 90 } });
    expect(fragment.edges).toEqual([]);
    expect(fragment.nodes.every((node) => node.evidence[0]!.path!.startsWith('tools/cli/'))).toBe(true);
    expect(fragment.sourceContext!.samples.every((sample) => sample.path.startsWith('tools/cli/'))).toBe(true);
  });

  it('does not treat comments, Python docstrings or JS multiline comments as import evidence', () => {
    const fragment = analyze({ 'main.py': '"""\nfrom worker import run\n"""\n# from worker import run', 'worker.py': 'def run(): pass', 'index.ts': '/*\nimport x from "./worker";\n*/', 'worker.ts': 'export default 1;' });
    expect(fragment.edges).toEqual([]);
  });

  it('ignores JavaScript template examples and block comments starting after code', () => {
    const fragment = analyze({
      'template.ts': 'const example = `\nimport x from "./worker";\n`;\nconst suffix = "safe";',
      'comment.ts': 'const x = 1; /*\nimport x from "./worker";\n*/\nexport {};',
      'worker.ts': 'export default 1;',
      'real.ts': 'import {\n worker,\n} from "./worker";',
    });
    expect(fragment.edges).toHaveLength(1);
    expect(fragment.edges[0]!.evidence[0]).toMatchObject({ path: 'real.ts', lines: [1, 3] });
  });

  it('caps import edges with an explicit gap instead of silently dropping them', () => {
    const fragment = analyze({ 'main.ts': 'import "./a";\nimport "./b";', 'a.ts': 'export {};', 'b.ts': 'export {};' }, { caps: { maxEdges: 1 } });
    expect(fragment.edges).toHaveLength(1);
    expect(fragment.gaps.join(' ')).toMatch(/edge.*cap/i);
  });

  it('skips binary and unreadable selected files without inventing evidence', () => {
    const fragment = extractGeneric(['binary.py', 'bad.ts', 'ok.go'], (path) => { if (path === 'bad.ts') throw new Error('denied'); return path === 'binary.py' ? 'x\u0000y' : 'package main'; });
    expect(fragment.nodes.map((node) => node.label)).toEqual(['ok.go']);
    expect(fragment.gaps.join(' ')).toMatch(/unreadable|binary/i);
  });
});
