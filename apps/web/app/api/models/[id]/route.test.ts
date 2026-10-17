import { beforeEach, describe, expect, it } from 'vitest';
import { validFullModel } from '@archwoven/model';
import { openStore } from '@archwoven/jobs';
import { serverDeps } from '../../../lib/server';
import { GET } from './route';
import { POST as UNDO } from './undo/route';

const req = (cookie = 'aw_sid=test-sess') => new Request('http://localhost/api/models/m1', { headers: { cookie } });
const ctx = { params: Promise.resolve({ id: 'm1' }) };
const undoReq = (body: unknown, cookie = 'aw_sid=test-sess') =>
  new Request('http://localhost/api/models/m1/undo', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });

beforeEach(() => {
  serverDeps.store = openStore(':memory:');
});

describe('GET /api/models/:id', () => {
  it('serves a current model unchanged', async () => {
    serverDeps.store.saveRevision('m1', validFullModel, 'test-sess');
    const res = await GET(req(), ctx);
    expect(res.status).toBe(200);
    const { model } = (await res.json()) as { model: { title: string } };
    expect(model.title).toBe(validFullModel.title);
  });

  it('pre-M4 raw revision gets schema defaults at the boundary (C2: canvas reads boundaries/guidedViews unguarded)', async () => {
    const preM4 = structuredClone(validFullModel) as Record<string, unknown>;
    delete preM4.boundaries; delete preM4.guidedViews; delete preM4.semanticChecks;
    serverDeps.store.saveRevision('m1', preM4 as never, 'test-sess');
    const res = await GET(req(), ctx);
    expect(res.status).toBe(200);
    const { model } = (await res.json()) as { model: Record<string, unknown> };
    expect(model.boundaries).toEqual([]);
    expect(model.guidedViews).toEqual([]);
  });

  it('other session → 404', async () => {
    serverDeps.store.saveRevision('m1', validFullModel, 'test-sess');
    expect((await GET(req('aw_sid=mallory'), ctx)).status).toBe(404);
  });
});

describe('POST /api/models/:id/undo — pre-M4 shape (C2)', () => {
  it('undo across a pre-M4 revision serves defaults, not undefined', async () => {
    const preM4 = structuredClone(validFullModel) as Record<string, unknown>;
    delete preM4.boundaries; delete preM4.guidedViews; delete preM4.semanticChecks;
    serverDeps.store.saveRevision('m1', preM4 as never, 'test-sess');
    const rev2 = structuredClone(validFullModel);
    rev2.revision = 2; rev2.parentId = 1;
    serverDeps.store.saveRevision('m1', rev2, 'test-sess');
    const res = await UNDO(undoReq({ prevRevision: 1, baseRevision: 2 }), ctx);
    expect(res.status).toBe(200);
    const { model } = (await res.json()) as { model: Record<string, unknown> };
    expect(model.boundaries).toEqual([]);
    expect(model.guidedViews).toEqual([]);
  });
});
