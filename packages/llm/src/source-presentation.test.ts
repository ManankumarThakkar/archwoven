import { describe, expect, it } from 'vitest';
import { extractGeneric } from '@archwoven/extract';
import { validateModel } from '@archwoven/model';
import { assembleRepoModel, sourceEvidenceErrors } from './repo';
import { assembleRepoModelLocal } from './local';
import type { StructuredClient } from './client';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const cases: [string, Record<string, string>][] = [
  ['Python', { 'main.py': 'from worker import run', 'worker.py': 'def run(): pass' }],
  ['JavaScript cycle', { 'main.js': "import {run} from './worker.js';", 'worker.js': "import './main.js'; export const run = () => {};" }],
  ['Go', { 'go.mod': 'module example.com/tool', 'main.go': 'package main\nimport "example.com/tool/worker"', 'worker/service.go': 'package worker\nfunc Run() {}' }],
  ['Rust', { 'src/main.rs': 'mod worker;\nfn main() {}', 'src/worker.rs': 'pub fn run() {}' }],
];

function provider(kind: 'hosted' | 'local', values: unknown[]) {
  let calls = 0;
  const next = () => values[Math.min(calls++, values.length - 1)];
  const client: StructuredClient = {
    messages: { countTokens: async () => ({ input_tokens: 50 }) },
    beta: { messages: { create: async () => ({ content: [{ type: 'text', text: JSON.stringify(next()) }], stop_reason: 'end_turn', usage: { input_tokens: 50, output_tokens: 20 } }) } },
  };
  const fetchImpl = (async () => new Response(JSON.stringify({ message: { content: JSON.stringify(next()) }, done: true, prompt_eval_count: 50, eval_count: 20 }) + '\n')) as typeof fetch;
  return {
    run: (fragment: ReturnType<typeof extractGeneric>) => kind === 'hosted'
      ? assembleRepoModel(fragment, { owner: 'example', repo: 'source', sha: SHA, framework: 'generic' }, { client })
      : assembleRepoModelLocal(fragment, { owner: 'example', repo: 'source', sha: SHA, framework: 'generic' }, { fetchImpl }),
    count: () => calls,
  };
}

for (const kind of ['hosted', 'local'] as const) describe(`${kind} generic presentation assembly`, () => {
  it.each(cases)('preserves the extracted %s graph without asking the provider to rewrite it', async (_name, files) => {
    const fragment = extractGeneric(Object.keys(files), (path) => files[path]!);
    const before = structuredClone(fragment);
    expect(fragment.nodes).toHaveLength(2);
    expect(fragment.edges.length).toBeGreaterThan(0);
    const p = provider(kind, [{ title: 'Source map', openQuestions: [], guidedViews: [{ label: 'Entry', focus: [fragment.nodes[0]!.id], note: null }] }]);
    const out = await p.run(fragment);
    expect(out.ok, JSON.stringify(out.ok ? '' : out.errors)).toBe(true);
    if (!out.ok) return;
    expect(out.model.nodes.map((node) => ({ id: node.id, kind: node.kind, label: node.label }))).toEqual(before.nodes.map((node) => ({ id: node.id, kind: node.kind, label: node.label })));
    expect(out.model.edges.map(({ evidence, ...edge }) => edge)).toEqual(before.edges.map(({ evidence, ...edge }) => edge));
    expect(out.model.views).toEqual([{ id: 'view.architecture', type: 'architecture', orientation: 'LR', nodes: fragment.nodes.map((node) => node.id), edges: fragment.edges.map((edge) => edge.id) }]);
    expect(sourceEvidenceErrors(fragment, out.model)).toEqual([]);
    expect(out.model.edges[0]!.evidence[0]).toMatchObject({ repo: 'example/source', commit: SHA });
    expect(out.model.openQuestions.map((question) => question.text)).toEqual(expect.arrayContaining(fragment.gaps));
    expect(out.model.privacy.boundary).toBe(kind === 'local' ? 'local-only' : 'external-allowed');
    expect(validateModel(out.model).ok).toBe(true);
    expect(fragment).toEqual(before);
    expect(p.count()).toBe(1);
  });

  it.each(['graph', 'unknown-focus', 'empty-title'] as const)('repairs an invalid %s presentation without accepting invented source claims', async (failure) => {
    const fragment = extractGeneric(['main.py'], () => 'print(1)');
    const good = { title: 'Source map', openQuestions: [], guidedViews: [] };
    const bad = failure === 'graph' ? { ...good, nodes: [{ id: 'invented', kind: 'service' }] }
      : failure === 'unknown-focus' ? { ...good, guidedViews: [{ label: 'Invented', focus: ['invented'], note: null }] }
        : { ...good, title: ' ' };
    const p = provider(kind, [bad, good]);
    const out = await p.run(fragment);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.usage.repairs).toBe(1);
    expect(out.model.nodes.map((node) => node.label)).toEqual(['main.py']);
    expect(out.model.guidedViews).toEqual([]);
    expect(p.count()).toBe(2);
  });

  it('keeps metadata repair bounded and fails explicitly when the provider keeps returning graph data', async () => {
    const fragment = extractGeneric(['main.py'], () => 'print(1)');
    const p = provider(kind, [{ title: 'Wrong contract', nodes: [], edges: [] }]);
    const out = await p.run(fragment);
    expect(out.ok).toBe(false);
    expect(p.count()).toBe(3);
  });

  it('supports a documentation-only repository with explicit implementation unknowns', async () => {
    const fragment = extractGeneric(['README.md'], () => '# Future service\nNot implemented yet.');
    const out = await provider(kind, [{ title: 'Documentation map', openQuestions: [], guidedViews: [] }]).run(fragment);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.model.nodes).toHaveLength(1);
    expect(out.model.nodes[0]).toMatchObject({ kind: 'component', label: 'README.md' });
    expect(out.model.edges).toEqual([]);
    expect(out.model.openQuestions.some((question) => /No implementation source/.test(question.text))).toBe(true);
  });
});
