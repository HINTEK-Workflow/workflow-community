# Workflow Community Edition

[Svenska](README.sv.md) | English

> **Status: in active development.** This text describes what the edition contains as of version 0.64.0. Issues
> and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

Workflow is a web app for electrical and installation companies. It brings together work orders, quotes, invoice bases,
articles and purchasing, maintenance, inspection rounds, deviations, self-inspection, planning, time and payroll basis,
with PDF reports. The user interface is in Swedish.

This is the community edition of [HINTEK Workflow](https://hintekwork.com), under the
[GNU Affero General Public License v3.0](LICENSE). It is exported from HINTEK's private repository at each release.
The app's Swedish names and the English terms used here are listed in the [glossary](GLOSSARY.md).

## Install

You need:

- [Docker Desktop](https://www.docker.com/products/docker-desktop), running
- [Git](https://git-scm.com)

How it works:

- Copy one of the lines below into a terminal.
- Answer two questions: your e-mail address and a password.
- The installer downloads Workflow, creates the settings with new random secrets, starts everything, creates your
  account and opens the browser.
- The first start takes 5-10 minutes.

The lines fetch the installer from this repository. To read it first, open [install.ps1](install.ps1) or
[install.sh](install.sh).

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/HINTEK-Workflow/workflow-community/main/install.ps1 | iex
```

```bash
# macOS and Linux
curl -fsSL https://raw.githubusercontent.com/HINTEK-Workflow/workflow-community/main/install.sh | bash
```

Afterwards:

- Workflow is installed in `workflow-community` in your home folder.
- Run the same line again to update. Settings and data are kept.
- Your own server, HTTPS, scheduled jobs and backup: read [INSTALLATION.en.md](INSTALLATION.en.md) (in Swedish:
  [INSTALLATION.md](INSTALLATION.md)).

## What is included

All business functions of Workflow. The app is in Swedish, so each name below is given in English with the app's
Swedish label in parentheses. **Overview** (*Översikt*) is at the top of the menu, followed by these groups.

**Work** (*Arbete*)

- **Planning** (*Planering*)
- **Work orders** (*Arbetsordrar*) with **Tasks** (*Uppgifter*): risk assessments, pre-commissioning checks, protocols
  from your own forms, signatures, photos and PDF reports
- **Inspection rounds** (*Driftronder*) and **Deviations** (*Avvikelser*)
- **Maintenance** (*Underhåll*): machines and parts, plans by date or run hours, store, and machine alarms that become
  work orders
- **Time** (*Tid*): time, **Personalliggare** (*the Swedish staff register required on construction sites*) and payroll
  files

**Business** (*Affär*)

- **Customers** (*Kunder*) and **Projects** (*Projekt*)
- **Quotes** (*Offerter*), **Invoice bases** (*Fakturaunderlag*) and **Invoices** (*Fakturor*): the company's own
  invoices to its customers, with PDF and e-mail, credit notes and **ROT** (*Swedish tax deduction for repair and
  renovation work*)
- **Purchasing** (*Inköp*) and **Articles** (*Artiklar*)

**More** (*Mer*)

- **Report archive** (*Rapportarkiv*), **Self-inspection** (*Egenkontroll*), **Instruments** (*Instrument*),
  **Calculators** (*Kalkylator*), the **Form builder** (*Skapa formulär*) and **Import** (*Import*)

**Also included**

- 19 work profiles that set each person's start page and rights
- settings where each company turns modules on or off
- the PDF template editor, under **Installation** (the superadmin's area, same name in the app)
- the PLC simulator, a desktop-style tool opened from **Settings → Connections → Machines** (*Inställningar →
  Kopplingar → Maskiner*)
- **My website** (*Min webbsida*) under Settings: each company edits and publishes the pages of its own WordPress site
  with an application password from WordPress (nothing is installed on the site)
- a demo with invented data that runs in the browser: the **Show demo with sample data** button (*Visa demo med
  exempeldata*) on the sign-in page, or `/demo`
- several companies in one installation, each kept apart, or one company by itself
- both limited companies and sole traders can sign up

## With your own keys

- **Workflow AI** with OpenAI or Azure OpenAI. The provider bills you, and each company has a limit per hour.
- the **API** and the **MCP server** with OAuth
- sign-in with passkeys, **Google** or **Microsoft**
- e-mail through your own SMTP server, and web push
- the map from **Lantmäteriet** (*the Swedish mapping, cadastral and land registration authority*)
- company lookup from **SCB** (*Statistics Sweden*)
- the shared article register from **Solar** (an electrical wholesaler)

## What is not included

- HINTEK's charging of its own customers (Stripe, subscriptions, prices, credits)
- HINTEK's key vault and server routines
- the landing page and the mobile app

The database keeps the billing and credit tables, because the core refers to them. Nothing charges anyone, and nothing
in this edition contacts HINTEK.

## What loads from elsewhere

- Scripts and fonts come from your own server.
- The browser contacts no one else. With Solar switched on, your server fetches the product images and serves them
  itself.
- The server contacts an outside service only when you have switched it on with your own key.

## Map data

- The map needs a Geotorget sign-in (Lantmäteriet's e-service portal) under **Installation → Services and keys**
  (*Installation → Tjänster och nycklar*).
- The server reads tiles of Lantmäteriet's *Topografisk webbkarta Nedladdning, raster* (its topographic web map) only
  where someone looks.
- The tiles are kept on the server's own disk (with a size limit) and served from there. The browser never contacts
  Lantmäteriet.
- Source and licence: **Topografisk webbkarta Nedladdning, raster ©Lantmäteriet**,
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The tiles are shown unchanged.
- Without a sign-in there is no map, and everything else works.

## Manual installation (for developers)

Requires Node.js 22 or later and PostgreSQL 16 (`docker-compose.yml` can run it).

```bash
cp .env.example .env            # then change AUTH_SECRET, INTEGRATION_KEYS_SECRET and INSTANCE_ADMIN_EMAIL
docker compose up -d postgres   # or point DATABASE_URL at your own PostgreSQL
npm ci
npm run db:deploy               # applies the database migrations
INSTANCE_ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a long password' npm run admin:create
npm run dev                     # http://localhost:3000
```

- `npm run admin:create` sets up the first superadmin and organization in an empty database. It refuses to run when
  any account exists.
- For production: `npm run build` and `npm run start`, or `docker compose up -d --build`, with an HTTPS `APP_URL`
  behind a reverse proxy.
- Checks: `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`.

## Configuration

All settings are environment variables, and `.env.example` lists them. The installation's identity:

| Variable | Meaning |
| --- | --- |
| `INSTANCE_NAME` | The product name in the menu, page titles, e-mails and the MCP server |
| `INSTANCE_OPERATOR` | Your organization's short name, shown for your own forms |
| `INSTANCE_OPERATOR_DOMAINS`, `INSTANCE_OPERATOR_SLUGS` | How your own organization is recognised |
| `INSTANCE_ADMIN_EMAIL` | The owner account |
| `INSTANCE_SOURCE_URL` | The source link in **About Workflow** (*Om Workflow*). If you change the code and let others use it over a network, point it at your own copy |
| `AI_COMPANY_CALLS_PER_HOUR` | AI calls per company an hour (default 300, `0` for no limit) |
| `WEBSITE_ALLOW_LOCAL_ADDRESSES` | `true` lets My website reach a WordPress on your own network (http and internal addresses). Off by default: public https addresses only |

## Your own terms

- Workflow ships no terms. Whoever runs an installation is responsible for them.
- The links **Terms of service** (*Tjänstevillkor*), **Privacy policy** (*Integritetspolicy*) and **DPA** show a short
  description until you add `legal/terms.md`, `legal/privacy.md` and `legal/dpa.md` (see
  [legal/README.md](legal/README.md)).

## Licences

- `public/third-party-licenses.txt` lists every package with its licence and is linked from About Workflow.
- `sbom.cdx.json` is the same inventory as a CycloneDX file.

## Contributing and security

- Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and the
  [Contributor License Agreement](CLA.md) (Swedish version, which governs: [CLA.sv.md](CLA.sv.md)).
- Report vulnerabilities as described in [SECURITY.md](SECURITY.md).

## Trademarks

- "HINTEK" and the HINTEK Workflow name, wordmark and icons are trademarks of HINTEK Power Solutions AB.
- The AGPL-3.0 licence covers the code, not these marks. None of them is in this edition, which has a neutral icon.
- If you run a modified version as a service, give it your own name with `INSTANCE_NAME` and your own icon under
  **Installation → Operations and security → App icon** (*Installation → Drift och säkerhet → Appikon*).
