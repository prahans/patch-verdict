# Public Showcase UI

The `feat/public-showcase-ui` branch is intended for the public AWS
showcase. It changes only presentation: the landing page displays a saved
evidence panel instead of the verification form, all public entry points
link to benchmarks, and saved mission pages hide PR-creation buttons.

The full AI repair engine, verification and verdict logic, mission API
handlers, saved proofs, nine-scenario catalog, and infrastructure config
are **unchanged**. There is no demo-mode environment variable required to
show the new UI.

## Important: the host still controls write access

**UI changes do not prevent direct API calls.** The existing
`POST /api/missions` and `POST /api/missions/<missionId>/pull-request`
handlers still exist and are not modified by this branch.

Before publishing, confirm Caddy blocks both write endpoints even when
called directly, and confirm that the Next.js listener port is not publicly
reachable around Caddy. This branch does not test or modify Caddy rules.
If either write endpoint can be reached, UI-only restrictions are **not**
a safe substitute for server-side authorization.

## Deployment notes

Switch your EC2 checkout to `origin/feat/public-showcase-ui`, build the
web app, then restart your existing PatchVerdict systemd service. Preserve
`output/` and your private environment files. The nine selected benchmark
proof directories are ignored by Git; any missing bundles will be shown
as unavailable. Nothing is automatically transferred from the local PC.

For the interactive app, continue using `main` locally. Branch-only UI
changes have no effect on that branch.
