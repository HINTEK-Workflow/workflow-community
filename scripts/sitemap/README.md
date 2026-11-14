# Webbplatskartan

`generate.cjs` räknar fram kartan ur koden (vyer, flikar, steg, popupar och vägarna mellan dem, per roll). Appen visar den
under Produktadministration → Drift och säkerhet → Avancerat (`features/workflow/site-map.tsx`, data via
`/api/superadmin/sitemap`, bara superadmin). Den fristående sidan:

```
node scripts/sitemap/generate.cjs --html C:\Temp\webbplatskarta-workflow.html
```

## Externa tjänster

Kartan visar också program och tjänster utanför Workflow som koden pratar med (AI, inloggning, betalning, grossister,
uppslag och kartor, e-post och notiser, bokföring) och de som pratar med Workflow (API, MCP, maskiner). Ingången
**Externa tjänster** har en grupp per slag och en ruta per tjänst:

- rutans färg säger vems nyckel den använder: central nyckel, företagets egen nyckel, nyckel som Workflow utfärdar eller
  ingen; märket **UT**, **IN** eller **UT+IN** säger åt vilket håll den pratar;
- linjesorten **där nyckeln och inställningen finns** går från sidan eller avsnittet där den administreras, och
  **sidor som använder tjänsten** (avslagen som förval) från sidorna som använder den;
- panelen visar vad tjänsten används till, nycklarnas namn (aldrig värden), adresserna och modulerna.

Listan är `lib/integrations/external-services.ts`; den kommersiella delen lägger till sina i
`ee/integrations/external-services.ts`, som bara läses när `ee/` finns. `tests/external-services.test.ts` faller om en
värd i `tests/local-sources.test.ts` eller en central nyckel i `lib/secrets/central-fields.ts` saknar en post – lägg då
till tjänsten i listan.

## Provat i appen (klickroboten)

`observed.json` är klickrobotens senaste omgång i kort form: vilka adresser (id:n som `…`) och vägar roboten nådde per
roll och enhet, rollprovet, Bakåt-provet och fynden med status (rättat/öppet/avfärdat). Inga namn, inga sidtexter, inga
hemligheter. Generatorn läser den och märker kartan:

- varje ruta och linje: **Provad i appen** (vilka roller och enheter) eller **Bara i koden – aldrig nådd av roboten**;
- vägar och sidor som roboten hittade men koden saknar: linjesorten **Bara hittad av roboten** och märket ROBOT;
- robotens fynd under Iakttagelser → **Provat i appen**;
- filtret **Visa: Allt · Provat i appen · Bara i koden**;
- **Visa som** följer robotens rollprov (QA:s roller) där roboten provade, annars koden (kryssrutan Följ robotens rollprov).

### Köra om roboten

Roboten bara läser: den öppnar sidor, följer länkar, byter flik och öppnar popupar som bara visar. Den trycker aldrig på
något som sparar, raderar, skickar, betalar, loggar ut eller byter företag. Den körs **bara mot QA-instanserna på
loopback** (3004 produktadmin, 3001 kundföretagets admin, 3002 medarbetare – de syntetiska QA-rollerna) och **inte medan
QA provas för ett släpp**. Utdata hamnar i `.next/sitemap-crawl/` (ändra med `SITEMAP_CRAWL_OUT`), aldrig i Git.

```
node scripts/sitemap/crawl/crawl.cjs superadmin desktop
node scripts/sitemap/crawl/crawl.cjs superadmin phone
node scripts/sitemap/crawl/crawl.cjs admin desktop
node scripts/sitemap/crawl/crawl.cjs admin phone
node scripts/sitemap/crawl/crawl.cjs member desktop
node scripts/sitemap/crawl/crawl.cjs member phone
node scripts/sitemap/crawl/roles.cjs                 # varje vy och avsnitt direkt som varje roll + API:ts GET-vägar
node scripts/sitemap/crawl/back.cjs admin-phone      # Bakåt-provet, för var och en av de sex
node scripts/sitemap/crawl/recheck.cjs               # sidor som inte laddade i robotens flik, igen i en ny
node scripts/sitemap/crawl/summarize.cjs --commit <kort sha för QA-bygget>
node scripts/sitemap/generate.cjs --html C:\Temp\webbplatskarta-workflow.html
```

`summarize.cjs` skriver `scripts/sitemap/observed.json`; committa den. Fyndens status kommer från tabellen `STATUS` (och
`MANUAL` för fynd som provats för hand) i `summarize.cjs` – uppdatera den efter varje omgång rättningar; ett fynd som
ingen regel känner står som öppet. Utan `observed.json` (eller med `--no-observed`) visar kartan bara koden.

Omgången 2026-10-24 (karta `ae2748f6`, QA-bygget av `svar-0-21`) har en analys utanför repot
(`analys-workflow-2026-10-24.md`); rättningarna ligger i `e56676ae`, `aa1da29e` och `4769d86a`.
