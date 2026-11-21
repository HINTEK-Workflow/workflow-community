"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Ban, Bell, CalendarClock, CalendarPlus, FileText, CheckCircle2, CircleDashed, CircleAlert, CircleSlash, ClipboardList, Pencil, Play, QrCode, Repeat, Trash2, MapPin } from "lucide-react";
import { notDoneLine } from "@/lib/workflow/round-outcome";
import { RoundNotDoneDialog } from "./round-not-done-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { Empty, DialogActions, FormPage, FormPanel, NoPermission, Panel, ShowMore } from "@/features/kfid/ui";
import { DialogPage } from "@/features/kfid/dialog-page";
import { cn } from "@/lib/utils";
import { formatSwedish, swedishDayKey } from "@/lib/swedish-time";
import { defaultScheduleReminders, formScheduleInputSchema, occurrenceHandled, occurrenceOverdue, roundPosition, roundWhereLabel, type FormScheduleInput, type ScheduleOccurrenceState, type ScheduleView } from "@/lib/workflow/form-schedule";
import { indicatorBadge, indicatorText } from "./indicator-tone";
import { PlaceMap, useMapStatus } from "./map-view";
import { occurrenceChipDate, roundFormNotice, roundHref } from "@/lib/workflow/form-schedule";
import { roundStartAction } from "@/lib/workflow/round-work-orders";
import { RoundRuleFields } from "./round-rule-fields";
import { PageHeader } from "@/components/page-shell";
import { ListFilterBar, useListPrefs } from "@/components/list-filter-bar";
import { useEntryState } from "@/components/history-nav";
import { listSortOptions } from "@/lib/list-filter";
import { listRounds, ROUND_FILTER_LABEL, ROUND_FILTERS, ROUND_SORTS, roundMatches, type RoundFilter } from "@/lib/workflow/round-list";
import type { WorkListScope } from "@/lib/workflow/work-list";
import { useRouter, useSearchParams } from "next/navigation";
import { useAddressEntryState } from "@/components/use-address-filter";
import { ListEmpty, ListFact, ListGroup, ListRow, NativeActions, NativeLargeTitle, NativePage, NativeSegmented, useNativeTopBar } from "@/components/native";
import { returnToWork } from "@/components/history-nav";
import { announce } from "@/lib/workflow/toast";
import { groupByDate, withScreen } from "@/lib/workflow/native-mode";
import { roundLabelsHref } from "@/lib/workflow/navigation";
import { useNativeMode } from "./use-detail-level";
import { IconButton } from "@/components/ui/icon-button";
import { RemoveButton } from "@/components/ui/remove-button";

type PublishedForm = { id: string; name: string };
type Option = { id: string; name: string };
/**
 * `hidden`: rounds exist but the person may read none of them (the server decides). `canPlan`: Ny rond; each round's
 * `canEdit`: Ändra and Ta bort (planning rights 2026-10-10, lib/workflow/round-planning.ts); without it `canPlan` applies.
 * `canPlanOthers: false`: the person plans only their own rounds (outside the projects they are responsible for).
 */
type RoundsData = { schedules: (ScheduleView & { canEdit?: boolean })[]; canPlan: boolean; canPlanOthers?: boolean; today: string; hidden?: boolean; /** false: the person may not read rounds at all (canReadRounds) – the permission box. */ canRead?: boolean;
  /** Ej utfört is offered (Cloud only, 2026-10-28); absent in Local and the demo. Each marking is still decided by the server. */ canMarkNotDone?: boolean };
const mayEdit = (data: RoundsData, schedule: ScheduleView & { canEdit?: boolean }) => schedule.canEdit ?? data.canPlan;
/** The same view in Cloud (API) and Local (the open file). */
export type RoundsBackend = {
  load: () => Promise<RoundsData>;
  save: (input: FormScheduleInput, templateName: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  members?: Option[];
  /**
   * Ej utfört (2026-10-28, etapp 5): record or revoke that an occurrence will not be done. Cloud only – Local and the
   * demo leave them out, so the button is not offered there.
   */
  markNotDone?: (scheduleId: string, occurrence: string, reason: string) => Promise<void>;
  revokeNotDone?: (id: string) => Promise<void>;
};

export const cloudRoundsBackend: RoundsBackend = {
  load: () => api("/api/form-schedules"),
  save: async (schedule) => { await api("/api/form-schedules", { method: "POST", body: JSON.stringify({ action: "save", schedule }) }); },
  remove: async (id) => { await api("/api/form-schedules", { method: "POST", body: JSON.stringify({ action: "delete", id }) }); },
  markNotDone: async (scheduleId, occurrence, reason) => { await api("/api/form-schedules", { method: "POST", body: JSON.stringify({ action: "mark_not_done", scheduleId, occurrence, reason }) }); },
  revokeNotDone: async (id) => { await api("/api/form-schedules", { method: "POST", body: JSON.stringify({ action: "revoke_not_done", id }) }); },
};

const STATE: Record<ScheduleOccurrenceState["state"], { label: string; tone: "success" | "warning" | "danger" | "neutral"; icon: typeof CheckCircle2 }> = {
  done: { label: "Utförd", tone: "success", icon: CheckCircle2 }, started: { label: "Påbörjad", tone: "warning", icon: CircleDashed },
  missed: { label: "Missad", tone: "danger", icon: CircleAlert }, due: { label: "I dag", tone: "warning", icon: CalendarClock }, upcoming: { label: "Kommande", tone: "neutral", icon: CalendarClock },
  // Etapp 5 (2026-10-28): Ej utfört is handled (neutral); Utgått leaves the day open – försenad once its time has passed.
  not_done: { label: "Ej utfört", tone: "neutral", icon: CircleSlash }, cancelled: { label: "Utgått", tone: "warning", icon: Ban },
};
/** A chip's look: an utgått day that is late is shown like a missed one. */
const chipState = (occurrence: ScheduleOccurrenceState) => occurrence.state === "cancelled" && occurrence.late ? { ...STATE.cancelled, tone: "danger" as const } : STATE[occurrence.state];
/** The occurrence Ej utfört is offered for on the card: the one to do now, when it has no protocol going. */
const notDoneTarget = (schedule: ScheduleView) => {
  const current = schedule.overview.current;
  return schedule.active && current && current.state !== "started" && !occurrenceHandled(current) ? current : null;
};
const day = (value: string) => formatSwedish(`${value}T12:00:00`, { dateStyle: "medium" });
/** Where a round is on the map: the place of the work order that holds it (2026-10-27 kväll), else the pin of its temporary place. */
const roundPin = (schedule: ScheduleView) => roundPosition(schedule.holder);


/**
 * Driftronder (2026-09-28): recurring rounds of any form – a hydropower station's daily supervision, a standby
 * generator's weekly test run, a pumping station's round. Shows what is due today, what was missed and what comes
 * next; a round is started from its occurrence and the protocol remembers the schedule and the day. Where a round is done is
 * the place of the work order that holds it (2026-10-27 kväll); a round without one shows "Ingen arbetsorder". Who plans a round
 * follows the booking rules (lib/workflow/round-planning.ts; in Local the file's owner); everyone who may read the form
 * starts them. The list has the shared toppvisning (2026-10-31): Mina | Alla (the rounds I am responsible for), chips with
 * counts, a search, the sort and Rader | Kort (lib/workflow/round-list.ts); level 1 on a phone keeps its own Alla | Behöver åtgärd.
 */
const ROUND_SCOPES: readonly WorkListScope[] = ["mine", "all"];
const NO_SCOPES: readonly WorkListScope[] = [];
const ROUND_SORT_OPTIONS = listSortOptions(ROUND_SORTS);
/** Ronder shown at a time on the list (levels 2–3). */
const ROUND_PAGE = 10;

export function FormRounds({ backend = cloudRoundsBackend, revision, personId = "" }: { backend?: RoundsBackend; /** Local: the file's revision, so the view reads the file again after a change. */ revision?: string;
  /** The signed-in person, for Mina and the remembered choices; Local has none (no Mina | Alla). */ personId?: string }) {
  const [confirm, confirmCard] = useConfirm();
  const [data, setData] = useState<RoundsData | null>(null);
  const [error, setError] = useState("");
  // `&attention=1` opens the rounds that need attention (dashboard etapp 3, 2026-10-28; lib/url-filters.ts).
  const [filter, setFilter] = useAddressEntryState<RoundFilter>("rounds.filter", "attention", (raw) => raw === "1" ? "attention" : null, "all");
  const prefs = useListPrefs("rounds", personId, { sorts: ROUND_SORTS, scopes: personId ? ROUND_SCOPES : NO_SCOPES, scope: "all" });
  const [query, setQuery] = useEntryState("rounds.q", "");
  // Planning rounds on Lantmäteriet's map (2026-10-04), when the installation has it.
  const mapStatus = useMapStatus();
  const [showMap, setShowMap] = useState(false);
  // Local builds a new backend on every render of the open file, so it is read through a ref, not as a dependency.
  const source = useRef(backend);
  useEffect(() => { source.current = backend; });
  const reload = useCallback(async () => { try { setData(await source.current.load()); setError(""); } catch (issue) { setError((issue as Error).message); } }, []);
  useEffect(() => { void reload(); }, [reload, revision]);
  const schedules = data?.schedules ?? [];
  const active = schedules.filter((item) => item.active);
  const dueToday = active.filter((item) => item.overview.today && !occurrenceHandled(item.overview.today)).length;
  const missed = active.reduce((sum, item) => sum + item.overview.missed, 0);
  const missedRounds = active.filter((item) => item.overview.missed > 0).length;
  // Ej utfört in the last 30 days (2026-10-28): followed up under Behöver åtgärd, never counted as missed.
  const notDone = active.reduce((sum, item) => sum + (item.overview.notDone ?? 0), 0);
  const openFaults = schedules.reduce((sum, item) => sum + (item.overview.openDeviations ?? 0), 0);
  // Level 1 keeps its own Alla | Behöver åtgärd; the computer's list has scope, search, the chips and the sort.
  const nativeFilter: "all" | "attention" = filter === "attention" ? "attention" : "all";
  const nativeShown = schedules.filter((item) => roundMatches(item, nativeFilter));
  const listed = listRounds(schedules, { scope: prefs.scope ?? null, personId, filter, q: query, sort: prefs.sort, where: (item) => [roundWhereLabel(item.holder), item.holder?.customerName, item.holder?.projectName].filter(Boolean).join(" ") });
  const shown = listed.items;
  // A few rounds at a time with Visa fler (the fold rule, 2026-11-02); a new choice starts from the top again.
  const [rows, setRows] = useState(ROUND_PAGE);
  const listChoice = `${filter}|${query}|${prefs.scope ?? ""}|${prefs.sort}`;
  const [seenChoice, setSeenChoice] = useState(listChoice);
  if (seenChoice !== listChoice) { setSeenChoice(listChoice); setRows(ROUND_PAGE); }
  // Ej utfört (2026-10-28): the occurrence being marked, and the way to record or revoke it (Cloud only).
  const [notDoneFor, setNotDoneFor] = useState<{ schedule: ScheduleView; date: string } | null>(null);
  const canMarkNotDone = Boolean(backend.markNotDone && backend.revokeNotDone && data?.canMarkNotDone);
  const markNotDone = (schedule: ScheduleView, date: string) => setNotDoneFor({ schedule, date });
  const revokeNotDone = async (id: string) => {
    if (!(await confirm({ title: "Ångra Ej utfört?", message: "Tillfället blir öppet igen. Markeringen finns kvar i historiken som ångrad.", confirmLabel: "Ångra" }))) return;
    try { await source.current.revokeNotDone?.(id); await reload(); announce("Ej utfört är ångrat"); } catch (issue) { setError((issue as Error).message); }
  };
  const notDoneDialog = <RoundNotDoneDialog target={notDoneFor ? { title: notDoneFor.schedule.title, date: notDoneFor.date } : null} onClose={() => setNotDoneFor(null)}
    onConfirm={async (reason) => {
      if (!notDoneFor) return null;
      try { await source.current.markNotDone?.(notDoneFor.schedule.id, notDoneFor.date, reason); await reload(); announce("Tillfället är markerat Ej utfört"); return null; } catch (issue) { return (issue as Error).message; }
    }} />;
  const native = useNativeMode();
  // Nivå 1 på mobil: Ny rond and Ändra rond are a screen of their own (`&step=ny`, `&step=rond&round=…`), with Avbryt and
  // Spara in the top bar, instead of a view over the list; Bakåt and the browser's back close it.
  const router = useRouter();
  const params = useSearchParams();
  // Ny rond and Ändra rond are pages of their own on levels 2–3 (plan 1O, 2026-10-11): `&new=1` and
  // `&roundId=…&edit=1`; Avbryt goes back where the person came from, Spara to the list. Level 1 keeps its screens above.
  const roundsHref = "/?view=rounds";
  const formRequested = !native && (params.get("new") === "1" || params.get("edit") === "1");
  const editing: ScheduleView | "new" | null = !native && params.get("new") === "1" ? "new" : !native && params.get("edit") === "1" ? schedules.find((item) => item.id === params.get("roundId")) ?? null : null;
  const setEditing = (target: ScheduleView | "new") => router.push(target === "new" ? `${roundsHref}&new=1` : `${roundsHref}&roundId=${encodeURIComponent(target.id)}&edit=1`);
  const roundUrl = (step: "ny" | "rond" | null, id?: string) => { const next = new URLSearchParams(withScreen(params.toString(), step).slice(2)); if (id) next.set("round", id); else next.delete("round"); next.delete("new"); next.delete("edit"); next.delete("roundId"); return `/?${next.toString()}`; };
  const nativeEditing: ScheduleView | "new" | null = !native ? null : params.get("step") === "ny" || params.get("new") === "1" ? "new" : params.get("step") === "rond" ? schedules.find((item) => item.id === params.get("round")) ?? null : null;
  // M1: the list has the top bar (‹ Hem, Driftronder); Ny rond and Ändra rond (ScheduleDialog) set their own with Avbryt/Spara.
  useNativeTopBar(native && !nativeEditing ? { title: "Driftronder", back: { label: "Hem" }, save: data?.canPlan ? { label: "Ny", onClick: () => edit("new") } : null } : null);
  const edit = (target: ScheduleView | "new") => native ? router.push(target === "new" ? roundUrl("ny") : roundUrl("rond", target.id)) : setEditing(target);
  const closeScreen = () => returnToWork(roundUrl(null), (address) => router.push(address));
  const remove = async (schedule: ScheduleView): Promise<boolean> => {
    if (!(await confirm({ title: "Ta bort ronden?", message: `${schedule.title} tas bort. Protokoll som redan gjorts finns kvar.`, confirmLabel: "Ta bort", tone: "danger" }))) return false;
    try { await source.current.remove(schedule.id); await reload(); announce("Ronden är borttagen"); return true; } catch (issue) { setError((issue as Error).message); return false; }
  };
  // Nivå 1 på mobil (2026-10-09): the rounds as rows grouped by the day they are due, the same start and planning.
  // The round's own screen (2026-10-12): start or continue it, change it, and remove it (asks first) – none of that sits in the list's row.
  if (native && nativeEditing) {
    const own = nativeEditing === "new" ? null : nativeEditing;
    const action = own ? roundAction(own) : null;
    const allowed = !own || (data ? mayEdit(data, own) : false);
    // QR-etiketter från telefonen (2026-10-23): the round's own screen leads to its label sheet, as the card does on a computer.
    const labels = own && backend === cloudRoundsBackend && own.holder?.facilityId ? roundLabelsHref(own.id) : null;
    // Ej utfört on the round's own screen (2026-10-28): for the occurrence to do now, when it has no protocol going.
    const target = own && canMarkNotDone ? notDoneTarget(own) : null;
    const notDoneRow = own && target ? { date: target.date, onClick: () => markNotDone(own, target.date) } : undefined;
    // Förenkling 0.77.0 (kvar-till-2026-12-31 F, Driftronder): a tap on the round opens the round – start or continue it,
    // its facts – not Ändra rond. Ändra rond is a row of its own there (`&edit=1`) for someone who may change the round.
    const roundScreen = own ? roundUrl("rond", own.id) : "";
    if (own && !(allowed && params.get("edit") === "1")) return <>{notDoneDialog}<RoundReadOnly schedule={own} action={action} labels={labels} notice={roundFormNotice(own)} notDone={notDoneRow} edit={allowed ? `${roundScreen}&edit=1` : null} /></>;
    const closeEdit = own ? () => returnToWork(roundScreen, (address) => router.push(address)) : closeScreen;
    return <>{confirmCard}{notDoneDialog}<ScheduleDialog screen schedule={own} backend={backend} planOthers={data?.canPlanOthers} onClose={closeEdit} onSaved={() => { closeEdit(); void reload(); }}
      onRemove={own ? () => { void remove(own).then((done) => { if (done) closeScreen(); }); } : undefined} /></>;
  }
  // The page follows the menu (canReadRounds, decided by the server; webbplatskartan 2026-10-25): someone without it gets the
  // one "no permission" box (decision 6, KTR-13). Someone with it, who reads none of the company's rounds (hidden), gets the
  // page without numbers – told so in the list, with Ny driftrond when the server says they may plan.
  if (data?.canRead === false) return native ? <NativePage testId="form-rounds"><NoRoundsAccess native /></NativePage> : <NoRoundsAccess />;
  if (native) return <NativePage testId="form-rounds">
    {confirmCard}
    {notDoneDialog}
    {/* The count says what it counts (QA 2026-10-10: "4 missade" over a list of 2): missed occasions in 30 days, on how many rounds.
        + for a new round, as the other lists at level 1. */}
    <NativeLargeTitle inBar subtitle={data ? `${dueToday} att göra i dag${missed ? ` · ${missed} ${missed === 1 ? "missat tillfälle" : "missade tillfällen"} på ${missedRounds} ${missedRounds === 1 ? "rond" : "ronder"}` : ""}${notDone ? ` · ${notDone} ej utförda` : ""}${openFaults ? ` · ${openFaults} brister utan arbetsorder` : ""}` : "Hämtar ronder…"}
      >Driftronder</NativeLargeTitle>
    <NativeSegmented label="Urval" value={nativeFilter} onChange={setFilter} options={[["all", "Alla"], ["attention", "Behöver åtgärd"]]} testId="round-filter" />
    {error ? <p role="alert" className="notice mt-3 text-destructive">{error}</p> : null}
    {!data ? <p role="status" className="px-4 py-6 text-sm text-muted-foreground">Hämtar ronder…</p>
      : !nativeShown.length ? <ListGroup><ListEmpty>{schedules.length ? "Inget behöver åtgärdas." : data.hidden ? (data.canPlan ? "Inga ronder som du får se. Planera en med plusknappen." : "Inga ronder som du får se.") : data.canPlan ? "Inga ronder ännu. Planera en med plusknappen." : "Inga ronder ännu. Du har inte behörighet att planera ronder."}</ListEmpty></ListGroup>
      : <div data-testid="round-list">{groupByDate(nativeShown, (item) => item.active ? item.overview.current?.date ?? item.overview.next ?? null : null, data.today, (item) => item.active && item.overview.current?.state !== "done").map((group) => <ListGroup key={group.key} title={group.label} testId={`native-group-${group.key}`} alignPills>
        {group.items.map((schedule) => { const status = roundStatus(schedule);
          // The pill says the state in one word; its day goes first in the line under the title.
          const [word, ...when] = status.label.split(" "); const short = ["Missad", "Nästa", "Påbörjad"].includes(word) && when.length ? { label: word, tone: status.tone, when: when.join(" ") } : { ...status, when: "" };
          return <ListRow key={schedule.id} type="round" title={schedule.title} href={roundUrl("rond", schedule.id)} testId="round-card"
            subtitle={[short.when, roundFormNotice(schedule) ?? (roundWhereLabel(schedule.holder) || schedule.templateName), schedule.ruleText].filter(Boolean).join(" · ")} pill={{ label: short.label, tone: short.tone }} />; })}
      </ListGroup>)}</div>}
    {mapStatus && schedules.some((item) => roundPin(item)) ? <div className="space-y-3 pt-4">
      <Button type="button" variant="outline" aria-pressed={showMap} onClick={() => setShowMap((current) => !current)} data-testid="rounds-show-map"><MapPin />{showMap ? "Dölj kartan" : "Ronderna på karta"}</Button>
      {showMap ? <PlaceMap status={mapStatus} label="Ronderna på karta" points={nativeShown.filter((item) => roundPin(item)).map((item) => ({ id: item.id, ...roundPin(item)!, label: `${item.title} · ${roundWhereLabel(item.holder)}`, ...(item.overview.current && roundAction(item) ? { href: roundAction(item)!.href } : {}) }))} /> : null}
    </div> : null}
  </NativePage>;
  // Ny driftrond is a page on displays 2 and 3 (plan 1Q): the form is larger than a popup the size of "Lägg till instrument"
  // (form, place, who, how often with its weekdays, reminders), so it stays a page in every display (a screen at level 1).
  if (formRequested) return <FormPage title={editing === "new" ? "Ny driftrond" : "Ändra rond"} size="page" back={roundsHref} testId="round-form-page"
    description="Välj formulär, ansvarig och hur ofta ronden ska göras. Kund och plats följer arbetsordern.">
    {(form) => editing === "new" && data && !data.canPlan ? <p role="status" className="text-sm text-muted-foreground" data-testid="round-no-permission">Du saknar behörighet att planera ronder.</p> : editing ? <ScheduleDialog page schedule={editing === "new" ? null : editing} backend={backend} planOthers={data?.canPlanOthers} onClose={form.cancel} onSaved={() => { void reload(); form.done(roundsHref); }} />
      : <p role="status" className="text-sm text-muted-foreground">{data ? "Ronden hittades inte." : "Hämtar ronden…"}</p>}
  </FormPage>;
  return <div className="space-y-6" data-testid="form-rounds" data-view={prefs.view} data-scope={prefs.scope}>
    {confirmCard}
    {notDoneDialog}
    <PageHeader title="Driftronder" description="Driftronder är återkommande tillsyn. En arbetsorder samlar ronden under en period. Här startar du dagens rond."
      actions={<>
        {mapStatus && schedules.some((item) => roundPin(item)) ? <Button type="button" variant="outline" aria-pressed={showMap} onClick={() => setShowMap((current) => !current)} data-testid="rounds-show-map"><MapPin />{showMap ? "Dölj kartan" : "Ronderna på karta"}</Button> : null}
        {data?.canPlan ? <Button onClick={() => setEditing("new")} data-testid="round-new"><CalendarPlus />Ny driftrond</Button> : null}
      </>} />
    {error ? <p role="alert" className="notice text-destructive">{error}</p> : null}
    <ListFilterBar testId="rounds"
      scope={prefs.scope ? { value: prefs.scope, scopes: ROUND_SCOPES, onChange: prefs.setScope } : undefined}
      chips={{ label: "Urval", chips: ROUND_FILTERS.map((value) => ({ value, label: ROUND_FILTER_LABEL[value], count: data ? listed.counts[value] : null })), value: filter, onChange: setFilter, testId: "round-filter" }}
      search={{ label: "Sök rond", placeholder: "Rond, formulär, plats eller ansvarig…", value: query, onChange: setQuery }}
      sort={{ value: prefs.sort, options: ROUND_SORT_OPTIONS, onChange: prefs.setSort }}
      view={{ value: prefs.view, onChange: prefs.setView }} />
    <Panel title="Ronder" description={data ? `I dag ${day(data.today)}.` : "Hämtar ronder…"} icon={Repeat}>
      {!data ? <p role="status" className="text-sm text-muted-foreground">Hämtar ronder…</p> : !shown.length
        ? schedules.length && (filter !== "attention" || query.trim() || prefs.scope === "mine") ? <div className="notice">Inget matchar urvalet. Ändra filter eller sökning.</div>
        : <Empty title={schedules.length ? "Inget behöver åtgärdas" : data.hidden ? "Inga ronder att visa" : "Inga ronder ännu"} description={schedules.length ? "Alla dagens ronder är hanterade, inga är missade och alla brister har en arbetsorder." : data.hidden ? (data.canPlan ? "Du får inte se någon av företagets ronder. Du kan planera en egen." : "Du får inte se någon av företagets ronder.") : data.canPlan ? "Planera en återkommande rond: välj formulär och hur ofta den görs." : "Du har inte behörighet att planera ronder."}>
          {!schedules.length && data.canPlan ? <Button onClick={() => setEditing("new")}><CalendarPlus />Ny driftrond</Button> : null}
        </Empty>
        // Rader: one round per row across the list; Kort: the same round cards side by side, as many as the list's width holds.
        : <div className="@container"><ul className={cn("grid gap-3", prefs.view === "cards" && "@3xl:grid-cols-2 @7xl:grid-cols-3")} data-testid="round-list">{shown.slice(0, rows).map((schedule) => <RoundCard key={schedule.id} schedule={schedule} canPlan={mayEdit(data, schedule)} todayKey={data.today} onEdit={() => setEditing(schedule)} onRemove={() => void remove(schedule)}
          onNotDone={canMarkNotDone ? (date) => markNotDone(schedule, date) : undefined} onRevokeNotDone={canMarkNotDone ? (id) => void revokeNotDone(id) : undefined}
          labels={backend === cloudRoundsBackend && schedule.holder?.facilityId ? roundLabelsHref(schedule.id) : null} />)}</ul><ShowMore shown={Math.min(rows, shown.length)} total={shown.length} onMore={() => setRows((value) => value + ROUND_PAGE)} testId="round-more" /></div>}
    </Panel>
    {/* Lika är rätt (2026-11-13): nothing between the heading and the toolbar, so the list starts where every other list's
        does – the map (its button is in the header) and the numbers stand under the list. */}
    {mapStatus && showMap && schedules.some((item) => roundPin(item)) ? <PlaceMap status={mapStatus} label="Ronderna på karta" points={shown.filter((item) => roundPin(item)).map((item) => ({ id: item.id, ...roundPin(item)!, label: `${item.title} · ${roundWhereLabel(item.holder)}`, ...(item.overview.current && roundAction(item) ? { href: roundAction(item)!.href } : {}) }))} /> : null}
    {/* No numbers for someone who reads none of the rounds (KTR-13): they would count nothing. */}
    {data?.hidden && !schedules.length ? null : <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="stat-card rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Att göra i dag</p><p className="mt-1 text-2xl font-semibold tabular-nums">{dueToday}</p></div>
      <div className="stat-card rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Missade senaste 30 dagarna</p><p className={cn("mt-1 text-2xl font-semibold tabular-nums", missed && "text-destructive")}>{missed}</p>{notDone ? <p className="mt-1 text-xs text-muted-foreground" data-testid="round-not-done-count">{notDone} ej utförda</p> : null}</div>
      <div className="stat-card rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Brister utan arbetsorder</p><p className={cn("mt-1 text-2xl font-semibold tabular-nums", openFaults && "text-destructive")} data-testid="round-open-faults">{openFaults}</p></div>
      <div className="stat-card rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">Aktiva ronder</p><p className="mt-1 text-2xl font-semibold tabular-nums">{active.length}</p></div>
    </div>}
  </div>;
}

/** The shared "no permission" box (decision 6): the same title and the way out, without the page's numbers and buttons. */
function NoRoundsAccess({ native = false }: { native?: boolean }) {
  useNativeTopBar(native ? { title: "Driftronder", back: { label: "Hem" } } : null);
  if (native) return <>
    <ListGroup><ListEmpty>Du har inte behörighet till den här sidan.</ListEmpty></ListGroup>
    <NativeActions><Link href="/?view=stats" data-testid="no-permission-home">Till Översikt</Link></NativeActions>
  </>;
  return <div className="space-y-6" data-testid="form-rounds">
    <PageHeader title="Driftronder" />
    <NoPermission />
  </div>;
}

/** The round's own screen at level 1: the way to start it, its facts, and Ändra rond for someone who may change it. */
function RoundReadOnly({ schedule, action, labels, notice, notDone, edit = null }: { schedule: ScheduleView; action: { href: string; label: string; kind: string } | null; labels: string | null; notice: string | null; notDone?: { date: string; onClick: () => void }; edit?: string | null }) {
  useNativeTopBar({ title: schedule.title, back: { label: "Driftronder" } });
  return <NativePage testId="native-round-readonly">
    {action || labels || notice || notDone ? <ListGroup testId="native-round-start">
      {notice ? <RoundFormNoticeRow notice={notice} /> : null}
      {action ? <ListRow type="round" icon={action.kind === "create" ? ClipboardList : Play} title={action.label} href={action.href} testId={action.kind === "create" ? "round-create-order" : "round-start"} /> : null}
      {notDone ? <RoundNotDoneRow {...notDone} /> : null}
      {labels ? <RoundLabelsRow href={labels} /> : null}
    </ListGroup> : null}
    <ListGroup>
      <ListFact label="Formulär">{schedule.templateName}</ListFact>
      <ListFact label="Hur ofta">{schedule.ruleText}</ListFact>
      <ListFact label="Plats">{roundWhereLabel(schedule.holder)}</ListFact>
      {schedule.assignedToName ? <ListFact label="Ansvarig">{schedule.assignedToName}</ListFact> : null}
    </ListGroup>
    {edit ? <ListGroup><ListRow type="round" icon={Pencil} title="Ändra rond" subtitle="Formulär, ansvarig, hur ofta och påminnelser" href={edit} testId="round-edit" /></ListGroup> : null}
  </NativePage>;
}

/** 2026-10-24: the round's form is not published (or removed) – this stands where Starta would, on the round's own screen. */
function RoundFormNoticeRow({ notice }: { notice: string }) {
  return <ListRow type="round" icon={CircleAlert} title={notice} subtitle="Ronden kan startas när formuläret publiceras eller byts" testId="round-form-missing" />;
}

/** Ej utfört as a row of the round's own screen at level 1 (2026-10-28): opens the dialog with the required reason. */
function RoundNotDoneRow({ date, onClick }: { date: string; onClick: () => void }) {
  return <ListRow type="round" icon={CircleSlash} title="Ej utfört" subtitle={`Tillfället ${day(date)} görs inte`} onClick={onClick} testId="round-not-done" />;
}

/** The round's QR labels as a row of the round's own screen at level 1 (2026-10-23). */
function RoundLabelsRow({ href }: { href: string }) {
  return <ListRow type="round" icon={QrCode} title="QR-etiketter" subtitle="Skriv ut etiketter till rondens punkter" href={href} testId="round-labels" />;
}

/** A round's status as the card and the phone's row show it. */
function roundStatus(schedule: ScheduleView): { label: string; tone: "success" | "warning" | "danger" | "neutral" } {
  const current = schedule.overview.current;
  const today = schedule.overview.today;
  return !schedule.active ? { label: "Pausad", tone: "neutral" as const } : today?.state === "done" ? (schedule.overview.openDeviations ? { label: "Utförd i dag – brist utan arbetsorder", tone: "warning" as const } : { label: "Utförd i dag", tone: "success" as const }) // Today's occurrence is försenad once the round's klockslag has passed (2026-10-28), and "I dag kl. 07:00" before that.
    // An utgått protocol leaves its day open (2026-10-28): late like a missed one once its time has passed.
    : current && occurrenceOverdue(current) ? { label: current.date === today?.date ? `Förfallen kl. ${schedule.rule.time}` : `Missad ${day(current.date)}`, tone: "danger" as const }
    : today?.state === "not_done" && !current ? { label: "Ej utfört i dag", tone: "neutral" as const }
    : today ? { label: today.state === "started" ? "Påbörjad i dag" : `I dag${schedule.rule.time ? ` kl. ${schedule.rule.time}` : ""}`, tone: "warning" as const } : schedule.overview.next && schedule.overview.nextTaskId ? { label: `Påbörjad ${day(schedule.overview.next)}`, tone: "warning" as const } : { label: schedule.overview.next ? `Nästa ${day(schedule.overview.next)}` : "Avslutad", tone: "neutral" as const };
}

/**
 * What a tap on the round does now: continue a started protocol, start today's (or a missed, or the next) occurrence in the
 * round's work order, or – when no work order holds that day (2026-10-27, punkt 3) – make it first.
 */
const roundAction = (schedule: ScheduleView) => roundStartAction(schedule);

function RoundCard({ schedule, canPlan, todayKey, onEdit, onRemove, labels = null, onNotDone, onRevokeNotDone }: { schedule: ScheduleView; canPlan: boolean; todayKey: string; onEdit: () => void; onRemove: () => void;
  /** QR hör till driftronden (2026-10-22): the round's label sheet, for its work order's place and the objects under it (Cloud, a work order with a register place). */
  labels?: string | null;
  /** Ej utfört (2026-10-28, Cloud): mark an occurrence without a protocol going, and revoke a marking. The server decides. */
  onNotDone?: (date: string) => void; onRevokeNotDone?: (id: string) => void }) {
  const today = schedule.overview.today;
  const status = roundStatus(schedule);
  const action = roundAction(schedule);
  const notDoneFor = onNotDone ? notDoneTarget(schedule) : null;
  // The occurrences recorded as Ej utfört in the window, the latest first: reason, who and when (the history).
  const notDoneItems = [...(today?.state === "not_done" ? [today] : []), ...schedule.overview.history.filter((item) => item.state === "not_done")].flatMap((item) => item.notDone ? [{ date: item.date, ...item.notDone }] : []).slice(0, 5);
  // Where the round is done: the work order that holds it now (2026-10-27 kväll) – its place (a temporary place as
  // "Tillfällig: …"), customer and project – or "Ingen arbetsorder".
  const holder = schedule.holder;
  const place = roundWhereLabel(holder);
  const where = [place, holder?.customerName && holder.customerName !== place ? holder.customerName : "", holder?.projectName].filter(Boolean).join(" · ");
  return <li className="rounded-xl border bg-card p-4" data-testid="round-card">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 basis-64">
        {/* Förenkling 0.77.0: the round's name opens the round – its occurrence to do now, as the main button does; Ändra rond is the pencil. */}
        <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">{action && action.kind !== "create" ? <Link href={action.href} className="hover:underline underline-offset-4" data-testid="round-open">{schedule.title}</Link> : schedule.title}<Badge variant="outline" className={indicatorBadge(status.tone)} data-testid="round-status">{status.label}</Badge></h3>
        <p className="mt-1 text-xs text-muted-foreground" data-testid="round-where-line">{schedule.templateMissing ? <span className={cn("font-medium", indicatorText("warning"))} data-testid="round-form-missing">{roundFormNotice(schedule)}.{canPlan ? <> <button type="button" className="underline underline-offset-4" onClick={onEdit}>Välj ett nytt formulär</button></> : ""}</span> : schedule.templateName}{where ? ` · ${where}` : ""}</p>
        <p className="mt-1 text-xs text-muted-foreground">{schedule.ruleText}{schedule.assignedToName ? ` · Ansvarig ${schedule.assignedToName}` : ""}</p>
      </div>
      {/* Prydliga rader (2026-11-04): the main button has one width and every icon its own place, so the rows line up. */}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2" data-testid="round-actions">
        {/* "Planering är bara en planering" (2026-10-07): with nothing due, the next occurrence can be started now; an
            occurrence started ahead stays the next one, with Fortsätt rond, until its protocol is completed (2026-10-07). Without
            a work order that holds the day (2026-10-27, punkt 3) the button makes it first – a year from the day by default; the
            work order chooses its customer and place (an older round's stored ones are the suggestion). */}
        {action ? <Button asChild size="sm" className="min-w-[15rem]" variant={action.kind === "start" && !schedule.overview.current ? "outline" : "default"}><Link href={action.href}
          data-testid={action.kind === "create" ? "round-create-order" : action.kind === "continue" ? (schedule.overview.current ? "round-start" : "round-continue") : schedule.overview.current ? "round-start" : "round-start-now"}>
          {action.kind === "continue" ? <CircleDashed /> : action.kind === "create" ? <ClipboardList /> : <Play />}{action.label}</Link></Button> : null}
        {/* Ej utfört (2026-10-28): the occurrence to do now will not be done – a required reason, no protocol. */}
        {notDoneFor ? <Button type="button" size="sm" variant="outline" onClick={() => onNotDone!(notDoneFor.date)} data-testid="round-not-done"><CircleSlash />Ej utfört</Button> : null}
        <div className="flex shrink-0 items-center gap-2">
        {/* Driftrond i arbetsordern (2026-10-27): the round's work orders – the ones holding it for a period (and 0.24.0's per day). */}
        <Button asChild size="icon" variant="ghost" aria-label={`Arbetsordrar för ${schedule.title}`} title="Rondens arbetsordrar"><Link href={`/?view=work_orders&round=${encodeURIComponent(schedule.id)}`} data-testid="round-work-orders"><ClipboardList /></Link></Button>
        {labels ? <Button asChild size="icon" variant="ghost" aria-label={`QR-etiketter för ${schedule.title}`} title="QR-etiketter"><Link href={labels} data-testid="round-labels"><QrCode /></Link></Button> : <span aria-hidden="true" className="size-8 shrink-0" data-testid="round-labels-place" />}
        {canPlan ? <IconButton label={`Ändra ${schedule.title}`} onClick={onEdit}><Pencil /></IconButton> : null}
        {canPlan ? <RemoveButton label={`Ta bort ${schedule.title}`} onClick={onRemove} /> : null}
        </div>
      </div>
    </div>
    {schedule.overview.history.length || schedule.overview.upcoming.length ? <ol className="mt-3 flex flex-wrap gap-1.5" aria-label={`Tillfällen för ${schedule.title}`}>
      {[...schedule.overview.history.slice(0, 10).reverse(), ...(today ? [today] : []), ...schedule.overview.upcoming.slice(0, 3)].map((occurrence) => {
        const state = chipState(occurrence);
        const Icon = state.icon;
        const content = <><Icon className="size-3" />{occurrenceChipDate(occurrence.date, todayKey)}</>;
        // An utgått day opens its protocol (read-only); a starting link only ever continues a protocol that is going.
        const opened = occurrence.taskId ?? occurrence.cancelledTaskId;
        const chip = cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", indicatorBadge(state.tone));
        // A missed day without a protocol can be marked Ej utfört from its chip (2026-10-28).
        const markable = onNotDone && schedule.active && occurrence.state === "missed";
        const hint = occurrence.notDone ? notDoneLine(occurrence.notDone) : state.label;
        return <li key={occurrence.date}>{opened
          ? <Link href={roundHref(schedule, { date: occurrence.date, taskId: opened })} className={cn(chip, "hover:underline")} title={`${state.label} – öppna protokollet`}>{content}<span className="sr-only">{state.label}</span></Link>
          : markable ? <button type="button" className={cn(chip, "hover:underline")} title={`${state.label} – markera Ej utfört`} onClick={() => onNotDone!(occurrence.date)} data-testid="round-chip-not-done">{content}<span className="sr-only">{state.label}, markera Ej utfört</span></button>
          : <span className={chip} title={hint}>{content}<span className="sr-only">{hint}</span></span>}</li>;
      })}
    </ol> : null}
    {notDoneItems.length ? <ul className="mt-2 space-y-1" aria-label={`Ej utförda tillfällen för ${schedule.title}`} data-testid="round-not-done-history">
      {notDoneItems.map((item) => <li key={item.id} className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span className="min-w-0 break-words"><span className="font-medium text-foreground">{occurrenceChipDate(item.date, todayKey)}</span> · {notDoneLine(item)}</span>
        {onRevokeNotDone ? <button type="button" className="underline underline-offset-4 hover:text-foreground" onClick={() => onRevokeNotDone(item.id)} data-testid="round-not-done-revoke">Ångra</button> : null}
      </li>)}
    </ul> : null}
  </li>;
}

/** The round editor's cards (2026-10-30); the test ids are the old framed parts', so the tests still find them. */
const ROUND_SECTIONS = {
  ronden: { title: "Ronden", icon: FileText, testId: undefined },
  "hur-ofta": { title: "Hur ofta", icon: CalendarClock, testId: "round-how-often" },
  paminnelser: { title: "Påminnelser", icon: Bell, testId: "round-reminders" },
} as const;

/**
 * Plans or changes a round: the form, its name, who is responsible and how often (2026-10-27 kväll: "Ronden är framför
 * allt tidsreglerna som ställs in – kund och plats hänger med från arbetsordern"). No customer, place, temporary place or
 * project: they are the work order's that holds the round. "Hur ofta" is RoundRuleFields.
 */
export function ScheduleDialog({ schedule, initial, heading, backend, onClose, onSaved, screen = false, start, notice = null, labels = null, onRemove, page = false, planOthers, notDone }: { schedule: ScheduleView | null;
  /** The form's fields and actions only, inside a FormPage (the Driftronder page's Ny rond / Ändra rond, plan 1O). */
  page?: boolean;
  /** false: the person plans only their own rounds (outside the projects they are responsible for); a line says so. */
  planOthers?: boolean;
  /** Nivå 1 på mobil: drawn as a screen of its own with Avbryt and Spara in the top bar instead of a view. */
  screen?: boolean;
  /** Level 1, the round's own screen: the way to start or continue it, and Ta bort (which asks first) at the foot. */
  start?: { label: string; href: string }; onRemove?: () => void;
  /** Level 1, the round's own screen: Ej utfört for the occurrence to do now (2026-10-28, Cloud). */
  notDone?: { date: string; onClick: () => void };
  /** Level 1, the round's own screen: why the round cannot be started (its form is not published), in Starta's place. */
  notice?: string | null;
  /** Level 1, the round's own screen: its QR label sheet (2026-10-23), beside the way to start it. */
  labels?: string | null;
  /** A new round already filled in – "Upprepa kontrollen" from a completed protocol (2026-10-06). */
  initial?: FormScheduleInput; heading?: string; backend: RoundsBackend; onClose: () => void; onSaved: () => void }) {
  const [forms, setForms] = useState<PublishedForm[]>([]);
  const [members, setMembers] = useState<Option[]>(backend.members ?? []);
  const today = useMemo(() => swedishDayKey(new Date()), []);
  const [draft, setDraft] = useState<FormScheduleInput>(() => schedule
    ? { id: schedule.id, version: schedule.version, title: schedule.title, templateId: schedule.templateId, assignedToUserId: schedule.assignedToUserId, assignedToName: schedule.assignedToName, active: schedule.active, rule: schedule.rule, reminders: schedule.reminders }
    : initial ? { ...initial } : { title: "", templateId: "", assignedToUserId: null, assignedToName: "", active: true, rule: { frequency: "DAILY", interval: 1, weekdays: [], startDate: today, endDate: "" }, reminders: { ...defaultScheduleReminders } });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ forms: PublishedForm[] }>("/api/forms").then((result) => setForms(result.forms)).catch(() => setForms([]));
    if (!backend.members) api<{ members?: Option[] }>("/api/workflow-tasks?members=only").then((result) => setMembers(result.members ?? [])).catch(() => undefined);
  }, [backend.members]);
  const save = async () => {
    // The form first: without it the schema's own (English) message must never reach the person (R2-KTR-04).
    if (!draft.templateId) { setError("Välj formulär."); return; }
    const parsed = formScheduleInputSchema.safeParse({ ...draft, title: draft.title.trim() || forms.find((form) => form.id === draft.templateId)?.name || "" });
    if (!parsed.success) { setError("Kontrollera uppgifterna: namn, datum och tider."); return; }
    setBusy(true); setError("");
    try { await backend.save(parsed.data, forms.find((form) => form.id === parsed.data.templateId)?.name ?? ""); announce("Rond sparad"); onSaved(); } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  };
  // Labels above their fields, one rule for the whole dialog (2026-09-30: "Frekvens" stood beside its field).
  const label = "grid content-start gap-1.5 text-xs font-medium text-muted-foreground";
  const reminders = draft.reminders ?? defaultScheduleReminders;
  const title = heading ?? (schedule ? "Ändra rond" : "Ny rond");
  useNativeTopBar(screen ? { title, cancel: { onClick: onClose }, save: { busy, onClick: () => void save() } } : null);
  // Separate cards like every other edit page (2026-10-30: "Ny driftrond lägger allt i ett stort kort"): Ronden, Hur
  // ofta and Påminnelser, each a FormPanel with its icon. The app look (level 1) keeps its one group with framed parts.
  const native = useNativeMode() || screen;
  const section = (key: keyof typeof ROUND_SECTIONS, children: ReactNode) => {
    const { title: sectionTitle, icon, testId } = ROUND_SECTIONS[key];
    if (!native) return <FormPanel title={sectionTitle} icon={icon} testId={testId}><div className="grid gap-4 sm:grid-cols-2">{children}</div></FormPanel>;
    if (!testId) return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
    return <fieldset className="field-group grid gap-4 rounded-lg border p-4" data-testid={testId}><legend className="px-1 text-xs font-semibold">{sectionTitle}</legend>{children}</fieldset>;
  };
  const fields = <>
    <div className={native ? "grid gap-4" : "space-y-5"} data-testid="round-dialog">
      {section("ronden", <>
      <label className={cn(label, "sm:col-span-2")}>Formulär<select className="form-select" value={draft.templateId} onChange={(event) => setDraft({ ...draft, templateId: event.target.value, title: draft.title || forms.find((form) => form.id === event.target.value)?.name || "" })}><option value="">Välj formulär</option>{forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}</select></label>
      <label className={cn(label, "sm:col-span-2")}>Namn på ronden<Input value={draft.title} maxLength={200} placeholder="T.ex. Daglig tillsyn Forsen kraftstation" onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
      {/* No customer, place, temporary place or project on the round (2026-10-27 kväll): the work order that holds it brings them. */}
      <p className="text-xs text-muted-foreground sm:col-span-2" data-testid="round-place-note">{schedule?.holder ? `Kund och plats följer arbetsordern ${schedule.holder.title?.trim() || ""}: ${roundWhereLabel(schedule.holder) || "ingen plats vald"}.` : "Kund och plats följer arbetsordern som håller ronden."}</p>
      <label className={label}>Ansvarig (valfritt)<select className="form-select" value={draft.assignedToUserId ?? ""} onChange={(event) => { const member = members.find((item) => item.id === event.target.value); setDraft({ ...draft, assignedToUserId: member?.id ?? null, assignedToName: member?.name ?? "" }); }}><option value="">Ingen</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select>{planOthers === false ? <span className="font-normal" data-testid="round-own-only">Du planerar ronder åt dig själv. Ronder åt andra planeras av en administratör eller projektansvarig.</span> : null}</label>
      </>)}
      {section("hur-ofta", <div className="grid gap-4 sm:col-span-2">
        <RoundRuleFields rule={draft.rule} today={today} onChange={(rule) => setDraft((current) => ({ ...current, rule }))}
          holder={schedule?.holder && !schedule.holder.occurrence ? schedule.holder : null} />
      </div>)}
      {/* Reminders (2026-09-30): the bell in the top bar, and an e-mail, to the responsible person – or the admins.
          Aktiv stands first: a paused round sends none. */}
      {section("paminnelser", <div className="grid gap-2 sm:col-span-2">
        <label className="inline-flex items-center gap-2 text-sm touch:min-h-11"><input type="checkbox" className="size-4" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />Aktiv</label>
        <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={reminders.bell} onChange={(event) => setDraft({ ...draft, reminders: { ...reminders, bell: event.target.checked } })} />Notis i klockan när ronden ska göras och om den missas</label>
        <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={reminders.email} onChange={(event) => setDraft({ ...draft, reminders: { ...reminders, email: event.target.checked } })} />E-post samma morgon som ronden ska göras</label>
        <p className="text-xs text-muted-foreground">Går till {draft.assignedToName || "företagets administratörer, eftersom ingen ansvarig är vald"}.</p>
      </div>)}
    </div>
    {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
  </>;
  if (screen) return <div className="native-page native-screen pb-4" data-testid="native-round-form">
    {start || labels || notice || notDone ? <ListGroup testId="native-round-start">
      {notice ? <RoundFormNoticeRow notice={notice} /> : null}
      {start ? <ListRow type="round" icon={Play} title={start.label} href={start.href} testId="round-start" /> : null}
      {notDone ? <RoundNotDoneRow {...notDone} /> : null}
      {labels ? <RoundLabelsRow href={labels} /> : null}
    </ListGroup> : <div className="h-3" aria-hidden="true" />}
    <div className="native-group p-4">{fields}</div>
    {onRemove ? <NativeActions><Button type="button" variant="ghost" className="text-destructive" onClick={onRemove} data-testid="round-remove"><Trash2 />Ta bort ronden</Button></NativeActions> : null}
  </div>;
  const body = <>
    {fields}
    <DialogActions className="mt-5" cancel={{ onClick: onClose }} primary={{ label: "Spara rond", busy, busyLabel: "Sparar…", onClick: () => void save() }} />
  </>;
  if (page) return body;
  // "Upprepa kontrollen" on a finished protocol opens it as a dialog over the protocol (the protocol cannot be left half-way).
  // Larger than the popup ceiling (Popupstorlek, 2026-10-13): a page over the protocol on displays 2 and 3 (the
  // protocol stays mounted under it), a screen at level 1.
  return <DialogPage pageKey="upprepa" size="page" panelTitle={false} open onOpenChange={(open) => { if (!open) onClose(); }} title={title}>{body}</DialogPage>;
}
