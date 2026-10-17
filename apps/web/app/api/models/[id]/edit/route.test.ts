import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validFullModel } from '@archwoven/model';
import { openStore } from '@archwoven/jobs';
import { serverDeps } from '../../../../lib/server';
import { POST } from './route';
const ctx = { params: Promise.resolve({ id: 'm1' }) };
const request = (action: unknown, baseRevision = 1, cookie = 'aw_sid=owner') => new Request('http://localhost/api/models/m1/edit', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ baseRevision, action }) });
beforeEach(() => {
    serverDeps.store = openStore(':memory:');
    serverDeps.store.saveRevision('m1', validFullModel, 'owner');
    serverDeps.generateRefinement = vi.fn();
    serverDeps.generateModel = vi.fn();
});
describe('direct edits', () => {
    it('renames without changing identity, evidence, semantics or invoking inference', async () => {
        const response = await POST(request({ type: 'rename', target: 'gateway.api', label: '  Public API  ' }), ctx);
        expect(response.status).toBe(200);
        const { model } = await response.json();
        const expected = structuredClone(validFullModel);
        expected.revision = 2;
        expected.parentId = 1;
        expected.nodes.find(n => n.id === 'gateway.api')!.label = 'Public API';
        expect(model).toEqual(expected);
        expect(serverDeps.store.getRevision('m1')).toEqual(expected);
        expect(serverDeps.generateRefinement).not.toHaveBeenCalled();
        expect(serverDeps.generateModel).not.toHaveBeenCalled();
        expect(serverDeps.store.listCalls('owner')).toEqual([]);
        expect(serverDeps.store.creditsUsed('owner', new Date().toISOString().slice(0, 10))).toBe(0);
    });
    it('persists a batch of finite manual positions atomically', async () => {
        const response = await POST(request({ type: 'move', positions: { 'gateway.api': { x: -80, y: 250 }, 'actor.user': { x: 400, y: 50 } } }), ctx);
        expect(response.status).toBe(200);
        expect(serverDeps.store.getRevision('m1')?.layout).toEqual({ 'gateway.api': { x: -80, y: 250 }, 'actor.user': { x: 400, y: 50 } });
        expect(serverDeps.store.getRevision('m1')?.nodes).toEqual(validFullModel.nodes);
    });
    it('rejects a stale edit with the latest model without overwriting it', async () => {
        await POST(request({ type: 'rename', target: 'gateway.api', label: 'Latest API' }), ctx);
        const response = await POST(request({ type: 'rename', target: 'gateway.api', label: 'Stale API' }), ctx);
        expect(response.status).toBe(409);
        expect((await response.json()).model.nodes.find((n: {
            id: string;
        }) => n.id === 'gateway.api').label).toBe('Latest API');
        expect(serverDeps.store.getRevision('m1')?.revision).toBe(2);
    });
    it('does not reveal or change another owner’s model', async () => {
        expect((await POST(request({ type: 'rename', target: 'gateway.api', label: 'Nope' }, 1, 'aw_sid=other'), ctx)).status).toBe(404);
        expect(serverDeps.store.getRevision('m1')?.revision).toBe(1);
    });
    it('stops oversized request streams before parsing an otherwise valid edit', async () => {
        const cancel = vi.fn(), bytes = new TextEncoder().encode(JSON.stringify({ baseRevision: 1, action: { type: 'rename', target: 'gateway.api', label: 'small' } }) + ' '.repeat(70000));
        const body = new ReadableStream({ start(controller) { controller.enqueue(bytes); }, cancel });
        const req = new Request('http://localhost/api/models/m1/edit', { method: 'POST', headers: { cookie: 'aw_sid=owner', 'content-type': 'application/json' }, body, duplex: 'half' } as RequestInit);
        expect((await POST(req, ctx)).status).toBe(400);
        expect(cancel).toHaveBeenCalledOnce();
        expect(serverDeps.store.getRevision('m1')?.revision).toBe(1);
    });
    it.each([
        { type: 'rename', target: 'gateway.api', label: ' ' },
        { type: 'rename', target: 'gateway.api', label: 'x'.repeat(501) },
        { type: 'rename', target: 'gateway.api', label: 'x', provenance: 'proposed' },
        { type: 'move', positions: { 'gateway.api': { x: 100001, y: 0 } } },
        { type: 'move', positions: { missing: { x: 10, y: 20 }, 'gateway.api': { x: 1, y: 2 } } },
        { type: 'move', positions: {} },
    ])('rejects malformed or unknown edits atomically: %j', async (action) => {
        expect((await POST(request(action), ctx)).status).toBe(400);
        expect(serverDeps.store.getRevision('m1')?.revision).toBe(1);
    });
});
