# syntax=docker/dockerfile:1

# The web server launches the backend using /app/node_modules/tsx and /app/src.
# Both projects must be installed; a web-only image cannot execute missions.
FROM node:24-bookworm-slim AS build

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm install --global pnpm@12.8.1

# PatchVerdict and apps/web are independent pnpm projects.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --no-frozen-lockfile

COPY apps/web/package.json apps/web/pnpm-lock.yaml apps/web/pnpm-workspace.yaml ./apps/web/
RUN cd apps/web && pnpm install --no-frozen-lockfile

# .dockerignore excludes local secrets, existing proof bundles, and host modules.
COPY . .

RUN cd apps/web && pnpm exec next typegen && pnpm build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

WORKDIR /app
# Keep root devDependencies: the mission runner needs the tsx CLI at runtime.
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/output && chown node:node /app/output

USER node
WORKDIR /app/apps/web

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
