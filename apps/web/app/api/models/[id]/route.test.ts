import { beforeEach, describe, expect, it } from 'vitest';
import { validFullModel } from '@archwoven/model';
import { openStore } from '@archwoven/jobs';
import { serverDeps } from '../../../lib/server';
import { DELETE, GET } from './route';
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

describe('DELETE /api/models/:id', () => {
  const del = (cookie = 'aw_sid=test-sess') => new Request('http://localhost/api/models/m1', { method: 'DELETE', headers: { cookie } });

  it('deletes the whole diagram history for its owner', async () => {
    serverDeps.store.saveRevision('m1', validFullModel, 'test-sess');
    const rev2 = structuredClone(validFullModel); rev2.revision = 2; rev2.parentId = 1;
    serverDeps.store.saveRevision('m1', rev2, 'test-sess');
    const res = await DELETE(del(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(serverDeps.store.getRevision('m1')).toBeNull();
    expect(serverDeps.store.getRevision('m1', 1)).toBeNull();
    expect((await GET(req(), ctx)).status).toBe(404);
  });

  it('never reveals or deletes another session\'s diagram', async () => {
    serverDeps.store.saveRevision('m1', validFullModel, 'test-sess');
    expect((await DELETE(del('aw_sid=mallory'), ctx)).status).toBe(404);
    expect(serverDeps.store.getRevision('m1')).not.toBeNull();
  });

  it('answers 404 for a diagram that is already gone', async () => {
    expect((await DELETE(del(), ctx)).status).toBe(404);
  });
});
