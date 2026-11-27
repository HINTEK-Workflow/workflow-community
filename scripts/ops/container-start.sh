#!/bin/sh
# Start of the app container (security review 2026-10-04): the storage is given to the unprivileged user "node", then
# the migrations and the app run as that user, never as root. Started as another user (for example by an orchestrator
# that sets one), it skips the hand-over and starts directly.
#
#   container-start            migrate deploy, the schema guard, then the app (the image's CMD)
#   container-start migrate    only migrate deploy, then exit (deploy.sh's separate migration step, 2026-10-28)
#
# Migreringssäkerhet (2026-10-28): migrate deploy runs with lock_timeout MIGRATE_LOCK_TIMEOUT (10s) and
# statement_timeout MIGRATE_STATEMENT_TIMEOUT (5min), passed to Postgres by prisma.config.ts, and the whole run is
# stopped after MIGRATE_TOTAL_TIMEOUT (15m). Postgres runs each migration file in one transaction, so a stopped or
# failed migration leaves that file's changes out; Prisma marks it failed and later deploys stop until it is resolved
# (docs/drift/MIGRERING-OCH-ATERSTALLNING.md). Before the app starts, scripts/ops/schema-guard.ts refuses to start it
# when a migration of this image is missing or one is failed/half done. At a normal start the migrations were already
# applied by deploy.sh, so migrate deploy is a no-op there and stays as a safety net.
#
# D3 (granskningen 2026-10-20): the storage is on NFS, and a chown -R of every file at every start grows slow with the
# files. It now only runs when something is not node's: find stops at the first file with another owner or group, so
# when everything already belongs to node nothing is written. If find itself fails, chown runs as before.
# STORAGE_CHOWN=never skips the check entirely (an export with root_squash, where root may not change owners; the files
# must then be node's from the server side).
set -eu
MODE="${1:-start}"
case "$MODE" in start|migrate) ;; *) echo "container-start: unknown mode $MODE (start|migrate)" >&2; exit 64 ;; esac
export MIGRATE_LOCK_TIMEOUT="${MIGRATE_LOCK_TIMEOUT:-10s}"
export MIGRATE_STATEMENT_TIMEOUT="${MIGRATE_STATEMENT_TIMEOUT:-5min}"
export MIGRATE_TOTAL_TIMEOUT="${MIGRATE_TOTAL_TIMEOUT:-15m}"
MIGRATE='timeout --kill-after=30s "$MIGRATE_TOTAL_TIMEOUT" npx prisma migrate deploy'
GUARD='npx tsx scripts/ops/schema-guard.ts'
if [ "$MODE" = "migrate" ]; then
  RUN="$MIGRATE"
else
  # The app is node itself (review G-14/G-31, 2026-11-24): no npm process in between, so nothing asks the npm registry.
  # It is the same command as "npm run start" (package.json: next start).
  RUN="$MIGRATE && $GUARD && exec node node_modules/next/dist/bin/next start"
fi

if [ "$(id -u)" = "0" ]; then
  if [ "$MODE" = "start" ]; then
    storage="${STORAGE_ROOT:-/app/storage}"
    mkdir -p "$storage"
    # Serveruppdateringar (2026-10-25): .host-status/ is the database server's status file, written by its root and only
    # read by the app, so it stays root's: left out of the check and of the hand-over.
    if [ "${STORAGE_CHOWN:-auto}" != "never" ]; then
      if ! wrong="$(find "$storage" -path "$storage/.host-status" -prune -o \( ! -user node -o ! -group node \) -print -quit)"; then wrong="(find failed)"; fi
      if [ -n "$wrong" ]; then
        echo "container-start: the storage has files that are not node's; chown node:node (all but .host-status)"
        find "$storage" -path "$storage/.host-status" -prune -o -exec chown -h node:node {} +
      fi
    fi
  fi
  exec setpriv --reuid=node --regid=node --init-groups --inh-caps=-all --bounding-set=-all sh -c "$RUN"
fi
exec sh -c "$RUN"
