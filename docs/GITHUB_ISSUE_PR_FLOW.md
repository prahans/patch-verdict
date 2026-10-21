# GitHub issue and pull request flow

PatchVerdict can turn a public GitHub issue into a verification mission and, after a separate user action, publish an eligible recorded repair. Issue loading, verification, and publication have different credentials and trust boundaries. This guide describes the checked-in implementation, replacing the earlier feature-branch implementation report.

For installation, see [Getting started](GETTING_STARTED.md). For evidence semantics, see [Verification](VERIFICATION.md). For access-control limitations, see [Security and limitations](SECURITY_AND_LIMITATIONS.md).

## Public issue input

The landing form opens in issue mode. Supply an exact URL such as:

```text
https://github.com/prahans/patchverdict-divide-by-zero/issues/1
```

The supported shape is `https://github.com/<owner>/<repository>/issues/<positive-integer>`. HTTP, other hosts, embedded credentials, ports, queries, fragments, extra path segments, and a trailing slash after the issue number are rejected. The number must be a safe positive integer. Pull-request URLs are unsupported; an issue-shaped URL is also rejected if GitHub's issues API identifies its response as a pull request.

The preview calls `GET /api/github/issue?url=<encoded-url>`. The server validates the URL before fetching a fixed `https://api.github.com/repos/.../issues/...` endpoint. It disables redirects, uses a 15-second request timeout, and limits the response to 256 KiB. Reads are always unauthenticated, even when a publication token is configured. Private issues are unsupported, and GitHub's unauthenticated rate limits apply.

The preview returns the repository, issue number, title, canonical URL, and up to 500 body characters. It renders text rather than issue-supplied HTML. Preview truncation affects presentation only: verification uses the full accepted title/body. The combined context must fit 10,000 characters, the title is limited to 1,024 characters, and serialized issue metadata must fit 24,000 characters for the process boundary. Oversized context is rejected rather than silently shortened. An empty body is accepted when the title is usable.

Sources: [URL validation](../apps/web/lib/github-issue-url.ts), [issue resolver](../apps/web/lib/github-issue.ts), [preview route](../apps/web/app/api/github/issue/route.ts), [preview component](../apps/web/components/landing/issue-preview.tsx).

## Manual reports and advanced settings

**No GitHub issue? Use a repository and manual bug description** switches to manual input. The HTTPS GitHub repository URL must identify the repository directly; this form accepts an optional `.git` suffix or trailing slash. The description must contain 20–10,000 characters after trimming. Issue titles do not inherit the manual description's 20-character minimum.

Both modes expose the same optional advanced settings:

| Field | Behavior |
| --- | --- |
| Reproduction command | Up to 2,000 characters. If omitted, the CLI uses the detected `npm test` or `pnpm test` command. |
| Required failure marker | Up to 1,000 characters. If provided, the baseline must contain that text. No marker is invented when absent. |

These are execution inputs, not verdict overrides. Commands run in the remote sandbox. The [verification guide](VERIFICATION.md) describes baseline exit-code and output checks.

## Canonical submission and Mission Control

`POST /api/missions` accepts JSON in either form:

```json
{
  "mode": "issue",
  "issueUrl": "https://github.com/owner/repository/issues/12",
  "reproductionCommand": "npm test",
  "requiredOutput": "expected failure text"
}
```

```json
{
  "mode": "manual",
  "repositoryUrl": "https://github.com/owner/repository",
  "issue": "Describe the observed failure and the expected behavior."
}
```

The advanced fields are optional in both forms. The route requires JSON and enforces a 64 KiB body limit. For issue mode it fetches the issue again and derives the repository and title/body on the server. Browser-supplied title, body, repository, or metadata cannot replace those canonical values. If the issue changes after preview, the fresh server response supplies the mission context.

After initial status persistence and process launch, the server returns HTTP `202` with `missionId`, `missionUrl`, and `statusUrl`. The browser opens `/missions/<missionId>` without waiting for verification. Repeating a mission submission creates another run; PR retry deduplication does not deduplicate missions.

The process bridge invokes the fixed backend entry point with separate arguments and `shell: false`. It generates the `web-<UUID>` mission ID and passes canonical issue metadata separately from the report text. It explicitly blanks `PATCHVERDICT_GITHUB_TOKEN` in the child environment, also preventing dotenv from restoring that token from a root environment file.

Live status lives in `output/.runs/`; completed proof lives in `output/<missionId>/`. Mission Control polls real recorded progress and refreshes into the saved dashboard when proof is available. Issue-backed bundles include `mission.source.githubIssue`; manual and older bundles remain readable without it. New patches record `patch.sha256`, calculated from the exact saved `patch.diff` bytes. The dashboard displays recorded evidence and verdicts; it does not create a replacement verdict.

Sources: [input parser](../apps/web/lib/mission-input.ts), [mission route](../apps/web/app/api/missions/route.ts), [process bridge](../apps/web/lib/run-backend-mission.ts), [proof writer](../src/proof/bundle.ts). See [System design](SYSTEM_DESIGN.md) for process lifetime and failures.

## Enable publication separately

Public issue loading and verification do not require a GitHub token. Publication requires Git on the web server and `PATCHVERDICT_GITHUB_TOKEN` in the web server environment or `apps/web/.env.local`. Merely placing it in the root CLI `.env` is not the documented web configuration.

Use the configuration in [the web environment example](../apps/web/.env.example): a fine-grained token restricted to intended repositories, with Contents read/write, Pull requests read/write, Issues read, and Metadata read. GitHub enforces repository access and permissions. Never prefix a credential with `NEXT_PUBLIC_`.

The publisher sends the token in GitHub API authorization headers. It does not place it in Git command arguments, browser responses, or proof metadata. A missing token produces a publication-only configuration error; it does not change the saved verdict.

The branch is created in the proof's repository. There is no fork-creation workflow: a public issue may be verifiable while publication remains unavailable because the configured account lacks write access.

## Eligibility and human action

| Recorded result | Available action, subject to evidence validation |
| --- | --- |
| Completed `VERIFIED` mission | **Create pull request** |
| Completed `REVIEW_REQUIRED` mission | **Create draft PR** |
| `FAILED` verdict, execution failure, or ineligible evidence | No publication |

Publication is never automatic, and PatchVerdict does not merge PRs. A publication error leaves the original proof and verdict unchanged.

`POST /api/missions/<missionId>/pull-request` accepts an empty body. The browser cannot supply a repository, diff, base commit, branch, or verdict. The server reloads the saved proof and requires:

1. A valid mission ID, readable canonical artifacts, completed execution, and an allowed verdict. If live status exists, it must also say completed with proof ready.
2. An applied, nonempty patch and nonempty changed-file set, with matching source and patch base commits.
3. A recorded SHA-256 digest matching the exact diff bytes and loaded diff text.
4. No corrupt-artifact warnings or contradictory recorded failures. Failing recorded tests or compromised integrity cannot be overridden by a `VERIFIED` label.

Older proofs without a digest remain viewable but need a new verification mission to become publishable. Some legacy evidence fields are optional; eligibility rejects contradictions in recorded fields without requiring every optional field to exist.

The route rejects a supplied foreign `Origin` or `Sec-Fetch-Site: cross-site`. This is browser cross-site request protection, **not user authentication**. There is no account login or per-mission ownership check, and requests without those headers are not rejected on origin grounds. Keep a token-enabled instance under operator-controlled access. See [Security and limitations](SECURITY_AND_LIMITATIONS.md#application-access).

Sources: [eligibility rules](../apps/web/lib/pull-request-types.ts), [publication route](../apps/web/app/api/missions/[missionId]/pull-request/route.ts), [publisher](../apps/web/lib/github-pull-request.ts).

## Publish the exact recorded patch

The publisher validates identity and contents before constructing the GitHub commit:

1. Read the proof's exact base commit and recursive tree through GitHub REST.
2. Reconstruct the base tree in a temporary bare Git repository and index, and check its tree hash. Fetch only affected base blobs and verify their hashes.
3. Run `git apply --cached --check` and `git apply --cached` with the exact diff. Validate the resulting changed-file set, modes, contents, and tree hash.
4. Create GitHub blobs and a tree, checking the returned hashes. Create a commit with the recorded base commit as its sole parent.
5. Use branch `patchverdict/<missionId>`, recheck the local proof, then open or recover the matching PR targeting the repository's current default branch.

This uses an index and object database without checking out or executing repository code. The Git subprocess has an isolated environment/configuration and disabled hooks. Publication does not ask the model for another repair.

The patch is not rebased, regenerated, or reverified against an advanced default branch. The PR may conflict with newer work, and maintainers must review integration separately. An incompatible existing mission branch is rejected rather than force-updated.

The PR description includes recorded checks, base commit, changed files, integrity status, and review reasons. `REVIEW_REQUIRED` always requests a draft. `Fixes #N` is added only for validated issue metadata from the same repository. Creating the PR does not itself close the issue.

Source: [exact patch reconstruction](../apps/web/lib/exact-verified-patch.ts) and [publisher](../apps/web/lib/github-pull-request.ts).

### Publication bounds

Publication supports changes to UTF-8 regular text files, including executable files, additions, and deletions. Changed binary files, symlinks, submodules, invalid paths, and unsupported modes are rejected. Unaffected symlink/submodule entries can remain in the reconstructed base tree.

| Bound | Current limit |
| --- | --- |
| Changed files | 200, with no duplicate paths |
| Saved diff | 2 MiB |
| Affected file contents | 2 MiB per file |
| Total downloaded affected base blobs | 8 MiB |
| Recursive repository tree | 20,000 entries; truncated responses rejected |
| GitHub JSON response | 12 MiB |
| Individual Git command | 20 seconds, with bounded combined output |

Tree validation also rejects unsafe or case-ambiguous paths. These are publication constraints; a readable mission does not necessarily satisfy them.

## Retry, recovery, and persistence

Concurrent requests share an in-process operation and a per-mission filesystem lock. Locks older than ten minutes can be removed on retry. GitHub API calls share a two-minute deadline, with individual requests limited to at most 20 seconds; this is not a guaranteed two-minute total duration for all local Git work.

Successful publication stores `output/<missionId>/pull-request.json` atomically, separately from `proof.json`. Metadata binds the repository, branch, PR URL/number, draft policy, base/head/tree hashes, diff digest, and full proof digest. A refresh can show **View PR** from valid local metadata without a token or GitHub request. That is a saved publication record, not a live PR-status monitor.

If GitHub succeeds before local persistence fails, retry looks for the deterministic branch and existing PR. Recovery checks repository, branch, draft policy, commit parent, and expected tree before reuse. It can recover a matching closed PR even after its branch has been deleted. Conflicting state is rejected; recovery does not overwrite another repair. Partial failure can leave Git objects or a branch on GitHub; no general remote rollback service is implemented.

PR metadata follows the mission directory's [retention policy](BENCHMARK_DASHBOARD.md). Back up required demonstrations privately with the rest of their proof bundles.

## What the tests establish

[Issue tests](../apps/web/tests/github-issue.test.mjs) cover strict parsing, public unauthenticated fetching, response limits, canonical resubmission, and unsafe metadata. [Process tests](../apps/web/tests/run-backend-mission.test.mjs) cover literal arguments, issue source propagation, and write-token exclusion. [PR tests](../apps/web/tests/github-pull-request.test.mjs) use real Git objects with a deterministic mock GitHub API to exercise exact publication, policy, integrity failures, concurrency, recovery, and containment. [UI tests](../apps/web/tests/issue-pr-ui.test.mjs) cover preview escaping, input modes, action availability, errors, and saved links.

Those tests do not establish successful live GitHub publication or arbitrary-repository reliability. The earlier implementation report explicitly recorded that no real PR or live AI/E2B mission was created during that implementation. This documentation refresh does not claim an additional live publication. Follow the [demo guide](DEMO_GUIDE.md) to prepare an intentional demonstration with an authorized repository and inspect the actual result.
