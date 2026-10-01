import { z } from "zod";

export const CommandEvidenceSchema = z.object({
  command: z.string(),
  exitCode: z.number(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number().nonnegative(),
});

export type CommandEvidence = z.infer<typeof CommandEvidenceSchema>;
