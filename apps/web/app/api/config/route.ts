import { deployMode, fakeMode } from '../../lib/mode';
import { resolveHostedModelId } from '@archwoven/model';

export const dynamic = 'force-dynamic';

/** Public deployment facts for the UI chip — no session, no secrets. */
export function GET() {
  const mode = deployMode();
  // boolean only — the key itself never crosses the wire.
  const llmReady = mode === 'local' || fakeMode() || (process.env.ANTHROPIC_API_KEY ?? '').trim().length > 0;
  return Response.json({ mode, fake: fakeMode(), llmReady, hostedModel: mode === 'hosted' && !fakeMode() ? resolveHostedModelId(process.env.ARCHWOVEN_HOSTED_MODEL) : null }, { headers: { 'Cache-Control': 'private, no-store' } });
}
