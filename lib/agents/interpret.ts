import { swedishParts } from "@/lib/swedish-time";
import { cleanRecipients, isConditionEvent, missionScheduleText, type AgentEventKey, type FeedbackChannel, type MissionDraft, type MissionSchedule, type PostChannel } from "./model";
import { reportTemplateFor } from "./report-template";
import { deniedActionsIn, needsJudgement, periodIn, sourcesIn, writeToolsIn } from "./tool-policy";
import { agentTemplate, ownWordsFrom, type TemplateKey } from "./templates";

/**
 * Tolka (2026-11-21): the owner's own words as a structured mission – what, underlag, when, what it makes and how the
 * owner is told. Workflow's own rules read the words first (free, no AI): the template, the days and the time, draft or publish, the
 * channels, the feedback and the projects or round named. What the words do not say becomes a question to the owner – never a
 * guess. The page fills in the template's defaults for those parts so the form is complete, but marks them as questions; the chat
 * asks them instead of creating anything. The AI model may read the words too (lib/agents/server.ts), and its reading passes the
 * same check.
 */
export type Interpretation = { draft: MissionDraft; questions: { field: string; question: string }[]; understood: string[];
  /** Tolka med Workflow AI: the write tools the model proposed from the meaning of the words (the owner approves them in Kontrollera). */
  proposedTools?: { name: string; title: string }[] };

const WORDS: [RegExp, TemplateKey][] = [
  [/driftrond|\brond(en)?\b/, "round_month"],
  [/veckotid|min tid|mina timmar|min registrerade tid/, "my_week_time"],
  [/kalibrer|intyg|behörighet(er)? som går ut/, "expiring_calibrations"],
  [/avvikelse/, "open_deviations"],
  [/fakturaunderlag|fakturer|att fakturera/, "pending_invoicing"],
  [/offert/, "quotes_waiting"],
  [/kapacitet|nästa veckas? (planering|bokningar|timmar)/, "next_week_capacity"],
  [/planering.*(nyhet|publicera|intern)|(nyhet|publicera).*planering/, "weekly_planning_news"],
  [/veckonyhet|inlägg|facebook|instagram|linkedin|sociala medier/, "weekly_news_draft"],
  [/arbetsord(er|rar).*(vecka|sammanst|saknar ansvarig|förfall)|(vecka|sammanst).*arbetsord(er|rar)/, "weekly_work_orders"],
];
const DAYS: [RegExp, number][] = [[/måndag/, 1], [/tisdag/, 2], [/onsdag/, 3], [/torsdag/, 4], [/fredag/, 5], [/lördag/, 6], [/söndag/, 7]];

const clockOf = (hourText: string, minuteText?: string) => {
  const hour = Number(hourText); const minute = Number(minuteText ?? 0);
  return hour > 23 || minute > 59 ? null : `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

// "klockan sju", "kl. fjorton" (2026-11-24): an hour written as a word after kl/klockan is read as its number.
const HOUR_WORDS = ["noll", "ett", "två", "tre", "fyra", "fem", "sex", "sju", "åtta", "nio", "tio", "elva", "tolv", "tretton", "fjorton", "femton", "sexton", "sjutton", "arton", "nitton", "tjugo", "tjugoett", "tjugotvå", "tjugotre"];
const HOUR_WORD = new RegExp(`(kl(?:\\.|ockan)?\\s*)(${[...HOUR_WORDS].sort((a, b) => b.length - a.length).join("|")})(?![\\p{L}])`, "giu");
export const hourWordsAsNumbers = (text: string) => text.replace(HOUR_WORD, (_, kl: string, word: string) => `${kl}${HOUR_WORDS.indexOf(word.toLocaleLowerCase("sv"))}`);

/** The time in the words ("kl. 7", "07:30", "klockan 14", "klockan sju"), as TT:MM, or null. */
export function timeInWords(textIn: string): string | null {
  const text = hourWordsAsNumbers(textIn);
  const match = /\b(?:kl(?:\.|ockan)?\s*)(\d{1,2})(?:[:.](\d{2}))?\b/.exec(text) ?? /\b(\d{1,2})[:.](\d{2})\b/.exec(text);
  return match ? clockOf(match[1]!, match[2]) : null;
}

/** Every time in the words ("kl 8 och 15", "kl. 7, 12 och 16", "08:00 och 15:30"), sorted, at most six (2026-11-23). */
export function timesInWords(textIn: string): string[] {
  const text = hourWordsAsNumbers(textIn);
  const found = new Set<string>();
  const run = /\bkl(?:\.|ockan)?\s*(\d{1,2}(?:[:.]\d{2})?(?:\s*(?:,|och|samt|&)\s*(?:kl(?:\.|ockan)?\s*)?\d{1,2}(?:[:.]\d{2})?\b)*)/g;
  for (const match of text.matchAll(run)) {
    for (const part of match[1]!.split(/\s*(?:,|och|samt|&)\s*(?:kl(?:\.|ockan)?\s*)?/)) {
      const piece = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(part.trim());
      const clock = piece ? clockOf(piece[1]!, piece[2]) : null;
      if (clock) found.add(clock);
    }
  }
  for (const match of text.matchAll(/\b(\d{1,2})[:.](\d{2})\b/g)) { const clock = clockOf(match[1]!, match[2]); if (clock) found.add(clock); }
  return [...found].sort().slice(0, 6);
}

const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
/** A date in the words ("den 5 december", "5 dec 2026", "2026-12-05"), as ÅÅÅÅ-MM-DD: the next such day from `now` when no year is said. */
export function dateInWords(text: string, now: Date = new Date()): string | null {
  const today = swedishParts(now);
  const key = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const valid = (year: number, month: number, day: number) => month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) { const [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]; return valid(year, month, day) ? key(year, month, day) : null; }
  const named = /\b(\d{1,2})(?::e|e)?\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|okt|nov|dec)(?![a-zåäö])\.?(?:\s+(20\d{2}))?/.exec(text);
  if (!named) return null;
  const month = MONTHS.findIndex((name) => name.startsWith(named[2]!)) + 1;
  const day = Number(named[1]);
  let year = named[3] ? Number(named[3]) : today.year;
  if (!named[3] && key(year, month, day) < key(today.year, today.month, today.day)) year += 1;
  return valid(year, month, day) ? key(year, month, day) : null;
}

type DaysRead = { kind: MissionSchedule["kind"]; weekdays?: number[]; weekday?: number; date?: string; from?: string };
/** The days in the words, as a schedule without its time, or null. */
export function daysInWords(text: string, now: Date = new Date()): DaysRead | null {
  const date = dateInWords(text, now);
  if (date) return { kind: "once", date };
  if (/sista dag(en)? (i|varje|per) månad|månadens sista dag|sista i månaden/.test(text)) return { kind: "monthly_last" };
  const firstOf = /första\s+(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)\w*\s+(i|varje|per)\s+månad/.exec(text);
  if (firstOf) return { kind: "monthly_first", weekday: DAYS.find(([pattern]) => pattern.test(firstOf[1]!))![1] };
  if (/första\s+vardagen|varje månad|en gång i månaden|månadens första/.test(text)) return { kind: "monthly_first_weekday" };
  const weekdays = DAYS.filter(([pattern]) => pattern.test(text)).map(([, day]) => day);
  if (/var ?annan (vecka|måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)|varannan veckas?/.test(text)) {
    const today = swedishParts(now);
    return { kind: "biweekly", weekdays, from: `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}` };
  }
  if (/varje vardag|alla vardagar|vardagar/.test(text)) return { kind: "daily" };
  if (/varje dag|dagligen/.test(text)) return { kind: "weekly", weekdays: [1, 2, 3, 4, 5, 6, 7] };
  return weekdays.length ? { kind: "weekly", weekdays } : null;
}

/** The schedule the days and times make (the template's time when the words name none). */
export function scheduleFrom(days: DaysRead, clocks: readonly string[], fallbackTime: string): MissionSchedule {
  const [time = fallbackTime, ...more] = clocks;
  const times = more.length ? { times: more } : {};
  switch (days.kind) {
    case "weekly": return { kind: "weekly", weekdays: days.weekdays ?? [1], time, ...times };
    case "biweekly": return { kind: "biweekly", weekdays: days.weekdays?.length ? days.weekdays : [1], from: days.from!, time, ...times };
    case "monthly_first": return { kind: "monthly_first", weekday: days.weekday ?? 1, time, ...times };
    case "once": return { kind: "once", date: days.date!, time, ...times };
    case "daily": case "monthly_first_weekday": case "monthly_last": return { kind: days.kind, time, ...times };
    default: return { kind: "weekly", weekdays: [1], time, ...times };
  }
}

export function interpretMission(textIn: string, known: { projects?: Readonly<Record<string, string>>; rounds?: Readonly<Record<string, string>>; now?: Date } = {}): Interpretation {
  const original = textIn.trim();
  const text = original.toLocaleLowerCase("sv");
  const now = known.now ?? new Date();
  // Hybrid by default (2026-11-21): the rules alone only when they fully answer the words. Judgement, ranking, comparing or
  // prose – or changes in Workflow – make it Med egna ord, where the rules fetch and Workflow AI judges and acts.
  const writeTools = writeToolsIn(text);
  const event = eventInWords(text);
  const ruled = WORDS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
  const eventTemplate = event === "deviation_created" && writeTools.includes("create_work_order") ? "deviation_to_work_order" : event === "machine_alarm" && !writeTools.length ? "alarm_notice" : null;
  // A state that is reached (an overdue invoice, a late work order, an intyg going out): Med egna ord, about the record itself.
  const templateKey: TemplateKey = event && isConditionEvent(event) ? "custom"
    : eventTemplate ?? (ruled && !needsJudgement(text) && !writeTools.length ? ruled : ruled === "weekly_news_draft" || ruled === "weekly_planning_news" ? ruled : "custom");
  const template = agentTemplate(templateKey)!;
  const questions: Interpretation["questions"] = [];
  const understood: string[] = [`Mall: ${template.name}.`];
  const defaults = template.defaults;
  for (const denied of deniedActionsIn(text)) questions.push({ field: "instruction", question: `${denied.reason} Vill du att agenten gör något annat i stället?` });

  // När
  const days = daysInWords(text, now);
  const clocks = timesInWords(text);
  const clock = clocks[0] ?? null;
  let schedule: MissionSchedule = defaults.schedule;
  if (event) { schedule = { kind: "event", event, time: "07:00" }; understood.push("Händelsen."); }
  else if (days) {
    schedule = scheduleFrom(days, clocks, defaults.schedule.time);
    understood.push(days.kind === "once" ? "Datumet." : "Dagarna.");
    if (days.kind === "biweekly" && !days.weekdays?.length) questions.push({ field: "schedule", question: "Vilken veckodag varannan vecka ska agenten köras?" });
  } else if (clock) schedule = { ...defaults.schedule, time: clock, ...(clocks.length > 1 ? { times: clocks.slice(1) } : {}) } as MissionSchedule;
  if (!event && !days) questions.push({ field: "schedule", question: "När ska agenten köras? Till exempel varje måndag, varannan vecka, sista dagen i månaden, ett visst datum eller när en avvikelse registreras." });
  if (!event && !clock) questions.push({ field: "schedule", question: "Vilket klockslag ska agenten köras?" });
  else if (clock) understood.push(clocks.length > 1 ? `Klockslagen ${clocks.join(", ")}.` : `Klockslaget ${clock}.`);

  // Vad agenten skapar och var
  const target: MissionDraft["target"] = { ...defaults.target, channels: [...defaults.target.channels] };
  const channels = (["facebook", "instagram", "linkedin"] as PostChannel[]).filter((channel) => text.includes(channel));
  if (templateKey === "custom") {
    if (/intern(a)? nyhet|nyheter|anslagstavla/.test(text)) target.kind = "news";
    else if (channels.length || /inlägg|sociala medier/.test(text)) target.kind = "post";
    else if (writeTools.length) { target.kind = "actions"; target.tools = writeTools; understood.push("Ändringarna."); }
    else target.kind = "report";
  }
  // Rapportmallar: the PDF template that fits the words.
  const eventSource = event === "invoice_overdue" ? "invoices" : event === "work_order_overdue" ? "work_orders" : event === "credential_expiring" ? "credentials" : null;
  const sources = [...new Set([...sourcesIn(text), ...(eventSource ? [eventSource] : [])])] as ReturnType<typeof sourcesIn>;
  target.report = sources.includes("deviations") ? "deviations" : sources.includes("time") ? "time" : sources.includes("quotes") ? "quotes_waiting" : templateKey === "custom" ? "general" : reportTemplateFor(templateKey);
  if (/pdf|bifoga/.test(text)) target.attachPdf = true;
  if (target.kind === "post" || target.kind === "news") {
    const publishes = /publicera(s)? (automatiskt|direkt)|publicera det|och publicera|publicera på/.test(text);
    const drafts = /utkast/.test(text);
    if (publishes && !drafts) target.publish = "auto";
    else if (drafts) target.publish = "draft";
    else questions.push({ field: "target", question: target.kind === "post" ? "Ska agenten spara inlägget som utkast eller publicera det automatiskt?" : "Ska agenten spara nyheten som utkast eller publicera den automatiskt?" });
    if (target.kind === "post") {
      if (channels.length) { target.channels = channels; understood.push("Kanalerna."); }
      else if (target.publish === "auto") questions.push({ field: "channels", question: "Var ska inlägget publiceras? Facebook, Instagram eller LinkedIn?" });
    }
  }

  // Underlag
  const projectIds = Object.entries(known.projects ?? {}).filter(([, name]) => name.trim().length >= 3 && text.includes(name.toLocaleLowerCase("sv"))).map(([projectId]) => projectId).slice(0, 20);
  if (projectIds.length) understood.push("Projekten.");
  let roundScheduleId: string | null = null;
  if (template.needs.round) {
    const rounds = Object.entries(known.rounds ?? {});
    const named = rounds.filter(([, name]) => name.trim().length >= 3 && text.includes(name.toLocaleLowerCase("sv")));
    roundScheduleId = named.length === 1 ? named[0]![0] : rounds.length === 1 ? rounds[0]![0] : null;
    if (!roundScheduleId) questions.push({ field: "scope", question: "Vilken driftrond gäller det?" });
  }

  // Så får du resultatet
  const feedback: FeedbackChannel[] = [];
  if (/e-?post|mejl|mail/.test(text)) feedback.push("EMAIL");
  if (/notis|klockan i workflow/.test(text)) feedback.push("NOTICE");
  if (/chatt/.test(text)) feedback.push("CHAT");
  if (!feedback.length) questions.push({ field: "feedback", question: "Hur vill du få resultatet: e-post, notis i Workflow eller en sammanfattning i chatten?" });

  const name = templateKey === "custom" ? (original.split(/[.\n]/)[0] ?? "").replace(/^(skriv|gör|skapa|lista|ta fram)\s+/i, "").slice(0, 60).trim() || "Eget uppdrag" : template.name;
  return {
    draft: {
      name: name.charAt(0).toUpperCase() + name.slice(1), instruction: original.slice(0, 1_000), templateKey,
      scope: { projectIds, roundScheduleId, ...(templateKey === "custom" ? { sources: sources.length ? sources : ["work_orders" as const], period: periodIn(text) } : {}) }, schedule, target, feedback: feedback.length ? feedback : [...defaults.feedback],
    },
    questions,
    understood,
  };
}

/** The event the words name ("när en avvikelse registreras"), or null. */
export function eventInWords(text: string): AgentEventKey | null {
  if (!/\bnär\b|\bså fort\b|\bvarje gång\b|\bom\b/.test(text)) return null;
  if (/(tillbud|olycksfall)\w* (registreras|rapporteras|kommer|skapas)/.test(text)) return "incident_created";
  if (/avvikelse\w* (registreras|rapporteras|kommer|skapas)|ny avvikelse/.test(text)) return "deviation_created";
  if (/arbetsord\w* (blir |är )?(klar|färdigställ)\w*/.test(text)) return "work_order_completed";
  if (/maskinlarm|larm (kommer|går)/.test(text)) return "machine_alarm";
  if (/offert\w* (accepteras|godkänns|antas)/.test(text)) return "quote_accepted";
  if (/offert\w* (avböjs|nekas|avslås)/.test(text)) return "quote_declined";
  if (/ny kund|kund\w* (skapas|läggs till)/.test(text)) return "customer_created";
  // Fler händelser (2026-11-23): a state that is reached.
  if (/faktur\w* (har )?(passerat|förfallit|förfaller|är förfallen|blir förfallen|inte (är |blivit )?betald)|förfallen faktura|obetald\w* faktur\w* (passerar|förfaller)/.test(text)) return "invoice_overdue";
  if (/arbetsord\w* (har )?(passerat|är försenad|blir försenad|är sen\b|blir sen\b)|försenad\w* arbetsord|klart senast (har )?passerat/.test(text)) return "work_order_overdue";
  if (/(intyg|behörighet|certifikat|kompetensbevis)\w* (snart )?(går ut|löper ut|håller på att gå ut|upphör)/.test(text)) return "credential_expiring";
  return null;
}

/** The questions as one message for the chat. */
export const questionsText = (questions: readonly { question: string }[]) => questions.map((item) => `• ${item.question}`).join("\n");

// ---------- a follow-up in the conversation: the words change the CURRENT mission ----------

export type Refinement = {
  draft: MissionDraft;
  /** What changed, each as one plain Swedish sentence. */
  changes: string[];
  /** What the words ask for that no agent ever does, with the reason. */
  denied: string[];
  /** The words were about what the agent does (not when, to whom or how): they became part of its own words. */
  whatChanged: boolean;
};

const CHANNEL_WORDS: [FeedbackChannel, string, string][] = [["EMAIL", "e-?post\\w*|mejl\\w*|mail\\w*", "e-post"], ["NOTICE", "notis\\w*", "en notis"], ["CHAT", "chatt\\w*", "en sammanfattning i chatten"]];
const NOT = "(?:inte|ingen|inga|utan|ta bort|sluta med|slipp\\w*|ej)";
const ROLE_WORDS: ["admins" | "everyone", string, string][] = [
  ["admins", "(?:alla |företagets )?administratör\\w*|(?:alla )?admin(?:s|er|erna)?(?![\\p{L}])", "alla administratörer"],
  ["everyone", "alla i företaget|hela företaget|alla kollegor\\w*|alla medarbetare\\w*|alla anställda|hela teamet", "alla i företaget"],
];
const DAY_WORD = "(?:mån|tis|ons|tors|fre|lör|sön)dag\\w*";
/**
 * Whether the words are about WHEN the agent runs (2026-11-23, fewer false hits): they say so ("kör", "varje", "varannan", "kl 8",
 * "i stället", "på fredagar", "byt till", "sista dagen i månaden", a date), or they are nothing but days and times ("måndagar och
 * torsdagar", "14:00"). A day inside a description – "arbetsordrar som ska vara klara på fredag" – is not.
 */
export function aboutWhen(text: string): boolean {
  const cue = new RegExp([
    "(?:^|[^\\p{L}])(?:kör\\w*|körs|varje|varannan|var annan|dagligen|vardagar|alla dagar)(?![\\p{L}])", "kl(?:\\.|ockan)?\\s*\\d", "i stället|istället",
    `(?:^|[^\\p{L}])på ${DAY_WORD}ar(?![\\p{L}])`, `^(?:ta|välj|gör det)\\s+(?:\\S+\\s+)?(?:${DAY_WORD}|kl)`, `(?:byt|ändra|flytta)\\w*\\s+(?:\\S+\\s+){0,3}?(?:till|dag\\w*|tid\\w*|klockslag\\w*|kl|${DAY_WORD})(?![\\p{L}])`,
    "sista dag(?:en)? (?:i|varje|per) månad|månadens sista dag|första (?:vardagen|\\p{L}+dagen) (?:i|varje|per) månad|en gång i månaden|varje månad",
    "(?:^|[^\\p{L}])den \\d{1,2}(?::e|e)? \\p{L}+", "\\b20\\d{2}-\\d{2}-\\d{2}\\b",
  ].join("|"), "u");
  if (cue.test(hourWordsAsNumbers(text))) return true;
  // Only days, times and small words: the whole message is a schedule.
  const rest = text.replace(new RegExp(DAY_WORD, "gu"), " ").replace(/\d{1,2}[:.]\d{2}|\d{1,2}/g, " ").replace(/(?:^|[^\p{L}])(?:och|samt|kl|klockan|på|i|vecka|veckan|veckor|dag|dagar|tack|gärna)(?![\p{L}])/gu, " ").replace(/[\s,.;:!?&-]+/g, "");
  return rest === "";
}
/** Whether the words are about WHO gets the result: a colleague's name or a role adds a recipient only then. */
export const aboutWho = (text: string) => /(?:^|[^\p{L}])(?:skicka\w*|mejla\w*|maila\w*|mottagar\w*|till|även|också|lägg till|kopia|cc|inte|utan|ta bort)(?![\p{L}])/u.test(text);
const joined = (items: readonly string[]) => items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} och ${items[items.length - 1]}`;
const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Ett svar i samtalet (2026-11-23): "ta måndagar i stället", "skicka även till alla administratörer", "kl 8 och 15", "utan notis".
 * Workflow's own rules read the words against the mission as it is now and change only what they name – when, how the owner gets
 * the result, who else gets it, draft or publish, the PDF, the name. Words that name none of those are about WHAT the agent does:
 * they are added to its own words (a mission that followed a template then follows the owner's words, lib/agents/templates.ts).
 * What no agent ever does is refused with its reason and changes nothing. Pure and free; the server may let Workflow AI read the new
 * words too, and Kontrollera judges the result as always.
 */
export function refineMission(current: MissionDraft, textIn: string, known: { members?: Readonly<Record<string, string>>; now?: Date } = {}): Refinement {
  const original = textIn.trim();
  const text = original.toLocaleLowerCase("sv");
  const now = known.now ?? new Date();
  const changes: string[] = [];
  let draft: MissionDraft = { ...current, scope: { ...current.scope }, target: { ...current.target, channels: [...current.target.channels] }, feedback: [...current.feedback] };
  // "Ta bort notisen" takes a channel, a recipient, a time or the PDF away: that is no permanent delete, so it is read before the deny-list.
  const removable = new RegExp(`${NOT}\\s+(?:\\S+\\s+){0,2}?(?:${CHANNEL_WORDS.map(([, words]) => words).join("|")}|${ROLE_WORDS.map(([, words]) => words).join("|")}|mottagar\\w*|pdf\\w*|klockslag\\w*)`, "gu");
  const denied = deniedActionsIn(text.replace(removable, " ")).map((item) => item.reason);
  if (denied.length) return { draft: current, changes, denied, whatChanged: false };
  const says = (words: string) => new RegExp(`(?:^|[^\\p{L}])(?:${words})`, "u").test(text);
  const negates = (words: string) => new RegExp(`${NOT}\\s+(?:\\S+\\s+){0,2}?(?:${words})`, "u").test(text);
  const only = /\bbara\b|\bendast\b|i stället|istället/.test(text) && !/även|också/.test(text);

  // När
  const event = eventInWords(text);
  const days = daysInWords(text, now);
  const clocks = timesInWords(text);
  const before = draft.schedule;
  const keptTimes = before.kind === "event" ? [] : [before.time, ...(before.times ?? [])];
  // A day or a time is a change of when only in words about when the agent runs – never inside a description of what it reads.
  const when = aboutWhen(text);
  if (event) draft.schedule = { kind: "event", event, time: "07:00" };
  else if (!when) { /* "som ska vara klara på fredag": the day is part of what the agent does */ }
  else if (days) {
    const weekdays = days.weekdays?.length ? days.weekdays : before.kind === "weekly" || before.kind === "biweekly" ? before.weekdays : days.weekdays;
    draft.schedule = scheduleFrom({ ...days, weekdays }, clocks.length ? clocks : keptTimes, "07:00");
  } else if (clocks.length && before.kind !== "event") {
    const next = { ...before, time: clocks[0]!, times: clocks.slice(1) };
    if (!next.times.length) delete (next as { times?: string[] }).times;
    draft.schedule = next;
  }
  if (JSON.stringify(draft.schedule) !== JSON.stringify(before)) changes.push(`Agenten körs nu ${missionScheduleText(draft.schedule).toLocaleLowerCase("sv")}.`);

  // Till vem: fler mottagare
  const chosen = { userIds: [...(current.recipients?.userIds ?? [])], roles: [...(current.recipients?.roles ?? [])] };
  let recipientsNamed = false;
  if (/bara (till )?mig(?![\p{L}])|bara jag(?![\p{L}])|inga (fler |andra )?mottagar|ta bort (alla )?mottagar/u.test(text)) {
    recipientsNamed = true;
    if (chosen.userIds.length || chosen.roles.length) { chosen.userIds = []; chosen.roles = []; changes.push("Nu får bara du resultatet."); }
  } else {
    for (const [role, words, label] of ROLE_WORDS) {
      if (!says(words) || !aboutWho(text)) continue;
      recipientsNamed = true;
      if (negates(words)) { if (chosen.roles.includes(role)) { chosen.roles = chosen.roles.filter((item) => item !== role); changes.push(`Resultatet skickas inte längre till ${label}.`); } }
      else if (!chosen.roles.includes(role)) { chosen.roles.push(role); changes.push(`Resultatet skickas också som e-post till ${label}.`); }
    }
    const members = Object.entries(known.members ?? {});
    const firstOf = (name: string) => name.trim().toLocaleLowerCase("sv").split(/\s+/)[0] ?? "";
    for (const [userId, name] of members) {
      const full = name.trim().toLocaleLowerCase("sv");
      const first = firstOf(name);
      const firstIsUnique = first.length >= 3 && members.filter(([, other]) => firstOf(other) === first).length === 1;
      const words = [full.length >= 3 ? full : null, firstIsUnique ? first : null].filter((item): item is string => Boolean(item)).map(escaped).join("|");
      if (!words || !aboutWho(text) || !new RegExp(`(?:^|[^\\p{L}])(?:${words})(?![\\p{L}])`, "u").test(text)) continue;
      recipientsNamed = true;
      if (negates(words)) { if (chosen.userIds.includes(userId)) { chosen.userIds = chosen.userIds.filter((item) => item !== userId); changes.push(`Resultatet skickas inte längre till ${name}.`); } }
      else if (!chosen.userIds.includes(userId)) { chosen.userIds.push(userId); changes.push(`Resultatet skickas också som e-post till ${name}.`); }
    }
  }
  const recipients = cleanRecipients(chosen);
  if (recipients) draft.recipients = recipients; else delete draft.recipients;

  // Till vem: how the owner gets it (words about colleagues do not change the owner's own channels)
  if (!recipientsNamed || /(?:^|[^\p{L}])(mig|jag)(?![\p{L}])/u.test(text)) {
    const named = CHANNEL_WORDS.filter(([, words]) => says(words));
    const wanted = named.filter(([, words]) => !negates(words)).map(([channel]) => channel);
    const unwanted = named.filter(([, words]) => negates(words)).map(([channel]) => channel);
    const next = (only && wanted.length ? wanted : [...new Set([...draft.feedback, ...wanted])]).filter((channel) => !unwanted.includes(channel));
    if (JSON.stringify([...next].sort()) !== JSON.stringify([...draft.feedback].sort())) {
      draft.feedback = next;
      changes.push(next.length ? `Du får resultatet som ${joined(next.map((channel) => CHANNEL_WORDS.find(([key]) => key === channel)![2]))}.` : "Nu är inget sätt att få resultatet valt.");
    }
  }

  // Vad agenten skapar: utkast eller publicera, kanaler, PDF
  if (draft.target.kind === "post" || draft.target.kind === "news") {
    const publish = /utkast/.test(text) ? "draft" : /publicera(s)? (automatiskt|direkt)|publicera det(?![\p{L}])/u.test(text) ? "auto" : null;
    if (publish && publish !== draft.target.publish) { draft.target.publish = publish; changes.push(publish === "auto" ? "Agenten publicerar automatiskt, men sparar ett utkast när det är känsligt." : "Agenten sparar ett utkast, och du publicerar själv."); }
  }
  if (draft.target.kind === "post") {
    const channels = (["facebook", "instagram", "linkedin"] as PostChannel[]).filter((channel) => text.includes(channel));
    const next = only && channels.length ? channels : [...new Set([...draft.target.channels, ...channels])];
    if (JSON.stringify(next) !== JSON.stringify(draft.target.channels)) { draft.target.channels = next; changes.push(`Inlägget går till ${joined(next.map((channel) => channel === "linkedin" ? "LinkedIn" : channel.charAt(0).toUpperCase() + channel.slice(1)))}.`); }
  }
  if (says("pdf\\w*|bifoga\\w*")) {
    const attach = !negates("pdf\\w*|bifoga\\w*");
    if (attach !== Boolean(draft.target.attachPdf)) { draft.target.attachPdf = attach; changes.push(attach ? "Rapporten bifogas som PDF i e-posten." : "Rapporten bifogas inte längre som PDF."); }
  }

  // Namn
  const renamed = /^(?:döp|kalla)\s+(?:det|den|uppdraget|agenten)?\s*(?:till|för)?\s*["”]?([^"”]{2,80}?)["”]?\s*$/i.exec(original);
  if (renamed) { draft.name = renamed[1]!.trim(); changes.push(`Uppdraget heter nu ${draft.name}.`); }

  if (changes.length) return { draft, changes, denied, whatChanged: false };
  // Words about when, to whom or how that the mission already follows (the ready answer "E-post" when e-mail is already chosen,
  // 2026-11-24) change nothing – they are never added to what the agent does.
  const ownChannels = !recipientsNamed || /(?:^|[^\p{L}])(mig|jag)(?![\p{L}])/u.test(text);
  const addressed = Boolean(event) || (when && (Boolean(days) || clocks.length > 0)) || recipientsNamed
    || (ownChannels && CHANNEL_WORDS.some(([, words]) => says(words))) || (draft.target.kind === "post" && /facebook|instagram|linkedin/.test(text));
  if (addressed) {
    // A ready answer about how the owner gets the result is confirmed in its own words; anything else already in place is said so.
    const channelAnswer = ownChannels && !recipientsNamed && !(when && (days || clocks.length)) && CHANNEL_WORDS.some(([, words]) => says(words)) && draft.feedback.length;
    const confirmed = channelAnswer ? `Du får resultatet som ${joined(draft.feedback.map((channel) => CHANNEL_WORDS.find(([key]) => key === channel)![2]))}.` : "Det gäller redan för uppdraget.";
    return { draft, changes: [confirmed], denied, whatChanged: false };
  }

  // Nothing of when, to whom or how: the words are about what the agent does.
  const template = agentTemplate(draft.templateKey);
  if (template && template.key !== "custom") {
    draft = ownWordsFrom({ ...draft, instruction: `${template.does} ${original}`.slice(0, 1_000) });
    changes.push("Agenten följer nu dina egna ord i stället för mallen, och använder Workflow AI.");
  } else {
    const first = !draft.instruction.trim();
    draft.instruction = (first ? original : `${draft.instruction.trim().replace(/[.!?]?$/, ".")} ${original}`).slice(0, 1_000);
    const extraSources = sourcesIn(text);
    if (extraSources.length) draft.scope.sources = [...new Set([...(draft.scope.sources ?? []), ...extraSources])];
    const tools = writeToolsIn(text);
    if (tools.length && (draft.target.kind === "report" || draft.target.kind === "actions")) draft.target = { ...draft.target, kind: "actions", tools: [...new Set([...(draft.target.tools ?? []), ...tools])] };
    changes.push(first ? "Jag har skrivit in vad agenten ska göra." : "Jag har lagt till det i vad agenten ska göra.");
  }
  return { draft, changes, denied, whatChanged: true };
}
