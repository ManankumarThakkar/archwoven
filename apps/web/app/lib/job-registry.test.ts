import { expect, it, vi } from 'vitest';

it('route module reloads share the same in-flight controller and execution deadline', async () => {
  const first = await import('./job-registry');
  const entry = { controller: new AbortController(), settled: false, deadlineAt: Date.now() + 1000 };
  first.jobRegistry.set('cross-route', entry);
  try {
    vi.resetModules();
    const second = await import('./job-registry');
    expect(second.jobRegistry.get('cross-route')).toBe(entry);
  } finally { first.jobRegistry.delete('cross-route'); }
});

it('route module reloads share concurrency slots and queue positions', async () => {
  const first = await import('./llm-limiter'); first.resetSlots(1);
  let release!: () => void;
  const running = first.withSlot('running', () => new Promise<void>((resolve) => { release = resolve; }));
  let started = false;
  try {
    vi.resetModules();
    const second = await import('./llm-limiter');
    const queued = second.withSlot('queued', async () => { started = true; });
    expect(second.slotPosition('queued')).toBe(1);
    expect(first.slotPosition('queued')).toBe(1);
    expect(started).toBe(false);
    release(); await running; await queued;
  } finally { release(); await running; first.resetSlots(); }
});
