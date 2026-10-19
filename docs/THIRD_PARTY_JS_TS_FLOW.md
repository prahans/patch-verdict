# Third-party JavaScript/TypeScript flow

One mission binds one public GitHub issue, one human-selected existing branch, one exact commit SHA, and one target behavior. AI proposes evidence and a candidate repair. Tools enforce capabilities, framework execution verifies behavior, deterministic policy records the verdict, and a human explicitly approves publication.

## Scope

Supported repositories have one root package, JavaScript/TypeScript production source, one consistent npm or pnpm lockfile, and repository-installed Vitest or Jest. Production extensions are .js, .jsx, .ts, .tsx, .mjs, .cjs, .mts, and .cts. Strict repair permits one grounded production file. A separate regression phase may create one new .test/.spec JS/JSX/TS/TSX test.

Unsupported layouts and operations fail explicitly: workspaces and multipackage repositories; Yarn/Bun; other language families; browser/E2E frameworks; required containers/services/secrets; unsupported test scripts or dynamic setup; binaries, symlinks, submodules, and unsupported file modes; dependency/configuration/CI changes; multi-file production repairs; arbitrary tags/SHAs and automatic branch search. A dependency on Turbo alone does not establish a workspace. Conservative preflight may reject repositories that a human could run manually.

Manual missions retain their legacy behavior and v2 proof semantics. The strict policy does not reinterpret historical evidence.

## Canonical launch and preparation

The server resolves the public issue and repository, presents bounded branch browsing, and preselects the default branch. The human may select a maintenance branch. Launch fetches fresh canonical issue/repository/branch metadata and resolves a full SHA. Client-provided repository identity, base SHA, fork identity, publication branch, and verdict are not accepted.

Branch names are URL-encoded for GitHub requests. The branch is metadata in the sandbox; checkout uses only the validated 40-character SHA. A moving branch, deleted branch, or issue text mentioning another branch never silently changes checkout authority.

The web child receives a fixed-schema JSON stdin envelope with a 64 KiB byte bound. Issue text is not in argv or executable shell text. Positional developer CLI arguments remain supported for legacy work. The publication token is blanked in the verification child and is never forwarded to agents or sandbox commands.

Preflight checks root metadata, manager/lock consistency, supported layout and framework, installs dependencies, and verifies the exact HEAD and clean repository state. Strict missions do not inherit the E2B base image's Node version: PatchVerdict provisions checksum-pinned Node v22.14.0 from the official nodejs.org release archive into a PatchVerdict-owned `/tmp` runtime and places that runtime first in PATH for dependency installation and every later verification command. The archive is selected only for supported x86_64/arm64 sandbox architectures and its SHA-256 is verified before extraction. This fixes host-template drift such as an older E2B Node runtime being unable to install a modern locked Vite dependency without weakening `--engine-strict`. Repositories whose dependencies are still incompatible with this pinned runtime stop as PREPARATION_FAILED before reproduction. Installation, compilation, import, framework startup, infrastructure, and timeout errors do not establish target reproduction.

## Reproduction and repair

1. Capture the untouched full suite before creating a regression or editing production. Repeat failing baseline runs within a fixed budget and compare exact discovered/pass/fail identities.
2. Ask a read-only discovery agent for one observed test that materially matches the issue. Require an observed identity, safely read file, exact issue/assertion quotes, and bounded rationale. Execute the proposed exact file/name through the framework adapter and repeat its failure.
3. If no existing target is established, a separate RegressionAgent can write one new test. Its dedicated writer reserves one safe path, allows at most two attempts on that same path, and rejects existing files, protected paths, symlinks, oversized or invalid text, and focused/skipped tests. A valid passing target is not rewritten to manufacture failure.
4. Accept only a discovered, executed application-behavior failure. No discovery, bad imports, parse/compile failures, startup failures, and timeouts cannot qualify. Unstable reproduction stops repair.
5. Freeze the origin, framework, exact test path/identity, command, SHA-256, issue provenance, selected branch/base, baseline result, and stability before repair.
6. Investigate with bounded read-only tools and the frozen target/background context. Structured diagnosis must be grounded in inspected repository evidence.
7. Repair tools can edit only one allowed production file across the initial attempt and single correction. All tests, the frozen test, package/lock/config/setup/CI files, Git internals, symlinks, and ungrounded targets remain blocked in code.
8. Recheck frozen bytes, exact HEAD, authorized changed-file provenance, target identity/command and pass result, then compare the full suite. Test execution itself cannot mutate the candidate into different verified bytes.

The canonical patch includes only the authorized production repair and, when present, the registered frozen new test. Other untracked files are rejected. Integrity checks compare raw tracked bytes against the exact base, reject hidden index flags and unsupported Git configuration/attributes, and build the patch through a separate index from those bytes. The repository index stays at its base state; no sandbox commit is made.

Freezing an AI-generated regression protects its bytes; it does not establish that its expected behavior is correct. Generated-oracle success always requires human review.

## Outcomes and policy

Execution status, outcome, and repair verdict are separate. COMPLETED means evaluation completed; it does not mean the repair succeeded.

| Outcome | Verdict | Publication |
| --- | --- | --- |
| TARGET_NOT_REPRODUCED | null | Unavailable |
| UNSTABLE_REPRODUCTION | null | Unavailable |
| UNSUPPORTED_REPOSITORY | null | Unavailable |
| UNSUPPORTED_REPAIR_SCOPE | null | Unavailable |
| PREPARATION_FAILED | null | Unavailable |
| INVESTIGATION_FAILED | null | Unavailable |
| PATCH_FAILED | null | Unavailable |
| VERIFICATION_FAILED | null | Unavailable |
| REPAIR_EVALUATED | VERIFIED, REVIEW_REQUIRED, or FAILED | Only positive eligible verdicts |

An existing target that passes after repair, with clean background and preserved integrity, is VERIFIED. A generated target or unchanged stable background failures requires REVIEW_REQUIRED. New non-target failures, changed frozen bytes, scope violations, or untrustworthy verification cannot earn a positive verdict. Target failure after the bounded correction is REPAIR_EVALUATED with FAILED.

Background comparison excludes the exact target identity from both channels. A generated target is absent from the untouched baseline and excluded from the post-patch background. Unrelated tests in the same file are not excluded.

| Background state | Meaning |
| --- | --- |
| CLEAN | No non-target failures before or after |
| UNCHANGED_PREEXISTING_FAILURES | Same stable non-target failures remain |
| REGRESSED | New non-target failures appear |
| IMPROVED_WITH_BACKGROUND_FAILURES | Prior background failures resolve; conservative review still applies |
| UNSTABLE | Repeated test populations or results differ |
| UNKNOWN | Framework results or test populations cannot be compared safely |

Example: target A changes from failing to passing while unrelated B/C remain failing. The repair is REVIEW_REQUIRED with unchanged background failures, not a failed repair solely because the suite exits 1. If a new failure D appears, the verdict is FAILED. Missing tests or previously passing tests becoming skipped make comparison unknown; skipped previously failing tests cannot masquerade as resolved failures.

## Proof and UI

Version 3 adds canonical source mode/branch/default branch/base, immutable creation timestamp, outcome, frozen reproduction/provenance, normalized target-after evidence, untouched baseline/repeat evidence, background comparison, and separate trusted-regression/production provenance. It preserves fixed artifact paths and exact patch SHA-256. A shared exclusive writer lock prevents strict or legacy runs from overwriting a finalized v3 proof or incomplete bundle; only finalized v2 bundles retain legacy replacement behavior. Publication metadata is separate.

The loader continues to read version 2 without applying new semantics retroactively. V3 readers reject contradictory source, target, background, provenance, or trust-policy evidence. Proof JSON is bounded at 16 MiB, patch bytes at 2 MiB, and command artifacts at 256 KiB. A corrupt or incomplete proof does not become publication authority.

Mission Control displays source branch/SHA, reproduction origin/framework/identity/hash, generated-oracle review requirements, production repair, background comparison, and the recorded outcome/verdict. An unreproduced target suggests selecting another branch for a new mission; it does not retry another branch automatically.

## Fork publication and recovery

New strict missions always use fork publication. Historical controlled v2 missions may keep direct publication.

An explicit Create PR action causes the server to resolve the token's authenticated user, validate upstream, discover an owned related fork or create one, and poll readiness within bounds. Same-name unrelated repositories are rejected. Renamed forks are considered through bounded owned-repository discovery. If discovery is incomplete or the exact proof base is unavailable, publication fails safely.

Upstream supplies canonical source Git objects. An isolated local Git index validates the exact diff and resulting tree. The authenticated fork receives blobs/tree/commit and only the deterministic patchverdict/<missionId> branch. Its default branch is never updated. The candidate parent remains the exact proof base; the PR base remains the selected branch even after upstream advances.

The commit payload binds proof and patch SHA-256 digests and uses the immutable proof timestamp for author/committer date. Recovery validates the exact commit SHA, parent/tree, fork relation, upstream/fork identity, deterministic branch, target branch, and draft policy. Existing exact state is reused; conflicting refs are never forced or deleted. Closed matching PRs are returned without opening another. Lost commit/PR responses and local metadata persistence failure are recovered from remote state.

Existing frozen tests are checked against base Git blob bytes. Generated tests are checked against exact resulting patch bytes. Publication never calls an AI, regenerates a test, reformats a patch, rebases, changes proof, or closes an issue directly. Default-branch PRs may use Fixes; maintenance-branch PRs use Related to.

## Bounds, credentials, and remaining limits

The web process deadline is 18 minutes, Next route budget 20 minutes, E2B lifetime 20 minutes, and each normal sandbox command two minutes. The one-time checksum-verified Node runtime bootstrap is allowed up to three minutes. Discovery/regression/repair iterations and tool counts are bounded; generation permits two writes and production repair one correction. Framework reports cap test counts and output; stale report files are removed outside the repository before execution. Raw-byte integrity checks permit at most 10,000 tracked files, 16 MiB per tracked file, and 128 MiB total tracked bytes.

GitHub publication has a shared two-minute request deadline, per-request timeouts, bounded JSON, at most three owned-repository pages and twenty candidate forks, and six readiness checks. Large repos or slow remote setup may produce controlled unsupported/preparation/publication errors.

E2B_API_KEY and OPENROUTER_API_KEY are needed to run actual missions. PATCHVERDICT_GITHUB_TOKEN is needed only for publication and stays server-side. Token ownership, cross-owner repository access, fork creation, Contents write, and Pull requests write must be permitted by GitHub. No OAuth or GitHub App is added. Git must be installed on the web server.

Issue-to-test semantic matching still uses a model proposal grounded in observed evidence; this milestone does not prove natural-language intent mathematically. Generated oracle validity always needs human review. Stable observed tests do not establish correctness for untested behavior or other branches/environments.

## Validation and controlled smoke

The automated fixture matrix covers Vitest/Jest normalization, exact checkout and branch movement, unsupported workspace/package-manager/service layouts, existing/generated/absent/flaky targets, invalid regression imports/compilation/discovery, same-file revision and frozen protection, one-file repair limits, background identity changes, proof v2/v3 compatibility, stdin transport, and mocked GitHub publication/recovery.

Before external use, run all six gates: root pnpm typecheck and pnpm test; web node --test tests/*.test.mjs, pnpm exec tsc --noEmit, pnpm lint, and pnpm build. Windows shells may require pnpm.cmd.

Use local fixtures or a controlled repository first. Exercise default and maintenance branches, an existing target, a generated target, a target fixed with unchanged background failures, and an unreproduced issue. Inspect the source SHA, frozen target, outcome, exact changed files, and background panel. Configure publication only for a controlled fork test, then explicitly click the normal/draft action and verify parent/tree/head/base and repeated-click recovery. Development automation must never create a real third-party fork or PR.

An external issue is a separate human-selected trial after these checks. A failed preflight, absent target, unsupported repair, or unexpected generated oracle is a valid stopping result. Inspect the immutable proof before deciding whether to publish; never assume every public JavaScript/TypeScript issue is supported or repairable.
