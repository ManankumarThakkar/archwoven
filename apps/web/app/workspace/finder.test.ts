import { describe, expect, it } from 'vitest';
import type { SystemModel } from '@archwoven/model';
import { findNodes } from './finder';

const model: SystemModel = {
  schemaVersion: '1',
  revision: 1,
  title: 'Shop',
  requirements: [],
  openQuestions: [],
  nodes: [
    { id: 'svc.orders', kind: 'service', label: 'Orders Service', provenance: 'user-specified', evidence: [] },
    { id: 'db.inventory', kind: 'datastore', label: 'Inventory DB', provenance: 'source-supported', evidence: [] },
    { id: 'q.notifications', kind: 'queue', label: 'Notify Queue', provenance: 'inferred', evidence: [] },
  ],
  edges: [],
  views: [{ id: 'v.arch', type: 'architecture', nodes: ['svc.orders', 'db.inventory', 'q.notifications'], edges: [] }],
  privacy: { classification: 'public', boundary: 'external-allowed' },
  boundaries: [], guidedViews: [],
};

describe('findNodes', () => {
  it('empty view → no hits', () => {
    expect(findNodes(model, [], 'orders')).toEqual([]);
  });

  it('matches label case-insensitively', () => {
    expect(findNodes(model, ['svc.orders', 'db.inventory'], 'ORDERS')).toEqual([{ id: 'svc.orders', label: 'Orders Service' }]);
  });

  it('matches id case-insensitively', () => {
    expect(findNodes(model, ['svc.orders', 'db.inventory', 'q.notifications'], 'DB.')).toEqual([{ id: 'db.inventory', label: 'Inventory DB' }]);
  });

  it('empty query lists the whole view in schema order', () => {
    expect(findNodes(model, ['q.notifications', 'svc.orders', 'db.inventory'], '').map((h) => h.id))
      .toEqual(['q.notifications', 'svc.orders', 'db.inventory']);
  });

  it('no match → empty', () => {
    expect(findNodes(model, ['svc.orders', 'db.inventory'], 'gateway')).toEqual([]);
  });

  it('view ids that resolve to no node are skipped', () => {
    expect(findNodes(model, ['ghost', 'svc.orders'], 'orders')).toEqual([{ id: 'svc.orders', label: 'Orders Service' }]);
  });
});
