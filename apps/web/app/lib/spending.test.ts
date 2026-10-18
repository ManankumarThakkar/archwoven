import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSpendingLedger, SpendingLedgerUnavailable, type SpendingLedger } from '@archwoven/jobs';
import { startTestRedis } from '../../../../packages/jobs/src/redis-test-server';
import { ProviderAccountingError, ProviderRequestNotSentError, STRUCTURED_OUTPUTS_BETA, type StructuredClient } from '@archwoven/llm';
import { evaluationHoldNanos, validFullModelExtended } from '@archwoven/model';
import { generateModel, generateRefinement, expandComponent, assembleRepoModel } from '@archwoven/llm';
import { inputCeiling, refusalCopy, spendingClient, withSpendingLimits } from './spending';

const request = { model: 'claude-opus-5-5', max_tokens: 8192, system: [{ type: 'text', text: 'system' }], messages: [{ role: 'user', content: 'A shop' }] };
const usage = { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const who = { visitor: 'visitor-1', network: '203.0.113.9' };
function provider(counted = 1000) {
  const countTokens = vi.fn(async () => ({ input_tokens: counted }));
  const create = vi.fn(async (_params: unknown) => ({ content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn', usage }));
  return { client: { messages: { countTokens }, beta: { messages: { create } } } as unknown as StructuredClient, countTokens, create };
}
function fakeLedger(reserve: SpendingLedger['reserve'] = async () => ({ ok: true })) {
  return { reserve: vi.fn(reserve), settle: vi.fn(async (_id: string, _charged: number | null) => 'settled' as const) } as unknown as SpendingLedger & { reserve: ReturnType<typeof vi.fn>; settle: ReturnType<typeof vi.fn> };
}

describe('hosted spending guard', () => {
  it('reserves the counted context before sending, sends reviewed options and settles the reported cost', async () => {
    const { client, create } = provider(1000); const ledger = fakeLedger();
    await withSpendingLimits(client, ledger, who).beta.messages.create(request);
    const [id, nanos, identity] = ledger.reserve.mock.calls[0]!;
    expect(nanos).toBe(evaluationHoldNanos('claude-opus-5-5', 8192, inputCeiling(1000)));
    expect(identity).toEqual(who);
    expect(ledger.reserve.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]!);
    expect(create).toHaveBeenCalledWith({ ...request, service_tier: 'standard_only', inference_geo: 'global', speed: 'standard' }, undefined);
    expect(ledger.settle).toHaveBeenCalledWith(id, 1000 * 4000 + 100 * 20_000);
  });

  it('counts an output schema conservatively as extra context', async () => {
    const { client } = provider(1000); const ledger = fakeLedger();
    const schema = { type: 'object', properties: { ops: { type: 'array' } } };
    await withSpendingLimits(client, ledger, who).beta.messages.create({ ...request, betas: [STRUCTURED_OUTPUTS_BETA], output_config: { format: { type: 'json_schema', schema } } });
    expect(ledger.reserve.mock.calls[0]![1]).toBe(evaluationHoldNanos('claude-opus-5-5', 8192, inputCeiling(1000 + Buffer.byteLength(JSON.stringify(schema)))));
  });

  it.each([
    ['visitor-exhausted', /today's AI limit for this browser/], ['network-exhausted', /for your network/],
    ['month-exhausted', /this month's free AI budget/i], ['year-exhausted', /this year/], ['ledger-expired', /this year/],
    ['paused', /paused/], ['ledger-missing', /temporarily unavailable/], ['duplicate', /temporarily unavailable/],
  ] as const)('refuses with an understandable message when the ledger says %s, and sends nothing', async (reason, copy) => {
    const { client, create } = provider(); const ledger = fakeLedger(async () => ({ ok: false, reason }));
    const failure = withSpendingLimits(client, ledger, who).beta.messages.create(request);
    await expect(failure).rejects.toBeInstanceOf(ProviderRequestNotSentError);
    await expect(failure).rejects.toThrow(copy);
    await expect(failure).rejects.toThrow(/You can still view, edit and download your diagrams/);
    expect(create).not.toHaveBeenCalled();
  });

  it('fails closed when the ledger cannot be reached, releasing any hold it may have made', async () => {
    const { client, create } = provider(); const ledger = fakeLedger(async () => { throw new SpendingLedgerUnavailable('down'); });
    await expect(withSpendingLimits(client, ledger, who).beta.messages.create(request)).rejects.toThrow(/temporarily unavailable/);
    expect(create).not.toHaveBeenCalled();
    expect(ledger.settle).toHaveBeenCalledWith(ledger.reserve.mock.calls[0]![0], 0);
  });

  it('refuses unreviewed options and unmeasurable requests before reserving', async () => {
    const { client, countTokens } = provider(); const ledger = fakeLedger();
    await expect(withSpendingLimits(client, ledger, who).beta.messages.create({ ...request, tools: [] })).rejects.toBeInstanceOf(ProviderRequestNotSentError);
    countTokens.mockRejectedValueOnce(new Error('count unavailable'));
    await expect(withSpendingLimits(client, ledger, who).beta.messages.create(request)).rejects.toThrow(/could not be measured/);
    expect(ledger.reserve).not.toHaveBeenCalled();
  });

  it('keeps the hold when the provider fails or reports no usage, and stops retries when settlement fails', async () => {
    const failing = provider(); failing.create.mockRejectedValueOnce(new Error('socket hang up'));
    const ledger = fakeLedger();
    await expect(withSpendingLimits(failing.client, ledger, who).beta.messages.create(request)).rejects.toThrow('socket hang up');
    expect(ledger.settle).toHaveBeenLastCalledWith(expect.any(String), null);
    const silent = provider(); silent.create.mockResolvedValueOnce({ content: [], stop_reason: 'end_turn', usage: {} } as never);
    await withSpendingLimits(silent.client, ledger, who).beta.messages.create(request);
    expect(ledger.settle).toHaveBeenLastCalledWith(expect.any(String), null);
    const broken = fakeLedger(); broken.settle.mockRejectedValue(new SpendingLedgerUnavailable('down'));
    await expect(withSpendingLimits(provider().client, broken, who).beta.messages.create(request)).rejects.toBeInstanceOf(ProviderAccountingError);
  });

  it('releases the hold and reports cancellation when the request is cancelled before sending', async () => {
    const { client, create } = provider(); const ledger = fakeLedger();
    const controller = new AbortController();
    ledger.reserve.mockImplementationOnce(async () => { controller.abort(); return { ok: true }; });
    await expect(withSpendingLimits(client, ledger, who).beta.messages.create(request, { signal: controller.signal })).rejects.toThrow(/Cancelled/);
    expect(create).not.toHaveBeenCalled();
    expect(ledger.settle).toHaveBeenCalledWith(ledger.reserve.mock.calls[0]![0], 0);
    const counting = provider(); counting.countTokens.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const aborted = new AbortController(); aborted.abort();
    await expect(withSpendingLimits(counting.client, fakeLedger(), who).beta.messages.create(request, { signal: aborted.signal })).rejects.toThrow(/Cancelled/);
  });

  it('never claims a whole task cost nothing', () => {
    expect(refusalCopy('unavailable')).toMatch(/No further AI request was sent/);
  });

  it('names reset times in UTC', () => {
    expect(refusalCopy('month-exhausted', Date.UTC(2026, 11, 20))).toMatch(/resets on 1 January 2027/);
    expect(refusalCopy('visitor-exhausted', Date.UTC(2026, 11, 20))).toMatch(/resets at 00:00 UTC/);
  });
});

describe('choosing the hosted client', () => {
  afterEach(() => vi.unstubAllEnvs());
  const env = (values: Record<string, string>) => { for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value); };
  beforeEach(() => env({ ARCHWOVEN_MODE: 'hosted', ARCHWOVEN_FAKE: '0', ANTHROPIC_API_KEY: 'test-key-not-real', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '', ARCHWOVEN_SPEND_PREFIX: '', VERCEL: '' }));

  it('keeps unconfigured development servers as they are', () => {
    expect(spendingClient(who)).toBeUndefined();
  });

  it('refuses paid work on Vercel when limits are not configured, or configured badly', async () => {
    env({ VERCEL: '1' });
    await expect(spendingClient(who)!.beta.messages.create(request)).rejects.toThrow(/spending limits are not configured/);
    await expect(spendingClient(who)!.messages.countTokens(request)).rejects.toBeInstanceOf(ProviderRequestNotSentError);
    env({ UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:6379', UPSTASH_REDIS_REST_TOKEN: 'token', ARCHWOVEN_SPEND_PREFIX: 'archwoven:' });
    await expect(spendingClient(who)!.beta.messages.create(request)).rejects.toThrow(/spending limits are not configured/);
  });

  it('on Vercel, refuses paid work that has no verified network address', async () => {
    env({ VERCEL: '1', UPSTASH_REDIS_REST_URL: 'https://example.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'token', ARCHWOVEN_SPEND_PREFIX: 'archwoven:' });
    const network = vi.fn(async () => { throw new Error('no network in this test'); });
    vi.stubGlobal('fetch', network);
    try {
      await expect(spendingClient({ visitor: 'v', network: null })!.beta.messages.create(request)).rejects.toThrow(/No further AI request was sent/);
      expect(network).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('refuses a request that arrives without a server-issued visitor', async () => {
    env({ UPSTASH_REDIS_REST_URL: 'https://example.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'token', ARCHWOVEN_SPEND_PREFIX: 'archwoven:' });
    await expect(spendingClient(undefined)!.beta.messages.create(request)).rejects.toThrow(/temporarily unavailable/);
  });
});

describe('every hosted operation passes the reviewed-request check under spending limits', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('reserves before each provider attempt of generation, refinement, expansion and repository assembly', async () => {
    vi.stubEnv('ARCHWOVEN_FAKE', '0'); vi.stubEnv('ARCHWOVEN_HOSTED_MODEL', 'claude-opus-5-5');
    const fragment = { nodes: [], edges: [], gaps: [], sources: [], warnings: [], diagnostics: [] };
    for (const run of [
      (client: StructuredClient) => generateModel('Customer uses an API', 'architecture', { client }),
      (client: StructuredClient) => generateRefinement('rename API', validFullModelExtended, 'architecture', { client }),
      (client: StructuredClient) => expandComponent(validFullModelExtended, 'svc.orders', 'show details', { client }),
      (client: StructuredClient) => assembleRepoModel(fragment as never, { owner: 'owner', repo: 'repo', sha: 'a'.repeat(40), framework: 'FastAPI' }, { client }),
    ]) {
      const { client, create } = provider(); const ledger = fakeLedger();
      await run(withSpendingLimits(client, ledger, who));
      expect(create.mock.calls.length).toBeGreaterThan(0);
      expect(ledger.reserve.mock.calls.length).toBe(create.mock.calls.length);
      expect(ledger.settle.mock.calls.length).toBe(create.mock.calls.length);
    }
  });
});

const redis = await startTestRedis();
if (!redis && process.env.CI) throw new Error('CI must provide Redis for the spending guard tests.');
afterAll(async () => { await redis?.close(); });

describe.skipIf(!redis)('two instances racing for the last of the budget (real Redis)', () => {
  it('dispatches exactly one paid request', async () => {
    await redis!.flush();
    const open = () => openSpendingLedger({ url: redis!.url, token: redis!.token, prefix: 'archwoven-test:' });
    const hold = evaluationHoldNanos('claude-opus-5-5', 8192, inputCeiling(1000));
    await open().initialize({ start: Date.now() - 1000, end: Date.now() + 86_400_000 }, { annualNanos: hold * 10, monthNanos: hold + hold / 2, visitorDayNanos: hold + hold / 2, networkDayNanos: hold + hold / 2 });
    const a = provider(), b = provider();
    const results = await Promise.allSettled([
      withSpendingLimits(a.client, open(), { visitor: 'tab-1', network: '203.0.113.9' }).beta.messages.create(request),
      withSpendingLimits(b.client, open(), { visitor: 'tab-2', network: '198.51.100.7' }).beta.messages.create(request),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(a.create.mock.calls.length + b.create.mock.calls.length).toBe(1);
    const status = await open().status();
    expect(status!.month).toMatchObject({ heldNanos: 0, settledNanos: 1000 * 4000 + 100 * 20_000 });
  });
});
