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

type DiffSection = {
  oldPath: string;
  newPath: string;
  lines: string[];
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

function isTestSupportFile(filePath: string) {
  const normalized = normalizePath(filePath);

  return (
    /(^|\/)(?:test|testing)[-_]?utils?\.[^/]+$/i.test(normalized) ||
    /(^|\/)(?:test|testing)[-_]?(?:helpers?|support)\.[^/]+$/i.test(
      normalized,
    ) ||
    /(^|\/)(?:test|testing)[-_]?utils?(\/|$)/i.test(normalized)
  );
}

function isTestInfrastructureFile(filePath: string) {
  const normalized = normalizePath(filePath);

  return (
    /(^|\/)(vite|vitest|jest|playwright|cypress)\.config\.[^/]+$/i.test(
      normalized,
    ) ||
    /(^|\/)(vitest|jest)\.setup\.[^/]+$/i.test(normalized) ||
    /(^|\/)setupTests\.[^/]+$/i.test(normalized)
  );
}

export type VerificationPathRole =
  | "TEST_FILE"
  | "TEST_SUPPORT"
  | "TEST_INFRASTRUCTURE"
  | "OTHER";

export function classifyVerificationPath(
  filePath: string,
): VerificationPathRole {
  if (isDirectTestFile(filePath)) {
    return "TEST_FILE";
  }

  if (isTestSupportFile(filePath)) {
    return "TEST_SUPPORT";
  }

  if (isTestInfrastructureFile(filePath)) {
    return "TEST_INFRASTRUCTURE";
  }

  return "OTHER";
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

function parseDiffSections(diff: string): DiffSection[] {
  const sections: DiffSection[] = [];

  let current: DiffSection | undefined;

  for (const line of diff.split(/\r?\n/)) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);

    if (match) {
      const oldPath = match[1];
      const newPath = match[2];

      if (!oldPath || !newPath) {
        continue;
      }

      current = {
        oldPath: normalizePath(oldPath),
        newPath: normalizePath(newPath),
        lines: [],
      };

      sections.push(current);

      continue;
    }

    current?.lines.push(line);
  }

  return sections;
}

function addedLines(section: DiffSection) {
  return section.lines.filter(
    (line) => line.startsWith("+") && !line.startsWith("+++"),
  );
}

function removedLines(section: DiffSection) {
  return section.lines.filter(
    (line) => line.startsWith("-") && !line.startsWith("---"),
  );
}

function isActiveAssertion(line: string) {
  const trimmed = line.trim();

  if (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*")
  ) {
    return false;
  }

  return /\bexpect(?:\.[A-Za-z_$][\w$]*)?\s*\(/.test(trimmed);
}

function hasSpecificMatcher(line: string) {
  return /\.(?:toBe|toEqual|toStrictEqual|toThrow|toThrowError|toMatch|toMatchObject|toContain|toContainEqual|toHaveLength|toHaveProperty|toBeNull|toBeUndefined|toHaveTextContent|toHaveValue|toHaveBeenCalled|toHaveBeenCalledWith|toHaveBeenCalledTimes)\s*\(/.test(
    line,
  );
}

function hasWeakMatcher(line: string) {
  return /\.(?:toBeDefined|toBeTruthy|toBeFalsy)\s*\(/.test(line);
}

function findAssertionIntegrityViolations(section: DiffSection) {
  if (
    !isDirectTestFile(section.oldPath) &&
    !isDirectTestFile(section.newPath)
  ) {
    return [];
  }

  const removedAssertions = removedLines(section)
    .map((line) => line.slice(1))
    .filter(isActiveAssertion);

  const addedAssertions = addedLines(section)
    .map((line) => line.slice(1))
    .filter(isActiveAssertion);

  const violations: string[] = [];

  /*
   * Example:
   *
   * - expect(value).toBe(5);
   *
   * with no replacement assertion.
   */
  if (removedAssertions.length > addedAssertions.length) {
    violations.push(`Candidate removed assertion(s) from ${section.newPath}.`);
  }

  /*
   * Example:
   *
   * - expect(value).toBe(5);
   * + expect(value).toBeDefined();
   */
  const removedSpecificAssertion = removedAssertions.some(hasSpecificMatcher);

  const addedWeakAssertion = addedAssertions.some(hasWeakMatcher);

  if (removedSpecificAssertion && addedWeakAssertion) {
    violations.push(`Candidate weakened assertion(s) in ${section.newPath}.`);
  }

  return violations;
}

function introducesSkippedOrFocusedTest(section: DiffSection) {
  if (
    !isDirectTestFile(section.oldPath) &&
    !isDirectTestFile(section.newPath)
  ) {
    return false;
  }

  return addedLines(section).some(
    (line) =>
      /\b(?:describe|it|test)(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*\.\s*(?:skip|only)\s*\(/.test(
        line,
      ) || /\b(?:xdescribe|xit|xtest)\s*\(/.test(line),
  );
}

function deletesProtectedTest(section: DiffSection) {
  return (
    isDirectTestFile(section.oldPath) &&
    section.lines.some(
      (line) =>
        line === "+++ /dev/null" || line.startsWith("deleted file mode "),
    )
  );
}

function renamesTestOutOfDiscovery(section: DiffSection) {
  const renameFrom = section.lines
    .find((line) => line.startsWith("rename from "))
    ?.slice("rename from ".length);

  const renameTo = section.lines
    .find((line) => line.startsWith("rename to "))
    ?.slice("rename to ".length);

  if (!renameFrom || !renameTo) {
    return false;
  }

  return isDirectTestFile(renameFrom) && !isDirectTestFile(renameTo);
}

function changesTestDiscovery(section: DiffSection) {
  if (
    !isTestInfrastructureFile(section.newPath) &&
    !isTestInfrastructureFile(section.oldPath)
  ) {
    return false;
  }

  return addedLines(section).some((line) =>
    /\b(?:include|exclude|testMatch|testRegex|testPathIgnorePatterns|passWithNoTests)\b\s*[:=]/i.test(
      line,
    ),
  );
}

export function analyzeVerificationIntegrity({
  changedFiles,
  diff,
}: AnalyzeVerificationIntegrityInput): VerificationIntegrity {
  const normalizedFiles = changedFiles.map(normalizePath);

  const protectedChangedFiles = normalizedFiles.filter(isDirectTestFile);

  const violations: string[] = [];

  const reviewFlags: string[] = [];

  const diffSections = parseDiffSections(diff);

  if (protectedChangedFiles.length > 0) {
    reviewFlags.push(
      `Candidate modified protected test file(s): ${protectedChangedFiles.join(
        ", ",
      )}`,
    );
  }

  for (const section of diffSections) {
    if (introducesSkippedOrFocusedTest(section)) {
      violations.push(
        `Candidate introduced a focused or skipped test in ${section.newPath}.`,
      );
    }

    if (deletesProtectedTest(section)) {
      violations.push(
        `Candidate deleted protected test file: ${section.oldPath}.`,
      );
    }

    if (renamesTestOutOfDiscovery(section)) {
      violations.push(
        `Candidate renamed a protected test so it may no longer be discovered: ${section.oldPath}.`,
      );
    }

    if (changesTestDiscovery(section)) {
      violations.push(
        `Candidate modified test discovery configuration in ${section.newPath}.`,
      );
    }

    const assertionViolations = findAssertionIntegrityViolations(section);

    violations.push(...assertionViolations);
  }

  if (modifiesPackageTestScript(diff)) {
    violations.push(
      "Candidate modified the package.json test script used for verification.",
    );
  }

  const supportFiles = normalizedFiles.filter(isTestSupportFile);

  if (supportFiles.length > 0) {
    reviewFlags.push(
      `Candidate modified test support code: ${supportFiles.join(", ")}`,
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
