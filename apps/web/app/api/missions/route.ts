import { MissionInputError, parseMissionInput } from "../../../lib/mission-input";
import { BackendMissionError, runBackendMission } from "../../../lib/run-backend-mission";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BODY_BYTES = 64 * 1024;

class RequestBodyError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new RequestBodyError("Send the mission fields as application/json.", 415);
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > MAX_BODY_BYTES) {
    throw new RequestBodyError("The mission request is too large.", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new RequestBodyError("A JSON request body is required.", 400);
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RequestBodyError("The mission request is too large.", 413);
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body);
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError("The request body must contain valid JSON.", 400);
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  try {
    const input = parseMissionInput(await readJson(request));
    const result = await runBackendMission(input);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Only known, fixed public messages leave the server. Never return child
    // output, raw exception text, credentials, or filesystem paths.
    const known = error instanceof MissionInputError ||
      error instanceof RequestBodyError || error instanceof BackendMissionError;
    return Response.json(
      { error: known ? error.message : "The verification mission could not be started. Please try again." },
      {
        status: error instanceof MissionInputError ? 400 :
          error instanceof RequestBodyError || error instanceof BackendMissionError ? error.status : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
