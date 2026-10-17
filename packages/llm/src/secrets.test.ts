import { describe, expect, it, vi } from 'vitest';
import { findSecrets, guardEgress, maskFragmentSecrets, maskSecrets, secretRefusal, SecretEgressError } from './secrets';
import type { StructuredClient } from './client';

// Secret-shaped test values are assembled at runtime so no literal token ever sits in the repository.
const chars = (n: number, abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') => Array.from({ length: n }, (_, i) => abc[(i * 7 + 3) % abc.length]).join('');
const b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const FAKE = {
  github: ['gh', 'p_'].join('') + chars(36),
  anthropic: ['sk-', 'ant-', 'api03-'].join('') + chars(93) + 'AA',
  openai: ['sk-', 'proj-'].join('') + chars(74) + ['T3Blbk', 'FJ'].join('') + chars(74),
  stripe: ['sk_', 'live_'].join('') + chars(24),
  slack: ['xo', 'xb-'].join('') + chars(11, '0123456789') + '-' + chars(12, '0123456789') + '-' + chars(24),
  awsSecret: `AWS_ACCESS_KEY_ID=${['AK', 'IA'].join('')}${chars(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567')}\nAWS_SECRET_ACCESS_KEY=${chars(40, b64)}`,
  privateKey: `-----BEGIN RSA ${'PRIVATE'} KEY-----\nMII${chars(61, b64)}\n${chars(64, b64)}\n${chars(64, b64)}\n-----END RSA ${'PRIVATE'} KEY-----`,
  dbUrl: ['postgres', '://admin:', 'S3cr3tPassw0rd', '@db.internal:5432/app'].join(''),
  basicAuth: ['https://deploy:', 'Hunter2Secret', '@internal.example.com/api'].join(''),
};

describe('findSecrets (precise provider rules)', () => {
  it.each([
    ['github', FAKE.github, 'GitHub token'],
    ['anthropic', FAKE.anthropic, 'Anthropic API key'],
    ['openai', FAKE.openai, 'OpenAI API key'],
    ['stripe', FAKE.stripe, 'Stripe key'],
    ['slack', FAKE.slack, 'Slack token'],
    ['aws', FAKE.awsSecret, 'AWS secret key'],
    ['private key', FAKE.privateKey, 'private key'],
    ['database url', FAKE.dbUrl, 'database connection string'],
    ['basic auth url', FAKE.basicAuth, 'URL with a password'],
  ])('finds a %s with its exact range', async (_name, secret, kind) => {
    const text = `before\n${secret}\nafter`;
    const found = await findSecrets(text);
    expect(found.map(f => f.kind)).toContain(kind);
    const f = found.find(x => x.kind === kind)!;
    expect(f.start).toBeGreaterThanOrEqual(7);
    expect(f.end).toBeLessThanOrEqual(7 + secret.length);
    expect(f.line).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ['architecture prose', 'An online bookstore with a catalog service, PostgreSQL and Stripe payments.'],
    ['ids and hashes', 'id 3fa85f64-5717-4562-b3fc-2c963f66afa6 sha d66599cceb3a151f64d45eb1cc46afe59c386c1f'],
    ['an AWS access key id alone', `key id ${['AK', 'IA'].join('')}${chars(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567')}`],
    ['a placeholder private key', `-----BEGIN RSA ${'PRIVATE'} KEY-----\n...\n-----END RSA ${'PRIVATE'} KEY-----`],
    ['a password word in prose', 'Users reset their password through the auth service; tokens expire after 15 minutes.'],
  ])('does not flag %s', async (_name, text) => {
    expect(await findSecrets(text)).toEqual([]);
  });
});

describe('secretRefusal (typed text is blocked, never sent)', () => {
  it('names the field, the kind and the line, and promises nothing was sent or charged', async () => {
    const message = await secretRefusal([{ label: 'Your description', text: `An API gateway.\nUse ${FAKE.github} for deploys.` }]);
    expect(message).toBe('Your description contains what looks like a GitHub token on line 2. Remove it and try again. Archwoven never sends detected secrets to the AI provider, and no credit was used.');
  });

  it('lists several findings across fields once each', async () => {
    const message = await secretRefusal([
      { label: 'Your instruction', text: `rotate ${FAKE.stripe}` },
      { label: 'Answer 2', text: `${FAKE.dbUrl}\n${FAKE.dbUrl}` },
    ]);
    expect(message).toBe('Your instruction contains what looks like a Stripe key on line 1; Answer 2 contains what looks like a database connection string on lines 1 and 2. Remove them and try again. Archwoven never sends detected secrets to the AI provider, and no credit was used.');
  });

  it('returns null for clean text, and never applies the generic credential rule to typed text', async () => {
    expect(await secretRefusal([{ label: 'Your description', text: 'The config sets password = "Tr0ub4dor&3" for the demo.' }])).toBeNull();
  });
});

describe('maskSecrets (repository content is masked, not blocked)', () => {
  it('replaces exactly the secret ranges and reports what was masked', async () => {
    const text = `token = "${FAKE.github}"\nurl = "${FAKE.dbUrl}"`;
    const { text: masked, findings } = await maskSecrets(text);
    expect(masked).toBe('token = "[REDACTED:GitHub token]"\nurl = "[REDACTED:database connection string]"');
    expect(findings.map(f => f.kind)).toEqual(['GitHub token', 'database connection string']);
  });

  it.each([
    ['a quoted password literal', 'DB_PASSWORD = "Tr0ub4dor&3xyz"', 'DB_PASSWORD = "[REDACTED:credential]"'],
    ['a JSON client secret', '{"client_secret": "a8f5f167f44f4964e6c998dee827110c"}', '{"client_secret": "[REDACTED:credential]"}'],
    ['a YAML api key', 'api_key: Zx9!q2Lr7#wB', 'api_key: [REDACTED:credential]'],
    ['a Django secret key', 'SECRET_KEY = "django-insecure-8dyfuiRyq=vVc3RRr"', 'SECRET_KEY = "[REDACTED:credential]"'],
    ['an AWS secret access key setting', "aws_secret_access_key = 'q2Lr7wBZx9q2Lr7wBZx9'", "aws_secret_access_key = '[REDACTED:credential]'"],
  ])('masks %s with the generic credential rule', async (_name, text, expected) => {
    expect((await maskSecrets(text)).text).toBe(expected);
  });

  it.each([
    ['an environment lookup', 'password = os.getenv("DB_PASSWORD")'],
    ['a code reference', 'token = settings.API_TOKEN'],
    ['an interpolated value', 'password: ${DB_PASSWORD}'],
    ['a placeholder', 'api_key = "your-api-key-here"'],
    ['a template placeholder', 'secret = "<replace-me>"'],
    ['a short value', 'token = "abc"'],
    ['a flag whose name merely contains a credential word', '$ secretlint "**/*" --secretlintrc=.secretlintrc.custom.json'],
    ['a token endpoint URL', 'token_url = "https://auth.example.com/oauth/token"'],
    ['a password file path', 'password_file: "/run/secrets/db_password.txt"'],
    ['a key file name', 'private_key = "deploy-key.pem"'],
  ])('leaves %s alone', async (_name, text) => {
    expect((await maskSecrets(text)).text).toBe(text);
  });
});

describe('maskFragmentSecrets', () => {
  it('masks every string in a fragment consistently, counts by kind and leaves the input untouched', async () => {
    const fragment = {
      nodes: [{ id: 'mod.config', label: 'config.py', evidence: [{ path: 'config.py', note: `uses ${FAKE.stripe}` }] }],
      edges: [{ id: 'e1', from: 'mod.config', to: 'mod.config' }],
      sourceContext: { samples: [{ path: 'config.py', text: `STRIPE = "${FAKE.stripe}"\nDB_PASSWORD = "Tr0ub4dor&3xyz"` }] },
    };
    const before = structuredClone(fragment);
    const out = await maskFragmentSecrets(fragment);
    expect(fragment).toEqual(before);
    expect(out.fragment.sourceContext.samples[0]!.text).toBe('STRIPE = "[REDACTED:Stripe key]"\nDB_PASSWORD = "[REDACTED:credential]"');
    expect(out.fragment.nodes[0]!.evidence[0]!.note).toBe('uses [REDACTED:Stripe key]');
    expect(out.fragment.edges[0]).toEqual({ id: 'e1', from: 'mod.config', to: 'mod.config' });
    expect(out.counts).toEqual({ 'Stripe key': 2, credential: 1 });
    expect(out.disclosure).toBe('Masked 3 likely secrets (2 Stripe keys, 1 credential) before analysis; their values were never sent to the AI provider.');
  });

  it('reports nothing for a clean fragment', async () => {
    const out = await maskFragmentSecrets({ nodes: [{ id: 'a', label: 'main.go' }] });
    expect(out.disclosure).toBeNull();
    expect(out.counts).toEqual({});
  });
});

describe('guardEgress (defense in depth at the provider boundary)', () => {
  const inner = () => {
    const calls: string[] = [];
    const client = {
      messages: { countTokens: vi.fn(async () => { calls.push('count'); return { input_tokens: 10 }; }) },
      beta: { messages: { create: vi.fn(async () => { calls.push('create'); return { content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn', usage: {} }; }) } },
    } as unknown as StructuredClient;
    return { client, calls };
  };

  it('refuses token counting and requests that carry a secret, without calling the provider', async () => {
    const { client, calls } = inner();
    const guarded = guardEgress(client);
    const params = { model: 'm', system: [{ type: 'text', text: 'system' }], messages: [{ role: 'user', content: `model JSON {"label":"${FAKE.anthropic}"}` }] };
    await expect(guarded.messages.countTokens(params)).rejects.toBeInstanceOf(SecretEgressError);
    await expect(guarded.beta.messages.create(params)).rejects.toThrow('Archwoven stopped this request because it contained what looks like an Anthropic API key. Nothing was sent to the AI provider.');
    expect(calls).toEqual([]);
  });

  it('passes clean requests through unchanged', async () => {
    const { client, calls } = inner();
    const guarded = guardEgress(client);
    const params = { model: 'm', system: [{ type: 'text', text: 'system' }], messages: [{ role: 'user', content: 'An API gateway in front of an order service. [REDACTED:credential]' }] };
    await guarded.messages.countTokens(params);
    await guarded.beta.messages.create(params, { signal: undefined });
    expect(calls).toEqual(['count', 'create']);
    expect(client.beta.messages.create).toHaveBeenCalledWith(params, { signal: undefined });
  });
});
