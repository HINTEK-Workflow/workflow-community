# Workflow Community Edition - installer for Windows (PowerShell 5.1 or later).
#
#   irm https://raw.githubusercontent.com/HINTEK-Workflow/workflow-community/main/install.ps1 | iex
#
# Downloads Workflow, writes .env with new random secrets and free ports, starts it with Docker, creates your owner
# account and opens the browser. Run it again to update: your .env and your data are kept. If an earlier run stopped
# before the account was made, the next run creates it.
# Optional: $env:WORKFLOW_DIR (install folder), $env:WORKFLOW_SOURCE (git repository to install from). Without questions:
# $env:WORKFLOW_ADMIN_EMAIL, $env:WORKFLOW_ADMIN_PASSWORD, $env:WORKFLOW_NAME; $env:WORKFLOW_NO_BROWSER=1 opens no browser.

$ErrorActionPreference = "Stop"
$Source = if ($env:WORKFLOW_SOURCE) { $env:WORKFLOW_SOURCE } else { "https://github.com/HINTEK-Workflow/workflow-community.git" }
$Dir = if ($env:WORKFLOW_DIR) { $env:WORKFLOW_DIR } else { Join-Path $HOME "workflow-community" }

function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host ""; Write-Host "Stopp: $text" -ForegroundColor Red; throw $text }
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
# Updates an existing clone. If the published history has been rewritten, a clone without own commits or changes is
# moved to the new history and its old state is kept as a backup branch. .env, storage and the database volume are not
# tracked by Git and are never touched.
function UpdateClone {
  $upstream = GitOut rev-parse --abbrev-ref --symbolic-full-name "@{u}"
  if (-not $upstream) { Fail "$Dir följer ingen gren på GitHub och kan inte uppdateras automatiskt.`n$NewFolderHint" }
  $remoteRef = "refs/remotes/$upstream"
  $before = GitOut rev-parse -q --verify $remoteRef
  Native { git -C $Dir fetch origin } "Kunde inte hämta uppdateringar till $Dir. Kontrollera internetanslutningen och kör igen."
  if (Succeeds { git -C $Dir merge-base --is-ancestor HEAD $remoteRef }) {
    Native { git -C $Dir merge --ff-only $remoteRef } "Kunde inte uppdatera $Dir."
    return
  }
  Write-Host "Den publicerade versionen har en ny historik, så $Dir kan inte uppdateras på vanligt sätt."
  if (GitOut status --porcelain --untracked-files=no) {
    Fail "Du har ändrat filer i $Dir. De skrivs inte över.`nSpara dina ändringar någon annanstans, eller låt mappen vara och installera i en ny mapp.`n$NewFolderHint"
  }
  # HEAD has no own commits if it is part of what the remote branch pointed to before this run or earlier. The ref's
  # log holds every old and new value, also the one a forced update replaced in an earlier, failed run.
  $log = Join-Path (GitOut rev-parse --absolute-git-dir) "logs/$remoteRef"
  $logged = if (Test-Path $log) { Get-Content $log | ForEach-Object { ($_ -split " ")[0..1] } } else { @() }
  $known = @($before) + @($logged) | Where-Object { $_ -match "^[0-9a-f]{40,64}$" -and $_ -notmatch "^0+$" } | Select-Object -Unique
  $own = $true
  foreach ($commit in $known) { if (Succeeds { git -C $Dir merge-base --is-ancestor HEAD $commit }) { $own = $false; break } }
  if ($own) {
    Fail "$Dir innehåller egna ändringar (commits) som inte finns på GitHub. De skrivs inte över.`nSpara dem, eller låt mappen vara och installera i en ny mapp.`n$NewFolderHint"
  }
  $backup = "backup/" + (Get-Date -Format "yyyy-MM-dd-HHmmss")
  Native { git -C $Dir branch $backup HEAD } "Kunde inte spara en kopia av den gamla versionen."
  Native { git -C $Dir reset --hard $remoteRef } "Kunde inte uppdatera $Dir."
  Write-Host "Uppdaterat till den nya versionen. Den gamla versionen finns kvar i Git-grenen $backup."
  Write-Host "Dina inställningar (.env), dina filer (storage) och databasen är orörda."
}

Write-Host "Workflow Community Edition - installation" -ForegroundColor Cyan

Step "Kontrollerar Git och Docker"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail "Git saknas. Installera från https://git-scm.com och kör igen." }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail "Docker saknas. Installera Docker Desktop från https://www.docker.com/products/docker-desktop och kör igen." }
if (-not (Succeeds { docker info })) { Fail "Docker Desktop är inte igång. Starta det, vänta tills det är klart och kör igen." }

Step "Hämtar Workflow till $Dir"
if (Test-Path (Join-Path $Dir ".git")) { ShowRunning; UpdateClone }
elseif (Test-Path $Dir) { Fail "$Dir finns redan men är ingen Workflow-installation.`n$NewFolderHint" }
else { Native { git clone --depth 1 $Source $Dir } "Kunde inte hämta Workflow." }
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

Step "Bygger och startar (första gången tar det 5-10 minuter)"
Native { docker compose up -d --build } "Docker kunde inte starta Workflow. Se felet ovan."

Step "Väntar tills Workflow svarar"
$url = "http://localhost:$appPort"
$ready = $false
for ($i = 0; $i -lt 120; $i++) {
  try { if ((Invoke-WebRequest "$url/api/health/ready" -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200) { $ready = $true; break } } catch { }
  Start-Sleep -Seconds 5
}
if (-not $ready) { Fail "Workflow svarade inte inom 10 minuter. Se loggen med: docker compose logs app" }

# The account is made on a new installation, and also on a later run when .env exists but an earlier run stopped before
# the account was made (admin:create with ADMIN_CREATE_CHECK=1 exits 0 only while the installation has no account).
$accountNeeded = $newInstall
if (-not $newInstall -and (Succeeds { docker compose exec -T -e ADMIN_CREATE_CHECK=1 app npm run -s admin:create })) {
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
    try { $status = NativeCode { docker compose exec -T -e ADMIN_PASSWORD app npm run -s admin:create } }
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
Write-Host "Klart! Workflow körs på $url" -ForegroundColor Green
Write-Host "Logga in med $adminEmail."
Write-Host ""
Write-Host "I mappen $Dir :"
Write-Host "  Stänga av:        docker compose down"
Write-Host "  Starta igen:      docker compose up -d"
Write-Host "  Uppdatera:        kör installationsraden igen"
Write-Host "  Ta bort allt:     docker compose down -v   (raderar även datan)"
if (-not $env:WORKFLOW_NO_BROWSER) { Start-Process $url }
