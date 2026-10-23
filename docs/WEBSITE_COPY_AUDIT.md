# Website copy and claim-accuracy audit

Reviewed on 2026-10-23 against local `main` at `efd0743`.
Working branch: `chore/website-copy-accuracy-audit`.

The website now describes AI investigation and candidate repair, evaluation
against recorded requirements, and evidence available for inspection. The audit
does not add features or change the engine, design, submission controls, or
publication behavior.

## A. Website copy audit

| Page or surface | Components and states reviewed |
| --- | --- |
| `/` and shared metadata | `app/page.tsx`, `app/layout.tsx`; page title, description, example-link availability, and shared Mission Control metadata |
| Landing header and hero | `landing-header`, `hero`; tagline, navigation, primary/secondary actions, introductory claims, and AI/evidence distinction |
| Mission submission | `mission-launcher`, `issue-preview`; issue loading, empty issue description, manual mode, advanced settings, validation, pending submission, interrupted connection, preview errors, and accessible labels |
| Landing explanations | `workflow`, `verdict-cards`, `evidence-preview`, `trust-section`, `landing-footer`; five stages, all three verdicts, illustrative record, optional artifacts, tool/coverage limitations, final CTA, and footer |
| `/missions/[missionId]` | Saved-result page, unavailable/invalid bundle, partial artifacts, warnings, execution failure, and footer |
| Live Mission Control | `live-mission`; every phase, waiting state, unavailable status, polling retry, terminal execution failure, elapsed-time explanations, refresh action, live Proof Chain, and footer |
| Saved mission summary | `mission-header`, `mission-summary`, `github-issue-body`; execution versus verdict, repository/issue links, source metadata, manual reports, issue text, and accessibility |
| Saved evidence | `investigation-report`, `flight-recorder`, `proof-chain`, `diff-viewer`, `verification-evidence`; proposed diagnosis, recorded event display, integrity descriptions, review reasons, missing diff, clipboard feedback, command outcomes, stdout/stderr, and absent evidence |
| Export and publication | `export-evidence`, `pull-request-action`; download scope, eligibility notices, normal/draft PR actions, credentials, pending/error/retry states, and existing PR links |
| `/benchmarks` | Page metadata; `benchmark-dashboard`, `benchmark-summary`, `benchmark-table`, `verdict-distribution`, `benchmark-refresh`; scope, eight metrics, denominator, missing/unsupported records, selected scenarios, history, timing, technical details, search/sort/filter labels, no matches, setup state, screen-reader text, and refresh notice |
| Shared presentation and errors | `live-proof-chain`, `pull-request-types`, all benchmark libraries, input/issue validation, proof loader, live-status/process bridge, repository-root/retention helpers, publisher, exact-patch validation, and their user-facing messages |
| API error surfaces | Issue preview GET, mission POST, mission-status GET, and PR POST; safe fixed errors, unchanged response shapes and status codes |
| Design support | `icon.tsx`, `app/icon.svg`, and responsive CSS reviewed; no custom not-found page exists. No icon, CSS, layout, or breakpoint changes were needed. |

The seven requested documentation guides were reviewed: [Verification](VERIFICATION.md),
[Security and limitations](SECURITY_AND_LIMITATIONS.md), [System design](SYSTEM_DESIGN.md),
[Benchmark Dashboard](BENCHMARK_DASHBOARD.md), [GitHub issue and PR flow](GITHUB_ISSUE_PR_FLOW.md),
[Getting started](GETTING_STARTED.md), and [OpenRouter reliability](OPENROUTER_RELIABILITY.md).
Technical claims were also checked against the source cited below.

## B. Important claims corrected

Paths under `components/` below are relative to `apps/web/`.

| File and UI section | Previous wording | New wording | Reason and implementation evidence |
| --- | --- | --- | --- |
| `components/landing/landing-header.tsx`, mission/benchmark headers, homepage metadata | Every patch earns its verdict. | Candidate repairs. Recorded evidence. | Execution can stop before a patch or verdict. [Runner](../src/mission/runner.ts), [verification outcomes](VERIFICATION.md). |
| `components/landing/hero.tsx`, introduction | Reproduces the reported bug; reruns trusted tests; produces a deterministic verdict | AI attempts a candidate repair; runs the configured reproduction and repository test script; calculates a verdict when verification completes | Failure expectations are predicates; repository tests are not an independent oracle; completion is conditional. [Reproduction](../src/verification/reproduction.ts), [project detection](../src/repository/detect-project.ts), [runner](../src/mission/runner.ts). |
| `components/landing/hero.tsx`, evidence principle | Tool evidence is authoritative. | AI reasoning is not proof. Recorded checks determine the verdict. | Observations are bounded; model reasoning is not a verdict input. [Verdict rules](../src/proof/verdict.ts), [security limits](SECURITY_AND_LIMITATIONS.md). |
| Landing and benchmark navigation | Verify a patch | Start verification | The existing form starts from a repository/report or issue, not an uploaded patch. Destinations remain unchanged. [Submission form](../apps/web/components/landing/mission-launcher.tsx). |
| `components/landing/workflow.tsx`, PATCH stage | AI proposes the smallest evidence-supported change. | AI attempts a candidate repair within fixed limits. | The agent has an iteration limit; minimality is not proved. [Patch agent](../src/agent/patch.ts). |
| Landing workflow and live phases | Unqualified bug-to-verdict sequence; producing a patch | A mission can stop before a patch or verdict; attempting a bounded candidate repair | Preparation, provider, investigation, or patch failures can interrupt execution. [Runner](../src/mission/runner.ts), [request recovery](../src/ai/chat-recovery.ts). |
| `components/landing/issue-preview.tsx` | ISSUE DETECTED | ISSUE LOADED | PatchVerdict retrieves a supplied issue rather than discovering it. [Issue resolver](../apps/web/lib/github-issue.ts). |
| `components/landing/mission-launcher.tsx`, scope | A repository. A reported bug. A verdict backed by evidence. | Public JavaScript/TypeScript repositories with a root package.json, test script, and matching npm/pnpm lockfile | General repository support is not implemented. [Project detection](../src/repository/detect-project.ts), [preparation](../src/repository/prepare.ts). |
| Same file, reproduction/marker help | Auto-detected command; marker confirms a symptom | npm/pnpm default, baseline exit 1, post-repair pass; if supplied, a literal case-sensitive marker must appear, but does not prove cause | These are the actual configured predicates. [CLI plan](../src/real-mission-demo.ts), [reproduction classification](../src/verification/reproduction.ts). |
| Same file, interrupted submission | Inputs are saved here; try again | Inputs remain in the form; a mission may already be running; history lists only saved attempts | Inputs are local component state; submission is not deduplicated across separate requests, and history skips active runs. [Launcher](../apps/web/components/landing/mission-launcher.tsx), [history discovery](../apps/web/lib/benchmarks/aggregate.ts). |
| `components/landing/verdict-cards.tsx`, VERIFIED | Verification integrity was preserved; evidence satisfies every requirement | Required checks passed; no recognized integrity flags or violations detected; applies to recorded checks | Integrity uses defined path/text heuristics. [Integrity analysis](../src/verification/integrity.ts), [verdict rules](../src/proof/verdict.ts). |
| REVIEW_REQUIRED cards and `components/mission/proof-chain.tsx` | Patch passed verification; automatic verification was withheld | Functional checks passed; recorded integrity concerns require human review | Review is a calculated outcome after functional checks pass, not withheld execution or human approval. [Verdict rules](../src/proof/verdict.ts). |
| FAILED cards, mission page, benchmark summary | Approved-repair requirement; Mission failed | Completed verification did not meet acceptance conditions; Mission execution failed | A failed execution may have no repair verdict. Unavailable evidence is neither a computed FAILED verdict nor proof of a failed repair. [Runner](../src/mission/runner.ts), [proof loader](../apps/web/lib/load-proof-bundle.ts). |
| `components/landing/trust-section.tsx` | Agent can act only through declared tools; human-aware safety | Fixed attempt limits; targeted tests use Vitest; integrity checks cannot detect every way to weaken tests | Declared investigation tools are not a separate enforced dispatch allowlist. Targeted execution is specifically Vitest. [Investigator](../src/agent/investigate.ts), [test tool](../src/tools/run-test.ts), [security limits](SECURITY_AND_LIMITATIONS.md). |
| `components/landing/evidence-preview.tsx` | Every verdict is backed by a saved proof bundle | A bundle records checks and available artifacts; some artifacts may be unavailable | Saving/reading can fail, and optional artifacts can be absent. Static example is labeled EXAMPLE RECORD. [Bundle writer](../src/proof/bundle.ts), [loader](../apps/web/lib/load-proof-bundle.ts). |
| `components/mission/investigation-report.tsx` | ROOT CAUSE ANALYSIS | PROPOSED DIAGNOSIS; AI investigation report | Provenance validation does not establish the truth of the diagnosis. [Provenance checks](../src/agent/investigation-provenance.ts). |
| `components/mission/proof-chain.tsx`, integrity | Verification remained independent | No recognized integrity concerns detected | Heuristic detection is not a complete independence guarantee. [Integrity analysis](../src/verification/integrity.ts). |
| Proof Chain, command evidence, illustrative record, live labels | Full test suite | Repository test script | The engine invokes the repository's existing `test` script; coverage depends on that script. Raw stored command labels remain unchanged. [Project detection](../src/repository/detect-project.ts). |
| `components/mission/diff-viewer.tsx`, empty state | No candidate patch was produced. | No candidate patch is recorded in this proof bundle. | Missing loaded evidence does not establish what execution produced. [Proof loader](../apps/web/lib/load-proof-bundle.ts). |
| `components/mission/export-evidence.tsx` | Export evidence | Export result JSON; tooltip says it is not the complete proof bundle | Download serializes the loaded mission result plus mission ID/data source, not the raw bundle. [Download implementation](../apps/web/components/mission/export-evidence.tsx). |
| `components/mission/pull-request-action.tsx` | Generic draft/publication wording | Explicit candidate publication, required credentials/write access, no merge, continued human review | PR creation is a separate user action; REVIEW_REQUIRED creates a draft. [Eligibility](../apps/web/lib/pull-request-types.ts), [publisher](../apps/web/lib/github-pull-request.ts). |
| `lib/pull-request-types.ts`, eligibility reason | Canonical proof; verified patch digest | Saved proof; recorded patch digest | The initial UI policy checks presence/shape; the server performs later content consistency checks. [Eligibility](../apps/web/lib/pull-request-types.ts), [publisher](../apps/web/lib/github-pull-request.ts). |
| `components/benchmarks/benchmark-dashboard.tsx`, heading | Every result backed by recorded evidence. | Selected runs. Available evidence. | Selected scenarios remain listed when artifacts are unreadable or missing. [Aggregation](../apps/web/lib/benchmarks/aggregate.ts). |
| Same file, scope and history | Verified bugs across controlled repositories; new completed missions appear automatically | Recorded candidates/checks/verdicts; historical selections do not measure general accuracy or predict reruns; page checks for saved records | Seven fixed selections and bounded discovery are not a general repair benchmark. [Catalog](../apps/web/lib/benchmarks/catalog.ts), [aggregation](../apps/web/lib/benchmarks/aggregate.ts). |
| `components/benchmarks/benchmark-table.tsx` | Bug Reproduced / Reproduced | Baseline Match / Matched, with an expectation-matching explanation | Matching an exit/output expectation does not establish the failure's cause. [Reproduction](../src/verification/reproduction.ts). |
| Benchmark summary, distribution, and table | No Decision / Missing Evidence; ambiguous mission status | No Verdict / Unavailable Evidence; Execution Status separate from Repair Verdict | Availability, execution, and verdict are separate dimensions. Denominator still includes every selected scenario. [Aggregation](../apps/web/lib/benchmarks/aggregate.ts). |
| Benchmark timing | Saved commands; full-suite time | Recorded command durations; repository test script time; untimed stages excluded | Sum covers available durations, up to three saved command artifacts, rather than complete mission duration. [Aggregation](../apps/web/lib/benchmarks/aggregate.ts). |
| Landing final CTA and shared footers | Make patches prove themselves; Tests verify. Humans approve. | Evaluate AI repairs with recorded evidence; Evidence informs review. | The system evaluates bounded requirements and does not guarantee human approval. [Verdict rules](../src/proof/verdict.ts), [publication flow](GITHUB_ISSUE_PR_FLOW.md). |

## C. General writing improvements

- Consistent terms distinguish a candidate repair, recorded execution, repair
  verdict, integrity check, and unavailable evidence.
- Issue text is called a description in the UI; source keys such as `body` remain
  unchanged. Preview wording explains that submission reloads the issue.
- Live polling describes retained progress rather than implying that full proof
  evidence is already available. Fixed event messages are still displayed intact.
- Short headings retain the product's identity without promising a correct repair
  or completed verdict for every submission.
- Accessible table captions, verdict labels, and action tooltips explain scope.
  The export and PR tooltips add explanatory text only.
- Existing clear copy was retained, including the Verified Outcomes denominator,
  history discovery limits, safe route errors, and the Run verification button.

## D. File changes and scope

Relative to `efd0743`, there are **29 application files with copy changes**, **two
test files with text-assertion updates**, and this audit report.

| Directory | Changed files |
| --- | --- |
| `apps/web/app/` | `layout.tsx`, `page.tsx`, `benchmarks/page.tsx`, `missions/[missionId]/page.tsx` |
| `apps/web/components/landing/` | `landing-header.tsx`, `hero.tsx`, `mission-launcher.tsx`, `issue-preview.tsx`, `workflow.tsx`, `verdict-cards.tsx`, `evidence-preview.tsx`, `trust-section.tsx`, `landing-footer.tsx` |
| `apps/web/components/mission/` | `mission-header.tsx`, `mission-summary.tsx`, `live-mission.tsx`, `investigation-report.tsx`, `flight-recorder.tsx`, `proof-chain.tsx`, `diff-viewer.tsx`, `verification-evidence.tsx`, `export-evidence.tsx`, `pull-request-action.tsx` |
| `apps/web/components/benchmarks/` | `benchmark-dashboard.tsx`, `benchmark-summary.tsx`, `benchmark-table.tsx`, `verdict-distribution.tsx` |
| `apps/web/lib/` | `live-proof-chain.ts` (display labels only), `pull-request-types.ts` (two human-readable reasons only) |
| `apps/web/tests/` | `benchmarks-ui.test.mjs`, `issue-pr-ui.test.mjs` (expected text only) |
| `docs/` | `WEBSITE_COPY_AUDIT.md` (this report) |

No changes to engine source, prompts, models, retries, verification/integrity
algorithms, status values, artifact loading/writing, API routes, response shapes,
GitHub publication behavior, benchmark selection/calculation/filtering, package
manifests, lockfiles, CSS, navigation destinations, AWS, or Caddy configuration.
No demo/read-only mode or feature flags were introduced. Forms and actions retain
their existing behavior and availability.

`main` remains at `efd0743`. During the work, the audit branch advanced to
checkpoint `dbccaa2`; no commit, push, or merge command was issued by the audit
agents. Subsequent text refinements, test-assertion updates, and this report are
left for review rather than automatically committed.

## E. Verification

Commands below were run in PowerShell, using `pnpm.cmd` for the requested pnpm
commands. Package-store access was needed by pnpm, and the production build used
network access for the existing Google Fonts integration.

| Working directory | Exact command | Result |
| --- | --- | --- |
| Repository root | `pnpm.cmd typecheck` | Passed after retrying with package-store access. The first restricted attempt failed on `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` before TypeScript ran. |
| Repository root | `pnpm.cmd test` | 129 tests passed in 14 files. |
| `apps/web` | `node --test tests/benchmarks-ui.test.mjs tests/issue-pr-ui.test.mjs tests/mission-live.test.mjs` | Initially 33 passed / 8 failed because expected static copy was outdated. After updating only text assertions, 41/41 passed; passed again after the final helper/error-copy refinements. |
| `apps/web` | `node --test tests/*.test.mjs` | 155/155 passed. |
| `apps/web` | `pnpm.cmd exec next typegen` | Passed. |
| `apps/web` | `pnpm.cmd exec tsc --noEmit` | Passed. |
| `apps/web` | `pnpm.cmd lint` | Passed, including a final run after the last helper/error-copy refinements. |
| `apps/web` | `pnpm.cmd build` | Passed, including a final run after the last helper/error-copy refinements; all application routes built successfully. |
| Repository root | `git -c core.whitespace=cr-at-eol diff efd0743 --check` | Passed. Existing CRLF line endings were preserved; no formatting cleanup was performed. |

Existing behavioral assertions were not removed or weakened. Counts, filtering,
sorting, denominator arithmetic, request payloads, event interpretation, duplicate
click protection, PR eligibility, and safe rendering remain covered by their
original tests. No new tests or dependencies were added.

An independent TypeScript syntax-tree comparison against `efd0743` covered all
29 changed application files. It found no changes to protected literals or JSX
event handlers. The only added syntax consists of two explanatory `title`
attributes on the existing export and PR buttons, within the allowed tooltip
scope. After accounting for those two additions, no syntax-tree structural
differences remained beyond copy text.

A before/after SHA-256 comparison found **all 121 existing files under `output/`
unchanged**, with no missing or new files. This includes live records and saved
proof artifacts. The first comparison script mistakenly wrapped the parsed JSON
array; correcting that diagnostic script produced the complete 121-file match.

Responsive structure and existing wrapping/scrolling CSS were reviewed. Component
tests render actual markup. The browser tool reported no available browser, so
desktop/mobile visual inspection and screenshots were not performed. No live
verification mission or GitHub publication was triggered.

## F. Issues intentionally not changed

- Exact-match progress messages such as `Reported bug reproduced`, `Verification
  integrity preserved`, `Running full test suite`, and `Full test suite passes`
  remain unchanged in the engine, live-event parser, `live-proof-chain`, and
  Flight Recorder. Renaming them requires coordinated contract changes. Their
  surrounding UI now explains configured expectations and limited detection.
- Raw saved events, AI-generated reports, GitHub issue text, diffs, command labels,
  stdout/stderr, verdicts, and statuses remain intact. Historical wording can
  therefore differ from the revised explanatory UI.
- The `Unavailable` formatter sentinel remains unchanged because presentation
  code also compares it. Benchmark catalog names/IDs and selected records remain
  unchanged.
- Saved Flight Recorder coloring uses execution states, so a completed execution
  can use completion styling even when its repair verdict is FAILED. Altering
  that mapping would change behavior and is outside this audit.
- The generated GitHub PR body still says the candidate was “verified by
  PatchVerdict” for eligible REVIEW_REQUIRED drafts as well as VERIFIED results.
  That external publication template was not rewritten in this website-only
  task. The website now distinguishes both outcomes precisely.
- AWS/Caddy access behavior and public demo-mode changes were deliberately left
  untouched. The mission form and Run verification action remain present.

## G. Remaining recommendations

No further website wording change is required by this audit. Before publishing,
review the longer form help, header tagline, benchmark metric notes, and export
label at desktop and mobile widths in an available browser.

For separate future work, review the generated PR introduction so REVIEW_REQUIRED
is described as evaluated with passing functional checks rather than implicitly
VERIFIED. Any backend event terminology migration should be planned with its
parsers, tests, and compatibility for historical records. Public read-only demo
controls remain a distinct implementation task.
