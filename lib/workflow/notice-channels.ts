import { z } from "zod";
import type { TaskNotification } from "@/lib/workflow/task-notifications";

/**
 * Notiser per e-post och push (2026-10-07): the reminders the bell already shows can also be sent as e-mail and as
 * web push – per person, opt-in, never prefilled. The bell itself is always on. A person picks the channels and which
 * kinds of notice they want; a member only ever gets their own, an admin the team's, because the notices are computed by
 * the bell's own rules (lib/workflow/task-notifications-server.ts). Pure: kinds, keys and selection; the sending is in
 * lib/workflow/notice-delivery.ts.
 */
export const NOTICE_KINDS = [
  { key: "DEADLINES", label: "Förfallna och snart förfallande uppgifter", description: "Arbetsordrar, riskbedömningar och protokoll vars sista datum närmar sig eller har passerat." },
  { key: "ACTION", label: "Uppgifter som behöver åtgärdas", description: "Uppgifter vars status är Behöver åtgärdas." },
  // Fas 1B (2026-10-08): a new kind, so it is off for everyone until they choose it (nothing is switched on for them).
  { key: "ASSIGNED", label: "Uppgifter som tilldelas dig", description: "När någon annan gör dig ansvarig för en arbetsorder eller annan uppgift." },
  // Plan 1M (2026-10-11): a new kind, off for everyone until they choose it.
  { key: "OBSTACLES", label: "Hinder på jobb", description: "När någon rapporterar hinder på ett jobb eller projekt som du ansvarar för." },
  // Användartest 2026-10-31: a new kind, off for everyone until they choose it.
  { key: "TEAM", label: "Teamet: bokningar, frånvaro och tid", description: "När någon bokar dig eller tar bort dig från en bokning, lägger in eller tar bort frånvaro, eller när en månads tid skickas in, tillbaka eller godkänns." },
  // Kommentarer (beslut 14, 2026-11-01): a new kind, off for everyone until they choose it.
  { key: "COMMENTS", label: "Kommentarer", description: "När någon nämner dig med @namn, eller skriver på ett jobb du följer." },
  { key: "URGENT", label: "Akuta arbetsordrar", description: "Öppna arbetsordrar som är markerade Akut." },
  { key: "ROUNDS", label: "Driftronder", description: "Ronder som ska göras i dag eller har missats." },
  { key: "FOLLOW_UP", label: "Uppföljning av avvikelser", description: "När en arbetsorder som skapats från en avvikelse är färdigställd och protokollet ska följas upp." },
  // Offert per e-post, steg E (2026-10-09): a new kind, off for everyone until they choose it.
  { key: "QUOTES", label: "Svar på offerter", description: "När en kund accepterar eller avböjer en offert via länken i e-posten." },
  { key: "SELF_INSPECTION", label: "Egenkontroll", description: "Årlig översyn, ny version av programmet att läsa, åtgärder, kompetens och kalibrering." },
  // S4 (2026-10-20): company admins who never saved their choices get it; for others it is off until they pick it.
  { key: "MACHINE_ALARM", label: "Maskinlarm", description: "När ett maskinlarm gett en automatisk arbetsorder, eller ett förslag väntar på godkännande. Du kan kvittera med Jag tar den." },
  { key: "NEWSLETTER_DRAFT", label: "Veckobrev att godkänna", description: "Bara för systemadministratören: ett veckobrev väntar på godkännande." },
  // Serveruppdateringar (2026-10-25): a new kind, off until chosen; the bell shows it to the superadmin anyway.
  { key: "SERVER_UPDATES", label: "Serveruppdateringar", description: "Bara för systemadministratören: säkerhetsuppdateringar eller omstart som väntat mer än tre dagar, eller avstängda automatiska uppdateringar." },
  // Felrapporter (2026-11-13): a new kind, off until chosen; the bell shows it to the superadmin anyway.
  { key: "ISSUE_REPORTS", label: "Felrapporter och förslag", description: "Bara för systemadministratören: när någon skickar Rapportera fel eller förslag." },
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number]["key"];
export const NOTICE_KIND_KEYS = NOTICE_KINDS.map((kind) => kind.key) as [NoticeKind, ...NoticeKind[]];
export const NOTICE_CHANNELS = ["EMAIL", "PUSH"] as const;
export type NoticeChannel = (typeof NOTICE_CHANNELS)[number];

/** The kinds a person may choose: the product kinds only for the installation's superadmin. */
const PRODUCT_KINDS = new Set<string>(["NEWSLETTER_DRAFT", "SERVER_UPDATES", "ISSUE_REPORTS"]);
export const availableNoticeKinds = (options: { superadmin: boolean }) => NOTICE_KINDS.filter((kind) => !PRODUCT_KINDS.has(kind.key) || options.superadmin);

/** What a person saves: nothing is on until they say so (an empty list means no kind). */
export const noticePreferenceInput = z.object({
  email: z.boolean(),
  kinds: z.array(z.enum(NOTICE_KIND_KEYS)).max(NOTICE_KIND_KEYS.length),
  /** Integrationsmotorn E6: maskinlarm även på natten (20–06), när företaget valt dygnet runt. Utelämnat = oförändrat. */
  machineAlarmNight: z.boolean().optional(),
  /** "Kräver åtgärd" med e-post och push (beslut 4): på från början, personen kan stänga av. Utelämnat = oförändrat. */
  requiredNotices: z.boolean().optional(),
});
export type NoticePreferenceInput = z.infer<typeof noticePreferenceInput>;
export const MACHINE_ALARM_NIGHT_LABEL = "Även på natten (20–06)";
export const MACHINE_ALARM_NIGHT_HINT = "Bara när företaget har valt maskinlarm dygnet runt. Annars kommer nattens larm i morgonlistan efter kl. 06.";

/** Stored kinds as known kinds, in the order of the list, each once (an unknown or no longer offered one is dropped). */
export function normalizeNoticeKinds(raw: unknown, allowed: readonly NoticeKind[] = NOTICE_KIND_KEYS): NoticeKind[] {
  const wanted = new Set(Array.isArray(raw) ? raw : []);
  return NOTICE_KIND_KEYS.filter((kind) => wanted.has(kind) && allowed.includes(kind));
}

/** Which kinds a notice belongs to; a task can be both overdue and in need of action, so it can belong to several. */
export function noticeKindsOf(item: Pick<TaskNotification, "kind" | "urgent" | "deadline" | "needsAction">): NoticeKind[] {
  if (item.kind === "NEWSLETTER_DRAFT") return ["NEWSLETTER_DRAFT"];
  if (item.kind === "SERVER_UPDATES") return ["SERVER_UPDATES"];
  if (item.kind === "ISSUE_REPORT") return ["ISSUE_REPORTS"];
  if (item.kind === "FOLLOW_UP") return ["FOLLOW_UP"];
  if (item.kind === "ASSIGNED") return ["ASSIGNED"];
  if (item.kind === "MACHINE_ALARM") return ["MACHINE_ALARM"];
  if (item.kind === "OBSTACLE") return ["OBSTACLES"];
  if (item.kind === "TEAM") return ["TEAM"];
  if (item.kind === "COMMENT") return ["COMMENTS"];
  if (item.kind === "QUOTE") return ["QUOTES"];
  if (item.kind === "ROUND") return ["ROUNDS"];
  if (item.kind === "SELF_INSPECTION") return ["SELF_INSPECTION"];
  const kinds: NoticeKind[] = [];
  if (item.urgent) kinds.push("URGENT");
  if (item.deadline) kinds.push("DEADLINES");
  if (item.needsAction) kinds.push("ACTION");
  return kinds;
}

export type NoticeStage = "urgent" | "overdue" | "soon" | "action" | "other";

/** A notice about planned work an absence touches (Frånvarokrock); its id ends with the absence. */
export const ABSENCE_CONFLICT_PREFIX = "ABSENCE_CONFLICT:";

/** How pressing a notice is now; a notice that becomes more pressing (soon → overdue) is a new notice to send. */
export function noticeStage(item: Pick<TaskNotification, "urgent" | "deadline" | "needsAction">): NoticeStage {
  if (item.urgent) return "urgent";
  if (item.deadline === "OVERDUE") return "overdue";
  if (item.deadline === "DUE_SOON") return "soon";
  return item.needsAction ? "action" : "other";
}

/**
 * The key a notice is sent once under, per person and channel: what it is about, how pressing it is and its date. The
 * same task due soon and later overdue are two notices (a person who was told it was due soon is told when it is late),
 * and a changed date is a new one; the same notice is never sent twice.
 */
export const noticeKey = (item: Pick<TaskNotification, "id" | "urgent" | "deadline" | "needsAction" | "dueDate">) =>
  // An assignment is told once per assignment (its id carries the time); a changed date is not a new assignment. An absence
  // conflict is told once per absence: its date is the first job left, which moves day by day as the absence goes on.
  item.id.startsWith(ABSENCE_CONFLICT_PREFIX) || item.id.startsWith("ASSIGNED:") || item.id.startsWith("MACHINE_ALARM:") || item.id.startsWith("QUOTE:") || item.id.startsWith("OBSTACLE:") || item.id.startsWith("ROUND_NOT_DONE:") || item.id.startsWith("TEAM:") || item.id.startsWith("COMMENT:") ? item.id : `${item.id}|${noticeStage(item)}|${item.dueDate}`;

/**
 * The notices to send now over one channel: those of a kind the person chose and that were not sent before. Nothing is
 * chosen by default, so a person without kinds gets nothing.
 */
export function noticesToSend<T extends Pick<TaskNotification, "id" | "kind" | "urgent" | "deadline" | "needsAction" | "dueDate">>(items: readonly T[], kinds: readonly NoticeKind[], sent: ReadonlySet<string>, /** Goes whatever the kinds: "Kräver åtgärd" from the start (beslut 4). */ always?: (item: T) => boolean): T[] {
  if (!kinds.length && !always) return [];
  const chosen = new Set<NoticeKind>(kinds);
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!noticeKindsOf(item).some((kind) => chosen.has(kind)) && !always?.(item)) return false;
    const key = noticeKey(item);
    if (sent.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The notice's state in words, for the e-mail line and the push text. */
export function noticeStateText(item: Pick<TaskNotification, "kind" | "urgent" | "deadline" | "needsAction" | "dueDate" | "assignedBy" | "decision" | "machineAlarm"> & { id?: string }, today: string) {
  if (item.kind === "QUOTE") return item.decision === "ACCEPTED" ? "Accepterad av kunden" : "Avböjd av kunden";
  if (item.kind === "NEWSLETTER_DRAFT") return "Väntar på godkännande";
  if (item.kind === "SERVER_UPDATES") return `Sedan ${item.dueDate}`;
  if (item.kind === "ISSUE_REPORT") return `Skickad ${item.dueDate}`;
  if (item.kind === "ASSIGNED") return `Tilldelad dig${item.assignedBy ? ` av ${item.assignedBy}` : ""}${item.dueDate ? `, klart senast ${item.dueDate}` : ""}`;
  if (item.kind === "MACHINE_ALARM") return item.machineAlarm?.taskId === null ? "Förslag väntar på godkännande" : "Automatisk arbetsorder, ingen ansvarig";
  if (item.kind === "OBSTACLE") return `Hinder rapporterat${item.assignedBy ? ` av ${item.assignedBy}` : ""}`;
  if (item.kind === "TEAM") return item.needsAction ? "Väntar på dig" : "Händelse i teamet";
  // Never the comment's text in a mail or on a lock screen: who wrote, and the person opens the job to read it.
  if (item.kind === "COMMENT") return `Kommentar${item.assignedBy ? ` av ${item.assignedBy}` : ""}`;
  if (item.kind === "FOLLOW_UP") return "Följ upp avvikelsen";
  // Ej utfört (2026-10-28): someone recorded that a round's occurrence will not be done (lib/workflow/round-outcome.ts).
  if (item.kind === "ROUND" && item.id?.startsWith("ROUND_NOT_DONE:")) return `Ej utfört (${item.dueDate})${item.assignedBy ? ` – markerat av ${item.assignedBy}` : ""}`;
  if (item.kind === "ROUND") return item.deadline === "OVERDUE" ? `Missad rond (${item.dueDate})` : "Ska göras i dag";
  if (item.urgent) return "Akut arbetsorder";
  if (item.deadline === "OVERDUE") return `Förfallen (${item.dueDate})`;
  if (item.deadline === "DUE_SOON") return item.dueDate === today ? "Förfaller i dag" : `Klart senast ${item.dueDate}`;
  if (item.needsAction) return "Behöver åtgärdas";
  return "";
}
