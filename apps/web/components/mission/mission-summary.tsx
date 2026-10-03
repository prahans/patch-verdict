import type { MissionResult } from "@/lib/mock-mission";
import { Icon } from "./icon";
import { ExportEvidence } from "./export-evidence";

export function MissionSummary({ mission, details }: {
  mission: MissionResult;
  details: { id: string; title: string; description: string; repository: string };
}) {
  return (
    <section className="mission-summary" aria-labelledby="mission-title">
      <div className="summary-heading">
        <div className="min-w-0">
          <p className="eyebrow amber">PATCH VERIFICATION MISSION</p>
          <h1 id="mission-title">{details.title}</h1>
          <p className="mission-description">{details.description}</p>
        </div>
        <ExportEvidence mission={mission} missionId={details.id} />
      </div>
      <div className="repository-line"><Icon name="branch" /><span>{details.repository}</span></div>
      <dl className="mission-facts">
        <div><dt>Mission status</dt><dd className={mission.status === "COMPLETED" ? "green" : "amber"}><span className="status-dot" />{mission.status}</dd></div>
        <div><dt>Base commit</dt><dd><Icon name="branch" /><code title={mission.patch?.baseCommit}>{mission.patch?.baseCommit.slice(0, 7) ?? "—"}</code></dd></div>
        <div><dt>Changed files</dt><dd><Icon name="file" />{mission.patch?.changedFiles.length ?? 0}<span className="fact-detail">file</span></dd></div>
        <div><dt>Investigation</dt><dd>{mission.investigation?.iterations ?? 0}<span className="fact-detail">iterations</span></dd></div>
      </dl>
    </section>
  );
}
