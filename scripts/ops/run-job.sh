#!/usr/bin/env bash
# Runs one of Workflow's scheduled jobs inside the app container (drift, 2026-09-30), one at a time per job
# (a lock), with a timestamped log and a success/failure marker that scripts/ops/monitor.sh watches.
#
#   ./scripts/ops/run-job.sh history:retention
#   ./scripts/ops/run-job.sh history:retention --dry-run   (T5, 2026-10-24: only the jobs that delete or send – prints
#        what they would do to the terminal; no log line, no success/failure marker)
#
# Environment: COMPOSE_PROJECT (workflow) · APP_SERVICE (app) · STATE_DIR (/var/lib/workflow)
#              LOG_DIR (/var/log/workflow)
set -Euo pipefail
umask 027

readonly COMPOSE_PROJECT="${COMPOSE_PROJECT:-workflow}"
readonly APP_SERVICE="${APP_SERVICE:-app}"
readonly STATE_DIR="${STATE_DIR:-/var/lib/workflow}"
readonly LOG_DIR="${LOG_DIR:-/var/log/workflow}"
readonly JOB="${1:-}"
readonly MODE="${2:-}"

# Only the known jobs – never an arbitrary command.
case "$JOB" in
  billing:email|billing:delinquency|billing:card-retries|rounds:reminders|history:retention|integrity:check|credits:check|ai:digest|keys:alerts|secrets:sync|mailings:send|notices:send|companies:closure|register:sync|maintenance:plans|schedule:publish|machine:rules|machine:alarms) ;;
  *) printf 'ERROR: unknown job %s\n' "$JOB" >&2; exit 2 ;;
esac
# A dry run only for the jobs that have one; nothing else may follow the job's name.
case "$MODE" in
  "") ;;
  --dry-run)
    case "$JOB" in
      history:retention|companies:closure|mailings:send|notices:send|schedule:publish) ;;
      *) printf 'ERROR: %s has no --dry-run\n' "$JOB" >&2; exit 2 ;;
    esac ;;
  *) printf 'ERROR: unknown argument %s\n' "$MODE" >&2; exit 2 ;;
esac
[[ $# -le 2 ]] || { printf 'ERROR: too many arguments\n' >&2; exit 2; }
readonly NAME="${JOB//:/-}"
mkdir -p "$STATE_DIR" "$LOG_DIR"

if command -v flock >/dev/null 2>&1; then
  exec 9>"$STATE_DIR/$NAME.lock"
  if ! flock -n 9; then
    printf '%s %s already running\n' "$(date -u +%FT%TZ)" "$JOB" >> "$LOG_DIR/$NAME.log"
    exit 0
  fi
fi

if [[ "$MODE" == "--dry-run" ]]; then
  # Under the same lock as the real run, so the two never overlap; the output goes to the terminal only.
  docker compose -p "$COMPOSE_PROJECT" exec -T "$APP_SERVICE" npm run --silent "$JOB" -- --dry-run
  exit $?
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
