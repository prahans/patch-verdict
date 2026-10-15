import { createMissionPullRequest, PullRequestError } from "../../../../../lib/github-pull-request";

export const runtime = "nodejs";

async function hasRequestBody(request: Request) {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > 0) return true;
  if (!request.body) return false;

  const reader = request.body.getReader();
  try {
    const { done, value } = await reader.read();
    return !done && !!value?.byteLength;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function POST(request: Request, context: { params: Promise<{ missionId: string }> }) {
  const headers = { "Cache-Control": "no-store" };
  // Browser-triggered authenticated writes must originate from this application.
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ error: "Pull request creation must be requested from this PatchVerdict application." }, { status: 403, headers });
  }
  try {
    // Some runtimes expose a zero-byte POST stream as a non-null body.
    // Reject client-supplied canonical data, but allow a truly empty request.
    if (await hasRequestBody(request)) return Response.json({ error: "This action does not accept a request body." }, { status: 400, headers });
    const { missionId } = await context.params;
    return Response.json(await createMissionPullRequest(missionId), { headers });
  } catch (error) {
    return Response.json({ error: error instanceof PullRequestError ? error.message : "Pull request creation could not be completed." },
      { status: error instanceof PullRequestError ? error.status : 500, headers });
  }
}
