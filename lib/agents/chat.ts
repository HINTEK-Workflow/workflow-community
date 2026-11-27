import type { MissionCheck } from "./check";
import { AGENT_EVENTS, dateText, FEEDBACK_LABEL, missionScheduleText, RECIPIENT_ROLE_LABEL, SCHEDULE_KIND_LABEL, scheduleTimes, TARGET_LABEL, WEEKDAY_LABEL, type FeedbackChannel, type MissionDraft, type MissionSchedule } from "./model";
import { agentTemplate } from "./templates";
import { SOURCE_LABEL } from "./tool-policy";

/**
 * Uppdraget som ett samtal (2026-11-23): the mission page speaks like Workflow AI's window though Workflow's own rules answer. Pure:
 * what Workflow says after it has read the owner's words and checked the mission – what changed, what is refused and why, what
 * must be put right, the one thing it asks next with ready answers, or "Allt stämmer. Du kan spara." – and the choices as they
 * stand (När, Till vem, Resultat, Underlag) for the chips under the message. The page keeps the conversation only while it is open.
 */
const FEEDBACK_WORD: Record<FeedbackChannel, string> = { EMAIL: "e-post", NOTICE: "en notis", CHAT: "en sammanfattning i chatten" };
const joined = (items: readonly string[]) => items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} och ${items[items.length - 1]}`;
const lower = (text: string) => text.toLocaleLowerCase("sv");

/** The prompts a new mission's greeting offers. */
export const EXAMPLE_PROMPTS = [
  "Lista varje måndag kl. 7 arbetsordrar som saknar ansvarig, som e-post",
  "Sammanfatta veckans avvikelser varje fredag kl. 14, som notis",
  "Säg till när en arbetsorder har passerat Klart senast, som notis",
  "Skriv ett utkast till veckonyhet varje torsdag kl. 13",
] as const;
export const GREETING = "Hej! Skriv vad agenten ska göra, när och hur du vill få resultatet. Jag fyller i resten och kontrollerar uppdraget. Du kan också börja med ett av exemplen.";

/** What the agent does, in the owner's or the template's words. */
export function missionWhat(draft: MissionDraft) {
  const template = agentTemplate(draft.templateKey);
  if (draft.templateKey === "custom" || !template) return draft.instruction.trim() || "Du har inte skrivit vad agenten ska göra ännu.";
  return template.does;
}
/** How many more than the owner get it, in words ("alla administratörer och 2 kollegor"), or "". */
export function recipientsText(draft: MissionDraft, names: Readonly<Record<string, string>> = {}) {
  const roles = (draft.recipients?.roles ?? []).map((role) => lower(RECIPIENT_ROLE_LABEL[role]));
  const people = (draft.recipients?.userIds ?? []).map((userId) => names[userId]).filter(Boolean) as string[];
  const unnamed = (draft.recipients?.userIds.length ?? 0) - people.length;
  return joined([...roles, ...people, ...(unnamed > 0 ? [unnamed === 1 ? "en kollega" : `${unnamed} kollegor`] : [])]);
}
/** What, when and to whom in plain words. */
export function missionSentence(draft: MissionDraft, names: Readonly<Record<string, string>> = {}) {
  const others = recipientsText(draft, names);
  const what = missionWhat(draft).replace(/\s+$/, "");
  return [
    /[.!?]$/.test(what) ? what : `${what}.`,
    `Den körs ${lower(missionScheduleText(draft.schedule))}.`,
    draft.feedback.length ? `Du får resultatet som ${joined(draft.feedback.map((channel) => FEEDBACK_WORD[channel]))}${others ? `, och ${others} får det som e-post` : ""}.` : "Du har inte valt hur du får resultatet.",
  ].join(" ");
}

export type ChoiceKey = "when" | "who" | "result" | "basis";
export type MissionChoice = { key: ChoiceKey; label: string; value: string };
/** The choices as they stand, for the chips: När, Till vem, Resultat and (Med egna ord) Underlag. */
export function missionChoices(draft: MissionDraft, names: Readonly<Record<string, string>> = {}): MissionChoice[] {
  const others = recipientsText(draft, names);
  const who = draft.feedback.length ? `${joined(draft.feedback.map((channel) => FEEDBACK_LABEL[channel]))} till mig${others ? `, e-post till ${others}` : ""}` : "Inte valt";
  const template = agentTemplate(draft.templateKey);
  const sources = draft.templateKey === "custom" ? (draft.scope.sources?.length ? draft.scope.sources : ["work_orders" as const]) : template?.sources ?? [];
  return [
    { key: "when", label: "När", value: missionScheduleText(draft.schedule) },
    { key: "who", label: "Till vem", value: who },
    { key: "result", label: "Resultat", value: TARGET_LABEL[draft.target.kind] },
    { key: "basis", label: "Underlag", value: joined(sources.map((source) => SOURCE_LABEL[source])) || "Mallens eget" },
  ];
}

/** `field`: the part of the mission the question is about (its answer is read as words about that part). */
export type ChatQuestion = { field: "instruction" | "schedule" | "feedback" | "scope" | "target" | "channels"; text: string; replies: string[] };
const QUESTIONS = {
  feedback: { field: "feedback", text: "Hur vill du få resultatet?", replies: ["E-post", "Notis", "Chatten"] },
  schedule: { field: "schedule", text: "När ska agenten köras?", replies: ["Varje måndag kl. 7", "Varje vardag kl. 7", "Sista dagen i månaden kl. 16", "Varannan fredag kl. 14"] },
  target: { field: "target", text: "Ska agenten spara ett utkast eller publicera automatiskt?", replies: ["Spara som utkast", "Publicera automatiskt"] },
  channels: { field: "channels", text: "Var ska inlägget publiceras?", replies: ["Facebook", "Instagram", "LinkedIn"] },
} satisfies Record<string, ChatQuestion>;

/**
 * The one thing Workflow asks next, with ready answers: what the words left unsaid (`asked`, the fields Tolka could not read) or what
 * Kontrollera says is missing. A reply is sent as the owner's own words and read like any other message.
 */
export function chatQuestion(draft: MissionDraft, check: Pick<MissionCheck, "problems">, asked: readonly string[] = [], rounds: readonly string[] = []): ChatQuestion | null {
  const problem = (field: string) => check.problems.some((item) => item.field === field);
  if (draft.templateKey === "custom" && draft.instruction.trim().length < 10) return { field: "instruction", text: "Vad ska agenten göra? Skriv det med några ord.", replies: [] };
  if (asked.includes("schedule") || problem("schedule")) return QUESTIONS.schedule;
  if (!draft.feedback.length || asked.includes("feedback")) return QUESTIONS.feedback;
  if (asked.includes("scope") && rounds.length) return { field: "scope", text: "Vilken driftrond gäller det?", replies: rounds.slice(0, 6) };
  if (asked.includes("target")) return QUESTIONS.target;
  if (asked.includes("channels") || problem("channels")) return QUESTIONS.channels;
  return null;
}

export type ChatAnswer = { text: string; question: ChatQuestion | null; ok: boolean };
/**
 * Workflow's message after the words are read and the mission checked. Refusals first with their reason, then what changed (or,
 * the first time, how the words were read), then what must be put right in plain words, then one question – or that all is right.
 */
export function chatAnswer(input: {
  draft: MissionDraft; check: Pick<MissionCheck, "ok" | "problems" | "notes">; changes?: readonly string[]; denied?: readonly string[];
  /** The fields the words left unsaid (Tolka's questions). */
  asked?: readonly string[]; rounds?: readonly string[]; names?: Readonly<Record<string, string>>;
  /** The whole mission is said again (the first reading, or after Följ mallen igen). */
  whole?: boolean;
}): ChatAnswer {
  const lines: string[] = [];
  for (const reason of input.denied ?? []) lines.push(`Det gör agenten inte. ${reason}`);
  const changes = input.changes ?? [];
  // Korten visar vad som gäller (2026-11-23): the answer is short – that the cards are filled in, or the one thing that changed.
  if (input.whole || (!changes.length && !(input.denied ?? []).length)) lines.push("Jag har fyllt i korten.");
  else if (changes.length) lines.push(changes.join(" "));
  const question = (input.denied ?? []).length ? null : chatQuestion(input.draft, input.check, input.asked, input.rounds);
  // What the question already asks about is not said twice as a problem.
  const asking = question?.field ?? null;
  const problems = [...new Set(input.check.problems.filter((item) => item.field !== asking && !(asking === "instruction" && item.field === "name")).map((item) => item.message))]
    .filter((message) => !(input.denied ?? []).includes(message));
  if (problems.length) lines.push(problems.length === 1 ? `Det här behöver rättas först: ${problems[0]}` : `Det här behöver rättas först:\n${problems.map((message) => `• ${message}`).join("\n")}`);
  for (const note of input.check.notes) if (/Workflow AI|får inte resultatet|krediter/.test(note)) lines.push(note);
  const ok = input.check.ok && !question && !(input.denied ?? []).length;
  if (question) lines.push(question.text);
  else if (ok) lines.push("Allt stämmer. Du kan spara.");
  return { text: lines.join("\n\n"), question, ok };
}

/** A choice changed with its chip: one short sentence. */
export function choiceChanged(key: ChoiceKey, draft: MissionDraft, names: Readonly<Record<string, string>> = {}) {
  const choice = missionChoices(draft, names).find((item) => item.key === key)!;
  return `${choice.label} är nu: ${choice.value}.`;
}

// ---------- the cards: what Workflow sorted out of the words ----------

export const CARD_KEYS = ["what", "when", "basis", "result", "who"] as const;
export type CardKey = (typeof CARD_KEYS)[number];
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The cards a change touched: Vad, När, Underlag, Resultat, Till vem. */
export function changedCards(before: MissionDraft, after: MissionDraft): CardKey[] {
  const changed: CardKey[] = [];
  if (before.instruction.trim() !== after.instruction.trim() || before.templateKey !== after.templateKey || before.name.trim() !== after.name.trim()) changed.push("what");
  if (!same(before.schedule, after.schedule)) changed.push("when");
  if (!same(before.scope, after.scope)) changed.push("basis");
  if (!same(before.target, after.target)) changed.push("result");
  if (!same([...before.feedback].sort(), [...after.feedback].sort()) || !same(before.recipients, after.recipients)) changed.push("who");
  return changed;
}

/** A schedule as key words: "Fredag", "14:00", "Varje vecka". */
export function scheduleWords(schedule: MissionSchedule): string[] {
  if (schedule.kind === "event") return [AGENT_EVENTS[schedule.event]];
  const days = schedule.kind === "weekly" || schedule.kind === "biweekly" ? [...schedule.weekdays].sort((a, b) => a - b).map((day) => WEEKDAY_LABEL[day - 1]!) : [];
  const often = schedule.kind === "weekly" ? (days.length === 7 ? "Varje dag" : "Varje vecka") : schedule.kind === "once" ? dateText(schedule.date) : SCHEDULE_KIND_LABEL[schedule.kind];
  return [...(days.length === 7 ? [] : days), ...scheduleTimes(schedule), often];
}

/**
 * The key words Workflow understood in a message, for the small chips of its answer: what the changed cards now hold – the days, the
 * times and how often, the channels and recipients, what it makes, what it reads. Nothing for a card the words did not touch.
 */
export function understoodWords(before: MissionDraft, after: MissionDraft, names: Readonly<Record<string, string>> = {}): string[] {
  const changed = changedCards(before, after);
  const words: string[] = [];
  if (changed.includes("when")) words.push(...scheduleWords(after.schedule));
  if (changed.includes("who")) {
    words.push(...after.feedback.map((channel) => FEEDBACK_LABEL[channel]));
    words.push(...(after.recipients?.roles ?? []).map((role) => RECIPIENT_ROLE_LABEL[role]), ...(after.recipients?.userIds ?? []).map((userId) => names[userId]).filter((name): name is string => Boolean(name)));
  }
  if (changed.includes("result")) words.push(TARGET_LABEL[after.target.kind], ...(after.target.attachPdf && !before.target.attachPdf ? ["PDF"] : []));
  if (changed.includes("basis") && after.templateKey === "custom") words.push(...(after.scope.sources ?? []).filter((source) => !(before.scope.sources ?? []).includes(source) || before.templateKey !== "custom").map((source) => SOURCE_LABEL[source]));
  return [...new Set(words)].slice(0, 10);
}
