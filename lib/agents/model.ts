import { z } from "zod";
import { formatSwedish, swedishDate, swedishParts } from "@/lib/swedish-time";

/**
 * Agenter (2026-11-21): a mission is something Workflow AI does on a schedule – with the owner's own rights, checked again on
 * every run – and tells the owner about. Pure: the shapes, the schedule (Swedish time), the checks before a mission may be switched
 * on, the plain description ("Så här kommer agenten att arbeta"), the caution rules that turn "Publicera automatiskt" into a draft,
 * the run keys that make a run happen once, the link texts and the cost class. The server, the page, the chat and the tests read
 * the same rules.
 *
 * What an agent never does, in any mode: sign, complete, send to a customer, send invoices, delete permanently or decide anything
 * about electrical safety; no limit values that do not come from the instrument (CLAUDE.md, the copyright precaution).
 */

export const MAX_MISSIONS = 25;
export const NAME_MAX = 80;
export const INSTRUCTION_MAX = 1_000;

// ---------- the parts of a mission ----------

export const FEEDBACK_CHANNELS = ["EMAIL", "NOTICE", "CHAT"] as const;
export type FeedbackChannel = (typeof FEEDBACK_CHANNELS)[number];
export const FEEDBACK_LABEL: Record<FeedbackChannel, string> = { EMAIL: "E-post", NOTICE: "Notis i Workflow", CHAT: "Sammanfattning i chatten" };
export const FEEDBACK_HELP: Record<FeedbackChannel, string> = {
  EMAIL: "En kort rapport med rubriker och länkar. Länkarna kräver inloggning.",
  NOTICE: "En rad i klockan med en länk.",
  CHAT: "Ett kort svar i konversationen Agenter i Workflow AI, med Visa hela rapporten.",
};

/** actions (2026-11-21: "så flexibelt och mycket som möjligt inom ramen för de säkra reglerna"): changes in Workflow with the catalog's tools. */
export const TARGET_KINDS = ["report", "work_order", "post", "news", "actions"] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];
export const TARGET_LABEL: Record<TargetKind, string> = { report: "Bara en rapport", work_order: "Planerad arbetsorder", post: "Inlägg", news: "Intern nyhet", actions: "Ändringar i Workflow" };
export const PUBLISH_MODES = ["draft", "auto"] as const;
export type PublishMode = (typeof PUBLISH_MODES)[number];
export const PUBLISH_LABEL: Record<PublishMode, string> = { draft: "Spara som utkast", auto: "Publicera automatiskt" };
export const POST_CHANNELS = ["facebook", "instagram", "linkedin"] as const;
export type PostChannel = (typeof POST_CHANNELS)[number];
export const POST_CHANNEL_LABEL: Record<PostChannel, string> = { facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn" };

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Ange klockslaget som TT:MM, till exempel 07:00.");
/** Flera gånger per dag (2026-11-23): more clock times the same day, besides `time`. */
const times = z.array(time).max(5, "Högst sex klockslag per dag.").optional();
const dateKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Ange datumet som ÅÅÅÅ-MM-DD.");
/** 1 = Monday … 7 = Sunday. */
const weekday = z.number().int().min(1).max(7);
export const MISSION_EVENT_KEYS = [
  "deviation_created", "incident_created", "work_order_completed", "machine_alarm", "quote_accepted", "quote_declined", "customer_created",
  // Fler händelser (2026-11-23): a state that is reached rather than a change – found by the job's sweep (lib/agents/events.ts).
  "invoice_overdue", "work_order_overdue", "credential_expiring",
] as const;
export const missionScheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("weekly"), weekdays: z.array(weekday).min(1, "Välj minst en dag.").max(7), time, times }),
  // Varannan vecka (2026-11-23): the weeks counted from the week of `from` (week 0 runs, week 1 does not, and so on).
  z.object({ kind: z.literal("biweekly"), weekdays: z.array(weekday).min(1, "Välj minst en dag.").max(7), time, times, from: dateKey }),
  z.object({ kind: z.literal("daily"), time, times }),
  z.object({ kind: z.literal("monthly_first_weekday"), time, times }),
  z.object({ kind: z.literal("monthly_first"), weekday, time, times }),
  z.object({ kind: z.literal("monthly_last"), time, times }),
  // Ett visst datum (2026-11-23): once; afterwards the mission has no next time.
  z.object({ kind: z.literal("once"), date: dateKey, time, times }),
  // När något händer (2026-11-21): the mission runs on an event instead of a time (lib/agents/events.ts).
  z.object({ kind: z.literal("event"), event: z.enum(MISSION_EVENT_KEYS), time: time.default("07:00") }),
]);
export type MissionSchedule = z.infer<typeof missionScheduleSchema>;
export const SCHEDULE_KINDS = ["weekly", "biweekly", "daily", "monthly_first_weekday", "monthly_first", "monthly_last", "once", "event"] as const;
export const SCHEDULE_KIND_LABEL: Record<MissionSchedule["kind"], string> = {
  weekly: "Vissa veckodagar", biweekly: "Varannan vecka", daily: "Varje vardag", monthly_first_weekday: "Första vardagen varje månad", monthly_first: "Första veckodagen i månaden",
  monthly_last: "Sista dagen varje månad", once: "En gång, ett visst datum", event: "När något händer",
};
export type AgentEventKey = Extract<MissionSchedule, { kind: "event" }>["event"];
export const AGENT_EVENTS: Record<AgentEventKey, string> = {
  deviation_created: "När en avvikelse registreras", incident_created: "När ett tillbud eller olycksfall registreras", work_order_completed: "När en arbetsorder färdigställs",
  machine_alarm: "När ett maskinlarm kommer", quote_accepted: "När en offert accepteras", quote_declined: "När en offert avböjs", customer_created: "När en ny kund skapas",
  invoice_overdue: "När en faktura har passerat förfallodagen", work_order_overdue: "När en arbetsorder har passerat Klart senast", credential_expiring: "När ett intyg eller en behörighet går ut inom 30 dagar",
};
/** The events that are a state reached (found by the job's sweep), not a change someone makes. */
export const CONDITION_EVENTS = ["invoice_overdue", "work_order_overdue", "credential_expiring"] as const satisfies readonly AgentEventKey[];
export type ConditionEventKey = (typeof CONDITION_EVENTS)[number];
export const isConditionEvent = (key: string): key is ConditionEventKey => (CONDITION_EVENTS as readonly string[]).includes(key);
/** A reached state's event id: the record and the date it is about, so the same record runs a mission once per date. */
export const conditionEventId = (key: ConditionEventKey, recordId: string, date: string) => `${key}:${recordId}:${date}`;
/** How many days back the sweep looks, so a new mission never runs on years of old records; and how far ahead an intyg counts as going out. */
export const CONDITION_LOOKBACK_DAYS = 7;
export const CREDENTIAL_NOTICE_DAYS = 30;
/** What the owner must be allowed to read for the event's own record (its title goes into the run). */
export const EVENT_NEEDS: Partial<Record<AgentEventKey, { rights?: readonly string[]; modules?: readonly string[]; admin?: boolean }>> = {
  invoice_overdue: { rights: ["invoicing:read"], modules: ["invoicing"] },
  work_order_overdue: { rights: ["work-order:read"] },
  credential_expiring: { admin: true, modules: ["self_inspection"] },
};
/** At most this many event runs per mission and hour; the rest wait for a notice (a mass import never floods). */
export const EVENT_BURST_PER_HOUR = 20;

const id = z.string().trim().min(1).max(100);
export const missionScopeSchema = z.object({
  /** Underlag: the projects the agent reads; empty is everything the owner may read. */
  projectIds: z.array(id).max(20).default([]),
  /** Dags för driftrond: the round whose month the agent looks after. */
  roundScheduleId: id.nullish().transform((value) => value ?? null),
  /** Med egna ord: what the rules fetch first (lib/agents/tool-policy.ts SOURCE_KEYS) and for which period. */
  sources: z.array(z.enum(["work_orders", "deviations", "time", "quotes", "planning", "projects", "customers", "credentials", "invoices"])).max(9).optional(),
  period: z.enum(["week", "month", "quarter", "year"]).optional(),
});
export type MissionScope = z.infer<typeof missionScopeSchema>;

export const missionTargetSchema = z.object({
  kind: z.enum(TARGET_KINDS),
  publish: z.enum(PUBLISH_MODES).default("draft"),
  channels: z.array(z.enum(POST_CHANNELS)).max(3).default([]),
  /** The catalog's tools the mission may change things with (Ändringar i Workflow); reading tools are always there. */
  tools: z.array(z.string().max(40)).max(20).optional(),
  /** The report template (PDF Agentrapport) the run fills; left out, the mission template's own. */
  report: z.string().max(40).nullish(),
  /** Attach the PDF to the e-mail (only when chosen, and only to the owner, who may see it). */
  attachPdf: z.boolean().optional(),
});
export type MissionTarget = z.infer<typeof missionTargetSchema>;

/** Fler mottagare (2026-11-23): colleagues in the same company, or a role, besides the owner. Never an address outside the company. */
export const RECIPIENT_ROLES = ["admins", "everyone"] as const;
export type RecipientRole = (typeof RECIPIENT_ROLES)[number];
export const RECIPIENT_ROLE_LABEL: Record<RecipientRole, string> = { admins: "Alla administratörer", everyone: "Alla i företaget" };
export const MAX_RECIPIENTS = 50;
export const missionRecipientsSchema = z.object({
  userIds: z.array(id).max(MAX_RECIPIENTS, `Högst ${MAX_RECIPIENTS} mottagare.`).default([]),
  roles: z.array(z.enum(RECIPIENT_ROLES)).max(RECIPIENT_ROLES.length).default([]),
});
export type MissionRecipients = z.infer<typeof missionRecipientsSchema>;
/** The recipients as stored and compared: undefined when nobody but the owner. */
export function cleanRecipients(value: MissionRecipients | null | undefined): MissionRecipients | undefined {
  if (!value) return undefined;
  const userIds = [...new Set(value.userIds)].slice(0, MAX_RECIPIENTS);
  const roles = RECIPIENT_ROLES.filter((role) => value.roles.includes(role));
  return userIds.length || roles.length ? { userIds, roles } : undefined;
}

export const missionDraftSchema = z.object({
  name: z.string().trim().max(NAME_MAX + 40).default(""),
  instruction: z.string().trim().max(INSTRUCTION_MAX).default(""),
  templateKey: z.string().trim().min(1).max(40),
  scope: missionScopeSchema.default({ projectIds: [], roundScheduleId: null }),
  schedule: missionScheduleSchema,
  target: missionTargetSchema,
  feedback: z.array(z.enum(FEEDBACK_CHANNELS)).max(3).default([]),
  /** Left out or empty: only the owner. */
  recipients: missionRecipientsSchema.optional(),
});
export type MissionDraft = z.infer<typeof missionDraftSchema>;

// ---------- the schedule (Swedish time) ----------

const parseTime = (value: string) => { const [hour, minute] = value.split(":").map(Number); return { hour: hour ?? 0, minute: minute ?? 0 }; };
/** The first Monday–Friday of the month of `day` (1–3). */
function firstWeekdayOfMonth(year: number, month: number) {
  const first = swedishParts(swedishDate(year, month, 1, 12)).weekday; // 0 = Monday
  return first === 5 ? 3 : first === 6 ? 2 : 1;
}

/** A calendar day as a number of days since 1970-01-01, and the Monday of its week (1970-01-01 was a Thursday). */
const dayNumber = (year: number, month: number, day: number) => Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
const mondayOf = (number: number) => number - ((number + 3) % 7);
const parseDateKey = (value: string) => { const [year, month, day] = value.split("-").map(Number); return { year: year ?? 1970, month: month ?? 1, day: day ?? 1 }; };
export const dateKeyOf = (day: { year: number; month: number; day: number }) => `${day.year}-${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Whether the schedule runs on this Swedish day (`weekday` 0 = Monday, as swedishParts). */
export function scheduleRunsOn(schedule: MissionSchedule, day: { year: number; month: number; day: number; weekday: number }) {
  switch (schedule.kind) {
    case "weekly": return schedule.weekdays.includes(day.weekday + 1);
    case "biweekly": {
      if (!schedule.weekdays.includes(day.weekday + 1)) return false;
      const start = parseDateKey(schedule.from);
      const weeks = (mondayOf(dayNumber(day.year, day.month, day.day)) - mondayOf(dayNumber(start.year, start.month, start.day))) / 7;
      return weeks >= 0 && weeks % 2 === 0;
    }
    case "daily": return day.weekday < 5;
    case "monthly_first_weekday": return day.day === firstWeekdayOfMonth(day.year, day.month);
    case "monthly_first": return day.day <= 7 && day.weekday + 1 === schedule.weekday;
    case "monthly_last": return day.day === daysInMonth(day.year, day.month);
    case "once": return dateKeyOf(day) === schedule.date;
    case "event": return false;
  }
}
export const isEventSchedule = (schedule: MissionSchedule): schedule is Extract<MissionSchedule, { kind: "event" }> => schedule.kind === "event";

/** Every clock time of the day the schedule runs, sorted and without duplicates. */
export function scheduleTimes(schedule: MissionSchedule): string[] {
  if (schedule.kind === "event") return [];
  return [...new Set([schedule.time, ...(schedule.times ?? [])])].sort();
}

/**
 * The next time the schedule runs after `from` (strictly later), in Swedish time. A clock time that does not exist the night summer
 * time starts (02:00–02:59) runs an hour later that night, the way the clock reads it. Null when none within 400 days (never for a
 * valid repeating schedule; a date that has passed gives none).
 */
export function nextMissionRun(schedule: MissionSchedule, from: Date): Date | null {
  if (schedule.kind === "event") return null;
  const clocks = scheduleTimes(schedule).map(parseTime);
  const today = swedishParts(from);
  for (let offset = 0; offset <= 400; offset += 1) {
    const noon = swedishParts(swedishDate(today.year, today.month, today.day + offset, 12));
    if (!scheduleRunsOn(schedule, noon)) continue;
    for (const { hour, minute } of clocks) {
      const at = swedishDate(noon.year, noon.month, noon.day, hour, minute);
      if (at.getTime() > from.getTime()) return at;
    }
  }
  return null;
}

const WEEKDAY_PLURAL = ["måndagar", "tisdagar", "onsdagar", "torsdagar", "fredagar", "lördagar", "söndagar"];
const WEEKDAY_SINGULAR = ["måndagen", "tisdagen", "onsdagen", "torsdagen", "fredagen", "lördagen", "söndagen"];
export const WEEKDAY_LABEL = ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag", "Söndag"];
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const joinWords = (items: readonly string[]) => items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} och ${items[items.length - 1]}`;

export const MONTH_NAMES = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
/** "5 december 2026". */
export const dateText = (value: string) => { const day = parseDateKey(value); return `${day.day} ${MONTH_NAMES[day.month - 1] ?? ""} ${day.year}`; };

/** The days of a weekly schedule in plain Swedish: "måndagar och torsdagar", "vardagar", "varje dag". */
function weekdaysText(weekdays: readonly number[]) {
  const days = [...new Set(weekdays)].sort((a, b) => a - b);
  if (days.length === 7) return "varje dag";
  if (days.length === 5 && days.every((day, index) => day === index + 1)) return "vardagar";
  return joinWords(days.map((day) => WEEKDAY_PLURAL[day - 1]!));
}

/** The schedule in plain Swedish: "Måndagar 07:00", "Vardagar 08:00 och 15:00", "Varannan vecka, måndagar 07:00", "Sista dagen varje månad 16:00". */
export function missionScheduleText(schedule: MissionSchedule): string {
  if (schedule.kind === "event") return AGENT_EVENTS[schedule.event];
  const clock = joinWords(scheduleTimes(schedule));
  switch (schedule.kind) {
    case "weekly": return `${capital(weekdaysText(schedule.weekdays))} ${clock}`;
    case "biweekly": return `Varannan vecka, ${weekdaysText(schedule.weekdays)} ${clock}`;
    case "daily": return `Varje vardag ${clock}`;
    case "monthly_first_weekday": return `Första vardagen varje månad ${clock}`;
    case "monthly_first": return `Första ${WEEKDAY_SINGULAR[schedule.weekday - 1]} varje månad ${clock}`;
    case "monthly_last": return `Sista dagen varje månad ${clock}`;
    case "once": return `En gång, ${dateText(schedule.date)} ${clock}`;
  }
}

// ---------- event runs ----------

/** An event run's key: the mission and the event's own id, so a re-delivered event runs once. */
export const eventRunKey = (missionId: string, eventId: string) => `${missionId}@event:${eventId.slice(0, 120)}`;
export type AgentEvent = { key: AgentEventKey; id: string; organizationId: string; recordId: string; title: string; href: string; actorId: string | null; at: Date;
  /** Set when an agent's own run made the change: that mission never runs on it (no loops). */
  byMissionId?: string | null };
/** The missions an event starts: active, on this event, never the one whose own change it was, within the burst limit. */
export function eventTargets<M extends { id: string; status: string; schedule: MissionSchedule; recentRuns: number }>(missions: readonly M[], event: Pick<AgentEvent, "key" | "byMissionId">): { run: M[]; held: M[] } {
  const matching = missions.filter((mission) => mission.status === "active" && mission.schedule.kind === "event" && mission.schedule.event === event.key && mission.id !== event.byMissionId);
  return { run: matching.filter((mission) => mission.recentRuns < EVENT_BURST_PER_HOUR), held: matching.filter((mission) => mission.recentRuns >= EVENT_BURST_PER_HOUR) };
}

/** "fredag 28 november kl. 14:00". */
export const runTimeText = (at: Date) => `${formatSwedish(at, { weekday: "long", day: "numeric", month: "long" })} kl. ${formatSwedish(at, { hour: "2-digit", minute: "2-digit" })}`;

// ---------- run keys: a run happens once ----------

/** The scheduled run of a mission at a slot: unique per company, so two jobs at the same minute make one run. */
export const scheduledRunKey = (missionId: string, slotAt: Date) => `${missionId}@${slotAt.toISOString()}`;
/** Kör nu: its own key per press (the page sends a fresh nonce; a double click with the same nonce is one run). */
export const manualRunKey = (missionId: string, nonce: string) => `${missionId}@manual:${nonce.slice(0, 60)}`;
/** What a run makes is marked with the run's key: a post (SocialPost source "agent"), an internal news post. */
export const AGENT_SOURCE = "agent";
export const effectRef = (runKey: string) => runKey.slice(0, 200);
/** The bell's notice of a run (NoticeDelivery, channel AGENT). */
export const AGENT_NOTICE_CHANNEL = "AGENT";
export const agentNoticeKey = (runId: string) => `AGENT:${runId}`;
export const parseAgentNoticeKey = (key: string) => key.startsWith("AGENT:") && key.length > 6 ? key.slice(6) : null;

// ---------- the run's state and retries ----------

export const RUN_STATUSES = ["queued", "running", "done", "nothing", "skipped", "failed", "stopped"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const RUN_STATUS_LABEL: Record<RunStatus, { label: string; tone: "success" | "neutral" | "warning" | "danger" }> = {
  queued: { label: "Väntar", tone: "neutral" }, running: { label: "Pågår", tone: "warning" }, done: { label: "Klar", tone: "success" },
  nothing: { label: "Inget att rapportera", tone: "neutral" }, skipped: { label: "Hoppades över", tone: "neutral" },
  failed: { label: "Misslyckades", tone: "danger" }, stopped: { label: "Kontrollera innan du kör igen", tone: "danger" },
};
/** How long a claimed run may hold its lock before a later job counts it as stopped half-way. */
export const RUN_LOCK_MS = 10 * 60_000;
export const RUN_MAX_ATTEMPTS = 4;
const BACKOFF_MINUTES = [5, 15, 45];
/** Three failed runs in a row pause the mission, and the owner is mailed. */
export const FAILURE_STREAK_PAUSE = 3;
export const STOPPED_TEXT = "Körningen avbröts innan den var klar. Kontrollera det agenten kan ha skapat innan du kör igen.";

export type RunOutcome =
  | { kind: "done"; message: string }
  | { kind: "nothing"; message: string }
  /** A module off, Workflow AI off for an AI mission: nothing done, logged; the mission keeps its schedule. */
  | { kind: "skip"; message: string }
  /** Something that may work later (the network, Meta, Azure). */
  | { kind: "retry"; message: string }
  /** Something that will not work by itself (a right lost, a target gone). */
  | { kind: "fail"; message: string; pause?: boolean };

/** When a retry is tried again, or null after the last attempt. `attempts` counts the attempt just made. */
export function nextRunAttempt(attempts: number, now: Date): Date | null {
  if (attempts >= RUN_MAX_ATTEMPTS) return null;
  return new Date(now.getTime() + (BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)] ?? 5) * 60_000);
}

/** The run's next state after an attempt, and what it does to the mission's streak. Pure, so the job and the tests agree. */
export function settleRun(outcome: RunOutcome, attempts: number, now: Date, streak: number): { status: RunStatus; nextAttemptAt: Date | null; streak: number; pause: string | null } {
  if (outcome.kind === "done" || outcome.kind === "nothing") return { status: outcome.kind, nextAttemptAt: null, streak: 0, pause: null };
  if (outcome.kind === "skip") return { status: "skipped", nextAttemptAt: null, streak, pause: null };
  const retryAt = outcome.kind === "retry" ? nextRunAttempt(attempts, now) : null;
  if (retryAt) return { status: "queued", nextAttemptAt: retryAt, streak, pause: null };
  const next = streak + 1;
  const pause = outcome.kind === "fail" && outcome.pause ? outcome.message : next >= FAILURE_STREAK_PAUSE ? `Uppdraget pausades efter ${FAILURE_STREAK_PAUSE} misslyckade körningar i rad. Senaste orsaken: ${outcome.message}` : null;
  return { status: "failed", nextAttemptAt: null, streak: next, pause };
}

// ---------- feedback, once per channel ----------

export type FeedbackState = Partial<Record<FeedbackChannel, "sent" | "failed" | "skipped">>;
/** The chosen channels not yet sent (or skipped): a resend sends only these, never the post again. */
export const feedbackPending = (chosen: readonly FeedbackChannel[], state: FeedbackState) => chosen.filter((channel) => state[channel] !== "sent" && state[channel] !== "skipped");

// ---------- what a run did, and its links ----------

export type ActionKind = "work_order" | "post_draft" | "post_published" | "news_draft" | "news_published" | "report" | "notice_only";
export const LINK_TEXT: Record<ActionKind, string> = {
  work_order: "Öppna arbetsordern", post_draft: "Öppna utkast", post_published: "Visa inlägg", news_draft: "Öppna utkast", news_published: "Visa inlägg",
  report: "Visa hela rapporten", notice_only: "Visa hela rapporten",
};
/**
 * `proposed` (säkerhetsgranskningen 2026-11-24, G-07): a change Workflow AI asked for in a run, waiting for the owner's Godkänn
 * (`tool` and `args` stay on the server; `lines` say what would change); `rejected` when turned down. `decidedBy` names who did.
 */
export type RunAction = { kind: ActionKind; label: string; href: string; linkText: string; state?: "creating" | "done" | "proposed" | "rejected"; id?: string; reason?: string;
  tool?: string; args?: Record<string, unknown>; lines?: string[]; decidedBy?: string; decidedAt?: string };
export const action = (kind: ActionKind, label: string, href: string, extra: Partial<RunAction> = {}): RunAction => ({ kind, label, href, linkText: LINK_TEXT[kind], state: "done", ...extra });

/** The report: headings and rows (a row's title and link go in the e-mail; its detail only in Workflow). */
export type ReportRow = { title: string; detail?: string; href?: string };
export type RunReport = {
  title: string; summary: string; sections: { heading: string; rows: ReportRow[] }[];
  /** Rapportmallar (2026-11-21): the report template it was filled from (lib/agents/report-template.ts). */
  template?: string;
  /** Siffror: counts the rules made. */
  facts?: { label: string; value: string }[];
  /** Workflow AI's slot, marked as such; never a decision about electrical safety. */
  assessment?: { label: string; text: string } | null;
  nextSteps?: string[];
};
export const missionHref = (missionId: string) => `/?view=agents&mission=${encodeURIComponent(missionId)}`;
export const runHref = (missionId: string, runId: string) => `/?view=agents&mission=${encodeURIComponent(missionId)}&run=${encodeURIComponent(runId)}`;

/** The run's main link: what it made first, else its report. */
export function mainLink(actions: readonly RunAction[], report: { missionId: string; runId: string }): { href: string; text: string } {
  const made = actions.find((item) => item.kind !== "report" && item.kind !== "notice_only" && (item.state === undefined || item.state === "done"));
  return made ? { href: made.href, text: made.linkText } : { href: runHref(report.missionId, report.runId), text: LINK_TEXT.report };
}

// ---------- caution: Publicera automatiskt becomes a draft ----------

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /(\+46|\b0)[\s-]?\d{1,3}[\s-]?\d{2,3}[\s-]?\d{2}[\s-]?\d{2}\b/;
const ADDRESS = /\b[\p{Lu}][\p{L}-]*(gatan|vägen|gränd|torget|backen|stigen|allén|plan|leden|gata|väg)\s+\d+/u;
const POSTCODE = /\b\d{3}\s?\d{2}\s+[\p{Lu}]/u;
const PRICE = /(\d[\d\s]*(?:[.,]\d+)?\s*(kr|kronor|sek|:-|€|\$|%)|\b(pris|priset|kostar|kostnad|rabatt|offert|faktur)\w*)/i;
const SAFETY = /(elsäker\w*|säkerhet\w*|gränsvärde\w*|isolationsresistans|jordfel\w*|kortslutning\w*|utlösningstid\w*|\d+(?:[.,]\d+)?\s*(m?Ω|ohm|kv|ma|mΩ|MΩ)\b|\d+\s?(v|a)\b|besiktning\w*|godkänd\w*|farlig\w*|livsfara)/i;
const PROMISE = /\b(garanti\w*|garanterar|lovar|utlovar|alltid|aldrig mer|kostnadsfri\w*|gratis|senast\s+\d)/i;

export type CautionInput = {
  text: string;
  /** Names the basis held (customers, people, places, addresses): none of them may stand in a public text. */
  sensitive?: readonly string[];
  firstRun: boolean;
  /** The model said it was unsure, or the basis was thin or contradictory. */
  uncertain?: boolean;
  /** How many records the text was written from; nothing is a thin basis. */
  basisCount?: number;
};

/**
 * Why a text the owner chose to publish automatically is saved as a draft instead (2026-11-21: "Om man som användare
 * tillåter agenten så är det överordnat … men agenten ska vara försiktig och om den är osäker blir det bara ett utkast"). Empty: it
 * may be published. Always a draft on the mission's first run (also after a change of what it does, where it goes or its basis).
 */
export function cautionReasons(input: CautionInput): string[] {
  const text = input.text;
  const lower = text.toLocaleLowerCase("sv");
  const reasons: string[] = [];
  if (input.firstRun) reasons.push("Det är uppdragets första körning. Första gången sparas det alltid som utkast.");
  const named = (input.sensitive ?? []).map((name) => name.trim()).filter((name) => name.length >= 3).some((name) => lower.includes(name.toLocaleLowerCase("sv")));
  if (named || EMAIL.test(text) || PHONE.test(text) || ADDRESS.test(text) || POSTCODE.test(text)) reasons.push("Texten nämner kunder, personer eller kontaktuppgifter som inte ska vara publika.");
  if (PRICE.test(text)) reasons.push("Texten tar upp priser eller belopp.");
  if (SAFETY.test(text)) reasons.push("Texten tar upp elsäkerhet, mätvärden eller gränsvärden.");
  if (PROMISE.test(text)) reasons.push("Texten lovar något om arbetet.");
  if (input.uncertain || (input.basisCount !== undefined && input.basisCount < 1)) reasons.push("Underlaget var tunt eller osäkert.");
  return reasons;
}

/** What the run does with a text: publish only when the owner chose it and no caution applies. */
export function publishDecision(mode: PublishMode, reasons: readonly string[]): "publish" | "draft" {
  return mode === "auto" && !reasons.length ? "publish" : "draft";
}

/** The fields whose change makes the next run count as a first run (what, where, the basis). */
export const FIRST_RUN_FIELDS = ["templateKey", "instruction", "target", "scope"] as const;
export function changesWhatOrWhere(before: Pick<MissionDraft, (typeof FIRST_RUN_FIELDS)[number]>, after: Pick<MissionDraft, (typeof FIRST_RUN_FIELDS)[number]>) {
  return FIRST_RUN_FIELDS.some((field) => JSON.stringify(normalizeForCompare(before[field])) !== JSON.stringify(normalizeForCompare(after[field])));
}
const normalizeForCompare = (value: unknown): unknown => {
  if (Array.isArray(value)) return [...value].map(normalizeForCompare).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, inner]) => [key, normalizeForCompare(inner)]));
  return typeof value === "string" ? value.trim() : value;
};
/** The edit log's words for what changed (names of the parts, never their text). */
export const FIELD_LABEL: Record<string, string> = { name: "namnet", instruction: "vad agenten ska göra", templateKey: "mallen", scope: "underlaget", schedule: "när", target: "vad agenten skapar", feedback: "hur du får resultatet", recipients: "mottagarna", ownerId: "ägaren" };
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>) {
  return Object.keys(FIELD_LABEL).filter((key) => key in after && JSON.stringify(normalizeForCompare(before[key])) !== JSON.stringify(normalizeForCompare(after[key])));
}
