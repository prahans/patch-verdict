# Third-party JS/TS implementation report

This milestone adds a strict issue-to-repair flow alongside the legacy manual flow. One mission binds **one public issue + one selected branch + one exact base commit + one target bug**. Models propose a target, regression, diagnosis, and repair; executable tools and deterministic policy decide what is permitted and what the evidence supports.

Work belongs on `feat/third-party-js-ts-flow`. It must not be merged or pushed as part of this task. This report covers the 44 requested report items; final validation, smoke, and commit records are collected at the end.

## Files and architecture (items 1–3)

The main implementation boundaries are:

| Area                            | Files and responsibility                                                                                                                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mission model and orchestration | `src/mission/third-party-types.ts`, `types.ts`, `third-party-runner.ts`, and `run-third-party-envelope.ts`: outcomes, frozen target, normalized runs, strict state transitions, bounded correction, and proof finalization.                                                     |
| Safe launch                     | `src/mission/input-envelope.ts`, `src/real-mission-demo.ts`, `apps/web/lib/run-backend-mission.ts`: a fixed stdin protocol and legacy CLI dispatch.                                                                                                                             |
| Preparation                     | `src/repository/clone.ts`, `detect-project.ts`, `prepare.ts`, `protected-paths.ts`, `errors.ts`, and `types.ts`: exact checkout, supported project analysis, protected setup dependencies, and typed preparation outcomes.                                                      |
| Framework evidence              | `src/verification/framework-adapter.ts`, `background.ts`: repository-local Vitest/Jest execution, structured reports, exact identities, and target/background comparison.                                                                                                       |
| Agent capabilities              | `src/agent/strict-reproduction.ts`, `investigate.ts`, `patch.ts`, `src/tools/strict-policy.ts`: separate discovery/generation/repair tools and stateful path/write limits.                                                                                                      |
| Git integrity                   | `src/tools/strict-git-evidence.ts`: raw file integrity against the exact base and patch construction through a separate Git index.                                                                                                                                              |
| Verdict and proof               | `src/proof/third-party-verdict.ts`, `bundle.ts`, `apps/web/lib/proof-v3.ts`, `load-proof-bundle.ts`, `mission-types.ts`, and `pull-request-types.ts`: deterministic policy, v3 serialization, compatibility, consistency, and eligibility.                                      |
| Branch selection                | `apps/web/lib/github-branch-name.ts`, `github-branches.ts`, `github-issue.ts`, `github-public-api.ts`, `mission-input.ts`; `/api/github/branches`, `/api/github/issue`, and `/api/missions`; landing `branch-selector.tsx`, `issue-preview.tsx`, and `mission-launcher.tsx`.    |
| Mission Control                 | Mission page; `third-party-evidence.tsx`, `mission-header.tsx`, `mission-summary.tsx`, `proof-chain.tsx`, `verification-evidence.tsx`, `live-mission.tsx`, and `flight-recorder.tsx`; live status/types and `live-proof-chain.ts`.                                              |
| Publication                     | `apps/web/lib/github-fork-publication.ts`, `github-pull-request.ts`, and `exact-verified-patch.ts`: authenticated fork selection, exact Git objects, target-aware PR creation, and recovery.                                                                                    |
| Runtime and documentation       | `src/sandbox/e2b.ts`; root/web READMEs; `apps/web/.env.example`; architecture, flow, and implementation documents; `apps/web/scripts/smoke-third-party-ui.mjs`.                                                                                                                 |
| Tests                           | New strict mission, preflight, protected-path, adapter, background, policy, reproduction, agent-boundary, Git-integrity, and fork-publication suites; expanded proof, branch/input, transport, live-state, and UI suites; shared `apps/web/tests/helpers/proof-v3-fixture.mjs`. |

The strict runner does not redefine legacy suite-wide reproduction or historical verdicts. Shared investigation and patch agents accept explicit strict capability hooks, while the existing manual route and v2 reader remain available. The architectural rationale is recorded in [the architecture note](THIRD_PARTY_JS_TS_ARCHITECTURE.md); [the flow guide](THIRD_PARTY_JS_TS_FLOW.md) describes normal use.

## Supported scope and result model (items 4–5)

Supported repositories are public, single-package JavaScript/TypeScript projects with one consistent npm or pnpm lockfile and one repository-installed Vitest or Jest framework. Supported production extensions are `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, and `.cts`. Repair modifies one existing grounded production file, optionally accompanied by one newly generated `.test`/`.spec` JS/JSX/TS/TSX file.

Status describes execution. Outcome describes what the mission established. A verdict describes an evaluated repair. `COMPLETED` is not a synonym for `VERIFIED`.

| Outcome                                                                             | Verdict                                    |
| ----------------------------------------------------------------------------------- | ------------------------------------------ |
| `TARGET_NOT_REPRODUCED`, `UNSTABLE_REPRODUCTION`                                    | `null`                                     |
| `UNSUPPORTED_REPOSITORY`, `UNSUPPORTED_REPAIR_SCOPE`                                | `null`                                     |
| `PREPARATION_FAILED`, `INVESTIGATION_FAILED`, `PATCH_FAILED`, `VERIFICATION_FAILED` | `null`                                     |
| `REPAIR_EVALUATED`                                                                  | `VERIFIED`, `REVIEW_REQUIRED`, or `FAILED` |

Non-repair outcomes and failed repairs cannot authorize a PR. A supported project is not a promise that a particular issue can be reproduced or repaired within these limits.

## Canonical branch, checkout, and transport (items 6–9)

The issue preview resolves public canonical repository metadata and preselects its default branch. The branch picker supports bounded pages and exact-name lookup. Launch re-resolves the issue, repository, selected existing branch, and full 40-character SHA on the server. Browser-supplied SHA, repository authority, fork, verdict, or publication destination is rejected. Issue text and model output cannot choose the canonical checkout.

Strict checkout uses the validated SHA in detached HEAD state. Branch names are API data, URL-encoded for GitHub and retained in proof, rather than interpolated into checkout commands. A branch moving after preview changes only the SHA of a newly launched mission; it cannot change an existing mission's base. Deleted or invalid branches cause an explicit error.

The web child has fixed arguments ending in `--input-stdin` and receives a validated, UTF-8, 64 KiB JSON envelope. Issue text never becomes command text or argv. The envelope rejects extra strict-mode command/configuration authority. Publication credentials are removed from the verification child. Legacy positional developer CLI behavior remains supported.

Preflight rejects missing/ambiguous managers and locks, workspaces and nested package manifests, unsupported frameworks/languages/layouts, symlinks/submodules, and unsupported test orchestration. Supported root test scripts are deliberately limited to `vitest`, `vitest run`, `vitest --run`, `jest`, and `jest --runInBand`; custom flags, environment wrappers, and pre/post-test hooks are rejected rather than silently dropped. Installation uses the frozen lock and strict engine checks. Static verification configuration and its setup/import closure become protected paths. Dynamic or unresolved setup is unsupported. Installation and subsequent evidence checks must preserve the exact HEAD and repository integrity.

## Framework adapters and reproduction (items 10–17)

Vitest runs its installed `node_modules/vitest/vitest.mjs` with `run` and JSON reporting. Jest runs installed `node_modules/jest/bin/jest.js` in non-watch, in-band JSON mode. Neither adapter downloads a runner through `npx`. Target execution binds an exact safely quoted path and an escaped, anchored full test name; Jest additionally uses `--runTestsByPath`.

Both adapters normalize discovered, passed, and failed `(testPath, testIdentity)` pairs. Reporter files live outside the repository, have a unique adapter path, are removed before each invocation, and are checked for regular-file type and size before reading. Reports with contradictory totals, unknown status, duplicate identities, escaping paths, absent execution, or unexpected target selection fail closed. Compilation, parsing, module resolution, startup, configuration, timeout, and infrastructure failures are separate from application-behavior failures. Exit code 1 alone is never reproduction.

Before generation or repair, the runner records the untouched full suite and repeats failing baselines. Existing-target discovery has read-only capabilities. A proposal must name an observed test and provide exact issue/assertion excerpts plus a reason grounded in a safely read file. The selected case must have failed in the untouched baseline and must fail consistently when run alone. Durable frozen provenance preserves those excerpts and rationale for v3 readers.

When no existing target is established, a separate RegressionAgent can create one new test through `write_regression_test`. The writer reserves one safe path, rejects an existing file, and permits at most two writes on that same path. A second write must match the prior registered digest. It cannot change production, other tests, setup, or configuration. A generated test that validly passes stops reproduction; the agent cannot revise its expected value simply to manufacture a failure. Invalid imports/compilation/discovery can consume the bounded revision opportunity.

Once a stable behavioral failure is established, freeze records origin, framework, path, exact identity and command, SHA-256, branch/base, provenance, stability, and baseline target result. Freezing disables the regression writer. Hashes and bindings are checked again through investigation, repair, target execution, suite execution, and proof/publication validation. Freezing protects bytes; an AI-generated expected result still requires human review and can never earn `VERIFIED`.

## Target, background, and repair provenance (items 12, 18–24)

The untouched baseline retains the full suite evidence. Comparisons exclude only the exact target identity from both baseline and post-patch backgrounds, so unrelated cases in the same file remain visible. A generated target is absent from the untouched baseline and is removed from the post-patch background; its intentional addition is not treated as a new unrelated regression.

The comparison uses discovered identity sets and pass/fail partitions, not just suite exit codes or failure counts. It identifies stable existing failures, newly failing identities, and resolved failures. Disappearing tests or formerly passing tests becoming skipped produce `UNKNOWN`; a prior failure is resolved only when that identity actually passes. Different repeated populations/results produce `UNSTABLE`. Newly failing background tests produce `REGRESSED`. Stable prior failures remain reviewable. Resolving some or all prior background failures is conservatively recorded as `IMPROVED_WITH_BACKGROUND_FAILURES` and requires review.

Repair receives the frozen target and background context. Its tool policy allows only one grounded existing production file across the first attempt and one correction. Tests, generated regression, package/lock files, config/setup dependencies, CI, Git internals, symlinks, and ungrounded paths remain protected. The repair loop stops after a successful write and enforces iteration/tool bounds. A required multi-production-file change becomes `UNSUPPORTED_REPAIR_SCOPE`.

Trusted generated-test provenance and production-repair provenance are distinct. Git evidence hashes raw tracked bytes against HEAD, rejects hidden index entries and unsupported Git configuration/attributes, and builds a separate index from exact candidate bytes. It does not trust a working-tree diff whose index flags or clean filters could hide changes. The real index must remain at the base. The canonical changed-file set must be one production repair plus, when present, the registered generated path. Candidate bytes are compared around target and full-suite execution so test execution cannot quietly change the patch being verified.

The deterministic policy requires stable target reproduction, a repair attempt, valid scope, unchanged frozen evidence, target success, comparable background evidence, and verification integrity. With those conditions:

| Target origin and background                                                       | Verdict           |
| ---------------------------------------------------------------------------------- | ----------------- |
| Existing repository test; `CLEAN`                                                  | `VERIFIED`        |
| Generated regression; otherwise acceptable background                              | `REVIEW_REQUIRED` |
| Existing test; stable pre-existing or improved background failures                 | `REVIEW_REQUIRED` |
| Target still fails, integrity/scope failure, `REGRESSED`, `UNKNOWN`, or `UNSTABLE` | `FAILED`          |

The full suite must also observe the target passing. A target that passes alone but fails in the suite cannot receive a positive verdict. Models never provide a trusted verdict or publication-eligibility input.

## Proof and Mission Control (items 25–27)

V3 adds canonical source mode/branch/default branch/base, immutable `createdAt`, outcome, frozen reproduction/provenance, normalized target-after evidence, untouched baseline/repeat, background comparison, and separate trusted-regression/production repair fields. Exact patch bytes and SHA-256 remain publication authority. Fixed evidence artifacts must agree with the normalized proof, including commands and failing-baseline repeats.

Finalization writes the proof atomically. An exclusive per-mission directory lock is shared by strict and legacy writers. Existing finalized v3 proofs and incomplete directories are not replaceable; only a finalized v2 bundle retains legacy replacement behavior. Publication writes separate `pull-request.json` metadata, never edits proof. A crash can leave a conservative lock/incomplete directory that requires operator review.

The v2 loader keeps its historical semantics. Positive v3 proof requires consistent source, target, command, provenance, baseline, comparison, and integrity fields; contradictory or incomplete evidence cannot authorize publication. Mission Control displays the branch/SHA, target origin/framework/identity/hash, review warning for generated oracles, production changes, background channels, outcome, and verdict. Unreproduced outcomes suggest selecting another branch for a new mission without automatically switching branches. Live states include `REPRODUCING`.

## Fork publication and recovery (items 28–35)

Strict Create PR resolves the token through `/user`, requires a user identity, validates the public upstream, and uses that user's related fork. Same-name unrelated repositories are refused. Renamed related forks are discovered through bounded owned-repository pages; unrelated private forks are skipped. If no related fork exists after complete bounded discovery, the explicit user action may create one with all branches. Publication refuses a user who owns the upstream because this strict mode requires a separate user fork.

Upstream supplies canonical base Git objects. An isolated local bare Git index reconstructs the exact base tree, applies the recorded patch, validates the complete changed-file set, and computes the resulting tree. The production repair must modify a regular file present in the base. A generated test must be absent from the base and match frozen resulting bytes; an existing test must match the base blob digest.

The fork must contain the exact proof base commit and tree. Readiness is polled within a fixed budget; no default-branch substitution or synchronization occurs. Blobs, tree, commit, and deterministic `patchverdict/<missionId>` ref are written only in the validated fork. The upstream receives the PR. The commit has exactly the proof base as its parent and the verified resulting tree. Its fixed author/committer and date from immutable proof bytes, plus proof/patch digest markers, produce a deterministic expected commit SHA. Mutable display events cannot change it.

The PR base is the recorded target branch. Branch advancement does not rebase or change the verified parent; branch deletion stops publication. Default-branch descriptions may use `Fixes #N`, while maintenance branches use `Related to #N`. Generated-oracle and background-review results publish only as drafts.

Repeated actions re-read local authority and validate remote state. Exact matching commits, refs, and open or closed PRs are reused. Conflicting deterministic refs are never forced or deleted. Lost fork/commit/ref/PR responses and failed local metadata persistence recover from validated remote objects. A closed matching PR with its branch deleted is returned without creating another. Publication does not invoke AI, execute repository code, regenerate tests, edit the patch, change proof, merge, or close issues directly.

## Security and resource bounds (items 36–37)

Controls include fixed public GitHub origins and encoded API data, strict schemas, server-resolved authority, safe path containment, regular-file/link checks, bounded UTF-8 I/O, restricted agent tools, exact Git object checks, publication locks, sanitized API failures, and server-only credentials. Local publication Git uses an allowlisted environment without AI/publication keys, no shell, no inherited hooks/configuration, and no worktree execution.

| Resource                               | Bound                                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Mission stdin                          | 64 KiB; 10-second read deadline                                                                                   |
| Web process / route / sandbox          | 18 / 20 / 20 minutes                                                                                              |
| Sandbox command                        | 2 minutes                                                                                                         |
| Existing-target discovery / regression | 5 / 6 model iterations; 18 tool calls per phase                                                                   |
| Investigation / patch attempt          | 8 iterations and 32 tool calls / 4 iterations and 20 tool calls                                                   |
| Generated test / correction            | 2 writes, one path, 32,768 bytes / one repair correction                                                          |
| Repair file                            | 131,072 bytes                                                                                                     |
| Framework report                       | 4,000,000 bytes; 10,000 tests; retained stdout/stderr 32,000 characters each                                      |
| Strict raw-file integrity              | 10,000 tracked files; 16 MiB per tracked file; 128 MiB total tracked bytes                                        |
| Proof / patch / command artifact       | 16 MiB / 2 MiB / 256 KiB                                                                                          |
| Branch browser                         | 30 names per page; at most 100 pages; exact lookup also available                                                 |
| GitHub publication                     | Shared 2-minute deadline; bounded requests/JSON; 3 owned-repository pages; 20 fork candidates; 6 readiness checks |
| Local publication Git                  | 20-second command deadline; 12 MiB combined output bound                                                          |

These are safety and predictability limits, not guarantees that every supported installation completes in time. Installation and tests still execute repository code inside the disposable sandbox. Snapshot integrity and reporter checks are not formal attestation of arbitrary hostile code.

## Environment and GitHub permissions (items 38–39)

No new mandatory environment variable is introduced. `E2B_API_KEY` and `OPENROUTER_API_KEY` remain necessary for actual missions. Existing server-only `PATCHVERDICT_GITHUB_TOKEN` enables publication; it must never be a `NEXT_PUBLIC_` variable. Git is required on the web host. No OAuth or GitHub App provisioning flow is added.

The token must resolve an authenticated user, read public upstream metadata/objects and owned repository metadata, create the user's fork when needed, write its Git contents/refs, and create upstream pull requests. For fine-grained fork creation, GitHub documents Contents read together with either Administration write or Repository creation write. Forking is asynchronous, which is why this implementation polls exact-base readiness. Token owner/repository restrictions and organization policies can still prevent a cross-owner flow. See [GitHub's fork endpoint permissions](https://docs.github.com/en/rest/repos/forks?apiVersion=2022-11-28#create-a-fork) and [pull-request endpoint permissions](https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28#create-a-pull-request); permission errors are surfaced without altering proof.

## Test coverage and fixtures (items 40–41)

| Coverage                      | Evidence                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Policy and background         | Pure tests for all outcomes/trust combinations, existing/generated targets, unchanged/new/resolved failures, missing identities, and previously passed/failed cases becoming skipped.                                                                                                                                                                                     |
| Preparation and checkout      | Exact default/release SHA, branch advancement binding, npm/Vitest and pnpm/Jest profiles, workspace/manager/service/script rejection, static config/setup protection.                                                                                                                                                                                                     |
| Frameworks                    | Structured Vitest/Jest reports and exact command selection; parse/compile/import/startup/timeouts; no-test and duplicate identities; stale/oversized/symlink reports. Real installed Vitest fixtures execute target and background failure/pass cases.                                                                                                                    |
| Reproduction and capabilities | Existing issue-grounded target, generated target, no target despite unrelated failures, flaky reproduction, malformed regression, same-path revision, frozen writer, passing generated target, attempted tool escape.                                                                                                                                                     |
| Repair orchestration          | Clean existing target, generated review, multiple stable background failures, new regressions, unsupported multi-file scope, one correction, target-only pass/full-suite fail, candidate mutation during tests.                                                                                                                                                           |
| Git and proof                 | Local Git repositories exercise exact byte/provenance capture and index/configuration tampering; v3 consistency and v2 compatibility; immutable/in-flight writer protection; bounded artifacts and exact hashes.                                                                                                                                                          |
| Web and transport             | Canonical issue/branch selection, forged authority rejection, fresh SHA resolution, stdin escaping and bounds, live states, server-rendered UI and hook behavior, null-outcome publication blocking.                                                                                                                                                                      |
| Publication                   | Local bare Git plus mocked GitHub exercise exact parent/tree/bytes, maintenance/default branch policy, fork creation/renaming/readiness, wrong identity/relation, branch advancement/deletion, deterministic conflicts, closed PR recovery, uncertain responses, canonical route validation, repeated clicks, persistence failure, proof mutation, and timestamp binding. |

Automated tests do not depend on live external repositories. Mocked Jest normalization/commands are not a live installation run of every supported Jest version. Server-rendered UI/hook tests and HTTP smoke are distinct from visual browser inspection.

## Final gates, smoke, and commits (items 2, 42)

Validation recorded on October 19, 2026 (Asia/Katmandu):

| Required command | Final result |
| --- | --- |
| Root `pnpm.cmd typecheck` | Passed. |
| Root `pnpm.cmd test` | 293 passed, 1 skipped, across 23 files. The executable-mode test is skipped on Windows and requires POSIX. |
| Web `node --test tests/*.test.mjs` | 150 passed; no skipped tests. |
| Web `pnpm.cmd exec tsc --noEmit` | Passed. |
| Web `pnpm.cmd lint` | Passed. |
| Web `pnpm.cmd build` | Passed. The restricted-network attempt could not fetch the existing Geist fonts; the network-enabled build succeeded. |
| Production HTTP smoke | Passed landing and existing-clean, generated-background, and not-reproduced mission pages using `node scripts/smoke-third-party-ui.mjs http://127.0.0.1:4317`. Local fixtures were removed by the helper. |
| Controlled actual mission smoke | Public issue preview and branch endpoints resolved `prahans/patchverdict-divide-by-zero#1`, default branch `main`. Production POST accepted the mission with HTTP 202; the exact SHA was `f2b1a27dbea7dec90dbb7d8c8ba04e00af536a98`. It recorded `PREPARATION_FAILED`, null verdict, and a readable HTTP 200 proof page. See runtime limitation below. |
| Controlled live fork publication | Not performed. The smoke server explicitly blanked the publication token; no fork or PR was created. Local Git and mocked GitHub publication tests passed. |
| Visual browser inspection | Not performed; no browser surface was available. |

The production server ran with `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 4317` and was stopped after the smoke. Its public reads used GitHub, and the controlled mission used E2B. The synthetic HTTP helper did not invoke AI or publish anything.

Controlled mission `web-5c9f9b45-26b0-4ea5-8494-2602d1df26da` preserved its v3 proof under ignored runtime `output/`. Installation failed correctly with `EBADENGINE`: locked `vite@7.3.7` needs Node `^20.19.0 || >=22.12.0`, while the current E2B template supplies Node `v20.9.0` with npm `10.1.0`. No target, repair, or positive verdict was fabricated. This validates canonical launch, exact-base preparation, safe failure, proof finalization, and readable failure UI; it does **not** validate a successful live AI repair.

The smoke also exposed two strict preparation messages omitted by the live-event allowlist. Both fixed messages are now accepted and covered by parser tests; arbitrary backend text remains excluded or sanitized.

Before an external issue trial, use an E2B runtime compatible with the controlled repository's lockfile, rerun the controlled issue, and inspect the target/provenance/background proof. Exercise the release-branch, generated, absent-target, and background scenarios (automated fixtures already cover them). Then a human must explicitly publish an eligible proof against a controlled repository from a separate authenticated fork owner and verify repeated-action recovery. A strict publisher cannot fork its own upstream into the same account. The requested single external-issue instructions remain deferred until that controlled publication check succeeds; no external issue was run or PR created during this task.

Commit record on `feat/third-party-js-ts-flow`:

- `e16d853` ? `Fail verification when background tests stop executing`.
- `60867bb` ? `Reject missing prerequisites as target reproduction`.
- Session checkpoints preserved without amendment: `5f54607`, `73edffa`, `413a0b6`, `3d470a1`, `6e88a0d`, `cb832ed`, `aae10f2`, `7a726e8` (all titled `update`). These contain the staged implementation since base `e8e2775`.
- Final documentation/live-progress commit: `Record third-party validation and preparation progress`; obtain its hash with `git log -1` after finalization.

No merge or push was performed. The full changed-file inventory is available with `git diff --name-only e8e2775..HEAD`; the area map above groups those files for review.

## Remaining limits and merge considerations (items 43–44)

Unsupported cases include private repositories, non-JS/TS languages, workspaces/multipackage layouts, Yarn/Bun, browser/E2E suites, Docker/service/secret-dependent verification, unsupported test flags/hooks or dynamic configuration, automatic branch search, arbitrary historical commits/tags, multi-production-file repair, dependency/config/CI edits, symlinks/submodules, and over-budget repositories/reports. Conservative preflight intentionally rejects some projects a human could operate manually.

Natural-language issue-to-test relevance and generated expectations still involve model proposals. Exact quotes, observed failures, frozen bytes, and deterministic gates constrain that uncertainty without eliminating it. Tests cover observed behavior on one commit/environment, not universal correctness. Generated oracles and pre-existing background failures always require review.

Remote fork readiness, token restrictions, API rate limits, and server deployment process lifetimes remain operational constraints. A moving maintenance branch may require a later human reconciliation even though published bytes retain their verified parent. Large or renamed fork inventories can exceed bounded discovery and fail explicitly. The deterministic GitHub commit contract has local Git and mocked API coverage; live controlled publication must be recorded separately before external use.

The strict and legacy paths intentionally coexist. Shared agent hooks, proof loading, and exact-patch publication therefore retain regression tests for the old flow. Proof v3 is immutable after finalization, but filesystem administrative access is outside that contract. Interrupted writer locks are conservative and require reviewed cleanup. Keep this branch unmerged until the final gates and the remaining controlled smoke limitations above have been reviewed.
