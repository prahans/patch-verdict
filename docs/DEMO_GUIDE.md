# Demo Guide

Use this guide to rehearse a 3–5-minute PatchVerdict presentation for Leapfrog Frogtoberfest 2026 — Build with AI. The sequence is a suggestion, not a record of a completed presentation or an event rule. It can be demonstrated entirely with genuine saved evidence; a new live mission on a trusted local instance is optional and has no guaranteed outcome or completion time.

[Project overview](../README.md) · [Setup](GETTING_STARTED.md) · [Verification rules](VERIFICATION.md) · [Selected benchmark evidence](BENCHMARK_DASHBOARD.md)

[Live Demo](https://patchverdict.duckdns.org/) · [Demo Video](https://youtu.be/escDTfDGirs)

The public deployment is a read-only showcase. New mission creation and GitHub PR publication are disabled at its deployment boundary. Use it to inspect available saved evidence; use a separate trusted local interactive instance to demonstrate submission or publication. These deployment restrictions do not establish built-in application authentication.

## The explanation to lead with

> PatchVerdict investigates a reported repository bug, attempts a repair, and records the evidence behind its verdict. AI proposes an explanation and a patch; execution results and explicit verification rules determine whether the recorded candidate satisfies the checks, needs review, or fails.

The problem is easy to recognize: a convincing diff and a green test are not enough to establish that the intended bug was reproduced and repaired under trustworthy test conditions. Show the baseline, the candidate, the post-repair checks, and the integrity result as separate pieces of evidence.

The engineering distinction is the implemented pipeline around the model: repository preparation, source-reference checks, recorded command results, deterministic verdict precedence, proof persistence, and a separate publication boundary. Avoid describing this as an autonomous software engineer or claiming that an explanation proves causality.

## Choose genuine evidence before presenting

The existing benchmark catalog provides two useful contrasting records. These outcomes were supported by the saved bundles inspected on **2026-10-21**; availability must be checked on the presentation machine.

| Purpose | Selected scenario | Local Mission Control path |
| --- | --- | --- |
| Show a recorded `VERIFIED` result | Division by Zero | `/missions/web-42a66b12-7219-4d6e-a799-c49f797aa13d` |
| Explain review despite passing tests | Test State Leak | `/missions/web-d59e040c-e511-4d9e-bd6b-7cb6bfdd645d` |
| Explain the selection and denominator | Current selected scenarios (nine as of 2026-10-24) | `/benchmarks` |

The source repositories are [patchverdict-divide-by-zero](https://github.com/prahans/patchverdict-divide-by-zero) and [patchverdict-test-state-leak](https://github.com/prahans/patchverdict-test-state-leak). The issue example already used by the application documentation is [division-by-zero issue #1](https://github.com/prahans/patchverdict-divide-by-zero/issues/1). Check that it is still readable before relying on a live preview.

The selected runs are tied to recorded commits. A new submission uses the repository state available when it runs; an issue or default branch may have changed. Do not promise that rerunning the issue will reproduce the historical outcome, and do not replace the selected benchmark IDs to improve the demo.

Saved `output/` bundles are ignored by Git and are not included in a fresh clone. Follow the [private backup procedure](BENCHMARK_DASHBOARD.md#non-destructive-private-backup-procedure) before launching additional missions. Normal retention can remove selected `web-` bundles; selection does not exempt them. Never fabricate a missing proof or use the landing page's illustrative **EXAMPLE RECORD** as a recorded result.

## A four-minute sequence

| Time | Show | Explain |
| --- | --- | --- |
| 0:00–0:25 | Project name and landing page | “A patch should come with the evidence used to judge it.” Briefly introduce the problem and the separation between model reasoning and observed checks. |
| 0:25–0:55 | Reported issue and reproduction settings | On the public showcase, inspect the saved issue and recorded commands. On a local interactive instance, optionally show the issue preview, manual-report option, and **Advanced verification settings**. Explain that submission re-fetches the issue on the server. |
| 0:55–1:55 | The saved Division by Zero mission | Announce that this is a recorded run. Show the base commit, **Flight Recorder**, **AI investigation report**, **Candidate patch**, and **Verification evidence**. Point to baseline failure followed by post-repair and repository-test success in the actual record. |
| 1:55–2:40 | The saved Test State Leak mission | Show the `REVIEW_REQUIRED` result, passing test evidence, and the `setupTests.js` change. Explain why a test-setup change still needs a person to inspect it. |
| 2:40–3:20 | **Benchmark Dashboard** | Show the current nine selected scenarios: six recorded `VERIFIED`, two `REVIEW_REQUIRED`, and one completed `FAILED` verdict, if the same evidence remains available. Explain that new history entries do not replace these selections and that Conflicting Contract is an artificial negative control. |
| 3:20–4:00 | Publication boundary and architecture | Explain the eligible normal/draft PR choices available on a configured local instance; publication is disabled on the public demo. Describe the exact recorded patch boundary and what the tests establish. |

For a three-minute slot, shorten the input preview and architecture explanation. For five minutes, spend the additional time on the patch, review flag, or a judge's question. Do not spend the entire slot waiting for a provider.

### Optional local live submission

If you choose to start a new mission on a separate trusted local instance, do so early and acknowledge that it is a fresh attempt. This workflow is unavailable on the public demo. A successful launch returns HTTP 202 and opens `/missions/<missionId>` while the CLI continues on the Node server. The live view polls persisted status; it does not manufacture progress from a timer. When a proof manifest appears, the page loads the saved result.

While the new attempt runs, present the prepared saved records. If it finishes, show its actual outcome—even if it differs from the selected benchmark. A new completed attempt may appear in history after the next visible-page refresh, subject to filters and discovery limits. It does not enter the selected denominator automatically.

You can show input without submitting it. This is preferable when provider credentials, credit, network access, or available time have not been checked. Do not start repeated missions just to obtain a green outcome.

## What to point at in the evidence

**Reproduction:** Show the baseline command, exit code, and relevant output. The web CLI expects exit code 1, any supplied literal failure marker, and no `Startup Error`. With no marker, a matching exit code is a relatively weak link to the reported bug. Say “the configured reproduction expectation matched,” rather than claiming that every nonzero exit proves the issue.

**Investigation:** Point to the report and its inspected-source references. The model can read/search repository files and request a targeted Vitest run; the implementation validates structured output and references to observed tool sources. It does not independently prove every sentence in the diagnosis. There is no separate counterfactual experiment planner or persisted transcript of every model/tool exchange. Do not invent an experiment that is absent from the saved evidence.

**Repair and verification:** Show the saved diff and the post-repair reproduction/full-suite results. Those stages use command exit codes; the full suite is the repository's configured test script. If discussing recovery, state its actual bound: one correction attempt when post-repair reproduction fails, not an open-ended self-healing loop.

**Review case:** The Test State Leak diff replaces `return templateUser` with `return { ...templateUser }` in `setupTests.js`. Its recorded baseline, post-repair, and suite exit codes are 1, 0, and 0. The integrity record has a test-infrastructure review flag and an empty violations list. The right explanation is “tests passed, but the repair changed verification-related setup,” not “the tests failed” or “a malicious patch was detected.”

**Benchmark totals:** The 2026-10-21 inspection recorded 6/7 selected outcomes (85.7%) and 26,986 ms of available test-command durations. That historical snapshot excludes the two additions registered on 2026-10-24. The 2026-10-24 inspection of the nine-scenario selection recorded six VERIFIED, two REVIEW_REQUIRED, and one completed FAILED verdict (6/9 = 66.7%); see the [current selection](BENCHMARK_DASHBOARD.md#current-nine-scenario-selection-2026-10-24). Present those counts only when the corresponding evidence remains readable on the demonstration instance. Neither ratio is an independently sampled real-world success rate or a prediction for unseen repositories. Command durations exclude investigation and preparation; the earlier seven traces do not establish total mission duration.

**Export:** **Export result JSON** downloads the loaded mission result as JSON. It is useful for inspecting that record, but is not a full backup of the original artifact directory. Preserve the complete bundle separately.

## Demonstrating publication responsibly

Publication is optional and requires a separately configured trusted interactive instance; it is disabled on the public deployment. On that interactive instance, an eligible completed `VERIFIED` record exposes **Create pull request**; `REVIEW_REQUIRED` exposes **Create draft PR**. A visible action is not a guarantee of success: the server reloads and validates the saved evidence, patch digest, base commit, supported patch format, and GitHub permissions. Older records without a digest may remain viewable while being ineligible to publish.

Use a repository you control and a restricted server token if you intend to perform the real write. Otherwise, explain the action without clicking it. An existing, validated **View PR** link may be shown when available; do not invent one. This documentation exercise did not use the application's repair-PR action, and mocked publication tests are not a live demonstration of that action.

The publisher builds from the recorded base and exact diff. It does not regenerate the patch, rebase it onto today's default branch, or run verification again. A normal PR still needs human inspection; a draft makes the recorded review requirement explicit. Nothing merges automatically. See [GitHub Issue and PR Flow](GITHUB_ISSUE_PR_FLOW.md).

## Technical judge questions

| Question | Accurate answer |
| --- | --- |
| Why use deterministic verification? | The same recorded checks follow explicit verdict rules. A model's confidence or persuasive explanation does not choose the verdict. Determinism does not make incomplete tests complete. |
| How do you decide whether to trust a patch? | Match the baseline expectation, confirm a real candidate change, run post-repair reproduction and the suite, and evaluate file/diff integrity rules. `VERIFIED` is bounded to these checks. |
| What if tests pass but integrity needs review? | With all functional checks passing, an integrity review flag yields `REVIEW_REQUIRED`; compromised integrity yields `FAILED`. The setup-file example shows the first case. |
| Is the investigation read-only? | The prompt and advertised tools intend that separation, but it is not a complete security boundary. The current dispatcher lacks an investigation-only tool allowlist, and repository tests can themselves modify files. |
| What prevents unauthorized publication? | The server checks canonical evidence, exact patch/base identity, browser-origin signals, and GitHub token permissions. There is no application login or per-user ownership check. Use a trusted restricted host; a human button is not authentication. |
| How do AI and E2B interact? | The Node backend calls OpenRouter and executes requested repository operations through E2B APIs. The model proposes tool calls and a candidate; code executes operations and evaluates checks. |
| Are experiments or counterfactual tests implemented? | The investigation can request targeted Vitest executions to examine hypotheses. There is no separate counterfactual planner or general experimental-proof system. |
| What happens if a mission fails? | A runner failure can save partial evidence with execution `FAILED` and no verdict. Preparation/provider/process failures can occur before a proof exists; the web bridge records a safe execution-failure state. |
| Does 85.7% mean it fixes most GitHub bugs? | No. That was six verified outcomes among the seven controlled runs inspected on 2026-10-21. The current nine-scenario selection is separately documented; neither selection estimates general repair accuracy. |
| What repository types are supported? | Preparation expects a root JavaScript/TypeScript package with an npm/pnpm lockfile and test script. Targeted investigation is Vitest-specific. Detection of a project is not proof it can be repaired successfully. |
| Can a test or patch fool the system? | Integrity checks are heuristics, and local artifacts are not signed attestations. The implementation also captures the patch before final tests without a post-test recapture. These limits prevent a universal correctness claim. |
| How was AI used during development? | AI coding tools assisted project development. Separately, the application uses models through OpenRouter at runtime. No exact authorship percentage is established. |

The [verification guide](VERIFICATION.md), [system design](SYSTEM_DESIGN.md), and [security review](SECURITY_AND_LIMITATIONS.md) link these answers to source and tests.

## Before going on stage

- Follow [Getting Started](GETTING_STARTED.md) and run the documented local checks. A production build may need access to Google Fonts; do not discover this during the presentation.
- Confirm the app opens, both selected mission URLs load real proofs, and `/benchmarks` shows the expected available records. Read any missing-evidence notice aloud if it affects the claim.
- Back up the selected bundles privately. Keep a copy of their catalog and verify copied bytes; do not edit proofs to fit the narrative.
- If using a live attempt, check provider access and credits beforehand and choose a repository whose current failure you have actually inspected. Rehearsal missions cost provider resources and are separate attempts.
- Keep `.env` files, tokens, raw request headers, and unrelated sensitive logs off screen. Review evidence before showing or sharing it.
- If showing publication, decide in advance whether you intend a real write and use a restricted token/repository. Keep Git installed on the server.
- Open the saved verified record, review record, and benchmarks in separate tabs. Rehearse switching between them and keep the core explanation under four minutes.

## Fallback when the live path fails

| Problem | Honest fallback |
| --- | --- |
| GitHub preview is unavailable or rate-limited | Show the already saved issue-backed record, or the manual-input option on a local interactive instance. Explain that public issue reads are unauthenticated and depend on GitHub. |
| OpenRouter/E2B or the live mission fails | Show the actual failure status, then switch to a prepared recorded run. Label it as historical evidence; do not imply the interrupted mission succeeded. |
| A selected proof is missing | Explain the unavailable row. Use only a verified private backup of the original bytes, restored according to the benchmark guide, or present the source/rules without claiming a local result. |
| The server restarts | Reopen completed saved proofs if present. Active execution is not resumed by the app; a saved status record is not a durable worker. |
| PR publication fails or is ineligible | Keep the recorded verdict on screen and explain the separate publication boundary. Show the controlled error without changing the proof or retrying blindly. |
| The whole local app is unavailable | Use the repository's architecture and verification documents. Clearly distinguish implemented behavior, previously inspected outcomes, and what you could not demonstrate live. |

Close with the narrow claim the evidence supports: PatchVerdict makes recorded candidate repairs and the checks behind their verdicts available for human inspection.
