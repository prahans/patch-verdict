# PatchVerdict

The landing page starts the existing PatchVerdict CLI and immediately opens live Mission Control. Real backend events build the live evidence chain; the existing proof dashboard takes over when the saved bundle is ready. Investigation, verification, and verdict logic remain authoritative in the backend.

## Run locally

Install dependencies at both the repository root and in `apps/web` if they are missing. Use Node.js 24 or later for the included web tests.

```sh
pnpm install
cd apps/web
pnpm install
pnpm dev
```

Configure `E2B_API_KEY` and `OPENROUTER_API_KEY` in the repository root `.env` (see `.env.example`). `AGENT_MODEL` is optional. The backend loads that file with its existing dotenv setup; credentials stay on the server.

Open http://localhost:3000. Paste a public **GitHub issue URL**, such as `https://github.com/prahans/patchverdict-divide-by-zero/issues/1`. The form loads a plain-text preview of the repository, issue number, title, and body. **No GitHub issue? Use a repository and manual bug description** switches to the original repository/description flow; manual descriptions still require at least 20 characters. Switch back to issue mode at any time before submission.

The collapsed **Advanced verification settings** section provides the same optional reproduction command and failure marker in either mode. The form is disabled only while the server accepts the request, then opens `/missions/<missionId>` immediately. Public issue loading and the entire verification mission work without a GitHub token.

When the command is omitted, the CLI uses `prepared.project.fullSuiteCommand` from the existing project detector (for example, `npm test` or `pnpm test`). An explicit command takes precedence. No failure marker is invented.

## Execution and data boundary

`GET /api/github/issue?url=<encoded-issue-url>` parses the URL locally and fetches only the fixed GitHub API origin. Issue URLs must have exactly the HTTPS `github.com/<owner>/<repo>/issues/<positive-integer>` shape, without credentials, queries, fragments, or extra segments. A GitHub pull request returned by the issues API is rejected. Preview text is bounded and rendered as text.

`POST /api/missions` accepts `{ mode: "issue", issueUrl, reproductionCommand?, requiredOutput? }` or `{ mode: "manual", repositoryUrl, issue, reproductionCommand?, requiredOutput? }`. Issue submission resolves the issue again on the server and derives the repository and title/body there; browser preview values cannot replace them. Both modes become repository-oriented backend input. The route creates a unique server-generated mission ID, saves initial status, and starts the child process. It returns HTTP 202 with `missionId`, `missionUrl`, and `statusUrl` without awaiting the mission. Submitting the same inputs again creates a separate run.

`runBackendMission()` launches `process.execPath` with the root-installed `tsx/dist/cli.mjs`, the fixed `src/real-mission-demo.ts` entry point, and separate input arguments using `shell:false`. It supplies `PATCHVERDICT_MISSION_ID` itself and keeps the GitHub write token out of the verification child. The browser cannot choose this ID. Normal CLI runs retain their original generated IDs when the variable is absent. The reproduction command is data for the existing sandbox backend.

The child continues under the Node server after the response. Next.js `after()` tracks its completion. An optional runner observer emits each real event with the exact `PATCHVERDICT EVENT <server-generated-id>: [STATE] message` envelope; the CLI emits repository preparation in the same format. Messages are flattened to one line. The bridge accepts only envelopes for that mission, then allowlists or sanitizes their messages. Raw repository output, AI text, and evidence summaries do not become progress events. The observer does not change the runner's existing console output, execution, or saved proof.

Live status is written atomically to `output/.runs/<missionId>.json` through a temporary file and rename, outside the proof directory that the backend recreates. The live client polls `GET /api/missions/<missionId>/status` about once per second with caching disabled. A browser reload reads the same status from disk. Live proof checks change only in response to real events, never elapsed time or percentages.

The backend writes supporting artifacts first, then atomically publishes the unchanged `proof.json` through a temporary file and rename. Its presence therefore signals that the saved bundle is ready. Polling stops and `router.refresh()` loads the canonical server-rendered dashboard. A saved mission with execution or verdict `FAILED` still opens that dashboard. A process crash without proof, or the 270-second timeout, produces a persisted **MISSION EXECUTION FAILED** state with a safe message. Timeout terminates the process tree. Corrupt proof files remain artifact errors rather than appearing as running missions.

The server reads the saved proof with `loadProofBundle(missionId)` on each dashboard request, including a refresh. The loader uses fixed artifact filenames, safe mission IDs, and real-path containment. The frontend displays the recorded verdict without recomputing it. The landing page links a proof example only when a readable real repository bundle exists locally. Its illustrative HTML proof preview is separately labeled EXAMPLE PROOF.

Keep the complete checkout, root dependencies, and writable `output` directory available to the Node server in both development and production (`pnpm build`, then `pnpm start`). This filesystem/process integration requires a long-lived Node host capable of running missions for up to five minutes. It does not resume execution after a server restart; persisted progress remains readable, and abandoned runs become failed when their deadline expires. There is no queue or worker service. A static export or short-lived Edge runtime cannot run it. Existing proof bundles can still be opened directly.

Required proof files are `proof.json` and `events.json`. Investigation, diff, and execution evidence files are optional when the backend did not produce them.

Issue-backed proof bundles carry optional `mission.source.githubIssue` metadata alongside the repository URL and base commit. Mission Control uses the canonical issue title as its heading, the body as its description, and safe external repository/issue links. Existing manual and older proof bundles continue loading. New proofs also record `patch.sha256`, a digest of the exact saved `patch.diff` bytes. The published proof remains immutable.

## Human-controlled pull requests

PR publication is separate from verification. The dashboard offers **Create pull request** for an eligible `VERIFIED` mission and **Create draft PR** for `REVIEW_REQUIRED`. Failed missions cannot publish. Nothing creates or merges a PR automatically, and a publication error cannot change the verdict.

Set `PATCHVERDICT_GITHUB_TOKEN` in the **web server environment** or `apps/web/.env.local` only when you want publication enabled (see this directory's `.env.example`). A missing token produces a controlled configuration error only when creating a PR. The server uses it in GitHub authorization headers; it is never sent to the browser, git commands, proof artifacts, or the AI. Use a fine-grained token restricted to the intended demo repositories with **Contents: read/write**, **Pull requests: read/write**, **Issues: read**, and **Metadata: read**. Permissions and repository access are also enforced by GitHub. Do not use a `NEXT_PUBLIC_` variable for credentials.

`POST /api/missions/<missionId>/pull-request` derives all publication inputs from persisted evidence. It requires completed, readable proof, an allowed verdict, an applied nonempty patch, matching source/patch base commits, and a matching diff digest. The browser supplies no repository, patch, base, branch, or verdict. Old proofs without a diff digest remain viewable but must be verified again before publication.

The publisher reads the exact base commit/tree through GitHub REST and applies the exact diff in an isolated Git index. Git does not check out or execute repository code. It validates the resulting changed-file set and modes, then creates GitHub blobs/tree and a commit whose parent is the recorded base commit. The PR targets the repository's current default branch; the patch is never rebased, regenerated, or reverified during publication. GitHub reports conflicts if that branch has advanced.

Only supported bounded text patches can publish. Binary files, symlinks, submodules, unsafe paths, unsupported modes, or repositories exceeding publication limits produce controlled errors. Git must be available on the web server. The verification engine's E2B execution remains unchanged.

The deterministic branch is `patchverdict/<missionId>`. Validated PR metadata is saved atomically as `output/<missionId>/pull-request.json`, separate from `proof.json`, and the refreshed dashboard shows **View PR**. Repeated/concurrent requests reuse publication state. If GitHub succeeds before local persistence fails, retry checks the deterministic branch and existing PR against the exact expected repair before recovering it. Existing mission retention naturally retains or removes PR metadata with its mission directory.

## Checks

At the repository root:

```sh
pnpm typecheck
pnpm test
```

From `apps/web`:

```sh
node --test tests/*.test.mjs
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

## Manual browser test

1. Start the app with `pnpm dev` in `apps/web`, then open http://localhost:3000.
2. Enter `https://github.com/prahans/patchverdict-simple-bug`.
3. Enter: The average function returns incorrect results. average([10, 20, 30]) should return 20, average([100]) should return 100, and the implementation should correctly compute the arithmetic mean while preserving the empty-array behavior.
4. Leave Advanced settings collapsed; submit just these two fields.
5. Confirm an immediate HTTP 202 and navigation to `/missions/<actual-mission-id>`, showing RUNNING / PREPARING. The backend should detect npm and use `npm test`.
6. Confirm real events appear as reproduction, investigation, patching, and verification run. Reload during execution and confirm the saved progress remains visible.
7. Confirm the live view automatically becomes the existing final dashboard, with the actual repository, commit, investigation, diff, evidence, and recorded verdict. Reload once more to confirm the final proof persists.
8. Use New mission to return to `/#verify`, and the brand to return to `/`. Submit an invalid repository URL to confirm an accessible error and preserved inputs.
9. Repeat with the review benchmark `https://github.com/zrev2220/vitest-rtl-cleanup-bug` and issue: `DarkMode tests fail because rendered DOM from previous test suites remains mounted. Each test should run with a clean DOM.` Optionally set `npm test` and `Found multiple elements` in Advanced settings. Observe the actual recorded outcome; a sensitive verification change should appear as REVIEW and ultimately REVIEW_REQUIRED when verification passes.
