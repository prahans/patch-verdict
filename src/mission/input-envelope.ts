import { z } from "zod";
import type { Readable } from "node:stream";

export const MAX_MISSION_INPUT_BYTES = 64 * 1024;
const githubIssueSchema = z.object({
  url: z.string().max(2048), number: z.number().int().positive().safe(), title: z.string().min(1).max(1024),
  owner: z.string().regex(/^[A-Za-z0-9-]+$/), repository: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  body: z.string().max(12_000).optional(),
}).strict();
const envelopeSchema = z.object({
  version: z.literal(1), mode: z.enum(["LEGACY", "THIRD_PARTY_JS_TS"]),
  repositoryUrl: z.string().max(2048), issue: z.string().min(1).max(16_000), githubIssue: githubIssueSchema.optional(),
  targetBranch: z.string().min(1).max(255).optional(), defaultBranch: z.string().min(1).max(255).optional(),
  baseCommit: z.string().regex(/^[0-9a-f]{40}$/).optional(),
  reproductionCommand: z.string().max(2000).optional(), requiredOutput: z.string().max(2000).optional(),
}).strict();
export type MissionEnvelope = z.infer<typeof envelopeSchema>;

export function parseMissionEnvelope(text: string): MissionEnvelope {
  if (Buffer.byteLength(text, "utf8") > MAX_MISSION_INPUT_BYTES) throw new Error("Mission input exceeds its byte limit.");
  const input = envelopeSchema.parse(JSON.parse(text));
  const url = new URL(input.repositoryUrl);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash ||
    !/^\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname)) throw new Error("Mission repository must be a canonical public GitHub repository URL.");
  const repository = url.pathname.replace(/^\//, "").replace(/\/$/, "").replace(/\.git$/, "");
  if (input.githubIssue) {
    const source = input.githubIssue;
    if (`${source.owner}/${source.repository}` !== repository ||
      source.url !== `https://github.com/${repository}/issues/${source.number}` ||
      /[\0\r\n]/.test(source.title) ||
      input.issue !== (source.body ? `${source.title}\n\n${source.body}` : source.title)) throw new Error("Mission issue does not match its canonical source.");
  }
  if (input.mode === "THIRD_PARTY_JS_TS") {
    if (!input.githubIssue || !input.targetBranch || !input.defaultBranch || !input.baseCommit ||
      /[\0\r\n]/.test(input.targetBranch + input.defaultBranch)) throw new Error("Strict mission requires a resolved issue, branch, and exact SHA.");
    if (input.reproductionCommand?.trim() || input.requiredOutput?.trim()) throw new Error("Strict missions use framework-owned reproduction commands.");
  } else if (input.targetBranch || input.defaultBranch || input.baseCommit) throw new Error("Legacy missions cannot supply strict checkout authority.");
  return input;
}

export async function readMissionEnvelope(stream: Readable): Promise<MissionEnvelope> {
  const chunks: Buffer[] = [];
  let length = 0;
  const timeout = setTimeout(() => stream.destroy(new Error("Mission input timed out.")), 10_000);
  timeout.unref();
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      length += bytes.length;
      if (length > MAX_MISSION_INPUT_BYTES) throw new Error("Mission input exceeds its byte limit.");
      chunks.push(bytes);
    }
    return parseMissionEnvelope(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { clearTimeout(timeout); }
}
