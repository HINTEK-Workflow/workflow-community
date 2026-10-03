#!/usr/bin/env bash
# Runs one of HINTEK Workflow's scheduled jobs inside the app container (drift, 2026-09-30), one at a time per job
# (a lock), with a timestamped log and a success/failure marker that scripts/ops/monitor.sh watches.
#
#   ./scripts/ops/run-job.sh history:retention
#
# Environment: COMPOSE_PROJECT (workflowhintekse) · APP_SERVICE (app) · STATE_DIR (/var/lib/hintek-workflow)
#              LOG_DIR (/var/log/hintek-workflow)
set -Euo pipefail
umask 027

readonly COMPOSE_PROJECT="${COMPOSE_PROJECT:-workflowhintekse}"
readonly APP_SERVICE="${APP_SERVICE:-app}"
readonly STATE_DIR="${STATE_DIR:-/var/lib/hintek-workflow}"
readonly LOG_DIR="${LOG_DIR:-/var/log/hintek-workflow}"
readonly JOB="${1:-}"

# Only the known jobs – never an arbitrary command.
case "$JOB" in
  billing:email|billing:delinquency|billing:card-retries|rounds:reminders|history:retention|integrity:check|ai:digest|keys:alerts|mailings:send) ;;
  *) printf 'ERROR: unknown job %s\n' "$JOB" >&2; exit 2 ;;
esac
readonly NAME="${JOB//:/-}"
mkdir -p "$STATE_DIR" "$LOG_DIR"

if command -v flock >/dev/null 2>&1; then
  exec 9>"$STATE_DIR/$NAME.lock"
  if ! flock -n 9; then
    printf '%s %s already running\n' "$(date -u +%FT%TZ)" "$JOB" >> "$LOG_DIR/$NAME.log"
    exit 0
  fi
fi

{
  printf '=== %s %s\n' "$(date -u +%FT%TZ)" "$JOB"
  docker compose -p "$COMPOSE_PROJECT" exec -T "$APP_SERVICE" npm run --silent "$JOB"
} >> "$LOG_DIR/$NAME.log" 2>&1
status=$?
if [[ $status -eq 0 ]]; then
  date -u +%FT%TZ > "$STATE_DIR/$NAME.last-success"
else
  date -u +%FT%TZ > "$STATE_DIR/$NAME.last-failure"
  printf '%s %s failed with %s\n' "$(date -u +%FT%TZ)" "$JOB" "$status" >> "$LOG_DIR/$NAME.log"
fi
exit $status
