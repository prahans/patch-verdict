"use client";

import { useState } from "react";
import type { FormEvent } from "react";

type RunResponse = {
  missionId?: string;
  error?: string;
};

export function MissionLauncher() {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRunning(true);
    setError(null);

    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/missions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          repositoryUrl: form.get("repositoryUrl"),
          issue: form.get("issue"),
          reproductionCommand: form.get("reproductionCommand"),
          requiredOutput: form.get("requiredOutput"),
        }),
      });

      const data = (await response.json()) as RunResponse;

      if (!response.ok || !data.missionId) {
        throw new Error(data.error || "Mission did not return a mission ID.");
      }

      window.location.assign(
        `/missions/${encodeURIComponent(data.missionId)}`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not run PatchVerdict.",
      );
      setRunning(false);
    }
  }

  return (
    <section className="panel launcher-panel" aria-labelledby="launcher-title">
      <div className="panel-header">
        <div>
          <p className="eyebrow amber">NEW VERIFICATION MISSION</p>
          <h1 id="launcher-title">Run PatchVerdict</h1>
          <p className="launcher-intro">
            Reproduce a reported bug, let the agent investigate and patch it,
            then verify the result with deterministic tests.
          </p>
        </div>
      </div>

      <form className="launcher-form" onSubmit={submit}>
        <label className="launcher-field">
          <span>GitHub repository</span>
          <input
            name="repositoryUrl"
            type="url"
            required
            placeholder="https://github.com/owner/repository"
            defaultValue="https://github.com/zrev2220/vitest-rtl-cleanup-bug"
            disabled={running}
          />
        </label>

        <label className="launcher-field">
          <span>Reported issue</span>
          <textarea
            name="issue"
            required
            rows={4}
            defaultValue="DarkMode tests fail because rendered DOM from previous test suites remains mounted. Each test should run with a clean DOM."
            disabled={running}
          />
        </label>

        <div className="launcher-grid">
          <label className="launcher-field">
            <span>Reproduction command</span>
            <input
              name="reproductionCommand"
              required
              defaultValue="npm test"
              disabled={running}
            />
          </label>

          <label className="launcher-field">
            <span>Required failure text</span>
            <input
              name="requiredOutput"
              defaultValue="Found multiple elements"
              disabled={running}
            />
          </label>
        </div>

        {error && (
          <div className="launcher-error" role="alert">
            <strong>Mission could not start</strong>
            <p>{error}</p>
          </div>
        )}

        <div className="launcher-actions">
          <div>
            <span className="status-dot amber" />
            <span>
              Backend runs locally and writes a proof bundle to{" "}
              <code>output/</code>.
            </span>
          </div>

          <button className="action-button launcher-submit" type="submit" disabled={running}>
            {running ? "Running mission…" : "Run PatchVerdict"}
          </button>
        </div>
      </form>
    </section>
  );
}
