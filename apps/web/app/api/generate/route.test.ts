import { beforeEach, describe, expect, it } from 'vitest';
import { validFullModel } from '@archwoven/model';
import { openStore } from '@archwoven/jobs';
import { serverDeps } from '../../lib/server';
import { resetSlots } from '../../lib/llm-limiter';
import { GET } from '../jobs/[id]/route';
import { POST } from './route';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
};

const usage = { model: 'claude-opus-5-5', effort: 'medium' as const, inputTokens: 1000, cacheWriteTokens: 5000, cacheReadTokens: 10000, outputTokens: 1500, latencyMs: 500, repairs: 0 };

// §15: quotas compile out in local mode (reserve → Infinity → JSON null); credit gates are hosted-only.
const QUOTA = process.env.ARCHWOVEN_MODE !== 'local';
const hostedOnly = QUOTA ? it : it.skip;

const req = (body: unknown, cookie = 'aw_sid=test-sess') =>
  new Request('http://localhost/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });

async function waitJob(id: string) {
  for (let i = 0; i < 100; i++) {
    const job = serverDeps.store.getJob(id);
    if (job && job.status !== 'queued' && job.status !== 'running') return job;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`job ${id} never settled`);
}

beforeEach(() => {
  serverDeps.store = openStore(':memory:');
  serverDeps.generateModel = async () => ({ ok: true as const, model: validFullModel, usage });
  resetSlots(2);
});

describe('POST /api/generate', () => {
  it('happy path: 202 jobId → job reaches done, revision saved, 1 credit spent', async () => {
    const res = await POST(req({ prompt: 'shop', view: 'architecture', idempotencyKey: 'k1' }));
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: string };
    const job = await waitJob(jobId);
    expect(job.status).toBe('succeeded');
    expect(serverDeps.store.getRevision(jobId)).not.toBeNull();
    expect(serverDeps.store.creditsUsed('test-sess', new Date().toISOString().slice(0, 10))).toBe(QUOTA ? 1 : 0);
  });

  it('duplicate idempotencyKey returns the same job and charges once', async () => {
    const a = await POST(req({ prompt: 'shop', view: 'architecture', idempotencyKey: 'dup' }));
    const { jobId: id1 } = (await a.json()) as { jobId: string };
    await waitJob(id1);
    const b = await POST(req({ prompt: 'shop', view: 'architecture', idempotencyKey: 'dup' }));
    const { jobId: id2 } = (await b.json()) as { jobId: string };
    expect(id2).toBe(id1);
    expect(serverDeps.store.creditsUsed('test-sess', new Date().toISOString().slice(0, 10))).toBe(QUOTA ? 1 : 0);
  });

  hostedOnly('credits exhausted → 429 with friendly reset copy', async () => {
    process.env.ARCHWOVEN_BURST_WINDOW_SEC = '0.05'; // isolate the daily-credit gate from the 5/min burst gate
    try {
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 60));
        const res = await POST(req({ prompt: `p${i}`, view: 'architecture', idempotencyKey: `k${i}` }));
        expect(res.status, `gen ${i + 1}`).toBe(202);
        const { jobId } = (await res.json()) as { jobId: string };
        await waitJob(jobId);
      }
      await new Promise((r) => setTimeout(r, 60));
      const res = await POST(req({ prompt: 'one too many', view: 'architecture', idempotencyKey: 'k99' }));
      expect(res.status).toBe(429);
      const body = (await res.json()) as { reason: string; message: string; resetAt: number };
      expect(body.reason).toBe('credits-exhausted');
      expect(body.message).toMatch(/resets in \d+h \d+m/);
      expect(body.message).toMatch(/GitHub/);
    } finally {
      delete process.env.ARCHWOVEN_BURST_WINDOW_SEC;
    }
  });

  it('oversized prompt → 413 scope-down copy, no model call', async () => {
    let called = false;
    serverDeps.generateModel = async () => {
      called = true;
      return { ok: true as const, model: validFullModel, usage };
    };
    const res = await POST(req({ prompt: 'x'.repeat(100_001), view: 'architecture', idempotencyKey: 'big' }));
    expect(res.status).toBe(413);
    expect(((await res.json()) as { message: string }).message).toMatch(/one system or flow/);
    expect(called).toBe(false);
  });

  it('provider failure → job.failed, credits NOT spent, prompt preserved in error', async () => {
    serverDeps.generateModel = async () => ({ ok: false as const, errors: ['provider exploded'], usage });
    const res = await POST(req({ prompt: 'shop', view: 'architecture', idempotencyKey: 'fail' }));
    const { jobId } = (await res.json()) as { jobId: string };
    const job = await waitJob(jobId);
    expect(job.status).toBe('failed');
    expect(job.error).toContain('provider exploded');
    expect(serverDeps.store.creditsUsed('test-sess', new Date().toISOString().slice(0, 10))).toBe(0);
  });

  it('mints the session cookie when absent', async () => {
    const res = await POST(req({ prompt: 'shop', view: 'architecture', idempotencyKey: 'fresh' }, ''));
    expect(res.headers.get('set-cookie')).toMatch(/aw_sid=/);
  });

  it('202 body carries the live remaining credits', async () => {
    const res = await POST(req({ prompt: 'shop', view: 'architecture', idempotencyKey: 'rem1' }));
    const body = (await res.json()) as { jobId: string; remaining: number };
    expect(body.remaining).toBe(QUOTA ? 5 : null);
  });

  it('idempotency dedupe is session-scoped — another session with the same key gets its own job', async () => {
    const a = await POST(req({ prompt: 'shop', view: 'architecture', idempotencyKey: 'shared' }));
    const { jobId: id1 } = (await a.json()) as { jobId: string };
    await waitJob(id1);
    const b = await POST(req({ prompt: 'shop', view: 'architecture', idempotencyKey: 'shared' }, 'aw_sid=other-sess'));
    expect(b.status).toBe(202);
    const { jobId: id2 } = (await b.json()) as { jobId: string };
    expect(id2).not.toBe(id1);
    await waitJob(id2);
    expect(serverDeps.store.creditsUsed('other-sess', new Date().toISOString().slice(0, 10))).toBe(QUOTA ? 1 : 0);
  });

  it('excess parallel generates queue with a visible position (§15 concurrency cap)', async () => {
    const gate = deferred();
    serverDeps.generateModel = async () => {
      await gate.promise;
      return { ok: true as const, model: validFullModel, usage };
    };
    const ids: string[] = [];
    for (const k of ['q1', 'q2', 'q3']) {
      const res = await POST(req({ prompt: `p${k}`, view: 'architecture', idempotencyKey: k }));
      expect(res.status).toBe(202);
      ids.push(((await res.json()) as { jobId: string }).jobId);
    }
    await new Promise((r) => setTimeout(r, 20));
    const third = await GET(new Request(`http://localhost/api/jobs/${ids[2]}`, { headers: { cookie: 'aw_sid=test-sess' } }), { params: Promise.resolve({ id: ids[2]! }) });
    const body = (await third.json()) as { status: string; queuePosition: number | null };
    expect(body.status).toBe('queued');
    expect(body.queuePosition).toBe(1);
    gate.resolve();
    for (const id of ids) await waitJob(id);
  });

  hostedOnly('credits are reserved at accept and refunded when the job fails', async () => {
    const gate = deferred();
    serverDeps.generateModel = async () => {
      await gate.promise;
      return { ok: false as const, errors: ['boom'], usage };
    };
    const res = await POST(req({ prompt: 'shop', view: 'architecture', idempotencyKey: 'rr' }));
    const { jobId } = (await res.json()) as { jobId: string };
    // reserved at accept (job still blocked in the model call):
    expect(serverDeps.store.creditsUsed('test-sess', new Date().toISOString().slice(0, 10))).toBe(1);
    gate.resolve();
    await waitJob(jobId);
    // refunded after failure:
    expect(serverDeps.store.creditsUsed('test-sess', new Date().toISOString().slice(0, 10))).toBe(0);
  });

  it('local mode: a lying model self-report loses to the server privacy stamp', async () => {
    const prevMode = process.env.ARCHWOVEN_MODE;
    process.env.ARCHWOVEN_MODE = 'local';
    try {
      const liar = structuredClone(validFullModel);
      liar.privacy = { classification: 'public', boundary: 'external-allowed' };
      serverDeps.generateModel = async () => ({ ok: true as const, model: liar, usage });
      const res = await POST(req({ prompt: 'shop', view: 'architecture', idempotencyKey: 'stamp-local' }));
      const { jobId } = (await res.json()) as { jobId: string };
      await waitJob(jobId);
      expect(serverDeps.store.getRevision(jobId)?.privacy).toEqual({ classification: 'private', boundary: 'local-only' });
    } finally {
      if (prevMode === undefined) delete process.env.ARCHWOVEN_MODE; else process.env.ARCHWOVEN_MODE = prevMode;
    }
  });

  it('hosted without a key: 503 at the gate with human copy, credits untouched (no SDK error later)', async () => {
    const prevKey = process.env.ANTHROPIC_API_KEY;
    const prevMode = process.env.ARCHWOVEN_MODE;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ARCHWOVEN_MODE; // force hosted regardless of suite mode
    try {
      const res = await POST(req({ prompt: 'shop', view: 'architecture', idempotencyKey: 'nokey' }));
      expect(res.status).toBe(503);
      const body = await res.json() as { reason: string; message: string };
      expect(body.reason).toBe('llm-not-configured');
      expect(body.message).toMatch(/ANTHROPIC_API_KEY/);
      expect(body.message).toMatch(/ARCHWOVEN_MODE=local/);
      expect(serverDeps.store.creditsUsed('test-sess', new Date().toISOString().slice(0, 10))).toBe(0);
    } finally {
      if (prevKey !== undefined) process.env.ANTHROPIC_API_KEY = prevKey;
      if (prevMode !== undefined) process.env.ARCHWOVEN_MODE = prevMode;
    }
  });

  it('hosted mode: the stamp is public · external-allowed even if the model claims private', async () => {
    const prevMode = process.env.ARCHWOVEN_MODE;
    delete process.env.ARCHWOVEN_MODE; // force hosted regardless of suite mode
    try {
      const claimer = structuredClone(validFullModel);
      claimer.privacy = { classification: 'private', boundary: 'local-only' };
      serverDeps.generateModel = async () => ({ ok: true as const, model: claimer, usage });
      const res = await POST(req({ prompt: 'shop', view: 'architecture', idempotencyKey: 'stamp-hosted' }));
      const { jobId } = (await res.json()) as { jobId: string };
      await waitJob(jobId);
      expect(serverDeps.store.getRevision(jobId)?.privacy).toEqual({ classification: 'public', boundary: 'external-allowed' });
    } finally {
      if (prevMode !== undefined) process.env.ARCHWOVEN_MODE = prevMode;
    }
  });

  it('failed provider call is still metered to call_log (§11 data, stop-loss input)', async () => {
    serverDeps.generateModel = async () => ({ ok: false as const, errors: ['boom'], usage });
    expect(serverDeps.store.todayCost()).toBe(0);
    const res = await POST(req({ prompt: 'shop', view: 'architecture', idempotencyKey: 'meter' }));
    const { jobId } = (await res.json()) as { jobId: string };
    await waitJob(jobId);
    // the failed attempt billed real tokens — the old code logged nothing here,
    // so todayCost (the stop-loss input) undercounted every failure.
    expect(serverDeps.store.todayCost()).toBeGreaterThan(0);
    expect(serverDeps.store.creditsUsed('test-sess', new Date().toISOString().slice(0, 10))).toBe(0);
  });
});

describe('GET /api/jobs/:id', () => {
  it('returns stage for polling', async () => {
    const res = await POST(req({ prompt: 'shop', view: 'architecture', idempotencyKey: 'poll' }));
    const { jobId } = (await res.json()) as { jobId: string };
    await waitJob(jobId);
    const jobRes = await GET(new Request(`http://localhost/api/jobs/${jobId}`, { headers: { cookie: 'aw_sid=test-sess' } }), { params: Promise.resolve({ id: jobId }) });
    const body = (await jobRes.json()) as { status: string; modelId: string; revision: number };
    expect(body.status).toBe('succeeded');
    expect(body.modelId).toBe(jobId);
    expect(body.revision).toBe(validFullModel.revision);
  });

  it('another session cannot read your job', async () => {
    const res = await POST(req({ prompt: 'shop', view: 'architecture', idempotencyKey: 'priv' }));
    const { jobId } = (await res.json()) as { jobId: string };
    await waitJob(jobId);
    const leak = await GET(new Request(`http://localhost/api/jobs/${jobId}`, { headers: { cookie: 'aw_sid=mallory' } }), { params: Promise.resolve({ id: jobId }) });
    expect(leak.status).toBe(404);
  });
});


describe('clarification lifecycle', () => {
  async function questionJob() {
    serverDeps.generateModel = async () => ({ ok: true as const, questions: ['Store orders or keep them transient?', 'Who can submit orders?'], usage });
    const res = await POST(req({ prompt: 'Store orders. Store nothing.', view: 'architecture', idempotencyKey: 'questions' }));
    const { jobId } = await res.json();
    const job = await waitJob(jobId);
    expect(job.status).toBe('clarifying');
    return jobId as string;
  }
  it('persists owner-only questions, releases the slot, records usage and refunds the question-only credit', async () => {
    const id = await questionJob();
    const body = await (await GET(new Request('http://localhost/api/jobs/'+id, { headers: { cookie: 'aw_sid=test-sess' } }), { params: Promise.resolve({ id }) })).json();
    expect(body.questions).toEqual(['Store orders or keep them transient?', 'Who can submit orders?']);
    expect(body.remaining).toBe(QUOTA ? 6 : null);
    expect(body).not.toHaveProperty('prompt');
    expect(serverDeps.store.getRevision(id)).toBeNull();
    expect(serverDeps.store.todayCost()).toBeGreaterThan(0);
    const leak = await GET(new Request('http://localhost/api/jobs/'+id, { headers: { cookie: 'aw_sid=other' } }), { params: Promise.resolve({ id }) });
    expect(leak.status).toBe(404);
  });
  it('continues using the stored prompt/view, keeps unanswered questions and marks supplied answers clarified', async () => {
    const id = await questionJob();
    let received = ''; let allowed: boolean | undefined; let receivedView: string | undefined;
    serverDeps.generateModel = async (prompt, view, opts) => { received=prompt;receivedView=view;allowed=opts?.allowClarification;return { ok: true as const, model: validFullModel, usage }; };
    const res=await POST(req({ clarification: { jobId: id, answers: ['Keep orders transient.', ''] } }));
    expect(res.status).toBe(202);const {jobId}=await res.json();expect((await waitJob(jobId)).status).toBe('succeeded');
    expect(received).toContain('Store orders. Store nothing.');expect(received).toContain('Keep orders transient.');expect(receivedView).toBe('architecture');expect(allowed).toBe(false);
    const model=serverDeps.store.getRevision(jobId)!;
    expect(model.requirements.some(r=>r.status==='clarified' && r.text.includes('Keep orders transient.'))).toBe(true);
    expect(model.openQuestions.some(q=>q.text==='Who can submit orders?')).toBe(true);
    const duplicate=await POST(req({ clarification: { jobId: id, answers: ['Keep orders transient.', ''] } }));
    expect((await duplicate.json()).jobId).toBe(jobId);
    expect(serverDeps.store.creditsUsed('test-sess',new Date().toISOString().slice(0,10))).toBe(QUOTA?1:0);
  });
  it('skip retains every unanswered question in the saved model and never asks again', async () => {
    const id=await questionJob();serverDeps.generateModel=async()=>({ok:true as const,model:validFullModel,usage});
    const res=await POST(req({clarification:{jobId:id,skip:true}}));expect(res.status).toBe(202);
    const {jobId}=await res.json();await waitJob(jobId);
    expect(serverDeps.store.getRevision(jobId)!.openQuestions.map(q=>q.text)).toEqual(expect.arrayContaining(['Store orders or keep them transient?', 'Who can submit orders?']));
  });
  it('rejects foreign challenges and invalid answers before any reservation', async () => {
    const id=await questionJob();
    expect((await POST(req({clarification:{jobId:id,skip:true}},'aw_sid=other'))).status).toBe(404);
    for(const clarification of [{jobId:id,answers:['x'.repeat(1001),'']},{jobId:id,answers:['one']},{jobId:id,skip:true,answers:['a','b']},{jobId:id,answers:['','']}]) {
      expect((await POST(req({clarification}))).status).toBe(400);
    }
    expect(serverDeps.store.creditsUsed('test-sess',new Date().toISOString().slice(0,10))).toBe(0);
  });
});


it('a concurrent duplicate acceptance refunds the losing reservation',async()=>{
  const store=serverDeps.store, originalFind=store.findJobByIdempotencyKey.bind(store);
  let reads=0;
  store.findJobByIdempotencyKey=(key,owner)=>++reads<=2?null:originalFind(key,owner);
  const a=await POST(req({prompt:'Shop',view:'architecture',idempotencyKey:'race'}));
  const b=await POST(req({prompt:'Shop',view:'architecture',idempotencyKey:'race'}));
  const first=await a.json();expect((await b.json()).jobId).toBe(first.jobId);await waitJob(first.jobId);
  expect(store.creditsUsed('test-sess',new Date().toISOString().slice(0,10))).toBe(QUOTA?1:0);
});
