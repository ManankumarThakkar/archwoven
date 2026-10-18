import { afterEach, describe, expect, it, vi } from 'vitest';
import { validFullModelExtended } from '@archwoven/model';
import { extractGeneric } from '@archwoven/extract';
import { generateModel, type StructuredClient } from './client';
import { assembleRepoModel } from './repo';
import { generateRefinement } from './refine';
import { expandComponent, fakeExpansion } from './expand';

afterEach(() => vi.unstubAllEnvs());

describe.each(['claude-sonnet-5-5', 'claude-haiku-5-5'])('hosted model %s', selectedModel => {
  it.each(['generation', 'repository', 'refinement', 'expansion'])('uses the same selected model for counting, %s repairs and reporting', async action => {
    vi.stubEnv('ARCHWOVEN_HOSTED_MODEL', selectedModel);
    const model = structuredClone(validFullModelExtended);
    const fragment = extractGeneric(['worker.py'], () => 'def run(): pass\n');
    const replies: Record<string, unknown> = {
      generation: model,
      repository: { title: 'Worker', openQuestions: [], guidedViews: [] },
      refinement: [{ op: 'update', target: 'svc.orders', patch: { label: 'Checkout' }, baseRevision: model.revision, summary: 'Rename orders' }],
      expansion: fakeExpansion(model, 'svc.orders'),
    };
    const requested: string[] = [];
    const counted: string[] = [];
    const client: StructuredClient = {
      messages: { countTokens: async params => { counted.push(params.model); return { input_tokens: 1000 }; } },
      beta: { messages: { create: async params => {
        requested.push((params as { model: string }).model);
        // Prove a task pins its chosen model even if server configuration changes mid-flight.
        vi.stubEnv('ARCHWOVEN_HOSTED_MODEL', 'claude-opus-5-5');
        return { content: [{ type: 'text', text: requested.length === 1 ? 'invalid JSON' : JSON.stringify(replies[action]) }], stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 200 } };
      } } },
    };
    const result = action === 'generation' ? await generateModel('An order service', 'architecture', { client })
      : action === 'repository' ? await assembleRepoModel(fragment, { owner: 'example', repo: 'worker', sha: 'a'.repeat(40), framework: 'generic' }, { client })
      : action === 'refinement' ? await generateRefinement('Rename orders to Checkout', model, 'architecture', { client })
      : await expandComponent(model, 'svc.orders', '', { client });
    expect(result.ok).toBe(true);
    expect(counted).toEqual([selectedModel]);
    expect(requested).toEqual([selectedModel, selectedModel]);
    expect(result.usage).toMatchObject({ provider: 'anthropic', model: selectedModel, repairs: 1, inputTokens: 2000, outputTokens: 400 });
  });
});

it('rejects an unsupported model before reaching the provider', async () => {
  vi.stubEnv('ARCHWOVEN_HOSTED_MODEL', 'unsupported');
  const client: StructuredClient = {
    messages: { countTokens: async () => { throw new Error('provider must not be reached'); } },
    beta: { messages: { create: async () => { throw new Error('provider must not be reached'); } } },
  };
  await expect(generateModel('An API', 'architecture', { client })).rejects.toThrow(/Unsupported ARCHWOVEN_HOSTED_MODEL/);
});
