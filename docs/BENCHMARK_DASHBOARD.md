# Benchmark Dashboard

Explore how PatchVerdict investigated, repaired, and verified bugs across controlled test repositories.

**Every result backed by recorded evidence.**

Results reflect selected controlled test scenarios, not general-purpose repair accuracy.

This document is for reviewers interpreting the saved results and maintainers preserving their evidence. For local setup, see [Getting Started](GETTING_STARTED.md); for the engine's verdict rules, see [Verification](VERIFICATION.md).

The read-only dashboard at `/benchmarks` presents recorded PatchVerdict proof bundles: the saved verdict, events, and available supporting artifacts for each mission. It uses the existing version 2 proof loader and the existing Mission Control evidence pages. Opening or refreshing the dashboard does not launch a mission, execute a test, change a verdict, or write proof artifacts. A selected run without readable, valid evidence remains unavailable.

## Evidence and fixed benchmark selection

Evidence comes from the repository-level `output/<missionId>/` directory. The application resolves the same checkout whether Next.js starts from the repository root or `apps/web`. A finalized bundle has `proof.json` and `events.json`; the existing writer publishes `proof.json` last. Temporary manifests, live run metadata, and directories without a finalized manifest do not become discovered recorded results.

`output/` is [ignored by Git](../.gitignore). A fresh clone contains the catalog but not the historical proof bundles or dashboard history described here. The observations below were checked against evidence present in the documentation author's local checkout; other checkouts may correctly show unavailable results.

The tracked configuration is [`apps/web/lib/benchmarks/catalog.ts`](../apps/web/lib/benchmarks/catalog.ts). Each entry identifies one exact recorded run and the repository expected for that scenario. The dashboard validates the saved bundle with the existing loader and compares its recorded repository identity with the catalog. GitHub repository identity comparison is case-insensitive and accepts equivalent URLs with a trailing slash or `.git` suffix.

The catalog selects seven scenarios, each linked to one specific completed run. New attempts do not change the selected benchmark results or replace these mission IDs automatically. All seven selections are retained in this documentation overhaul.

**Selection provenance requires review.** Earlier documentation attributed the historical run choices to explicit user approval on 2026-10-20, including the choice of `debug-normalization-01` and the latest completed candidates for three repositories. The available repository record does not independently substantiate that approval or selection rationale. Saved proofs establish the recorded outcomes, not who approved the selection. The existing IDs are retained without asserting an unverified historical decision.

| Scenario | Selected mission ID | Saved verdict at inspection |
| --- | --- | --- |
| Username Normalization | `debug-normalization-01` | VERIFIED |
| Division by Zero | `web-42a66b12-7219-4d6e-a799-c49f797aa13d` | VERIFIED |
| Array Boundary | `web-5e60fb32-602e-4bf3-9707-d58bbb6168bd` | VERIFIED |
| Boolean Condition | `web-b1439d1c-7727-4b7f-a8d2-367ceae8a8e4` | VERIFIED |
| Off-by-One Range | `web-4ac3cf2d-4bdd-4c96-b73b-dabca9c82109` | VERIFIED |
| Average Calculation | `web-69465de5-6600-42b8-96ec-8fb49fe24c72` | VERIFIED |
| Test State Leak | `web-d59e040c-e511-4d9e-bd6b-7cb6bfdd645d` | REVIEW_REQUIRED |

At inspection on 2026-10-21, the existing dashboard reader accepted all seven selected bundles and matched their saved repository identities to their catalog entries. All seven had the required proof/events and all three command evidence artifacts. Six had matching structured GitHub issue #1 metadata; `debug-normalization-01` had no structured issue metadata. These valid saved proofs reported **six VERIFIED, one REVIEW_REQUIRED, and zero FAILED** verdicts, giving **6 / 7 = 85.7% Verified Outcomes**. The 21 available command durations summed to **26,986 ms of recorded test execution time**.

These counts, percentages, and durations describe the inspected evidence. The application computes them from valid saved bundles on every refresh; they are not hardcoded outcomes or promises that evidence will remain available. The seven selected scenarios remain the denominator even if a bundle becomes unreadable or unavailable.

The discovery inventory at this inspection contained 22 finalized manifests: 14 validated v2 records (10 VERIFIED, 2 REVIEW_REQUIRED, and 2 failed executions with null verdicts) plus 8 unsupported v3 records. This describes the inspected checkout, not a fixed history count. Unsupported records remain unavailable and are not reinterpreted or migrated.

During the documentation audit on 2026-10-21, a read-only call to the actual dashboard aggregator revalidated the same seven selections and 22 discovered records, with no discovery truncation or availability notices. The command-duration total remained 26,986 ms. This was an inspection of existing artifacts, not a new mission or test execution; it does not authenticate the origin of locally editable evidence.

The selected Test State Leak run requires human review because its repair changed the shared test setup in `setupTests.js`. The saved diff replaces the shared `return templateUser` with `return { ...templateUser }`, giving each test a fresh object. The bug was reproduced and both the post-repair test and full test suite passed, but the change also affects how tests verify behavior. Passing tests alone does not resolve that review requirement.

Its saved proof records `REVIEW_REQUIRED` with integrity `REVIEW_REQUIRED`, `preserved: false`, and review flag `Candidate modified test infrastructure: setupTests.js`; its recorded violations list is empty. The only changed file is `setupTests.js`. The baseline, post-repair, and full-suite command exits are 1, 0, and 0; durations are 787, 742, and 778 ms. These are saved observations, not a newly calculated verdict.

**Controlled Benchmarks** presents the seven selected runs: "These results are linked to specific completed runs. New attempts do not change the selected benchmark results."

**Recorded Mission History** lets viewers browse saved mission attempts, including successful repairs, unsuccessful attempts, and results requiring human review. It includes selected and other discovered attempts within the display limits below. Multiple runs for a repository remain separate, including failed attempts and later reruns. Unsupported or invalid discovered bundles remain unavailable. History does not determine benchmark totals or choose replacement runs, and it is not guaranteed to include every mission ever executed.

## Change the controlled catalog deliberately

1. Identify the intended scenarios and the exact saved mission directory belonging to each selected run. Inspect their existing Mission Control pages at `/missions/<missionId>` and their local proof metadata. Do not select a run solely because it passed. Resolve ambiguous candidates explicitly with the benchmark owner.
2. Check that each `proof.json` is a supported version 2 bundle, that its `mission.id` matches the directory name, and that `mission.source.repositoryUrl` records the expected repository. Keep the existing evidence files with the manifest. Bundles without recorded repository identity cannot verify a catalog identity.
3. Edit `benchmarkCatalog` in `apps/web/lib/benchmarks/catalog.ts`, using this exact entry shape:

   ```ts
   type BenchmarkScenario = {
     id: string;            // Stable identifier for this controlled scenario.
     name: string;          // Human-readable scenario name.
     repositoryUrl: string; // Expected HTTPS GitHub repository URL.
     missionId: string;     // Exact existing output directory / recorded mission ID.
   };
   ```

   Use distinct scenario identifiers and the precise mission IDs from saved evidence. Repository and mission values must come from the actual selected runs; this document deliberately supplies no fabricated registration entries.
4. Refresh `/benchmarks` and review each row's availability, repository, recorded execution status, and recorded verdict. Open **View Evidence** to inspect the existing Mission Control record.
5. Run the dashboard tests before committing the configuration. Record any benchmark selection changes so a later comparison uses a clearly identified set of runs.

A missing run stays configured and unavailable. Do not remove a missing or unsuccessful scenario merely to improve the reported rate. To use an unsupported proof version, provide an already-supported saved bundle or address compatibility as a separate task; this dashboard neither changes the proof loader nor rewrites evidence.

## Metrics and missing data

**Benchmark Overview** summarizes all selected scenarios before table filtering or sorting:

| Metric | Definition |
| --- | --- |
| Selected Test Scenarios | Number of catalog entries; currently seven. |
| Readable Proof Bundles | Selected entries whose saved bundle passes validation and repository matching. Missing optional artifacts do not invalidate an otherwise valid manifest; readable does not mean every supporting artifact is present. |
| VERIFIED, REVIEW_REQUIRED, FAILED | Counts of the unchanged recorded verdicts on valid configured entries. |
| No Decision / Missing Evidence | Valid entries with a null verdict plus entries without valid, matching recorded evidence. The underlying data keeps those groups separate as `validWithoutVerdict` and `unavailable`. |
| Verified Outcomes | Valid selected entries with recorded verdict VERIFIED, divided by **all selected scenarios**, including unavailable entries and valid entries without a verdict. An empty catalog has an unavailable percentage, not 0% or 100%. |
| Recorded Test Execution Time | Sum of available validated baseline, post-repair, and full-suite command durations for valid selected entries. Coverage accompanies this value. It is not total mission duration. |

For example, if a six-entry catalog has three valid VERIFIED results, one valid REVIEW_REQUIRED result, one valid run with no verdict, and one missing bundle, Verified Outcomes is 3 / 6 = 50%. This is an explanation of the calculation, not a claim about saved results.

The dashboard explains the recorded verdicts using these descriptions; they do not introduce new verdict rules:

| Label | Explanation |
| --- | --- |
| VERIFIED | The bug was reproduced, the patch was applied, and the required tests passed without detected verification-integrity violations. |
| REVIEW_REQUIRED | The repair requires human inspection because it changed verification-related files or triggered an integrity review flag. |
| FAILED | The completed verification process did not meet the requirements for an approved repair. |
| No Verdict Recorded | The mission ended before a final repair verdict could be produced, or its verdict is unavailable. |

VERIFIED describes the checks performed for that recorded run. It does not guarantee correctness beyond those tests. No Verdict Recorded is a display label for an absent verdict, not a new enum value.

Execution status and verdict are separate: a mission can have execution status `COMPLETED` and verdict `FAILED`, or execution status `FAILED` and no recorded verdict. The dashboard preserves both fields and never recalculates the engine's verdict. A malformed proof containing the text `VERIFIED` does not count as verified.

Baseline reproduction, post-patch results, full-suite results, integrity status, changed-file count, base commit, and investigation iterations are projected from validated saved fields where available. Missing values stay unavailable. In particular, an absent patch does not become zero changed files, and missing integrity is not inferred from a verdict.

The table uses **Scenario / Repository**, **Mission Status**, **Repair Verdict**, **Bug Reproduced**, **Post-Repair Test**, **Full Test Suite**, **Test Integrity**, **Recorded Test Time**, and **Evidence** to distinguish the scenario, execution state, verification observations, and supporting records. **Technical Details** contains the additional recorded metadata.

Search, verdict filters, and scenario/date/duration/verdict sorting change the displayed rows only. They do not rewrite evidence or change the benchmark summary. **View Evidence** links are offered only for validated records and use the existing `/missions/<missionId>` route. Missing, unsupported, invalid, or repository-mismatched proofs show unavailable evidence without a misleading link. A valid failed execution with a null verdict still has inspectable evidence and displays No Verdict Recorded. Missing values never stand in for a passing or failing check.

## Automatic history updates and ordering

New completed missions appear automatically while this page is open. Benchmark totals remain based on the seven selected runs. Updates depend on saved evidence being discoverable within the history limits and visible under the active filters.

The page is rendered on demand with `connection()`. A small client component calls `router.refresh()` approximately every 30 seconds only while `/benchmarks` is active and the document is visible. Hiding the tab stops the timer; showing it starts a fresh interval. Route departure and unmount remove both the timer and visibility listener. There is no background refresh on other pages, backend mission polling, AI invocation, WebSocket, file watcher, or database.

Next.js merges refreshed server data into the existing client tables. Search, verdict filters, and chosen sorting stay selected. A newly finalized mission appears after the next refresh unless the active filters exclude it or discovery limits are reached. Temporary/live-only records do not appear before `proof.json` is published. Direct reload also re-reads the filesystem.

History defaults to newest first. A trusted completion date comes from the validated final event when its state matches the saved execution status, all event timestamps have explicit timezones and chronological order, and no earlier terminal event appears. It is shown as **Recorded** in UTC. This does not require the first event to be PREPARING and does not imply a complete mission duration. When this timestamp cannot be established, a safely inspected manifest's filesystem modification time may be shown as **Artifact saved** in UTC. Copying or touching an artifact can change that fallback time. Unknown dates remain unavailable and sort last. The date source is always explicit.

## Duration semantics

`durationMs` belongs to each recorded command evidence artifact. Recorded Test Execution Time is the sum of the available durations for these three fixed stages:

- Baseline reproduction: `evidence/baseline-test.json`.
- Post-repair test: `evidence/post-patch-test.json`.
- Full-suite verification: `evidence/full-suite.json`.

This sum is **recorded test execution time**, not total mission duration. It excludes investigation, patch generation, repository preparation, and unrecorded commands. A row identifies how many of its three command durations are available; aggregate coverage identifies the recorded runs and commands contributing to the total. Partial evidence produces a partial sum. No available durations produces `Unavailable`; a genuinely recorded zero-millisecond duration remains zero.

Overall mission duration is available only when the recorded event sequence begins with `PREPARING`, has monotonic timestamps, ends in the terminal state matching the recorded execution status, and contains no earlier terminal event. Otherwise it is `Unavailable`. In particular, a trace beginning at `BASELINE` does not establish the start of repository preparation or the entire mission, even when it has a final timestamp. All seven selected traces inspected on 2026-10-21 began at `BASELINE`, so none established total mission duration.

## Read-only filesystem boundary

Filesystem work stays in the server-only aggregator under `apps/web/lib/benchmarks/`. Its typed, serializable projection is defined in `types.ts`. Raw issue descriptions, command output, investigation reports, diffs, artifact paths, and raw filesystem errors are not sent to the dashboard client.

The reader validates mission IDs, resolves the existing repository root, and checks real-path containment. It rejects symlinks at the output, mission, evidence-directory, and artifact boundaries. It uses the loader's fixed artifact filenames and never follows paths supplied by proof metadata or query parameters. Repository-supplied display text is rendered as text.

The bounded reader applies these limits:

| Limit | Value |
| --- | --- |
| Catalog entries | 100 |
| Directory entries examined during discovery | 500 |
| Recorded missions returned | 100 |
| Accepted artifact size | 2 MiB per file |
| Accepted bundle size | 8 MiB across fixed artifacts |

Discovery streams at most 500 directory entries and selects the 100 most recently saved regular manifests within that scan before loading their bundles. It then orders the returned rows by the displayed event/artifact timestamp. Unsafe manifest nodes are omitted with a notice. Limits are surfaced so a truncated listing is not mistaken for the complete local history; filesystem enumeration does not guarantee the newest global run lies within the first 500 entries. The catalog loads the selected benchmark missions directly, independently of the history limits. Existing limits have not been increased.

The aggregator checks fixed artifacts before and after calling the unchanged loader and rejects detectable changes during a read. These checks assume finalized local artifacts are immutable while being read. They are not a transactional filesystem snapshot and do not guarantee consistency against an adversarial process concurrently replacing files. Keep the saved output directory under trusted local control and avoid editing finalized evidence while serving it.

Missing output directories, missing configured runs, corrupt JSON, unsupported versions, unsafe paths, oversized files, and repository mismatches produce safe unavailable states. Missing optional evidence remains missing, and malformed optional evidence is excluded by the existing loader. Availability messages do not include raw logs or server paths. The dashboard has no external analytics integration.

## Tests and project validation

From `apps/web`, run the focused dashboard tests and the existing Node.js web suite:

```powershell
node --test tests/benchmarks.test.mjs tests/benchmarks-ui.test.mjs
node --test tests/*.test.mjs
```

Tests use disposable fixtures and do not modify real saved proof bundles. They cover seven configured repositories with fixture results of six VERIFIED and one REVIEW_REQUIRED, fixed denominators and integrity, new finalized runs without replacing selected attempts, recorded verdicts and execution failures, missing and malformed evidence, identity matching, date/duration provenance, filtering/sorting across refreshed data, valid-only evidence URLs, refresh visibility/route/unmount lifecycle, filesystem limits, path traversal, symlink protection, and read-only behavior. Fixture results are test inputs, not evidence of real benchmark outcomes. The existing engine and web tests remain part of validation.

The complete requested project validation also includes these commands from the repository root:

```powershell
pnpm typecheck
pnpm test
```

And these commands from `apps/web`:

```powershell
pnpm exec next typegen
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

Check actual command results in the implementation report. This document lists the required commands without asserting that any particular environment has passed them.

On Windows with PowerShell script execution disabled, use `pnpm.cmd` in place of `pnpm` to invoke the same package scripts.

## Implementation references

| Behavior | Source and automated coverage |
| --- | --- |
| Fixed scenario selection | [Catalog](../apps/web/lib/benchmarks/catalog.ts) and [types](../apps/web/lib/benchmarks/types.ts). |
| Validated bundle loading, repository matching, metrics, timestamps, bounded history discovery | [Aggregator](../apps/web/lib/benchmarks/aggregate.ts), [proof loader](../apps/web/lib/load-proof-bundle.ts), and [dashboard data tests](../apps/web/tests/benchmarks.test.mjs). |
| Read-only page rendering, visible-tab refresh, filters and labels | [Page](../apps/web/app/benchmarks/page.tsx), [refresh component](../apps/web/components/benchmarks/benchmark-refresh.tsx), [dashboard](../apps/web/components/benchmarks/benchmark-dashboard.tsx), and [UI tests](../apps/web/tests/benchmarks-ui.test.mjs). |
| Final manifest publication | [Proof writer](../src/proof/bundle.ts) and [bundle tests](../src/proof/bundle.test.ts). |
| Web mission retention | [Retention implementation](../apps/web/lib/mission-retention.ts) and [retention tests](../apps/web/tests/mission-retention.test.mjs). |

## Deployment and interpretation limits

No database is used or required: saved proof bundles supply the recorded results, and the tracked catalog defines the selected benchmarks. The dashboard reads current bundles on server requests rather than embedding results at build time. Direct visits and refreshes use the same server rendering path.

A deployment must retain a readable repository checkout with the existing root markers and persist its repository-level `output/` directory. An ephemeral or static-only deployment will not acquire the developer's local evidence automatically. Mount or provision the genuine saved bundles persistently, retain their fixed file layout, and provide filesystem permissions to read them. Do not copy secrets into published evidence.

PatchVerdict retains the 30 newest completed `web-` mission bundles by default. Catalog registration does not exempt a selected `web-` mission from normal cleanup when later missions run. Preserve benchmark evidence through your existing backup process; if a selected bundle is removed, its configured row becomes unavailable and remains in the verification-rate denominator.

## Non-destructive private backup procedure

The dashboard does not perform backups automatically. Make a private backup before launching enough later missions to trigger retention:

1. Wait until the selected runs have finalized and pause launching new missions during the copy so cleanup cannot remove a source halfway through. Do not edit any source artifacts.
2. Choose an access-controlled backup directory **outside this checkout and outside `output/`**. Create a new empty dated subfolder for this backup; do not reuse or overwrite an earlier backup. Do not put it under a public repository or automatically shared folder: proofs, logs, issue text, and diffs may contain sensitive data.
3. Using the seven exact IDs in the table above, locate each `output/<missionId>` directory. Verify the manifest exists and reject any source directory or descendant that is a symbolic link/junction. Copy each entire directory, preserving its exact mission ID as the destination folder name. Use **Copy**, never Move, and refuse any overwrite prompt. Include `proof.json`, `events.json`, optional reports/diffs, and the complete `evidence` directory.
4. Compare the source and copied file lists. For each corresponding file, compare SHA-256 values. PowerShell's `Get-FileHash -LiteralPath '<source file>' -Algorithm SHA256` and the same command for the copied file provide a read-only check. Repeat for all copied files, not only `proof.json`; any mismatch means the backup is incomplete. Also keep a copy of `catalog.ts` with the backup to preserve which runs were selected.
5. Keep the original `output/` bundles untouched. Retain the private backup separately from source control and record when it was verified. If restoration is needed, stop mission launches and restore only a missing mission directory from the verified copy, with no overwrites or manifest edits. The directory name and recorded `mission.id` must stay identical. Refresh the dashboard to validate the restored bundle through the existing loader.

This procedure copies existing bytes without deleting, renaming, repairing, migrating, or regenerating evidence. No backup or restore is executed by visiting the dashboard.

Controlled scenario outcomes describe only the saved runs listed in the benchmark catalog. They do not estimate general-purpose repair accuracy, establish performance on unseen repositories, or prove that different run conditions are comparable. The dashboard preserves recorded verdicts and validates their format and association; it does not re-execute verification, authenticate externally edited evidence, or change any AI, verification, proof-writing, GitHub publication, or mission execution behavior.
