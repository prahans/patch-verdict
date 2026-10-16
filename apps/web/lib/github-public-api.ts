import "server-only";

export class GitHubIssueError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "GitHubIssueError";
    this.status = status;
  }
}

export function githubUnavailable(): GitHubIssueError {
  return new GitHubIssueError("GitHub is unavailable. Please try loading the issue again.");
}

/** Public reads never inherit the publication credential or follow redirects. */
export async function readGitHubPublicJson(apiPath: string): Promise<unknown> {
  if (!apiPath.startsWith("/repos/") || /[\r\n]/.test(apiPath)) throw githubUnavailable();
  let response: Response;
  try {
    response = await fetch(`https://api.github.com${apiPath}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "PatchVerdict", "X-GitHub-Api-Version": "2022-11-28" },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000),
    });
  } catch { throw githubUnavailable(); }
  if (!response.ok) await response.body?.cancel().catch(() => undefined);
  if (response.status === 404 || response.status === 401)
    throw new GitHubIssueError("The issue, repository, or selected branch was not found, or is private or inaccessible. Use a public GitHub issue and an existing branch.", 404);
  if (response.status === 429 || (response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after"))))
    throw new GitHubIssueError("GitHub's rate limit was reached. Please try again later.", 429);
  if (response.status === 403) throw new GitHubIssueError("The GitHub repository is inaccessible. Use a public GitHub issue.", 403);
  if (!response.ok || !response.body) throw githubUnavailable();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 256 * 1024) throw githubUnavailable();
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch { throw githubUnavailable(); }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
