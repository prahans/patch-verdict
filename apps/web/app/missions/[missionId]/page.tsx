import { connection } from "next/server";

import { MissionHeader } from "@/components/mission/mission-header";
import { MissionSummary } from "@/components/mission/mission-summary";
import { FlightRecorder } from "@/components/mission/flight-recorder";
import { ProofChain } from "@/components/mission/proof-chain";
import { DiffViewer } from "@/components/mission/diff-viewer";
import { InvestigationReport } from "@/components/mission/investigation-report";
import { VerificationEvidence } from "@/components/mission/verification-evidence";
import { Icon } from "@/components/mission/icon";

import { loadProofBundle } from "@/lib/load-proof-bundle";

import type { MissionViewModel } from "@/lib/mission-types";

type MissionPageProps = {
  params: Promise<{
    missionId: string;
  }>;
};

export default async function MissionPage({ params }: MissionPageProps) {
  await connection();

  const { missionId } = await params;

  let bundle: MissionViewModel;

  try {
    bundle = await loadProofBundle(missionId);
  } catch (error) {
    return (
      <>
        <MissionHeader verdict={null} />

        <main id="mission" className="mission-shell">
          <section
            className="panel bundle-notice"
            aria-labelledby="bundle-error-title"
          >
            <p className="eyebrow amber">PROOF BUNDLE UNAVAILABLE</p>

            <h1 id="bundle-error-title">
              Mission artifacts could not be loaded
            </h1>

            <p>
              {error instanceof Error
                ? error.message
                : "An unexpected error occurred while reading the proof bundle."}
            </p>

            <p>
              Check the backend-generated files in{" "}
              <code>output/{missionId}</code>, then reload this page.
            </p>
          </section>
        </main>
      </>
    );
  }

  const { mission, details: missionDetails, warnings } = bundle;

  return (
    <>
      <a className="skip-link" href="#mission">
        Skip to mission
      </a>

      <MissionHeader verdict={mission.verdict} />

      <main id="mission" className="mission-shell">
        <div className="workspace-bar">
          <div className="flex items-center gap-3">
            <Icon name="terminal" />

            <span>Mission control</span>

            <span className="text-muted" aria-hidden="true">
              /
            </span>

            <span className="font-mono text-muted">{missionDetails.id}</span>
          </div>

          <span className="bundle-label">
            <span className="status-dot" />
            Proof bundle
          </span>
        </div>

        <MissionSummary mission={mission} details={missionDetails} />

        {mission.status === "FAILED" && (
          <section
            className="panel bundle-notice is-failed"
            aria-label="Mission failure"
          >
            <h2>Mission failed</h2>

            <p>
              {mission.error ??
                "The backend recorded a failed mission without an error description."}
            </p>
          </section>
        )}

        {warnings.length > 0 && (
          <aside
            className="panel bundle-notice"
            aria-label="Artifact availability"
          >
            <h2>Some proof artifacts are unavailable</h2>

            <ul>
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </aside>
        )}

        <div className="section-divider">
          <span>MISSION RECORD</span>

          <span className="section-divider-line" />

          <span>REASONING / EVIDENCE / VERDICT</span>
        </div>

        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <FlightRecorder events={mission.events} />

          <ProofChain mission={mission} />
        </div>

        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <DiffViewer patch={mission.patch} />

          <InvestigationReport
            investigation={mission.investigation}
            details={missionDetails}
          />
        </div>

        <VerificationEvidence
          evidence={mission.evidence}
          bugReproducedBeforePatch={mission.checks?.bugReproducedBeforePatch}
        />

        <footer className="mission-footer">
          <p>
            <span className="footer-mark">PV</span> AI proposes. Tools execute.
            Tests verify. Humans approve.
          </p>

          <span>PROOF BUNDLE · DETERMINISTIC EVIDENCE</span>
        </footer>
      </main>
    </>
  );
}
