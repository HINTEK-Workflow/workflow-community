#!/usr/bin/env bash
# Where the production database is (2026-10-05), shared by nightly-backup.sh and backup-restore-drill.sh.
#
# - Without APP_DATABASE_URL in the production .env: the postgres service of this compose project (as before).
# - With it (the database server db-server): a throwaway postgres:16 client container that mounts the CA directory at
#   /app/certs – the same path the URL's sslrootcert names inside the app – and connects with verified TLS. The URL is
#   handed over in the environment, never as a command-line argument.
#
# Needs COMPOSE_PROJECT and POSTGRES_SERVICE from the caller. Optional: PRODUCTION_ENV, DB_CA_DIR, DB_CLIENT_IMAGE.

readonly PRODUCTION_ENV="${PRODUCTION_ENV:-/opt/workflow/production/.env}"
readonly DB_CA_DIR="${DB_CA_DIR:-/opt/workflow/production/certs}"
readonly DB_CLIENT_IMAGE="${DB_CLIENT_IMAGE:-postgres:16-alpine}"

SOURCE_DB_URL=""
if [[ -r "$PRODUCTION_ENV" ]]; then
  SOURCE_DB_URL="$(sed -n 's/^APP_DATABASE_URL=//p' "$PRODUCTION_ENV" | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/")"
fi
# libpq knows no "schema" parameter (that one is Prisma's), so it is taken out.
if [[ -n "$SOURCE_DB_URL" ]]; then
  SOURCE_DB_URL="$(printf '%s' "$SOURCE_DB_URL" | sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//')"
fi
export SOURCE_DB_URL

source_db_remote() { [[ -n "$SOURCE_DB_URL" ]]; }

source_db_client() {
  docker run --rm -i -e SOURCE_DB_URL -v "$DB_CA_DIR:/app/certs:ro" "$DB_CLIENT_IMAGE" "$@"
}

# Is the database reachable? Remote: a real TLS login; local: the compose service runs.
source_db_ready() {
  if source_db_remote; then
    [[ -d "$DB_CA_DIR" ]] || return 1
    source_db_client sh -c 'psql -X "$SOURCE_DB_URL" -At -c "select 1"' >/dev/null
  else
    docker compose -p "$COMPOSE_PROJECT" ps --status running "$POSTGRES_SERVICE" --quiet | grep -q .
  fi
}

# pg_dump of the production database to stdout; extra pg_dump flags as arguments.
source_pg_dump() {
  if source_db_remote; then
    source_db_client sh -c 'pg_dump --dbname="$SOURCE_DB_URL" "$@"' sh "$@"
  else
    docker compose -p "$COMPOSE_PROJECT" exec -T "$POSTGRES_SERVICE" sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' sh "$@"
  fi
}

# psql against the production database, SQL on stdin, unaligned tuples only.
source_psql() {
  if source_db_remote; then
    source_db_client sh -c 'psql -X "$SOURCE_DB_URL" -v ON_ERROR_STOP=1 -At'
  else
    docker compose -p "$COMPOSE_PROJECT" exec -T "$POSTGRES_SERVICE" sh -lc 'psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -At'
  fi
}

# Reads a custom-format dump on stdin back with pg_restore --list (no database needed).
dump_readable() {
  docker run --rm -i --network none "$DB_CLIENT_IMAGE" sh -c 'f=$(mktemp); cat > "$f"; pg_restore --list "$f" > /dev/null; rc=$?; rm -f "$f"; exit $rc'
}
