export type VerificationIntegrityStatus =
  | "PRESERVED"
  | "REVIEW_REQUIRED"
  | "COMPROMISED";

export type VerificationIntegrity = {
  status: VerificationIntegrityStatus;

  preserved: boolean;

  violations: string[];

  reviewFlags: string[];

  protectedChangedFiles: string[];
};

type AnalyzeVerificationIntegrityInput = {
  changedFiles: string[];
  diff: string;
};

function normalizePath(filePath: string) {
  return filePath.replace(/\\/g, "/");
}

function isDirectTestFile(filePath: string) {
  const normalized = normalizePath(filePath);

  return (
    /(^|\/)__tests__(\/|$)/i.test(normalized) ||
    /\.(test|spec)\.[^/]+$/i.test(normalized)
  );
}

function isTestInfrastructureFile(filePath: string) {
  const normalized = normalizePath(filePath);

  return (
    /(^|\/)(vitest|jest|playwright|cypress)\.config\.[^/]+$/i.test(
      normalized,
    ) ||
    /(^|\/)(vitest|jest)\.setup\.[^/]+$/i.test(normalized) ||
    /(^|\/)setupTests\.[^/]+$/i.test(normalized)
  );
}

function modifiesPackageTestScript(diff: string) {
  let currentFile: string | undefined;

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);

      currentFile = match?.[2];

      continue;
    }

    if (currentFile !== "package.json") {
      continue;
    }

    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }

    if (
      (line.startsWith("+") || line.startsWith("-")) &&
      /["']test["']\s*:/.test(line)
    ) {
      return true;
    }
  }

  return false;
}

export function analyzeVerificationIntegrity({
  changedFiles,
  diff,
}: AnalyzeVerificationIntegrityInput): VerificationIntegrity {
  const normalizedFiles = changedFiles.map(normalizePath);

  const protectedChangedFiles = normalizedFiles.filter(isDirectTestFile);

  const violations: string[] = [];

  const reviewFlags: string[] = [];

  if (protectedChangedFiles.length > 0) {
    reviewFlags.push(
      `Candidate modified protected test file(s): ${protectedChangedFiles.join(
        ", ",
      )}`,
    );
  }

  if (modifiesPackageTestScript(diff)) {
    violations.push(
      "Candidate modified the package.json test script used for verification.",
    );
  }

  const infrastructureFiles = normalizedFiles.filter(isTestInfrastructureFile);

  if (infrastructureFiles.length > 0) {
    reviewFlags.push(
      `Candidate modified test infrastructure: ${infrastructureFiles.join(
        ", ",
      )}`,
    );
  }

  const status: VerificationIntegrityStatus =
    violations.length > 0
      ? "COMPROMISED"
      : reviewFlags.length > 0
        ? "REVIEW_REQUIRED"
        : "PRESERVED";

  return {
    status,

    preserved: status === "PRESERVED",

    violations,

    reviewFlags,

    protectedChangedFiles,
  };
}
