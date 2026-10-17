import { afterEach, describe, expect, it, vi } from 'vitest';
import { startRetentionSweeper } from './retention';

afterEach(() => vi.useRealTimers());

const fakeStore = (result = { models: 1, jobs: 2, calls: 0, credits: 0, burst: 0 }) => {
  const store = { sweepExpired: vi.fn(() => result), close: vi.fn() };
  return store;
};

describe('startRetentionSweeper', () => {
  it('sweeps at start and then every 24 hours, closing its connection each time', () => {
    vi.useFakeTimers();
    const store = fakeStore();
    const log = vi.fn();
    const stop = startRetentionSweeper(() => store, log);
    expect(store.sweepExpired).toHaveBeenCalledTimes(1);
    expect(store.close).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('[archwoven] retention sweep removed 1 diagram(s) and 2 job(s)');
    vi.advanceTimersByTime(24 * 3600 * 1000 - 1);
    expect(store.sweepExpired).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(store.sweepExpired).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(48 * 3600 * 1000);
    expect(store.sweepExpired).toHaveBeenCalledTimes(2);
  });

  it('keeps sweeping after a failed run and still closes the connection', () => {
    vi.useFakeTimers();
    const store = { sweepExpired: vi.fn(() => { throw new Error('database is locked'); }), close: vi.fn() };
    const log = vi.fn();
    const stop = startRetentionSweeper(() => store, log);
    expect(store.close).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('[archwoven] retention sweep failed: database is locked');
    vi.advanceTimersByTime(24 * 3600 * 1000);
    expect(store.sweepExpired).toHaveBeenCalledTimes(2);
    stop();
  });

  it('logs nothing when nothing expired', () => {
    const log = vi.fn();
    startRetentionSweeper(() => fakeStore({ models: 0, jobs: 0, calls: 3, credits: 0, burst: 9 }), log)();
    expect(log).not.toHaveBeenCalled();
  });
});
