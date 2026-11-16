#!/usr/bin/env bash
# Workflow Community Edition - installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/HINTEK-Workflow/workflow-community/main/install.sh | bash
#
# Downloads Workflow, writes .env with new random secrets and free ports, starts it with Docker, creates your owner
# account and opens the browser. Run it again to update: your .env and your data are kept.
# Optional: WORKFLOW_DIR (install folder), WORKFLOW_SOURCE (git repository to install from). Without questions:
# WORKFLOW_ADMIN_EMAIL, WORKFLOW_ADMIN_PASSWORD, WORKFLOW_NAME; WORKFLOW_NO_BROWSER=1 opens no browser.
set -Eeuo pipefail

SOURCE="${WORKFLOW_SOURCE:-https://github.com/HINTEK-Workflow/workflow-community.git}"
DIR="${WORKFLOW_DIR:-$HOME/workflow-community}"

step() { printf '\n\033[36m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mStopp: %s\033[0m\n' "$*" >&2; exit 1; }
secret() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }
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
# Updates an existing clone. If the published history has been rewritten, a clone without own commits or changes is
# moved to the new history and its old state is kept as a backup branch. .env, storage and the database volume are not
# tracked by Git and are never touched.
update_clone() {
  local upstream remote_ref before commit backup own=true
  upstream="$(git -C "$DIR" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)" \
    || fail "$DIR följer ingen gren på GitHub och kan inte uppdateras automatiskt.
$new_folder_hint"
  remote_ref="refs/remotes/$upstream"
  before="$(git -C "$DIR" rev-parse -q --verify "$remote_ref" 2>/dev/null || true)"
  git -C "$DIR" fetch origin || fail "Kunde inte hämta uppdateringar till $DIR. Kontrollera internetanslutningen och kör igen."
  if git -C "$DIR" merge-base --is-ancestor HEAD "$remote_ref" 2>/dev/null; then
    git -C "$DIR" merge --ff-only "$remote_ref" || fail "Kunde inte uppdatera $DIR."
    return
  fi
  echo "Den publicerade versionen har en ny historik, så $DIR kan inte uppdateras på vanligt sätt."
  if [[ -n "$(git -C "$DIR" status --porcelain --untracked-files=no)" ]]; then
    fail "Du har ändrat filer i $DIR. De skrivs inte över.
Spara dina ändringar någon annanstans, eller låt mappen vara och installera i en ny mapp.
$new_folder_hint"
  fi
  # HEAD has no own commits if it is part of what the remote branch pointed to before this run or earlier. The ref's
  # log holds every old and new value, also the one a forced update replaced in an earlier, failed run.
  local log; log="$(git -C "$DIR" rev-parse --absolute-git-dir)/logs/$remote_ref"
  for commit in $before $( [[ -f "$log" ]] && awk '{ print $1; print $2 }' "$log" | sort -u ); do
    if git -C "$DIR" merge-base --is-ancestor HEAD "$commit" 2>/dev/null; then own=false; break; fi
  done
  if $own; then
    fail "$DIR innehåller egna ändringar (commits) som inte finns på GitHub. De skrivs inte över.
Spara dem, eller låt mappen vara och installera i en ny mapp.
$new_folder_hint"
  fi
  backup="backup/$(date +%Y-%m-%d-%H%M%S)"
  git -C "$DIR" branch "$backup" HEAD || fail "Kunde inte spara en kopia av den gamla versionen."
  git -C "$DIR" reset --hard "$remote_ref" || fail "Kunde inte uppdatera $DIR."
  echo "Uppdaterat till den nya versionen. Den gamla versionen finns kvar i Git-grenen $backup."
  echo "Dina inställningar (.env), dina filer (storage) och databasen är orörda."
}

printf '\033[36mWorkflow Community Edition - installation\033[0m\n'

step "Kontrollerar Git och Docker"
command -v git >/dev/null || fail "Git saknas. Installera Git och kör igen."
command -v docker >/dev/null || fail "Docker saknas. Installera Docker Desktop (Mac) eller Docker Engine (Linux) och kör igen."
docker info >/dev/null 2>&1 || fail "Docker är inte igång. Starta det och kör igen."
docker compose version >/dev/null 2>&1 || fail "Docker Compose saknas. Installera Docker Compose v2 och kör igen."

step "Hämtar Workflow till $DIR"
if [[ -d "$DIR/.git" ]]; then show_running; update_clone
elif [[ -e "$DIR" ]]; then fail "$DIR finns redan men är ingen Workflow-installation.
$new_folder_hint"
else git clone --depth 1 "$SOURCE" "$DIR"; fi
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
  # Container names follow the folder, so two installations on one computer never collide.
  set_value CONTAINER_PREFIX "$(basename "$DIR" | tr "[:upper:]" "[:lower:]" | sed "s/[^a-z0-9_.-]/-/g")" .env
  new_install=true
  echo "Workflow använder port $app_port (databasen $db_port)."
fi
app_port="$(env_value APP_PORT)"; admin_email="$(env_value INSTANCE_ADMIN_EMAIL)"

step "Bygger och startar (första gången tar det 5-10 minuter)"
docker compose up -d --build || fail "Docker kunde inte starta Workflow. Se felet ovan."

step "Väntar tills Workflow svarar"
url="http://localhost:$app_port"
ready=false
for _ in $(seq 1 120); do
  curl -fsS "$url/api/health/ready" >/dev/null 2>&1 && { ready=true; break; }
  sleep 5
done
$ready || fail "Workflow svarade inte inom 10 minuter. Se loggen med: docker compose logs app"

if $new_install; then
  step "Skapar ditt konto ($admin_email)"
  password="${WORKFLOW_ADMIN_PASSWORD:-}"
  while (( ${#password} < 12 )); do read -r -s -p "Välj ett lösenord (minst 12 tecken): " password < /dev/tty; echo; done
  ADMIN_PASSWORD="$password" docker compose exec -T -e ADMIN_PASSWORD app npm run -s admin:create || fail "Kontot kunde inte skapas."
  unset password
fi

printf '\n\033[32mKlart! Workflow körs på %s\033[0m\n' "$url"
echo "Logga in med $admin_email."
echo
echo "I mappen $DIR :"
echo "  Stänga av:        docker compose down"
echo "  Starta igen:      docker compose up -d"
echo "  Uppdatera:        kör installationsraden igen"
echo "  Ta bort allt:     docker compose down -v   (raderar även datan)"
if [[ -n "${WORKFLOW_NO_BROWSER:-}" ]]; then :
elif command -v open >/dev/null; then open "$url"; elif command -v xdg-open >/dev/null; then xdg-open "$url" >/dev/null 2>&1 || true; fi
