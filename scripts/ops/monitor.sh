#!/usr/bin/env bash
# Watches HINTEK Workflow in production (drift, 2026-09-30) and e-mails the operations address when something is wrong:
# readiness (database and file storage), the TLS certificate, disk space, the nightly backup and the scheduled jobs.
# Alerts go out when the state changes and at most every six hours while it stays wrong, through the app's own SMTP
# settings (npm run ops:alert). Run every five minutes from cron.
#
# Environment: APP_URL (https://workflow.hintek.se) · COMPOSE_PROJECT (workflowhintekse) · APP_SERVICE (app)
#   STATE_DIR (/var/lib/hintek-workflow) · STORAGE_PATH (/opt/workflow.hintek.se/storage) · BACKUP_MAX_AGE_HOURS (26)
#   DISK_MAX_PERCENT (85) · CERT_MIN_DAYS (14) · DRY_RUN (1 = print only)
set -Euo pipefail

readonly APP_URL="${APP_URL:-https://workflow.hintek.se}"
readonly COMPOSE_PROJECT="${COMPOSE_PROJECT:-workflowhintekse}"
readonly APP_SERVICE="${APP_SERVICE:-app}"
readonly STATE_DIR="${STATE_DIR:-/var/lib/hintek-workflow}"
readonly STORAGE_PATH="${STORAGE_PATH:-/opt/workflow.hintek.se/storage}"
readonly BACKUP_MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-26}"
readonly DISK_MAX_PERCENT="${DISK_MAX_PERCENT:-85}"
readonly CERT_MIN_DAYS="${CERT_MIN_DAYS:-14}"
readonly DRY_RUN="${DRY_RUN:-0}"
mkdir -p "$STATE_DIR"

problems=()
age_hours() {
  local stamp seconds
  stamp="$(cat "$1" 2>/dev/null)" || { echo 99999; return; }
  seconds="$(date -u -d "$stamp" +%s 2>/dev/null)" || { echo 99999; return; }
  echo $(( ( $(date -u +%s) - seconds ) / 3600 ))
}
send() {
  local subject="$1" body="$2"
  if [[ "$DRY_RUN" == 1 ]]; then
    printf 'DRY RUN – %s:\n%s\n' "$subject" "$body"
  else
    printf '%s' "$body" | docker compose -p "$COMPOSE_PROJECT" exec -T "$APP_SERVICE" npm run --silent ops:alert -- "$subject" \
      || printf 'Larmet kunde inte skickas: %s\n%s\n' "$subject" "$body" >&2
  fi
}

# 1. Readiness: the database answers and the storage is writable.
ready="$(curl -fsS --max-time 10 "${APP_URL%/}/api/health/ready" 2>/dev/null || true)"
if [[ "$ready" != *'"status":"ok"'* ]]; then
  problems+=("Appen svarar inte klar på ${APP_URL%/}/api/health/ready (databas eller lagring).")
fi

# 2. TLS certificate (only for https).
if [[ "$APP_URL" == https://* ]] && command -v openssl >/dev/null 2>&1; then
  host="${APP_URL#https://}"
  host="${host%%/*}"
  end="$(echo | openssl s_client -servername "$host" -connect "$host:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
  if [[ -n "$end" ]]; then
    days=$(( ( $(date -u -d "$end" +%s) - $(date -u +%s) ) / 86400 ))
    if (( days < CERT_MIN_DAYS )); then problems+=("TLS-certifikatet för $host går ut om $days dagar."); fi
  else
    problems+=("TLS-certifikatet för $host kunde inte läsas.")
  fi
fi

# 3. Disk space where the files are.
if [[ -d "$STORAGE_PATH" ]]; then
  used="$(df -P "$STORAGE_PATH" | awk 'NR==2 {gsub("%","",$5); print $5}')"
  if [[ "$used" =~ ^[0-9]+$ ]] && (( used >= DISK_MAX_PERCENT )); then
    problems+=("Disken med filerna är $used % full (gräns $DISK_MAX_PERCENT %).")
  fi
fi

# 4. Nightly backup and scheduled jobs: last success recent enough, no newer failure.
backup_age="$(age_hours "$STATE_DIR/backup.last-success")"
if (( backup_age > BACKUP_MAX_AGE_HOURS )); then
  problems+=("Senaste lyckade backup är ${backup_age} timmar gammal (eller saknas).")
fi
for job in backup billing-email billing-delinquency billing-card-retries rounds-reminders history-retention integrity-check ai-digest keys-alerts; do
  failure="$STATE_DIR/$job.last-failure"
  success="$STATE_DIR/$job.last-success"
  if [[ -f "$failure" ]] && { [[ ! -f "$success" ]] || [[ "$failure" -nt "$success" ]]; }; then
    problems+=("Det schemalagda jobbet $job misslyckades senast $(cat "$failure").")
  fi
done

# Alert on change, and every six hours while a problem remains; say when it is fixed.
previous="$(cat "$STATE_DIR/monitor.state" 2>/dev/null || true)"
last_alert="$(cat "$STATE_DIR/monitor.last-alert" 2>/dev/null || echo 0)"
now="$(date -u +%s)"
if (( ${#problems[@]} )); then
  summary="$(printf '%s\n' "${problems[@]}")"
  if [[ "$summary" != "$previous" ]] || (( now - last_alert >= 21600 )); then
    send "Driftproblem (${#problems[@]})" "$(printf 'Problem upptäckta %s:\n\n%s\n\nKontrollera enligt docs/drift/INCIDENTRUTIN.md.' "$(date -u +%FT%TZ)" "$summary")"
    echo "$now" > "$STATE_DIR/monitor.last-alert"
  fi
  printf '%s' "$summary" > "$STATE_DIR/monitor.state"
  exit 1
fi
if [[ -n "$previous" ]]; then
  send "Åtgärdat" "Allt fungerar igen $(date -u +%FT%TZ)."
fi
: > "$STATE_DIR/monitor.state"
echo "OK $(date -u +%FT%TZ)"
