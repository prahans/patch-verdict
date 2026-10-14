import { createMissionPullRequest, PullRequestError } from "../../../../../lib/github-pull-request";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ missionId: string }> }) {
  const headers = { "Cache-Control": "no-store" };
  // Browser-triggered authenticated writes must originate from this application.
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ error: "Pull request creation must be requested from this PatchVerdict application." }, { status: 403, headers });
  }
  try {
    // There is no client-supplied repository, patch, branch, base, or verdict.
    if (request.body !== null) return Response.json({ error: "This action does not accept a request body." }, { status: 400, headers });
    const { missionId } = await context.params;
    return Response.json(await createMissionPullRequest(missionId), { headers });
  } catch (error) {
    return Response.json({ error: error instanceof PullRequestError ? error.message : "Pull request creation could not be completed." },
      { status: error instanceof PullRequestError ? error.status : 500, headers });
  }
}
