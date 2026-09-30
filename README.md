# Workflow Community Edition

Workflow is a web application for electrical and installation companies. It covers projects, tasks, work orders,
risk assessments, commissioning checks (*Kontroll före idrifttagning*), inspection rounds, planning, time reporting and
a form builder for your own protocols, with PDF reports. The user interface is in Swedish.

This repository is the community edition of [HINTEK Workflow](https://workflow.hintek.se), published under the
[GNU Affero General Public License v3.0](LICENSE). It is exported from HINTEK's private repository at each release.

## Install in one step

You need [Docker Desktop](https://www.docker.com/products/docker-desktop) (running) and [Git](https://git-scm.com).
Copy one line into a terminal – for example the terminal in VS Code – and answer two questions (your e-mail address and
a password). The installer downloads Workflow, creates the settings with new random secrets, picks free ports, starts
everything, creates your account and opens the browser. The first start takes 5–10 minutes.

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/HINTEK-Workflow/workflow-community/main/install.ps1 | iex
```

**macOS and Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/HINTEK-Workflow/workflow-community/main/install.sh | bash
```

Workflow is installed in the folder `workflow-community` in your home folder. Run the same line again to update; your
settings and data are kept. In that folder, `docker compose down` stops Workflow and `docker compose up -d` starts it
again.

## What is not included

HINTEK's commercial parts are not part of this repository. Without them:

- there is no payment, subscription or invoicing (Stripe);
- there are no credits to buy, and use is not limited by credits;
- there is no public landing page or landing page editor;
- there is no AI assistant, no API and no MCP server;
- sign-in is with e-mail and password only (no Google sign-in).

## Private-test mode

The current release signs in only the owner account (`INSTANCE_ADMIN_EMAIL`) and, on a public HTTPS server, the
addresses in `PILOT_ACCESS_EMAILS`. Open sign-up is not available yet.

## Requirements

- Node.js 22 or later
- PostgreSQL 16 (the included `docker-compose.yml` can run it)
- Docker (optional, for running the whole stack in containers)

## Manual installation (for developers)

```bash
cp .env.example .env            # then change AUTH_SECRET, INTEGRATION_KEYS_SECRET and INSTANCE_ADMIN_EMAIL
docker compose up -d postgres   # or point DATABASE_URL at your own PostgreSQL
npm ci
npm run db:deploy               # applies the database migrations
INSTANCE_ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a long password' npm run admin:create
npm run dev                     # http://localhost:3000
```

`npm run admin:create` sets up the first superadmin and its organization in an empty database. It refuses to run when
any account exists.

For production, run `npm run build` and `npm run start`, or `docker compose up -d --build`. Use an HTTPS `APP_URL`
behind a reverse proxy.

## Configuration

All settings are environment variables; `.env.example` lists them. The installation's identity:

| Variable | Meaning |
| --- | --- |
| `INSTANCE_NAME` | The product name in the menu, page titles, e-mails and the MCP server |
| `INSTANCE_OPERATOR` | Your organization's short name, shown for your own forms ("*Operator* Original") |
| `INSTANCE_OPERATOR_DOMAINS`, `INSTANCE_OPERATOR_SLUGS` | How your own organization is recognised |
| `INSTANCE_ADMIN_EMAIL` | The owner account |

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md). Every contributor signs the
[Contributor License Agreement](CLA.md) once, in the pull request.

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Trademarks

"HINTEK" and the HINTEK Workflow name, wordmark and icons are trademarks of HINTEK Power Solutions AB. The AGPL-3.0
licence covers the code, not these marks. If you run a modified version as a service, give it your own name with
`INSTANCE_NAME` and your own icons.
