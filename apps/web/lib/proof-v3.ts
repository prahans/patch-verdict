import { isGitHubBranchName } from "./github-branch-name";
import type { CommandEvidence, FrozenReproduction, MissionDetails, MissionOutcome, MissionResult, NormalizedRun, RepairProvenance, SuiteComparison } from "./mission-types";
import type { FrameworkErrorKind, TestIdentity } from "../../../src/mission/third-party-types";

type ObjectValue = Record<string, unknown>;
const outcomes = new Set<MissionOutcome>(["REPAIR_EVALUATED", "TARGET_NOT_REPRODUCED", "UNSTABLE_REPRODUCTION", "UNSUPPORTED_REPOSITORY", "UNSUPPORTED_REPAIR_SCOPE", "PREPARATION_FAILED", "INVESTIGATION_FAILED", "PATCH_FAILED", "VERIFICATION_FAILED"]);
const errors = new Set<FrameworkErrorKind>(["TARGET_TEST_FAILURE", "NO_TESTS_FOUND", "TEST_PARSE_ERROR", "TEST_COMPILE_ERROR", "MODULE_RESOLUTION_ERROR", "FRAMEWORK_STARTUP_ERROR", "CONFIGURATION_ERROR", "TIMEOUT", "INFRASTRUCTURE_ERROR"]);
const states = new Set<SuiteComparison["state"]>(["CLEAN", "UNCHANGED_PREEXISTING_FAILURES", "REGRESSED", "IMPROVED_WITH_BACKGROUND_FAILURES", "UNSTABLE", "UNKNOWN"]);
const fail = (label: string): never => { throw new Error(`Invalid proof.json version 3 ${label}.`); };
function object(value: unknown, label: string): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(label);
  return value as ObjectValue;
}
function text(value: unknown, label: string, max: number, empty = false): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim()) || value.includes("\0")) return fail(label);
  return value;
}
function bool(value: unknown, label: string): boolean { return typeof value === "boolean" ? value : fail(label); }
function finite(value: unknown, label: string): number { return typeof value === "number" && Number.isFinite(value) ? value : fail(label); }
function repositoryPath(value: unknown): string {
  const path = text(value, "repository path", 500);
  if (/[\\\x00-\x1f\x7f:]/.test(path) || !path.split("/").every(part => !!part && part !== "." && part !== ".." && !/^\.git(?:$|\.)/i.test(part) && !/[. ]$/.test(part)) || /(^|\/)(node_modules|\.env(?:\.[^/]*)?)(\/|$)/i.test(path)) fail("repository path");
  return path;
}
const identityKey = (value: TestIdentity) => JSON.stringify([value.testPath, value.testIdentity]);
const identitySet = (values: TestIdentity[]) => new Set(values.map(identityKey));
const sameSet = (left: Set<string>, right: Set<string>) => left.size === right.size && [...left].every(value => right.has(value));
function identity(value: unknown): TestIdentity {
  const data = object(value, "test identity");
  return { testPath: repositoryPath(data.testPath), testIdentity: text(data.testIdentity, "test identity", 2000) };
}
function identities(value: unknown): TestIdentity[] {
  if (!Array.isArray(value) || value.length > 10000) return fail("test identity list");
  const result = value.map(identity);
  if (identitySet(result).size !== result.length) fail("duplicate test identities");
  return result;
}
function evidence(value: unknown): CommandEvidence {
  const data = object(value, "command evidence");
  const exitCode = finite(data.exitCode, "command exit code");
  const durationMs = finite(data.durationMs, "command duration");
  if (!Number.isInteger(exitCode) || durationMs < 0) fail("command evidence");
  return { command: text(data.command, "command", 16000), exitCode, durationMs, stdout: text(data.stdout, "stdout", 32000, true), stderr: text(data.stderr, "stderr", 32000, true) };
}
function run(value: unknown): NormalizedRun {
  const data = object(value, "normalized test run");
  if (data.execution !== "COMPLETED" && data.execution !== "ERROR") fail("test execution status");
  if (data.errorKind !== undefined && !errors.has(data.errorKind as FrameworkErrorKind)) fail("framework error kind");
  const discovered = identities(data.discovered);
  const passed = identities(data.passed);
  const failures = identities(data.failed);
  const failed = failures.map((item, index) => ({ ...item, message: text((data.failed as ObjectValue[])[index].message, "failure message", 8000, true) }));
  const parsed: NormalizedRun = { execution: data.execution as NormalizedRun["execution"], discovered, passed, failed, evidence: evidence(data.evidence), ...(data.errorKind !== undefined && { errorKind: data.errorKind as FrameworkErrorKind }) };
  const discoveredKeys = identitySet(discovered), passedKeys = identitySet(passed), failedKeys = identitySet(failed);
  if ([...passedKeys, ...failedKeys].some(key => !discoveredKeys.has(key)) || [...passedKeys].some(key => failedKeys.has(key))) fail("test result partition");
  if (parsed.execution === "COMPLETED" && (!discovered.length || !passed.length && !failed.length || parsed.evidence.exitCode !== (failed.length ? 1 : 0) || parsed.errorKind !== (failed.length ? "TARGET_TEST_FAILURE" : undefined))) fail("completed framework result");
  if (parsed.execution === "ERROR" && (!parsed.errorKind || parsed.errorKind === "TARGET_TEST_FAILURE" || discovered.length || passed.length || failed.length)) fail("framework error result");
  return parsed;
}
function files(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) return fail("repair paths");
  const paths = value.map(repositoryPath);
  if (new Set(paths).size !== paths.length) fail("duplicate repair paths");
  return paths;
}

export type ProofV3Fields = Pick<MissionResult, "outcome" | "frozenReproduction" | "targetAfter" | "suiteComparison" | "repair">;

/** Parse recorded evidence. Contradictions are rejected, never converted into a new verdict. */
export function parseProofV3Fields(proof: ObjectValue, source: MissionDetails["source"]): ProofV3Fields {
  if (!source || source.mode !== "THIRD_PARTY_JS_TS" || !source.githubIssue || !isGitHubBranchName(source.targetBranch) || !isGitHubBranchName(source.defaultBranch)) fail("canonical source");
  if (!outcomes.has(proof.outcome as MissionOutcome)) fail("outcome");
  const parsed: ProofV3Fields = { outcome: proof.outcome as MissionOutcome };
  if (proof.frozenReproduction != null) {
    const data = object(proof.frozenReproduction, "frozen reproduction");
    if ((data.origin !== "EXISTING_TEST" && data.origin !== "GENERATED_REGRESSION") || (data.framework !== "vitest" && data.framework !== "jest")) fail("reproduction origin/framework");
    if (typeof data.frozenSha256 !== "string" || !/^[a-f0-9]{64}$/.test(data.frozenSha256) || data.targetBranch !== source.targetBranch || data.baseCommit !== source.baseCommit) fail("frozen source binding");
    const target: FrozenReproduction = { ...identity(data), origin: data.origin as FrozenReproduction["origin"], framework: data.framework as FrozenReproduction["framework"], command: text(data.command, "frozen command", 16000), frozenSha256: data.frozenSha256 as string, targetBranch: source.targetBranch!, baseCommit: source.baseCommit, stable: bool(data.stable, "reproduction stability"), targetBaselineResult: run(data.targetBaselineResult) };
    const baseline = target.targetBaselineResult;
    if (baseline.evidence.command !== target.command || baseline.execution !== "COMPLETED" || baseline.errorKind !== "TARGET_TEST_FAILURE" || baseline.failed.length !== 1 || identityKey(baseline.failed[0]) !== identityKey(target) || baseline.passed.length) fail("target baseline failure");
    if (target.origin === "GENERATED_REGRESSION" && !/\.(test|spec)\.(js|jsx|ts|tsx)$/.test(target.testPath)) fail("generated regression path");
    parsed.frozenReproduction = target;
  }
  if (proof.targetAfter != null) parsed.targetAfter = run(proof.targetAfter);
  if (proof.suiteComparison != null) {
    const data = object(proof.suiteComparison, "suite comparison");
    if (!states.has(data.state as SuiteComparison["state"])) fail("background state");
    parsed.suiteComparison = { baseline: run(data.baseline), postPatch: run(data.postPatch), state: data.state as SuiteComparison["state"], stableBackgroundFailures: identities(data.stableBackgroundFailures), newBackgroundFailures: identities(data.newBackgroundFailures), resolvedBackgroundFailures: identities(data.resolvedBackgroundFailures) };
  }
  if (proof.repair != null) {
    const data = object(proof.repair, "repair provenance");
    parsed.repair = { trustedRegressionChangedFiles: files(data.trustedRegressionChangedFiles), productionChangedFiles: files(data.productionChangedFiles), frozenIntegrity: bool(data.frozenIntegrity, "frozen integrity"), scopeValid: bool(data.scopeValid, "repair scope") };
  }
  return parsed;
}

export function assertProofV3Consistency(mission: MissionResult, source: NonNullable<MissionDetails["source"]>): void {
  const { outcome, frozenReproduction: target, targetAfter, suiteComparison: suite, repair, patch, checks, verificationIntegrity: integrity } = mission;
  if (!outcome || (outcome === "REPAIR_EVALUATED") !== (mission.verdict !== null && mission.verdict !== undefined)) fail("outcome/verdict combination");
  if (patch && patch.baseCommit !== source.baseCommit) fail("patch base binding");
  if (targetAfter && (!target || targetAfter.evidence.command !== target.command)) fail("post-target command binding");
  if (suite) {
    if (!target) fail("background target exclusion");
    const targetKey = identityKey(target!);
    const before = identitySet(suite.baseline.failed.filter(item => identityKey(item) !== targetKey));
    const after = identitySet(suite.postPatch.failed.filter(item => identityKey(item) !== targetKey));
    const stable = new Set([...after].filter(key => before.has(key)));
    const added = new Set([...after].filter(key => !before.has(key)));
    const resolved = new Set([...before].filter(key => !after.has(key)));
    if (!sameSet(stable, identitySet(suite.stableBackgroundFailures)) || !sameSet(added, identitySet(suite.newBackgroundFailures)) || !sameSet(resolved, identitySet(suite.resolvedBackgroundFailures))) fail("background failure sets");
    const withoutTarget = (values: TestIdentity[]) => identitySet(values.filter(item => identityKey(item) !== targetKey));
    const comparable = suite.baseline.execution === "COMPLETED" && suite.postPatch.execution === "COMPLETED" && sameSet(withoutTarget(suite.baseline.discovered), withoutTarget(suite.postPatch.discovered));
    const resolvedPassed = [...resolved].every(key => identitySet(suite.postPatch.passed).has(key));
    const expected = !comparable ? "UNKNOWN" : added.size ? "REGRESSED" : !resolvedPassed ? "UNKNOWN" : !before.size && !after.size ? "CLEAN" : resolved.size ? "IMPROVED_WITH_BACKGROUND_FAILURES" : "UNCHANGED_PREEXISTING_FAILURES";
    if (suite.state !== "UNSTABLE" && suite.state !== expected) fail("background comparison state");
    if (target!.origin === "GENERATED_REGRESSION" && suite.baseline.discovered.some(item => item.testPath === target!.testPath)) fail("generated test in untouched baseline");
  }
  const positive = mission.verdict === "VERIFIED" || mission.verdict === "REVIEW_REQUIRED";
  if (!positive) return;
  if (mission.status !== "COMPLETED" || mission.error || !target?.stable || !targetAfter || !suite || !repair?.scopeValid || !repair.frozenIntegrity || !patch?.applied || !patch.sha256 || !patch.diff || !checks?.bugReproducedBeforePatch || !checks.reproductionPassesAfterPatch || !checks.verificationIntegrityPreserved || integrity?.status !== "PRESERVED" || !integrity.preserved || integrity.violations.length || integrity.protectedChangedFiles.length) fail("positive repair evidence");
  const key = identityKey(target!);
  if (targetAfter!.execution !== "COMPLETED" || targetAfter!.evidence.exitCode !== 0 || targetAfter!.failed.length || targetAfter!.passed.length !== 1 || identityKey(targetAfter!.passed[0]) !== key || !suite!.postPatch.passed.some(item => identityKey(item) === key) || suite!.postPatch.failed.some(item => identityKey(item) === key)) fail("post-target identity");
  if (target!.origin === "EXISTING_TEST" && !suite!.baseline.failed.some(item => identityKey(item) === key)) fail("existing target baseline");
  if (["REGRESSED", "UNKNOWN", "UNSTABLE"].includes(suite!.state) || suite!.newBackgroundFailures.length) fail("positive background state");
  const expectedVerdict = target!.origin === "EXISTING_TEST" && suite!.state === "CLEAN" ? "VERIFIED" : "REVIEW_REQUIRED";
  if (mission.verdict !== expectedVerdict) fail("verdict trust policy");
  if (repair!.productionChangedFiles.length !== 1 || repair!.trustedRegressionChangedFiles.length !== (target!.origin === "GENERATED_REGRESSION" ? 1 : 0) || (target!.origin === "GENERATED_REGRESSION" && repair!.trustedRegressionChangedFiles[0] !== target!.testPath) || !sameSet(new Set(patch!.changedFiles), new Set([...repair!.productionChangedFiles, ...repair!.trustedRegressionChangedFiles]))) fail("repair provenance");
  const production = repair!.productionChangedFiles[0];
  if (!/\.(?:[cm]?[jt]s|jsx|tsx)$/.test(production) || production === target!.testPath || /(?:^|[/._-])(?:tests?|specs?|mocks?|fixtures?|config|setup|teardown|vitest|jest|babel|webpack|rollup|vite|eslint|prettier|tsconfig|scripts?|ci)(?:[./_-]|$)/i.test(production) || /(^|\/)\.[^/]+/.test(production) || /\.d\.[cm]?ts$/.test(production)) fail("production repair path");
}
