# Hosted deployment

Archwoven uses Next.js on Vercel and Redis through the Upstash REST API. Vercel opens no SQLite database. Local/private deployments use SQLite and Ollama; see the [README](../README.md#run-privately).

## Vercel configuration

Import the repository as a **Next.js** project with:

| Setting | Value |
|---|---|
| Root directory | `apps/web` |
| Node.js | `24.x` |
| Build command | `cd ../.. && pnpm build` |
| Install command | `pnpm install --frozen-lockfile` |

Configure these project-level, server-only environment variables:

| Variable | Purpose |
|---|---|
| `ARCHWOVEN_MODE=hosted` | Hosted processing |
| `ARCHWOVEN_FAKE=0` | Real-provider mode |
| `ANTHROPIC_API_KEY` | Provider credential; Secret/Sensitive |
| `UPSTASH_REDIS_REST_URL` | HTTPS REST endpoint; Secret/Sensitive |
| `UPSTASH_REDIS_REST_TOKEN` | Writable REST token; Secret/Sensitive |
| `ARCHWOVEN_SESSION_SECRET` | Stable cryptographically random secret of at least 32 characters; Secret/Sensitive |
| `ARCHWOVEN_REDIS_PREFIX` | Environment's isolated key prefix |
| `ARCHWOVEN_SITE_URL` | Final HTTPS origin, Production only |

Use separate prefixes, such as `archwoven:`, `archwoven-preview:` and `archwoven-dev:`. Production and Preview need their own spending ledgers and approved allowances. Sharing a Redis database shares its provider quotas even when keys have separate prefixes. Keep credentials out of `NEXT_PUBLIC_` variables. Vercel sets `VERCEL` itself.

Use `apps/web/.env.local` for local development; the root `.env.local` is not loaded by the web app. Rotating the session secret invalidates visitor sessions and job ownership. Environment changes require a new deployment.

Keep all deployments protected during initial setup. For public access, Standard Protection leaves production domains public while protecting previews and generated deployment URLs. Connect the domain in the Archwoven project's Domains settings, follow its exact DNS instructions, and verify HTTPS and redirects before sharing the URL.

## Initialize spending limits

Environment variables do not initialize the ledger. From the repository root, use a private environment file containing the Redis URL, writable token and intended prefix:

```bash
node --env-file=/path/to/private.env scripts/spending-ledger.mjs status
node --env-file=/path/to/private.env scripts/spending-ledger.mjs init --start <YYYY-MM-DD> --annual 120 --month 10 --day 1 --visitor-day 0.40 --network-day 1
node --env-file=/path/to/private.env scripts/spending-ledger.mjs pause "Deployment setup in progress"
```

These are the public policy caps: **$10/month, $120/year, $1/UTC day overall, $0.40/visitor/day and $1/network/day**. Choose the annual start date to cover the intended usage; calls before that date are refused. A visitor is a signed browser session, not an identified person. Network limits use Vercel's verified address, with IPv6 grouped by /64.

`init` preserves an existing ledger. To update its policy without changing settled or held usage:

```bash
node --env-file=/path/to/private.env scripts/spending-ledger.mjs caps --annual 120 --month 10 --day 1 --visitor-day 0.40 --network-day 1
```

A ledger created before the overall daily cap existed needs `caps` to set it. Visitor and network days must fit within the overall day, then month, then year. Preview testing has its own separately approved allowance.

Before every paid attempt, including repairs and retries, the server counts the request and atomically reserves its worst-case input and output cost. Admission requires settled usage plus all held amounts to fit every cap. Reported usage settles the hold; missing usage, provider failures and crashes retain it. A reported charge above its hold pauses paid work for inspection.

Reaching an AI cap pauses new paid calls and explains the reset time. Existing diagrams, editing, examples and downloads remain available while hosting and Redis are healthy. Redis outages also block server-backed saves and recovery; the diagram already on screen remains downloadable.

## Jobs, ownership and retention

- Jobs are bound to a signed visitor session; foreign job and diagram IDs are refused before Redis access.
- A visitor has one active job, a network at most two, and at most eight jobs wait for a running slot. The accepting invocation runs the job after responding, within the route's 300-second limit.
- Reloading or closing the tab does not cancel a hosted job. The browser remembers its ID and reconnects. A crashed execution expires; an ambiguous provider attempt is never retried automatically.
- Direct edits, undo, refinement and expansion check the current revision. A stale tab is refused and receives the latest diagram; late paid results cannot overwrite a newer edit or a cancelled job.
- Repository imports read source without executing it. Likely secrets are masked before provider calls; scanner failures stop the job.
- Each browser keeps the latest revision of up to 20 diagrams in localStorage, at most 512 KiB per diagram. Copies are validated on read and restore; blocked storage and corrupt copies are explained. Clearing site data removes browser copies.
- Job status and questions expire 24 hours after creation. Saved diagrams, results and last-task reports expire 24 hours after their most recent write.
- Spending attempts and annual/monthly totals do not expire; visitor and network daily totals expire after 35 days.
- The single-server SQLite deployment retains diagrams and finished jobs for 30 days and content-free metering for 90 days. Local/private diagrams remain until deleted.
- Delete diagram removes its saved diagram and browser copy. Job results and reports have separate expiry; spending records remain.

## Storage and abuse controls

Each Redis prefix allows **32 MiB of serialized temporary payloads and 256 payload records**, including reserved capacity. Diagrams are bounded to **512 KiB in UTF-8**. Job admission reserves capacity before inference; successful writes consume that reservation and unused capacity is released when the job ends. Successful changes retain the sliding 24-hour expiry.

A full prefix refuses new work before inference and explains how to download or delete existing diagrams. The cap excludes Redis key/index overhead, job metadata, spending records and other applications' data; it is not a total Redis memory bound.

Use a fresh Production prefix initially. When upgrading an existing prefix, touched payloads enter accounting on their next write. Untouched copies expire within 24 hours after all old instances stop; the complete payload bound applies after that migration window. No spending history is flushed.

Imports/restores are limited to 30 per visitor/day, 60 per network and 200 overall. Edits/undo are limited to 300 per visitor/day, 600 per network and 600 overall. These successful-write limits do not bound polling, rejected requests or all Redis usage. Configure API request-rate protection before functions run, and measure actual billed commands and total storage in the Upstash console. Local REST request counts do not establish how provider billing counts Lua operations.

## Operator commands

```bash
node --env-file=/path/to/private.env scripts/spending-ledger.mjs status
node --env-file=/path/to/private.env scripts/spending-ledger.mjs unknown
node --env-file=/path/to/private.env scripts/spending-ledger.mjs pause "reason"
node --env-file=/path/to/private.env scripts/spending-ledger.mjs resume
```

`status` reports caps, settled and held usage, unresolved attempts and accounted temporary payloads. Monitor this alongside provider usage, Upstash storage/commands and Vercel resource usage.

Resolve unknown usage only after confirming the actual charge in the provider console:

```bash
node --env-file=/path/to/private.env scripts/spending-ledger.mjs resolve <attempt-id> <usd> --evidence "<what the console showed>"
```

This requires an interactive confirmation, retains the evidence and refuses amounts above the hold. `renew --start <YYYY-MM-DD>` begins the next annual window only after the previous one ends. Resuming paid work does not change any cap.

## Models and task usage

`ARCHWOVEN_HOSTED_MODEL` selects the reviewed server configuration: `claude-opus-5-5` (default), `claude-sonnet-5-5` or `claude-haiku-5-5`. Visitors cannot select a model through the API. Tasks retain the model they started with. Supporting a model does not establish its quality; see the measured results in the README.

The Last task summary shows reported tokens, repairs, retries and estimated hosted cost. Estimates use [standard provider rates](https://platform.claude.com/docs/en/about-claude/pricing), including supported cache tiers. Missing usage is marked incomplete; unknown prices show Cost unavailable. Ollama incurs no external API charge. The Redis ledger enforces caps separately from these estimates.

## Deployment verification and search

Before enabling paid work, verify the actual Vercel/Upstash deployment: generation and repository import, reload recovery, ownership isolation, stale revisions, cancellation, editing/undo, downloads, and spending/capacity/outage refusals. Local recorded fixtures and packaging checks do not establish real-provider quality or production acceptance; see the [testing guide](testing.md).

`ARCHWOVEN_SITE_URL` enables canonical links and a sitemap containing only the landing page. Without a valid origin, the site stays noindex. Preview, development, local/private and demo deployments stay noindex; the workspace is always noindex and API responses carry an X-Robots-Tag. Search directives do not provide access control.

Verify ownership in Google Search Console and Bing Webmaster Tools and submit `/sitemap.xml`. Optional `ARCHWOVEN_GOOGLE_SITE_VERIFICATION` and `ARCHWOVEN_BING_SITE_VERIFICATION` values add ownership meta tags. Edit `apps/web/public/og.svg` and run `node scripts/render-social-preview.mjs` to regenerate the social image with bundled fonts.

## Optional Preview packaging probe

```bash
pnpm build
pnpm hosting:preflight
```

The preflight exercises only the function's traced files in a temporary directory, running real Java/Python extraction and secret detection with outbound fetch rejected. It checks packaging, not job recovery, provider quality or Redis behavior.

For a protected **Preview only**, set `ARCHWOVEN_MODE=hosted`, `ARCHWOVEN_FAKE=0`, `ARCHWOVEN_HOSTING_PROBE=1` and `ARCHWOVEN_HOSTING_PROBE_TOKEN` to a random 32–256-character printable secret without spaces. Add no provider key. This mode blocks application APIs; only the authenticated `/api/hosting-probe` endpoint is available. Production refuses diagnostic mode.

Set the same probe token in the shell without placing it in history, then run:

```bash
node scripts/hosting-preflight.mjs --url https://your-preview.vercel.app
```

The runner accepts `VERCEL_AUTOMATION_BYPASS_SECRET` when protection requires it. Secrets travel only in headers and redirects are refused. Leave diagnostic variables unset in ordinary deployments.
