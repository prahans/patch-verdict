import "server-only";

import { lstat, opendir, realpath } from "node:fs/promises";
import path from "node:path";
import { parseGitHubRepositoryUrl } from "../github-issue-url";
import { loadProofBundle } from "../load-proof-bundle";
import type { MissionResult, MissionViewModel } from "../mission-types";
import { resolveRepositoryRoot } from "../repository-root";
import { benchmarkCatalog } from "./catalog";
import type { BenchmarkDashboardData, BenchmarkRow, BenchmarkScenario, BenchmarkSummary } from "./types";

export const BENCHMARK_LIMITS = {
  catalog: 100,
  scannedEntries: 500,
  otherMissions: 100,
  artifactBytes: 2 * 1024 * 1024,
  bundleBytes: 8 * 1024 * 1024,
} as const;

// This is the unchanged proof loader's fixed allowlist, not manifest paths.
const artifactFiles = [
  "proof.json", "events.json", "investigation.md", "patch.diff",
  "evidence/baseline-test.json", "evidence/post-patch-test.json", "evidence/full-suite.json",
] as const;

class Unavailable extends Error {}

function hasCode(error: unknown, code: string) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export function isBenchmarkMissionId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function contained(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return !!relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function checkedDirectory(parent: string, directory: string) {
  const metadata = await lstat(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Unavailable("Evidence directory is unsafe or is not a directory.");
  }
  const resolved = await realpath(directory);
  if (!contained(parent, resolved)) throw new Unavailable("Evidence directory is outside the allowed location.");
  return resolved;
}

/** Preflight every file the shared reader can open, including optional files.
 * Repeat after loading to reject bundles changed during the read. The existing
 * reader also checks realpath containment at each actual artifact read. */
async function inspectBundle(output: string, missionId: string) {
  const directory = await checkedDirectory(output, path.join(output, missionId));
  const fingerprints: string[] = [directory];
  try {
    fingerprints.push(await checkedDirectory(directory, path.join(directory, "evidence")));
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
    fingerprints.push("no-evidence-directory");
  }
  let total = 0;
  for (const filename of artifactFiles) {
    try {
      // Runtime evidence is provisioned separately, never bundled at build time.
      const file = path.join(/* turbopackIgnore: true */ directory, filename);
      const metadata = await lstat(file);
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new Unavailable("A proof artifact is unsafe or is not a regular file.");
      }
      const resolved = await realpath(/* turbopackIgnore: true */ file);
      if (!contained(directory, resolved)) throw new Unavailable("A proof artifact is outside the allowed location.");
      total += metadata.size;
      if (metadata.size > BENCHMARK_LIMITS.artifactBytes || total > BENCHMARK_LIMITS.bundleBytes) {
        throw new Unavailable("Saved artifacts exceed the dashboard size limit.");
      }
      fingerprints.push(`${resolved}:${metadata.dev}:${metadata.ino}:${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`);
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
      if (filename === "proof.json") throw new Unavailable("Finalized proof.json is missing; this run may be incomplete.");
      if (filename === "events.json") throw new Unavailable("Required events.json is missing.");
      fingerprints.push(`${filename}:missing`);
    }
  }
  return fingerprints.join("\n");
}

function repositoryIdentity(url: string) {
  const parsed = parseGitHubRepositoryUrl(url);
  return { label: `${parsed.owner}/${parsed.repository}`, identity: parsed.repositoryUrl.toLowerCase() };
}

function safeReason(error: unknown): string {
  if (error instanceof Unavailable) return error.message;
  if (hasCode(error, "ENOENT")) return "The configured mission was not found in local output.";
  // Never forward filesystem errors, parser excerpts, recorded errors or logs.
  if (error instanceof Error && error.message.startsWith("Invalid proof.json version:")) {
    return "Unsupported proof version. This dashboard supports the existing version 2 proof format.";
  }
  return "Saved proof is invalid or unreadable. A valid version 2 proof and event record are required.";
}

function emptyRow(id: string, scenario: string, missionId: string, repository: string | null): BenchmarkRow {
  return {
    id, scenario, missionId, repository, availability: "unavailable", unavailableReason: null,
    executionStatus: null, verdict: null, baselineReproduced: null, postPatchPassed: null,
    fullSuitePassed: null, integrity: null, changedFiles: null, baseCommit: null, iterations: null,
    testDurationMs: null, timedCommandCount: 0,
    commandDurations: { baseline: null, postPatch: null, fullSuite: null },
    missionDurationMs: null, evidenceUrl: isBenchmarkMissionId(missionId) ? `/missions/${missionId}` : null,
    evidenceWarnings: false,
  };
}

function missionDuration(mission: MissionResult): number | null {
  const { events } = mission;
  if (events.length < 2 || events[0].state !== "PREPARING" || events.at(-1)?.state !== mission.status) return null;
  const times = events.map((event) => Date.parse(event.timestamp));
  // Explicit timezone, chronological order and complete endpoints are required.
  if (events.some((event, index) =>
    !/(?:Z|[+-]\d{2}:\d{2})$/i.test(event.timestamp) || !Number.isFinite(times[index]) ||
    (index > 0 && times[index] < times[index - 1]) ||
    (index < events.length - 1 && (event.state === "COMPLETED" || event.state === "FAILED")),
  )) return null;
  return times[times.length - 1] - times[0];
}

function projectBundle(row: BenchmarkRow, bundle: MissionViewModel): BenchmarkRow {
  const { mission, details } = bundle;
  const evidence = mission.evidence;
  const commandDurations = {
    baseline: evidence?.baselineTest?.durationMs ?? null,
    postPatch: evidence?.postPatchTest?.durationMs ?? null,
    fullSuite: evidence?.fullSuite?.durationMs ?? null,
  };
  const durations = Object.values(commandDurations).filter((value): value is number => value !== null);
  const measured = durations.reduce((sum, value) => sum + value, 0);
  return {
    ...row,
    repository: details.source ? repositoryIdentity(details.source.repositoryUrl).label : null,
    availability: "valid", unavailableReason: null,
    executionStatus: mission.status, verdict: mission.verdict ?? null,
    baselineReproduced: mission.checks?.bugReproducedBeforePatch ?? mission.reproduction?.reproduced ?? null,
    postPatchPassed: mission.checks?.reproductionPassesAfterPatch ??
      (evidence?.postPatchTest ? evidence.postPatchTest.exitCode === 0 : null),
    fullSuitePassed: mission.checks?.fullSuitePassesAfterPatch ??
      (evidence?.fullSuite ? evidence.fullSuite.exitCode === 0 : null),
    integrity: mission.verificationIntegrity?.status ?? null,
    changedFiles: mission.patch ? new Set(mission.patch.changedFiles).size : null,
    baseCommit: details.source?.baseCommit ?? (mission.patch?.baseCommit && /^[0-9a-f]{40}$/i.test(mission.patch.baseCommit) ? mission.patch.baseCommit : null),
    iterations: mission.investigation?.iterations ?? null,
    commandDurations, timedCommandCount: durations.length,
    testDurationMs: durations.length && Number.isFinite(measured) ? measured : null,
    missionDurationMs: missionDuration(mission), evidenceWarnings: bundle.warnings.length > 0,
  };
}

async function loadRow(output: string, row: BenchmarkRow, expectedRepository?: string): Promise<BenchmarkRow> {
  try {
    const before = await inspectBundle(output, row.missionId);
    // All proof/schema/command validation is owned by the existing viewer.
    const bundle = await loadProofBundle(row.missionId);
    if (before !== await inspectBundle(output, row.missionId)) {
      throw new Unavailable("Saved artifacts changed during reading. Reload after the run has finalized.");
    }
    if (expectedRepository && (!bundle.details.source ||
      repositoryIdentity(bundle.details.source.repositoryUrl).identity !== expectedRepository)) {
      throw new Unavailable("Recorded repository identity does not match this configured scenario.");
    }
    return projectBundle(row, bundle);
  } catch (error) {
    return { ...row, unavailableReason: safeReason(error) };
  }
}

function summarize(rows: BenchmarkRow[]): BenchmarkSummary {
  const valid = rows.filter((row) => row.availability === "valid");
  const verified = valid.filter((row) => row.verdict === "VERIFIED").length;
  const reviewRequired = valid.filter((row) => row.verdict === "REVIEW_REQUIRED").length;
  const failed = valid.filter((row) => row.verdict === "FAILED").length;
  const timed = valid.filter((row) => row.testDurationMs !== null);
  const total = timed.reduce((sum, row) => sum + row.testDurationMs!, 0);
  return {
    configured: rows.length, valid: valid.length, verified, reviewRequired, failed,
    noVerdict: rows.length - verified - reviewRequired - failed,
    unavailable: rows.length - valid.length,
    validWithoutVerdict: valid.filter((row) => row.verdict === null).length,
    verificationRate: rows.length ? verified / rows.length * 100 : null,
    testDurationMs: timed.length && Number.isFinite(total) ? total : null,
    timedCommandCount: timed.reduce((sum, row) => sum + row.timedCommandCount, 0),
    timedMissionCount: timed.length,
  };
}

/** Read-only request-time aggregation. No paths or IDs come from request input. */
export async function aggregateBenchmarks(
  catalog: readonly BenchmarkScenario[] = benchmarkCatalog,
): Promise<BenchmarkDashboardData> {
  const notices: string[] = [];
  // An oversized tracked config fails closed instead of silently changing the denominator.
  if (catalog.length > BENCHMARK_LIMITS.catalog) {
    return {
      benchmarks: [], otherMissions: [], summary: summarize([]), outputState: "unavailable",
      discoveryTruncated: false, notices: ["Benchmark catalog exceeds the 100-scenario limit. Reduce the catalog before viewing results."],
    };
  }
  let output: string | null = null;
  let outputState: BenchmarkDashboardData["outputState"] = "available";
  try {
    const root = await resolveRepositoryRoot();
    output = await checkedDirectory(root, path.join(root, "output"));
  } catch (error) {
    outputState = hasCode(error, "ENOENT") ? "missing" : "unavailable";
    notices.push(outputState === "missing"
      ? "No local output directory is available. Saved proof bundles must be present in this checkout."
      : "Local output could not be read safely. Check its availability and filesystem permissions.");
  }
  const benchmarks: BenchmarkRow[] = [];
  const configuredMissions = new Set<string>();
  const seenScenarios = new Set<string>();
  for (const [index, scenario] of catalog.entries()) {
    let expectedRepository: string | undefined;
    let repository: string | null = null;
    let reason: string | null = null;
    try {
      const parsed = repositoryIdentity(scenario.repositoryUrl);
      expectedRepository = parsed.identity;
      repository = parsed.label;
    } catch {
      reason = "Configure a valid GitHub HTTPS repository identity for this scenario.";
    }
    if (!isBenchmarkMissionId(scenario.id) || typeof scenario.name !== "string" || !scenario.name.trim() || scenario.name.length > 200) {
      reason = "Scenario configuration requires a stable ID and a name of 1–200 characters.";
    }
    if (!isBenchmarkMissionId(scenario.missionId)) reason = "Invalid configured mission ID. Use 1–128 letters, digits, underscores or hyphens.";
    if (seenScenarios.has(scenario.id) || configuredMissions.has(scenario.missionId)) {
      reason = "Duplicate scenario or mission ID. Each controlled scenario must select a distinct saved run.";
    }
    seenScenarios.add(scenario.id);
    configuredMissions.add(scenario.missionId);
    const row = emptyRow(`benchmark-${index}-${scenario.id}`, scenario.name, scenario.missionId, repository);
    if (reason || !output) benchmarks.push({ ...row, unavailableReason: reason ?? "Local output is unavailable." });
    else benchmarks.push(await loadRow(output, row, expectedRepository));
  }

  const otherMissions: BenchmarkRow[] = [];
  let discoveryTruncated = false;
  if (output) {
    // Stream the directory and cap entries examined, including ignored files.
    // Curated missions above are loaded directly, independent of discovery caps.
    try {
      const directory = await opendir(output);
      let examined = 0;
      let unreadableEntries = false;
      const candidates: string[] = [];
      for await (const entry of directory) {
        if (examined++ >= BENCHMARK_LIMITS.scannedEntries) { discoveryTruncated = true; break; }
        if (!entry.isDirectory() || entry.isSymbolicLink() || !isBenchmarkMissionId(entry.name) || configuredMissions.has(entry.name)) continue;
        try {
          const bundleDirectory = await checkedDirectory(output, path.join(/* turbopackIgnore: true */ output, entry.name));
          // Ignore live-only and temporary bundles. Malformed published manifests
          // remain visible as unavailable instead of quietly disappearing.
          await lstat(path.join(bundleDirectory, "proof.json"));
        } catch (error) {
          if (hasCode(error, "ENOENT")) continue;
          unreadableEntries = true;
          continue;
        }
        candidates.push(entry.name);
      }
      if (unreadableEntries) notices.push("Some other local recordings could not be inspected safely and were omitted from discovery.");
      candidates.sort();
      if (candidates.length > BENCHMARK_LIMITS.otherMissions) discoveryTruncated = true;
      for (const missionId of candidates.slice(0, BENCHMARK_LIMITS.otherMissions)) {
        otherMissions.push(await loadRow(output, emptyRow(`recorded-${missionId}`, missionId, missionId, null)));
      }
    } catch {
      notices.push("Some local recordings could not be discovered safely. Configured benchmark results are shown independently.");
    }
  }
  if (discoveryTruncated) notices.push("Local discovery is limited to 500 directory entries and 100 other recordings. Configured benchmarks are loaded directly.");
  return { benchmarks, otherMissions, summary: summarize(benchmarks), notices, outputState, discoveryTruncated };
}
