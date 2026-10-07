import { NextResponse } from "next/server";

import { runBackendMission } from "@/lib/run-backend-mission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = {
  repositoryUrl?: unknown;
  issue?: unknown;
  reproductionCommand?: unknown;
  requiredOutput?: unknown;
};

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request) {
  let body: RequestBody;

  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  try {
    const result = await runBackendMission({
      repositoryUrl: readString(body.repositoryUrl),
      issue: readString(body.issue),
      reproductionCommand: readString(body.reproductionCommand),
      requiredOutput: readString(body.requiredOutput),
    });

    return NextResponse.json({
      missionId: result.missionId,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "PatchVerdict backend mission failed to start.",
      },
      { status: 500 },
    );
  }
}
