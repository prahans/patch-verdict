import { parseGitHubIssueUrl, parseGitHubRepositoryUrl, parsePersistedGitHubIssue, type GitHubIssue } from "./github-issue-url";
import { isGitHubBranchName } from "./github-branch-name";

export const BACKEND_ENVELOPE_MAX_BYTES = 64 * 1024;

export const MISSION_INPUT_LIMITS = {
  repositoryUrl: 2048,
  issue: 10000,
  reproductionCommand: 2000,
  requiredOutput: 1000,
} as const;

export type MissionInput = {
  mode?: "THIRD_PARTY_JS_TS";
  targetBranch?: string;
  baseCommit?: string;
  defaultBranch?: string;
  repositoryUrl: string;
  issue: string;
  reproductionCommand?: string;
  requiredOutput?: string;
  githubIssue?: GitHubIssue;
};

export type ParsedMissionInput = MissionInput & { reproductionCommand: string; requiredOutput: string };
export type IssueMissionInput = { mode: "issue"; issueUrl: string; targetBranch: string; reproductionCommand: string; requiredOutput: string };
export type MissionRequest = IssueMissionInput | (Omit<ParsedMissionInput, "mode"> & { mode?: "manual" });

export class MissionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissionInputError";
  }
}

export function assertGitHubIssueEnvelopeSize(githubIssue: GitHubIssue): void {
  // Bound escaped canonical metadata as well as plain-text issue content.
  if (JSON.stringify(githubIssue).length > 24000) {
    throw new MissionInputError("The GitHub issue is too large for the mission runner. Use a shorter manual bug description.");
  }
}

function field(
  value: unknown,
  label: string,
  maxLength: number,
  optional = false,
): string {
  if (optional && value === undefined) return "";
  if (typeof value !== "string") {
    throw new MissionInputError(label + " must be text.");
  }
  const normalized = value.trim();
  if (!optional && !normalized) {
    throw new MissionInputError(label + " is required.");
  }
  if (normalized.length > maxLength) {
    throw new MissionInputError(
      label + " must be " + maxLength + " characters or fewer.",
    );
  }
  // NUL cannot be represented safely in process arguments.
  if (normalized.includes("\0")) {
    throw new MissionInputError(label + " contains an unsupported character.");
  }
  return normalized;
}

export function parseMissionInput(value: unknown): MissionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MissionInputError("Send a JSON object with the mission fields.");
  }
  const data = value as Record<string, unknown>;
  const allowed = data.mode === "issue"
    ? ["mode", "issueUrl", "targetBranch", "reproductionCommand", "requiredOutput"]
    : ["mode", "repositoryUrl", "issue", "reproductionCommand", "requiredOutput"];
  if (Object.keys(data).some((key) => !allowed.includes(key))) {
    throw new MissionInputError("Send only mission input fields. Repository metadata and base commits are resolved by the server.");
  }
  if (data.mode !== undefined && data.mode !== "issue" && data.mode !== "manual") {
    throw new MissionInputError("Choose GitHub issue or manual mission input.");
  }
  const advanced = {
    reproductionCommand: field(data.reproductionCommand, "Reproduction command", MISSION_INPUT_LIMITS.reproductionCommand, true),
    requiredOutput: field(data.requiredOutput, "Required failure marker", MISSION_INPUT_LIMITS.requiredOutput, true),
  };
  if (data.mode === "issue") {
    if (!isGitHubBranchName(data.targetBranch)) throw new MissionInputError("Load the issue and select an existing target branch before starting the mission.");
    if (advanced.reproductionCommand || advanced.requiredOutput) throw new MissionInputError("Issue missions use framework-discovered target tests. Advanced overrides are available in manual mode only.");
    const issueUrl = field(data.issueUrl, "GitHub issue URL", MISSION_INPUT_LIMITS.repositoryUrl);
    try { return { mode: "issue", issueUrl: parseGitHubIssueUrl(issueUrl).issueUrl, targetBranch: data.targetBranch, ...advanced }; }
    catch { throw new MissionInputError("Enter an exact GitHub issue URL such as https://github.com/owner/repository/issues/12, without extra paths or parameters."); }
  }
  const repositoryUrl = field(
    data.repositoryUrl,
    "GitHub repository URL",
    MISSION_INPUT_LIMITS.repositoryUrl,
  );
  let repository: ReturnType<typeof parseGitHubRepositoryUrl>;
  try {
    repository = parseGitHubRepositoryUrl(repositoryUrl);
  } catch {
    throw new MissionInputError("Enter a valid HTTPS GitHub repository URL.");
  }
  const issue = field(
    data.issue,
    "Bug description",
    MISSION_INPUT_LIMITS.issue,
  );

  if (issue.length < 20) {
    throw new MissionInputError(
      "Bug description must be at least 20 characters. Describe what is broken and what should happen instead.",
    );
  }

  return {
    ...(data.mode === "manual" && { mode: "manual" as const }),
    repositoryUrl: repository.repositoryUrl,
    issue,
    ...advanced,
  };
}

/** Internal backend boundary; browser input must first use resolveMissionInput. */
export function parseBackendMissionInput(value: MissionInput): ParsedMissionInput {
  const strict = value.mode === "THIRD_PARTY_JS_TS";
  if (value.mode !== undefined && !strict) throw new MissionInputError("The canonical mission mode is invalid.");
  if (strict && (!value.githubIssue || !isGitHubBranchName(value.targetBranch) || !isGitHubBranchName(value.defaultBranch) || !/^[a-f0-9]{40}$/.test(value.baseCommit ?? ""))) {
    throw new MissionInputError("Resolve the GitHub issue and target branch before starting verification.");
  }
  if (strict && (value.reproductionCommand?.trim() || value.requiredOutput?.trim())) throw new MissionInputError("Issue missions cannot override target verification commands.");
  if (!strict && [value.targetBranch, value.baseCommit, value.defaultBranch].some((field) => field !== undefined)) throw new MissionInputError("Legacy missions cannot supply canonical branch metadata.");
  if (!value.githubIssue) {
    const parsed = parseMissionInput(value);
    if (parsed.mode === "issue") throw new MissionInputError("Resolve the GitHub issue before starting verification.");
    const { repositoryUrl, issue, reproductionCommand, requiredOutput } = parsed;
    return { repositoryUrl, issue, reproductionCommand, requiredOutput };
  }
  const githubIssue = parsePersistedGitHubIssue(value.githubIssue, value.repositoryUrl);
  if (!githubIssue) throw new MissionInputError("The resolved GitHub issue is invalid.");
  assertGitHubIssueEnvelopeSize(githubIssue);
  const issue = githubIssue.body ? `${githubIssue.title}\n\n${githubIssue.body}` : githubIssue.title;
  if (value.issue !== issue) throw new MissionInputError("The resolved GitHub issue context does not match its source.");
  return {
    ...(strict && { mode: "THIRD_PARTY_JS_TS" as const, targetBranch: value.targetBranch, baseCommit: value.baseCommit, defaultBranch: value.defaultBranch }),
    repositoryUrl: parseGitHubRepositoryUrl(value.repositoryUrl).repositoryUrl,
    issue: field(issue, "GitHub issue", MISSION_INPUT_LIMITS.issue), githubIssue,
    reproductionCommand: field(value.reproductionCommand, "Reproduction command", MISSION_INPUT_LIMITS.reproductionCommand, true),
    requiredOutput: field(value.requiredOutput, "Required failure marker", MISSION_INPUT_LIMITS.requiredOutput, true),
  };
}

export function serializeBackendMissionInput(value: ParsedMissionInput): string {
  const envelope = JSON.stringify({ version: 1, ...value, mode: value.mode ?? "LEGACY" });
  if (new TextEncoder().encode(envelope).byteLength > BACKEND_ENVELOPE_MAX_BYTES) throw new MissionInputError("The canonical mission input is too large for the mission runner.");
  return envelope;
}
