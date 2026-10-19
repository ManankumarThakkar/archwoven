import { describe, expect, it } from 'vitest';
import { isOwnedId, ownedId } from './owned-ids';

const secret = 'test-session-secret-0123456789abcdef';

describe('ids bound to the visitor session', () => {
  it('mints UUID-shaped ids that only the minting session owns', () => {
    const id = ownedId('session-a', secret);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(isOwnedId(id, 'session-a', secret)).toBe(true);
    expect(isOwnedId(id, 'session-b', secret)).toBe(false);
    expect(isOwnedId(id, 'session-a', 'another-secret-0123456789abcdefghij')).toBe(false);
    expect(ownedId('session-a', secret)).not.toBe(id);
  });

  it('rejects random, tampered and malformed ids', () => {
    const id = ownedId('session-a', secret);
    const tampered = id.slice(0, -1) + (id.endsWith('0') ? '1' : '0');
    for (const candidate of [crypto.randomUUID(), tampered, '../x', '', id.toUpperCase(), `${id}0`]) expect(isOwnedId(candidate, 'session-a', secret)).toBe(false);
  });
});
