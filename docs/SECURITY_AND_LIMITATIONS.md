# Security and limitations

This guide is for operators and reviewers deciding where PatchVerdict can run and how much confidence to place in its output. The code contains useful input, filesystem, verification, and publication controls. It does not establish that the application is production-hardened or suitable for arbitrary untrusted multi-tenant access.

The practical operating model is a controlled instance, trusted access to the application and its local evidence, and a narrowly scoped GitHub token only when publication is needed. [Getting started](GETTING_STARTED.md) covers configuration; [System design](SYSTEM_DESIGN.md) explains the components.

## Trust boundaries

| Boundary | What crosses it | Remaining limitation |
| --- | --- | --- |
| Browser to Next.js | Issue URL or repository/report, optional sandbox command and marker, mission ID for publication | No built-in authentication, mission ownership, or submission quota |
| GitHub to issue resolver | Public issue title/body from a fixed API origin | Issue content remains untrusted model input |
| Server to backend process | Validated literal arguments, server mission ID, canonical issue metadata | Child inherits the server environment except explicit overrides |
| Backend to OpenRouter | Issue context, repository context, selected tool outputs, model conversation | External provider processing; model output is not correctness evidence |
| Backend to E2B | Clone, install/test commands, candidate edits | Repository scripts execute; no application-defined egress policy |
| Filesystem to dashboard/publisher | Proofs, events, diffs, command evidence | Local files are trusted records, not signed attestations |
| Publisher to GitHub | Reconstructed patch and explicit PR request | Shared server token authority; no per-user OAuth or ownership policy |

## Implemented protections

### Input and GitHub requests

The web input parser enforces types, lengths, required fields, and NUL rejection. Mission requests require JSON and have a 64 KiB body limit. GitHub issue and repository URLs are parsed as constrained HTTPS GitHub paths. The issue resolver constructs a fixed-origin GitHub API URL, disables redirects, bounds response bytes, and applies a timeout. Issue ingestion never attaches the publication credential.

Issue mode refetches canonical data on submission. Preview values cannot substitute a different repository, title, body, or metadata. Preview and issue body components render text rather than raw HTML. These controls reduce URL/request ambiguity and HTML injection risk; they do not establish that an issue is honest or its instructions safe for a model.

Sources: [input parser](../apps/web/lib/mission-input.ts), [mission route](../apps/web/app/api/missions/route.ts), [issue resolver](../apps/web/lib/github-issue.ts), [issue display](../apps/web/components/mission/github-issue-body.tsx). Exact URL forms and bounds are in [GitHub issue and PR flow](GITHUB_ISSUE_PR_FLOW.md).

### Credentials and local process launch

`OPENROUTER_API_KEY` and `E2B_API_KEY` configure external runtime services. `AGENT_MODEL` selects the model and defaults to the value in [the OpenRouter client](../src/ai/openrouter.ts). The optional publication token belongs in the web server environment or `apps/web/.env.local`, as described in [the environment example](../apps/web/.env.example). Credentials must not use a `NEXT_PUBLIC_` name.

The web bridge launches the fixed Node/tsx CLI using separate arguments and `shell: false`. A submitted reproduction command is an argument to the backend and executes through the remote sandbox; it is not interpolated into a host shell command. The bridge assigns the mission ID and blanks `PATCHVERDICT_GITHUB_TOKEN` in the child environment. The empty override also prevents dotenv from restoring the token from the root environment file.

This is a specific token separation measure, not a general environment allowlist: the bridge otherwise spreads `process.env`. Keep unrelated secrets out of the server environment. The publication Git subprocess constructs a smaller environment, uses isolated Git configuration, disables hooks, and has no working-tree checkout. The token travels in GitHub authorization headers, not Git arguments or proof metadata.

Sources: [process bridge](../apps/web/lib/run-backend-mission.ts), [publication Git runner](../apps/web/lib/exact-verified-patch.ts), [GitHub request wrapper](../apps/web/lib/github-pull-request.ts).

### Execution bounds and live status

The web bridge stops a run after 270 seconds and attempts process-tree termination, including children started by tsx. Next.js declares a 300-second route duration. E2B creation requests a ten-minute sandbox lifetime, while each sandbox command has a two-minute timeout. The CLI normally kills the sandbox in `finally`; forcibly terminating the local process may prevent that cleanup, so the requested remote lifetime is a separate bound.

Investigation has eight tool-loop iterations, duplicate-call and targeted-test budgets; patch generation has four iterations. These constrain work, but they do not establish a single guaranteed maximum provider cost. Installation, model latency, provider availability, and command timeouts can prevent completion.

The bridge bounds buffered child logs and accepts only progress envelopes carrying the current mission ID, then validates/sanitizes messages. It does not stream arbitrary repository output or model prose into live progress. Known route errors use controlled messages. Saved command evidence is different: proofs intentionally retain stdout/stderr and other execution detail, without a general redaction guarantee.

Sources: [process bridge](../apps/web/lib/run-backend-mission.ts), [event parser](../apps/web/lib/mission-live-types.ts), [sandbox adapter](../src/sandbox/e2b.ts), [investigation](../src/agent/investigate.ts), [patch generation](../src/agent/patch.ts).

### Evidence paths and publication integrity

The dashboard proof loader validates mission IDs, resolves filesystem paths, and requires output, mission directories, and artifacts to remain within their expected parents. It reads fixed filenames rather than paths supplied inside `proof.json`. It parses required metadata and evidence shapes; absent optional evidence remains unavailable.

Publication adds bounded artifact reads, proof/diff digest consistency, matching base commits, allowed verdicts, and contradictory-evidence checks. A temporary Git index reconstructs the base tree, checks blob hashes, applies the recorded diff, and checks the resulting file set and tree hash. The publisher rechecks canonical proof before opening the PR. Publication state is separate and does not rewrite the proof or verdict.

These are consistency controls. A SHA-256 digest beside the diff is not a signature or independent attestation: an actor with output-directory write access could replace evidence and its digest. Atomic writes reduce partial-write exposure; they do not make files immutable or protect against a hostile local administrator. Path containment also does not establish complete protection against concurrent filesystem mutation.

Sources: [proof loader](../apps/web/lib/load-proof-bundle.ts), [proof writer](../src/proof/bundle.ts), [publisher](../apps/web/lib/github-pull-request.ts), [exact patch validation](../apps/web/lib/exact-verified-patch.ts). See [Verification](VERIFICATION.md) for artifact semantics and [GitHub issue and PR flow](GITHUB_ISSUE_PR_FLOW.md) for publication bounds.

## Current limitations

### Application access

There is no built-in account authentication, role model, per-mission ownership check, or tenant separation. Mission creation and evidence viewing are available to clients that can reach the application. The mission route has no application-level rate limiter or queue/concurrency admission control; repeated accepted submissions can start separate provider-backed runs.

The PR route rejects a supplied foreign `Origin` or `Sec-Fetch-Site: cross-site`. Requests with neither header can proceed. These checks address a browser request pattern, not caller identity or authority. The explicit UI click is a workflow boundary, not authentication. Anyone able to call the endpoint with an eligible mission ID can attempt publication using the configured server token.

GitHub enforces token permissions. PatchVerdict does not add an operator-configured repository allowlist, per-user tokens, OAuth, or GitHub App authorization. Restrict network access to the instance and limit token repository scope when operating it. Those are deployment precautions, not built-in application features.

Sources: [mission route](../apps/web/app/api/missions/route.ts), [publication route](../apps/web/app/api/missions/[missionId]/pull-request/route.ts), [publisher](../apps/web/lib/github-pull-request.ts).

### Untrusted execution and model context

Repository preparation uses `pnpm install --frozen-lockfile` or `npm ci --no-audit --no-fund`. These commands do not disable lifecycle scripts. The detected test script, user reproduction command, and targeted Vitest tests execute in E2B. Preparation checks HEAD and tracked files after installation, but this is not malware detection and does not constrain every side effect or untracked file.

The sandbox adapter requests remote execution and timeouts. It does not configure an application-specific network egress policy, dependency allowlist, or per-command capability policy. This guide makes no claim about E2B's platform security beyond how this repository uses its API. Untrusted code may perform network requests or manipulate its test environment inside the sandbox.

The model receives issue text and repository/tool context. Prompt injection remains a risk; there is no proof that model instructions cannot be diverted. Tool schemas, provenance checks, budgets, and later execution checks constrain parts of the workflow without providing a general prompt-injection defense. Provenance validation connects references to observed sources; it does not prove a diagnosis true. Assume context sent to OpenRouter leaves the local machine, and avoid secrets in demonstration inputs.

Two implementation gaps matter when describing tool boundaries:

- `read_file` and `apply_patch` reject lexical traversal and absolute paths, but do not resolve symlinks to prove the final target stays inside the project. These checks are not complete filesystem confinement.
- Investigation advertises read/search/test tools, but its dispatch path forwards the returned function name to the shared dispatcher, which also exposes `apply_patch`. It lacks a separate investigation-phase allowlist. The advertised tool list must not be described as an enforced read-only security boundary.

Sources: [preparation](../src/repository/prepare.ts), [sandbox adapter](../src/sandbox/e2b.ts), [read-file tool](../src/tools/read-file.ts), [patch tool](../src/tools/apply-patch.ts), [investigation](../src/agent/investigate.ts), [tool dispatcher](../src/tools/index.ts), [provenance validation](../src/agent/investigation-provenance.ts).

### Verification establishes bounded evidence

`VERIFIED` means the recorded candidate satisfied the implemented reproduction, patch, suite, and integrity conditions for that run. It does not guarantee semantic correctness, security, adequate coverage, or behavior on every input. Tests run repository-controlled code; exit codes and output are execution observations, not an independent oracle of the issue's truth.

Integrity analysis uses filename and textual diff patterns. It flags recognized test/infrastructure changes for review and detects selected compromising changes such as skipped tests, removed/weakened assertions, and altered discovery. It is not a parser-based proof that tests cannot be weakened, and does not cover every framework, naming convention, or indirect behavior change. Changes outside recognized patterns can escape those heuristics.

The runner captures the patch diff before post-patch reproduction and full-suite execution. It does not take another final diff afterward to prove that those commands left the tested checkout unchanged. Repository scripts can mutate files during testing. Exact PR publication preserves the saved diff, but does not close this execution-to-recording gap.

Model explanations remain distinct from command evidence. `REVIEW_REQUIRED` is not approval, and an execution failure may produce no verdict. See [Verification](VERIFICATION.md) and the [controlled benchmark methodology](BENCHMARK_DASHBOARD.md).

Sources: [integrity rules](../src/verification/integrity.ts), [verdict rules](../src/proof/verdict.ts), [mission runner](../src/mission/runner.ts).

### Repository and runtime scope

Preparation expects a public GitHub repository with a root `package.json`, an npm or pnpm lockfile consistent with package-manager detection, and a `test` script. The detector recognizes Vitest and Jest, but investigation's `run_test` specifically invokes `npx vitest run -t`. Detection is not complete framework support. Arbitrary languages, private repositories, nested-project setup, unusual toolchains, and long installations are not established as supported workflows.

The web host needs the checkout, installed root dependencies, writable output, and a long-lived Node process able to spawn the backend. There is no durable job queue or restart/resume worker. Progress persists, but a restarted server does not resume execution; abandoned records eventually expire into failure. A static export or short-lived Edge host cannot provide this process integration.

Publication has a narrower patch/tree scope than evidence display and requires same-repository write permission. It does not fork, merge, rebase, or rerun checks on the latest default branch. Provider/network/API errors can leave partial runs or require publication retry.

Sources: [project detector](../src/repository/detect-project.ts), [targeted test tool](../src/tools/run-test.ts), [live status](../apps/web/lib/mission-live-status.ts), [publisher](../apps/web/lib/github-pull-request.ts).

### Evidence privacy and storage

Bundles can contain issue text, source fragments, diffs, model analysis, and raw test output. There is no general secret-redaction layer for all of that content. Inspect bundles before sharing or exporting, and keep sensitive backups private. Local `output/` artifacts are not automatically included in a clone.

The general dashboard proof loader reads artifacts without a general per-file byte limit; the publisher and benchmark loader have their own bounds. Arbitrary externally supplied proof directories should not be treated as safe uploads. Filesystem permissions remain part of the trust model.

Retention removes eligible old mission directories and their PR metadata under the [documented policy](BENCHMARK_DASHBOARD.md); it is not a backup system. Model responses and external services can change between runs. Selected historical proofs do not promise an identical patch today. Available tests do not establish production-scale reliability or an independent security audit.

## Potential future improvements — not implemented

Possible next steps include authenticated users and per-mission authorization, repository allowlists, submission quotas/concurrency limits, a stricter child-environment allowlist, phase-specific tool enforcement, stronger sandbox path/network controls, a final post-verification repository snapshot, bounded reads across all artifact surfaces, and signed or independently stored evidence. A durable queue could improve restart behavior. These are work items, not current capabilities.

For a controlled presentation with honest fallbacks, use the [demo guide](DEMO_GUIDE.md).
