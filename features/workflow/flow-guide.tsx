"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Popover } from "radix-ui";
import { Check, Lightbulb, Settings2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRunningTimers } from "@/components/workspace-actions";
import { clientExtensions } from "@ee/client";
import { ADVISOR_DEFAULT, ADVISOR_LEVELS, ASSISTANT_ASK_EVENT, adviseFlow, pickAdvice, type Advice, type AdvisorContext, type AdvisorLevel } from "@/lib/workflow/flow-advisor";
import type { Flow, FlowStep } from "@/lib/workflow/task-flow";
import { announce } from "@/lib/workflow/toast";
import { publishFlowHint, publishPageContext, useFlowHintShown } from "./flow-hint-store";

// ---------- The person's setting for tips ----------
type AdvisorSettings = { level: AdvisorLevel; muted: string[]; autofill?: boolean };
type AdvisorSettingsValue = AdvisorSettings & { save: (next: AdvisorSettings) => Promise<void> };
const SETTINGS_KEY = "hwf-advisor";
const readLocal = (): AdvisorSettings => {
  if (typeof window === "undefined") return ADVISOR_DEFAULT;
  try { const value = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "null") as AdvisorSettings | null; if (value && ADVISOR_LEVELS.some((item) => item.value === value.level) && Array.isArray(value.muted)) return value; } catch { /* storage is optional */ }
  return ADVISOR_DEFAULT;
};
const AdvisorSettingsContext = createContext<AdvisorSettingsValue | null>(null);

/**
 * The person's tip setting (2026-10-01: "justera hur ofta det visas och stänga av det helt"): kept in their
 * preferences on the server when signed in, otherwise in this browser.
 */
export function AdvisorSettingsProvider({ value, onSave, children }: { value?: AdvisorSettings; onSave?: (next: AdvisorSettings) => Promise<void>; children: React.ReactNode }) {
  const [local, setLocal] = useState<AdvisorSettings>(readLocal);
  const current = value ?? local;
  const save = useCallback(async (next: AdvisorSettings) => {
    if (onSave) await onSave(next);
    else { setLocal(next); try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* storage is optional */ } }
  }, [onSave]);
  const context = useMemo(() => ({ ...current, save }), [current, save]);
  return <AdvisorSettingsContext.Provider value={context}>{children}</AdvisorSettingsContext.Provider>;
}
function useAdvisorSettings(): AdvisorSettingsValue {
  const context = useContext(AdvisorSettingsContext);
  const [local, setLocal] = useState<AdvisorSettings>(readLocal);
  return context ?? { ...local, save: async (next) => { setLocal(next); try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* storage is optional */ } } };
}

/** Whether the person lets HINTEK AI put a proposal they asked for straight into an empty field (Inställningar). */
export function useAdvisorAutofill() {
  return Boolean(useAdvisorSettings().autofill);
}

/** The tip level picker, shared by the tip card and Inställningar. */
export function AdvisorLevelPicker({ level, onChange, name = "advisor-level" }: { level: AdvisorLevel; onChange: (level: AdvisorLevel) => void; name?: string }) {
  return <div role="radiogroup" aria-label="Hur ofta tips visas" className="grid gap-1.5">
    {ADVISOR_LEVELS.map((item) => <label key={item.value} className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm", level === item.value ? "border-primary/50 bg-secondary" : "hover:bg-muted")}>
      <input type="radio" name={name} value={item.value} checked={level === item.value} onChange={() => onChange(item.value)} className="mt-1 accent-[var(--primary)]" />
      <span><span className="block font-medium">{item.label}</span><span className="block text-xs text-muted-foreground">{item.help}</span></span>
    </label>)}
  </div>;
}

// ---------- Where a step or a tip leads ----------

/**
 * An element id, or the heading of a panel ("Grunduppgifter", "Sammanfattning"). With a message (2026-10-01:
 * "vid viktiga händelser är det bättre med en toast"), it is also shown as a toast while the page moves to the field.
 */
export function focusTarget(target: string | undefined, message?: string) {
  if (message) announce(message, true);
  if (!target) return false;
  const element = document.getElementById(target)
    ?? [...document.querySelectorAll("section h2, [data-flow-target]")].find((item) => item.textContent?.trim() === target || item.getAttribute("data-flow-target") === target)?.closest("section, [data-flow-target]");
  if (!(element instanceof HTMLElement)) return false;
  guideTo(element);
  return true;
}

/**
 * Leads to what is missing (2026-10-01: "jag klickar på texten och inget händer – jag vill hamna på ett
 * färgmarkerat fält, t.ex. lätt ljust rött"): scrolls to it, marks its first empty field light red until it is changed
 * (at most a while) and puts the cursor there, or on its first unticked box.
 */
export function guideTo(element: HTMLElement) {
  element.scrollIntoView({ behavior: "smooth", block: "center" });
  const fields = element.matches("input, textarea, select, button") ? [element] : [...element.querySelectorAll<HTMLElement>("input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])")];
  const empty = fields.find((field) => (field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio") ? !field.checked : (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) ? !field.value : false)) ?? fields[0];
  // Only the field itself is marked (2026-10-01: "bara själva textfältet"), never its label or the whole panel;
  // a box is marked with its own label, since the box alone is too small to see.
  const box = empty instanceof HTMLInputElement && (empty.type === "checkbox" || empty.type === "radio");
  const marked = (box ? (empty.closest("label") as HTMLElement | null) : empty) ?? element;
  marked.classList.remove("flow-attention");
  void marked.offsetWidth;
  marked.classList.add("flow-attention");
  const clear = () => { marked.classList.remove("flow-attention"); marked.removeEventListener("input", clear); marked.removeEventListener("change", clear); };
  marked.addEventListener("input", clear);
  marked.addEventListener("change", clear);
  window.setTimeout(clear, 8_000);
  window.setTimeout(() => empty?.focus({ preventScroll: true }), 350);
}

// ---------- The progress line ----------
/**
 * Progressionen (2026-10-01): a thin line with a dot and a name for every step, between the header's icon row
 * and the first panel. Done steps are filled, the current one is marked and named below the line with what to do now;
 * a step can be clicked to go where it is done.
 */
export function FlowProgress({ flow, label = "Arbetsflöde" }: { flow: Flow; label?: string }) {
  const steps = flow.steps;
  // The current step's text sits in the header of the panel where it is done; here only when no panel takes it.
  const inPanel = useFlowHintShown();
  useEffect(() => {
    const step = flow.current;
    if (!step) { publishFlowHint(null); return; }
    let tries = 0;
    let timer = 0;
    const place = () => {
      const target = step.target ? document.getElementById(step.target)
        ?? [...document.querySelectorAll("section h2")].find((item) => item.textContent?.trim() === step.target) : null;
      const panel = target?.closest("section")?.querySelector("h2")?.textContent?.trim()
        ?? document.querySelector("main section h2")?.textContent?.trim();
      if (panel) publishFlowHint({ panel, step: step.label, hint: step.hint, number: flow.steps.findIndex((item) => item.key === step.key) + 1, total: flow.steps.length });
      else if (tries++ < 10) timer = window.setTimeout(place, 250);
      else publishFlowHint(null);
    };
    place();
    return () => { window.clearTimeout(timer); };
  }, [flow.current?.key, flow.current?.hint, flow.current?.target]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => publishFlowHint(null), []);
  const lastDone = steps.reduce((last, step, index) => (step.state === "done" || step.state === "skipped" || step.state === "current" ? index : last), 0);
  const fill = steps.length > 1 ? (lastDone / (steps.length - 1)) * 100 : 0;
  return <nav aria-label={label} className="flow-progress" data-testid="flow-progress" data-flow-done={flow.done || undefined}>
    <ol className="relative flex">
      <span aria-hidden="true" className="absolute top-[5px] h-px bg-border" style={{ left: `calc(100% / ${steps.length * 2})`, right: `calc(100% / ${steps.length * 2})` }} />
      <span aria-hidden="true" className={cn("absolute top-[5px] h-px", flow.done ? "bg-emerald-500" : "bg-primary")} style={{ left: `calc(100% / ${steps.length * 2})`, width: `calc((100% - 100% / ${steps.length}) * ${fill / 100})` }} />
      {steps.map((step) => <FlowDot key={step.key} step={step} done={flow.done} />)}
    </ol>
    {flow.done ? <p className="mt-2 text-center text-xs leading-5 text-muted-foreground" data-testid="flow-current"><Check className="mr-1 inline size-3.5 text-emerald-600" aria-hidden="true" />Klart – alla steg är gjorda.</p>
      : flow.current && !inPanel ? <p className="mx-auto mt-2 max-w-3xl text-center text-xs leading-5 text-muted-foreground" data-testid="flow-current"><span className="font-semibold text-foreground">Nu: {flow.current.label}.</span> {flow.current.hint}</p> : null}
  </nav>;
}

function FlowDot({ step, done }: { step: FlowStep; done: boolean }) {
  const stateText = step.state === "done" ? "klart" : step.state === "current" ? "pågår nu" : step.state === "skipped" ? "hoppades över (valfritt)" : step.optional ? "valfritt" : "kommer";
  return <li className="relative z-[1] flex min-w-0 flex-1 flex-col items-center" aria-current={step.state === "current" ? "step" : undefined}>
    <button type="button" onClick={() => focusTarget(step.target)} disabled={!step.target} title={`${step.label}: ${stateText}`} aria-label={`${step.label}, ${stateText}`}
      className="group flex min-w-0 max-w-full flex-col items-center rounded-md px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default">
      <span aria-hidden="true" className={cn("block size-[11px] rounded-full border-2 transition-colors",
        step.state === "done" ? (done ? "border-emerald-500 bg-emerald-500" : "border-primary bg-primary")
          : step.state === "current" ? "border-primary bg-card ring-4 ring-primary/20"
          : step.state === "skipped" ? "border-dashed border-muted-foreground/50 bg-card"
          : "border-muted-foreground/35 bg-card")} />
      <span className={cn("mt-1.5 max-w-full truncate text-[11px] leading-4", step.state === "current" ? "font-semibold text-foreground" : step.state === "done" ? "text-foreground/80" : "text-muted-foreground", step.target && "group-hover:text-primary")}>
        {step.label}{step.optional && step.state !== "done" ? <span className="sr-only"> (valfritt)</span> : null}
      </span>
    </button>
  </li>;
}

// ---------- The tip ----------
const DISMISS_KEY = "hwf-advisor-dismissed";
/** How long "Inte nu" keeps a tip away on this page, and how long a page must be open before a tip is shown. */
const DISMISS_MS = 12 * 60 * 60 * 1000;
const SETTLE_MS = 5_000;
const readDismissed = (page: string): string[] => {
  try {
    const all = JSON.parse(window.localStorage.getItem(DISMISS_KEY) ?? "{}") as Record<string, number>;
    const now = Date.now();
    return Object.entries(all).filter(([key, at]) => key.startsWith(`${page}|`) && now - at < DISMISS_MS).map(([key]) => key.slice(page.length + 1));
  } catch { return []; }
};
const writeDismissed = (page: string, id: string) => {
  try {
    const all = JSON.parse(window.localStorage.getItem(DISMISS_KEY) ?? "{}") as Record<string, number>;
    const now = Date.now();
    // Old entries are dropped, so the list stays small.
    const kept = Object.fromEntries(Object.entries(all).filter(([, at]) => now - at < DISMISS_MS).slice(-200));
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify({ ...kept, [`${page}|${id}`]: now }));
  } catch { /* storage is optional */ }
};

export type AdviceHandlers = { startTimer?: () => void; complete?: () => void; save?: () => void };
/** What the page tells HINTEK AI when the person asks for help with the current step: no names, only the flow. */
export type AdvisorPageContext = {
  kind: AdvisorContext["kind"];
  /** What the page is, e.g. "Kontroll före idrifttagning" – a kind, never a name. */
  label?: string;
  step: string | null; hint: string | null; steps: { label: string; state: string }[]; tip: string | null;
  /** What is still missing before the task can be completed (the completion rules' own messages). */
  missing?: string[];
  /** "tip" when asked from a tip's "Fråga HINTEK AI", "page" when the person types in the chat on the page. */
  source?: "tip" | "page";
};


/**
 * The progress line and, below it, at most one tip (2026-10-01, beslutsstöd): shown only after the page has
 * been open a few seconds and the tip has held that long, never one dismissed here in the last 12 hours or muted, and
 * only as often as the person's setting says. "Fråga HINTEK AI" is the only way the tip uses AI – and credits.
 */
export function FlowGuide({ flow, advisor, page, handlers, label, pageLabel, missing }: {
  flow: Flow;
  /** Everything but the flow; omit for a progress line without tips. */
  advisor?: Omit<AdvisorContext, "flow" | "otherTimer"> & { currentTaskId?: string };
  /** A key for this page (the task's id), so "Inte nu" is remembered per task. */
  page: string;
  handlers?: AdviceHandlers;
  label?: string;
  /** What the page is ("Arbetsorder", "Kontroll före idrifttagning") and what is missing, for HINTEK AI. */
  pageLabel?: string;
  missing?: string[];
}) {
  const settings = useAdvisorSettings();
  // HINTEK AI always knows the page the person is on (2026-10-01: "den förstår inte att jag är på
  // kontrollsidan"): kinds, steps and what is missing, never names.
  const pageContext: AdvisorPageContext | null = advisor ? { kind: advisor.kind, label: pageLabel, step: flow.current?.label ?? null, hint: flow.current?.hint ?? null, steps: flow.steps.map((step) => ({ label: step.label, state: step.state })), tip: null, missing: (missing ?? []).slice(0, 10).map((item) => item.slice(0, 200)) } : null;
  const pageKey = JSON.stringify(pageContext);
  useEffect(() => { publishPageContext(pageKey === "null" ? null : JSON.parse(pageKey)); }, [pageKey]);
  useEffect(() => () => publishPageContext(null), []);
  const router = useRouter();
  const timers = useRunningTimers();
  // The person's timer on another task, from the top bar's running timers (relations across pages).
  const other = timers?.timers.find((timer) => timer.taskId !== advisor?.currentTaskId);
  const tips = advisor ? adviseFlow({ ...advisor, flow, otherTimer: other ? { title: other.taskTitle } : null }) : [];
  // Dismissed here ("Inte nu"), read per page; the ones dismissed in this visit are added on top.
  const [dismissedNow, setDismissedNow] = useState<{ page: string; ids: string[] }>({ page, ids: [] });
  const dismissed = useMemo(() => [...readDismissed(page), ...(dismissedNow.page === page ? dismissedNow.ids : [])], [page, dismissedNow]);
  const candidate = pickAdvice(tips, settings.level, settings.muted, dismissed);
  // A tip is shown once the page has settled and the same tip has held for a moment (no flicker while typing).
  const [ready, setReady] = useState<{ page: string; id: string } | null>(null);
  const openedAt = useRef<{ page: string; at: number } | null>(null);
  useEffect(() => {
    if (openedAt.current?.page !== page) openedAt.current = { page, at: Date.now() };
    if (!candidate) return;
    const wait = Math.max(1_500, SETTLE_MS - (Date.now() - openedAt.current.at));
    const timer = window.setTimeout(() => setReady({ page, id: candidate.id }), wait);
    return () => window.clearTimeout(timer);
  }, [candidate?.id, page]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = candidate && ready?.page === page && ready.id === candidate.id ? candidate : null;
  const assistantAvailable = Boolean(clientExtensions.AssistantPanel);
  const act = (tip: Advice) => {
    const action = tip.action?.do;
    if (!action) return;
    if (action.kind === "focus") focusTarget(action.target);
    else if (action.kind === "link") router.push(action.href);
    else if (action.kind === "start-timer") handlers?.startTimer?.();
    else if (action.kind === "complete") handlers?.complete?.();
    else if (action.kind === "save") handlers?.save?.();
  };
  const dismiss = (tip: Advice) => { writeDismissed(page, tip.id); setDismissedNow((current) => ({ page, ids: [...(current.page === page ? current.ids : []), tip.id] })); };
  const mute = (tip: Advice) => { void settings.save({ level: settings.level, muted: [...new Set([...settings.muted, tip.id])].slice(-40), autofill: settings.autofill }); };
  const askAi = (tip: Advice) => {
    const context: AdvisorPageContext = { ...pageContext!, tip: `${tip.title}. ${tip.text}`, source: "tip" };
    window.dispatchEvent(new CustomEvent(ASSISTANT_ASK_EVENT, { detail: { question: `Hjälp mig med nästa steg: ${flow.current?.label ?? "uppgiften"}`, page: context } }));
  };
  return <div className="flow-guide space-y-3">
    <FlowProgress flow={flow} label={label} />
    {shown && settings.level !== "off" ? <aside aria-label="Tips" role="status" data-testid="flow-advice" data-advice={shown.id}
      className={cn("flex flex-wrap items-start gap-3 rounded-xl border px-3.5 py-3 text-sm shadow-xs", shown.priority === 3 ? "border-red-200 bg-red-50/70 dark:border-red-900 dark:bg-red-950/30" : "border-primary/20 bg-secondary/60")}>
      <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-card", shown.priority === 3 ? "text-red-700 dark:text-red-300" : "text-primary")}><Lightbulb className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{shown.title}</p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{shown.text}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {shown.action ? <Button type="button" size="sm" onClick={() => act(shown)} data-testid="flow-advice-action">{shown.action.label}</Button> : null}
          {assistantAvailable && advisor ? <Button type="button" size="sm" variant="outline" onClick={() => askAi(shown)} title="Öppnar HINTEK AI med det här steget. Frågor som kräver AI-modellen kostar krediter."><Sparkles />Fråga HINTEK AI</Button> : null}
          <Button type="button" size="sm" variant="ghost" onClick={() => dismiss(shown)} data-testid="flow-advice-dismiss">Inte nu</Button>
          <Button type="button" size="sm" variant="ghost" className="text-muted-foreground" onClick={() => mute(shown)} data-testid="flow-advice-mute">Visa inte sådana tips</Button>
        </div>
      </div>
      <div className="flex shrink-0 items-center">
        <Popover.Root>
          <Popover.Trigger asChild><Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Hur ofta tips visas" title="Hur ofta tips visas"><Settings2 /></Button></Popover.Trigger>
          <Popover.Portal><Popover.Content align="end" sideOffset={6} className="z-50 w-72 rounded-xl border bg-popover p-3 shadow-lg">
            <p className="mb-2 text-xs font-semibold">Tips i arbetsflödet</p>
            <AdvisorLevelPicker level={settings.level} name={`advisor-level-${page}`} onChange={(level) => void settings.save({ level, muted: settings.muted, autofill: settings.autofill })} />
            {settings.muted.length ? <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => void settings.save({ level: settings.level, muted: [], autofill: settings.autofill })}>Visa avstängda tips igen ({settings.muted.length})</Button> : null}
          </Popover.Content></Popover.Portal>
        </Popover.Root>
        <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Stäng tipset" onClick={() => dismiss(shown)}><X /></Button>
      </div>
    </aside> : null}
  </div>;
}
