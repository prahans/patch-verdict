import type { MissionDetails, MissionResult } from "@/lib/mission-types";
import { Icon } from "./icon";
import { GitHubIssueBody } from "./github-issue-body";
import { ExportEvidence } from "./export-evidence";
import { PullRequestAction } from "./pull-request-action";
import { getPullRequestEligibility, type PullRequestResult } from "@/lib/pull-request-types";

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
  pullRequest = null,
}: {
  mission: MissionResult;
  details: MissionDetails;
  pullRequest?: PullRequestResult | null;
}) {
  const baseCommit = details.source?.baseCommit ?? mission.patch?.baseCommit;
  const githubIssue = details.source?.githubIssue;
  const eligibility = getPullRequestEligibility(mission, details);

  const repository =
    details.source?.repositoryUrl ??
    details.repository ??
    `Proof bundle / ${details.id}`;
  return (
    <section className="mission-summary" aria-labelledby="mission-title">
      <div className="summary-heading">
        <div className="summary-copy">
          <p className="eyebrow amber">PATCH VERIFICATION MISSION</p>
          <h1 id="mission-title">{githubIssue?.title ?? details.title}</h1>
          {githubIssue ? (
            <GitHubIssueBody body={githubIssue.body ?? details.description} />
          ) : (
            <p className="mission-description">{details.description}</p>
          )}
        </div>
        <div className="mission-actions">
          <ExportEvidence mission={mission} missionId={details.id} />
          <PullRequestAction missionId={details.id} eligibility={eligibility} initialPullRequest={pullRequest} />
          {!eligibility.allowed && mission.status === "COMPLETED" &&
            (mission.verdict === "VERIFIED" || mission.verdict === "REVIEW_REQUIRED") && (
            <p className="pull-request-note text-muted">{eligibility.reason}</p>
          )}
        </div>
      </div>
      <div className="mission-origin-list" aria-label="Mission source">
        <div className="mission-origin-item">
          <Icon name="branch" width="14" height="14" />
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
        {githubIssue && (
          <div className="mission-origin-item">
            <Icon name="file" width="14" height="14" />
            <span className="repository-label">Issue</span>
            <a href={githubIssue.url} target="_blank" rel="noopener noreferrer">
              #{githubIssue.number} · View original issue <span className="external-link-mark" aria-hidden="true">↗</span>
            </a>
          </div>
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
