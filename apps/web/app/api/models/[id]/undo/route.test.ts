import { beforeEach, describe, expect, it } from 'vitest';
import { validFullModel } from '@archwoven/model';
import { openStore } from '@archwoven/jobs';
import { serverDeps } from '../../../../lib/server';
import { POST } from './route';

const req = (body: unknown, cookie = 'aw_sid=test-sess') =>
  new Request('http://localhost/api/models/m1/undo', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  serverDeps.store = openStore(':memory:');
  serverDeps.store.saveRevision('m1', validFullModel, 'test-sess');
  const rev2 = structuredClone(validFullModel);
  rev2.revision = 2;
  rev2.parentId = 1;
  rev2.title = 'Shop v2';
  serverDeps.store.saveRevision('m1', rev2, 'test-sess');
});

const ctx = { params: Promise.resolve({ id: 'm1' }) };

describe('POST /api/models/:id/undo', () => {
  it('restores the previous content as a forward revision (rev 3, parent 2)', async () => {
    const res = await POST(req({ prevRevision: 1 }), ctx);
    expect(res.status).toBe(200);
    const { model } = (await res.json()) as { model: { revision: number; parentId: number | null; title: string } };
    expect(model.revision).toBe(3);
    expect(model.parentId).toBe(2);
    expect(model.title).toBe(validFullModel.title); // rev1 content, not rev2
    expect(serverDeps.store.getRevision('m1')?.revision).toBe(3);
  });

  it('another session cannot undo your model', async () => {
    const res = await POST(req({ prevRevision: 1 }, 'aw_sid=mallory'), ctx);
    expect(res.status).toBe(404);
    expect(serverDeps.store.getRevision('m1')?.revision).toBe(2);
  });

  it('unknown prevRevision → 400', async () => {
    const res = await POST(req({ prevRevision: 99 }), ctx);
    expect(res.status).toBe(400);
  });
});
