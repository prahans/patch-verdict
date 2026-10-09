"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/mission/icon";
import { MISSION_INPUT_LIMITS, parseMissionInput, MissionInputError } from "@/lib/mission-input";

export function MissionLauncher() {
  const router = useRouter();
  const inFlight = useRef(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitMission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const fields = new FormData(event.currentTarget);
    setError(null);

    let input;
    try {
      input = parseMissionInput(Object.fromEntries(fields));
    } catch (error) {
      setError(error instanceof MissionInputError ? error.message : "Check the mission fields and try again.");
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
        const message = result && typeof result === "object" && "error" in result && typeof result.error === "string"
          ? result.error
          : "Verification could not start. Please try again.";
        setError(message);
      } else if (
        result && typeof result === "object" && "missionId" in result &&
        typeof result.missionId === "string" && /^[A-Za-z0-9_-]+$/.test(result.missionId)
      ) {
        router.push("/missions/" + result.missionId);
        // Keep the form locked until the actual dashboard replaces it.
        return;
      } else {
        setError("The server did not return a valid mission ID. Please try again.");
      }
    } catch {
      setError("The connection to PatchVerdict was interrupted. Your inputs are saved here; check the connection and try again.");
    }
    inFlight.current = false;
    setRunning(false);
  }

  return (
    <section id="verify" className="launch-panel" aria-labelledby="launch-title" tabIndex={-1}>
      <div className="launch-panel-header">
        <p className="eyebrow amber"><Icon name="terminal" width="14" height="14" /> MISSION INPUT</p>
        <h2 id="launch-title">Start verification mission</h2>
        <p>A repository. A reproducible failure. A verdict backed by evidence.</p>
      </div>
      <form className="launch-form" onSubmit={submitMission} aria-busy={running}>
        <fieldset disabled={running} className="launch-fields">
          <div className="launch-field">
            <label htmlFor="repository-url">GitHub repository URL</label>
            <input id="repository-url" name="repositoryUrl" className="launch-input" type="url" required maxLength={MISSION_INPUT_LIMITS.repositoryUrl} placeholder="https://github.com/owner/repository" autoComplete="url" spellCheck={false} />
          </div>
          <div className="launch-field">
            <label htmlFor="issue">Bug description</label>
            <textarea id="issue" name="issue" className="launch-input launch-textarea" required maxLength={MISSION_INPUT_LIMITS.issue} placeholder="Describe the observed bug and expected behavior." rows={3} />
          </div>
          <div className="launch-field">
            <label htmlFor="reproduction-command">Reproduction command</label>
            <input id="reproduction-command" name="reproductionCommand" className="launch-input" required maxLength={MISSION_INPUT_LIMITS.reproductionCommand} placeholder="npm test" autoComplete="off" spellCheck={false} aria-describedby="command-hint" />
            <p id="command-hint" className="launch-hint">Runs inside the isolated repository sandbox.</p>
          </div>
          <div className="launch-field">
            <label htmlFor="required-output">Required failure marker <span className="text-muted">(optional)</span></label>
            <input id="required-output" name="requiredOutput" className="launch-input" maxLength={MISSION_INPUT_LIMITS.requiredOutput} placeholder="Found multiple elements" autoComplete="off" spellCheck={false} aria-describedby="marker-hint" />
            <p id="marker-hint" className="launch-hint">Text expected in the baseline failure. Helps confirm the reported symptom was reproduced.</p>
          </div>
          <button className="launch-submit landing-button" type="submit" disabled={running}>
            <Icon name={running ? "activity" : "shield"} width="16" height="16" />
            {running ? "Running PatchVerdict mission…" : "Run verification"}
          </button>
        </fieldset>
        {error && <p className="launch-error" role="alert">{error}</p>}
        <p className="launch-status" role="status" aria-live="polite">
          {running ? "The mission is running. This can take up to five minutes. Your proof dashboard will open when the saved evidence is ready." : ""}
        </p>
        <p className="launch-footnote">AI proposes. Tools execute. Tests verify. Humans approve.</p>
      </form>
    </section>
  );
}
