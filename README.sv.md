# Workflow Community Edition

Svenska | [English](README.md)

> **Status: under aktiv utveckling.** Texten beskriver vad utgåvan innehåller i version 0.65.0. Ärenden och pull
> requests är välkomna: se [CONTRIBUTING.md](CONTRIBUTING.md).

Workflow är en webbapp för el- och installationsföretag. Den samlar arbetsordrar, offerter, fakturaunderlag, artiklar
och inköp, underhåll, driftronder, avvikelser, egenkontroll, planering, tid och löneunderlag, med PDF-rapporter.
Gränssnittet är på svenska.

Det här är community-utgåvan av [HINTEK Workflow](https://hintekwork.com), under
[GNU Affero General Public License v3.0](LICENSE). Den exporteras från HINTEK:s privata arkiv vid varje släpp.
Namnen i appen och deras engelska motsvarigheter står i [ordlistan](GLOSSARY.md).

## Installera

Det här behöver du:

- [Docker Desktop](https://www.docker.com/products/docker-desktop), igång (på Linux går det också med Docker Engine och Docker Compose)
- [Git](https://git-scm.com)

Så går det till:

- Kopiera en av raderna nedan till en terminal.
- Svara på tre frågor: din e-postadress, ett namn på installationen och ett lösenord.
- Installationen hämtar Workflow, skapar inställningarna med nya slumpade hemligheter, startar allt, skapar ditt konto
  och öppnar webbläsaren.
- Första starten tar 5–10 minuter.

Raderna hämtar installationsskriptet från det här arkivet. Vill du läsa det först, öppna [install.ps1](install.ps1)
eller [install.sh](install.sh).

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/HINTEK-Workflow/workflow-community/main/install.ps1 | iex
```

```bash
# macOS och Linux
curl -fsSL https://raw.githubusercontent.com/HINTEK-Workflow/workflow-community/main/install.sh | bash
```

Efteråt:

- Workflow ligger i mappen `workflow-community` i din hemmapp.
- Kör samma rad igen för att uppdatera. Inställningar och data finns kvar.
- Egen server, HTTPS, schemalagda jobb och backup: läs [INSTALLATION.md](INSTALLATION.md) (på engelska:
  [INSTALLATION.en.md](INSTALLATION.en.md)).

## Vad som ingår

Alla affärsfunktioner i Workflow, med samma namn som i appen. Överst i menyn står **Översikt**, och sedan kommer
grupperna nedan.

**Arbete**

- **Planering**
- **Arbetsordrar** med **Uppgifter**: riskbedömningar, kontroll före idrifttagning, protokoll från egna formulär,
  signaturer, bilder och PDF-rapporter
- **Driftronder** och **Avvikelser**
- **Underhåll**: maskiner och delar, planer efter datum eller drifttimmar, lager och maskinlarm som blir arbetsordrar
- **Tid**: tid, personalliggare och löneunderlag

**Affär**

- **Kunder** och **Projekt**
- **Offerter**, **Fakturaunderlag** och **Fakturor**: företagets egna fakturor till sina kunder, med PDF och e-post,
  kreditfakturor och ROT
- **Inköp** och **Artiklar**

**Mer**

- Rapportarkiv, egenkontroll, instrument, kalkylator, formulärbyggaren (**Skapa formulär**) och import

**Dessutom**

- 19 arbetsprofiler som styr varje persons startsida och rättigheter
- inställningar där varje företag slår på eller av moduler
- redigeraren för PDF-mallar, under **Installation**
- PLC-simulatorn, ett verktyg i skrivbordsstil som öppnas från **Inställningar → Kopplingar → Maskiner**
- **Min webbsida** under Inställningar: varje företag redigerar och publicerar sidorna på sin egen WordPress-webbplats
  med ett applikationslösenord från WordPress (inget installeras på webbplatsen)
- en demo med påhittade data som körs i webbläsaren: knappen **Visa demo med exempeldata** på inloggningssidan, eller
  `/demo`
- flera företag i en installation, åtskilda från varandra, eller ett företag för sig
- både aktiebolag och enskilda firmor kan registrera sig

## Med egna nycklar

- **Workflow AI** med OpenAI eller Azure OpenAI. Leverantören debiterar dig, och varje företag har en gräns per timme.
- **API** och **MCP-server** med OAuth
- inloggning med passkey, **Google** eller **Microsoft**
- e-post via egen SMTP-server, och webbpush
- kartan från Lantmäteriet
- företagsuppslag från SCB
- det gemensamma artikelregistret från **Solar**

## Vad som inte ingår

- HINTEK:s sätt att ta betalt av sina egna kunder (Stripe, abonnemang, priser, krediter)
- HINTEK:s nyckelvalv och serverrutiner
- startsidan och mobilappen

Databasen behåller tabellerna för fakturering och krediter, eftersom kärnan hänvisar till dem. Ingenting debiterar
någon, och inget i utgåvan kontaktar HINTEK.

## Vad som hämtas utifrån

- Skript och typsnitt kommer från din egen server.
- Webbläsaren kontaktar ingen annan. Med Solar påslaget hämtar din server produktbilderna och visar dem själv.
- Servern kontaktar en extern tjänst bara när du själv har slagit på den med din egen nyckel.

## Kartdata

- Kartan kräver en Geotorget-inloggning under **Installation → Tjänster och nycklar**.
- Servern hämtar rutor ur Lantmäteriets *Topografisk webbkarta Nedladdning, raster* bara där någon tittar.
- Rutorna sparas på serverns egen disk (med storleksgräns) och visas därifrån. Webbläsaren kontaktar aldrig
  Lantmäteriet.
- Källa och licens: **Topografisk webbkarta Nedladdning, raster ©Lantmäteriet**,
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Rutorna visas oförändrade.
- Utan inloggning finns ingen karta, men allt annat fungerar.

## Manuell installation (för utvecklare)

Kräver Node.js 22 eller senare och PostgreSQL 16 (`docker-compose.yml` kan köra den).

```bash
cp .env.example .env            # ändra sedan AUTH_SECRET, INTEGRATION_KEYS_SECRET och INSTANCE_ADMIN_EMAIL
docker compose up -d postgres   # eller peka DATABASE_URL på din egen PostgreSQL
npm ci
npm run db:deploy               # kör databasmigreringarna
INSTANCE_ADMIN_EMAIL=du@example.com ADMIN_PASSWORD='ett långt lösenord' npm run admin:create
npm run dev                     # http://localhost:3000
```

- `npm run admin:create` skapar den första superadmin och organisationen i en tom databas. Det vägrar köra om något
  konto redan finns.
- I drift: `npm run build` och `npm run start`, eller `docker compose up -d --build`, med en https-`APP_URL` bakom en
  omvänd proxy.
- Kontroller: `npm run typecheck`, `npm run lint`, `npm test` och `npm run build`.

## Inställningar

Allt ställs in med miljövariabler, och `.env.example` listar dem. Installationens identitet:

| Variabel | Betydelse |
| --- | --- |
| `INSTANCE_NAME` | Produktnamnet i menyn, sidtitlarna, mejlen och MCP-servern |
| `INSTANCE_OPERATOR` | Er organisations korta namn, som visas för era egna formulär |
| `INSTANCE_OPERATOR_DOMAINS`, `INSTANCE_OPERATOR_SLUGS` | Hur er egen organisation känns igen |
| `INSTANCE_ADMIN_EMAIL` | Ägarkontot |
| `INSTANCE_SOURCE_URL` | Länken till källkoden i *Om Workflow*. Ändrar du koden och låter andra använda den över nätverket, ska den peka på din egen kopia |
| `AI_COMPANY_CALLS_PER_HOUR` | AI-anrop per företag och timme (standard 300, `0` för ingen gräns) |
| `WEBSITE_ALLOW_LOCAL_ADDRESSES` | `true` låter Min webbsida nå en WordPress i ert eget nät (http och interna adresser). Av som standard: bara publika https-adresser |

## Egna villkor

- Workflow har inga villkor med sig. Den som driver en installation ansvarar för sina egna.
- Länkarna *Tjänstevillkor*, *Integritetspolicy* och *DPA* visar en kort beskrivning tills du lägger in
  `legal/terms.md`, `legal/privacy.md` och `legal/dpa.md` (se [legal/README.md](legal/README.md)).

## Licenser

- `public/third-party-licenses.txt` listar varje paket med dess licens och länkas från *Om Workflow*.
- `sbom.cdx.json` är samma förteckning som en CycloneDX-fil.

## Bidrag och säkerhet

- Bidrag är välkomna. Se [CONTRIBUTING.md](CONTRIBUTING.md) och avtalet om bidragslicens
  ([CLA.sv.md](CLA.sv.md), på engelska [CLA.md](CLA.md)).
- Sårbarheter rapporteras enligt [SECURITY.md](SECURITY.md).

## Varumärken

- "HINTEK" samt namnet, ordmärket och ikonerna för HINTEK Workflow är varumärken som tillhör HINTEK Power Solutions AB.
- AGPL-3.0-licensen gäller koden, inte märkena. Inget av dem finns i den här utgåvan, som har en neutral ikon.
- Kör du en ändrad version som tjänst, ge den ett eget namn med `INSTANCE_NAME` och en egen ikon under
  **Installation → Drift och säkerhet → Appikon**.
