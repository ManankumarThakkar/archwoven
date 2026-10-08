import { describe, expect, it } from 'vitest';
import { generateModel, MAX_REPAIRS, STABLE_SYSTEM } from './client';
import type { ParseClient } from './client';
import validFull from '@archwoven/model/src/fixtures/valid-full.json';
import dangling from '@archwoven/model/src/fixtures/invalid-dangling-edge.json';

const USAGE = {
  input_tokens: 1200,
  cache_creation_input_tokens: 900,
  cache_read_input_tokens: 0,
  output_tokens: 800,
};

type Canned = { parsed_output: unknown } | null;

function fakeClient(canned: Canned[]): { client: ParseClient; calls: unknown[] } {
  const calls: unknown[] = [];
  let i = 0;
  return {
    calls,
    client: {
      messages: {
        parse(params: unknown) {
          calls.push(params);
          // null is a *canned* value (parsed_output null), distinct from out-of-range
          const c: Canned = i < canned.length ? canned[i]! : canned[canned.length - 1]!;
          i++;
          return Promise.resolve({ parsed_output: c === null ? null : c.parsed_output, usage: USAGE });
        },
      },
    },
  };
}

describe('generateModel (mocked SDK)', () => {
  it('returns the model on first valid pass, zero repairs, meters usage', async () => {
    const { client, calls } = fakeClient([{ parsed_output: validFull }]);
    const r = await generateModel('an e-commerce site', 'architecture', { client });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.usage.repairs).toBe(0);
      expect(r.usage.inputTokens).toBe(1200);
      expect(r.usage.cacheWriteTokens).toBe(900);
      expect(r.usage.model).toBe('claude-opus-5-5');
    }
    expect(calls).toHaveLength(1);
  });

  it('repairs once on graph-invalid output and feeds validator errors back', async () => {
    const { client, calls } = fakeClient([{ parsed_output: dangling }, { parsed_output: validFull }]);
    const r = await generateModel('x', 'architecture', { client });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.usage.repairs).toBe(1);
    expect(calls).toHaveLength(2);
    const retry = JSON.stringify(calls[1]);
    expect(retry).toContain('svc.nonexistent'); // named error fed back
    expect(retry).toContain('failed validation');
  });

  it('gives up after MAX_REPAIRS with named errors, never loops longer', async () => {
    const { client, calls } = fakeClient([{ parsed_output: dangling }]);
    const r = await generateModel('x', 'architecture', { client });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toContain('svc.nonexistent');
    expect(calls).toHaveLength(MAX_REPAIRS + 1); // initial + 2 repairs
  });

  it('treats a null parsed_output as invalid and repairs', async () => {
    const { client, calls } = fakeClient([null, { parsed_output: validFull }]);
    const r = await generateModel('x', 'architecture', { client });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('repairs when messages.parse throws (truncated/malformed structured output)', async () => {
    const calls: unknown[] = [];
    let i = 0;
    const client: ParseClient = {
      messages: {
        parse(params: unknown) {
          calls.push(params);
          if (i++ === 0) return Promise.reject(new Error("Failed to parse structured output as JSON: Expected property name or '}' in JSON at position 3959"));
          return Promise.resolve({ parsed_output: validFull, usage: USAGE });
        },
      },
    };
    const r = await generateModel('x', 'architecture', { client });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.usage.repairs).toBe(1);
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[1])).toContain('not valid JSON');
  });

  it('returns ok:false instead of throwing when every attempt fails to parse', async () => {
    const client: ParseClient = {
      messages: { parse: () => Promise.reject(new Error('Failed to parse structured output as JSON')) },
    };
    const r = await generateModel('x', 'architecture', { client });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/parse|JSON/i);
  });

  it('sends a stable cacheable system prefix with cache_control', async () => {
    const { client, calls } = fakeClient([{ parsed_output: validFull }]);
    await generateModel('x', 'architecture', { client });
    const first = calls[0] as {
      system: { text: string; cache_control?: { type: string } }[];
      output_config: { format: unknown; effort: string };
    };
    expect(first.system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(first.system[0]!.text).toBe(STABLE_SYSTEM);
    expect(first.output_config.format).toBeDefined();
    expect(first.output_config.effort).toBe('medium');
  });
});
