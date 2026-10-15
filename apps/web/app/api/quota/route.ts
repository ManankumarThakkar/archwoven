import { TIERS } from '@archwoven/jobs';
import { serverDeps, readOrCreateSession, sessionCookie, tierOf } from '../../lib/server';
import { fakeMode } from '../../lib/mode';

export const runtime = 'nodejs';

/** Live credit meter (§15) — the header chip's real data source. */
export async function GET(req: Request) {
  const { sessionId, minted } = readOrCreateSession(req);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (minted) headers['set-cookie'] = sessionCookie(sessionId);
  const tier = tierOf(sessionId);
  const used = serverDeps.store.creditsUsed(sessionId, new Date().toISOString().slice(0, 10));
  return Response.json({ remaining: Math.max(0, TIERS[tier].pool - used), pool: TIERS[tier].pool, tier, fake: fakeMode() }, { status: 200, headers });
}
