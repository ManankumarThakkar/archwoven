import { randomUUID } from 'node:crypto';
import { openStore, type Store, type Tier } from '@archwoven/jobs';
import { generateModel, generateRefinement, assembleRepoModel, type GenerateOutcome, type RefineOutcome } from '@archwoven/llm';
import { ingestRepo, type IngestResult } from '@archwoven/ingest';
import { extractSpringBoot, extractFastApi, type Fragment } from '@archwoven/extract';
import type { SystemModel, ViewType } from '@archwoven/model';

/**
 * Server singletons + injectable seams. Tests replace `serverDeps.store`
 * (":memory:") and `serverDeps.generateModel` / `serverDeps.generateRefinement`
 * / `serverDeps.ingestRepo` / `serverDeps.assembleRepoModel` (canned outcomes)
 * — production wiring lives here and nowhere else.
 */
export const serverDeps: {
  store: Store;
  generateModel: (prompt: string, view: ViewType) => Promise<GenerateOutcome>;
  generateRefinement: (instruction: string, model: SystemModel, view: ViewType) => Promise<RefineOutcome>;
  ingestRepo: (parsed: { owner: string; repo: string; ref?: string; subdir?: string }, opts?: { signal?: AbortSignal; onStage?: (stage: 'fetching' | 'extracting') => void }) => Promise<IngestResult>;
  assembleRepoModel: (fragment: Fragment, meta: { owner: string; repo: string; sha: string; framework: string }, opts?: { signal?: AbortSignal }) => Promise<GenerateOutcome>;
} = {
  store: openStore(process.env.ARCHWOVEN_DB ?? 'data/archwoven.db'),
  generateModel: (prompt, view) => generateModel(prompt, view),
  generateRefinement: (instruction, model, view) => generateRefinement(instruction, model, view),
  // §14: URLs reaching this seam are already parseRepoUrl-validated (github.com only);
  // repo content is untrusted data, never executed — extraction is static analysis only.
  ingestRepo: (parsed, opts) => ingestRepo(parsed, { fetcher: (url, init) => fetch(url, init), extractSpringBoot, extractFastApi }, opts),
  assembleRepoModel: (fragment, meta, opts) => assembleRepoModel(fragment, meta, opts),
};

export const PROMPT_TOKEN_LIMIT = 25_000;
/** Cheap server-side estimate for the UI chip; the authoritative gate is the
 *  exact count_tokens call inside generateModel (CJK text defeats chars/4). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/**
 * Fake/local modes are test-and-demo affordances — they must never ship.
 * Production with ARCHWOVEN_FAKE serves every user the same canned diagram
 * (while still exercising the credit ladder), and ARCHWOVEN_MODE=local compiles
 * all quotas out. Boot fails loudly unless a second explicit ack opts in.
 */
export function assertSafeRuntime(): void {
  const prod = process.env.NODE_ENV === 'production';
  if (!prod) return;
  const acked = process.env.ARCHWOVEN_DEMO_ACK === '1';
  if (acked) return;
  if (process.env.ARCHWOVEN_FAKE === '1') {
    throw new Error('refusing to boot production with ARCHWOVEN_FAKE=1 (fake model data). Set ARCHWOVEN_DEMO_ACK=1 to run an explicit production demo.');
  }
  if (process.env.ARCHWOVEN_MODE === 'local') {
    throw new Error('refusing to boot production in ARCHWOVEN_MODE=local (quotas disabled). Set ARCHWOVEN_DEMO_ACK=1 to opt in explicitly.');
  }
}

export function readOrCreateSession(req: Request): { sessionId: string; minted: boolean } {
  const raw = req.headers.get('cookie') ?? '';
  const match = /(?:^|;\s*)aw_sid=([\w-]+)/.exec(raw);
  if (match) return { sessionId: match[1]!, minted: false };
  return { sessionId: randomUUID(), minted: true };
}

export const sessionCookie = (sessionId: string) =>
  `aw_sid=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${90 * 24 * 3600}`;

export const tierOf = (_sessionId: string): Tier => 'anonymous'; // GitHub OAuth deferred to M6 (external GitHub App registration; private repos covered by local mode)
/** Demo-data mode flag — surfaced to the UI so fake output is never silent. */
export const fakeMode = () => process.env.ARCHWOVEN_FAKE === '1';

export function creditsExhaustedCopy(resetAt: number): string {
  const mins = Math.max(0, Math.round((resetAt - Date.now()) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `You've used today's free generations — resets in ${h}h ${m}m. Sign in with GitHub for 30/day.`;
}
export const STOP_LOSS_COPY = "Generations are temporarily paused while we stay within today's budget — try again tomorrow.";
export const OVERSIZED_COPY = "That description is bigger than a single diagram can hold — try focusing on one system or flow.";
export const BURST_COPY = 'Slow down a touch — too many generations at once. Try again in a minute.';
