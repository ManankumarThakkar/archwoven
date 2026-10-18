#!/usr/bin/env node
/** Explicit local evaluation ledger administration. Never imports credentials. */
import { createInterface } from 'node:readline/promises';
import { initializeEvaluationBudget, openEvaluationBudget, parseBudgetUsd, parseUsd } from '../../packages/jobs/src/evaluation-budget.ts';

const usage = 'Usage: pnpm eval:budget init <new-budget.db> <approved-usd> | status <budget.db> | unknown <budget.db> | resolve <budget.db> <attempt-id> <usd> --evidence "<where the actual charge was confirmed>"';
const [command, file, ...rest] = process.argv.slice(2);
const evidenceAt = rest.indexOf('--evidence');
const evidence = evidenceAt >= 0 ? rest[evidenceAt + 1] : undefined;
const positional = evidenceAt >= 0 ? rest.slice(0, evidenceAt).concat(rest.slice(evidenceAt + 2)) : rest;
const arity = { init: 1, status: 0, unknown: 0, resolve: 2 };
if (!file || !(command in arity) || positional.length !== arity[command] || (command === 'resolve') !== (evidence !== undefined)) throw new Error(usage);
if (command === 'init') initializeEvaluationBudget(file, parseBudgetUsd(positional[0]));
const budget = openEvaluationBudget(file);
try {
  if (command === 'resolve') {
    const [id, amount] = positional;
    const charged = parseUsd(amount, { zero: true });
    // Only the person who checked the provider's console resolves unknown usage.
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Resolving unknown usage needs an interactive terminal and the owner\'s confirmation.');
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    const typed = await prompt.question(`Settle attempt ${id} at $${amount}, based on: "${evidence}".\nType the first 8 characters of the attempt id to confirm: `);
    prompt.close();
    if (typed.trim() !== id.slice(0, 8)) throw new Error('Not confirmed; nothing was changed.');
    budget.resolveUnknown(id, charged, evidence);
  }
  if (command === 'unknown') {
    console.log(JSON.stringify(budget.unknownAttempts().map(({ reservedNanos, ...attempt }) => ({ ...attempt, heldUsd: reservedNanos / 1e9 })), null, 2));
  } else {
    const state = budget.snapshot();
    console.log(JSON.stringify({
      capUsd: state.capNanos / 1e9, settledUsd: state.settledNanos / 1e9,
      heldUsd: state.heldNanos / 1e9, availableUsd: state.availableNanos / 1e9,
      frozen: state.frozen, unknownAttempts: state.unknownAttempts, pendingAttempts: state.pendingAttempts,
    }, null, 2));
  }
} finally { budget.close(); }
