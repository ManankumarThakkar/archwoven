import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { openStore, type Store, type Tier } from '@archwoven/jobs';
import {
  generateModel, generateRefinement, assembleRepoModel, expandComponent,
  generateModelLocal, generateRefinementLocal, assembleRepoModelLocal, expandComponentLocal,
  makeEgressGuard, LOCAL_EGRESS_ALLOW,
  type GenerateOutcome, type DescriptionOutcome, type RefineOutcome, type ExpandOutcome,
} from '@archwoven/llm';
import { deployMode, fakeMode } from './mode';
import { hostingProbeRequested } from '../../lib/hosting-probe';
import { evaluationClient } from './evaluation-budget';
import { spendingClient, type Spender } from './spending';
import { ingestRepo, ingestLocal, gitRevParse, type IngestResult } from '@archwoven/ingest';
import { extractSpringBoot, extractFastApi, type Fragment } from '@archwoven/extract';
import type { SystemModel, ViewType } from '@archwoven/model';

/** In local deployments every raw fetch passes the egress guard; hosted uses plain fetch. */
const egressFetch: typeof fetch = deployMode() === 'local' ? makeEgressGuard(LOCAL_EGRESS_ALLOW) : fetch;

/** Hosted without a key dies deep in the SDK ("Could not resolve authentication
 *  method") after credits are reserved — fail at the gate, in human words, first. */
export const LLM_NOT_CONFIGURED_COPY =
  'No LLM is configured for this server. Set ANTHROPIC_API_KEY in apps/web/.env.local and restart, or run locally with Ollama: ARCHWOVEN_MODE=local pnpm dev.';
export const llmNotConfigured = (): boolean =>
  deployMode() === 'hosted' && !fakeMode() && (process.env.ANTHROPIC_API_KEY ?? '').trim().length === 0;

// Next can preload route modules before middleware rejects their requests.
// Importing a route must not create a database in a read-only function bundle.
let applicationStore: Store | undefined;

/**
 * Server singletons + injectable seams. Tests replace `serverDeps.store`
 * (":memory:") and `serverDeps.generateModel` / `serverDeps.generateRefinement`
 * / `serverDeps.ingestRepo` / `serverDeps.assembleRepoModel` (canned outcomes)
 * — production wiring lives here and nowhere else.
 */
export const serverDeps: {
  store: Store;
  generateModel: (prompt: string, view: ViewType, opts?: { signal?: AbortSignal; allowClarification?: boolean; spender?: Spender }) => Promise<DescriptionOutcome>;
  generateRefinement: (instruction: string, model: SystemModel, view: ViewType, opts?: { signal?: AbortSignal; spender?: Spender }) => Promise<RefineOutcome>;
  expandComponent: (model: SystemModel, target: string, hint: string, opts?: { signal?: AbortSignal; spender?: Spender }) => Promise<ExpandOutcome>;
  ingestRepo: (parsed: { owner: string; repo: string; ref?: string; subdir?: string }, opts?: { signal?: AbortSignal; onStage?: (stage: 'fetching' | 'extracting') => void }) => Promise<IngestResult>;
  ingestLocal: (dir: string, opts?: { subdir?: string; signal?: AbortSignal; onStage?: (stage: 'fetching' | 'extracting') => void }) => Promise<IngestResult>;
  assembleRepoModel: (fragment: Fragment, meta: { owner: string; repo: string; sha: string; framework: string }, opts?: { signal?: AbortSignal; spender?: Spender }) => Promise<GenerateOutcome>;
} = {
  get store(): Store {
    if (hostingProbeRequested()) throw new Error('Application storage is unavailable during hosting diagnostics.');
    return applicationStore ??= openStore(process.env.ARCHWOVEN_DB ?? 'data/archwoven.db');
  },
  set store(value: Store) { applicationStore = value; },
  // Routing: fake first (canned, zero network); local mode goes to Ollama
  // behind the egress guard — a private job can never reach a hosted provider,
  // not even by accident in a repair or failure path.
  generateModel: (prompt, view, opts) =>
    fakeMode() ? generateModel(prompt, view, { ...opts, allowClarification: opts?.allowClarification ?? false })
      : deployMode() === 'local' ? generateModelLocal(prompt, view, { fetchImpl: egressFetch, signal: opts?.signal, allowClarification: opts?.allowClarification ?? false })
        : generateModel(prompt, view, { signal: opts?.signal, client: hostedClient(opts?.spender), allowClarification: opts?.allowClarification ?? false }),
  generateRefinement: (instruction, model, view, opts) =>
    fakeMode() ? generateRefinement(instruction, model, view)
      : deployMode() === 'local' ? generateRefinementLocal(instruction, model, view, { fetchImpl: egressFetch, signal: opts?.signal })
        : generateRefinement(instruction, model, view, { signal: opts?.signal, client: hostedClient(opts?.spender) }),
  expandComponent: (model, target, hint, opts) =>
    fakeMode() ? expandComponent(model, target, hint)
      : deployMode() === 'local' ? expandComponentLocal(model, target, hint, { fetchImpl: egressFetch, signal: opts?.signal })
        : expandComponent(model, target, hint, { signal: opts?.signal, client: hostedClient(opts?.spender) }),
  // URLs reaching this seam are already parseRepoUrl-validated (github.com only);
  // repo content is untrusted data, never executed — extraction is static analysis only.
  ingestRepo: (parsed, opts) => ingestRepo(parsed, { fetcher: (url, init) => egressFetch(url, init), extractSpringBoot, extractFastApi }, opts),
  // Private clone import — reads the user's own directory, no network at all.
  ingestLocal: (dir, opts) => ingestLocal(dir, { revParse: gitRevParse, extractSpringBoot, extractFastApi }, opts),
  assembleRepoModel: (fragment, meta, opts) =>
    fakeMode() ? assembleRepoModel(fragment, meta, opts)
      : deployMode() === 'local' ? assembleRepoModelLocal(fragment, meta, { fetchImpl: egressFetch, signal: opts?.signal })
        : assembleRepoModel(fragment, meta, { signal: opts?.signal, client: hostedClient(opts?.spender) }),
};

/** Local evaluation ledgers take precedence; otherwise hosted spending limits apply where configured. */
const hostedClient = (spender?: Spender) => evaluationClient() ?? spendingClient(spender);

/** The network a client address belongs to: IPv4 per address, IPv6 per /64, the usual size of one subscriber's allocation. */
export function networkOf(address: string | null): string | null {
  if (!address || isIP(address) !== 6) return address;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)?.[1];
  if (mapped && isIP(mapped) === 4) return mapped;
  const [head = '', tail = ''] = address.toLowerCase().split('::');
  const left = head ? head.split(':') : [], right = tail ? tail.split(':') : [];
  const groups = address.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map(group => group.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/** The visitor and network a paid request is charged to. */
export const spenderOf = (headers: Headers, sessionId: string): Spender => ({ visitor: sessionId, network: networkOf(clientIp(headers)) });

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

/** Secure on hosted production (HTTPS); local and development servers run over http on loopback. */
export const sessionCookie = (sessionId: string) =>
  `aw_sid=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${90 * 24 * 3600}${deployMode() === 'hosted' && process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;

export const tierOf = (_sessionId: string): Tier => 'anonymous'; // No sign-in tier: private repositories are handled by local mode

/** The client address, or null when it is unknown. On Vercel, x-vercel-forwarded-for is set by
 *  the platform and cannot be spoofed. Elsewhere, the address appended by the nearest proxy (the
 *  last X-Forwarded-For entry); entries before it are client-controlled and never decide a bucket. */
export function clientIp(headers: Headers): string | null {
  const address = process.env.VERCEL === '1'
    ? headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()
    : headers.get('x-forwarded-for')?.split(',').at(-1)?.trim();
  return address && isIP(address) ? address : null;
}

const resetIn = (resetAt: number): string => {
  const mins = Math.max(0, Math.round((resetAt - Date.now()) / 60_000));
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
};
const STILL_FREE = 'You can still view, rearrange, rename and export your diagrams.';

/** One honest message per quota refusal; no sign-in tier is offered because none exists in this release. */
export function quotaMessage(q: { reason: 'credits-exhausted' | 'network-credits-exhausted' | 'stop-loss' | 'burst'; resetAt?: number }): string {
  if (q.reason === 'credits-exhausted') return `You've used today's free credits. They reset in ${resetIn(q.resetAt ?? Date.now())}. ${STILL_FREE}`;
  if (q.reason === 'network-credits-exhausted') return `Today's free credits for your network are used up. They reset in ${resetIn(q.resetAt ?? Date.now())}. ${STILL_FREE}`;
  return q.reason === 'stop-loss' ? STOP_LOSS_COPY : BURST_COPY;
}
export const STOP_LOSS_COPY = "Generations are temporarily paused while we stay within today's budget — try again tomorrow.";
export const OVERSIZED_COPY = "That description is bigger than a single diagram can hold — try focusing on one system or flow.";
export const BURST_COPY = 'Slow down a touch — too many generations at once. Try again in a minute.';
