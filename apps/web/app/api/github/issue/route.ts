import { GitHubIssueError, resolveGitHubIssue } from "../../../../lib/github-issue";
import { MissionInputError } from "../../../../lib/mission-input";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url).searchParams.get("url");
    if (!url || url.length > 2048) throw new MissionInputError("Enter an exact public GitHub issue URL.");
    const issue = await resolveGitHubIssue(url);
    return Response.json({ owner: issue.owner, repository: issue.repository, issueNumber: issue.number,
      title: issue.title, bodyPreview: (issue.body ?? "").slice(0, 500), issueUrl: issue.url },
    { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = error instanceof MissionInputError || error instanceof GitHubIssueError;
    return Response.json({ error: known ? error.message : "The GitHub issue could not be loaded. Please try again." },
      { status: error instanceof MissionInputError ? 400 : error instanceof GitHubIssueError ? error.status : 502,
        headers: { "Cache-Control": "no-store" } });
  }
}
