#!/usr/bin/env bash

set -Eeuo pipefail

umask 077

readonly COMPOSE_PROJECT="${COMPOSE_PROJECT:-workflow}"
readonly POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
readonly SOURCE_STORAGE="${SOURCE_STORAGE:-/opt/workflow/storage}"
readonly BACKUP_ROOT="${BACKUP_ROOT:-/opt/backups/kfid-restore-drills}"
readonly RUN_ID="$(date -u +%Y%m%d_%H%M%S)_$$"
readonly DRILL_DIR="${BACKUP_ROOT}/${RUN_ID}"
readonly DATABASE_BACKUP="${DRILL_DIR}/database.dump"
readonly STORAGE_BACKUP="${DRILL_DIR}/storage.tar.gz"
readonly REPORT_PATH="${DRILL_DIR}/report.md"
readonly RESTORE_DATABASE="kfid_restore_drill"
readonly RESTORE_USER="restore_drill"
readonly RESTORE_CONTAINER="kfid-restore-drill-${RUN_ID//_/-}"

RESTORE_DB_ROOT=""
RESTORE_STORAGE=""
CONTAINER_STARTED=false

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command is missing: $1"
}

safe_remove_tree() {
  local target="$1"
  case "$target" in
    /opt/kfid-v3/db-restore-drill.*|/opt/kfid-v3/storage-restore-drill.*)
      if [[ -d "$target" ]]; then
        find "$target" -depth -delete
      fi
      ;;
    *)
      fail "Refusing to remove unexpected path: $target"
      ;;
  esac
}

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM

  if [[ "$CONTAINER_STARTED" == true ]]; then
    case "$RESTORE_CONTAINER" in
      kfid-restore-drill-[0-9-]*)
        docker stop --time 5 "$RESTORE_CONTAINER" >/dev/null 2>&1 || true
        ;;
      *)
        printf 'ERROR: Refusing to stop unexpected container: %s\n' "$RESTORE_CONTAINER" >&2
        exit_code=1
        ;;
    esac
  fi

  if [[ -n "$RESTORE_DB_ROOT" ]]; then
    safe_remove_tree "$RESTORE_DB_ROOT" || exit_code=1
  fi
  if [[ -n "$RESTORE_STORAGE" ]]; then
    safe_remove_tree "$RESTORE_STORAGE" || exit_code=1
  fi

  exit "$exit_code"
}

trap cleanup EXIT INT TERM

database_fingerprint_sql() {
  printf '%s\n' \
    "SET client_min_messages = warning;" \
    "SET timezone = 'UTC';" \
    "SELECT format(" \
    "  'SELECT %L || ''|rows='' || count(*) || ''|xor_a='' || coalesce(bit_xor((''x'' || substr(md5(to_jsonb(t)::text), 1, 16))::bit(64)::bigint), 0) || ''|xor_b='' || coalesce(bit_xor((''x'' || substr(md5(to_jsonb(t)::text), 17, 16))::bit(64)::bigint), 0) FROM %I.%I AS t;'," \
    "  'TABLE:' || schemaname || '.' || tablename," \
    "  schemaname," \
    "  tablename" \
    ")" \
    "FROM pg_tables" \
    "WHERE schemaname = 'public'" \
    "ORDER BY tablename" \
    "\\gexec" \
    "SELECT format(" \
    "  'SELECT %L || ''|last_value='' || last_value || ''|is_called='' || is_called FROM %I.%I;'," \
    "  'SEQUENCE:' || schemaname || '.' || sequencename," \
    "  schemaname," \
    "  sequencename" \
    ")" \
    "FROM pg_sequences" \
    "WHERE schemaname = 'public'" \
    "ORDER BY sequencename" \
    "\\gexec" \
    "SELECT 'LARGE_OBJECTS|rows=' || count(*) FROM pg_largeobject_metadata;"
}

source_database_fingerprint() {
  database_fingerprint_sql | docker compose -p "$COMPOSE_PROJECT" exec -T "$POSTGRES_SERVICE" \
    sh -lc 'psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -At'
}

restored_database_fingerprint() {
  database_fingerprint_sql | docker exec -i "$RESTORE_CONTAINER" \
    psql -X -U "$RESTORE_USER" -d "$RESTORE_DATABASE" -v ON_ERROR_STOP=1 -At
}

source_schema_digest() {
  docker compose -p "$COMPOSE_PROJECT" exec -T "$POSTGRES_SERVICE" \
    sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --schema-only --no-owner --no-privileges' \
    | sed -e '/^\\restrict /d' -e '/^\\unrestrict /d' \
    | sha256sum \
    | awk '{print $1}'
}

restored_schema_digest() {
  docker exec -i "$RESTORE_CONTAINER" \
    pg_dump -U "$RESTORE_USER" -d "$RESTORE_DATABASE" --schema-only --no-owner --no-privileges \
    | sed -e '/^\\restrict /d' -e '/^\\unrestrict /d' \
    | sha256sum \
    | awk '{print $1}'
}

storage_manifest() {
  local root="$1"
  (
    cd "$root"
    find . -mindepth 1 -printf 'ENTRY|%y|%m|%U|%G|%s|%p|%l\n' | LC_ALL=C sort
    while IFS= read -r -d '' path; do
      printf 'CONTENT|%s|' "$path"
      sha256sum -- "$path" | awk '{print $1}'
    done < <(find . -type f -print0 | LC_ALL=C sort -z)
  )
}

for command_name in docker tar gzip sha256sum find awk sed mktemp; do
  require_command "$command_name"
done

[[ -d "$SOURCE_STORAGE" ]] || fail "Production storage directory does not exist: $SOURCE_STORAGE"
docker compose -p "$COMPOSE_PROJECT" ps --status running "$POSTGRES_SERVICE" --quiet | grep -q . \
  || fail "The production PostgreSQL service is not running"

mkdir -p "$DRILL_DIR"
chmod 700 "$DRILL_DIR"

RESTORE_DB_ROOT="$(mktemp -d /opt/kfid-v3/db-restore-drill.XXXXXX)"
RESTORE_STORAGE="$(mktemp -d /opt/kfid-v3/storage-restore-drill.XXXXXX)"

printf 'Creating protected database and storage backups in %s\n' "$DRILL_DIR"

SOURCE_STORAGE_BEFORE="$(storage_manifest "$SOURCE_STORAGE")"
SOURCE_DATABASE_BEFORE="$(source_database_fingerprint)"
SOURCE_SCHEMA_DIGEST="$(source_schema_digest)"

docker compose -p "$COMPOSE_PROJECT" exec -T "$POSTGRES_SERVICE" \
  sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges' \
  > "$DATABASE_BACKUP"

tar --acls --xattrs --numeric-owner --one-file-system -C "$SOURCE_STORAGE" -czf "$STORAGE_BACKUP" .
chmod 600 "$DATABASE_BACKUP" "$STORAGE_BACKUP"

docker run --detach --rm \
  --name "$RESTORE_CONTAINER" \
  --network none \
  --env POSTGRES_DB="$RESTORE_DATABASE" \
  --env POSTGRES_USER="$RESTORE_USER" \
  --env POSTGRES_PASSWORD="local-restore-drill-only" \
  --volume "$RESTORE_DB_ROOT:/var/lib/postgresql/data" \
  postgres:16-alpine >/dev/null
CONTAINER_STARTED=true

for _ in $(seq 1 60); do
  if docker exec "$RESTORE_CONTAINER" pg_isready -U "$RESTORE_USER" -d "$RESTORE_DATABASE" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$RESTORE_CONTAINER" pg_isready -U "$RESTORE_USER" -d "$RESTORE_DATABASE" >/dev/null \
  || fail "The isolated restore database did not become ready"

docker compose -p "$COMPOSE_PROJECT" exec -T "$POSTGRES_SERVICE" \
  sh -lc 'pg_restore --list' < "$DATABASE_BACKUP" >/dev/null
gzip -t "$STORAGE_BACKUP"
tar -tzf "$STORAGE_BACKUP" >/dev/null

docker exec -i "$RESTORE_CONTAINER" \
  pg_restore -U "$RESTORE_USER" -d "$RESTORE_DATABASE" --exit-on-error --no-owner --no-privileges \
  < "$DATABASE_BACKUP"
tar --acls --xattrs --numeric-owner -xzf "$STORAGE_BACKUP" -C "$RESTORE_STORAGE"

SOURCE_DATABASE_AFTER="$(source_database_fingerprint)"
SOURCE_STORAGE_AFTER="$(storage_manifest "$SOURCE_STORAGE")"
RESTORED_DATABASE="$(restored_database_fingerprint)"
RESTORED_STORAGE="$(storage_manifest "$RESTORE_STORAGE")"
RESTORED_SCHEMA_DIGEST="$(restored_schema_digest)"

[[ "$SOURCE_DATABASE_BEFORE" == "$SOURCE_DATABASE_AFTER" ]] \
  || fail "The source database changed during the drill; keep the backup but rerun for an exact comparison"
[[ "$SOURCE_STORAGE_BEFORE" == "$SOURCE_STORAGE_AFTER" ]] \
  || fail "The source storage changed during the drill; keep the backup but rerun for an exact comparison"
[[ "$SOURCE_DATABASE_AFTER" == "$RESTORED_DATABASE" ]] \
  || fail "Restored database content differs from the source snapshot"
[[ "$SOURCE_SCHEMA_DIGEST" == "$RESTORED_SCHEMA_DIGEST" ]] \
  || fail "Restored database schema differs from the source schema"
[[ "$SOURCE_STORAGE_AFTER" == "$RESTORED_STORAGE" ]] \
  || fail "Restored storage differs from the source snapshot"

MIGRATION_STATUS="$(docker exec "$RESTORE_CONTAINER" \
  psql -X -U "$RESTORE_USER" -d "$RESTORE_DATABASE" -v ON_ERROR_STOP=1 -Atqc \
  "SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) || ' applied, ' || count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) || ' failed/pending, ' || count(*) FILTER (WHERE rolled_back_at IS NOT NULL) || ' rolled back' FROM \"_prisma_migrations\";")"

DATABASE_DIGEST="$(printf '%s\n' "$RESTORED_DATABASE" | sha256sum | awk '{print $1}')"
STORAGE_DIGEST="$(printf '%s\n' "$RESTORED_STORAGE" | sha256sum | awk '{print $1}')"
DATABASE_ARCHIVE_SHA="$(sha256sum "$DATABASE_BACKUP" | awk '{print $1}')"
STORAGE_ARCHIVE_SHA="$(sha256sum "$STORAGE_BACKUP" | awk '{print $1}')"
TABLE_COUNT="$(printf '%s\n' "$RESTORED_DATABASE" | grep -c '^TABLE:')"
SEQUENCE_COUNT="$(printf '%s\n' "$RESTORED_DATABASE" | grep -c '^SEQUENCE:' || true)"
STORAGE_FILE_COUNT="$(find "$RESTORE_STORAGE" -type f -printf '.' | wc -c | tr -d ' ')"
STORAGE_BYTES="$(find "$RESTORE_STORAGE" -type f -printf '%s\n' | awk '{sum += $1} END {print sum + 0}')"

printf '%s  %s\n%s  %s\n' \
  "$DATABASE_ARCHIVE_SHA" "$(basename "$DATABASE_BACKUP")" \
  "$STORAGE_ARCHIVE_SHA" "$(basename "$STORAGE_BACKUP")" \
  > "$DRILL_DIR/SHA256SUMS"
chmod 600 "$DRILL_DIR/SHA256SUMS"

docker stop --time 5 "$RESTORE_CONTAINER" >/dev/null
CONTAINER_STARTED=false
safe_remove_tree "$RESTORE_DB_ROOT"
RESTORE_DB_ROOT=""
safe_remove_tree "$RESTORE_STORAGE"
RESTORE_STORAGE=""

printf '%s\n' \
  '# KFID V3 – backup-/restore-övning' \
  '' \
  "- Tid (UTC): $(date -u +'%Y-%m-%d %H:%M:%S')" \
  "- Resultat: GODKÄND" \
  "- Databasbackup: \`$(basename "$DATABASE_BACKUP")\`" \
  "- Lagringsbackup: \`$(basename "$STORAGE_BACKUP")\`" \
  "- Databastabeller verifierade: ${TABLE_COUNT}" \
  "- Databassekvenser verifierade: ${SEQUENCE_COUNT}" \
  "- Databasfingeravtryck: \`${DATABASE_DIGEST}\`" \
  "- Schemafingeravtryck: \`${RESTORED_SCHEMA_DIGEST}\`" \
  "- Migreringar i återställningen: ${MIGRATION_STATUS}" \
  "- Lagringsfiler verifierade: ${STORAGE_FILE_COUNT}" \
  "- Lagringsstorlek verifierad: ${STORAGE_BYTES} byte" \
  "- Lagringsfingeravtryck: \`${STORAGE_DIGEST}\`" \
  '- Isolering: separat PostgreSQL 16-container med separat bind-monterad datakatalog, utan nätverk eller publicerad port.' \
  '- Produktionsdatabas och produktionslagring användes endast som läskälla.' \
  '- Det isolerade återställningsmålet och dess temporära lagring raderades efter godkänd jämförelse.' \
  > "$REPORT_PATH"
chmod 600 "$REPORT_PATH"

trap - EXIT INT TERM
printf 'Restore drill passed. Report: %s\n' "$REPORT_PATH"
