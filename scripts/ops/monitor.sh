#!/usr/bin/env bash
# Watches Workflow in production (drift, 2026-09-30) and e-mails the operations address when something is wrong:
# readiness (database and file storage), the TLS certificate, disk space, the nightly backup and the scheduled jobs.
# Alerts go out when the state changes and at most every six hours while it stays wrong, through the app's own SMTP
# settings (npm run ops:alert). Run every five minutes from cron.
#
# Environment: APP_URL (required; without it the APP_URL line of .env in the working directory) · COMPOSE_PROJECT (workflow) · APP_SERVICE (app)
#   STATE_DIR (/var/lib/workflow) · STORAGE_PATH (/opt/workflow/storage) · BACKUP_MAX_AGE_HOURS (26)
#   DISK_MAX_PERCENT (85) · CERT_MIN_DAYS (14) · DRY_RUN (1 = print only)
#   CERT_EXTRA_HOSTS ("" – e.g. "example.com") · DB_TLS_ADDR ("" – e.g. 10.0.0.10:5432) · DB_CERT_MIN_DAYS (60)
#   OFFSITE_MAX_AGE_HOURS (168: the newest copy of the backups outside db-server, when db-server reports one)
#   HC_PING_FILE (/etc/workflow/healthcheck-url: one line, a dead man's switch ping address, root 0600)
#
# D1 (granskningen 2026-10-20): the e-mail goes through the app's container, so it cannot reach anyone when the app is
# down. With HC_PING_FILE every run also pings an external dead man's switch (healthchecks.io or the same software run
# elsewhere, docs/drift/BEVAKNING_EXTERN.md): "ok" when all is well, "/fail" with the problem lines when not. The
# service e-mails on its own when the pings say fail or stop coming (the server or its network is down).
set -Euo pipefail

# No installation's address as a default (2026-11-10): the app's own address, from the environment or the app's .env.
APP_URL="${APP_URL:-$(sed -n 's/^APP_URL=//p' .env 2>/dev/null | tail -n 1 | tr -d '"\r'"'")}"
if [[ -z "$APP_URL" ]]; then
  echo "monitor.sh: APP_URL saknas. Sätt APP_URL eller kör skriptet i mappen med appens .env." >&2
  exit 2
fi
readonly APP_URL
readonly COMPOSE_PROJECT="${COMPOSE_PROJECT:-workflow}"
readonly APP_SERVICE="${APP_SERVICE:-app}"
readonly STATE_DIR="${STATE_DIR:-/var/lib/workflow}"
readonly STORAGE_PATH="${STORAGE_PATH:-/opt/workflow/storage}"
readonly BACKUP_MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-26}"
readonly DISK_MAX_PERCENT="${DISK_MAX_PERCENT:-85}"
readonly CERT_MIN_DAYS="${CERT_MIN_DAYS:-14}"
readonly CERT_EXTRA_HOSTS="${CERT_EXTRA_HOSTS:-}"
readonly DB_TLS_ADDR="${DB_TLS_ADDR:-}"
readonly DB_CERT_MIN_DAYS="${DB_CERT_MIN_DAYS:-60}"
readonly OFFSITE_MAX_AGE_HOURS="${OFFSITE_MAX_AGE_HOURS:-168}"
readonly HC_PING_FILE="${HC_PING_FILE:-/etc/workflow/healthcheck-url}"
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
# D1: the dead man's switch outside the app. $1 ok|fail, $2 the text (problem lines only, never secrets or customer data).
hc_ping() {
  local url
  [[ -r "$HC_PING_FILE" ]] || return 0
  url="$(head -n 1 "$HC_PING_FILE" | tr -d '[:space:]')"
  [[ "$url" == https://* ]] || return 0
  [[ "$1" == fail ]] && url="${url%/}/fail"
  if [[ "$DRY_RUN" == 1 ]]; then printf 'DRY RUN – ping %s\n' "$1"; return 0; fi
  printf '%s' "$2" | curl -fsS --max-time 10 --retry 3 --data-binary @- -o /dev/null "$url" \
    || printf 'Pingen till bevakningen kunde inte skickas (%s).\n' "$1" >&2
}

# 1. Readiness: the database answers and the storage is writable.
ready="$(curl -fsS --max-time 10 "${APP_URL%/}/api/health/ready" 2>/dev/null || true)"
if [[ "$ready" != *'"status":"ok"'* ]]; then
  problems+=("Appen svarar inte klar på ${APP_URL%/}/api/health/ready (databas, migreringar eller lagring).")
fi

# 2. TLS certificates: the app (only for https), the extra public names in CERT_EXTRA_HOSTS (D4: example.com) and the
# database server's own certificate through Postgres STARTTLS (DB_TLS_ADDR, for example 10.0.0.10:5432; made by hand
# with 730 days from 2026-10-04, so it is warned about DB_CERT_MIN_DAYS before).
cert_check() { # $1 label, $2 host, $3 host:port, $4 minimum days, $5 optional s_client -starttls protocol
  local end days starttls=()
  [[ -n "${5:-}" ]] && starttls=(-starttls "$5")
  end="$(echo | timeout 20 openssl s_client "${starttls[@]}" -servername "$2" -connect "$3" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
  if [[ -n "$end" ]]; then
    days=$(( ( $(date -u -d "$end" +%s) - $(date -u +%s) ) / 86400 ))
    if (( days < $4 )); then problems+=("TLS-certifikatet för $1 går ut om $days dagar."); fi
  else
    problems+=("TLS-certifikatet för $1 kunde inte läsas.")
  fi
}
if command -v openssl >/dev/null 2>&1; then
  if [[ "$APP_URL" == https://* ]]; then
    host="${APP_URL#https://}"
    host="${host%%/*}"
    cert_check "$host" "$host" "$host:443" "$CERT_MIN_DAYS"
  fi
  for extra in $CERT_EXTRA_HOSTS; do cert_check "$extra" "$extra" "$extra:443" "$CERT_MIN_DAYS"; done
  if [[ -n "$DB_TLS_ADDR" ]]; then cert_check "databasservern ($DB_TLS_ADDR)" "${DB_TLS_ADDR%:*}" "$DB_TLS_ADDR" "$DB_CERT_MIN_DAYS" postgres; fi
fi

# 3. Disk space where the files are.
if [[ -d "$STORAGE_PATH" ]]; then
  used="$(df -P "$STORAGE_PATH" | awk 'NR==2 {gsub("%","",$5); print $5}')"
  if [[ "$used" =~ ^[0-9]+$ ]] && (( used >= DISK_MAX_PERCENT )); then
    problems+=("Disken med filerna är $used % full (gräns $DISK_MAX_PERCENT %).")
  fi
fi

# 4. Nightly backup and scheduled jobs: last success recent enough, no newer failure.
# Backup only on the database server (2026-10-13): with BACKUP_GATE_HOST (in the environment or the production .env, the
# only key read from it) the nightly backups of the database and the files are checked on that server, at most once an
# hour through db-backup-remote.sh; without it, the marker of nightly-backup.sh on this server as before.
gate="${BACKUP_GATE_HOST:-$(sed -n 's/^BACKUP_GATE_HOST=//p' .env 2>/dev/null | tail -n 1 | tr -d "\"'")}"
backup_jobs="backup"
if [[ -n "$gate" ]]; then
  backup_jobs=""
  remote="$STATE_DIR/backup-remote.status"
  if [[ ! -f "$remote" ]] || (( $(date +%s) - $(stat -c %Y "$remote") >= 3300 )); then
    if BACKUP_GATE_HOST="$gate" timeout 60 "${BACKUP_GATE_CLIENT:-/opt/workflow/db-backup-remote.sh}" status > "$remote.tmp" 2>/dev/null; then mv -f "$remote.tmp" "$remote"; else rm -f "$remote.tmp"; fi
  fi
  if [[ ! -f "$remote" ]] || (( $(date +%s) - $(stat -c %Y "$remote") >= 7200 )); then
    problems+=("Backupstatus från databasservern har inte kunnat läsas på över två timmar.")
  else
    for part in db files; do
      label="$([[ $part == db ]] && echo databasen || echo filerna)"
      result="$(sed -n "s/^$part\.result=//p" "$remote")"
      sed -n "s/^$part\.time=//p" "$remote" > "$STATE_DIR/backup-remote.$part.time"
      part_age="$(age_hours "$STATE_DIR/backup-remote.$part.time")"
      if [[ "$result" != ok ]]; then problems+=("Senaste nattbackupen av $label på databasservern misslyckades (${result:-saknas}).")
      elif (( part_age > BACKUP_MAX_AGE_HOURS )); then problems+=("Senaste nattbackupen av $label på databasservern är ${part_age} timmar gammal."); fi
    done
    # D2: the copy outside db-server (scripts/drift/backup-offsite.sh). Only checked once db-server reports it
    # ("offsite.result" is missing until it is installed, docs/drift/BACKUP_ANNAN_PLATS.md).
    offsite="$(sed -n 's/^offsite\.result=//p' "$remote")"
    if [[ -n "$offsite" && "$offsite" != missing ]]; then
      sed -n 's/^offsite\.time=//p' "$remote" > "$STATE_DIR/backup-remote.offsite.time"
      offsite_age="$(age_hours "$STATE_DIR/backup-remote.offsite.time")"
      if [[ "$offsite" != ok ]]; then problems+=("Senaste kopieringen av backuperna till den andra platsen misslyckades ($offsite).")
      elif (( offsite_age > OFFSITE_MAX_AGE_HOURS )); then problems+=("Senaste kopian av backuperna på den andra platsen är ${offsite_age} timmar gammal (gräns $OFFSITE_MAX_AGE_HOURS)."); fi
    fi
  fi
else
  backup_age="$(age_hours "$STATE_DIR/backup.last-success")"
  if (( backup_age > BACKUP_MAX_AGE_HOURS )); then
    problems+=("Senaste lyckade backup är ${backup_age} timmar gammal (eller saknas).")
  fi
fi
for job in $backup_jobs billing-email billing-delinquency billing-card-retries rounds-reminders history-retention integrity-check credits-check ai-digest keys-alerts secrets-sync mailings-send notices-send companies-closure register-sync maintenance-plans machine-rules machine-alarms schedule-publish; do
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
    send "Driftproblem (${#problems[@]})" "$(printf 'Problem upptäckta %s:\n\n%s' "$(date -u +%FT%TZ)" "$summary")"
    echo "$now" > "$STATE_DIR/monitor.last-alert"
  fi
  printf '%s' "$summary" > "$STATE_DIR/monitor.state"
  hc_ping fail "$summary"
  exit 1
fi
if [[ -n "$previous" ]]; then
  send "Åtgärdat" "Allt fungerar igen $(date -u +%FT%TZ)."
fi
: > "$STATE_DIR/monitor.state"
hc_ping ok "OK $(date -u +%FT%TZ)"
echo "OK $(date -u +%FT%TZ)"
