import type { MissionDetails, MissionResult } from "@/lib/mission-types";
import { Icon } from "./icon";
import { ExportEvidence } from "./export-evidence";

function isGitHubRepositoryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

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
        <span className="repository-label">Repository</span>
        {isGitHubRepositoryUrl(repository) ? (
          <a
            href={repository}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Source repository: ${repository} (opens in a new tab)`}
          >
            {repository}<span className="external-link-mark" aria-hidden="true"> ↗</span>
          </a>
        ) : (
          <span className="repository-value">{repository}</span>
        )}
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
        <div className="base-commit-fact">
          <dt>Base commit</dt>

          <dd>
            <Icon name="branch" />

            {baseCommit ? (
              <code className="base-commit" title={baseCommit}>
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
