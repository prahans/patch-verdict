"use client";

import { useRef, useState } from "react";
import { isPullRequestResult, type PullRequestResult } from "@/lib/pull-request-types";
import { Icon } from "./icon";

export function PullRequestAction({
  missionId,
  eligibility,
  initialPullRequest = null,
}: {
  missionId: string;
  eligibility: { allowed: boolean; draft: boolean; reason?: string };
  initialPullRequest?: PullRequestResult | null;
}) {
  const inFlight = useRef(false);
  const [creating, setCreating] = useState(false);
  const [pullRequest, setPullRequest] = useState(initialPullRequest);
  const [error, setError] = useState<string | null>(null);

  async function createPullRequest() {
    if (inFlight.current || pullRequest || !eligibility.allowed) return;
    // Lock synchronously, including clicks before React commits disabled state.
    inFlight.current = true;
    setCreating(true);
    setError(null);
    try {
      const response = await fetch(`/api/missions/${missionId}/pull-request`, { method: "POST" });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(result && typeof result === "object" && "error" in result &&
          typeof result.error === "string" && result.error.length <= 500
          ? result.error : "Pull request creation failed. Please try again.");
      } else if (isPullRequestResult(result)) {
        setPullRequest(result);
      } else {
        setError("The server did not return a valid pull request. Retry to recover any pull request already created.");
      }
    } catch {
      setError("The connection was interrupted. Retry to recover any pull request already created.");
    } finally {
      inFlight.current = false;
      setCreating(false);
    }
  }

  if (pullRequest) {
    return (
      <a className="action-button" href={pullRequest.url} target="_blank" rel="noopener noreferrer">
        <Icon name="branch" width="15" height="15" /> View PR #{pullRequest.number} ↗
      </a>
    );
  }
  if (!eligibility.allowed) return null;

  return (
    <div className="pull-request-action" aria-busy={creating}>
      <button className="action-button" type="button" disabled={creating} onClick={() => void createPullRequest()}>
        <Icon name={creating ? "activity" : "branch"} width="15" height="15" />
        {creating ? "Creating PR..." : eligibility.draft ? "Create draft PR" : "Create pull request"}
      </button>
      {eligibility.draft && (
        <p className="pull-request-note amber">Human review is required. This repair will be published as a draft.</p>
      )}
      {error && <p className="pull-request-error" role="alert">{error}</p>}
      <span className="sr-only" role="status" aria-live="polite">{creating ? "Creating pull request from the recorded patch..." : ""}</span>
    </div>
  );
}
