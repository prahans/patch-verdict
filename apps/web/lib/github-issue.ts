import "server-only";

import { parseGitHubIssueUrl, type GitHubIssue } from "./github-issue-url";
import {
  MISSION_INPUT_LIMITS,
  MissionInputError,
  assertGitHubIssueEnvelopeSize,
  parseMissionInput,
  type ParsedMissionInput,
} from "./mission-input";

import { GitHubIssueError, githubUnavailable as unavailable, readGitHubPublicJson } from "./github-public-api";
import { resolveGitHubBranch, resolveGitHubRepository } from "./github-branches";
export { GitHubIssueError } from "./github-public-api";

export async function resolveGitHubIssue(
  issueUrl: string,
): Promise<GitHubIssue> {
  let parsed: ReturnType<typeof parseGitHubIssueUrl>;
  try {
    parsed = parseGitHubIssueUrl(issueUrl);
  } catch {
    throw new MissionInputError("Enter an exact public GitHub issue URL.");
  }
  const value = await readGitHubPublicJson(`/repos/${parsed.owner}/${parsed.repository}/issues/${parsed.issueNumber}`);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
  const data = value as Record<string, unknown>;
  if (Object.hasOwn(data, "pull_request"))
    throw new GitHubIssueError(
      "This GitHub URL is a pull request. Paste a GitHub issue URL instead.",
      400,
    );
  if (
    data.number !== parsed.issueNumber ||
    typeof data.title !== "string" ||
    !data.title.trim() ||
    data.title.length > 1024 ||
    /[\0\r\n]/.test(data.title) ||
    (data.body !== null && typeof data.body !== "string")
  )
    throw unavailable();
  const title = data.title.trim();
  const body = typeof data.body === "string" ? data.body.trim() : "";
  if (body.includes("\0")) throw unavailable();
  // Keep canonical content intact; reject oversized input rather than truncating
  // the issue used by verification or exceeding Windows process argument limits.
  if (
    (body ? `${title}\n\n${body}` : title).length > MISSION_INPUT_LIMITS.issue
  ) {
    throw new GitHubIssueError(
      "The GitHub issue is too long for verification. Use a manual bug description of 10000 characters or fewer.",
      422,
    );
  }
  const githubIssue: GitHubIssue = {
    url: parsed.issueUrl,
    number: parsed.issueNumber,
    title,
    body,
    owner: parsed.owner,
    repository: parsed.repository,
  };
  assertGitHubIssueEnvelopeSize(githubIssue);
  return githubIssue;
}

export async function resolveMissionInput(
  value: unknown,
): Promise<ParsedMissionInput> {
  const input = parseMissionInput(value);
  if (input.mode !== "issue") {
    const { repositoryUrl, issue, reproductionCommand, requiredOutput } = input;
    return { repositoryUrl, issue, reproductionCommand, requiredOutput };
  }
  // Always perform a fresh read: preview/title/repository fields from the
  // browser are intentionally discarded by the pure request parser.
  const githubIssue = await resolveGitHubIssue(input.issueUrl);
  const repository = await resolveGitHubRepository(`https://github.com/${githubIssue.owner}/${githubIssue.repository}`);
  const branch = await resolveGitHubBranch(repository, input.targetBranch);
  // Use API-confirmed repository casing consistently throughout the envelope.
  githubIssue.owner = repository.owner;
  githubIssue.repository = repository.repository;
  githubIssue.url = `${repository.repositoryUrl}/issues/${githubIssue.number}`;
  return {
    mode: "THIRD_PARTY_JS_TS",
    repositoryUrl: repository.repositoryUrl,
    defaultBranch: repository.defaultBranch,
    ...branch,
    issue: githubIssue.body
      ? `${githubIssue.title}\n\n${githubIssue.body}`
      : githubIssue.title,
    reproductionCommand: input.reproductionCommand,
    requiredOutput: input.requiredOutput,
    githubIssue,
  };
}
