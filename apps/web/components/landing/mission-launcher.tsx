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
import { BranchSelector } from "./branch-selector";

export function MissionLauncher() {
  const router = useRouter();
  const inFlight = useRef(false);
  const previewRequest = useRef<AbortController | null>(null);
  const [mode, setMode] = useState<"issue" | "manual">("issue");
  const [issueUrl, setIssueUrl] = useState("");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [manualIssue, setManualIssue] = useState("");
  const [reviewedRegressionJson, setReviewedRegressionJson] = useState("");
  const [preview, setPreview] = useState<ResolvedIssuePreview | null>(null);
  const [targetBranch, setTargetBranch] = useState("");
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
      setTargetBranch(resolved.defaultBranch);
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
          "The server did not return a valid mission ID. Please try again.",
        );
      }
    } catch {
      setError(
        "The connection to PatchVerdict was interrupted. Your inputs are saved here; check the connection and try again.",
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
        <h2 id="launch-title">Start verification mission</h2>
        <p>A repository. A reported bug. A verdict backed by evidence.</p>
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
                    setReviewedRegressionJson("");
                    setPreview(null);
                    setTargetBranch("");
                    setPreviewError(null);
                  }}
                  onBlur={() => void resolvePreview()}
                />
                <p id="github-issue-hint" className="launch-hint">
                  Paste a public GitHub issue. PatchVerdict will load the repository and reported bug automatically.
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
              <details className="launch-advanced">
                <summary>Advanced: use a reviewed regression test instead of AI generation</summary>
                <div className="launch-advanced-fields">
                  <div className="launch-field">
                    <label htmlFor="reviewed-regression">Reviewed regression JSON (optional)</label>
                    <textarea
                      id="reviewed-regression"
                      name="reviewedRegressionJson"
                      className="launch-input launch-textarea"
                      rows={8}
                      maxLength={42000}
                      value={reviewedRegressionJson}
                      onChange={(event) => setReviewedRegressionJson(event.target.value)}
                      placeholder={'{"path":"src/__tests__/issue-regression.test.ts","sourcePath":"src/vcon.ts","testIdentity":"...","content":"...","issueQuote":"...","assertionQuote":"...","reason":"..."}'}
                      spellCheck={false}
                    />
                    <p className="launch-hint">
                      For a manually reviewed JS/TS test. Provide the new test path, an
                      existing production source path, the exact standalone test name,
                      complete test content, an exact quote from the GitHub issue,
                      an exact assertion from your test, and why it checks that issue.
                      PatchVerdict validates the input against the canonical issue,
                      runs the exact test twice in its sandbox, and still requires review.
                      Never paste secrets. Leave blank for automatic generation.
                    </p>
                  </div>
                </div>
              </details>
              {preview && <IssuePreview issue={preview} />}
              {preview && <BranchSelector key={preview.issueUrl} issueUrl={preview.issueUrl} defaultBranch={preview.defaultBranch} value={targetBranch} onChange={setTargetBranch} />}
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
          {mode === "manual" && <details className="launch-advanced">
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
                  Auto-detected from the repository when omitted.
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
                  Optional text expected in the baseline failure. Useful for
                  confirming a specific reported symptom.
                </p>
              </div>
            </div>
          </details>}
          <button
            className="launch-submit landing-button"
            type="submit"
            disabled={running || (mode === "issue" && !preview)}
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
          AI proposes. Tools execute. Tests verify. Humans approve.
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
