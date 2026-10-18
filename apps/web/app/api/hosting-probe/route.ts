import { timingSafeEqual } from 'node:crypto';
import { assertHostingProbeRuntime, hostingProbeRequested } from '../../../lib/hosting-probe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

/** Fixed inputs only. No provider, repository fetching, filesystem discovery or storage. */
export async function GET(request: Request) {
  try {
    if (!hostingProbeRequested()) throw new Error('disabled');
    assertHostingProbeRuntime();
    const expected = Buffer.from(`Bearer ${process.env.ARCHWOVEN_HOSTING_PROBE_TOKEN}`);
    const received = Buffer.from(request.headers.get('authorization') ?? '');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error('unauthorized');
  } catch {
    return Response.json({ error: 'Not found' }, { status: 404, headers });
  }

  const started = performance.now();
  try {
    // Import after authorization so rejected requests cannot trigger parser startup.
    const { extractSpringBoot, extractFastApi } = await import('@archwoven/extract');
    const { findSecrets } = await import('@archwoven/llm');
    const spring = await extractSpringBoot('', new Map([['Probe.java',
      '@RestController class Probe { @GetMapping("/hosting-ready") public String ready() { return "ok"; } }',
    ]]));
    const fastapi = await extractFastApi('', new Map([['probe.py',
      'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/hosting-ready")\ndef ready():\n    return {"ok": True}\n',
    ]]));
    // Synthetic shape, never a real credential; tests the precise scanner rather than its generic fallback.
    const synthetic = ['gh', 'p_', 'Ab3Cd4Ef5Gh6Ij7Kl8Mn9Op0Qr1St2Uv3Wx4'].join('');
    const findings = await findSecrets(synthetic);
    const checks = {
      spring: spring.endpoints.some(e => e.method === 'GET' && e.path === '/hosting-ready'),
      fastapi: fastapi.endpoints.some(e => e.method === 'GET' && e.path === '/hosting-ready'),
      secretScanner: findings.some(f => f.kind === 'GitHub token'),
    };
    const ok = Object.values(checks).every(Boolean);
    return Response.json({ ok, checks, elapsedMs: Math.round(performance.now() - started) }, { status: ok ? 200 : 503, headers });
  } catch {
    // Dependency errors can contain absolute paths or configuration: never return/log them.
    console.error('[archwoven] hosting dependency probe failed');
    return Response.json({ ok: false, error: 'dependency-check-failed' }, { status: 503, headers });
  }
}
