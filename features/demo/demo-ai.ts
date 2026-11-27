import { isTaskOpen } from "@/lib/workflow/task-cancel";
import { JOB_STATUS_LABELS } from "@/lib/workflow/job-state";
import { formatSwedish, swedishDayKey } from "@/lib/swedish-time";

/**
 * Workflow AI in the public demo (2026-11-22): the real chat window with Manuellt | Auto, but every answer is a ready example built
 * in this browser from the invented company's own data. No AI provider is ever called and nothing is saved; Auto only says what it
 * would do in Workflow. A question the demo has no example for gets the list of questions it does have.
 */
export const DEMO_CHAT_QUESTIONS = ["Vilka arbetsordrar är öppna?", "Vad har jag i dag?", "Vad är förfallet?", "Hur gör jag ett fakturaunderlag?"] as const;
export const DEMO_CHAT_STATUS_LINE = "Exempelsvar i demon";
export const DEMO_CHAT_MARK = "**Exempelsvar i demon.** Svaret bygger på demoföretagets påhittade uppgifter. Ingen AI anropas och inget sparas.";
export const DEMO_CHAT_AUTO = "**Auto visas bara i demon.** I Workflow gör Workflow AI uppgiften direkt och ger dig en länk och Ångra. Här görs ingenting, så du får samma svar som i Manuellt.";

export type DemoChatTask = { id: string; kind: string; title: string; status: string; dueDate: string; plannedStartDate?: string; assignedToUserId: string | null; customerName: string };
export type DemoChatActivity = { title: string; startsAt: string; endsAt: string; status: string; userIds: string[]; deleted: boolean };
export type DemoChatInput = {
  question: string; mode: "manual" | "auto"; now: Date; userId: string;
  /** The work the person may read, already narrowed to their own when they do not see the team (as the lists). */
  tasks: DemoChatTask[]; activities: DemoChatActivity[];
};
export type DemoChatCitation = { resourceType: string; resourceId: string; title: string; description: string; href: string; citationLabel: string };
export type DemoChatAnswer = { topic: "work_orders" | "today" | "overdue" | "invoice_basis" | "unknown"; content: string; citations: DemoChatCitation[] };

const LIST_LIMIT = 6;
const taskHref = (task: Pick<DemoChatTask, "id" | "kind">) => `/?view=workflow_task&taskId=${encodeURIComponent(task.id)}&taskType=${task.kind}`;
const day = (key: string) => formatSwedish(`${key}T12:00:00Z`, { day: "numeric", month: "short" });
const clock = (iso: string) => formatSwedish(iso, { hour: "2-digit", minute: "2-digit" });
const taskCitation = (task: DemoChatTask): DemoChatCitation => ({ resourceType: task.kind, resourceId: task.id, title: task.title, description: "", href: taskHref(task), citationLabel: task.title });
const pageCitation = (view: string, label: string): DemoChatCitation => ({ resourceType: "PAGE", resourceId: view, title: label, description: "", href: `/?view=${view}`, citationLabel: label });
const row = (task: DemoChatTask) => `- ${task.title} · ${JOB_STATUS_LABELS[task.status] ?? task.status}${task.customerName ? ` · ${task.customerName}` : ""}${task.dueDate ? ` · klart senast ${day(task.dueDate)}` : ""}`;
const more = (count: number) => count > LIST_LIMIT ? [`- och ${count - LIST_LIMIT} till`] : [];

/** Which example a question asks for; the words a visitor is likely to type, not only the buttons' exact text. */
export function demoChatTopic(question: string): DemoChatAnswer["topic"] {
  const text = question.toLocaleLowerCase("sv-SE").replace(/[?!.,]/g, " ");
  if (/faktur/.test(text)) return "invoice_basis";
  if (/förfall|försen/.test(text)) return "overdue";
  if (/\bi ?dag\b|idag|dagens|vad har jag/.test(text)) return "today";
  if (/arbetsorder|uppgift|öppn|pågå/.test(text)) return "work_orders";
  return "unknown";
}

/** The example answer for one question, marked as an example; Auto says first that nothing is done in the demo. */
export function demoChatAnswer(input: DemoChatInput): DemoChatAnswer {
  const topic = demoChatTopic(input.question);
  const today = swedishDayKey(input.now);
  const open = input.tasks.filter((task) => isTaskOpen(task.status));
  let body: string[];
  let citations: DemoChatCitation[] = [];
  if (topic === "work_orders") {
    const orders = open.filter((task) => task.kind === "WORK_ORDER").sort((left, right) => (left.dueDate || "9999").localeCompare(right.dueDate || "9999"));
    body = orders.length
      ? [`Det finns ${orders.length} öppna arbetsordrar, den som ska vara klar först överst:`, ...orders.slice(0, LIST_LIMIT).map(row), ...more(orders.length)]
      : ["Det finns inga öppna arbetsordrar just nu."];
    citations = [...orders.slice(0, 3).map(taskCitation), pageCitation("work_orders", "Arbetsordrar")];
  } else if (topic === "today") {
    const booked = input.activities.filter((activity) => !activity.deleted && activity.status !== "CANCELED" && activity.userIds.includes(input.userId) && swedishDayKey(activity.startsAt) === today)
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
    const due = open.filter((task) => task.assignedToUserId === input.userId && (task.dueDate === today || task.plannedStartDate === today));
    body = [
      ...(booked.length ? ["Planerat i dag:", ...booked.map((activity) => `- ${clock(activity.startsAt)}–${clock(activity.endsAt)} ${activity.title}`)] : ["Inget är planerat i kalendern i dag."]),
      ...(due.length ? ["Ska börja eller vara klart i dag:", ...due.slice(0, LIST_LIMIT).map(row), ...more(due.length)] : []),
    ];
    citations = [...due.slice(0, 3).map(taskCitation), pageCitation("planning", "Planering")];
  } else if (topic === "overdue") {
    const late = open.filter((task) => task.dueDate && task.dueDate < today).sort((left, right) => left.dueDate.localeCompare(right.dueDate));
    body = late.length
      ? [`${late.length === 1 ? "En uppgift har" : `${late.length} uppgifter har`} passerat Klart senast:`, ...late.slice(0, LIST_LIMIT).map(row), ...more(late.length)]
      : ["Inget är förfallet. Alla öppna uppgifter ligger inom sitt datum."];
    citations = [...late.slice(0, 3).map(taskCitation), pageCitation("tasks", "Uppgifter")];
  } else if (topic === "invoice_basis") {
    body = [
      "Så gör du ett fakturaunderlag:",
      "1. Öppna en färdigställd arbetsorder eller ett projekt.",
      "2. Välj Fakturaunderlag och sedan Nytt fakturaunderlag. Tid × timpris, material och utgifter fylls i från arbetet.",
      "3. Kontrollera raderna och ändra det som behövs. Beloppen är exklusive moms.",
      "4. Exportera underlaget eller markera det som fakturerat.",
      "Du kan också starta ett tomt underlag med Nytt fakturaunderlag på sidan Fakturaunderlag.",
    ];
    citations = [pageCitation("invoice_bases", "Fakturaunderlag")];
  } else {
    body = ["Demon har färdiga exempelsvar på några vanliga frågor. Prova någon av dem:", ...DEMO_CHAT_QUESTIONS.map((question) => `- ${question}`), "I Workflow svarar Workflow AI på dina egna frågor om ditt arbete."];
  }
  const content = [...(input.mode === "auto" ? [DEMO_CHAT_AUTO, ""] : []), ...body, "", DEMO_CHAT_MARK].join("\n");
  return { topic, content, citations };
}
