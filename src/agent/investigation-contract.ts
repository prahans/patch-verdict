import { z } from "zod";

const repositoryPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(
    (value) => {
      const normalized = value.replace(/\\/g, "/");

      return (
        !normalized.startsWith("/") &&
        normalized !== ".." &&
        !normalized.startsWith("../") &&
        !normalized.includes("/../")
      );
    },
    {
      message: "Expected a safe repository-relative path.",
    },
  );

const investigationEvidenceSchema = z
  .object({
    kind: z.enum(["FILE", "TEST", "SEARCH"]),

    source: z.string().trim().min(1).max(500),

    observation: z.string().trim().min(1).max(2000),
  })
  .strict();

const patchTargetAnalysisEntrySchema = z
  .object({
    path: repositoryPathSchema,

    decision: z.enum(["RECOMMEND", "REJECT"]),

    reason: z.string().trim().min(10).max(2000),
  })
  .strict();

const patchIntentEvidenceRefSchema = z
  .object({
    kind: z.enum(["FILE", "TEST", "SEARCH"]),

    source: z.string().trim().min(1).max(500),
  })
  .strict();

const patchIntentSchema = z
  .object({
    id: z
      .string()
      .trim()
      .regex(
        /^intent-[1-9]\d*$/,
        "Expected an intent id such as intent-1.",
      ),

    path: repositoryPathSchema,

    objective: z.string().trim().min(10).max(2000),

    evidenceRefs: z.array(patchIntentEvidenceRefSchema).min(1).max(10),
  })
  .strict();

export const investigationDiagnosisSchema = z
  .object({
    rootCause: z.string().trim().min(1).max(4000),

    evidence: z.array(investigationEvidenceSchema).min(1).max(20),

    relevantFiles: z.array(repositoryPathSchema).min(1).max(30),

    recommendedPatchTargets: z.array(repositoryPathSchema).min(1).max(10),

    patchTargetAnalysis: z.array(patchTargetAnalysisEntrySchema).min(1).max(20),

    patchIntents: z.array(patchIntentSchema).min(1).max(20),

    confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  })
  .strict();

export const investigationModelOutputSchema = z
  .object({
    report: z.string().trim().min(1).max(10_000),

    diagnosis: investigationDiagnosisSchema,
  })
  .strict();

export type InvestigationDiagnosis = z.infer<
  typeof investigationDiagnosisSchema
>;

export type InvestigationModelOutput = z.infer<
  typeof investigationModelOutputSchema
>;

function removeJsonFence(content: string) {
  const trimmed = content.trim();

  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);

  return match?.[1]?.trim() ?? trimmed;
}

export function parseInvestigationModelOutput(
  content: string,
): InvestigationModelOutput {
  const json = removeJsonFence(content);

  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Investigation agent returned invalid JSON.");
  }

  const result = investigationModelOutputSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(
      `Investigation agent returned an invalid structured diagnosis: ${z.prettifyError(
        result.error,
      )}`,
    );
  }

  return result.data;
}
