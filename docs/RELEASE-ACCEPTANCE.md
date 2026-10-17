# Release acceptance record

2026-10-17. This record distinguishes automated verification, real-provider browser
checks and acceptance that still needs a person or device. It does not replace the
[release tracker](RELEASE-PROGRESS.md) or the [known gaps](OPEN-GAPS.md).

## Stack and reproducibility

The release fixes were reviewed as a stack of
[PR39](https://github.com/ManankumarThakkar/archwoven/pull/39) →
[PR40](https://github.com/ManankumarThakkar/archwoven/pull/40) →
[PR41](https://github.com/ManankumarThakkar/archwoven/pull/41) →
[PR42](https://github.com/ManankumarThakkar/archwoven/pull/42). PR39 merged into `main`, but
PRs 40–42 were merged into the branch below them after that branch had already
merged, so their changes did not reach `main`. [PR43](https://github.com/ManankumarThakkar/archwoven/pull/43)
lands all of their commits unchanged; its CI, including the real Compose smoke, passed
against current `main`. This acceptance PR is based on PR43's head.

A fresh source export of the combined stack was installed with Node 24 and
`pnpm install --frozen-lockfile`, then built with `pnpm -r build`. No environment
files, databases, compiled packages or installed dependencies were copied into it.
The final acceptance pass also pins Next.js file tracing to the repository root,
following the [documented monorepo configuration](https://nextjs.org/docs/app/api-reference/config/next-config-js/output#caveats),
so unrelated parent-folder lockfiles do not change the tracing root.

A second, independent rerun repeated the same steps from a fresh `git archive` export
of this PR (no environment files, databases or dependencies copied). It reproduced every
result below; the build reported no workspace-root warning, and the traced root is the
repository root.

| Check | Result |
|---|---|
| Fresh frozen install and production build | Passed |
| Full test suite | 1,128 passed |
| Full local-mode test suite | 1,104 passed, 24 expected hosted-only skips |
| Workspace typechecks | Passed |
| Ordinary-model-floor selftest | 25 checks passed |
| Provider-score selftest | Passed |
| Repair-rounds selftest | 37 checks passed |
| Suite A evidence package | Three images and models tracked with CI checksum verification |
| Named Suite A visual verdicts | Pending; evidence eligibility remains false |

## Real Docker runtime

[PR40 CI](https://github.com/ManankumarThakkar/archwoven/actions/runs/39069471963)
passed both verification and the real Docker job. A development-shaped context
contained canaries in an environment file, host dependencies and generated output;
none entered the built image.

The Compose smoke exercised production startup and SQLite, actual Ollama transport,
loopback-only published web ports, hostile Host/Origin refusals, a read-only
runner-owned Git clone, commit pinning, local ingestion, job ownership and retry
admission. It used no fake assembly, API key or downloaded model. Its expected
terminal result was Ollama's missing-model 404, not a successful diagram. Successful
inference inside the container remains unverified.

## Fresh real-provider browser checks

The clean production build ran on a separate loopback port and disposable database,
with `ARCHWOVEN_MODE=local`, `ARCHWOVEN_FAKE=0` and the installed Ollama
`gpt-oss:20b` model. No additional hosted API calls were made in these checks.

| Flow | Result |
|---|---|
| Library description → architecture | Passed: Reader, Web Portal, Catalog API, PostgreSQL and the requested connections |
| Open component detail → real expansion | Passed: inferred internals and parent context shown |
| Same-model architecture/detail link | Passed without reloading the diagram |
| Live internal focus with incompatible lens | Passed: focus applied and hiding lens cleared |
| Live route and omitted route clearing | Passed: playback restored; omitted route cleared prior state |
| SVG and PNG delivery in Chrome | Passed: new files inspected directly after the download observer timed out |
| Downloaded inferred-detail output | Valid XML/PNG; caption retained and all four internal borders dashed |

Further live checks are recorded here as they complete. A derived geometry fixture,
where used, is labelled separately from real model generation.

## Cleanup and remaining acceptance

The README now links current release status and gives native production/local setup
commands. The MIT license implements the choice already locked in SPEC §1.
Historical milestone transcripts and plans are preserved as evidence and labelled
where their old commands or ignored reference inputs could mislead a fresh checkout.
No saved diagrams, keys, local clones or user-generated files were deleted.

Outstanding gates include the named Suite A verdicts, real screen-reader/physical-touch
acceptance, browser combinations not recorded above, successful container inference,
and owner name/domain clearance. Hosted import first-pass validity after the latest
prompt fixes still needs a bounded provider evaluation. Hosting and its cost controls
remain a separate decision; this pass does not change shipped retention or deployment
architecture. See OPEN-GAPS.md for measured extraction limits and deferred enhancements.
