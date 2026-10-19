"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { MissionLiveStatus } from "@/lib/mission-live-types";
import {
  buildLiveProofChain,
  type LiveProofState,
} from "@/lib/live-proof-chain";
import { MissionHeader } from "./mission-header";
import { GitHubIssueBody } from "./github-issue-body";
import { FlightRecorder } from "./flight-recorder";
import { Icon } from "./icon";
import { parsePersistedGitHubIssue } from "@/lib/github-issue-url";

const phaseCopy = {
  PREPARING: "Preparing isolated repository…",
  BASELINE: "Reproducing the reported failure…",
  INVESTIGATING: "AI is inspecting repository evidence…",
  PATCHING: "Producing a bounded candidate patch…",
  VERIFYING: "Running trusted verification…",
  VERDICT: "Calculating deterministic verdict…",
  COMPLETED: "Recording the proof bundle…",
  FAILED: "Recording available proof after the backend reported a failure…",
} as const;

const proofIcons: Record<
  LiveProofState,
  "minus" | "activity" | "check" | "warning" | "x"
> = {
  WAITING: "minus",
  RUNNING: "activity",
  PASSED: "check",
  REVIEW: "warning",
  FAILED: "x",
};

function isStatusResponse(
  value: unknown,
  missionId: string,
): value is MissionLiveStatus {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.githubIssue !== undefined) {
    try {
      if (!parsePersistedGitHubIssue(candidate.githubIssue, String(candidate.repositoryUrl))) return false;
    } catch { return false; }
  }
  return (
    candidate.missionId === missionId &&
    ["QUEUED", "RUNNING", "COMPLETED", "FAILED"].includes(
      String(candidate.status),
    ) &&
    typeof candidate.phase === "string" &&
    Object.hasOwn(phaseCopy, candidate.phase) &&
    typeof candidate.proofReady === "boolean" &&
    typeof candidate.message === "string" &&
    typeof candidate.repositoryUrl === "string" &&
    typeof candidate.issue === "string" &&
    typeof candidate.updatedAt === "string" &&
    Number.isFinite(Date.parse(candidate.updatedAt)) &&
    (candidate.error === undefined || typeof candidate.error === "string") &&
    Array.isArray(candidate.events) &&
    candidate.events.every((event: unknown) => {
      if (!event || typeof event !== "object") return false;
      const row = event as Record<string, unknown>;
      return (
        typeof row.state === "string" &&
        Object.hasOwn(phaseCopy, row.state) &&
        typeof row.message === "string" &&
        typeof row.timestamp === "string" &&
        Number.isFinite(Date.parse(row.timestamp))
      );
    })
  );
}

export function LiveMission({
  initialStatus,
}: {
  initialStatus: MissionLiveStatus;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [pollError, setPollError] = useState<string | null>(null);
  const [timingNoticeDismissed, setTimingNoticeDismissed] = useState(false);
  const missionId = initialStatus.missionId;

  useEffect(() => {
    let stopped = false;
    let nextPoll: ReturnType<typeof setTimeout> | undefined;
    let requestTimer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;

    if (initialStatus.proofReady) {
      router.refresh();
      return;
    }
    if (initialStatus.status === "FAILED") return;

    async function poll() {
      if (stopped) return;
      request = new AbortController();
      requestTimer = setTimeout(() => request?.abort(), 15000);
      let keepPolling = true;
      try {
        const response = await fetch(`/api/missions/${missionId}/status`, {
          cache: "no-store",
          signal: request.signal,
        });
        if (stopped) return;
        if (response.status === 404 || response.status === 400) {
          setPollError(
            "Live mission status is unavailable. Reload this page to check for saved proof.",
          );
          keepPolling = false;
          return;
        }
        if (!response.ok) throw new Error("Status request failed");
        const next: unknown = await response.json();
        if (stopped) return;
        if (!isStatusResponse(next, missionId))
          throw new Error("Invalid status response");
        setStatus(next);
        setPollError(null);
        if (next.proofReady) {
          keepPolling = false;
          router.refresh();
        } else if (next.status === "FAILED") {
          keepPolling = false;
        }
      } catch {
        if (!stopped)
          setPollError(
            "Live updates are temporarily unavailable. Retrying; the last saved evidence remains visible.",
          );
      } finally {
        clearTimeout(requestTimer);
        // Schedule only after the previous request settles: polls never overlap.
        if (!stopped && keepPolling) nextPoll = setTimeout(poll, 1000);
      }
    }

    nextPoll = setTimeout(poll, 1000);
    return () => {
      stopped = true;
      clearTimeout(nextPoll);
      clearTimeout(requestTimer);
      request?.abort();
    };
  }, [initialStatus.proofReady, initialStatus.status, missionId, router]);

  const failed = status.status === "FAILED" && !status.proofReady;
  const active =
    (status.status === "QUEUED" || status.status === "RUNNING") &&
    !status.proofReady &&
    status.phase !== "COMPLETED" &&
    status.phase !== "FAILED";
  const chain = buildLiveProofChain(status);

  return (
    <>
      <a className="skip-link" href="#mission">
        Skip to mission
      </a>
      <MissionHeader
        verdict={null}
        executionStatus={
          failed ? "FAILED" : status.proofReady ? "RECORDED" : "RUNNING"
        }
      />
      <main id="mission" className="mission-shell live-mission">
        <div className="workspace-bar">
          <div className="flex items-center gap-3">
            <Icon name="terminal" />
            <span>Mission control</span>
            <span className="text-muted" aria-hidden="true">
              /
            </span>
            <span className="font-mono text-muted">{missionId}</span>
          </div>
          <span className="bundle-label">
            <span className="status-dot" />
            Live mission
          </span>
        </div>
        <section className="live-summary" aria-labelledby="live-title">
          <p className={`eyebrow ${failed ? "is-failed" : "amber"}`}>
            {failed
              ? "REAL EXECUTION / RECORDED FAILURE"
              : status.proofReady
                ? "REAL EXECUTION / SAVED EVIDENCE"
                : "REAL EXECUTION / LIVE EVIDENCE"}
          </p>
          <h1 id="live-title">
            {status.githubIssue?.title ?? (failed
              ? "MISSION EXECUTION FAILED"
              : status.proofReady
                ? "PROOF BUNDLE RECORDED"
                : "MISSION IN PROGRESS")}
          </h1>
          {status.githubIssue ? (
            <GitHubIssueBody
              body={status.githubIssue.body ?? status.issue.split(/\r?\n/).slice(1).join("\n").trim()}
            />
          ) : (
            <p className="live-summary-copy">
              {failed
                ? "The backend stopped before it could record a usable proof bundle."
                : status.proofReady
                  ? "Opening the saved proof dashboard…"
                  : "PatchVerdict is building the evidence chain."}
            </p>
          )}
          {status.githubIssue ? (
            <div className="mission-origin-list" aria-label="Mission source">
              <div className="mission-origin-item">
                <Icon name="branch" width="14" height="14" />
                <span className="repository-label">Repository</span>
                <a href={status.repositoryUrl} target="_blank" rel="noopener noreferrer">
                  {status.repositoryUrl}<span className="external-link-mark" aria-hidden="true"> ↗</span>
                </a>
              </div>
              <div className="mission-origin-item">
                <Icon name="file" width="14" height="14" />
                <span className="repository-label">Issue</span>
                <a href={status.githubIssue.url} target="_blank" rel="noopener noreferrer">
                  #{status.githubIssue.number} · View original issue
                  <span className="external-link-mark" aria-hidden="true"> ↗</span>
                </a>
              </div>
            </div>
          ) : (
            <dl className="live-mission-facts">
              <div>
                <dt>Repository</dt>
                <dd className="live-repository">
                  <Icon name="branch" width="14" height="14" />
                  <span>{status.repositoryUrl}</span>
                </dd>
              </div>
              <div>
                <dt>Reported issue</dt>
                <dd className="live-reported-issue">{status.issue}</dd>
              </div>
            </dl>
          )}
          <div
            className={`live-phase ${failed ? "is-failed" : "amber"}`}
            role="status"
            aria-live="polite"
          >
            <span className={`status-dot ${active ? "live-pulse" : ""}`} />
            <div>
              <span className="live-phase-label">
                {failed
                  ? "EXECUTION FAILED"
                  : status.proofReady
                    ? "PROOF RECORDED"
                    : status.phase}
              </span>
              <p>
                {failed
                  ? (status.error ??
                    "The mission could not finish. Start a new mission to try again.")
                  : status.proofReady
                    ? "Proof bundle recorded. Loading its evidence…"
                    : phaseCopy[status.phase]}
                {active && (
                  <span className="live-terminal-cursor" aria-hidden="true" />
                )}
              </p>
            </div>
          </div>
        </section>
        {active && !timingNoticeDismissed && (
          <aside className="panel live-mission-notice" role="status">
            <Icon name="activity" />
            <div>
              <p className="live-mission-notice-title">
                Verification mission is running
              </p>

              <p>
                PatchVerdict is reproducing the bug, investigating evidence,
                applying a candidate repair, and rerunning trusted tests. This
                may take a few minutes.
              </p>
            </div>
            <button
              className="live-mission-notice-close"
              type="button"
              aria-label="Dismiss mission timing notice"
              onClick={() => setTimingNoticeDismissed(true)}
            >
              <Icon name="x" width="16" height="16" />
            </button>
          </aside>
        )}
        {pollError && (
          <aside className="panel live-poll-notice" role="status">
            <Icon name="warning" />
            <p>{pollError}</p>
            <button
              className="action-button"
              type="button"
              onClick={() => router.refresh()}
            >
              Reload status
            </button>
          </aside>
        )}
        <div className="section-divider">
          <span>LIVE MISSION RECORD</span>
          <span className="section-divider-line" />
          <span>EVENTS / EVIDENCE / VERDICT</span>
        </div>
        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="live-flight">
            <FlightRecorder
              events={status.events}
              live
              activePhase={active ? status.phase : undefined}
            />
          </div>
          <section
            className="panel live-proof-panel"
            aria-labelledby="live-proof-title"
          >
            <div className="panel-header">
              <div className="panel-heading">
                <Icon name="shield" />
                <h2 id="live-proof-title">Proof Chain</h2>
              </div>
              <span className="panel-meta">EVIDENCE DRIVEN</span>
            </div>
            <ol className="live-proof-list">
              {chain.map((step, index) => (
                <li
                  className={`live-proof-step live-check-${step.state.toLowerCase()}`}
                  key={step.id}
                >
                  <span
                    className={`live-proof-icon ${step.state === "RUNNING" && active ? "live-pulse" : ""}`}
                  >
                    <Icon
                      name={proofIcons[step.state]}
                      width="13"
                      height="13"
                    />
                  </span>
                  <div>
                    <span className="live-proof-label">{step.label}</span>
                    <span className="live-proof-state">
                      {step.detail ?? step.state}
                    </span>
                  </div>
                  <span className="proof-index">0{index + 1}</span>
                </li>
              ))}
            </ol>
            <div className="panel-footer">
              Checks change only when backend evidence is recorded.
            </div>
          </section>
        </div>
        <footer className="mission-footer">
          <p>
            <span className="footer-mark">PV</span>AI proposes. Tools execute.
            Tests verify. Humans approve.
          </p>
          <span>
            LAST SAVED{" "}
            <time dateTime={status.updatedAt}>
              {new Date(status.updatedAt).toISOString().slice(11, 19)} UTC
            </time>
          </span>
        </footer>
      </main>
    </>
  );
}
