# Docker: local PatchVerdict demo

This Docker image runs the Next.js web server **and** the TypeScript mission runner
in one container. The backend still uses **remote E2B sandboxes**, not
Docker-in-Docker. Docker is optional: existing local Node/pnpm workflows remain
unchanged.

This setup is intended for a trusted developer machine and local hackathon
demonstrations, **not** as a hardened public multi-tenant deployment.

## Prerequisites

- Docker Desktop with Compose V2 (Windows/macOS), or Docker Engine + Compose V2 (Linux).
- Internet access during the first image build (for dependencies and Next.js fonts).
- An OpenRouter API key and an E2B API key for *running actual missions*.
  Browsing the app and existing proof bundles does not require those services.

## Start

From the repository root:

```bash
cp .env.example .env
```

Edit `.env` and set your own `OPENROUTER_API_KEY` and `E2B_API_KEY`. Do
not commit this file. Optional PR publishing requires
`PATCHVERDICT_GITHUB_TOKEN` in this same root `.env`; it is only supplied
to the server and is not necessary for verifying public issues.

Make sure the repository root has an `output/` directory. It may already
contain the seven controlled benchmark runs. Do not delete or rename any
existing proof bundles.

```bash
mkdir -p output
docker compose up --build -d
docker compose ps
```

Open **http://localhost:3000** to use PatchVerdict and
**http://localhost:3000/benchmarks** to view the saved benchmark evidence.

```bash
docker compose logs -f patchverdict
```

The first image build may take several minutes. The app starts only after
both the backend and frontend dependencies and the production Next.js build
are available.

## Stop or rebuild

```bash
docker compose down
docker compose up --build -d
```

`docker compose down` does **not** remove the host's `./output` directory.
The Compose file mounts this directory at `/app/output` inside the
container. New web missions write evidence into the same host folder, so
regular local runs and Docker runs share their saved history.

Avoid stopping/rebuilding the container while a mission is running. The
backend may be terminated before it can publish a complete proof.

## Important limitations

- The container does **not** include API keys in its built image. Credentials
  come from `.env` at **run time** through Compose. Never put keys in build
  arguments, source files, or Dockerfiles.
- The port is bound to `127.0.0.1:3000` on the host, not publicly exposed.
  Public deployment, authentication, TLS, and external access require a
  separate security review.
- The app runs as the non-root `node` user. Linux bind-mounted `output/`
  must be writable by the container user (typically UID 1000). If mission
  output cannot be saved, check directory ownership and permissions before
  changing them; preserve existing proofs.
- Repository checkout and backend dependencies remain in the runtime image
  because the server starts `src/real-mission-demo.ts` with `tsx`. Removing
  backend sources or dev dependencies from the image breaks real missions.
- The seven benchmark IDs are configured in code, but their **proof bundles
  are local files**, not checked into Git. On another machine, transfer a
  verified backup of the evidence to `output/` if you want the same dashboard
  results. Keep sensitive proofs in private storage.
- The application still enforces its retention policy for completed
  `web-...` missions (currently the newest **30**). Pinning a mission in the
  benchmark catalog does not exempt its proof from cleanup: keep backups.
- This is **container packaging**, not automatic deployment (CD). Docker does
  not automatically run PatchVerdict's AI missions or CI tests.
- The repository currently has incomplete committed pnpm lockfiles, so the
  build installs with `--no-frozen-lockfile`. Once both application lockfiles
  are regenerated and committed, switch to frozen installs for reproducibility.

## Validate the image manually

```bash
docker compose build
docker compose up -d
docker compose ps
```

A healthy container should serve the landing page and `/benchmarks`.
Test a mission through the web interface only after confirming that the
required API keys are set. Do not run a paid AI mission as part of CI.

The separate Docker image-build GitHub Actions workflow checks that the
image can be built, but it does not start the app, use credentials, or publish
images to a registry.
