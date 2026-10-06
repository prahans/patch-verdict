import { z } from "zod";

import type { InvestigationDiagnosis } from "./investigation-contract.js";

const patchRequestSchema = z
  .object({
    intentId: z.string().trim().min(1).max(100),

    path: z.string().trim().min(1).max(500),

    content: z.string().min(1).max(50_000),
  })
  .strict();

type AuthorizedPatchInput = {
  path: string;
  content: string;
};

export type PatchAuthorizationEvidence = {
  intentId: string;
  authorizedPath: string;
  objective: string;
  evidenceRefs: InvestigationDiagnosis["patchIntents"][number]["evidenceRefs"];
};

type PatchAuthorizationResult =
  | {
      ok: true;
      authorization: PatchAuthorizationEvidence;
      input: AuthorizedPatchInput;
    }
  | {
      ok: false;
      error: string;
    };

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

export function assertPatchAuthorizationMatchesChangedFiles(
  authorization: PatchAuthorizationEvidence,
  changedFiles: readonly string[],
) {
  const normalizedAuthorizedPath = normalizePath(authorization.authorizedPath);

  const normalizedChangedFiles = [
    ...new Set(changedFiles.map(normalizePath)),
  ];

  if (normalizedChangedFiles.length !== 1) {
    throw new Error(
      `Patch authorization "${authorization.intentId}" permits exactly one changed file ("${authorization.authorizedPath}"), but Git reported ${normalizedChangedFiles.length}: ${normalizedChangedFiles.join(", ") || "none"}.`,
    );
  }

  const actualPath = normalizedChangedFiles[0]!;

  if (actualPath !== normalizedAuthorizedPath) {
    throw new Error(
      `Patch authorization "${authorization.intentId}" permits "${authorization.authorizedPath}", but Git reported a change to "${changedFiles[0]}".`,
    );
  }
}

export function authorizePatchToolInput(
  input: unknown,
  patchIntents: InvestigationDiagnosis["patchIntents"],
): PatchAuthorizationResult {
  const parsed = patchRequestSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error:
        "apply_patch requires a valid intentId, repository-relative path, and replacement content.",
    };
  }

  const matchingIntents = patchIntents.filter(
    (intent) => intent.id === parsed.data.intentId,
  );

  if (matchingIntents.length === 0) {
    return {
      ok: false,
      error: `Patch intent "${parsed.data.intentId}" is not authorized by the validated investigation.`,
    };
  }

  if (matchingIntents.length > 1) {
    return {
      ok: false,
      error: `Patch intent "${parsed.data.intentId}" is ambiguous because the validated investigation contains duplicate intent ids.`,
    };
  }

  const intent = matchingIntents[0]!;

  if (normalizePath(parsed.data.path) !== normalizePath(intent.path)) {
    return {
      ok: false,
      error: `Patch intent "${intent.id}" authorizes only "${intent.path}", not "${parsed.data.path}".`,
    };
  }

  return {
    ok: true,
    authorization: {
      intentId: intent.id,
      authorizedPath: intent.path,
      objective: intent.objective,
      evidenceRefs: intent.evidenceRefs,
    },
    input: {
      path: intent.path,
      content: parsed.data.content,
    },
  };
}
