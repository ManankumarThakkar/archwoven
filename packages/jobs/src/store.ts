import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SystemModel } from '@archwoven/model';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type Tier = 'anonymous' | 'github';

export interface Job {
  id: string;
  modelId: string;
  kind: 'generate' | 'refine';
  idempotencyKey?: string;
  status: JobStatus;
  stage?: string;
  error?: string;
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
  costUsd: number;
  retries: number;
  outcome: 'ok' | 'repaired' | 'failed';
}

/**
 * SQLite-backed durable state: append-only revisions, job records with idempotency,
 * call accounting (powers §11 eval + stop-loss) and the weighted-credit ledger (§15).
 */
export function openStore(path = 'data/archwoven.db') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS revisions (
      model_id TEXT NOT NULL, revision INTEGER NOT NULL, parent_id INTEGER,
      json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (model_id, revision)
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, model_id TEXT NOT NULL, kind TEXT NOT NULL,
      idempotency_key TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'queued',
      stage TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
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

  return {
    saveRevision(modelId: string, model: SystemModel): void {
      db.prepare('INSERT INTO revisions (model_id, revision, parent_id, json) VALUES (?, ?, ?, ?)').run(
        modelId, model.revision, model.parentId ?? null, JSON.stringify(model),
      );
    },
    getRevision(modelId: string, revision?: number): SystemModel | null {
      const row = (revision === undefined
        ? db.prepare('SELECT json FROM revisions WHERE model_id = ? ORDER BY revision DESC LIMIT 1').get(modelId)
        : db.prepare('SELECT json FROM revisions WHERE model_id = ? AND revision = ?').get(modelId, revision)) as { json: string } | undefined;
      return row ? (JSON.parse(row.json) as SystemModel) : null;
    },

    createJob(job: { id: string; modelId: string; kind: 'generate' | 'refine'; idempotencyKey?: string }): void {
      db.prepare('INSERT INTO jobs (id, model_id, kind, idempotency_key) VALUES (?, ?, ?, ?)').run(
        job.id, job.modelId, job.kind, job.idempotencyKey ?? null,
      );
    },
    findJobByIdempotencyKey(key: string): Job | null {
      const r = db.prepare('SELECT * FROM jobs WHERE idempotency_key = ?').get(key) as SqlRow | undefined;
      return r ? rowToJob(r) : null;
    },
    updateJob(id: string, patch: { status?: JobStatus; stage?: string; error?: string }): void {
      const sets: string[] = [];
      const args: (string | number)[] = [];
      if (patch.status) { sets.push('status = ?'); args.push(patch.status); }
      if (patch.stage) { sets.push('stage = ?'); args.push(patch.stage); }
      if (patch.error !== undefined) { sets.push('error = ?'); args.push(patch.error); }
      if (!sets.length) return;
      db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    },
    getJob(id: string): Job | null {
      const r = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as SqlRow | undefined;
      return r ? rowToJob(r) : null;
    },

    logCall(rec: CallRec): void {
      db.prepare(
        'INSERT INTO call_log (session_id, tier, view, input_tokens, cache_write_tokens, cache_read_tokens, output_tokens, cost_usd, retries, outcome) VALUES (?,?,?,?,?,?,?,?,?,?)',
      ).run(rec.sessionId, rec.tier, rec.view, rec.inputTokens, rec.cacheWriteTokens, rec.cacheReadTokens, rec.outputTokens, rec.costUsd, rec.retries, rec.outcome);
    },
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

    bumpBurst(key: string, windowSec: number): number {
      const now = Date.now() / 1000;
      db.prepare('DELETE FROM burst WHERE key = ? AND ts < ?').run(key, now - windowSec);
      db.prepare('INSERT INTO burst (key, ts) VALUES (?, ?)').run(key, now);
      const r = db.prepare('SELECT COUNT(*) AS n FROM burst WHERE key = ? AND ts >= ?').get(key, now - windowSec) as { n: number };
      return r.n;
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
  createdAt: String(r.created_at),
});
