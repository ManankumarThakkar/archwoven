import { TIERS, creditsRemaining } from '@archwoven/jobs';
import { serverDeps, readOrCreateSession, sessionCookie, tierOf, clientIp } from '../../lib/server';
import { fakeMode } from '../../lib/mode';

export const runtime = 'nodejs';

/** Live credit meter (§15) — the header chip's real data source. */
export async function GET(req: Request) {
  const { sessionId, minted } = readOrCreateSession(req);
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cache-control': 'private, no-store' };
  if (minted) headers['set-cookie'] = sessionCookie(sessionId);
  const tier = tierOf(sessionId);
  const remaining = creditsRemaining(serverDeps.store, { sessionId, tier, ip: clientIp(req.headers) });
  return Response.json({ remaining, pool: TIERS[tier].pool, tier, fake: fakeMode(), lastTask: serverDeps.store.lastTask(sessionId) }, { status: 200, headers });
}
