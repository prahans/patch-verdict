import "server-only";

import { parseGitHubIssueUrl, type GitHubIssue } from "./github-issue-url";
import {
  MISSION_INPUT_LIMITS,
  MissionInputError,
  assertGitHubIssueEnvelopeSize,
  parseMissionInput,
  type ParsedMissionInput,
} from "./mission-input";

export class GitHubIssueError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "GitHubIssueError";
    this.status = status;
  }
}

const unavailable = () =>
  new GitHubIssueError(
    "GitHub is unavailable. Please try loading the issue again.",
  );

export async function resolveGitHubIssue(
  issueUrl: string,
): Promise<GitHubIssue> {
  let parsed: ReturnType<typeof parseGitHubIssueUrl>;
  try {
    parsed = parseGitHubIssueUrl(issueUrl);
  } catch {
    throw new MissionInputError("Enter an exact public GitHub issue URL.");
  }
  let response: Response;
  try {
    // This public read deliberately has no write credential. Redirects cannot
    // turn a fixed GitHub API request into an arbitrary network request.
    response = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repository}/issues/${parsed.issueNumber}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "PatchVerdict",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
  } catch {
    throw unavailable();
  }
  if (!response.ok) await response.body?.cancel().catch(() => undefined);
  if (response.status === 404 || response.status === 401) {
    throw new GitHubIssueError(
      "The issue or repository was not found, or is private or inaccessible. Use a public GitHub issue.",
      404,
    );
  }
  if (
    response.status === 429 ||
    (response.status === 403 &&
      (response.headers.get("x-ratelimit-remaining") === "0" ||
        response.headers.has("retry-after")))
  ) {
    throw new GitHubIssueError(
      "GitHub's rate limit was reached. Please try again later.",
      429,
    );
  }
  if (response.status === 403)
    throw new GitHubIssueError(
      "The GitHub issue is inaccessible. Use a public GitHub issue.",
      403,
    );
  if (!response.ok || !response.body) throw unavailable();
  const reader = response.body.getReader();
  let bytes = 0;
  let text = "";
  const decoder = new TextDecoder();
  let data: Record<string, unknown>;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 256 * 1024) {
        await reader.cancel();
        throw unavailable();
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw unavailable();
    data = value as Record<string, unknown>;
  } catch {
    throw unavailable();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
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
  return {
    repositoryUrl: `https://github.com/${githubIssue.owner}/${githubIssue.repository}`,
    issue: githubIssue.body
      ? `${githubIssue.title}\n\n${githubIssue.body}`
      : githubIssue.title,
    reproductionCommand: input.reproductionCommand,
    requiredOutput: input.requiredOutput,
    githubIssue,
  };
}
