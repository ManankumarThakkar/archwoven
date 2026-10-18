import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, openSync, realpathSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// This tool is for small, explicitly approved evaluations, not a billing system.
const MAX_NANOS = 1_000_000_000_000; // $1,000; all arithmetic stays exact in JS and SQLite.
const validAmount = (value: number, zero = false) => {
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1) || value > MAX_NANOS) throw new Error('Invalid evaluation budget amount.');
};
export function parseUsd(value: string, { zero = false } = {}): number {
  if (!/^\d+(?:\.\d{1,9})?$/.test(value)) throw new Error('Amounts must be decimal USD with at most nine decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const nanos = BigInt(whole!) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0'));
  if (nanos < (zero ? 0n : 1n) || nanos > BigInt(MAX_NANOS)) throw new Error(`Amounts must be ${zero ? 'at least zero' : 'greater than zero'} and at most $1,000.`);
  return Number(nanos);
}
export const parseBudgetUsd = (value: string) => parseUsd(value);

/** Explicit initialization only. An existing or interrupted ledger is never reset. */
export function initializeEvaluationBudget(file: string, capNanos: number): void {
  validAmount(capNanos);
  closeSync(openSync(file, 'wx', 0o600));
  const db = new DatabaseSync(file);
  try {
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE budget (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, cap INTEGER NOT NULL, frozen INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE attempts (id TEXT PRIMARY KEY, model TEXT NOT NULL, basis TEXT NOT NULL,
        reserved INTEGER NOT NULL, charged INTEGER, state TEXT NOT NULL CHECK(state IN ('held','unknown','settled')));
    `);
    db.prepare('INSERT INTO budget(id,version,cap) VALUES (1,1,?)').run(capNanos);
  } finally { db.close(); }
}

/** Path-free name for a ledger file, so an evaluation runner can confirm that
 * it reads the same ledger the server reserves against. */
export function evaluationLedgerId(file: string): string {
  if (!existsSync(file)) throw new Error('Evaluation budget is not initialized. Initialize a new ledger explicitly before starting the server.');
  return `l-${createHash('sha256').update(realpathSync(file)).digest('hex').slice(0, 12)}`;
}

export function openEvaluationBudget(file: string) {
  if (!existsSync(file)) throw new Error('Evaluation budget is not initialized. Initialize a new ledger explicitly before starting the server.');
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
    const row = db.prepare('SELECT version,cap FROM budget WHERE id=1').get();
    if (!row || row.version !== 1) throw new Error('Unsupported evaluation budget ledger.');
    validAmount(Number(row.cap));
  } catch (error) { db.close(); throw error; }
  const snapshot = () => {
    const row = db.prepare(`SELECT cap, frozen,
      (SELECT COALESCE(SUM(charged),0) FROM attempts WHERE state='settled') AS settled,
      (SELECT COALESCE(SUM(reserved),0) FROM attempts WHERE state!='settled') AS held,
      (SELECT COUNT(*) FROM attempts WHERE state='unknown') AS unknown,
      (SELECT COUNT(*) FROM attempts WHERE state='held') AS pending
      FROM budget WHERE id=1`).get()!;
    const capNanos = Number(row.cap), settledNanos = Number(row.settled), heldNanos = Number(row.held);
    return { capNanos, settledNanos, heldNanos, availableNanos: Math.max(0, capNanos - settledNanos - heldNanos), frozen: row.frozen === 1, unknownAttempts: Number(row.unknown), pendingAttempts: Number(row.pending) };
  };
  return {
    snapshot,
    freeze() { db.exec('UPDATE budget SET frozen=1 WHERE id=1'); },
    assertAvailable(amount: number) {
      validAmount(amount);
      const state = snapshot();
      if (state.frozen || state.availableNanos < amount) throw new Error('Evaluation budget cannot cover another attempt. Existing diagrams remain available. Inspect the budget ledger before continuing.');
    },
    reserve(amount: number, identity: { model: string; basis: string }): string {
      validAmount(amount);
      const id = randomUUID();
      // One write statement serializes admission across processes/connections.
      const result = db.prepare(`INSERT INTO attempts(id,model,basis,reserved,state)
        SELECT ?,?,?,?,'held' FROM budget WHERE id=1 AND frozen=0 AND
        cap >= ? + (SELECT COALESCE(SUM(CASE WHEN state='settled' THEN charged ELSE reserved END),0) FROM attempts)`)
        .run(id, identity.model, identity.basis, amount, amount);
      if (!result.changes) throw new Error('Evaluation budget cannot cover another attempt. Existing diagrams remain available. Inspect the budget ledger before continuing.');
      return id;
    },
    settle(id: string, charged: number | null): boolean {
      if (charged !== null) validAmount(charged, true);
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = db.prepare('SELECT state,reserved FROM attempts WHERE id=?').get(id);
        if (!row) throw new Error('Unknown evaluation reservation.');
        if (row.state !== 'held') { db.exec('COMMIT'); return false; }
        if (charged !== null && charged > Number(row.reserved)) db.exec('UPDATE budget SET frozen=1 WHERE id=1');
        db.prepare('UPDATE attempts SET charged=?,state=? WHERE id=?').run(charged, charged === null ? 'unknown' : 'settled', id);
        db.exec('COMMIT');
        return true;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    /** Attempts whose usage was never reported; each keeps its whole hold. */
    unknownAttempts() {
      return (db.prepare("SELECT id,model,basis,reserved FROM attempts WHERE state='unknown' ORDER BY rowid").all() as { id: string; model: string; basis: string; reserved: number }[])
        .map(row => ({ id: row.id, model: row.model, basis: row.basis, reservedNanos: Number(row.reserved) }));
    },
    /** Settle one attempt whose usage was never reported, from evidence outside
     * the ledger such as the provider's usage console. Explicit and audited;
     * attempts still in flight cannot be resolved. */
    resolveUnknown(id: string, charged: number, evidence: string) {
      validAmount(charged, true);
      const note = evidence.trim();
      if (!note || note.length > 500) throw new Error('Resolving unknown usage needs evidence of at most 500 characters.');
      db.exec('BEGIN IMMEDIATE');
      try {
        // A frozen ledger holds an attempt whose usage exceeded the reviewed limits; it may have cost more than any hold.
        if (db.prepare('SELECT frozen FROM budget WHERE id=1').get()?.frozen === 1) throw new Error('The ledger is frozen for inspection; unknown usage cannot be resolved.');
        const row = db.prepare('SELECT state,reserved FROM attempts WHERE id=?').get(id);
        if (row?.state !== 'unknown') throw new Error('Evaluation reservations can resolve only unknown usage.');
        if (charged > Number(row.reserved)) throw new Error('A resolved charge cannot be more than its hold. Inspect the ledger.');
        db.exec('CREATE TABLE IF NOT EXISTS resolutions (attempt_id TEXT PRIMARY KEY, charged INTEGER NOT NULL, evidence TEXT NOT NULL, resolved_at TEXT NOT NULL)');
        db.prepare("INSERT INTO resolutions(attempt_id,charged,evidence,resolved_at) VALUES (?,?,?,datetime('now'))").run(id, charged, note);
        db.prepare("UPDATE attempts SET charged=?,state='settled' WHERE id=?").run(charged, id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close() { db.close(); },
  };
}
export type EvaluationBudget = ReturnType<typeof openEvaluationBudget>;
