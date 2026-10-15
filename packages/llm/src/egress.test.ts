import { describe, expect, it } from 'vitest';
import { EgressBlockedError, makeEgressGuard, LOCAL_EGRESS_ALLOW } from './egress';

const spy = (calls: string[]) =>
  (async (input: unknown) => {
    calls.push(String(input));
    return new Response('{}');
  }) as unknown as typeof fetch;

describe('egress guard (§9)', () => {
  it('allows the ollama host and GitHub fetch hosts', async () => {
    const calls: string[] = [];
    const guard = makeEgressGuard(LOCAL_EGRESS_ALLOW, spy(calls));
    await guard('http://localhost:11434/api/chat');
    await guard('http://127.0.0.1:11434/api/chat');
    await guard('https://api.github.com/repos/o/r');
    await guard('https://codeload.github.com/o/r/tar.gz/abc');
    expect(calls).toHaveLength(4);
  });

  it('refuses external inference and any other host, naming the host, inner never called', async () => {
    const calls: string[] = [];
    const guard = makeEgressGuard(LOCAL_EGRESS_ALLOW, spy(calls));
    const r1 = await guard('https://api.anthropic.com/v1/messages').catch((e: unknown) => e);
    expect(r1).toBeInstanceOf(EgressBlockedError);
    expect((r1 as EgressBlockedError).host).toBe('api.anthropic.com');
    const r2 = await guard('https://evil.example/x').catch((e: unknown) => e);
    expect((r2 as Error).message).toContain('evil.example');
    expect(calls).toHaveLength(0);
  });

  it('LOCAL_EGRESS_ALLOW is exactly the ollama + GitHub hosts (§9 allowlist)', () => {
    expect([...LOCAL_EGRESS_ALLOW].sort()).toEqual([
      '127.0.0.1:11434',
      'api.github.com',
      'codeload.github.com',
      'localhost:11434',
    ]);
  });
});
