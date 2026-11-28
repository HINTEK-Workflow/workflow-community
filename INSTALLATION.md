# Installera Workflow för internt bruk

Svenska | [English](INSTALLATION.en.md)

Guiden beskriver vad som krävs för att köra Workflow i ert eget företag, antingen på en **lokal server** i företagets
nätverk eller på en **egen server på internet**.

- Installationen är fristående och har inga kopplingar till HINTEK.
- Ni driver den själva och ansvarar för e-post, backup, säkerhet och de nycklar ni lägger in.
- Namnen i appen och deras engelska motsvarigheter står i [ordlistan](GLOSSARY.md).

**Vad som hämtas utifrån**

- Allt som Workflow behöver levereras från er egen server. Appen hämtar inga typsnitt eller skript från andra
  webbplatser och skickar ingen statistik.
- Servern kontaktar en extern tjänst bara när ni själva har slagit på den: er e-postserver, OpenAI eller Azure OpenAI,
  inloggning med Google eller Microsoft, SCB:s företagsregister, Lantmäteriet eller Solar.
- Inget går direkt från webbläsaren. Med Solar påslaget hämtar installationens server produktbilderna, och då behöver
  servern nå leverantörens bildadresser över https.

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
| Workflow AI (chatt, förslag, granskning, import med AI) | En egen API-nyckel från OpenAI, eller en egen Azure OpenAI-resurs. Kostnaden debiteras ert konto, så sätt ett kostnadstak där. Läs leverantörens avtal om personuppgifter (DPA) innan ni delar data. Varje företag i installationen har dessutom en gräns per timme (se avsnitt 8). | Installation → Tjänster och nycklar |
| Inloggning med Google | Egna OAuth-nycklar från Google Cloud Console. Tillåten omdirigeringsadress: `https://<er adress>/api/auth/callback/google`. | Installation → Tjänster och nycklar (eller `GOOGLE_CLIENT_ID` och `GOOGLE_CLIENT_SECRET` i `.env`) |
| Solar (gemensamt artikelregister, lagersaldo, produktbilder) | Ett eget API-konto hos Solar: klient-id, hemlighet och katalognummer. Utan det fungerar material, offert och inköp med egna artiklar och prisfiler. | Installation → Tjänster och nycklar → Solar. Kräver jobbet `register:sync` (avsnitt 5). |
| Företagsuppslag med organisationsnummer | En kostnadsfri API-nyckel från SCB:s företagsregister (apiafr.scb.se). | Installation → Tjänster och nycklar |
| API och MCP (ChatGPT, Claude, egna system) | Inget extra för API-nycklar. För att ansluta ChatGPT med inloggning måste servern nås från internet via HTTPS. Claude Desktop och lokala verktyg kan använda en MCP-nyckel även på en lokal server. | Inställningar → Kopplingar |
| Inloggning med Microsoft (Entra ID) | En appregistrering i företagets Microsoft Entra ID: klient-id, klienthemlighet och katalog (tenant). Servern måste nå `login.microsoftonline.com` och `graph.microsoft.com`. | Installation → Tjänster och nycklar → Inloggning med Microsoft. Tryck *Kontrollera* när nycklarna är sparade. |
| Webbpush (notiser till telefon och dator) | Inga externa nycklar: Workflow skapar själv sitt nyckelpar (VAPID). Kräver https. | Installation → Drift och säkerhet → Webbpush: tryck *Skapa nycklar*, ange en kontaktadress (tomt = e-postavsändaren) och slå på. Varje person väljer sedan notiser under Mina inställningar → Notiser. |
| Min webbsida (företagets WordPress) | En WordPress-webbplats med ett *applikationslösenord* (WordPress → Användare → Profil). Som standard bara publika https-adresser. En WordPress i ert eget nät kräver `WEBSITE_ALLOW_LOCAL_ADDRESSES=true` i `.env` och en omstart. | Mer → Webb och inlägg → Min webbsida (slå först på modulen Webb och inlägg under Inställningar → Arbetssätt) |
| Maskiner och styrsystem (Node-RED, PLC) | En nyckel per källa, som ni skapar i Workflow. Källan skickar till `https://<er adress>/api/ingest/v1/events` (eller `/raw`), så den måste nå Workflows adress. På en lokal server räcker det interna nätet. | Inställningar → Kopplingar → Maskiner |
| Fakturor | Inget extra. Fakturan görs av ett fakturaunderlag eller från början under Fakturor. Fyll i företagets uppgifter (organisationsnummer, momsnummer, bankgiro) och fakturainställningarna före den första fakturan. ROT-fakturor skickas som en länk, så kunden måste nå adressen (en server på internet). | Inställningar → Arbetssätt → Fakturering |
| Bokföring | Inget extra. Fakturerade fakturaunderlag exporteras som SIE-fil till ert bokföringsprogram. | Inställningar → Kopplingar → Bokföring |
| Lön och frånvaro | Inget extra. Frånvarofiler läses in på Import, och lönefilen laddas ner för hand. | Inställningar → Kopplingar → Lön och export, och Tid → Lön och export |

## 2. Installera

Raderna nedan hämtar installationsskriptet från arkivet på GitHub.

**Linux och macOS:**

```bash
curl -fsSL https://raw.githubusercontent.com/HINTEK-Workflow/workflow-community/main/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/HINTEK-Workflow/workflow-community/main/install.ps1 | iex
```

Det här gör skriptet:

- hämtar den senaste släppta versionen (en tagg som `v1.2.3`), inte det som just nu ligger på `main`
- frågar efter er e-postadress, ett namn på installationen och ett lösenord
- skapar `.env` med nya slumpade hemligheter och lediga portar (från 3000 för appen och 5432 för databasen)
- startar Workflow och skapar ert konto som superadmin.

Lösenordet ska ha minst 12 tecken och får inte vara ett vanligt lösenord som `Password1234`. Godtas det inte står det
varför, och ni får välja ett nytt lösenord, upp till tre gånger, utan att installationen börjar om. Stannar skriptet
innan kontot är skapat kör ni samma installationsrad igen. Inställningarna i `.env` behålls, och skriptet fortsätter
med att skapa kontot.

Första starten tar 5–10 minuter. Vill ni installera för hand, se *Manuell installation (för utvecklare)* i
[README.sv.md](README.sv.md).

**En viss version.** Sätt `WORKFLOW_VERSION` innan ni kör installationsraden, till exempel
`WORKFLOW_VERSION=v1.2.3` (Linux och macOS, före `bash` i raden) eller `$env:WORKFLOW_VERSION = "v1.2.3"` (PowerShell).
Vilka versioner som finns ser ni under *Releases* på GitHub.

**Kontrollera skriptet först (rekommenderas).** Från och med 0.90.0 har varje version en release på GitHub under
*Releases*, och äldre releaser och taggar tas aldrig bort. Releasen har de här filerna:

| Fil | Vad det är |
| --- | --- |
| `workflow-community-v1.2.3.tar.gz` | Hela koden för versionen (samma filer som en klon av taggen) |
| `install.sh`, `install.ps1` | Installationsskripten för versionen |
| `sbom-community-v1.2.3.cdx.json` | Förteckningen över paketen i versionen (CycloneDX) |
| `allowed_signers` | Den publika nyckeln som taggen är signerad med |
| `SHA256SUMS` | Kontrollsummorna för filerna ovan |

Ladda ner skriptet för versionen, kontrollera kontrollsumman och kör det sedan:

```bash
curl -fsSLO https://github.com/HINTEK-Workflow/workflow-community/releases/download/v1.2.3/install.sh
curl -fsSLO https://github.com/HINTEK-Workflow/workflow-community/releases/download/v1.2.3/SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS && WORKFLOW_VERSION=v1.2.3 bash install.sh
```

I PowerShell: `Get-FileHash install.ps1 -Algorithm SHA256` och jämför med raden för `install.ps1` i `SHA256SUMS`.

**Taggen är signerad.** Taggen `v1.2.3` är signerad med en SSH-nyckel, och GitHub visar den som *Verified*. Vill ni
kontrollera själva, gör det i installationsmappen (eller i en klon) med `allowed_signers` från releasen:

```bash
git fetch origin tag v1.2.3 && git -c gpg.ssh.allowedSignersFile=allowed_signers verify-tag v1.2.3
```

Raden ska sluta med `Good "git" signature`. Versioner till och med 0.90.0 har ingen signerad tagg.

### Var Workflow hamnar

- Workflow hamnar i mappen `workflow-community` i hemmappen, till exempel `/home/anna/workflow-community` eller
  `C:\Users\anna\workflow-community`.
- Vill ni ha en annan mapp, ange den med `WORKFLOW_DIR` när ni kör installationsraden. På Linux och macOS:

  ```bash
  curl -fsSL https://raw.githubusercontent.com/HINTEK-Workflow/workflow-community/main/install.sh | WORKFLOW_DIR="$HOME/workflow-ny" bash
  ```

  I PowerShell på Windows:

  ```powershell
  $env:WORKFLOW_DIR = "$HOME\workflow-ny"; irm https://raw.githubusercontent.com/HINTEK-Workflow/workflow-community/main/install.ps1 | iex
  ```

- Finns Workflow redan i mappen uppdateras den installationen. En ny mapp ger en ny, separat installation med egna
  inställningar och en egen databas.
- Använd samma `WORKFLOW_DIR` varje gång ni uppdaterar en installation som inte ligger i standardmappen.
- Körs Workflow redan i mappen säger skriptet det och väntar i 10 sekunder innan det fortsätter. Tryck Ctrl+C för att
  avbryta.

## 3. Ställ in efter första inloggningen

1. **Installation → Tjänster och nycklar → E-post:** fyll i SMTP-servern och avsändaren, och kontrollera att ett
   testmejl kommer fram. Vilka mejl som skickas och adressen för driftlarm väljer ni under **Installation → Drift och
   säkerhet**.
2. **Inställningar → Användare:** bjud in medarbetarna. Den som accepterar en inbjudan kan logga in direkt.
   - Inbjudningar är av från början: kryssa först i *Inbjudningar* under **Installation → Drift och säkerhet**.
3. **Fler företag i samma installation** (valfritt): välj **Installation → Översikt → Kundföretag → Alla företag →
   Förbered företag**, och skicka sedan admininbjudan därifrån.
   - Varje företag är skilt från de andra.
   - Fliken Kundföretag visas när installationen har fler företag än sitt eget.
4. **Installation → Drift och säkerhet:** bestäm om besökare själva får skapa konton (*Tillåt nya konton*, av från
   början). *Vem får logga in* står på Alla, det vill säga alla med ett konto.
5. **Installation → Tjänster och nycklar** (valfritt): klistra in OpenAI-nyckeln, tryck *Kontrollera* och slå på AI. Under *Leverantör för Standard* väljer ni OpenAI (förvalt) eller Azure; företag som kräver behandling inom EU kör alltid på Azure-modeller markerade EU verifierad.
   - Lägg in nycklar för Google och SCB om ni vill.
   - Välj sedan under **Inställningar → Arbetssätt → Workflow AI** vad företaget delar med AI.
   - Kontrollera att allt som ska vara inlagt visar *Klar*.
6. **Karta** (valfritt):
   - Beställ behörighet till *Topografisk webbkarta Nedladdning, raster* i Lantmäteriets Geotorget (avgiftsfritt).
   - Lägg in användarnamn och lösenord under **Installation → Tjänster och nycklar → Karta från Lantmäteriet**.
   - Servern hämtar bara de kartrutor som någon tittar på. Den sparar dem i `storage/map-tiles` upp till den gräns ni
     anger (standard 1 024 MB; en plats med omgivning tar ungefär 5 MB) och visar dem därifrån.
   - Webbläsaren kontaktar aldrig Lantmäteriet. Servern behöver nå `api.lantmateriet.se` och `dl1.lantmateriet.se`
     utåt.
   - Källangivelse enligt villkoren: *Topografisk webbkarta Nedladdning, raster ©Lantmäteriet*, licens CC BY 4.0
     (creativecommons.org/licenses/by/4.0/). Kartbilderna visas oförändrade, och kartnålarna är tillagda i Workflow.
     Workflow visar detta vid varje karta och under Hjälp → Om Workflow.

### Namn och ikon

- Installationens namn och den som driver den står i `.env`:
  - `INSTANCE_NAME` visas i menyn, fliken och mejlen.
  - `INSTANCE_OPERATOR` är ert korta namn, till exempel på era egna globala formulär.
- Installationsskriptet sätter båda till det namn ni angav.
- Vill ni byta namn efteråt, ändra dem i `.env` och starta om med `docker compose up -d`. Inget sparat ändras: nya mejl,
  rapporter och sidor får det nya namnet. Formulär som redan är publicerade behåller namnet de publicerades med.
- Ikonen i webbläsarens flik och på hemskärmen är en neutral Workflow-ikon. Ladda upp er egen under **Installation →
  Drift och säkerhet → Appikon** (kvadratisk PNG, JPEG eller WebP, högst 2 MB). Den sparas i fillagringen och följer med
  backupen.

## 4. Adress och HTTPS

- Efter installationen har Workflow adressen `http://localhost:<port>`, som bara nås från den egna datorn.
- För att andra ska komma åt den behöver den en riktig adress: `APP_URL` och `NEXTAUTH_URL` i `.env`.
- **En adress som inte är localhost måste vara https**, annars startar inte appen.
- Länkar i inbjudningar och mejl byggs av `APP_URL`, så den ska vara adressen som medarbetarna faktiskt använder.
- Med en omvänd proxy framför: sätt också `TRUSTED_PROXY_HOPS=1` i `.env`. Då ser gränserna per IP-adress besökarens
  adress och inte proxyns.
- Exemplen nedan använder port 3000. Har installationsskriptet valt en annan port står den som `APP_PORT` i `.env`.

### Lokal server i företagets nätverk

Ge servern ett namn i ert nätverk, till exempel `workflow.foretaget.local` eller ett namn i er egen domän, som pekar på
serverns interna adress. Sätt `APP_URL` och `NEXTAUTH_URL` till `https://workflow.foretaget.local` och starta om med
`docker compose up -d`. Lägg en omvänd proxy med certifikat framför. Med Caddys interna certifikatutfärdare:

```
workflow.foretaget.local {
    tls internal
    reverse_proxy 127.0.0.1:3000
}
```

- Klienterna måste lita på Caddys rotcertifikat (`caddy trust` på servern, och rotcertifikatet installerat på varje
  dator och telefon). Ni kan också använda företagets eget certifikat.
- Öppna bara port 443 i serverns brandvägg mot det interna nätet.
- Inloggning med Google och anslutning av ChatGPT kräver en adress som nås från internet. Det gör inte resten.

### Egen server på internet

Sätt `APP_URL` och `NEXTAUTH_URL` i `.env` till den publika adressen, till exempel `https://workflow.ert-foretag.se`,
och starta om med `docker compose up -d`. Lägg en omvänd proxy framför. Med Caddy räcker en fil `/etc/caddy/Caddyfile`:

```
workflow.ert-foretag.se {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy hämtar och förnyar certifikatet själv. Workflow lyssnar bara på `127.0.0.1`, så den nås inte utan proxyn.

## 5. Schemalagda jobb

Workflow har jobb som ska köras regelbundet: underhållsplaner, maskinregler och larm, påminnelser, lagringstid för
historik, övervakning, backup, nyckellarm, dagsammanställning, utskick och integritetskontroll.

- **Utan jobben händer inget när en dag kommer.** Arbetsordrar från underhållsplaner skapas inte, larm eskaleras inte,
  och övervakningen märker inte ett jobb som aldrig körs.
- Kör dem med cron på servern som root.
- Byt `/opt/workflow` mot mappen där Workflow ligger, och sätt `COMPOSE_PROJECT` till Docker Compose-projektets namn. Det
  är mappnamnet med små bokstäver (`docker compose ls` visar det).
- Inget jobb kräver en nyckel: en tjänst som inte är påslagen hoppas över.

```
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
COMPOSE_PROJECT=workflow-community
APP_URL=https://workflow.ert-foretag.se
STORAGE_PATH=/opt/workflow/storage
*/5 * * * *  root  cd /opt/workflow && scripts/ops/monitor.sh >> /var/log/workflow/monitor.log 2>&1
15 1 * * *   root  cd /opt/workflow && SOURCE_STORAGE=/opt/workflow/storage scripts/ops/nightly-backup.sh >> /var/log/workflow/backup.log 2>&1
# Underhåll och maskiner
40 5 * * *   root  cd /opt/workflow && scripts/ops/run-job.sh maintenance:plans
*/5 * * * *  root  cd /opt/workflow && scripts/ops/run-job.sh machine:rules
*/5 * * * *  root  cd /opt/workflow && scripts/ops/run-job.sh machine:alarms
# Påminnelser, lagringstid och utskick
0 6 * * *    root  cd /opt/workflow && scripts/ops/run-job.sh rounds:reminders
30 3 * * *   root  cd /opt/workflow && scripts/ops/run-job.sh history:retention
45 6 * * *   root  cd /opt/workflow && scripts/ops/run-job.sh keys:alerts
30 1 * * *   root  cd /opt/workflow && scripts/ops/run-job.sh ai:digest
*/5 * * * *  root  cd /opt/workflow && scripts/ops/run-job.sh mailings:send
*/15 6-19 * * * root  cd /opt/workflow && scripts/ops/run-job.sh notices:send
*/5 * * * *  root  cd /opt/workflow && scripts/ops/run-job.sh schedule:publish
*/5 * * * *  root  cd /opt/workflow && scripts/ops/run-job.sh agents:run
0 5 * * 1    root  cd /opt/workflow && scripts/ops/run-job.sh integrity:check
# Bara med Solar påslagen: hämtar artikelregistret efter att ni begärt det under Tjänster och nycklar → Solar
*/10 * * * * root  cd /opt/workflow && scripts/ops/run-job.sh register:sync
# Valfritt: kontroll en gång om dygnet att förseglade nycklar går att öppna (inget nyckelvalv behövs)
10 4 * * *   root  cd /opt/workflow && scripts/ops/run-job.sh secrets:sync
```

Det här gör jobben:

- `maintenance:plans` skapar och flyttar arbetsordrar från underhållsplanerna.
- `machine:rules` larmar när en signal har tystnat eller ett tillstånd har varat för länge.
- `machine:alarms` eskalerar larm och felanmälningar till jouren. Utan e-post och push eskaleras de ändå i appen.
- `secrets:sync` larmar högst en gång per dygn om ett förseglat värde inte går att öppna, till exempel efter ett byte av
  `AUTH_SECRET`. Samma kontroll finns manuellt under Tjänster och nycklar. Är larm-e-post avstängd skrivs larmet i loggen,
  och jobbet räknas som misslyckat.
- `notices:send` skickar de påminnelser som personerna själva har valt att få som e-post eller webbpush (Mina
  inställningar → Notiser). Det gör ingenting förrän e-postnotiser är påslagna under Installation → Drift och säkerhet,
  eller webbpush har fått nycklar och är påslagen.
- `mailings:send` skickar de utskick som systemadministratören har skickat eller schemalagt under Installation →
  Webbplats och utskick. Den här utgåvan gör inga veckobrev med versionsnyheter.
- `schedule:publish` publicerar inlägg och webbsidor som en administratör har schemalagt, när tiden har kommit. Utan
  något schemalagt gör det ingenting. Det laddar också upp filmer till YouTube (Filmer) när de är schemalagda, och fortsätter
  en uppladdning som har stannat.
- `agents:run` kör uppdragen under Agenter när deras tid har kommit, med ägarens behörigheter. Uppdrag som bara räknar och
  listar fungerar utan AI-nyckel. Uppdrag där HINTEK AI skriver en text använder er egen AI-nyckel. Utan uppdrag gör jobbet ingenting.
- Jobb för betalning och krediter finns inte i den här utgåvan.

Spara som `/etc/cron.d/workflow` och kör `mkdir -p /var/log/workflow` och `chmod 644 /etc/cron.d/workflow`.
Övervakningen larmar tills det finns en lyckad backup, så kör backupen en gång för hand som root:

```bash
cd /opt/workflow && COMPOSE_PROJECT=workflow-community SOURCE_STORAGE=/opt/workflow/storage scripts/ops/nightly-backup.sh
```

Inom fem minuter efter det ska `tail /var/log/workflow/monitor.log` visa `OK`.

## 6. Backup och återställning

- `scripts/ops/nightly-backup.sh` tar en kopia av databasen och filerna och kontrollerar att den går att läsa.
- Sätt `OFFSITE_TARGET` för att också skicka kopian till en annan server.
- Öva en återställning med `scripts/ops/backup-restore-drill.sh` innan ni är beroende av den. Den skriver aldrig till den
  riktiga databasen. Kör den som root med samma projektnamn och lagringsmapp som backupen:

  ```bash
  cd /opt/workflow && COMPOSE_PROJECT=workflow-community SOURCE_STORAGE=/opt/workflow/storage \
    BACKUP_ROOT=/opt/backups/workflow-restore-drills scripts/ops/backup-restore-drill.sh
  ```

  Övningen återställer till en tillfällig databas och mapp under `BACKUP_ROOT/work` (en annan mapp: `DRILL_WORK_ROOT`)
  och tar bort dem när den är klar. Rapporten ligger i övningens mapp under `BACKUP_ROOT`.
- **Backuperna krypteras alltid** med `age`. Programmet behövs på servern (till exempel `apt install age`,
  `brew install age` eller `winget install FiloSottile.age`), och installationen stannar med ett besked om det saknas.
  - Bäst är att skapa nyckeln på en annan dator, inte på servern: `age-keygen -o workflow-backup.key`. Raden
    `Public key: age1…` är den publika delen. Lägg den i `.env` som `BACKUP_AGE_RECIPIENT=age1…` (eller ange den första
    gången med `WORKFLOW_BACKUP_AGE_RECIPIENT=age1…` före installationsraden).
  - Finns ingen `BACKUP_AGE_RECIPIENT` skapar installationsskriptet ett nyckelpar i `backup-key/workflow-backup.agekey` i
    installationsmappen (bara er användare kan läsa den), skriver den publika delen i `.env` och säger var den privata
    nyckeln ligger. **Kopiera den privata nyckeln till en säker plats utanför servern**, helst två (en lösenordshanterare
    och ett USB-minne i ett kassaskåp), och ta sedan bort den från servern. Utan den går ingen backup att öppna.
  - `nightly-backup.sh` läser `BACKUP_AGE_RECIPIENT` ur `.env` i mappen som cron-raden står i (eller ur cron-filen), och
    vägrar ta en okrypterad backup. Bara `.age`-filerna sparas och skickas till `OFFSITE_TARGET`. `SHA256SUMS.plain` har
    kontrollsummorna för de okrypterade filerna, och backupen före en uppdatering har dessutom `ROWS` (antalet rader per
    tabell) och `MANIFEST`.
- **Öva återställningen av en verklig backup en gång i månaden** med `scripts/ops/aterstallningsovning.sh`, på en dator som
  har Docker och den privata nyckeln (gärna inte servern). Den återställer den senaste backupen i en tillfällig databas utan
  nätverk, jämför kontrollsummorna och antalet rader per tabell med backupens förteckning, startar appen mot kopian och
  kontrollerar att den svarar, och skriver ett protokoll i `aterstallning/aterstallning-ÅÅÅÅ-MM-DD.md`. Utan `--apply`
  visar den bara vad den skulle göra:

  ```bash
  bash scripts/ops/aterstallningsovning.sh --backup-dir backups --key ~/workflow-backup.key \
    --app-image "$(sed -n 's/^APP_IMAGE=//p' .env)" --apply
  ```

  Den dekrypterade kopian skrivs över och tas bort efteråt; den krypterade ligger kvar.
- Hemligheterna i `.env` ingår inte i kopian. Spara `.env` separat och säkert, annars går de förseglade nycklarna inte
  att öppna efter en återställning.

## 7. Uppdatera

Kör installationsraden igen. Skriptet gör så här:

1. Hämtar den senaste släppta versionen (eller den ni anger med `WORKFLOW_VERSION`).
2. Bygger den nya versionen medan den gamla körs.
3. Stoppar appen och tar en backup av databasen och filerna i `backups/update-<tid>/` i installationsmappen. Databasen
   läses tillbaka till en tillfällig databas, och arkivet med filerna listas tillbaka. Går något fel startas den gamla
   versionen igen och databasen ändras inte.
4. Startar den nya versionen, som uppdaterar databasen.

- Inställningar och data behålls. De fem senaste backuperna från uppdateringar sparas (`WORKFLOW_KEEP_BACKUPS` ändrar
  antalet). De krypteras alltid till `BACKUP_AGE_RECIPIENT` i `.env` (avsnitt 6).
- Uppdaterar ni för hand (`git fetch --tags` och `git checkout v1.2.3` följt av `docker compose up -d --build`), ta
  först en backup med `scripts/ops/nightly-backup.sh`.

**Om uppdateringen stannar**

Svarar Workflow inte efter en uppdatering, titta först i loggen med `docker compose logs app`.

- Står det att en migrering misslyckades eller att databasen inte stämmer med versionen, startar appen inte. Det är
  avsiktligt: ingenting halvfärdigt används. Varje migrering körs i en transaktion, så en migrering som stoppades har inte
  ändrat något.
- Gå då tillbaka till versionen ni hade och återställ backupen från före uppdateringen, enligt *Återställ* nedan. Kör
  sedan inte uppdateringen igen förrän ni vet varför den stannade (skapa gärna ett ärende på GitHub med loggen, utan
  hemligheter).

**Återställ**

Så här återställer ni backupen från före en uppdatering, eller en nattlig backup. Kör kommandona i installationsmappen.
Byt `update-<tid>` mot backupens mapp och `v1.2.2` mot versionen ni hade (står i `MANIFEST` som `from=`, och i
`git tag`).

```bash
dir=backups/update-<tid>
( cd "$dir" && sha256sum --check SHA256SUMS )
# Backupen är krypterad: packa upp först, på en dator som har nyckeln (kontrollera sedan med SHA256SUMS.plain)
#   age -d -i workflow-backup.key -o "$dir/database.dump" "$dir/database.dump.age"
#   age -d -i workflow-backup.key -o "$dir/storage.tar.gz" "$dir/storage.tar.gz.age"
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
mv storage "storage.fore-aterstallning.$(date +%s)" && mkdir storage
docker compose run --rm --no-deps -T -v "$PWD/$dir:/backup:ro" app tar -xzf /backup/storage.tar.gz -C /app/storage
docker compose up -d
```

- Databasen tas bort och skapas igen ur backupen, så tabeller som en nyare version har lagt till försvinner också.
- De gamla filerna ligger kvar i `storage.fore-aterstallning.<tal>` tills ni själva tar bort dem.
- På Windows (PowerShell): samma kommandon, men `Get-FileHash` i stället för `sha256sum`, och
  `Rename-Item storage "storage.fore-aterstallning"; New-Item -ItemType Directory storage` i stället för raden med `mv`.
  Skriv sökvägen till backupen fullt ut i raden med `-v`, till exempel `-v "C:\Users\anna\workflow-community\backups\update-<tid>:/backup:ro"`.
- Öppna Workflow och kontrollera att det ni väntade er finns, till exempel en kund och en bilaga.
- Prova gärna återställningen en gång på en provinstallation (en egen mapp med `WORKFLOW_DIR`) innan ni behöver den.

**Om den publicerade historiken har skrivits om**

Ibland görs historiken i arkivet på GitHub om. Då kan en äldre kopia inte uppdateras på vanligt sätt, och `git pull`
stoppar med `Not possible to fast-forward`. Kör installationsraden i stället. Skriptet gör så här:

- Har ni inte ändrat något i mappen flyttar skriptet den till den nya versionen. Den gamla versionen sparas i en
  Git-gren som heter `backup/` följt av datum och tid.
- Har ni ändrat filer eller gjort egna commits stoppar skriptet och skriver inte över något. Spara era ändringar någon
  annanstans och kör igen, eller installera i en ny mapp med `WORKFLOW_DIR`.
- `.env`, filerna i `storage` och databasen påverkas aldrig, eftersom de inte ligger i Git.

**Vad ändras, och måste ni göra något?**

- Läs versionsanteckningarna för den nya versionen innan ni uppdaterar. De står i `lib/release-notes.ts` i arkivet, och
  en kort sammanfattning visas på Översikt efter uppdateringen.
- Jämför er `.env` med den nya `.env.example` och er cron-fil med avsnitt 5, så att nya inställningar och jobb kommer
  med.
- De flesta uppdateringar lägger bara till tabeller och kolumner, men en del tar bort eller byter ut sådant som en ny
  funktion har ersatt. Därför tar skriptet alltid en backup först.
- Gå aldrig tillbaka till en äldre version utan att först återställa backupen från före uppdateringen (*Återställ* ovan).

## 8. Säkerhet

- `.env` innehåller hemligheter. Dela den inte, checka inte in den i git och visa den inte i loggar.
- Byt aldrig `AUTH_SECRET` eller `INTEGRATION_KEYS_SECRET` i en installation som används. Lösenordet till e-postservern
  och nycklarna till OpenAI och SCB är krypterade med dem och slutar annars fungera.
- Nycklarna förseglas i er egen databas. Ni behöver inget externt nyckelvalv, och `CENTRAL_SECRET_STORE=vault` vägras i
  den här utgåvan.
- **Virussökning av dokument.** Utan ClamAV fungerar Dokument som vanligt, men filerna märks *Inte virussökt*. Med egen
  ClamAV: lägg till tjänsten `clamav/clamav` i er compose-fil (i samma nät som appen, ingen port utåt) och sätt
  `DOCUMENT_SCAN=clamav` och `CLAMAV_HOST=clamav` i `.env`. Då ges en fil ut först när clamd har sagt att den är ren, och en
  smittad fil tas bort direkt.
- **Kvoter per företag.** Har installationen flera företag delar de på samma nycklar. Varje företag får högst 300
  AI-anrop och 6 000 frågor till Solar per timme, och får ett tydligt besked när gränsen nås. AI-gränsen ändras med
  `AI_COMPANY_CALLS_PER_HOUR` i `.env` (`0` stänger av den).
- **Utelåst?** Den som kan köra kommandon på servern kan sätta ett nytt lösenord för superadmin, slå på
  Google-inloggning igen eller återställa e-posten till `.env`:

  ```bash
  docker compose exec -e ADMIN_PASSWORD='ett långt nytt lösenord' app npm run admin:recover -- --password
  docker compose exec app npm run admin:recover -- --google --mail
  ```

## 9. Villkor och kakor

- Den som driver installationen ansvarar för villkor och personuppgifter.
- Lägg era egna texter i `legal/terms.md`, `legal/privacy.md` och `legal/dpa.md` (se `legal/README.md`).
- Sidan `/cookies` listar alla kakor och all lokal lagring som Workflow använder.
- Alla behövs för inloggning, säkerhet och användarens egna val. Därför visar Workflow en informationsruta men ber inte om
  samtycke.
- Lägger ni till något för statistik eller marknadsföring krävs samtycke.

## 10. Kontrollera att allt fungerar

- `https://<er adress>/api/health/ready` svarar med `"status":"ok"` när databasen och fillagringen fungerar.
- Testmejlet under Installation → Tjänster och nycklar → E-post kommer fram.
- Installation → Tjänster och nycklar visar *Klar* för det ni har lagt in.
- Efter en dag visar `/var/log/workflow/` och *Drift och säkerhet* inga misslyckade jobb.
