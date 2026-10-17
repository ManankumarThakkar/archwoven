import { lintSource } from '@secretlint/core';
import { creator as recommended } from '@secretlint/secretlint-rule-preset-recommend';
import type { StructuredClient } from './client';

/**
 * Secret detection before anything leaves for a hosted provider (SPEC §9, best-effort).
 * Precise provider rules (secretlint's recommended preset, pinned) decide what typed text
 * may be sent; repository content is additionally masked with a generic credential rule,
 * because a masked false positive costs nothing while a leaked value cannot be recalled.
 */
export interface SecretFinding { kind: string; start: number; end: number; line: number }

const CONFIG = { rules: [{ id: '@secretlint/secretlint-rule-preset-recommend', rule: recommended }] };

const KINDS: Record<string, [singular: string, plural: string]> = {
  github: ['GitHub token', 'GitHub tokens'],
  anthropic: ['Anthropic API key', 'Anthropic API keys'],
  openai: ['OpenAI API key', 'OpenAI API keys'],
  stripe: ['Stripe key', 'Stripe keys'],
  slack: ['Slack token', 'Slack tokens'],
  privatekey: ['private key', 'private keys'],
  'database-connection-string': ['database connection string', 'database connection strings'],
  basicauth: ['URL with a password', 'URLs with a password'],
  gcp: ['Google Cloud key', 'Google Cloud keys'],
  credential: ['credential', 'credentials'],
};
const kindOf = (ruleId: string, messageId: string): string => {
  const rule = ruleId.replace('@secretlint/secretlint-rule-', '');
  if (rule === 'aws') return /SecretAccessKey/.test(messageId) ? 'AWS secret key' : 'AWS key';
  return KINDS[rule]?.[0] ?? `${rule} secret`;
};
const plural = (kind: string): string => Object.values(KINDS).find(([one]) => one === kind)?.[1] ?? `${kind}s`;
const article = (kind: string): string => (/^[AEIO]/i.test(kind) && !/^URL/.test(kind) ? 'an' : 'a');
const lineAt = (text: string, index: number): number => text.slice(0, index).split('\n').length;
const list = (items: string[]): string => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/** Precise provider findings, sorted, with 1-based line numbers. */
export async function findSecrets(text: string): Promise<SecretFinding[]> {
  if (!text) return [];
  const result = await lintSource({
    source: { content: text, filePath: '/archwoven/input.txt', ext: '.txt', contentType: 'text' },
    options: { config: CONFIG, noPhysicFilePath: true, maskSecrets: true },
  });
  return result.messages
    .map(m => {
      // Some rules include surrounding quotes or separators; masking those would break the sample's syntax.
      let [start, end] = m.range;
      while (start < end && /[\s"'`,;]/.test(text[start]!)) start++;
      while (end > start && /[\s"'`,;]/.test(text[end - 1]!)) end--;
      return { kind: kindOf(m.ruleId, m.messageId), start, end, line: lineAt(text, start) };
    })
    .sort((a, b) => a.start - b.start);
}

// Config-style assignments whose key names a credential: `password = "…"`, `"client_secret": "…"`, `api_key: …`.
// The key must END with the credential term, so `secretlintrc`, `token_url` or `password_file` are not credentials.
const ASSIGNMENT = /(["']?)([A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|secret[_-]?key|token|access[_-]?token|auth[_-]?token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?key))\1\s*[:=]\s*(["']?)([^\s"'`,;]+)\3/dgi;
const PLACEHOLDER = /^(?:\$|%|<|\{\{|\[redacted)|^(?:your[-_ ].*|changeme|change[-_]me|password|secret|example.*|dummy.*|test.*|x{3,}|\*+|null|none|undefined|true|false|todo|placeholder)$/i;
const CODE_REFERENCE = /^[A-Za-z_$][\w$]*(?:\.[\w$]+)*(?:\(.*)?$/;
const FILE_NAME = /\.(?:json|ya?ml|toml|ini|cfg|conf|env|txt|pem|key|crt|cer|p12|pfx|jks)$/i;

function genericCredentials(text: string): SecretFinding[] {
  const found: SecretFinding[] = [];
  for (const match of text.matchAll(ASSIGNMENT)) {
    const [, , , quote, value] = match;
    if (!value || value.length < 8 || PLACEHOLDER.test(value) || FILE_NAME.test(value)) continue;
    if (!quote && CODE_REFERENCE.test(value)) continue; // settings.API_TOKEN, os.getenv( … are references, not literals
    const [start, end] = match.indices![4]!;
    found.push({ kind: 'credential', start, end, line: lineAt(text, start) });
  }
  return found;
}

/** Replace secret values with `[REDACTED:<kind>]`. Provider rules win where they overlap the generic rule. */
export async function maskSecrets(text: string): Promise<{ text: string; findings: SecretFinding[] }> {
  const precise = await findSecrets(text);
  const generic = genericCredentials(text).filter(g => !precise.some(p => g.start < p.end && p.start < g.end));
  const findings = [...precise, ...generic].sort((a, b) => a.start - b.start)
    .filter((f, i, all) => i === 0 || f.start >= all[i - 1]!.end);
  let out = text;
  for (const f of [...findings].reverse()) out = `${out.slice(0, f.start)}[REDACTED:${f.kind}]${out.slice(f.end)}`;
  return { text: out, findings };
}

/** A user-facing refusal for typed text that contains a secret, or null. Only precise rules apply here. */
export async function secretRefusal(fields: { label: string; text: string }[]): Promise<string | null> {
  const parts: string[] = [];
  let total = 0;
  for (const field of fields) {
    const findings = await findSecrets(field.text);
    if (!findings.length) continue;
    total += findings.length;
    const byKind = new Map<string, number[]>();
    for (const f of findings) byKind.set(f.kind, [...new Set([...(byKind.get(f.kind) ?? []), f.line])]);
    parts.push(`${field.label} contains what looks like ${list([...byKind].map(([kind, lines]) => `${article(kind)} ${kind} on ${lines.length > 1 ? 'lines' : 'line'} ${list(lines.map(String))}`))}`);
  }
  if (!parts.length) return null;
  return `${parts.join('; ')}. Remove ${total > 1 ? 'them' : 'it'} and try again. Archwoven never sends detected secrets to the AI provider, and no credit was used.`;
}

/** Mask every string in an extracted fragment; identical strings mask identically, so ids stay consistent. */
export async function maskFragmentSecrets<T>(fragment: T): Promise<{ fragment: T; counts: Record<string, number>; disclosure: string | null }> {
  const counts: Record<string, number> = {};
  const cache = new Map<string, { text: string; findings: SecretFinding[] }>();
  const walk = async (value: unknown): Promise<unknown> => {
    if (typeof value === 'string') {
      const masked = cache.get(value) ?? await maskSecrets(value);
      cache.set(value, masked);
      for (const f of masked.findings) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
      return masked.text;
    }
    if (Array.isArray(value)) { const out: unknown[] = []; for (const v of value) out.push(await walk(v)); return out; }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = await walk(v);
      return out;
    }
    return value;
  };
  const masked = await walk(fragment) as T;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const disclosure = total
    ? `Masked ${total} likely secret${total > 1 ? 's' : ''} (${Object.entries(counts).map(([kind, n]) => `${n} ${n > 1 ? plural(kind) : kind}`).join(', ')}) before analysis; their values were never sent to the AI provider.`
    : null;
  return { fragment: masked, counts, disclosure };
}

export class SecretEgressError extends Error {
  constructor(kinds: string[]) {
    super(`Archwoven stopped this request because it contained what looks like ${list(kinds.map(k => `${article(k)} ${k}`))}. Nothing was sent to the AI provider.`);
    this.name = 'SecretEgressError';
  }
}

const strings = (value: unknown, out: string[] = []): string[] => {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out);
  return out;
};

async function assertClean(params: unknown): Promise<void> {
  const p = params as { system?: unknown; messages?: unknown };
  const findings = await findSecrets(strings([p.system, p.messages]).join('\n'));
  if (findings.length) throw new SecretEgressError([...new Set(findings.map(f => f.kind))]);
}

/** Every hosted request — including token counting — is scanned at the provider boundary and fails closed. */
export function guardEgress(client: StructuredClient): StructuredClient {
  return {
    messages: { countTokens: async (params, options) => { await assertClean(params); return client.messages.countTokens(params, options); } },
    beta: { messages: { create: async (params, options) => { await assertClean(params); return client.beta.messages.create(params, options); } } },
  };
}
