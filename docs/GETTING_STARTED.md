# Getting Started

This guide takes a developer from a fresh checkout to a local PatchVerdict web server, then explains how to submit a mission and inspect its saved evidence. For the engineering behind the workflow, see [System Design](SYSTEM_DESIGN.md); for a presentation sequence, see the [Demo Guide](DEMO_GUIDE.md).

The [public demonstration](https://patchverdict.duckdns.org/) is a read-only showcase: new mission creation and GitHub PR publication are disabled at its deployment boundary. The submission and publication instructions below apply to a separate, trusted local interactive instance. Public deployment restrictions are not built-in user authentication.

## Prerequisites

- **Node.js 24:** the version used by [CI](../.github/workflows/ci.yml). The web tests use Node's native TypeScript loading and module hooks. Neither package manifest declares a broader supported Node range.
- **pnpm 12.8.1:** pinned in both the [root manifest](../package.json) and [web manifest](../apps/web/package.json), and configured in CI. Confirm `node --version` and `pnpm --version` before installing.
- **Git:** needed to clone this project, and available on the web server if you enable pull-request publication.
- **OpenRouter and E2B accounts/API keys:** required to execute real missions. The AI and sandbox providers may charge for usage. Viewing an existing saved proof does not start a mission.
- A writable local checkout, network access to the required services, and a public GitHub JavaScript/TypeScript repository suited to the current detector.

The repository being investigated must have a root `package.json`, a `test` script, and a supported npm or pnpm lockfile. Ambiguous package-manager configurations are rejected. This is a limited repository workflow, not general language support; see [Security and Limitations](SECURITY_AND_LIMITATIONS.md).

## Install the two applications

Run these commands in a terminal:

```sh
git clone https://github.com/prahans/patch-verdict.git
cd patch-verdict
pnpm install --no-frozen-lockfile
cd apps/web
pnpm install --no-frozen-lockfile
cd ../..
```

The root engine and `apps/web` are separate pnpm projects with separate lockfiles. Installing only the web dependencies lets the UI start but leaves the root-installed `tsx` mission runner unavailable.

These installation flags match CI. The committed lockfiles currently lack complete dependency graphs, so a frozen install is not the documented baseline. Non-frozen installs may resolve dependency ranges and update local lockfiles; this is a reproducibility limitation, not an instruction to commit incidental dependency changes.

On Windows, if PowerShell blocks `pnpm.ps1` because of script execution policy, use `pnpm.cmd` for the same commands.

## Configure credentials

For a new checkout, copy the root example:

```sh
cp .env.example .env
```

PowerShell equivalent:

```powershell
Copy-Item -LiteralPath .env.example -Destination .env
```

If `.env` already exists, edit it instead of replacing it. Fill in your own values locally:

```dotenv
OPENROUTER_API_KEY=your_openrouter_key
E2B_API_KEY=your_e2b_key
AGENT_MODEL=qwen/qwen3-coder-next
```

| Variable | Location and purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | Root `.env` or inherited server environment; required for the engine's OpenRouter client. |
| `E2B_API_KEY` | Root `.env` or inherited server environment; used by the E2B SDK to create remote sandboxes. |
| `AGENT_MODEL` | Optional root/server setting. The engine defaults to `qwen/qwen3-coder-next` when unset. Access to a chosen model depends on the provider account. |
| `PATCHVERDICT_GITHUB_TOKEN` | Optional **web server environment** or `apps/web/.env.local`; enables user-initiated PR publication only. |

The backend imports `dotenv/config` and the web runner starts it with the repository root as its working directory. Public issue loading and verification do not require a GitHub token. Put the optional publication token in the web environment rather than relying on the root `.env` to configure Next.js. Never prefix credentials with `NEXT_PUBLIC_`.

For publication, the web example documents a fine-grained token restricted to the intended repositories, with Contents read/write, Pull requests read/write, Issues read, and Metadata read. GitHub still enforces your repository access. Configuration, eligibility, and publication limits are explained in [GitHub Issue and PR Flow](GITHUB_ISSUE_PR_FLOW.md). Restart the web server after changing its environment.

Sources: [root environment example](../.env.example), [web environment example](../apps/web/.env.example), [OpenRouter client](../src/ai/openrouter.ts), [sandbox adapter](../src/sandbox/e2b.ts), and [backend bridge](../apps/web/lib/run-backend-mission.ts).

## Start the web app

From the repository root:

```sh
cd apps/web
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Keep this process running throughout the mission. The UI submits to the local Next.js server, which starts the TypeScript backend; repository installation, tests, and candidate edits run in E2B.

### Submit a GitHub issue

1. Paste an exact public issue URL in the form, for example `https://github.com/prahans/patchverdict-divide-by-zero/issues/1`.
2. Inspect the repository, issue number, title, and plain-text body in the preview.
3. Optionally expand **Advanced verification settings**.
4. Select **Run verification**.

The example identifies the issue recorded in a selected controlled benchmark. Its current remote contents and a new run's outcome can differ from that saved evidence. Live submissions use the current repository checkout and consume provider resources.

Issue URLs must use HTTPS on `github.com`, with the `/owner/repository/issues/positive-number` path and no query, fragment, credentials, or extra path segments. Pull-request URLs and API issue responses representing pull requests are rejected. The server reloads the canonical issue at submission, so it may differ from an earlier preview. Public issue reads are unauthenticated and subject to GitHub rate limits.

### Submit a manual bug report

Choose **No GitHub issue? Use a repository and manual bug description**. Enter an HTTPS GitHub repository URL and describe the observed failure and expected behavior in 20–10,000 characters. This mode uses the same mission engine without structured issue metadata.

A controlled input preserved from the original onboarding guide is:

```text
Repository: https://github.com/prahans/patchverdict-simple-bug
Bug description: The average function returns incorrect results. average([10, 20, 30]) should return 20, average([100]) should return 100, and the implementation should correctly compute the arithmetic mean while preserving the empty-array behavior.
```

This is a suggested input, not a promise of a successful rerun. Switch between issue and manual modes before submission; advanced settings are available in both.

### Choose reproduction settings carefully

**Reproduction command** is optional, up to 2,000 characters. If omitted, the backend uses the repository's detected test script: `npm test` or `pnpm test`. An explicit command overrides the reproduction command only; the full-suite stage still uses that detected script, whose coverage depends on the repository. Commands execute in the remote repository context.

**Required failure marker** is optional, up to 1,000 characters. It is a literal, case-sensitive substring expected in combined baseline stdout/stderr, not a regular expression. Use it to identify the reported symptom; an incorrect marker can prevent baseline reproduction from being accepted. The CLI currently expects baseline exit code `1` and rejects output containing `Startup Error`. It does not invent a marker when the field is empty.

These behaviors are enforced by [input validation](../apps/web/lib/mission-input.ts), the [real mission entry point](../src/real-mission-demo.ts), the [verification plan](../src/verification/create-plan.ts), and [reproduction evaluation](../src/verification/reproduction.ts).

## Follow Mission Control and inspect evidence

Accepted submissions return HTTP 202 and immediately open `/missions/<missionId>`. Each submission creates a separate server-generated ID. Mission Control polls saved live status about once per second and shows actual backend progress events. Reloading the browser reads that persisted progress; it does not restart a mission.

When a readable proof is ready, the page refreshes into the saved evidence dashboard. Inspect the recorded repository/base commit, baseline failure, investigation, patch diff, post-patch result, full-suite result, integrity findings, and verdict where available. A completed `FAILED` verdict can still have an inspectable proof. A runner crash or timeout without a readable proof instead produces **MISSION EXECUTION FAILED**. See [Verification](VERIFICATION.md) for the distinction.

Finalized bundles live at the repository root under `output/<missionId>/`. The loader requires `proof.json` and `events.json`; investigation reports, diffs, and command evidence may be absent when a stage did not produce them. Live status lives separately in `output/.runs/`. Treat finalized artifacts as immutable while inspecting them.

Open `/benchmarks` to see the configured controlled scenarios and discovered mission history. **A fresh Git clone does not contain historical proofs:** `output/` is ignored by Git. A configured scenario without its local evidence stays unavailable. The landing page's illustrative **EXAMPLE RECORD** is not a recorded mission; a link to an actual proof is offered only when an appropriate local bundle is readable.

The web runner cleans up old output after missions: by default it retains the 30 newest finalized saved `web-` mission bundles, including failed executions, removes incomplete web mission directories older than 24 hours, and expires old live status files. Retention counts matching web mission directories with a regular `proof.json`; it does not require execution status `COMPLETED` or a passing verdict. Selected catalog entries are not exempt from cleanup. See [Benchmark Dashboard](BENCHMARK_DASHBOARD.md) for the exact selections, history limits, and private backup procedure.

## Run local quality checks

At the repository root:

```sh
pnpm typecheck
pnpm test
```

From `apps/web`:

```sh
node --test tests/*.test.mjs
pnpm exec next typegen
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

Generate Next.js route/layout types before the frontend TypeScript check, especially in a clean checkout. There is no web `test` script; CI invokes Node's test runner directly. The backend uses Vitest. These are the checks in [CI](../.github/workflows/ci.yml), not full AI repair missions or evidence of general repair reliability. They do not require paid provider calls.

The root `real:demo` script is a live mission command, not a free test. Its argument shape is:

```text
pnpm real:demo <repository-url> "<issue>" "[reproduction-command]" "[required-output]"
```

Use the web workflow for the guided experience. Do not run live demos as a substitute for local quality checks.

## Production runtime assumptions

From `apps/web`, build and start the Node server:

```sh
pnpm build
pnpm start
```

Keep the complete checkout, root and web dependencies, server environment, and writable repository-level `output/` directory available at runtime. Preserve `output/` across restarts if you want historical evidence to remain available. A static export, Edge-only host, or short-lived request host cannot provide this process/filesystem integration.

The mission route declares a five-minute maximum, and the backend bridge enforces a 270-second mission timeout. Hosting must allow the child process to continue after the submission response. There is no queue, persistent worker, or execution-resume mechanism after a server restart; saved status remains readable and abandoned runs become failed after their recorded deadline. This is an operational requirement, not evidence of a tested production deployment. Read [Security and Limitations](SECURITY_AND_LIMITATIONS.md) before exposing the server beyond a trusted environment.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Mission runner unavailable | Install root dependencies as well as web dependencies. The bridge requires root `node_modules/tsx/dist/cli.mjs` and the complete checkout. Restart the server afterward. |
| Frozen install fails on this checkout | Use the documented `--no-frozen-lockfile` install, matching CI. Do not confuse this with target repository installation: investigated pnpm repositories use a frozen install in E2B. |
| Web tests fail on module hooks or TypeScript imports | Check that the terminal is running Node 24. Installing web dependencies does not change the active Node runtime. |
| Frontend typecheck cannot find generated route types | Run `pnpm exec next typegen` in `apps/web`, then rerun `pnpm exec tsc --noEmit`. |
| Production build cannot fetch Geist fonts | The existing Next.js layout downloads Geist and Geist Mono through Google Fonts during the build. Check permitted network access to Google Fonts; this is independent of OpenRouter and E2B credentials. |
| Provider authentication or startup failure | Check root/server `OPENROUTER_API_KEY`, `E2B_API_KEY`, provider access, and network connectivity. Keep secret values out of screenshots and reports. |
| OpenRouter 429 or temporary provider failure | Model requests have bounded retries for HTTP 429/502/503/504, subject to the mission deadline. See [OpenRouter recovery](OPENROUTER_RELIABILITY.md) for routing constraints, safe error categories, and validation limits. |
| Issue preview is rejected | Use the exact issue URL format above. Check repository visibility, issue size, and GitHub's unauthenticated rate limit; manual input is available when appropriate. |
| Repository preparation fails | Check the root manifest, test script, supported lockfile, and dependency installation. Current support does not cover every public repository. |
| Failure is not reproduced | Check the expected exit code and optional literal marker. The CLI rejects output containing the exact text `Startup Error`; other unrelated failures can still match the configured conditions. Inspect the command output to establish its relevance to the report. |
| Mission exceeds its deadline | The bridge stops it after 270 seconds. Inspect saved status/evidence before choosing a smaller repository or narrower reproduction for a new run. |
| Mission cannot be saved, or evidence is missing | Check write/read permissions and the checkout's `output/` location. Existing history may have been removed by retention or may never have existed in this clone. Do not invent or edit proofs to fill gaps. |
| PR action reports configuration or eligibility error | Configure the optional token in the web environment and inspect the saved proof requirements in [GitHub Issue and PR Flow](GITHUB_ISSUE_PR_FLOW.md). Old proofs without a diff digest remain viewable but are ineligible. |

Progress, artifact loading, and runtime behavior are covered by [mission runner tests](../apps/web/tests/run-backend-mission.test.mjs), [live mission tests](../apps/web/tests/mission-live.test.mjs), [proof loader tests](../apps/web/tests/load-proof-bundle.test.mjs), and [retention tests](../apps/web/tests/mission-retention.test.mjs). A test's presence documents its intended coverage; execution results belong in the validation report for the relevant checkout.
