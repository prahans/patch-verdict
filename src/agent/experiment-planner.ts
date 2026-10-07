import { z } from "zod";
import type { CreateCausalFreezeInput } from "./create-causal-freeze.js";
import type { CounterfactualInput, CounterfactualInterventionRole } from "../tools/run-counterfactual.js";

const refSchema = z.object({
  kind: z.enum(["FILE", "TEST", "EXPERIMENT"]), source: z.string().trim().min(1).max(500),
}).strict();

const experimentPredictionSchema = z.object({
  hypothesisId: z.string().regex(/^H[1-5]$/),
  expectedOutcome: z.enum(["FAILURE_REMOVED", "FAILURE_PERSISTS", "UNKNOWN"]),
  reason: z.string().trim().min(10).max(1500),
  evidenceRefs: z.array(refSchema).min(1).max(10),
}).strict();

const experimentCandidateSchema = z.object({
  id: z.string().regex(/^candidate-[1-9]\d*$/),
  question: z.string().trim().min(10).max(1500),
  causalVariable: z.string().trim().min(10).max(1000),
  path: z.string().trim().min(1).max(500),
  find: z.string().min(1).max(4000),
  replace: z.string().max(4000),
  predictions: z.array(experimentPredictionSchema).min(2).max(5),
}).strict();

export const experimentProposalSchema = z.object({
  candidates: z.array(experimentCandidateSchema).max(3),
  stopReason: z.string().trim().min(10).max(1500).nullable(),
}).strict();

export function experimentProposalResponseJsonSchema(context: {
  evidence: CreateCausalFreezeInput;
  runnerConfigPaths: readonly string[];
  testSetupPaths: readonly string[];
}): Record<string, unknown> {
  const hypothesisIds = context.evidence.board.hypotheses.map((item) => item.id);
  const inspectedPaths = new Set(
    context.evidence.files
      .filter((file) => !file.truncated)
      .map((file) => normalizePath(file.path)),
  );
  const allowedPaths = [
    ...new Set(
      [...context.runnerConfigPaths, ...context.testSetupPaths]
        .map(normalizePath)
        .filter((filePath) => inspectedPaths.has(filePath)),
    ),
  ];

  if (allowedPaths.length === 0) {
    throw new Error("No inspected runner configuration or shared test-setup file is available for a counterfactual experiment.");
  }

  const evidenceSources = [
    ...new Set([
      context.evidence.baseline.command,
      ...context.evidence.files.map((file) => file.path),
      ...context.evidence.tests.flatMap((test) => [
        test.selector,
        test.evidence.command,
      ]),
      ...context.evidence.experiments
        .filter((experiment) => experiment.repositoryRestored)
        .map((experiment) => experiment.evidenceSource),
    ]),
  ];

  const constrainedRefSchema = refSchema.extend({
    source: z.enum(evidenceSources as [string, ...string[]]),
  });

  const constrainedPredictionSchema = experimentPredictionSchema.extend({
    hypothesisId: z.enum(hypothesisIds as [string, ...string[]]),
    evidenceRefs: z.array(constrainedRefSchema).min(1).max(10),
  });

  const constrainedCandidateSchema = experimentCandidateSchema.extend({
    path: z.enum(allowedPaths as [string, ...string[]]),
    predictions: z
      .array(constrainedPredictionSchema)
      .min(hypothesisIds.length)
      .max(hypothesisIds.length),
  });

  return z.toJSONSchema(
    experimentProposalSchema.extend({
      candidates: z.array(constrainedCandidateSchema).max(3),
    }),
  ) as Record<string, unknown>;
}

export type ExperimentCandidate = z.infer<typeof experimentProposalSchema>["candidates"][number];
export type ExperimentRanking = {
  candidate: ExperimentCandidate;
  informationGainBits: number;
  interventionRole: CounterfactualInterventionRole | null;
  priorityDirect: boolean;
  rejectionReasons: string[];
};

export type PriorityDirectBooleanIntervention = {
  path: string;
  key: string;
  find: string;
  replace: string;
  hypothesisIds: string[];
};
export type ExperimentPlan = {
  round: number;
  status: "SELECTED" | "STOPPED" | "REJECTED";
  reason: string;
  rankings: ExperimentRanking[];
  selectedCandidateId: string | null;
  request: CounterfactualInput | null;
  execution: { status: "COMPLETED" | "FAILED"; evidenceSource: string | null; error: string | null } | null;
};
export type ExperimentPlanningSummary = {
  plans: ExperimentPlan[];
  stopReason: string;
  usage: { modelTurns: number; toolCalls: number; testExecutions: number; experimentExecutions: number };
};
export type ExperimentPlanningContext = {
  evidence: CreateCausalFreezeInput;
  runnerConfigPaths: readonly string[];
  testSetupPaths: readonly string[];
  previousPlans: readonly ExperimentPlan[];
  remainingExecutions: number;
  maxPlanningRounds: number;
  nextExperimentId: string;
};

const normalizePath = (value: string) => value.replace(/\\/g, "/").replace(/^\.\//, "");
const interventionKey = (item: { path: string; find: string; replace: string }) =>
  JSON.stringify([normalizePath(item.path), item.find, item.replace]);

/**
 * Host-detected direct boolean toggles from inspected runner configuration.
 * Only variables explicitly named by an original hypothesis are eligible.
 */
export function priorityDirectBooleanInterventions(context: {
  evidence: CreateCausalFreezeInput;
  runnerConfigPaths: readonly string[];
}): PriorityDirectBooleanIntervention[] {
  const runnerPaths = new Set(context.runnerConfigPaths.map(normalizePath));
  const candidates: PriorityDirectBooleanIntervention[] = [];
  const seen = new Set<string>();

  for (const file of context.evidence.files) {
    const path = normalizePath(file.path);

    if (file.truncated || !runnerPaths.has(path)) continue;

    const booleanSetting = /\b([A-Za-z_$][\w$]*)\s*:\s*(true|false)\b/g;
    let match: RegExpExecArray | null;

    while ((match = booleanSetting.exec(file.content)) !== null) {
      const key = match[1]!;
      const current = match[2]!;
      const hypothesisIds = context.evidence.board.hypotheses
        .filter((hypothesis) =>
          hypothesis.hypothesis.toLowerCase().includes(key.toLowerCase()),
        )
        .map((hypothesis) => hypothesis.id);

      if (hypothesisIds.length === 0) continue;

      const find = match[0];
      if (file.content.split(find).length - 1 !== 1) continue;

      const replace = find.replace(
        /\b(true|false)\b$/,
        current === "true" ? "false" : "true",
      );
      const candidate = { path, key, find, replace, hypothesisIds };
      const signature = interventionKey(candidate);

      if (seen.has(signature)) continue;

      seen.add(signature);
      candidates.push(candidate);
    }
  }

  return candidates
    .sort(
      (a, b) =>
        b.hypothesisIds.length - a.hypothesisIds.length ||
        a.path.localeCompare(b.path) ||
        a.key.localeCompare(b.key),
    )
    .slice(0, 2);
}

function excerpt(value: string, max = 120) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= max ? compact : `${compact.slice(0, max - 1)}…`;
}

function hostExperimentQuestion(candidate: ExperimentCandidate) {
  return [
    `Does the trusted reproduction outcome change when ${normalizePath(candidate.path)} is temporarily changed`,
    `from "${excerpt(candidate.find)}" to "${excerpt(candidate.replace)}" while all other repository state is restored?`,
  ].join(" ");
}

function entropy(probability: number) {
  if (probability === 0 || probability === 1) return 0;
  return -probability * Math.log2(probability) - (1 - probability) * Math.log2(1 - probability);
}

/**
 * A ranking heuristic, not a calibrated probability of a cause. Assume uniform
 * hypothesis weights, deterministic predictions, and 50/50 for UNKNOWN. Require
 * opposing concrete predictions; shared symptom suppression has zero gain.
 */
export function predictedInformationGain(predictions: ExperimentCandidate["predictions"]): number {
  const removed = predictions.filter((item) => item.expectedOutcome === "FAILURE_REMOVED").length;
  const persists = predictions.filter((item) => item.expectedOutcome === "FAILURE_PERSISTS").length;
  if (!removed || !persists) return 0;
  const unknown = predictions.length - removed - persists;
  return Math.max(0, entropy((removed + unknown / 2) / predictions.length) - unknown / predictions.length);
}

/** Validates and ranks proposals; only the returned host request can execute. */
export function planExperiments(raw: unknown, context: ExperimentPlanningContext): ExperimentPlan {
  const record: ExperimentPlan = {
    round: context.previousPlans.length + 1, status: "STOPPED", reason: "",
    rankings: [], selectedCandidateId: null, request: null, execution: null,
  };
  if (context.remainingExecutions <= 0 || record.round > context.maxPlanningRounds) {
    record.reason = "Experiment planning/execution budget exhausted.";
    return record;
  }
  const parsed = experimentProposalSchema.safeParse(raw);
  if (!parsed.success) {
    return { ...record, status: "REJECTED", reason: `Invalid experiment proposal: ${parsed.error.message}` };
  }
  const proposal =
    parsed.data.candidates.length > 0 && parsed.data.stopReason !== null
      ? { ...parsed.data, stopReason: null }
      : parsed.data;

  if (!proposal.candidates.length) {
    if (!proposal.stopReason) {
      return {
        ...record,
        status: "REJECTED",
        reason: "An empty proposal requires a stopReason.",
      };
    }

    return { ...record, reason: proposal.stopReason };
  }

  const ids = context.evidence.board.hypotheses.map((item) => item.id);
  const knownRefs = new Set([
    `TEST:${context.evidence.baseline.command}`,
    ...context.evidence.files.map((file) => `FILE:${file.path}`),
    ...context.evidence.tests.flatMap((test) => [`TEST:${test.selector}`, `TEST:${test.evidence.command}`]),
  ]);
  const tried = new Set([
    ...context.previousPlans.flatMap((plan) => plan.request ? [interventionKey(plan.request)] : []),
    ...context.evidence.experiments.map((experiment) => interventionKey(experiment.intervention)),
  ]);
  const candidateIds = proposal.candidates.map((candidate) => candidate.id);
  const keys = proposal.candidates.map(interventionKey);
  const priorityDirectKeys = new Set(
    priorityDirectBooleanInterventions({
      evidence: context.evidence,
      runnerConfigPaths: context.runnerConfigPaths,
    }).map(interventionKey),
  );

  for (const candidate of proposal.candidates) {
    const errors: string[] = [];
    const path = normalizePath(candidate.path);
    const role = context.runnerConfigPaths.includes(path) ? "RUNNER_CONFIGURATION"
      : context.testSetupPaths.includes(path) ? "TEST_SETUP_CONTROL" : null;
    if (!role) errors.push("Intervention path is not an allowlisted runner configuration or shared setup file.");
    if (path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.split("/").includes("..")) errors.push("Unsafe repository-relative intervention path.");
    const file = context.evidence.files.find((item) => item.path === path);
    if (!file || file.truncated) errors.push("Intervention requires a completely inspected file.");
    else if (file.content.split(candidate.find).length - 1 !== 1) errors.push("Intervention find text must occur exactly once in the observed file.");
    if (candidate.find === candidate.replace) errors.push("Intervention must change the named causal variable.");
    if (tried.has(interventionKey(candidate))) errors.push("This intervention was already attempted, regardless of its id or wording.");
    if (candidateIds.filter((id) => id === candidate.id).length !== 1) errors.push("Duplicate candidate id.");
    if (keys.filter((key) => key === interventionKey(candidate)).length !== 1) errors.push("Duplicate intervention in this proposal.");
    const predictedIds = candidate.predictions.map((item) => item.hypothesisId);
    if (new Set(predictedIds).size !== ids.length || predictedIds.length !== ids.length || predictedIds.some((id) => !ids.includes(id))) {
      errors.push("Predictions must cover every original hypothesis exactly once; use UNKNOWN when necessary.");
    }
    for (const prediction of candidate.predictions) {
      for (const ref of prediction.evidenceRefs) {
        if (ref.kind === "EXPERIMENT") {
          const experiment = context.evidence.experiments.find((item) => item.evidenceSource === ref.source);
          if (!experiment?.repositoryRestored || !experiment.hypothesisIds.includes(prediction.hypothesisId)) {
            errors.push(`Prediction for ${prediction.hypothesisId} cites an unavailable or out-of-scope experiment ${ref.source}.`);
          }
        } else if (!knownRefs.has(`${ref.kind}:${ref.source}`)) errors.push(`Prediction cites unobserved evidence ${ref.kind}:${ref.source}.`);
      }
    }
    const gain = predictedInformationGain(candidate.predictions);
    if (gain <= 0) errors.push("No opposing predicted outcomes; this intervention cannot distinguish hypotheses.");
    record.rankings.push({
      candidate,
      informationGainBits: gain,
      interventionRole: role,
      priorityDirect: priorityDirectKeys.has(interventionKey(candidate)),
      rejectionReasons: errors,
    });
  }
  // Test a directly named observed runner boolean before nearby substitutes.
  // Then use predicted information gain and deterministic tie-breaks.
  record.rankings.sort((a, b) =>
    Number(a.rejectionReasons.length > 0) - Number(b.rejectionReasons.length > 0) ||
    Number(b.priorityDirect) - Number(a.priorityDirect) ||
    b.informationGainBits - a.informationGainBits ||
    Number(a.interventionRole === "TEST_SETUP_CONTROL") - Number(b.interventionRole === "TEST_SETUP_CONTROL") ||
    (a.candidate.find.length + a.candidate.replace.length) - (b.candidate.find.length + b.candidate.replace.length) ||
    a.candidate.id.localeCompare(b.candidate.id),
  );
  const winner = record.rankings.find((item) => !item.rejectionReasons.length);
  if (!winner) return { ...record, reason: "No new executable experiment with positive predicted information gain." };
  return {
    ...record, status: "SELECTED", reason: "Highest predicted information gain among valid, untried candidates.",
    selectedCandidateId: winner.candidate.id,
    request: {
      experimentId: context.nextExperimentId,
      hypothesisIds: winner.candidate.predictions.filter((item) => item.expectedOutcome !== "UNKNOWN").map((item) => item.hypothesisId),
      question: hostExperimentQuestion(winner.candidate), path: normalizePath(winner.candidate.path),
      find: winner.candidate.find, replace: winner.candidate.replace,
    },
  };
}
