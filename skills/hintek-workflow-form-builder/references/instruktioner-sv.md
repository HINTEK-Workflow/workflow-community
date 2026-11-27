# HINTEK Workflow Form Builder – instruktioner på svenska

Version 1.0.0, för formulärfiler i formatet `hintek-workflow-forms`, formatVersion 1. Samma innehåll som `SKILL.md` på engelska. Den tekniska beskrivningen av varje inställning finns i `format-reference.md` och det exakta formatet i `schema.json`.

Du skriver en **formulärfil** som kunden importerar i HINTEK Workflow (Ny uppgift › Importera, eller Skapa formulär › Skapa med AI). Filen är vanlig JSON. Workflow läser den som data, kontrollerar varje värde och sparar formulären som **utkast**. Kunden granskar och publicerar dem i Skapa formulär. Inget i filen körs som kod.

## Arbetsgång

1. **Förstå underlaget.** Läs kundens beskrivning eller dokument (PDF, Word, Excel eller ett annat formulär). Ta reda på syftet, delarna (avsnitten), varje fråga eller mätvärde, tabeller, checklistor, signaturer och vad som räknas som avvikelse. Är något viktigt oklart, till exempel om ett värde mäts eller bara bockas av, ställ en kort fråga. Annars väljer du rimligt och berättar efteråt vad du valde.
2. **Planera strukturen.** Ett avsnitt per del i underlaget. Välj blocktyp med tabellen "Välj block". Behåll underlagets ordning.
3. **Skriv filen.** Utgå från `assets/mall.json`. Fyll i `meta` och `document`. Följ `format-reference.md` för varje inställning du använder. Utelämna inställningar du inte behöver; alla har ett standardvärde.
4. **Kontrollera filen** med listan nedan. Kan du köra kod, validera mot `schema.json` med en validerare för JSON Schema 2020-12.
5. **Lämna över** en fil som heter som formuläret, till exempel `riskbedomning-takarbete.json`, i UTF-8. Kan du inte skapa filer, skriv hela JSON-innehållet i ett enda kodblock och be kunden spara det som en `.json`-fil. Sammanfatta kort: avsnitten, vad du antog och vad kunden själv behöver fylla i (till exempel gränsvärden).

## Filen

- `format` är `"hintek-workflow-forms"` och `formatVersion` är `1`. `exportedAt` är tiden nu i UTC, till exempel `2026-01-01T00:00:00.000Z`.
- `exportedBy.name` och `publisherName`: kundens företagsnamn om du vet det, annars `Extern AI`. `exportedBy.hintek` är alltid `false`.
- **Skriv aldrig `signature`.** Bara Workflow signerar filer. En fil från dig visas som inte verifierad, och det är rätt.
- `sourceTemplateId`: `ai-` + ett kort namn + `-` + sex slumpade bokstäver eller siffror, till exempel `ai-riskbedomning-takarbete-p3k8m2`. Ett nytt formulär får ett nytt id. `sourceVersion` är `null`.
- Högst 20 formulär per fil, oftast ett.
- `meta.name` krävs (högst 120 tecken). `color`, `icon` och `category` ska vara ett av värdena i referensen.
- `document.schema` är `2`. `document.blocks` innehåller **bara avsnitt**. Alla andra block ligger i ett avsnitts `blocks`.

## Regler som importen kontrollerar

- **Inga okända fält.** Använd bara fälten i referensen, stavade exakt. Ett felstavat eller påhittat fält gör att hela filen avvisas.
- **Bara vanlig text.** Ingen HTML, ingen Markdown, inga taggar som `<b>`, ingen `javascript:` och inga vinkelparenteser runt ord. Radbrytningar i långa texter går bra.
- **Id** (`id`): 1–60 tecken, unikt i formuläret för avsnitt och block, unikt i en tabell för dess kolumner och i en checklista för dess punkter. Använd läsbara id som `avsnitt-matning`, `falt-datum`, `kol-uppmatt`.
- **Kortnamn** (`key`): små bokstäver `a–z`, `å`, `ä`, `ö`, siffror och `_`, börjar med en bokstav, högst 40 tecken, till exempel `uppmatt_varde`. Unikt bland formulärets block; en tabells kolumner har egna kortnamn inom tabellen.
- **Längder:** etiketter högst 200 tecken, hjälptexter 500, textblock och infokort 5 000, alternativ 120 tecken och 50 per lista, checklistpunkter 300 tecken och 200 per lista, 40 kolumner per tabell, 500 fasta rader och 300 block per formulär.
- Hänvisningar ska finnas: ett villkors `key` är ett fält i formuläret; `limitKey` och `limitDefault` är ett gränsvärde i `document.limits`; `deviationTable` är en tabell; `switchKey` och `requiredIf` är ett Ja/nej-fält; `distinctFrom` är en annan signatur; `labelFor` är en kolumn i samma tabell.

## Upphovsrätt och gränsvärden – följ noga

- **Kopiera inte skyddad text ordagrant** ur kundens underlag (standarder, manualer, handböcker, andra utgivares formulär eller tabeller). Skriv frågorna med egna, korta ord. Att hänvisa till en standard med dess beteckning, till exempel "enligt SS-EN 61439", är tillåtet.
- **Hitta aldrig på gränsvärden.** Skriv inga tal för gränser, godkända intervall eller tillåtna intervall (`low`, `high`, `warnLow`, `warnHigh`, `min`, `max`, `allowedMin`, `allowedMax`) om inte kunden har gett just det värdet för sitt eget formulär. Lägg i stället ett gränsvärde i `document.limits` med talen `null` och en `source` som "Anges av teknikern eller i företagets värden". Teknikern eller företagets gränsprofil anger värdena i Workflow.
- Inga organisations- eller tillverkarnamn i formulärnamn, etiketter eller exempel, om inte kunden uttryckligen vill ha sitt eget företagsnamn.
- Inga bilder, logotyper eller bilagor. Filen innehåller bara text och inställningar.

## Språk

Skriv all text som användaren ser (namn, etiketter, hjälptexter, alternativ, punkter) på underlagets språk, och annars på **svenska**. Korta, konkreta etiketter med stor bokstav bara först. Lägg vägledning i `help`, inte i etiketten.

## Välj block

| I underlaget | Block |
|---|---|
| En rubrik inne i en del | `heading` (nivå 3) |
| En instruktion eller förklaring | `text`, eller `note` (Infokort) för längre stöd |
| Ett kort svar, namn, plats | `field` med `input: "text"` |
| Ett längre svar, anmärkningar | `field` med `input: "textarea"` |
| Ett tal eller mätvärde | `field` med `input: "number"` och `unit`; gräns via `limitKey` om värdet bedöms |
| Datum / datum och tid | `field` med `input: "date"` / `"datetime"` |
| Ja / Nej | `field` med `input: "yesno"`; `deviationOn` när ett svar är en avvikelse |
| Ett eller flera alternativ | `field` med `input: "choice"`, `options`, `multiple` |
| Punkter som bedöms OK / Ej OK / Ej aktuellt | `checklist` med `mode: "assessment"` |
| Kryssrutor | `checklist` med `mode: "check"` |
| Rutnät med rader, eller upprepade objekt | `table` (`layout`: `grid`, `cards` eller `rows`; `rowMode`: `fixed` eller `free`) |
| Ett beräknat värde | `computed` med `formula` |
| Foton eller filer | `images` |
| Signaturer | `signature` (en per person som signerar; `role`) |
| Sammanfattning av avvikelser | `summary`, nära slutet |
| Riskmatris | `matrix` |
| Ny sida i PDF | `pagebreak` mellan block, eller `newPage` på ett avsnitt |

Med `width` (`quarter`, `third`, `half`, `two_thirds`, `three_quarters`, `full`) hamnar korta fält bredvid varandra som i ett pappersprotokoll. Bara korta fält, beräknade värden, signaturer, infokort och matriser kan vara smala; resten tar hela bredden.

## Formler i korthet

Som i Excel, med svenska funktionsnamn och `;` mellan argumenten. Ett fält skrivs med sitt kortnamn (`uppmatt`), en hel tabellkolumn som lista (`matning.uppmatt`), en cell på samma tabellrad som `[uppmatt]` och ett gränsvärde som `gräns.<kortnamn>`. Funktioner: `SUMMA`, `MEDEL`, `MIN`, `MAX`, `ANTAL`, `ANTAL.OM`, `OM`, `OCH`, `ELLER`, `INTE`, `AVRUNDA`, `ABS`, `SAMMANFOGA`, `ÄRTOM`, `EDATUM`, `VÄXLA` (engelska namn som `SUM`, `IF` och `AND` fungerar också). Ett Ja/nej-fält läses som sant eller falskt.

En rads **Godkänd** är en kolumn med `input: "assessment"` och ett villkor som `[uppmatt] <= [grans]`, där `grans` är en talkolumn märkt med `limitDefault`, så att företagets värde fylls i. Skriv aldrig gränsens tal i formeln.

## Kontrollera innan du lämnar över

- [ ] Giltig JSON (dubbla citattecken, inga kommentarer, inga avslutande kommatecken), `format`, `formatVersion: 1`, ingen `signature`.
- [ ] `meta.name` ifyllt; `color`, `icon` och `category` från de tillåtna listorna.
- [ ] `document.schema: 2`; bara avsnitt på översta nivån.
- [ ] Alla id unika; alla kortnamn giltiga och unika; alla hänvisningar pekar på något som finns.
- [ ] Valfält och valkolumner har `options`; `deviationOptions` och `defaultValue` finns bland dem.
- [ ] Tabeller med fasta rader har `fixedRows`; varje tabell har minst en kolumn och högst en `assessment`-kolumn.
- [ ] Formler använder bara kortnamn som finns; `[cell]` bara i tabellkolumner.
- [ ] Inga gränsvärden som du inte har fått; gränser har `null` och en `source`.
- [ ] Ingen HTML, ingen kopierad skyddad text, inga organisations- eller tillverkarnamn.
- [ ] Minst ett fält att fylla i, och en signatur om formuläret ska signeras.

## Efter importen

Workflow importerar filen som ett utkast och säger hur många saker som behöver rättas före publicering, om några. Kunden öppnar det i Skapa formulär, provar det i Förhandsgranska och publicerar. Avvisar importen filen står det var felet finns. Rätta just det stället och lämna över filen igen.
