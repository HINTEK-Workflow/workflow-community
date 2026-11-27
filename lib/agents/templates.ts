import type { FeedbackChannel, MissionDraft, MissionSchedule, MissionScope, MissionTarget, TargetKind } from "./model";
import type { SourceKey } from "./tool-policy";

/**
 * De tio mallarna (2026-11-21, the analysis' section 5 with his answers) and "Med egna ord". "rules": Workflow counts and
 * lists without an AI model – free, never stopped by the week's quota. "ai": the model writes a text, which uses credits (Azure's
 * cost and the markup) or, in Community, the company's own key. Every template can be changed before it is saved.
 *
 * Med egna ord först (2026-11-23): a new mission starts with the owner's own words; the templates are "Exempel att börja från".
 * A mission made from a template is fully editable – what it does, what it reads, the period, when, who gets it and what it makes.
 * As long as the template's own part is untouched, the template's rules run it (free); when the owner changes what it does or reads
 * (ownWordsFrom), it becomes a Med egna ord mission that starts from the template's text and basis.
 */
export const TEMPLATE_KEYS = [
  "weekly_work_orders", "round_month", "my_week_time", "weekly_news_draft", "weekly_planning_news",
  "expiring_calibrations", "open_deviations", "pending_invoicing", "quotes_waiting", "next_week_capacity",
  // När något händer (2026-11-21): two that start on an event.
  "deviation_to_work_order", "alarm_notice", "custom",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];
export const isTemplateKey = (value: unknown): value is TemplateKey => (TEMPLATE_KEYS as readonly unknown[]).includes(value);

/** A right the owner must have: a subject and an action of lib/workflow/permissions.ts. */
export type NeededRight = `${string}:${string}`;

export type AgentTemplate = {
  key: TemplateKey;
  name: string;
  /** What the template reads, as Med egna ord's sources: the starting basis when the owner makes it their own. */
  sources: readonly SourceKey[];
  /** One sentence: what the agent does. */
  does: string;
  /** What it reads (Underlag), in the words of the menu. */
  basis: string;
  /** What it never does. */
  never: string;
  /** rules: no model; ai: the model always writes the text. */
  writes: "rules" | "ai";
  targets: readonly TargetKind[];
  defaults: { schedule: MissionSchedule; target: MissionTarget; feedback: FeedbackChannel[]; scope?: Partial<MissionScope> };
  needs: { modules: readonly string[]; admin?: boolean; rights?: readonly NeededRight[]; round?: boolean };
};

const report = (): MissionTarget => ({ kind: "report", publish: "draft", channels: [] });

export const AGENT_TEMPLATES: readonly AgentTemplate[] = [
  {
    key: "weekly_work_orders", name: "Veckans arbetsorder", sources: ["work_orders", "planning"],
    does: "Sammanställer veckans planerade och förfallna arbetsordrar och lyfter fram dem som saknar ansvarig.",
    basis: "Arbetsordrar och planering som du får se.", never: "Sätter aldrig ansvarig och ändrar aldrig datum.",
    writes: "rules", targets: ["report"],
    defaults: { schedule: { kind: "weekly", weekdays: [1], time: "07:00" }, target: report(), feedback: ["EMAIL"] },
    needs: { modules: [], rights: ["work-order:read"] },
  },
  {
    key: "round_month", name: "Dags för driftrond", sources: ["work_orders"],
    does: "Kontrollerar att ronden har en arbetsorder för månaden. Saknas den skapar agenten en, som Planerad och utan ansvarig. Finns den kommer bara en notis.",
    basis: "Den valda ronden och dess arbetsordrar.", never: "Startar aldrig ronden, fyller aldrig i protokoll, svarar aldrig på säkerhetsfrågorna och sätter aldrig ansvarig.",
    writes: "rules", targets: ["work_order"],
    defaults: { schedule: { kind: "monthly_first_weekday", time: "06:30" }, target: { kind: "work_order", publish: "draft", channels: [] }, feedback: ["NOTICE"] },
    needs: { modules: ["rounds"], rights: ["work-order:create"], round: true },
  },
  {
    key: "my_week_time", name: "Min veckotid", sources: ["time"],
    does: "Summerar din registrerade tid i veckan, med totalen först och sedan per projekt och arbetsorder.",
    basis: "Bara din egen tid.", never: "Rapporterar, ändrar eller skickar aldrig in tid. Månaden skickar du in själv.",
    writes: "rules", targets: ["report"],
    defaults: { schedule: { kind: "weekly", weekdays: [5], time: "14:00" }, target: report(), feedback: ["CHAT"] },
    needs: { modules: ["time"] },
  },
  {
    key: "weekly_news_draft", name: "Utkast till veckonyhet", sources: ["work_orders"],
    does: "Skriver ett förslag till veckonyhet om arbeten som blev klara i veckan, utan kundnamn, adresser eller personer.",
    basis: "Färdigställda arbetsordrar i de valda projekten: rubrik och typ av arbete, med namn som platshållare.",
    never: "Nämner aldrig kunder, adresser eller personer och hittar aldrig på siffror.",
    writes: "ai", targets: ["post"],
    defaults: { schedule: { kind: "weekly", weekdays: [4], time: "13:00" }, target: { kind: "post", publish: "draft", channels: ["facebook"] }, feedback: ["NOTICE"] },
    needs: { modules: ["web_posts"], admin: true, rights: ["work-order:read"] },
  },
  {
    key: "weekly_planning_news", name: "Publicera veckans planering", sources: ["planning"],
    does: "Skriver en kort intern nyhet om veckans planering: antal bokningar, arbetsordrar utan bokning och vilka som är borta.",
    basis: "Planering och godkänd frånvaro (aldrig orsaken).", never: "Bokar, flyttar eller tar aldrig bort bokningar och skriver aldrig varför någon är borta.",
    writes: "rules", targets: ["news", "report"],
    defaults: { schedule: { kind: "weekly", weekdays: [1], time: "07:00" }, target: { kind: "news", publish: "auto", channels: [] }, feedback: ["CHAT"] },
    needs: { modules: ["planning"], admin: true },
  },
  {
    key: "expiring_calibrations", name: "Kalibreringar och behörigheter som går ut", sources: ["credentials"],
    does: "Listar mätinstrument vars kalibrering och personers intyg som går ut inom 60 dagar.",
    basis: "Instrumentregistret och egenkontrollens intyg.", never: "Ändrar aldrig datum, markerar aldrig som kalibrerat och bedömer aldrig om ett instrument får användas.",
    writes: "rules", targets: ["report"],
    defaults: { schedule: { kind: "monthly_first", weekday: 1, time: "07:00" }, target: report(), feedback: ["EMAIL"] },
    needs: { modules: [], admin: true },
  },
  {
    key: "open_deviations", name: "Avvikelser utan åtgärd", sources: ["deviations"],
    does: "Listar öppna avvikelser som saknar åtgärd, saknar klart-datum eller har ett datum som har passerat.",
    basis: "Avvikelseloggen, så som du får se den.", never: "Stänger aldrig en avvikelse, skriver aldrig orsak eller åtgärd och bedömer aldrig hur allvarlig den är.",
    writes: "rules", targets: ["report"],
    defaults: { schedule: { kind: "weekly", weekdays: [1], time: "08:00" }, target: report(), feedback: ["NOTICE", "EMAIL"] },
    needs: { modules: [] },
  },
  {
    key: "pending_invoicing", name: "Fakturaunderlag som väntar", sources: ["work_orders", "invoices"],
    does: "Hittar färdigställda arbetsordrar med tid, material eller utgifter som inte finns i något fakturaunderlag.",
    basis: "Arbetsordrar som blivit klara de senaste 60 dagarna, med samma beräkning som Föreslå fakturaunderlag.",
    never: "Markerar aldrig något som fakturerat, skickar aldrig till bokföringen och ändrar aldrig rader.",
    writes: "rules", targets: ["report"],
    defaults: { schedule: { kind: "weekly", weekdays: [5], time: "12:00" }, target: report(), feedback: ["EMAIL"] },
    needs: { modules: ["invoicing"], rights: ["quotes:edit"] },
  },
  {
    key: "quotes_waiting", name: "Offerter som väntar på svar", sources: ["quotes"],
    does: "Listar skickade offerter utan svar som är äldre än 7 dagar eller går ut inom 7 dagar.",
    basis: "Offerter som du får se.", never: "Skickar aldrig något till kunden och ändrar aldrig status eller belopp.",
    writes: "rules", targets: ["report"],
    defaults: { schedule: { kind: "weekly", weekdays: [2], time: "08:00" }, target: report(), feedback: ["NOTICE"] },
    needs: { modules: ["quotes"], rights: ["quotes:read"] },
  },
  {
    key: "next_week_capacity", name: "Nästa veckas kapacitet", sources: ["planning", "work_orders"],
    does: "Visar nästa vecka per person: bokade timmar, godkänd frånvaro och arbetsordrar med klart-datum nästa vecka som saknar bokning.",
    basis: "Planering, frånvaro och arbetsordrar (Teamet – läsa).", never: "Bokar, flyttar eller ändrar aldrig frånvaro.",
    writes: "rules", targets: ["report"],
    defaults: { schedule: { kind: "weekly", weekdays: [4], time: "14:00" }, target: report(), feedback: ["CHAT"] },
    needs: { modules: ["planning"], rights: ["team:read"] },
  },
  {
    key: "deviation_to_work_order", name: "Ny avvikelse → arbetsorder", sources: ["deviations", "work_orders"],
    does: "När en avvikelse registreras och saknar arbetsorder skapar agenten en arbetsorder för att åtgärda den, som Planerad och utan ansvarig.",
    basis: "Den nya avvikelsen, så som du får se den.", never: "Stänger aldrig avvikelsen, skriver aldrig orsak eller åtgärd och bedömer aldrig hur allvarlig den är.",
    writes: "rules", targets: ["work_order"],
    defaults: { schedule: { kind: "event", event: "deviation_created", time: "07:00" }, target: { kind: "work_order", publish: "draft", channels: [] }, feedback: ["NOTICE"] },
    needs: { modules: [], rights: ["work-order:create"] },
  },
  {
    key: "alarm_notice", name: "Maskinlarm → notis med förklaring", sources: ["work_orders"],
    does: "När ett maskinlarm kommer skickar agenten en notis med larmet och en försiktig förklaring av vad det kan betyda.",
    basis: "Larmet och maskinens senaste händelser.", never: "Avgör aldrig om maskinen är säker att använda och kvitterar aldrig larmet.",
    writes: "ai", targets: ["report"],
    defaults: { schedule: { kind: "event", event: "machine_alarm", time: "07:00" }, target: { kind: "report", publish: "draft", channels: [] }, feedback: ["NOTICE"] },
    needs: { modules: ["upkeep"], rights: ["maintenance:read"] },
  },
  {
    key: "custom", name: "Med egna ord", sources: ["work_orders"],
    does: "Workflow hämtar och räknar det uppdraget gäller, och Workflow AI bedömer, rangordnar och skriver utifrån det – och gör de ändringar du beskriver, med dina behörigheter.",
    basis: "Det du beskriver (arbetsordrar, avvikelser, tid, offerter, planering, projekt eller kunder), så som du får se det.", never: "Signerar, färdigställer, skickar till kund eller tar aldrig bort något och fattar aldrig beslut om elsäkerhet.",
    writes: "ai", targets: ["report", "post", "news", "actions"],
    defaults: { schedule: { kind: "weekly", weekdays: [5], time: "14:00" }, target: report(), feedback: ["NOTICE"] },
    needs: { modules: [], rights: ["work-order:read"] },
  },
];

const BY_KEY = new Map(AGENT_TEMPLATES.map((template) => [template.key, template]));
export const agentTemplate = (key: string): AgentTemplate | null => BY_KEY.get(key as TemplateKey) ?? null;

/** The templates in the order the page offers them: Med egna ord first, then the examples. */
export const TEMPLATES_OWN_WORDS_FIRST: readonly AgentTemplate[] = [...AGENT_TEMPLATES.filter((item) => item.key === "custom"), ...AGENT_TEMPLATES.filter((item) => item.key !== "custom")];

/**
 * The mission as Med egna ord, starting from its template (2026-11-23): the template's text becomes the words when none are written,
 * its basis the sources, and what it makes stays when Med egna ord can make it. Schedule, feedback, recipients and projects stay.
 * A mission that is already Med egna ord comes back as it is.
 */
export function ownWordsFrom(draft: MissionDraft): MissionDraft {
  const template = agentTemplate(draft.templateKey);
  if (!template || template.key === "custom") return draft;
  const custom = agentTemplate("custom")!;
  const instruction = draft.instruction.trim() || `${template.does} ${template.never}`.slice(0, 1_000);
  // A planned work order becomes the change Skapa arbetsorder, which the owner sees and approves in Kontrollera.
  const kind = draft.target.kind === "work_order" ? "actions" : custom.targets.includes(draft.target.kind) ? draft.target.kind : "report";
  const tools = kind === "actions" ? [...new Set([...(draft.target.tools ?? []), ...(draft.target.kind === "work_order" ? ["create_work_order"] : [])])] : draft.target.tools;
  return {
    ...draft, templateKey: "custom", instruction,
    scope: { ...draft.scope, sources: draft.scope.sources?.length ? draft.scope.sources : [...template.sources], period: draft.scope.period ?? "week" },
    target: { ...draft.target, kind, ...(tools ? { tools } : {}) },
  };
}

/** Whether a mission keeps to its template's own part (what it makes); outside it, it must become Med egna ord. */
export const outsideTemplate = (draft: Pick<MissionDraft, "templateKey" | "target">) => { const template = agentTemplate(draft.templateKey); return Boolean(template && template.key !== "custom" && !template.targets.includes(draft.target.kind)); };

/** Whether a mission's run lets the model write (credits): the template's own rule. */
export const costClass = (templateKey: string): "rules" | "ai" => agentTemplate(templateKey)?.writes === "ai" ? "ai" : "rules";
