# Workflow Community Edition - installer for Windows (PowerShell 5.1 or later).
#
#   irm https://raw.githubusercontent.com/HINTEK-Workflow/workflow-community/main/install.ps1 | iex
#
# Downloads Workflow, writes .env with new random secrets and free ports, starts it with Docker, creates your owner
# account and opens the browser. Run it again to update: your .env and your data are kept.
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
function Succeeds([scriptblock]$Command) {
  $previous = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  try { & $Command *> $null } finally { $ErrorActionPreference = $previous }
  return $LASTEXITCODE -eq 0
}

Write-Host "Workflow Community Edition - installation" -ForegroundColor Cyan

Step "Kontrollerar Git och Docker"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail "Git saknas. Installera från https://git-scm.com och kör igen." }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail "Docker saknas. Installera Docker Desktop från https://www.docker.com/products/docker-desktop och kör igen." }
if (-not (Succeeds { docker info })) { Fail "Docker Desktop är inte igång. Starta det, vänta tills det är klart och kör igen." }

Step "Hämtar Workflow till $Dir"
if (Test-Path (Join-Path $Dir ".git")) { Native { git -C $Dir pull --ff-only } "Kunde inte uppdatera $Dir." }
elseif (Test-Path $Dir) { Fail "$Dir finns redan men är ingen Workflow-installation. Välj en annan mapp med `$env:WORKFLOW_DIR." }
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
  # Container names follow the folder, so two installations on one computer never collide.
  $lines = SetValue $lines "CONTAINER_PREFIX" ((Split-Path $Dir -Leaf).ToLower() -replace "[^a-z0-9_.-]", "-")
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

if ($newInstall) {
  Step "Skapar ditt konto ($adminEmail)"
  $password = if ($env:WORKFLOW_ADMIN_PASSWORD) { $env:WORKFLOW_ADMIN_PASSWORD } else { "" }
  while ($password.Length -lt 12) {
    $secure = Read-Host "Välj ett lösenord (minst 12 tecken)" -AsSecureString
    $password = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  }
  $env:ADMIN_PASSWORD = $password
  try { Native { docker compose exec -T -e ADMIN_PASSWORD app npm run -s admin:create } "Kontot kunde inte skapas." }
  finally { Remove-Item Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue; $password = $null }
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
