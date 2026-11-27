"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, CalendarClock, ClipboardCheck, Eye, History, ListChecks, Pause, Play, Plus, RotateCcw, Send, ShieldCheck, Trash2, UserCheck, Users } from "lucide-react";
import { AreaIcon } from "@/components/area-icon";
import { PageBackButton, PageHeader, PageSkeleton } from "@/components/page-shell";
import { RowChevron } from "@/components/row-chevron";
import { ListCard, ListCardGrid, ListFilterBar, useListPrefs } from "@/components/list-filter-bar";
import { useEntryState } from "@/components/history-nav";
import { countByFilter, listSearchMatches, listSortOptions, sortListItems } from "@/lib/list-filter";
import type { WorkListScope } from "@/lib/workflow/work-list";
import {
  AGENT_LIST_KIND_LABEL, AGENT_LIST_KINDS, AGENT_STATUS_LABEL, AGENT_TRIGGER_LABEL, AGENT_TYPE_LABEL, agentKindMatches, agentListMatches,
  type AgentListItem, type AgentListKind, type AgentListStatus, type AgentListTrigger,
} from "@/lib/agents/agent-list";
import { Button } from "@/components/ui/button";
import { RemoveButton } from "@/components/ui/remove-button";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { Empty, Field, FoldRow, Panel, ShowMore, SwitchRow } from "@/features/kfid/ui";
import { AUTOSAVE_DELAY_MS } from "@/lib/workflow/autosave";
import { adoptCreated, editorKey, useFirstChangeSave } from "@/lib/workflow/use-first-change-save";
import { useUnsavedGuard } from "@/lib/workflow/use-unsaved-guard";
import { StatusPill } from "@/features/integrations/status-pill";
import { AdvisorLevelPicker } from "@/features/workflow/flow-guide";
import { AnswerBody, CHAT_ANSWER, CHAT_USER_BUBBLE, ChatChip, ChatComposer, ThinkingBubble } from "@/features/ai/chat-parts";
import { changedCards, chatAnswer, EXAMPLE_PROMPTS, GREETING, recipientsText, understoodWords, type CardKey } from "@/lib/agents/chat";
import { formatSwedish, swedishDayKey } from "@/lib/swedish-time";
import { useLoadEffect } from "@/lib/use-load-effect";
import { cn } from "@/lib/utils";
import type { MissionCheck, MissionProblem } from "@/lib/agents/check";
import {
  missionScheduleText, AGENT_EVENTS, FEEDBACK_CHANNELS, FEEDBACK_HELP, FEEDBACK_LABEL, POST_CHANNEL_LABEL, POST_CHANNELS, PUBLISH_LABEL, RECIPIENT_ROLE_LABEL, RECIPIENT_ROLES, RUN_STATUS_LABEL, SCHEDULE_KIND_LABEL, SCHEDULE_KINDS,
  TARGET_KINDS, TARGET_LABEL, WEEKDAY_LABEL,
  type MissionDraft, type MissionSchedule, type RecipientRole, type RunAction, type RunReport,
} from "@/lib/agents/model";
import { ownWordsFrom, type AgentTemplate } from "@/lib/agents/templates";
import type { AdvisorLevel } from "@/lib/workflow/flow-advisor";
import { REPORT_TEMPLATES } from "@/lib/agents/report-template";
import { SOURCE_KEYS, SOURCE_LABEL, toolTitle, WRITE_TOOLS, type SourceKey } from "@/lib/agents/tool-policy";

/** Every catalog tool that changes something, except the deny-list (2026-11-21: "så flexibelt och mycket som möjligt"). */
const ACTION_TOOLS = WRITE_TOOLS.map((name) => ({ name, title: toolTitle(name) }));
const PERIOD_LABEL: Record<NonNullable<MissionDraft["scope"]["period"]>, string> = { week: "Senaste veckan", month: "Senaste månaden", quarter: "Senaste kvartalet", year: "Senaste året" };

/**
 * Agenter (2026-11-21): the person's missions and the company's built-in agents. One list in the shared list page (as
 * Tavlor and Rapportarkiv) with Nytt uppdrag top right. A mission opens as a conversation (MissionEditor below). Earlier: ONE
 * editing window for every agent (2026-11-23): at its top the search and a grouped select (Mina uppdrag, Mallar, Inbyggda agenter)
 * fetch the agent to edit – the shared SearchPicker, the pattern of Apparatbiblioteket's top card. A mission or a template shows its
 * five parts in a fixed order – Vad agenten ska göra, Underlag, När, Vad agenten skapar, Så får du resultatet – and beside them
 * Kontrollera, Så här kommer agenten att arbeta and Provkör. Med egna ord is the first choice; a template is an example to start
 * from, fully editable, and saving it makes an own mission (the template stays). A built-in agent shows its extra instruction, when
 * it runs, on/off and Återställ till original; what it may do and never does cannot be changed. The demo shows the templates and a
 * few invented runs, and says that nothing runs there.
 */
type Options = { projects: { id: string; name: string }[]; rounds: { id: string; name: string }[]; connections: Record<string, { connected: boolean; publishing: boolean; name: string | null }>;
  news: boolean; ai: { ready: boolean; reason: string | null }; credits: { system: boolean; balance: number }; admin: boolean; missionCount: number; members?: { id: string; name: string }[] };
type Mission = MissionDraft & { id: string; ownerName: string; mine: boolean; status: string; pausedReason: string | null; nextRunAt: string | null; scheduleText: string; lastRunAt: string | null;
  lastOutcomeLabel: string | null; firstRunPending: boolean; cost: "rules" | "ai"; version: number; templateName: string; updatedAt?: string };
type Run = { id: string; trigger: string; status: string; statusLabel: string; tone: "success" | "neutral" | "warning" | "danger"; createdAt: string; read: Record<string, number>; actions: RunAction[];
  report: RunReport; feedback: Record<string, unknown>; cost: string; chargedCredits: number; message: string | null;
  /** Vem som betalar (2026-11-27): Ingår, "Krediter: n" or Företagets nyckel (lib/ai/payer.ts). */
  payerText?: string };
type SystemAgentView = { id: string; name: string; does: string; never: string; uses: "model" | "rules"; when: { key: string; label: string }[]; whenChosen?: string; on: boolean; focus: string; level: AdvisorLevel; standard: boolean };
type Overview = { missions: Mission[]; templates: AgentTemplate[]; options: Options; system: SystemAgentView[]; demo?: boolean; me?: string };
type Preview = { read: Record<string, number>; report: RunReport; effects: { kind: string; title: string; lines: string[]; decision: string; reasons: string[]; linkText: string }[]; nothing: boolean; skip: string | null; fail: string | null;
  feedback: { title: string; summary: string; links: string[]; channels: string[] } };

const VIEW = "/?view=agents";
const missionHref = (id: string) => `${VIEW}&mission=${encodeURIComponent(id)}`;
const systemHref = (id: string) => missionHref(`system:${id}`);
const templateHref = (key: string) => key === "custom" ? missionHref("new") : `${missionHref("new")}&template=${encodeURIComponent(key)}`;
const WHEN = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } as const;

export function AgentsPage({ mission, run, template }: { mission: string | null; run: string | null; template: string | null }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setOverview(await api<Overview>("/api/agents", { cache: "no-store" })); setError(""); } catch (cause) { setError((cause as Error).message); }
  }, []);
  useLoadEffect(load);
  if (error && !overview) return <div className="space-y-4"><PageHeader title="Agenter" /><p className="notice text-destructive" role="alert">{error}</p></div>;
  if (!overview) return <div data-testid="agents-page"><PageSkeleton label="Hämtar agenterna…" panels={2} rows={3} /></div>;
  if (mission?.startsWith("system:")) return <SystemAgentEditor key={mission} agentId={mission.slice(7)} overview={overview} onChanged={load} />;
  if (mission) return <MissionEditor key={editorKey(mission === "new" ? null : mission, `new:${template ?? ""}`)} id={mission} templateKey={template} openRun={run} overview={overview} onChanged={load} />;
  return <AgentsList overview={overview} />;
}

const AGENT_SORTS = ["updated", "title"] as const;
const AGENT_SCOPES: readonly WorkListScope[] = ["mine", "all"];

/** Every agent as one list item: a mission, an example to start from or a built-in agent. */
function listItems(overview: Overview): AgentListItem[] {
  const missions: AgentListItem[] = overview.missions.map((item) => ({ key: `mission:${item.id}`, kind: "mission", name: item.name, description: [item.mine ? null : item.ownerName, item.scheduleText, item.lastOutcomeLabel].filter(Boolean).join(" · "),
    href: missionHref(item.id), mine: item.mine, status: item.status === "active" ? "active" : "paused", trigger: item.schedule.kind === "event" ? "event" : "schedule",
    when: item.status === "active" ? (item.nextRunAt ? `Nästa ${formatSwedish(item.nextRunAt, WHEN)}` : item.schedule.kind === "event" ? "Väntar på händelsen" : "Ingen fler körning") : "Pausat", updatedAt: item.updatedAt ?? null }));
  const templates: AgentListItem[] = overview.templates.filter((item) => item.key !== "custom").map((item) => ({ key: `template:${item.key}`, kind: "template", name: item.name, description: item.does,
    href: templateHref(item.key), mine: false, status: null, trigger: item.defaults.schedule.kind === "event" ? "event" : "schedule", when: item.writes === "ai" ? "Workflow AI skriver texten" : "Ingår, kostar inget", updatedAt: null }));
  const system: AgentListItem[] = overview.system.map((agent) => ({ key: `system:${agent.id}`, kind: "system", name: agent.name, description: agent.does, href: systemHref(agent.id), mine: false,
    status: agent.on ? "active" : "off", trigger: null, when: agent.on ? (agent.standard ? "På" : "På, ändrad") : "Av för företaget", updatedAt: null }));
  return [...missions, ...templates, ...system];
}
const itemIcon = (item: AgentListItem) => item.kind === "mission" ? Bot : item.kind === "template" ? ClipboardCheck : ShieldCheck;
const itemTestId = (item: AgentListItem) => item.kind === "mission" ? `agents-mission-${item.key.slice(8)}` : item.kind === "template" ? `agents-template-${item.key.slice(9)}` : `agents-system-${item.key.slice(7)}`;
const KIND_ORDER: Record<AgentListItem["kind"], number> = { mission: 0, template: 1, system: 2 };

/**
 * Agenter's start page (2026-11-23): the shared list page of Tavlor and Rapportarkiv – the header with Nytt uppdrag, the shared
 * filter row (Mina | Alla, the kind as chips with counts, the search, Status and Schema eller händelse, the sort, Rader | Kort) and
 * ONE list of missions, examples and built-in agents. Every row opens the same editor.
 */
function AgentsList({ overview }: { overview: Overview }) {
  const router = useRouter();
  const prefs = useListPrefs("agents", overview.me ?? "me", { sorts: AGENT_SORTS, scopes: AGENT_SCOPES, scope: "all" });
  const scope = prefs.scope ?? "all";
  const [query, setQuery] = useEntryState("agents.q", "");
  const [kind, setKind] = useEntryState<AgentListKind>("agents.kind", "all");
  const [status, setStatus] = useEntryState<"" | AgentListStatus>("agents.status", "");
  const [trigger, setTrigger] = useEntryState<"" | AgentListTrigger>("agents.trigger", "");
  const all = useMemo(() => listItems(overview), [overview]);
  const filtered = useMemo(() => all.filter((item) => agentListMatches(item, { scope, status, trigger }) && listSearchMatches(query, [item.name, item.description])), [all, scope, status, trigger, query]);
  const counts = useMemo(() => countByFilter(filtered, AGENT_LIST_KINDS, agentKindMatches), [filtered]);
  const items = useMemo(() => sortListItems(filtered.filter((item) => agentKindMatches(item, kind)), prefs.sort === "title"
    ? [{ value: (item: AgentListItem) => item.name.toLocaleLowerCase("sv-SE") }]
    : [{ value: (item: AgentListItem) => item.updatedAt, direction: "desc" as const }, { value: (item: AgentListItem) => KIND_ORDER[item.kind] }, { value: (item: AgentListItem) => item.name.toLocaleLowerCase("sv-SE") }]), [filtered, kind, prefs.sort]);
  const changed = (item: AgentListItem) => item.updatedAt ? formatSwedish(item.updatedAt, { day: "numeric", month: "short" }) : "–";
  const badge = (item: AgentListItem) => <StatusPill tone={item.status === "active" ? "success" : "neutral"}>{item.status ? AGENT_STATUS_LABEL[item.status] : "Exempel"}</StatusPill>;
  const filteredOut = Boolean(query || scope === "mine" || kind !== "all" || status || trigger);
  return <div className="space-y-5" data-testid="agents-page" data-view={prefs.view}>
    <PageHeader title="Agenter" description="Uppdrag som Workflow AI gör åt dig med dina behörigheter, exempel att börja från och de inbyggda agenterna."
      actions={<Button type="button" onClick={() => router.push(missionHref("new"))} data-testid="agents-new"><Plus aria-hidden="true" />Nytt uppdrag</Button>} />
    {overview.demo ? <p className="notice" role="status" data-testid="agents-demo">I demon ser du mallarna och några påhittade körningar. Agenter går inte att köra här.</p> : null}
    <ListFilterBar testId="agents" label="Sök och filtrera agenter"
      scope={{ value: scope, scopes: AGENT_SCOPES, onChange: prefs.setScope }}
      chips={{ label: "Typ", chips: AGENT_LIST_KINDS.map((value) => ({ value, label: AGENT_LIST_KIND_LABEL[value], count: counts[value] })), value: kind, onChange: setKind, testId: "agents-kind" }}
      search={{ label: "Sök agenter", placeholder: "Sök på namn eller beskrivning", value: query, onChange: setQuery, testId: "agents-search" }}
      extras={[
        { key: "status", label: "Status", value: status, onChange: (value) => setStatus(value as "" | AgentListStatus), testId: "agents-status",
          options: [{ value: "", label: "Alla statusar" }, ...(Object.keys(AGENT_STATUS_LABEL) as AgentListStatus[]).map((value) => ({ value, label: AGENT_STATUS_LABEL[value] }))] },
        { key: "trigger", label: "Schema eller händelse", value: trigger, onChange: (value) => setTrigger(value as "" | AgentListTrigger), testId: "agents-trigger",
          options: [{ value: "", label: "Schema och händelser" }, ...(Object.keys(AGENT_TRIGGER_LABEL) as AgentListTrigger[]).map((value) => ({ value, label: AGENT_TRIGGER_LABEL[value] }))] },
      ]}
      sort={{ value: prefs.sort, options: listSortOptions(AGENT_SORTS), onChange: prefs.setSort }}
      view={{ value: prefs.view, onChange: prefs.setView }} />
    {!items.length ? (filteredOut
      ? <div className="notice" data-testid="agents-empty">{scope === "mine" && !overview.missions.some((item) => item.mine) ? "Du har inga egna uppdrag ännu. Tryck Nytt uppdrag, eller välj Alla för att se exemplen och de inbyggda agenterna." : "Inget matchar urvalet. Ändra filter eller sökning."}</div>
      : <div className="rounded-xl border bg-card" data-testid="agents-empty"><Empty title="Inga agenter" description="Tryck Nytt uppdrag och skriv med egna ord vad agenten ska göra." /></div>)
      : prefs.view === "cards" ? <ListCardGrid testId="agents-cards">{items.map((item) => <ListCard key={item.key} testId="agents-card" href={item.href} data={{ "data-kind": item.kind }}
          icon={<AreaIcon area="tools" icon={itemIcon(item)} />} title={item.name} subtitle={item.description || undefined} badges={badge(item)}
          facts={[{ icon: ListChecks, label: "Typ", value: AGENT_TYPE_LABEL[item.kind] }, { icon: CalendarClock, label: "Nästa körning eller status", value: item.when }, item.updatedAt ? { icon: History, label: "Ändrad", value: `Ändrad ${changed(item)}` } : null]} />)}</ListCardGrid>
      : <div role="table" aria-label="Agenter" className="overflow-hidden rounded-xl border bg-card shadow-xs" data-testid="agents-table">
        <div role="row" className="hidden gap-x-3 bg-[var(--panel-header)] px-3.5 py-2.5 text-xs font-semibold text-muted-foreground md:grid md:grid-cols-[minmax(0,1fr)_8rem_13rem_6rem_2.5rem]">
          <span role="columnheader">Namn</span><span role="columnheader">Typ</span><span role="columnheader">Nästa körning eller status</span><span role="columnheader">Ändrad</span><span role="columnheader"><span className="sr-only">Öppna</span></span>
        </div>
        <div role="rowgroup" className="divide-y" data-testid="agents-rows">{items.map((item) => <div key={item.key} role="row" data-kind={item.kind} className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3.5 py-3 text-sm transition-colors hover:bg-secondary/50 md:grid-cols-[minmax(0,1fr)_8rem_13rem_6rem_2.5rem]" data-testid="agents-row">
          <span role="cell" className="flex min-w-0 items-center gap-3">
            <AreaIcon area="tools" icon={itemIcon(item)} />
            <span className="min-w-0"><Link href={item.href} className="stretched-link block truncate font-semibold hover:text-primary" data-testid={itemTestId(item)}>{item.name}</Link>
              <span className="block truncate text-xs text-muted-foreground">{item.description}</span></span>
          </span>
          <span role="cell" className="text-xs text-muted-foreground max-md:hidden">{AGENT_TYPE_LABEL[item.kind]}</span>
          <span role="cell" className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">{badge(item)}<span className="truncate max-md:hidden">{item.when}</span></span>
          <span role="cell" className="text-xs text-muted-foreground max-md:hidden">{changed(item)}</span>
          <span role="cell" className="hidden justify-end md:flex"><RowChevron /></span>
        </div>)}</div>
      </div>}
  </div>;
}

// ---------- the built-in agents ----------

/** A built-in agent: its extra instruction, when it runs, on/off for the company and Återställ till original; each person's own level. Each change saves at once. */
function SystemAgentEditor({ agentId, overview, onChanged }: { agentId: string; overview: Overview; onChanged: () => Promise<void> }) {
  const agent = overview.system.find((item) => item.id === agentId);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [focus, setFocus] = useState(agent?.focus ?? "");
  const [level, setLevel] = useState<AdvisorLevel | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const admin = overview.options.admin;
  const demo = Boolean(overview.demo);
  if (!agent) return <div className="space-y-4" data-testid="agents-editor"><PageHeader title="Agenten finns inte" actions={<PageBackButton href={VIEW} label="Agenter" testId="agents-back" />} /></div>;
  const post = async (body: Record<string, unknown>, done: string) => {
    setBusy(true); setMessage(null);
    try { await api("/api/agents", { method: "POST", body: JSON.stringify({ agentId: agent.id, ...body }) }); await onChanged(); setMessage({ text: done }); return true; }
    catch (cause) { setMessage({ text: (cause as Error).message, error: true }); return false; } finally { setBusy(false); }
  };
  const reset = async () => {
    if (!(await confirm({ title: "Återställ till original?", message: `${agent.name} går tillbaka till Workflows original: på, utan extra instruktion och med standardvalet för när den körs.`, confirmLabel: "Återställ" }))) return;
    if (await post({ action: "system_company", reset: true }, `${agent.name} är återställd till original.`)) setFocus("");
  };
  return <div className="space-y-4" data-testid="agents-editor">
    {confirmElement}
    <PageHeader title={agent.name} description={agent.does}
      actions={<>
        {admin ? <Button type="button" variant="outline" disabled={busy || agent.standard || demo} disabledReason={agent.standard ? "Agenten är redan Workflows original." : null} onClick={() => void reset()} data-testid={`agents-system-${agent.id}-reset`}><RotateCcw />Återställ till original</Button> : null}
        <PageBackButton href={VIEW} label="Agenter" testId="agents-back" />
      </>} />
    {message ? <p className={cn("notice", message.error && "text-destructive")} role="status" data-testid="agents-message">{message.text}</p> : null}
    <div className="space-y-4" data-testid="agents-system-editor">
      <Panel icon={ShieldCheck} title="För hela företaget" description={admin ? "Det du väljer här gäller alla i företaget och sparas direkt." : "Företagets administratör bestämmer det här."}>
        <div className="space-y-3">
          <SwitchRow id={`system-${agent.id}-on`} testId={`agents-system-${agent.id}-on`} title="På för företaget" text="Av: agenten föreslår och tipsar inget för någon i företaget." checked={agent.on} disabled={!admin || busy || demo}
            onCheckedChange={(on) => void post({ action: "system_company", on }, on ? `${agent.name} är på.` : `${agent.name} är av för företaget.`)} />
          {agent.when.length > 1 ? <Field id={`system-${agent.id}-when`} label="När körs agenten?" value={agent.whenChosen ?? agent.when[0]!.key} options={agent.when.map((item) => item.key)} optionLabels={Object.fromEntries(agent.when.map((item) => [item.key, item.label]))} disabled={!admin || busy || demo}
            onChange={(when) => void post({ action: "system_company", when }, "Sparat.")} /> : <p className="text-sm text-muted-foreground">Agenten körs {agent.when[0]!.label.toLocaleLowerCase("sv")}.</p>}
          {agent.uses === "model" ? <div className="space-y-2">
            <Field id={`system-${agent.id}-focus`} label="Extra instruktion: hur agenten ska tänka och skriva" multiline value={focus} onChange={setFocus} disabled={!admin || demo}
              help="Till exempel: Vi arbetar mest med belysning i skolor, skriv kort och enkelt. Den läggs efter agentens egna regler och kan aldrig ändra vad agenten får göra." placeholder="Ingen extra instruktion" />
            {admin ? <Button type="button" size="sm" variant="outline" disabled={busy || focus.trim() === agent.focus || demo} onClick={() => void post({ action: "system_company", focus }, "Den extra instruktionen är sparad.")} data-testid={`agents-system-${agent.id}-focus-save`}>Spara instruktionen</Button> : null}
          </div> : <p className="text-sm text-muted-foreground">Agenten följer Workflows egna regler och använder ingen AI, så den har ingen extra instruktion.</p>}
          <p className="text-xs text-muted-foreground">{agent.never} Vad agenten får göra, och det ingen agent någonsin gör, finns i Workflows kod och går inte att ändra.</p>
        </div>
      </Panel>
      <Panel icon={UserCheck} title="Bara för dig">
        <div><p className="mb-1 text-xs font-medium">Hur ofta vill du själv få förslag och tips?</p>
          <AdvisorLevelPicker level={level ?? agent.level} name={`system-${agent.id}-level`} onChange={(next) => {
            setLevel(next);
            void post({ action: "system_person", level: next }, "Ditt val är sparat.").finally(() => setLevel(null));
          }} /></div>
      </Panel>
    </div>
  </div>;
}

// ---------- missions and templates ----------

const blankSchedule: MissionSchedule = { kind: "weekly", weekdays: [1], time: "07:00" };
const FEEDBACK_WORD: Record<(typeof FEEDBACK_CHANNELS)[number], string> = { EMAIL: "e-post", NOTICE: "en notis", CHAT: "en sammanfattning i chatten" };
const words = (items: readonly string[]) => items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} och ${items[items.length - 1]}`;
const RUNS_SHOWN = 5;

function draftFromTemplate(template: AgentTemplate | undefined): MissionDraft {
  if (!template) return { name: "", instruction: "", templateKey: "custom", scope: { projectIds: [], roundScheduleId: null, sources: ["work_orders"], period: "week" }, schedule: blankSchedule, target: { kind: "report", publish: "draft", channels: [] }, feedback: ["NOTICE"] };
  return { name: template.key === "custom" ? "" : template.name, instruction: "", templateKey: template.key, scope: { projectIds: [], roundScheduleId: null, ...template.defaults.scope, ...(template.key === "custom" ? { sources: [...template.sources], period: "week" as const } : {}) },
    schedule: template.defaults.schedule, target: { ...template.defaults.target, channels: [...template.defaults.target.channels] }, feedback: [...template.defaults.feedback] };
}

/** When and to whom, in plain words: "Den körs måndagar 07:00. Du får resultatet som e-post." */
function whenAndWho(draft: MissionDraft) {
  const others = (draft.recipients?.userIds.length ?? 0) + (draft.recipients?.roles.length ?? 0);
  return `Den körs ${missionScheduleText(draft.schedule).toLocaleLowerCase("sv")}. ${draft.feedback.length ? `Du får resultatet som ${words(draft.feedback.map((channel) => FEEDBACK_WORD[channel]))}` : "Inget sätt att få resultatet är valt"}${others ? ", och de mottagare du valt får det som e-post" : ""}.`;
}
/** A template-based mission's own words: what the template does, when and to whom. Unchanged, the template's rules run it. */
const templateText = (template: AgentTemplate, draft: MissionDraft) => `${template.does} ${whenAndWho(draft)}`;
/** One message of the mission's conversation (page state only, never stored). */
type ChatMessage = { id: number; role: "user" | "workflow"; text: string; replies?: readonly string[]; field?: string; ok?: boolean; preview?: Preview;
  /** The key words Workflow understood, as small chips over its answer. */
  words?: readonly string[] };

/**
 * Ett uppdrag som ett samtal (2026-11-23): the page speaks like Workflow AI's window though Workflow's own rules answer – the same
 * shared parts (features/ai/chat-parts.tsx: the person's bubble, the answer's text, the thinking lines, the field with the round send
 * button, the chips). The owner writes what the agent is to do or what to change; Workflow reads the words against the mission as
 * it is (rules first, Workflow AI when on), checks it and answers in plain words: what changed, what it will not do and why, what must
 * be put right, one question with ready answers – or "Allt stämmer. Du kan spara." with Spara and Provkör in the message. The chips
 * under the latest answer show the choices as they stand (När, Till vem, Resultat, Underlag); a chip opens its own small fields.
 * Under the conversation, folded: Fler val (every field) and Körhistorik. The conversation is page state only. Saving follows the
 * Workflow rule: a new mission is a paused draft at its first change, a paused one saves itself, an active one needs Spara.
 */
function MissionEditor({ id, templateKey, openRun, overview, onChanged }: { id: string; templateKey: string | null; openRun: string | null; overview: Overview; onChanged: () => Promise<void> }) {
  const router = useRouter();
  // The draft a new editor saved at its first change: kept as state for the page, and in a ref for the load that follows the address.
  const created = useRef<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const missionId = id === "new" ? createdId : id;
  const isNew = !missionId;
  const [mission, setMission] = useState<Mission | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [shownRuns, setShownRuns] = useState(RUNS_SHOWN);
  const startTemplate = overview.templates.find((item) => item.key === (templateKey ?? "custom"));
  // An existing mission has no draft until it is read: never a blank Med egna ord in its place.
  const [draft, setDraft] = useState<MissionDraft | null>(() => id === "new" ? draftFromTemplate(startTemplate) : null);
  const [saved, setSaved] = useState(() => id === "new" ? JSON.stringify(draft) : "");
  const names = useMemo(() => Object.fromEntries((overview.options.members ?? []).map((member) => [member.id, member.name])), [overview.options.members]);
  const counter = useRef(0);
  const nextId = () => { counter.current += 1; return counter.current; };
  const [messages, setMessages] = useState<ChatMessage[]>(() => id !== "new" ? []
    : startTemplate && startTemplate.key !== "custom" ? [{ id: 0, role: "workflow", text: `Exemplet ${startTemplate.name} är ifyllt i korten. Skriv om du vill ändra något, till exempel när den körs eller vem som får resultatet.` }]
      : [{ id: 0, role: "workflow", text: GREETING, replies: EXAMPLE_PROMPTS }]);
  const [input, setInput] = useState("");
  const [openCard, setOpenCard] = useState<CardKey | null>(null);
  // The cards the latest message filled in, lit for a moment.
  const [flash, setFlash] = useState<CardKey[]>([]);
  useEffect(() => {
    if (!flash.length) return;
    const timer = window.setTimeout(() => setFlash([]), 2_500);
    return () => window.clearTimeout(timer);
  }, [flash]);
  // Mallen var startpunkten: the template the mission followed, while the owner may still go back to it.
  const [fromTemplate, setFromTemplate] = useState<string | null>(null);
  const [check, setCheck] = useState<MissionCheck | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const thread = useRef<HTMLDivElement>(null);
  const template = overview.templates.find((item) => item.key === draft?.templateKey);
  const custom = overview.templates.find((item) => item.key === "custom");
  const say = (entry: Omit<ChatMessage, "id">) => setMessages((current) => [...current, { ...entry, id: nextId() }]);

  const loadMission = useCallback(async () => {
    if (id === "new" || id === created.current) return;
    try {
      const data = await api<{ mission: Mission; runs: Run[] }>(`/api/agents?mission=${encodeURIComponent(id)}`, { cache: "no-store" });
      const loaded = draftOf(data.mission);
      const latest = data.runs[0];
      setMission(data.mission); setRuns(data.runs); setDraft(loaded); setSaved(JSON.stringify(loaded));
      // The conversation starts with what the agent does, when, to whom, and how it is going.
      setMessages([{ id: 0, role: "workflow", text: [
        [data.mission.status === "active" ? "Agenten är på." : `Agenten är av.${data.mission.pausedReason ? ` ${data.mission.pausedReason}` : ""}`,
          data.mission.status === "active" && data.mission.nextRunAt ? `Nästa körning ${formatSwedish(data.mission.nextRunAt, WHEN)}.` : "",
          latest ? `Senast: ${latest.statusLabel.toLocaleLowerCase("sv")} ${formatSwedish(latest.createdAt, WHEN)}${latest.report?.summary ? ` – ${latest.report.summary}` : ""}` : "Det har inte körts än."].filter(Boolean).join(" "),
        data.mission.mine ? "Skriv vad du vill ändra, eller ändra direkt i korten." : "",
      ].filter(Boolean).join("\n\n") }]);
    } catch (cause) { setMessage({ text: (cause as Error).message, error: true }); }
  }, [id]);
  useLoadEffect(loadMission);
  // Kör nu runs in the background (2026-11-21): while a run is Väntar or Pågår the page asks again, and shows it as done.
  const running = runs.some((item) => item.status === "queued" || item.status === "running");
  useEffect(() => {
    if (!running || !missionId) return;
    const timer = window.setInterval(() => {
      void api<{ mission: Mission; runs: Run[] }>(`/api/agents?mission=${encodeURIComponent(missionId)}`, { cache: "no-store" }).then((data) => { setRuns(data.runs); setMission(data.mission); }).catch(() => undefined);
    }, 2_500);
    return () => window.clearInterval(timer);
  }, [running, missionId]);
  // The newest message is in view.
  useEffect(() => { const box = thread.current; if (box) box.scrollTop = box.scrollHeight; }, [messages.length, busy]);

  // The check on every change of the draft, a moment after it stops (the fields under Fler val, a chip's own fields). Free, no AI.
  const draftKey = draft ? JSON.stringify(draft) : "";
  useEffect(() => {
    if (!draftKey) return;
    const timer = window.setTimeout(() => {
      void api<{ check: MissionCheck }>("/api/agents", { method: "POST", body: JSON.stringify({ action: "check", mission: JSON.parse(draftKey), ...(missionId ? { missionId } : {}) }) })
        .then((answer) => setCheck(answer.check)).catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draftKey, missionId]);

  const post = async <T,>(body: Record<string, unknown>) => api<T>("/api/agents", { method: "POST", body: JSON.stringify(body) });
  const mine = isNew || Boolean(mission?.mine);
  const editable = mine && !overview.demo;
  const active = mission?.status === "active";
  const dirty = Boolean(draft) && draftKey !== saved;
  const named = (value: MissionDraft) => ({ ...value, name: value.name.trim() || "Nytt uppdrag" });

  /** Saves the draft as it is (a new one paused, a paused one as it is); never switches it on. True when saved. */
  const saveDraft = async () => {
    if (!draft || !editable) return false;
    const sent = draftKey;
    try {
      if (!missionId) {
        const answer = await post<{ mission: Mission }>({ action: "create", mission: named(draft), active: false });
        created.current = answer.mission.id; setCreatedId(answer.mission.id);
        adoptCreated(answer.mission.id, `new:${templateKey ?? ""}`);
        setMission(answer.mission); setSaved(sent);
        router.replace(missionHref(answer.mission.id));
        void onChanged();
        return true;
      }
      const answer = await post<{ mission: Mission; runs: Run[] }>({ action: "update", missionId, mission: named(draft), version: mission?.version });
      setMission(answer.mission); setRuns(answer.runs); setSaved(sent);
      return true;
    } catch (cause) { setMessage({ text: (cause as Error).message, error: true }); return false; }
  };
  // Lika är rätt: a new mission is saved as a paused draft at its first change; a paused one saves itself after a calm pause.
  useFirstChangeSave({ isNew, dirty, ready: editable, busy: Boolean(busy), change: draftKey, save: saveDraft });
  const saveRef = useRef(saveDraft);
  useEffect(() => { saveRef.current = saveDraft; });
  useEffect(() => {
    if (isNew || active || !dirty || !editable || busy) return;
    const timer = window.setTimeout(() => void saveRef.current(), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isNew, active, dirty, editable, busy, draftKey]);
  // An active mission waits for Spara: every way out asks. A draft saves on the way out instead.
  useUnsavedGuard(dirty && editable, confirm, active ? undefined : saveDraft);

  /**
   * Skicka: the owner's words are read against the mission as it is (rules first, Workflow AI when on), the mission is checked and
   * Workflow answers. `words` is what is read; `shown` what the owner's bubble says (a ready answer's own label).
   */
  const send = async (words: string, shown = words, field?: string) => {
    const text = words.trim();
    if (!draft || text.length < 2 || busy) return;
    setInput(""); setOpenCard(null); setMessage(null);
    say({ role: "user", text: shown.trim() });
    setBusy("interpret");
    try {
      // A ready answer to "Hur vill du få resultatet?" is the whole answer, not one more channel.
      const answer = await post<{ draft: MissionDraft; questions: { field: string }[]; changes?: string[]; denied?: string[]; check: MissionCheck; proposedTools?: { title: string }[] }>(
        { action: "interpret", text: field === "feedback" ? `bara ${text}` : text, current: draft, ...(missionId ? { missionId } : {}) });
      const wasTemplate = draft.templateKey !== "custom" && answer.draft.templateKey === "custom" ? draft.templateKey : null;
      if (wasTemplate) setFromTemplate(wasTemplate);
      setDraft(answer.draft); setCheck(answer.check); setFlash(changedCards(draft, answer.draft));
      const reply = chatAnswer({ draft: answer.draft, check: answer.check, changes: answer.changes, denied: answer.denied, asked: answer.questions.map((item) => item.field), rounds: overview.options.rounds.map((item) => item.name), names,
        whole: !(answer.changes ?? []).length && !(answer.denied ?? []).length });
      const proposed = (answer.proposedTools ?? []).map((item) => item.title.toLocaleLowerCase("sv"));
      say({ role: "workflow", ok: reply.ok, replies: reply.question?.replies, field: reply.question?.field, words: understoodWords(draft, answer.draft, names),
        text: proposed.length ? `${reply.text}\n\nWorkflow AI föreslår att agenten får ${proposed.join(", ")}. Du ser det i kortet Resultat och kan ta bort det du inte vill.` : reply.text });
    } catch (cause) { say({ role: "workflow", text: `Det gick inte att läsa det. ${(cause as Error).message}` }); }
    finally { setBusy(null); }
  };
  const sentWords = useRef(false);
  useEffect(() => {
    if (id !== "new" || sentWords.current) return;
    const text = new URLSearchParams(window.location.search).get("words");
    if (!text) return;
    const timer = window.setTimeout(() => { sentWords.current = true; void send(text); }, 0);
    return () => window.clearTimeout(timer);
    // The words of the address are sent once, when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /** A card closed with Klar: the mission is checked at once, and the conversation says what is left – or that all is right. */
  const closeCard = async (title: string) => {
    setOpenCard(null);
    if (!draft || draftKey === saved && check?.ok) return;
    try {
      const answer = await post<{ check: MissionCheck }>({ action: "check", mission: draft, ...(missionId ? { missionId } : {}) });
      setCheck(answer.check);
      const reply = chatAnswer({ draft, check: answer.check, changes: [`Kortet ${title} är ändrat.`], names });
      say({ role: "workflow", ok: reply.ok, replies: reply.question?.replies, field: reply.question?.field, text: reply.text });
    } catch (cause) { say({ role: "workflow", text: (cause as Error).message }); }
  };

  /** Spara (active) or Spara och slå på (new or paused): the whole check must be green. */
  const save = async () => {
    if (!draft) return;
    setBusy("save"); setMessage(null);
    try {
      let after: { mission: Mission; runs?: Run[] };
      if (!missionId) {
        after = await post<{ mission: Mission }>({ action: "create", mission: named(draft), active: true });
        created.current = after.mission.id; setCreatedId(after.mission.id);
        adoptCreated(after.mission.id, `new:${templateKey ?? ""}`);
        setSaved(draftKey);
        router.replace(missionHref(after.mission.id));
      } else {
        const answer = await post<{ mission: Mission; runs: Run[] }>({ action: "update", missionId, mission: named(draft), version: mission?.version });
        setSaved(draftKey);
        after = active ? answer : await post<{ mission: Mission; runs: Run[] }>({ action: "resume", missionId });
      }
      setMission(after.mission); if (after.runs) setRuns(after.runs); setFromTemplate(null);
      say({ role: "workflow", text: `Sparat. Uppdraget är på${after.mission.nextRunAt ? `, och körs nästa gång ${formatSwedish(after.mission.nextRunAt, WHEN)}` : ""}.${after.mission.firstRunPending ? " Första körningen sparar alltid ett utkast i stället för att publicera." : ""}` });
      await onChanged();
    } catch (cause) { say({ role: "workflow", text: `Det gick inte att spara. ${(cause as Error).message}` }); } finally { setBusy(null); }
  };
  const act = async (action: string, extra: Record<string, unknown> = {}, done?: string) => {
    if (!missionId) return;
    setBusy(action); setMessage(null);
    try { const answer = await post<{ mission: Mission; runs: Run[] }>({ action, missionId, ...extra }); setMission(answer.mission); setRuns(answer.runs); if (done) say({ role: "workflow", text: done }); await onChanged(); }
    catch (cause) { setMessage({ text: (cause as Error).message, error: true }); } finally { setBusy(null); }
  };
  const remove = async () => {
    if (!missionId || !(await confirm({ title: "Ta bort uppdraget?", message: "Uppdraget tas bort. Det agenten redan har skapat finns kvar, och körhistoriken sparas.", confirmLabel: "Ta bort", tone: "danger" }))) return;
    setBusy("delete");
    try { setSaved(draftKey); await post({ action: "delete", missionId }); await onChanged(); router.push(VIEW); } catch (cause) { setMessage({ text: (cause as Error).message, error: true }); setBusy(null); }
  };
  /** Provkör: everything but saving, publishing and sending; the result comes as a message. */
  const tryRun = async () => {
    if (!draft) return;
    setBusy("preview"); setMessage(null);
    try {
      const preview = (await post<{ preview: Preview }>({ action: "preview", mission: draft, ...(missionId ? { missionId } : {}) })).preview;
      say({ role: "workflow", preview, text: preview.skip || preview.fail ? "Testet gick inte igenom:" : "Så här hade det blivit. Inget sparades, publicerades eller skickades." });
    } catch (cause) { say({ role: "workflow", text: `Testet gick inte. ${(cause as Error).message}` }); } finally { setBusy(null); }
  };

  if (!draft) return message?.error ? <div className="space-y-4" data-testid="agents-editor"><PageHeader title="Uppdraget" actions={<PageBackButton href={VIEW} label="Agenter" testId="agents-back" />} /><p className="notice text-destructive" role="alert">{message.text}</p></div>
    : <div data-testid="agents-editor"><PageSkeleton label="Hämtar uppdraget…" panels={2} rows={3} /></div>;
  const problems = check?.problems ?? [];
  const problemOf = (...fields: MissionProblem["field"][]) => problems.filter((item) => fields.includes(item.field)).map((item) => item.message).join(" ") || undefined;
  const set = (patch: Partial<MissionDraft>) => setDraft({ ...draft, ...patch });
  const ok = Boolean(check?.ok);
  const notOkReason = !check ? "Kontrollerar…" : ok ? null : "Rätta det som samtalet säger först.";
  const isCustom = draft.templateKey === "custom";
  const target = draft.target;
  const text = isCustom || !template ? draft.instruction : templateText(template, draft);
  /** Fler val, the text itself: unchanged, a template mission follows its template; any edit makes it Med egna ord (Workflow AI). */
  const changeText = (value: string) => {
    if (!isCustom && template) {
      if (value.trim() === text.trim()) return;
      setFromTemplate(template.key);
      setDraft({ ...ownWordsFrom({ ...draft, instruction: value }), instruction: value });
    } else setDraft({ ...draft, instruction: value });
  };
  /** What it reads or makes, outside the template's own part, makes it Med egna ord too. */
  const changeWhat = (patch: Partial<MissionDraft>, leavesTemplate: boolean) => {
    const next = { ...draft, ...patch };
    if (leavesTemplate && !isCustom && template) { setFromTemplate(template.key); setDraft({ ...ownWordsFrom(next), instruction: templateText(template, next) }); }
    else setDraft(next);
  };
  const backToTemplate = () => {
    const original = overview.templates.find((item) => item.key === fromTemplate);
    if (!original) return;
    const fresh = draftFromTemplate(original);
    const next = { ...draft, templateKey: original.key, instruction: "", scope: { ...fresh.scope, projectIds: draft.scope.projectIds, roundScheduleId: draft.scope.roundScheduleId }, target: fresh.target };
    setDraft(next); setFromTemplate(null);
    setFlash(["what", "basis", "result"]);
    say({ role: "workflow", text: `Agenten följer mallen ${original.name} igen, med Workflows egna regler.` });
  };
  const sources: readonly SourceKey[] = isCustom ? (draft.scope.sources?.length ? draft.scope.sources : ["work_orders"]) : (template?.sources ?? []);
  // What it makes: the template's own, and everything Med egna ord can make (choosing one of those makes it Med egna ord).
  const targetKinds = TARGET_KINDS.filter((kind) => (template?.targets.includes(kind) || custom?.targets.includes(kind)) && (kind !== "news" || overview.options.news));
  // The on/off words (2026-11-23: "så man fattar om agenten är av eller på"): the header says På or Av, the switch-off button is
  // Stäng av, and the primary button of a mission that is off is Slå på (it saves first).
  const saveLabel = active ? "Spara" : "Slå på";
  const stateText = !missionId || !mission ? "Agenten är av. Den är inte sparad ännu." : active ? `Agenten är på.${mission.nextRunAt ? ` Nästa körning ${formatSwedish(mission.nextRunAt, WHEN)}.` : ""}` : `Agenten är av.${mission.pausedReason ? ` ${mission.pausedReason}` : ""}`;
  const saveReason = !editable ? "Det går inte att spara i demon." : busy ? null : notOkReason ?? (active && !dirty ? "Inga ändringar att spara." : null);
  const lastWorkflow = [...messages].reverse().find((item) => item.role === "workflow" && !item.preview);

  // Korten (2026-11-23): each part of the proposal is a small card – its value in plain words, its own fields when opened, and a clear
  // mark with the problem's text when something is missing. The conversation fills them in; a card that just changed is lit a moment.
  const cardProblem: Record<CardKey, string | undefined> = {
    what: problemOf("instruction", "name", "general", "owner"), when: problemOf("schedule"), basis: problemOf("scope"), result: problemOf("target", "channels"), who: problemOf("feedback", "recipients"),
  };
  const others = recipientsText(draft, names);
  const cardValue: Record<CardKey, string> = {
    what: isCustom ? (draft.instruction.trim() || "Inte skrivet ännu. Skriv i samtalet vad agenten ska göra.") : template?.does ?? "",
    when: missionScheduleText(draft.schedule),
    basis: `${words(sources.map((source) => SOURCE_LABEL[source])) || "Mallens eget underlag"}${isCustom ? `, ${PERIOD_LABEL[draft.scope.period ?? "week"].toLocaleLowerCase("sv")}` : ""}${draft.scope.projectIds.length ? `, bara ${draft.scope.projectIds.length === 1 ? "ett projekt" : `${draft.scope.projectIds.length} projekt`}` : ""}`,
    result: `${TARGET_LABEL[target.kind]}${target.kind === "post" || target.kind === "news" ? `, ${PUBLISH_LABEL[target.publish].toLocaleLowerCase("sv")}` : ""}${target.kind === "actions" && target.tools?.length ? `: ${words(target.tools.map((name) => toolTitle(name).toLocaleLowerCase("sv")))}` : ""}${target.attachPdf ? ", med PDF i e-posten" : ""}`,
    who: draft.feedback.length ? `${words(draft.feedback.map((channel) => FEEDBACK_LABEL[channel]))} till dig${others ? `, och e-post till ${others}` : ""}` : "Inte valt ännu",
  };
  const cardMissing: Record<CardKey, boolean> = { what: isCustom && draft.instruction.trim().length < 10, when: false, basis: false, result: false, who: !draft.feedback.length };
  const whatFields = <div className="space-y-3">
    <Field id="agents-instruction" label="Vad ska agenten göra?" multiline value={text} onChange={changeText}
      help={isCustom ? "Agenten följer dina egna ord och använder Workflow AI, med dina behörigheter." : "Så länge texten är oförändrad följer agenten mallen med Workflows egna regler. Det kostar inget och använder ingen AI."} />
    {fromTemplate ? <Button type="button" size="sm" variant="outline" onClick={backToTemplate} data-testid="agents-back-to-template"><RotateCcw />Följ mallen igen</Button> : null}
  </div>;
  const whenFields = <ScheduleFields schedule={draft.schedule} onChange={(schedule) => set({ schedule })} />;
  const whoFields = <div className="space-y-3">
    <div className="flex flex-wrap gap-x-4 gap-y-1" data-testid="agents-feedback">
      {FEEDBACK_CHANNELS.map((channel) => <label key={channel} className="flex min-h-9 items-center gap-2 text-sm" title={FEEDBACK_HELP[channel]}>
        <Checkbox checked={draft.feedback.includes(channel)} onCheckedChange={(on) => set({ feedback: on === true ? [...draft.feedback, channel] : draft.feedback.filter((item) => item !== channel) })} data-testid={`agents-feedback-${channel}`} />
        {FEEDBACK_LABEL[channel]}</label>)}
    </div>
    <Recipients draft={draft} members={overview.options.members ?? []} choice={check?.recipients} onChange={(recipients) => set({ recipients })} />
  </div>;
  const resultFields = <div className="space-y-3">
    <Field id="agents-target" label="Resultat" value={target.kind} options={targetKinds} optionLabels={TARGET_LABEL}
      onChange={(kind) => { const next = kind as MissionDraft["target"]["kind"]; changeWhat({ target: { ...target, kind: next, ...(next === "actions" ? { tools: target.tools ?? [] } : {}) } }, Boolean(template && !template.targets.includes(next))); }} />
    {target.kind === "post" || target.kind === "news" ? <div role="radiogroup" aria-label="Publicering" className="grid gap-1.5" data-testid="agents-publish">
      {(["draft", "auto"] as const).map((mode) => <label key={mode} className={cn("flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm", target.publish === mode ? "border-primary/50 bg-secondary" : "hover:bg-muted")}>
        <input type="radio" name="agents-publish" checked={target.publish === mode} onChange={() => set({ target: { ...target, publish: mode } })} className="mt-1 accent-[var(--primary)]" data-testid={`agents-publish-${mode}`} />
        <span><span className="block font-medium">{PUBLISH_LABEL[mode]}</span><span className="block text-xs text-muted-foreground">{mode === "draft" ? "Du publicerar själv." : "Agenten publicerar, men sparar ett utkast när det är känsligt."}</span></span>
      </label>)}
    </div> : null}
    {target.kind === "post" ? <fieldset className="space-y-1" data-testid="agents-channels"><legend className="text-xs font-medium">Var inlägget publiceras</legend>
      {POST_CHANNELS.map((channel) => { const connection = overview.options.connections[channel]; return <label key={channel} className={cn("flex min-h-9 items-center gap-2 text-sm", !connection?.connected && "text-muted-foreground")}>
        <Checkbox checked={target.channels.includes(channel)} onCheckedChange={(on) => set({ target: { ...target, channels: on === true ? [...target.channels, channel] : target.channels.filter((item) => item !== channel) } })} data-testid={`agents-channel-${channel}`} />
        {POST_CHANNEL_LABEL[channel]}{connection?.name ? ` (${connection.name})` : ""}{!connection?.connected ? " – inte kopplat" : target.publish === "auto" && !connection.publishing ? " – publicering avstängd" : ""}</label>; })}
    </fieldset> : null}
    {target.kind === "actions" ? <fieldset className="space-y-1" data-testid="agents-action-tools"><legend className="text-xs font-medium">Vad agenten får ändra (med dina behörigheter)</legend>
      <div className="flex flex-wrap gap-x-4">{ACTION_TOOLS.map((tool) => <label key={tool.name} className="flex min-h-9 items-center gap-2 text-sm">
        <Checkbox checked={(target.tools ?? []).includes(tool.name)} onCheckedChange={(on) => set({ target: { ...target, tools: on === true ? [...(target.tools ?? []), tool.name] : (target.tools ?? []).filter((item) => item !== tool.name) } })} data-testid={`agents-tool-${tool.name}`} />{tool.title}</label>)}</div>
      <p className="text-xs text-muted-foreground">Agenten frågar först. Varje ändring väntar under Körhistorik tills du väljer Godkänn.</p>
    </fieldset> : null}
    <Field id="agents-report" label="Rapportmall (PDF)" value={target.report ?? ""} options={["", ...REPORT_TEMPLATES.map((item) => item.key)]} optionLabels={{ "": "Mallens egen", ...Object.fromEntries(REPORT_TEMPLATES.map((item) => [item.key, item.name])) }}
      onChange={(report) => set({ target: { ...target, report: report || null } })} />
    <label className="flex min-h-9 items-center gap-2 text-sm"><Checkbox checked={Boolean(target.attachPdf)} onCheckedChange={(on) => set({ target: { ...target, attachPdf: on === true } })} data-testid="agents-attach-pdf" />Bifoga rapporten som PDF i e-posten</label>
    {check?.cautions.length ? <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground" data-testid="agents-cautions">{check.cautions.map((item) => <li key={item}>{item}</li>)}</ul> : null}
  </div>;
  const basisFields = <div className="space-y-3">
    <fieldset className="space-y-1" data-testid="agents-sources"><legend className="text-xs font-medium">Vad agenten läser</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">{SOURCE_KEYS.map((key) => <label key={key} className="flex min-h-9 items-center gap-2 text-sm">
        <Checkbox checked={sources.includes(key)} onCheckedChange={(on) => { const next = on === true ? [...new Set([...sources, key])] : sources.filter((item) => item !== key); changeWhat({ scope: { ...draft.scope, sources: next.length ? next : ["work_orders"] } }, true); }} data-testid={`agents-source-${key}`} />{SOURCE_LABEL[key]}</label>)}</div>
    </fieldset>
    <Field id="agents-period" label="Period" value={draft.scope.period ?? "week"} options={Object.keys(PERIOD_LABEL)} optionLabels={PERIOD_LABEL}
      onChange={(period) => changeWhat({ scope: { ...draft.scope, period: period as NonNullable<MissionDraft["scope"]["period"]>, sources: [...sources] } }, true)} />
    {template?.needs.round ? <Field id="agents-round" label="Driftrond" value={draft.scope.roundScheduleId ?? ""} options={["", ...overview.options.rounds.map((item) => item.id)]} optionLabels={{ "": "Välj rond", ...Object.fromEntries(overview.options.rounds.map((item) => [item.id, item.name])) }}
      onChange={(roundScheduleId) => set({ scope: { ...draft.scope, roundScheduleId: roundScheduleId || null } })} /> : null}
    {overview.options.projects.length ? <fieldset className="space-y-1.5"><legend className="text-xs font-medium">Bara de här projekten (inget valt: allt du får se)</legend>
      <div className="flex max-h-40 flex-wrap gap-x-4 gap-y-1 overflow-y-auto">{overview.options.projects.map((project) => <label key={project.id} className="flex min-h-9 items-center gap-2 text-sm">
        <Checkbox checked={draft.scope.projectIds.includes(project.id)} onCheckedChange={(on) => set({ scope: { ...draft.scope, projectIds: on === true ? [...draft.scope.projectIds, project.id] : draft.scope.projectIds.filter((item) => item !== project.id) } })} />{project.name}</label>)}</div>
    </fieldset> : null}
    {!isCustom ? <p className="text-xs text-muted-foreground">Ändrar du vad agenten läser följer den dina egna ord i stället för mallen, och använder Workflow AI.</p> : null}
  </div>;
  const CARDS: { key: CardKey; title: string; icon: typeof Bot; fields: React.ReactNode }[] = [
    { key: "what", title: "Vad", icon: Bot, fields: whatFields }, { key: "when", title: "När", icon: CalendarClock, fields: whenFields }, { key: "basis", title: "Underlag", icon: ListChecks, fields: basisFields },
    { key: "result", title: "Resultat", icon: ClipboardCheck, fields: resultFields }, { key: "who", title: "Till vem", icon: Send, fields: whoFields },
  ];
  const saveButton = (testId: string) => mine ? <Button type="button" disabled={Boolean(saveReason) || Boolean(busy)} disabledReason={saveReason} busy={busy === "save"} busyLabel="Sparar…" onClick={() => void save()} data-testid={testId}>{saveLabel}</Button> : null;
  const previewButton = (testId: string) => <Button type="button" variant="outline" disabled={Boolean(busy) || !check} busy={busy === "preview"} busyLabel="Testar…" onClick={() => void tryRun()} data-testid={testId}><Eye />Testa uppdraget</Button>;

  return <div className="space-y-4" data-testid="agents-editor">
    {confirmElement}
    {/* En mall för sidornas överdel (2026-11-02): the red one furthest left, then the page's own (outline), Tillbaka, and Spara furthest right. */}
    <PageHeader title={draft.name.trim() || (isNew ? "Nytt uppdrag" : mission?.name || "Uppdrag")}
      description={`${stateText}${mission && !mission.mine ? ` Ägare: ${mission.ownerName}.` : ""}`}
      actions={<>
        {missionId && mission ? <Button type="button" variant="outline" className="text-destructive" disabled={Boolean(busy) || Boolean(overview.demo)} onClick={() => void remove()} data-testid="agents-delete"><Trash2 />Ta bort</Button> : null}
        {previewButton("agents-preview")}
        {missionId && mission?.mine ? <Button type="button" variant="outline" disabled={Boolean(busy) || !ok || dirty || Boolean(overview.demo)} disabledReason={overview.demo ? "Agenter går inte att köra i demon." : dirty ? "Spara ändringarna först." : notOkReason} onClick={() => void act("run_now", { nonce: crypto.randomUUID() }, "Körningen har startat. Körhistoriken visar när den är klar.")} data-testid="agents-run-now"><Play />{running ? "Körs…" : "Kör uppdraget en gång"}</Button> : null}
        {missionId && mission && active ? <Button type="button" variant="outline" disabled={Boolean(busy) || Boolean(overview.demo)} onClick={() => void act("pause", {}, "Agenten är av. Ändringar sparas nu av sig själva.")} data-testid="agents-pause"><Pause />Stäng av</Button> : null}
        {missionId && mission && !mission.mine && overview.options.admin ? <Button type="button" variant="outline" disabled={Boolean(busy) || Boolean(overview.demo)} onClick={() => void act("take_over", {}, "Du äger nu uppdraget. Kontrollera det och slå på det igen.")} data-testid="agents-take-over"><UserCheck />Ta över uppdraget</Button> : null}
        <PageBackButton href={VIEW} label="Agenter" testId="agents-back" />
        {/* Spara always shows for one's own mission; in the demo it is greyed out with the reason, like Kör nu (2026-11-23: "det finns ingen spara knapp?"). */}
        {saveButton("agents-save")}
      </>} />
    {overview.demo ? <p className="notice" role="status">I demon går det att prata med agenten och se vad den skulle göra, men inget sparas eller körs.</p> : null}
    {message ? <p className={cn("notice", message.error && "text-destructive")} role="status" data-testid="agents-message">{message.text}</p> : null}
    {editable && active && dirty ? <p className="notice" role="status" data-testid="agents-unsaved">Osparade ändringar. Uppdraget är på, så ändringarna gäller först när du trycker Spara.</p> : null}

    {/* Två kolumner som Workflow AI:s förstorade fönster (2026-11-23): the cards to the left, the conversation to the right in the
        column's whole height with its field at the bottom. On a phone the conversation comes first and the cards under it. */}
    {/* Namn above the two columns, as wide as the cards, so the Vad card and the conversation start at the same height. */}
    <div className="lg:max-w-[24rem]"><Field id="agents-name" label="Namn" value={draft.name} onChange={(name) => set({ name })} error={problemOf("name")} disabled={!mine} /></div>
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]" data-testid="agents-layout">
      {/* Two cards in the column (2026-11-23): the conversation, which scrolls inside, and under it the field as a card of its own. */}
      <section className="flex h-[min(42rem,calc(100dvh-11rem))] min-h-[26rem] flex-col gap-4 max-lg:order-1 lg:sticky lg:top-20 lg:order-2" aria-label="Samtal om uppdraget" data-testid="agents-chat">
        <div ref={thread} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain rounded-xl border bg-card px-4 py-3 shadow-xs" aria-live="polite" data-testid="agents-chat-thread">
          {messages.map((item) => item.role === "user"
            ? <div key={item.id} className="flex justify-end"><div className={CHAT_USER_BUBBLE} data-testid="agents-chat-user"><p className="whitespace-pre-wrap break-words">{item.text}</p></div></div>
            : <div key={item.id} className="flex justify-start"><div className={CHAT_ANSWER} data-testid="agents-chat-answer" data-ok={item.ok || undefined}>
              {/* What Workflow sorted out of the words, as small key words; the cards hold the rest. */}
              {item.words?.length ? <div className="mb-1.5 flex flex-wrap gap-1.5" aria-label="Uppfattat" data-testid="agents-chat-words">
                {item.words.map((word) => <span key={word} className="rounded-full border bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">{word}</span>)}
              </div> : null}
              <AnswerBody text={item.text} />
              {item.preview ? <div className="mt-2"><PreviewView preview={item.preview} /></div> : null}
              {item === lastWorkflow && !busy ? <>
                {item.replies?.length ? <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Färdiga svar" data-testid="agents-chat-replies">
                  {item.replies.map((reply) => <ChatChip key={reply} className="whitespace-normal py-1.5 text-left" disabled={!mine} onClick={() => void send(reply, reply, item.field)} data-testid="agents-chat-reply">{reply}</ChatChip>)}
                </div> : null}
                {item.ok ? <div className="mt-2 flex flex-wrap gap-2" data-testid="agents-chat-actions">{saveButton("agents-chat-save")}{previewButton("agents-chat-preview")}</div> : null}
              </> : null}
              <p className="mt-1.5 flex items-center gap-1 text-[0.6875rem] leading-4 text-muted-foreground"><Bot className="size-3" aria-hidden="true" />Workflow</p>
            </div></div>)}
          {busy === "interpret" ? <ThinkingBubble label="Läser orden och fyller i korten" /> : busy === "preview" ? <ThinkingBubble label="Testar uppdraget" /> : null}
        </div>
        {/* Just the chat field under the conversation card, no card of its own (2026-11-23: "bara chattrutan utan kort"). */}
        <div className="shrink-0" data-testid="agents-chat-composer">
          <ChatComposer id="agents-chat-input" testId="agents-chat-input" label="Skriv till agenten" value={input} onChange={setInput} onSend={() => void send(input)} disabled={Boolean(busy) || !mine}
            placeholder="Skriv vad agenten ska göra eller vad du vill ändra…" />
        </div>
      </section>

      <div className="min-w-0 space-y-3 max-lg:order-2 lg:order-1" data-testid="agents-cards">
        {CARDS.map((card) => {
          const problem = cardProblem[card.key];
          const open = openCard === card.key;
          return <div key={card.key} className={cn("rounded-xl transition-shadow duration-500", flash.includes(card.key) && "ring-2 ring-primary/50")} data-testid={`agents-card-${card.key}`} data-changed={flash.includes(card.key) || undefined} data-problem={Boolean(problem) || undefined}>
            <Panel icon={card.icon} title={card.title}
              actions={<div className="flex items-center gap-2">
                {problem ? <StatusPill tone="danger">Rätta</StatusPill> : cardMissing[card.key] ? <StatusPill tone="warning">Saknas</StatusPill> : null}
                {mine ? <Button type="button" size="sm" variant={open ? "default" : "ghost"} onClick={() => (open ? void closeCard(card.title) : setOpenCard(card.key))} data-testid={`agents-card-${card.key}-${open ? "done" : "edit"}`}>{open ? "Klar" : "Ändra"}</Button> : null}
              </div>}>
              <div className="space-y-2">
                {open ? card.fields : <p className="text-sm" data-testid={`agents-card-${card.key}-value`}>{cardValue[card.key]}</p>}
                {problem ? <p className="text-xs text-destructive" role="alert" data-testid={`agents-card-${card.key}-problem`}>{problem}</p> : null}
                {card.key === "what" && template ? <p className="text-xs text-muted-foreground" data-testid="agents-never">{template.never}</p> : null}
                {card.key === "what" && check ? <p className="text-xs text-muted-foreground" data-testid="agents-cost">{check.cost.text}</p> : null}
                {card.key === "who" && check?.recipients?.excluded.length && !open ? <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-700 dark:text-amber-300">{check.recipients.excluded.map((item) => <li key={item.id}>{item.reason}</li>)}</ul> : null}
              </div>
            </Panel>
          </div>;
        })}
        {missionId ? <div data-testid="agents-card-history"><Panel icon={History} title="Körhistorik" count={runs.length}>
          {runs.length ? <>
            <ol className="divide-y" data-testid="agents-runs">{runs.slice(0, Math.max(shownRuns, runs.findIndex((item) => item.id === openRun) + 1)).map((item) => <RunRow key={item.id} run={item} open={item.id === openRun} canResend={Boolean(mission?.mine) && !overview.demo} busy={Boolean(busy)} onResend={() => void act("resend", { runId: item.id }, "Beskedet är skickat igen. Inget skapades eller publicerades på nytt.")}
              onDecide={(index, approve) => void act("decide", { runId: item.id, index, approve }, approve ? "Ändringen är gjord." : "Ändringen är avvisad. Inget ändrades.")} />)}</ol>
            <ShowMore shown={Math.min(shownRuns, runs.length)} total={runs.length} onMore={() => setShownRuns((count) => count + RUNS_SHOWN)} testId="agents-runs-more" />
          </> : <Empty compact title="Inga körningar än" description="Uppdraget har inte körts än." />}
        </Panel></div> : null}
      </div>
    </div>
  </div>;
}

/** The parts of a mission the editor holds (the view also has its state, owner and dates). */
function draftOf(mission: Mission): MissionDraft {
  const { name, instruction, templateKey, scope, schedule, target, feedback, recipients } = mission;
  return { name, instruction, templateKey, scope, schedule, target, feedback, ...(recipients ? { recipients } : {}) };
}

/** Fler mottagare: a role or chosen colleagues get the result by e-mail too; Kontrollera says who is left out and why. */
function Recipients({ draft, members, choice, onChange }: { draft: MissionDraft; members: { id: string; name: string }[]; choice?: MissionCheck["recipients"]; onChange: (recipients: MissionDraft["recipients"]) => void }) {
  const chosen = { userIds: draft.recipients?.userIds ?? [], roles: draft.recipients?.roles ?? [] };
  const setRoles = (role: RecipientRole, on: boolean) => onChange({ ...chosen, roles: on ? [...new Set([...chosen.roles, role])] : chosen.roles.filter((item) => item !== role) });
  const setUser = (userId: string, on: boolean) => onChange({ ...chosen, userIds: on ? [...new Set([...chosen.userIds, userId])] : chosen.userIds.filter((item) => item !== userId) });
  const excluded = new Map((choice?.excluded ?? []).map((item) => [item.id, item.reason]));
  return <fieldset className="space-y-1.5" data-testid="agents-recipients">
    <legend className="flex items-center gap-1.5 text-xs font-medium"><Users className="size-3.5" aria-hidden="true" />Fler mottagare (e-post)</legend>
    <p className="text-xs text-muted-foreground">Bara kollegor i företaget, och bara de som själva får läsa det agenten läser.</p>
    <div className="flex flex-wrap gap-x-4 gap-y-1">{RECIPIENT_ROLES.map((role) => <label key={role} className="flex min-h-9 items-center gap-2 text-sm">
      <Checkbox checked={chosen.roles.includes(role)} onCheckedChange={(on) => setRoles(role, on === true)} data-testid={`agents-recipient-role-${role}`} />{RECIPIENT_ROLE_LABEL[role]}</label>)}</div>
    {members.length ? <div className="flex max-h-48 flex-wrap gap-x-4 gap-y-1 overflow-y-auto">{members.map((member) => <label key={member.id} className={cn("flex min-h-9 items-center gap-2 text-sm", excluded.has(member.id) && "text-muted-foreground")} title={excluded.get(member.id)}>
      <Checkbox checked={chosen.userIds.includes(member.id)} onCheckedChange={(on) => setUser(member.id, on === true)} data-testid={`agents-recipient-${member.id}`} />{member.name}</label>)}</div>
      : <p className="text-xs text-muted-foreground">Det finns inga andra aktiva medlemmar i företaget.</p>}
    {choice?.excluded.length ? <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-700 dark:text-amber-300" data-testid="agents-recipients-excluded">{choice.excluded.map((item) => <li key={item.id}>{item.reason}</li>)}</ul> : null}
  </fieldset>;
}

/** När on one row (2026-11-23): how often, the day or date, and the clock times; the days of a weekly schedule wrap under it. */
function ScheduleFields({ schedule, onChange, error }: { schedule: MissionSchedule; onChange: (schedule: MissionSchedule) => void; error?: string }) {
  const clock = schedule.kind === "event" ? "07:00" : schedule.time;
  const change = (kind: MissionSchedule["kind"]) => onChange(
    kind === "weekly" ? { kind, weekdays: [1], time: clock } : kind === "biweekly" ? { kind, weekdays: [1], time: clock, from: swedishDayKey(new Date()) }
      : kind === "monthly_first" ? { kind, weekday: 1, time: clock } : kind === "once" ? { kind, date: swedishDayKey(new Date(Date.now() + 86_400_000)), time: clock }
      : kind === "event" ? { kind, event: "deviation_created", time: clock } : { kind, time: clock } as MissionSchedule);
  const kindField = <div className="w-56 max-sm:w-full"><Field id="agents-schedule-kind" label="Hur ofta" value={schedule.kind} options={[...SCHEDULE_KINDS]} optionLabels={SCHEDULE_KIND_LABEL} onChange={(kind) => change(kind as MissionSchedule["kind"])} /></div>;
  if (schedule.kind === "event") return <div className="space-y-2" data-testid="agents-schedule">
    <div className="flex flex-wrap items-end gap-3">
      {kindField}
      <div className="min-w-0 flex-1"><Field id="agents-schedule-event" label="När" value={schedule.event} options={Object.keys(AGENT_EVENTS)} optionLabels={AGENT_EVENTS} onChange={(event) => onChange({ ...schedule, event: event as typeof schedule.event })} error={error} /></div>
    </div>
    <p className="text-xs text-muted-foreground">Högst 20 gånger i timmen, och en gång per sak. Det agenten själv ändrar startar aldrig samma uppdrag igen.</p>
  </div>;
  // Flera gånger per dag: the first time and up to five more.
  const extra = schedule.times ?? [];
  const setExtra = (times: string[]) => onChange({ ...schedule, times: times.length ? times : undefined } as MissionSchedule);
  return <div className="space-y-2" data-testid="agents-schedule">
    <div className="flex flex-wrap items-end gap-3" data-testid="agents-times">
      {kindField}
      {schedule.kind === "once" ? <div className="w-40"><Field id="agents-schedule-date" label="Datum" type="date" value={schedule.date} onChange={(date) => onChange({ ...schedule, date })} /></div>
        : schedule.kind === "biweekly" ? <div className="w-40"><Field id="agents-schedule-from" label="Första veckan" type="date" value={schedule.from} onChange={(from) => onChange({ ...schedule, from: from || schedule.from })} /></div>
        : schedule.kind === "monthly_first" ? <div className="w-36"><Field id="agents-schedule-weekday" label="Veckodag" value={String(schedule.weekday)} options={["1", "2", "3", "4", "5", "6", "7"]} optionLabels={Object.fromEntries(WEEKDAY_LABEL.map((label, index) => [String(index + 1), label]))}
          onChange={(day) => onChange({ ...schedule, weekday: Number(day) })} /></div> : null}
      <div className="w-28"><Field id="agents-schedule-time" label="Klockslag" type="time" value={schedule.time} onChange={(time) => onChange({ ...schedule, time } as MissionSchedule)} /></div>
      {extra.map((time, index) => <div key={index} className="flex items-end gap-1">
        <div className="w-28"><Field id={`agents-schedule-time-${index + 2}`} label={`Klockslag ${index + 2}`} type="time" value={time} onChange={(value) => setExtra(extra.map((item, at) => (at === index ? value : item)))} /></div>
        <RemoveButton label={`Ta bort klockslag ${index + 2}`} onClick={() => setExtra(extra.filter((_, at) => at !== index))} data-testid={`agents-time-remove-${index + 2}`} />
      </div>)}
      {extra.length < 5 ? <Button type="button" size="sm" variant="ghost" onClick={() => setExtra([...extra, "15:00"])} data-testid="agents-time-add"><Plus />Klockslag</Button> : null}
    </div>
    {schedule.kind === "weekly" || schedule.kind === "biweekly" ? <fieldset className="flex flex-wrap gap-x-4 gap-y-1"><legend className="sr-only">Dagar</legend>
      {WEEKDAY_LABEL.map((label, index) => <label key={label} className="flex min-h-9 items-center gap-2 text-sm"><Checkbox checked={schedule.weekdays.includes(index + 1)}
        onCheckedChange={(on) => onChange({ ...schedule, weekdays: on === true ? [...schedule.weekdays, index + 1].sort() : schedule.weekdays.filter((day) => day !== index + 1) })} data-testid={`agents-day-${index + 1}`} />{label}</label>)}
    </fieldset> : null}
    {error ? <p className="text-xs text-destructive" data-testid="agents-problem-schedule">{error}</p> : null}
  </div>;
}

function PreviewView({ preview }: { preview: Preview }) {
  return <div className="space-y-3 text-sm" data-testid="agents-preview-result">
    {preview.skip || preview.fail ? <p className="text-destructive">{preview.skip ?? preview.fail}</p> : null}
    <p className="text-xs text-muted-foreground">Läste {Object.entries(preview.read).map(([what, count]) => `${count} ${what}`).join(", ") || "inget"}.</p>
    {preview.effects.map((effect, index) => <div key={index} className="rounded-lg border p-2" data-testid="agents-preview-effect">
      <p className="text-xs font-semibold">{effect.kind === "work_order" ? "Skulle skapa arbetsordern" : effect.decision === "publish" ? "Skulle publicera" : "Skulle spara ett utkast"}: {effect.title}</p>
      {effect.lines.map((line) => <p key={line} className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">{line}</p>)}
      {effect.reasons.length ? <ul className="mt-1 list-disc pl-4 text-xs">{effect.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
    </div>)}
    <div className="rounded-lg border bg-muted/40 p-2" data-testid="agents-preview-feedback">
      <p className="text-xs font-semibold">{preview.feedback.title}</p>
      <p className="mt-0.5 text-xs">{preview.feedback.summary}</p>
      <p className="mt-1 text-xs text-primary">{preview.feedback.links.join(" · ")}</p>
    </div>
    <ReportView report={preview.report} preview />
  </div>;
}

function ReportView({ report, preview = false }: { report: RunReport; preview?: boolean }) {
  if (!report?.sections?.length) return null;
  return <div className="space-y-2" data-testid="agents-report">{report.sections.map((section) => <div key={section.heading}>
    <p className="text-xs font-semibold">{section.heading}</p>
    <ul className="mt-0.5 space-y-0.5 text-xs">{section.rows.map((row, index) => <li key={index}>{row.href && !preview ? <Link href={row.href} className="text-primary hover:underline">{row.title}</Link> : row.title}{row.detail ? <span className="text-muted-foreground"> · {row.detail}</span> : null}</li>)}</ul>
  </div>)}</div>;
}

function RunRow({ run, open, canResend, busy, onResend, onDecide }: { run: Run; open: boolean; canResend: boolean; busy: boolean; onResend: () => void; onDecide: (index: number, approve: boolean) => void }) {
  const status = RUN_STATUS_LABEL[run.status as keyof typeof RUN_STATUS_LABEL] ?? RUN_STATUS_LABEL.queued;
  const feedback = run.feedback ?? {};
  const failedFeedback = Object.values(feedback).includes("failed") || Object.values((feedback.recipients ?? {}) as Record<string, string>).includes("failed");
  const sentTo = Object.values((feedback.recipients ?? {}) as Record<string, string>).filter((value) => value === "sent").length;
  return <li className="py-1.5" data-testid={`agents-run-${run.id}`}>
    <FoldRow open={open} summary={<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="tabular-nums">{formatSwedish(run.createdAt, WHEN)}</span>
        <StatusPill tone={status.tone}>{run.statusLabel}</StatusPill>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{run.report?.summary || run.message || ""}</span>
        <span className="text-xs text-muted-foreground" data-testid="agents-run-payer">{run.payerText ?? (run.cost === "ai" ? `Krediter: ${run.chargedCredits}` : "Ingår")}{run.trigger === "manual" ? " · Kört en gång" : ""}</span>
      </div>}>
      <div className="space-y-2 text-sm">
        <p className="text-xs text-muted-foreground">Läste {Object.entries(run.read ?? {}).map(([what, count]) => `${count} ${what}`).join(", ") || "inget"}.</p>
        {sentTo ? <p className="text-xs text-muted-foreground">Skickades också till {sentTo === 1 ? "en kollega" : `${sentTo} kollegor`}.</p> : null}
        {["done", "nothing"].includes(run.status) ? <a href={`/api/agents?run=${encodeURIComponent(run.id)}&pdf=1`} target="_blank" rel="noopener" className="text-xs text-primary hover:underline" data-testid="agents-run-pdf">Visa rapporten (PDF)</a> : null}
        {run.actions?.length ? <ul className="space-y-1">{run.actions.map((item, index) => item.state === "proposed" || item.state === "rejected"
          // A change Workflow AI asked for waits for the owner (säkerhetsgranskningen 2026-11-24, G-07): what would change, then Godkänn or Avvisa.
          ? <li key={index} className="rounded-lg border p-2 text-xs" data-testid="agents-proposed-change">
            <span className="flex flex-wrap items-center gap-2"><span className="font-medium">{item.label}</span><StatusPill tone={item.state === "proposed" ? "warning" : "neutral"}>{item.state === "proposed" ? "Väntar på godkännande" : "Avvisad"}</StatusPill></span>
            {item.lines?.length ? <ul className="mt-1 space-y-0.5 text-muted-foreground">{item.lines.map((line) => <li key={line}>{line}</li>)}</ul> : null}
            {item.reason ? <span className="mt-1 block text-muted-foreground">{item.reason}</span> : null}
            {item.state === "proposed" && canResend ? <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={busy} onClick={() => onDecide(index, true)} data-testid="agents-change-approve">Godkänn</Button>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onDecide(index, false)} data-testid="agents-change-reject">Avvisa</Button>
            </div> : null}
          </li>
          : <li key={index} className="text-xs">{item.label}{item.href ? <> · <Link href={item.href} className="text-primary hover:underline">{item.linkText}</Link></> : null}{item.reason ? <span className="block text-muted-foreground">{item.reason}</span> : null}</li>)}</ul> : null}
        <ReportView report={run.report} />
        {run.message && run.status !== "done" ? <p className="text-xs text-muted-foreground">{run.message}</p> : null}
        {canResend && failedFeedback ? <Button type="button" size="sm" variant="outline" onClick={onResend} data-testid="agents-resend"><Send />Skicka beskedet igen</Button> : null}
      </div>
    </FoldRow>
  </li>;
}
