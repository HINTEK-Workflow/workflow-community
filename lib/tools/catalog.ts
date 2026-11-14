import { z } from "zod";
import { OPERATING_STATES, PLACE_ATTRIBUTE_LIMIT, WAITING_REASONS } from "@/lib/workflow/maintenance";
import { cancelReasonSchema } from "@/lib/workflow/task-cancel";
import { addFieldHelp } from "@/lib/tools/field-help";
import { CUSTOMER_TYPES } from "@/lib/kfid/customer-schema";

// The tool catalogue (2026-09-30): names, descriptions, what kind of change each tool makes, which key scope it
// needs and its input. No database or route code here, so the page, the tests and the MCP listing can use it.

export type ToolEffect = "read" | "create" | "update" | "delete";

const id = z.string().min(1).max(100);
const day = z.iso.date();
const text = (max: number) => z.string().trim().max(max);
// Kundtyp (2026-10-10): Företag (COMPANY) or Privatperson (PRIVATE); a new quote for the customer starts with it.
const customerType = z.enum(CUSTOMER_TYPES).describe("Kundtyp: COMPANY (företag) eller PRIVATE (privatperson).");
const page = z.number().int().min(1).max(1000).optional();
// What a paused work order waits for (Underhåll, 2026-10-06). The maintenance facts (type, priority, fault, times)
// moved to maintenance items on machine parts on 2026-10-30 and are not set through these tools.
const waitingOn = z.union([z.literal(""), z.enum(WAITING_REASONS)]).optional().describe("Vad en pausad arbetsorder väntar på: MATERIAL material, CUSTOMER kund, SHUTDOWN avställning; \"\" tar bort. Sätter status PAUSED om ingen annan status anges.");
// A place's object data (Underhåll stage 2): free text entered by the user and the operating state.
const placeObject = {
  objectType: text(80).optional(),
  operatingState: z.union([z.literal(""), z.enum(OPERATING_STATES)]).optional().describe("IN_SERVICE i drift, OUT_OF_SERVICE ur drift, DECOMMISSIONED avvecklad"),
  manufacturer: text(120).optional(), model: text(120).optional(), serialNumber: text(120).optional(), installedOn: z.union([z.literal(""), day]).optional(),
  attributes: z.array(z.object({ label: z.string().trim().min(1).max(60), value: text(200) })).max(PLACE_ATTRIBUTE_LIMIT).optional(),
};

type Definition = {
  title: string;
  description: string;
  effect: ToolEffect;
  /** The API key scope; MCP keys use mcp:read / mcp:write / mcp:delete by effect unless `mcpScope` says otherwise. */
  apiScope: string;
  /** An MCP scope of its own (plan 1J: mcp:invoices for a draft fakturaunderlag), off until chosen on the key or the app. */
  mcpScope?: string;
  input: z.ZodObject;
};

const define = <T extends Record<string, Definition>>(tools: T) => tools;

export const TOOL_CATALOG = define({
  // ---------- read ----------
  search: { title: "Sök i Workflow", effect: "read", apiScope: "tasks:read",
    description: "Sök brett bland projekt, uppgifter, protokoll och kunder som användaren får se. Börja här och hämta sedan detaljer med get_task, get_project eller get_customer.",
    input: z.object({ query: z.string().trim().min(2).max(100) }) },
  list_my_work: { title: "Mina uppgifter", effect: "read", apiScope: "tasks:read",
    description: "Lista användarens egna uppgifter och protokoll, sidvis. filter: open, active, planned, action, done eller all.",
    input: z.object({ filter: z.enum(["open", "active", "planned", "action", "done", "all"]).optional(), query: text(100).optional(), page }) },
  list_projects: { title: "Lista projekt", effect: "read", apiScope: "projects:read",
    description: "Lista projekt sidvis efter läge (ongoing, closed, archived), med valfri sökning på namn, beskrivning eller kund.",
    input: z.object({ state: z.enum(["ongoing", "closed", "archived"]).optional(), query: text(100).optional(), page }) },
  get_project: { title: "Hämta projekt", effect: "read", apiScope: "projects:read",
    description: "Hämta ett projekt med ram, status, kund och dess uppgifter.",
    input: z.object({ projectId: id }) },
  get_task: { title: "Hämta uppgift", effect: "read", apiScope: "tasks:read",
    description: "Hämta en uppgift eller ett protokoll med innehåll, status, tid och bilagor (namn), och jobbets läge (job): riskbedömningssteget, vad som spärrar Starta tid och Färdigställ och varför, nästa steg, kommande bokningar, Utgår och tidplan. En arbetsorder visar också de avvikelseposter den åtgärdar (linkedDeviations) för den som får läsa avvikelseloggen. Materialens inköpspris och påslag följer bara med för en nyckel som även får läsa offerter, och för en person med prisrätt.",
    input: z.object({ taskId: id }) },
  list_customers: { title: "Lista kunder", effect: "read", apiScope: "customers:read",
    description: "Sök kunder på namn, företag, e-post eller ort. Returnerar kunder med deras platser (anläggning, byggnad/avdelning, utrymme, objekt) och hela vägen till varje plats.",
    input: z.object({ query: text(100).optional(), limit: z.number().int().min(1).max(100).optional() }) },
  get_customer: { title: "Hämta kund", effect: "read", apiScope: "customers:read",
    description: "Hämta en kund med platser och kopplat arbete (sidvis).",
    input: z.object({ customerId: id, page }) },
  list_planned_activities: { title: "Lista planering", effect: "read", apiScope: "planning:read",
    description: "Lista planerade aktiviteter, valfritt inom ett datumintervall (ÅÅÅÅ-MM-DD) och för ett projekt.",
    input: z.object({ from: day.optional(), to: day.optional(), projectId: id.optional() }) },
  list_time_entries: { title: "Min rapporterade tid", effect: "read", apiScope: "time:read",
    description: "Lista användarens egna tidposter, valfritt inom ett datumintervall (ÅÅÅÅ-MM-DD); utan startdatum de senaste 90 dagarna. Svaret har också företagets aktiva tidstyper (timeTypes) att välja i report_time.",
    input: z.object({ from: day.optional(), to: day.optional() }) },
  list_notifications: { title: "Notiser", effect: "read", apiScope: "tasks:read",
    description: "Aktuella påminnelser: förfallna och snart förfallande uppgifter, ronder och arbetsordrar att följa upp.",
    input: z.object({}) },
  get_self_inspection_program: { title: "Egenkontrollprogram", effect: "read", apiScope: "tasks:read",
    description: "Hämta företagets gällande, fastställda egenkontrollprogram: version, verksamhetstyper, avsnitt och roller med nivå (1–3) och personer, samt läge för årlig översyn. Utkast, fastställande och kvittenser finns bara i Workflow.",
    input: z.object({}) },
  list_task_types: { title: "Uppgiftstyper", effect: "read", apiScope: "tasks:read",
    description: "Lista de uppgiftstyper och publicerade formulär som företaget kan skapa, med den nivå (1–3) varje typ kräver (fältet riskClass). Ingen får tilldelas, starta, fylla i, slutföra eller signera en uppgift som kräver högre nivå än personens egen; servern spärrar det.",
    input: z.object({}) },
  // Lagöversikt (2026-10-09, AI-beslut 3): the team's open work as the person may read it in Workflow's lists
  // (Alla); the company admin can switch it off under Workflow AI → Vad Workflow AI får göra.
  list_team_work: { title: "Lagöversikt", effect: "read", apiScope: "tasks:read",
    description: "Lista lagets öppna jobb som användaren får läsa (samma behörighet som listan Alla i Workflow), med ansvarig, projekt, klart-datum och vad som stoppar. filter: late (förfallna), due_soon (klart inom 7 dagar), action (behöver åtgärdas), waiting (pausade arbetsordrar som väntar på material, kund eller avställning) eller open (alla öppna, förval). Högst 48 jobb, de mest brådskande först.",
    input: z.object({ filter: z.enum(["open", "late", "due_soon", "action", "waiting"]).optional(), query: text(100).optional() }) },

  // ---------- create ----------
  create_work_order: { title: "Skapa arbetsorder", effect: "create", apiScope: "tasks:write",
    description: "Skapa en arbetsorder, valfritt i ett projekt och för en kund. Den skapas som planerad; slutförande och signering görs av en person i Workflow.",
    input: z.object({ title: z.string().trim().min(1).max(200), description: text(5000).optional(), projectId: id.optional(), customerId: id.optional(), facilityId: id.optional(),
      dueDate: day.optional(), assignedToUserId: id.optional(), executionNotes: text(10_000).optional(),
      plannedStartDate: day.optional().describe("Start. Utelämnad = i dag (inom projektets tidsram och aldrig efter klart senast)."), stage: text(60).optional().describe("Etapp, en valfri etikett som grupperar projektets jobb."),
      /** The task the work order follows up; it must be one the user may read, and the work order links back to it. */
      sourceTaskId: id.optional(), waitingOn }) },
  create_place: { title: "Skapa plats", effect: "create", apiScope: "customers:write",
    description: "Lägg till en plats hos en kund: en anläggning (översta nivån, med adress) eller under en annan plats (parentId) som byggnad/avdelning, utrymme, objekt eller annat.",
    input: z.object({ customerId: id, name: z.string().trim().min(1).max(160), kind: z.enum(["FACILITY", "BUILDING", "SPACE", "OBJECT", "OTHER"]).optional(), parentId: id.optional(),
      address: text(200).optional(), postalCode: text(20).optional(), city: text(120).optional(), description: text(2000).optional(),
      latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(), ...placeObject }) },
  create_project: { title: "Skapa projekt", effect: "create", apiScope: "projects:write",
    description: "Skapa ett projekt med start- och slutdatum (krävs), valfritt för en kund.",
    input: z.object({ name: z.string().trim().min(1).max(160), startDate: day, dueDate: day, description: text(2000).optional(), customerId: id.optional(),
      workSite: text(300).optional(), reference: text(120).optional(), responsibleUserId: id.optional() }) },
  create_customer: { title: "Skapa kund", effect: "create", apiScope: "customers:write",
    description: "Lägg till en kund i kundregistret, valfritt med kundtyp och Kundnummer i bokföringen (accountingCustomerNumber).",
    input: z.object({ name: z.string().trim().min(1).max(200), company: text(200).optional(), email: text(254).optional(), phone: text(200).optional(), mobile: text(200).optional(),
      address: text(200).optional(), postalCode: text(200).optional(), city: text(200).optional(), notes: text(5000).optional(), customerType: customerType.optional(),
      accountingCustomerNumber: text(60).optional().describe("Kundnummer i bokföringen.") }) },
  create_planned_activity: { title: "Planera aktivitet", effect: "create", apiScope: "planning:write",
    description: "Planera en aktivitet med start och slut (ISO-tid), valfritt i ett projekt eller på en arbetsorder (taskId; en uppgift planeras på sin arbetsorder) och en ansvarig. Planering är inte rapporterad tid.",
    input: z.object({ title: z.string().trim().min(1).max(200), startsAt: z.iso.datetime(), endsAt: z.iso.datetime(), description: text(2000).optional(),
      kind: z.enum(["TASK", "MEETING", "DEADLINE"]).optional().describe("TASK arbete, MEETING möte, DEADLINE milstolpe."), projectId: id.optional(), taskId: id.optional(), assignedToUserId: id.optional() }) },
  add_project_decision: { title: "Lägg till beslut", effect: "create", apiScope: "projects:write",
    description: "Lägg till ett beslut i projektets beslutslogg (datum, text och vem som beslutade).",
    input: z.object({ projectId: id, decidedOn: day, text: z.string().trim().min(1).max(2000), decidedBy: z.string().trim().min(1).max(160) }) },
  // Arbetsordern styr (2026-10-26): time is on a work order or a project, never on a task of its own.
  report_time: { title: "Rapportera tid", effect: "create", apiScope: "time:write",
    description: "Rapportera användarens egen tid (start och slut som ISO-tid) på en arbetsorder (workOrderId, eller taskId – en uppgifts tid räknas på dess arbetsorder) eller på ett projekt utan arbetsorder (projectId, till exempel projektledning och möten). Ange exakt ett av dem. Tidstyp (timeTypeId) är valfri: en aktiv tidstyp i företaget (se list_time_entries); utan den företagets standardtyp. Svaret säger var tiden landade (owner).",
    input: z.object({ workOrderId: id.optional(), taskId: id.optional(), projectId: id.optional(), startedAt: z.iso.datetime(), endedAt: z.iso.datetime(), note: text(1000).optional(), timeTypeId: id.optional() })
      .refine((value) => [value.workOrderId, value.taskId, value.projectId].filter(Boolean).length === 1, { message: "Ange arbetsorder (workOrderId eller taskId) eller projekt (projectId), exakt ett av dem.", path: ["workOrderId"] }) },
  // Materialrader (AI-beslut 1, 2026-10-09): rows added to a work order's Material; prices come from the work order's
  // own rules (an article picked in Workflow), never from the caller.
  add_material_rows: { title: "Lägg till materialrader", effect: "create", apiScope: "tasks:write",
    description: "Lägg till materialrader (benämning, antal, enhet) sist i en arbetsorders material. Befintliga rader ändras inte. Slutförda arbetsordrar ändras inte. Pris sätts i Workflow, inte här.",
    input: z.object({ taskId: id, rows: z.array(z.object({ name: z.string().trim().min(1).max(200), quantity: z.string().trim().max(40).default(""), unit: z.string().trim().max(40).default("") })).min(1).max(50) }) },

  // ---------- update ----------
  update_task: { title: "Ändra uppgift", effect: "update", apiScope: "tasks:write",
    description: "Ändra rubrik, beskrivning, status (Planerad eller Behöver åtgärdas; Pågår och Pausad följer tidtagningen och ändras inte här), klart senast, start (plannedStartDate, före eller samma dag som klart senast och inom projektets tidsram), uppskattad tid i minuter (estimatedMinutes), etapp (stage, högst 60 tecken, tom tar bort), ansvarig, vilken arbetsorder en uppgift ligger i (workOrderId: kopplar ett utkast eller flyttar uppgiften till en annan öppen arbetsorder och ger den arbetsorderns kund och projekt; en kopplad uppgift kan inte släppas fri, och arbetet i en uppgift börjar först när den har en arbetsorder) eller en arbetsorders utförda arbete och underhållsuppgifter (typ, prioritet, fel, orsak, tider, vad en pausad order väntar på). Slutförda uppgifter ändras inte.",
    input: z.object({ taskId: id, title: z.string().trim().min(1).max(200).optional(), description: text(5000).optional(),
      status: z.enum(["PLANNED", "IN_PROGRESS", "PAUSED", "NEEDS_ACTION"]).optional(), dueDate: z.union([z.literal(""), day]).optional(),
      // Tidplan (steg 2): Start ("" = utan datum) and Uppskattad tid in minutes (null = none); the route checks the rules.
      plannedStartDate: z.union([z.literal(""), day]).optional(), estimatedMinutes: z.number().int().min(0).max(600_000).nullable().optional(), stage: text(60).optional(),
      assignedToUserId: id.nullable().optional(), workOrderId: id.optional(), executionNotes: text(10_000).optional(), waitingOn }) },
  // Utgår och Återuppta (2026-10-09): the same action, rules and permission (redigera jobbet) as the buttons in
  // Workflow; the job is kept read-only with its history, and running time on it stops.
  cancel_task: { title: "Sätt jobb till Utgår", effect: "update", apiScope: "tasks:write",
    description: "Sätt ett jobb (arbetsorder, protokoll eller riskbedömning) som inte ska göras till Utgår, med en kort orsak (krävs, 3–500 tecken). Jobbet tas inte bort: det blir skrivskyddat med sin historik, räknas inte längre som öppet, förfallet eller kvar, och pågående tid på det stoppas. Ett färdigställt jobb kan inte utgå. Återställs med restore_task.",
    input: z.object({ taskId: id, reason: cancelReasonSchema }) },
  // Rapportera hinder (plan 1M, 2026-10-11): the buttons' action and permission; the job's and the project's responsible people are told.
  report_obstacle: { title: "Rapportera hinder", effect: "update", apiScope: "tasks:write",
    description: "Rapportera att ett jobb (arbetsorder, uppgift, protokoll eller riskbedömning) hindras: reason är MATERIAL (väntar på material), CUSTOMER (väntar på kund), SHUTDOWN (väntar på avställning) eller OTHER (annat, text krävs), text är några ord (högst 300 tecken). Jobbet markeras i listor och i Tidplanen, och jobbets och projektets ansvariga får en notis. Ett färdigställt eller utgånget jobb kan inte få hinder. Löses med resolve_obstacle.",
    input: z.object({ taskId: id, reason: z.enum(["MATERIAL", "CUSTOMER", "SHUTDOWN", "OTHER"]), text: text(300).optional() }) },
  resolve_obstacle: { title: "Lös hinder", effect: "update", apiScope: "tasks:write",
    description: "Lös ett rapporterat hinder: markeringen tas bort och jobbet får tillbaka sin status (Pågår blir Pausad, eftersom tiden avgör Pågår).",
    input: z.object({ taskId: id }) },
  restore_task: { title: "Återuppta jobb", effect: "update", apiScope: "tasks:write",
    description: "Återuppta ett jobb som har utgått. Det får sin tidigare status (Pågår blir Pausad, eftersom tiden stoppades).",
    input: z.object({ taskId: id }) },
  update_place: { title: "Ändra plats", effect: "update", apiScope: "customers:write",
    description: "Ändra en plats hos en kund: namn, beskrivning och objektdata (objekttyp, driftstatus, tillverkare, modell, serienummer, installationsdatum och fria tekniska värden). Fält som utelämnas behålls; attributes ersätter hela listan.",
    input: z.object({ placeId: id, name: z.string().trim().min(1).max(160).optional(), description: text(2000).optional(),
      ...placeObject }) },
  update_project: { title: "Ändra projekt", effect: "update", apiScope: "projects:write",
    description: "Ändra ett projekts namn, beskrivning, datum, arbetsplats, referens eller ansvarig.",
    input: z.object({ projectId: id, name: z.string().trim().min(1).max(160).optional(), description: text(2000).optional(), startDate: day.optional(), dueDate: day.optional(),
      workSite: text(300).optional(), reference: text(120).optional(), responsibleUserId: id.nullable().optional() }) },
  update_customer: { title: "Ändra kund", effect: "update", apiScope: "customers:write",
    description: "Ändra en kunds kontaktuppgifter, kundtyp eller Kundnummer i bokföringen (accountingCustomerNumber). Fält som utelämnas behålls.",
    input: z.object({ customerId: id, name: z.string().trim().min(1).max(200).optional(), company: text(200).optional(), email: text(254).optional(), phone: text(200).optional(),
      mobile: text(200).optional(), address: text(200).optional(), postalCode: text(200).optional(), city: text(200).optional(), notes: text(5000).optional(), customerType: customerType.optional(),
      accountingCustomerNumber: text(60).optional().describe("Kundnummer i bokföringen; \"\" tar bort.") }) },

  // ---------- remove (reversible; permanent deletion is not offered) ----------
  archive_project: { title: "Arkivera projekt", effect: "delete", apiScope: "delete",
    description: "Arkivera ett projekt. Det går att återställa i Workflow.",
    input: z.object({ projectId: id }) },
  delete_planned_activity: { title: "Ta bort planering", effect: "delete", apiScope: "delete",
    description: "Ta bort en planerad aktivitet. Historiken sparas.",
    input: z.object({ activityId: id }) },

  // ---------- Artiklar och priser (read, 2026-10-08) ----------
  // The company's own catalogue (Cloud only), with the catalogue's read right; bounded answers, prices excl. VAT. Since 2026-10-17 a
  // price on a wholesaler's catalogue article (the shared register) is one of the company's prices too, read the same way.
  search_articles: { title: "Sök artiklar och priser", effect: "read", apiScope: "catalogue:read",
    description: "Sök i företagets egna artiklar och priser (från företagets prisfiler, även priserna på grossistens katalogartiklar) på benämning, artikelnummer eller E-nummer, valfritt hos en leverantör (id eller del av namnet). Ger högst 20 artiklar som företaget har pris på, med artikelnummer, E-nummer, benämning, enhet, senaste à-pris exkl. moms, prisdatum, senast bekräftat datum och leverantör. Finns bara med serverlagring.",
    input: z.object({ query: z.string().trim().min(2).max(100), supplier: text(120).optional(), limit: z.number().int().min(1).max(20).optional() }) },
  get_article_price_history: { title: "Prishistorik för artikel", effect: "read", apiScope: "catalogue:read",
    description: "Hämta en artikels prishistorik ur företagets artiklar och priser: de senaste prisraderna (högst 50, nyast först) med à-pris exkl. moms, pris per antal, prisdatum, senast bekräftat datum och källfil. articleId kommer från search_articles (id på artikeln eller på leverantörens erbjudande).",
    input: z.object({ articleId: id, limit: z.number().int().min(1).max(50).optional() }) },

  // ---------- Offerter (read, 2026-10-09) ----------
  // The company's quotes (Cloud only), with the right Offerter – läsa and its own key scope; not offered to Workflow AI.
  list_quotes: { title: "Lista offerter", effect: "read", apiScope: "quotes:read",
    description: "Lista företagets offerter, senaste versionen av varje, 20 per sida, senast ändrad först. status: open (utkast och giltiga skickade, förval), all, DRAFT, SENT, ACCEPTED, DECLINED eller EXPIRED. query söker i rubrik, nummer (O-12), kund och projekt. Belopp exkl. moms.",
    input: z.object({ query: text(100).optional(), status: z.enum(["open", "all", "DRAFT", "SENT", "ACCEPTED", "DECLINED", "EXPIRED"]).optional(), page }) },
  get_quote: { title: "Hämta offert", effect: "read", apiScope: "quotes:read",
    description: "Hämta en offert med rader (typ, benämning, antal, enhet, à-pris, påslag), summa exkl. moms, moms 25 % och summa inkl. moms, status, giltig till, kund, plats, projekt och versioner. quoteId kommer från list_quotes.",
    input: z.object({ quoteId: id }) },

  // ---------- Fakturaunderlag (plan 1J, 2026-10-11: läsa och skapa utkast) ----------
  // The invoice-bases route's own checks (Cloud, Offerter – läsa/redigera and the right to read the job or project).
  // Answers carry selling prices and amounts only (lib/tools/invoice-basis-view.ts). Marking as invoiced, Fortnox, changing
  // lines and deleting are done by a person in Workflow and are not tools. Not offered to Workflow AI.
  list_invoice_bases: { title: "Lista fakturaunderlag", effect: "read", apiScope: "quotes:read",
    description: "Lista fakturaunderlagen för ett färdigställt jobb (taskId) eller ett projekt (projectId): nummer (F-0001), rubrik, status (DRAFT utkast, INVOICED fakturerat), summa exkl. moms, samt hur mycket ett nytt underlag skulle ta med nu (available) eller varför inget kan göras (newReason). Försäljningspriser, aldrig inköpspris eller påslag. Finns bara med serverlagring.",
    input: z.object({ taskId: id.optional(), projectId: id.optional() }) },
  get_invoice_basis: { title: "Hämta fakturaunderlag", effect: "read", apiScope: "quotes:read",
    description: "Hämta ett fakturaunderlag med rader (typ, benämning, antal, enhet, pris per enhet exkl. moms, belopp), summa per slag, summa exkl. moms, moms och summa inkl. moms, status, jobb eller projekt och kund. basisId kommer från list_invoice_bases.",
    input: z.object({ basisId: id }) },
  propose_invoice_basis: { title: "Föreslå fakturaunderlag", effect: "read", apiScope: "quotes:read",
    description: "Visa vad ett nytt fakturaunderlag för ett färdigställt jobb (taskId) eller ett projekt (projectId) skulle ta med nu: avslutad tid som arbete, material och utgifter som inte redan finns i ett underlag, med priser som i Workflow. Inget sparas och inget tas. Kräver Offerter – redigera. Svaret har proposal, nyckeln som create_invoice_basis skickar tillbaka.",
    input: z.object({ taskId: id.optional(), projectId: id.optional() }) },
  create_invoice_basis: { title: "Skapa utkast till fakturaunderlag", effect: "create", apiScope: "invoices:write", mcpScope: "mcp:invoices",
    description: "Spara förslaget från propose_invoice_basis som ett utkast till fakturaunderlag för jobbet (taskId) eller projektet (projectId) och ta med dess tid, material och utgifter, så att de aldrig faktureras två gånger. Samma kontroller som i Workflow: 409 om det som kan faktureras har ändrats sedan förslaget (hämta ett nytt) eller om någon annan just tog samma källor. Rubrik och anteckning kan anges; raderna är förslagets. Markera som fakturerat, Fortnox, ändra rader och ta bort görs av en person i Workflow.",
    input: z.object({ taskId: id.optional(), projectId: id.optional(), proposal: z.string().trim().min(1).max(100).describe("Nyckeln från propose_invoice_basis."), title: text(200).optional(), note: text(2000).optional() }) },
});

export type ToolName = keyof typeof TOOL_CATALOG;
export const TOOL_NAMES = Object.keys(TOOL_CATALOG) as ToolName[];
export const MCP_SCOPE_OF: Record<ToolEffect, string> = { read: "mcp:read", create: "mcp:write", update: "mcp:write", delete: "mcp:delete" };

/** The scope a key of the kind needs for the tool. */
export const toolScope = (kind: "API" | "MCP", name: ToolName) => { const tool: Definition = TOOL_CATALOG[name]; return kind === "MCP" ? tool.mcpScope ?? MCP_SCOPE_OF[tool.effect] : tool.apiScope; };

/** Whether a key with these scopes may run the tool. */
export function keyMayRun(kind: "API" | "MCP", scopes: string[], name: ToolName) {
  return scopes.includes(toolScope(kind, name));
}

/** The JSON Schema of a tool's input, for MCP tools/list and the API description. */
export function toolInputSchema(name: ToolName) {
  const schema = z.toJSONSchema(TOOL_CATALOG[name].input, { io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  return addFieldHelp(name, schema);
}

/** The description shown to API and MCP clients; a tool that creates something says it is not idempotent (API-13). */
export const toolDescription = (name: ToolName) => { const tool: Definition = TOOL_CATALOG[name]; return tool.effect === "create" ? `${tool.description} Inte idempotent: samma anrop två gånger skapar två poster, så sök först.` : tool.description; };

/** The names of a tool's own input fields (top level). */
export const toolFieldNames = (name: ToolName) => Object.keys(TOOL_CATALOG[name].input.shape);

export const isToolName = (value: string): value is ToolName => Object.prototype.hasOwnProperty.call(TOOL_CATALOG, value);
