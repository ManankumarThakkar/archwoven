import { describe, expect, it } from 'vitest';
import { motionMode } from './motion';

describe('motionMode', () => {
  it('no stored pref, no OS reduced → motion', () => {
    expect(motionMode(null, false)).toBe('motion');
  });

  it('OS reduced with empty localStorage → still (no JS gate needed)', () => {
    expect(motionMode(null, true)).toBe('still');
  });

  it('stored still wins over OS motion', () => {
    expect(motionMode('still', false)).toBe('still');
  });

  it('stored motion overrides OS reduced (explicit user opt-in)', () => {
    expect(motionMode('motion', true)).toBe('motion');
  });
});
