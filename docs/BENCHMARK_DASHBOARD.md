# Benchmark Dashboard

The read-only dashboard at `/benchmarks` presents recorded PatchVerdict proof bundles. It uses the existing version 2 proof loader and the existing Mission Control evidence pages. Opening or refreshing the dashboard does not launch a mission, execute a test, change a verdict, or write proof artifacts.

**Controlled benchmark results. Not a measure of general-purpose repair accuracy.**

## Evidence and cohort selection

Evidence comes from the repository-level `output/<missionId>/` directory. The application resolves the same checkout whether Next.js starts from the repository root or `apps/web`. A finalized bundle has `proof.json` and `events.json`; the existing writer publishes `proof.json` last. Temporary manifests, live run metadata, and directories without a finalized manifest do not become discovered recorded results.

The tracked configuration is [`apps/web/lib/benchmarks/catalog.ts`](../apps/web/lib/benchmarks/catalog.ts). Each entry identifies one exact recorded run and the repository expected for that scenario. The dashboard validates the saved bundle with the existing loader and compares its recorded repository identity with the catalog. GitHub repository identity comparison is case-insensitive and accepts equivalent URLs with a trailing slash or `.git` suffix.

The catalog pins seven real version 2 bundles. The selection was confirmed on 2026-10-20: the user selected the latest completed supported candidate by recorded timestamp for divide-by-zero, boolean-condition, and test-state-leak. Their earlier completed candidates had the same respective verdicts. The user explicitly selected `debug-normalization-01` for normalization, preserving that diagnostic run even though a later successful web run exists. Array boundary, off-by-one range, and average calculation each had one supported completed candidate. This was a one-time selection; new runs never replace these IDs automatically.

| Scenario | Exact pinned mission ID | Saved verdict at inspection |
| --- | --- | --- |
| Username String Normalization | `debug-normalization-01` | VERIFIED |
| Division by zero | `web-42a66b12-7219-4d6e-a799-c49f797aa13d` | VERIFIED |
| Array boundary | `web-5e60fb32-602e-4bf3-9707-d58bbb6168bd` | VERIFIED |
| Boolean condition | `web-b1439d1c-7727-4b7f-a8d2-367ceae8a8e4` | VERIFIED |
| Off-by-one range | `web-4ac3cf2d-4bdd-4c96-b73b-dabca9c82109` | VERIFIED |
| Average calculation | `web-69465de5-6600-42b8-96ec-8fb49fe24c72` | VERIFIED |
| Test state leak | `web-d59e040c-e511-4d9e-bd6b-7cb6bfdd645d` | REVIEW_REQUIRED |

The saved repository identities all match their catalog entries. All seven have the required proof/events and all three command evidence artifacts. Six have matching structured GitHub issue #1 metadata; `debug-normalization-01` has no structured issue metadata. These records support 6 VERIFIED, 1 REVIEW_REQUIRED, 0 FAILED verdicts, and 6 / 7 = 85.7% controlled verification. The application computes these values from the bundles on every refresh; they are not constants in the UI. The 21 available command durations sum to 26,986 ms, which is test execution time only.

The discovery inventory at this inspection contained 22 finalized manifests: 14 validated v2 records (10 VERIFIED, 2 REVIEW_REQUIRED, and 2 failed executions with null verdicts) plus 8 unsupported v3 records. This describes the inspected checkout, not a fixed history count. Unsupported records remain unavailable and are not reinterpreted or migrated.

The selected test-state-leak proof records `REVIEW_REQUIRED` with integrity `REVIEW_REQUIRED`, `preserved: false`, and review flag `Candidate modified test infrastructure: setupTests.js`. The only changed file is `setupTests.js`; its saved diff replaces the shared `return templateUser` with `return { ...templateUser }`. Baseline reproduction is true, and post-patch and full-suite checks pass. Their recorded exits are 1, 0, and 0; durations are 787, 742, and 778 ms. These are saved observations, not a newly calculated verdict.

**All Recorded Missions** includes pinned missions and every other discovered attempt within the safety limits below. It is independent of the controlled summary. Multiple runs for a repository remain separate, including failed attempts and later reruns. Unsupported or invalid discovered bundles remain unavailable. The history list never determines the official denominator or chooses a better replacement run.

## Change the controlled catalog deliberately

1. Identify the intended scenarios and the exact saved mission directory belonging to each selected run. Inspect their existing Mission Control pages at `/missions/<missionId>` and their local proof metadata. Do not select a run solely because it passed. Resolve ambiguous candidates explicitly with the cohort owner.
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
5. Run the dashboard tests before committing the configuration. Record any cohort selection changes so a later comparison uses a clearly identified set of runs.

A missing run stays configured and unavailable. Do not remove a missing or unsuccessful scenario merely to improve the reported rate. To use an unsupported proof version, provide an already-supported saved bundle or address compatibility as a separate task; this dashboard neither changes the proof loader nor rewrites evidence.

## Metrics and missing data

All summary metrics use the configured cohort, before table filtering or sorting:

| Metric | Definition |
| --- | --- |
| Configured scenarios | Number of catalog entries. |
| Valid recorded evidence | Configured entries whose saved bundle passes validation and repository matching. Missing optional artifacts do not invalidate an otherwise valid manifest. |
| VERIFIED, REVIEW_REQUIRED, FAILED | Counts of the unchanged recorded verdicts on valid configured entries. |
| No verdict / unavailable | Valid entries with a null verdict plus entries without valid, matching recorded evidence. The underlying data keeps those groups separate as `validWithoutVerdict` and `unavailable`. |
| Controlled verification rate | Valid configured entries with recorded verdict VERIFIED, divided by **all configured scenarios**, including unavailable entries and valid entries without a verdict. An empty catalog has an unavailable rate, not 0% or 100%. |
| Measured test execution time | Sum of available validated baseline, post-patch reproduction, and full-suite command durations for valid configured entries. Coverage accompanies this value. |

For example, if a six-entry catalog has three valid VERIFIED results, one valid REVIEW_REQUIRED result, one valid run with no verdict, and one missing bundle, the verification rate is 3 / 6 = 50%. This is an explanation of the calculation, not a claim about saved results.

Execution status and verdict are separate: a mission can have execution status `COMPLETED` and verdict `FAILED`, or execution status `FAILED` and no recorded verdict. The dashboard preserves both fields and never recalculates the engine's verdict. A malformed proof containing the text `VERIFIED` does not count as verified.

Baseline reproduction, post-patch results, full-suite results, integrity status, changed-file count, base commit, and investigation iterations are projected from validated saved fields where available. Missing values stay unavailable. In particular, an absent patch does not become zero changed files, and missing integrity is not inferred from a verdict.

Search, verdict filters, and scenario/date/duration/verdict sorting change the displayed rows only. They do not rewrite evidence or change the cohort-wide summary. **View Evidence** links are offered only for validated records and use the existing `/missions/<missionId>` route. Missing, unsupported, invalid, or repository-mismatched proofs show unavailable evidence without a misleading link. A valid failed execution with a null verdict still has inspectable evidence and displays no recorded verdict.

## Automatic history updates and ordering

The page is rendered on demand with `connection()`. A small client component calls `router.refresh()` approximately every 30 seconds only while `/benchmarks` is active and the document is visible. Hiding the tab stops the timer; showing it starts a fresh interval. Route departure and unmount remove both the timer and visibility listener. There is no background refresh on other pages, backend mission polling, AI invocation, WebSocket, file watcher, or database.

Next.js merges refreshed server data into the existing client tables. Search, verdict filters, and chosen sorting stay selected. A newly finalized mission appears after the next refresh unless the active filters exclude it or discovery limits are reached. Temporary/live-only records do not appear before `proof.json` is published. Direct reload also re-reads the filesystem.

History defaults to newest first. A trusted completion date comes from the validated final event when its state matches the saved execution status, all event timestamps have explicit timezones and chronological order, and no earlier terminal event appears. It is shown as **Recorded** in UTC. This does not require the first event to be PREPARING and does not imply a complete mission duration. When this timestamp cannot be established, a safely inspected manifest's filesystem modification time may be shown as **Artifact saved** in UTC. Copying or touching an artifact can change that fallback time. Unknown dates remain unavailable and sort last. The date source is always explicit.

## Duration semantics

`durationMs` belongs to each recorded command evidence artifact. The measured duration is the sum of the available durations for these three fixed stages:

- Baseline reproduction: `evidence/baseline-test.json`.
- Post-patch reproduction: `evidence/post-patch-test.json`.
- Full-suite verification: `evidence/full-suite.json`.

This sum is **measured test execution time**, not total AI mission time. It excludes investigation, patch generation, repository preparation, and unrecorded commands. A row identifies how many of its three command durations are available; aggregate coverage identifies the recorded runs and commands contributing to the total. Partial evidence produces a partial sum. No available durations produces `Unavailable`; a genuinely recorded zero-millisecond duration remains zero.

Overall mission duration is available only when the recorded event sequence begins with `PREPARING`, has monotonic timestamps, ends in the terminal state matching the recorded execution status, and contains no earlier terminal event. Otherwise it is `Unavailable`. In particular, a trace beginning at `BASELINE` does not establish the start of repository preparation or the entire mission, even when it has a final timestamp. The supported local traces inspected during implementation began at `BASELINE`.

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

Discovery streams at most 500 directory entries and selects the 100 most recently saved regular manifests within that scan before loading their bundles. It then orders the returned rows by the displayed event/artifact timestamp. Unsafe manifest nodes are omitted with a notice. Limits are surfaced so a truncated listing is not mistaken for the complete local history; filesystem enumeration does not guarantee the newest global run lies within the first 500 entries. Explicit catalog selection loads pinned missions directly, independently of the history limits. Existing limits have not been increased.

The aggregator checks fixed artifacts before and after calling the unchanged loader and rejects detectable changes during a read. These checks assume finalized local artifacts are immutable while being read. They are not a transactional filesystem snapshot and do not guarantee consistency against an adversarial process concurrently replacing files. Keep the saved output directory under trusted local control and avoid editing finalized evidence while serving it.

Missing output directories, missing configured runs, corrupt JSON, unsupported versions, unsafe paths, oversized files, and repository mismatches produce safe unavailable states. Missing optional evidence remains missing, and malformed optional evidence is excluded by the existing loader. Availability messages do not include raw logs or server paths. The dashboard has no external analytics integration.

## Tests and project validation

From `apps/web`, run the focused dashboard tests and the existing Node.js web suite:

```powershell
node --test tests/benchmarks.test.mjs tests/benchmarks-ui.test.mjs
node --test tests/*.test.mjs
```

Tests use disposable fixtures and do not modify real saved proof bundles. They cover seven configured repositories with six VERIFIED and one REVIEW_REQUIRED, fixed denominators and integrity, new finalized runs without replacing pinned attempts, recorded verdicts and execution failures, missing and malformed evidence, identity matching, date/duration provenance, filtering/sorting across refreshed data, valid-only evidence URLs, refresh visibility/route/unmount lifecycle, filesystem limits, path traversal, symlink protection, and read-only behavior. The existing engine and web tests remain part of validation.

The complete requested project validation also includes these commands from the repository root:

```powershell
pnpm typecheck
pnpm test
```

And these commands from `apps/web`:

```powershell
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

Check actual command results in the implementation report. This document lists the required commands without asserting that any particular environment has passed them.

On Windows with PowerShell script execution disabled, use `pnpm.cmd` in place of `pnpm` to invoke the same package scripts.

## Deployment and interpretation limits

No database is required because the saved proof bundles are the source of truth and the tracked catalog defines the cohort. The dashboard reads current bundles on server requests rather than embedding results at build time. Direct visits and refreshes use the same server rendering path.

A deployment must retain a readable repository checkout with the existing root markers and persist its repository-level `output/` directory. An ephemeral or static-only deployment will not acquire the developer's local evidence automatically. Mount or provision the genuine saved bundles persistently, retain their fixed file layout, and provide filesystem permissions to read them. Do not copy secrets into published evidence.

Catalog registration does not change the application's existing retention policy. In particular, selecting a `web-` mission does not exempt its bundle from normal cleanup when later missions run. Preserve benchmark evidence through your existing backup process; if a selected bundle is removed, its configured row becomes unavailable and remains in the verification-rate denominator.

## Non-destructive private backup procedure

The dashboard does not perform backups automatically. Make a private backup before launching enough later missions to trigger retention:

1. Wait until the selected runs have finalized and pause launching new missions during the copy so cleanup cannot remove a source halfway through. Do not edit any source artifacts.
2. Choose an access-controlled backup directory **outside this checkout and outside `output/`**. Create a new empty dated subfolder for this backup; do not reuse or overwrite an earlier backup. Do not put it under a public repository or automatically shared folder: proofs, logs, issue text, and diffs may contain sensitive data.
3. Using the seven exact IDs in the table above, locate each `output/<missionId>` directory. Verify the manifest exists and reject any source directory or descendant that is a symbolic link/junction. Copy each entire directory, preserving its exact mission ID as the destination folder name. Use **Copy**, never Move, and refuse any overwrite prompt. Include `proof.json`, `events.json`, optional reports/diffs, and the complete `evidence` directory.
4. Compare the source and copied file lists. For each corresponding file, compare SHA-256 values. PowerShell's `Get-FileHash -LiteralPath '<source file>' -Algorithm SHA256` and the same command for the copied file provide a read-only check. Repeat for all copied files, not only `proof.json`; any mismatch means the backup is incomplete. Also keep a copy of `catalog.ts` with the backup to preserve which runs were pinned.
5. Keep the original `output/` bundles untouched. Retain the private backup separately from source control and record when it was verified. If restoration is needed, stop mission launches and restore only a missing mission directory from the verified copy, with no overwrites or manifest edits. The directory name and recorded `mission.id` must stay identical. Refresh the dashboard to validate the restored bundle through the existing loader.

This procedure copies existing bytes without deleting, renaming, repairing, migrating, or regenerating evidence. No backup or restore is executed by visiting the dashboard.

Controlled scenario outcomes describe only the explicitly selected saved runs. They do not estimate general-purpose repair accuracy, establish performance on unseen repositories, or prove that different run conditions are comparable. The dashboard preserves recorded verdicts and validates their format and association; it does not re-execute verification, authenticate externally edited evidence, or change any AI, verification, proof-writing, GitHub publication, or mission execution behavior.
