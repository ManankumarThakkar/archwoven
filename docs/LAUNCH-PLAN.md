# Public launch plan

Agreed 2026-10-17 between the owner and the engineering sessions. This is the plan for putting Archwoven on the public web as a free portfolio project. It is the single reference for the order of work, the decisions already made and what each phase needs from the owner. It does not claim any phase is done; [RELEASE-PROGRESS.md](RELEASE-PROGRESS.md) and [OPEN-GAPS.md](OPEN-GAPS.md) record status.

Earlier requirement drafts (`confirmed-requirements.md` and `decision-brief.md`, prepared outside the repository) were merged into this plan. Where they differed, the owner's later answers below win.

## Goal

Recruiters and engineers can open Archwoven, describe a system or paste a public GitHub repository, and get a real diagram without an account, an API key or a CAPTCHA. It must stay within a fixed budget, be honest when the budget runs out and meet the existing quality bar:
- correctness
- security
- accessibility
- tests
- observability
- graceful recovery

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Budget | $120 per year, all-in: hosting, AI, testing, taxes and any domain. Separate from the portfolio's own budget. | Owner limit |
| Hosting | Vercel Hobby, launched at `archwoven.vercel.app` (unclaimed on 2026-10-17). No domain at launch. | Free; the portfolio already runs there |
| Domain | Later. Candidates: `archwoven.dev` (available 2026-10-17), or a subdomain of a personal domain shared with the portfolio. | Spend only when traffic justifies it |
| Hosted storage | Upstash Redis, shared account with the portfolio (own database, or a separate key prefix if the free plan allows one database). Local mode keeps SQLite. | TTL-native expiry; atomic budget scripts; the pattern the portfolio already uses |
| Diagram ownership | The diagram lives in the browser. The server keeps only job status and the final result for 24 hours, tied to an unguessable visitor cookie. No cloud history in hosted mode. | Matches "no permanent history"; least storage and data retention |
| Job execution | Return a job id, run the work with Next.js `after()`, keep status in Redis. A tab closing does not stop it. A crash mid-job ends as "failed, retry" after its deadline. | Single-step jobs under 180 s; Vercel Workflow retries are a hazard for paid calls |
| Bot protection | No CAPTCHA of any kind, including invisible Turnstile. | Owner requirement |
| Repository analysis | AI assembly stays the default. Results are cached by pinned commit plus model and prompt version, examples are precomputed and labelled, and a labelled model-free code map is offered when the AI budget is exhausted. | Biggest cost lever that keeps the showpiece |
| Logo | Replace the current ⌘ mark, which is Apple's Command-key symbol, with an original SVG designed in code. | Avoid confusion and resemblance to an existing mark |
| Links | LinkedIn (`linkedin.com/in/mananthakkar20`) and the GitHub repository. The repository becomes public at the end of Phase 6. | Visibility for recruiters |

## Budget allocation

| Use | Per year | Rule |
|---|---|---|
| Hosting and database | $0 | Free tiers only. Exceeding them must pause features, never bill. |
| Public AI usage | $84 | $7 per month, inside an annual cap. A new month never resets the annual ledger. |
| Testing and evaluation | $12 | Each paid run needs the owner's approval and a cap. |
| Domain | $15 | Bought later. |
| Tax and contingency | $9 | Not spent without a decision. |

At measured Opus 5.5 costs ($0.04 per description, $0.10–0.17 per import), $7 a month covers roughly 175 descriptions or 50 imports. Phase 1 decides whether a cheaper model raises that.

## Money and abuse model

Without a CAPTCHA, these limits are the protection. They guarantee spending never exceeds $7 a month or $84 a year. They do not stop a determined attacker rotating networks from using up a month's allowance early; then the site says so and shows the reset date.

- **Invariant:** reported spend + outstanding reservations + next attempt's worst-case cost ≤ the applicable cap (visitor, network, month, year).
- **Before every provider call:** reserve the attempt's worst-case cost, assuming no cache hit and the full output cap. Settle the reservation with reported usage afterwards. Unknown usage stays charged.
- **Fail closed:** if Redis is unreachable, refuse paid work. Examples, editing and downloads keep working.
- **Per-visitor and per-network money caps,** one active job per visitor and a small bounded queue. Network identity comes from the address Vercel supplies, never from a client-written header.
- **CPU admission limits** on repository imports before any download or parsing, plus a kill switch. Vercel Hobby limits may be shared with the portfolio, so CPU abuse must not pause either site.
- **Refusals and cancellations:** refunding a visitor's allowance never erases money already spent or the attempt from abuse counters.

## Phases

Each phase is one or more pull requests, reviewed and merged before the next starts. Paid runs happen only with the cap shown.

| # | Phase | Deliverable | Done when | Needs from the owner |
|---|---|---|---|---|
| 1 | Model experiment | Run the 30 provider-eval cases on Haiku 5.5, Sonnet 5.5, Haiku and Sonnet with an Opus advisor, and Opus 5.5 as the baseline. Publish cost per accepted task, first-attempt validity, Suite A and ground-truth accuracy, and latency. | A model is chosen that keeps quality at the lowest cost. | Approve the spend cap (about $6, from the testing allocation). Review the result. |
| 2 | Money ledger and limits | Reservation-based accounting with visitor, network, month and year caps; fail-closed behaviour; budget-exhausted messages; race tests showing two requests cannot both spend the last dollar. | Race, rollover, crash and missing-usage tests pass; local mode unchanged. | Review the PR. |
| 3 | Hosted architecture | Redis store for hosted mode, `after()` jobs with deadlines, browser-held diagrams with 24-hour recovery, JSON import and export, CPU admission limits, the commit-pinned repository cache and the code-map fallback. | Closing a tab mid-job recovers the result; nothing lives past 24 hours; local mode keeps full history. | Create the Upstash database (or confirm the prefix approach) and add its credentials in Vercel later. |
| 4 | Deployment probes | A preview deployment on Vercel. Check the parsers and secret scanner fit Vercel's function limits; recovery after a closed tab; limits holding across instances; no secrets in client code. | All probes pass on a real Vercel preview. | Create the Vercel project from the GitHub repository and add environment variables. Step-by-step instructions are provided at this phase. |
| 5 | Logo | 3–4 original SVG marks with reverse-image and trademark-design checks, then the favicon, app icons and share image. | The owner picks one. | Pick a mark. |
| 6 | Landing page and visibility | Server-rendered landing page; metadata and share previews; sitemap, `robots.txt` and structured data; LinkedIn and GitHub links; README polish; secrets and history audit. | Lighthouse and accessibility checks pass on the preview; the audit is clean. | Make the repository public. |
| 7 | Launch | Production deployment at `archwoven.vercel.app`, an operating runbook, a cost dashboard and an Anthropic console spend limit as a backstop. | A new visitor completes a real task, and the budget-exhausted path is verified. | Set the console spend limit and give the final go. |
| 8 | Domain (later) | Connect the chosen domain and move metadata to it. | HTTPS and redirects verified. | Buy the domain. |

## Verification before building on these assumptions

- Whether Vercel Hobby allowances and limit pauses are shared with the portfolio's project. Check the usage dashboard or ask Vercel support.
- Upstash free plan: Lua scripting support, and whether it allows 1 or 10 databases (its pricing page states both).
- Which client-address header Vercel guarantees cannot be set by the client.
- That the tree-sitter WASM grammars and secret-scanning dependencies are bundled into the Vercel function.

## Revisit triggers

- More than about 1% of hosted jobs lost to crashes or redeploys: move job execution to Vercel Workflow with retries disabled on paid steps.
- The monthly AI cap is reached early in most months: revisit the model choice, caching and per-visitor caps before raising spend.
- A Vercel Hobby limit is approached: tighten import admission or move CPU-heavy extraction elsewhere.

## Out of scope

Accounts, teams, SSO, permanent cloud history, paid hosting tiers and automatic model upgrades on failure.
