export const MISSION_INPUT_LIMITS = {
  repositoryUrl: 2048,
  issue: 10000,
  reproductionCommand: 2000,
  requiredOutput: 1000,
} as const;

export type MissionInput = {
  repositoryUrl: string;
  issue: string;
  reproductionCommand: string;
  requiredOutput: string;
};

export class MissionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissionInputError";
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
    throw new MissionInputError(label + " must be " + maxLength + " characters or fewer.");
  }
  // NUL cannot be represented safely in process arguments.
  if (normalized.includes("\0")) {
    throw new MissionInputError(label + " contains an unsupported character.");
  }
  return normalized;
}

export function parseMissionInput(value: unknown): MissionInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MissionInputError("Send a JSON object with the mission fields.");
  }
  const data = value as Record<string, unknown>;
  const repositoryUrl = field(data.repositoryUrl, "GitHub repository URL", MISSION_INPUT_LIMITS.repositoryUrl);
  let repository: URL;
  try {
    repository = new URL(repositoryUrl);
  } catch {
    throw new MissionInputError("Enter a valid HTTPS GitHub repository URL.");
  }
  if (
    repository.protocol !== "https:" ||
    repository.hostname !== "github.com" ||
    repository.username || repository.password || repository.port ||
    repository.search || repository.hash ||
    !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(repository.pathname)
  ) {
    throw new MissionInputError("Use a repository URL such as https://github.com/owner/repository, without credentials or extra parameters.");
  }
  return {
    repositoryUrl: repository.href.replace(/\/$/, ""),
    issue: field(data.issue, "Bug description", MISSION_INPUT_LIMITS.issue),
    reproductionCommand: field(data.reproductionCommand, "Reproduction command", MISSION_INPUT_LIMITS.reproductionCommand),
    requiredOutput: field(data.requiredOutput, "Required failure marker", MISSION_INPUT_LIMITS.requiredOutput, true),
  };
}
