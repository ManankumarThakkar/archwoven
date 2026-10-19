import { TIERS, creditsRemaining } from '@archwoven/jobs';
import { serverDeps, readOrCreateSession, sessionCookie, tierOf, clientIp } from '../../lib/server';
import { fakeMode } from '../../lib/mode';
import { hostedJobs } from '../../lib/hosted-runner';

export const runtime = 'nodejs';

/** Live credit meter — the header chip's real data source. */
export async function GET(req: Request) {
  const { sessionId, minted } = readOrCreateSession(req);
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cache-control': 'private, no-store' };
  if (minted) headers['set-cookie'] = sessionCookie(sessionId);
  const tier = tierOf(sessionId);
  const jobs = hostedJobs();
  if (jobs) {
    // Hosted limits are money caps, not credits; the last task report lives with the job state.
    const lastTask = jobs === 'misconfigured' ? null : await jobs.getOwned('lasttask', jobs.ownerOf(sessionId), sessionId).catch(() => null);
    return Response.json({ remaining: null, pool: null, tier, fake: fakeMode(), lastTask }, { status: 200, headers });
  }
  const remaining = creditsRemaining(serverDeps.store, { sessionId, tier, ip: clientIp(req.headers) });
  return Response.json({ remaining, pool: TIERS[tier].pool, tier, fake: fakeMode(), lastTask: serverDeps.store.lastTask(sessionId) }, { status: 200, headers });
}
