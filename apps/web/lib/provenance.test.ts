import { describe, expect, it } from 'vitest';
import { PROVENANCE_STYLE } from './provenance';

describe('provenance badges', () => {
  it('say where each element came from in words a first-time reader understands', () => {
    expect(Object.fromEntries(Object.entries(PROVENANCE_STYLE).map(([kind, style]) => [kind, style.badge]))).toEqual({
      'user-specified': 'described',
      'source-supported': 'from source',
      inferred: 'inferred',
      proposed: 'proposed',
    });
  });
});
