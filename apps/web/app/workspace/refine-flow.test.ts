import { describe, expect, it } from 'vitest';
import { summarizeOps, pushHistory, undo, idempotencyKeyFor } from './refine-flow';
import type { EditOp, SystemModel } from '@archwoven/model';

const addCache: EditOp = { op: 'add', target: 'svc.cache', patch: { id: 'svc.cache', kind: 'service', label: 'Cache', provenance: 'proposed' }, baseRevision: 1, summary: '' };
const addEdge: EditOp = { op: 'add', target: 'e.orders-cache', patch: { id: 'e.orders-cache', from: 'svc.orders', to: 'svc.cache', type: 'sync', provenance: 'proposed' }, baseRevision: 1, summary: '' };

const rev = (revision: number): SystemModel => ({
  schemaVersion: '1', revision, parentId: revision > 1 ? revision - 1 : null, title: 'Shop',
  requirements: [], openQuestions: [], nodes: [], edges: [],
  views: [{ id: 'v', type: 'architecture', nodes: [], edges: [] }],
  privacy: { classification: 'public', boundary: 'external-allowed' },
  boundaries: [], guidedViews: [],
});

describe('refine flow', () => {
  it('ops → human summary', () => {
    expect(summarizeOps([addCache, addEdge])).toBe('+Cache service, +edge orders→cache');
  });

  it('update/remove/move render distinct summary verbs', () => {
    expect(summarizeOps([{ op: 'update', target: 'svc.orders', patch: { label: 'Orders' }, baseRevision: 1, summary: '' }])).toBe('~Orders');
    expect(summarizeOps([{ op: 'remove', target: 'svc.cache', patch: {}, baseRevision: 1, summary: '' }])).toBe('-cache');
    expect(summarizeOps([{ op: 'move', target: 'svc.orders', patch: { x: 1, y: 2 }, baseRevision: 1, summary: '' }])).toBe('· move orders');
  });

  it('undo restores the previous revision state', () => {
    let stack = pushHistory([], rev(1));
    stack = pushHistory(stack, rev(2));
    const { model, stack: after } = undo(stack);
    expect(model?.revision).toBe(1);
    expect(after).toHaveLength(1);
  });

  it('undo of a single-entry stack is a no-op', () => {
    const stack = pushHistory([], rev(1));
    expect(undo(stack).model?.revision).toBe(1);
  });

  it('idempotencyKeyFor is stable per (prompt, view) so a retry dedupes instead of double-charging', () => {
    const k1 = idempotencyKeyFor('an e-commerce shop', 'architecture');
    const k2 = idempotencyKeyFor('an e-commerce shop', 'architecture');
    expect(k2).toBe(k1);
    expect(idempotencyKeyFor('an e-commerce shop', 'sequence')).not.toBe(k1);
    expect(idempotencyKeyFor('an e-commerce shop with caching', 'architecture')).not.toBe(k1);
    expect(k1).toMatch(/^[0-9a-f]{8,}$/);
  });
});
