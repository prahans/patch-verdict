import "server-only";
import { createHash } from "node:crypto";
import { gitSha, patchDigest, prepareExactPatch, PullRequestError, record, type GitHubRequest } from "./exact-verified-patch";
import { isPullRequestResult } from "./pull-request-types";
import { isGitHubBranchName } from "./github-branch-name";
import type { Canonical, Metadata } from "./github-pull-request";

type Clients = {
  root: GitHubRequest;
  repository: (repository: string) => GitHubRequest;
  assertUnchanged: () => Promise<void>;
  title: string;
  description: (defaultBranch: string) => string;
  wait?: (milliseconds: number) => Promise<void>;
};
type Repository = { id: number; fullName: string; name: string; owner: string; ownerId: number; data: Record<string, unknown> };
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function repository(value: unknown): Repository {
  const data = record(value);
  const owner = record(data.owner);
  if (!Number.isSafeInteger(data.id) || Number(data.id) <= 0 || !Number.isSafeInteger(owner.id) || Number(owner.id) <= 0 ||
    typeof data.name !== "string" || !/^[A-Za-z0-9_.-]+$/.test(data.name) || [".", ".."].includes(data.name) ||
    typeof owner.login !== "string" || !/^[A-Za-z0-9-]+$/.test(owner.login) ||
    data.full_name !== owner.login + "/" + data.name || data.private !== false) {
    throw new PullRequestError("GitHub returned invalid public repository metadata.", 502);
  }
  return { id: Number(data.id), fullName: String(data.full_name), name: data.name, owner: owner.login, ownerId: Number(owner.id), data };
}
function validateFork(fork: Repository, upstream: Repository, user: { login: string; id: number }) {
  if (fork.data.fork !== true || fork.ownerId !== user.id || !same(fork.owner, user.login) || fork.id === upstream.id) {
    throw new PullRequestError("The selected repository is not an authenticated-user fork of the canonical upstream.");
  }
  const related = [fork.data.parent, fork.data.source].filter(Boolean).some(value => {
    const parent = record(value);
    return parent.id === upstream.id && typeof parent.full_name === "string" && same(parent.full_name, upstream.fullName);
  });
  if (!related) throw new PullRequestError("The fork relation does not match the canonical upstream.");
}
function refSha(value: unknown, branch: string): string {
  const ref = record(value);
  const object = record(ref.object);
  if (ref.ref !== "refs/heads/" + branch || object.type !== "commit") throw new PullRequestError("GitHub returned an unexpected publication branch.", 502);
  return gitSha(object.sha);
}

/** Deterministic Git object: retries cannot create commits with a new timestamp. */
export function forkCommitPlan(source: Canonical, treeSha: string, title: string) {
  const date = source.publicationTimestamp;
  const milliseconds = Date.parse(date ?? "");
  if (!Number.isFinite(milliseconds)) throw new PullRequestError("The immutable proof is missing a publication timestamp.");
  const seconds = Math.floor(milliseconds / 1000);
  const timestamp = new Date(seconds * 1000).toISOString().replace(".000Z", "Z");
  const message = title + "\n\nPatchVerdict-Proof-SHA256: " + source.proofSha256 +
    "\nPatchVerdict-Patch-SHA256: " + source.patchSha256 + "\n";
  const identity = { name: "PatchVerdict", email: "patchverdict@users.noreply.github.com", date: timestamp };
  const person = identity.name + " <" + identity.email + "> " + seconds + " +0000";
  const contents = Buffer.from("tree " + treeSha + "\nparent " + source.baseCommit + "\nauthor " + person +
    "\ncommitter " + person + "\n\n" + message);
  const sha = createHash("sha1").update(Buffer.from("commit " + contents.length + "\0")).update(contents).digest("hex");
  return { sha, body: { message, tree: treeSha, parents: [source.baseCommit], author: identity, committer: identity } };
}

export async function publishFork(source: Canonical, clients: Clients): Promise<Metadata> {
  const sourceMetadata = source.bundle.details.source!;
  const targetBranch = sourceMetadata.targetBranch;
  if (sourceMetadata.mode !== "THIRD_PARTY_JS_TS" || !isGitHubBranchName(targetBranch)) throw new PullRequestError("The strict proof has no valid target branch.");
  const upstreamApi = clients.repository(source.repository);
  const upstream = repository(await upstreamApi(""));
  if (!same(upstream.fullName, source.repository) || !isGitHubBranchName(upstream.data.default_branch)) throw new PullRequestError("The canonical upstream could not be confirmed.");
  const defaultBranch = upstream.data.default_branch;
  const userValue = record(await clients.root("/user"));
  if (typeof userValue.login !== "string" || !/^[A-Za-z0-9-]+$/.test(userValue.login) ||
    !Number.isSafeInteger(userValue.id) || Number(userValue.id) <= 0 || userValue.type !== "User") {
    throw new PullRequestError("The token must identify an authenticated GitHub user.", 403);
  }
  const user = { login: userValue.login, id: Number(userValue.id) };
  if (user.id === upstream.ownerId) throw new PullRequestError("Third-party publication requires a separate user fork; this account owns the upstream.");
  const assertSource = async () => {
    await clients.assertUnchanged();
    const value = await upstreamApi("/branches/" + encodeURIComponent(targetBranch), "GET", undefined, true);
    if (!value) throw new PullRequestError("The recorded target branch no longer exists. Start a new mission to select another branch.");
    const branch = record(value);
    if (branch.name !== targetBranch) throw new PullRequestError("GitHub returned a different target branch.");
    // Advancement is allowed; checkout and candidate parent remain proof.baseCommit.
    gitSha(record(branch.commit).sha);
  };
  await assertSource();
  const pullsPath = "/pulls?state=all&head=" + encodeURIComponent(user.login + ":" + source.branch) + "&per_page=100";
  const listPulls = async () => {
    const value = await upstreamApi(pullsPath);
    if (!Array.isArray(value) || value.length > 1) throw new PullRequestError("The deterministic mission head has ambiguous pull requests.");
    return value.length ? record(value[0]) : null;
  };
  let existingPr = await listPulls();
  // Validate exact bytes before creating any fork or Git object.
  const exact = await prepareExactPatch(upstreamApi, source.baseCommit, source.bundle.mission.patch!.changedFiles, source.patch);
  const frozen = source.bundle.mission.frozenReproduction!;
  const production = source.bundle.mission.repair!.productionChangedFiles[0];
  const productionBase = exact.baseEntries.find(entry => entry.path === production);
  if (!productionBase || !["100644", "100755"].includes(productionBase.mode)) {
    throw new PullRequestError("The production repair must modify an existing regular source file.");
  }
  if (frozen.origin === "GENERATED_REGRESSION") {
    if (exact.baseEntries.some(entry => entry.path === frozen.testPath)) {
      throw new PullRequestError("A trusted generated regression must be a new file absent from the proof base.");
    }
    const entry = exact.entries.find(entry => entry.path === frozen.testPath);
    if (!entry?.contents || patchDigest(entry.contents) !== frozen.frozenSha256) throw new PullRequestError("The published regression differs from the frozen verified bytes.");
  } else {
    const entry = exact.baseEntries.find(entry => entry.path === frozen.testPath);
    if (!entry || !["100644", "100755"].includes(entry.mode)) throw new PullRequestError("The frozen repository test is not a regular file at the proof base.");
    const blob = record(await upstreamApi("/git/blobs/" + entry.sha));
    if (blob.sha !== entry.sha || blob.encoding !== "base64" || typeof blob.content !== "string") throw new PullRequestError("The frozen base test cannot be confirmed.");
    const bytes = Buffer.from(blob.content, "base64");
    const objectSha = createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0")).update(bytes).digest("hex");
    if (bytes.length > 512 * 1024 || objectSha !== entry.sha || patchDigest(bytes) !== frozen.frozenSha256) throw new PullRequestError("The frozen test digest does not match the exact repository base.");
  }
  const plan = forkCommitPlan(source, exact.treeSha, clients.title);
  let fork: Repository | undefined;
  const readFork = async (name: string) => {
    const value = await clients.repository(name)("", "GET", undefined, true);
    if (!value) return undefined;
    const result = repository(value);
    if (!same(result.fullName, name)) throw new PullRequestError("The fork repository identity changed.");
    validateFork(result, upstream, user);
    return result;
  };
  if (existingPr) {
    const headRepository = record(record(existingPr.head).repo);
    if (typeof headRepository.full_name !== "string") throw new PullRequestError("The existing pull request fork cannot be identified.");
    fork = await readFork(headRepository.full_name);
    if (!fork) throw new PullRequestError("The existing pull request fork is unavailable.");
  } else {
    fork = await readFork(user.login + "/" + upstream.name);
    if (!fork) {
      let examinedForks = 0;
      let exhausted = false;
      for (let page = 1; page <= 3 && !fork; page++) {
        const values = await clients.root("/user/repos?affiliation=owner&per_page=100&page=" + page);
        if (!Array.isArray(values) || values.length > 100) throw new PullRequestError("GitHub returned invalid owned-repository metadata.", 502);
        for (const value of values) {
          const candidate = record(value);
          if (candidate.fork !== true) continue;
          const candidateOwner = record(candidate.owner);
          if (candidateOwner.id !== user.id || typeof candidate.full_name !== "string") continue;
          if (++examinedForks > 20) throw new PullRequestError("Fork discovery exceeded its bounded search. The existing fork must be resolved before publication.");
          const full = repository(await clients.repository(candidate.full_name)(""));
          const related = [full.data.parent, full.data.source].filter(Boolean).some(value => record(value).id === upstream.id);
          if (related) { validateFork(full, upstream, user); fork = full; break; }
        }
        if (values.length < 100) { exhausted = true; break; }
      }
      if (!fork && !exhausted) throw new PullRequestError("Owned repository search was incomplete; a renamed fork cannot be ruled out safely.");
    }
    if (!fork) {
      await assertSource();
      try {
        const created = repository(await upstreamApi("/forks", "POST", { default_branch_only: false }));
        validateFork(created, upstream, user);
        fork = created;
      } catch (error) {
        // A lost create response may already have created the default-named fork.
        fork = await readFork(user.login + "/" + upstream.name);
        if (!fork) throw error;
      }
    }
  }
  const forkApi = clients.repository(fork.fullName);
  const wait = clients.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  let ready = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    const confirmed = await readFork(fork.fullName);
    if (confirmed && confirmed.id !== fork.id) throw new PullRequestError("The fork repository was replaced during publication.");
    const base = confirmed ? await forkApi("/git/commits/" + source.baseCommit, "GET", undefined, true) : null;
    if (base && gitSha(record(base).sha) === source.baseCommit && record(record(base).tree).sha === exact.baseTree) { ready = true; break; }
    if (attempt < 5) await wait([500, 1000, 2000, 3000, 4000][attempt]!);
  }
  if (!ready) throw new PullRequestError("The fork is not ready with the exact proof base commit. Retry later; no alternate base or fork default branch was used.", 503);

  const validateCommit = async (sha: string) => {
    if (sha !== plan.sha) throw new PullRequestError("The mission branch contains a conflicting commit; it will not be overwritten.");
    const commit = record(await forkApi("/git/commits/" + sha));
    if (commit.sha !== plan.sha || record(commit.tree).sha !== exact.treeSha ||
      !Array.isArray(commit.parents) || commit.parents.length !== 1 || record(commit.parents[0]).sha !== source.baseCommit ||
      typeof commit.message !== "string" || commit.message.trimEnd() !== plan.body.message.trimEnd()) {
      throw new PullRequestError("The remote commit does not match the exact proof, patch, parent, and tree.");
    }
  };
  const metadataFor = async (pr: Record<string, unknown>): Promise<Metadata> => {
    const head = record(pr.head), base = record(pr.base);
    const headRepo = record(head.repo), baseRepo = record(base.repo);
    const result = { number: pr.number, url: pr.html_url, draft: pr.draft };
    if (!isPullRequestResult(result) || result.draft !== source.draft || head.ref !== source.branch || base.ref !== targetBranch ||
      headRepo.id !== fork.id || baseRepo.id !== upstream.id || typeof headRepo.full_name !== "string" || !same(headRepo.full_name, fork.fullName) ||
      typeof baseRepo.full_name !== "string" || !same(baseRepo.full_name, source.repository) ||
      result.url.toLowerCase() !== ("https://github.com/" + source.repository + "/pull/" + result.number).toLowerCase() ||
      typeof pr.created_at !== "string" || !Number.isFinite(Date.parse(pr.created_at))) {
      throw new PullRequestError("The existing pull request conflicts with the recorded upstream, fork, target branch, or review policy.");
    }
    await validateCommit(gitSha(head.sha));
    return { ...result, repository: source.repository, branch: source.branch, headSha: plan.sha, treeSha: exact.treeSha,
      baseCommit: source.baseCommit, patchSha256: source.patchSha256, proofSha256: source.proofSha256, createdAt: pr.created_at,
      publicationMode: "FORK", upstreamRepository: source.repository, forkRepository: fork.fullName, forkOwner: user.login, targetBranch };
  };
  // Closed matching PRs and deleted deterministic refs are recovered without recreation.
  if (existingPr) return metadataFor(existingPr);
  const refPath = "/git/ref/heads/" + source.branch.split("/").map(encodeURIComponent).join("/");
  let ref = await forkApi(refPath, "GET", undefined, true);
  if (ref) await validateCommit(refSha(ref, source.branch));
  else {
    const priorCommit = await forkApi("/git/commits/" + plan.sha, "GET", undefined, true);
    if (!priorCommit) {
      const entries = [];
      for (const entry of exact.entries) {
        if (entry.contents === null) throw new PullRequestError("Strict publication cannot delete files.");
        const blob = record(await forkApi("/git/blobs", "POST", { content: entry.contents.toString("base64"), encoding: "base64" }));
        if (gitSha(blob.sha) !== entry.sha) throw new PullRequestError("GitHub created different patch bytes.", 502);
        entries.push({ path: entry.path, mode: entry.mode, type: "blob", sha: entry.sha });
      }
      const tree = record(await forkApi("/git/trees", "POST", { base_tree: exact.baseTree, tree: entries }));
      if (gitSha(tree.sha) !== exact.treeSha) throw new PullRequestError("GitHub created a different verified tree.", 502);
      try {
        const commit = record(await forkApi("/git/commits", "POST", plan.body));
        if (gitSha(commit.sha) !== plan.sha) throw new PullRequestError("GitHub created a different deterministic commit.", 502);
      } catch (error) {
        const recovered = await forkApi("/git/commits/" + plan.sha, "GET", undefined, true);
        if (!recovered) throw error;
      }
    }
    await validateCommit(plan.sha);
    await assertSource();
    try { await forkApi("/git/refs", "POST", { ref: "refs/heads/" + source.branch, sha: plan.sha }); }
    catch (error) {
      ref = await forkApi(refPath, "GET", undefined, true);
      if (!ref) throw error;
      await validateCommit(refSha(ref, source.branch));
    }
  }
  await assertSource();
  ref = await forkApi(refPath, "GET", undefined, true);
  if (!ref) throw new PullRequestError("The exact publication branch disappeared before pull request creation.");
  await validateCommit(refSha(ref, source.branch));
  existingPr = await listPulls();
  if (!existingPr) {
    try {
      await upstreamApi("/pulls", "POST", { title: clients.title, body: clients.description(defaultBranch),
        head: user.login + ":" + source.branch, head_repo: fork.name, base: targetBranch, draft: source.draft, maintainer_can_modify: false });
    } catch (error) {
      existingPr = await listPulls();
      if (!existingPr) throw error;
    }
    existingPr ??= await listPulls();
  }
  if (!existingPr) throw new PullRequestError("The pull request could not be confirmed. Retry to recover the existing remote state.", 503);
  return metadataFor(existingPr);
}
