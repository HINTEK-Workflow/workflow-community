# Multi-stage build (T4 and D3, granskningen 2026-10-20; 2026-10-24):
#   deps-build    every package (the build needs Tailwind, ESLint's Next config, TypeScript …)
#   deps-runtime  only the runtime packages: npm ci --omit=dev, so the development tools (and the vulnerable packages
#                 in them, S7) are not in the production image. prisma (migrate deploy at start) and tsx (the
#                 scheduled jobs, npm run <job>) are dependencies in package.json; typescript stays as an optional peer.
#   build         next build + scripts/sitemap/generate.cjs (npm run build), with placeholder values only
#   runtime       the image that runs: runtime packages, the sources (jobs and migrations read them) and .next
# The package steps only depend on package.json, package-lock.json, prisma.config.ts, lib/database-url.ts and
# prisma/schema.prisma, so an ordinary code change reuses them from the build cache, and the npm cache mount keeps
# downloaded packages between builds (deploy.sh no longer empties the whole build cache after each release).
# BuildKit is required (COPY --chmod and RUN --mount); it is the default builder since Docker 23.
#
# The base image is locked to a digest (supply-chain review 2026-11-24, P5): the same Dockerfile always builds on the same
# operating system packages, and a changed upstream tag cannot slip in unnoticed. The digest is the multi-platform index,
# so amd64 and arm64 both work. Update it on purpose (monthly, and at security notices), then run the full test round:
#   docker buildx imagetools inspect node:22-bookworm-slim     (the "Digest:" line)

FROM node:22-bookworm-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# npm never asks the registry for a newer npm (review G-31): nothing in the image contacts anyone by itself.
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
# apt-get upgrade (K4.3, 2026-11-28): Debian's security fixes are taken in at every build even before the locked node image
# is rebuilt upstream, so the mandatory Trivy image scan does not stop on fixed system packages (libpam, libzstd).
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# What npm ci needs: the package files, and for its postinstall (prisma generate) the schema and prisma.config.ts,
# which translates DATABASE_URL for the CLI (2026-10-05) through lib/database-url.ts.
FROM base AS deps-build
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY lib/database-url.ts ./lib/database-url.ts
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci

FROM base AS deps-runtime
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY lib/database-url.ts ./lib/database-url.ts
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --omit=dev

FROM deps-build AS build
COPY . .
# Types were checked by the release workflow before this build (see next.config.ts); the server's memory does not fit a
# second full type check of the whole app (v0.6.4: out of memory, heap limit about 2 GB). v0.54.0 ran out of the default ~2 GB heap
# in the build itself; the server has 4 GB memory and 5 GB swap, so the build gets 3 GB. Since 2026-11-10 the image is built on
# the release computer and shipped finished (docs/drift/BYGGE_LOKALT.md); 3 GB stays so that the emergency build on the server fits.
# .next/cache is webpack's build cache (about 2 GB); next start never needs it (it creates .next/cache/images itself when it
# optimises an image), so it is removed here and is neither in the image nor in the transfer to the server.
RUN CI=1 \
  NODE_OPTIONS=--max-old-space-size=3072 \
  RAYON_NUM_THREADS=1 \
  APP_URL=http://127.0.0.1:3000 \
  AUTH_SECRET=build-only-placeholder-not-for-runtime-123456789 \
  DATABASE_URL=postgresql://build:build@127.0.0.1:5432/kfid_v3_test \
  SEED_ADMIN_PASSWORD=build-only-placeholder \
  SKIP_BUILD_TYPECHECK=1 \
  npm run build \
  && rm -rf .next/cache

FROM base AS runtime
ENV PORT=3000
ENV NODE_ENV=production
COPY --from=deps-runtime /app/node_modules ./node_modules
COPY . .
# .next belongs to "node" (next start writes its image cache there); --chown avoids a second copy of it in a layer.
COPY --from=build --chown=node:node /app/.next ./.next

# The server's checkout can be readable by root only (umask 077), and COPY keeps those modes; the app runs as "node"
# and must read its own sources (v0.4.14 stopped at prisma/schema.prisma). node_modules is left out: npm ci wrote it
# readable, and touching it would copy the whole tree into a new layer; .next was written readable by the build stage.
RUN find /app \( -path /app/node_modules -o -path /app/.next \) -prune -o -exec chmod a+rX {} +

# The app runs as the unprivileged user "node", not root (security review 2026-10-04). The container starts as root only
# to give the mounted storage to "node" when its owner is wrong (an older installation's files are root's), then drops
# every privilege with setpriv before the migrations and the app start. Nothing has to be done by hand when updating.
COPY --chmod=0755 scripts/ops/container-start.sh /usr/local/bin/container-start
#
# Why there is no "USER node" line (review G-26, 2026-11-24): the start must be root for a moment to hand an older
# installation's root-owned storage to "node" (above). Everything else runs as node: the app and the migrations through
# setpriv, and the scheduled jobs, the alerts and the admin commands through "docker compose exec --user node"
# (scripts/ops/run-job.sh, scripts/ops/monitor.sh, install.sh, install.ps1).
#
# Why npm stays in the image (review G-14): the scheduled jobs and the admin commands are npm scripts (npm run <job>,
# npx prisma, npx tsx), also in the published installation guide. The app itself starts with node directly
# (container-start), and npm's update check is off (NPM_CONFIG_UPDATE_NOTIFIER above).

EXPOSE 3000

# Docker's own health status (review G-26): the cheap liveness answer, no database query. It restarts nothing; deploy.sh and
# install.sh keep their own readiness checks on /api/health/ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

CMD ["container-start"]
