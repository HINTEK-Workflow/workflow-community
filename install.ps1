# Workflow Community Edition - installer for Windows (PowerShell 5.1 or later).
#
#   irm https://raw.githubusercontent.com/HINTEK-Workflow/workflow-community/main/install.ps1 | iex
#
# Downloads Workflow, writes .env with new random secrets and free ports, starts it with Docker, creates your owner
# account and opens the browser. Run it again to update: your .env and your data are kept. If an earlier run stopped
# before the account was made, the next run creates it.
#
# Versions: it installs the newest released version (a tag vX.Y.Z), not whatever is on main. $env:WORKFLOW_VERSION picks one
# (v1.2.3, or main to follow main as before). Before an update changes the database it stops the app, takes a backup of the
# database and the files into backups\update-<time>\, restores the database copy into a temporary database to prove it can
# be read, checks the file archive, and only then starts the new version (which runs the migrations). With
# BACKUP_AGE_RECIPIENT in .env and age.exe installed, the backup is encrypted to that key. INSTALLATION.md, "Återställ",
# tells how to go back.
#
# Optional: $env:WORKFLOW_DIR (install folder), $env:WORKFLOW_SOURCE (git repository to install from), $env:WORKFLOW_VERSION,
# $env:WORKFLOW_KEEP_BACKUPS (how many update backups are kept, 5). $env:WORKFLOW_SKIP_BACKUP=1 skips the backup (not
# recommended). Without questions: $env:WORKFLOW_ADMIN_EMAIL, $env:WORKFLOW_ADMIN_PASSWORD, $env:WORKFLOW_NAME;
# $env:WORKFLOW_NO_BROWSER=1 opens no browser.

$ErrorActionPreference = "Stop"
$Source = if ($env:WORKFLOW_SOURCE) { $env:WORKFLOW_SOURCE } else { "https://github.com/HINTEK-Workflow/workflow-community.git" }
$Dir = if ($env:WORKFLOW_DIR) { $env:WORKFLOW_DIR } else { Join-Path $HOME "workflow-community" }
$KeepBackups = if ($env:WORKFLOW_KEEP_BACKUPS -match "^\d+$") { [int]$env:WORKFLOW_KEEP_BACKUPS } else { 5 }
# npm in the containers never asks the registry for a newer npm.
$env:NPM_CONFIG_UPDATE_NOTIFIER = "false"

function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host ""; Write-Host "Stopp: $text" -ForegroundColor Red; throw $text }
function Warn($text) { Write-Host $text -ForegroundColor Yellow }
function Secret { $bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); -join ($bytes | ForEach-Object { $_.ToString("x2") }) }
function FreePort($start) {
  for ($port = $start; $port -lt $start + 100; $port++) {
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $port)
    try { $listener.Start(); $listener.Stop(); return $port } catch { }
  }
  Fail "Hittade ingen ledig port från $start."
}
function SetValue([string[]]$lines, $key, $value) {
  $found = $false
  $result = foreach ($line in $lines) { if ($line -match "^$key=") { $found = $true; "$key=$value" } else { $line } }
  if (-not $found) { $result += "$key=$value" }
  return ,$result
}
function EnvValue($key) {
  $file = Join-Path $Dir ".env"
  if (-not (Test-Path $file)) { return "" }
  $line = Get-Content $file | Where-Object { $_ -match "^$key=" } | Select-Object -Last 1
  if ($line) { return ($line -replace "^$key=", "") } else { return "" }
}
# External programs write progress to stderr; only their exit code decides whether a step failed.
function Native {
  param([scriptblock]$Command, [string]$Message)
  $previous = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  try { & $Command 2>&1 | ForEach-Object { Write-Host $_ } } finally { $ErrorActionPreference = $previous }
  if ($LASTEXITCODE -ne 0) { Fail $Message }
}
# Like Native, but returns the exit code instead of stopping, for a step whose codes mean different things.
function NativeCode([scriptblock]$Command) {
  $previous = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  try { & $Command 2>&1 | ForEach-Object { Write-Host $_ } } finally { $ErrorActionPreference = $previous }
  return $LASTEXITCODE
}
function Succeeds([scriptblock]$Command) {
  $previous = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  try { & $Command *> $null } finally { $ErrorActionPreference = $previous }
  return $LASTEXITCODE -eq 0
}
# Runs git in the install folder and returns its output, or $null if git failed.
function GitOut {
  $previous = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  try { $out = & git -C $Dir @args 2>$null } finally { $ErrorActionPreference = $previous }
  if ($LASTEXITCODE -ne 0) { return $null }
  return $out
}
# Runs a small sh script in a container and returns the last line it printed, or $null if it failed. The script is a file
# (LF line endings), never a command-line argument or stdin, so that no quoting of PowerShell 5.1 can change it.
# $Folder: a folder of this computer that the container sees at $InContainer (the script is written there and removed);
# without it the script is copied into the postgres container with docker compose cp.
function ContainerScript([string]$script, [string[]]$DockerArgs, [string]$Folder = "", [string]$InContainer = "") {
  $name = "workflow-backup-step.sh"
  $utf8 = New-Object Text.UTF8Encoding($false)
  $local = if ($Folder) { Join-Path $Folder $name } else { Join-Path ([IO.Path]::GetTempPath()) $name }
  # The copy in the postgres container removes itself (sh has already opened it).
  if (-not $Folder) { $script = "rm -f -- `"`$0`"`n" + $script }
  [IO.File]::WriteAllText($local, ($script -replace "`r", ""), $utf8)
  $previous = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  try {
    if ($Folder) { $path = "$InContainer/$name" }
    else {
      $path = "/tmp/$name"
      & docker compose cp $local "postgres:$path" *> $null
      if ($LASTEXITCODE -ne 0) { return $null }
    }
    $out = @(& docker @DockerArgs sh $path 2>$null)
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previous; Remove-Item $local -Force -ErrorAction SilentlyContinue }
  if ($code -ne 0) { return $null }
  $lines = @($out | Where-Object { $_ -ne $null -and "$_".Trim() })
  if ($lines.Count -eq 0) { return "" }
  return "$($lines[-1])".Trim()
}
$NewFolderHint = "Vill du installera en ny, separat Workflow i stället? Välj en ny mapp, till exempel:`n  `$env:WORKFLOW_DIR = `"`$HOME\workflow-ny`"; irm https://raw.githubusercontent.com/HINTEK-Workflow/workflow-community/main/install.ps1 | iex"
# Tells the user when the folder already holds an installation that is running now, before it is restarted.
function ShowRunning {
  if (-not (Test-Path (Join-Path $Dir ".env"))) { return }
  $previous = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  try { Push-Location $Dir; $names = @(docker compose ps --status running --format "{{.Name}}" 2>$null | Where-Object { $_ }) }
  finally { Pop-Location; $ErrorActionPreference = $previous }
  if ($names.Count -eq 0) { return }
  Write-Host ""
  Write-Host "Obs: Workflow i $Dir körs redan ($($names -join ', '))." -ForegroundColor Yellow
  Write-Host "Den uppdateras och startas om. Dina inställningar (.env), dina filer och databasen behålls." -ForegroundColor Yellow
  Write-Host $NewFolderHint -ForegroundColor Yellow
  Write-Host "Fortsätter om 10 sekunder. Tryck Ctrl+C för att avbryta." -ForegroundColor Yellow
  Start-Sleep -Seconds 10
}

# The version to install: WORKFLOW_VERSION, else the newest release tag vX.Y.Z of the source, else main.
function ResolveVersion {
  if ($env:WORKFLOW_VERSION) {
    if ($env:WORKFLOW_VERSION -notmatch "^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$" -and $env:WORKFLOW_VERSION -ne "main") { Fail "WORKFLOW_VERSION ska vara en version som v1.2.3, eller main." }
    return $env:WORKFLOW_VERSION
  }
  $previous = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  try { $refs = @(& git ls-remote --tags --refs $Source "v*" 2>$null) } finally { $ErrorActionPreference = $previous }
  $versions = @($refs | ForEach-Object { if ("$_" -match "refs/tags/v(\d+\.\d+\.\d+)$") { [version]$Matches[1] } })
  if ($versions.Count -eq 0) { return "main" }
  return "v" + ($versions | Sort-Object | Select-Object -Last 1).ToString()
}
# The commits this clone already knows from the published repository (before a fetch): the remote branches, the tags and
# every earlier value of the remote branches. HEAD has no own commits if it is part of one of them.
function KnownCommits {
  $known = @(GitOut for-each-ref --format="%(objectname) %(*objectname)" refs/remotes refs/tags) -split " "
  foreach ($ref in @(GitOut for-each-ref --format="%(refname)" refs/remotes)) { if ($ref) { $known += @(GitOut reflog show --format=%H $ref) } }
  return @($known | Where-Object { $_ -match "^[0-9a-f]{40,64}$" } | Select-Object -Unique)
}
function HeadIsPublished($known) {
  foreach ($commit in $known) { if (Succeeds { git -C $Dir merge-base --is-ancestor HEAD $commit }) { return $true } }
  return $false
}
function RefuseLocalChanges {
  if (GitOut status --porcelain --untracked-files=no) {
    Fail "Du har ändrat filer i $Dir. De skrivs inte över.`nSpara dina ändringar någon annanstans, eller låt mappen vara och installera i en ny mapp.`n$NewFolderHint"
  }
}
$OwnCommits = "innehåller egna ändringar (commits) som inte finns på GitHub. De skrivs inte över.`nSpara dem, eller låt mappen vara och installera i en ny mapp."

# Updates an existing clone to a release tag. A clone on main (an older installation) moves to the tag. If the published
# history has been rewritten, a clone without own commits or changes is moved to the new history and its old state is kept
# as a backup branch. .env, storage, backups and the database volume are not tracked by Git and are never touched.
function UpdateToTag($target) {
  $current = GitOut describe --tags --exact-match HEAD
  if (-not $current) { $current = GitOut rev-parse --short HEAD }
  RefuseLocalChanges
  $known = KnownCommits
  Native { git -C $Dir fetch --force origin "refs/tags/$($target):refs/tags/$($target)" } "Kunde inte hämta version $target till $Dir. Kontrollera internetanslutningen (och versionen) och kör igen."
  $targetCommit = GitOut rev-parse "refs/tags/$target^{commit}"
  if ((GitOut rev-parse HEAD) -eq $targetCommit) { Write-Host "Workflow är redan version $target."; return }
  if (Succeeds { git -C $Dir merge-base --is-ancestor HEAD $targetCommit }) {
    Native { git -C $Dir -c advice.detachedHead=false checkout -q --detach $targetCommit } "Kunde inte uppdatera $Dir."
    Write-Host "Uppdaterar från $current till $target."
    return
  }
  if (Succeeds { git -C $Dir merge-base --is-ancestor $targetCommit HEAD }) {
    Warn "Obs: $target är äldre än versionen du har ($current). Har den nyare versionen ändrat databasen startar den äldre inte;`nåterställ då backupen från före uppdateringen (INSTALLATION.md, avsnittet Återställ)."
  } elseif (-not (HeadIsPublished $known)) {
    Fail "$Dir $OwnCommits`n$NewFolderHint"
  }
  $backup = "backup/" + (Get-Date -Format "yyyy-MM-dd-HHmmss")
  Native { git -C $Dir branch $backup HEAD } "Kunde inte spara en kopia av den gamla versionen."
  Native { git -C $Dir -c advice.detachedHead=false checkout -q --detach $targetCommit } "Kunde inte uppdatera $Dir."
  Write-Host "Byter från $current till $target. Den gamla versionen finns kvar i Git-grenen $backup."
}

# Updates an existing clone that follows main (WORKFLOW_VERSION=main, or a source without release tags).
function UpdateToMain {
  $upstream = GitOut rev-parse --abbrev-ref --symbolic-full-name "@{u}"
  if (-not $upstream) { Fail "$Dir följer ingen gren på GitHub och kan inte uppdateras automatiskt.`n$NewFolderHint" }
  $remoteRef = "refs/remotes/$upstream"
  $known = KnownCommits
  Native { git -C $Dir fetch origin } "Kunde inte hämta uppdateringar till $Dir. Kontrollera internetanslutningen och kör igen."
  if (Succeeds { git -C $Dir merge-base --is-ancestor HEAD $remoteRef }) {
    Native { git -C $Dir merge --ff-only $remoteRef } "Kunde inte uppdatera $Dir."
    return
  }
  Write-Host "Den publicerade versionen har en ny historik, så $Dir kan inte uppdateras på vanligt sätt."
  RefuseLocalChanges
  if (-not (HeadIsPublished $known)) { Fail "$Dir $OwnCommits`n$NewFolderHint" }
  $backup = "backup/" + (Get-Date -Format "yyyy-MM-dd-HHmmss")
  Native { git -C $Dir branch $backup HEAD } "Kunde inte spara en kopia av den gamla versionen."
  Native { git -C $Dir reset --hard $remoteRef } "Kunde inte uppdatera $Dir."
  Write-Host "Uppdaterat till den nya versionen. Den gamla versionen finns kvar i Git-grenen $backup."
  Write-Host "Dina inställningar (.env), dina filer (storage) och databasen är orörda."
}

# The backup before an update (in $Dir, with the app stopped): the database as pg_dump in custom format, restored into a
# temporary database in the same PostgreSQL container to prove it can be read (the number of tables must match), and the
# files as a tar archive that is listed back. Then SHA256SUMS, an optional age encryption and the retention.
# Returns $true when everything was written and checked.
function BackupBeforeUpdate {
  $InPostgres = @("compose", "exec", "-T", "postgres")
  $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
  $target = Join-Path (Join-Path $Dir "backups") "update-$stamp"
  New-Item -ItemType Directory -Force $target | Out-Null
  if (-not (Succeeds { docker compose start postgres })) { if (-not (Succeeds { docker compose up -d postgres })) { return $false } }
  for ($i = 0; $i -lt 60; $i++) {
    if ((ContainerScript "pg_isready -U `$POSTGRES_USER -d `$POSTGRES_DB >/dev/null && echo ok`nexit 0`n" $InPostgres) -eq "ok") { break }
    Start-Sleep -Seconds 2
  }
  Write-Host "Databasen ..."
  $dump = ContainerScript "pg_dump -U `$POSTGRES_USER -d `$POSTGRES_DB --format=custom --no-owner --no-privileges -f /tmp/workflow-update.dump && echo dumped`nexit `$?`n" $InPostgres
  if ($dump -ne "dumped") { return $false }
  if (-not (Succeeds { docker compose cp postgres:/tmp/workflow-update.dump (Join-Path $target "database.dump") })) { return $false }
  if (-not (Test-Path (Join-Path $target "database.dump")) -or (Get-Item (Join-Path $target "database.dump")).Length -eq 0) { return $false }
  $check = @(
    "set -e",
    "check=workflow_backup_check",
    "dropdb -U `$POSTGRES_USER --if-exists `$check >/dev/null 2>&1",
    "createdb -U `$POSTGRES_USER `$check",
    "pg_restore -U `$POSTGRES_USER -d `$check --no-owner --no-privileges --exit-on-error /tmp/workflow-update.dump",
    "count=`"select count(*) from information_schema.tables where table_schema = 'public'`"",
    "live=`$(psql -X -At -U `$POSTGRES_USER -d `$POSTGRES_DB -c `"`$count`")",
    "copy=`$(psql -X -At -U `$POSTGRES_USER -d `$check -c `"`$count`")",
    "dropdb -U `$POSTGRES_USER `$check",
    "rm -f /tmp/workflow-update.dump",
    "echo `$live `$copy",
    "exit 0",
    "") -join "`n"
  $tables = ContainerScript $check $InPostgres
  if (-not $tables -or ($tables -split " ").Count -ne 2 -or ($tables -split " ")[0] -ne ($tables -split " ")[1]) { Write-Host "Kopian av databasen stämmer inte: $tables"; return $false }
  Write-Host "  läst tillbaka i en tillfällig databas: $(($tables -split ' ')[1]) tabeller, samma som i databasen"
  Write-Host "Filerna ..."
  $tar = @(
    "set -e",
    "tar -czf /backup/storage.tar.gz -C /app/storage .",
    "live=`$(cd /app/storage && find . | wc -l)",
    "copy=`$(tar -tzf /backup/storage.tar.gz | wc -l)",
    "echo `$live `$copy",
    "exit 0",
    "") -join "`n"
  $files = ContainerScript $tar @("compose", "run", "--rm", "--no-deps", "-T", "-v", "$($target):/backup", "app") $target "/backup"
  if (-not $files -or ($files -split "\s+").Count -ne 2 -or ($files -split "\s+")[0] -ne ($files -split "\s+")[1]) { Write-Host "Arkivet med filerna stämmer inte: $files"; return $false }
  Write-Host "  arkivet listat tillbaka: $(($files -split '\s+')[1]) filer och mappar"
  $recipient = EnvValue "BACKUP_AGE_RECIPIENT"
  if ($recipient) {
    if (Get-Command age -ErrorAction SilentlyContinue) {
      foreach ($name in @("database.dump", "storage.tar.gz")) {
        $plain = Join-Path $target $name
        if (-not (Succeeds { age -r $recipient -o "$plain.age" $plain })) { return $false }
        Remove-Item $plain -Force
      }
      Write-Host "  krypterad med age till BACKUP_AGE_RECIPIENT"
    } else {
      Warn "  BACKUP_AGE_RECIPIENT är satt men age.exe finns inte: backupen är OKRYPTERAD. Installera age."
    }
  }
  $sums = Get-ChildItem $target -File | Where-Object { $_.Name -like "database.dump*" -or $_.Name -like "storage.tar.gz*" } |
    ForEach-Object { "$((Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower())  $($_.Name)" }
  $utf8 = New-Object Text.UTF8Encoding($false)
  [IO.File]::WriteAllText((Join-Path $target "SHA256SUMS"), (($sums -join "`n") + "`n"), $utf8)
  $from = if ($script:PreviousVersion) { $script:PreviousVersion } else { "okänd" }
  [IO.File]::WriteAllText((Join-Path $target "MANIFEST"), "created=$stamp`nfrom=$from`ntables=$(($tables -split ' ')[1])`nfiles=$(($files -split '\s+')[1])`n", $utf8)
  Write-Host "Backup klar: $target"
  # Retention: the newest WORKFLOW_KEEP_BACKUPS update backups stay; only folders named like a stamp are removed.
  if ($KeepBackups -ge 1) {
    Get-ChildItem (Join-Path $Dir "backups") -Directory | Where-Object { $_.Name -match "^update-\d{8}T\d{6}Z$" } |
      Sort-Object Name -Descending | Select-Object -Skip $KeepBackups | ForEach-Object { Remove-Item $_.FullName -Recurse -Force }
  }
  return $true
}

Write-Host "Workflow Community Edition - installation" -ForegroundColor Cyan

Step "Kontrollerar Git och Docker"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail "Git saknas. Installera från https://git-scm.com och kör igen." }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail "Docker saknas. Installera Docker Desktop från https://www.docker.com/products/docker-desktop och kör igen." }
if (-not (Succeeds { docker info })) { Fail "Docker Desktop är inte igång. Starta det, vänta tills det är klart och kör igen." }

$Version = ResolveVersion
if ($Version -eq "main") { Warn "Ingen släppt version hittades; följer main." }
Step "Hämtar Workflow $Version till $Dir"
$updating = $false
if (Test-Path (Join-Path $Dir ".git")) {
  ShowRunning
  # The version before the update, for the backup's MANIFEST (Återställ in INSTALLATION.md goes back to it).
  $script:PreviousVersion = GitOut describe --tags --always HEAD
  if ($Version -eq "main") { UpdateToMain } else { UpdateToTag $Version }
  $updating = Test-Path (Join-Path $Dir ".env")
}
elseif (Test-Path $Dir) { Fail "$Dir finns redan men är ingen Workflow-installation.`n$NewFolderHint" }
elseif ($Version -eq "main") { Native { git clone --depth 1 $Source $Dir } "Kunde inte hämta Workflow." }
else { Native { git -c advice.detachedHead=false clone --depth 1 --branch $Version $Source $Dir } "Kunde inte hämta Workflow $Version." }
Set-Location $Dir

$envFile = Join-Path $Dir ".env"
$utf8 = New-Object Text.UTF8Encoding($false)
if (Test-Path $envFile) {
  Step "Behåller dina befintliga inställningar (.env)"
  $appPort = ((Get-Content $envFile | Where-Object { $_ -match "^APP_PORT=" }) -replace "^APP_PORT=", "")
  $adminEmail = ((Get-Content $envFile | Where-Object { $_ -match "^INSTANCE_ADMIN_EMAIL=" }) -replace "^INSTANCE_ADMIN_EMAIL=", "")
  $newInstall = $false
} else {
  Step "Skapar inställningar"
  $adminEmail = if ($env:WORKFLOW_ADMIN_EMAIL) { $env:WORKFLOW_ADMIN_EMAIL.Trim() } else { "" }
  while ($adminEmail -notmatch "^[^@\s]+@[^@\s]+\.[^@\s]+$") { $adminEmail = (Read-Host "Din e-postadress (för inloggning)").Trim() }
  $name = if ($env:WORKFLOW_NAME) { $env:WORKFLOW_NAME } else { (Read-Host "Namn på installationen [Workflow]").Trim() }; if (-not $name) { $name = "Workflow" }
  $appPort = FreePort 3000
  $dbPort = FreePort 5432
  $secret = Secret
  $lines = Get-Content (Join-Path $Dir ".env.example")
  $lines = SetValue $lines "APP_URL" "http://localhost:$appPort"
  $lines = SetValue $lines "NEXTAUTH_URL" "http://localhost:$appPort"
  $lines = SetValue $lines "AUTH_SECRET" $secret
  $lines = SetValue $lines "INTEGRATION_KEYS_SECRET" (Secret)
  $lines = SetValue $lines "POSTGRES_PASSWORD" (Secret)
  $lines = SetValue $lines "SEED_ADMIN_PASSWORD" (Secret)
  $lines = SetValue $lines "INSTANCE_NAME" $name
  $lines = SetValue $lines "INSTANCE_OPERATOR" $name
  $lines = SetValue $lines "INSTANCE_ADMIN_EMAIL" $adminEmail
  $lines = SetValue $lines "APP_PORT" $appPort
  $lines = SetValue $lines "POSTGRES_PORT" $dbPort
  # Container and image names follow the folder, so two installations on one computer never collide or share a build.
  $prefix = (Split-Path $Dir -Leaf).ToLower() -replace "[^a-z0-9_.-]", "-"
  $lines = SetValue $lines "CONTAINER_PREFIX" $prefix
  $lines = SetValue $lines "APP_IMAGE" "workflow-community-$($prefix):local"
  [IO.File]::WriteAllText($envFile, (($lines -join "`n") + "`n"), $utf8)
  $newInstall = $true
  Write-Host "Workflow använder port $appPort (databasen $dbPort)."
}

if ($updating) {
  # The new version is built while the old one keeps running; then the old one stops, the backup is taken and read back,
  # and only then does the new version start and migrate the database.
  Step "Bygger den nya versionen (den gamla körs under tiden)"
  Native { docker compose build app } "Docker kunde inte bygga den nya versionen. Den gamla körs som förut. Se felet ovan."
  if ($env:WORKFLOW_SKIP_BACKUP -eq "1") {
    Warn "WORKFLOW_SKIP_BACKUP=1: ingen backup tas före uppdateringen."
  } else {
    Step "Tar en backup och läser tillbaka den innan databasen uppdateras"
    Succeeds { docker compose stop app } | Out-Null
    $backedUp = $false
    try { $backedUp = BackupBeforeUpdate } catch { Write-Host $_ }
    if (-not $backedUp) {
      Succeeds { docker compose start app } | Out-Null
      Fail "Backupen kunde inte tas eller läsas tillbaka, så databasen har inte ändrats och den gamla versionen startades igen.`nSe felet ovan. Uppdatera inte utan backup; `$env:WORKFLOW_SKIP_BACKUP=1 hoppar över den på egen risk."
    }
  }
  Step "Startar den nya versionen"
  Native { docker compose up -d } "Docker kunde inte starta Workflow. Se felet ovan och INSTALLATION.md, avsnittet Om uppdateringen stannar."
} else {
  Step "Bygger och startar (första gången tar det 5-10 minuter)"
  Native { docker compose up -d --build } "Docker kunde inte starta Workflow. Se felet ovan."
}

Step "Väntar tills Workflow svarar"
$url = "http://localhost:$appPort"
$ready = $false
for ($i = 0; $i -lt 120; $i++) {
  try { if ((Invoke-WebRequest "$url/api/health/ready" -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200) { $ready = $true; break } } catch { }
  Start-Sleep -Seconds 5
}
if (-not $ready) { Fail "Workflow svarade inte inom 10 minuter. Se loggen med: docker compose logs app`nStannade uppdateringen vid databasen: se INSTALLATION.md, avsnittet Om uppdateringen stannar." }

# The account is made on a new installation, and also on a later run when .env exists but an earlier run stopped before
# the account was made (admin:create with ADMIN_CREATE_CHECK=1 exits 0 only while the installation has no account).
# The admin commands run as the app's own user "node", not root.
$accountNeeded = $newInstall
if (-not $newInstall -and (Succeeds { docker compose exec -T --user node -e ADMIN_CREATE_CHECK=1 app npm run -s admin:create })) {
  Write-Host "Installationen har inget konto ännu, så det skapas nu."
  $accountNeeded = $true
}

if ($accountNeeded) {
  Step "Skapar ditt konto ($adminEmail)"
  Write-Host "Lösenordet ska ha minst 12 tecken och får inte vara ett vanligt lösenord som Password1234."
  $password = if ($env:WORKFLOW_ADMIN_PASSWORD) { $env:WORKFLOW_ADMIN_PASSWORD } else { "" }
  $created = $false
  # admin:create exits 2 when it refuses the password (too short or too common) and has then written why. The person
  # chooses a new one, at most three times, without starting the installation over. Exit 3: an account already exists.
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    while ($password.Length -lt 12) {
      $secure = Read-Host "Välj ett lösenord" -AsSecureString
      $password = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
      if ($password.Length -lt 12) { Write-Host "Lösenordet måste ha minst 12 tecken." }
    }
    $env:ADMIN_PASSWORD = $password
    try { $status = NativeCode { docker compose exec -T --user node -e ADMIN_PASSWORD app npm run -s admin:create } }
    finally { Remove-Item Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue }
    if ($status -eq 0 -or $status -eq 3) { $created = $true; break }
    if ($status -ne 2) { $password = $null; Fail "Kontot kunde inte skapas. Se felet ovan och kör installationsraden igen." }
    if ($env:WORKFLOW_ADMIN_PASSWORD) { $password = $null; Fail "Lösenordet i WORKFLOW_ADMIN_PASSWORD godtogs inte. Välj ett annat och kör installationsraden igen." }
    $password = ""
    if ($attempt -lt 3) { Write-Host "Välj ett annat lösenord." }
  }
  $password = $null
  if (-not $created) { Fail "Kontot kunde inte skapas efter tre försök. Kör installationsraden igen och välj ett annat lösenord. Dina inställningar behålls." }
}

Write-Host ""
Write-Host "Klart! Workflow $Version körs på $url" -ForegroundColor Green
Write-Host "Logga in med $adminEmail."
Write-Host ""
Write-Host "I mappen $Dir :"
Write-Host "  Stänga av:        docker compose down"
Write-Host "  Starta igen:      docker compose up -d"
Write-Host "  Uppdatera:        kör installationsraden igen (tar en backup först)"
Write-Host "  Gå tillbaka:      INSTALLATION.md, avsnittet Återställ (backuperna ligger i $Dir\backups)"
Write-Host "  Ta bort allt:     docker compose down -v   (raderar även datan)"
if (-not (EnvValue "BACKUP_AGE_RECIPIENT")) {
  Write-Host ""
  Write-Host "Tips: kryptera backuperna med age. Skapa en nyckel på en annan dator (age-keygen -o workflow-backup.key),"
  Write-Host "skriv dess publika del i .env som BACKUP_AGE_RECIPIENT=age1... och installera age här (INSTALLATION.md)."
}
if (-not $env:WORKFLOW_NO_BROWSER) { Start-Process $url }
