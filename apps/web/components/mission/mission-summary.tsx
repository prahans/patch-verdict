import type { MissionDetails, MissionResult } from "@/lib/mission-types";
import { Icon } from "./icon";
import { ExportEvidence } from "./export-evidence";

export function MissionSummary({
  mission,
  details,
}: {
  mission: MissionResult;
  details: MissionDetails;
}) {
  const baseCommit = details.source?.baseCommit ?? mission.patch?.baseCommit;

  const repository =
    details.source?.repositoryUrl ??
    details.repository ??
    `Proof bundle / ${details.id}`;
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
      <div className="repository-line">
        <Icon name="branch" />

        <span title={repository}>{repository}</span>
      </div>
      <dl className="mission-facts">
        <div>
          <dt>Mission status</dt>
          <dd
            className={mission.status === "COMPLETED" ? "green" : "is-failed"}
          >
            <span className="status-dot" />
            {mission.status}
          </dd>
        </div>
        <div>
          <dt>Base commit</dt>

          <dd>
            <Icon name="branch" />

            {baseCommit ? (
              <code className="break-all" title={baseCommit}>
                {baseCommit}
              </code>
            ) : (
              "Unavailable"
            )}
          </dd>
        </div>
        <div>
          <dt>Changed files</dt>
          <dd>
            <Icon name="file" />
            {mission.patch ? (
              <>
                {mission.patch.changedFiles.length}
                <span className="fact-detail">
                  {mission.patch.changedFiles.length === 1 ? "file" : "files"}
                </span>
              </>
            ) : (
              "Unavailable"
            )}
          </dd>
        </div>
        <div>
          <dt>Investigation</dt>
          <dd>
            {mission.investigation?.iterations !== undefined ? (
              <>
                {mission.investigation.iterations}
                <span className="fact-detail">iterations</span>
              </>
            ) : (
              "Unavailable"
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
