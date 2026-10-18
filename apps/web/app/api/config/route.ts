import { deployMode, fakeMode } from '../../lib/mode';
import { resolveHostedModelId } from '@archwoven/model';
import { openEvaluationBudget } from '@archwoven/jobs';

export const dynamic = 'force-dynamic';

/** Public deployment facts for the UI chip — no session, no secrets. */
export function GET() {
  const mode = deployMode();
  // boolean only — the key itself never crosses the wire.
  const llmReady = mode === 'local' || fakeMode() || (process.env.ANTHROPIC_API_KEY ?? '').trim().length > 0;
  const file = process.env.ARCHWOVEN_EVAL_BUDGET_DB;
  let evaluationBudgetCapNanos: number | null = null;
  if (file !== undefined) {
    const budget = openEvaluationBudget(file);
    try { evaluationBudgetCapNanos = budget.snapshot().capNanos; } finally { budget.close(); }
  }
  return Response.json({
    mode, fake: fakeMode(), llmReady,
    hostedModel: mode === 'hosted' && !fakeMode() ? resolveHostedModelId(process.env.ARCHWOVEN_HOSTED_MODEL) : null,
    evaluationBudgetEnabled: file !== undefined, evaluationBudgetCapNanos,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
