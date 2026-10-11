import { deployMode } from '../../lib/mode';
import { fakeMode } from '../../lib/server';

export const dynamic = 'force-dynamic';

/** Public deployment facts for the UI chip — no session, no secrets. */
export function GET() {
  return Response.json({ mode: deployMode(), fake: fakeMode() });
}
