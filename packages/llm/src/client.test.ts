import { describe, expect, it } from 'vitest';
import { generateModel, MAX_REPAIRS, STABLE_SYSTEM, faithfulSchema } from './client';
import type { StructuredClient } from './client';
import validFull from '@archwoven/model/src/fixtures/valid-full.json';
import dangling from '@archwoven/model/src/fixtures/invalid-dangling-edge.json';

const USAGE = { input_tokens: 1200, cache_creation_input_tokens: 900, cache_read_input_tokens: 0, output_tokens: 800 };

const text = (v: unknown) => [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }];

/** canned: each entry is the model's text output (object → stringified, string → raw, null → empty). */
function fakeClient(canned: (unknown | null)[]): { client: StructuredClient; calls: unknown[] } {
  const calls: unknown[] = [];
  let i = 0;
  return {
    calls,
    client: {
      beta: {
        messages: {
          create(params: unknown) {
            calls.push(params);
            const c = i < canned.length ? canned[i] : canned[canned.length - 1];
            i++;
            return Promise.resolve({ content: c === null ? [] : text(c), stop_reason: 'end_turn', usage: USAGE });
          },
        },
      },
    },
  };
}

describe('generateModel (mocked SDK)', () => {
  it('returns the model on first valid pass, zero repairs, meters usage', async () => {
    const { client, calls } = fakeClient([validFull]);
    const r = await generateModel('an e-commerce site', 'architecture', { client });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.usage.repairs).toBe(0);
      expect(r.usage.inputTokens).toBe(1200);
      expect(r.usage.model).toBe('claude-opus-5-5');
    }
    expect(calls).toHaveLength(1);
  });

  it('repairs once on graph-invalid output and feeds validator errors back', async () => {
    const { client, calls } = fakeClient([dangling, validFull]);
    const r = await generateModel('x', 'architecture', { client });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.usage.repairs).toBe(1);
    expect(calls).toHaveLength(2);
    const retry = JSON.stringify(calls[1]);
    expect(retry).toContain('svc.nonexistent'); // named error fed back
    expect(retry).toContain('failed validation');
  });

  it('gives up after MAX_REPAIRS with named errors, never loops longer', async () => {
    const { client, calls } = fakeClient([dangling]);
    const r = await generateModel('x', 'architecture', { client });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toContain('svc.nonexistent');
    expect(calls).toHaveLength(MAX_REPAIRS + 1);
  });

  it('repairs when output is not JSON, quoting the truncation reason', async () => {
    const { client, calls } = fakeClient(['```json\n{"revision":1', validFull]);
    const r = await generateModel('x', 'architecture', { client });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[1])).toContain('not complete valid JSON');
  });

  it('sends the beta header and a faithful schema that keeps enum constraints', async () => {
    const { client, calls } = fakeClient([validFull]);
    await generateModel('x', 'architecture', { client });
    const first = calls[0] as { betas: string[]; system: { text: string; cache_control?: { type: string } }[]; output_config: { format: { schema: any }; effort: string } };
    expect(first.betas).toContain('structured-outputs-2025-12-15');
    expect(first.system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(first.system[0]!.text).toBe(STABLE_SYSTEM);
    expect(first.output_config.effort).toBe('medium');
    // enum survives on the wire — the SDK's zodOutputFormat would have stripped it
    expect(first.output_config.format.schema.properties.edges.items.properties.type.enum).toEqual(['sync', 'async', 'data', 'relation', 'control']);
    expect('$defs' in faithfulSchema).toBe(false);
  });
});
