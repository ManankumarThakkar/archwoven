import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validFullModel } from '@archwoven/model';
import { openStore } from '@archwoven/jobs';
import type { Fragment } from '@archwoven/extract';

// The scanner itself failing must stop the job: nothing unscanned may reach a hosted provider.
vi.mock('@archwoven/llm', async (original) => ({ ...(await original<typeof import('@archwoven/llm')>()), maskFragmentSecrets: async () => { throw new Error('scanner unavailable'); } }));
const { serverDeps } = await import('../../lib/server');
const { POST } = await import('./route');

const SHA = 'a'.repeat(40);
const fragment: Fragment = { nodes: [{ id: 'svc.api', kind: 'service', label: 'API', provenance: 'source-supported', evidence: [] }], edges: [], endpoints: [], gaps: [] };

describe('hosted repository analysis fails closed when secret scanning fails', () => {
  beforeEach(() => { serverDeps.store = openStore(':memory:'); });

  it('fails the job, refunds the credits and never calls the provider', async () => {
    const prev = process.env.ARCHWOVEN_MODE; delete process.env.ARCHWOVEN_MODE;
    try {
      let assembled = false;
      serverDeps.ingestRepo = async () => ({ ok: true as const, sha: SHA, framework: 'fastapi', fragment, gaps: [], filesScanned: 1 });
      const { usageFrom } = await import('@archwoven/llm');
      serverDeps.assembleRepoModel = async () => { assembled = true; return { ok: true as const, model: validFullModel, usage: usageFrom({}, 'medium', 0, 0) }; };
      const res = await POST(new Request('http://localhost/api/repo', { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'aw_sid=s' }, body: JSON.stringify({ url: 'https://github.com/foo/bar' }) }));
      const { jobId } = await res.json();
      let job = serverDeps.store.getJob(jobId);
      for (let i = 0; i < 200 && (job?.status === 'queued' || job?.status === 'running'); i++) { await new Promise(r => setTimeout(r, 10)); job = serverDeps.store.getJob(jobId); }
      expect(job?.status).toBe('failed');
      expect(assembled).toBe(false);
      expect(serverDeps.store.creditsUsed('s', new Date().toISOString().slice(0, 10))).toBe(0);
    } finally { if (prev !== undefined) process.env.ARCHWOVEN_MODE = prev; }
  });
});
