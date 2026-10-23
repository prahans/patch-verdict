"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/mission/icon";
import {
  MISSION_INPUT_LIMITS,
  parseMissionInput,
  MissionInputError,
} from "@/lib/mission-input";
import { parseGitHubIssueUrl } from "@/lib/github-issue-url";
import { IssuePreview, readIssuePreview, type ResolvedIssuePreview } from "./issue-preview";

export function MissionLauncher() {
  const router = useRouter();
  const inFlight = useRef(false);
  const previewRequest = useRef<AbortController | null>(null);
  const [mode, setMode] = useState<"issue" | "manual">("issue");
  const [issueUrl, setIssueUrl] = useState("");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [manualIssue, setManualIssue] = useState("");
  const [preview, setPreview] = useState<ResolvedIssuePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => previewRequest.current?.abort(), []);

  function switchMode(next: "issue" | "manual") {
    previewRequest.current?.abort();
    previewRequest.current = null;
    setPreviewLoading(false);
    setPreviewError(null);
    setError(null);
    setMode(next);
  }

  async function resolvePreview() {
    if (!issueUrl.trim()) return;
    let requestedUrl: string;
    try {
      requestedUrl = parseGitHubIssueUrl(issueUrl).issueUrl;
    } catch {
      setPreviewError("Enter a GitHub issue URL such as https://github.com/owner/repo/issues/12, without extra paths or parameters.");
      return;
    }
    if (preview?.issueUrl === requestedUrl) return;
    previewRequest.current?.abort();
    const request = new AbortController();
    previewRequest.current = request;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const response = await fetch(`/api/github/issue?url=${encodeURIComponent(requestedUrl)}`, {
        cache: "no-store",
        signal: request.signal,
      });
      const value: unknown = await response.json().catch(() => null);
      if (request.signal.aborted || previewRequest.current !== request) return;
      if (!response.ok) {
        setPreviewError(readSafeError(value, "The GitHub issue could not be loaded. Please try again."));
        return;
      }
      const resolved = readIssuePreview(value, requestedUrl);
      if (!resolved) {
        setPreviewError("The server returned an invalid issue preview. Please try again.");
        return;
      }
      setPreview(resolved);
    } catch {
      if (!request.signal.aborted)
        setPreviewError("The GitHub issue could not be loaded. Check the connection and try again.");
    } finally {
      if (previewRequest.current === request) {
        previewRequest.current = null;
        setPreviewLoading(false);
      }
    }
  }

  async function submitMission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const fields = new FormData(event.currentTarget);
    setError(null);

    let input;
    try {
      input = { ...parseMissionInput({ ...Object.fromEntries(fields), mode }), mode };
    } catch (error) {
      setError(
        error instanceof MissionInputError
          ? error.message
          : "Check the mission fields and try again.",
      );
      return;
    }

    // A ref closes the gap before React renders the disabled controls.
    inFlight.current = true;
    setRunning(true);
    try {
      const response = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(readSafeError(result, "Verification could not start. Please try again."));
      } else if (
        result &&
        typeof result === "object" &&
        "missionId" in result &&
        typeof result.missionId === "string" &&
        /^[A-Za-z0-9_-]+$/.test(result.missionId)
      ) {
        router.push("/missions/" + result.missionId);
        // Keep the form locked until live Mission Control replaces it.
        return;
      } else {
        setError(
          "The server did not return a valid mission ID. Check Recorded Mission History before starting another mission.",
        );
      }
    } catch {
      setError(
        "The connection to PatchVerdict was interrupted. Your inputs remain in this form. Check Recorded Mission History before starting another mission.",
      );
    }
    inFlight.current = false;
    setRunning(false);
  }

  return (
    <section
      id="verify"
      className="launch-panel"
      aria-labelledby="launch-title"
      tabIndex={-1}
    >
      <div className="launch-panel-header">
        <p className="eyebrow amber">
          <Icon name="terminal" width="14" height="14" /> MISSION INPUT
        </p>
        <h2 id="launch-title">Start a verification mission</h2>
        <p>For public JavaScript/TypeScript repositories with a root package.json, a test script, and a matching npm or pnpm lockfile.</p>
      </div>
      <form
        className="launch-form"
        onSubmit={submitMission}
        aria-busy={running}
      >
        <fieldset disabled={running} className="launch-fields">
          {mode === "issue" ? (
            <>
              <div className="launch-field">
                <label htmlFor="issue-url">GitHub issue URL</label>
                <input
                  id="issue-url"
                  name="issueUrl"
                  className="launch-input"
                  type="url"
                  required
                  maxLength={MISSION_INPUT_LIMITS.repositoryUrl}
                  placeholder="https://github.com/owner/repo/issues/12"
                  autoComplete="url"
                  spellCheck={false}
                  aria-describedby="github-issue-hint"
                  value={issueUrl}
                  onChange={(event) => {
                    previewRequest.current?.abort();
                    previewRequest.current = null;
                    setPreviewLoading(false);
                    setIssueUrl(event.target.value);
                    setPreview(null);
                    setPreviewError(null);
                  }}
                  onBlur={() => void resolvePreview()}
                />
                <p id="github-issue-hint" className="launch-hint">
                  Paste a public GitHub issue URL to load its repository, title, and description. The issue is fetched again when you submit.
                </p>
                <div className="launch-mode-actions">
                  <button className="launch-mode-switch" type="button" onClick={() => void resolvePreview()} disabled={previewLoading || !issueUrl.trim()}>
                    {previewLoading ? "Loading issue..." : "Load issue preview"}
                  </button>
                  <button className="launch-mode-switch" type="button" onClick={() => switchMode("manual")}>
                    No GitHub issue? Use a repository and manual bug description →
                  </button>
                </div>
              </div>
              {preview && <IssuePreview issue={preview} />}
              {previewError && <p className="launch-error" role="alert">{previewError}</p>}
              <span className="sr-only" role="status" aria-live="polite">{previewLoading ? "Loading GitHub issue preview..." : ""}</span>
            </>
          ) : (
            <>
              <button className="launch-mode-switch" type="button" onClick={() => switchMode("issue")}>
                ← Use a GitHub issue instead
              </button>
          <div className="launch-field">
            <label htmlFor="repository-url">GitHub repository URL</label>
            <input
              id="repository-url"
              name="repositoryUrl"
              className="launch-input"
              type="url"
              required
              maxLength={MISSION_INPUT_LIMITS.repositoryUrl}
              placeholder="https://github.com/owner/repository"
              autoComplete="url"
              spellCheck={false}
              value={repositoryUrl}
              onChange={(event) => setRepositoryUrl(event.target.value)}
            />
          </div>
          <div className="launch-field">
            <label htmlFor="issue">Bug description</label>

            <textarea
              id="issue"
              name="issue"
              className="launch-input launch-textarea"
              required
              minLength={20}
              maxLength={MISSION_INPUT_LIMITS.issue}
              placeholder="Describe what is broken and what should happen instead..."
              rows={3}
              aria-describedby="issue-hint"
              value={manualIssue}
              onChange={(event) => setManualIssue(event.target.value)}
            />

            <p id="issue-hint" className="launch-hint">
              Describe the observed problem and the expected behavior. Minimum
              20 characters.
            </p>
          </div>
            </>
          )}
          <details className="launch-advanced">
            <summary>Advanced verification settings</summary>
            <div className="launch-advanced-fields">
              <div className="launch-field">
                <label htmlFor="reproduction-command">
                  Reproduction command{" "}
                  <span className="text-muted">(optional)</span>
                </label>
                <input
                  id="reproduction-command"
                  name="reproductionCommand"
                  className="launch-input"
                  maxLength={MISSION_INPUT_LIMITS.reproductionCommand}
                  placeholder="npm test"
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby="command-hint"
                />
                <p id="command-hint" className="launch-hint">
                  Defaults to npm test or pnpm test. The baseline must exit with code 1, and the same command must pass after repair.
                </p>
              </div>
              <div className="launch-field">
                <label htmlFor="required-output">
                  Required failure marker{" "}
                  <span className="text-muted">(optional)</span>
                </label>
                <input
                  id="required-output"
                  name="requiredOutput"
                  className="launch-input"
                  maxLength={MISSION_INPUT_LIMITS.requiredOutput}
                  placeholder="Found multiple elements"
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby="marker-hint"
                />
                <p id="marker-hint" className="launch-hint">
                  Literal, case-sensitive text required in the baseline output.
                  Choose a distinctive symptom; a match alone does not prove its cause.
                </p>
              </div>
            </div>
          </details>
          <button
            className="launch-submit landing-button"
            type="submit"
            disabled={running}
          >
            <Icon
              name={running ? "activity" : "shield"}
              width="16"
              height="16"
            />
            {running ? "Starting mission..." : "Run verification"}
          </button>
        </fieldset>
        {error && (
          <p className="launch-error" role="alert">
            {error}
          </p>
        )}
        <p className="launch-status" role="status" aria-live="polite">
          {running
            ? "Starting your mission. Opening live Mission Control..."
            : ""}
        </p>
        <p className="launch-footnote">
          AI proposes. Tools execute. Evidence informs review.
        </p>
      </form>
    </section>
  );
}

function readSafeError(value: unknown, fallback: string): string {
  return value && typeof value === "object" && "error" in value &&
    typeof value.error === "string" && value.error.length <= 500
    ? value.error : fallback;
}
