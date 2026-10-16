import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadProofBundle } from "./load-proof-bundle";
import type { MissionInput } from "./mission-input";
import { parsePersistedGitHubIssue } from "./github-issue-url";
import { isGitHubBranchName } from "./github-branch-name";
import { isSafeMissionId, type MissionLiveEvent, type MissionLiveStatus } from "./mission-live-types";
import { resolveRepositoryRoot } from "./repository-root";

// This map only serializes writes; disk is the authoritative state on every read.
const writes = new Map<string, Promise<unknown>>();
const phases = new Set(["PREPARING", "BASELINE", "INVESTIGATING", "PATCHING", "VERIFYING", "VERDICT", "COMPLETED", "FAILED"]);

function contained(parent: string, child: string) {
  const relative = path.relative(parent, child);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Mission storage resolves outside the allowed directory.");
  }
}

function missing(error: unknown) {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function validateId(missionId: string) {
  if (!isSafeMissionId(missionId)) throw new Error("Invalid mission ID.");
}

async function outputDirectory(create = false) {
  const root = await resolveRepositoryRoot();
  const requested = path.join(root, "output");
  if (create) await mkdir(requested, { recursive: true });
  const resolved = await realpath(requested);
  contained(root, resolved);
  return resolved;
}

async function runFilename(missionId: string, create = false) {
  validateId(missionId);
  const output = await outputDirectory(create);
  const requested = path.join(output, ".runs");
  if (create) await mkdir(requested, { recursive: true });
  const directory = await realpath(requested);
  contained(output, directory);
  return path.join(directory, `${missionId}.json`);
}

function parseStatus(text: string, missionId: string): MissionLiveStatus {
  const value = JSON.parse(text) as MissionLiveStatus;
  if (!value || value.missionId !== missionId ||
    !["QUEUED", "RUNNING", "COMPLETED", "FAILED"].includes(value.status) ||
    !phases.has(value.phase) || typeof value.proofReady !== "boolean" ||
    typeof value.repositoryUrl !== "string" || typeof value.issue !== "string" ||
    typeof value.message !== "string" ||
    ![value.startedAt, value.updatedAt, value.deadlineAt].every((date) => typeof date === "string" && Number.isFinite(Date.parse(date))) ||
    !Array.isArray(value.events) || value.events.some((event) =>
      !event || !phases.has(event.state) || typeof event.message !== "string" ||
      typeof event.timestamp !== "string" || !Number.isFinite(Date.parse(event.timestamp))) ||
    (value.error !== undefined && typeof value.error !== "string")) {
    throw new Error("The persisted mission status is invalid.");
  }
  if (value.githubIssue !== undefined) {
    const githubIssue = parsePersistedGitHubIssue(value.githubIssue, value.repositoryUrl);
    if (!githubIssue) throw new Error("The persisted GitHub issue source is invalid.");
    value.githubIssue = githubIssue;
  }
  if (value.mode !== undefined && value.mode !== "THIRD_PARTY_JS_TS") throw new Error("The persisted mission mode is invalid.");
  if (value.mode === "THIRD_PARTY_JS_TS" && (!value.githubIssue || !isGitHubBranchName(value.targetBranch) || !isGitHubBranchName(value.defaultBranch) || !/^[a-f0-9]{40}$/.test(value.baseCommit ?? ""))) throw new Error("The persisted branch source is invalid.");
  return value;
}

async function readFileStatus(filename: string, missionId: string) {
  const resolved = await realpath(filename);
  contained(path.dirname(filename), resolved);
  return parseStatus(await readFile(resolved, "utf8"), missionId);
}

async function atomicWrite(filename: string, value: MissionLiveStatus) {
  // A unique, exclusively-created sibling avoids stale temp files and symlink
  // targets. Rename exposes either the complete old JSON or the complete new JSON.
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, filename);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function update(
  missionId: string,
  change: (current: MissionLiveStatus) => MissionLiveStatus | Promise<MissionLiveStatus>,
) {
  const filename = await runFilename(missionId);
  const prior = writes.get(filename) ?? Promise.resolve();
  const pending = prior.catch(() => undefined).then(async () => {
    const current = await readFileStatus(filename, missionId);
    const next = await change(current);
    if (next !== current) await atomicWrite(filename, next);
    return next;
  });
  writes.set(filename, pending);
  try {
    return await pending;
  } finally {
    if (writes.get(filename) === pending) writes.delete(filename);
  }
}

function active(status: MissionLiveStatus) {
  return status.status === "QUEUED" || status.status === "RUNNING";
}

export async function createMissionLiveStatus(missionId: string, input: MissionInput, timeoutMs: number) {
  const filename = await runFilename(missionId, true);
  const now = new Date().toISOString();
  const status: MissionLiveStatus = {
    missionId, status: "QUEUED", phase: "PREPARING",
    message: "Mission accepted. Starting the backend.",
    repositoryUrl: input.repositoryUrl, issue: input.issue,
    ...(input.githubIssue && { githubIssue: input.githubIssue }),
    ...(input.mode && { mode: input.mode, targetBranch: input.targetBranch, baseCommit: input.baseCommit, defaultBranch: input.defaultBranch }),
    startedAt: now, updatedAt: now,
    deadlineAt: new Date(Date.now() + timeoutMs + 5000).toISOString(),
    proofReady: false, events: [],
  };
  await atomicWrite(filename, status);
  return status;
}

export async function recordMissionLiveEvent(missionId: string, event: Omit<MissionLiveEvent, "timestamp">) {
  return update(missionId, (current) => {
    if (!active(current)) return current;
    const timestamp = new Date().toISOString();
    return {
      ...current, status: "RUNNING", phase: event.state, message: event.message,
      updatedAt: timestamp, events: [...current.events, { ...event, timestamp }],
    };
  });
}

export async function failMissionLiveStatus(missionId: string, message: string) {
  return update(missionId, (current) => {
    if (!active(current)) return current;
    const timestamp = new Date().toISOString();
    return {
      ...current, status: "FAILED", phase: "FAILED", message, error: message,
      updatedAt: timestamp, proofReady: false,
      events: [...current.events, { timestamp, state: "FAILED", message }],
    };
  });
}

export async function proofBundleExists(missionId: string): Promise<boolean> {
  validateId(missionId);
  try {
    const output = await outputDirectory();
    const directory = await realpath(path.join(output, missionId));
    contained(output, directory);
    const proof = await realpath(path.join(directory, "proof.json"));
    contained(directory, proof);
    return (await stat(proof)).isFile();
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

async function usableProof(current: MissionLiveStatus) {
  try {
    const bundle = await loadProofBundle(current.missionId);
    const [title, ...description] = current.issue.split(/\r?\n/);
    const canonicalUrl = (url: string) => url.replace(/\.git\/?$/, "").replace(/\/$/, "");
    return bundle.details.title === title.trim() &&
      bundle.details.description === description.join("\n").trim() &&
      !!bundle.details.source &&
      canonicalUrl(bundle.details.source.repositoryUrl) === canonicalUrl(current.repositoryUrl) &&
      JSON.stringify(bundle.details.source.githubIssue) === JSON.stringify(current.githubIssue) &&
      (current.mode !== "THIRD_PARTY_JS_TS" ||
        (bundle.details.source.baseCommit === current.baseCommit &&
          (bundle.details.source as { targetBranch?: string }).targetBranch === current.targetBranch &&
          (bundle.details.source as { defaultBranch?: string }).defaultBranch === current.defaultBranch &&
          (bundle.details.source as { mode?: string }).mode === current.mode));
  } catch {
    return false;
  }
}

export async function completeMissionLiveStatus(missionId: string): Promise<boolean> {
  const filename = await runFilename(missionId);
  const current = await readFileStatus(filename, missionId);
  if (!(await usableProof(current))) return false;
  await update(missionId, (latest) => ({
    ...latest, status: "COMPLETED", phase: "COMPLETED", proofReady: true,
    message: "Proof bundle recorded.", updatedAt: new Date().toISOString(), error: undefined,
  }));
  return true;
}

export async function readMissionLiveStatus(missionId: string): Promise<MissionLiveStatus | null> {
  validateId(missionId);
  try {
    const filename = await runFilename(missionId);
    const current = await readFileStatus(filename, missionId);
    // Polling does not rewrite progress. Proof presence hands control to the
    // canonical page, including its existing corrupt-artifact error handling.
    const hasProof = await proofBundleExists(missionId);
    if (hasProof) return { ...current, proofReady: true };
    if (active(current) && Date.now() > Date.parse(current.deadlineAt)) {
      return failMissionLiveStatus(missionId, "The mission exceeded its time limit or the server stopped before recording proof. Please start a new mission.");
    }
    return { ...current, proofReady: false };
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}
