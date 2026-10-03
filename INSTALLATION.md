# Installera Workflow för internt bruk

Den här guiden beskriver vad som krävs för att köra Workflow i ert eget företag, antingen på en **lokal server** i
företagets nätverk eller på en **egen server på internet**. Installationen är fristående: den har inga kopplingar till
HINTEK. Ni driver den själva och ansvarar för e-post, backup, säkerhet och de nycklar ni lägger in.

Allt som Workflow behöver levereras från er egen server. Appen hämtar inga typsnitt, skript eller bilder från andra
webbplatser och skickar ingen statistik. Den kontaktar en extern tjänst bara när ni själva har slagit på den: er
e-postserver, OpenAI, Google-inloggning eller SCB:s företagsregister.

## 1. Det här krävs

| Vad | Krav | Varför |
| --- | --- | --- |
| Dator eller server | Linux rekommenderas (Ubuntu 22.04/24.04). Windows och macOS fungerar med Docker Desktop. Minst 2 processorkärnor, 4 GB minne (8 GB under bygget) och 20 GB disk. | Workflow och databasen körs i två containrar. |
| Docker | Docker Engine med Docker Compose, eller Docker Desktop. | Installationen bygger och startar allt med Docker. |
| Git | Valfri aktuell version. | Installationsskriptet hämtar koden. |
| E-postserver (SMTP) | En adress som får skicka mejl, till exempel `noreply@ert-foretag.se`, med server, port, användarnamn och lösenord från er e-postleverantör. | Utan e-post fungerar inte *Glömt lösenord*, verifiering av e-post, inbjudningar, påminnelser, driftlarm eller utskick. |
| Backup | En plats utanför servern för kopior av databasen och filerna. | Ni ansvarar själva för att data kan återställas. |

**Dessutom för en egen server på internet:**

| Vad | Krav |
| --- | --- |
| Domännamn | Till exempel `workflow.ert-foretag.se`, som pekar på serverns adress. |
| HTTPS | En omvänd proxy med certifikat framför Workflow, till exempel Caddy (se avsnitt 4). Öppna bara portarna 80 och 443. |

**Valfritt:**

| Funktion | Det här behövs | Var det ställs in |
| --- | --- | --- |
| Workflow AI (chatt, förslag, granskning, import med AI) | En egen API-nyckel från OpenAI. Kostnaden debiteras ert OpenAI-konto; sätt ett kostnadstak där. Läs OpenAI:s avtal om personuppgifter (DPA) innan ni delar data. | Produktadministration → AI |
| Inloggning med Google | Egna OAuth-nycklar från Google Cloud Console. Tillåten omdirigeringsadress: `https://<er adress>/api/auth/callback/google`. | `GOOGLE_CLIENT_ID` och `GOOGLE_CLIENT_SECRET` i `.env`, sedan på eller av under Produktadministration → Inloggning |
| Företagsuppslag med organisationsnummer | En kostnadsfri API-nyckel från SCB:s företagsregister (apiafr.scb.se). | Produktadministration → Inloggning |
| API och MCP (ChatGPT, Claude, egna system) | Inget extra för API-nycklar. För att ansluta ChatGPT med inloggning måste servern nås från internet via HTTPS. Claude Desktop och lokala verktyg kan använda en MCP-nyckel även på en lokal server. | Inställningar → API och MCP |

## 2. Installera

**Linux och macOS:**

```bash
curl -fsSL https://raw.githubusercontent.com/HINTEK-Workflow/workflow-community/main/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/HINTEK-Workflow/workflow-community/main/install.ps1 | iex
```

Skriptet frågar efter er e-postadress och ett lösenord, skapar `.env` med nya slumpade hemligheter, startar Workflow
och skapar ert konto som superadmin. Första starten tar 5–10 minuter. Workflow hamnar i mappen `workflow-community`
i hemmappen.

Vill ni installera för hand, se *Manual installation* i README.md.

## 3. Ställ in efter första inloggningen

1. **Produktadministration → E-post:** fyll i SMTP-servern, avsändaren och en adress för driftlarm. Tryck
   *Skicka testmejl till mig* och kontrollera att mejlet kommer fram.
2. **Inställningar → Företag och användare:** bjud in medarbetarna.
3. **Produktadministration → Inloggning:** bestäm om Google-inloggning ska visas och om nya konton får skapas av
   besökare själva (*Tillåt nya konton*). Lägg in SCB-nyckeln om ni vill.
4. **Produktadministration → AI** (valfritt): klistra in OpenAI-nyckeln, tryck *Kontrollera nyckeln* och slå på.
   Därefter **Inställningar → Workflow AI**: välj vad företaget delar med AI.
5. **Produktadministration → Servernycklar:** kontrollera att allt som ska vara inlagt visar *Klar*.

## 4. Egen server på internet: HTTPS

Sätt `APP_URL` och `NEXTAUTH_URL` i `.env` till den publika adressen, till exempel `https://workflow.ert-foretag.se`,
och starta om med `docker compose up -d`. Lägg en omvänd proxy framför. Med Caddy räcker en fil `/etc/caddy/Caddyfile`:

```
workflow.ert-foretag.se {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy hämtar och förnyar certifikatet själv. Workflow lyssnar bara på `127.0.0.1`, så den nås inte utan proxyn.

## 5. Schemalagda jobb

Workflow har jobb som ska köras regelbundet: övervakning, backup, påminnelser, lagringstid för historik, nyckellarm,
dagsammanställning, utskick och integritetskontroll. Kör dem med cron på servern som root. Byt `/opt/workflow` mot
mappen där Workflow ligger och sätt `COMPOSE_PROJECT` till projektets namn (mappnamnet, eller värdet i `.env`).

```
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
COMPOSE_PROJECT=workflow-community
APP_URL=https://workflow.ert-foretag.se
STORAGE_PATH=/opt/workflow/storage
*/5 * * * *  root  cd /opt/workflow && scripts/ops/monitor.sh >> /var/log/workflow/monitor.log 2>&1
15 2 * * *   root  cd /opt/workflow && SOURCE_STORAGE=/opt/workflow/storage scripts/ops/nightly-backup.sh >> /var/log/workflow/backup.log 2>&1
0 6 * * *    root  cd /opt/workflow && scripts/ops/run-job.sh rounds:reminders
30 3 * * *   root  cd /opt/workflow && scripts/ops/run-job.sh history:retention
45 6 * * *   root  cd /opt/workflow && scripts/ops/run-job.sh keys:alerts
30 1 * * *   root  cd /opt/workflow && scripts/ops/run-job.sh ai:digest
*/5 * * * *  root  cd /opt/workflow && scripts/ops/run-job.sh mailings:send
0 5 * * 1    root  cd /opt/workflow && scripts/ops/run-job.sh integrity:check
```

Spara som `/etc/cron.d/workflow`, kör `mkdir -p /var/log/workflow` och `chmod 644 /etc/cron.d/workflow`. Efter fem
minuter ska `tail /var/log/workflow/monitor.log` visa `OK`.

## 6. Backup och återställning

`scripts/ops/nightly-backup.sh` tar en kopia av databasen och filerna och kontrollerar att den går att läsa. Sätt
`OFFSITE_TARGET` för att också skicka kopian till en annan server. Öva en återställning med
`scripts/ops/backup-restore-drill.sh` innan ni är beroende av den; den skriver aldrig till den riktiga databasen.

## 7. Uppdatera

Ta en backup, kör sedan installationsraden igen (eller `git pull` följt av `docker compose up -d --build` i mappen).
Inställningar och data behålls, och databasen uppdateras när Workflow startar.

**Startar inte Workflow efter uppdateringen?** Versionerna 0.4.1–0.4.10 av den här utgåvan hade en databasmigrering
som inte gick att köra. Står det `P3009` eller `builtin_kfid_risk_overwrite` i `docker compose logs app`, kör en gång:

```bash
docker compose run --rm app npx prisma migrate resolve --rolled-back 20261002200000_builtin_kfid_risk_overwrite
docker compose up -d
```

Migreringen körs då om i rättad form. Inga data går förlorade.

## 8. Säkerhet

- `.env` innehåller hemligheter. Den ska inte delas, checkas in i git eller visas i loggar.
- Byt aldrig `AUTH_SECRET` eller `INTEGRATION_KEYS_SECRET` i en installation som används. Lösenordet till
  e-postservern och nycklarna till OpenAI och SCB är krypterade med dem och slutar annars fungera.
- **Utelåst?** Den som kan köra kommandon på servern kan sätta ett nytt lösenord för superadmin, slå på
  Google-inloggning igen eller återställa e-posten till `.env`:

  ```bash
  docker compose exec -e ADMIN_PASSWORD='ett långt nytt lösenord' app npm run admin:recover -- --password
  docker compose exec app npm run admin:recover -- --google --mail
  ```

## 9. Juridik och kakor

Den som driver installationen ansvarar för villkor och personuppgifter. Lägg era egna texter i `legal/terms.md`,
`legal/privacy.md` och `legal/dpa.md` (se `legal/README.md`). Sidan `/cookies` listar alla kakor och all lokal
lagring som Workflow använder. Alla är nödvändiga för inloggning, säkerhet och användarens egna val, så Workflow visar
en informationsruta men ber inte om samtycke. Lägger ni till något för statistik eller marknadsföring krävs samtycke.

## 10. Kontrollera att allt fungerar

- `https://<er adress>/api/health/ready` svarar `{"status":"ok"}` när databasen och fillagringen fungerar.
- *Skicka testmejl till mig* under Produktadministration → E-post kommer fram.
- Produktadministration → Servernycklar visar *Klar* för det ni har lagt in.
