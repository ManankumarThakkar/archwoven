import { describe, expect, it } from 'vitest';
import { validFullModel } from '@archwoven/model';
import { generateModelLocal, LOCAL_MODEL } from './local';

const enc = new TextEncoder();

function ndjsonResponse(contentChunks: string[], counts = { prompt_eval_count: 1200, eval_count: 800 }): Response {
  const lines = contentChunks.map((c) => JSON.stringify({ message: { content: c } }));
  lines.push(JSON.stringify({ message: { content: '' }, done: true, ...counts }));
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(`${l}\n`));
      c.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson' } });
}

describe('generateModelLocal (Ollama adapter)', () => {
  it('streams NDJSON, parses the model, and records TTFT + token usage', async () => {
    const json = JSON.stringify(validFullModel);
    const mid = Math.floor(json.length / 2);
    const resps: Response[] = [];
    const fakeFetch = (async () => {
      const r = ndjsonResponse([json.slice(0, mid), json.slice(mid)]);
      resps.push(r);
      return r;
    }) as unknown as typeof fetch;

    const out = await generateModelLocal('shop', 'architecture', { fetchImpl: fakeFetch });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.model.title).toBe(validFullModel.title);
    const u = out.usage as typeof out.usage & { ttftMs: number };
    expect(u.ttftMs).toBeGreaterThanOrEqual(0);
    expect(u.outputTokens).toBe(800);
    expect(u.model).toBe(LOCAL_MODEL);
  });

  it('feeds validator errors back and repairs within MAX_REPAIRS', async () => {
    const broken = JSON.stringify({ ...validFullModel, nodes: validFullModel.nodes.slice(1) });
    const good = JSON.stringify(validFullModel);
    const bodies: string[] = [];
    let call = 0;
    const fakeFetch = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(String(init?.body));
      call++;
      return ndjsonResponse([call === 1 ? broken : good]);
    }) as unknown as typeof fetch;

    const out = await generateModelLocal('shop', 'architecture', { fetchImpl: fakeFetch });
    expect(out.ok).toBe(true);
    expect(call).toBe(2);
    expect(bodies[1]).toContain('failed validation');
    expect(out.usage.repairs).toBe(1);
  });

  it('requests constrained decoding with the SystemModel JSON schema, streamed', async () => {
    let body: Record<string, unknown> = {};
    const fakeFetch = (async (_url: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return ndjsonResponse([JSON.stringify(validFullModel)]);
    }) as unknown as typeof fetch;

    await generateModelLocal('shop', 'architecture', { fetchImpl: fakeFetch });
    expect(body.model).toBe(LOCAL_MODEL);
    expect(body.stream).toBe(true);
    const format = body.format as { type: string; properties: Record<string, { const?: string }> };
    expect(format.type).toBe('object');
    expect(format.properties.schemaVersion!.const).toBe('1');
  });
});
