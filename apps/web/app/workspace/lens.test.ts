import { describe, expect, it } from 'vitest';
import type { SystemModel } from '@archwoven/model';
import { LENS_MAX, lensKindsInView, lensPasses, parseLens, serializeLens, toggleLens } from './lens';

const model: SystemModel = {
  schemaVersion: '1',
  revision: 1,
  title: 'Shop',
  requirements: [],
  openQuestions: [],
  nodes: [
    { id: 'svc.orders', kind: 'service', label: 'Orders', provenance: 'user-specified', evidence: [] },
    { id: 'svc.pay', kind: 'service', label: 'Payments', provenance: 'user-specified', evidence: [] },
    { id: 'q.notify', kind: 'queue', label: 'Notify', provenance: 'inferred', evidence: [] },
    { id: 'db.main', kind: 'datastore', label: 'Main DB', provenance: 'source-supported', evidence: [] },
  ],
  edges: [],
  views: [{ id: 'v.arch', type: 'architecture', nodes: ['svc.orders', 'svc.pay', 'q.notify', 'db.main'], edges: [] }],
  privacy: { classification: 'public', boundary: 'external-allowed' },
  boundaries: [], guidedViews: [],
};

describe('parseLens', () => {
  it('parses the #lens= permalink', () => {
    expect(parseLens('service,queue')).toEqual(['service', 'queue']);
  });

  it('>2 kinds clamped to the first two', () => {
    expect(parseLens('service,queue,datastore')).toEqual(['service', 'queue']);
  });

  it('unknown kinds dropped, duplicates collapsed', () => {
    expect(parseLens('bogus,service,service')).toEqual(['service']);
    expect(parseLens('bogus,thing')).toEqual([]);
  });

  it('empty/null/undefined → no lens', () => {
    expect(parseLens('')).toEqual([]);
    expect(parseLens(null)).toEqual([]);
    expect(parseLens(undefined)).toEqual([]);
  });
});

describe('serializeLens', () => {
  it('round-trips through parse', () => {
    expect(parseLens(serializeLens(['queue', 'service']))).toEqual(['queue', 'service']);
  });

  it('empty lens serializes to null (hash key removed)', () => {
    expect(serializeLens([])).toBeNull();
  });

  it('never serializes more than LENS_MAX kinds', () => {
    expect(serializeLens(['service', 'queue', 'datastore'])!.split(',')).toHaveLength(LENS_MAX);
  });
});

describe('toggleLens', () => {
  it('adds and removes a kind', () => {
    expect(toggleLens([], 'service')).toEqual(['service']);
    expect(toggleLens(['service', 'queue'], 'service')).toEqual(['queue']);
  });

  it('a third kind replaces the oldest — never more than 2 active', () => {
    const next = toggleLens(['service', 'queue'], 'datastore');
    expect(next).toEqual(['queue', 'datastore']);
    expect(next).toHaveLength(LENS_MAX);
  });
});

describe('lensKindsInView / lensPasses', () => {
  it('distinct kinds in schema order', () => {
    expect(lensKindsInView(model, ['svc.orders', 'svc.pay', 'q.notify', 'db.main'])).toEqual(['service', 'queue', 'datastore']);
  });

  it('empty view → no kinds', () => {
    expect(lensKindsInView(model, [])).toEqual([]);
  });

  it('empty lens passes everything; active lens filters', () => {
    expect(lensPasses('queue', [])).toBe(true);
    expect(lensPasses('queue', ['service'])).toBe(false);
    expect(lensPasses('service', ['service', 'queue'])).toBe(true);
  });
});
