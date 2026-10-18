import "server-only";

import { randomUUID } from "node:crypto";
import {
  lstat,
  open,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { loadProofBundle } from "./load-proof-bundle";
import { readMissionLiveStatus } from "./mission-live-status";
import { resolveRepositoryRoot } from "./repository-root";
import { parseGitHubRepositoryUrl } from "./github-issue-url";
import {
  getPullRequestEligibility,
  isPullRequestResult,
  type PullRequestResult,
} from "./pull-request-types";
import {
  gitSha,
  patchDigest,
  prepareExactPatch,
  PullRequestError,
  record,
  type GitHubRequest,
} from "./exact-verified-patch";
import type { MissionViewModel } from "./mission-types";
import { publishFork } from "./github-fork-publication";

export { PullRequestError } from "./exact-verified-patch";

export type Canonical = {
  directory: string;
  bundle: MissionViewModel;
  repository: string;
  owner: string;
  name: string;
  baseCommit: string;
  patchSha256: string;
  proofSha256: string;
  patch: Buffer;
  branch: string;
  draft: boolean;
  publicationTimestamp?: string;
};
export type Metadata = PullRequestResult & {
  repository: string;
  branch: string;
  headSha: string;
  treeSha: string;
  baseCommit: string;
  patchSha256: string;
  proofSha256: string;
  createdAt: string;
  publicationMode?: "FORK";
  upstreamRepository?: string;
  forkRepository?: string;
  forkOwner?: string;
  targetBranch?: string;
};
const pending = new Map<string, Promise<PullRequestResult>>();
const MAX_JSON = 12 * 1024 * 1024;

function contained(parent: string, child: string) {
  const relative = path.relative(parent, child);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new PullRequestError(
      "The mission artifacts are outside the permitted storage directory.",
    );
  }
}

function hasCode(error: unknown, code: string) {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === code
  );
}

function validateId(missionId: string) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(missionId))
    throw new PullRequestError("Invalid mission ID.", 400);
}

async function missionDirectory(missionId: string) {
  validateId(missionId);
  const root = await resolveRepositoryRoot();
  const output = await realpath(path.join(root, "output"));
  contained(root, output);
  const directory = await realpath(path.join(output, missionId));
  contained(output, directory);
  return directory;
}

async function artifact(directory: string, filename: string, maxBytes: number) {
  const requested = path.join(directory, filename);
  const resolved = await realpath(requested);
  contained(directory, resolved);
  const info = await lstat(requested);
  if (!info.isFile() || info.size > maxBytes)
    throw new PullRequestError(
      "A mission artifact is invalid or exceeds the publication size limit.",
    );
  const bytes = await readFile(resolved);
  if (bytes.length > maxBytes)
    throw new PullRequestError(
      "A mission artifact exceeds the publication size limit.",
    );
  return bytes;
}

async function canonical(missionId: string): Promise<Canonical> {
  validateId(missionId);
  try {
    const directory = await missionDirectory(missionId);
    // Bound required inputs before calling the shared, backward-compatible reader.
    const proof = await artifact(directory, "proof.json", 16 * 1024 * 1024);
    await artifact(directory, "events.json", 2 * 1024 * 1024);
    const patch = await artifact(directory, "patch.diff", 2 * 1024 * 1024);
    const bundle = await loadProofBundle(missionId);
    if (
      !proof.equals(await artifact(directory, "proof.json", 16 * 1024 * 1024))
    ) {
      throw new PullRequestError(
        "The mission artifacts changed during publication.",
      );
    }
    const policy = getPullRequestEligibility(bundle.mission, bundle.details);
    if (!policy.allowed) throw new PullRequestError(policy.reason!);
    if (bundle.warnings.length)
      throw new PullRequestError(
        "The canonical proof contains unreadable or corrupt artifacts.",
      );
    const live = await readMissionLiveStatus(missionId);
    if (live && (live.status !== "COMPLETED" || !live.proofReady)) {
      throw new PullRequestError(
        "The mission has not completed successfully. Pull request creation is unavailable.",
      );
    }
    const source = bundle.details.source!;
    const repository = parseGitHubRepositoryUrl(source.repositoryUrl);
    if (!repository)
      throw new PullRequestError(
        "The proof repository is not a supported GitHub repository.",
      );
    const digest = patchDigest(patch);
    const manifest = JSON.parse(proof.toString("utf8")) as Record<string, unknown>;
    let publicationTimestamp: string | undefined;
    if (source.mode === "THIRD_PARTY_JS_TS") {
      if (typeof manifest.createdAt !== "string" || !Number.isFinite(Date.parse(manifest.createdAt)) ||
        new Date(manifest.createdAt).toISOString() !== manifest.createdAt) {
        throw new PullRequestError("This proof has no immutable publication timestamp. Run a new mission.");
      }
      publicationTimestamp = manifest.createdAt;
    }
    if (
      digest !== bundle.mission.patch!.sha256 ||
      patch.toString("utf8") !== bundle.mission.patch!.diff
    ) {
      throw new PullRequestError(
        "The patch does not match the digest recorded in the canonical proof.",
      );
    }
    return {
      directory,
      bundle,
      owner: repository.owner,
      name: repository.repository,
      repository: `${repository.owner}/${repository.repository}`,
      baseCommit: source.baseCommit.toLowerCase(),
      patchSha256: digest,
      proofSha256: patchDigest(proof),
      patch,
      branch: `patchverdict/${missionId}`,
      draft: policy.draft,
      ...(publicationTimestamp && { publicationTimestamp }),
    };
  } catch (error) {
    if (error instanceof PullRequestError) throw error;
    throw new PullRequestError(
      "The canonical proof or exact patch is missing, unreadable, or invalid.",
    );
  }
}

function parseMetadata(value: unknown, source: Canonical): Metadata | null {
  if (!isPullRequestResult(value)) return null;
  const saved = value as Metadata;
  const strict = source.bundle.details.source?.mode === "THIRD_PARTY_JS_TS";
  if (strict && (saved.publicationMode !== "FORK" || saved.upstreamRepository !== source.repository ||
    saved.targetBranch !== source.bundle.details.source?.targetBranch || !saved.forkOwner ||
    !/^[A-Za-z0-9-]+$/.test(saved.forkOwner) || !saved.forkRepository ||
    !new RegExp("^" + saved.forkOwner + "/[A-Za-z0-9_.-]+$").test(saved.forkRepository))) return null;
  if (
    saved.repository !== source.repository ||
    saved.branch !== source.branch ||
    saved.draft !== source.draft ||
    saved.baseCommit !== source.baseCommit ||
    saved.patchSha256 !== source.patchSha256 ||
    saved.proofSha256 !== source.proofSha256 ||
    !/^[a-f0-9]{40}$/.test(saved.headSha) ||
    !/^[a-f0-9]{40}$/.test(saved.treeSha) ||
    saved.url.toLowerCase() !==
      `https://github.com/${source.repository}/pull/${saved.number}`.toLowerCase() ||
    typeof saved.createdAt !== "string" ||
    !Number.isFinite(Date.parse(saved.createdAt))
  )
    return null;
  return {
    number: saved.number,
    url: saved.url,
    draft: saved.draft,
    repository: saved.repository,
    branch: saved.branch,
    headSha: saved.headSha,
    treeSha: saved.treeSha,
    baseCommit: saved.baseCommit,
    patchSha256: saved.patchSha256,
    proofSha256: saved.proofSha256,
    createdAt: saved.createdAt,
    ...(strict && { publicationMode: "FORK" as const, upstreamRepository: saved.upstreamRepository,
      forkRepository: saved.forkRepository, forkOwner: saved.forkOwner, targetBranch: saved.targetBranch }),
  };
}

function publicResult(metadata: PullRequestResult): PullRequestResult {
  return { number: metadata.number, url: metadata.url, draft: metadata.draft };
}

async function savedMetadata(source: Canonical): Promise<Metadata | null> {
  try {
    return parseMetadata(
      JSON.parse(
        (await artifact(source.directory, "pull-request.json", 16384)).toString(
          "utf8",
        ),
      ),
      source,
    );
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw new PullRequestError(
      "Saved pull request metadata is unreadable or invalid.",
    );
  }
}

export async function readMissionPullRequest(
  missionId: string,
): Promise<PullRequestResult | null> {
  try {
    const source = await canonical(missionId);
    const saved = await savedMetadata(source);
    return saved ? publicResult(saved) : null;
  } catch {
    return null;
  }
}

async function persist(source: Canonical, metadata: Metadata) {
  // Recheck directory identity before the write. Never use paths from saved JSON.
  if ((await missionDirectory(source.bundle.details.id)) !== source.directory)
    throw new PullRequestError("Mission storage changed during publication.");
  const filename = path.join(source.directory, "pull-request.json");
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(metadata, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, filename);
  } catch {
    throw new PullRequestError(
      "GitHub created the pull request, but its local record could not be saved. Retry to recover the existing pull request.",
      503,
    );
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function responseJson(response: Response) {
  if (!response.body)
    throw new PullRequestError("GitHub returned an empty response.", 502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_JSON)
        throw new PullRequestError(
          "GitHub returned a response that exceeds the publication limit.",
          502,
        );
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function githubRoot(token: string): GitHubRequest {
  const deadline = Date.now() + 120000;
  return async (endpoint, method = "GET", body, allowMissing = false) => {
    if (
      (endpoint !== "" && !endpoint.startsWith("/")) ||
      endpoint.startsWith("//") ||
      Date.now() >= deadline
    )
      throw new PullRequestError(
        "Pull request creation timed out. Retry to recover any existing pull request.",
        503,
      );
    try {
      const response = await fetch(
        "https://api.github.com" + endpoint,
        {
          method,
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(
            Math.min(20000, Math.max(1, deadline - Date.now())),
          ),
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "PatchVerdict",
            "X-GitHub-Api-Version": "2022-11-28",
            Authorization: `Bearer ${token}`,
            ...(body !== undefined && { "Content-Type": "application/json" }),
          },
          ...(body !== undefined && { body: JSON.stringify(body) }),
        },
      );
      if (allowMissing && response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok) {
        await response.body?.cancel();
        if (
          response.status === 429 ||
          (response.status === 403 &&
            response.headers.get("x-ratelimit-remaining") === "0")
        ) {
          throw new PullRequestError(
            "GitHub's rate limit was reached. Try again later.",
            429,
          );
        }
        if ([401, 403, 404].includes(response.status))
          throw new PullRequestError(
            "GitHub denied access. Check the token's repository access and Contents and Pull requests write permissions.",
            403,
          );
        if (response.status === 422 || response.status === 409)
          throw new PullRequestError(
            "GitHub could not create this pull request or branch. Retry to recover an existing pull request, or check the repository on GitHub.",
            409,
          );
        throw new PullRequestError(
          "GitHub is unavailable. Try again later.",
          502,
        );
      }
      return await responseJson(response);
    } catch (error) {
      if (error instanceof PullRequestError) throw error;
      throw new PullRequestError(
        "GitHub could not be reached or returned an invalid response. Try again later.",
        502,
      );
    }
  };
}

function forRepository(api: GitHubRequest, repository: string): GitHubRequest {
  const parsed = parseGitHubRepositoryUrl("https://github.com/" + repository);
  if (!parsed) throw new PullRequestError("Invalid publication repository.");
  const prefix = "/repos/" + encodeURIComponent(parsed.owner) + "/" + encodeURIComponent(parsed.repository);
  return (endpoint, method, body, allowMissing) => api(prefix + endpoint, method, body, allowMissing);
}

function github(source: Canonical, token: string): GitHubRequest {
  return forRepository(githubRoot(token), source.repository);
}

function markdown(value: string, limit = 500) {
  return value
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .slice(0, limit)
    .replace(/[\\`*_{}[\]()<>#+.!|@~-]/g, "\\$&");
}

export function pullRequestDescription(bundle: MissionViewModel, currentDefaultBranch?: string) {
  const { mission, details } = bundle;
  const outcome = (value: boolean | undefined) =>
    value === true ? "passed" : value === false ? "failed" : "not recorded";
  const lines = [
    "This candidate repair was verified by PatchVerdict against the recorded reproduction and test suite.",
    "",
    `PatchVerdict verdict: **${mission.verdict}**`,
    `Base commit: ${details.source!.baseCommit}`,
    `Baseline reproduction: ${mission.checks?.bugReproducedBeforePatch === true ? "bug reproduced" : "not confirmed"}`,
    `Post-patch reproduction: ${outcome(mission.checks?.reproductionPassesAfterPatch)}`,
    `Full suite: ${outcome(mission.checks?.fullSuitePassesAfterPatch)}`,
    `Verification integrity: ${mission.verificationIntegrity?.status ?? "not recorded"}`,
    "",
    "Changed files:",
    ...mission.patch!.changedFiles.map((file) => `- ${markdown(file)}`),
    "",
    "These results cover the recorded checks at the stated base commit; they do not establish that every behavior is correct.",
  ];
  if (details.source?.mode === "THIRD_PARTY_JS_TS") {
    const frozen = mission.frozenReproduction!;
    const backgroundCount = (tests: Array<{ testPath: string; testIdentity: string }>) => tests.filter(test =>
      test.testPath !== frozen.testPath || test.testIdentity !== frozen.testIdentity).length;
    lines.splice(0, lines.length,
      "This candidate repair was verified against the recorded issue-specific reproduction on " +
        markdown(details.source.targetBranch!) + " at commit " + details.source.baseCommit + ".",
      "", "PatchVerdict verdict: **" + mission.verdict + "**",
      "Upstream repository: " + markdown(details.source.repositoryUrl),
      "Target branch: " + markdown(details.source.targetBranch!),
      "Exact base commit: " + details.source.baseCommit,
      "Reproduction origin: " + frozen.origin,
      "Framework: " + frozen.framework,
      "Test path: " + markdown(frozen.testPath),
      "Test identity: " + markdown(frozen.testIdentity),
      "Frozen SHA-256: " + frozen.frozenSha256,
      "Frozen integrity: " + (mission.repair?.frozenIntegrity ? "unchanged" : "not preserved"),
      "Production repair: " + mission.repair!.productionChangedFiles.map(file => markdown(file)).join(", "),
      "Background baseline failures: " + backgroundCount(mission.suiteComparison!.baseline.failed),
      "Background post-patch failures: " + backgroundCount(mission.suiteComparison!.postPatch.failed),
      "Background comparison: " + mission.suiteComparison!.state,
      "New non-target regressions: " + mission.suiteComparison!.newBackgroundFailures.length,
      "", "These checks apply to this branch and exact base; they do not establish correctness on other branches or environments.");
    if (frozen.origin === "GENERATED_REGRESSION") lines.push("", "The regression was AI-generated. Its expected behavior requires human review; freezing protects its bytes, not the correctness of its oracle.");
  }
  if (mission.verdict === "REVIEW_REQUIRED") {
    lines.push("", "Human review is required. This pull request is a draft.");
    for (const reason of [
      ...(mission.verificationIntegrity?.reviewFlags ?? []),
      ...(mission.verificationIntegrity?.violations ?? []),
    ].slice(0, 10))
      lines.push(`- ${markdown(reason)}`);
  }
  const issue = details.source?.githubIssue;
  const repository = details.source
    ? parseGitHubRepositoryUrl(details.source.repositoryUrl)
    : null;
  if (
    issue &&
    repository &&
    issue.owner.toLowerCase() === repository.owner.toLowerCase() &&
    issue.repository.toLowerCase() === repository.repository.toLowerCase()
  ) {
    const reference = details.source?.mode === "THIRD_PARTY_JS_TS" &&
      details.source.targetBranch !== (currentDefaultBranch ?? details.source.defaultBranch) ? "Related to" : "Fixes";
    lines.push("", reference + " #" + issue.number);
  }
  return lines.join("\n");
}

function title(source: Canonical) {
  const raw =
    source.bundle.details.source?.githubIssue?.title ??
    source.bundle.details.title;
  return `fix: ${raw
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .trim()
    .slice(0, 200)}`;
}

async function validateHead(
  api: GitHubRequest,
  sha: string,
  source: Canonical,
  treeSha: string,
) {
  const commit = record(await api(`/git/commits/${sha}`));
  if (
    commit.sha !== sha ||
    record(commit.tree).sha !== treeSha ||
    !Array.isArray(commit.parents) ||
    commit.parents.length !== 1 ||
    record(commit.parents[0]).sha !== source.baseCommit
  ) {
    throw new PullRequestError(
      "The existing branch does not contain the exact recorded patch and base commit. It cannot be reused.",
    );
  }
}

async function recover(
  api: GitHubRequest,
  source: Canonical,
  treeSha: string,
): Promise<Metadata | null> {
  const value = await api(
    `/pulls?state=all&head=${encodeURIComponent(`${source.owner}:${source.branch}`)}&per_page=100`,
  );
  if (!Array.isArray(value))
    throw new PullRequestError(
      "GitHub returned invalid pull request metadata.",
      502,
    );
  if (value.length > 1)
    throw new PullRequestError(
      "Multiple pull requests exist for this mission branch. Review them on GitHub.",
    );
  if (!value.length) return null;
  const pr = record(value[0]);
  const head = record(pr.head);
  const base = record(pr.base);
  const headRepo = head.repo == null ? null : record(head.repo);
  const baseRepo = record(base.repo);
  const headSha = gitSha(head.sha);
  const metadata = parseMetadata(
    {
      number: pr.number,
      url: pr.html_url,
      draft: pr.draft,
      repository: source.repository,
      branch: source.branch,
      headSha,
      treeSha,
      baseCommit: source.baseCommit,
      patchSha256: source.patchSha256,
      proofSha256: source.proofSha256,
      createdAt: pr.created_at,
    },
    source,
  );
  if (
    !metadata ||
    head.ref !== source.branch ||
    !headRepo ||
    typeof headRepo.full_name !== "string" ||
    headRepo.full_name.toLowerCase() !== source.repository.toLowerCase() ||
    typeof baseRepo.full_name !== "string" ||
    baseRepo.full_name.toLowerCase() !== source.repository.toLowerCase()
  ) {
    throw new PullRequestError(
      "The existing pull request does not match this mission's repository, branch, or draft policy.",
    );
  }
  await validateHead(api, headSha, source, treeSha);
  return metadata;
}

async function publish(source: Canonical, token: string) {
  if (source.bundle.details.source?.mode === "THIRD_PARTY_JS_TS") {
    const root = githubRoot(token);
    const assertUnchanged = async () => {
      const latest = await canonical(source.bundle.details.id);
      if (latest.proofSha256 !== source.proofSha256 || latest.patchSha256 !== source.patchSha256 ||
        latest.repository !== source.repository || latest.baseCommit !== source.baseCommit || latest.draft !== source.draft ||
        latest.bundle.details.source?.targetBranch !== source.bundle.details.source?.targetBranch) {
        throw new PullRequestError("The mission artifacts changed during publication.");
      }
    };
    const metadata = await publishFork(source, { root, repository: name => forRepository(root, name),
      assertUnchanged, title: title(source), description: defaultBranch => pullRequestDescription(source.bundle, defaultBranch) });
    await persist(source, metadata);
    return publicResult(metadata);
  }
  const api = github(source, token);
  const repository = record(await api(""));
  if (
    typeof repository.full_name !== "string" ||
    repository.full_name.toLowerCase() !== source.repository.toLowerCase() ||
    typeof repository.default_branch !== "string" ||
    !repository.default_branch ||
    repository.default_branch.length > 250 ||
    /[\x00-\x1f\x7f]/.test(repository.default_branch)
  ) {
    throw new PullRequestError(
      "GitHub returned invalid repository metadata.",
      502,
    );
  }
  const exact = await prepareExactPatch(
    api,
    source.baseCommit,
    source.bundle.mission.patch!.changedFiles,
    source.patch,
  );
  let metadata = await recover(api, source, exact.treeSha);
  if (metadata) {
    await persist(source, metadata);
    return publicResult(metadata);
  }
  const refPath = `/git/ref/heads/${source.branch.split("/").map(encodeURIComponent).join("/")}`;
  const existing = await api(refPath, "GET", undefined, true);
  let headSha: string;
  if (existing) {
    const ref = record(existing);
    if (ref.ref !== `refs/heads/${source.branch}`)
      throw new PullRequestError("GitHub returned an unexpected branch.", 502);
    headSha = gitSha(record(ref.object).sha);
    await validateHead(api, headSha, source, exact.treeSha);
  } else {
    const entries = [];
    for (const entry of exact.entries) {
      if (entry.contents === null)
        entries.push({
          path: entry.path,
          mode: entry.mode,
          type: "blob",
          sha: null,
        });
      else {
        const blob = record(
          await api("/git/blobs", "POST", {
            content: entry.contents.toString("base64"),
            encoding: "base64",
          }),
        );
        if (gitSha(blob.sha) !== entry.sha)
          throw new PullRequestError(
            "GitHub's created file differs from the verified patch.",
            502,
          );
        entries.push({
          path: entry.path,
          mode: entry.mode,
          type: "blob",
          sha: entry.sha,
        });
      }
    }
    const tree = record(
      await api("/git/trees", "POST", {
        base_tree: exact.baseTree,
        tree: entries,
      }),
    );
    if (gitSha(tree.sha) !== exact.treeSha)
      throw new PullRequestError(
        "GitHub's created tree differs from the verified patch.",
        502,
      );
    const commit = record(
      await api("/git/commits", "POST", {
        message: title(source),
        tree: exact.treeSha,
        parents: [source.baseCommit],
      }),
    );
    headSha = gitSha(commit.sha);
    if (
      record(commit.tree).sha !== exact.treeSha ||
      !Array.isArray(commit.parents) ||
      commit.parents.length !== 1 ||
      record(commit.parents[0]).sha !== source.baseCommit
    ) {
      throw new PullRequestError(
        "GitHub's created commit differs from the verified patch.",
        502,
      );
    }
    try {
      await api("/git/refs", "POST", {
        ref: `refs/heads/${source.branch}`,
        sha: headSha,
      });
    } catch (error) {
      const raced = await api(refPath, "GET", undefined, true);
      if (!raced) throw error;
      headSha = gitSha(record(record(raced).object).sha);
      await validateHead(api, headSha, source, exact.treeSha);
    }
  }
  // Reload artifacts immediately before the user-visible write; evidence never changes.
  const latest = await canonical(source.bundle.details.id);
  if (
    latest.proofSha256 !== source.proofSha256 ||
    latest.patchSha256 !== source.patchSha256 ||
    latest.baseCommit !== source.baseCommit ||
    latest.repository !== source.repository ||
    latest.draft !== source.draft
  ) {
    throw new PullRequestError(
      "The mission artifacts changed during publication.",
    );
  }
  // A racing server may have opened the PR while this process created Git objects.
  metadata = await recover(api, source, exact.treeSha);
  if (!metadata) {
    try {
      await api("/pulls", "POST", {
        title: title(source),
        body: pullRequestDescription(source.bundle),
        head: source.branch,
        base: repository.default_branch,
        draft: source.draft,
        maintainer_can_modify: false,
      });
    } catch (error) {
      metadata = await recover(api, source, exact.treeSha);
      if (!metadata) throw error;
    }
    metadata ??= await recover(api, source, exact.treeSha);
  }
  if (!metadata)
    throw new PullRequestError(
      "GitHub's pull request could not be confirmed. Retry to recover it.",
      503,
    );
  await persist(source, metadata);
  return publicResult(metadata);
}

async function create(missionId: string) {
  const source = await canonical(missionId);
  const saved = await savedMetadata(source);
  if (saved && source.bundle.details.source?.mode !== "THIRD_PARTY_JS_TS") return publicResult(saved);
  const token = process.env.PATCHVERDICT_GITHUB_TOKEN?.trim();
  if (!token)
    throw new PullRequestError(
      "Pull request creation is not configured on this PatchVerdict server.",
      503,
    );
  const lock = path.join(source.directory, ".pull-request.lock");
  let handle;
  try {
    // Publication API calls stop after two minutes. A ten-minute lock can only be
    // left by an interrupted server; deterministic GitHub recovery still applies.
    try {
      const info = await lstat(lock);
      if (info.isFile() && Date.now() - info.mtimeMs > 10 * 60000)
        await unlink(lock);
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
    try {
      handle = await open(lock, "wx", 0o600);
    } catch (error) {
      if (hasCode(error, "EEXIST"))
        throw new PullRequestError(
          "Pull request creation is already in progress. Please retry shortly.",
        );
      throw error;
    }
    const existing = await savedMetadata(source);
    if (existing && source.bundle.details.source?.mode !== "THIRD_PARTY_JS_TS") return publicResult(existing);
    return await publish(source, token);
  } finally {
    if (handle) {
      await handle.close();
      await unlink(lock).catch(() => undefined);
    }
  }
}

export async function createMissionPullRequest(
  missionId: string,
): Promise<PullRequestResult> {
  validateId(missionId);
  const key = `${await resolveRepositoryRoot()}:${missionId}`;
  const prior = pending.get(key);
  if (prior) return prior;
  const operation = create(missionId).catch((error) => {
    if (error instanceof PullRequestError) throw error;
    throw new PullRequestError(
      "Pull request creation could not be completed. Please try again.",
      500,
    );
  });
  pending.set(key, operation);
  try {
    return await operation;
  } finally {
    if (pending.get(key) === operation) pending.delete(key);
  }
}
