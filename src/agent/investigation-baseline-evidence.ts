import type { InvestigationBaselineContext } from "./investigation-context.js";
import type { InvestigationModelOutput } from "./investigation-contract.js";

function referencesBaseline(
  structured: InvestigationModelOutput,
  command: string,
) {
  const normalizedCommand = command.trim();

  const refs = [
    ...structured.diagnosis.scopeAnalysis.evidenceRefs,
    ...structured.diagnosis.patchTargetAnalysis.flatMap(
      (entry) => entry.evidenceRefs,
    ),
    ...structured.diagnosis.patchIntents.flatMap(
      (intent) => intent.evidenceRefs,
    ),
  ];

  return refs.some(
    (ref) =>
      ref.kind === "TEST" && ref.source.trim() === normalizedCommand,
  );
}

export function ensureTrustedBaselineEvidence(
  structured: InvestigationModelOutput,
  baseline: InvestigationBaselineContext,
): InvestigationModelOutput {
  if (!referencesBaseline(structured, baseline.command)) {
    return structured;
  }

  const alreadyPresent = structured.diagnosis.evidence.some(
    (evidence) =>
      evidence.kind === "TEST" &&
      evidence.source.trim() === baseline.command.trim(),
  );

  if (alreadyPresent) {
    return structured;
  }

  if (structured.diagnosis.evidence.length >= 20) {
    return structured;
  }

  return {
    ...structured,
    diagnosis: {
      ...structured.diagnosis,
      evidence: [
        ...structured.diagnosis.evidence,
        {
          kind: "TEST",
          source: baseline.command,
          observation:
            `Trusted baseline reproduction exited with code ${baseline.exitCode} and reproduced the reported issue.`,
        },
      ],
    },
  };
}
