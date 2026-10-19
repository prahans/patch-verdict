# PatchVerdict web

The landing page launches public GitHub issue missions and opens live Mission Control. AI proposes a reproduction and repair; framework execution and deterministic policy decide the recorded outcome and verdict. A human explicitly publishes an eligible candidate.

## Run locally

Install dependencies at the repository root and in apps/web. Configure E2B_API_KEY and OPENROUTER_API_KEY in the root .env; AGENT_MODEL is optional. Start pnpm dev from apps/web and open http://localhost:3000. Node.js 24 or later is required for the web test harness.

Paste a public GitHub issue URL, load its canonical preview, and choose an existing target branch. The default branch is preselected; bounded branch browsing and exact branch selection support maintenance branches. Launch resolves the issue, repository, branch, and full commit SHA again on the server. A mission never changes that branch or base.

Manual repository/description input remains available. Its advanced reproduction command and failure marker retain the legacy verification policy. Strict issue missions use framework-owned commands and cannot override them.

## Supported strict flow

The first third-party milestone supports single-package JavaScript/TypeScript repositories, npm or pnpm with one consistent lockfile, and repository-installed Vitest or Jest. A repair changes at most one grounded production JS/TS file plus one optional generated regression test. See [the complete flow and limits](../../docs/THIRD_PARTY_JS_TS_FLOW.md).

The untouched suite is captured before generation or repair. One issue-specific existing test or generated regression must fail consistently before its bytes, command, identity, branch, and base are frozen. Repair tools cannot edit tests, package files, lockfiles, configuration, setup, CI, or a second production file.

Verification checks the same frozen target and compares non-target failure identities. A successful existing target with clean background can be VERIFIED. Stable pre-existing failures require REVIEW_REQUIRED; an AI-generated oracle always requires REVIEW_REQUIRED. New regressions, changed frozen evidence, or unknown verification cannot earn an eligible verdict. Unsupported, unstable, or unreproduced outcomes have no verdict or publication action.

## Execution and evidence

POST /api/missions accepts issueUrl and targetBranch for issue mode, or repositoryUrl and issue for manual mode. Canonical repository metadata and SHA come from GitHub, never the browser. Public reads use a fixed GitHub API host without the publication token.

The web server launches the fixed CLI with --input-stdin and a 64 KiB bounded JSON envelope. Untrusted issue text is not an operating-system argument. The write token is explicitly blanked in the verification child; no shell is used for spawning it. Developer CLI positional arguments remain supported.

Next.js after() tracks the child on a long-lived Node host. The web deadline is 18 minutes, route maxDuration 1,200 seconds, sandbox lifetime 20 minutes, and individual sandbox commands two minutes. Hosting must permit these bounds. There is no persistent execution queue; server restarts leave readable status but do not resume execution.

Live status lives separately in output/.runs and uses atomic replacement. Only known, sanitized mission events become UI progress. Proof v3 binds branch/base, outcome, frozen reproduction, normalized target/background evidence, repair provenance, and exact patch SHA-256. Supporting artifacts are written first; proof.json is finalized last and never overwritten for a strict mission. Version 2 proofs retain their original interpretation. Readers use fixed filenames, bounded sizes, and real-path containment.

## Human-controlled publication

Set PATCHVERDICT_GITHUB_TOKEN in the web server environment or apps/web/.env.local only when publication is wanted. Never prefix it with NEXT_PUBLIC_. A missing token affects only publication.

Every new strict issue mission publishes through the authenticated user's validated fork, even when the token could write upstream. The server resolves the user and fork; the browser cannot provide either. An unrelated same-name repository is rejected. Renamed-fork discovery and asynchronous readiness polling are bounded.

The exact proof patch is applied to the exact base in an isolated Git index. Only the authenticated fork receives the deterministic patchverdict/<missionId> branch and commit. The parent stays proof.baseCommit and the PR targets proof.targetBranch. Branch advancement never causes rebasing or regeneration; a deleted target causes a controlled failure. A fork default branch is never updated.

Generated test bytes and existing frozen base-test bytes are checked against their recorded hash. Commit payloads bind proof and patch digests and use a fixed recorded timestamp, so uncertain retries do not generate new commits. Recovery validates upstream/fork identity, target branch, exact parent/tree/head, digests, and draft policy. Closed matching PRs are recovered; conflicting branches are never overwritten. Separate pull-request.json metadata never changes proof.json.

Eligible VERIFIED repairs create normal PRs; REVIEW_REQUIRED creates drafts. Nothing creates a fork or PR before an explicit publication action. Historical v2 controlled-repository proofs retain direct publication behavior.

Token access must cover upstream public reads and PR creation, fork Contents write, and fork creation if needed. GitHub documents fork creation permissions separately from content/PR permissions; fine-grained token ownership and repository restrictions can prevent cross-owner publication. See [GitHub forks](https://docs.github.com/en/rest/repos/forks), [Git commits](https://docs.github.com/en/rest/git/commits), and [pull requests](https://docs.github.com/en/rest/pulls/pulls). No OAuth or GitHub App is implemented.

## Checks

At the repository root, run pnpm typecheck and pnpm test. From apps/web, run node --test tests/*.test.mjs, pnpm exec tsc --noEmit, pnpm lint, and pnpm build. On Windows use pnpm.cmd if PowerShell blocks pnpm.ps1.

Development tests use local Git repositories, framework fixtures, and mocked GitHub responses. They do not create real third-party forks or PRs. Follow the controlled smoke checklist in the flow document before selecting an external issue.
