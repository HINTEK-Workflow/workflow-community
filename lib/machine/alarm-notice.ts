import type { TaskNotification } from "@/lib/workflow/task-notifications";
import { SIM_TEXT_PREFIX } from "@/lib/machine/simulator/limits";

/**
 * Notis med kvittens för maskinlarm (S4). Samma mönster som "Tilldelad dig" (lib/workflow/task-assignment-notice.ts):
 * ingen egen tabell, en rad i NoticeDelivery med kanalen "MACHINE_ALARM" och nyckeln
 * `MACHINE_ALARM:<arbetsorderns id>|<källans id>` (ett förslag som väntar har `p-<radens id>` i stället för orderns id).
 * Raden finns medan notisen är oläst; en kvittens, en färdig order eller ett beslut om förslaget tar bort den.
 * Rent: nycklar, vem som notiseras, kvittensvillkoret och klockans rader. Databasen finns i alarm-notice-store.ts.
 */
export const MACHINE_ALARM_CHANNEL = "MACHINE_ALARM";
export const MACHINE_ALARM_PREFIX = "MACHINE_ALARM:";
/** Högst så många olästa larmnotiser läses för en person. */
export const MACHINE_ALARM_LIMIT = 50;
/** Notistypen i personens val (lib/workflow/notice-channels.ts). */
export const MACHINE_ALARM_KIND = "MACHINE_ALARM";
const PENDING_REF = "p-";

export const alarmRef = (input: { taskId: string } | { pendingRowId: string }) => "taskId" in input ? input.taskId : `${PENDING_REF}${input.pendingRowId}`;
export const alarmKeyPrefix = (ref: string) => `${MACHINE_ALARM_PREFIX}${ref}|`;
export const alarmKey = (ref: string, sourceId: string) => `${alarmKeyPrefix(ref)}${sourceId}`;

export type ParsedAlarmKey = { ref: string; sourceId: string; pending: boolean; taskId: string | null; rowId: string | null };
export function parseAlarmKey(key: string): ParsedAlarmKey | null {
  if (!key.startsWith(MACHINE_ALARM_PREFIX)) return null;
  const [ref, sourceId, ...rest] = key.slice(MACHINE_ALARM_PREFIX.length).split("|");
  if (!ref || !sourceId || rest.length) return null;
  const pending = ref.startsWith(PENDING_REF);
  const id = pending ? ref.slice(PENDING_REF.length) : ref;
  if (!id) return null;
  return { ref, sourceId, pending, taskId: pending ? null : id, rowId: pending ? id : null };
}

export type AlarmMember = { userId: string; admin: boolean; canReadWorkOrders: boolean; /** Underhåll – läsa: the machines' own right (2026-11-05). */ canReadMachines: boolean };

/**
 * Vem som notiseras (2026-11-05): de som har behörighet till maskinerna, det vill säga företagets ägare och
 * administratörer och de med Underhåll – läsa. De har typen på från början och kan välja bort den genom att spara sina val
 * utan den. Den som får arbetsordern får också sin vanliga notis "Tilldelad dig". Ett förslag som väntar på godkännande går
 * bara till administratörer (de enda som kan godkänna). `choices` har personens sparade val, om de har sparat några.
 */
export function alarmRecipients(input: { members: readonly AlarmMember[]; choices: ReadonlyMap<string, readonly string[]>; pending: boolean }): string[] {
  return [...new Set(input.members.flatMap((member) => {
    const saved = input.choices.get(member.userId);
    if (!member.admin && (input.pending || !member.canReadMachines)) return [];
    return !saved || saved.includes(MACHINE_ALARM_KIND) ? [member.userId] : [];
  }))].sort();
}

export type ClaimFacts = { status: string; assignedToUserId: string | null; assignedToName: string };
export type ClaimDecision = { result: "claim" } | { result: "mine" } | { result: "taken"; by: string } | { result: "closed" };

/** Kvittensvillkoret: en order som är färdig eller utgången kvitteras inte, och bara den första får den. */
export function claimDecision(task: ClaimFacts, userId: string): ClaimDecision {
  if (task.status === "COMPLETED" || task.status === "CANCELLED") return { result: "closed" };
  if (!task.assignedToUserId) return { result: "claim" };
  if (task.assignedToUserId === userId) return { result: "mine" };
  return { result: "taken", by: task.assignedToName.trim() || "en kollega" };
}

export const claimTakenText = (by: string) => `${by} hann före och tar ordern. Du behöver inte göra något.`;
export const claimClosedText = "Ordern är redan färdig eller utgången.";
export const claimNote = (name: string) => `${name || "En kollega"} kvitterade larmet (Jag tar den) och blev ansvarig.`;

export const SIMULATED_LABEL = "Simulerat";
/** A fault report's notice text starts with this (lib/operator/on-call-store.ts) and is labelled Felanmälan, not Maskinlarm. */
export const FAULT_TEXT_PREFIX = "Felanmälan";
export const FAULT_LABEL = "Felanmälan";
/** Larmet i ord. Simulatorns märkning "Simulerat: " blir notisens etikett i stället för att stå i meningen. */
function alarmWords(alarm: { text: string; code: string }) {
  const simulated = alarm.text.startsWith(SIM_TEXT_PREFIX);
  const text = oneLine(simulated ? alarm.text.slice(SIM_TEXT_PREFIX.length) : alarm.text, 120) || oneLine(alarm.code, 40) || "larm";
  return { text, simulated };
}

/** Larmtexten är skriven av en maskin: en rad utan formatering (som sammandraget kräver, notice-digest.ts). */
const oneLine = (value: string, max: number) => value.replace(/[\r\n*[\]()]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, max);

export type AlarmNoticeRow = {
  key: string;
  createdAt: Date;
  alarm: { sourceName: string; text: string; code: string } | null;
  task: { id: string; status: string; dueDate: string; assignedToUserId: string | null } | null;
  /** Sant om förslaget fortfarande väntar (bara för rader utan order). */
  pendingOpen: boolean;
};

/**
 * Klockans rader. En order visas bara medan den är öppen och ingen är ansvarig; ett förslag medan det väntar.
 * Den som kan kvittera (`canAck`) får knappen Kvittera, ett förslag leder till sidan där det godkänns.
 */
export function alarmNotifications(rows: readonly AlarmNoticeRow[], options: { canAck: boolean }): TaskNotification[] {
  return rows.flatMap((row): TaskNotification[] => {
    const parsed = parseAlarmKey(row.key);
    if (!parsed || !row.alarm) return [];
    const source = oneLine(row.alarm.sourceName, 60) || "maskinen";
    const { text, simulated } = alarmWords(row.alarm);
    // A fault report from the operator page is called what it is, not a larm (kundresa 2026-11-07, L48).
    const fault = text.startsWith(FAULT_TEXT_PREFIX);
    const base = fault ? `${text} – ${source}` : `Larm från ${source}: ${text}`;
    const id = `${MACHINE_ALARM_PREFIX}${parsed.ref}:${row.createdAt.getTime()}`;
    const common = { id, kind: "MACHINE_ALARM" as const, dueDate: "", deadline: null, needsAction: false, assignedAt: row.createdAt.toISOString(), ...(simulated ? { label: SIMULATED_LABEL } : fault ? { label: FAULT_LABEL } : {}) };
    if (parsed.pending) {
      if (!row.pendingOpen) return [];
      return [{ ...common, title: `${base}.`, detail: "Ett förslag till arbetsorder väntar på godkännande.", href: "/?view=advanced&section=machines", machineAlarm: { taskId: null, canAck: false } }];
    }
    const task = row.task;
    if (!task || task.id !== parsed.taskId || task.assignedToUserId || task.status === "COMPLETED" || task.status === "CANCELLED") return [];
    return [{ ...common, title: `${base}. Arbetsorder skapad.`, detail: "Ingen är ansvarig än.", href: `/?view=workflow_task&taskId=${encodeURIComponent(task.id)}&taskType=WORK_ORDER`, machineAlarm: { taskId: task.id, canAck: options.canAck } }];
  }).sort((a, b) => (b.assignedAt ?? "").localeCompare(a.assignedAt ?? "") || a.id.localeCompare(b.id));
}

export const alarmToastText = (item: Pick<TaskNotification, "title" | "detail">) => [item.title, item.detail].filter(Boolean).join(" ");

/**
 * Ett larm som inte gav någon arbetsorder (2026-11-05): det ska också synas i klockan, med orsaken. Samma mönster utan egen
 * tabell, en rad i NoticeDelivery per person. Den försvinner inte av en kvittens, utan läses som andra notiser och gäller en vecka.
 * Simulatorns larm går bara till den som kör simulatorn (den som senast skapade källans nyckel), märkta Simulerat.
 */
export const MACHINE_NOTE_CHANNEL = "MACHINE_ALARM_NOTE";
const MACHINE_NOTE_PREFIX = "MACHINE_NOTE:";
export const MACHINE_NOTE_DAYS = 7;
export const MACHINE_NOTE_LIMIT = 50;
/** Högst en notis per källa och orsak under så här lång tid: en maskin kan larma ofta, och ett prov i simulatorn ska synas snabbare. */
export const MACHINE_NOTE_QUIET_MS = { real: 3_600_000, simulated: 60_000 } as const;
export const SIM_RUNNER_CHANNEL = "MACHINE_SIM_RUNNER";
export const simRunnerKey = (sourceId: string) => `${SIM_RUNNER_CHANNEL}:${sourceId}`;

export const ALARM_NOTE_REASONS = {
  off: "Ingen arbetsorder skapades, eftersom källan står på Av.",
  level: "Ingen arbetsorder skapades, eftersom larmets nivå är lägre än fel.",
  cooldown: "Ingen ny arbetsorder skapades, eftersom samma maskin nyss fick en.",
  cap: "Ingen arbetsorder skapades, eftersom dagens gräns för företaget är nådd.",
  open: "Ingen ny arbetsorder skapades, eftersom en redan är öppen.",
} as const;
export type AlarmNoteReason = keyof typeof ALARM_NOTE_REASONS;

export const alarmNoteSourcePrefix = (sourceId: string, reason: AlarmNoteReason) => `${MACHINE_NOTE_PREFIX}${sourceId}|${reason}|`;
export const alarmNoteKey = (input: { sourceId: string; reason: AlarmNoteReason; eventId: string; taskId?: string | null }) => `${alarmNoteSourcePrefix(input.sourceId, input.reason)}${input.eventId}|${input.taskId ?? ""}`;
export function parseAlarmNoteKey(key: string) {
  if (!key.startsWith(MACHINE_NOTE_PREFIX)) return null;
  const [sourceId, reason, eventId, taskId, ...rest] = key.slice(MACHINE_NOTE_PREFIX.length).split("|");
  if (!sourceId || !eventId || rest.length || !Object.hasOwn(ALARM_NOTE_REASONS, reason ?? "")) return null;
  return { sourceId, reason: reason as AlarmNoteReason, eventId, taskId: taskId || null };
}

/** Klockans rader för larm utan arbetsorder. `taskHref` finns när en redan öppen order går att öppna; annars leder raden till maskinerna. */
export function alarmNoteNotifications(rows: readonly { key: string; createdAt: Date; alarm: { sourceName: string; text: string; code: string } | null; taskHref?: string | null }[], options: { machinesHref: string }): TaskNotification[] {
  return rows.flatMap((row): TaskNotification[] => {
    const parsed = parseAlarmNoteKey(row.key);
    if (!parsed || !row.alarm) return [];
    const { text, simulated } = alarmWords(row.alarm);
    return [{
      id: row.key, kind: "MACHINE_NOTE", title: `Larm från ${oneLine(row.alarm.sourceName, 60) || "maskinen"}: ${text}.`, detail: ALARM_NOTE_REASONS[parsed.reason],
      href: row.taskHref || options.machinesHref, dueDate: "", deadline: null, needsAction: false, assignedAt: row.createdAt.toISOString(), ...(simulated ? { label: SIMULATED_LABEL } : {}),
    }];
  }).sort((a, b) => (b.assignedAt ?? "").localeCompare(a.assignedAt ?? "") || a.id.localeCompare(b.id));
}
