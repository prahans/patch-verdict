import { parseGitHubIssueUrl } from "@/lib/github-issue-url";

export type ResolvedIssuePreview = {
  owner: string;
  repository: string;
  issueNumber: number;
  title: string;
  bodyPreview: string;
  issueUrl: string;
};

export function readIssuePreview(value: unknown, requestedUrl: string): ResolvedIssuePreview | null {
  if (!value || typeof value !== "object") return null;
  const issue = value as Record<string, unknown>;
  if (typeof issue.issueUrl !== "string" || issue.issueUrl !== requestedUrl ||
    typeof issue.title !== "string" || !issue.title.trim() || issue.title.length > 1024 ||
    typeof issue.bodyPreview !== "string" || issue.bodyPreview.length > 2000) return null;
  try {
    const parsed = parseGitHubIssueUrl(issue.issueUrl);
    if (parsed.owner !== issue.owner || parsed.repository !== issue.repository || parsed.issueNumber !== issue.issueNumber) return null;
  } catch { return null; }
  return issue as ResolvedIssuePreview;
}

export function IssuePreview({ issue }: { issue: ResolvedIssuePreview }) {
  return (
    <section className="issue-preview" aria-label="Loaded GitHub issue" aria-live="polite">
      <p className="eyebrow amber">ISSUE LOADED</p>
      <p className="issue-preview-origin">{issue.owner}/{issue.repository} · #{issue.issueNumber}</p>
      <h3>{issue.title}</h3>
      <p className="issue-preview-body">{issue.bodyPreview || "This issue has no description. Its title will be used as the bug report."}</p>
    </section>
  );
}
