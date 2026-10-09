# PatchVerdict

The landing page launches the existing PatchVerdict CLI and opens the proof dashboard for its saved result. The backend investigation, verification, and verdict logic remain authoritative.

## Run locally

Install dependencies at both the repository root and in `apps/web` if they are missing. Use Node.js 24 or later for the included web tests.

```sh
pnpm install
cd apps/web
pnpm install
pnpm dev
```

Configure `E2B_API_KEY` and `OPENROUTER_API_KEY` in the repository root `.env` (see `.env.example`). `AGENT_MODEL` is optional. The backend loads that file with its existing dotenv setup; credentials stay on the server.

Open http://localhost:3000. Enter a GitHub repository URL, bug description, reproduction command, and optional failure marker. The form remains disabled while the mission runs and opens `/missions/<missionId>` when the saved bundle is ready. Failures keep the inputs available for retry.

## Execution and data boundary

`POST /api/missions` validates the JSON input, then `runBackendMission()` launches Node with the root-installed `tsx/dist/cli.mjs` and the fixed `src/real-mission-demo.ts` entry point. Each input is a separate argument; the bridge does not evaluate a shell command. The reproduction command is data for the existing sandbox backend.

The CLI writes `output/<missionId>` and prints its mission ID. The bridge validates that the actual proof bundle can be loaded before returning `{ missionId }`. A saved mission with execution or verdict `FAILED` still opens its dashboard. A process failure without a usable saved bundle is an API error.

The server reads the saved proof with `loadProofBundle(missionId)` on each dashboard request, including a refresh. The loader uses fixed artifact filenames, safe mission IDs, and real-path containment. The frontend displays the recorded verdict without recomputing it. The landing page links a proof example only when a readable real repository bundle exists locally. Its illustrative HTML proof preview is separately labeled EXAMPLE PROOF.

Keep the complete checkout, root dependencies, and writable `output` directory available to the Node server in both development and production (`pnpm build`, then `pnpm start`). This filesystem/process integration requires a Node host capable of running missions for up to five minutes; a static export or short-lived Edge runtime cannot run it. Existing proof bundles can still be opened directly.

Required proof files are `proof.json` and `events.json`. Investigation, diff, and execution evidence files are optional when the backend did not produce them.

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
4. Use `npm test` and the failure marker `expected`.
5. Click Run verification. Confirm fields and submit are disabled while the real mission runs.
6. Confirm the page opens `/missions/<actual-mission-id>` and shows the actual repository, base commit, investigation, Git diff, execution evidence, and recorded verdict (including a failed verdict).
7. Refresh that URL to confirm the same saved proof loads. Use New mission to return to `/#verify`, and the brand to return to `/`.
8. Submit an invalid repository URL to confirm an accessible error and preserved inputs.
