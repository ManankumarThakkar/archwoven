import { randomUUID } from 'node:crypto';
import { openStore, type Store, type Tier } from '@archwoven/jobs';
import { generateModel, generateRefinement, type GenerateOutcome, type RefineOutcome } from '@archwoven/llm';
import type { SystemModel, ViewType } from '@archwoven/model';

/**
 * Server singletons + injectable seams. Tests replace `serverDeps.store`
 * (":memory:") and `serverDeps.generateModel` / `serverDeps.generateRefinement`
 * (canned outcomes) — production wiring lives here and nowhere else.
 */
export const serverDeps: {
  store: Store;
  generateModel: (prompt: string, view: ViewType) => Promise<GenerateOutcome>;
  generateRefinement: (instruction: string, model: SystemModel, view: ViewType) => Promise<RefineOutcome>;
} = {
  store: openStore(process.env.ARCHWOVEN_DB ?? 'data/archwoven.db'),
  generateModel: (prompt, view) => generateModel(prompt, view),
  generateRefinement: (instruction, model, view) => generateRefinement(instruction, model, view),
};

export const PROMPT_TOKEN_LIMIT = 25_000;
/** Cheap server-side estimate; exact count via count_tokens happens inside generateModel's own budget. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export function readOrCreateSession(req: Request): { sessionId: string; minted: boolean } {
  const raw = req.headers.get('cookie') ?? '';
  const match = /(?:^|;\s*)aw_sid=([\w-]+)/.exec(raw);
  if (match) return { sessionId: match[1]!, minted: false };
  return { sessionId: randomUUID(), minted: true };
}

export const sessionCookie = (sessionId: string) =>
  `aw_sid=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${90 * 24 * 3600}`;

export const tierOf = (_sessionId: string): Tier => 'anonymous'; // GitHub OAuth lands M4

export function creditsExhaustedCopy(resetAt: number): string {
  const mins = Math.max(0, Math.round((resetAt - Date.now()) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `You've used today's free generations — resets in ${h}h ${m}m. Sign in with GitHub for 30/day.`;
}
export const STOP_LOSS_COPY = "Generations are temporarily paused while we stay within today's budget — try again tomorrow.";
export const OVERSIZED_COPY = "That description is bigger than a single diagram can hold — try focusing on one system or flow.";
export const BURST_COPY = 'Slow down a touch — too many generations at once. Try again in a minute.';
