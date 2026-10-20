# Benchmark Dashboard

The read-only dashboard at `/benchmarks` presents recorded PatchVerdict proof bundles. It uses the existing version 2 proof loader and the existing Mission Control evidence pages. Opening or refreshing the dashboard does not launch a mission, execute a test, change a verdict, or write proof artifacts.

**Controlled benchmark results. Not a measure of general-purpose repair accuracy.**

## Evidence and cohort selection

Evidence comes from the repository-level `output/<missionId>/` directory. The application resolves the same checkout whether Next.js starts from the repository root or `apps/web`. A finalized bundle has `proof.json` and `events.json`; the existing writer publishes `proof.json` last. Temporary manifests, live run metadata, and directories without a finalized manifest do not become discovered recorded results.

The tracked configuration is [`apps/web/lib/benchmarks/catalog.ts`](../apps/web/lib/benchmarks/catalog.ts). Each entry identifies one exact recorded run and the repository expected for that scenario. The dashboard validates the saved bundle with the existing loader and compares its recorded repository identity with the catalog. GitHub repository identity comparison is case-insensitive and accepts equivalent URLs with a trailing slash or `.git` suffix.

The catalog is initially empty. During implementation, this checkout contained 21 recorded proof manifests: five version 2 bundles accepted by the current loader and 16 version 3 bundles unsupported by that loader. The five supported bundles covered three distinct repositories, including two runs for the same boolean-condition repository. Those records do not confidently identify the intended six controlled scenarios. No runs were selected on the basis of their successful verdicts, and no six-scenario results were invented. This inventory describes the inspected checkout, not a permanent product assumption.

The optional **other recorded missions** section shows discovered local runs separately. Those runs never contribute to controlled benchmark counts, durations, or the verification rate. Multiple runs for one repository remain separate records; there is no automatic latest-run or best-result selection. Unsupported or invalid discovered bundles remain unavailable rather than being interpreted as valid results.

## Register the six controlled scenarios

1. Identify the six actual scenarios and the exact saved mission directory belonging to each intended run. Inspect their existing Mission Control pages at `/missions/<missionId>` and their local proof metadata. Do not select a run solely because it passed.
2. Check that each `proof.json` is a supported version 2 bundle, that its `mission.id` matches the directory name, and that `mission.source.repositoryUrl` records the expected repository. Keep the existing evidence files with the manifest. Bundles without recorded repository identity cannot verify a catalog identity.
3. Add six entries to `benchmarkCatalog` in `apps/web/lib/benchmarks/catalog.ts`, using this exact entry shape:

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

Search, verdict filters, and scenario/duration/verdict sorting change the displayed rows only. They do not rewrite evidence or change the cohort-wide summary. Evidence links use the existing `/missions/<missionId>` route; there is no second evidence viewer.

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
| Other recorded missions returned | 100 |
| Accepted artifact size | 2 MiB per file |
| Accepted bundle size | 8 MiB across fixed artifacts |

Discovery limits are surfaced so a truncated listing is not mistaken for the complete local history. Explicit catalog selection does not depend on discovering a mission among the optional other runs.

The aggregator checks fixed artifacts before and after calling the unchanged loader and rejects detectable changes during a read. These checks assume finalized local artifacts are immutable while being read. They are not a transactional filesystem snapshot and do not guarantee consistency against an adversarial process concurrently replacing files. Keep the saved output directory under trusted local control and avoid editing finalized evidence while serving it.

Missing output directories, missing configured runs, corrupt JSON, unsupported versions, unsafe paths, oversized files, and repository mismatches produce safe unavailable states. Missing optional evidence remains missing, and malformed optional evidence is excluded by the existing loader. Availability messages do not include raw logs or server paths. The dashboard has no external analytics integration.

## Tests and project validation

From `apps/web`, run the focused dashboard tests and the existing Node.js web suite:

```powershell
node --test tests/benchmarks.test.mjs tests/benchmarks-ui.test.mjs
node --test tests/*.test.mjs
```

Tests use disposable fixtures and do not modify real saved proof bundles. They cover recorded verdicts and execution failures, missing and malformed evidence, catalog identity matching, cohort denominators, duration coverage, filtering/sorting, evidence URLs, filesystem limits, path traversal, symlink protection, and read-only behavior.

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

Controlled scenario outcomes describe only the explicitly selected saved runs. They do not estimate general-purpose repair accuracy, establish performance on unseen repositories, or prove that different run conditions are comparable. The dashboard preserves recorded verdicts and validates their format and association; it does not re-execute verification, authenticate externally edited evidence, or change any AI, verification, proof-writing, GitHub publication, or mission execution behavior.
