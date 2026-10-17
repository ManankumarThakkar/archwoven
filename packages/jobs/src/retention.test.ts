import { describe, expect, it } from 'vitest';
import { validFullModel, type SystemModel } from '@archwoven/model';
import { openStore } from './store';

const DAY = 24 * 3600 * 1000;
const START = new Date('2026-01-01T12:00:00Z');

/** A store whose clock the test moves forward, so rows get real ages. */
function clocked() {
  let now = START.getTime();
  const store = openStore(':memory:', { now: () => new Date(now) });
  return { store, at: (days: number) => { now = START.getTime() + days * DAY; } };
}
const rev = (n: number): SystemModel => ({ ...structuredClone(validFullModel), revision: n, parentId: n > 1 ? n - 1 : undefined });
const call = (store: ReturnType<typeof openStore>, sessionId: string) =>
  store.logCall({ sessionId, tier: 'anonymous', view: 'generate', inputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 1, costUsd: 0.001, retries: 0, outcome: 'ok' });

describe('deleteModel', () => {
  it('removes every revision and job of one diagram and nothing else', () => {
    const { store } = clocked();
    store.saveRevision('m1', rev(1), 's'); store.saveRevision('m1', rev(2), 's');
    store.saveRevision('m2', rev(1), 's');
    store.createJob({ id: 'm1', modelId: 'm1', kind: 'generate', sessionId: 's' });
    store.createJob({ id: 'r1', modelId: 'm1', kind: 'refine', sessionId: 's' });
    store.createJob({ id: 'm2', modelId: 'm2', kind: 'generate', sessionId: 's' });
    expect(store.deleteModel('m1')).toEqual({ revisions: 2, jobs: 2 });
    expect(store.getRevision('m1')).toBeNull();
    expect(store.getRevisionOwner('m1')).toBeNull();
    expect(store.getJob('m1')).toBeNull();
    expect(store.getJob('r1')).toBeNull();
    expect(store.getRevision('m2')?.revision).toBe(1);
    expect(store.getJob('m2')).not.toBeNull();
  });

  it('reports nothing for an unknown diagram', () => {
    expect(clocked().store.deleteModel('missing')).toEqual({ revisions: 0, jobs: 0 });
  });
});

describe('sweepExpired', () => {
  it('deletes diagrams whose last change is older than 30 days, with their whole history and jobs', () => {
    const { store, at } = clocked();
    store.saveRevision('old', rev(1), 's'); store.createJob({ id: 'old', modelId: 'old', kind: 'generate', sessionId: 's' });
    store.updateJob('old', { status: 'succeeded' });
    at(31);
    expect(store.sweepExpired()).toMatchObject({ models: 1 });
    expect(store.getRevision('old')).toBeNull();
    expect(store.getJob('old')).toBeNull();
  });

  it('keeps a diagram created long ago but changed recently, including its older revisions', () => {
    const { store, at } = clocked();
    store.saveRevision('active', rev(1), 's');
    at(40); store.saveRevision('active', rev(2), 's');
    at(45);
    expect(store.sweepExpired().models).toBe(0);
    expect(store.getRevision('active', 1)).not.toBeNull();
    expect(store.getRevision('active')?.revision).toBe(2);
  });

  it('keeps a diagram on day 29 and deletes it after day 30', () => {
    const { store, at } = clocked();
    store.saveRevision('edge', rev(1), 's');
    at(29.9); expect(store.sweepExpired().models).toBe(0);
    at(30.1); expect(store.sweepExpired().models).toBe(1);
  });

  it('deletes finished jobs older than 30 days, including unanswered clarifications holding the original prompt', () => {
    const { store, at } = clocked();
    store.createJob({ id: 'ask', modelId: 'ask', kind: 'generate', sessionId: 's' });
    store.updateJob('ask', { status: 'clarifying', clarification: { prompt: 'Our internal billing design…', view: 'architecture', questions: ['Which queue?'] } });
    store.createJob({ id: 'failed', modelId: 'failed', kind: 'repo', sessionId: 's' });
    store.updateJob('failed', { status: 'failed', error: 'no source' });
    store.createJob({ id: 'stuck', modelId: 'stuck', kind: 'generate', sessionId: 's' });
    store.updateJob('stuck', { status: 'running' });
    at(31);
    store.createJob({ id: 'fresh', modelId: 'fresh', kind: 'generate', sessionId: 's' });
    expect(store.sweepExpired().jobs).toBe(2);
    expect(store.getJob('ask')).toBeNull();
    expect(store.getJob('failed')).toBeNull();
    expect(store.getJob('stuck')).not.toBeNull();
    expect(store.getJob('fresh')).not.toBeNull();
  });

  it('prunes metering rows after 90 days and burst counters after a day, without touching recent ones', () => {
    const { store, at } = clocked();
    call(store, 'old-session');
    store.addCreditsUsed('old-session', '2026-01-01', 1);
    at(89); call(store, 'recent-session');
    at(91);
    store.addCreditsUsed('recent-session', '2026-04-01', 1);
    const swept = store.sweepExpired();
    expect(swept.calls).toBe(1);
    expect(swept.credits).toBe(1);
    expect(store.listCalls('old-session')).toEqual([]);
    expect(store.listCalls('recent-session')).toHaveLength(1);
    expect(store.creditsUsed('recent-session', '2026-04-01')).toBe(1);
  });

  it('is idempotent', () => {
    const { store, at } = clocked();
    store.saveRevision('old', rev(1), 's');
    at(31);
    store.sweepExpired();
    expect(store.sweepExpired()).toEqual({ models: 0, jobs: 0, calls: 0, credits: 0, burst: 0 });
  });
});
