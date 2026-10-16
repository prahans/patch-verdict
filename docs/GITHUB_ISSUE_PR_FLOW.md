# GitHub issue and pull request flow — implementation report

Implementation remains on `feat/github-issue-pr-flow`. No merges or pushes to `main` or `feat/live-mission-flow` were performed.

## Input and verification

The landing form defaults to a GitHub issue URL and provides a compact plain-text preview. A subtle action switches to repository URL plus manual bug description; users can switch back. Both modes retain the existing optional reproduction command and required failure marker. Manual descriptions still require at least 20 characters. Title-only GitHub issues can be shorter.

`github-issue-url.ts` contains pure strict URL and persisted-source validation. `github-issue.ts` is server-only and uses native fetch against the fixed `https://api.github.com` origin, with redirects disabled, timeouts, response bounds, and controlled errors. Public issue reads are always unauthenticated. The issues endpoint's `pull_request` field is rejected even when null.

The preview route returns only owner, repository, issue number, title, bounded body preview, and canonical issue URL. `POST /api/missions` resolves the issue again, discards browser-supplied repository/title/body/metadata, and normalizes canonical title and body into the repository-oriented backend input. The engine, sandbox execution, investigation, verification rules, and verdict generation are unchanged.

The process bridge passes canonical issue metadata separately from the issue context and explicitly blanks `PATCHVERDICT_GITHUB_TOKEN` in the verification child's environment. An empty value also prevents dotenv from restoring a write token from a root environment file. Process arguments remain separate values with `shell: false`.

## Proof and Mission Control

Proof version 2 gains optional `mission.source.githubIssue` metadata: URL, number, title, owner, repository, and body. Source repository URL and base commit remain canonical. New proofs record `patch.sha256`, computed from exactly the bytes written to `patch.diff`, including its final newline. All additions are made before the proof manifest is published. PR publication never edits the manifest or patch.

Older and manual proofs continue loading without issue metadata or a digest. Older proofs without a digest remain viewable but require a new verification mission before PR publication.

Live and completed Mission Control show the canonical issue title/body and safe external issue/repository links. Manual display is preserved. Status, base commit, changed files, investigation iterations, Flight Recorder, Proof Chain, Diff Viewer, Investigation Report, Verification Evidence, and Export evidence remain available.

## Exact patch publication

`POST /api/missions/<missionId>/pull-request` accepts no request body. It validates the mission ID, canonical readable proof, completed execution, verdict, applied patch, nonempty changed-file set, matching source/patch base commits, and exact diff digest. Contradictory recorded evidence is rejected without modifying the verdict. Browser cross-site writes are rejected.

The publisher reads the base commit and tree through GitHub REST. A temporary bare Git repository and index reconstruct that tree and verify its SHA. Only affected base blobs are downloaded and their Git hashes verified. `git apply --cached --check` and `git apply --cached` use the exact recorded diff. The resulting file set, content, modes, and tree SHA are checked. No working tree, repository commands, hooks, filters, clone credentials, or AI are used.

The server creates GitHub blobs and a tree, verifies their returned hashes, and creates a commit whose sole parent is the exact proof base commit. A deterministic `patchverdict/<missionId>` branch points to it. The PR targets the repository's current default branch. An advanced default branch never triggers rebase, patch regeneration, or another verification run.

| Recorded outcome                                               | Human action                                            |
| -------------------------------------------------------------- | ------------------------------------------------------- |
| COMPLETED + VERIFIED with eligible proof                       | Create pull request                                     |
| COMPLETED + REVIEW_REQUIRED with eligible proof                | Create draft PR, with an amber human-review explanation |
| FAILED verdict, execution failure, or invalid/missing evidence | No publication                                          |

PR titles come from the issue title or manual report. The body includes the verdict, base commit, changed files, baseline/post-patch/full-suite results, integrity state, and review reasons. `Fixes #N` is included only for a validated issue belonging to the same repository. No automatic creation or merge occurs.

## Idempotency and recovery

In-process deduplication and a per-mission filesystem lock protect concurrent requests. Validated publication metadata is written atomically to `output/<missionId>/pull-request.json`, separately from proof. It binds the repository, deterministic branch, PR number/URL, draft state, head/tree/base SHAs, exact patch digest, and full proof digest. Page refresh shows the saved View PR link without requiring a token or contacting GitHub.

Retries search all PR states for the deterministic branch. Recovery verifies repository, head, draft policy, commit parent, and exact tree. It can recover an existing branch, a PR created before local persistence failed, uncertain API success, and a closed matching PR whose branch was deleted. Conflicting branches or PRs are rejected. The existing retention policy retains/removes PR metadata with its mission directory.

## Configuration

- Existing verification: `E2B_API_KEY` and `OPENROUTER_API_KEY`; optional `AGENT_MODEL`.
- Optional publication: `PATCHVERDICT_GITHUB_TOKEN` in the web server environment or `apps/web/.env.local`. It is required only when creating a PR. A missing token returns a safe publication-only error.
- Fine-grained token scope: restrict to intended repositories; Contents read/write, Pull requests read/write, Issues read, Metadata read. No OAuth or GitHub App is introduced.
- Git must be installed on the web server. No additional npm dependencies were added.

GitHub REST references: [trees](https://docs.github.com/en/rest/git/trees), [commits](https://docs.github.com/en/rest/git/commits), [pull requests](https://docs.github.com/en/rest/pulls/pulls).

## Verification results

PowerShell blocks the local `pnpm.ps1` shim, so commands used the equivalent `pnpm.cmd` executable.

| Required command                   | Result                              |
| ---------------------------------- | ----------------------------------- |
| Root `pnpm typecheck`              | PASS                                |
| Root `pnpm test`                   | PASS — 76 tests, 11 files           |
| Web `node --test tests/*.test.mjs` | PASS — 108 tests, no failures/skips |
| Web `pnpm exec tsc --noEmit`       | PASS                                |
| Web `pnpm lint`                    | PASS                                |
| Web `pnpm build`                   | PASS                                |

Targeted tests exercised strict URL parsing, safe/unauthenticated issue fetching, fresh canonical submission, both advanced fields, manual validation, proof compatibility, token exclusion, Windows metadata bounds, PR policy, actual Git patch application and object hashes, immutable evidence, unsupported patches, concurrency, recovery, metadata tampering, and containment. UI tests use real React rendering and component callbacks with a narrow state/ref harness; they cover modes, preview escaping/cancellation, submissions, title/links, loading locks, draft policy, errors, and persisted View PR links. Retention tests confirm PR metadata follows its mission's lifetime.

Additional commands included targeted Node test files, the proof-writer Vitest file, `git diff --check`, and a production HTTP smoke test. The production server returned the issue-first form and a safe invalid-URL error. A real unauthenticated request for `prahans/patchverdict-divide-by-zero#1` returned HTTP 200 and title `division by zero returns Infinity`. Temporary smoke servers were stopped.

The first sandboxed production build could not download the existing Google Fonts; the network-enabled build passed without a font or layout change. One concurrent lint invocation raced test-fixture cleanup; rerunning lint after the tests passed.

## Remaining limitations

Public issue reads are subject to unauthenticated GitHub rate limits. Issue context retains the 10,000-character limit, with an additional 24,000-character serialized metadata bound for Windows. Text is rejected when oversized, never silently truncated for verification.

Publication supports bounded UTF-8 regular files, including executable modes, additions, and deletions. Changed binary files, symlinks, submodules, unsupported modes, unsafe/ambiguous paths, or oversized/truncated repository trees are rejected. Current bounds include 200 changed files, a 2 MiB patch, 2 MiB per affected file, 8 MiB total fetched base blobs, and 20,000 tree entries.

No live E2B/AI mission or real GitHub PR was created during this implementation. PR network writes were tested against a deterministic mock GitHub API backed by real Git objects. No connected browser was available for visual inspection; UI rendering/callback tests and production HTTP checks passed.

## File inventory

Configuration/documentation: `.env.example`, `apps/web/.env.example`, `apps/web/.gitignore`, `apps/web/README.md`, and this report.

API routes: `apps/web/app/api/github/issue/route.ts`, `apps/web/app/api/missions/route.ts`, `apps/web/app/api/missions/[missionId]/pull-request/route.ts`.

UI: `apps/web/app/globals.css`, `apps/web/app/missions/[missionId]/page.tsx`, `apps/web/components/landing/issue-preview.tsx`, `apps/web/components/landing/mission-launcher.tsx`, `apps/web/components/mission/live-mission.tsx`, `apps/web/components/mission/mission-summary.tsx`, `apps/web/components/mission/pull-request-action.tsx`.

Web libraries: `apps/web/lib/github-issue-url.ts`, `apps/web/lib/github-issue.ts`, `apps/web/lib/github-pull-request.ts`, `apps/web/lib/exact-verified-patch.ts`, `apps/web/lib/pull-request-types.ts`, `apps/web/lib/load-proof-bundle.ts`, `apps/web/lib/mission-input.ts`, `apps/web/lib/mission-live-status.ts`, `apps/web/lib/mission-live-types.ts`, `apps/web/lib/mission-types.ts`, `apps/web/lib/run-backend-mission.ts`.

Backend: `src/real-mission-demo.ts`, `src/proof/bundle.ts`.

Tests: `src/proof/bundle.test.ts`, `apps/web/tests/github-issue.test.mjs`, `apps/web/tests/github-pull-request.test.mjs`, `apps/web/tests/issue-pr-ui.test.mjs`, `apps/web/tests/load-proof-bundle.test.mjs`, `apps/web/tests/run-backend-mission.test.mjs`, `apps/web/tests/mission-retention.test.mjs`, `apps/web/tests/helpers/ui-harness.mjs`, `apps/web/tests/helpers/ui-loader.mjs`.
