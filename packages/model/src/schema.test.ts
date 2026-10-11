import { describe, expect, it } from 'vitest';
import { SystemModelSchema } from './schema';
import validFull from './fixtures/valid-full.json';
import validNulls from './fixtures/valid-null-optionals.json';

describe('SystemModelSchema', () => {
  it('parses the full valid fixture', () => {
    const r = SystemModelSchema.safeParse(validFull);
    expect(r.success).toBe(true);
  });

  it('accepts omitted optional fields and explicit nulls', () => {
    const r = SystemModelSchema.safeParse(validNulls);
    expect(r.success).toBe(true);
  });

  it('rejects unknown provenance, naming the field', () => {
    const bad = structuredClone(validFull);
    (bad.nodes[0] as { provenance: string }).provenance = 'guessed';
    const r = SystemModelSchema.safeParse(bad);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes('provenance'))).toBe(true);
    }
  });

  it('rejects unknown node kind', () => {
    const bad = structuredClone(validFull);
    (bad.nodes[1] as { kind: string }).kind = 'blobstore';
    expect(SystemModelSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects schemaVersion other than "1"', () => {
    const bad = structuredClone(validFull);
    (bad as { schemaVersion: string }).schemaVersion = '2';
    expect(SystemModelSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects unknown extra keys (strict)', () => {
    const bad = structuredClone(validFull);
    (bad.nodes[0] as unknown as Record<string, unknown>).hallucinated = true;
    expect(SystemModelSchema.safeParse(bad).success).toBe(false);
  });
});

describe('M4 semantic additions (optional, backward-compatible)', () => {
  const withExtras = () => {
    const m = structuredClone(validFull);
    (m as Record<string, unknown>).semanticChecks = {
      allowedRoots: [(m.nodes[0] as { id: string }).id],
      allowedTerminals: [(m.nodes[m.nodes.length - 1] as { id: string }).id],
      requiredEdges: [{ from: (m.nodes[0] as { id: string }).id, to: (m.nodes[1] as { id: string }).id, type: 'sync' }],
      requiredPaths: [{ from: (m.nodes[0] as { id: string }).id, to: (m.nodes[m.nodes.length - 1] as { id: string }).id }],
    };
    (m as Record<string, unknown>).boundaries = [{ id: 'b1', label: 'Cloud', wraps: [(m.nodes[0] as { id: string }).id] }];
    (m as Record<string, unknown>).guidedViews = [{ id: 'gv1', label: 'Happy path', focus: [(m.nodes[0] as { id: string }).id, (m.nodes[1] as { id: string }).id], note: 'start here' }];
    (m.edges[0] as { role?: string }).role = 'main';
    (m.views[0] as { mainPath?: string[] }).mainPath = [(m.nodes[0] as { id: string }).id, (m.nodes[1] as { id: string }).id];
    return m;
  };

  it('pre-M4 fixture validates unchanged; new fields default cleanly', () => {
    const r = SystemModelSchema.safeParse(validFull);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.semanticChecks).toBeUndefined();
      expect(r.data.boundaries).toEqual([]);
      expect(r.data.guidedViews).toEqual([]);
    }
  });

  it('accepts all M4 fields together', () => {
    expect(SystemModelSchema.safeParse(withExtras()).success).toBe(true);
  });

  it('rejects more than 5 guided views', () => {
    const m = withExtras();
    (m as Record<string, unknown>).guidedViews = Array.from({ length: 6 }, (_, i) => ({ id: `g${i}`, label: `g${i}`, focus: [(m.nodes[0] as { id: string }).id] }));
    expect(SystemModelSchema.safeParse(m).success).toBe(false);
  });

  it('rejects a boundary wrapping nothing', () => {
    const m = withExtras();
    (m as Record<string, unknown>).boundaries = [{ id: 'b1', label: 'Empty', wraps: [] }];
    expect(SystemModelSchema.safeParse(m).success).toBe(false);
  });

  it('rejects an unknown edge role, naming the field', () => {
    const m = withExtras();
    (m.edges[0] as { role?: string }).role = 'vibes';
    const r = SystemModelSchema.safeParse(m);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path.includes('role'))).toBe(true);
  });

  it('rejects a mainPath shorter than 2 nodes', () => {
    const m = withExtras();
    (m.views[0] as { mainPath?: string[] }).mainPath = [(m.nodes[0] as { id: string }).id];
    expect(SystemModelSchema.safeParse(m).success).toBe(false);
  });
});
