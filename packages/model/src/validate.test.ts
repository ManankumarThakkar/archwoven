import { describe, expect, it } from 'vitest';
import { validateModel } from './validate';
import validFull from './fixtures/valid-full.json';
import dupNodeId from './fixtures/invalid-dup-node-id.json';
import danglingEdge from './fixtures/invalid-dangling-edge.json';
import viewForeign from './fixtures/invalid-view-foreign-node.json';
import seqGap from './fixtures/invalid-seq-gap.json';

describe('validateModel', () => {
  it('accepts the full valid fixture with no errors', () => {
    const r = validateModel(validFull);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.model.title).toBe('E-commerce Platform');
  });

  it('rejects duplicate node ids and names the id', () => {
    const r = validateModel(dupNodeId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toContain('svc.dup');
  });

  it('rejects dangling edges and names edge + node ids', () => {
    const r = validateModel(danglingEdge);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join('\n')).toContain('e.bad');
      expect(r.errors.join('\n')).toContain('svc.nonexistent');
    }
  });

  it('rejects a view referencing a node absent from the model', () => {
    const r = validateModel(viewForeign);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toContain('svc.only-in-other-view');
  });

  it('rejects non-consecutive sequence numbering and names the seq', () => {
    const r = validateModel(seqGap);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toContain('seq');
  });

  it('rejects duplicate seq numbers', () => {
    const bad = structuredClone(validFull);
    const msgs = (bad.views[1] as { sequence: { messages: { seq: number }[] } }).sequence.messages;
    msgs[2]!.seq = 2; // duplicate of previous
    const r = validateModel(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toContain('seq');
  });

  it('rejects parentId that is not revision - 1', () => {
    const bad = structuredClone(validFull);
    (bad as { parentId?: number }).parentId = 7;
    const r = validateModel(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toContain('parentId');
  });
});

describe('validateModel — semanticChecks', () => {
  const base = () => structuredClone(validFull);

  it('accepts reachable requiredPaths and satisfied roots/terminals', () => {
    const m = base();
    (m as Record<string, unknown>).semanticChecks = {
      allowedRoots: ['actor.user', 'entity.user'],
      allowedTerminals: ['external.stripe', 'datastore.postgres', 'datastore.redis', 'entity.product'],
      requiredEdges: [{ from: 'actor.user', to: 'gateway.api', type: 'sync' }],
      requiredPaths: [{ from: 'actor.user', to: 'external.stripe' }],
    };
    expect(validateModel(m).ok).toBe(true);
  });

  it('rejects unreachable requiredPaths, naming the pair', () => {
    const m = base();
    (m as Record<string, unknown>).semanticChecks = { requiredPaths: [{ from: 'actor.user', to: 'entity.user' }] };
    const r = validateModel(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toContain('actor.user');
  });

  it('unknown id in allowedRoots names the id', () => {
    const m = base();
    (m as Record<string, unknown>).semanticChecks = { allowedRoots: ['svc.ghost'] };
    const r = validateModel(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toContain('svc.ghost');
  });

  it('self-referencing requiredPath terminates (reachable at depth 0)', () => {
    const m = base();
    (m as Record<string, unknown>).semanticChecks = { requiredPaths: [{ from: 'svc.orders', to: 'svc.orders' }] };
    expect(validateModel(m).ok).toBe(true);
  });

  it('roots discipline: unrooted node missing from allowedRoots is rejected', () => {
    const m = base();
    (m as Record<string, unknown>).semanticChecks = { allowedRoots: ['actor.user'] };
    const r = validateModel(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toContain('entity.user');
  });

  it('requiredEdges type honored: wrong type rejected, right type accepted', () => {
    const m = base();
    (m as Record<string, unknown>).semanticChecks = { allowedRoots: ['actor.user', 'entity.user'], allowedTerminals: ['external.stripe', 'datastore.postgres', 'datastore.redis', 'entity.product'], requiredEdges: [{ from: 'actor.user', to: 'gateway.api', type: 'async' }] };
    expect(validateModel(m).ok).toBe(false);
    (m as Record<string, unknown>).semanticChecks = { allowedRoots: ['actor.user', 'entity.user'], allowedTerminals: ['external.stripe', 'datastore.postgres', 'datastore.redis', 'entity.product'], requiredEdges: [{ from: 'actor.user', to: 'gateway.api', type: 'sync' }] };
    expect(validateModel(m).ok).toBe(true);
  });

  it('absent semanticChecks skips root discipline (backward compat)', () => {
    expect(validateModel(base()).ok).toBe(true);
  });

  it('mainPath consecutive pair without a forward edge is rejected', () => {
    const m = base();
    (m.views[0] as { mainPath?: string[] }).mainPath = ['actor.user', 'gateway.api', 'svc.orders'];
    expect(validateModel(m).ok).toBe(true);
    (m.views[0] as { mainPath?: string[] }).mainPath = ['svc.orders', 'actor.user'];
    const r = validateModel(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toContain('svc.orders');
  });

  it('mainPath id outside the view is rejected', () => {
    const m = base();
    (m.views[0] as { mainPath?: string[] }).mainPath = ['actor.user', 'entity.user'];
    expect(validateModel(m).ok).toBe(false);
  });

  it('node in two boundaries rejected; unknown wraps id rejected', () => {
    const m = base();
    (m as Record<string, unknown>).boundaries = [{ id: 'b1', label: 'A', wraps: ['svc.orders'] }, { id: 'b2', label: 'B', wraps: ['svc.orders'] }];
    const r = validateModel(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toContain('svc.orders');
    (m as Record<string, unknown>).boundaries = [{ id: 'b1', label: 'A', wraps: ['svc.ghost'] }];
    expect(validateModel(m).ok).toBe(false);
  });

  it('guidedViews focus with unknown id rejected', () => {
    const m = base();
    (m as Record<string, unknown>).guidedViews = [{ id: 'g', label: 'G', focus: ['svc.ghost'] }];
    expect(validateModel(m).ok).toBe(false);
  });

  it('fastapi-scale synthetic graph (700 nodes, 1300 edges) validates < 1000ms', () => {
    const m = base();
    const nodes = Array.from({ length: 700 }, (_, i) => ({ id: `n${i}`, kind: 'service', label: `N${i}`, provenance: 'source-supported', evidence: [] }));
    // ring (every node rooted+terminal) + chords — fastapi-scale density without discipline noise
    const edges = Array.from({ length: 1300 }, (_, i) => ({ id: `e${i}`, from: `n${i % 700}`, to: `n${i < 700 ? (i + 1) % 700 : (i * 7 + 3) % 700}`, type: 'sync', provenance: 'source-supported', evidence: [] }));
    (m as Record<string, unknown>).nodes = nodes;
    (m as Record<string, unknown>).edges = edges;
    (m as Record<string, unknown>).views = [{ id: 'v', type: 'architecture', nodes: nodes.map((n) => n.id), edges: edges.map((e) => e.id) }];
    (m as Record<string, unknown>).semanticChecks = { requiredPaths: [{ from: 'n0', to: 'n699' }] };
    const t0 = Date.now();
    const r = validateModel(m);
    expect(r.ok, JSON.stringify(r.ok ? '' : r.errors)).toBe(true);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
