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
