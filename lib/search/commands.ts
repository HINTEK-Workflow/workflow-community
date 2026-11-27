import { FORM_PERMISSION_AREAS, type WorkflowPermissionAction, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import type { SearchCandidate } from "./types";
import { MODULE_OF_COMMAND, moduleInList } from "@/lib/workflow/modules";

/**
 * Pages and actions Sök can open (2026-10-05): "Ny arbetsorder", "Tidrapport", the settings tabs. Only a way
 * there – each page still checks the person's rights on the server – but a page the person cannot use is not offered.
 */
export type SearchAccess = {
  admin: boolean;
  superadmin: boolean;
  local: boolean;
  canBuildForms: boolean;
  can: (subject: WorkflowPermissionSubject, action: WorkflowPermissionAction) => boolean;
  features: { credits: boolean; billing: boolean; ai: boolean; integrations: boolean; landingEditor: boolean; import: boolean };
  /** Företagets moduler (0.39.0): the modules that are on; a page of one that is off is not offered. Left out is everything on. */
  modules?: readonly string[] | null;
};
type Command = { id: string; label: string; href: string; keywords: string; shown: (access: SearchAccess) => boolean };

const readsTasks = (a: SearchAccess) => (["kfid", "work-order", "risk-assessment", "forms"] as const).some((subject) => a.can(subject, "read"));
const createsTasks = (a: SearchAccess) => (["kfid", "risk-assessment", "forms"] as const).some((subject) => a.can(subject, "create"));
// Driftronder are rounds of forms (lib/workflow/permissions.ts canReadRounds; planning one: canPlanRounds), not of work orders.
const readsRounds = (a: SearchAccess) => FORM_PERMISSION_AREAS.some((area) => a.can(area, "read"));
const plansRounds = (a: SearchAccess) => FORM_PERMISSION_AREAS.some((area) => a.can(area, "create"));

export const SEARCH_COMMANDS: readonly Command[] = [
  { id: "stats", label: "Översikt", href: "/?view=stats", keywords: "hem start nyckeltal statistik", shown: () => true },
  { id: "new_task", label: "Ny uppgift", href: "/?view=new_task", keywords: "skapa kontroll protokoll riskbedömning formulär", shown: createsTasks },
  { id: "new_work_order", label: "Ny arbetsorder", href: "/?view=workflow_task&taskType=WORK_ORDER", keywords: "skapa ao arbetsorder jobb", shown: (a) => a.can("work-order", "create") },
  { id: "new_risk", label: "Ny riskbedömning", href: "/?view=workflow_task&taskType=RISK_ASSESSMENT", keywords: "skapa risk riskanalys", shown: (a) => a.can("risk-assessment", "create") },
  { id: "new_project", label: "Nytt projekt", href: "/?view=new_project", keywords: "skapa projekt", shown: (a) => a.can("projects", "create") },
  { id: "tasks", label: "Uppgifter", href: "/?view=tasks", keywords: "uppgifter kontroller protokoll lista", shown: readsTasks },
  { id: "work_orders", label: "Arbetsordrar", href: "/?view=work_orders", keywords: "ao arbetsorder lista", shown: (a) => a.can("work-order", "read") },
  { id: "projects", label: "Projekt", href: "/?view=projects", keywords: "projekt lista", shown: (a) => a.can("projects", "read") },
  // Offerter (2026-10-09, steg B): Cloud only, with the right Offerter.
  { id: "new_purchase", label: "Nytt inköp", href: "/?view=purchase", keywords: "inköp beställning grossist varukorg material", shown: (a) => !a.local && (a.can("catalogue", "read") || a.can("work-order", "edit") || a.can("quotes", "edit")) },
  { id: "boards", label: "Tavlor", href: "/?view=boards", keywords: "tavla tavlor dashboard nyckeltal skärm skärmar infoskärm tv tabell diagram presentera", shown: (a) => !a.local && (a.can("boards", "read") || a.can("screens", "read")) },
  { id: "screens", label: "Skärmar", href: "/?view=boards&tab=screens", keywords: "skärm skärmar tv infoskärm koppla skärm kiosk spellista", shown: (a) => !a.local && a.can("screens", "read") },
  { id: "maintenance", label: "Underhåll", href: "/?view=maintenance", keywords: "underhåll anläggning plats platser maskin maskiner komponent del delar förråd förvaring hylla reservdel reservdelar saldo stillestånd felanmälan", shown: (a) => !a.local && a.can("maintenance", "read") },
  { id: "purchases", label: "Inköp", href: "/?view=purchases", keywords: "inköp beställningar grossist leverans", shown: (a) => !a.local && (a.can("catalogue", "read") || a.can("work-order", "edit") || a.can("quotes", "edit")) },
  { id: "articles", label: "Artiklar", href: "/?view=articles", keywords: "artiklar artikel sök pris lagersaldo e-nummer rsk ean", shown: (a) => !a.local && (a.can("catalogue", "read") || a.can("work-order", "edit") || a.can("quotes", "edit")) },
  { id: "new_quote", label: "Ny offert", href: "/?view=quote", keywords: "skapa offert anbud kalkyl pris", shown: (a) => !a.local && a.can("quotes", "edit") },
  { id: "quotes", label: "Offerter", href: "/?view=quotes", keywords: "offerter offert anbud lista priser", shown: (a) => !a.local && a.can("quotes", "read") },
  // Fakturaunderlag (2026-10-28): the company's list, the right of the invoice bases (Offerter – läsa).
  { id: "invoice_bases", label: "Fakturaunderlag", href: "/?view=invoice_bases", keywords: "fakturaunderlag faktura fakturera underlag ofakturerat", shown: (a) => !a.local && a.can("quotes", "read") },
  // Planering's views (2026-11-01): Kalender, Tidplan and Kapacitet, each found by its own name.
  { id: "project_planning", label: "Planering – Tidplan", href: "/?view=project_planning", keywords: "planering tidplan gantt etapper hinder projektplanering portfölj", shown: (a) => !a.local && a.can("projects", "read") },
  { id: "planning", label: "Planering – Kalender", href: "/?view=planning", keywords: "kalender planering schema bemanning bokningar aktiviteter", shown: (a) => a.can("projects", "read") || readsTasks(a) },
  { id: "capacity", label: "Planering – Kapacitet", href: "/?view=capacity", keywords: "kapacitet beläggning överbokad veckotimmar bokade timmar krock tidskrock frånvaro", shown: (a) => !a.local && (a.can("projects", "read") || readsTasks(a)) },
  { id: "new_round", label: "Ny driftrond", href: "/?view=rounds&new=1", keywords: "skapa rond ronder planera schema återkommande tillsyn", shown: (a) => readsRounds(a) && plansRounds(a) },
  { id: "rounds", label: "Driftronder", href: "/?view=rounds", keywords: "rond ronder schema återkommande", shown: readsRounds },
  { id: "time", label: "Tid", href: "/?view=time", keywords: "tidrapport tid timmar rapportera tidrapportering min tid", shown: readsTasks },
  // Tid's tabs (2026-11-01, beslut 13), by the same rights as the tab row (lib/workflow/time-tabs.ts).
  { id: "time_team", label: "Tid – Teamet", href: "/?view=time&tab=team", keywords: "godkänn tid godkänna månad påminn påminnelse inskickad teamets tid", shown: (a) => !a.local && (a.admin || a.can("team", "read")) },
  { id: "report_archive", label: "Rapportarkiv", href: "/?view=report_archive", keywords: "rapporter pdf excel sparade arkiv exporterade hämta", shown: (a) => !a.local && (readsTasks(a) || a.can("projects", "read")) },
  { id: "customers", label: "Kunder", href: "/?view=customers", keywords: "kundregister kunder kund register anläggningar platser", shown: (a) => a.can("customers", "read") },
  { id: "self_inspection", label: "Egenkontroll", href: "/?view=self_inspection", keywords: "egenkontrollprogram program elsäkerhet regelefterlevnad ere översyn roller kompetenskort utbildningar intyg nivå nivåer krävd nivå riskklass handledning", shown: () => true },
  { id: "self_inspection_levels", label: "Krävd nivå per uppgiftstyp", href: "/?view=self_inspection&tab=levels", keywords: "egenkontroll krävd nivå nivåer riskklass roller handledning spärr", shown: (a) => a.admin },
  // Avvikelser (2026-10-30): the company's deviation log, its own page; every active member reports.
  { id: "deviations", label: "Avvikelser", href: "/?view=deviations", keywords: "avvikelse avvikelser avvikelselogg tillbud olycksfall olycka riskobservation risk brist fel", shown: () => true },
  { id: "new_deviation", label: "Rapportera avvikelse", href: "/?view=deviations&new=1", keywords: "rapportera avvikelse tillbud olycksfall olycka riskobservation", shown: () => true },
  { id: "instruments", label: "Instrument", href: "/?view=instruments", keywords: "mätinstrument instrumentregister kalibrering kalibrerad serienummer installationstestare kvalitet", shown: () => true },
  { id: "notifications", label: "Notiser", href: "/?view=notifications", keywords: "påminnelser klocka", shown: () => true },
  { id: "calculators", label: "Kalkylator", href: "/?view=calculators", keywords: "kalkylator räkna effekt transformator kortslutning frånkoppling spänningsfall kabel gruppledning kompensering ström", shown: () => true },
  { id: "import", label: "Import", href: "/?view=import", keywords: "importera fil excel json", shown: (a) => a.features.import && !a.local },
  { id: "forms", label: "Skapa formulär", href: "/?view=forms", keywords: "formulärskaparen mall bygga verktyg", shown: (a) => a.canBuildForms },
  // Verktyg (2026-10-23): the hub of Rapportarkiv, Egenkontroll, Instrument, Kalkylator, Skapa formulär and Import.
  { id: "tools", label: "Mer", href: "/?view=tools", keywords: "verktyg register rapportarkiv egenkontroll instrument import formulär kalkylator", shown: () => true },
  { id: "settings", label: "Mina inställningar", href: "/?view=settings", keywords: "inställningar profil lösenord tema visningsnivå meny", shown: () => true },
  { id: "company", label: "Företag", href: "/?view=company", keywords: "inställningar företag företagsuppgifter avtal villkor logotyp logga rapport färger dokumentprofil organisationsnummer", shown: (a) => a.admin },
  // Användare and Operatörskonton: menu buttons of their own under Företaget (2026-10-31).
  { id: "administration", label: "Användare", href: "/?view=administration", keywords: "inställningar företag användare medarbetare behörighet rättigheter roller inbjudan säkerhet tvåstegsverifiering", shown: (a) => a.admin },
  { id: "operator_accounts", label: "Operatörskonton", href: "/?view=operator_accounts", keywords: "inställningar användare företag operatör operatörer operatörssidan felanmälan qr maskiner microsoft konton", shown: (a) => a.admin && !a.local },
  // The tabs under Inställningar, one page each since 2026-10-15 (lib/workflow/settings-tabs.ts); a part of a page is
  // reached with ?section=<part>, and every older address still lands on its part.
  { id: "quote_settings", label: "Priser och offert", href: "/?view=company_features&section=prices", keywords: "inställningar priser påslag timpris offert villkor giltighet rot", shown: (a) => a.admin && !a.local },
  { id: "company_features", label: "Arbetssätt", href: "/?view=company_features", keywords: "inställningar funktioner objektdata av på hintek ai", shown: (a) => a.admin },
  { id: "company_values", label: "Värden och referenser", href: "/?view=company_values", keywords: "inställningar arbetssätt gränsvärden gränsvärde gräns gränser gränsprofil gränsprofiler källa standard referens", shown: (a) => a.admin },
  // The company's pages are the admin's (2026-10-07); a member finds Workflow AI's status in the AI panel.
  { id: "credits", label: "Abonnemang", href: "/?view=company&section=billing", keywords: "inställningar ai krediter köp abonnemang cloud faktura", shown: (a) => a.admin && (a.features.credits || a.features.billing) && !a.local },
  { id: "upgrade", label: "Uppgradera till Cloud", href: "/?view=company&section=billing", keywords: "inställningar cloud uppgradera", shown: (a) => a.admin && (a.features.credits || a.features.billing) && a.local },
  { id: "ai_settings", label: "Workflow AI", href: "/?view=company_features&section=ai", keywords: "inställningar arbetssätt ai assistent", shown: (a) => a.admin && a.features.ai && !a.local },
  { id: "integrations", label: "Kopplingar", href: "/?view=advanced", keywords: "inställningar kopplingar nycklar api mcp integration externa chatgpt exportera läs in importera säkerhetskopia lösenordshanterare", shown: (a) => a.admin && !a.local && a.features.integrations },
  // Kopplingar's areas (2026-10-31): one page each (?section=<area>), so a search for bokföring lands on its page. Lön under Tid.
  { id: "connections_accounting", label: "Bokföring", href: "/?view=advanced&section=accounting", keywords: "kopplingar bokföring bokföringskonton konton verifikationsserie sie fortnox ekonomi", shown: (a) => a.admin && !a.local && a.features.integrations },
  { id: "connections_payroll", label: "Lön och export", href: "/?view=time&tab=payroll", keywords: "tid lön lönesystem löneunderlag löneexport export paxml frånvaro frånvarokod tidstyp tidkod anställningsnummer lönekod exportmall sftp kopplingar", shown: (a) => !a.local && (a.admin || a.can("team", "read")) },
  { id: "connections_machines", label: "Maskiner", href: "/?view=advanced&section=machines", keywords: "kopplingar maskiner larm styrsystem plc node-red källa maskinintag", shown: (a) => a.admin && !a.local && a.features.integrations },
  { id: "connections_api", label: "API och MCP", href: "/?view=advanced&section=api", keywords: "kopplingar api mcp nycklar chatgpt claude oauth egna system", shown: (a) => a.admin && !a.local && a.features.integrations },
  // Webb och inlägg (2026-11-20): Inlägg and Min webbsida are the tabs of a page under Mer (tabs of Inställningar 2026-11-10 to
  // 2026-11-20), for every company's admin in Cloud, while the module is on (MODULE_OF_COMMAND).
  { id: "web_posts", label: "Webb och inlägg", href: "/?view=company_posts", keywords: "mer verktyg webb inlägg webbsida sociala medier", shown: (a) => a.admin && !a.local },
  { id: "company_website", label: "Min webbsida", href: "/?view=company_website", keywords: "mer verktyg webb och inlägg webbsida webbplats hemsida wordpress sidor publicera applikationslösenord", shown: (a) => a.admin && !a.local },
  { id: "company_posts", label: "Inlägg", href: "/?view=company_posts", keywords: "mer verktyg webb och inlägg facebook instagram linkedin sociala medier dela publicera bild", shown: (a) => a.admin && !a.local },
  // Agenter (2026-11-21): every member's own missions and the built-in agents, where Workflow AI is.
  { id: "agents", label: "Agenter", href: "/?view=agents", keywords: "mer verktyg agent agenter uppdrag schema automatisk hintek ai mall veckorapport påminnelse inbyggda förslag tips", shown: (a) => a.features.ai && !a.local },
  { id: "company_videos", label: "Filmer", href: "/?view=company_videos", keywords: "mer verktyg webb och inlägg filmer film video youtube kanal ladda upp publicera", shown: (a) => a.admin && !a.local },
  // Nyheter (2026-11-21): every member reads them; Ny nyhet for the company's admin. Both stop with the module (MODULE_OF_COMMAND).
  { id: "news", label: "Nyheter", href: "/?view=news", keywords: "mer verktyg nyheter nyhet internt meddelande information företaget anslagstavla veckans planering", shown: (a) => !a.local },
  { id: "new_news", label: "Ny nyhet", href: "/?view=news&new=1", keywords: "skriv nyhet publicera nyhet meddelande till alla", shown: (a) => a.admin && !a.local },
  // Dokument (0.87.0): the customer register's right; it stops with Kunder (MODULE_OF_COMMAND).
  { id: "documents", label: "Dokument", href: "/?view=documents", keywords: "mer verktyg dokument filer fil ritning intyg avtal bilaga ladda upp ladda ner kund anläggning papperskorg", shown: (a) => !a.local && a.can("customers", "read") },
  { id: "history_retention", label: "Historik och lagring", href: "/?view=company&section=history", keywords: "inställningar företaget historik lagringstid radering", shown: (a) => a.admin && !a.local },
  { id: "administration_log", label: "Administrationshistorik", href: "/?view=administration&section=log", keywords: "användare logg händelser historik", shown: (a) => a.admin && !a.local },
  { id: "help", label: "Hjälp", href: "/?view=help", keywords: "hjälp kalkylator manual", shown: () => true },
  // Installation in five tabs (C6, 2026-10-21), one page each; the parts keep their own search words.
  { id: "product_overview", label: "Produktöversikt", href: "/?view=product_overview", keywords: "start betalningar misslyckade driftlarm nycklar nya företag", shown: (a) => a.superadmin },
  { id: "customer_companies", label: "Kundföretag", href: "/?view=customer_companies", keywords: "kundföretag produktadministration superadmin", shown: (a) => a.superadmin },
  { id: "pricing_admin", label: "Priser", href: "/?view=pricing_admin", keywords: "produktadministration priser ai-kostnad kampanjer planer rabattkoder", shown: (a) => a.superadmin && a.features.billing },
  // AI-kostnad is a part of Priser when the installation sells (settings-tabs: ai_admin → section ai); the search opens the part itself.
  { id: "ai_admin_part", label: "AI-kostnad", href: "/?view=pricing_admin&section=ai", keywords: "produktadministration priser ai valutakurs kostnad lägsta uttag användning", shown: (a) => a.superadmin && a.features.ai && a.features.billing },
  { id: "ai_admin", label: "AI-kostnad", href: "/?view=ai_admin", keywords: "produktadministration priser ai valutakurs kostnad lägsta uttag användning", shown: (a) => a.superadmin && a.features.ai && !a.features.billing },
  { id: "mailings", label: "Utskick", href: "/?view=mailings", keywords: "produktadministration webbplats och utskick nyhetsbrev veckobrev", shown: (a) => a.superadmin },
  { id: "mail_settings", label: "E-postserver (SMTP)", href: "/?view=server_keys&section=keys-email", keywords: "produktadministration tjänster och nycklar smtp e-post avsändare testmejl", shown: (a) => a.superadmin },
  { id: "login_settings", label: "Drift och säkerhet", href: "/?view=login_settings", keywords: "produktadministration inloggning google microsoft registrering nya konton tvåstegsverifiering automatiska mejl driftlarm webbpush push säkerhetslogg", shown: (a) => a.superadmin },
  { id: "server_keys", label: "Tjänster och nycklar", href: "/?view=server_keys", keywords: "produktadministration servernycklar tjänster nycklar stripe google microsoft openai azure solar smtp", shown: (a) => a.superadmin },
  { id: "plc_devices", label: "PLC-apparater", href: "/?view=plc_devices", keywords: "produktadministration plc simulator apparat symbol bild plint komponent", shown: (a) => a.superadmin },
  { id: "pdf_templates", label: "PDF-mallar", href: "/?view=pdf_templates", keywords: "produktadministration pdf dokument mall texter offert faktura protokoll rapport", shown: (a) => a.superadmin },
  { id: "landing_editor", label: "Landningssidan", href: "/?view=landing_editor", keywords: "produktadministration webbplats startsida", shown: (a) => a.superadmin && a.features.landingEditor },
  { id: "services", label: "Företagsuppslag, karta och adresser", href: "/?view=server_keys&section=scb", keywords: "produktadministration tjänster och nycklar scb företagsuppslag karta adress lantmäteriet", shown: (a) => a.superadmin },
  { id: "payments_test", label: "Test av betalningar", href: "/?view=server_keys&section=payments", keywords: "produktadministration tjänster och nycklar sandbox betalning stripe", shown: (a) => a.superadmin && a.features.billing },
  { id: "view_as", label: "Visa som", href: "/?view=login_settings&section=view-as", keywords: "produktadministration kundföretag förhandsgranska kund medarbetare ägare gratisföretag", shown: (a) => a.superadmin },
  { id: "sitemap", label: "Webbplatskarta", href: "/?view=login_settings&section=sitemap", keywords: "produktadministration drift och säkerhet avancerat karta sidor navigering menyer flikar vägar roller", shown: (a) => a.superadmin },
  { id: "servers", label: "Servrar och uppdateringar", href: "/?view=login_settings&section=servers", keywords: "produktadministration drift och säkerhet server serveruppdateringar patchar säkerhetsuppdateringar omstart kärna apt", shown: (a) => a.superadmin },
  { id: "server-jobs", label: "Serverjobb", href: "/?view=login_settings&section=jobs", keywords: "produktadministration drift och säkerhet schemalagda jobb cron pausa kör nu backup backuper säkerhetskopior", shown: (a) => a.superadmin },
];

/** The commands this person is offered, as candidates for the same ranking as everything else. */
export function commandCandidates(access: SearchAccess): SearchCandidate[] {
  const inCompany = (id: string) => !MODULE_OF_COMMAND[id] || moduleInList(access.modules, MODULE_OF_COMMAND[id]);
  return SEARCH_COMMANDS.filter((command) => command.shown(access) && inCompany(command.id)).map((command) => ({
    type: "command", id: command.id, title: command.label, subtitle: "", href: command.href,
    fields: [{ label: "Sida", text: command.label, weight: "title" }, { label: "Sida", text: command.keywords, weight: "meta" }],
  }));
}
