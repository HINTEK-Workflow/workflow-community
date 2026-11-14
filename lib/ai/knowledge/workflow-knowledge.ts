import { QUOTE_STATUS_LABELS } from "@/lib/quotes/model";
import { LEVEL_TEXTS } from "@/lib/self-inspection/levels";
import { DETAIL_LEVEL_LABEL } from "@/lib/workflow/detail-level";
import { RISK_QUESTIONS } from "@/lib/workflow/risk-step";
import { STAFF_REGISTER_HELP } from "@/lib/workflow/staff-register";

/**
 * Kunskapspaketet om Workflow (Workflow AI-planen 2026-10-11, avsnitt 2.1; built 2026-10-09): what Workflow AI knows about
 * how Workflow works – the job, work order, task, project, the risk step, Färdigställ, Utgår, planning and bookings,
 * material and quotes, the staff register, the levels and where things are – in Workflow's own words. The labels that
 * exist in code (the risk questions' short names, the level texts, the display levels, the quote statuses, the staff
 * register's help) are read from the code itself, so they never drift. Copyright precaution (CLAUDE.md): nothing from
 * standards, manuals or publishers, no limit values, no customer data.
 *
 * It goes first in the instructions (after the one-line role), the same for every company and question, so the
 * provider's prompt cache carries it. Kept short for tokens (about 1 500, under 5 000 characters). Every change of the text needs a new
 * version: tests/ai-knowledge-pack.test.ts compares the text's fingerprint with WORKFLOW_KNOWLEDGE_FINGERPRINT. The
 * version is written in the run's own log (AiRunEvent "tools_called", `knowledge`), so answers can be compared by version.
 */
export const WORKFLOW_KNOWLEDGE_VERSION = "2026-11-02.3";

const list = (items: readonly string[]) => items.join("; ");

export const WORKFLOW_KNOWLEDGE = [
  `Så fungerar Workflow (kunskapspaket ${WORKFLOW_KNOWLEDGE_VERSION}, Workflows egna regler). Använd det för att förklara och leda rätt; uppgifter om organisationens arbete hämtar du ändå bara ur indatan och verktygen.`,
  "Projekt är valfritt och samlar arbetsordrar med kund, plats, tidsram (start och klart senast), budget och ansvarig. Ett arkiverat eller avslutat projekt låser sina jobb tills det återställs eller återöppnas.",
  "Arbetsordern styr: ett jobb är en arbetsorder, och en uppgift (ett protokoll eller en kontroll från ett formulär, eller en riskbedömning) görs i en arbetsorder och ärver dess kund och projekt. Ett utkast utan arbetsorder (Saknar arbetsorder) kopplas med Koppla till arbetsorder innan arbetet börjar. Tid rapporteras på en arbetsorder eller ett projekt (projekttid, till exempel möten), aldrig på en uppgift för sig. Riskbedömningen görs i arbetsordern. En driftrond (tidsreglerna) hålls av en arbetsorder med period som ger kund och plats; varje rondtillfälle registreras i den, efter en säkerhetsavstämning med tre frågor. En avvikelse i ett protokoll kan bli en uppföljande arbetsorder direkt från raden.",
  "Stegen: Beställning, Planering (valfri), Riskbedömning, Utförande, Signering, Färdigställd. Förloppslinjen och knappen Varför kan jag inte gå vidare? visar nästa steg. Status: Planerad, Pågår, Pausad, Behöver åtgärdas, Färdigställd, Utgått; Pågår och Pausad följer tidtagningen.",
  `Riskbedömningssteget: arbetsordern har det före arbetet, och uppgifterna i den följer det. Förenklad som standard: personen svarar själv Ja, Nej eller Osäker på frågorna (${list(RISK_QUESTIONS.map((question) => question.short))}) och bekräftar. Ett Nej eller Osäker, eller ett eget val, kräver en utökad riskbedömning – ett eget jobb med faror och skyddsåtgärder – som ska färdigställas. Tills steget är klart spärras Starta tid och Färdigställ. Undantag: knappen Arbetet är redan utfört, med ett skäl.`,
  "Färdigställ kräver att riskbedömningssteget är klart och att jobbets krav är uppfyllda: rubrik; för en arbetsorder beskrivet utfört arbete, namn på den som signerar och bekräftad signering; för ett protokoll formulärets obligatoriska fält och signaturer; för en riskbedömning minst en risk med fara, skyddsåtgärd och bedömning före och efter, och godkännande. Ett färdigställt jobb kan återöppnas. get_task ger det som saknas i job.completeBlockedBy och varför tiden inte kan startas i job.startTimeBlockedBy.",
  "Utgår: ett jobb som inte ska göras sätts till Utgår med en kort orsak i stället för att tas bort. Det blir skrivskyddat, räknas inte som öppet, förfallet eller kvar och kan återupptas med Återuppta.",
  `Krävd nivå: varje jobbtyp har en nivå 1–3 (företagets egen eller Workflows förslag) och varje person en nivå genom sina roller under Egenkontroll (${list(Object.values(LEVEL_TEXTS))}). Ingen kan tilldelas, starta, fylla i, signera eller färdigställa ett jobb över sin nivå; den som arbetar under handledning får en nivå över sin egen när ansvarig på jobbet har nivån. Visningsnivån är något annat – hur mycket sidan visar, vald för telefon, surfplatta och dator (${list(Object.values(DETAIL_LEVEL_LABEL))}).`,
  "Tid: Starta och Pausa på arbetsordern (i en uppgift heter knappen Starta tid på arbetsordern) och Starta projekttid på projektet gäller personens egen tid; en person har en timer i taget, och att starta pausar den andra. Tid kan också skrivas under Tid i menyn. Planering har vyerna Kalender, Tidplan och Kapacitet (bokad tid mot arbetstid utan helgdagar och frånvaro, krockar). Kalender är teamets kalender: en bokning (klick på en dag eller Boka) knyter personal och tid till ett jobb (Bokad: på jobbets sida). Egna bokningar ändrar var och en; andras admin, projektansvarig eller den som fått rätten. Tidplan samlar projektets tidplan (varje jobbs start, klart senast och uppskattade tid), bokningar och timmar, och med Alla projekt syns alla projekt.",
  `Material: materialrader (benämning, antal, enhet) på arbetsordern, med à-pris exkl. moms och prisdatum när en artikel ur företagets katalog är vald; Material i projektet summerar raderna. Priser visas bara för den som har rätt att se dem. Offert: utkast från projektets eller arbetsorderns material eller fritt, med moms och för privatperson ROT med företagets egna andel och tak; status ${list(Object.values(QUOTE_STATUS_LABELS))}. En accepterad offert kan bli en arbetsorder. Belopp räknar Workflow, och offerten skickas alltid av personen själv.`,
  `Personalliggare: ansvarig slår på den per byggarbetsplats i projektet. ${STAFF_REGISTER_HELP} Egenkontroll är företagets program med roller, personer, kompetens och nivåer; den godkända versionen gäller.`,
  "I menyn: Översikt, Planering, Arbetsordrar (med fliken Uppgifter), Driftronder, Avvikelser, Underhåll, Tid, Kunder, Projekt, Offerter, Inköp, Verktyg (Rapportarkiv, Egenkontroll, Instrument, Kalkylator, Skapa formulär, Import) och Inställningar. Användare är en flik där, med knappen Operatörskonton. Workflow AI: runda knappen nere, på telefon Hem eller Mer. Varje lista har + Ny … uppe till höger. Behörigheter styr vad var och en ser; du ser bara det personen får se.",
].join(" ");

/** The text's fingerprint for this version (tests/ai-knowledge-pack.test.ts): a change of the text without a new version fails. */
export const WORKFLOW_KNOWLEDGE_FINGERPRINT = "f67fb80339e71398";
