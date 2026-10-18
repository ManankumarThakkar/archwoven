#!/usr/bin/env node
/** Explicit local evaluation ledger administration. Never imports credentials. */
import { initializeEvaluationBudget, openEvaluationBudget, parseBudgetUsd } from '../../packages/jobs/src/evaluation-budget.ts';

const [command, file, amount, ...extra] = process.argv.slice(2);
if (!file || extra.length || !['init', 'status'].includes(command) || (command === 'init' ? !amount : amount !== undefined)) {
  throw new Error('Usage: pnpm eval:budget init <new-budget.db> <approved-usd> | pnpm eval:budget status <budget.db>');
}
if (command === 'init') initializeEvaluationBudget(file, parseBudgetUsd(amount));
const budget = openEvaluationBudget(file);
try {
  const state = budget.snapshot();
  console.log(JSON.stringify({
    capUsd: state.capNanos / 1e9, settledUsd: state.settledNanos / 1e9,
    heldUsd: state.heldNanos / 1e9, availableUsd: state.availableNanos / 1e9,
    frozen: state.frozen, unknownAttempts: state.unknownAttempts, pendingAttempts: state.pendingAttempts,
  }, null, 2));
} finally { budget.close(); }
