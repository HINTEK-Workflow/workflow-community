"use client";

import { WORK_LIST_SCOPE_LABEL } from "@/lib/workflow/work-list";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Archive, CalendarClock, Camera, CheckCircle2, ExternalLink, FileSearch, Pencil, Plus, RotateCcw, Send, UserRound, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListCard, ListCardGrid, ListFilterBar, useListPrefs } from "@/components/list-filter-bar";
import { listSortOptions } from "@/lib/list-filter";
import { DEVIATION_SORTS, sortDeviations } from "@/lib/self-inspection/deviation-list";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogActions, Empty, Field } from "@/features/kfid/ui";
import { DialogPage } from "@/features/kfid/dialog-page";
import { CommentThread } from "@/features/workflow/comment-thread";
import { ListEmpty, ListFact, ListGroup, ListRow, NativeActions, NativePage, NativePickerRow, NativeSegmented } from "@/components/native";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { indicatorBadge, PILL_FIXED_WIDTH } from "@/features/workflow/indicator-tone";
import { usePageTrail } from "@/components/page-shell";
import { useAddressEntryState } from "@/components/use-address-filter";
import { allowedFilter } from "@/lib/url-filters";
import { swedishDayKey } from "@/lib/swedish-time";
import { cn } from "@/lib/utils";
import { announce } from "@/lib/workflow/toast";
import {
  DEVIATION_CATEGORIES, DEVIATION_FILTER_LABEL, DEVIATION_FILTERS, DEVIATION_KINDS, DEVIATION_STATUSES, DEVIATION_TYPE_FILTER_LABEL, DEVIATION_TYPE_FILTERS, DEVIATION_TYPES, DEVIATION_SCOPES, DEVIATION_STATUS_FILTERS, deviationInScope, deviationSearchMatches, type DeviationScope,
  ELECTRICAL_ACCIDENT_REPORT_URL, SERIOUS_NOTICE, REPORTABLE_GUIDE_URL, REPORTABLE_HINT, REPORTABLE_LABEL, deviationSeverity, DEFAULT_DEVIATION_SEVERITY, DEVIATION_SEVERITIES, type DeviationSeverity, WORK_INJURY_REPORT_URL, awaitsAuthorityReport, deviationCloseRefusal, deviationMatches, deviationTypeMatches, isIncidentType,
  type DeviationFilter, type DeviationType, type DeviationTypeFilter, type DeviationView, type SelfInspectionAction, type SelfInspectionView,
} from "@/lib/self-inspection/model";
import { closedInvestigation } from "@/lib/self-inspection/incidents";
import { DEVIATION_RETENTION_HOLD_HINT, DEVIATION_RETENTION_TEXT, DEVIATION_RETENTION_WARNING_DAYS, deviationRetentionLine } from "@/lib/self-inspection/retention";
import { createOrderRefusal, deviationClosedText, deviationHref, deviationOrderHref, deviationOrderText, orderStatusLabel } from "@/lib/self-inspection/deviation-link";
import { siDate, type Run } from "./shared";
import { PhotoPicker, PhotoStrip, type DeviationPhotosApi } from "./deviation-photos";
import { browserDeviationExporter, DeviationEntryExport, DeviationListExport, type DeviationExporter } from "./deviation-export-menu";
import { deviationEntryLabel } from "@/lib/self-inspection/deviation-export";
import { DeviationTypeIcon, ICON_ON_TINT, deviationLook, severityOf } from "./deviation-look";

/**
 * Avvikelser (2026-10-30): the company's deviation log as a page of its own – Egenkontroll, Riskobservation, Tillbud
 * and Olycksfall in one list with a type filter. Reporting asks rubrik, beskrivning and photos first and the type further
 * down (no type chosen in advance; from a protocol row it is Egenkontroll); a near miss or an accident asks when, what and
 * why, and whether it is serious, injured someone or concerns electricity. Only drawing here – the backend decides who sees
 * and may do what (lib/self-inspection/incidents.ts).
 */
type DeviationDraft = { id?: string; kind: keyof typeof DEVIATION_KINDS; type: DeviationType | ""; title: string; description: string; category: keyof typeof DEVIATION_CATEGORIES; systematic: boolean;
  status: keyof typeof DEVIATION_STATUSES; action: string; responsibleId: string | null; dueDate: string; followUp: string;
  occurredAt: string; whatHappened: string; cause: string; serious: boolean; personalInjury: boolean; electrical: boolean; severity: DeviationSeverity };
// Öppen is grey since the severity scale (2026-10-30): an amber Öppen read as the amber Normal beside it.
const statusTone = (status: DeviationView["status"]) => status === "DONE" ? "success" : status === "IN_PROGRESS" ? "info" : "neutral";
/** A work order's status as a pill: finished green, cancelled grey, waiting amber, otherwise blue. */
const orderTone = (status: string) => status === "COMPLETED" ? "success" as const : status === "CANCELLED" || status === "PLANNED" ? "neutral" as const : status === "NEEDS_ACTION" ? "danger" as const : "info" as const;
const date = siDate;
const DEVIATION_SORT_OPTIONS = listSortOptions(DEVIATION_SORTS);
const typeOf = (item: { type?: DeviationType }) => item.type ?? "SELF_INSPECTION";
/** "Tillbud 4", "Avvikelse 2" (an Elinstallation entry keeps its kind's name), "Förbättring 3" – the export's own label (lib/self-inspection/deviation-export.ts). */
export const entryLabel = (item: Pick<DeviationView, "kind" | "number"> & { type?: DeviationType }) => deviationEntryLabel(item);
/** Förenkling 0.77.0 (kvar-till-2026-12-31 F): the log mixes four types from four ways in, so the page says where they come from. */
export const DEVIATION_SOURCES_SENTENCE = "Hit kommer brister från protokoll och ronder, maskinlarm, operatörernas felanmälningar och det ni rapporterar själva.";

/** ISO time ↔ the value of a datetime-local field (local time, minutes). */
const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
};
const fromLocalInput = (value: string) => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toISOString() : null;
const whenText = (iso: string) => new Date(iso).toLocaleString("sv-SE", { dateStyle: "medium", timeStyle: "short" });
/** "26 okt. 19:06" – a row's short date and time. */
const shortWhen = (iso: string) => new Date(iso).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
/** Anmälningspliktig · Personskada · Gäller el – the marks the reporter set. */
const marksOf = (item: DeviationView) => [item.serious ? REPORTABLE_LABEL : "", item.personalInjury ? "Personskada" : "", item.electrical ? "Gäller el" : ""].filter(Boolean).join(" · ");

const blank = (kind: DeviationDraft["kind"], type: DeviationDraft["type"] = ""): DeviationDraft => ({ kind, type, title: "", description: "", category: "ROUTINE", systematic: false, status: "OPEN", action: "",
  responsibleId: null, dueDate: "", followUp: "", occurredAt: "", whatHappened: "", cause: "", serious: false, personalInjury: false, electrical: false, severity: DEFAULT_DEVIATION_SEVERITY });
const draftOf = (item: DeviationView): DeviationDraft => ({ id: item.id, kind: item.kind, type: typeOf(item), title: item.title, description: item.description, category: item.category, systematic: item.systematic,
  status: item.status, action: item.action, responsibleId: item.responsibleId, dueDate: item.dueDate, followUp: item.followUp, occurredAt: toLocalInput(item.occurredAt), whatHappened: item.whatHappened ?? "",
  cause: item.cause ?? "", serious: Boolean(item.serious), personalInjury: Boolean(item.personalInjury), electrical: Boolean(item.electrical), severity: deviationSeverity(item.severity) });
/** The draft as the action sends it; the incident fields only for a near miss or an accident. */
function deviationInput(draft: DeviationDraft) {
  const type = (draft.type || "SELF_INSPECTION") as DeviationType;
  const incident = isIncidentType(type);
  return { ...(draft.id ? { id: draft.id } : {}), kind: draft.kind, type, title: draft.title, description: draft.description, category: draft.category, systematic: type === "SELF_INSPECTION" && draft.systematic,
    status: draft.status, action: draft.action, responsibleId: draft.responsibleId, dueDate: draft.dueDate as "", followUp: draft.followUp,
    occurredAt: incident ? fromLocalInput(draft.occurredAt) : null, whatHappened: incident ? draft.whatHappened : "", cause: incident ? draft.cause : "",
    serious: incident && draft.serious, personalInjury: incident && draft.personalInjury, electrical: incident && draft.electrical,
    ...(draft.kind === "IMPROVEMENT" ? {} : { severity: draft.severity }) };
}

/** `&new=` opens Rapportera avvikelse at once: `1` with no type chosen, `tillbud` as a near miss (Rapportera tillbud). */
export const newDeviationType = (value: string | null): DeviationDraft["type"] | null => value === "1" ? "" : value === "tillbud" ? "NEAR_MISS" : null;

export function DeviationsTab({ view, busy, run, reload, photos, comments = false, native = false, focusId = null, createWorkOrder, startNew = null, exporter, header }: { view: SelfInspectionView; busy: boolean; run: Run; reload: () => Promise<void>;
  /** Photos (Cloud): shown and taken only when the backend keeps them. */ photos?: DeviationPhotosApi;
  /** Kommentarer (Cloud): the entry's thread. Local has one user. */ comments?: boolean;
  /** Level 1 on a phone: rows instead of cards. */ native?: boolean;
  /** The entry `&deviation=` points out – marked in the list, its own screen at level 1. */ focusId?: string | null;
  /** Skapa arbetsorder on an entry without one (the backend decides who may). */ createWorkOrder?: (deviationId: string) => Promise<void>;
  /** `&new=`: open Rapportera avvikelse at once (newDeviationType). */ startNew?: DeviationDraft["type"] | null;
  /** Exportera (2026-10-30): where the PDF or CSV is made; without one it is drawn in the browser. */ exporter?: DeviationExporter;
  /** The page's header with the log's actions (Exportera, Ny förbättring, Rapportera avvikelse last) – the page template's place. */ header?: (actions: ReactNode, heading?: { title: string; description: string }) => ReactNode }) {
  const photoApi = view.photos ? photos : undefined;
  const exportFile = useMemo(() => exporter ?? browserDeviationExporter(view.company, photoApi), [exporter, view.company, photoApi]);
  const focusIndex = focusId ? view.deviations.findIndex((item) => item.id === focusId) : -1;
  const focused = focusIndex >= 0 ? view.deviations[focusIndex] : null;
  // Öppna · Förfallna · Mina · Alla, and the type (`&filter=`, `&type=`); the entry a link points out is always in the list.
  const [filter, setFilter] = useAddressEntryState<DeviationFilter>("deviations.filter", "filter", (raw) => allowedFilter(raw, DEVIATION_FILTERS), focused?.status === "DONE" ? "all" : "open");
  const [typeFilter, setTypeFilter] = useAddressEntryState<DeviationTypeFilter>("deviations.type", "type", (raw) => allowedFilter(raw, DEVIATION_TYPE_FILTERS), "any");
  const [scopeChoice, setScopeChoice] = useAddressEntryState<DeviationScope>("deviations.scope", "scope", (raw) => allowedFilter(raw, DEVIATION_SCOPES), "all");
  const [query, setQuery] = useState("");
  // Mina | Alla beside the status (2026-10-31); the old "mine" filter is Mina + Öppna.
  const scopeValue: DeviationScope = filter === "mine" ? "mine" : scopeChoice;
  const status: DeviationFilter = filter === "mine" ? "open" : filter;
  const chooseScope = (value: DeviationScope) => { if (filter === "mine") setFilter("open"); setScopeChoice(value); };
  const chooseStatus = (value: DeviationFilter) => { if (filter === "mine") setScopeChoice("mine"); setFilter(value); };
  const [draft, setDraft] = useState<DeviationDraft | null>(() => startNew !== null ? blank("DEVIATION", startNew) : null);
  const [newPhotos, setNewPhotos] = useState<File[]>([]);
  const [investigating, setInvestigating] = useState<DeviationView | null>(null);
  const [closing, setClosing] = useState<DeviationView | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  // The marker `&new=` leaves the address when the form it opened is closed or saved – never while the form opens (mobilresan
  // 2026-11-18): the form's back guard has just put its own history entry on top, and rewriting that entry's address made the
  // page draw itself anew without the form, and left a step so that ‹ needed two presses. A moment after closing, once the
  // guard has stepped off its entry, the page's own address loses the marker, so a reload or Bakåt does not open it again.
  const router = useRouter();
  const openedFromAddress = useRef(startNew !== null);
  useEffect(() => {
    if (draft || !openedFromAddress.current) return;
    openedFromAddress.current = false;
    const timer = window.setTimeout(() => {
      const url = new URL(window.location.href);
      if (!url.searchParams.has("new")) return;
      url.searchParams.delete("new");
      router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draft, router]);
  const [shown, setShown] = useState(Math.max(20, focusIndex + 1));
  const today = swedishDayKey(new Date());
  const isLate = (item: DeviationView) => Boolean(item.dueDate) && item.status !== "DONE" && item.dueDate < today;
  // The opened entry names itself in the trail: Översikt › Avvikelser › Tillbud 3.
  usePageTrail(focused ? { deviation: entryLabel(focused) } : {}, focused ? { deviation: focused.id } : {});
  // Antal per val i filterraden (as the work lists' chips): each count respects the other choice.
  const matches = (item: DeviationView, choice: { status?: DeviationFilter; type?: DeviationTypeFilter }) => deviationInScope(item, scopeValue, view.me.id)
    && deviationMatches(item, choice.status ?? status, { meId: view.me.id, today }) && deviationTypeMatches(item, choice.type ?? typeFilter) && deviationSearchMatches(item, query);
  const statusCounts = Object.fromEntries(DEVIATION_STATUS_FILTERS.map((key) => [key, view.deviations.filter((item) => matches(item, { status: key })).length])) as Record<DeviationFilter, number>;
  const typeCounts = Object.fromEntries(DEVIATION_TYPE_FILTERS.map((key) => [key, view.deviations.filter((item) => matches(item, { type: key })).length])) as Record<DeviationTypeFilter, number>;
  // The sort (toppvisningen, 2026-10-31), remembered per person on the device; Nummer keeps the old order.
  const prefs = useListPrefs("deviations", view.me.id, { sorts: DEVIATION_SORTS });
  const items = sortDeviations(view.deviations.filter((item) => item.id === focusId || matches(item, {})), prefs.sort);
  const scope = [scopeValue === "mine" ? "Mina" : "", DEVIATION_FILTER_LABEL[status], DEVIATION_TYPE_FILTER_LABEL[typeFilter], query.trim() && `"${query.trim()}"`].filter(Boolean).join(" · ");
  const listExport = <DeviationListExport entries={items} scope={scope} photos={Boolean(photoApi)} exporter={exportFile} disabled={busy} />;
  const entryExport = (item: DeviationView, size?: "sm") => <DeviationEntryExport entry={item} photos={Boolean(photoApi)} exporter={exportFile} size={size} />;
  const emptyText = query.trim() || scopeValue === "mine" ? "Inget matchar urvalet" : status === "open" && typeFilter === "any" ? "Inga öppna avvikelser" : status === "all" && typeFilter === "any" ? "Inga avvikelser" : "Inget matchar urvalet";

  const sendPhotos = async (deviationId: string, phase: "BEFORE" | "AFTER", files: File[]) => {
    if (!photoApi || !files.length) return;
    let failed = 0;
    for (const file of files) { try { await photoApi.upload(deviationId, phase, file); } catch { failed += 1; } }
    if (failed) announce(failed === files.length ? "Bilderna kunde inte sparas." : `${failed} av ${files.length} bilder kunde inte sparas.`, true);
    await reload();
  };
  const startReport = (type: DeviationDraft["type"], withCamera = false) => {
    setNewPhotos([]);
    setDraft(blank("DEVIATION", type));
    // Rapportera tillbud on a phone opens the camera at once (2026-10-30), in the same tap.
    if (withCamera) camera.current?.click();
  };
  const save = async (value: DeviationDraft) => {
    const next = await run({ action: "save_deviation", deviation: deviationInput(value) } as SelfInspectionAction,
      value.id ? "Avvikelsen är uppdaterad." : value.kind === "IMPROVEMENT" ? "Förbättringen är tillagd." : "Avvikelsen är rapporterad.");
    if (!next) return false;
    if (!value.id && next.createdDeviationId && newPhotos.length) await sendPhotos(next.createdDeviationId, "BEFORE", newPhotos);
    setNewPhotos([]);
    return true;
  };
  const removePhoto = async (photoId: string) => {
    if (!photoApi) return;
    try { await photoApi.remove(photoId); await reload(); } catch (cause) { announce((cause as Error).message, true); }
  };
  const reopen = (item: DeviationView) => void run({ action: "reopen_deviation", id: item.id }, "Avvikelsen är öppen igen.");
  const reported = (item: DeviationView) => void run({ action: "mark_reported_to_authority", id: item.id }, "Markerad som anmäld.");
  // Lagringstid (2026-11-04, lib/self-inspection/retention.ts): only where it applies (Cloud) and on an entry that is closed.
  const hold = (item: DeviationView) => void run({ action: "set_deviation_hold", id: item.id, hold: !item.retentionHoldAt }, item.retentionHoldAt ? "Avvikelsen följer lagringstiden igen." : "Avvikelsen sparas tills vidare.");
  const retentionNote = (item: DeviationView) => {
    const line = view.deviationRetention ? deviationRetentionLine(item) : null;
    return line ? <p className={cn("text-sm", line.warning ? "notice" : "text-muted-foreground")} data-testid="deviation-retention-line">{line.text}{!item.retentionHoldAt && item.canHandle ? ` ${DEVIATION_RETENTION_HOLD_HINT}` : ""}</p> : null;
  };

  const dialogs = <>
    {draft && <DeviationDialog draft={draft} view={view} busy={busy} photos={!draft.id && photoApi ? { files: newPhotos, onChange: setNewPhotos, cameraRef: camera } : undefined}
      onClose={() => { setDraft(null); setNewPhotos([]); }} onSave={save} />}
    {investigating && <InvestigationDialog entry={investigating} busy={busy} onClose={() => setInvestigating(null)}
      onSave={(input) => run({ action: "save_investigation", id: investigating.id, ...input }, "Utredningen är sparad.").then(Boolean)} />}
    {closing && <MarkDoneDialog entry={closing} busy={busy} photos={Boolean(photoApi)} onClose={() => setClosing(null)}
      onDone={async (doneNote, files, investigation) => {
        const next = await run({ action: "mark_deviation_done", id: closing.id, doneNote, ...(investigation ? { investigation } : {}) }, "Avvikelsen är klar.");
        if (!next) return false;
        await sendPhotos(closing.id, "AFTER", files);
        return true;
      }} />}
    {/* The camera of Rapportera tillbud, outside the form so the same tap can open it. */}
    {photoApi ? <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-label="Ta foto"
      onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) setNewPhotos((current) => [...current, ...files]); }} /> : null}
  </>;
  const canCreate = (item: DeviationView) => Boolean(createWorkOrder && view.canCreateWorkOrder) && !createOrderRefusal(item, true);
  const sourceHref = (source: NonNullable<DeviationView["source"]>) => `/?view=workflow_task&taskId=${encodeURIComponent(source.taskId)}&taskType=FORM${source.rowId ? `&row=${encodeURIComponent(source.rowId)}` : ""}`;
  const handling = (item: DeviationView, ghost: boolean) => {
    const variant = ghost ? "ghost" as const : "outline" as const;
    const size = ghost ? undefined : "sm" as const;
    return <>
      {item.canHandle && item.status !== "DONE" ? <Button type="button" variant={variant} size={size} disabled={busy} onClick={() => setClosing(item)} data-testid="deviation-mark-done"><CheckCircle2 />Markera klar</Button> : null}
      {item.canHandle && item.status === "DONE" && !item.personalDataRemovedAt ? <Button type="button" variant={variant} size={size} disabled={busy} onClick={() => reopen(item)} data-testid="deviation-reopen"><RotateCcw />Öppna igen</Button> : null}
      {item.canHandle && item.status === "DONE" && view.deviationRetention ? <Button type="button" variant={variant} size={size} disabled={busy} onClick={() => hold(item)} data-testid="deviation-retention-hold"><Archive />{item.retentionHoldAt ? "Följ lagringstiden" : "Spara tills vidare"}</Button> : null}
      {item.canHandle && isIncidentType(item.type) && !view.canEdit && !item.personalDataRemovedAt ? <Button type="button" variant={variant} size={size} disabled={busy} onClick={() => setInvestigating(item)} data-testid="deviation-investigate"><FileSearch />Utredning</Button> : null}
      {canCreate(item) ? <Button type="button" variant={variant} size={size} disabled={busy} onClick={() => void createWorkOrder!(item.id)} data-testid="self-inspection-deviation-create-order"><ClipboardList />Skapa arbetsorder</Button> : null}
      {view.canEdit && ghost && !item.personalDataRemovedAt ? <Button type="button" variant="ghost" onClick={() => { setNewPhotos([]); setDraft(draftOf(item)); }} data-testid="native-deviation-edit"><Pencil />Ändra</Button> : null}
    </>;
  };
  const hasHandling = (item: DeviationView) => Boolean(item.canHandle || canCreate(item) || view.canEdit);

  // Level 1: one entry is a screen of rows – its facts, the investigation, where it came from and what can be done.
  if (native && focused) return <NativePage testId="native-deviation">
    <ListGroup testId="native-deviation-facts">
      <ListFact label={entryLabel(focused)}>{focused.title}</ListFact>
      <ListRow title="Status" pill={{ label: DEVIATION_STATUSES[focused.status], tone: statusTone(focused.status) }} subtitle={deviationClosedText(focused) || undefined} testId="native-deviation-status" />
      <ListFact label="Typ">{deviationLook(focused).label}</ListFact>
      {severityOf(focused) ? <ListRow title="Allvarlighetsgrad" pill={{ label: severityOf(focused)!.label, tone: "neutral", className: severityOf(focused)!.badge }} testId="native-deviation-severity" /> : null}
      {focused.description ? <ListFact label="Beskrivning">{focused.description}</ListFact> : null}
      {focused.occurredAt ? <ListFact label="Hände">{whenText(focused.occurredAt)}</ListFact> : null}
      {focused.whatHappened ? <ListFact label="Vad hände">{focused.whatHappened}</ListFact> : null}
      {focused.cause ? <ListFact label="Varför">{focused.cause}</ListFact> : null}
      {focused.action ? <ListFact label="Åtgärd">{focused.action}</ListFact> : null}
      {focused.doneNote ? <ListFact label="Notering">{focused.doneNote}</ListFact> : null}
      {focused.responsibleName ? <ListFact label="Ansvarig">{focused.responsibleName}</ListFact> : null}
      {focused.dueDate ? <ListFact label="Klart senast">{`${date(focused.dueDate)}${focused.status !== "DONE" && focused.dueDate < today ? " · Förfallen" : ""}`}</ListFact> : null}
      <ListFact label="Rapporterad">{`${date(focused.createdAt)}${focused.reportedByName ? ` av ${focused.reportedByName}` : ""}`}</ListFact>
    </ListGroup>
    <IncidentNotice item={focused} busy={busy} onReported={() => reported(focused)} />
    {retentionNote(focused) ? <div className="px-1">{retentionNote(focused)}</div> : null}
    {photoApi ? <div className="px-1"><PhotoStrip photos={focused.attachments ?? []} api={photoApi} busy={busy} onRemove={(id) => void removePhoto(id)}
      canRemove={(photo) => Boolean(focused.canHandle) || photo.createdById === view.me.id} /></div> : null}
    {focused.source || focused.workOrder ? <ListGroup title="Kopplingar" testId="native-deviation-links">
      {focused.source ? <ListRow type="control" title={`Från ${focused.source.title || "protokollet"}`} subtitle="Öppna protokollet" href={sourceHref(focused.source)} testId="self-inspection-deviation-source" /> : null}
      {focused.workOrder ? focused.workOrder.readable
        ? <ListRow type="work-order" icon={ClipboardList} title={focused.workOrder.title || "(utan rubrik)"} subtitle="Arbetsorder" pill={{ label: orderStatusLabel(focused.workOrder.status), tone: orderTone(focused.workOrder.status) }} href={deviationOrderHref(focused.workOrder.id)} testId="self-inspection-deviation-order" twoLines />
        : <ListFact label="Arbetsorder" testId="self-inspection-deviation-order">Arbetsorder kopplad</ListFact> : null}
    </ListGroup> : null}
    {hasHandling(focused) ? <NativeActions title="Hantering" testId="native-deviation-actions">{handling(focused, true)}</NativeActions> : null}
    <NativeActions testId="native-deviation-export">{entryExport(focused)}</NativeActions>
    {comments ? <div className="px-1 pt-4"><CommentThread parentType="DEVIATION" parentId={focused.id} /></div> : null}
    {dialogs}
  </NativePage>;
  if (native) return <NativePage testId="native-deviations">
    <ListGroup footer={DEVIATION_SOURCES_SENTENCE} testId="native-deviations-sources">
      <ListRow type="risk" icon={Plus} title="Rapportera avvikelse" onClick={() => startReport("")} testId="native-deviation-new" />
      <ListRow type="risk" icon={photoApi ? Camera : Plus} title="Rapportera tillbud" onClick={() => startReport("NEAR_MISS", Boolean(photoApi))} testId="native-near-miss-new" />
      {view.canEdit ? <ListRow type="neutral" icon={Plus} title="Ny förbättring" onClick={() => { setNewPhotos([]); setDraft(blank("IMPROVEMENT")); }} /> : null}
    </ListGroup>
    <div className="space-y-3 pt-4">
      {/* Omfattning och status var för sig, som på datorn (TF9, 2026-11-01). */}
      <NativeSegmented label="Mina eller alla" value={scopeValue} onChange={chooseScope} options={DEVIATION_SCOPES.map((key) => [key, WORK_LIST_SCOPE_LABEL[key]] as const)} testId="native-deviations-scope" />
      <NativeSegmented label="Visa" value={status} onChange={chooseStatus} options={DEVIATION_STATUS_FILTERS.map((key) => [key, DEVIATION_FILTER_LABEL[key]] as const)} testId="native-deviations-filter" />
    </div>
    {/* Typ as the app's filter row (mobilresan 2026-11-18: a loose label and drop-down on the grey page), as Kunder's Filter. */}
    <ListGroup testId="native-deviations-type">
      <NativePickerRow label="Typ" display={`${DEVIATION_TYPE_FILTER_LABEL[typeFilter]} (${typeCounts[typeFilter]})`}>
        <select id="deviations-type-native" aria-label="Typ" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as DeviationTypeFilter)}>
          {DEVIATION_TYPE_FILTERS.map((key) => <option key={key} value={key}>{`${DEVIATION_TYPE_FILTER_LABEL[key]} (${typeCounts[key]})`}</option>)}
        </select>
      </NativePickerRow>
    </ListGroup>
    <ListGroup testId="self-inspection-deviations">
      {/* Level 1 (2026-10-30): the type's icon, the heading, severity as the pill and the row's tint, status and date in the line. */}
      {items.length ? items.slice(0, shown).map((item) => { const severity = severityOf(item); const look = deviationLook(item); return <ListRow key={item.id} type={look.area} icon={look.icon} title={item.title} twoLines
        subtitle={[entryLabel(item), DEVIATION_STATUSES[item.status], shortWhen(item.occurredAt ?? item.createdAt), isLate(item) ? "Förfallen" : ""].filter(Boolean).join(" · ")}
        iconClassName={severity ? ICON_ON_TINT : undefined} className={severity?.surface} pill={severity ? { label: severity.label, tone: "neutral", className: cn(PILL_FIXED_WIDTH, severity.badge) } : null} href={deviationHref(item.id)} />; })
        : <ListEmpty>{emptyText}.</ListEmpty>}
      {items.length > shown ? <ListRow title={<span className="text-primary">Visa fler</span>} chevron={false} onClick={() => setShown((count) => count + 20)} /> : null}
    </ListGroup>
    <NativeActions testId="native-deviations-export">{listExport}</NativeActions>
    {dialogs}
  </NativePage>;
  // The computer: one entry opened (`&deviation=`) is the whole entry with its actions; editing (Ändra) is there, top right.
  if (focused) {
    const severity = severityOf(focused);
    const late = isLate(focused);
    const closed = deviationClosedText(focused);
    const facts: [string, string][] = [
      ["Typ", `${deviationLook(focused).label}${typeOf(focused) === "SELF_INSPECTION" && focused.kind !== "IMPROVEMENT" ? ` · ${DEVIATION_CATEGORIES[focused.category]}` : ""}${focused.systematic ? " · systematiskt" : ""}`],
      ...(focused.occurredAt ? [["Hände", whenText(focused.occurredAt)] as [string, string]] : []),
      ["Rapporterad", `${whenText(focused.createdAt)}${focused.reportedByName ? ` av ${focused.reportedByName}` : ""}`],
      ["Ansvarig", focused.responsibleName || "Ingen vald"],
      ["Klart senast", focused.dueDate ? `${date(focused.dueDate)}${late ? " · Förfallen" : ""}` : "Inget datum"],
      ...(marksOf(focused) ? [["Markeringar", marksOf(focused)] as [string, string]] : []),
      ...(closed ? [["Åtgärdad", closed.replace(/^Åtgärdad /, "")] as [string, string]] : []),
    ];
    const texts: [string, string | undefined][] = [["Beskrivning", focused.description], ["Vad hände", focused.whatHappened], ["Varför", focused.cause], ["Åtgärd", focused.action], ["Uppföljning", focused.followUp], ["Notering", focused.doneNote]];
    const detailActions = <>
      {entryExport(focused)}
      {view.canEdit && !focused.personalDataRemovedAt ? <Button variant="outline" onClick={() => { setNewPhotos([]); setDraft(draftOf(focused)); }} data-testid="deviation-edit"><Pencil />Ändra</Button> : null}
    </>;
    return <>{header ? header(detailActions, { title: focused.title, description: entryLabel(focused) }) : null}
      <article id={`deviation-${focused.id}`} data-focused="" className="space-y-4 rounded-xl border bg-card p-4" data-testid="deviation-detail">
        <div className="flex flex-wrap items-center gap-2">
          <DeviationTypeIcon item={focused} />
          <span className="text-sm font-medium">{entryLabel(focused)}</span>
          {severity ? <span className={cn("rounded-full border px-2.5 py-0.5 text-xs", severity.badge)} data-testid="deviation-severity">{severity.label}</span> : null}
          <span className={cn("rounded-full border px-2.5 py-0.5 text-xs", indicatorBadge(statusTone(focused.status)))}>{DEVIATION_STATUSES[focused.status]}</span>
        </div>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-3">{facts.map(([label, value]) => <div key={label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{label}</dt><dd className={cn("break-words", label === "Klart senast" && late && "font-medium text-danger")}>{value}</dd></div>)}</dl>
        {texts.filter(([, value]) => value?.trim()).map(([label, value]) => <div key={label}>
          <p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-0.5 whitespace-pre-line break-words text-sm">{value}</p></div>)}
        <IncidentNotice item={focused} busy={busy} onReported={() => reported(focused)} />
        {retentionNote(focused)}
        {photoApi ? <PhotoStrip photos={focused.attachments ?? []} api={photoApi} busy={busy} onRemove={(id) => void removePhoto(id)} canRemove={(photo) => Boolean(focused.canHandle) || photo.createdById === view.me.id} /> : null}
        {/* A deviation taken from a protocol row leads back to it, and to the work order that fixes it. */}
        {focused.source || focused.workOrder ? <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {focused.source ? <Link className="text-primary underline underline-offset-2" data-testid="self-inspection-deviation-source" href={sourceHref(focused.source)}>Från {focused.source.title || "protokollet"}</Link> : null}
          {focused.workOrder ? focused.workOrder.readable
            ? <Link className="inline-flex items-center gap-1.5 text-primary underline underline-offset-2" data-testid="self-inspection-deviation-order" href={deviationOrderHref(focused.workOrder.id)}><ClipboardList className="size-4 shrink-0" aria-hidden="true" />{deviationOrderText(focused.workOrder)}</Link>
            : <span className="inline-flex items-center gap-1.5 text-muted-foreground" data-testid="self-inspection-deviation-order"><ClipboardList className="size-4 shrink-0" aria-hidden="true" />{deviationOrderText(focused.workOrder)}</span> : null}
        </p> : null}
        {focused.canHandle || canCreate(focused) ? <div className="flex flex-wrap gap-2" data-testid="deviation-actions">{handling(focused, false)}</div> : null}
      </article>
      {comments && !focused.personalDataRemovedAt ? <div className="mt-6"><CommentThread parentType="DEVIATION" parentId={focused.id} /></div> : null}
      {dialogs}
    </>;
  }
  const actions = <>
    {listExport}
    {view.canEdit && <Button variant="outline" onClick={() => { setNewPhotos([]); setDraft(blank("IMPROVEMENT")); }}><Plus />Ny förbättring</Button>}
    <Button onClick={() => startReport("")} data-testid="deviation-new"><Plus />Rapportera avvikelse</Button>
  </>;
  return <>{header ? header(actions) : null}<div className="space-y-5">
    {/* Den gemensamma toppvisningen (2026-10-31, components/list-filter-bar.tsx): Mina | Alla and the status chips,
        then the search, Typ as the extra filter, the sort and Rader | Kort (Kort wherever possible). */}
    <ListFilterBar testId="deviations"
      scope={{ value: scopeValue, scopes: DEVIATION_SCOPES, onChange: chooseScope }}
      chips={{ label: "Visa", chips: DEVIATION_STATUS_FILTERS.map((key) => ({ value: key, label: DEVIATION_FILTER_LABEL[key], count: statusCounts[key] })), value: status, onChange: chooseStatus, testId: "deviations-filter" }}
      search={{ label: "Sök avvikelse", placeholder: "Rubrik, nummer, text eller ansvarig", value: query, onChange: setQuery, testId: "deviations-search" }}
      extras={[{ key: "type", label: "Typ", testId: "deviations-type", className: "sm:w-56 sm:flex-none", value: typeFilter, onChange: (value) => setTypeFilter(value as DeviationTypeFilter),
        options: DEVIATION_TYPE_FILTERS.map((key) => ({ value: key, label: `${DEVIATION_TYPE_FILTER_LABEL[key]} (${typeCounts[key]})` })) }]}
      sort={{ value: prefs.sort, options: DEVIATION_SORT_OPTIONS, onChange: prefs.setSort }}
      view={{ value: prefs.view, onChange: prefs.setView }} />
    {header ? null : <div className="flex flex-wrap gap-2">{actions}</div>}
    {view.deviationRetention ? <p className="text-xs text-muted-foreground" data-testid="deviation-retention-rule">{DEVIATION_RETENTION_TEXT}</p> : null}
    {view.deviationRetention?.soon ? <p className="notice text-sm" data-testid="deviation-retention-soon">{view.deviationRetention.soon === 1 ? "1 post" : `${view.deviationRetention.soon} poster`} når lagringstiden inom {DEVIATION_RETENTION_WARNING_DAYS} dagar. Exportera det ni behöver, eller välj Spara tills vidare på posten.</p> : null}
    {/* The list (2026-10-30): the type's icon, the heading, severity, date and time, status and one short line – the
        whole card opens the entry, where its text, photos and actions are. The card's faint tint is the severity. */}
    {/* Kort: the shared register card (ListCard) – type icon, heading, number and date, severity, status and Anmälningspliktig
        as marks, the responsible and the date as facts; the whole card opens the entry, as a row does. */}
    {items.length && prefs.view === "cards" ? <ListCardGrid testId="self-inspection-deviations">{items.slice(0, shown).map((item) => {
      const severity = severityOf(item);
      const late = isLate(item);
      return <ListCard key={item.id} testId="deviation-card" href={deviationHref(item.id)} urgent={late || awaitsAuthorityReport(item)}
        icon={<DeviationTypeIcon item={item} />} title={item.title} subtitle={`${entryLabel(item)} · ${whenText(item.occurredAt ?? item.createdAt)}`}
        badges={<>
          {severity ? <span className={cn("rounded-full border px-2.5 py-0.5 text-xs", severity.badge)} data-testid="deviation-severity">{severity.label}</span> : null}
          <span className={cn("rounded-full border px-2.5 py-0.5 text-xs", indicatorBadge(statusTone(item.status)))} data-testid="deviation-status">{DEVIATION_STATUSES[item.status]}</span>
          {awaitsAuthorityReport(item) ? <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", indicatorBadge("danger"))} data-testid="deviation-reportable">{REPORTABLE_LABEL}</span> : null}
        </>}
        facts={[
          item.responsibleName ? { icon: UserRound, label: "Ansvarig", value: item.responsibleName } : null,
          item.dueDate ? { icon: CalendarClock, label: "Klart senast", value: <>Klart senast {date(item.dueDate)}{late ? <span className="font-medium text-danger"> · Förfallen</span> : null}</> } : null,
        ]} />;
    })}</ListCardGrid>
    : items.length ? <ul className="space-y-2" data-testid="self-inspection-deviations">{items.slice(0, shown).map((item) => {
      const severity = severityOf(item);
      const late = isLate(item);
      const line = [item.responsibleName && `Ansvarig ${item.responsibleName}`, item.dueDate && `klart senast ${date(item.dueDate)}`].filter(Boolean).join(" · ");
      return <li key={item.id} id={`deviation-${item.id}`} data-severity={item.kind === "IMPROVEMENT" ? undefined : deviationSeverity(item.severity)}>
        <Link href={deviationHref(item.id)} data-testid="deviation-card" className={cn("flex items-center gap-3 rounded-xl border p-3 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", severity ? severity.surface : "bg-card")} data-severity-step={severity?.step}>
          <DeviationTypeIcon item={item} onTint={Boolean(severity)} />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 text-xs text-muted-foreground">{entryLabel(item)}</span>
              <span className="truncate text-sm font-semibold" title={item.title}>{item.title}</span>
              {/* Anmälningspliktig and not marked reported (användartest 2026-10-31, fel 3): seen in the list, not only inside. */}
              {awaitsAuthorityReport(item) ? <span className={cn("shrink-0 self-center rounded-full border px-2 py-0.5 text-[11px] font-medium", indicatorBadge("danger"))} data-testid="deviation-reportable">{REPORTABLE_LABEL}</span> : null}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{whenText(item.occurredAt ?? item.createdAt)}{line ? ` · ${line}` : ""}
              {late ? <span className="font-medium text-danger"> · Förfallen</span> : null}</span>
          </span>
          {/* Two fixed columns (2026-10-30: the pills line up from card to card); a Förbättring keeps the severity column empty. */}
          <span className="flex shrink-0 items-center gap-1.5">
            {severity ? <span className={cn("rounded-full border px-2.5 py-0.5 text-xs", PILL_FIXED_WIDTH, severity.badge)} data-testid="deviation-severity">{severity.label}</span>
              : <span className={PILL_FIXED_WIDTH} aria-hidden="true" />}
            <span className={cn("rounded-full border px-2.5 py-0.5 text-xs", PILL_FIXED_WIDTH, indicatorBadge(statusTone(item.status)))} data-testid="deviation-status">{DEVIATION_STATUSES[item.status]}</span>
          </span>
        </Link>
      </li>;
    })}</ul> : <Empty title={emptyText} description={`Rapporterade avvikelser, tillbud och olycksfall visas här. ${DEVIATION_SOURCES_SENTENCE}`} />}
    {items.length > shown && <div className="flex justify-center"><Button variant="outline" onClick={() => setShown((count) => count + 20)}>Visa fler</Button></div>}
    {dialogs}
  </div></>;
}

/**
 * Allvarligt tillbud eller olycksfall: where it is reported (the authorities' own pages) and who marked it reported.
 * Workflow never sends anything itself.
 */
function IncidentNotice({ item, busy, onReported }: { item: DeviationView; busy: boolean; onReported: () => void }) {
  if (!isIncidentType(item.type) || !item.serious) return null;
  return <div className={cn("mt-3 rounded-lg border p-3 text-sm", indicatorBadge(item.reportedToAuthorityAt ? "success" : "danger"))} data-testid="deviation-serious-notice">
    <p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4 shrink-0" aria-hidden="true" />{SERIOUS_NOTICE}</p>
    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      <a className="inline-flex items-center gap-1 underline underline-offset-2" href={WORK_INJURY_REPORT_URL} target="_blank" rel="noreferrer">Anmäl till Arbetsmiljöverket<ExternalLink className="size-3.5" aria-hidden="true" /></a>
      {item.electrical ? <a className="inline-flex items-center gap-1 underline underline-offset-2" href={ELECTRICAL_ACCIDENT_REPORT_URL} target="_blank" rel="noreferrer">Anmäl till Elsäkerhetsverket<ExternalLink className="size-3.5" aria-hidden="true" /></a> : null}
    </p>
    {item.reportedToAuthorityAt
      ? <p className="mt-2" data-testid="deviation-reported">Anmäld {date(item.reportedToAuthorityAt)}{item.reportedToAuthorityByName ? ` av ${item.reportedToAuthorityByName}` : ""}.</p>
      // Markera som anmäld under the link (2026-10-31), the note under it.
      : <div className="mt-2 grid justify-items-start gap-1">
        {item.canHandle ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onReported} data-testid="deviation-mark-reported"><Send />Markera som anmäld</Button> : null}
        <span className="text-xs">Workflow skickar inget själv.</span>
      </div>}
  </div>;
}

/** When, Vad hände, Varför and the three marks of a near miss or an accident – in the report and in Utredning. */
function IncidentFields({ value, set, idPrefix }: { value: Pick<DeviationDraft, "occurredAt" | "whatHappened" | "cause" | "serious" | "personalInjury" | "electrical">; set: (patch: Partial<DeviationDraft>) => void; idPrefix: string }) {
  return <>
    <Field id={`${idPrefix}-occurred`} type="datetime-local" label="När hände det" value={value.occurredAt} onChange={(occurredAt) => set({ occurredAt })} className="max-w-xs" />
    <Field id={`${idPrefix}-what`} multiline label="Vad hände" value={value.whatHappened} onChange={(whatHappened) => set({ whatHappened })} />
    <Field id={`${idPrefix}-cause`} multiline label="Varför" value={value.cause} onChange={(cause) => set({ cause })} help="Skriv om arbetet, inte om personen. Inga namn." />
    <div className="grid gap-2">
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={value.serious} onCheckedChange={(checked) => set({ serious: checked === true })} data-testid="deviation-serious" aria-describedby={`${idPrefix}-reportable-hint`} />{REPORTABLE_LABEL}</label>
      <p id={`${idPrefix}-reportable-hint`} className="-mt-1 pl-6 text-xs text-muted-foreground">{REPORTABLE_HINT} <a className="underline underline-offset-2" href={REPORTABLE_GUIDE_URL} target="_blank" rel="noreferrer">Vad som ska anmälas</a></p>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={value.personalInjury} onCheckedChange={(checked) => set({ personalInjury: checked === true })} />Personskada</label>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={value.electrical} onCheckedChange={(checked) => set({ electrical: checked === true })} />Gäller el</label>
    </div>
    {value.serious ? <p className="notice text-sm">{SERIOUS_NOTICE}</p> : null}
  </>;
}

function DeviationDialog({ draft: initial, view, busy, photos, onClose, onSave }: { draft: DeviationDraft; view: SelfInspectionView; busy: boolean;
  photos?: { files: File[]; onChange: (files: File[]) => void; cameraRef: React.RefObject<HTMLInputElement | null> }; onClose: () => void; onSave: (draft: DeviationDraft) => Promise<boolean> }) {
  const [draft, setDraft] = useState(initial);
  const set = (patch: Partial<DeviationDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const full = view.canEdit;
  const incident = isIncidentType(draft.type);
  // A near miss or an accident: Ansvarig only among admins and Teamet (privacy first); the one chosen stays shown so the server can say why.
  const responsibleChoices = incident && view.incidentResponsibleIds
    ? view.people.filter((person) => view.incidentResponsibleIds!.includes(person.id) || person.id === draft.responsibleId) : view.people;
  // In the app the screen is called "Ny avvikelse" (mobilresan 2026-11-18: "Rapportera avvikel…" was cut in the top bar), and its
  // fields stand in one white group on the grey page, as Rapportera tid's and Ny arbetsorder's.
  const native = useNativeMode();
  const title = draft.id ? `Ändra ${(draft.kind === "IMPROVEMENT" ? "förbättring" : draft.type && draft.type !== "SELF_INSPECTION" ? DEVIATION_TYPES[draft.type] : "avvikelse").toLowerCase()}`
    : draft.kind === "IMPROVEMENT" ? "Ny förbättring" : native ? "Ny avvikelse" : "Rapportera avvikelse";
  const missing = !draft.title.trim() ? "Ange en rubrik." : !draft.type ? "Välj typ." : null;
  return <DialogPage pageKey="avvikelse" size="page" open onOpenChange={(open) => { if (!open) onClose(); }} title={title} panelTitle="Avvikelsen">
    <div className={cn("space-y-4", native && "native-form-card")}>
      <Field id="si-dev-title" label="Rubrik" value={draft.title} onChange={(value) => set({ title: value })} />
      <Field id="si-dev-description" multiline label="Beskrivning" value={draft.description} onChange={(description) => set({ description })} />
      {photos ? <PhotoPicker files={photos.files} onChange={photos.onChange} disabled={busy} cameraRef={photos.cameraRef} /> : null}
      {/* The type is chosen here, with no choice made in advance (2026-10-30); what follows depends on it. */}
      <Field id="si-dev-type" label="Typ" value={draft.type} onChange={(type) => set({ type: type as DeviationDraft["type"] })} options={["", ...Object.keys(DEVIATION_TYPES)]}
        optionLabels={{ "": "Välj typ", ...DEVIATION_TYPES }} required />
      {/* Allvarlighetsgrad right after Typ (2026-10-30), Normal from the start; a Förbättring has none. */}
      {draft.kind === "IMPROVEMENT" ? null : <Field id="si-dev-severity" label="Allvarlighetsgrad" value={draft.severity} onChange={(severity) => set({ severity: severity as DeviationSeverity })}
        options={Object.keys(DEVIATION_SEVERITIES)} optionLabels={DEVIATION_SEVERITIES} required />}
      {incident ? <IncidentFields value={draft} set={set} idPrefix="si-dev" /> : null}
      {draft.type === "SELF_INSPECTION" ? <>
        <Field id="si-dev-category" label="Klass" value={draft.category} onChange={(category) => set({ category: category as DeviationDraft["category"] })} options={Object.keys(DEVIATION_CATEGORIES)} optionLabels={DEVIATION_CATEGORIES} />
        {full ? <label className="flex items-center gap-2 text-sm"><Checkbox checked={draft.systematic} onCheckedChange={(value) => set({ systematic: value === true })} />Kan vara ett systematiskt fel (elinstallatören för regelefterlevnad ska meddelas)</label> : null}
      </> : null}
      {full && <>
        <Field id="si-dev-action" multiline label="Åtgärd" value={draft.action} onChange={(action) => set({ action })} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="si-dev-responsible" label="Ansvarig" value={draft.responsibleId ?? ""} onChange={(value) => set({ responsibleId: value || null })} options={["", ...responsibleChoices.map((person) => person.id)]}
            optionLabels={{ "": "Ingen vald", ...Object.fromEntries(view.people.map((person) => [person.id, person.name])) }}
            help={incident && view.incidentResponsibleIds ? "Bara administratörer och de som får se Teamet." : undefined} />
          <Field id="si-dev-due" type="date" label="Klart senast" value={draft.dueDate} onChange={(dueDate) => set({ dueDate })} />
          <Field id="si-dev-status" label="Status" value={draft.status} onChange={(status) => set({ status: status as DeviationDraft["status"] })} options={Object.keys(DEVIATION_STATUSES)} optionLabels={DEVIATION_STATUSES} />
        </div>
        <Field id="si-dev-follow-up" multiline label="Uppföljning" value={draft.followUp} onChange={(followUp) => set({ followUp })} />
      </>}
      {!full && !draft.id ? <p className="text-xs text-muted-foreground">Den som hanterar avvikelsen lägger till åtgärd, ansvarig och datum.</p> : null}
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: draft.id ? "Spara" : draft.kind === "IMPROVEMENT" ? "Lägg till" : "Rapportera", disabled: busy, disabledReason: missing ?? undefined, testId: "deviation-save",
        onClick: () => void onSave(draft).then((saved) => { if (saved) onClose(); }) }} />
    </div>
  </DialogPage>;
}

/** Utredning of a near miss or an accident by whoever handles it without being an admin: when, what, why and Åtgärd. */
function InvestigationDialog({ entry, busy, onClose, onSave }: { entry: DeviationView; busy: boolean; onClose: () => void;
  onSave: (input: { occurredAt: string | null; whatHappened: string; cause: string; plan: string; serious: boolean; personalInjury: boolean; electrical: boolean }) => Promise<boolean> }) {
  const [value, setValue] = useState(() => draftOf(entry));
  const set = (patch: Partial<DeviationDraft>) => setValue((current) => ({ ...current, ...patch }));
  return <DialogPage pageKey="avvikelse-utredning" size="form" open onOpenChange={(open) => { if (!open) onClose(); }} title={`Utredning · ${entryLabel(entry)}`}>
    <div className="space-y-4">
      <IncidentFields value={value} set={set} idPrefix="si-inv" />
      <Field id="si-inv-action" multiline label="Åtgärd" value={value.action} onChange={(action) => set({ action })} />
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Spara", disabled: busy, testId: "deviation-investigation-save",
        onClick: () => void onSave({ occurredAt: fromLocalInput(value.occurredAt), whatHappened: value.whatHappened, cause: value.cause, plan: value.action, serious: value.serious,
          personalInjury: value.personalInjury, electrical: value.electrical }).then((saved) => { if (saved) onClose(); }) }} />
    </div>
  </DialogPage>;
}

/**
 * Markera klar: optional photos (Efter) and a short line; a photo is never required. A near miss or an accident needs its investigation
 * first: what it still lacks is asked for here and saved together with the close (2026-11-02), and the server checks it again. The photos
 * were only greyed out because of that rule; they are never held back by it now.
 */
function MarkDoneDialog({ entry, busy, photos, onClose, onDone }: { entry: DeviationView; busy: boolean; photos: boolean; onClose: () => void;
  onDone: (doneNote: string, files: File[], investigation?: { occurredAt?: string | null; whatHappened?: string; cause?: string; plan?: string }) => Promise<boolean> }) {
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  // The fields that were missing when the dialog opened stay shown while they are filled in.
  const [lacking] = useState(() => { const stored = { ...entry, type: entry.type ?? null }; return { occurredAt: !stored.occurredAt, whatHappened: !stored.whatHappened?.trim(), cause: !stored.cause?.trim(), action: !stored.action.trim() }; });
  const [occurredAt, setOccurredAt] = useState("");
  const [whatHappened, setWhatHappened] = useState("");
  const [cause, setCause] = useState("");
  const [plan, setPlan] = useState("");
  const investigation = { ...(lacking.occurredAt && occurredAt ? { occurredAt: fromLocalInput(occurredAt) } : {}), ...(lacking.whatHappened ? { whatHappened } : {}), ...(lacking.cause ? { cause } : {}), ...(lacking.action ? { plan } : {}) };
  const asks = isIncidentType(entry.type) && Object.values(lacking).some(Boolean);
  const refusal = deviationCloseRefusal(closedInvestigation({ ...entry, type: entry.type ?? null }, investigation));
  return <DialogPage pageKey="avvikelse-klar" size="compact" open onOpenChange={(open) => { if (!open) onClose(); }} title="Markera klar">
    <div className="space-y-4">
      {asks ? <div className="space-y-4" data-testid="deviation-close-fields">
        {lacking.occurredAt ? <Field id="si-done-occurred" type="datetime-local" label="När hände det" value={occurredAt} onChange={setOccurredAt} className="max-w-xs" required /> : null}
        {lacking.whatHappened ? <Field id="si-done-what" multiline label="Vad hände" value={whatHappened} onChange={setWhatHappened} required /> : null}
        {lacking.cause ? <Field id="si-done-cause" multiline label="Varför" value={cause} onChange={setCause} required /> : null}
        {lacking.action ? <Field id="si-done-action" multiline label="Åtgärd" value={plan} onChange={setPlan} required /> : null}
      </div> : null}
      {photos ? <PhotoPicker files={files} onChange={setFiles} disabled={busy} label="Bilder efter" /> : null}
      <Field id="si-done-note" label="Kort notering" value={note} onChange={setNote} />
      {refusal ? <p className="text-xs text-muted-foreground" data-testid="deviation-close-refusal">{refusal}</p> : null}
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Markera klar", disabled: busy, disabledReason: refusal ?? undefined, testId: "deviation-done-save",
        onClick: () => void onDone(note.trim(), files, asks ? investigation : undefined).then((done) => { if (done) onClose(); }) }} />
    </div>
  </DialogPage>;
}
