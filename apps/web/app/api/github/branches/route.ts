import { GitHubIssueError } from "../../../../lib/github-public-api";
import { listGitHubBranches, resolveGitHubBranch, resolveGitHubRepository } from "../../../../lib/github-branches";
import { parseGitHubIssueUrl } from "../../../../lib/github-issue-url";
import { MissionInputError } from "../../../../lib/mission-input";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const issueUrl = query.get("issueUrl");
    if (!issueUrl || issueUrl.length > 2048) throw new MissionInputError("Enter an exact public GitHub issue URL.");
    let repositoryUrl: string;
    try { repositoryUrl = parseGitHubIssueUrl(issueUrl).repositoryUrl; } catch { throw new MissionInputError("Enter an exact public GitHub issue URL."); }
    const repository = await resolveGitHubRepository(repositoryUrl);
    const exact = query.get("exact");
    const result = exact !== null
      ? { ...repository, branches: [(await resolveGitHubBranch(repository, exact)).targetBranch], nextPage: null }
      : await listGitHubBranches(repository, Number(query.get("page") ?? "1"));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof MissionInputError || error instanceof GitHubIssueError ? error.message : "GitHub branches could not be loaded. Please try again." },
      { status: error instanceof MissionInputError ? 400 : error instanceof GitHubIssueError ? error.status : 502, headers: { "Cache-Control": "no-store" } });
  }
}
