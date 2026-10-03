import { MissionHeader } from "@/components/mission/mission-header";
import { MissionSummary } from "@/components/mission/mission-summary";
import { FlightRecorder } from "@/components/mission/flight-recorder";
import { ProofChain } from "@/components/mission/proof-chain";
import { DiffViewer } from "@/components/mission/diff-viewer";
import { InvestigationReport } from "@/components/mission/investigation-report";
import { VerificationEvidence } from "@/components/mission/verification-evidence";
import { Icon } from "@/components/mission/icon";
import { missionDetails, mockMission } from "@/lib/mock-mission";

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#mission">Skip to mission</a>
      <MissionHeader verdict={mockMission.verdict} />
      <main id="mission" className="mission-shell">
        <div className="workspace-bar">
          <div className="flex items-center gap-3">
            <Icon name="terminal" />
            <span>Mission control</span>
            <span className="text-muted" aria-hidden="true">/</span>
            <span className="font-mono text-muted">{missionDetails.id}</span>
          </div>
          <span className="mock-label"><span className="status-dot" />Mock mission</span>
        </div>
        <MissionSummary mission={mockMission} details={missionDetails} />
        <div className="section-divider">
          <span>MISSION RECORD</span>
          <span className="section-divider-line" />
          <span>REASONING / EVIDENCE / VERDICT</span>
        </div>
        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <FlightRecorder events={mockMission.events} />
          <ProofChain mission={mockMission} />
        </div>
        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          {mockMission.patch && <DiffViewer patch={mockMission.patch} />}
          {mockMission.investigation && (
            <InvestigationReport investigation={mockMission.investigation} details={missionDetails} />
          )}
        </div>
        {mockMission.evidence && <VerificationEvidence evidence={mockMission.evidence} />}
        <footer className="mission-footer">
          <p><span className="footer-mark">PV</span> AI proposes. Tools execute. Tests verify. Humans approve.</p>
          <span>MOCK DATA · NO LIVE EXECUTION</span>
        </footer>
      </main>
    </>
  );
}