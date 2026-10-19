export type PackageManager = "npm" | "pnpm";

export type TestFramework = "vitest" | "jest" | "unknown";

export type RepositoryRequest = {
  repositoryUrl: string;

  mode?: "THIRD_PARTY_JS_TS";
  /** Human-selected branch metadata; never used as shell checkout input. */
  targetBranch?: string;
  /** Server-resolved immutable checkout authority for strict missions. */
  expectedCommit?: string;

  /**
   * Branch, tag, or commit requested by the user.
   *
   * If omitted, PatchVerdict will use the repository's
   * default branch HEAD and record the exact commit SHA.
   */
  ref?: string;
};

export type ProjectRuntime = {
  nodeVersion: string;
  npmVersion: string;
  source: "PATCHVERDICT_PINNED_NODE_22";
};

export type ProjectProfile = {
  languageFamily?: "javascript-typescript";
  projectKind?: "single-package";
  targetBranch?: string;
  baseCommit?: string;
  protectedPaths?: string[];
  runtime?: ProjectRuntime;
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
  mode?: "THIRD_PARTY_JS_TS";
  targetBranch?: string;

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
  mode?: "THIRD_PARTY_JS_TS";
  targetBranch?: string;

  requestedRef?: string;

  baseCommit: string;

  projectRoot: string;
};
