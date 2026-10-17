import { describe, expect, it } from 'vitest';
import { validFullModelExtended, type SystemModel } from '@archwoven/model';
import type { Fragment } from '@archwoven/extract';
import type { StructuredClient } from './client';
import { generateModel } from './client';
import { generateRefinement } from './refine';
import { expandComponent } from './expand';
import { assembleRepoModel } from './repo';

// Assembled at runtime so no secret-shaped literal sits in the repository.
const KEY = ['sk-', 'ant-', 'api03-'].join('') + 'Q'.repeat(93) + 'AA';
const REFUSAL = 'Archwoven stopped this request because it contained what looks like an Anthropic API key. Nothing was sent to the AI provider.';

function recordingClient() {
  const calls: string[] = [];
  const client = {
    messages: { countTokens: async () => { calls.push('count'); return { input_tokens: 10 }; } },
    beta: { messages: { create: async () => { calls.push('create'); return { content: [{ type: 'text', text: '[]' }], stop_reason: 'end_turn', usage: {} }; } } },
  } as unknown as StructuredClient;
  return { client, calls };
}
const withKeyLabel = (): SystemModel => { const m = structuredClone(validFullModelExtended); m.nodes.find(n => n.id === 'gateway.api')!.label = `Gateway ${KEY}`; return m; };

describe('every hosted request is scanned before it leaves', () => {
  it('generation', async () => {
    const { client, calls } = recordingClient();
    const out = await generateModel(`A gateway configured with ${KEY}`, 'architecture', { client });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors).toEqual([REFUSAL]);
    expect(calls).toEqual([]);
  });

  it('refinement carrying a secret inside the model', async () => {
    const { client, calls } = recordingClient();
    const out = await generateRefinement('rename the gateway', withKeyLabel(), 'architecture', { client });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors).toEqual([REFUSAL]);
    expect(calls).toEqual([]);
  });

  it('expansion carrying a secret in a neighbour', async () => {
    const { client, calls } = recordingClient();
    const out = await expandComponent(withKeyLabel(), 'svc.orders', '', { client });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors).toEqual([REFUSAL]);
    expect(calls).toEqual([]);
  });

  it('repository assembly that was not masked', async () => {
    const { client, calls } = recordingClient();
    const fragment = { nodes: [{ id: 'svc.api', kind: 'service', label: `API ${KEY}`, provenance: 'source-supported', evidence: [] }], edges: [], endpoints: [], gaps: [] } as unknown as Fragment;
    const out = await assembleRepoModel(fragment, { owner: 'o', repo: 'r', sha: 'a'.repeat(40), framework: 'fastapi' }, { client });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors).toEqual([REFUSAL]);
    expect(calls).toEqual([]);
  });
});
