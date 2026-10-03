# PatchVerdict Mission Control

Mission Control renders the proof artifacts produced by the PatchVerdict backend. It does not execute missions or contact model or sandbox providers.

## Run locally

From `apps/web`:

```sh
pnpm dev
```

Open http://localhost:3000. The page loads `output/fixture-divide-zero` from the repository root, resolved relative to the app's working directory. Keep that directory available when using `pnpm start` too; this is a local filesystem integration, not a static export.

The existing bundle is sufficient. If you need a new mission, use the repository's existing backend workflow separately. Next.js never starts it.

## Data boundary

`proof.json` and `events.json` → server-only `loadProofBundle()` → `MissionViewModel` → existing UI components.

The loader validates the serialized bundle and accepts mission IDs containing only letters, numbers, underscores, and hyphens. It reads fixed artifact filenames, not paths supplied by the proof document. The frontend maintains its own types in `lib/mission-types.ts` and imports no engine code.

Required files:

- `proof.json`
- `events.json`

Optional files:

- `investigation.md`
- `patch.diff`
- `evidence/baseline-test.json`
- `evidence/post-patch-test.json`
- `evidence/full-suite.json`

Missing optional artifacts render unavailable states. Malformed optional artifacts are reported and excluded; missing or malformed required files render a descriptive bundle error. A saved verdict is displayed as recorded, never computed by the AI or frontend. Missing metadata, including investigation iterations in older bundles, is not invented.

The page reads files on each request. After editing an artifact or producing a new bundle, reload the page to see the new values. There is no polling or live execution API.

## Checks

From `apps/web`:

```sh
node --test tests/load-proof-bundle.test.mjs
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

The loader tests use Node.js 24 and isolated temporary proof bundles. They do not modify the real backend artifacts.