"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Mail } from "lucide-react";
import { ListEmpty, ListGroup, ListRow, NativeLargeTitle, NativePage, NativeSegmented, useNativeTopBar } from "@/components/native";
import { useAddressEntryState } from "@/components/use-address-filter";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { nativeNoticeHref, type TypeKey } from "@/lib/workflow/native-mode";
import { Button } from "@/components/ui/button";
import { useRegisterNotificationCount } from "@/components/workspace-actions";
import { api } from "@/features/kfid/api";
import { cn } from "@/lib/utils";
import { indicatorBadge } from "./indicator-tone";
import { announce, withdrawAnnouncement } from "@/lib/workflow/toast";
import { assignmentToastText } from "@/lib/workflow/task-assignment-notice";
import { quoteAnswerToastText } from "@/lib/quotes/quote-notice";
import { obstacleToastText } from "@/lib/workflow/obstacle-notice";
import { alarmToastText } from "@/lib/machine/alarm-notice";
import { teamToastText } from "@/lib/workflow/team-notice";
import { commentToastText } from "@/lib/comments/model";
import { NOTIFICATION_STATE_LABEL, NOTIFICATION_STATES, NOTIFICATION_TAB_LABEL, NOTIFICATION_TABS, notificationsBySection, notificationTabCount, parseNotificationTab, requiresAction, type NotificationCounts, type NotificationListAnswer, type NotificationState, type NotificationTab } from "@/lib/workflow/notification-list";
import { ClaimAlarmButton } from "./machine-alarm";
import { AssignButton } from "./assign-dialog";
import { assignHref, assignRefusal } from "@/lib/workflow/assign-work-order";
import { followUpNotifications, NOTIFICATION_MAX, NOTIFICATION_PAGE, notificationToday, orderNotifications, taskNotifications, type FollowUpSource, type NotificationSource, type TaskNotification } from "@/lib/workflow/task-notifications";
import { PageHeader } from "@/components/page-shell";

const kindLabel = { WORK_ORDER: "Arbetsorder", RISK_ASSESSMENT: "Riskbedömning", FORM: "Formulär", ROUND: "Rond", FOLLOW_UP: "Arbetsorder färdigställd", SELF_INSPECTION: "Egenkontroll", NEWSLETTER_DRAFT: "Utskick", ASSIGNED: "Tilldelad dig", OBSTACLE: "Hinder rapporterat", QUOTE: "Offert besvarad", CLOSURE: "Avslutat avtal", MACHINE_ALARM: "Maskinlarm", MACHINE_NOTE: "Maskinlarm", SERVER_UPDATES: "Server", OPERATOR: "Operatörskonto", TEAM: "Teamet", COMMENT: "Kommentar", ISSUE_REPORT: "Felrapport" };
/** "Tilldelad dig" already told with a toast in this browser tab's session, so a reload does not tell it again. */
const TOLD_KEY = "hwf-assigned-told";
function toldAssignments(): Set<string> {
  try { return new Set(JSON.parse(window.sessionStorage.getItem(TOLD_KEY) ?? "[]") as string[]); } catch { return new Set(); }
}
function rememberTold(told: Set<string>) {
  try { window.sessionStorage.setItem(TOLD_KEY, JSON.stringify([...told].slice(-500))); } catch { /* the toast may come again after a reload */ }
}
/** "Du har N nya notiser" is said once per browser tab's session (kundresa 2026-11-07, M2: it came on every page change). */
const SUMMARY_KEY = "hwf-notices-summary-told";
function summaryTold() {
  try { return window.sessionStorage.getItem(SUMMARY_KEY) === "1"; } catch { return false; }
}
function rememberSummary() {
  try { window.sessionStorage.setItem(SUMMARY_KEY, "1"); } catch { /* said again after a reload at most */ }
}

/**
 * Fas 1B (2026-10-08): a new "Tilldelad dig" is told with the workspace toast wherever the person is in the app
 * (MEMORY important-events-toast), once, with a button to the task. The bell keeps it as unread until the task is opened.
 * Offert per e-post (steg E, 2026-10-09): a customer's answer to a quote ("Offert besvarad") is told the same way.
 */
function useAssignmentToasts(items: TaskNotification[] | null, bell: number | null) {
  const router = useRouter();
  const told = useRef<Set<string> | null>(null);
  // The last single notice told, so it leaves once its own page is open (kundresa 2026-11-07, L13: the alarm toast stayed over the alarm order).
  const shown = useRef<{ text: string; href: string } | null>(null);
  const searchParams = useSearchParams();
  const here = searchParams.get("taskId") ?? searchParams.get("quoteId") ?? "";
  useEffect(() => {
    const last = shown.current;
    if (!last || !here || !last.href.includes(encodeURIComponent(here))) return;
    withdrawAnnouncement(last.text);
    shown.current = null;
  }, [here]);
  useEffect(() => {
    if (!items) return;
    told.current ??= toldAssignments();
    const fresh = items.filter((item) => (item.kind === "ASSIGNED" || item.kind === "QUOTE" || item.kind === "OBSTACLE" || item.kind === "MACHINE_ALARM" || item.kind === "MACHINE_NOTE" || item.kind === "TEAM" || item.kind === "COMMENT") && !item.read && !told.current!.has(item.id));
    if (!fresh.length) return;
    for (const item of fresh) told.current.add(item.id);
    rememberTold(told.current);
    // Never on Notiser itself: the list already says it (M2).
    if (new URLSearchParams(window.location.search).get("view") === "notifications") return;
    const [first] = fresh;
    if (fresh.length > 1) {
      // Several at once: one line with the bell's own figure, once per session, and not on a phone's app look, where Hem lists
      // them and the box stood over the buttons (M2). The bell keeps counting.
      if (summaryTold() || document.documentElement.dataset.native === "1") return;
      rememberSummary();
      const count = bell ?? fresh.length;
      if (!count) return;
      announce(count === 1 ? "Du har 1 ny notis." : `Du har ${count} nya notiser.`, false, [{ label: "Visa notiser", run: () => router.push("/?view=notifications") }], 6000);
      return;
    }
    const text = first.kind === "QUOTE" ? quoteAnswerToastText(first) : first.kind === "OBSTACLE" ? obstacleToastText(first) : first.kind === "MACHINE_ALARM" || first.kind === "MACHINE_NOTE" ? alarmToastText(first) : first.kind === "TEAM" ? teamToastText(first) : first.kind === "COMMENT" ? commentToastText(first) : assignmentToastText(first);
    shown.current = { text, href: first.href };
    announce(text, false, [{ label: "Öppna", run: () => router.push(first.href) }]);
  }, [items, router, bell]);
}

/** The small line under a notice that has a date: what the date means. */
const dateLabel = (kind: TaskNotification["kind"]) => kind === "ROUND" ? "Tillfälle" : kind === "FOLLOW_UP" ? "Färdigställd" : kind === "NEWSLETTER_DRAFT" ? "Utkast gjort" : kind === "QUOTE" ? "Besvarad" : kind === "CLOSURE" ? "Exportera senast" : kind === "SERVER_UPDATES" ? "Sedan" : kind === "ISSUE_REPORT" ? "Skickad" : "Klart senast";

export type TaskNotificationFeed = {
  items: TaskNotification[] | null;
  /** Every current reminder; Cloud sends only the most urgent page of them in `items`. */
  total: number | null;
  /** Notislistan (beslut 4): what the bell counts and each tab holds. Cloud only. */
  counts: NotificationCounts | null;
  loadMore: () => void;
  today: string;
  scope: "team" | "mine";
  local: boolean;
  error: string;
  reload: () => void;
};

// One feed per mounted workspace drives both the menu count and the Notiser view.
// Cloud reads the server-filtered route; Local computes from the open .hwf without network calls.
export function useTaskNotificationFeed({ localSources, localFollowUps, localExtra, enabled, resetKey }: { localSources?: NotificationSource[] | null; localFollowUps?: FollowUpSource[]; /** Reminders the file computes itself, e.g. Egenkontroll (2026-10-06). */ localExtra?: TaskNotification[]; enabled: boolean; resetKey?: string }): TaskNotificationFeed {
  const local = Boolean(localSources);
  const [result, setResult] = useState<{ items: TaskNotification[]; total?: number; counts?: NotificationCounts; today: string; scope: "team" | "mine"; key?: string } | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [limit, setLimit] = useState(NOTIFICATION_PAGE);
  const [today, setToday] = useState(notificationToday);
  useEffect(() => {
    if (!enabled) return;
    let controller: AbortController | undefined;
    // A hidden tab does not poll (quality check 2026-10-05, F3); it reads again when it is shown.
    const load = () => {
      setToday(notificationToday());
      if (local || document.visibilityState === "hidden") return;
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      void api<{ items: TaskNotification[]; total?: number; counts?: NotificationCounts; today: string; scope: "team" | "mine" }>(`/api/task-notifications?limit=${limit}`, { signal, cache: "no-store" })
        .then((data) => { if (!signal.aborted) { setResult({ ...data, key: resetKey }); setError(""); } })
        .catch((cause) => { if (!signal.aborted) { setResult(null); setError((cause as Error).message); } });
    };
    const shown = () => { if (document.visibilityState === "visible") load(); };
    load();
    const timer = window.setInterval(load, 60_000);
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", shown);
    return () => { controller?.abort(); window.clearInterval(timer); window.removeEventListener("focus", load); document.removeEventListener("visibilitychange", shown); };
  }, [enabled, local, refresh, resetKey, limit]);
  // The same order everywhere – Local, the demo and Cloud: urgent work orders first (orderNotifications).
  const localItems = useMemo(() => localSources ? orderNotifications([...(localExtra ?? []), ...followUpNotifications(localFollowUps ?? []), ...taskNotifications(localSources, today)]) : null, [localSources, localFollowUps, localExtra, today]);
  const cloud = result && result.key === resetKey ? result : null;
  const cloudItems = useMemo(() => cloud ? orderNotifications(cloud.items) : null, [cloud]);
  const items = !enabled ? null : localItems ?? cloudItems ?? null;
  const total = !enabled ? null : localItems ? localItems.length : cloud ? cloud.total ?? cloud.items.length : null;
  // The bell counts what is new for the person (beslut 4), not every reminder the team has.
  useRegisterNotificationCount(!enabled ? undefined : cloud?.counts?.bell ?? total);
  useAssignmentToasts(local ? null : items, cloud?.counts?.bell ?? null);
  return {
    items,
    total,
    counts: cloud?.counts ?? null,
    loadMore: () => setLimit((current) => Math.min(NOTIFICATION_MAX, current + NOTIFICATION_PAGE)),
    today: local ? today : cloud?.today ?? today,
    // The Local file owner is the local administrator of the open file.
    scope: local ? "team" : cloud?.scope ?? "mine",
    local,
    error: enabled && !local ? error : "",
    reload: () => setRefresh((value) => value + 1),
  };
}

/** One notice as a card; the same in Local and Cloud. */
function NoticeCard({ item, today, reload, onOpen, onRead }: { item: TaskNotification; today: string; reload: () => void; /** The row was opened: it is read. */ onOpen?: () => void; /** Cloud: Markera som läst. */ onRead?: () => void }) {
  const unreadKinds = item.kind === "ASSIGNED" || item.kind === "QUOTE" || item.kind === "OBSTACLE" || item.kind === "MACHINE_ALARM" || item.kind === "MACHINE_NOTE" || item.kind === "COMMENT" || item.kind === "ISSUE_REPORT";
  const read = onRead && !item.read ? <Button type="button" variant="ghost" size="icon-xs" className="absolute right-2 top-2" title="Markera som läst" aria-label={`Markera som läst: ${item.title}`} onClick={onRead} data-testid="task-notification-read"><Check /></Button> : null;
  return <li data-testid="task-notification" data-urgent={item.urgent || undefined} data-read={item.read || undefined} className={cn("relative rounded-xl border bg-card p-3.5", read && "pr-10", item.urgent && "border-red-300 dark:border-red-800")}>
    {read}
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{item.label ?? kindLabel[item.kind]}</span>
      {item.urgent ? <span data-testid="task-notification-urgent" className={cn("rounded-md border px-2 py-1 font-semibold", indicatorBadge("danger"))}>Akut</span> : null}
      {item.deadline && <span className="rounded-md bg-amber-100 px-2 py-1 text-amber-950 dark:bg-amber-950 dark:text-amber-100">{item.kind === "ROUND" ? item.deadline === "OVERDUE" ? "Missad eller ej klar" : "Ska göras idag" : item.deadline === "OVERDUE" ? "Förfallen" : item.dueDate === today ? "Förfaller idag" : "Snart förfallande"}</span>}
      {unreadKinds && !item.read ? <span data-testid="task-notification-unread" title="Oläst" className="size-2 rounded-full bg-primary"><span className="sr-only">Oläst</span></span>
        : item.kind === "FOLLOW_UP" ? <span className="rounded-md bg-primary/10 px-2 py-1 text-primary">Följ upp</span>
        : item.needsAction && <span className="rounded-md bg-muted px-2 py-1">Behöver åtgärdas</span>}
    </div>
    <Link href={item.href} onClick={onOpen} className="mt-1.5 block break-words text-sm font-semibold text-primary underline-offset-4 hover:underline">{item.title}</Link>
    {item.detail && <p className="mt-1 break-words text-sm text-muted-foreground" data-testid="task-notification-detail">{item.detail}</p>}
    {/* Jag tar den, and Tilldela (2026-11-07) opening the order with the dialog; grey with the reason for someone who may only read. */}
    {item.machineAlarm?.taskId ? <div className="mt-2 flex flex-wrap items-start gap-2">
      {item.machineAlarm.canAck ? <ClaimAlarmButton taskId={item.machineAlarm.taskId} done={reload} /> : null}
      {item.machineAlarm.canAck ? <AssignButton href={assignHref(item.href)} testId="machine-alarm-assign" />
        : <AssignButton disabledReason={assignRefusal({ canEdit: false, projectFrozen: false })} onClick={() => undefined} testId="machine-alarm-assign" />}
    </div> : null}
    {item.dueDate && <p className="mt-1 text-xs text-muted-foreground">{dateLabel(item.kind)} <time dateTime={item.dueDate}>{item.dueDate}</time></p>}
  </li>;
}

/** Notislistan in Cloud (beslut 4): the tab and the state are the server's, one page at a time; the marks are the person's own. */
function useNotificationList(feed: TaskNotificationFeed) {
  const [tab, setTab] = useAddressEntryState<NotificationTab>("notifications.tab", "tab", parseNotificationTab, "mine");
  const [state, setState] = useAddressEntryState<NotificationState>("notifications.state", "state", (raw) => NOTIFICATION_STATES.includes(raw as NotificationState) ? raw as NotificationState : null, "unread");
  const [limit, setLimit] = useState(NOTIFICATION_PAGE);
  const [answer, setAnswer] = useState<(NotificationListAnswer & { key: string }) | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const key = `${tab}|${state}`;
  // The feed reads again every minute: a change it finds shows here too.
  const stamp = `${feed.counts?.bell ?? ""}|${feed.counts?.mineRead ?? ""}|${feed.counts?.teamUnread ?? ""}`;
  useEffect(() => {
    if (feed.local) return;
    const controller = new AbortController();
    void api<NotificationListAnswer>(`/api/task-notifications?tab=${tab}&state=${state}&limit=${limit}`, { signal: controller.signal, cache: "no-store" })
      .then((data) => { if (!controller.signal.aborted) { setAnswer({ ...data, key: `${tab}|${state}` }); setError(""); } })
      .catch((cause) => { if (!controller.signal.aborted) setError((cause as Error).message); });
    return () => controller.abort();
  }, [feed.local, tab, state, limit, refresh, stamp]);
  const { reload: reloadFeed } = feed;
  const reload = useCallback(() => { setRefresh((value) => value + 1); reloadFeed(); }, [reloadFeed]);
  const post = useCallback(async (input: Record<string, string>) => {
    setBusy(true);
    try { await api("/api/task-notifications", { method: "POST", body: JSON.stringify(input) }); setError(""); reload(); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }, [reload]);
  return {
    tab, state, busy, error, reload,
    answer: answer && answer.key === key ? answer : null,
    /** The latest answer of any tab: "Kräver åtgärd" and the counts stay on the screen while another tab is read. */
    latest: answer,
    canTeam: answer?.canTeam ?? false,
    chooseTab: (value: NotificationTab) => { setTab(value); setLimit(NOTIFICATION_PAGE); },
    chooseState: (value: NotificationState) => { setState(value); setLimit(NOTIFICATION_PAGE); },
    markRead: (id: string) => post({ action: "read", id }),
    markAll: () => post({ action: "read_all", tab }),
    more: () => setLimit((current) => Math.min(NOTIFICATION_MAX, current + NOTIFICATION_PAGE)),
  };
}
type NotificationList = ReturnType<typeof useNotificationList>;
/** Opening a row reads it, except what requires action: read is not done, so it stays on top until it is solved or marked. */
const opensAsRead = (item: TaskNotification) => !item.read && !requiresAction(item);
const canMarkAll = (counts: NotificationCounts | undefined, tab: NotificationTab) => Boolean(tab === "mine" ? counts?.mineUnread : counts?.teamUnread);

/** The page's sections, each with its heading. `complete`: everything is read, so a heading may say how many. */
function NoticeSections({ items, complete, card }: { items: readonly TaskNotification[]; complete: boolean; card: (item: TaskNotification) => ReactNode }) {
  return <>{notificationsBySection(items).map((section) => <section key={section.key} className="space-y-2.5" aria-labelledby={`notifications-${section.key}`} data-testid={`notifications-${section.key}`}>
    <h2 id={`notifications-${section.key}`} className="text-sm font-semibold">{section.label}{complete ? ` (${section.items.length})` : ""}</h2>
    <ul className="grid items-start gap-3 xl:grid-cols-2 3xl:grid-cols-3" aria-label={section.label}>{section.items.map(card)}</ul>
  </section>)}</>;
}

export function TaskNotifications({ feed }: { feed: TaskNotificationFeed }) {
  const native = useNativeMode();
  return feed.local ? <LocalNotifications feed={feed} native={native} /> : <CloudNotifications feed={feed} native={native} />;
}


/** Local: one person in the open file, so there are no tabs and no read marks. Computed in the browser without network calls. */
function LocalNotifications({ feed, native }: { feed: TaskNotificationFeed; native: boolean }) {
  const [visibleCount, setVisibleCount] = useState(20);
  const { items, today, error, reload, loadMore } = feed;
  const total = feed.total ?? items?.length ?? 0;
  const showMore = () => { if (items && visibleCount + 20 > items.length && items.length < total) loadMore(); setVisibleCount((count) => count + 20); };
  if (native) return <NativeNotifications feed={feed} visibleCount={visibleCount} total={total} onMore={showMore} />;
  return <section className="space-y-5">
    <PageHeader title="Notiser" description="Det som väntar på dig i den öppna filen." />
    {error ? <p role="alert" className="notice text-destructive">{error}</p> : !items ? <p role="status">Hämtar notiser…</p> : <>
      {total ? null : <p role="status" className="text-sm text-muted-foreground">Inga aktuella notiser.</p>}
      <NoticeSections items={items.slice(0, visibleCount)} complete={visibleCount >= total} card={(item) => <NoticeCard key={item.id} item={item} today={today} reload={reload} />} />
      {(items.length > visibleCount || (items.length < total && items.length < NOTIFICATION_MAX)) && <Button variant="outline" onClick={showMore}>Visa fler notiser</Button>}
    </>}
  </section>;
}

function CloudNotifications({ feed, native }: { feed: TaskNotificationFeed; native: boolean }) {
  const list = useNotificationList(feed);
  const { answer, latest, tab, state } = list;
  if (native) return <NativeCloudNotifications list={list} today={feed.today} />;
  const counts = latest?.counts;
  const tabs = list.canTeam ? NOTIFICATION_TABS : NOTIFICATION_TABS.filter((key) => key === "mine");
  // What requires action comes with Oläst; under Läst there are only the tab's read rows. While another tab is read the last answer stands.
  const shown = answer ?? latest;
  const rows = shown ? [...(state === "unread" ? shown.required : []), ...shown.items] : [];
  const complete = Boolean(answer) && answer!.items.length >= answer!.total && answer!.required.length >= answer!.requiredTotal;
  const card = (item: TaskNotification) => <NoticeCard key={item.id} item={item} today={latest?.today ?? feed.today} reload={list.reload}
    onOpen={opensAsRead(item) ? () => void list.markRead(item.id) : undefined} onRead={() => void list.markRead(item.id)} />;
  return <section className="space-y-5">
    {/* No Uppdatera button (punkt 7): the feed reads again every minute, when the tab is shown and when the window gets focus. */}
    <PageHeader title="Notiser" description="Det som väntar på dig och teamet."
      actions={<Button type="button" variant="outline" disabled={list.busy || state !== "unread" || !canMarkAll(counts, tab)} onClick={() => void list.markAll()} data-testid="notifications-read-all">Läs alla</Button>} />
    {list.error ? <p role="alert" className="notice text-destructive">{list.error}</p> : null}
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b pb-3">
      <div className="flex min-w-0 gap-1.5" role="group" aria-label="Vems notiser" data-testid="notifications-tabs">
        {tabs.map((key) => <PillButton key={key} active={key === tab} onClick={() => list.chooseTab(key)} testId={`notifications-tab-${key}`} count={notificationTabCount(counts, key)}>{NOTIFICATION_TAB_LABEL[key]}</PillButton>)}
      </div>
      <div className="flex min-w-0 gap-1.5" role="group" aria-label="Oläst eller läst" data-testid="notifications-state">
        {NOTIFICATION_STATES.map((key) => <PillButton key={key} active={key === state} onClick={() => list.chooseState(key)} testId={`notifications-state-${key}`}>{NOTIFICATION_STATE_LABEL[key]}</PillButton>)}
      </div>
    </div>
    {!shown ? <p role="status" className="text-sm text-muted-foreground">Hämtar notiser…</p> : <>
      {rows.length ? null : <p role="status" className="text-sm text-muted-foreground">{state === "read" ? "Inget läst ännu." : "Inget nytt."}</p>}
      <NoticeSections items={rows} complete={complete} card={card} />
      {shown.items.length < shown.total && shown.items.length < NOTIFICATION_MAX ? <Button variant="outline" onClick={list.more}>Visa fler notiser</Button> : null}
    </>}
  </section>;
}

/** The pills of the app's tab rows (SectionTabs, Översikt), for a choice inside a page. */
function PillButton({ active, onClick, testId, count, children }: { active: boolean; onClick: () => void; testId: string; count?: number; children: ReactNode }) {
  return <button type="button" aria-pressed={active} onClick={onClick} data-testid={testId}
    className={cn("touch-target flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40",
      active ? "border-primary/30 bg-secondary font-medium text-secondary-foreground ring-1 ring-primary/15" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground")}>
    {children}{count ? <span className={cn("rounded-full px-1.5 text-xs tabular-nums", active ? "bg-card text-foreground" : "bg-muted")}>{count}</span> : null}
  </button>;
}

/** A notification's dot: red late or urgent, orange soon, blue the rest (the same as on Hem). */
export function noticeDot(item: Pick<TaskNotification, "urgent" | "deadline" | "needsAction">): TypeKey {
  if (item.urgent || item.deadline === "OVERDUE" || item.needsAction) return "work-order";
  if (item.deadline === "DUE_SOON") return "risk";
  return "notice";
}
/** What the notification is, in a few words ("Förfallen", "Tilldelad dig"), for the row's small line. */
function noticeState(item: TaskNotification, today: string) {
  if (item.deadline) return item.kind === "ROUND" ? item.deadline === "OVERDUE" ? "Missad eller ej klar" : "Ska göras i dag" : item.deadline === "OVERDUE" ? "Förfallen" : item.dueDate === today ? "Förfaller i dag" : "Snart förfallande";
  if (item.kind === "FOLLOW_UP") return "Följ upp";
  return item.needsAction ? "Behöver åtgärdas" : "";
}

/**
 * Notiser at level 1 on a phone (2026-10-09): a large title (no Uppdatera: the feed reads again by itself), then the notifications as rows in two
 * groups – what is late or urgent first, then the rest – each with its dot, the task, what it is and the date; a row opens
 * the task. The long explanation is left out; the e-mail and push choice is one row to Mina inställningar → Notiser.
 */
function NativeNotifications({ feed, visibleCount, total, onMore }: { feed: TaskNotificationFeed; visibleCount: number; total: number; onMore: () => void }) {
  const { items, today, error } = feed;
  useNativeTopBar({ title: "Notiser", back: { label: "Hem" } });
  const shown = (items ?? []).slice(0, visibleCount);
  return <NativePage testId="native-notifications">
    <NativeLargeTitle inBar subtitle={items ? total ? `${total} aktuella` : "Inga aktuella notiser" : undefined}>Notiser</NativeLargeTitle>
    {error ? <ListGroup><ListEmpty><span className="text-destructive" role="alert">{error}</span></ListEmpty></ListGroup>
      : !items ? <ListGroup><ListEmpty>Hämtar notiser…</ListEmpty></ListGroup>
      : !items.length ? <ListGroup><ListEmpty>Inget väntar på dig just nu.</ListEmpty></ListGroup> : <>
        {notificationsBySection(shown).map((section) => <ListGroup key={section.key} title={section.label} testId={`native-notifications-${section.key}`}>{section.items.map((item) => <NativeNoticeRow key={item.id} item={item} today={today} />)}</ListGroup>)}
        {(items.length > visibleCount || (items.length < total && items.length < NOTIFICATION_MAX)) ? <ListGroup><ListRow title={<span className="text-primary">Visa fler notiser</span>} chevron={false} onClick={onMore} /></ListGroup> : null}
      </>}
  </NativePage>;
}

function NativeNoticeRow({ item, today, onOpen }: { item: TaskNotification; today: string; onOpen?: () => void }) {
  return <ListRow dot={noticeDot(item)} title={item.title} twoLines href={nativeNoticeHref(item.href)} testId="task-notification" onClick={onOpen}
    subtitle={[item.label ?? kindLabel[item.kind], noticeState(item, today), item.detail, item.dueDate ? `${dateLabel(item.kind)} ${item.dueDate}` : ""].filter(Boolean).join(" · ")}
    pill={item.urgent ? { label: "Akut", tone: "danger" } : !item.read && (item.kind === "ASSIGNED" || item.kind === "QUOTE" || item.kind === "OBSTACLE" || item.kind === "MACHINE_ALARM" || item.kind === "MACHINE_NOTE" || item.kind === "COMMENT") ? { label: "Oläst", tone: "info" } : null} />;
}

/** Notislistan at level 1 on a phone (beslut 4): "Kräver åtgärd" first, the same choices as segmented controls, a row reads when it is opened. */
function NativeCloudNotifications({ list, today }: { list: NotificationList; today: string }) {
  const { answer, latest, tab, state } = list;
  useNativeTopBar({ title: "Notiser", back: { label: "Hem" } });
  const counts = latest?.counts;
  const open = (item: TaskNotification) => opensAsRead(item) ? () => void list.markRead(item.id) : undefined;
  const shownToday = latest?.today ?? today;
  const shown = answer ?? latest;
  const rows = shown ? [...(state === "unread" ? shown.required : []), ...shown.items] : [];
  return <NativePage testId="native-notifications">
    <NativeLargeTitle inBar subtitle={counts ? counts.bell ? `${counts.bell} nya` : "Inget nytt" : undefined}>Notiser</NativeLargeTitle>
    {list.error ? <ListGroup><ListEmpty><span className="text-destructive" role="alert">{list.error}</span></ListEmpty></ListGroup> : null}
    <div className="space-y-2 pt-3">
      {list.canTeam ? <NativeSegmented label="Vems notiser" value={tab} onChange={list.chooseTab} options={NOTIFICATION_TABS.map((key) => [key, NOTIFICATION_TAB_LABEL[key]] as const)} testId="notifications-tabs" /> : null}
      <NativeSegmented label="Oläst eller läst" value={state} onChange={list.chooseState} options={NOTIFICATION_STATES.map((key) => [key, NOTIFICATION_STATE_LABEL[key]] as const)} testId="notifications-state" />
    </div>
    {!shown ? <ListGroup><ListEmpty>Hämtar notiser…</ListEmpty></ListGroup>
      : !rows.length ? <ListGroup><ListEmpty>{state === "read" ? "Inget läst ännu." : "Inget väntar på dig just nu."}</ListEmpty></ListGroup>
      : notificationsBySection(rows).map((section) => <ListGroup key={section.key} title={section.label} testId={`native-notifications-${section.key}`}>{section.items.map((item) => <NativeNoticeRow key={item.id} item={item} today={shownToday} onOpen={open(item)} />)}</ListGroup>)}
    {shown && shown.items.length < shown.total && shown.items.length < NOTIFICATION_MAX ? <ListGroup><ListRow title={<span className="text-primary">Visa fler notiser</span>} chevron={false} onClick={list.more} /></ListGroup> : null}
    {answer ? <ListGroup footer="Det som kräver åtgärd kommer också med e-post och push.">
      {state === "unread" && canMarkAll(counts, tab) ? <ListRow title={<span className="text-primary">Läs alla</span>} chevron={false} onClick={() => void list.markAll()} testId="notifications-read-all" /> : null}
      <ListRow type="notice" icon={Mail} title="E-post och push" subtitle="Välj själv i Mina inställningar" href="/?view=settings&step=notices" testId="native-notifications-channels" />
    </ListGroup> : null}
  </NativePage>;
}
