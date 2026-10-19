#!/usr/bin/env node
/**
 * Operator commands for the hosted spending ledger. Reads UPSTASH_REDIS_REST_URL,
 * UPSTASH_REDIS_REST_TOKEN and ARCHWOVEN_REDIS_PREFIX from the environment
 * (for example `node --env-file=<private file> scripts/spending-ledger.mjs status`)
 * and never prints them.
 *
 *   init --start YYYY-MM-DD --annual <usd> --month <usd> --day <usd> --visitor-day <usd> --network-day <usd>
 *   caps --annual <usd> --month <usd> --day <usd> --visitor-day <usd> --network-day <usd>   (change an existing ledger's caps)
 *   status | pause "<reason>" | resume | unknown
 *   resolve <attempt-id> <usd> --evidence "<what the provider console showed>"   (owner, interactive)
 *   renew --start YYYY-MM-DD   (after the current annual window has ended)
 */
import { createInterface } from 'node:readline/promises';
import { openSpendingLedger, redisRest } from '../packages/jobs/src/spending-ledger.ts';
import { STORAGE_USAGE_LUA, HOSTED_STORAGE_LIMITS } from '../packages/jobs/src/hosted-storage.ts';
import { parseUsd } from '../packages/jobs/src/evaluation-budget.ts';

const [command, ...rest] = process.argv.slice(2);
const flag = name => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const usage = 'Usage: spending-ledger.mjs init --start YYYY-MM-DD --annual <usd> --month <usd> --day <usd> --visitor-day <usd> --network-day <usd> | caps --annual <usd> --month <usd> --day <usd> --visitor-day <usd> --network-day <usd> | status | pause "<reason>" | resume | unknown | resolve <attempt-id> <usd> --evidence "<text>" | renew --start YYYY-MM-DD';
const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token, ARCHWOVEN_REDIS_PREFIX: prefix } = process.env;
if (!url || !token || !prefix) throw new Error('Set UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN and ARCHWOVEN_REDIS_PREFIX first.');
const ledger = openSpendingLedger({ url, token, prefix });
const usd = nanos => `$${(nanos / 1e9).toFixed(4)}`;

const annualWindow = () => {
  const start = flag('--start');
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new Error(usage);
  const from = new Date(`${start}T00:00:00Z`), to = new Date(from); to.setUTCFullYear(to.getUTCFullYear() + 1);
  if (Number.isNaN(from.getTime()) || from.toISOString().slice(0, 10) !== start) throw new Error('Invalid start date.');
  return { start, from, to };
};

const amount = name => { const value = flag(name); if (!value) throw new Error(usage); return parseUsd(value); };
const capsFromFlags = () => ({ annualNanos: amount('--annual'), monthNanos: amount('--month'), dayNanos: amount('--day'), visitorDayNanos: amount('--visitor-day'), networkDayNanos: amount('--network-day') });

if (command === 'init') {
  const { start, from, to } = annualWindow();
  const result = await ledger.initialize({ start: from.getTime(), end: to.getTime() }, capsFromFlags());
  console.log(result === 'initialized' ? `Initialized ${prefix} for ${start} to ${to.toISOString().slice(0, 10)}.` : `A ledger already exists under ${prefix}; nothing was changed. Use caps to change its caps.`);
} else if (command === 'caps') {
  const caps = capsFromFlags();
  const before = await ledger.status();
  if (!before) throw new Error(`No ledger exists under ${prefix}; use init.`);
  await ledger.setCaps(caps);
  const show = c => ({ annual: usd(c.annualNanos), month: usd(c.monthNanos), day: c.dayNanos === null ? 'none' : usd(c.dayNanos), visitorDay: usd(c.visitorDayNanos), networkDay: usd(c.networkDayNanos) });
  console.log(JSON.stringify({ prefix, before: show(before.caps), after: show(caps), note: 'New caps apply to holds made from now on; settled and held amounts are unchanged.' }, null, 2));
} else if (command === 'pause' || command === 'resume') {
  const result = await ledger.setPaused(command === 'pause', command === 'pause' ? (rest[0] ?? 'Paused by the operator.') : '');
  console.log(result === 'ok' ? `${command === 'pause' ? 'Paused' : 'Resumed'} paid AI requests under ${prefix}.` : 'No ledger exists under this prefix.');
} else if (command === 'renew') {
  const { start, to } = annualWindow();
  const result = await ledger.renew({ start: Date.parse(`${start}T00:00:00Z`), end: to.getTime() });
  console.log({ renewed: `Started a new annual window ${start} to ${to.toISOString().slice(0, 10)}.`, 'still-open': 'The current annual window has not ended; nothing was changed.', overlaps: 'The new window must start at or after the current one ends.', 'ledger-missing': 'No ledger exists under this prefix.' }[result]);
} else if (command === 'unknown') {
  console.log(JSON.stringify((await ledger.unknownAttempts()).map(a => ({ id: a.id, model: a.model, held: usd(a.reservedNanos), reservedAt: new Date(a.reservedAt).toISOString() })), null, 2));
} else if (command === 'resolve') {
  const evidence = flag('--evidence'), [id, amountText] = rest.filter((value, i) => value !== '--evidence' && rest[i - 1] !== '--evidence');
  if (!id || !amountText || !evidence) throw new Error(usage);
  const charged = parseUsd(amountText, { zero: true });
  // Only the person who checked the provider's console resolves unknown usage.
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Resolving unknown usage needs an interactive terminal and the owner's confirmation.");
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const typed = await prompt.question(`Settle attempt ${id} at $${amountText}, based on: "${evidence}".\nType the first 8 characters of the attempt id to confirm: `);
  prompt.close();
  if (typed.trim() !== id.slice(0, 8)) throw new Error('Not confirmed; nothing was changed.');
  const result = await ledger.resolveUnknown(id, charged, evidence);
  console.log({ resolved: 'Resolved.', 'not-unknown': 'That attempt is not waiting on unknown usage; nothing was changed.', 'over-hold': 'That amount is more than the attempt held; nothing was changed. Inspect the ledger.' }[result]);
} else if (command === 'status') {
  const status = await ledger.status();
  const [payloadBytes, payloadRecords] = await redisRest(url, token)(['EVAL', STORAGE_USAGE_LUA, 0, prefix]);
  if (!status) console.log(`No ledger exists under ${prefix}.`);
  else console.log(JSON.stringify({
    prefix, window: [new Date(status.start).toISOString().slice(0, 10), new Date(status.end).toISOString().slice(0, 10)],
    paused: status.paused, pausedReason: status.pausedReason,
    caps: { annual: usd(status.caps.annualNanos), month: usd(status.caps.monthNanos), day: status.caps.dayNanos === null ? 'none' : usd(status.caps.dayNanos), visitorDay: usd(status.caps.visitorDayNanos), networkDay: usd(status.caps.networkDayNanos) },
    year: { settled: usd(status.year.settledNanos), held: usd(status.year.heldNanos) },
    month: { id: status.month.id, settled: usd(status.month.settledNanos), held: usd(status.month.heldNanos) },
    day: { id: status.day.id, settled: usd(status.day.settledNanos), held: usd(status.day.heldNanos) },
    unknownAttempts: status.unknownAttempts,
    temporaryStorage: { payloadBytes, payloadRecords, limits: HOSTED_STORAGE_LIMITS, note: 'Includes outstanding job reservations. Excludes Redis overhead, job metadata, spending records and untouched pre-upgrade copies.' },
  }, null, 2));
} else throw new Error(usage);
