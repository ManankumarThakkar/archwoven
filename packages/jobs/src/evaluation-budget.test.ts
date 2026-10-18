import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Worker } from 'node:worker_threads';
import { initializeEvaluationBudget, openEvaluationBudget, parseBudgetUsd } from './evaluation-budget';

const directories: string[] = [];
const stores: ReturnType<typeof openEvaluationBudget>[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function budget(cap = 1000) {
  const dir = mkdtempSync(join(tmpdir(), 'aw-budget-')); directories.push(dir);
  const file = join(dir, 'budget.db');
  initializeEvaluationBudget(file, cap);
  const store = openEvaluationBudget(file); stores.push(store);
  return { file, store };
}
const identity = { model: 'reviewed-model', basis: 'reviewed-pricing' };

describe('evaluation spending reservations', () => {
  it('admits exactly one simultaneous worker against the final funds', async () => {
    const { file, store } = budget(1000);
    const run = () => new Promise<boolean>((resolve, reject) => {
      const worker = new Worker(`const { parentPort, workerData } = require('node:worker_threads');
        import(workerData.module).then(({openEvaluationBudget}) => {
          const budget = openEvaluationBudget(workerData.file);
          try { budget.reserve(600, {model:'worker',basis:'reviewed'}); parentPort.postMessage(true); }
          catch (error) { if (!/budget cannot cover/.test(error.message)) throw error; parentPort.postMessage(false); }
          finally { budget.close(); }
        }).catch(error => { throw error; });`, { eval: true, workerData: { file, module: new URL('./evaluation-budget.ts', import.meta.url).href } });
      let result = false;
      worker.once('message', value => { result = value; }); worker.once('error', reject);
      worker.once('exit', code => code ? reject(new Error(`worker exited ${code}`)) : resolve(result));
    });
    expect((await Promise.all(Array.from({ length: 6 }, run))).filter(Boolean)).toHaveLength(1);
    expect(store.snapshot().heldNanos).toBe(600);
  });
  it('retains a reservation when its worker is terminated without closing SQLite', async () => {
    const { file, store } = budget(1000);
    const worker = new Worker(`const { parentPort, workerData } = require('node:worker_threads');
      import(workerData.module).then(({openEvaluationBudget}) => {
        const budget = openEvaluationBudget(workerData.file);
        budget.reserve(1000, {model:'interrupted-worker',basis:'reviewed'});
        parentPort.postMessage('reserved'); setInterval(() => {}, 1000);
      }).catch(error => { throw error; });`, { eval: true, workerData: { file, module: new URL('./evaluation-budget.ts', import.meta.url).href } });
    try { await new Promise<void>((resolve, reject) => { worker.once('message', () => resolve()); worker.once('error', reject); }); }
    finally { await worker.terminate(); }
    expect(store.snapshot()).toMatchObject({ heldNanos: 1000, pendingAttempts: 1, availableNanos: 0 });
    expect(() => store.reserve(1, identity)).toThrow(/budget/i);
  });
  it('reserves against settled costs and outstanding holds across connections and restarts', () => {
    const { file, store } = budget();
    const second = openEvaluationBudget(file); stores.push(second);
    const first = store.reserve(600, identity);
    expect(() => second.reserve(401, identity)).toThrow(/budget/i);
    expect(second.reserve(400, identity)).toBeTypeOf('string');
    store.settle(first, 100);
    expect(second.snapshot()).toMatchObject({ capNanos: 1000, settledNanos: 100, heldNanos: 400, availableNanos: 500 });
    const reopened = openEvaluationBudget(file); stores.push(reopened);
    reopened.reserve(500, identity);
    expect(() => store.reserve(1, identity)).toThrow(/budget/i);
  });
  it('retains unknown and crashed attempts indefinitely; repeated settlement never refunds twice', () => {
    const { file, store } = budget();
    const id = store.reserve(700, identity);
    expect(store.settle(id, null)).toBe(true);
    expect(store.settle(id, 0)).toBe(false);
    store.reserve(300, identity); // process dies without settlement
    const reopened = openEvaluationBudget(file); stores.push(reopened);
    expect(reopened.snapshot()).toMatchObject({ heldNanos: 1000, unknownAttempts: 1, pendingAttempts: 1, availableNanos: 0 });
    expect(() => reopened.reserve(1, identity)).toThrow(/budget/i);
  });
  it('settles zero and exact amounts once, and rejects unknown tickets', () => {
    const { store } = budget();
    const id = store.reserve(1000, identity);
    expect(store.settle(id, 0)).toBe(true);
    expect(store.settle(id, 1000)).toBe(false);
    expect(store.snapshot().availableNanos).toBe(1000);
    const exact = store.reserve(1000, identity); store.settle(exact, 1000);
    expect(store.snapshot()).toMatchObject({ settledNanos: 1000, heldNanos: 0, availableNanos: 0 });
    expect(() => store.settle('missing', 0)).toThrow(/unknown/i);
  });
  it('records an unexpected overrun and freezes future admission rather than truncating the charge', () => {
    const { file, store } = budget();
    const id = store.reserve(500, identity);
    store.settle(id, 1200);
    expect(store.snapshot()).toMatchObject({ settledNanos: 1200, frozen: true, availableNanos: 0 });
    const reopened = openEvaluationBudget(file); stores.push(reopened);
    expect(() => reopened.reserve(1, identity)).toThrow(/budget/i);
  });
  it('never initializes implicitly or resets an existing cap', () => {
    const { file } = budget();
    expect(() => initializeEvaluationBudget(file, 9000)).toThrow();
    expect(() => openEvaluationBudget(file + '-missing')).toThrow(/initializ/i);
    const reopened = openEvaluationBudget(file); stores.push(reopened);
    expect(reopened.snapshot().capNanos).toBe(1000);
  });
  it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid reservation/cap %s before changing the ledger', amount => {
    const { file, store } = budget();
    expect(() => store.reserve(amount, identity)).toThrow();
    expect(() => initializeEvaluationBudget(file + '-invalid', amount)).toThrow();
    expect(store.snapshot().heldNanos).toBe(0);
  });
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('retains the hold after invalid settlement %s', amount => {
    const { store } = budget(); const id = store.reserve(1000, identity);
    expect(() => store.settle(id, amount)).toThrow();
    expect(store.snapshot().heldNanos).toBe(1000);
  });
  it('uses decimal parsing with no floating point rounding or implicit budget', () => {
    expect(parseBudgetUsd('6')).toBe(6_000_000_000);
    expect(parseBudgetUsd('0.000000001')).toBe(1);
    for (const value of ['', '0', '-1', '1e2', 'NaN', '0.0000000001', '9007199254740991']) expect(() => parseBudgetUsd(value)).toThrow();
  });
});
