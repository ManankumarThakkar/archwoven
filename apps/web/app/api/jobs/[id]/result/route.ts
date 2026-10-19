import { readOrCreateSession } from '../../../../lib/server';
import { hostedJobs, HOSTED_NOT_CONFIGURED_COPY, HOSTED_UNAVAILABLE_COPY } from '../../../../lib/hosted-runner';

export const runtime = 'nodejs';

/** A hosted job's result, for 24 hours, to the session that owns the job only. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { sessionId } = readOrCreateSession(req);
  const { id } = await ctx.params;
  const headers = { 'cache-control': 'private, no-store' };
  const jobs = hostedJobs();
  if (jobs === 'misconfigured') return Response.json({ error: HOSTED_NOT_CONFIGURED_COPY }, { status: 503, headers });
  if (!jobs) return Response.json({ error: 'result not found' }, { status: 404, headers });
  let result: unknown;
  try { result = await jobs.getOwned('result', id, sessionId); }
  catch { return Response.json({ error: HOSTED_UNAVAILABLE_COPY }, { status: 503, headers }); }
  return result ? Response.json(result, { headers }) : Response.json({ error: 'result not found' }, { status: 404, headers });
}
