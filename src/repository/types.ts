export type PackageManager = "npm" | "pnpm";

export type TestFramework = "vitest" | "jest" | "unknown";

export type RepositoryRequest = {
  repositoryUrl: string;

  /**
   * Branch, tag, or commit requested by the user.
   *
   * If omitted, PatchVerdict will use the repository's
   * default branch HEAD and record the exact commit SHA.
   */
  ref?: string;
};

export type ProjectProfile = {
  packageManager: PackageManager;

  testFramework: TestFramework;

  /**
   * Deterministic command owned by PatchVerdict.
   *
   * Examples:
   *   npm ci
   *   pnpm install --frozen-lockfile
   */
  installCommand: string;

  /**
   * Repository-level verification command.
   *
   * Examples:
   *   npm test
   *   pnpm test
   */
  fullSuiteCommand: string;
};

export type PreparedRepository = {
  repositoryUrl: string;

  /**
   * The branch/tag/SHA requested by the caller,
   * if one was supplied.
   */
  requestedRef?: string;

  /**
   * Exact immutable Git commit PatchVerdict checked out.
   *
   * This is the repository truth we will put into
   * the Proof Bundle.
   */
  baseCommit: string;

  /**
   * Absolute path inside the sandbox.
   *
   * Currently:
   * /tmp/patchverdict
   */
  projectRoot: string;

  project: ProjectProfile;
};

export type RepositoryCheckout = {
  repositoryUrl: string;

  requestedRef?: string;

  baseCommit: string;

  projectRoot: string;
};
