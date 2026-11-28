# Installing Workflow for internal use

[Svenska](INSTALLATION.md) | English

This guide describes what it takes to run Workflow in your own company, on a **local server** in the company network or
on **your own server on the internet**.

- The installation is self-contained and has no ties to HINTEK.
- You run it yourselves and are responsible for e-mail, backup, security and the keys you add.
- The Swedish guide ([INSTALLATION.md](INSTALLATION.md)) is the original; this one is a translation of it.
- The app's user interface is in Swedish. Each name in the app is given in English with the exact Swedish label in
  parentheses the first time; the [glossary](GLOSSARY.md) lists them all.

**What loads from elsewhere**

- Everything Workflow needs is served from your own server. The app loads no fonts or scripts from other sites and sends
  no statistics.
- The server contacts an outside service only when you have switched it on: your mail server, OpenAI or Azure OpenAI,
  Google or Microsoft sign-in, the company register of **SCB** (*Statistics Sweden*), **Lantmäteriet** (*the Swedish
  mapping, cadastral and land registration authority*) or **Solar** (an electrical wholesaler).
- Nothing goes directly from the browser. With Solar on, the installation's server fetches the product images, so the
  server must reach the supplier's image addresses over https.

## 1. Requirements

| What | Requirement | Why |
| --- | --- | --- |
| Computer or server | Linux recommended (Ubuntu 22.04/24.04). Windows and macOS work with Docker Desktop. At least 2 CPU cores, 4 GB memory (8 GB while building) and 20 GB disk. | Workflow and the database run in two containers. |
| Docker | Docker Engine with Docker Compose, or Docker Desktop. Docker Engine on Linux is open source and free for everyone. Docker Desktop (Windows and macOS) is free for individuals, education and smaller businesses; larger organisations need a paid licence from Docker (read Docker's own terms). | The installation builds and starts everything with Docker. |
| Git | Any current version. Open source. | The install script fetches the code. |
| age or GnuPG | age is the default: any current version (for example `apt install age` or `winget install FiloSottile.age`). If you choose GnuPG instead: `apt install gnupg`, `brew install gnupg` or `winget install GnuPG.Gpg4win` (section 6, *Encryption of the backups*). Both are open source. | The backups are always encrypted, and the installation stops if the program is missing. |
| Mail server (SMTP) | An address allowed to send mail, for example `noreply@example.com`, with server, port, user name and password from your e-mail provider. | Without e-mail, **Forgot password** (*Glömt lösenord*), e-mail verification, invitations, reminders, operations alerts and mailings do not work. |
| Backup | A place outside the server for copies of the database and the files. | You are responsible for being able to restore your data. |

**Also for your own server on the internet:**

| What | Requirement |
| --- | --- |
| Domain name | For example `workflow.example.com`, pointing at the server's address. |
| HTTPS | A reverse proxy with a certificate in front of Workflow, for example Caddy (see section 4). Open only ports 80 and 443. |

**Optional:**

| Function | What it needs | Where it is set |
| --- | --- | --- |
| Workflow AI (chat, suggestions, review, import with AI) | Your own OpenAI API key, or your own Azure OpenAI resource. The provider bills your account, so set a spending cap there. Read the provider's data processing agreement (DPA) before sharing data. Each company in the installation also has a limit per hour (see section 8). | **Installation → Services and keys** (*Installation → Tjänster och nycklar*) |
| Google sign-in | Your own OAuth keys from Google Cloud Console. Allowed redirect address: `https://<your address>/api/auth/callback/google`. | Installation → Services and keys (or `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`) |
| Solar (shared article register, stock levels, product images) | Your own API account with Solar: client id, secret and catalogue number. Without it, materials, quotes and purchasing work with your own articles and price files. | Installation → Services and keys → Solar. Needs the job `register:sync` (section 5). |
| Company lookup by organisation number | A free API key from SCB's company register (apiafr.scb.se). | Installation → Services and keys |
| API and MCP (ChatGPT, Claude, your own systems) | Nothing extra for API keys. To connect ChatGPT with sign-in, the server must be reachable from the internet over HTTPS. Claude Desktop and local tools can use an MCP key on a local server too. | **Settings → Connections** (*Inställningar → Kopplingar*) |
| Microsoft sign-in (Entra ID) | An app registration in your company's Microsoft Entra ID: client id, client secret and directory (tenant). The server must reach `login.microsoftonline.com` and `graph.microsoft.com`. | Installation → Services and keys → **Microsoft sign-in** (*Inloggning med Microsoft*). Press **Check** (*Kontrollera*) once the keys are saved. |
| Web push (notifications on phones and computers) | No outside keys: Workflow makes its own key pair (VAPID). Needs https. | **Installation → Operations and security → Web push** (*Installation → Drift och säkerhet → Webbpush*): press **Create keys** (*Skapa nycklar*), enter a contact address (empty = the e-mail sender) and switch it on. Each person then chooses notifications under **My settings → Notifications** (*Mina inställningar → Notiser*). |
| My website (the company's WordPress) | A WordPress site with an *application password* (WordPress → Users → Profile). Public https addresses only by default. A WordPress on your own network needs `WEBSITE_ALLOW_LOCAL_ADDRESSES=true` in `.env` and a restart. | **More → Web and posts → My website** (*Mer → Webb och inlägg → Min webbsida*; first turn on the module *Webb och inlägg* under *Inställningar → Arbetssätt*) |
| Machines and control systems (Node-RED, PLC) | One key per source, made in Workflow. The source sends to `https://<your address>/api/ingest/v1/events` (or `/raw`), so it must reach Workflow's address. On a local server the internal network is enough. | Settings → Connections → **Machines** (*Maskiner*) |
| Invoices | Nothing extra. An invoice is made from an **invoice basis** (*fakturaunderlag*) or from scratch under **Invoices** (*Fakturor*). Fill in the company's details (organisation number, VAT number, **Bankgiro** (*Swedish giro payment number*)) and the invoice settings before the first invoice. **ROT** (*Swedish tax deduction for repair and renovation work*) invoices are sent as a link, so the customer must reach the address (a server on the internet). | **Settings → Ways of working → Invoicing** (*Inställningar → Arbetssätt → Fakturering*) |
| Accounting | Nothing extra. Invoiced invoice bases are exported as a SIE file to your accounting program. | Settings → Connections → **Accounting** (*Bokföring*) |
| Payroll and absence | Nothing extra. Absence files are read in on Import, and the payroll file is downloaded by hand. | Settings → Connections → **Payroll and export** (*Lön och export*), and **Time → Payroll and export** (*Tid → Lön och export*) |

## 2. Install

The lines below fetch the installer from the repository on GitHub.

**Linux and macOS:**

```bash
curl -fsSL https://raw.githubusercontent.com/HINTEK-Workflow/workflow-community/main/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/HINTEK-Workflow/workflow-community/main/install.ps1 | iex
```

What the script does:

- fetches the newest released version (a tag such as `v1.2.3`), not whatever is on `main` right now
- asks for your e-mail address, a name for the installation and a password
- creates `.env` with new random secrets and free ports (from 3000 for the app and 5432 for the database)
- starts Workflow and creates your account as superadmin.

The password needs at least 12 characters and must not be a common password such as `Password1234`. If it is not
accepted, the script says why and you choose a new password, up to three times, without starting the installation over.
If the script stops before the account is created, run the same install command again. The settings in `.env` are kept,
and the script goes on to create the account.

The first start takes 5-10 minutes. To install by hand, see *Manual installation (for developers)* in
[README.md](README.md).

**A specific version.** Set `WORKFLOW_VERSION` before running the install line, for example `WORKFLOW_VERSION=v1.2.3`
(Linux and macOS, before `bash` in the line) or `$env:WORKFLOW_VERSION = "v1.2.3"` (PowerShell). The versions are listed
under *Releases* on GitHub.

**Check the script first (recommended).** From 0.90.0 on every version has a release on GitHub under *Releases*, and
older releases and tags are never removed. The release has these files:

| File | What it is |
| --- | --- |
| `workflow-community-v1.2.3.tar.gz` | All the code of the version (the same files as a clone of the tag) |
| `install.sh`, `install.ps1` | The install scripts of the version |
| `sbom-community-v1.2.3.cdx.json` | The list of the packages in the version (CycloneDX) |
| `allowed_signers` | The public key the tag is signed with |
| `SHA256SUMS` | The checksums of the files above |

Download the script for the version, check its checksum, then run it:

```bash
curl -fsSLO https://github.com/HINTEK-Workflow/workflow-community/releases/download/v1.2.3/install.sh
curl -fsSLO https://github.com/HINTEK-Workflow/workflow-community/releases/download/v1.2.3/SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS && WORKFLOW_VERSION=v1.2.3 bash install.sh
```

In PowerShell: `Get-FileHash install.ps1 -Algorithm SHA256` and compare with the line for `install.ps1` in `SHA256SUMS`.

**The tag is signed.** The tag `v1.2.3` is signed with an SSH key, and GitHub shows it as *Verified*. To check it
yourself, in the install folder (or a clone) with `allowed_signers` from the release:

```bash
git fetch origin tag v1.2.3 && git -c gpg.ssh.allowedSignersFile=allowed_signers verify-tag v1.2.3
```

The line should end with `Good "git" signature`. Versions up to and including 0.90.0 have no signed tag.

### Where Workflow is placed

- Workflow is placed in the folder `workflow-community` in your home folder, for example
  `/home/anna/workflow-community` or `C:\Users\anna\workflow-community`.
- For another folder, set `WORKFLOW_DIR` when you run the install line. On Linux and macOS:

  ```bash
  curl -fsSL https://raw.githubusercontent.com/HINTEK-Workflow/workflow-community/main/install.sh | WORKFLOW_DIR="$HOME/workflow-new" bash
  ```

  In PowerShell on Windows:

  ```powershell
  $env:WORKFLOW_DIR = "$HOME\workflow-new"; irm https://raw.githubusercontent.com/HINTEK-Workflow/workflow-community/main/install.ps1 | iex
  ```

- If the folder already holds Workflow, that installation is updated. A new folder gives a new, separate installation
  with its own settings and its own database.
- Use the same `WORKFLOW_DIR` every time you update an installation that is not in the default folder.
- If Workflow is already running in the folder, the script says so and waits 10 seconds before it goes on. Press
  Ctrl+C to stop.

## 3. Set up after the first sign-in

1. **Installation → Services and keys → E-mail** (*E-post*): enter the SMTP server and the sender, and check that a
   test mail arrives. Which mails are sent and the address for operations alerts are chosen under **Installation →
   Operations and security**.
2. **Settings → Users** (*Inställningar → Användare*): invite your staff. Whoever accepts an invitation can sign in
   at once.
   - Invitations are off from the start: first tick *Invitations* (*Inbjudningar*) under **Installation → Operations
     and security** (*Drift och säkerhet*).
3. **More companies in one installation** (optional): choose **Installation → Overview → Customer companies → All
   companies → Prepare company** (*Installation → Översikt → Kundföretag → Alla företag → Förbered
   företag*), then send the admin invitation from there.
   - Each company is kept apart from the others.
   - The Customer companies tab is shown once the installation has more companies than its own.
4. **Installation → Operations and security:** decide whether visitors may create accounts themselves (**Allow new
   accounts**, *Tillåt nya konton*, off at first). **Who may sign in** (*Vem får logga in*) is set to **Everyone**
   (*Alla*), that is everyone with an account.
5. **Installation → Services and keys** (optional): paste the OpenAI key, press Check and switch AI on. Under *Provider for Standard* (*Leverantör för Standard*) you choose OpenAI (the default) or Azure; companies that require processing in the EU always run on Azure models marked EU verified.
   - Add keys for Google and SCB if you want.
   - Then choose under **Settings → Ways of working → Workflow AI** (*Inställningar → Arbetssätt → Workflow AI*) what
     the company shares with AI.
   - Check that everything you have added shows **Ready** (*Klar*).
6. **Map** (optional):
   - Order access to *Topografisk webbkarta Nedladdning, raster* (Lantmäteriet's topographic web map) in Lantmäteriet's
     Geotorget (its e-service portal; free of charge).
   - Enter the user name and password under **Installation → Services and keys → Map from Lantmäteriet** (*Karta från
     Lantmäteriet*).
   - The server fetches only the map tiles someone looks at. It stores them in `storage/map-tiles` up to the limit you
     set (default 1,024 MB; one place with its surroundings takes about 5 MB) and serves them from there.
   - The browser never contacts Lantmäteriet. The server must reach `api.lantmateriet.se` and `dl1.lantmateriet.se`.
   - Attribution required by the terms: *Topografisk webbkarta Nedladdning, raster ©Lantmäteriet*, licence CC BY 4.0
     (creativecommons.org/licenses/by/4.0/). The map images are shown unchanged, and the pins are added by Workflow.
     Workflow shows this at every map and under **Help → About Workflow** (*Hjälp → Om Workflow*).

### Name and icon

- The installation's name and who runs it are in `.env`:
  - `INSTANCE_NAME` is shown in the menu, the browser tab and the e-mails.
  - `INSTANCE_OPERATOR` is your short name, for example on your own global forms.
- The install script sets both to the name you gave.
- To rename later, change them in `.env` and restart with `docker compose up -d`. Nothing stored changes: new e-mails,
  reports and pages carry the new name. Forms already published keep the name they were published with.
- The icon in the browser tab and on the home screen is a neutral Workflow icon. Upload your own under **Installation →
  Operations and security → App icon** (*Appikon*) (a square PNG, JPEG or WebP of at most 2 MB). It is kept in the file
  storage and is part of the backup.

## 4. Address and HTTPS

- After installation Workflow is at `http://localhost:<port>`, reachable only from the computer itself.
- For others to reach it, it needs a real address: `APP_URL` and `NEXTAUTH_URL` in `.env`.
- **An address that is not localhost must be https**, or the app does not start.
- Links in invitations and mails are built from `APP_URL`, so it must be the address your staff actually use.
- With a reverse proxy in front, also set `TRUSTED_PROXY_HOPS=1` in `.env`. Then the per-IP limits see the visitor's
  address and not the proxy's.
- The examples below use port 3000. If the installer chose another port, it is `APP_PORT` in `.env`.

### Local server in the company network

Give the server a name in your network, for example `workflow.company.local` or a name in your own domain, pointing at
the server's internal address. Set `APP_URL` and `NEXTAUTH_URL` to `https://workflow.company.local` and restart with
`docker compose up -d`. Put a reverse proxy with a certificate in front. With Caddy's internal certificate authority:

```
workflow.company.local {
    tls internal
    reverse_proxy 127.0.0.1:3000
}
```

- Clients must trust Caddy's root certificate (`caddy trust` on the server, and the root certificate installed on each
  computer and phone). You can also use the company's own certificate.
- Open only port 443 in the server's firewall towards the internal network.
- Google sign-in and connecting ChatGPT need an address reachable from the internet. Nothing else does.

### Your own server on the internet

Set `APP_URL` and `NEXTAUTH_URL` in `.env` to the public address, for example `https://workflow.example.com`, and
restart with `docker compose up -d`. Put a reverse proxy in front. With Caddy one file `/etc/caddy/Caddyfile` is enough:

```
workflow.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy fetches and renews the certificate itself. Workflow listens only on `127.0.0.1`, so it cannot be reached without
the proxy.

## 5. Scheduled jobs

Workflow has jobs that must run regularly: maintenance plans, machine rules and alarms, reminders, history retention,
monitoring, backup, key alerts, the daily digest, mailings and the integrity check.

- **Without the jobs nothing happens when a day comes.** Work orders from maintenance plans are not created, alarms are
  not escalated, and the monitoring does not notice a job that never runs.
- Run them with cron on the server as root.
- Replace `/opt/workflow` with the folder where Workflow is, and set `COMPOSE_PROJECT` to the Docker Compose project's
  name. It is the folder name in lower case (`docker compose ls` shows it).
- No job needs a key: a service that is not switched on is skipped.

```
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
COMPOSE_PROJECT=workflow-community
APP_URL=https://workflow.example.com
STORAGE_PATH=/opt/workflow/storage
*/5 * * * *  root  cd /opt/workflow && scripts/ops/monitor.sh >> /var/log/workflow/monitor.log 2>&1
15 1 * * *   root  cd /opt/workflow && SOURCE_STORAGE=/opt/workflow/storage scripts/ops/nightly-backup.sh >> /var/log/workflow/backup.log 2>&1
# Maintenance and machines
40 5 * * *   root  cd /opt/workflow && scripts/ops/run-job.sh maintenance:plans
*/5 * * * *  root  cd /opt/workflow && scripts/ops/run-job.sh machine:rules
*/5 * * * *  root  cd /opt/workflow && scripts/ops/run-job.sh machine:alarms
# Reminders, retention and mailings
0 6 * * *    root  cd /opt/workflow && scripts/ops/run-job.sh rounds:reminders
30 3 * * *   root  cd /opt/workflow && scripts/ops/run-job.sh history:retention
45 6 * * *   root  cd /opt/workflow && scripts/ops/run-job.sh keys:alerts
30 1 * * *   root  cd /opt/workflow && scripts/ops/run-job.sh ai:digest
*/5 * * * *  root  cd /opt/workflow && scripts/ops/run-job.sh mailings:send
*/15 6-19 * * * root  cd /opt/workflow && scripts/ops/run-job.sh notices:send
*/5 * * * *  root  cd /opt/workflow && scripts/ops/run-job.sh schedule:publish
*/5 * * * *  root  cd /opt/workflow && scripts/ops/run-job.sh agents:run
0 5 * * 1    root  cd /opt/workflow && scripts/ops/run-job.sh integrity:check
# Only with Solar on: fetches the article register after you request it under Services and keys → Solar
*/10 * * * * root  cd /opt/workflow && scripts/ops/run-job.sh register:sync
# Optional: once a day, checks that sealed keys can be opened (no key vault needed)
10 4 * * *   root  cd /opt/workflow && scripts/ops/run-job.sh secrets:sync
```

What the jobs do:

- `maintenance:plans` creates and moves work orders from the maintenance plans.
- `machine:rules` raises an alarm when a signal has gone quiet or a state has lasted too long.
- `machine:alarms` escalates alarms and fault reports to the person on call. Without e-mail and push they are still
  escalated in the app.
- `secrets:sync` raises at most one alarm a day if a sealed value cannot be opened, for example after `AUTH_SECRET` was
  changed. The same check is available by hand under Services and keys. If alert e-mail is off, the alarm is written to
  the log and the job counts as failed.
- `notices:send` sends the reminders people have chosen to get as e-mail or web push (My settings → Notifications). It
  does nothing until e-mail notifications are switched on under Installation → Operations and security, or web push has
  keys and is switched on.
- `mailings:send` sends the mailings the system administrator has sent or scheduled under **Installation → Website and
  mailings** (*Installation → Webbplats och utskick*). This edition makes no weekly letter of release notes.
- `schedule:publish` publishes the posts and web pages an administrator has scheduled, when their time comes. It does
  nothing without scheduled items. It also uploads films to YouTube (Filmer) when they are scheduled, and goes on with an
  upload that has stopped.
- `agents:run` runs the missions under **Agents** (*Agenter*) when their time comes, with the owner's own permissions.
  Missions that only count and list work without an AI key; missions where HINTEK AI writes a text use your own AI key. It
  does nothing without missions.
- There are no jobs for payment and credits in this edition.

Save as `/etc/cron.d/workflow` and run `mkdir -p /var/log/workflow` and `chmod 644 /etc/cron.d/workflow`.
The monitoring alerts until there is a successful backup, so run the backup once by hand as root:

```bash
cd /opt/workflow && COMPOSE_PROJECT=workflow-community SOURCE_STORAGE=/opt/workflow/storage scripts/ops/nightly-backup.sh
```

Within five minutes after that, `tail /var/log/workflow/monitor.log` should show `OK`.

## 6. Backup and restore

- `scripts/ops/nightly-backup.sh` copies the database and the files and checks that the copy can be read.
- Set `OFFSITE_TARGET` to also send the copy to another server.
- Practise a restore with `scripts/ops/backup-restore-drill.sh` before you depend on it. It never writes to the real
  database. Run it as root with the same project name and storage folder as the backup:

  ```bash
  cd /opt/workflow && COMPOSE_PROJECT=workflow-community SOURCE_STORAGE=/opt/workflow/storage \
    BACKUP_ROOT=/opt/backups/workflow-restore-drills scripts/ops/backup-restore-drill.sh
  ```

  The drill restores into a temporary database and folder under `BACKUP_ROOT/work` (another folder: `DRILL_WORK_ROOT`)
  and removes them when it is done. The report is in the drill's folder under `BACKUP_ROOT`.
- **The backups are always encrypted** with `age` (or with GnuPG, see *Encryption of the backups* below). The program is needed on the server (for example `apt install age`,
  `brew install age` or `winget install FiloSottile.age`), and the installer stops with a message when it is missing.
  - Best is to make the key on another computer, not on the server: `age-keygen -o workflow-backup.key`. The line
    `Public key: age1…` is the public part. Put it in `.env` as `BACKUP_AGE_RECIPIENT=age1…` (or give it the first time
    with `WORKFLOW_BACKUP_AGE_RECIPIENT=age1…` before the install line).
  - Without a `BACKUP_AGE_RECIPIENT` the installer makes a key pair in `backup-key/workflow-backup.agekey` in the install
    folder (only your user can read it), writes the public part to `.env` and tells you where the private key is. **Copy
    the private key to a safe place off the server**, preferably two (a password manager and a USB stick in a safe), then
    remove it from the server. Without it no backup can be opened.
  - `nightly-backup.sh` reads `BACKUP_AGE_RECIPIENT` from `.env` in the folder the cron line runs in (or from the cron
    file) and refuses to take an unencrypted backup. Only the `.age` files are kept and sent to `OFFSITE_TARGET`.
    `SHA256SUMS.plain` holds the checksums of the plain files, and the backup before an update also has `ROWS` (the number
    of rows per table) and `MANIFEST`.
- **Practise restoring a real backup once a month** with `scripts/ops/aterstallningsovning.sh`, on a computer that has
  Docker and the private key (preferably not the server). It restores the newest backup into a temporary database without
  a network, compares the checksums and the number of rows per table with the backup's own list, starts the app against
  the copy and checks that it answers, and writes a report to `aterstallning/aterstallning-YYYY-MM-DD.md`. Without
  `--apply` it only shows what it would do:

  ```bash
  bash scripts/ops/aterstallningsovning.sh --backup-dir backups --key ~/workflow-backup.key \
    --app-image "$(sed -n 's/^APP_IMAGE=//p' .env)" --apply
  ```

  The decrypted copy is overwritten and removed afterwards; the encrypted one stays.
- The secrets in `.env` are not in the copy. Keep `.env` separately and safely, or the sealed keys cannot be opened
  after a restore.

### Encryption of the backups

You can choose between two programs. Both encrypt to a public key, so the server never needs the private key.

| | age (default) | GnuPG (choice) |
| --- | --- | --- |
| Method | age, with X25519 for the key and ChaCha20-Poly1305 for the data | OpenPGP (RFC 9580), with AES-256 for the data and an RSA key of 4096 bits for the recipient |
| Licence | Open source (BSD) | Open source (GPLv3) |
| Suits | Most installations | Organisations whose rules require algorithms from the BSI or NIST lists (for example BSI TR-02102) |
| The files | `database.dump.age`, `storage.tar.gz.age` | `database.dump.gpg`, `storage.tar.gz.gpg` |
| Private key that is made | `backup-key/workflow-backup.agekey` | `backup-key/workflow-backup.gpgkey` |

**Choose GnuPG when you install.** Install GnuPG first (Debian and Ubuntu: `sudo apt install gnupg`, macOS:
`brew install gnupg`, Windows: `winget install GnuPG.Gpg4win`). Then run the install line with the choice:

```bash
curl -fsSL https://raw.githubusercontent.com/HINTEK-Workflow/workflow-community/main/install.sh | bash -s -- --encryption gpg
```

```powershell
$env:WORKFLOW_BACKUP_ENCRYPTION = "gpg"; irm https://raw.githubusercontent.com/HINTEK-Workflow/workflow-community/main/install.ps1 | iex
```

On Linux and macOS you can also set `WORKFLOW_BACKUP_ENCRYPTION=gpg` before `bash`. Without the choice the installer asks
nothing more than usual, and age is used.

- The choice is kept in `.env` as `BACKUP_ENCRYPTION=gpg`. The installer then makes a key pair (RSA 4096 bits, without a
  passphrase) in a temporary GnuPG folder of its own, saves the public key in `backup-key/workflow-backup.pub.asc` and the
  private one in `backup-key/workflow-backup.gpgkey`, and then removes the temporary folder. `.env` gets
  `BACKUP_GPG_RECIPIENT_FILE=backup-key/workflow-backup.pub.asc`. Your own GnuPG keyring is not used.
- The key has **no expiry date**, so the backups never stop working on their own when a date passes. Change the key when
  your own routine says so (see below).
- If you would rather make the key on another computer, export the public part (`gpg --armor --export <fingerprint> >
  workflow-backup.pub.asc`) and give the file the first time with `WORKFLOW_BACKUP_GPG_RECIPIENT_FILE=<file>` (PowerShell:
  `$env:WORKFLOW_BACKUP_GPG_RECIPIENT_FILE`). The key must be RSA with at least 3072 bits and able to encrypt, and the file
  must not contain a private key.
- `nightly-backup.sh` reads `BACKUP_ENCRYPTION` and `BACKUP_GPG_RECIPIENT_FILE` from `.env` in the folder the cron line
  runs in. It encrypts with `gpg --cipher-algo AES256 --compress-algo none --recipient-file <public key>`, in a temporary
  GnuPG folder of its own, and keeps only the `.gpg` files.

**Keep the private key off the server**, whichever program you use, preferably in two places (a password manager and a
USB stick in a safe), then remove it from the server. Without it no backup can be opened.

**Changing the program or the key.** Run the install line again with `--encryption gpg` or `--encryption age`
(PowerShell: `$env:WORKFLOW_BACKUP_ENCRYPTION`), or change `BACKUP_ENCRYPTION` in `.env`. New backups are then encrypted
with the new choice. Older backups do not change: keep the old private key for as long as those backups are kept. For a
new GnuPG key, remove the line `BACKUP_GPG_RECIPIENT_FILE` from `.env` and move the old `workflow-backup.pub.asc` (and the
private key, if it is still there) out of `backup-key/` before you run the install line again.

**Practise the restore with GnuPG.** `scripts/ops/aterstallningsovning.sh` recognises the `.gpg` files. Give the private
key with `--key ~/workflow-backup.gpgkey`; it is read into a temporary GnuPG folder that is removed afterwards.

## 7. Update

Run the install line again. The script does this:

1. Fetches the newest released version (or the one you set with `WORKFLOW_VERSION`).
2. Builds the new version while the old one keeps running.
3. Stops the app and takes a backup of the database and the files in `backups/update-<time>/` in the install folder.
   The database is read back into a temporary database, and the archive of the files is listed back. If anything fails,
   the old version is started again and the database is not changed.
4. Starts the new version, which updates the database.

- Settings and data are kept. The five newest backups from updates are kept (`WORKFLOW_KEEP_BACKUPS` changes the
  number). They are always encrypted to `BACKUP_AGE_RECIPIENT` in `.env`, or with GnuPG to `BACKUP_GPG_RECIPIENT_FILE`
  when `BACKUP_ENCRYPTION=gpg` (section 6).
- If you update by hand (`git fetch --tags` and `git checkout v1.2.3` followed by `docker compose up -d --build`), take
  a backup with `scripts/ops/nightly-backup.sh` first.
- Under **Hjälp → Om Workflow** (Help → About Workflow) you see which version you have and how old it is. There the
  administrator can turn on **Kontrollera nya versioner** (check for new versions). The server then reads the public list
  of releases on GitHub once a day and shows when a new version is out. It is off by default, and nothing about the
  installation is sent.
- Every version can be upgraded straight to the latest, also one that is several years old (see SECURITY.md).

**If the update stops**

If Workflow does not answer after an update, first look at the log with `docker compose logs app`.

- If it says that a migration failed or that the database does not match the version, the app does not start. That is
  on purpose: nothing half done is used. Each migration runs in one transaction, so a migration that stopped has not
  changed anything.
- Then go back to the version you had and restore the backup from before the update, as in *Restore* below. Do not run
  the update again until you know why it stopped (an issue on GitHub with the log, without secrets, helps).

**Restore**

This restores the backup from before an update, or a nightly backup. Run the commands in the install folder. Replace
`update-<time>` with the backup's folder and `v1.2.2` with the version you had (in `MANIFEST` as `from=`, and in
`git tag`).

```bash
dir=backups/update-<time>
( cd "$dir" && sha256sum --check SHA256SUMS )
# The backup is encrypted: decrypt first, on a computer that has the key (then check with SHA256SUMS.plain)
#   age -d -i workflow-backup.key -o "$dir/database.dump" "$dir/database.dump.age"
#   age -d -i workflow-backup.key -o "$dir/storage.tar.gz" "$dir/storage.tar.gz.age"
# With GnuPG (.gpg files): import the private key once and decrypt
#   gpg --import workflow-backup.gpgkey
#   gpg -o "$dir/database.dump" -d "$dir/database.dump.gpg"
#   gpg -o "$dir/storage.tar.gz" -d "$dir/storage.tar.gz.gpg"
docker compose stop app
git fetch --depth 1 origin tag v1.2.2
git checkout v1.2.2
docker compose build app
docker compose cp "$dir/database.dump" postgres:/tmp/restore.dump
docker compose exec -T postgres sh -c 'set -e
  dropdb -U "$POSTGRES_USER" --force "$POSTGRES_DB"
  createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges --single-transaction --exit-on-error /tmp/restore.dump
  rm /tmp/restore.dump'
mv storage "storage.before-restore.$(date +%s)" && mkdir storage
docker compose run --rm --no-deps -T -v "$PWD/$dir:/backup:ro" app tar -xzf /backup/storage.tar.gz -C /app/storage
docker compose up -d
```

- The database is removed and created again from the backup, so tables that a newer version added are gone too.
- The old files stay in `storage.before-restore.<number>` until you remove them yourself.
- On Windows (PowerShell): the same commands, but `Get-FileHash` instead of `sha256sum`, and
  `Rename-Item storage "storage.before-restore"; New-Item -ItemType Directory storage` instead of the line with `mv`.
  Write the backup's full path in the line with `-v`, for example `-v "C:\Users\anna\workflow-community\backups\update-<time>:/backup:ro"`.
- Open Workflow and check that what you expect is there, for example a customer and an attachment.
- Try the restore once on a test installation (its own folder with `WORKFLOW_DIR`) before you need it.

**If the published history has been rewritten**

Now and then the history of the repository on GitHub is rewritten. An older copy can then not be updated the usual
way, and `git pull` stops with `Not possible to fast-forward`. Run the install line instead. The script does this:

- If you have not changed anything in the folder, the script moves it to the new version. The old version is kept in a
  Git branch named `backup/` followed by the date and time.
- If you have changed files or made your own commits, the script stops and overwrites nothing. Save your changes
  elsewhere and run it again, or install in a new folder with `WORKFLOW_DIR`.
- `.env`, the files in `storage` and the database are never touched, since they are not in Git.

**What changes, and do you need to do anything?**

- Read the release notes of the new version before updating. They are in `lib/release-notes.ts` in the repository,
  and a short summary is shown on **Overview** (*Översikt*) after the update.
- Compare your `.env` with the new `.env.example`, and your cron file with section 5, so that new settings and jobs
  are added.
- Most updates only add tables and columns, but some remove or replace what a new feature has taken over. That is why
  the script always takes a backup first.
- Never go back to an older version without first restoring the backup from before the update (*Restore* above).

## 8. Security

- `.env` holds secrets. Do not share it, commit it to git or show it in logs.
- Never change `AUTH_SECRET` or `INTEGRATION_KEYS_SECRET` in an installation in use. The mail server password and the
  OpenAI and SCB keys are encrypted with them and would stop working.
- Keys are sealed in your own database. You need no external key vault, and `CENTRAL_SECRET_STORE=vault` is refused in
  this edition.
- **Virus scan of documents.** Without ClamAV, Documents work as usual, but the files are marked *Not virus scanned*. With
  your own ClamAV: add the service `clamav/clamav` to your compose file (on the app's network, no port outwards) and set
  `DOCUMENT_SCAN=clamav` and `CLAMAV_HOST=clamav` in `.env`. A file is then given out only once clamd has said it is clean,
  and an infected file is removed at once.
- **Quotas per company.** If the installation has several companies, they share the same keys. Each company gets at
  most 300 AI calls and 6,000 Solar queries an hour, with a clear message when the limit is reached. Change the AI limit
  with `AI_COMPANY_CALLS_PER_HOUR` in `.env` (`0` turns it off).
- **Locked out?** Whoever can run commands on the server can set a new superadmin password, switch Google sign-in on
  again or reset the e-mail settings to `.env`:

  ```bash
  docker compose exec -e ADMIN_PASSWORD='a long new password' app npm run admin:recover -- --password
  docker compose exec app npm run admin:recover -- --google --mail
  ```

## 9. Terms and cookies

- Whoever runs the installation is responsible for terms and personal data.
- Put your own texts in `legal/terms.md`, `legal/privacy.md` and `legal/dpa.md` (see `legal/README.md`).
- The page `/cookies` lists all cookies and local storage Workflow uses.
- All are necessary for sign-in, security and the user's own choices. So Workflow shows an information box but does
  not ask for consent.
- If you add anything for statistics or marketing, consent is required.

## 10. Check that everything works

- `https://<your address>/api/health/ready` answers with `"status":"ok"` when the database and file storage work.
- The test mail under Installation → Services and keys → E-mail arrives.
- Installation → Services and keys shows Ready for everything you have added.
- After a day, `/var/log/workflow/` and Operations and security show no failed jobs.
