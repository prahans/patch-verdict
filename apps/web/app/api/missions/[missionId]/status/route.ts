import { isSafeMissionId } from "../../../../../lib/mission-live-types";
import { readMissionLiveStatus } from "../../../../../lib/mission-live-status";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ missionId: string }> }) {
  const { missionId } = await context.params;
  const headers = { "Cache-Control": "no-store" };
  if (!isSafeMissionId(missionId)) {
    return Response.json({ error: "Invalid mission ID." }, { status: 400, headers });
  }
  try {
    const status = await readMissionLiveStatus(missionId);
    if (!status) return Response.json({ error: "Mission status was not found." }, { status: 404, headers });
    return Response.json(status, { headers });
  } catch {
    return Response.json({ error: "Mission status could not be read." }, { status: 500, headers });
  }
}
