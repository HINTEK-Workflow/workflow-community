# Skapa formulär med extern AI – HINTEK Workflow Form Builder

Version 1.1.0. Med det här paketet kan du låta en AI, till exempel ChatGPT, Claude, Gemini eller Copilot, skapa ett färdigt formulär som du sedan importerar i HINTEK Workflow.

## Så gör du

1. **Ladda ner** paketet i Workflow: Skapa formulär › Skapa med AI, eller Ny uppgift › Skapa formulär med extern AI.
2. **Ge filerna till din AI** tillsammans med din beskrivning eller ditt dokument (PDF, Word, Excel eller ett annat formulär). Skriv till exempel: "Skapa ett formulär för HINTEK Workflow enligt instruktionerna i paketet, utifrån det här protokollet."
3. **Importera resultatet.** Spara AI:ns svar som en `.json`-fil och välj Importera i samma ruta i Workflow. Formuläret blir ett utkast som du granskar i Skapa formulär och sedan publicerar.

## Olika AI-tjänster

- **Claude:** ladda upp zip-filen som en skill i Claudes inställningar för skills, eller bifoga filerna i samtalet.
- **ChatGPT:** bifoga zip-filen eller filerna `SKILL.md`, `references/format-reference.md`, `references/schema.json` och ett exempel från `assets/`. I ett eget GPT- eller projektläge kan filerna läggas som kunskap.
- **Gemini och Copilot:** bifoga eller klistra in `SKILL.md` (eller `references/instruktioner-sv.md`), `references/format-reference.md` och `assets/mall.json`. Klistra in `references/schema.json` om tjänsten tar emot den.
- Andra AI-system som följer standarden Agent Skills läser mappen direkt.

## Vad paketet innehåller

| Fil | Innehåll |
|---|---|
| `SKILL.md` | Instruktionerna till AI:n (engelska) |
| `references/instruktioner-sv.md` | Samma instruktioner på svenska |
| `references/format-reference.md` | Alla blocktyper och inställningar |
| `references/schema.json` | Importformatet som JSON Schema 2020-12 |
| `assets/mall.json` | En grundmall |
| `assets/exempel-*.json` | Färdiga exempel: egenkontroll, mätprotokoll och riskbedömning |

## Bra att veta

- Paketet innehåller inga nycklar, lösenord eller uppgifter om ditt företag. Det skickar inget själv; det är du som väljer vilken AI du ger filerna till och vad du delar med den.
- Ge inte AI:n mer än den behöver. Ta bort personuppgifter och kunduppgifter ur dokumenten innan du delar dem.
- AI:n ska inte hitta på gränsvärden. Gränser fylls i av teknikern eller i företagets värden i Workflow.
- AI:n ska inte kopiera skyddad text ur standarder eller manualer ordagrant. Granska formuläret innan du publicerar det.
- Workflow kontrollerar filen vid importen. Är något fel står det var, och inget sparas förrän hela filen är godkänd.
- Paketets version följer formulärfilens format. Ladda ner paketet igen när Workflow har uppdaterats, så att AI:n får de senaste instruktionerna.
