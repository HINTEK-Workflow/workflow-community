#!/usr/bin/env bash
# Workflow Community Edition - installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/HINTEK-Workflow/workflow-community/main/install.sh | bash
#
# Downloads Workflow, writes .env with new random secrets and free ports, starts it with Docker, creates your owner
# account and opens the browser. Run it again to update: your .env and your data are kept. If an earlier run stopped
# before the account was made, the next run creates it.
#
# Versions: it installs the newest released version (a tag vX.Y.Z), not whatever is on main. WORKFLOW_VERSION=vX.Y.Z picks
# one; WORKFLOW_VERSION=main follows main as before. Before an update changes the database it stops the app, takes a backup
# of the database and the files into backups/update-<time>/, restores the database copy into a temporary database to prove
# it can be read, checks the file archive, and only then starts the new version (which runs the migrations). The backup is
# always encrypted with age to BACKUP_AGE_RECIPIENT in .env; without one a key pair is made in backup-key/ and the admin is
# told to move the private key somewhere safe (age must be installed). INSTALLATION.md, "Återställ", tells how to go back.
#
# Encryption (2026-11-28): age is the default. GnuPG (OpenPGP, AES-256 and RSA 4096) is a second choice for organisations
# whose rules ask for algorithms from the BSI or NIST lists: --encryption gpg (curl … | bash -s -- --encryption gpg) or
# WORKFLOW_BACKUP_ENCRYPTION=gpg. The choice is kept in .env as BACKUP_ENCRYPTION; without it nothing more is asked than before.
#
# Optional: WORKFLOW_DIR (install folder), WORKFLOW_SOURCE (git repository to install from), WORKFLOW_VERSION, and
# WORKFLOW_KEEP_BACKUPS (how many update backups are kept, 5). WORKFLOW_SKIP_BACKUP=1 skips the backup (not recommended).
# Without questions: WORKFLOW_ADMIN_EMAIL, WORKFLOW_ADMIN_PASSWORD, WORKFLOW_NAME; WORKFLOW_NO_BROWSER=1 opens no browser.
set -Eeuo pipefail

SOURCE="${WORKFLOW_SOURCE:-https://github.com/HINTEK-Workflow/workflow-community.git}"
DIR="${WORKFLOW_DIR:-$HOME/workflow-community}"
KEEP_BACKUPS="${WORKFLOW_KEEP_BACKUPS:-5}"
# npm in the containers never asks the registry for a newer npm.
export NPM_CONFIG_UPDATE_NOTIFIER=false

step() { printf '\n\033[36m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mStopp: %s\033[0m\n' "$*" >&2; exit 1; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
secret() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }
sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
# Questions are read from the terminal, also when the script itself arrives through a pipe.
ask() { local answer; read -r -p "$1" answer < /dev/tty; printf '%s' "$answer"; }
port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
free_port() { local port; for ((port = $1; port < $1 + 100; port++)); do port_free "$port" && { echo "$port"; return; }; done; fail "Hittade ingen ledig port från $1."; }
set_value() { # key value file
  if grep -q "^$1=" "$3"; then
    local tmp; tmp="$(mktemp)"; awk -v k="$1" -v v="$2" 'index($0, k"=") == 1 { print k"="v; next } { print }' "$3" > "$tmp" && mv "$tmp" "$3"
  else printf '%s=%s\n' "$1" "$2" >> "$3"; fi
}
env_value() { sed -n "s/^$1=//p" "$DIR/.env" | tail -n 1; }
# The encryption chosen on the command line (--encryption age|gpg) or with WORKFLOW_BACKUP_ENCRYPTION; empty = what .env says.
ENCRYPTION_CHOICE="${WORKFLOW_BACKUP_ENCRYPTION:-}"
while (( $# )); do
  case "$1" in
    --encryption) ENCRYPTION_CHOICE="${2:-}"; (( $# < 2 )) || shift ;;
    --encryption=*) ENCRYPTION_CHOICE="${1#*=}" ;;
    *) fail "Okänt val: $1 (installationen tar bara --encryption age eller --encryption gpg)." ;;
  esac
  shift
done
[[ -z "$ENCRYPTION_CHOICE" || "$ENCRYPTION_CHOICE" == age || "$ENCRYPTION_CHOICE" == gpg ]] \
  || fail "--encryption (eller WORKFLOW_BACKUP_ENCRYPTION) ska vara age eller gpg."
new_folder_hint="Vill du installera en ny, separat Workflow i stället? Välj en ny mapp, till exempel:
  curl -fsSL https://raw.githubusercontent.com/HINTEK-Workflow/workflow-community/main/install.sh | WORKFLOW_DIR=\"\$HOME/workflow-ny\" bash"
# Tells the user when the folder already holds an installation that is running now, before it is restarted.
show_running() {
  [[ -f "$DIR/.env" ]] || return 0
  local names; names="$(cd "$DIR" && docker compose ps --status running --format '{{.Name}}' 2>/dev/null | tr '\n' ' ' || true)"
  names="${names% }"; [[ -n "$names" ]] || return 0
  printf '\n\033[33mObs: Workflow i %s körs redan (%s).\n' "$DIR" "${names// /, }"
  printf 'Den uppdateras och startas om. Dina inställningar (.env), dina filer och databasen behålls.\n%s\n' "$new_folder_hint"
  printf 'Fortsätter om 10 sekunder. Tryck Ctrl+C för att avbryta.\033[0m\n'
  sleep 10
}

# The version to install: WORKFLOW_VERSION, else the newest release tag vX.Y.Z of the source, else main.
resolve_version() {
  if [[ -n "${WORKFLOW_VERSION:-}" ]]; then
    [[ "$WORKFLOW_VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ || "$WORKFLOW_VERSION" == main ]] \
      || fail "WORKFLOW_VERSION ska vara en version som v1.2.3, eller main."
    printf '%s' "$WORKFLOW_VERSION"; return
  fi
  local newest
  newest="$(git ls-remote --tags --refs "$SOURCE" 'v*' 2>/dev/null | sed 's#.*refs/tags/##' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
    | sed 's/^v//' | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1 || true)"
  if [[ -n "$newest" ]]; then printf 'v%s' "$newest"; else printf 'main'; fi
}

# The commits this clone already knows from the published repository (before a fetch): the remote branches, the tags and
# every earlier value of the remote branches. HEAD has no own commits if it is part of one of them.
known_commits() {
  git -C "$DIR" for-each-ref --format='%(objectname) %(*objectname)' refs/remotes refs/tags 2>/dev/null | tr ' ' '\n'
  local ref; for ref in $(git -C "$DIR" for-each-ref --format='%(refname)' refs/remotes 2>/dev/null); do
    git -C "$DIR" reflog show --format=%H "$ref" 2>/dev/null || true
  done
}
head_is_published() { # known commits on stdin
  local commit
  while read -r commit; do
    [[ "$commit" =~ ^[0-9a-f]{40,64}$ ]] || continue
    git -C "$DIR" merge-base --is-ancestor HEAD "$commit" 2>/dev/null && return 0
  done
  return 1
}
refuse_local_changes() {
  [[ -z "$(git -C "$DIR" status --porcelain --untracked-files=no)" ]] || fail "Du har ändrat filer i $DIR. De skrivs inte över.
Spara dina ändringar någon annanstans, eller låt mappen vara och installera i en ny mapp.
$new_folder_hint"
}

# Updates an existing clone to a release tag. A clone on main (an older installation) moves to the tag. If the published
# history has been rewritten, a clone without own commits or changes is moved to the new history and its old state is kept
# as a backup branch. .env, storage, backups and the database volume are not tracked by Git and are never touched.
update_to_tag() {
  local target="$1" current target_commit known backup
  current="$(git -C "$DIR" describe --tags --exact-match HEAD 2>/dev/null || git -C "$DIR" rev-parse --short HEAD)"
  refuse_local_changes
  known="$(known_commits)"
  git -C "$DIR" fetch --force origin "refs/tags/$target:refs/tags/$target" \
    || fail "Kunde inte hämta version $target till $DIR. Kontrollera internetanslutningen (och versionen) och kör igen."
  target_commit="$(git -C "$DIR" rev-parse "refs/tags/$target^{commit}")"
  if [[ "$(git -C "$DIR" rev-parse HEAD)" == "$target_commit" ]]; then
    echo "Workflow är redan version $target."
    return
  fi
  if git -C "$DIR" merge-base --is-ancestor HEAD "$target_commit" 2>/dev/null; then
    git -C "$DIR" -c advice.detachedHead=false checkout -q --detach "$target_commit" || fail "Kunde inte uppdatera $DIR."
    echo "Uppdaterar från $current till $target."
    return
  fi
  if git -C "$DIR" merge-base --is-ancestor "$target_commit" HEAD 2>/dev/null; then
    warn "Obs: $target är äldre än versionen du har ($current). Har den nyare versionen ändrat databasen startar den äldre inte;
återställ då backupen från före uppdateringen (INSTALLATION.md, avsnittet Återställ)."
  elif ! head_is_published <<< "$known"; then
    fail "$DIR innehåller egna ändringar (commits) som inte finns på GitHub. De skrivs inte över.
Spara dem, eller låt mappen vara och installera i en ny mapp.
$new_folder_hint"
  fi
  backup="backup/$(date +%Y-%m-%d-%H%M%S)"
  git -C "$DIR" branch "$backup" HEAD || fail "Kunde inte spara en kopia av den gamla versionen."
  git -C "$DIR" -c advice.detachedHead=false checkout -q --detach "$target_commit" || fail "Kunde inte uppdatera $DIR."
  echo "Byter från $current till $target. Den gamla versionen finns kvar i Git-grenen $backup."
}

# Updates an existing clone that follows main (WORKFLOW_VERSION=main, or a source without release tags).
update_to_main() {
  local upstream remote_ref commit backup
  upstream="$(git -C "$DIR" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)" \
    || fail "$DIR följer ingen gren på GitHub och kan inte uppdateras automatiskt.
$new_folder_hint"
  remote_ref="refs/remotes/$upstream"
  local known; known="$(known_commits)"
  git -C "$DIR" fetch origin || fail "Kunde inte hämta uppdateringar till $DIR. Kontrollera internetanslutningen och kör igen."
  if git -C "$DIR" merge-base --is-ancestor HEAD "$remote_ref" 2>/dev/null; then
    git -C "$DIR" merge --ff-only "$remote_ref" || fail "Kunde inte uppdatera $DIR."
    return
  fi
  echo "Den publicerade versionen har en ny historik, så $DIR kan inte uppdateras på vanligt sätt."
  refuse_local_changes
  head_is_published <<< "$known" || fail "$DIR innehåller egna ändringar (commits) som inte finns på GitHub. De skrivs inte över.
Spara dem, eller låt mappen vara och installera i en ny mapp.
$new_folder_hint"
  backup="backup/$(date +%Y-%m-%d-%H%M%S)"
  git -C "$DIR" branch "$backup" HEAD || fail "Kunde inte spara en kopia av den gamla versionen."
  git -C "$DIR" reset --hard "$remote_ref" || fail "Kunde inte uppdatera $DIR."
  echo "Uppdaterat till den nya versionen. Den gamla versionen finns kvar i Git-grenen $backup."
  echo "Dina inställningar (.env), dina filer (storage) och databasen är orörda."
}

# The backup before an update (run in $DIR, with the app stopped): the database as pg_dump in custom format, restored into a
# temporary database in the same PostgreSQL container to prove it can be read (the number of tables must match), and the
# files as a tar archive that is listed back. Then SHA256SUMS, an optional age encryption and the retention.
backup_before_update() {
  local stamp target tables_live tables_copy files_live files_copy recipient
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  target="$DIR/backups/update-$stamp"
  mkdir -p "$target"; chmod 700 "$DIR/backups" "$target"
  docker compose start postgres >/dev/null 2>&1 || docker compose up -d postgres >/dev/null || return 1
  for _ in $(seq 1 60); do docker compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1 && break; sleep 2; done
  echo "Databasen ..."
  docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges -f /tmp/workflow-update.dump' || return 1
  docker compose cp postgres:/tmp/workflow-update.dump "$target/database.dump" >/dev/null 2>&1 || return 1
  [[ -s "$target/database.dump" ]] || return 1
  read -r tables_live tables_copy < <(docker compose exec -T postgres sh -c '
    set -e
    check=workflow_backup_check
    dropdb -U "$POSTGRES_USER" --if-exists "$check" >/dev/null 2>&1
    createdb -U "$POSTGRES_USER" "$check"
    pg_restore -U "$POSTGRES_USER" -d "$check" --no-owner --no-privileges --exit-on-error /tmp/workflow-update.dump
    count="select count(*) from information_schema.tables where table_schema = '\''public'\''"
    live=$(psql -X -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$count")
    copy=$(psql -X -At -U "$POSTGRES_USER" -d "$check" -c "$count")
    # The number of rows per table in the copy (names and numbers only), for the restore drill to compare with.
    psql -X -At -U "$POSTGRES_USER" -d "$check" -c "select format('"'"'select %L || chr(9) || count(*) from %I.%I;'"'"', table_name, table_schema, table_name) from information_schema.tables where table_schema = '"'"'public'"'"' and table_type = '"'"'BASE TABLE'"'"' order by table_name" \
      | psql -X -At -U "$POSTGRES_USER" -d "$check" > /tmp/workflow-update.rows
    dropdb -U "$POSTGRES_USER" "$check"
    rm -f /tmp/workflow-update.dump
    echo "$live $copy"' | tail -n 1) || return 1
  [[ -n "$tables_live" && "$tables_live" == "$tables_copy" ]] || { echo "Kopian har $tables_copy tabeller, databasen $tables_live." >&2; return 1; }
  docker compose cp postgres:/tmp/workflow-update.rows "$target/ROWS" >/dev/null 2>&1 || true
  docker compose exec -T postgres rm -f /tmp/workflow-update.rows >/dev/null 2>&1 || true
  echo "  läst tillbaka i en tillfällig databas: $tables_copy tabeller, samma som i databasen"
  echo "Filerna ..."
  read -r files_live files_copy < <(docker compose run --rm --no-deps -T -e HOST_ID="$(id -u):$(id -g)" -v "$target:/backup" app sh -c '
    set -e
    tar -czf /backup/storage.tar.gz -C /app/storage .
    live=$(cd /app/storage && find . | wc -l)
    copy=$(tar -tzf /backup/storage.tar.gz | wc -l)
    chown "$HOST_ID" /backup/storage.tar.gz 2>/dev/null || true
    echo "$live $copy"' | tail -n 1) || return 1
  [[ -n "$files_live" && "$files_live" == "$files_copy" ]] || { echo "Arkivet har $files_copy poster, lagringen $files_live." >&2; return 1; }
  echo "  arkivet listat tillbaka: $files_copy filer och mappar"
  # Always encrypted (K1.6, 2026-11-28): ensure_backup_encryption has made sure there is a recipient and the program (age,
  # or gpg with BACKUP_ENCRYPTION=gpg). The sums of the plain files are kept to check after decrypting; only the .age (.gpg)
  # files stay.
  local encryption setting
  encryption="$(env_value BACKUP_ENCRYPTION)"; encryption="${encryption:-age}"
  if [[ "$encryption" == gpg ]]; then setting=BACKUP_GPG_RECIPIENT_FILE; else encryption=age; setting=BACKUP_AGE_RECIPIENT; fi
  recipient="$(env_value "$setting")"
  [[ -n "$recipient" ]] && command -v "$encryption" >/dev/null 2>&1 || { echo "Backupen krypteras alltid, men $setting eller programmet $encryption saknas." >&2; rm -f "$target/database.dump" "$target/storage.tar.gz"; return 1; }
  ( cd "$target" && sha256 database.dump storage.tar.gz > SHA256SUMS.plain ) || return 1
  local file
  for file in database.dump storage.tar.gz; do
    encrypt_backup_file "$encryption" "$recipient" "$target/$file" "$target/$file.$encryption" && [[ -s "$target/$file.$encryption" ]] && rm -f "$target/$file" \
      || { rm -f "$target/database.dump" "$target/storage.tar.gz" "$target/$file.$encryption"; return 1; }
  done
  echo "  krypterad med $encryption till $setting"
  ( cd "$target" && sha256 "database.dump.$encryption" "storage.tar.gz.$encryption" > SHA256SUMS ) || return 1
  printf 'created=%s\nfrom=%s\ntables=%s\nfiles=%s\nencrypted=%s\n' "$stamp" "${previous_version:-okänd}" "$tables_copy" "$files_copy" "$encryption" > "$target/MANIFEST"
  [[ -s "$target/ROWS" ]] || rm -f "$target/ROWS"
  echo "Backup klar: $target"
  # Retention: the newest KEEP_BACKUPS update backups stay; only folders named like a stamp are removed.
  if [[ "$KEEP_BACKUPS" =~ ^[0-9]+$ ]] && (( KEEP_BACKUPS >= 1 )); then
    find "$DIR/backups" -mindepth 1 -maxdepth 1 -type d -name 'update-20[0-9][0-9][01][0-9][0-3][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z' \
      | sort -r | tail -n +"$((KEEP_BACKUPS + 1))" | while read -r old; do rm -rf -- "$old"; done
  fi
}

# The backups are always encrypted (K1.6, 2026-11-28). BACKUP_AGE_RECIPIENT in .env (or WORKFLOW_BACKUP_AGE_RECIPIENT the
# first time) is the public key; the private key is best made on another computer (age-keygen -o workflow-backup.key). Without
# one, a key pair is made here in backup-key/ (only this user can read it) and the admin is told to move a copy of the private
# key somewhere safe: without it no backup can be opened. age is needed on this computer either way.
age_hint="Installera age (Debian/Ubuntu: sudo apt install age, Fedora: sudo dnf install age, macOS: brew install age) och kör igen."
gpg_hint="Installera GnuPG (Debian/Ubuntu: sudo apt install gnupg, Fedora: sudo dnf install gnupg2, macOS: brew install gnupg) och kör igen."
ensure_backup_encryption() {
  local encryption
  encryption="${ENCRYPTION_CHOICE:-$(env_value BACKUP_ENCRYPTION)}"; encryption="${encryption:-age}"
  [[ "$encryption" == age || "$encryption" == gpg ]] || fail "BACKUP_ENCRYPTION i .env ska vara age eller gpg."
  [[ -z "$ENCRYPTION_CHOICE" ]] || set_value BACKUP_ENCRYPTION "$encryption" "$DIR/.env"
  if [[ "$encryption" == gpg ]]; then ensure_gpg_encryption; else ensure_age_encryption; fi
  BACKUP_ENCRYPTION="$encryption"
}

# A path in .env is relative to the install folder (the cron line of nightly-backup.sh runs there too).
gpg_key_path() { if [[ "$1" == /* ]]; then printf '%s' "$1"; else printf '%s/%s' "$DIR" "$1"; fi; }

# Makes the backups' GnuPG key pair (RSA 4096 with an RSA 4096 subkey for encryption) in its own GNUPGHOME: <home> <private
# key file> <public key file>. No expiry, so the backups never stop silently when a date passes; without a passphrase, like
# the age key, because the nightly backup only needs the public key and the private one is meant to leave this computer.
gpg_make_key() {
  local home="$1" fpr
  mkdir -p "$home" && chmod 700 "$home" || return 1
  gpg --homedir "$home" --batch --gen-key >/dev/null 2>&1 <<'GPGKEY' || return 1
%no-protection
Key-Type: RSA
Key-Length: 4096
Key-Usage: cert
Subkey-Type: RSA
Subkey-Length: 4096
Subkey-Usage: encrypt
Name-Real: Workflow backup
Expire-Date: 0
%commit
GPGKEY
  fpr="$(gpg --homedir "$home" --batch --with-colons --list-secret-keys 2>/dev/null | awk -F: '$1 == "fpr" { print $10; exit }')"
  [[ "$fpr" =~ ^([0-9A-F]{40}|[0-9A-F]{64})$ ]] || return 1
  ( umask 077; gpg --homedir "$home" --batch --armor --export-secret-keys "$fpr" > "$2" 2>/dev/null ) && [[ -s "$2" ]] || return 1
  gpg --homedir "$home" --batch --armor --export "$fpr" > "$3" 2>/dev/null && [[ -s "$3" ]]
}

# Empty when the file is a public key that can encrypt with RSA of at least 3072 bits; otherwise the reason.
gpg_key_problem() {
  local home lines
  [[ -s "$1" ]] || { printf 'filen %s finns inte' "$1"; return; }
  home="$(mktemp -d)"
  lines="$(gpg --homedir "$home" --batch --with-colons --show-keys "$1" 2>/dev/null || true)"
  gpgconf --homedir "$home" --kill all >/dev/null 2>&1 || true; rm -rf -- "$home"
  if grep -qE '^(sec|ssb):' <<< "$lines"; then printf 'filen innehåller en privat nyckel; ange bara den publika'
  elif ! awk -F: '($1 == "pub" || $1 == "sub") && $2 !~ /[rei]/ && $4 == 1 && $3 >= 3072 && $12 ~ /e/ { found = 1 } END { exit !found }' <<< "$lines"; then
    printf 'nyckeln ska vara en publik RSA-nyckel med minst 3072 bitar som kan kryptera'
  fi
}

# One backup file encrypted: <age|gpg> <recipient: age1… or the public key file> <plain file> <encrypted file>. gpg reads the
# public key from the file (--recipient-file) in a GNUPGHOME of its own that is removed again; no keyring is used or changed.
encrypt_backup_file() {
  [[ "$1" == gpg ]] || { age -r "$2" -o "$4" "$3"; return; }
  gpg_encrypt_file "$(gpg_key_path "$2")" "$3" "$4"
}
gpg_encrypt_file() { # <public key file> <plain file> <encrypted file>
  local home status=0
  home="$(mktemp -d)"
  gpg --homedir "$home" --batch --yes --no-tty --trust-model always --cipher-algo AES256 --compress-algo none \
    --recipient-file "$1" -o "$3" --encrypt "$2" >/dev/null 2>"$home/gpg.err" || { status=$?; cat "$home/gpg.err" >&2; }
  gpgconf --homedir "$home" --kill all >/dev/null 2>&1 || true; rm -rf -- "$home"
  return "$status"
}

# GnuPG (BACKUP_ENCRYPTION=gpg): BACKUP_GPG_RECIPIENT_FILE in .env (or WORKFLOW_BACKUP_GPG_RECIPIENT_FILE the first time, then
# copied to backup-key/) is the public key; without one a key pair is made in a temporary GNUPGHOME of its own, the private
# key exported to backup-key/workflow-backup.gpgkey (like the age key) and that GNUPGHOME removed again.
ensure_gpg_encryption() {
  local file pub key home problem
  command -v gpg >/dev/null 2>&1 || fail "Backuperna ska krypteras med GnuPG, men programmet gpg finns inte. $gpg_hint"
  file="$(env_value BACKUP_GPG_RECIPIENT_FILE)"
  pub="$DIR/backup-key/workflow-backup.pub.asc"; key="$DIR/backup-key/workflow-backup.gpgkey"
  if [[ -z "$file" && -n "${WORKFLOW_BACKUP_GPG_RECIPIENT_FILE:-}" ]]; then
    [[ -s "$WORKFLOW_BACKUP_GPG_RECIPIENT_FILE" ]] || fail "Filen i WORKFLOW_BACKUP_GPG_RECIPIENT_FILE finns inte: $WORKFLOW_BACKUP_GPG_RECIPIENT_FILE"
    mkdir -p "$DIR/backup-key"; chmod 700 "$DIR/backup-key"
    cp -- "$WORKFLOW_BACKUP_GPG_RECIPIENT_FILE" "$pub" || fail "Kunde inte kopiera den publika nyckeln till $pub."
    file=backup-key/workflow-backup.pub.asc
    set_value BACKUP_GPG_RECIPIENT_FILE "$file" "$DIR/.env"
  fi
  if [[ -z "$file" ]]; then
    if [[ ! -s "$pub" ]]; then
      # Never a new key over an old private key: the backups made with it could no longer be opened.
      [[ ! -s "$key" ]] || fail "$key finns men inte den publika nyckeln $pub. Exportera den publika delen dit (gpg --armor --export) och kör igen."
      mkdir -p "$DIR/backup-key"; chmod 700 "$DIR/backup-key"
      # The GNUPGHOME is a new folder of mktemp (only this user can read it), not one under the install folder: gpg-agent's
      # socket lies in it on macOS and in Git Bash, and a long install path makes that socket path too long to open.
      home="$(mktemp -d)/gnupg"
      if ! gpg_make_key "$home" "$key" "$pub"; then
        gpgconf --homedir "$home" --kill all >/dev/null 2>&1 || true; rm -rf -- "${home%/gnupg}"; rm -f -- "$key" "$pub"
        fail "Kunde inte skapa en GnuPG-nyckel för backuperna i $DIR/backup-key."
      fi
      gpgconf --homedir "$home" --kill all >/dev/null 2>&1 || true; rm -rf -- "${home%/gnupg}"
    fi
    file=backup-key/workflow-backup.pub.asc
    set_value BACKUP_GPG_RECIPIENT_FILE "$file" "$DIR/.env"
  fi
  problem="$(gpg_key_problem "$(gpg_key_path "$file")")"
  [[ -z "$problem" ]] || fail "BACKUP_GPG_RECIPIENT_FILE i .env ($file): $problem."
}

ensure_age_encryption() {
  local recipient key
  recipient="$(env_value BACKUP_AGE_RECIPIENT)"
  if [[ -z "$recipient" && -n "${WORKFLOW_BACKUP_AGE_RECIPIENT:-}" ]]; then
    recipient="$WORKFLOW_BACKUP_AGE_RECIPIENT"
    set_value BACKUP_AGE_RECIPIENT "$recipient" "$DIR/.env"
  fi
  command -v age >/dev/null 2>&1 || fail "Backuperna krypteras alltid med age, men programmet age finns inte. $age_hint"
  if [[ -z "$recipient" ]]; then
    command -v age-keygen >/dev/null 2>&1 || fail "age-keygen saknas (det följer med age). $age_hint"
    key="$DIR/backup-key/workflow-backup.agekey"
    if [[ ! -s "$key" ]]; then
      mkdir -p "$DIR/backup-key"; chmod 700 "$DIR/backup-key"
      ( umask 077; age-keygen -o "$key" >/dev/null 2>&1 ) || fail "Kunde inte skapa en nyckel för backuperna i $DIR/backup-key."
    fi
    recipient="$(age-keygen -y "$key")" || fail "Kunde inte läsa den publika delen av $key."
    set_value BACKUP_AGE_RECIPIENT "$recipient" "$DIR/.env"
  fi
  [[ "$recipient" =~ ^age1[0-9a-z]{58}$ ]] || fail "BACKUP_AGE_RECIPIENT i .env ska vara en publik age-nyckel som börjar med age1."
}

printf '\033[36mWorkflow Community Edition - installation\033[0m\n'

step "Kontrollerar Git och Docker"
command -v git >/dev/null || fail "Git saknas. Installera Git och kör igen."
command -v docker >/dev/null || fail "Docker saknas. Installera Docker Desktop (Mac) eller Docker Engine (Linux) och kör igen."
docker info >/dev/null 2>&1 || fail "Docker är inte igång. Starta det och kör igen."
docker compose version >/dev/null 2>&1 || fail "Docker Compose saknas. Installera Docker Compose v2 och kör igen."

version="$(resolve_version)"
[[ "$version" == main ]] && warn "Ingen släppt version hittades; följer main."
step "Hämtar Workflow $version till $DIR"
updating=false
if [[ -d "$DIR/.git" ]]; then
  show_running
  # The version before the update, for the backup's MANIFEST (Återställ in INSTALLATION.md goes back to it).
  previous_version="$(git -C "$DIR" describe --tags --always HEAD 2>/dev/null || echo okänd)"
  if [[ "$version" == main ]]; then update_to_main; else update_to_tag "$version"; fi
  [[ -f "$DIR/.env" ]] && updating=true
elif [[ -e "$DIR" ]]; then fail "$DIR finns redan men är ingen Workflow-installation.
$new_folder_hint"
elif [[ "$version" == main ]]; then git clone --depth 1 "$SOURCE" "$DIR"
else git -c advice.detachedHead=false clone --depth 1 --branch "$version" "$SOURCE" "$DIR"; fi
cd "$DIR"

new_install=false
if [[ -f .env ]]; then
  step "Behåller dina befintliga inställningar (.env)"
else
  step "Skapar inställningar"
  admin_email="${WORKFLOW_ADMIN_EMAIL:-}"
  until [[ "$admin_email" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; do admin_email="$(ask "Din e-postadress (för inloggning): ")"; done
  name="${WORKFLOW_NAME:-}"; [[ -n "$name" ]] || name="$(ask "Namn på installationen [Workflow]: ")"; name="${name:-Workflow}"
  app_port="$(free_port 3000)"; db_port="$(free_port 5432)"
  cp .env.example .env && chmod 600 .env
  set_value APP_URL "http://localhost:$app_port" .env
  set_value NEXTAUTH_URL "http://localhost:$app_port" .env
  set_value AUTH_SECRET "$(secret)" .env
  set_value INTEGRATION_KEYS_SECRET "$(secret)" .env
  set_value POSTGRES_PASSWORD "$(secret)" .env
  set_value SEED_ADMIN_PASSWORD "$(secret)" .env
  set_value INSTANCE_NAME "$name" .env
  set_value INSTANCE_OPERATOR "$name" .env
  set_value INSTANCE_ADMIN_EMAIL "$admin_email" .env
  set_value APP_PORT "$app_port" .env
  set_value POSTGRES_PORT "$db_port" .env
  # Container and image names follow the folder, so two installations on one computer never collide or share a build.
  prefix="$(basename "$DIR" | tr "[:upper:]" "[:lower:]" | sed "s/[^a-z0-9_.-]/-/g")"
  set_value CONTAINER_PREFIX "$prefix" .env
  set_value APP_IMAGE "workflow-community-$prefix:local" .env
  new_install=true
  echo "Workflow använder port $app_port (databasen $db_port)."
fi
app_port="$(env_value APP_PORT)"; admin_email="$(env_value INSTANCE_ADMIN_EMAIL)"
step "Kontrollerar krypteringen av backuperna"
ensure_backup_encryption
if [[ "$BACKUP_ENCRYPTION" == gpg ]]; then echo "Backuperna krypteras med GnuPG (AES-256, RSA) till nyckeln i BACKUP_GPG_RECIPIENT_FILE i .env."
else echo "Backuperna krypteras med age till BACKUP_AGE_RECIPIENT i .env."; fi

if $updating; then
  # The new version is built while the old one keeps running; then the old one stops, the backup is taken and read back,
  # and only then does the new version start and migrate the database.
  step "Bygger den nya versionen (den gamla körs under tiden)"
  docker compose build app || fail "Docker kunde inte bygga den nya versionen. Den gamla körs som förut. Se felet ovan."
  if [[ "${WORKFLOW_SKIP_BACKUP:-}" == 1 ]]; then
    warn "WORKFLOW_SKIP_BACKUP=1: ingen backup tas före uppdateringen."
  else
    step "Tar en backup och läser tillbaka den innan databasen uppdateras"
    docker compose stop app >/dev/null 2>&1 || true
    if ! backup_before_update; then
      docker compose start app >/dev/null 2>&1 || true
      fail "Backupen kunde inte tas eller läsas tillbaka, så databasen har inte ändrats och den gamla versionen startades igen.
Se felet ovan. Uppdatera inte utan backup; WORKFLOW_SKIP_BACKUP=1 hoppar över den på egen risk."
    fi
  fi
  step "Startar den nya versionen"
  docker compose up -d || fail "Docker kunde inte starta Workflow. Se felet ovan och INSTALLATION.md, avsnittet Om uppdateringen stannar."
else
  step "Bygger och startar (första gången tar det 5-10 minuter)"
  docker compose up -d --build || fail "Docker kunde inte starta Workflow. Se felet ovan."
fi

step "Väntar tills Workflow svarar"
url="http://localhost:$app_port"
ready=false
for _ in $(seq 1 120); do
  curl -fsS "$url/api/health/ready" >/dev/null 2>&1 && { ready=true; break; }
  sleep 5
done
$ready || fail "Workflow svarade inte inom 10 minuter. Se loggen med: docker compose logs app
Stannade uppdateringen vid databasen: se INSTALLATION.md, avsnittet Om uppdateringen stannar."

# The account is made on a new installation, and also on a later run when .env exists but an earlier run stopped before
# the account was made (admin:create with ADMIN_CREATE_CHECK=1 exits 0 only while the installation has no account).
# The admin commands run as the app's own user "node", not root.
account_needed=$new_install
if ! $new_install && docker compose exec -T --user node -e ADMIN_CREATE_CHECK=1 app npm run -s admin:create >/dev/null 2>&1; then
  echo "Installationen har inget konto ännu, så det skapas nu."
  account_needed=true
fi

if $account_needed; then
  step "Skapar ditt konto ($admin_email)"
  echo "Lösenordet ska ha minst 12 tecken och får inte vara ett vanligt lösenord som Password1234."
  password="${WORKFLOW_ADMIN_PASSWORD:-}"
  created=false
  # admin:create exits 2 when it refuses the password (too short or too common) and has then written why. The person
  # chooses a new one, at most three times, without starting the installation over. Exit 3: an account already exists.
  for attempt in 1 2 3; do
    while (( ${#password} < 12 )); do
      read -r -s -p "Välj ett lösenord: " password < /dev/tty; echo
      (( ${#password} >= 12 )) || echo "Lösenordet måste ha minst 12 tecken."
    done
    status=0
    ADMIN_PASSWORD="$password" docker compose exec -T --user node -e ADMIN_PASSWORD app npm run -s admin:create || status=$?
    if (( status == 0 || status == 3 )); then created=true; break; fi
    (( status == 2 )) || fail "Kontot kunde inte skapas. Se felet ovan och kör installationsraden igen."
    [[ -z "${WORKFLOW_ADMIN_PASSWORD:-}" ]] || fail "Lösenordet i WORKFLOW_ADMIN_PASSWORD godtogs inte. Välj ett annat och kör installationsraden igen."
    password=""
    (( attempt == 3 )) || echo "Välj ett annat lösenord."
  done
  unset password
  $created || fail "Kontot kunde inte skapas efter tre försök. Kör installationsraden igen och välj ett annat lösenord. Dina inställningar behålls."
fi

printf '\n\033[32mKlart! Workflow %s körs på %s\033[0m\n' "$version" "$url"
echo "Logga in med $admin_email."
echo
echo "I mappen $DIR :"
echo "  Stänga av:        docker compose down"
echo "  Starta igen:      docker compose up -d"
echo "  Uppdatera:        kör installationsraden igen (tar en backup först)"
echo "  Gå tillbaka:      INSTALLATION.md, avsnittet Återställ (backuperna ligger i $DIR/backups)"
echo "  Ta bort allt:     docker compose down -v   (raderar även datan)"
for backup_key in "$DIR/backup-key/workflow-backup.agekey" "$DIR/backup-key/workflow-backup.gpgkey"; do
  [[ -s "$backup_key" ]] || continue
  printf '\n\033[33mViktigt: den privata nyckeln till backuperna ligger i %s\n' "$backup_key"
  echo "Kopiera den nu till en säker plats utanför den här datorn (en lösenordshanterare eller ett USB-minne i ett kassaskåp),"
  echo "helst två ställen. Utan den går ingen backup att öppna. Ligger den bara här försvinner den med datorn."
  [[ "$backup_key" != *.gpgkey ]] || echo "Nyckeln har ingen utgångstid, så backuperna slutar aldrig fungera av sig själva."
  printf 'Flytta den sedan härifrån, så att den som kommer åt datorn inte också kan läsa backuperna (INSTALLATION.md, avsnitt 6).\033[0m\n'
done
if [[ -n "${WORKFLOW_NO_BROWSER:-}" ]]; then :
elif command -v open >/dev/null; then open "$url"; elif command -v xdg-open >/dev/null; then xdg-open "$url" >/dev/null 2>&1 || true; fi
