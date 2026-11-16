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
| Docker | Docker Engine with Docker Compose, or Docker Desktop. | The installation builds and starts everything with Docker. |
| Git | Any current version. | The install script fetches the code. |
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
| My website (the company's WordPress) | A WordPress site with an *application password* (WordPress → Users → Profile). Public https addresses only by default. A WordPress on your own network needs `WEBSITE_ALLOW_LOCAL_ADDRESSES=true` in `.env` and a restart. | **Settings → My website** (*Inställningar → Min webbsida*) |
| Machines and control systems (Node-RED, PLC) | One key per source, made in Workflow. The source sends to `https://<your address>/api/ingest/v1/events` (or `/raw`), so it must reach Workflow's address. On a local server the internal network is enough. | Settings → Connections → **Machines** (*Maskiner*) |
| Invoices | Nothing extra. An invoice is made from an **invoice basis** (*fakturaunderlag*) or from scratch under **Invoices** (*Fakturor*). Fill in the company's details (organisation number, VAT number, **Bankgiro** (*Swedish giro payment number*)) and the invoice settings before the first invoice. **ROT** (*Swedish tax deduction for repair and renovation work*) invoices are sent as a link, so the customer must reach the address (a server on the internet). | **Settings → Ways of working → Invoicing** (*Inställningar → Arbetssätt → Fakturering*) |
| Fortnox | The connection is prepared but not open in this version. Invoice bases can be exported as a file instead. | Settings → Connections → **Accounting** (*Bokföring*) |
| Payroll and absence via SFTP | Prepared and off at first. Needs an SFTP server at your time or payroll system: address, user and password or key. The payroll file can always be downloaded by hand. | Settings → Connections → **Payroll and export** (*Lön och export*), and **Time → Payroll and export** (*Tid → Lön och export*) |

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

- asks for your e-mail address, a name for the installation and a password
- creates `.env` with new random secrets and free ports (from 3000 for the app and 5432 for the database)
- starts Workflow and creates your account as superadmin.

The first start takes 5-10 minutes. Workflow is placed in the folder `workflow-community` in your home folder. To
install by hand, see *Manual installation (for developers)* in [README.md](README.md).

## 3. Set up after the first sign-in

1. **Installation → Services and keys → E-mail** (*E-post*): enter the SMTP server and the sender, and check that a
   test mail arrives. Which mails are sent and the address for operations alerts are chosen under **Installation →
   Operations and security**.
2. **Settings → Users** (*Inställningar → Användare*): invite your staff. Whoever accepts an invitation can sign in
   at once.
3. **More companies in one installation** (optional): choose **Installation → Overview → Customer companies → All
   companies → Prepare company** (*Installation → Översikt → Kundföretag → Alla företag → Förbered
   företag*), then send the admin invitation from there.
   - Each company is kept apart from the others.
   - The Customer companies tab is shown once the installation has more companies than its own.
4. **Installation → Operations and security:** decide whether visitors may create accounts themselves (**Allow new
   accounts**, *Tillåt nya konton*, off at first). **Who may sign in** (*Vem får logga in*) is set to **Everyone**
   (*Alla*), that is everyone with an account.
5. **Installation → Services and keys** (optional): paste the OpenAI key, press Check and switch AI on.
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
  nothing without scheduled items.
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
- The copy is **not encrypted**. It holds the whole database and every file, so keep it as well protected as the server.
- Before sending the copy elsewhere, encrypt it, for example with `age` or `gpg` and a key that is not on the server.
- The secrets in `.env` are not in the copy. Keep `.env` separately and safely, or the sealed keys cannot be opened
  after a restore.

## 7. Update

- Take a backup, then run the install line again (or `git pull` followed by `docker compose up -d --build` in the
  folder).
- Settings and data are kept, and the database is updated when Workflow starts.

**What changes, and do you need to do anything?**

- Read the release notes of the new version before updating. They are in `lib/release-notes.ts` in the repository,
  and a short summary is shown on **Overview** (*Översikt*) after the update.
- Compare your `.env` with the new `.env.example`, and your cron file with section 5, so that new settings and jobs
  are added.
- The database only ever gets additions, so an update keeps everything.
- Never go back to an older version without first restoring the backup from before the update.

## 8. Security

- `.env` holds secrets. Do not share it, commit it to git or show it in logs.
- Never change `AUTH_SECRET` or `INTEGRATION_KEYS_SECRET` in an installation in use. The mail server password and the
  OpenAI and SCB keys are encrypted with them and would stop working.
- Keys are sealed in your own database. You need no external key vault, and `CENTRAL_SECRET_STORE=vault` is refused in
  this edition.
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
