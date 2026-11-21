import { plural } from "@/lib/plural";
import { hasWorkflowPermission, type WorkflowPermissionProfile } from "@/lib/workflow/permissions";
import { canSeePrices } from "@/lib/workflow/material-prices";
import { effectiveQuoteStatus, type QuoteStatus } from "@/lib/quotes/model";
import { addDays, daysBetween, shortDay } from "@/lib/workflow/schedule";
import { isDeviationOverdue } from "@/lib/self-inspection/model";
import { listHref } from "@/lib/url-filters";
import { isLateTask } from "@/lib/workflow/late-tasks";
import { organizationModuleOn } from "@/lib/workflow/modules";

/**
 * Översikt – Kunder with real data (2026-10-28, 0.29.0; reworked 2026-10-29 the same way as Jag and Teamet): which
 * customers need attention now, what is going on at each customer and what is only information. Pure rules shared by
 * lib/overview/customers-server.ts, the demo (features/demo/demo-overview.ts) and the tests: who may open the tab and its
 * parts, a quote's answer state, a work order's day in the coming week, how the per-customer figures are merged and ordered,
 * a customer's state and progression, the list Kräver åtgärd and the headline. Nothing here reads or writes.
 */

type Caller = { admin: boolean; workflowPermissions: WorkflowPermissionProfile; organization?: { disabledModules?: readonly string[] | null } | null };

export type CustomersTabAccess = {
  customers: boolean; workOrders: boolean; quotes: boolean; prices: boolean;
  /**
   * The deviation log's own rule (lib/self-inspection, as Teamet): an admin reads the whole log, anyone else what they
   * reported or are responsible for. Only entries tied to a customer (through their work order or protocol) are counted.
   */
  deviationsCompany: boolean;
};

/** Kunder needs the customer register (customers:read, or admin); each part still follows its module's read right. */
export function customersTabAccess(ctx: Caller): CustomersTabAccess {
  // Företagets moduler (0.39.0): the tab needs Kunder; its sale figures need Offerter or Fakturaunderlag.
  const on = (key: Parameters<typeof organizationModuleOn>[1]) => organizationModuleOn(ctx.organization, key);
  const customers = on("customers") && (ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "customers", "read"));
  const quotes = customers && (on("quotes") || on("invoicing")) && (ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "quotes", "read"));
  return {
    customers,
    workOrders: customers && (ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, "work-order", "read")),
    // Invoice bases follow the quotes right (lib/invoice-basis/server.ts), and their sums the price right.
    quotes,
    prices: quotes && canSeePrices({ admin: ctx.admin, permissions: ctx.workflowPermissions }),
    deviationsCompany: customers && ctx.admin,
  };
}

/** The lists the tab's figures open (the same in Cloud and the demo). */
export const CUSTOMERS_LINKS = {
  register: "/?view=customers",
  openWorkOrders: listHref("tasks", { type: "work_orders", filter: "open", scope: "all" }),
  overdueWorkOrders: listHref("tasks", { type: "work_orders", filter: "overdue", scope: "all" }),
  quotes: listHref("quotes", { filter: "SENT" }),
  deviations: "/?view=deviations&filter=open",
  invoiceDrafts: listHref("invoice_bases", { filter: "DRAFT" }),
};

/** What the page is told about the person's rights (it leaves out what is null; the server already did). */
export const customersAccessRights = (access: CustomersTabAccess) => ({ workOrders: access.workOrders, quotes: access.quotes, prices: access.prices, deviations: access.deviationsCompany ? "company" as const : "own" as const });

/** How soon a sent quote's Giltig till counts as "går ut snart", in days. */
export const QUOTE_EXPIRY_DAYS = 14;
/** How far ahead Närmaste veckan looks, in days (today included). */
export const UPCOMING_DAYS = 7;
/** The window of a customer's progression: work orders färdigställda within it count as done, in days. */
export const RECENT_DAYS = 30;

/**
 * A quote's answer state as the quote list reads it (effectiveQuoteStatus): a sent quote that has not passed its Giltig till
 * waits for an answer, and goes out soon within `QUOTE_EXPIRY_DAYS`. Anything else is not waiting.
 */
export function quoteAnswerState(quote: { status: QuoteStatus; validUntil: string }, today: string): "expiringSoon" | "awaiting" | null {
  if (effectiveQuoteStatus(quote, today) !== "SENT") return null;
  return quote.validUntil && quote.validUntil <= addDays(today, QUOTE_EXPIRY_DAYS) ? "expiringSoon" : "awaiting";
}

/** An open work order's state on the Kunder tab: late (the job list's Förfallna rule), marked Behöver åtgärdas, or neither. */
export function workOrderState(task: { status: string; dueDate: string }, today: string): "overdue" | "needsAction" | "open" | "closed" {
  if (task.status === "COMPLETED" || task.status === "CANCELLED") return "closed";
  if (isLateTask(task, today)) return "overdue";
  return task.status === "NEEDS_ACTION" ? "needsAction" : "open";
}

/**
 * The day an open work order comes up in Närmaste veckan: its planned start, else its Klart senast, when that day is within
 * `UPCOMING_DAYS` from today. A late one or one marked Behöver åtgärdas is in Kräver åtgärd instead; null otherwise.
 */
export function upcomingDay(task: { status: string; dueDate: string; plannedStartDate: string }, today: string): { day: string; starts: boolean } | null {
  if (workOrderState(task, today) !== "open") return null;
  const day = task.plannedStartDate || task.dueDate;
  if (!day || day < today || day > addDays(today, UPCOMING_DAYS - 1)) return null;
  return { day, starts: Boolean(task.plannedStartDate) };
}

export type WorkOrderStat = {
  customerId: string; open: number; overdue: number; rounds: number; lastCompletedOn: string | null;
  /** Open and Pågår; marked Behöver åtgärdas but not late; färdigställda within RECENT_DAYS; coming up in Närmaste veckan. */
  inProgress: number; needsAction: number; completedRecent: number; upcoming: number;
  /** The next open work order's day (planned start, else Klart senast) from today on. */
  nextOn: string | null;
};
export type QuoteStat = { customerId: string; awaiting: number; expiringSoon: number };
export type InvoiceStat = { customerId: string; drafts: number; net: number };
export type DeviationStat = { customerId: string; open: number; overdue: number };

/** The per-customer figures of the work orders, one pass (the demo; Cloud sums the same in SQL). */
export function workOrderStats(tasks: readonly { customerId: string; status: string; dueDate: string; plannedStartDate: string; roundScheduleId: string | null; completedOn: string | null }[], today: string): WorkOrderStat[] {
  const stats = new Map<string, WorkOrderStat>();
  const since = addDays(today, -RECENT_DAYS);
  for (const task of tasks) {
    const stat = stats.get(task.customerId) ?? { customerId: task.customerId, open: 0, overdue: 0, rounds: 0, lastCompletedOn: null, inProgress: 0, needsAction: 0, completedRecent: 0, upcoming: 0, nextOn: null };
    const state = workOrderState(task, today);
    if (state !== "closed") {
      stat.open += 1;
      if (state === "overdue") stat.overdue += 1;
      if (state === "needsAction") stat.needsAction += 1;
      if (task.status === "IN_PROGRESS") stat.inProgress += 1;
      if (task.roundScheduleId) stat.rounds += 1;
      if (upcomingDay(task, today)) stat.upcoming += 1;
      const day = task.plannedStartDate || task.dueDate;
      if (day && day >= today && (!stat.nextOn || day < stat.nextOn)) stat.nextOn = day;
    }
    if (task.status === "COMPLETED" && task.completedOn) {
      if (!stat.lastCompletedOn || task.completedOn > stat.lastCompletedOn) stat.lastCompletedOn = task.completedOn;
      if (task.completedOn >= since) stat.completedRecent += 1;
    }
    stats.set(task.customerId, stat);
  }
  return [...stats.values()];
}

/** Quotes counted per customer: every waiting quote, and of them the ones that go out soon. */
export function quoteStats(quotes: readonly { customerId: string; status: QuoteStatus; validUntil: string }[], today: string): QuoteStat[] {
  const stats = new Map<string, QuoteStat>();
  for (const quote of quotes) {
    const state = quoteAnswerState(quote, today);
    if (!state) continue;
    const stat = stats.get(quote.customerId) ?? { customerId: quote.customerId, awaiting: 0, expiringSoon: 0 };
    stat.awaiting += 1;
    if (state === "expiringSoon") stat.expiringSoon += 1;
    stats.set(quote.customerId, stat);
  }
  return [...stats.values()];
}

/** Draft invoice bases counted and summed (exkl. moms) per customer. */
export function invoiceStats(bases: readonly { customerId: string; net: number }[]): InvoiceStat[] {
  const stats = new Map<string, InvoiceStat>();
  for (const basis of bases) {
    const stat = stats.get(basis.customerId) ?? { customerId: basis.customerId, drafts: 0, net: 0 };
    stat.drafts += 1;
    stat.net = Math.round((stat.net + basis.net) * 100) / 100;
    stats.set(basis.customerId, stat);
  }
  return [...stats.values()];
}

/** Open deviation entries counted per customer, and of them the late ones (the log's own rule, isDeviationOverdue). */
export function deviationStats(entries: readonly { customerId: string; status: string; dueDate: string }[], today: string): DeviationStat[] {
  const stats = new Map<string, DeviationStat>();
  for (const entry of entries) {
    if (entry.status === "DONE") continue;
    const stat = stats.get(entry.customerId) ?? { customerId: entry.customerId, open: 0, overdue: 0 };
    stat.open += 1;
    if (isDeviationOverdue(entry, today)) stat.overdue += 1;
    stats.set(entry.customerId, stat);
  }
  return [...stats.values()];
}

export type CustomerFigures = {
  customerId: string;
  /** Null when the person may not read work orders (the column is left out, never shown as 0). */
  openWorkOrders: number | null;
  overdueWorkOrders: number | null;
  roundWorkOrders: number | null;
  lastCompletedOn: string | null;
  inProgressWorkOrders: number | null;
  needsActionWorkOrders: number | null;
  completedRecent: number | null;
  upcomingWorkOrders: number | null;
  nextOn: string | null;
  /** The deviation log's entries tied to the customer that this person may read. */
  openDeviations: number;
  overdueDeviations: number;
  /** Null without the quotes right. */
  quotesAwaiting: number | null;
  quotesExpiringSoon: number | null;
  invoiceDrafts: number | null;
  /** Null without the price right. */
  invoiceDraftNet: number | null;
};

const n = (value: number | null | undefined) => value ?? 0;

/** What needs action at a customer: late work orders and deviations, work orders marked Behöver åtgärdas, quotes going out soon. */
export const customerActionCount = (row: Pick<CustomerFigures, "overdueWorkOrders" | "needsActionWorkOrders" | "overdueDeviations" | "quotesExpiringSoon">) =>
  n(row.overdueWorkOrders) + n(row.needsActionWorkOrders) + n(row.overdueDeviations) + n(row.quotesExpiringSoon);

/**
 * The figures per customer from each source, with the parts the person may not read left out (null). Only customers with
 * something going on are kept: open work, an open deviation, a waiting quote or an invoice basis not yet invoiced. Most urgent
 * first: what is late, then what needs action, then open work orders, waiting quotes and invoice drafts.
 */
export function mergeCustomerFigures(input: { access: CustomersTabAccess; workOrders: readonly WorkOrderStat[]; quotes: readonly QuoteStat[]; invoices: readonly InvoiceStat[]; deviations?: readonly DeviationStat[] }): CustomerFigures[] {
  const { access } = input;
  const ids = new Set<string>();
  const work = new Map(access.workOrders ? input.workOrders.map((stat) => [stat.customerId, stat]) : []);
  const quotes = new Map(access.quotes ? input.quotes.map((stat) => [stat.customerId, stat]) : []);
  const invoices = new Map(access.quotes ? input.invoices.map((stat) => [stat.customerId, stat]) : []);
  const deviations = new Map(access.customers ? (input.deviations ?? []).map((stat) => [stat.customerId, stat]) : []);
  for (const [id, stat] of work) if (stat.open > 0) ids.add(id);
  for (const [id, stat] of quotes) if (stat.awaiting > 0) ids.add(id);
  for (const [id, stat] of invoices) if (stat.drafts > 0) ids.add(id);
  for (const [id, stat] of deviations) if (stat.open > 0) ids.add(id);
  const rows = [...ids].map((customerId): CustomerFigures => {
    const w = work.get(customerId); const q = quotes.get(customerId); const i = invoices.get(customerId); const d = deviations.get(customerId);
    const wo = <T>(value: T) => (access.workOrders ? value : null);
    return {
      customerId,
      openWorkOrders: wo(w?.open ?? 0),
      overdueWorkOrders: wo(w?.overdue ?? 0),
      roundWorkOrders: wo(w?.rounds ?? 0),
      lastCompletedOn: wo(w?.lastCompletedOn ?? null),
      inProgressWorkOrders: wo(w?.inProgress ?? 0),
      needsActionWorkOrders: wo(w?.needsAction ?? 0),
      completedRecent: wo(w?.completedRecent ?? 0),
      upcomingWorkOrders: wo(w?.upcoming ?? 0),
      nextOn: wo(w?.nextOn ?? null),
      openDeviations: d?.open ?? 0,
      overdueDeviations: d?.overdue ?? 0,
      quotesAwaiting: access.quotes ? q?.awaiting ?? 0 : null,
      quotesExpiringSoon: access.quotes ? q?.expiringSoon ?? 0 : null,
      invoiceDrafts: access.quotes ? i?.drafts ?? 0 : null,
      invoiceDraftNet: access.prices ? i?.net ?? 0 : null,
    };
  });
  return rows.sort((a, b) => (n(b.overdueWorkOrders) + b.overdueDeviations) - (n(a.overdueWorkOrders) + a.overdueDeviations)
    || customerActionCount(b) - customerActionCount(a) || n(b.openWorkOrders) - n(a.openWorkOrders)
    || n(b.quotesAwaiting) - n(a.quotesAwaiting) || n(b.invoiceDrafts) - n(a.invoiceDrafts)
    || a.customerId.localeCompare(b.customerId));
}

export type CustomerTone = "danger" | "warning" | "info" | "neutral" | "success";

/**
 * A customer's state in the row's pill (the most urgent first): Försenat when a work order or a deviation is late, Behöver
 * åtgärd, Pågår when a work order is under way, Planerat when work is open, Avvikelse when only a deviation is open. A
 * customer with only quotes or invoice drafts has no work state (null).
 */
export function customerState(row: CustomerFigures): { label: string; tone: CustomerTone } | null {
  if (n(row.overdueWorkOrders) + row.overdueDeviations > 0) return { label: "Förfallet", tone: "danger" };
  if (n(row.needsActionWorkOrders) > 0) return { label: "Behöver åtgärd", tone: "danger" };
  if (n(row.inProgressWorkOrders) > 0) return { label: "Pågår", tone: "info" };
  if (n(row.openWorkOrders) > 0) return { label: "Planerat", tone: "neutral" };
  if (row.openDeviations > 0) return { label: "Avvikelse", tone: "warning" };
  return null;
}

/**
 * How far the work at a customer has come: the work orders färdigställda within RECENT_DAYS against those and the open
 * ones ("3 av 5 klara"). Null when there is no work (or no right to read it).
 */
export function customerProgress(row: Pick<CustomerFigures, "openWorkOrders" | "completedRecent">): { done: number; total: number; percent: number } | null {
  const done = n(row.completedRecent);
  const total = n(row.openWorkOrders) + done;
  return total ? { done, total, percent: Math.round((done / total) * 100) } : null;
}

/** The money side in the row's own column: a quote going out soon, a quote waiting for an answer, an invoice basis to invoice. */
export function customerCommercial(row: CustomerFigures): { label: string; tone: CustomerTone } | null {
  if (n(row.quotesExpiringSoon) > 0) return { label: "Offert går ut", tone: "warning" };
  if (n(row.quotesAwaiting) > 0) return { label: "Väntar på svar", tone: "info" };
  if (n(row.invoiceDrafts) > 0) return { label: "Att fakturera", tone: "success" };
  return null;
}


/** The facts under a customer's name, the most urgent first: "2 förfallna · 1 avvikelse · Nästa 3 nov · Senast på plats 12 okt". */
export function customerFacts(row: CustomerFigures): { text: string; late: boolean } {
  const parts: string[] = [];
  if (n(row.overdueWorkOrders)) parts.push(plural(n(row.overdueWorkOrders), "förfallen", "förfallna"));
  if (n(row.needsActionWorkOrders)) parts.push(`${n(row.needsActionWorkOrders)} behöver åtgärd`);
  if (row.overdueDeviations) parts.push(plural(row.overdueDeviations, "förfallen avvikelse", "förfallna avvikelser"));
  else if (row.openDeviations) parts.push(plural(row.openDeviations, "öppen avvikelse", "öppna avvikelser"));
  if (n(row.openWorkOrders)) parts.push(plural(n(row.openWorkOrders), "öppen arbetsorder", "öppna arbetsordrar"));
  if (row.nextOn) parts.push(`Nästa ${shortDay(row.nextOn)}`);
  if (n(row.quotesAwaiting)) parts.push(plural(n(row.quotesAwaiting), "offert väntar på svar", "offerter väntar på svar"));
  if (n(row.invoiceDrafts)) parts.push(plural(n(row.invoiceDrafts), "underlag", "underlag"));
  if (row.lastCompletedOn) parts.push(`Senast på plats ${shortDay(row.lastCompletedOn)}`);
  return { text: parts.join(" · "), late: n(row.overdueWorkOrders) + row.overdueDeviations > 0 };
}

/** One row of Kräver åtgärd: a late or Behöver åtgärdas work order, a late deviation, or a quote going out soon. */
export type CustomerActionRow = {
  key: string; reason: "overdue" | "needsAction" | "deviation" | "quote";
  id: string; title: string; href: string; customerName: string;
  /** Klart senast (work order, deviation) or Giltig till (quote). */
  day: string;
  status?: string; progress?: number | null; round?: boolean;
  /** A quote's amount exkl. moms, only with the price right. */
  net?: number | null;
};
/** One row of Länge sedan: a customer and the day the company was last there. */
export type CustomerLapsedRow = { customerId: string; name: string; place: string; href: string; lastCompletedOn: string };

/** One row of Närmaste veckan:an open work order (a round's included) starting or due within UPCOMING_DAYS. */
export type CustomerUpcomingRow = { id: string; title: string; href: string; customerName: string; day: string; starts: boolean; status: string; progress: number | null; round: boolean };

const REASON_ORDER ={ overdue: 0, deviation: 0, needsAction: 1, quote: 2 } as const;

/** Kräver åtgärd in one order: what is late first (the earliest day first), then Behöver åtgärdas, then quotes going out soon. */
export function sortActionRows(rows: readonly CustomerActionRow[]): CustomerActionRow[] {
  return [...rows].sort((a, b) => REASON_ORDER[a.reason] - REASON_ORDER[b.reason] || (a.day || "9999").localeCompare(b.day || "9999") || a.key.localeCompare(b.key));
}

/** Närmaste veckan by day, the starts before the deadlines on the same day. */
export function sortUpcomingRows(rows: readonly CustomerUpcomingRow[]): CustomerUpcomingRow[] {
  return [...rows].sort((a, b) => a.day.localeCompare(b.day) || Number(b.starts) - Number(a.starts) || a.title.localeCompare(b.title, "sv") || a.id.localeCompare(b.id));
}

/** How many customers have something in Kräver åtgärd. */
export const attentionCustomers = (rows: readonly CustomerFigures[]) => rows.filter((row) => customerActionCount(row) > 0).length;

/** "Giltig till 3 nov (5 dagar)" – a quote's last day and the days left. */
export function quoteDaysText(validUntil: string, today: string): string {
  const days = daysBetween(today, validUntil);
  return `Giltig till ${shortDay(validUntil)} (${days === 0 ? "sista dagen" : plural(days, "dag", "dagar")})`;
}

export type CustomerTotals = {
  customers: number;
  openWorkOrders: number | null; overdueWorkOrders: number | null; roundWorkOrders: number | null;
  needsActionWorkOrders: number | null; upcomingWorkOrders: number | null;
  openDeviations: number; overdueDeviations: number;
  quotesAwaiting: number | null; quotesExpiringSoon: number | null; invoiceDrafts: number | null; invoiceDraftNet: number | null;
};

type SummedKey = Exclude<keyof CustomerFigures, "customerId" | "lastCompletedOn" | "nextOn" | "completedRecent" | "inProgressWorkOrders">;
/** The tab's totals over every customer, each null when its part is left out. */
export function customerTotals(rows: readonly CustomerFigures[], access: CustomersTabAccess): CustomerTotals {
  const sum = (key: SummedKey, shown: boolean) => (shown ? Math.round(rows.reduce((total, row) => total + n(row[key]), 0) * 100) / 100 : null);
  return {
    customers: rows.length,
    openWorkOrders: sum("openWorkOrders", access.workOrders), overdueWorkOrders: sum("overdueWorkOrders", access.workOrders), roundWorkOrders: sum("roundWorkOrders", access.workOrders),
    needsActionWorkOrders: sum("needsActionWorkOrders", access.workOrders), upcomingWorkOrders: sum("upcomingWorkOrders", access.workOrders),
    openDeviations: sum("openDeviations", true) ?? 0, overdueDeviations: sum("overdueDeviations", true) ?? 0,
    quotesAwaiting: sum("quotesAwaiting", access.quotes), quotesExpiringSoon: sum("quotesExpiringSoon", access.quotes),
    invoiceDrafts: sum("invoiceDrafts", access.quotes), invoiceDraftNet: sum("invoiceDraftNet", access.prices),
  };
}

/** Everything in Kräver åtgärd, as the list counts it (the tab's chip and the headline say the same). */
export const actionTotal = (totals: Pick<CustomerTotals, "overdueWorkOrders" | "needsActionWorkOrders" | "overdueDeviations" | "quotesExpiringSoon">) => customerActionCount(totals);

/** Länge sedan (2026-10-29): how long without a färdigställd work order before a customer is listed, in days. */
export const LAPSED_DAYS = 365;
export const LAPSED_ROWS = 6;

/**
 * Länge sedan: customers that were worked for, but where nothing has been färdigställt for `LAPSED_DAYS` and nothing is
 * open – no open work order, and not in the tab's list of customers with something going on (`active`). A customer never
 * worked for has no "Senast där" and is left out. The most recent first, so the ones that just passed the year come on top.
 */
export function lapsedCustomers(stats: readonly WorkOrderStat[], active: ReadonlySet<string>, today: string): { customerId: string; lastCompletedOn: string }[] {
  const cutoff = addDays(today, -LAPSED_DAYS);
  return stats.flatMap((stat) => stat.open === 0 && stat.lastCompletedOn && stat.lastCompletedOn <= cutoff && !active.has(stat.customerId) ? [{ customerId: stat.customerId, lastCompletedOn: stat.lastCompletedOn }] : [])
    .sort((a, b) => b.lastCompletedOn.localeCompare(a.lastCompletedOn) || a.customerId.localeCompare(b.customerId));
}

/** "Senast på plats 3 okt 2025 · 12 mån sedan" – a day more than a year back with its year, and how many whole months ago. */
export function lapsedText(lastCompletedOn: string, today: string): string {
  const months = (Number(today.slice(0, 4)) - Number(lastCompletedOn.slice(0, 4))) * 12 + Number(today.slice(5, 7)) - Number(lastCompletedOn.slice(5, 7)) - (today.slice(8) < lastCompletedOn.slice(8) ? 1 : 0);
  return `Senast på plats ${shortDay(lastCompletedOn)} ${lastCompletedOn.slice(0, 4)} · ${months} mån sedan`;
}

/** The tab's chip:the count of Kräver åtgärd, as Teamet's ("3 att åtgärda"); none when nothing needs action. */
export const customersChip = (totals: Parameters<typeof actionTotal>[0]) => { const count = actionTotal(totals); return count > 0 ? `${count.toLocaleString("sv-SE")} att åtgärda` : null; };

const NUMBER_WORDS =["Noll", "En", "Två", "Tre", "Fyra", "Fem", "Sex", "Sju", "Åtta", "Nio", "Tio"];
const word = (count: number, capital = true) => { const text = count <= 10 ? NUMBER_WORDS[count] : String(count); return capital ? text : text.toLowerCase(); };
const neuter = (count: number, capital = true) => (count === 1 ? (capital ? "Ett" : "ett") : word(count, capital));

/**
 * Läget hos kunderna in one sentence, from the tab's own figures (as Teamet's): what needs action, how many customers are
 * concerned, the coming week and the quotes waiting. Nothing is guessed; a part the person may not read is not mentioned.
 */
export function customersSentence(input: { totals: CustomerTotals; attentionCustomers: number }): string {
  const { totals } = input;
  const parts: string[] = [];
  const action = actionTotal(totals);
  if (action) parts.push(`${action === 1 ? "En sak" : `${word(action)} saker`} kräver åtgärd hos ${input.attentionCustomers === 1 ? "en kund" : `${word(input.attentionCustomers, false)} kunder`} – börja där.`);
  else parts.push("Inget kräver åtgärd hos kunderna.");
  const open = n(totals.openWorkOrders);
  if (totals.openWorkOrders !== null && open) parts.push(`${open === 1 ? "En arbetsorder är öppen" : `${word(open)} arbetsordrar är öppna`}${n(totals.upcomingWorkOrders) ? `, ${word(n(totals.upcomingWorkOrders), false)} kommer den närmaste veckan` : ""}.`);
  if (n(totals.quotesAwaiting)) parts.push(n(totals.quotesAwaiting) === 1 ? "En offert väntar på svar." : `${word(n(totals.quotesAwaiting))} offerter väntar på svar.`);
  const drafts = n(totals.invoiceDrafts);
  if (drafts) parts.push(`${neuter(drafts)} fakturaunderlag är inte ${drafts === 1 ? "fakturerat" : "fakturerade"} än.`);
  return parts.join(" ");
}
