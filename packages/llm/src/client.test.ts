import { describe, expect, it } from 'vitest';
import { generateModel, makeAnthropic, MAX_REPAIRS, MAX_TOKENS, STABLE_SYSTEM, faithfulSchema } from './client';

/** The JSON schema the hosted system prompt shows the model. */
const hostedContract = () => JSON.parse(STABLE_SYSTEM.split('<model-json-schema>\n')[1]!.split('\n</model-json-schema>')[0]!);
import type { StructuredClient } from './client';
import validFull from '@archwoven/model/src/fixtures/valid-full.json';
import dangling from '@archwoven/model/src/fixtures/invalid-dangling-edge.json';

const USAGE = { input_tokens: 1200, cache_creation_input_tokens: 900, cache_read_input_tokens: 0, output_tokens: 800 };

const text = (v: unknown) => [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }];

/** canned: each entry is the model's text output (object → stringified, string → raw, null → empty). */
function fakeClient(canned: (unknown | null)[], opts: { countedTokens?: number; countFails?: boolean } = {}): { client: StructuredClient; calls: unknown[] } {
  const calls: unknown[] = [];
  let i = 0;
  return {
    calls,
    client: {
      messages: {
        countTokens() {
          if (opts.countFails) return Promise.reject(new Error('count unavailable'));
          return Promise.resolve({ input_tokens: opts.countedTokens ?? 500 });
        },
      },
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
  it('repairs a new ER model that silently omits cardinality instead of saving it as complete', async () => {
    const incomplete = structuredClone(validFull);
    delete incomplete.edges.find(e => e.id === 'er.user-order')!.cardinality;
    const { client, calls } = fakeClient([incomplete, validFull]);
    const out = await generateModel('Users have many orders', 'er', { client });
    expect(out.ok).toBe(true); expect(out.usage.repairs).toBe(1); expect(calls).toHaveLength(2);
  });
  it('shows hosted generation the evidence, field and sequence shapes instead of opaque encoded strings', () => {
    const contract = hostedContract();
    const node = contract.properties.nodes.items.properties;
    expect(node).not.toHaveProperty('evidenceJson');
    expect(node.evidence.type).toBe('array');
    expect(Object.keys(node.evidence.items.properties)).toEqual(expect.arrayContaining(['path', 'lines', 'note']));
    const fields = JSON.stringify(node.fields);
    for (const shape of ['"name"', '"type"', '"pk"', '"fk"', '"uk"']) expect(fields).toContain(shape);
    const sequence = JSON.stringify(contract.properties.views.items.properties.sequence);
    for (const shape of ['"participants"', '"messages"', '"fragment"', '"covers"', '"opt"']) expect(sequence).toContain(shape);
  });
  it('accepts a complete model wrapped in one Markdown code fence without a repair round', async () => {
    const fenced = fakeClient(['```json\n' + JSON.stringify(validFull, null, 2) + '\n```']);
    const out = await generateModel('x', 'architecture', { client: fenced.client });
    expect(out.ok).toBe(true); expect(out.usage.repairs).toBe(0); expect(fenced.calls).toHaveLength(1);
  });
  it('still asks for a repair when text surrounds the JSON beyond a single fence', async () => {
    for (const reply of ['Here is the model:\n```json\n' + JSON.stringify(validFull) + '\n```', '```json\n{}\n```\n```json\n' + JSON.stringify(validFull) + '\n```']) {
      const { client, calls } = fakeClient([reply, validFull]);
      const out = await generateModel('x', 'architecture', { client });
      expect(out.ok).toBe(true); expect(out.usage.repairs).toBe(1); expect(calls).toHaveLength(2);
    }
  });
  it('accepts native evidence objects on the first attempt and still decodes wire-encoded output', async () => {
    const native = structuredClone(validFull);
    native.nodes[0]!.evidence = [{ note: 'stated in the description' }];
    const first = fakeClient([native]);
    const out = await generateModel('x', 'architecture', { client: first.client });
    expect(out.ok).toBe(true); expect(out.usage.repairs).toBe(0); expect(first.calls).toHaveLength(1);
    const { evidence, ...rest } = native.nodes[0]!;
    const wire = { ...native, nodes: [{ ...rest, evidenceJson: JSON.stringify(evidence) }, ...native.nodes.slice(1)] };
    const legacy = await generateModel('x', 'architecture', { client: fakeClient([wire]).client });
    expect(legacy.ok).toBe(true); expect(legacy.ok && legacy.model.nodes[0]!.evidence).toEqual([{ note: 'stated in the description' }]);
  });
  it('decodes hosted wire evidence, ER fields and complete sequence metadata before validation', async () => {
    const wire = {
      schemaVersion: '1', revision: 1, title: 'Hosted sequence',
      nodes: [
        { id: 'actor.user', kind: 'actor', label: 'User', provenance: 'inferred', evidenceJson: '[{"note":"request actor"}]' },
        { id: 'svc.api', kind: 'service', label: 'API', provenance: 'source-supported', evidenceJson: '[{"path":"main.py"}]' },
        { id: 'entity.user', kind: 'entity', label: 'User record', provenance: 'source-supported', fieldsJson: '[{"name":"id","type":"uuid","key":"pk"}]' },
      ],
      edges: [],
      views: [{ id: 'view.sequence', type: 'sequence', nodes: ['actor.user', 'svc.api'], edges: [], sequenceJson: '{"participants":["actor.user","svc.api"],"messages":[{"seq":1,"from":"actor.user","to":"svc.api","label":"GET /users","kind":"call"}]}' }],
      privacy: { classification: 'public', boundary: 'external-allowed' },
    };
    const { client } = fakeClient([wire]);
    const out = await generateModel('read users', 'sequence', { client });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.usage.repairs).toBe(0);
    expect(out.model.nodes[1]!.evidence).toEqual([{ path: 'main.py' }]);
    expect(out.model.nodes[2]!.fields).toEqual([{ name: 'id', type: 'uuid', key: 'pk' }]);
    expect(out.model.views[0]!.sequence).toEqual({ participants: ['actor.user', 'svc.api'], messages: [{ seq: 1, from: 'actor.user', to: 'svc.api', label: 'GET /users', kind: 'call' }] });
  });

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

  it('sends no grammar on hosted generate — prompt carries the shape, validateModel enforces it', async () => {
    const { client, calls } = fakeClient([validFull]);
    await generateModel('x', 'architecture', { client });
    const first = calls[0] as { betas?: string[]; system: { text: string; cache_control?: { type: string } }[]; output_config?: unknown };
    // SystemModelSchema exceeds the API's grammar limits (verified live) —
    // the grammar must NOT be on the wire; the prompt + repair loop enforce it.
    expect(first.output_config).toBeUndefined();
    expect(first.betas).toBeUndefined();
    expect(first.system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(first.system[0]!.text).toBe(STABLE_SYSTEM);
    const contractText = first.system[0]!.text.split('<model-json-schema>')[1]?.split('</model-json-schema>')[0];
    expect(contractText, 'hosted generation must receive its output contract in the prompt').toBeDefined();
    const contract = JSON.parse(contractText!);
    expect(contract.properties.views.items.properties.type.enum).toEqual(['architecture', 'sequence', 'er', 'component-detail']);
    expect(contract.properties.nodes.items.properties.evidence.type).toBe('array');
    expect(contract.properties.views.items.properties).toHaveProperty('sequence');
  });

  it('wire schema carries no unsupported constraint keywords — Anthropic structured outputs 400s on them', () => {
    const UNSUPPORTED = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
      'maxItems', 'uniqueItems', 'contains', 'minLength', 'maxLength', 'pattern', 'format',
      'contentEncoding', 'contentMediaType'];
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (n && typeof n === 'object') {
        const o = n as Record<string, unknown>;
        for (const k of UNSUPPORTED) expect(o).not.toHaveProperty(k);
        if ('minItems' in o) expect([0, 1]).toContain(o.minItems); // only 0|1 supported
        if (o.type === 'object' && o.properties) expect(o.additionalProperties).toBe(false); // strict required
        if (o.type === 'object' && !o.properties) expect(typeof o.additionalProperties).not.toBe('object'); // records → strings
        Object.values(o).forEach(walk);
      }
    };
    walk(faithfulSchema);
    // the grammar that must survive:
    expect((faithfulSchema.properties as Record<string, unknown>).revision).toEqual({ type: 'integer' });
    expect(((faithfulSchema.properties as any).edges.items.properties.type as { enum: string[] }).enum).toEqual(['sync', 'async', 'data', 'relation', 'control']);
    // layout is server-computed — the model never emits it
    expect(faithfulSchema.properties).not.toHaveProperty('layout');
  });

  it('sends max_tokens at the fixed ceiling, never above', async () => {
    const { client, calls } = fakeClient([validFull]);
    await generateModel('x', 'architecture', { client });
    expect((calls[0] as { max_tokens: number }).max_tokens).toBe(8192);
    expect(MAX_TOKENS).toBeLessThanOrEqual(8192);
  });

  it('accumulates billed usage across every attempt (metering)', async () => {
    const { client } = fakeClient(['```json\n{"revision":1', validFull]);
    const r = await generateModel('x', 'architecture', { client });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // both attempts were billed by Anthropic; the old code logged only the last
      expect(r.usage.outputTokens).toBe(USAGE.output_tokens * 2);
      expect(r.usage.inputTokens).toBe(USAGE.input_tokens * 2);
    }
  });

  it('counts tokens before send and rejects oversized context without calling the model', async () => {
    const { client, calls } = fakeClient([validFull], { countedTokens: 30_000 });
    const r = await generateModel('x', 'architecture', { client });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/oversized|too large|scope/i);
    expect(calls).toHaveLength(0);
  });

  it('fails closed when the token count is unavailable — no uncounted sends', async () => {
    const { client, calls } = fakeClient([validFull], { countFails: true });
    const r = await generateModel('x', 'architecture', { client });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('pins baseURL to api.anthropic.com even when a proxy env var is set', () => {
    const prev = process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:2018/v1';
    try {
      expect(makeAnthropic('sk-test').baseURL).toBe('https://api.anthropic.com');
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = prev;
    }
  });
});

describe('STABLE_SYSTEM — semantic fields', () => {
  it('documents optional semanticChecks/mainPath/guidedViews', () => {
    expect(STABLE_SYSTEM).toContain('semanticChecks');
    expect(STABLE_SYSTEM).toContain('mainPath');
    expect(STABLE_SYSTEM).toContain('guidedViews');
  });
});


describe('description clarification decision', () => {
  it('returns focused questions and billed usage instead of forcing a model on conflicting requirements', async () => {
    const { client } = fakeClient([{ clarificationQuestions: ['Should orders persist, or must all storage be forbidden?'] }]);
    const out = await generateModel('Persist orders. Do not store any data.', 'architecture', { client, allowClarification: true });
    expect(out).toMatchObject({ ok: true, questions: ['Should orders persist, or must all storage be forbidden?'], usage: { inputTokens: 1200, outputTokens: 800 } });
  });
  it.each([[], [' '], ['a','b','c','d'], ['Same?', 'Same?'], ['x'.repeat(501)]].map(questions => ({questions})))('repairs invalid question lists without displaying them: $questions', async ({questions}) => {
    const { client } = fakeClient([{ clarificationQuestions: questions }, validFull]);
    const out = await generateModel('A system', 'architecture', { client, allowClarification: true });
    expect(out).toMatchObject({ ok: true, model: { title: validFull.title }, usage: { repairs: 1 } });
  });
  it('does not ask another round when clarification is disabled for continuation', async () => {
    const { client } = fakeClient([{ clarificationQuestions: ['Again?'] }, validFull]);
    const out = await generateModel('Use no storage.', 'architecture', { client });
    expect(out).toMatchObject({ ok: true, model: { title: validFull.title }, usage: { repairs: 1 } });
  });
});


it('clear descriptions still produce a model in one decision call',async()=>{
  const {client,calls}=fakeClient([validFull]);
  const out=await generateModel('A client sends orders to an API which writes them to PostgreSQL.', 'architecture',{client,allowClarification:true});
  expect(out).toMatchObject({ok:true,model:{title:validFull.title},usage:{repairs:0}});expect(calls).toHaveLength(1);
});

describe('reported task usage', () => {
  it('keeps transport retries separate from actual repair submissions', async () => {
    let attempt = 0;
    const client: StructuredClient = {
      messages: { countTokens: async () => ({ input_tokens: 10 }) },
      beta: { messages: { create: async () => {
        if (attempt++ === 0) throw new Error('transport unavailable');
        return { content: [{ type: 'text', text: JSON.stringify(attempt === 2 ? dangling : validFull) }], stop_reason: 'end_turn', usage: USAGE };
      } } },
    };
    const out = await generateModel('shop', 'architecture', { client });
    expect(out.ok).toBe(true);
    expect(out.usage).toMatchObject({ provider: 'anthropic', repairs: 1, transportRetries: 1, usageComplete: false, inputTokens: 2400 });
    expect(out.usage.attempts.map(part => part.kind)).toEqual(['initial', 'retry', 'repair']);
  });
  it('does not count a prepared repair that cancellation prevents from being sent', async () => {
    const controller = new AbortController();
    const client: StructuredClient = {
      messages: { countTokens: async () => ({ input_tokens: 10 }) },
      beta: { messages: { create: async () => {
        controller.abort();
        return { content: [{ type: 'text', text: JSON.stringify(dangling) }], stop_reason: 'end_turn', usage: USAGE };
      } } },
    };
    const out = await generateModel('shop', 'architecture', { client, signal: controller.signal });
    expect(out.ok).toBe(false);
    expect(out.usage.repairs).toBe(0);
    expect(out.usage.attempts).toHaveLength(1);
    expect(out.usage.usageComplete).toBe(true);
  });
  it('disables SDK retries so one adapter attempt cannot hide additional calls', () => {
    expect(makeAnthropic('sk-test').maxRetries).toBe(0);
  });
});
