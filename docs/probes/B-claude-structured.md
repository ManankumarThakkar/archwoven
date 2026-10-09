# Probe B — Hosted Claude structured output

**Question:** Does hosted structured output (`claude-opus-5-5`) hit the §11 first-pass-validity and tokens/task targets?

**Status:** ⚠️ **CONDITIONAL — enforcement fixed in code, live measurement BLOCKED on credential/endpoint.**

## What the mock suite proves (offline, green)

`packages/llm/src/client.test.ts` + `refine.test.ts` exercise the parse → validate → repair → cache-shape plumbing against a faked SDK:
- first valid pass → zero repairs, usage metered;
- graph-invalid output → one repair, validator errors quoted back by id;
- gives up after `MAX_REPAIRS` with named errors, never loops longer;
- non-JSON output → repair quoting the truncation reason;
- the request carries the beta header and a schema whose `enum` survives.

This is real coverage of the loop, but it cannot measure what Probe B is actually about: **whether the API enforces the grammar on real generations.** Mocks always "obey."

## Live attempt — what happened

Ran the eval with the key in `.env.local`. Every architecture/sequence prompt failed first-pass validation with a consistent signature: the model emitted `source`/`target`/`kind` on edges, free-form `type`, and omitted `title`/`privacy` — i.e. a generic graph shape, not `SystemModelSchema`. Repairs (2/prompt) never converged.

### Root cause (four compounding issues, all confirmed)

1. **`output_config` never reached a grammar compiler.** `ANTHROPIC_BASE_URL` is inherited from the Claude Code environment and points at a local proxy (`127.0.0.1:2018`). That proxy authenticates the session but **silently drops `output_config`** — the model free-generates (markdown + mermaid, or drifted JSON). Confirmed: a beta request through the proxy with a faithful schema still returned markdown, `stop_reason: end_turn`.
2. **Non-beta client sent no beta header.** `client.messages.parse()` does not attach `anthropic-beta`; structured outputs is gated behind `structured-outputs-2025-12-15`, which the SDK only auto-adds on `client.beta.messages`. Without it the API ignores `output_config`.
3. **`zodOutputFormat()` strips `enum`.** The SDK's `transformJSONSchema` folds `enum`/`minLength`/`default` into the `description` string, so even when sent, `kind`/`type`/`provenance` were unconstrained strings. Confirmed on the wire.
4. **Repairs couldn't converge.** `.parse()` throws on invalid output, discarding the raw text, so the repair turn got a generic "not valid JSON" with neither the specific errors nor the model's prior output — it regenerated the same drift.

## The fix (in code — offline-verified)

- `client.beta.messages.create` + explicit `structured-outputs-2025-12-15` header.
- A **faithful inline schema** (`z.toJSONSchema(..., { reused: 'inline' })`) that keeps every `enum`; verified on the wire that `edges.items.type.enum` survives and there are no `$defs`.
- `.create()` + our own `JSON.parse` + `validateModel`, so a truncated/invalid response still yields the raw text we quote back — repairs now carry **specific validator errors + the prior JSON**.
- **`baseURL` pinned to `https://api.anthropic.com`** via `makeAnthropic()` in both `client.ts` and `refine.ts` — the SDK otherwise inherits `ANTHROPIC_BASE_URL`, so any dev shell behind the Claude Code proxy would silently drop `output_config` and forward the API key to that proxy. A unit test poisons the env var and asserts the pin.
- `max_tokens` at the §15-locked **8192**, with an exact `count_tokens` pre-send gate (rejects >25k assembled context, fails closed). If live truncation recurs, the fix is effort-low output or a spec config-review amendment — not silent drift.
- Key sanitized against `--env-file` quote/whitespace artifacts.

Commits: `7953aba` (enforcement), `193e2a4` (refine), `1a2222e` (key sanitize); review-fix pass adds the baseURL pin + token gate. Offline suite green, `tsc` clean on `llm` + `web`.

## What is still required to close Probe B

The `.env.local` key returns **`401 Invalid bearer token`** against `api.anthropic.com` directly (not a quoting artifact — sanitizing didn't help). The only endpoint that authenticates here is the Claude Code proxy, which does not support structured outputs. Therefore first-pass validity **with enforcement** cannot be measured from this environment.

To complete Probe B, one of:
- a valid direct `sk-ant-…` Anthropic API key (then run `run-eval.ts` with `ANTHROPIC_BASE_URL` unset / pointed at `api.anthropic.com`), or
- run the eval outside the Claude Code proxy.

Until then Probe B stays **CONDITIONAL**: the enforcement path is correct in code and on the wire, but the live first-pass-validity number (§11 ≥95%) is unmeasured. Do **not** mark it GO on the strength of the mock suite alone.
