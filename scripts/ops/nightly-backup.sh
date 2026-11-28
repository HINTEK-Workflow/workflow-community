#!/usr/bin/env bash
# Nightly backup of Workflow (drift, 2026-09-30): the PostgreSQL database (custom format) and the private file
# storage, each verified after it is written, with SHA-256 sums, daily and weekly retention and an optional copy to
# another machine. Never writes to the database or the storage; only reads them.
#
#   sudo ./scripts/ops/nightly-backup.sh            (cron: see ops/cron/workflow)
#
# Environment (defaults are the production server's):
#   COMPOSE_PROJECT (workflow) · POSTGRES_SERVICE (postgres) · SOURCE_STORAGE (/opt/workflow/storage)
#   BACKUP_ROOT (/opt/backups/workflow) · KEEP_DAILY (14) · KEEP_WEEKLY (8) · STATE_DIR (/var/lib/workflow)
#   OFFSITE_TARGET (empty = no copy; e.g. backup@example-host:/srv/backups/workflow over ssh with a key)
#   TAR_OPTIONS (--numeric-owner --acls --xattrs --one-file-system on Linux)
#   BACKUP_AGE_RECIPIENT (required since K1.6, 2026-11-28, else read from ./.env; an age public key age1…, or
#   BACKUP_AGE_RECIPIENTS_FILE with one key per line): after both files are read back, they are encrypted with age and only the .age files are kept, also in the copy
#   to OFFSITE_TARGET. The private key must not be on this server (review P6, 2026-11-24). Restore: age -d -i <key file>.
#   BACKUP_ENCRYPTION (age, the default; else read from ./.env): gpg encrypts with GnuPG instead (2026-11-28, a second choice
#   for Community): AES-256 for the data to the RSA public key in BACKUP_GPG_RECIPIENT_FILE (a path, relative to the folder the
#   cron line runs in; install.sh writes it to .env), and the files end in .gpg. Restore: gpg --import <key file>, gpg -d.
#   The database is the compose service, or db-server when the production .env sets APP_DATABASE_URL (db-source.sh).
set -Eeuo pipefail
umask 077

readonly COMPOSE_PROJECT="${COMPOSE_PROJECT:-workflow}"
readonly POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
readonly SOURCE_STORAGE="${SOURCE_STORAGE:-/opt/workflow/storage}"
readonly BACKUP_ROOT="${BACKUP_ROOT:-/opt/backups/workflow}"
readonly KEEP_DAILY="${KEEP_DAILY:-14}"
readonly KEEP_WEEKLY="${KEEP_WEEKLY:-8}"
readonly STATE_DIR="${STATE_DIR:-/var/lib/workflow}"
readonly OFFSITE_TARGET="${OFFSITE_TARGET:-}"
# K1.6 (2026-11-28): the backup is always encrypted. Without BACKUP_AGE_RECIPIENT in the environment the line of that name
# in ./.env (the installation folder the cron line cd's into; install.sh writes it there) is used – only that one line is
# read. BACKUP_ALLOW_UNENCRYPTED=1 is for a throwaway test machine only and is said loudly.
if [[ -z "${BACKUP_AGE_RECIPIENT:-}" && -z "${BACKUP_AGE_RECIPIENTS_FILE:-}" && -r ./.env ]]; then
  BACKUP_AGE_RECIPIENT="$(sed -n 's/^BACKUP_AGE_RECIPIENT=//p' ./.env | tail -n 1 | tr -d '\r')"
fi
readonly BACKUP_AGE_RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"
readonly BACKUP_AGE_RECIPIENTS_FILE="${BACKUP_AGE_RECIPIENTS_FILE:-}"
# The program (2026-11-28): age unless BACKUP_ENCRYPTION=gpg, from the environment or that one line of ./.env.
env_line() { sed -n "s/^$1=//p" ./.env | tail -n 1 | tr -d '\r'; }
if [[ -z "${BACKUP_ENCRYPTION:-}" && -r ./.env ]]; then BACKUP_ENCRYPTION="$(env_line BACKUP_ENCRYPTION)"; fi
readonly BACKUP_ENCRYPTION="${BACKUP_ENCRYPTION:-age}"
if [[ "$BACKUP_ENCRYPTION" == gpg && -z "${BACKUP_GPG_RECIPIENT_FILE:-}" && -r ./.env ]]; then BACKUP_GPG_RECIPIENT_FILE="$(env_line BACKUP_GPG_RECIPIENT_FILE)"; fi
readonly BACKUP_GPG_RECIPIENT_FILE="${BACKUP_GPG_RECIPIENT_FILE:-}"
read -r -a TAR_FLAGS <<< "${TAR_OPTIONS:---numeric-owner --acls --xattrs --one-file-system}"

fail() { printf 'ERROR: %s\n' "$*" >&2; mkdir -p "$STATE_DIR"; date -u +%FT%TZ > "$STATE_DIR/backup.last-failure"; exit 1; }
trap 'fail "backup stopped at line $LINENO"' ERR

# The server runs a root-owned copy of this script outside the repo, so the helper is looked up beside it and in the repo.
for helper in "$(dirname "$(readlink -f "$0")")/db-source.sh" /opt/workflow/repo/scripts/ops/db-source.sh; do
  if [[ -r "$helper" ]]; then source "$helper"; break; fi
done
declare -F source_pg_dump >/dev/null || fail "scripts/ops/db-source.sh is missing."

for command_name in docker tar gzip sha256sum find sort; do
  command -v "$command_name" >/dev/null 2>&1 || fail "Required command is missing: $command_name"
done
AGE_ARGS=()
ENCRYPTED=""
if [[ "$BACKUP_ENCRYPTION" == gpg ]]; then
  command -v gpg >/dev/null 2>&1 || fail "BACKUP_ENCRYPTION=gpg but gpg is missing (install gnupg)."
  command -v mktemp >/dev/null 2>&1 || fail "Required command is missing: mktemp"
  [[ -n "$BACKUP_GPG_RECIPIENT_FILE" && -r "$BACKUP_GPG_RECIPIENT_FILE" ]] \
    || fail "BACKUP_ENCRYPTION=gpg needs BACKUP_GPG_RECIPIENT_FILE, a readable public key file (install.sh writes it to .env). See INSTALLATION.md, section 6."
  ENCRYPTED=gpg
elif [[ "$BACKUP_ENCRYPTION" != age ]]; then
  fail "BACKUP_ENCRYPTION must be age or gpg."
else
  if [[ -n "$BACKUP_AGE_RECIPIENT" ]]; then AGE_ARGS+=(-r "$BACKUP_AGE_RECIPIENT"); fi
  if [[ -n "$BACKUP_AGE_RECIPIENTS_FILE" ]]; then
    [[ -r "$BACKUP_AGE_RECIPIENTS_FILE" ]] || fail "BACKUP_AGE_RECIPIENTS_FILE cannot be read: $BACKUP_AGE_RECIPIENTS_FILE"
    AGE_ARGS+=(-R "$BACKUP_AGE_RECIPIENTS_FILE")
  fi
  if (( ${#AGE_ARGS[@]} )); then command -v age >/dev/null 2>&1 || fail "A BACKUP_AGE recipient is set but age is missing (install age)."; ENCRYPTED=age
  elif [[ "${BACKUP_ALLOW_UNENCRYPTED:-}" == 1 ]]; then echo "WARNING: BACKUP_ALLOW_UNENCRYPTED=1 – this backup is NOT encrypted (only for a throwaway test machine)." >&2
  else fail "The backup is always encrypted: set BACKUP_AGE_RECIPIENT=age1… (the public key; install.sh writes it to .env) and install age. See INSTALLATION.md, section 6."; fi
fi
readonly ENCRYPTED

# GnuPG: the public key is read from the file (--recipient-file) in a GNUPGHOME of its own that is removed again, so no
# keyring is used or changed; AES-256 for the data, no compression. Prints gpg's own message only when it fails.
gpg_encrypt_file() { # <public key file> <plain file> <encrypted file>
  local home status=0
  home="$(mktemp -d)"
  gpg --homedir "$home" --batch --yes --no-tty --trust-model always --cipher-algo AES256 --compress-algo none \
    --recipient-file "$1" -o "$3" --encrypt "$2" >/dev/null 2>"$home/gpg.err" || { status=$?; cat "$home/gpg.err" >&2; }
  gpgconf --homedir "$home" --kill all >/dev/null 2>&1 || true; rm -rf -- "$home"
  return "$status"
}
encrypt_file() { # <plain file> <encrypted file>
  if [[ "$ENCRYPTED" == gpg ]]; then gpg_encrypt_file "$BACKUP_GPG_RECIPIENT_FILE" "$1" "$2"; else age "${AGE_ARGS[@]}" -o "$2" "$1"; fi
}
[[ -d "$SOURCE_STORAGE" ]] || fail "Storage directory is missing: $SOURCE_STORAGE"
[[ "$KEEP_DAILY" =~ ^[0-9]+$ && "$KEEP_WEEKLY" =~ ^[0-9]+$ && "$KEEP_DAILY" -ge 3 ]] || fail "Retention must keep at least 3 daily backups."
source_db_ready || fail "PostgreSQL is not reachable."

readonly STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
KIND=daily
[[ "$(date -u +%u)" == 7 ]] && KIND=weekly
readonly TARGET="${BACKUP_ROOT}/${KIND}/${STAMP}"
mkdir -p "$TARGET" "$STATE_DIR"

# 1. Database: custom format, then read back by pg_restore in a client container without network.
source_pg_dump --format=custom --no-owner --no-privileges > "${TARGET}/database.dump"
[[ -s "${TARGET}/database.dump" ]] || fail "The database dump is empty."
dump_readable < "${TARGET}/database.dump" || fail "The database dump cannot be read back."

# 2. Files: the whole private storage, then listed back. The map tiles are a cache of Lantmäteriet's map that the server
#    fetches again when needed (2026-10-04), so they are left out of every backup.
tar "${TAR_FLAGS[@]}" --exclude=./map-tiles -C "$SOURCE_STORAGE" -czf "${TARGET}/storage.tar.gz" .
tar -tzf "${TARGET}/storage.tar.gz" > /dev/null || fail "The storage archive cannot be read back."

# 3. Checksums and a small manifest (no content).
( cd "$TARGET" && sha256sum database.dump storage.tar.gz > SHA256SUMS && sha256sum --check --quiet SHA256SUMS )
{
  printf 'created=%s\nkind=%s\ndatabase=%s\n' "$STAMP" "$KIND" "$(source_db_remote && echo db-server || echo compose)"
  printf 'database_bytes=%s\nstorage_bytes=%s\n' "$(wc -c < "${TARGET}/database.dump")" "$(wc -c < "${TARGET}/storage.tar.gz")"
} > "${TARGET}/MANIFEST"

# 3b. Encryption (age: BACKUP_AGE_RECIPIENT / BACKUP_AGE_RECIPIENTS_FILE; gpg: BACKUP_GPG_RECIPIENT_FILE): the files were read
#     back above, then each is encrypted and the plain file removed. SHA256SUMS.plain keeps the sums of the plain files (to
#     check after decrypting); SHA256SUMS then covers the .age (.gpg) files.
if [[ -n "$ENCRYPTED" ]]; then
  for file in database.dump storage.tar.gz; do
    encrypt_file "${TARGET}/${file}" "${TARGET}/${file}.${ENCRYPTED}" || fail "${ENCRYPTED} could not encrypt ${file}."
    [[ -s "${TARGET}/${file}.${ENCRYPTED}" ]] || fail "The encrypted ${file} is empty."
    rm -f -- "${TARGET}/${file}"
  done
  ( cd "$TARGET" && mv SHA256SUMS SHA256SUMS.plain && sha256sum "database.dump.${ENCRYPTED}" "storage.tar.gz.${ENCRYPTED}" > SHA256SUMS && sha256sum --check --quiet SHA256SUMS )
  printf 'encrypted=%s\n' "$ENCRYPTED" >> "${TARGET}/MANIFEST"
fi

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
