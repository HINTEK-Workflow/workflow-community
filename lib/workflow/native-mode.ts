import type { DetailLevel } from "./detail-level";
import { formBlockVisible, formConditionMet, formSectionShown, type FormBlock } from "./form-document";
import type { Flow, FlowStep } from "./task-flow";
import { MENU_LABEL, MENU_SUBTITLE, TOOLS_GROUP_TITLE, menuButtonHref, menuItemLabel, type MenuEntry, type MenuHideable, type MenuRights } from "./menu-items";
import { TEAM_HREF } from "./native-layout";
import { VIEW_LABEL } from "./navigation";
import { COMPANY_VIEWS, PRODUCT_VIEWS } from "./settings-tabs";

/**
 * Visning 1 (2026-10-09, widened 2026-10-11): display level 1 "Enkel – app" draws Workflow like a phone's own app – lists like the phone's settings (rows with a coloured icon, a line of text and
 * a chevron), one thing per screen with Tillbaka at the top left, a start page of big tiles and a tab bar at the bottom.
 * It is mainly navigation: the same pages, forms, data, rules and permissions; the server decides every call. Every device
 * can choose it. On a phone (a window narrower than 640 px) it fills the window; on a wider screen (tablet, computer) the
 * same screens are drawn in an app column in the middle (appColumnFor), a frame only 560 px wide that holds the very same
 * app, so the screens, dialogs-as-screens and the tab bar are exactly the phone's. Level 2–3 are the ordinary pages.
 * Since 2026-10-22 (UX-granskningen A2) a phone always shows the app while signed in: its layout level is 1 whatever is
 * saved, and Visa mer / Visa allt raise only the content level (lib/workflow/detail-level.ts, displayLevelsFor), so the
 * `level` given here is the layout level. Pure, so the shell, the pages and the tests read the same.
 */
export const NATIVE_MAX_WIDTH = 640;

/**
 * The native look is on in a window of phone width at layout level 1 – the phone itself (always, A2) or the app column's
 * frame (which is 560 px wide). The width is the safe fallback (a width of 0 is not yet known).
 */
export function nativeModeFor(level: DetailLevel, width: number, phone = false, tabletApp = false): boolean {
  // A phone on its side keeps the app across the whole screen, not the narrow column (2026-10-13).
  // Surfplattans appvy (appkänslan, beslutad 2026-11-23): a tablet fills its window with the app too (`tabletApp`).
  return level === 1 && width > 0 && (width < NATIVE_MAX_WIDTH || phone || tabletApp);
}

/** Level 1 on a screen of 640 px or more: the app is drawn in the centred app column – on a computer, and on a tablet without `tabletApp`. */
export function appColumnFor(level: DetailLevel, width: number, phone = false, tabletApp = false): boolean {
  return level === 1 && width >= NATIVE_MAX_WIDTH && !phone && !tabletApp;
}

/**
 * Icon colours per type (tokens --type-* in app/globals.css, muted, with dark variants). Fixed per type so the same
 * kind of thing always has the same colour; blue stays the app's own colour for menus and buttons.
 */
export const TYPE_KEYS = ["work-order", "control", "risk", "round", "time", "customer", "project", "quote", "purchase", "instrument", "tools", "calendar", "maintenance", "neutral", "checkin", "new", "notice"] as const;
export type TypeKey = (typeof TYPE_KEYS)[number];

/** The type of a task kind (a work order, a risk assessment, a protocol made from a form). */
export function typeOfTaskKind(kind: string | null | undefined): TypeKey {
  return kind === "WORK_ORDER" ? "work-order" : kind === "RISK_ASSESSMENT" ? "risk" : "control";
}

// ---------------------------------------------------------------------------------------------------------------------
// Lists grouped by date: I dag, Denna vecka, Senare (and what is late, done earlier or has no date).

export type DateGroupKey = "overdue" | "today" | "week" | "later" | "none" | "earlier";
export const DATE_GROUP_ORDER: readonly DateGroupKey[] = ["overdue", "today", "week", "later", "none", "earlier"];
export const DATE_GROUP_LABEL: Record<DateGroupKey, string> = {
  overdue: "Förfallet", today: "I dag", week: "Denna vecka", later: "Senare", none: "Utan datum", earlier: "Tidigare",
};

const DAY = /^(\d{4})-(\d{2})-(\d{2})/;
/** Days since 1970 for a YYYY-MM-DD day (calendar days, no time zone involved); null for anything else. */
function dayNumber(day: string | null | undefined): number | null {
  const match = DAY.exec(day ?? "");
  if (!match) return null;
  const value = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(value) ? Math.round(value / 86_400_000) : null;
}

/**
 * Where a dated item belongs, seen from `today` (both YYYY-MM-DD, Swedish days). "Denna vecka" is the rest of the
 * current week, Monday to Sunday; an open item before today is late, a finished one is earlier.
 */
export function dateGroupOf(day: string | null | undefined, today: string, { open = true }: { open?: boolean } = {}): DateGroupKey {
  const value = dayNumber(day);
  const now = dayNumber(today);
  if (value === null || now === null) return "none";
  if (value < now) return open ? "overdue" : "earlier";
  if (value === now) return "today";
  // 1970-01-01 was a Thursday: (n + 3) % 7 is 0 on a Monday.
  const weekEnd = now - ((now + 3) % 7) + 6;
  return value <= weekEnd ? "week" : "later";
}

export type DateGroup<T> = { key: DateGroupKey; label: string; items: T[] };

/**
 * Items in date groups in a fixed order, keeping the list's own order inside each group; empty groups are left out.
 * `overdueOf`: an open item already past its Klart senast belongs under Försenat even when it is booked later (QA
 * 2026-10-10: a "Förfallen" job stood under Senare because its booking was next week).
 */
export function groupByDate<T>(items: readonly T[], dayOf: (item: T) => string | null | undefined, today: string, openOf: (item: T) => boolean = () => true, overdueOf: (item: T) => boolean = () => false): DateGroup<T>[] {
  const groups = new Map<DateGroupKey, T[]>();
  for (const item of items) {
    const open = openOf(item);
    const key = open && overdueOf(item) ? "overdue" : dateGroupOf(dayOf(item), today, { open });
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return DATE_GROUP_ORDER.filter((key) => groups.has(key)).map((key) => ({ key, label: DATE_GROUP_LABEL[key], items: groups.get(key)! }));
}

// ---------------------------------------------------------------------------------------------------------------------
// A job as a menu of rows: Uppdraget, the steps and Mer. Each row opens its own screen (`&step=` in the address).

export const JOB_SCREENS = ["kommentarer", "uppdraget", "risk", "utforande", "material", "signering", "formular", "risker", "godkannande", "fardigstall", "tid", "projekt", "plats", "underhall", "bilagor", "kopplade", "rapport"] as const;
export type JobScreen = (typeof JOB_SCREENS)[number];
export const JOB_SCREEN_TITLE: Record<JobScreen, string> = {
  uppdraget: "Uppdraget", risk: "Riskbedömning", utforande: "Utförande", material: "Material", signering: "Signering", formular: "Ifyllnad",
  risker: "Risker", godkannande: "Godkännande", fardigstall: "Färdigställ", tid: "Tid", projekt: "Projekt", plats: "Plats och planering",
  underhall: "Underhåll", bilagor: "Bilder och dokument", kopplade: "Kopplade uppgifter", kommentarer: "Kommentarer", rapport: "Rapport",
};
/** The screens where the person types; their top bar has Avbryt and Spara instead of Tillbaka. Underhåll lists the order's
 * maintenance items, which are saved on their own pages (2026-10-30), so it has Tillbaka. */
export const EDITING_SCREENS: ReadonlySet<JobScreen> = new Set<JobScreen>(["risk", "utforande", "material", "signering", "formular", "risker", "godkannande", "plats"]);

export function parseJobScreen(value: string | null | undefined): JobScreen | null {
  return value && (JOB_SCREENS as readonly string[]).includes(value) ? value as JobScreen : null;
}

export type JobKind = "WORK_ORDER" | "RISK_ASSESSMENT" | "FORM";
export type JobRowTone = "done" | "next" | "todo";
export type JobStepRow = { screen: JobScreen; label: string; state: string; tone: JobRowTone; value?: string; type: TypeKey; icon: "risk" | "work" | "material" | "sign" | "form" | "complete" };
export type JobSteps = {
  rows: JobStepRow[];
  /** The row of the step the person is on, for "Fortsätt till …"; null when nothing is left. */
  next: JobStepRow | null;
  /** The step bar at the top: one piece per required step. */
  bar: ("done" | "current" | "todo")[];
};

type StepTexts = { done: string; todo?: string };
/** The state of the step the job is at, in the job menu's rows and tiles ("Nästa steg" is the primary button's alone). */
export const CURRENT_STEP_STATE = "Du är här";
const stateOf = (step: FlowStep | undefined, texts: StepTexts, completed: boolean): { state: string; tone: JobRowTone } => {
  if (completed || step?.state === "done") return { state: texts.done, tone: "done" };
  if (!step) return { state: texts.todo ?? "Inte påbörjad", tone: "todo" };
  // Svar 2 (2026-10-24): the row says where the job is; only the primary button points onward.
  if (step.state === "current") return { state: CURRENT_STEP_STATE, tone: "next" };
  if (step.state === "skipped") return { state: "Hoppas över", tone: "todo" };
  return { state: step.display ?? texts.todo ?? "Inte påbörjad", tone: "todo" };
};
/** The first step of a group that is not done, so a row made of several steps reads as its most urgent one. */
const firstOpen = (steps: (FlowStep | undefined)[]) => steps.find((step) => step && step.state !== "done") ?? steps.find(Boolean);

/**
 * The step rows of a saved job, from the same flow as the progress line and Färdigställ (lib/workflow/task-flow.ts), so
 * the rows, the bar, the percentage and the completion never disagree. Work order: Riskbedömning, Utförande, Material,
 * Signering (with Färdigställ). Risk assessment: Risker, Godkännande (with Färdigställ). Protocol: Riskbedömning,
 * Ifyllnad (the moments, the form and its signatures), Färdigställ.
 */
export function jobStepRows({ kind, flow, materials = 0, riskLevel = null, risks = 0 }: { kind: JobKind; flow: Flow; materials?: number; riskLevel?: "simplified" | "extended" | "exception" | null; risks?: number }): JobSteps {
  const step = (key: string) => flow.steps.find((item) => item.key === key);
  const completed = flow.done;
  const rows: JobStepRow[] = [];
  const risk = step("risk");
  if (risk) rows.push({ screen: "risk", label: "Riskbedömning", icon: "risk", type: "risk", ...stateOf(risk, { done: riskLevel === "exception" ? "Ej gjord · redan utfört" : riskLevel === "extended" ? "Klar · utökad" : riskLevel === "simplified" ? "Klar · förenklad" : "Klar" }, completed) });
  const complete = step("complete");
  if (kind === "WORK_ORDER") {
    rows.push({ screen: "utforande", label: "Utförande", icon: "work", type: "work-order", ...stateOf(step("work"), { done: "Ifyllt" }, completed) });
    // The count once, in the state (simulation 2026-10-10: "2 rader" and "2" in the same row).
    rows.push({ screen: "material", label: "Material", icon: "material", type: "quote", state: materials ? `${materials} ${materials === 1 ? "rad" : "rader"}` : "Inga rader", tone: materials ? "done" : "todo" });
    const sign = stateOf(firstOpen([step("sign"), complete]), { done: "Signerad" }, completed);
    rows.push({ screen: "signering", label: "Signering", icon: "sign", type: "project", ...(completed ? { state: "Färdigställd", tone: "done" as const } : step("sign")?.state === "done" && complete?.state === "current" ? { state: "Klar att färdigställa", tone: "next" as const } : sign) });
  } else if (kind === "RISK_ASSESSMENT") {
    rows.push({ screen: "risker", label: "Risker", icon: "risk", type: "risk", ...stateOf(step("risks"), { done: "Klar" }, completed), ...(risks ? { value: String(risks) } : {}) });
    const approval = step("approval");
    rows.push({ screen: "godkannande", label: "Godkännande", icon: "sign", type: "project", ...(completed ? { state: "Färdigställd", tone: "done" as const } : approval?.state === "done" && complete?.state === "current" ? { state: "Klar att färdigställa", tone: "next" as const } : stateOf(approval, { done: "Godkänd" }, completed)) });
  } else {
    const fill = firstOpen([step("moments"), step("fill"), step("sign")]);
    rows.push({ screen: "formular", label: "Ifyllnad", icon: "form", type: "control", ...stateOf(fill, { done: "Ifylld" }, completed) });
    rows.push({ screen: "fardigstall", label: "Färdigställ", icon: "complete", type: "project", ...(completed ? { state: "Färdigställd", tone: "done" as const } : stateOf(complete, { done: "Färdigställd", todo: "Inte klar" }, completed)) });
  }
  const next = completed ? null : rows.find((row) => row.tone === "next") ?? null;
  const bar = flow.steps.filter((item) => !item.optional).map((item) => (completed || item.state === "done" ? "done" as const : item.state === "current" ? "current" as const : "todo" as const));
  return { rows, next, bar };
}

/** "Fortsätt till signering": the primary button under the rows. */
export const continueLabel = (row: Pick<JobStepRow, "label">) => `Fortsätt till ${row.label.toLowerCase()}`;

/**
 * "Nästa steg" som huvudknapp in the app (UX-granskningen avsnitt 6, punkt 7): what the job's primary button says for the
 * step row it opens – the same words as the job page on a computer (lib/workflow/next-step.ts nextStepAction).
 */
const ROW_ACTION: Partial<Record<JobScreen, string>> = {
  risk: "Gör riskbedömningen", utforande: "Skriv utfört arbete", material: "Lägg till material", signering: "Signera", formular: "Fyll i protokollet",
  risker: "Lägg till risker", godkannande: "Godkänn bedömningen", fardigstall: "Färdigställ", plats: "Fyll i grunduppgifterna",
};
export function jobRowAction(row: Pick<JobStepRow, "screen" | "label" | "state">): string {
  // The last row before Färdigställ says "Klar att färdigställa" when everything on it is done.
  if (row.state === "Klar att färdigställa") return "Färdigställ";
  return ROW_ACTION[row.screen] ?? continueLabel(row);
}

/**
 * The screen where a field or panel lives (a requirement to fill in, the risk step, Färdigställ), so "what is missing"
 * on a phone at level 1 opens the right screen before it leads to the field.
 */
export function screenForTarget(target: string | null | undefined, kind: JobKind): JobScreen | null {
  if (!target) return null;
  if (target === "task-risk-step") return "risk";
  // The round's check stands first on Ifyllnad until it is done, whether or not the job has a risk step of its own.
  if (target === "task-round-safety") return "formular";
  if (target === "task-complete") return kind === "WORK_ORDER" ? "signering" : kind === "RISK_ASSESSMENT" ? "godkannande" : "fardigstall";
  if (target.startsWith("form-")) return "formular";
  if (/^task-(execution|deviations)/.test(target) || target === "Utförande") return "utforande";
  if (/^task-signature|^task-close/.test(target) || target === "Signering och avslut") return "signering";
  if (/^task-(add-risk|risk-)/.test(target) || target === "Identifierade risker") return "risker";
  if (/^task-approval/.test(target)) return "godkannande";
  if (/^task-(title|due-date|status|place|customer)/.test(target) || target === "Grunduppgifter") return "plats";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Ett formulär på nivå 1: en skärm per del (2026-10-09). A protocol's Ifyllnad shows one of the form's sections
// at a time (`&part=` in the address, so the browser's back goes to the previous part). Blocks outside any section join
// the part they stand next to; a section that is switched off or hidden is no part of its own.

export type FormPart = {
  /** The renderer's top-level groups shown in this part: a section's or a column row's id, a loose run's first block id. */
  keys: string[];
  /** Every block id the part leads to (sections, their blocks), for requirements that point to a field. */
  ids: string[];
  title: string;
  /** The part holds the form's own Sammanfattning (where the deviations comment lives). */
  summary: boolean;
  /** Before grouping only: a page break (a `pagebreak` block) follows, so the next section starts a new part. */
  breakAfter?: boolean;
  /** Before grouping only: how tall the part is, roughly (a table counts its columns and fixed rows), so a step never gets enormous. */
  weight?: number;
};

/** The heaviest a joined step may get before it is cut in two (2026-10-12: the last protocol step was ~5 300 px). */
export const MAX_STEP_WEIGHT = 36;

/** A block's height, roughly: a table is its columns times its fixed rows, a checklist its points, anything else one. */
export const blockWeight = (block: FormBlock): number => block.type === "table" ? Math.max(3, block.columns.length) * Math.max(1, block.fixedRows.length)
  : block.type === "checklist" ? Math.max(1, block.items.length) : 1;

/** The most steps a form is cut into at level 1 (2026-10-12: three to five bigger steps, not one screen per section). */
export const MAX_FORM_STEPS = 5;

/** How many steps `count` sections become when nothing forces a split: few sections stay, many are joined. */
export const formStepTarget = (count: number) => count <= 3 ? count : Math.min(MAX_FORM_STEPS, Math.max(3, Math.ceil(count * 0.6)));

/** The title of several sections read as one step: "A", "A och B", "A – C". */
const groupTitle = (titles: string[]) => { const named = titles.filter(Boolean); return named.length <= 1 ? named[0] ?? "" : named.length === 2 ? `${named[0]} och ${named[1]}` : `${named[0]} – ${named[named.length - 1]}`; };

/** Cuts `weights` into `groups` runs next to each other with the smallest heaviest run; returns the length of each run. */
function balancedRuns(weights: number[], groups: number): number[] {
  const n = weights.length;
  const g = Math.min(Math.max(groups, 1), n);
  const prefix = [0];
  for (const weight of weights) prefix.push(prefix[prefix.length - 1]! + weight);
  const cost = Array.from({ length: g + 1 }, () => new Array<number>(n + 1).fill(Infinity));
  const cut = Array.from({ length: g + 1 }, () => new Array<number>(n + 1).fill(0));
  cost[0]![0] = 0;
  for (let k = 1; k <= g; k++) for (let i = k; i <= n; i++) for (let j = k - 1; j < i; j++) {
    const worst = Math.max(cost[k - 1]![j]!, prefix[i]! - prefix[j]!);
    if (worst < cost[k]![i]!) { cost[k]![i] = worst; cut[k]![i] = j; }
  }
  const runs: number[] = [];
  for (let k = g, i = n; k > 0; k--) { runs.unshift(i - cut[k]![i]!); i = cut[k]![i]!; }
  return runs;
}

/**
 * Joins the sections of a form into the few bigger steps of level 1 (M3). A `pagebreak` block always ends a step; inside
 * each stretch between breaks the sections are joined to about `formStepTarget` steps of even size, and a section that is
 * only the Sammanfattning follows the one before it. Each section keeps its own heading in the renderer.
 */
export function groupFormParts(parts: FormPart[]): FormPart[] {
  const plain = (part: FormPart): FormPart => ({ keys: part.keys, ids: part.ids, title: part.title, summary: part.summary });
  if (parts.length < 2) return parts.map(plain);
  const stretches: FormPart[][] = [[]];
  for (const part of parts) { stretches[stretches.length - 1]!.push(part); if (part.breakAfter) stretches.push([]); }
  const used = stretches.filter((stretch) => stretch.length);
  const weightOf = (part: FormPart) => Math.max(part.weight ?? part.ids.length, 1);
  const totalWeight = parts.reduce((sum, part) => sum + weightOf(part), 0);
  const target = Math.max(formStepTarget(parts.length), used.length);
  const joined: FormPart[] = [];
  for (const stretch of used) {
    type Item = { part: FormPart; titles: string[] };
    const items = stretch.reduce<Item[]>((all, part) => {
      const before = all[all.length - 1];
      if (part.summary && part.ids.length <= 3 && before) all[all.length - 1] = { part: { keys: [...before.part.keys, ...part.keys], ids: [...before.part.ids, ...part.ids], title: before.part.title, summary: true, weight: weightOf(before.part) + weightOf(part) }, titles: [...before.titles, part.title] };
      else all.push({ part, titles: [part.title] });
      return all;
    }, []);
    const weights = items.map((item) => weightOf(item.part));
    const share = Math.max(1, Math.min(items.length, Math.round(target * weights.reduce((a, b) => a + b, 0) / totalWeight)));
    // A joined step that would still be very tall is cut in two (at most MAX_STEP_WEIGHT of content per step).
    let runs = balancedRuns(weights, share);
    for (let guard = 0; guard < 6; guard++) {
      let from = 0;
      let heavy = -1;
      for (const [index, length] of runs.entries()) {
        if (length > 1 && weights.slice(from, from + length).reduce((a, b) => a + b, 0) > MAX_STEP_WEIGHT) { heavy = index; break; }
        from += length;
      }
      if (heavy < 0) break;
      const [head, tail] = balancedRuns(weights.slice(from, from + runs[heavy]!), 2);
      runs = [...runs.slice(0, heavy), head!, tail!, ...runs.slice(heavy + 1)];
    }
    let at = 0;
    for (const length of runs) {
      const run = items.slice(at, at += length);
      joined.push({ keys: run.flatMap((item) => item.part.keys), ids: run.flatMap((item) => item.part.ids), title: groupTitle(run.flatMap((item) => item.titles)), summary: run.some((item) => item.part.summary) });
    }
  }
  return joined;
}

/** The form's parts, in reading order; one part when the form has fewer than two shown sections (no paging then). */
export function formParts(document: { blocks: FormBlock[] }, values: Parameters<typeof formSectionShown>[2]): FormPart[] {
  const parts: FormPart[] = [];
  const hidden: string[] = [];
  const loose: FormPart ={ keys: [], ids: [], title: "", summary: false };
  let run = false;
  const looseGroup = (key: string, ids: string[], summary: boolean) => {
    const target = parts.at(-1) ?? loose;
    target.keys.push(key);
    target.ids.push(...ids);
    target.summary ||= summary;
  };
  for (const block of document.blocks) {
    if (block.type === "section") {
      run = false;
      const ids = [block.id, ...block.blocks.map((child) => child.id)];
      // A section with nothing to fill in in the task (only in the PDF, or every block hidden by its condition) is no part;
      // the form's first section always is (it can hold the moments and the task's own fields).
      const firstSection = document.blocks.find((item) => item.type === "section") === block;
      const drawn = block.blocks.some((child) => child.type !== "pagebreak" && formBlockVisible(child, "task") && !(child.type === "field" && child.momentSwitch && child.input === "yesno")
        && (!("showIf" in child) || formConditionMet(document, values, child.showIf)));
      if (!formSectionShown(document, block, values) || (!drawn && !firstSection)) { hidden.push(...ids); continue; }
      const own: FormPart = { keys: [block.id], ids, weight: 1 + block.blocks.reduce((sum, child) => sum + blockWeight(child), 0), title: block.taskTitle || block.title, summary: block.blocks.some((child) => child.type === "summary"), breakAfter: block.blocks.some((child) => child.type === "pagebreak") };
      if (!parts.length && loose.keys.length) parts.push({ keys: [...loose.keys, ...own.keys], ids: [...loose.ids, ...own.ids], title: own.title, summary: loose.summary || own.summary, weight: loose.ids.length + (own.weight ?? own.ids.length) });
      else parts.push(own);
    } else if (block.type === "columns") {
      run = false;
      const ids = block.columns.flat().map((child) => child.id);
      looseGroup(block.id, ids, ids.length > 0 && block.columns.flat().some((child) => child.type === "summary"));
    } else {
      // Consecutive loose blocks share one group, keyed by its first block (as the renderer draws them).
      if (run) { const target = parts.at(-1) ?? loose; target.ids.push(block.id); target.summary ||= block.type === "summary"; }
      else looseGroup(block.id, [block.id], block.type === "summary");
      run = true;
      if (block.type === "pagebreak" && parts.length) parts[parts.length - 1]!.breakAfter = true;
    }
  }
  if (!parts.length) parts.push(loose);
  // What is switched off is chosen with the moments, which sit in the first part.
  parts[0].ids.push(...hidden);
  return groupFormParts(parts);
}

export type JobFlowStep = { key: string; label: string; screen: JobScreen; part?: number };

/**
 * The job's screens in a row (M3, 2026-10-12): the step rows in order, a protocol's Ifyllnad as its grouped parts, and
 * no Färdigställ row of its own (a protocol finishes in its Sammanfattning). The bottom row's Föregående / Nästa: <name> follows it.
 */
export function jobFlowSteps(rows: readonly Pick<JobStepRow, "screen" | "label">[], parts: readonly Pick<FormPart, "title">[]): JobFlowStep[] {
  return rows.flatMap((row): JobFlowStep[] => row.screen === "fardigstall" ? []
    : row.screen === "formular" && parts.length > 1 ? parts.map((part, index) => ({ key: `formular:${index + 1}`, label: part.title || `Del ${index + 1}`, screen: "formular" as const, part: index + 1 }))
    : [{ key: row.screen, label: row.label, screen: row.screen }]);
}

/** The place of the open screen (and part) in the flow, or -1 when the screen is not one of its steps. */
export const jobFlowIndex = (steps: readonly JobFlowStep[], screen: JobScreen | null, part: number) => steps.findIndex((step) => step.screen === screen && (step.part === undefined || step.part === part));

/** The part in the address (1-based), kept within the form's parts; anything else is the first part. */
export function parseFormPart(value: string | null | undefined, count: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || count < 1) return 1;
  return Math.min(Math.max(parsed, 1), count);
}

/** "Del 2 av 5". */
export const formPartLabel = (part: number, count: number) => `Del ${part} av ${count}`;

/**
 * The part (1-based) where a requirement's field lives: `form-<blockId>`, a table cell `form-<blockId>-…`, a row
 * `form-row-<blockId>-…`, and the deviations comment with the summary (or last). Null when the target is not the form's.
 */
export function formPartForTarget(target: string | null | undefined, parts: readonly Pick<FormPart, "ids" | "summary">[]): number | null {
  if (!target || !parts.length) return null;
  if (target === "form-deviations") { const index = parts.findIndex((part) => part.summary); return index >= 0 ? index + 1 : parts.length; }
  let best: { part: number; length: number } | null = null;
  for (const [index, part] of parts.entries()) for (const id of part.ids) {
    const hit = target === `form-${id}` || target.startsWith(`form-${id}-`) || target.startsWith(`form-row-${id}-`);
    if (hit && (!best || id.length > best.length)) best = { part: index + 1, length: id.length };
  }
  return best?.part ?? null;
}

/** The step bar over the parts: the current one, the ones with nothing left to fill in, and the rest. */
export function formPartBar(parts: readonly Pick<FormPart, "ids" | "summary">[], openBlockIds: readonly string[], current: number): ("done" | "current" | "todo")[] {
  const open = new Set(openBlockIds.map((id) => formPartForTarget(`form-${id}`, parts)));
  return parts.map((_, index) => index + 1 === current ? "current" : open.has(index + 1) ? "todo" : "done");
}

// ---------------------------------------------------------------------------------------------------------------------
// The shell: the tab bar, the top bar and the Mer list.

export type NativeTab = "home" | "jobs" | "new" | "time" | "more";
/** Which tab a page belongs to: Hem the overview, Jobb the work lists and jobs, Tid the time report, Mer everything else. */
export function nativeTabOf(view: string, params?: { get(name: string): string | null }): NativeTab {
  if (view === "stats") return "home";
  // Every "Ny ..." screen belongs to the Ny tab (audit 2026-10-12): Ny uppgift, Nytt projekt, Ny kund, Ny arbetsorder, Ny offert.
  if (view === "new_task" || view === "new" || view === "new_project") return "new";
  if (view === "workflow_task" && params && !params.get("taskId")) return "new";
  if (view === "quote" && params && !params.get("quoteId")) return "new";
  if (view === "customers" && params?.get("new") === "1") return "new";
  if (view === "rounds" && params?.get("new") === "1") return "new";
  if (view === "purchase" && params && !params.get("purchaseId")) return "new";
  if (["tasks", "work_orders", "workflow_task", "controls"].includes(view)) return "jobs";
  if (view === "time") return "time";
  return "more";
}

export type NativeMoreRow = { key: string; label: string; type: TypeKey; href?: string; action?: "ai" | "logout" | "local" | "calculator"; testId?: string; subtitle?: string };
export type NativeMoreSection = { title?: string; rows: NativeMoreRow[] };

const LINK_TYPE: Record<string, TypeKey> = {
  // Inköp (2026-10-16): the list has Artiklar and Nytt inköp at its top.
  purchases: "quote", quotes: "quote", customer_invoices: "quote", projects: "project", work_orders: "work-order",
  // Kalender its own plum, Verktyg's pages one shared slate blue-grey (2026-10-24, answers 7 and 14).
  rounds: "round", deviations: "risk", maintenance: "maintenance", boards: "project", planning: "calendar", time: "time", project_planning: "project", project_summary: "project", forms: "tools", ai: "project",
  customers: "customer", report_archive: "tools", self_inspection: "tools", instruments: "tools", import: "tools",
};

/** The demo's own row in Mer, right after Verktyg, or first when the person has no Verktyg. Only the demo asks for it. */
export function nativeMoreDemo(demo: boolean, sections: NativeMoreSection[]): NativeMoreSection[] {
  if (!demo) return sections;
  const row: NativeMoreSection = { rows: [{ key: "demo", label: VIEW_LABEL.demo, type: "tools", href: "/?view=demo", testId: "native-more-demo" }] };
  const at = sections.findIndex((section) => section.title === TOOLS_GROUP_TITLE);
  return at < 0 ? [row, ...sections] : [...sections.slice(0, at + 1), row, ...sections.slice(at + 1)];
}

/**
 * The whole menu as the Mer tab's grouped list, in the desktop menu's groups (lib/workflow/menu-items.ts decides what is
 * shown): Planering, the work, Kunder, Ekonomi, Verktyg (Kalkylator opens the top bar's calculator), then Konto with Notiser,
 * Inställningar, Workflow AI and Logga ut. Each button is one row with the menu's own noun (B1), to its list – or to Ny … for
 * someone who may only create. Projektstatistik is reached from the Projekt screen. Display only.
 */
export function nativeMoreSections(groups: MenuEntry[][], options: { canRead?: MenuRights; canCreate?: MenuRights; modules?: readonly string[] | null; productAdmin?: boolean; logoutLabel?: string; team?: boolean } = {}): NativeMoreSection[] {
  // Teamet (2026-11-01): a tab of Översikten that the phone otherwise reaches only from a tile; for whoever has the right.
  const sections: NativeMoreSection[] = options.team ? [{ rows: [{ key: "team", label: "Teamet", type: "customer", href: TEAM_HREF, testId: "native-more-team" }] }] : [];
  let ai = false;
  const link = (key: MenuHideable): NativeMoreRow => key === "ai"
    ? { key, label: MENU_LABEL.ai, type: "project", action: "ai", testId: "native-more-ai" }
    : key === "calculators"
    ? { key: "calculator", label: MENU_LABEL.calculators, type: "tools", action: "calculator", testId: "native-more-calculator" }
    : { key, label: menuItemLabel(key, options.modules), type: LINK_TYPE[key] ?? "neutral", href: menuButtonHref(key, options.canRead, options.canCreate, options.modules), testId: `native-more-${key}`, ...(MENU_SUBTITLE[key] ? { subtitle: MENU_SUBTITLE[key] } : {}) };
  for (const group of groups) {
    const rows: NativeMoreRow[] = [];
    let title: string | undefined;
    for (const entry of group) {
      if (entry.type === "more") {
        // What the yrkesprofil tucks away: lower down on the phone, a tap away. The office's rows among them join the group Kontor (nativeMoreTools).
        title = "Fler";
        for (const child of entry.children) rows.push(link(child));
      } else if (entry.type === "group") {
        title = TOOLS_GROUP_TITLE;
        for (const child of entry.children) rows.push(link(child));
      } else if (entry.type === "shortcut") {
        // A yrkesprofil's first group may hold a page of Verktyg among the links; it is then no Verktyg group.
        if (group.every((other) => other.type !== "link")) title = TOOLS_GROUP_TITLE;
        rows.push(link(entry.key));
      } else if (entry.key === "ai") {
        ai = true;
      } else {
        rows.push(link(entry.key));
      }
    }
    if (rows.length) sections.push({ ...(title ? { title } : {}), rows });
  }
  // Hem is edited in place (2026-10-21, UX-granskningen avsnitt 3): the way there without holding a tile, just above Konto.
  sections.push({ title: "Hemskärm", rows: [{ key: "home_edit", label: "Redigera hemskärmen", type: "neutral", href: "/?view=stats&edit=home", testId: "native-more-home-edit" }] });
  sections.push({ title: "Konto", rows: [
    { key: "notifications", label: VIEW_LABEL.notifications, type: "notice", href: "/?view=notifications", testId: "native-more-notifications" },
    { key: "settings", label: VIEW_LABEL.settings, type: "neutral", href: "/?view=settings", testId: "native-more-settings" },
    // Always one tap from Mer (plan 1P): the way to another display, also from the app column, where nothing else leads back.
    { key: "display", label: "Visning", type: "neutral", href: "/?view=settings&step=display", testId: "native-more-display" },
    ...(ai ? [link("ai")] : []),
    ...(options.productAdmin ? [{ key: "customer_companies", label: VIEW_LABEL.customer_companies, type: "neutral" as const, href: "/?view=product_overview", testId: "native-more-product" }] : []),
    { key: "logout", label: options.logoutLabel ?? "Logga ut", type: "neutral", action: "logout", testId: "native-more-logout" },
  ] });
  return sections;
}

/** Hem's "Nytt jobb" tile opens the tab bar's Ny list. */
export const NATIVE_NEW_EVENT = "hintek:native-new";

// ---------------------------------------------------------------------------------------------------------------------
// Tidrapporten and Mina inställningar at level 1 (2026-10-09): a list of rows; each row opens the page's own
// panel as a screen of its own (`&step=` in the address, so Bakåt and links work), like a job's steps.

// "entry" is one time entry to change or remove (`&entry=<id>`), "schedule" Arbetstid.
export const TIME_SCREENS = ["add", "reported", "calendar", "team", "entry", "schedule"] as const;
export type TimeScreen = (typeof TIME_SCREENS)[number];
export const TIME_SCREEN_TITLE: Record<TimeScreen, string> = {
  add: "Rapportera tid", reported: "Rapporterad tid", calendar: "Kalender", team: "Teamets tid",
  entry: "Rapporterad tid", schedule: "Arbetstid",
};
export function parseTimeScreen(value: string | null | undefined): TimeScreen | null {
  return value && (TIME_SCREENS as readonly string[]).includes(value) ? value as TimeScreen : null;
}

export type TimeDay<T> = { day: string; seconds: number; items: T[] };
/**
 * The week in Tid: one group per day (Monday first) with the day's entries in the list's order and its total. Days without
 * time are left out, except today, which is always shown so there is somewhere to start.
 */
export function timeDayGroups<T extends { durationSec: number }>(items: readonly T[], dayOf: (item: T) => string, weekDays: readonly string[], today: string): TimeDay<T>[] {
  return weekDays.map((day) => {
    const own = items.filter((item) => dayOf(item) === day);
    return { day, seconds: own.reduce((sum, item) => sum + (item.durationSec || 0), 0), items: own };
  }).filter((group) => group.items.length || group.day === today);
}

// Tabeller och mätningar (Kompakt tabellvisning, Lägg nya mätningar överst) is gone as a choice (2026-10-09 natt).
export const SETTINGS_SECTIONS = ["start", "display", "home", "sidemenu", "theme", "notices", "advisor", "ai", "profile", "security", "calendar", "apps", "install", "erase"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export const SETTINGS_SECTION_TITLE: Record<SettingsSection, string> = {
  start: "Startsida", display: "Visning", home: "Hemskärm och flikrad", sidemenu: "Menyn", theme: "Tema och text",
  notices: "Notiser", advisor: "Tips i arbetsflödet", ai: "Förslag från Workflow AI", profile: "Profil", security: "Konto och säkerhet",
  calendar: "Kalenderlänk", apps: "Anslutna appar", install: "Installera appen", erase: "Radera mitt konto",
};
/**
 * Mina inställningar in four groups (2026-10-09 natt): the same on the computer (group headings over the panels)
 * and at level 1 on a phone (the grouped rows). Every section is in exactly one group.
 */
export const MY_SETTINGS_GROUPS: readonly { title: string; sections: readonly SettingsSection[] }[] = [
  { title: "Utseende", sections: ["start", "theme", "sidemenu"] },
  { title: "Visning på enheten", sections: ["display", "home", "install"] },
  { title: "Notiser och tips", sections: ["notices", "advisor", "ai"] },
  { title: "Konto", sections: ["profile", "security", "calendar", "apps", "erase"] },
];
export function parseSettingsSection(value: string | null | undefined): SettingsSection | null {
  return value && (SETTINGS_SECTIONS as readonly string[]).includes(value) ? value as SettingsSection : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Ett projekt och ett kundkort på nivå 1 (2026-10-09): like a job, a menu of rows where each row opens the page's
// own panel as a screen of its own (`&step=` in the address, so Bakåt and links work). Nothing is rebuilt.

export const PROJECT_SCREENS = ["kommentarer", "jobb", "tidplan", "planering", "tid", "material", "offerter", "personalliggare", "beslut", "historik", "uppgifter", "hantering"] as const;
export type ProjectScreen = (typeof PROJECT_SCREENS)[number];
export const PROJECT_SCREEN_TITLE: Record<ProjectScreen, string> = {
  jobb: "Projektets jobb", tidplan: "Tidplan", planering: "Planering", tid: "Tid", material: "Material", offerter: "Offerter och utfall",
  personalliggare: "Personalliggare", beslut: "Beslutslogg", historik: "Historik", uppgifter: "Uppgifter om projektet",
  kommentarer: "Kommentarer",
  hantering: "Rapport och hantering",
};
export function parseProjectScreen(value: string | null | undefined): ProjectScreen | null {
  return value && (PROJECT_SCREENS as readonly string[]).includes(value) ? value as ProjectScreen : null;
}

/** The customer card's screens; Redigera kund is the register's own edit page (`&edit=1`). */
// Offerter (2026-10-10): the customer's quotes, for those who may read quotes (Cloud and the demo).
// Dokument (0.87.0): the customer's documents, with the place on each row (Cloud).
export const CUSTOMER_SCREENS = ["platser", "projekt", "jobb", "offerter", "dokument", "krav"] as const;
export type CustomerScreen = (typeof CUSTOMER_SCREENS)[number];
export const CUSTOMER_SCREEN_TITLE: Record<CustomerScreen, string> = { platser: "Platser", projekt: "Projekt", jobb: "Uppgifter och jobb", offerter: "Offerter", dokument: "Dokument", krav: "Särskilda krav" };
export function parseCustomerScreen(value: string | null | undefined): CustomerScreen | null {
  return value && (CUSTOMER_SCREENS as readonly string[]).includes(value) ? value as CustomerScreen : null;
}

/** The page's address with `step` set (or removed with null); the other parameters stay as they are. */
export function withScreen(search: string, step: string | null): string {
  const params = new URLSearchParams(search.replace(/^\?/, ""));
  if (step) params.set("step", step); else params.delete("step");
  return `/?${params.toString()}`;
}

/**
 * Whether a part of a page is drawn: always outside the native look (so level 2–3, the tablet and the computer are
 * unchanged); at level 1 only on the screens it is listed for ("menu" = the page's menu of rows, [] = never).
 */
export function screenShown(native: boolean, step: string | null, show: readonly string[]): boolean {
  return !native || show.includes(step ?? "menu");
}

export type ContactRow = { key: "phone" | "mobile" | "email" | "address"; label: string; value: string; href: string };
/**
 * A customer's contact details as rows that do something when tapped: call, write an e-mail or open the address in the
 * phone's map service (a link only; the page loads nothing). Empty values give no row.
 */
export function contactRows(contact: { phone?: string | null; mobile?: string | null; email?: string | null; address?: string | null }): ContactRow[] {
  const rows: ContactRow[] = [];
  const tel = (value: string) => `tel:${value.trim().replace(/(?!^\+)[^\d]/g, "")}`;
  const phone = contact.phone?.trim();
  const mobile = contact.mobile?.trim();
  if (phone && tel(phone) !== "tel:") rows.push({ key: "phone", label: "Telefon", value: phone, href: tel(phone) });
  if (mobile && mobile !== phone && tel(mobile) !== "tel:") rows.push({ key: "mobile", label: "Mobil", value: mobile, href: tel(mobile) });
  const email = contact.email?.trim();
  if (email && /^[^\s@]+@[^\s@]+$/.test(email)) rows.push({ key: "email", label: "E-post", value: email, href: `mailto:${email}` });
  const address = contact.address?.trim();
  if (address) rows.push({ key: "address", label: "Adress", value: address, href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` });
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------------
// Level 1 is for field work (2026-10-09): heavy desktop tools are hidden there. They stay one choice away – the
// phone's display level 2 – and nothing about rights changes: the menu, Mer, Hem and Sök only leave them out, and an
// address opened at level 1 shows a short screen with "Byt visning". The server decides every call as always.

/**
 * Pages for a larger screen: the builders and import, statistics, the company's and Workflow's administration. A round's QR
 * labels (place_labels) are not among them since 2026-10-23 ("QR kod borde kunna skrivas ut även på telefon").
 */
export const NATIVE_HIDDEN_VIEWS: ReadonlySet<string> = new Set<string>([
  "forms", "import", "landing_editor", "project_summary", "facilities", "administration", "operator_accounts",
  // Webb och inlägg (2026-11-20): a page for a larger screen, as when its tabs were under Inställningar.
  "web_posts", "company_posts", "company_website", "company_videos",
  ...COMPANY_VIEWS, ...PRODUCT_VIEWS,
]);

/**
 * Slimmer level 1 (2026-10-12, plan step 5): office rows that leave the Mer menu at level 1 but stay one tap away
 * where the work leads to them (a job's or a customer's card links on) and in display level 2. Not hidden pages: the page
 * itself opens as before, only the row in Mer and Verktyg is left out. Change back by removing a key here.
 */
export const NATIVE_MORE_HIDDEN: ReadonlySet<string> = new Set<string>([]);
/**
 * Since 2026-10-18 (decision 10) Mer shows the rest of the menu again: the office choices come last, in their own
 * group "Kontor" just before Konto, after the field's rows.
 */
export const NATIVE_MORE_OFFICE: readonly string[] = ["purchases", "quotes", "customer_invoices", "projects", "customers"];
/** The Tid screens left out at level 1 (their rows are not drawn; Exportera tid is one of the page's own buttons). */
export const NATIVE_TIME_HIDDEN: readonly TimeScreen[] = ["team", "schedule"];
/** Mina inställningar's sections left out at content level 1; Visa mer shows them on a phone (A2), display level 2 elsewhere. */
// Tips i arbetsflödet, Förslag från Workflow AI and Installera appen are fine-tuning or already known to the app (audit 2026-10-12).
export const NATIVE_SETTINGS_HIDDEN: readonly SettingsSection[] = ["sidemenu", "apps", "erase", "start", "theme", "advisor", "ai", "install"];

/**
 * Whether a page is hidden at level 1: one of NATIVE_HIDDEN_VIEWS, or the self-inspection programme's editor
 * (`?edit=1`) and its office tabs (Årlig översyn, Versioner, Krävd nivå); reading the programme, Avvikelser and
 * Kompetenskort stay. Mina inställningar, Hjälp and every page of the work stay.
 */
export function nativeHiddenView(view: string | null | undefined, params?: { get: (key: string) => string | null } | null): boolean {
  if (!view) return false;
  // Användare stays out of Mer at level 1 but opens from a link (kundresa 2026-11-07, L16: Bjud in kollegor in the guide met the larger-screen screen).
  if (view === "administration") return false;
  if (NATIVE_HIDDEN_VIEWS.has(view)) return true;
  return view === "self_inspection" && (params?.get("edit") === "1" || NATIVE_HIDDEN_SELF_INSPECTION_TABS.has(params?.get("tab") ?? ""));
}

/**
 * Whether the app leaves out a page for a larger screen: at content level 1 only. On a phone Visa mer raises the content
 * level and the page is drawn in the app (A2, 2026-10-22); in the app column the device switches to level 2 instead.
 */
export function nativeHidesView(native: boolean, content: DetailLevel, view: string | null | undefined, params?: { get: (key: string) => string | null } | null): boolean {
  return native && content === 1 && nativeHiddenView(view, params);
}

/** Whether a section of Mina inställningar is left out in the app (NATIVE_SETTINGS_HIDDEN at content level 1). */
export const nativeSettingsHidden = (section: SettingsSection, content: DetailLevel) => content === 1 && NATIVE_SETTINGS_HIDDEN.includes(section);

const NATIVE_HIDDEN_SELF_INSPECTION_TABS: ReadonlySet<string> = new Set(["review", "versions", "levels"]);

/** The same rule for an address (`/?view=forms`, a search hit, a row in Mer). */
export function nativeHiddenHref(href: string | null | undefined): boolean {
  if (!href) return false;
  const query = href.includes("?") ? href.slice(href.indexOf("?") + 1) : "";
  const params = new URLSearchParams(query);
  return nativeHiddenView(params.get("view"), params);
}

/**
 * Where a notice leads at level 1 (audit 2026-10-12): a page that is in display level 2 only (the self-inspection's Årlig översyn)
 * would be a dead end, so it leads to the nearest page the level has (Egenkontroll); anything else is kept as it is.
 */
export function nativeNoticeHref(href: string): string {
  if (!nativeHiddenHref(href)) return href;
  const view = new URLSearchParams(href.includes("?") ? href.slice(href.indexOf("?") + 1) : "").get("view");
  return view === "self_inspection" ? "/?view=self_inspection" : href;
}

/**
 * Mer without the hidden pages (a row's key is its view, Installation's is customer_companies) at content level 1.
 * On a phone with Visa mer or Visa allt (content 3, A2) the rows are kept, so no page is out of reach.
 */
export function nativeVisibleSections(sections: readonly NativeMoreSection[], content: DetailLevel = 1): NativeMoreSection[] {
  const hidden = (row: NativeMoreRow) => NATIVE_MORE_HIDDEN.has(row.key) || (content === 1 && (NATIVE_HIDDEN_VIEWS.has(row.key) || nativeHiddenHref(row.href)));
  return sections.map((section) => ({ ...section, rows: section.rows.filter((row) => !hidden(row)) }))
    .filter((section) => section.rows.length);
}

/**
 * Time entries as one group per day, newest day first, in the list's own order inside the day, with the day's total
 * (Rapporterad tid at level 1). `dayOf` gives YYYY-MM-DD in Swedish time.
 */
export function entriesByDay<T extends { durationSec: number }>(items: readonly T[], dayOf: (item: T) => string): TimeDay<T>[] {
  const days = new Map<string, T[]>();
  for (const item of items) { const day = dayOf(item); days.set(day, [...(days.get(day) ?? []), item]); }
  return [...days.entries()].sort(([left], [right]) => right.localeCompare(left))
    .map(([day, own]) => ({ day, seconds: own.reduce((sum, item) => sum + (item.durationSec || 0), 0), items: own }));
}

/**
 * Mer's big tile (M2): Driftronder, taken out of the groups; the rest stay rows. Arbetsordrar is not repeated here: since
 * B3 (2026-10-21, 2026-10-23) it and Uppgifter are the Jobb tab's one list with its Typ filter. Without a Jobb button
 * of one's own the list keeps one row, Jobb; a row that only creates (no right to read the list) stays as it is. Tid is not
 * repeated either when the tab bar has it (2026-11-01, plan 3.2). The untitled groups that follow each other
 * become one group instead of a card each.
 */
export const NATIVE_MORE_TILES = ["rounds"] as const;
export const NATIVE_MORE_SAME_AS_TAB: readonly string[] = ["work_orders"];
const JOBS_LIST_HREF = "/?view=tasks";
export const NATIVE_MORE_JOBS_ROW: NativeMoreRow = { key: "jobs", label: "Jobb", type: "project", href: JOBS_LIST_HREF, testId: "native-more-jobs" };
export function nativeMoreTiles(sections: readonly NativeMoreSection[], options: { jobsTab?: boolean; timeTab?: boolean; aiTab?: boolean } = {}): { tiles: NativeMoreRow[]; sections: NativeMoreSection[] } {
  const jobsTab = options.jobsTab ?? true;
  const timeTab = options.timeTab ?? true;
  // Workflow AI as a tab (2026-11-21): its row in Mer goes, as Tid's does when Tid is a tab.
  const aiTab = options.aiTab ?? false;
  // What a yrkesprofil tucks away stays under Fler; it never becomes a big tile.
  const all = sections.filter((section) => section.title !== "Fler").flatMap((section) => section.rows);
  const tiles = NATIVE_MORE_TILES.map((key) => all.find((row) => row.key === key)).filter((row): row is NativeMoreRow => Boolean(row));
  const isJobList = (row: NativeMoreRow) => NATIVE_MORE_SAME_AS_TAB.includes(row.key) && (row.href === JOBS_LIST_HREF || row.href === "/?view=work_orders");
  const firstList = all.find(isJobList);
  const taken = new Set(tiles.map((row) => row.key));
  const rest = sections.map((section) => ({ ...section, rows: section.rows.flatMap((row) => {
    if (taken.has(row.key) || (timeTab && row.key === "time") || (aiTab && row.key === "ai")) return [];
    if (!isJobList(row)) return [row];
    // One Jobb row where the first job list stood, for someone whose tab bar has no Jobb.
    return !jobsTab && row === firstList ? [NATIVE_MORE_JOBS_ROW] : [];
  }) })).filter((section) => section.rows.length);
  const merged: NativeMoreSection[] = [];
  for (const section of rest) {
    const last = merged.at(-1);
    if (last && !last.title && !section.title) merged[merged.length - 1] = { ...last, rows: [...last.rows, ...section.rows] }; else merged.push(section);
  }
  return { tiles, sections: merged };
}

/**
 * Mer at level 1 as the shell shows it: without the hidden pages, and with the office's rows in a group of their own just
 * before Konto. Kalkylator is a row of Verktyg like its other pages (N19, 2026-11-01).
 */
export function nativeMoreTools(sections: readonly NativeMoreSection[], content: DetailLevel = 1): NativeMoreSection[] {
  const visibleAll = nativeVisibleSections(sections, content);
  const office = visibleAll.flatMap((section) => section.rows).filter((row) => NATIVE_MORE_OFFICE.includes(row.key))
    .sort((left, right) => NATIVE_MORE_OFFICE.indexOf(left.key) - NATIVE_MORE_OFFICE.indexOf(right.key));
  const withoutOffice = visibleAll.map((section) => ({ ...section, rows: section.rows.filter((row) => !NATIVE_MORE_OFFICE.includes(row.key)) })).filter((section) => section.rows.length);
  const accountAt = withoutOffice.findIndex((section) => section.title === "Konto");
  return office.length ? [...withoutOffice.slice(0, accountAt >= 0 ? accountAt : withoutOffice.length), { title: "Kontor", rows: office }, ...withoutOffice.slice(accountAt >= 0 ? accountAt : withoutOffice.length)] : withoutOffice;
}
/**
 * A step's name short enough for the flow row's Nästa button on a phone (2026-10-12: "Nästa: Isolation och Kont…"):
 * a name longer than `max` is cut to its first part – before " och ", a comma or a dash ("Isolation och Kontinuitet" →
 * "Isolation"); a name with no such part is kept whole.
 */
export function shortStepLabel(label: string, max = 18) {
  const whole = label.trim();
  if (whole.length <= max) return whole;
  const first = whole.split(/\s+och\s+|,\s*|\s+[–-]\s+/)[0]?.trim() ?? "";
  return first && first.length < whole.length ? first : whole;
}
