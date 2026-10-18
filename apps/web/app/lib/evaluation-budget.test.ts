import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initializeEvaluationBudget, openEvaluationBudget } from '@archwoven/jobs';
import { generateModel, generateRefinement, expandComponent, assembleRepoModel, ProviderRequestNotSentError, type StructuredClient } from '@archwoven/llm';
import { validFullModelExtended } from '@archwoven/model';
import { withEvaluationBudget, evaluationReservation, promptVersion } from './evaluation-budget';

const directories: string[] = [];
const stores: ReturnType<typeof openEvaluationBudget>[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const store of stores.splice(0)) store.close(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function ledger(cap = 6_000_000_000) {
  const dir = mkdtempSync(join(tmpdir(), 'aw-eval-client-')); directories.push(dir);
  const file = join(dir, 'budget.db'); initializeEvaluationBudget(file, cap);
  const store = openEvaluationBudget(file); stores.push(store); return store;
}
const request = { model: 'claude-opus-5-5', max_tokens: 8192, system: [{ type: 'text', text: 'system', cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: 'hello' }] };
function transport() {
  const countTokens = vi.fn(async () => ({ input_tokens: 100 }));
  const create = vi.fn(async () => ({ content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 100 } }));
  return { client: { messages: { countTokens }, beta: { messages: { create } } } as StructuredClient, create, countTokens };
}

describe('evaluation provider guard', () => {
  it.each([
    ['claude-opus-5-5', 5_163_840_000], ['claude-sonnet-5-5', 2_581_920_000], ['claude-haiku-5-5', 645_480_000],
  ])('reserves the full reviewed context and maximum output for %s', (model, expected) => {
    expect(evaluationReservation({ ...request, model }).nanos).toBe(expected);
  });
  it('settles reported tokens with integer accounting', async () => {
    const store = ledger(); const { client, create } = transport();
    await withEvaluationBudget(client, store).beta.messages.create(request);
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith({ ...request, service_tier: 'standard_only', inference_geo: 'global', speed: 'standard' }, undefined);
    expect(store.snapshot()).toMatchObject({ settledNanos: 6_000_000, heldNanos: 0, pendingAttempts: 0 });
  });
  it('refuses before dispatch, including the free count preflight when no attempt could fit', async () => {
    const store = ledger(1000); const { client, create, countTokens } = transport(); const guarded = withEvaluationBudget(client, store);
    await expect(guarded.beta.messages.create(request)).rejects.toBeInstanceOf(ProviderRequestNotSentError);
    await expect(guarded.messages.countTokens({ model: request.model, system: request.system, messages: request.messages })).rejects.toThrow(/budget/i);
    expect(create).not.toHaveBeenCalled(); expect(countTokens).not.toHaveBeenCalled();
    expect(store.snapshot()).toMatchObject({ heldNanos: 0, settledNanos: 0 });
  });
  it('fails closed on reservation storage errors before dispatch', async () => {
    const store = ledger(); const { client, create } = transport();
    vi.spyOn(store, 'reserve').mockImplementation(() => { throw new Error('disk failure with private file path'); });
    await expect(withEvaluationBudget(client, store).beta.messages.create(request)).rejects.toThrow('Evaluation budget is unavailable. Nothing was sent.');
    expect(create).not.toHaveBeenCalled();
  });
  it.each([
    ['claude-opus-5-5', 5_163_840_000], ['claude-sonnet-5-5', 2_581_920_000], ['claude-haiku-5-5', 645_480_000],
  ])('covers the worst supported reported usage exactly for %s', async (model, expected) => {
    const store = ledger(); const { client, create } = transport();
    create.mockResolvedValueOnce({ content: [], stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 8192, cache_creation_input_tokens: 1_000_000 } } as never);
    await withEvaluationBudget(client, store).beta.messages.create({ ...request, model });
    expect(store.snapshot()).toMatchObject({ settledNanos: expected, heldNanos: 0, frozen: false });
  });
  it('retains the full hold after transport failure and prevents another attempt exceeding the cap', async () => {
    const store = ledger(); const { client, create } = transport(); create.mockRejectedValueOnce(new Error('connection lost'));
    const guarded = withEvaluationBudget(client, store);
    await expect(guarded.beta.messages.create(request)).rejects.toThrow('connection lost');
    expect(store.snapshot()).toMatchObject({ heldNanos: 5_163_840_000, unknownAttempts: 1 });
    await expect(guarded.beta.messages.create(request)).rejects.toBeInstanceOf(ProviderRequestNotSentError);
    expect(create).toHaveBeenCalledOnce();
  });
  it.each([{ input_tokens: 1000 }, { input_tokens: -1, output_tokens: 10 }, { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: null }])('retains holds for missing or malformed usage %j', async usage => {
    const store = ledger(); const { client, create } = transport();
    create.mockResolvedValueOnce({ content: [], stop_reason: 'end_turn', usage } as never);
    await withEvaluationBudget(client, store).beta.messages.create(request);
    expect(store.snapshot()).toMatchObject({ heldNanos: 5_163_840_000, unknownAttempts: 1 });
  });
  it.each([[100_000, 10_001_230], [100_001, 50_006_650]])('settles Haiku cached-input tier at %s total input without fractional arithmetic', async (input, expected) => {
    const store = ledger(); const { client, create } = transport();
    create.mockResolvedValueOnce({ content: [], stop_reason: 'end_turn', usage: { input_tokens: input - 3, output_tokens: 3, cache_read_input_tokens: 3 } } as never);
    await withEvaluationBudget(client, store).beta.messages.create({ ...request, model: 'claude-haiku-5-5' });
    expect(store.snapshot()).toMatchObject({ heldNanos: 0, settledNanos: expected });
  });
  it.each([{ input_tokens: 1_000_001, output_tokens: 10 }, { input_tokens: 1, output_tokens: 8193 }])('freezes admission when reported usage breaks the reviewed bound %j', async usage => {
    const store = ledger(); const { client, create } = transport(); create.mockResolvedValueOnce({ content: [], stop_reason: 'end_turn', usage });
    await expect(withEvaluationBudget(client, store).beta.messages.create(request)).rejects.toThrow(/frozen/);
    expect(store.snapshot()).toMatchObject({ frozen: true, heldNanos: 5_163_840_000, unknownAttempts: 1 });
  });
  it('admits concurrent calls atomically before either transport resolves', async () => {
    const store = ledger(); const { client, create } = transport();
    let finish!: (result: Awaited<ReturnType<typeof create>>) => void;
    create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const guarded = withEvaluationBudget(client, store); const first = guarded.beta.messages.create(request);
    await expect(guarded.beta.messages.create(request)).rejects.toBeInstanceOf(ProviderRequestNotSentError);
    finish({ content: [], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }); await first;
    expect(create).toHaveBeenCalledOnce();
  });
  it('does not send an already aborted request or consume a hold', async () => {
    const store = ledger(); const { client, create } = transport(); const controller = new AbortController(); controller.abort();
    await expect(withEvaluationBudget(client, store).beta.messages.create(request, { signal: controller.signal })).rejects.toBeInstanceOf(ProviderRequestNotSentError);
    expect(create).not.toHaveBeenCalled(); expect(store.snapshot().heldNanos).toBe(0);
  });
  it.each([
    { model: 'unknown' }, { max_tokens: 8193 }, { max_tokens: 0 }, { tools: [] }, { service_tier: 'auto' }, { stream: true },
    { system: [{ type: 'text', text: 'x', cache_control: { type: 'ephemeral', ttl: '1h' } }] },
    { messages: [{ role: 'user', content: [{ type: 'image', source: {} }] }] },
    { betas: ['unreviewed-pricing-beta'] }, { output_config: { advisor: { model: 'other' } } },
  ])('rejects unreviewed request pricing/features %j', patch => {
    expect(() => evaluationReservation({ ...request, ...patch })).toThrow();
  });
  it('leaves a durable hold and stops retrying if settlement storage fails after a response', async () => {
    vi.stubEnv('ARCHWOVEN_HOSTED_MODEL', 'claude-opus-5-5');
    const store = ledger(); const { client, create } = transport(); vi.spyOn(store, 'settle').mockImplementation(() => { throw new Error('disk failure'); });
    const outcome = await generateModel('Customer uses an API', 'architecture', { client: withEvaluationBudget(client, store) });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errors.join(' ')).toMatch(/accounting/i);
    expect(outcome.usage).toMatchObject({ usageComplete: false, repairs: 0, transportRetries: 0 });
    expect(outcome.usage.attempts).toHaveLength(1);
    expect(create).toHaveBeenCalledOnce(); expect(store.snapshot().heldNanos).toBe(5_163_840_000);
  });
});

describe('all hosted operations stop known pre-dispatch refusals', () => {
  it('shows a direct budget message rather than a token-counting failure for preflight denial', async () => {
    vi.stubEnv('ARCHWOVEN_HOSTED_MODEL', 'claude-opus-5-5');
    const store = ledger(1); const { client, create, countTokens } = transport();
    const outcome = await generateModel('Customer uses an API', 'architecture', { client: withEvaluationBudget(client, store) });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errors[0]).toMatch(/^Evaluation budget cannot cover/);
    expect(create).not.toHaveBeenCalled(); expect(countTokens).not.toHaveBeenCalled();
  });
  it('does not invent billed attempts or retries when a guard refuses a send', async () => {
    vi.stubEnv('ARCHWOVEN_FAKE', '0'); vi.stubEnv('ARCHWOVEN_HOSTED_MODEL', 'claude-opus-5-5');
    const { client, create } = transport(); create.mockRejectedValue(new ProviderRequestNotSentError('Evaluation budget cannot cover another attempt.'));
    const fragment = { nodes: [], edges: [], gaps: [], sources: [], warnings: [], diagnostics: [] };
    const outcomes = [
      await generateModel('Customer uses an API', 'architecture', { client }),
      await generateRefinement('rename API', validFullModelExtended, 'architecture', { client }),
      await expandComponent(validFullModelExtended, 'svc.orders', 'show details', { client }),
      await assembleRepoModel(fragment as never, { owner: 'owner', repo: 'repo', sha: 'a'.repeat(40), framework: 'FastAPI' }, { client }),
    ];
    for (const outcome of outcomes) {
      expect(outcome.ok).toBe(false);
      expect(outcome.usage).toMatchObject({ repairs: 0, transportRetries: 0, attempts: [], usageComplete: true });
      if (!outcome.ok) expect(outcome.errors.join(' ')).toMatch(/budget/i);
    }
    expect(create).toHaveBeenCalledTimes(4);
  });
  it('reserves every repair and settles it independently', async () => {
    vi.stubEnv('ARCHWOVEN_HOSTED_MODEL', 'claude-opus-5-5');
    const store = ledger(); const { client, create } = transport();
    const outcome = await generateModel('Customer uses an API', 'architecture', { client: withEvaluationBudget(client, store) });
    expect(outcome.ok).toBe(false); expect(create).toHaveBeenCalledTimes(3);
    expect(store.snapshot()).toMatchObject({ settledNanos: 18_000_000, heldNanos: 0 });
    expect(outcome.usage.attempts).toHaveLength(3);
  });
  it('keeps the submitted attempt incomplete when its transport fails and a retry cannot fit', async () => {
    vi.stubEnv('ARCHWOVEN_HOSTED_MODEL', 'claude-opus-5-5');
    const store = ledger(); const { client, create } = transport(); create.mockRejectedValueOnce(new Error('connection lost'));
    const outcome = await generateModel('Customer uses an API', 'architecture', { client: withEvaluationBudget(client, store) });
    expect(outcome.ok).toBe(false); expect(create).toHaveBeenCalledOnce();
    expect(outcome.usage).toMatchObject({ usageComplete: false, repairs: 0, transportRetries: 0 });
    expect(outcome.usage.attempts).toHaveLength(1);
    expect(store.snapshot()).toMatchObject({ heldNanos: 5_163_840_000, unknownAttempts: 1 });
  });
  it('does not invent repair attempts when the egress guard detects a secret in a prior response', async () => {
    vi.stubEnv('ARCHWOVEN_HOSTED_MODEL', 'claude-opus-5-5');
    const store = ledger(); const { client, create } = transport();
    const synthetic = ['sk-', 'ant-', 'api03-'].join('') + 'Q'.repeat(93) + 'AA';
    create.mockResolvedValueOnce({ content: [{ type: 'text', text: `invalid model ${synthetic}` }], stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 100 } });
    const outcome = await generateModel('Customer uses an API', 'architecture', { client: withEvaluationBudget(client, store) });
    expect(outcome.ok).toBe(false); expect(create).toHaveBeenCalledOnce();
    expect(outcome.usage).toMatchObject({ usageComplete: true, repairs: 0, transportRetries: 0 });
    expect(outcome.usage.attempts).toHaveLength(1);
    expect(store.snapshot()).toMatchObject({ settledNanos: 6_000_000, heldNanos: 0 });
  });
});

describe('prompt version', () => {
  it('changes with any prompt or schema text and stays stable otherwise', () => {
    const parts = { generate: 'system', refineSchema: { type: 'array' } };
    expect(promptVersion(parts)).toBe(promptVersion(structuredClone(parts)));
    expect(promptVersion(parts)).toMatch(/^p-[0-9a-f]{12}$/);
    expect(promptVersion({ ...parts, generate: 'system.' })).not.toBe(promptVersion(parts));
    expect(promptVersion({ ...parts, refineSchema: { type: 'object' } })).not.toBe(promptVersion(parts));
  });
});
