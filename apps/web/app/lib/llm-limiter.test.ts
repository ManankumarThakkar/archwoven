import { describe, expect, it } from 'vitest';
import { withSlot, slotPosition, resetSlots } from './llm-limiter';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
};

describe('llm concurrency cap (N parallel model calls, excess queue)', () => {
  it('runs at most N in parallel and queues the excess with a visible position', async () => {
    resetSlots(2);
    const a = deferred(); const b = deferred(); const c = deferred();
    const started = new Set<string>();
    const pa = withSlot('ja', async () => { started.add('a'); await a.promise; });
    const pb = withSlot('jb', async () => { started.add('b'); await b.promise; });
    const pc = withSlot('jc', async () => { started.add('c'); await c.promise; });

    await Promise.resolve();
    expect(started).toEqual(new Set(['a', 'b'])); // c is queued
    expect(slotPosition('jc')).toBe(1);
    expect(slotPosition('ja')).toBeNull();

    a.resolve();
    await pa;
    await new Promise((r) => setTimeout(r, 0));
    expect(started.has('c')).toBe(true); // c took the freed slot
    b.resolve();
    c.resolve();
    await pb;
    await pc;
  });

  it('position shifts as the queue drains', async () => {
    resetSlots(1);
    const a = deferred(); const b = deferred(); const c = deferred();
    const pa = withSlot('ja', () => a.promise);
    const pb = withSlot('jb', () => b.promise);
    const pc = withSlot('jc', () => c.promise);
    expect(slotPosition('jb')).toBe(1);
    expect(slotPosition('jc')).toBe(2);
    a.resolve();
    await pa;
    await new Promise((r) => setTimeout(r, 0));
    expect(slotPosition('jc')).toBe(1);
    b.resolve();
    await pb;
    c.resolve();
    await pc;
  });

  it('a throwing task still releases its slot', async () => {
    resetSlots(1);
    await expect(withSlot('j1', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    const ran = await withSlot('j2', async () => 'ok');
    expect(ran).toBe('ok');
  });
});
