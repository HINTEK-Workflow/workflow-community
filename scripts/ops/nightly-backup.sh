#!/usr/bin/env bash
# Nightly backup of HINTEK Workflow (drift, 2026-09-30): the PostgreSQL database (custom format) and the private file
# storage, each verified after it is written, with SHA-256 sums, daily and weekly retention and an optional copy to
# another machine. Never writes to the database or the storage; only reads them.
#
#   sudo ./scripts/ops/nightly-backup.sh            (cron: see ops/cron/hintek-workflow)
#
# Environment (defaults are the production server's):
#   COMPOSE_PROJECT (workflowhintekse) · POSTGRES_SERVICE (postgres) · SOURCE_STORAGE (/opt/workflow.hintek.se/storage)
#   BACKUP_ROOT (/opt/backups/hintek-workflow) · KEEP_DAILY (14) · KEEP_WEEKLY (8) · STATE_DIR (/var/lib/hintek-workflow)
#   OFFSITE_TARGET (empty = no copy; e.g. backup@example-host:/srv/backups/hintek-workflow over ssh with a key)
#   TAR_OPTIONS (--numeric-owner --acls --xattrs --one-file-system on Linux)
set -Eeuo pipefail
umask 077

readonly COMPOSE_PROJECT="${COMPOSE_PROJECT:-workflowhintekse}"
readonly POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
readonly SOURCE_STORAGE="${SOURCE_STORAGE:-/opt/workflow.hintek.se/storage}"
readonly BACKUP_ROOT="${BACKUP_ROOT:-/opt/backups/hintek-workflow}"
readonly KEEP_DAILY="${KEEP_DAILY:-14}"
readonly KEEP_WEEKLY="${KEEP_WEEKLY:-8}"
readonly STATE_DIR="${STATE_DIR:-/var/lib/hintek-workflow}"
readonly OFFSITE_TARGET="${OFFSITE_TARGET:-}"
read -r -a TAR_FLAGS <<< "${TAR_OPTIONS:---numeric-owner --acls --xattrs --one-file-system}"

fail() { printf 'ERROR: %s\n' "$*" >&2; mkdir -p "$STATE_DIR"; date -u +%FT%TZ > "$STATE_DIR/backup.last-failure"; exit 1; }
trap 'fail "backup stopped at line $LINENO"' ERR

for command_name in docker tar gzip sha256sum find sort; do
  command -v "$command_name" >/dev/null 2>&1 || fail "Required command is missing: $command_name"
done
[[ -d "$SOURCE_STORAGE" ]] || fail "Storage directory is missing: $SOURCE_STORAGE"
[[ "$KEEP_DAILY" =~ ^[0-9]+$ && "$KEEP_WEEKLY" =~ ^[0-9]+$ && "$KEEP_DAILY" -ge 3 ]] || fail "Retention must keep at least 3 daily backups."
docker compose -p "$COMPOSE_PROJECT" ps --status running "$POSTGRES_SERVICE" --quiet | grep -q . || fail "PostgreSQL is not running."

readonly STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
KIND=daily
[[ "$(date -u +%u)" == 7 ]] && KIND=weekly
readonly TARGET="${BACKUP_ROOT}/${KIND}/${STAMP}"
mkdir -p "$TARGET" "$STATE_DIR"

# 1. Database: custom format, then read back by pg_restore inside the database container.
docker compose -p "$COMPOSE_PROJECT" exec -T "$POSTGRES_SERVICE" \
  sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges' > "${TARGET}/database.dump"
[[ -s "${TARGET}/database.dump" ]] || fail "The database dump is empty."
docker compose -p "$COMPOSE_PROJECT" exec -T "$POSTGRES_SERVICE" \
  sh -c 'f=$(mktemp); cat > "$f"; pg_restore --list "$f" > /dev/null; rc=$?; rm -f "$f"; exit $rc' < "${TARGET}/database.dump" \
  || fail "The database dump cannot be read back."

# 2. Files: the whole private storage, then listed back.
tar "${TAR_FLAGS[@]}" -C "$SOURCE_STORAGE" -czf "${TARGET}/storage.tar.gz" .
tar -tzf "${TARGET}/storage.tar.gz" > /dev/null || fail "The storage archive cannot be read back."

# 3. Checksums and a small manifest (no content).
( cd "$TARGET" && sha256sum database.dump storage.tar.gz > SHA256SUMS && sha256sum --check --quiet SHA256SUMS )
{
  printf 'created=%s\nkind=%s\n' "$STAMP" "$KIND"
  printf 'database_bytes=%s\nstorage_bytes=%s\n' "$(wc -c < "${TARGET}/database.dump")" "$(wc -c < "${TARGET}/storage.tar.gz")"
} > "${TARGET}/MANIFEST"

# 4. Retention: keep the newest KEEP_DAILY daily and KEEP_WEEKLY weekly backups; only directories named like a stamp.
prune() {
  local folder="${BACKUP_ROOT}/$1" keep="$2"
  [[ -d "$folder" ]] || return 0
  find "$folder" -mindepth 1 -maxdepth 1 -type d -name '20[0-9][0-9][01][0-9][0-3][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z' | sort -r | tail -n +"$((keep + 1))" |
    while read -r old; do
      case "$old" in "${BACKUP_ROOT}/"*) rm -rf -- "$old" ;; *) fail "Refusing to remove unexpected path: $old" ;; esac
    done
}
prune daily "$KEEP_DAILY"
prune weekly "$KEEP_WEEKLY"

# 5. Optional copy to another machine (the only protection against losing this server).
if [[ -n "$OFFSITE_TARGET" ]]; then
  command -v rsync >/dev/null 2>&1 || fail "OFFSITE_TARGET is set but rsync is missing."
  rsync -a --partial -- "${BACKUP_ROOT}/" "${OFFSITE_TARGET%/}/" || fail "The copy to ${OFFSITE_TARGET} failed."
fi

date -u +%FT%TZ > "$STATE_DIR/backup.last-success"
printf 'Backup OK: %s (%s)\n' "$TARGET" "$KIND"
