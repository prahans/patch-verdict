import { z } from "zod";
import { investigationDiagnosisSchema } from "./investigation-contract.js";
import { repairKindSchema } from "./root-cause-contract.js";
import type { CreateCausalFreezeInput } from "./create-causal-freeze.js";
import type { VerificationPlan } from "../verification/types.js";

const refSchema = z.object({
  kind: z.enum(["FILE", "TEST", "EXPERIMENT"]), source: z.string().trim().min(1).max(500),
}).strict();
const alternativeSchema = z.object({
  id: z.string().regex(/^option-[1-9]\d*$/),
  path: z.string().trim().min(1).max(500).nullable(),
  repairKind: repairKindSchema.nullable(),
  objective: z.string().trim().min(10).max(2000),
  decision: z.enum(["SELECTED", "REJECTED"]),
  reason: z.string().trim().min(10).max(2000),
  tradeoff: z.string().trim().min(10).max(2000),
  evidenceRefs: z.array(refSchema).min(1).max(10),
}).strict();

const common = {
  report: z.string().trim().min(1).max(10_000),
  alternatives: z.array(alternativeSchema).min(1).max(4),
};
export const repairPlanOutputSchema = z.discriminatedUnion("status", [
  z.object({
    ...common, status: z.literal("READY"),
    alternatives: z.array(alternativeSchema).min(2).max(4),
    selectedAlternativeId: z.string().regex(/^option-[1-9]\d*$/),
    plan: investigationDiagnosisSchema.omit({ rootCause: true, rootCauseAnalysis: true, confidence: true }),
    blockers: z.array(z.string()).length(0),
  }).strict(),
  z.object({
    ...common, status: z.literal("BLOCKED"), selectedAlternativeId: z.null(), plan: z.null(),
    blockers: z.array(z.string().trim().min(10).max(2000)).min(1).max(8),
  }).strict(),
]);
export type RepairPlanOutput = z.infer<typeof repairPlanOutputSchema>;
export type ReadyRepairPlan = Extract<RepairPlanOutput, { status: "READY" }>;
export type RepairPlanRecord = {
  decision: RepairPlanOutput;
  verification: { reproductionCommand: string; fullSuiteCommand: string };
};
export type RepairPlanningFailure = {
  attempts: { responseText: string | null; error: string }[];
};

export function repairPlanRecord(decision: RepairPlanOutput, verification: VerificationPlan): RepairPlanRecord {
  return {
    decision,
    verification: { reproductionCommand: verification.reproduction.command, fullSuiteCommand: verification.fullSuite.command },
  };
}

/** Alternative comparison is a repair decision, never a revision of causality. */
export function assertRepairAlternatives(output: RepairPlanOutput, evidence: CreateCausalFreezeInput): void {
  const refs = new Set([
    `TEST:${evidence.baseline.command}`,
    ...evidence.files.map((file) => `FILE:${file.path}`),
    ...evidence.tests.flatMap((test) => [`TEST:${test.selector}`, `TEST:${test.evidence.command}`]),
    ...evidence.experiments.filter((experiment) => experiment.repositoryRestored).map((experiment) => `EXPERIMENT:${experiment.evidenceSource}`),
  ]);
  const ids = new Set<string>();
  const choices = new Set<string>();
  const selected = output.alternatives.filter((option) => option.decision === "SELECTED");
  for (const option of output.alternatives) {
    if (ids.has(option.id)) throw new Error(`Duplicate repair alternative id ${option.id}.`);
    ids.add(option.id);
    const choiceKey = JSON.stringify([option.path, option.repairKind, option.objective.toLowerCase(), option.tradeoff.toLowerCase()]);
    if (choices.has(choiceKey)) throw new Error("Repair alternatives must describe distinct choices, not renamed duplicates.");
    choices.add(choiceKey);
    if ((option.path === null) !== (option.repairKind === null)) throw new Error("A no-change alternative must have both path and repairKind null.");
    if (option.path !== null) {
      if (!evidence.files.some((file) => file.path === option.path && !file.truncated)) {
        throw new Error(`Repair alternative path ${option.path} was not inspected completely.`);
      }
      if (!option.evidenceRefs.some((ref) => ref.kind === "FILE" && ref.source === option.path)) {
        throw new Error(`Repair alternative ${option.id} must cite its own FILE evidence.`);
      }
    }
    for (const ref of option.evidenceRefs) {
      if (!refs.has(`${ref.kind}:${ref.source}`)) throw new Error(`Repair alternative cites unavailable evidence ${ref.kind}:${ref.source}.`);
    }
  }
  if (output.status === "BLOCKED") {
    if (selected.length) throw new Error("A BLOCKED repair plan cannot select an alternative.");
    return;
  }
  const choice = selected[0];
  if (selected.length !== 1 || choice?.id !== output.selectedAlternativeId || choice.path === null) {
    throw new Error("READY requires exactly one selected patch alternative; no-change does not authorize a patch.");
  }
  // The current executor authorizes one file and one intent. Do not produce a
  // multi-file plan that the patch phase can only partially execute.
  const intent = output.plan.patchIntents[0];
  if (output.plan.patchIntents.length !== 1 || output.plan.recommendedPatchTargets.length !== 1 ||
      output.plan.recommendedPatchTargets[0] !== choice.path || intent?.path !== choice.path ||
      intent.repairKind !== choice.repairKind || intent.objective !== choice.objective) {
    throw new Error("Selected repair alternative must match exactly one authorized target and intent (path, repairKind, objective).");
  }
  const ledger = new Set(output.plan.evidence.map((ref) => `${ref.kind}:${ref.source}`));
  for (const option of output.alternatives) {
    if (option.evidenceRefs.some((ref) => !ledger.has(`${ref.kind}:${ref.source}`))) {
      throw new Error(`Repair alternative ${option.id} cites evidence missing from the plan ledger.`);
    }
  }
}

export function assertRepairChoiceUnchanged(before: RepairPlanOutput, after: RepairPlanOutput): void {
  const snapshot = (output: RepairPlanOutput) => ({
    status: output.status, selectedAlternativeId: output.selectedAlternativeId, blockers: output.blockers,
    alternatives: output.alternatives.map(({ id, path, repairKind, objective, decision, tradeoff }) =>
      ({ id, path, repairKind, objective, decision, tradeoff })),
  });
  if (JSON.stringify(snapshot(before)) !== JSON.stringify(snapshot(after))) {
    throw new Error("Contract repair attempted to change the repair choice, alternatives, tradeoffs, or blockers.");
  }
}
