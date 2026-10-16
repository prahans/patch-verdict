import "server-only";
import { parseGitHubRepositoryUrl } from "./github-issue-url";
import { isGitHubBranchName } from "./github-branch-name";
import { githubUnavailable, readGitHubPublicJson } from "./github-public-api";
import { MissionInputError } from "./mission-input";

export type GitHubRepository = { repositoryUrl: string; owner: string; repository: string; defaultBranch: string };
export type GitHubBranchPage = GitHubRepository & { branches: string[]; nextPage: number | null };
export const BRANCH_PAGE_SIZE = 30;
export const MAX_BRANCH_PAGE = 100;

export async function resolveGitHubRepository(repositoryUrl: string): Promise<GitHubRepository> {
  const requested = parseGitHubRepositoryUrl(repositoryUrl);
  const value = await readGitHubPublicJson(`/repos/${requested.owner}/${requested.repository}`);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw githubUnavailable();
  const data = value as Record<string, unknown>;
  if (data.private !== false || typeof data.full_name !== "string" || typeof data.html_url !== "string" || !isGitHubBranchName(data.default_branch)) throw githubUnavailable();
  let canonical: ReturnType<typeof parseGitHubRepositoryUrl>;
  try { canonical = parseGitHubRepositoryUrl(data.html_url); } catch { throw githubUnavailable(); }
  if (data.full_name !== `${canonical.owner}/${canonical.repository}` || canonical.repositoryUrl.toLowerCase() !== requested.repositoryUrl.toLowerCase()) throw githubUnavailable();
  return { ...canonical, defaultBranch: data.default_branch };
}

export async function resolveGitHubBranch(repository: GitHubRepository, targetBranch: string) {
  if (!isGitHubBranchName(targetBranch)) throw new MissionInputError("Choose a valid existing target branch.");
  const value = await readGitHubPublicJson(`/repos/${repository.owner}/${repository.repository}/branches/${encodeURIComponent(targetBranch)}`);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw githubUnavailable();
  const data = value as { name?: unknown; commit?: { sha?: unknown } };
  if (data.name !== targetBranch || typeof data.commit?.sha !== "string" || !/^[a-f0-9]{40}$/i.test(data.commit.sha)) throw githubUnavailable();
  return { targetBranch, baseCommit: data.commit.sha.toLowerCase() };
}

export async function listGitHubBranches(repository: GitHubRepository, page = 1): Promise<GitHubBranchPage> {
  if (!Number.isInteger(page) || page < 1 || page > MAX_BRANCH_PAGE) throw new MissionInputError("Choose a valid branch page or enter an exact branch name.");
  const value = await readGitHubPublicJson(`/repos/${repository.owner}/${repository.repository}/branches?per_page=${BRANCH_PAGE_SIZE}&page=${page}`);
  if (!Array.isArray(value) || value.length > BRANCH_PAGE_SIZE) throw githubUnavailable();
  const branches = value.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || !isGitHubBranchName((entry as { name?: unknown }).name)) throw githubUnavailable();
    return (entry as { name: string }).name;
  });
  if (new Set(branches).size !== branches.length) throw githubUnavailable();
  return { ...repository, branches, nextPage: branches.length === BRANCH_PAGE_SIZE && page < MAX_BRANCH_PAGE ? page + 1 : null };
}
