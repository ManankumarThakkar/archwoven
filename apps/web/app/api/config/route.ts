import { deployMode, fakeMode } from '../../lib/mode';
import { HOSTED_REQUESTS, resolveHostedModelId } from '@archwoven/model';
import { evaluationLedgerId, openEvaluationBudget } from '@archwoven/jobs';
import { HOSTED_PROMPT_PARTS } from '@archwoven/llm';
import { promptVersion } from '../../lib/evaluation-budget';

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
    // What an evaluation run is measuring; never shown when not evaluating.
    ...(file !== undefined ? { evaluation: { ledger: evaluationLedgerId(file), promptVersion: promptVersion(HOSTED_PROMPT_PARTS), requests: HOSTED_REQUESTS } } : {}),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
