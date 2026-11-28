#!/usr/bin/env bash
# Återställningsövning (K1.2/K1.6, 2026-11-28; bygger på granskningen 2026-11-24, P4/G-03). Den senaste backupen återställs på
# den här datorn i en isolerad, tillfällig PostgreSQL, kontrolleras mot sin egen förteckning, appen startas mot kopian och
# ska svara, och ett protokoll skrivs. Fungerar för Workflow Community och för HINTEK:s kopia av nattbackupen.
#
#   bash scripts/ops/aterstallningsovning.sh [--apply] [--backup-dir MAPP] [--key NYCKELFIL] [--protocol-dir MAPP]
#        [--app-image AVBILDNING | --no-app] [--db FIL --files FIL]
#
# TORRKÖRNING (standard): visar vilka filer som skulle användas och vad som skulle kontrolleras. Ingenting dekrypteras,
# ingen container startas och nyckelfilen öppnas inte (bara att den finns kontrolleras).
# Med --apply: dekrypterar LOKALT med nyckelfilen (--key / AGE_KEY: den privata age-nyckeln, eller för .gpg-filer den
# exporterade privata GnuPG-nyckeln, workflow-backup.gpgkey, som läses in i en tillfällig GNUPGHOME som tas bort efteråt),
# återställer databasen i en transaktion i en
# PostgreSQL-container på ett eget internt Docker-nät utan väg ut och utan öppen port, packar upp filerna och kontrollerar:
#   - kontrollsummorna mot förteckningen bredvid backupen (SHA256SUMS, SHA256SUMS.txt; efter dekrypteringen SHA256SUMS.plain)
#   - antalet rader per tabell: det återställda mot arkivets egna rader, och mot ROWS när backupen har en (Community)
#   - antalet tabeller och filer mot MANIFEST (Community) eller serverns status (status-db.txt, status-files.txt)
#   - migreringstabellen, att varje bilaga finns med rätt storlek, att arbetsordrar pekar på en kund i samma företag
#   - markören (frivillig): MARKER_TASK_ID, MARKER_ATTACHMENT_ID och MARKER_SHA256 för en känd bilaga
#   - appen (--app-image, förval kfid-v3:latest eller APP_IMAGE): startas mot kopian på samma interna nät, med slumpade
#     engångsnycklar, och /api/health/ready ska svara ok. Den kör sina migreringar på kopian (ett uppgraderingsprov). Den
#     når inget utanför nätet: inga mejl, ingen betalning, inga externa anrop.
# Protokollet: <protocol-dir>/aterstallning-ÅÅÅÅ-MM-DD.md (förval: mappen aterstallning bredvid backuperna). De
# dekrypterade filerna skrivs över och tas bort efteråt; de krypterade ligger kvar. Skriver aldrig ut en nyckel, ett
# lösenord eller radinnehåll – bara antal, filnamn, kontrollsummor, tider och utfall.
#
# Backupen: den nyaste mappen under --backup-dir (BACKUP_DIR) som har både databasen och filerna:
#   <datum>/workflow-*.dump.age + storage-*.tar.gz.age   (kopian av nattbackupen på en annan dator)
#   daily|weekly/<tid>/database.dump.age + storage.tar.gz.age   (scripts/ops/nightly-backup.sh)
#   update-<tid>/database.dump.age + storage.tar.gz.age   (installationsskriptets backup före en uppdatering)
# eller exakt de filer som --db och --files anger. Med BACKUP_ENCRYPTION=gpg slutar filerna på .gpg i stället för .age.
# En okrypterad fil (utan .age eller .gpg) används som den är, för prov.
# Kräver bash, docker, sha256sum, tar och age eller gpg (bara med --apply och krypterade filer). Utgångskod 0 = godkänd.
set -euo pipefail
export MSYS_NO_PATHCONV=1

APPLY=false
BACKUP_DIR="${BACKUP_DIR:-}"
AGE_KEY="${AGE_KEY:-}"
PROTOCOL_DIR="${PROTOCOL_DIR:-}"
APP_IMAGE="${APP_IMAGE:-kfid-v3:latest}"
APP_CHECK=true
DB_FILE="${DB_FILE:-}"
FILES_FILE="${FILES_FILE:-}"
while (( $# )); do
  case "$1" in
    --apply) APPLY=true ;;
    --backup-dir) BACKUP_DIR="${2:?--backup-dir needs a folder}"; shift ;;
    --key) AGE_KEY="${2:?--key needs a file}"; shift ;;
    --protocol-dir) PROTOCOL_DIR="${2:?--protocol-dir needs a folder}"; shift ;;
    --app-image) APP_IMAGE="${2:?--app-image needs an image}"; shift ;;
    --no-app) APP_CHECK=false ;;
    --db) DB_FILE="${2:?--db needs a file}"; shift ;;
    --files) FILES_FILE="${2:?--files needs a file}"; shift ;;
    -h|--help) awk 'NR > 1 && /^set -euo/ { exit } NR > 1' "$0"; exit 0 ;;
    *) echo "Okänt val: $1 (se --help)" >&2; exit 64 ;;
  esac
  shift
done

AGE="${AGE:-$(command -v age 2>/dev/null || true)}"
GPG="${GPG:-$(command -v gpg 2>/dev/null || true)}"
RTO_HOURS="${RTO_HOURS:-8}"
RPO_HOURS="${RPO_HOURS:-24}"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"
RUN_ID="$(date +%Y%m%d%H%M%S)-$$"
NAME="workflow-aterstallningsovning-db-$RUN_ID"
APP_NAME="workflow-aterstallningsovning-app-$RUN_ID"
NET="workflow-aterstallningsovning-$RUN_ID"
say() { printf '%s\n' "$*"; }
# GNU tar reads "C:/…" as host:path; --force-local (where it exists) keeps it a local file.
TAR=(tar); tar --help 2>/dev/null | grep -q -- --force-local && TAR=(tar --force-local)
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }

# --- The backup to use ---------------------------------------------------------------------------------------------------
storage_beside() { # the file backup in the same folder as the database backup
  local dir; dir="$(dirname "$1")"
  ls -t "$dir"/storage-*.tar.gz.age "$dir"/storage-*.tar.gz.gpg "$dir"/storage-*.tar.gz "$dir"/storage.tar.gz.age "$dir"/storage.tar.gz.gpg "$dir"/storage.tar.gz 2>/dev/null | head -1 || true
}
if [[ -z "$DB_FILE" ]]; then
  [[ -n "$BACKUP_DIR" ]] || { say "Ange --backup-dir (mappen med backuperna) eller --db och --files." >&2; exit 64; }
  [[ -d "$BACKUP_DIR" ]] || { say "Mappen $BACKUP_DIR finns inte." >&2; exit 1; }
  while IFS= read -r candidate; do
    [[ -n "$candidate" ]] || continue
    files="$(storage_beside "$candidate")"
    if [[ -n "$files" ]]; then DB_FILE="$candidate"; FILES_FILE="${FILES_FILE:-$files}"; break; fi
  done < <(find "$BACKUP_DIR" -maxdepth 3 -type f \( -name 'workflow-*.dump.age' -o -name 'workflow-*.dump.gpg' -o -name 'workflow-*.dump' -o -name 'database.dump.age' -o -name 'database.dump.gpg' -o -name 'database.dump' \) \
             -not -path '*aterstallningsovning-tmp*' -printf '%T@ %p\n' 2>/dev/null | sort -rn | cut -d' ' -f2-)
fi
[[ -n "$DB_FILE" && -f "$DB_FILE" ]] || { say "Ingen databasbackup med en filbackup bredvid hittades i ${BACKUP_DIR:-(ingen mapp)}. Ange --db och --files." >&2; exit 1; }
[[ -z "$FILES_FILE" ]] && FILES_FILE="$(storage_beside "$DB_FILE")"
[[ -n "$FILES_FILE" && -f "$FILES_FILE" ]] || { say "Ingen filbackup hittades bredvid $DB_FILE (ange --files)." >&2; exit 1; }
SRC_DIR="$(cd "$(dirname "$DB_FILE")" && pwd)"
[[ -n "$BACKUP_DIR" ]] || BACKUP_DIR="$(dirname "$SRC_DIR")"
PROTOCOL_DIR="${PROTOCOL_DIR:-$BACKUP_DIR/aterstallning}"
REPORT="${REPORT:-$PROTOCOL_DIR/aterstallning-$(date +%Y-%m-%d).md}"
WORK="${WORK_DIR:-$BACKUP_DIR/aterstallningsovning-tmp-$RUN_ID}"
encrypted() { [[ "$1" == *.age || "$1" == *.gpg ]]; }
NEEDS_KEY=false; { encrypted "$DB_FILE" || encrypted "$FILES_FILE"; } && NEEDS_KEY=true
# The program the encrypted files need: gpg for .gpg, otherwise age.
TOOL=age; [[ "$DB_FILE" == *.gpg || "$FILES_FILE" == *.gpg ]] && TOOL=gpg
TOOL_PATH="$AGE"; [[ "$TOOL" == gpg ]] && TOOL_PATH="$GPG"
# Git Bash's own gpg (/usr/bin) reads paths as /c/…; Gpg4win's gpg.exe, like age.exe, reads C:\….
gpgpath() { if [[ "$GPG" == /usr/* ]]; then printf '%s' "$1"; else winpath "$1"; fi; }

# The backup's time: from the name (workflow-ÅÅÅÅ-MM-DDTHHMMSS…, update-ÅÅÅÅMMDDTHHMMSSZ, <ÅÅÅÅMMDDTHHMMSSZ>/), else the file's.
backup_time() {
  local text="$1/$(basename "$2")"
  if [[ "$text" =~ ([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2}) ]]; then
    printf '%s-%s-%s %s:%s:%s' "${BASH_REMATCH[@]:1:6}"
  elif [[ "$text" =~ ([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z ]]; then
    printf '%s-%s-%s %s:%s:%s UTC' "${BASH_REMATCH[@]:1:6}"
  else date -r "$2" '+%Y-%m-%d %H:%M:%S'; fi
}
DB_TIME="$(backup_time "$SRC_DIR" "$DB_FILE")"
FILES_TIME="$(backup_time "$SRC_DIR" "$FILES_FILE")"

if ! $APPLY; then
  say "TORRKÖRNING (standard) – inget dekrypteras, ingen container startas och nyckelfilen öppnas inte."
  say "Databas: $DB_FILE (tagen $DB_TIME, $(stat -c %s "$DB_FILE") byte$(encrypted "$DB_FILE" && echo ', krypterad' || echo ', OKRYPTERAD'))"
  say "Filer:   $FILES_FILE (tagen $FILES_TIME, $(stat -c %s "$FILES_FILE") byte$(encrypted "$FILES_FILE" && echo ', krypterad' || echo ', OKRYPTERAD'))"
  say "Förteckning bredvid: $(cd "$SRC_DIR" && ls SHA256SUMS SHA256SUMS.txt SHA256SUMS.plain MANIFEST ROWS status-db.txt status-files.txt 2>/dev/null | tr '\n' ' ')"
  if $NEEDS_KEY; then
    say "$TOOL: ${TOOL_PATH:-SAKNAS} · nyckelfil (--key): ${AGE_KEY:-INTE ANGIVEN}$([[ -n "$AGE_KEY" ]] && { [[ -f "$AGE_KEY" ]] && echo ' (finns)' || echo ' (SAKNAS)'; })"
  fi
  say "docker: $(command -v docker >/dev/null && echo finns || echo SAKNAS) · appen: $($APP_CHECK && echo "$APP_IMAGE$(docker image inspect "$APP_IMAGE" >/dev/null 2>&1 && echo ' (finns)' || echo ' (SAKNAS)')" || echo 'startas inte (--no-app)')"
  if [[ -n "${MARKER_TASK_ID:-}" && -n "${MARKER_ATTACHMENT_ID:-}" && -n "${MARKER_SHA256:-}" ]]; then say "Markör: angiven"; else say "Markör: inte angiven – kontrollen av en känd bilaga hoppas över"; fi
  say "Kontroller med --apply: kontrollsummor, dekryptering, pg_restore i en transaktion, rader per tabell mot arkivet och förteckningen, tabeller och filer mot förteckningen, migreringstabellen, bilagornas filer, kundkopplingar, markören, appens /api/health/ready, tid mot RTO ${RTO_HOURS} h och backupens ålder mot RPO ${RPO_HOURS} h."
  say "Protokoll: $REPORT"
  exit 0
fi

command -v docker >/dev/null 2>&1 || { say "docker saknas." >&2; exit 1; }
if $NEEDS_KEY; then
  if [[ "$TOOL" == gpg ]]; then
    [[ -n "$GPG" && -x "$GPG" ]] || { say "gpg saknas (installera GnuPG, eller ange GPG=<sökväg>)." >&2; exit 1; }
    [[ -n "$AGE_KEY" && -f "$AGE_KEY" ]] || { say "Nyckelfilen saknas: ange --key <fil> (den privata GnuPG-nyckeln, workflow-backup.gpgkey)." >&2; exit 1; }
  else
    [[ -n "$AGE" && -x "$AGE" ]] || { say "age saknas (installera age, eller ange AGE=<sökväg>)." >&2; exit 1; }
    [[ -n "$AGE_KEY" && -f "$AGE_KEY" ]] || { say "Nyckelfilen saknas: ange --key <fil> (den privata age-nyckeln)." >&2; exit 1; }
  fi
fi
if $APP_CHECK && ! docker image inspect "$APP_IMAGE" >/dev/null 2>&1; then say "Avbildningen $APP_IMAGE finns inte här (ange --app-image, eller --no-app)." >&2; exit 1; fi

rand() { od -An -N24 -tx1 /dev/urandom | tr -d ' \n'; }
PASS="$(rand)"
FAILS=0
mkdir -p "$PROTOCOL_DIR" "$WORK/storage"
chmod 700 "$WORK" 2>/dev/null || true
log() { printf '%s\n' "$*" | tee -a "$REPORT"; }
bad() { FAILS=$((FAILS + 1)); log "- **AVVIKELSE:** $*"; }
ok() { log "- OK: $*"; }
wipe() { # overwrite before removing: a plain copy never stays on disk
  [[ -f "$1" ]] || return 0
  if command -v shred >/dev/null 2>&1; then shred -u -- "$1" 2>/dev/null && return 0; fi
  local size; size="$(stat -c %s "$1")"
  dd if=/dev/zero of="$1" bs=1M count=$(( size / 1048576 + 1 )) conv=notrunc status=none 2>/dev/null || true
  rm -f -- "$1"
}
GPG_HOME=""
cleanup() {
  docker rm -f "$APP_NAME" "$NAME" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  wipe "$WORK/workflow.dump"; wipe "$WORK/storage.tar.gz"
  rm -rf -- "$WORK"
  gpg_home_remove
}
# The temporary GNUPGHOME with the imported private key: its agent stopped, every file overwritten, then removed.
gpg_home_remove() {
  [[ -n "$GPG_HOME" && -d "$GPG_HOME" ]] || return 0
  gpgconf --homedir "$(gpgpath "$GPG_HOME")" --kill all >/dev/null 2>&1 || true
  local file; while IFS= read -r -d '' file; do wipe "$file"; done < <(find "$GPG_HOME" -type f -print0 2>/dev/null)
  rm -rf -- "$GPG_HOME"; GPG_HOME=""
}
# GnuPG: the exported private key is read into a GNUPGHOME of its own (a short path in the temporary folder, for the agent's
# socket), never into the user's own keyring. <key file> <encrypted file> <plain target>
gpg_decrypt() {
  if [[ -z "$GPG_HOME" ]]; then
    GPG_HOME="$(mktemp -d)"; chmod 700 "$GPG_HOME"
    "$GPG" --homedir "$(gpgpath "$GPG_HOME")" --batch --quiet --import "$(gpgpath "$1")" >/dev/null 2>&1 || { say "Nyckelfilen gick inte att läsa in i gpg." >&2; return 1; }
  fi
  "$GPG" --homedir "$(gpgpath "$GPG_HOME")" --quiet --yes -o "$(gpgpath "$3")" --decrypt "$(gpgpath "$2")"
}
trap cleanup EXIT

START=$(date +%s)
{ printf '# Återställningsövning %s\n\n' "$(date '+%Y-%m-%d %H:%M')"; printf 'Skript: scripts/ops/aterstallningsovning.sh.\n\n'; } > "$REPORT"
log "## Backupen"
log "- Databas: $(basename "$DB_FILE"), tagen $DB_TIME, sha256 $(sha256sum "$DB_FILE" | cut -c1-12)…$(encrypted "$DB_FILE" || echo ' (okrypterad provfil)')"
log "- Filer: $(basename "$FILES_FILE"), tagen $FILES_TIME, sha256 $(sha256sum "$FILES_FILE" | cut -c1-12)…$(encrypted "$FILES_FILE" || echo ' (okrypterad provfil)')"
# The checksums of the files as they were written (SHA256SUMS: nightly-backup.sh and the installer; SHA256SUMS.txt: the copy).
check_sums() { # <sums file> <file>... → 0 ok, 1 wrong, 2 not listed
  local sums="$1" file line; shift
  for file in "$@"; do
    line="$(sed 's/\r$//' "$sums" | grep -E " [ *]$(basename "$file" | sed 's/[.[\*^$]/\\&/g')\$" | head -1 || true)"
    [[ -n "$line" ]] || return 2
    [[ "${line%% *}" == "$(sha256sum "$file" | cut -d' ' -f1)" ]] || return 1
  done
}
SUMS=""; for candidate in SHA256SUMS SHA256SUMS.txt; do [[ -f "$SRC_DIR/$candidate" ]] && { SUMS="$SRC_DIR/$candidate"; break; }; done
if [[ -n "$SUMS" ]]; then
  status=0; check_sums "$SUMS" "$DB_FILE" "$FILES_FILE" || status=$?
  case "$status" in 0) ok "kontrollsummorna stämmer mot $(basename "$SUMS")" ;; 2) bad "filerna står inte i $(basename "$SUMS")" ;; *) bad "kontrollsummorna stämmer inte mot $(basename "$SUMS")" ;; esac
else bad "ingen förteckning med kontrollsummor (SHA256SUMS) bredvid backupen"; fi
db_epoch="$(date -d "$DB_TIME" +%s 2>/dev/null || date +%s)"
AGE_H=$(( ( $(date +%s) - db_epoch ) / 3600 ))
log "- Backupens ålder när övningen startade: ${AGE_H} h. Nattbackupen tas varje natt, så det som kan gå förlorat är högst tiden sedan senaste natten (RPO ${RPO_HOURS} h)."

log ""; log "## Återställningen"
T=$(date +%s)
open_copy() { # <backup file> <plain target>
  if [[ "$1" == *.gpg ]]; then gpg_decrypt "$AGE_KEY" "$1" "$2"
  elif encrypted "$1"; then "$AGE" --decrypt -i "$(winpath "$AGE_KEY")" -o "$(winpath "$2")" "$(winpath "$1")"; else cp -- "$1" "$2"; fi
}
open_copy "$DB_FILE" "$WORK/workflow.dump"
open_copy "$FILES_FILE" "$WORK/storage.tar.gz"
gpg_home_remove
ok "$($NEEDS_KEY && echo 'dekrypterat lokalt' || echo 'kopierat (okrypterade provfiler)') på $(( $(date +%s) - T )) s"
if [[ -f "$SRC_DIR/SHA256SUMS.plain" ]]; then
  status=0
  ( cd "$WORK" && sed 's/\r$//' "$SRC_DIR/SHA256SUMS.plain" | sed -E 's/ [ *]database\.dump$/  workflow.dump/' | sha256sum --check --quiet --status ) || status=1
  [[ "$status" == 0 ]] && ok "de dekrypterade filerna stämmer mot SHA256SUMS.plain" || bad "de dekrypterade filerna stämmer inte mot SHA256SUMS.plain"
fi

# The database: its own network without a way out (--internal), no published port; reached only with docker exec.
docker network create --internal "$NET" >/dev/null
docker run -d --rm --name "$NAME" --network "$NET" --network-alias db -e POSTGRES_PASSWORD="$PASS" \
  -v "$(winpath "$WORK"):/work:ro" "$PG_IMAGE" >/dev/null
for _ in $(seq 1 90); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 2
T=$(date +%s)
docker exec "$NAME" sh -c 'createdb -U postgres prov && { createuser -U postgres workflow_app; createuser -U postgres workflow_backup; } 2>/dev/null; true' >/dev/null
if docker exec "$NAME" pg_restore -U postgres -d prov --no-owner --no-acl --exit-on-error --single-transaction /work/workflow.dump > "$WORK/restore.out" 2>&1; then
  ok "databasen återställd i en transaktion på $(( $(date +%s) - T )) s"
else
  bad "pg_restore föll: $(grep -m1 -i 'error' "$WORK/restore.out" | sed -E 's/(DETAIL|Key).*//' | cut -c1-160)"
fi
T=$(date +%s)
if "${TAR[@]}" -xzf "$WORK/storage.tar.gz" -C "$WORK/storage" 2>"$WORK/tar.out"; then ok "filerna uppackade på $(( $(date +%s) - T )) s ($(find "$WORK/storage" -type f | wc -l | tr -d ' ') filer)"; else bad "filarkivet gick inte att packa upp"; fi
RESTORED=$(( $(date +%s) - START ))

q() { docker exec "$NAME" psql -X -U postgres -d prov -Atc "$1" 2>/dev/null || true; } # empty when the query fails
log ""; log "## Kontroller"
log "- Migreringar: $(q 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL') klara, senaste $(q 'SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 1')"
FAILED_MIG="$(q 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL')"
[[ "${FAILED_MIG:-x}" == "0" ]] && ok "ingen migrering står som misslyckad" || bad "migreringar som står som misslyckade: ${FAILED_MIG:-okänt}"

# Rows per table: the archive's own rows (COPY blocks, read in the container and counted here in memory) against the restored
# database, and against ROWS when the backup has one. Names and numbers only.
docker exec "$NAME" pg_restore --data-only -f - /work/workflow.dump 2>/dev/null | awk '
  /^COPY / { name = $2; sub(/^public\./, "", name); gsub(/"/, "", name); n = 0; inside = 1; next }
  inside && /^\\\.$/ { print name "\t" n; inside = 0; next }
  inside { n++ }' | sort > "$WORK/rows-archive.tsv" || true
{ q "select format('select %L || chr(9) || count(*) from %I.%I;', table_name, table_schema, table_name) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name" || true; } \
  | docker exec -i "$NAME" psql -X -U postgres -d prov -At 2>/dev/null | sort > "$WORK/rows-restored.tsv" || true
TABLES_RESTORED="$(wc -l < "$WORK/rows-restored.tsv" | tr -d ' ')"
ROWS_TOTAL="$(awk -F'\t' '{ s += $2 } END { print s + 0 }' "$WORK/rows-restored.tsv")"
compare_rows() { # <expected tsv> <label> → the tables whose count differs, or a missing table
  awk -F'\t' 'NR == FNR { have[$1] = $2; next } { if (!($1 in have)) print $1 " saknas"; else if (have[$1] != $2) print $1 " " have[$1] " i stället för " $2 }' "$WORK/rows-restored.tsv" "$1" > "$WORK/rows-diff.txt"
  if [[ -s "$WORK/rows-diff.txt" ]]; then bad "rader per tabell skiljer sig från $2 i $(wc -l < "$WORK/rows-diff.txt" | tr -d ' ') tabeller: $(head -5 "$WORK/rows-diff.txt" | tr '\n' ';')"
  else ok "rader per tabell stämmer mot $2 ($(wc -l < "$1" | tr -d ' ') tabeller)"; fi
}
log "- Återställt: $TABLES_RESTORED tabeller, $ROWS_TOTAL rader."
[[ -s "$WORK/rows-archive.tsv" ]] && compare_rows "$WORK/rows-archive.tsv" "arkivet" || bad "arkivets rader kunde inte läsas"
if [[ -f "$SRC_DIR/ROWS" ]]; then sed 's/\r$//' "$SRC_DIR/ROWS" | sort > "$WORK/rows-manifest.tsv"; compare_rows "$WORK/rows-manifest.tsv" "förteckningen ROWS"; fi
manifest_value() { sed -n "s/^$2=//p" "$1" 2>/dev/null | tr -d '\r' | tail -n 1; }
if [[ -f "$SRC_DIR/MANIFEST" ]]; then
  want="$(manifest_value "$SRC_DIR/MANIFEST" tables)"
  if [[ -n "$want" ]]; then
    have="$(q "select count(*) from information_schema.tables where table_schema = 'public'")"
    [[ "$have" == "$want" ]] && ok "antalet tabeller stämmer mot MANIFEST ($want)" || bad "MANIFEST säger $want tabeller, återställt $have"
  fi
  want="$(manifest_value "$SRC_DIR/MANIFEST" files)"
  if [[ -n "$want" ]]; then
    have="$({ "${TAR[@]}" -tzf "$WORK/storage.tar.gz" 2>/dev/null || true; } | wc -l | tr -d ' ')"
    [[ "$have" == "$want" ]] && ok "antalet poster i filarkivet stämmer mot MANIFEST ($want)" || bad "MANIFEST säger $want poster i filarkivet, arkivet har $have"
  fi
fi
# The server's own status of the same night (the copy saves it beside the backup): COPY blocks and the number of files.
if [[ -f "$SRC_DIR/status-db.txt" && "$(manifest_value "$SRC_DIR/status-db.txt" file)" == "$(basename "$DB_FILE")" ]]; then
  want="$(manifest_value "$SRC_DIR/status-db.txt" tables)"; have="$(wc -l < "$WORK/rows-archive.tsv" | tr -d ' ')"
  [[ "$want" == "$have" ]] && ok "arkivets tabeller med data stämmer mot serverns status ($want)" || bad "serverns status säger $want tabeller med data, arkivet har $have"
fi
if [[ -f "$SRC_DIR/status-files.txt" && "$(manifest_value "$SRC_DIR/status-files.txt" file)" == "$(basename "$FILES_FILE")" ]]; then
  want="$(manifest_value "$SRC_DIR/status-files.txt" source_files)"; have="$(find "$WORK/storage" -type f | wc -l | tr -d ' ')"
  [[ "$want" == "$have" ]] && ok "antalet filer stämmer mot serverns status ($want)" || bad "serverns status säger $want filer, återställt $have"
fi
[[ "$(q 'SELECT count(*) FROM "Organization"')" -gt 0 ]] 2>/dev/null && ok "det finns företag i den återställda databasen" || bad "inga företag i den återställda databasen"

# Every attachment's file is in the restored storage with the size the row says (lib/kfid/storage.ts: <root>/kfid/<storagePath>).
q 'SELECT "storagePath" || chr(9) || size FROM "WorkflowTaskAttachment"' > "$WORK/attachments.tsv" || true
TOTAL=0; MISSING=0; WRONG=0
while IFS=$'\t' read -r key size; do
  [[ -n "$key" ]] || continue
  TOTAL=$((TOTAL + 1))
  file="$WORK/storage/kfid/$key"
  if [[ ! -f "$file" ]]; then MISSING=$((MISSING + 1)); elif [[ "$(stat -c %s "$file")" != "$size" ]]; then WRONG=$((WRONG + 1)); fi
done < "$WORK/attachments.tsv"
if [[ "$MISSING" == 0 && "$WRONG" == 0 ]]; then ok "alla $TOTAL bilagor finns med rätt storlek"; else bad "bilagor: $TOTAL rader, $MISSING filer saknas, $WRONG med fel storlek"; fi

# The customer link: a work order's customer exists in the same company (the triggers forbid anything else; the restore must keep it).
ORPHANS="$(q 'SELECT count(*) FROM "WorkflowTask" t WHERE t."customerId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Customer" c WHERE c.id = t."customerId" AND c."organizationId" = t."organizationId")')"
LINKED="$(q 'SELECT count(*) FROM "WorkflowTask" WHERE "customerId" IS NOT NULL')"
[[ "${ORPHANS:-x}" == "0" ]] && ok "alla $LINKED arbetsordrar med kund pekar på en kund i samma företag" || bad "arbetsordrar utan sin kund: ${ORPHANS:-okänt} av ${LINKED:-okänt}"

if [[ -n "${MARKER_TASK_ID:-}" && -n "${MARKER_ATTACHMENT_ID:-}" && -n "${MARKER_SHA256:-}" ]]; then
  case "$MARKER_TASK_ID$MARKER_ATTACHMENT_ID" in *[!A-Za-z0-9_-]*) say "MARKER_TASK_ID och MARKER_ATTACHMENT_ID får bara ha bokstäver, siffror, - och _." >&2; exit 1 ;; esac
  TASK_OK="$(q "SELECT count(*) FROM \"WorkflowTask\" t JOIN \"Customer\" c ON c.id = t.\"customerId\" AND c.\"organizationId\" = t.\"organizationId\" WHERE t.id = '$MARKER_TASK_ID'")"
  [[ "$TASK_OK" == "1" ]] && ok "markörens arbetsorder finns och har sin kund" || bad "markörens arbetsorder saknas eller saknar kund"
  MKEY="$(q "SELECT \"storagePath\" FROM \"WorkflowTaskAttachment\" WHERE id = '$MARKER_ATTACHMENT_ID' AND \"taskId\" = '$MARKER_TASK_ID'")"
  if [[ -n "$MKEY" && -f "$WORK/storage/kfid/$MKEY" ]]; then
    [[ "$(sha256sum "$WORK/storage/kfid/$MKEY" | cut -d' ' -f1)" == "$(printf '%s' "$MARKER_SHA256" | tr 'A-F' 'a-f')" ]] && ok "markörens bilaga har samma SHA-256 som filen som laddades ned före backupen" || bad "markörens bilaga har en annan SHA-256"
  else bad "markörens bilaga finns inte i den återställda databasen eller lagringen"; fi
else log "- Markören var inte angiven: kontrollen av en känd bilaga och dess SHA-256 gjordes inte."; fi

# The app against the copy: the same internal network, throwaway keys, storage in memory; it runs its migrations on the copy.
if $APP_CHECK; then
  log ""; log "## Appen mot kopian"
  T=$(date +%s)
  MIG_BEFORE="$(q 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')"
  docker run -d --rm --name "$APP_NAME" --network "$NET" \
    -e NODE_ENV=production -e APP_URL=https://aterstallningsovning.invalid \
    -e DATABASE_URL="postgresql://postgres:$PASS@db:5432/prov?schema=public" \
    -e AUTH_SECRET="$(rand)" -e SEED_ADMIN_PASSWORD="$(rand)" -e STORAGE_ROOT=/app/storage -e STORAGE_CHOWN=never \
    --tmpfs /app/storage:uid=1000,gid=1000,mode=0700 "$APP_IMAGE" >/dev/null
  READY=""
  for _ in $(seq 1 90); do
    READY="$(docker exec "$APP_NAME" node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health/ready').then(async r=>{const b=await r.json().catch(()=>({}));console.log(r.status+' '+(b.status||''));}).catch(()=>console.log('0'))" 2>/dev/null || true)"
    [[ "$READY" == "200 ok" ]] && break
    docker inspect -f '{{.State.Running}}' "$APP_NAME" 2>/dev/null | grep -q true || break
    sleep 2
  done
  if [[ "$READY" == "200 ok" ]]; then
    ok "appen ($APP_IMAGE) startade mot kopian och /api/health/ready svarade ok på $(( $(date +%s) - T )) s"
    MIG_AFTER="$(q 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')"
    log "- Migreringar som appen körde på kopian: $(( ${MIG_AFTER:-0} - ${MIG_BEFORE:-0} ))"
  else
    bad "appen ($APP_IMAGE) svarade inte ok mot kopian (${READY:-inget svar}). Sista raderna: $(docker logs --tail 3 "$APP_NAME" 2>&1 | tr '\n' ' ' | sed -E 's/(postgresql:\/\/)[^ ]*/\1…/g' | cut -c1-200)"
  fi
fi

TOTAL_S=$(( $(date +%s) - START ))
log ""; log "## Tid"
log "- Från start till återställd databas och filer: ${RESTORED} s. Med kontrollerna och appen: ${TOTAL_S} s."
log "- RTO ${RTO_HOURS} h gäller hela vägen i drift: beslut, hämtning, återställning på servern och start av appen. Den här delen tog $(( TOTAL_S / 60 )) min."
log ""
if [[ "$FAILS" == 0 ]]; then log "**Resultat: godkänd.**"; else log "**Resultat: $FAILS avvikelser.** Rätta och gör om övningen."; fi
log "De dekrypterade filerna skrivs över och tas bort nu; de krypterade ligger kvar."
[[ "$FAILS" == 0 ]]
