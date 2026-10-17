import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SystemModelSchema, type SystemModel, type ViewType, type TaskReport } from '@archwoven/model';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'clarifying';
export type Tier = 'anonymous' | 'github';

export interface Clarification {
  prompt: string;
  view: ViewType;
  questions: string[];
}

export interface Job {
  id: string;
  modelId: string;
  kind: 'generate' | 'refine' | 'repo';
  idempotencyKey?: string;
  status: JobStatus;
  stage?: string;
  error?: string;
  gaps?: string[];
  clarification?: Clarification;
  sessionId?: string;
  createdAt: string;
}

export interface CallRec {
  sessionId: string;
  tier: Tier;
  view: string;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costUsd: number | null;
  task?: TaskReport;
  retries: number;
  outcome: 'ok' | 'repaired' | 'failed';
}

/**
 * SQLite-backed durable state: append-only revisions, job records with idempotency,
 * call accounting (powers §11 eval + stop-loss) and the weighted-credit ledger (§15).
 */
/** SQLite `datetime()` text form, so stored timestamps compare correctly with SQL defaults. */
const sqlTime = (d: Date): string => d.toISOString().slice(0, 19).replace('T', ' ');

/** Retention (SPEC §1): diagram content lives 30 days after its last change; content-free metering 90 days. */
export const CONTENT_RETENTION_DAYS = 30;
export const METERING_RETENTION_DAYS = 90;

export function openStore(path = 'data/archwoven.db', opts: { now?: () => Date } = {}) {
  const now = opts.now ?? (() => new Date());
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // busy_timeout first so concurrent opens wait instead of throwing SQLITE_LOCKED;
  // WAL is best-effort — if another connection holds the lock during the mode
  // switch, rollback mode still works correctly, just with less concurrency.
  db.exec('PRAGMA busy_timeout = 5000;');
  try { db.exec('PRAGMA journal_mode = WAL;'); } catch { /* keep rollback mode */ }
  db.exec(`
    CREATE TABLE IF NOT EXISTS revisions (
      model_id TEXT NOT NULL, revision INTEGER NOT NULL, parent_id INTEGER,
      json TEXT NOT NULL, session_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (model_id, revision)
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, model_id TEXT NOT NULL, kind TEXT NOT NULL,
      idempotency_key TEXT, status TEXT NOT NULL DEFAULT 'queued',
      stage TEXT, error TEXT, gaps TEXT, session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (session_id, idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS call_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, tier TEXT NOT NULL,
      view TEXT NOT NULL, input_tokens INTEGER, cache_write_tokens INTEGER,
      cache_read_tokens INTEGER, output_tokens INTEGER, cost_usd REAL NOT NULL,
      retries INTEGER, outcome TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS credits (
      session_id TEXT NOT NULL, day TEXT NOT NULL, used REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (session_id, day)
    );
    CREATE TABLE IF NOT EXISTS burst (
      id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, ts REAL NOT NULL
    );
  `);

  // Old schema (pre-session-scoping) cannot express (session_id, idempotency_key)
  // uniqueness; these are dev-scratch databases, so recreate rather than migrate.
  const hasSession = (table: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === 'session_id');
  if (!hasSession('jobs')) db.exec('DROP TABLE jobs;');
  if (!hasSession('revisions')) db.exec('DROP TABLE revisions;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS revisions (
      model_id TEXT NOT NULL, revision INTEGER NOT NULL, parent_id INTEGER,
      json TEXT NOT NULL, session_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (model_id, revision)
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, model_id TEXT NOT NULL, kind TEXT NOT NULL,
      idempotency_key TEXT, status TEXT NOT NULL DEFAULT 'queued',
      stage TEXT, error TEXT, gaps TEXT, session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (session_id, idempotency_key)
    );
  `);
  // dev-scratch DBs created before the gaps column: add it in place
  try { db.exec('ALTER TABLE jobs ADD COLUMN gaps TEXT'); } catch { /* column exists */ }
  try { db.exec('ALTER TABLE jobs ADD COLUMN clarification TEXT'); } catch { /* column exists */ }

  // Additive migration: keep historical costs and saved diagrams untouched.
  const hasTask = () => (db.prepare('PRAGMA table_info(call_log)').all() as { name: string }[]).some(column => column.name === 'task_json');
  if (!hasTask()) {
    try { db.exec('ALTER TABLE call_log ADD COLUMN task_json TEXT'); }
    catch (error) { if (!hasTask()) throw error; }
  }

  // NOTE: the orphan sweep does NOT live here. openStore is re-evaluated per
  // route bundle in dev (Next compiles each route separately, separate realms —
  // globalThis guards do not cross them), which would sweep live jobs.
  // Boot-time sweep lives in apps/web/instrumentation.ts register() via sweepOrphans().

  return {
    /** Orphan sweep: a job whose process died mid-flight is settled honestly and
     *  its reserved credits returned. Called once at boot (instrumentation register),
     *  never from openStore — dev re-evaluates openStore per route bundle. */
    sweepOrphans(): number {
      const orphans = db.prepare("SELECT id, session_id, kind FROM jobs WHERE status IN ('running','queued')").all() as { id: string; session_id: string | null; kind: string }[];
      db.prepare("UPDATE jobs SET status = 'failed', error = 'server restarted before completion' WHERE status IN ('running','queued')").run();
      const refund = db.prepare('UPDATE credits SET used = MAX(0, used - ?) WHERE session_id = ? AND day = ?');
      const today = new Date().toISOString().slice(0, 10);
      for (const o of orphans) {
        if (!o.session_id) continue;
        const w = o.kind === 'refine' ? 0.25 : o.kind === 'repo' ? 2 : 1;
        refund.run(w, o.session_id, today);
      }
      return orphans.length;
    },
    saveRevision(modelId: string, model: SystemModel, sessionId?: string): void {
      db.prepare('INSERT INTO revisions (model_id, revision, parent_id, json, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        modelId, model.revision, model.parentId ?? null, JSON.stringify(model), sessionId ?? null, sqlTime(now()),
      );
    },
    getRevisionOwner(modelId: string): string | null {
      const r = db.prepare('SELECT session_id FROM revisions WHERE model_id = ? ORDER BY revision ASC LIMIT 1').get(modelId) as { session_id: string | null } | undefined;
      return r?.session_id ?? null;
    },
    getRevision(modelId: string, revision?: number): SystemModel | null {
      const row = (revision === undefined
        ? db.prepare('SELECT json FROM revisions WHERE model_id = ? ORDER BY revision DESC LIMIT 1').get(modelId)
        : db.prepare('SELECT json FROM revisions WHERE model_id = ? AND revision = ?').get(modelId, revision)) as { json: string } | undefined;
      if (!row) return null;
      const raw = JSON.parse(row.json) as SystemModel;
      // read-boundary normalization: pre-M4 revisions lack the optional-with-default
      // fields (boundaries/guidedViews) — fill schema defaults so consumers (Canvas)
      // never see undefined where the schema promises an array. Corrupt JSON passes
      // through as before; validation is enforced at the write/generate boundary.
      const parsed = SystemModelSchema.safeParse(raw);
      return parsed.success ? parsed.data : raw;
    },

    createJob(job: { id: string; modelId: string; kind: 'generate' | 'refine' | 'repo'; idempotencyKey?: string; sessionId: string }): void {
      // A failed/cancelled attempt stays in history but must not permanently
      // occupy the input key. Release and replace atomically so concurrent
      // retries still converge on one active attempt within the same session.
      db.exec('BEGIN IMMEDIATE');
      try {
        if (job.idempotencyKey) db.prepare("UPDATE jobs SET idempotency_key = NULL WHERE session_id = ? AND idempotency_key = ? AND status IN ('failed', 'cancelled')").run(job.sessionId, job.idempotencyKey);
        db.prepare('INSERT INTO jobs (id, model_id, kind, idempotency_key, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
          job.id, job.modelId, job.kind, job.idempotencyKey ?? null, job.sessionId, sqlTime(now()),
        );
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    findJobByIdempotencyKey(key: string, sessionId: string): Job | null {
      const r = db.prepare("SELECT * FROM jobs WHERE idempotency_key = ? AND session_id = ? AND status NOT IN ('failed', 'cancelled')").get(key, sessionId) as SqlRow | undefined;
      return r ? rowToJob(r) : null;
    },
    updateJob(id: string, patch: { status?: JobStatus; stage?: string; error?: string; gaps?: string[]; clarification?: Clarification }): void {
      const sets: string[] = [];
      const args: (string | number)[] = [];
      if (patch.status) { sets.push('status = ?'); args.push(patch.status); }
      if (patch.stage) { sets.push('stage = ?'); args.push(patch.stage); }
      if (patch.error !== undefined) { sets.push('error = ?'); args.push(patch.error); }
      if (patch.gaps !== undefined) { sets.push('gaps = ?'); args.push(JSON.stringify(patch.gaps)); }
      if (patch.clarification !== undefined) { sets.push('clarification = ?'); args.push(JSON.stringify(patch.clarification)); }
      if (!sets.length) return;
      db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    },
    getJob(id: string): Job | null {
      const r = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as SqlRow | undefined;
      return r ? rowToJob(r) : null;
    },

    logCall(rec: CallRec): void {
      db.prepare(
        'INSERT INTO call_log (session_id, tier, view, input_tokens, cache_write_tokens, cache_read_tokens, output_tokens, cost_usd, retries, outcome, task_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      ).run(rec.sessionId, rec.tier, rec.view, rec.inputTokens, rec.cacheWriteTokens, rec.cacheReadTokens, rec.outputTokens, rec.costUsd ?? 0, rec.retries, rec.outcome, rec.task ? JSON.stringify(rec.task) : null, sqlTime(now()));
    },
    listCalls(sessionId: string): CallRec[] {
      const rows = db.prepare('SELECT * FROM call_log WHERE session_id = ? ORDER BY id').all(sessionId) as Record<string, unknown>[];
      return rows.map((r) => ({
        sessionId: String(r.session_id), tier: r.tier as Tier, view: String(r.view),
        inputTokens: Number(r.input_tokens), cacheWriteTokens: Number(r.cache_write_tokens),
        cacheReadTokens: Number(r.cache_read_tokens), outputTokens: Number(r.output_tokens),
        costUsd: r.task_json ? (JSON.parse(String(r.task_json)) as TaskReport).estimatedCostUsd : Number(r.cost_usd), ...(r.task_json ? { task: JSON.parse(String(r.task_json)) as TaskReport } : {}), retries: Number(r.retries), outcome: r.outcome as CallRec['outcome'],
      }));
    },
    lastTask(sessionId: string): TaskReport | null {
      const row = db.prepare('SELECT task_json FROM call_log WHERE session_id = ? AND task_json IS NOT NULL ORDER BY id DESC LIMIT 1').get(sessionId) as { task_json: string } | undefined;
      return row ? JSON.parse(row.task_json) as TaskReport : null;
    },
    /** Known reported estimates plus retained legacy estimates; missing provider
     * usage cannot be reconstructed here and is disclosed as incomplete. */
    todayCost(): number {
      const r = db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM call_log WHERE date(created_at) = date('now')").get() as { c: number };
      return r.c;
    },

    creditsUsed(sessionId: string, day: string): number {
      const r = db.prepare('SELECT used FROM credits WHERE session_id = ? AND day = ?').get(sessionId, day) as { used: number } | undefined;
      return r?.used ?? 0;
    },
    addCreditsUsed(sessionId: string, day: string, amount: number): number {
      const r = db.prepare(
        'INSERT INTO credits (session_id, day, used) VALUES (?, ?, ?) ON CONFLICT(session_id, day) DO UPDATE SET used = used + excluded.used RETURNING used',
      ).get(sessionId, day, amount) as { used: number };
      return r.used;
    },
    /**
     * Atomic reserve: spend `weight` against the day's pool in a single statement.
     * Returns the new used total, or null if the pool would be crossed. The check
     * and the spend are one statement — no read-then-write window to race through.
     */
    reserveCredits(sessionId: string, day: string, weight: number, pool: number): number | null {
      const r = db.prepare(
        'INSERT INTO credits (session_id, day, used) VALUES (?, ?, ?) ON CONFLICT(session_id, day) DO UPDATE SET used = used + excluded.used WHERE used + excluded.used <= ? RETURNING used',
      ).get(sessionId, day, weight, pool) as { used: number } | undefined;
      return r?.used ?? null;
    },
    refundCredits(sessionId: string, day: string, weight: number): number {
      const r = db.prepare(
        'UPDATE credits SET used = MAX(0, used - ?) WHERE session_id = ? AND day = ? RETURNING used',
      ).get(weight, sessionId, day) as { used: number } | undefined;
      return r?.used ?? 0;
    },

    bumpBurst(key: string, windowSec: number): number {
      const now = Date.now() / 1000;
      db.prepare('DELETE FROM burst WHERE key = ? AND ts < ?').run(key, now - windowSec);
      db.prepare('INSERT INTO burst (key, ts) VALUES (?, ?)').run(key, now);
      const r = db.prepare('SELECT COUNT(*) AS n FROM burst WHERE key = ? AND ts >= ?').get(key, now - windowSec) as { n: number };
      return r.n;
    },

    /** Once a clarified diagram is saved, the original description and questions are no longer needed. */
    scrubClarification(jobId: string): void {
      db.prepare('UPDATE jobs SET clarification = NULL WHERE id = ?').run(jobId);
    },

    /** Owner-requested deletion: every revision of the diagram and every job that produced or changed it. */
    deleteModel(modelId: string): { revisions: number; jobs: number } {
      db.exec('BEGIN IMMEDIATE');
      try {
        const revisions = Number(db.prepare('DELETE FROM revisions WHERE model_id = ?').run(modelId).changes);
        const jobs = Number(db.prepare('DELETE FROM jobs WHERE model_id = ?').run(modelId).changes);
        db.exec('COMMIT');
        return { revisions, jobs };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    /** Nightly retention sweep. Diagrams expire 30 days after their last change (history included);
     *  finished jobs — which can hold prompts, gaps and errors — after 30 days; content-free metering
     *  after 90 days; burst counters after a day. Running and queued jobs are never touched. */
    sweepExpired(): { models: number; jobs: number; calls: number; credits: number; burst: number } {
      const at = now().getTime();
      const content = sqlTime(new Date(at - CONTENT_RETENTION_DAYS * 86_400_000));
      const metering = new Date(at - METERING_RETENTION_DAYS * 86_400_000);
      db.exec('BEGIN IMMEDIATE');
      try {
        const expired = (db.prepare('SELECT model_id FROM revisions GROUP BY model_id HAVING MAX(created_at) < ?').all(content) as { model_id: string }[]).map(r => r.model_id);
        let jobs = 0;
        for (const id of expired) {
          db.prepare('DELETE FROM revisions WHERE model_id = ?').run(id);
          jobs += Number(db.prepare("DELETE FROM jobs WHERE model_id = ? AND status NOT IN ('running', 'queued')").run(id).changes);
        }
        jobs += Number(db.prepare("DELETE FROM jobs WHERE created_at < ? AND status NOT IN ('running', 'queued')").run(content).changes);
        const calls = Number(db.prepare('DELETE FROM call_log WHERE created_at < ?').run(sqlTime(metering)).changes);
        const credits = Number(db.prepare('DELETE FROM credits WHERE day < ?').run(metering.toISOString().slice(0, 10)).changes);
        const burst = Number(db.prepare('DELETE FROM burst WHERE ts < ?').run(at / 1000 - 86_400).changes);
        db.exec('COMMIT');
        return { models: expired.length, jobs, calls, credits, burst };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    close(): void {
      db.close();
    },
  };
}

export type Store = ReturnType<typeof openStore>;

type SqlRow = Record<string, string | number | null>;
const rowToJob = (r: SqlRow): Job => ({
  id: String(r.id),
  modelId: String(r.model_id),
  kind: String(r.kind) as Job['kind'],
  idempotencyKey: r.idempotency_key == null ? undefined : String(r.idempotency_key),
  status: String(r.status) as JobStatus,
  stage: r.stage == null ? undefined : String(r.stage),
  error: r.error == null ? undefined : String(r.error),
  gaps: r.gaps == null ? undefined : (JSON.parse(String(r.gaps)) as string[]),
  clarification: r.clarification == null ? undefined : JSON.parse(String(r.clarification)) as Clarification,
  sessionId: r.session_id == null ? undefined : String(r.session_id),
  createdAt: String(r.created_at),
});
