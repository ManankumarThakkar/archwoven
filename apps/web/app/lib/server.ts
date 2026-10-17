import { randomUUID } from 'node:crypto';
import { openStore, type Store, type Tier } from '@archwoven/jobs';
import {
  generateModel, generateRefinement, assembleRepoModel, expandComponent,
  generateModelLocal, generateRefinementLocal, assembleRepoModelLocal, expandComponentLocal,
  makeEgressGuard, LOCAL_EGRESS_ALLOW,
  type GenerateOutcome, type DescriptionOutcome, type RefineOutcome, type ExpandOutcome,
} from '@archwoven/llm';
import { deployMode, fakeMode } from './mode';
import { ingestRepo, ingestLocal, gitRevParse, type IngestResult } from '@archwoven/ingest';
import { extractSpringBoot, extractFastApi, type Fragment } from '@archwoven/extract';
import type { SystemModel, ViewType } from '@archwoven/model';

/** §9: in local deployments every raw fetch passes the egress guard; hosted uses plain fetch. */
const egressFetch: typeof fetch = deployMode() === 'local' ? makeEgressGuard(LOCAL_EGRESS_ALLOW) : fetch;

/** Hosted without a key dies deep in the SDK ("Could not resolve authentication
 *  method") after credits are reserved — fail at the gate, in human words, first. */
export const LLM_NOT_CONFIGURED_COPY =
  'No LLM is configured for this server. Set ANTHROPIC_API_KEY in apps/web/.env.local and restart, or run locally with Ollama: ARCHWOVEN_MODE=local pnpm dev.';
export const llmNotConfigured = (): boolean =>
  deployMode() === 'hosted' && !fakeMode() && (process.env.ANTHROPIC_API_KEY ?? '').trim().length === 0;

/**
 * Server singletons + injectable seams. Tests replace `serverDeps.store`
 * (":memory:") and `serverDeps.generateModel` / `serverDeps.generateRefinement`
 * / `serverDeps.ingestRepo` / `serverDeps.assembleRepoModel` (canned outcomes)
 * — production wiring lives here and nowhere else.
 */
export const serverDeps: {
  store: Store;
  generateModel: (prompt: string, view: ViewType, opts?: { signal?: AbortSignal; allowClarification?: boolean }) => Promise<DescriptionOutcome>;
  generateRefinement: (instruction: string, model: SystemModel, view: ViewType, opts?: { signal?: AbortSignal }) => Promise<RefineOutcome>;
  expandComponent: (model: SystemModel, target: string, hint: string, opts?: { signal?: AbortSignal }) => Promise<ExpandOutcome>;
  ingestRepo: (parsed: { owner: string; repo: string; ref?: string; subdir?: string }, opts?: { signal?: AbortSignal; onStage?: (stage: 'fetching' | 'extracting') => void }) => Promise<IngestResult>;
  ingestLocal: (dir: string, opts?: { subdir?: string; signal?: AbortSignal; onStage?: (stage: 'fetching' | 'extracting') => void }) => Promise<IngestResult>;
  assembleRepoModel: (fragment: Fragment, meta: { owner: string; repo: string; sha: string; framework: string }, opts?: { signal?: AbortSignal }) => Promise<GenerateOutcome>;
} = {
  store: openStore(process.env.ARCHWOVEN_DB ?? 'data/archwoven.db'),
  // §8/§9 routing: fake first (canned, zero network); local mode goes to Ollama
  // behind the egress guard — a private job can never reach a hosted provider,
  // not even by accident in a repair or failure path.
  generateModel: (prompt, view, opts) =>
    fakeMode() ? generateModel(prompt, view, { ...opts, allowClarification: opts?.allowClarification ?? false })
      : deployMode() === 'local' ? generateModelLocal(prompt, view, { fetchImpl: egressFetch, signal: opts?.signal, allowClarification: opts?.allowClarification ?? false })
        : generateModel(prompt, view, { ...opts, allowClarification: opts?.allowClarification ?? false }),
  generateRefinement: (instruction, model, view, opts) =>
    fakeMode() ? generateRefinement(instruction, model, view)
      : deployMode() === 'local' ? generateRefinementLocal(instruction, model, view, { fetchImpl: egressFetch, signal: opts?.signal })
        : generateRefinement(instruction, model, view, opts),
  expandComponent: (model, target, hint, opts) =>
    fakeMode() ? expandComponent(model, target, hint)
      : deployMode() === 'local' ? expandComponentLocal(model, target, hint, { fetchImpl: egressFetch, signal: opts?.signal })
        : expandComponent(model, target, hint, opts),
  // §14: URLs reaching this seam are already parseRepoUrl-validated (github.com only);
  // repo content is untrusted data, never executed — extraction is static analysis only.
  ingestRepo: (parsed, opts) => ingestRepo(parsed, { fetcher: (url, init) => egressFetch(url, init), extractSpringBoot, extractFastApi }, opts),
  // §8: private clone import — reads the user's own directory, no network at all.
  ingestLocal: (dir, opts) => ingestLocal(dir, { revParse: gitRevParse, extractSpringBoot, extractFastApi }, opts),
  assembleRepoModel: (fragment, meta, opts) =>
    fakeMode() ? assembleRepoModel(fragment, meta, opts)
      : deployMode() === 'local' ? assembleRepoModelLocal(fragment, meta, { fetchImpl: egressFetch, signal: opts?.signal })
        : assembleRepoModel(fragment, meta, opts),
};

export const PROMPT_TOKEN_LIMIT = 25_000;
/** Cheap server-side estimate for the UI chip; the authoritative gate is the
 *  exact count_tokens call inside generateModel (CJK text defeats chars/4). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export function readOrCreateSession(req: Request): { sessionId: string; minted: boolean } {
  const raw = req.headers.get('cookie') ?? '';
  const match = /(?:^|;\s*)aw_sid=([\w-]+)/.exec(raw);
  if (match) return { sessionId: match[1]!, minted: false };
  return { sessionId: randomUUID(), minted: true };
}

export const sessionCookie = (sessionId: string) =>
  `aw_sid=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${90 * 24 * 3600}`;

export const tierOf = (_sessionId: string): Tier => 'anonymous'; // GitHub OAuth deferred to M6 (external GitHub App registration; private repos covered by local mode)

export function creditsExhaustedCopy(resetAt: number): string {
  const mins = Math.max(0, Math.round((resetAt - Date.now()) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `You've used today's free generations — resets in ${h}h ${m}m. Sign in with GitHub for 30/day.`;
}
export const STOP_LOSS_COPY = "Generations are temporarily paused while we stay within today's budget — try again tomorrow.";
export const OVERSIZED_COPY = "That description is bigger than a single diagram can hold — try focusing on one system or flow.";
export const BURST_COPY = 'Slow down a touch — too many generations at once. Try again in a minute.';
