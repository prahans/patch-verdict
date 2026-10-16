"use client";

import { useEffect, useRef, useState } from "react";
import { isGitHubBranchName } from "@/lib/github-branch-name";
import { parseGitHubIssueUrl, parseGitHubRepositoryUrl } from "@/lib/github-issue-url";

export function readBranchPage(value: unknown, issueUrl: string): { branches: string[]; nextPage: number | null } | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  try {
    if (typeof data.repositoryUrl !== "string" || parseGitHubRepositoryUrl(data.repositoryUrl).repositoryUrl.toLowerCase() !== parseGitHubIssueUrl(issueUrl).repositoryUrl.toLowerCase()) return null;
  } catch { return null; }
  if (!Array.isArray(data.branches) || data.branches.length > 30 || !data.branches.every(isGitHubBranchName) || new Set(data.branches).size !== data.branches.length ||
    !(data.nextPage === null || (Number.isInteger(data.nextPage) && (data.nextPage as number) >= 2 && (data.nextPage as number) <= 100))) return null;
  return { branches: data.branches, nextPage: data.nextPage as number | null };
}

export function BranchSelector({ issueUrl, defaultBranch, value, onChange }: {
  issueUrl: string; defaultBranch: string; value: string; onChange: (value: string) => void;
}) {
  const [branches, setBranches] = useState([defaultBranch]);
  const [nextPage, setNextPage] = useState<number | null>(1);
  const [exact, setExact] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  async function load(page?: number, exactName?: string) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ issueUrl, ...(exactName !== undefined ? { exact: exactName } : { page: String(page ?? 1) }) });
      const response = await fetch(`/api/github/branches?${query}`, { cache: "no-store", signal: controller.signal });
      const data: unknown = await response.json().catch(() => null);
      if (controller.signal.aborted || active.current !== controller) return;
      if (!response.ok) {
        setError(data && typeof data === "object" && "error" in data && typeof data.error === "string" && data.error.length < 500 ? data.error : "Branches could not be loaded. Please try again.");
        return;
      }
      const result = readBranchPage(data, issueUrl);
      if (!result || (exactName !== undefined && (result.branches.length !== 1 || result.branches[0] !== exactName))) throw new Error("Invalid branch response");
      setBranches(result.branches);
      setNextPage(result.nextPage);
      if (exactName !== undefined) onChange(result.branches[0]);
    } catch {
      if (!controller.signal.aborted) setError("Branches could not be loaded. Check the connection and try again.");
    } finally {
      if (active.current === controller) { active.current = null; setLoading(false); }
    }
  }

  const options = [...new Set([value, defaultBranch, ...branches])];
  return <div className="launch-field">
    <label htmlFor="target-branch">Target branch</label>
    <select id="target-branch" name="targetBranch" className="launch-input" value={value} onChange={(event) => onChange(event.target.value)} aria-describedby="target-branch-hint">
      {options.map((branch) => <option key={branch} value={branch}>{branch}{branch === defaultBranch ? " (default)" : ""}</option>)}
    </select>
    <p id="target-branch-hint" className="launch-hint">This mission verifies one branch at its exact starting commit. Choose the release line affected by this issue.</p>
    <div className="launch-mode-actions">
      <button className="launch-mode-switch" type="button" disabled={loading} onClick={() => void load(nextPage ?? 1)}>{loading ? "Loading branches..." : nextPage && nextPage > 1 ? "Next branch page" : "Browse branches"}</button>
    </div>
    <label htmlFor="exact-target-branch">Find an exact branch</label>
    <input id="exact-target-branch" className="launch-input" value={exact} maxLength={1024} onChange={(event) => setExact(event.target.value)} placeholder="release/2.x" spellCheck={false} autoComplete="off" />
    <button className="launch-mode-switch" type="button" disabled={loading || !isGitHubBranchName(exact)} onClick={() => void load(undefined, exact)}>Verify and select branch</button>
    {error && <p className="launch-error" role="alert">{error}</p>}
  </div>;
}
