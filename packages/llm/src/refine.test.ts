import { describe, expect, it } from 'vitest';
import { applyEditOps, type EditOp, type SystemModel } from '@archwoven/model';
import { generateRefinement } from './refine';
import type { StructuredClient } from './client';

const USAGE = { input_tokens: 2000, cache_creation_input_tokens: 0, cache_read_input_tokens: 1800, output_tokens: 120 };

const mkModel = (): SystemModel => ({
  schemaVersion: '1',
  revision: 1,
  title: 'Shop',
  requirements: [],
  openQuestions: [],
  nodes: [
    { id: 'svc.api', kind: 'service', label: 'API', provenance: 'user-specified', evidence: [] },
    { id: 'svc.orders', kind: 'service', label: 'Orders', provenance: 'user-specified', evidence: [] },
  ],
  edges: [{ id: 'e.api-orders', from: 'svc.api', to: 'svc.orders', type: 'sync', provenance: 'user-specified', evidence: [] }],
  views: [{ id: 'v.arch', type: 'architecture', nodes: ['svc.api', 'svc.orders'], edges: ['e.api-orders'] }],
  privacy: { classification: 'public', boundary: 'external-allowed' },
  boundaries: [], guidedViews: [],
});

const addCacheOp: EditOp = {
  op: 'add',
  target: 'svc.cache',
  patch: { id: 'svc.cache', kind: 'service', label: 'Cache', provenance: 'proposed' },
  baseRevision: 1,
  summary: '+Cache service',
};

const danglingOp: EditOp = {
  op: 'add',
  target: 'e.ghost',
  patch: { id: 'e.ghost', from: 'svc.ghost', to: 'svc.api', type: 'sync', provenance: 'proposed' },
  baseRevision: 1,
  summary: '+ghost edge',
};

function fakeClient(canned: unknown[], opts: { countedTokens?: number; countFails?: boolean } = {}): { client: StructuredClient; calls: unknown[] } {
  const calls: unknown[] = [];
  let i = 0;
  return {
    calls,
    client: {
      messages: {
        countTokens() {
          if (opts.countFails) return Promise.reject(new Error('count unavailable'));
          return Promise.resolve({ input_tokens: opts.countedTokens ?? 500 });
        },
      },
      beta: {
        messages: {
          create(params: unknown) {
            calls.push(params);
            const c = i < canned.length ? canned[i] : canned[canned.length - 1];
            i++;
            const text = typeof c === 'string' ? c : JSON.stringify(c);
            return Promise.resolve({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: USAGE });
          },
        },
      },
    },
  };
}

describe('generateRefinement', () => {
  it('returns ops on first valid pass; applying them commits revision+1', async () => {
    const m = mkModel();
    const { client, calls } = fakeClient([[addCacheOp]]);
    const r = await generateRefinement('add a redis cache for orders', m, 'architecture', { client });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ops).toEqual([addCacheOp]);
    expect(r.usage.repairs).toBe(0);
    const applied = applyEditOps(m, r.ops);
    expect(applied.ok).toBe(true);
    if (applied.ok) expect(applied.model.revision).toBe(2);
    expect(calls).toHaveLength(1);
  });

  it('repairs ops that fail applyEditOps (dangling edge) and feeds errors back', async () => {
    const m = mkModel();
    const { client, calls } = fakeClient([[danglingOp], [addCacheOp]]);
    const r = await generateRefinement('x', m, 'architecture', { client });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.usage.repairs).toBe(1);
    expect(JSON.stringify(calls[1])).toContain('svc.ghost');
  });

  it('gives up after MAX_REPAIRS; caller keeps the prior revision untouched (scenario 7)', async () => {
    const m = mkModel();
    const { client, calls } = fakeClient([[danglingOp]]);
    const r = await generateRefinement('x', m, 'architecture', { client });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(' ')).toContain('svc.ghost');
    expect(calls).toHaveLength(3);
    expect(m.revision).toBe(1);
    expect(m.edges).toHaveLength(1);
  });

  it('rejects ops whose baseRevision disagrees with the model — repair, not silent drift', async () => {
    const m = mkModel();
    const staleOp = { ...addCacheOp, baseRevision: 7 };
    const { client } = fakeClient([[staleOp], [addCacheOp]]);
    const r = await generateRefinement('x', m, 'architecture', { client });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ops[0]!.baseRevision).toBe(1);
  });

  it('accumulates billed usage across repair attempts (§15 metering)', async () => {
    const m = mkModel();
    const { client } = fakeClient(['not json', [addCacheOp]]);
    const r = await generateRefinement('x', m, 'architecture', { client });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.usage.outputTokens).toBe(USAGE.output_tokens * 2);
      expect(r.usage.inputTokens).toBe(USAGE.input_tokens * 2);
    }
  });

  it('counts tokens before send; oversized or uncountable context never reaches the model', async () => {
    const m = mkModel();
    const big = fakeClient([[addCacheOp]], { countedTokens: 30_000 });
    const r1 = await generateRefinement('x', m, 'architecture', { client: big.client });
    expect(r1.ok).toBe(false);
    expect(big.calls).toHaveLength(0);

    const fail = fakeClient([[addCacheOp]], { countFails: true });
    const r2 = await generateRefinement('x', m, 'architecture', { client: fail.client });
    expect(r2.ok).toBe(false);
    expect(fail.calls).toHaveLength(0);
  });
});

describe('server-maintained structures', () => {
  it('tells both refinement prompts that removals update checks, chapters, boundaries and sequences automatically', async () => {
    const { REFINEMENT_SYSTEM, LOCAL_REFINEMENT_SYSTEM } = await import('./refine');
    for (const prompt of [REFINEMENT_SYSTEM, LOCAL_REFINEMENT_SYSTEM]) {
      expect(prompt).toMatch(/never target semanticChecks/);
      expect(prompt).toMatch(/source-supported/);
    }
  });
});

describe('empty edit batches', () => {
  it('repairs an empty array instead of returning a no-op refinement', async () => {
    const { client, calls } = fakeClient([[], [addCacheOp]]);
    const out = await generateRefinement('add a cache', mkModel(), 'architecture', { client });
    expect(out.ok).toBe(true);
    expect(out.usage.repairs).toBe(1);
    const repair = (calls[1] as { messages: { content: string }[] }).messages.at(-1)!.content;
    expect(repair).toMatch(/No EditOps were emitted/);
  });

  it('fails with an explanation when the provider keeps emitting nothing', async () => {
    const { client } = fakeClient([[]]);
    const out = await generateRefinement('make it nicer', mkModel(), 'architecture', { client });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors.join(' ')).toMatch(/No EditOps were emitted/);
  });

  it('asks the provider to emit refused source-backed ops so the user learns why', async () => {
    const { REFINEMENT_SYSTEM } = await import('./refine');
    expect(REFINEMENT_SYSTEM).toMatch(/still emit the op/);
    expect(REFINEMENT_SYSTEM).toMatch(/Never emit an empty array/);
  });
});

describe('net-zero refinements and source refusals', () => {
  /** api→orders is required and backed by source evidence. */
  const guarded = (): SystemModel => {
    const m = mkModel();
    m.edges[0]!.provenance = 'source-supported';
    m.semanticChecks = { allowedRoots: [], allowedTerminals: [], requiredEdges: [{ from: 'svc.api', to: 'svc.orders', type: 'sync' }], requiredPaths: [] };
    return m;
  };
  const removeLink: EditOp = { op: 'remove', target: 'e.api-orders', patch: {}, baseRevision: 1, summary: '-link' };
  const sameName: EditOp = { op: 'update', target: 'svc.api', patch: { label: 'API' }, baseRevision: 1, summary: 'no-op' };

  it('reports the source-evidence refusal when the provider can only work around it', async () => {
    const { client, calls } = fakeClient([[removeLink], [sameName]]);
    const out = await generateRefinement('remove the link from API to Orders', guarded(), 'architecture', { client });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors).toEqual(['API → Orders is backed by source evidence and can\'t be removed by refinement.']);
    expect((calls[2] as { messages: { content: string }[] }).messages.at(-1)!.content).toMatch(/change nothing/);
  });

  it('repairs a net-zero batch and accepts a real change', async () => {
    const { client } = fakeClient([[sameName], [addCacheOp]]);
    const out = await generateRefinement('add a cache', mkModel(), 'architecture', { client });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.ops).toEqual([addCacheOp]);
  });

  it('explains when the provider never changes anything', async () => {
    const { client } = fakeClient([[sameName]]);
    const out = await generateRefinement('make it nicer', mkModel(), 'architecture', { client });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors.join(' ')).toMatch(/change nothing/);
  });

  it('tells the provider that views follow automatically', async () => {
    const { REFINEMENT_SYSTEM, LOCAL_REFINEMENT_SYSTEM } = await import('./refine');
    for (const p of [REFINEMENT_SYSTEM, LOCAL_REFINEMENT_SYSTEM]) expect(p).toMatch(/never target a view/);
  });
});
