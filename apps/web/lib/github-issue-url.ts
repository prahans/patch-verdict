/** Pure URL and persisted metadata validation. Safe to import in the browser. */
export type GitHubIssue = {
  url: string;
  number: number;
  title: string;
  owner: string;
  repository: string;
  body?: string;
};

const segment = "[A-Za-z0-9_-][A-Za-z0-9_.-]*";
const repositorySegment = "[A-Za-z0-9_.-]+";

export function parseGitHubRepositoryUrl(value: string) {
  const text = value.trim();
  const match = new RegExp(
    `^https://github\\.com/(${segment})/(${repositorySegment})/?$`,
    "i",
  ).exec(text);
  if (!match || /[\r\n\t]/.test(text)) {
    throw new Error(
      "Use a repository URL such as https://github.com/owner/repository, without credentials or extra parameters.",
    );
  }
  const [, owner, name] = match;
  const repository = name.replace(/\.git$/i, "");
  if (!repository || repository === "." || repository === "..")
    throw new Error("Enter a valid HTTPS GitHub repository URL.");
  return {
    owner,
    repository,
    repositoryUrl: `https://github.com/${owner}/${repository}`,
  };
}

export function parseGitHubIssueUrl(value: string) {
  const text = value.trim();
  const match = new RegExp(
    `^https://github\\.com/(${segment})/(${repositorySegment})/issues/([1-9][0-9]*)$`,
    "i",
  ).exec(text);
  if (
    !match ||
    /[\r\n\t]/.test(text) ||
    match[2] === "." || match[2] === ".." || /\.git$/i.test(match[2]) ||
    !Number.isSafeInteger(Number(match[3]))
  ) {
    throw new Error(
      "Enter an exact GitHub issue URL such as https://github.com/owner/repository/issues/12, without extra paths or parameters.",
    );
  }
  const [, owner, repository, number] = match;
  const repositoryUrl = `https://github.com/${owner}/${repository}`;
  return {
    owner,
    repository,
    repositoryUrl,
    issueNumber: Number(number),
    issueUrl: `${repositoryUrl}/issues/${number}`,
  };
}

export function parsePersistedGitHubIssue(
  value: unknown,
  repositoryUrl: string,
): GitHubIssue | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const data = value as Record<string, unknown>;
  if (
    typeof data.url !== "string" ||
    typeof data.title !== "string" ||
    !data.title.trim() ||
    data.title.length > 1024 ||
    /[\0\r\n]/.test(data.title) ||
    typeof data.owner !== "string" ||
    typeof data.repository !== "string" ||
    (data.body !== undefined &&
      (typeof data.body !== "string" ||
        data.body.length > 65536 ||
        data.body.includes("\0")))
  )
    return undefined;
  try {
    const parsed = parseGitHubIssueUrl(data.url);
    const source = parseGitHubRepositoryUrl(repositoryUrl);
    if (
      data.number !== parsed.issueNumber ||
      data.owner !== parsed.owner ||
      data.repository !== parsed.repository ||
      parsed.repositoryUrl.toLowerCase() !== source.repositoryUrl.toLowerCase()
    )
      return undefined;
    return {
      url: parsed.issueUrl,
      number: parsed.issueNumber,
      title: data.title,
      owner: parsed.owner,
      repository: parsed.repository,
      ...(typeof data.body === "string" && { body: data.body }),
    };
  } catch {
    return undefined;
  }
}
