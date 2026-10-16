import { describe, expect, it } from 'vitest';
import type { Edge, EdgeType } from '@archwoven/model';
import { PULSE_RANK, pulseOrder } from './pulses';

const edge = (id: string, type: EdgeType): Edge => ({
  id, from: 'a', to: 'b', type, provenance: 'source-supported', evidence: [],
});

describe('pulseOrder', () => {
  it('empty view → no pulses', () => {
    expect(pulseOrder([])).toEqual([]);
  });

  it('kind priority event > data > state > call (security tier reserved)', () => {
    const order = pulseOrder([
      edge('e.call', 'sync'),
      edge('e.state', 'control'),
      edge('e.event', 'async'),
      edge('e.data', 'data'),
      edge('e.rel', 'relation'),
    ]);
    expect(order).toEqual(['e.event', 'e.data', 'e.state', 'e.call', 'e.rel']);
  });

  it('ties keep schema order (stable)', () => {
    const order = pulseOrder([edge('e.first', 'sync'), edge('e.second', 'sync'), edge('e.zeroth', 'async')]);
    expect(order).toEqual(['e.zeroth', 'e.first', 'e.second']);
  });

  it('every schema edge kind has a rank', () => {
    const kinds: EdgeType[] = ['sync', 'async', 'data', 'relation', 'control'];
    for (const k of kinds) expect(typeof PULSE_RANK[k]).toBe('number');
  });
});
