"use client";

import { destinationText } from "@/lib/workflow/contact-links";
import { createElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronsDownUp, ChevronsUpDown, CircleDashed, ListTree, Map as MapIcon, MapPin, MapPinPlus, Pause, Pencil, Play, Plus, Trash2, MapPinHouse } from "lucide-react";
import { AreaIcon } from "@/components/area-icon";
import { IconActionBar, type IconBarAction } from "@/components/icon-action-bar";
import { NEW_CHILD_LABELS, placeActions, placeLevelName } from "@/lib/workflow/place-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageActionsReset } from "@/components/page-shell";
import { BareFormPanels, Empty, Panel, RowsSkeleton, ShowMore, SkeletonText } from "@/features/kfid/ui";
import { DISCARD_QUESTION, useConfirm } from "@/features/kfid/confirm";
import { ListGroup, ListRow, useNativeTopBar } from "@/components/native";
import { useEntryState } from "@/components/history-nav";
import { useNativeMode } from "./use-detail-level";
import { useUnsavedGuard } from "@/lib/workflow/use-unsaved-guard";
import { leaveWithoutAsking } from "@/lib/workflow/leave-guard";
import { formatSwedish } from "@/lib/swedish-time";
import { PLACE_MAX_DEPTH, placeChain, placeName, type CustomerFacilityInput, type FacilityItem } from "@/lib/workflow/customer-facility";
import { OPERATING_STATE_LABELS, placeHasObjectData } from "@/lib/workflow/maintenance";
import { roundHref } from "@/lib/workflow/form-schedule";
import { scanJobs } from "@/lib/workflow/place-scan";
import { listPlaceLabel } from "@/lib/workflow/temp-place";
import { indicatorBadge, statusTone } from "./indicator-tone";
import { emptyPlace, placeDraftOf, PlaceForm, type PlaceDraft } from "./place-editor";
import type { PlaceData } from "./place-page";
import { PlaceBadges } from "./place-register";
import { placeAddressLine, placeIcon, placeParentIds, placeTreeLevel, placeTreeLine, PlaceTreeView } from "./place-tree";

export type BrowserPlace = FacilityItem & { version?: number; links?: number; openWorkOrders?: number | null };
/** What a place shows besides itself (Cloud reads it from /api/places; Local and the demo have none). */
export type PlaceDetailData = Pick<PlaceData, "history" | "rounds" | "limits" | "canCreate">;

const typeLabel = (kind: string) => kind === "WORK_ORDER" ? "Arbetsorder" : kind === "RISK_ASSESSMENT" ? "Riskbedömning" : kind === "FORM" ? "Protokoll" : "Kontroll";
const statusLabel = (status: string) => ({ PLANNED: "Planerad", IN_PROGRESS: "Pågår", PAUSED: "Pausad", NEEDS_ACTION: "Behöver åtgärdas", COMPLETED: "Färdigställd", CANCELLED: "Utgått", DRAFT: "Utkast" } as Record<string, string>)[status] ?? status;
const EMPTY_TEXT = "Lägg till en adress med Ny adress, och under den objekten, till exempel en elcentral.";
/** The explorer stacks its panels under this width (the container query in app/globals.css). */
const STACK_BELOW_REM = 44;

type Editing = { id?: string; version?: number; facility: PlaceDraft };

/**
 * Anläggningar as two panels side by side (2026-10-15 night: "två separata, lite som egenkontroll"; replaces the
 * panel with a framed tree column and a framed content box inside it): the tree in one ordinary `Panel` – only arrow, icon,
 * name and the address or type (`PlaceTreeView`) – and the open place in the `Panel` beside it: its name as the title,
 * where it lies as the description, Nytt objekt / Redigera and small icon buttons in the header, and under that the
 * object data, rounds due, latest jobs, rounds and limits. Nothing in the tree is repeated in the content: the objects are
 * listed in the tree only. Forms (Ny adress, Nytt objekt, Redigera) take the content panel's place. The page never moves
 * when a row is clicked: the content column keeps the tallest height it has had during the visit, the content read for a
 * place is kept, and the browser scrolls only when the panels are stacked (a phone, a narrow window) and the content is
 * out of sight. The place is in the address as `&place=` (replaced, not pushed). On level 1 the tree is the screen and a
 * place, like a form, is a screen of its own with "‹ Platser" in the top bar. What is folded out is kept per visit
 * (`useEntryState`), so Bakåt from a job finds the tree as it was left, and the open place's way is always folded out.
 */
export function PlaceBrowser<T extends BrowserPlace>({ places, current, onNavigate, scanned = false, nativeTitle = "Platser", title = "Anläggningsträd", onNewAddress, map, above, creating, onCreatingDone, canEdit, canManage, maintenance = false, onSave, onStatus, onDelete, loadDetail, onShowOnMap, footer, testId = "place-browser" }: {
  places: readonly T[];
  /** Level 1: rows under the tree (Visa på karta, Ny adress), not on a place's or a form's screen. */
  footer?: ReactNode;
  /** The address or object open now; null when none is. */
  current: string | null;
  onNavigate: (id: string | null) => void;
  /** Reached by scanning the place's QR label: several rounds due there are offered as a choice first. */
  scanned?: boolean;
  /** Level 1 on a phone: the screen's title while no place is open (the top bar is this component's there). */
  nativeTitle?: string;
  /** Display 2–3: the tree panel's title. */
  title?: string;
  /** Display 2–3: Ny adress in the action card (Hantera anläggningar, 2026-10-24). */
  onNewAddress?: () => void;
  /** Display 2–3: the customer's map, shown or hidden from the action card's fixed tools. */
  map?: { shown: boolean; onToggle: () => void } | null;
  /** Display 2–3: shown over both panels (the customer's map). */
  above?: ReactNode;
  /** Ny adress was pressed above the tree. */
  creating?: boolean;
  onCreatingDone?: () => void;
  canEdit: boolean;
  canManage: boolean;
  maintenance?: boolean;
  onSave: (input: { id?: string; version?: number; facility: CustomerFacilityInput }) => Promise<void>;
  onStatus: (place: T, isActive: boolean) => Promise<void>;
  onDelete: (place: T) => Promise<void>;
  loadDetail?: (id: string, page: number) => Promise<PlaceDetailData>;
  onShowOnMap?: (place: T) => void;
  testId?: string;
}) {
  const byId = useMemo(() => new Map(places.map((item) => [item.id, item])), [places]);
  const childrenOf = useMemo(() => {
    const map = new Map<string, T[]>();
    for (const item of places) if (item.parentId) map.set(item.parentId, [...(map.get(item.parentId) ?? []), item]);
    return map;
  }, [places]);
  const place = current ? byId.get(current) ?? null : null;
  const [editing, setEditing] = useState<Editing | null>(null);
  const native = useNativeMode();
  const formId = useId();
  const [initial, setInitial] = useState("");
  const dirty = Boolean(editing) && JSON.stringify(editing!.facility) !== initial;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, confirmElement] = useConfirm();
  // What a place's panel has read (its first page of jobs, rounds, limits), kept for the visit: going back shows it at once.
  const [details] = useState(() => new Map<string, PlaceDetailData>());
  // Whether jobs, rounds or limit values point to a place (read by its panel): the action card's Ta bort follows it.
  const [use, setUse] = useState<{ id: string; inUse: boolean | null } | null>(null);
  const reportUse = useCallback((id: string, inUse: boolean | null) => setUse((now) => now?.id === id && now.inUse === inUse ? now : { id, inUse }), []);
  const wrapId = useId();
  const paneId = useId();
  // The content column never gets shorter during the visit (the tallest place's height is kept as its least height), so
  // what stands under the panels never moves up when a shorter place or a place still being read is opened.
  const [hold, setHold] = useState(0);
  const settle = useCallback(() => { const box = document.getElementById(paneId); if (box) setHold((height) => Math.max(height, box.offsetHeight)); }, [paneId]);
  // What is folded out, kept for this visit: Bakåt from a job finds the tree as it was left.
  const [openList, setOpenList] = useEntryState<string[]>(`places.open.${places[0]?.customerId ?? "none"}`, []);
  const open = useMemo(() => new Set(openList), [openList]);
  const unfold = (ids: string[]) => { if (ids.some((id) => !open.has(id))) setOpenList((list) => [...new Set([...list, ...ids])]); };
  const toggle = (id: string) => setOpenList((list) => list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
  const startForm = (facility: PlaceDraft, id?: string, version?: number) => { setEditing({ id, version, facility }); setInitial(JSON.stringify(facility)); setError(""); };

  const [seenCreating, setSeenCreating] = useState(false);
  if (Boolean(creating) !== seenCreating) {
    setSeenCreating(Boolean(creating));
    if (creating) startForm(emptyPlace());
  }
  // Another place opened (a click, Bakåt, a QR label): its way folds out, and the form of the place left closes.
  const [seenCurrent, setSeenCurrent] = useState<string | null>(null);
  if (current !== seenCurrent) {
    setSeenCurrent(current);
    if (editing?.id && editing.id !== current && !native) setEditing(null);
    setError("");
    if (current) unfold(placeChain(places, current).slice(0, -1).map((item) => item.id));
  }
  // Arriving at a place (a QR label, a link, Bakåt): its row is brought into view once.
  useEffect(() => {
    if (!current || native) return;
    requestAnimationFrame(() => document.querySelector(`[data-testid="place-node"][data-place-id="${CSS.escape(current)}"]`)?.scrollIntoView({ block: "nearest" }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** Only when the panels are stacked (a phone, a narrow window) and the content is out of sight: bring it up. Side by side nothing moves. */
  const showPane = () => requestAnimationFrame(() => {
    const wrap = document.getElementById(wrapId);
    const box = document.getElementById(paneId);
    if (!wrap || !box) return;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    if (wrap.getBoundingClientRect().width >= STACK_BELOW_REM * rem) return;
    if (box.getBoundingClientRect().top > window.innerHeight * 0.6) box.scrollIntoView({ block: "start", behavior: "smooth" });
  });

  const close = () => { if (!editing?.id && !editing?.facility.parentId) onCreatingDone?.(); setEditing(null); setError(""); };
  /** A changed form asks before it is left for another form or another place. */
  const leaveForm = async () => {
    if (!dirty) return true;
    if (!(await confirm(DISCARD_QUESTION))) return false;
    leaveWithoutAsking();
    return true;
  };
  const save = async () => {
    if (!editing) return;
    setBusy(true); setError("");
    try {
      await onSave({ id: editing.id, version: editing.version, facility: editing.facility });
      // The new object stands at once where it belongs: its parent stays folded out.
      if (editing.facility.parentId) unfold([editing.facility.parentId]);
      close();
    } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  };
  const openPlace = async (item: T) => {
    if (editing && !(await leaveForm())) return;
    if (editing) close();
    onNavigate(item.id);
    if (!native) showPane();
  };
  const edit = async (item: T) => {
    if (editing && editing.id !== item.id && !(await leaveForm())) return;
    if (editing && !editing.id && !editing.facility.parentId) onCreatingDone?.();
    startForm(placeDraftOf(item), item.id, item.version);
    if (!native) showPane();
  };
  const add = async (parent: T) => {
    if (editing && !(await leaveForm())) return;
    if (editing && !editing.id && !editing.facility.parentId) onCreatingDone?.();
    unfold([parent.id]);
    startForm(emptyPlace(parent.id, "OBJECT"));
    if (!native) showPane();
  };
  const remove = async (item: T) => {
    if (!(await confirm({ title: `Ta bort ${placeName(item)}?`, message: "Platsen tas bort från kunden. Det går inte att ångra.", confirmLabel: "Ta bort", tone: "danger" }))) return;
    setBusy(true);
    // The place above opens at once, as the folder above does when a folder is removed.
    if (current === item.id) onNavigate(item.parentId ?? null);
    try { await onDelete(item); details.delete(item.id); }
    catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  };
  useUnsavedGuard(dirty && !busy, confirm, undefined, { browserBack: native });
  const cancelEditing = async () => {
    if (dirty && !(await confirm(DISCARD_QUESTION))) return;
    leaveWithoutAsking();
    close();
  };
  const toggleStatus = async (item: T) => {
    setBusy(true);
    try { await onStatus(item, !item.isActive); } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  };

  // A new address is opened at once (a creating form without a parent has nothing to open yet; its parent shows the new object).
  useEffect(() => { if (creating && !native) showPane(); }, [creating]); // eslint-disable-line react-hooks/exhaustive-deps

  const parentOf = (draft: PlaceDraft) => draft.parentId ? byId.get(draft.parentId) ?? null : null;
  const newTitle = (draft: PlaceDraft) => { const parent = parentOf(draft); return !parent ? "Ny adress" : parent.parentId ? "Nytt underobjekt" : "Nytt objekt"; };
  const quick = Boolean(editing && !editing.id && editing.facility.parentId);
  const canSubmit = Boolean(editing && (editing.facility.name.trim() || (!editing.facility.parentId && (editing.facility.address.trim() || editing.facility.city.trim()))));
  useNativeTopBar(!native ? null : editing
    ? { title: editing.id ? "Redigera plats" : newTitle(editing.facility), cancel: { onClick: () => void cancelEditing() },
      save: { label: editing.id ? "Spara" : "Lägg till", busy, disabled: !canSubmit, onClick: () => (document.getElementById(formId) as HTMLFormElement | null)?.requestSubmit() } }
    : place ? { title: placeName(place), back: { label: "Platser" } }
    : { title: nativeTitle });

  const editedName = editing?.id ? placeName(byId.get(editing.id) ?? { name: "platsen" }) : "";
  const newParent = editing ? parentOf(editing.facility) : null;
  const formTitle = editing ? editing.id ? `Redigera ${editedName}` : `${newTitle(editing.facility)}${newParent ? ` under ${placeName(newParent)}` : ""}` : "";
  const form = editing ? <div data-testid="place-inline-form" data-quick={quick ? "" : undefined}>
    <PageActionsReset><BareFormPanels><PlaceForm inline quick={quick} maintenance={maintenance} value={editing.facility} onChange={(facility) => setEditing({ ...editing, facility })} places={[...places]} placeId={editing.id}
      error={error} busy={busy} onCancel={() => void cancelEditing()} onSubmit={() => void save()} submitLabel={editing.id ? "Spara" : editing.facility.parentId ? "Lägg till" : "Lägg till adress"}
      formId={formId} hideActions={native} /></BareFormPanels></PageActionsReset>
  </div> : null;

  /** The open place's content: the panel beside the tree, or its own screen on level 1. */
  const summary = (item: T) => {
    const depth = placeChain(places, item.id).length - 1;
    const kids = childrenOf.get(item.id) ?? [];
    return <PlaceSummary place={item} depth={depth} native={native} maintenance={maintenance} scanned={scanned} canEdit={canEdit} canManage={canManage} busy={busy} notice={error}
      loadDetail={loadDetail} cache={details} onSettled={settle} onUse={reportUse} address={item.parentId ? byId.get(placeChain(places, item.id)[0]?.id ?? "") ?? null : null}
      under={kids} onOpenChild={(child) => void openPlace(child)} onAdd={canEdit && item.isActive && depth + 1 < PLACE_MAX_DEPTH ? () => void add(item) : null}
      blocked={kids.length > 0} onShowOnMap={onShowOnMap}
      onEdit={() => void edit(item)} onStatus={() => void toggleStatus(item)} onDelete={() => void remove(item)} />;
  };

  if (native) {
    let body: ReactNode;
    if (editing) body = form;
    else if (place) body = summary(place);
    else if (!places.length) body = <Empty title="Inga anläggningar" description={EMPTY_TEXT} />;
    else body = <PlaceTreeView places={places} open={open} onToggle={toggle} selected={null} onOpen={(item) => void openPlace(item)} />;
    return <div className="space-y-3" data-testid={testId}>
      {confirmElement}
      {error && !editing ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" data-testid="place-list-error">{error}</p> : null}
      {body}
      {!editing && !place ? footer : null}
    </div>;
  }

  // Hantera anläggningar (2026-10-24): the actions in one compact card above the tree and the information card,
  // following the level chosen in the tree (or the place a form is open for). The tree only navigates, marks and folds.
  const shown = editing?.id ? byId.get(editing.id) ?? null : editing ? newParent : place;
  const shownDepth = shown ? placeChain(places, shown.id).length - 1 : 0;
  const parents = placeParentIds(places);
  // Visa på karta (UT7, 2026-11-01): the place's own position, else the nearest above it (an object stands at its address), else its address.
  const chain = shown ? placeChain(places, shown.id).reverse() : [];
  const mapTarget = chain.find((item) => item.latitude != null && item.longitude != null) ?? chain.find((item) => destinationText(item)) ?? null;
  const bar = <PlaceActionsBar target={shown} depth={shownDepth} canEdit={canEdit} canManage={canManage} busy={busy}
    hasChildren={Boolean(shown && childrenOf.get(shown.id)?.length)}
    inUse={!shown ? null : use?.id === shown.id ? use.inUse : loadDetail ? null : (shown.links ?? 0) > 0}
    onNewAddress={onNewAddress ? () => void (async () => { if (editing && !(await leaveForm())) return; if (editing?.id || editing?.facility.parentId) setEditing(null); onNewAddress(); })() : undefined}
    onAdd={() => { if (shown) void add(shown); }} onEdit={() => { if (shown) void edit(shown); }} onStatus={() => { if (shown) void toggleStatus(shown); }} onDelete={() => { if (shown) void remove(shown); }}
    mapTarget={mapTarget} onShowOnMap={onShowOnMap ? () => { if (mapTarget) onShowOnMap(mapTarget); } : undefined} map={map}
    canOpenAll={parents.some((id) => !open.has(id))} canFoldAll={parents.some((id) => open.has(id))} onOpenAll={() => setOpenList(parents)} onFoldAll={() => setOpenList([])} />;
  const count = places.filter((item) => !item.parentId).length;
  const treeDescription = `${count} ${count === 1 ? "adress" : "adresser"}`;

  // Nothing yet and no form: the action card (Ny adress) and one panel with the invitation, no empty tree and no empty content.
  if (!places.length && !editing) return <div className="place-explorer-wrap" data-testid={testId}><div className="place-explorer">{confirmElement}
    <div className="place-explorer-bar">{bar}</div>
    <div className="place-explorer-above"><Panel icon={ListTree} title={title} description={treeDescription}><Empty compact title="Inga anläggningar" description={EMPTY_TEXT} /></Panel></div>
  </div></div>;

  return <div className="place-explorer-wrap" id={wrapId} data-testid={testId}><div className="place-explorer">
    {confirmElement}
    <div className="place-explorer-bar">{bar}</div>
    {above ? <div className="place-explorer-above">{above}</div> : null}
    <div className="place-explorer-tree" data-chrome-follow="">
      <Panel icon={ListTree} title={title} description={treeDescription} className="place-tree-panel">
        <nav aria-label="Kundens platser">
          <PlaceTreeView places={places} open={open} onToggle={toggle} selected={editing ? shown?.id ?? null : current} onOpen={(item) => void openPlace(item)} />
        </nav>
      </Panel>
    </div>
    <div className="place-pane" id={paneId} style={hold ? { minHeight: hold } : undefined} data-testid="place-pane">
      {editing ? <div data-testid={editing.id ? "place-edit-panel" : "place-new-panel"}><Panel icon={editing.id ? Pencil : Plus} title={formTitle}>{form}</Panel></div>
        : place ? summary(place)
        : <Panel icon={MapPinHouse} title="Välj en plats" className="place-pane-panel"><PaneEmpty testId="place-pane-empty" /></Panel>}
    </div>
  </div></div>;
}

/**
 * Hantera anläggningar (2026-10-24): the compact action card above the tree and the information card – the shared
 * light icon menu (`IconActionBar`). Ny adress always; Nytt objekt / Nytt underobjekt under the chosen level; Redigera,
 * Visa på karta, Pausa/Aktivera and Ta bort on the chosen level; at the far right, in a fixed place, the customer's map and
 * Fäll ut alla / Fäll ihop alla. What does not fit the choice is inactive with its reason (`placeActions`), so the card keeps
 * its shape whatever is chosen. `loading`: the same card on its way, every button there and inactive.
 */
function PlaceActionsBar({ target, mapTarget = null, depth, canEdit, canManage, busy = false, hasChildren = false, inUse = null, onNewAddress, onAdd, onEdit, onStatus, onDelete, onShowOnMap, map, canOpenAll = false, canFoldAll = false, onOpenAll, onFoldAll, loading = false }: {
  target: BrowserPlace | null; mapTarget?: BrowserPlace | null; depth: number; canEdit: boolean; canManage: boolean; busy?: boolean; hasChildren?: boolean; inUse?: boolean | null;
  onNewAddress?: () => void; onAdd?: () => void; onEdit?: () => void; onStatus?: () => void; onDelete?: () => void; onShowOnMap?: () => void;
  map?: { shown: boolean; onToggle: () => void } | null;
  canOpenAll?: boolean; canFoldAll?: boolean; onOpenAll?: () => void; onFoldAll?: () => void;
  loading?: boolean;
}) {
  const actions = placeActions({ selected: target ? { depth, name: placeName(target), isActive: target.isActive, hasChildren, inUse } : null, canEdit, canManage, maxDepth: PLACE_MAX_DEPTH });
  const wait = loading ? "Kundens anläggningar läses in." : null;
  const reason = (state: { enabled: boolean; reason?: string }) => wait ?? (state.enabled ? null : state.reason ?? null);
  const name = target ? placeName(target) : "";
  const noop = () => undefined;
  const groups: IconBarAction[][] = [
    [
      ...(actions.newAddress && (onNewAddress || loading) ? [{ key: "new-address", label: "Ny adress", icon: MapPinPlus, disabledReason: wait, onClick: onNewAddress ?? noop, testId: "place-new-top" }] : []),
      ...(actions.newChild ? [{ key: "new-child", label: actions.newChild.label, labels: NEW_CHILD_LABELS, icon: Plus, disabledReason: reason(actions.newChild), onClick: onAdd ?? noop,
        ariaLabel: target && actions.newChild.enabled ? `${actions.newChild.label} under ${name}` : undefined, testId: "place-add-child" }] : []),
    ],
    [
      ...(actions.edit ? [{ key: "edit", label: "Redigera", icon: Pencil, disabledReason: reason(actions.edit), onClick: onEdit ?? noop, ariaLabel: target ? `Redigera ${name}` : undefined, testId: "place-edit" }] : []),
      ...(onShowOnMap || loading ? [{ key: "show-on-map", label: "Visa på karta", icon: MapPin, onClick: onShowOnMap ?? noop, ariaLabel: target ? `Visa på karta: ${name}` : undefined, testId: "place-show-on-map",
        disabledReason: wait ?? (!target ? "Välj en adress eller ett objekt i trädet först." : !mapTarget ? `${name} har ingen adress eller position. Ange den under Redigera.` : null) }] : []),
      ...(actions.pause ? [{ key: "status", label: actions.pause.label, labels: ["Pausa", "Aktivera"], icon: target && !target.isActive ? Play : Pause, busy, disabledReason: reason(actions.pause), onClick: onStatus ?? noop,
        ariaLabel: target ? `${actions.pause.label} ${name}` : undefined, testId: "place-status" }] : []),
      ...(actions.remove ? [{ key: "delete", label: "Ta bort", icon: Trash2, tone: "danger" as const, busy, disabledReason: reason(actions.remove), onClick: onDelete ?? noop, ariaLabel: target ? `Ta bort ${name}` : undefined, testId: "place-delete" }] : []),
    ],
  ];
  const end: IconBarAction[] = [
    ...(map || loading ? [{ key: "map", label: map?.shown ? "Dölj kartan" : "Visa kartan", icon: MapIcon, iconOnly: true, pressed: Boolean(map?.shown), disabledReason: wait, onClick: map?.onToggle ?? noop, testId: "places-show-map" }] : []),
    { key: "open-all", label: "Fäll ut alla", icon: ChevronsUpDown, iconOnly: true, disabledReason: wait ?? (canOpenAll ? null : "Allt i trädet är redan utfällt."), onClick: onOpenAll ?? noop, testId: "place-tree-open-all" },
    { key: "fold-all", label: "Fäll ihop alla", icon: ChevronsDownUp, iconOnly: true, disabledReason: wait ?? (canFoldAll ? null : "Allt i trädet är redan hopfällt."), onClick: onFoldAll ?? noop, testId: "place-tree-fold-all" },
  ];
  return <IconActionBar title="Hantera anläggningar" label="Hantera anläggningar" icon={<AreaIcon area="customer" icon={ListTree} tone="solid" />}
    line={loading ? <SkeletonText className="w-48" /> : actions.line} groups={groups} end={end} testId="place-actions-bar" />;
}

/**
 * Anläggningar on their way (2026-10-16, "sidan hoppar när den bygger och laddar innehåll"; the action card since
 * 2026-10-24): the same action card, tree panel and content panel as `PlaceBrowser` from the first drawing – the card with
 * every button there and inactive, the tree panel with its title and grey rows in the tree rows' height, and the content
 * panel with its least height (with a place in the address: its overview and "Senaste arbetsordrar" in grey) – so the page under
 * them never moves when the places come. `placeOpen`: a place is in the address and will open beside the tree.
 */
export function PlaceBrowserSkeleton({ title = "Anläggningsträd", rows = 2, placeOpen = false, withActions = true, testId = "place-browser-loading" }: { title?: string; rows?: number; placeOpen?: boolean; withActions?: boolean; testId?: string }) {
  return <div className="place-explorer-wrap" data-testid={testId} aria-busy="true"><div className="place-explorer">
    {withActions ? <div className="place-explorer-bar" aria-hidden="true" inert><PlaceActionsBar target={null} depth={0} canEdit canManage loading onShowOnMap={() => undefined} /></div> : null}
    <div className="place-explorer-tree" data-chrome-follow="">
      <Panel icon={ListTree} title={title} description="Adresserna läses in" className="place-tree-panel">
        <div className="place-tree-box" aria-hidden="true">
          <ul className="place-tree">{Array.from({ length: rows }, (_, index) => <li key={index} className="place-node">
            <div className="place-row"><span className="place-toggle" /><span className="place-name-button">
              <span className="native-skeleton size-7 shrink-0 rounded-lg" />
              <span className="place-text flex-1"><span className="place-name"><SkeletonText className={index % 2 ? "w-1/2" : "w-3/4"} /></span><span className="place-meta"><SkeletonText className="w-2/5" /></span></span>
            </span></div>
          </li>)}</ul>
        </div>
      </Panel>
    </div>
    <div className="place-pane">
      {placeOpen ? <Panel icon={MapPinHouse} title="Hämtar platsen…" description="Platsen läses in" className="place-pane-panel">
        <div className="space-y-5" aria-hidden="true">
          <dl className="place-overview-facts">{["Vald nivå", "Objekt", "Registrerade arbetsordrar"].map((label) => <div key={label}><dt>{label}</dt><dd><SkeletonText className="w-12" /></dd></div>)}</dl>
          <section className="place-loading"><h4 className="text-xs font-semibold text-muted-foreground">Senaste arbetsordrar</h4><RowsSkeleton rows={2} dense label="Hämtar platsen…" /></section>
        </div>
      </Panel>
        : <Panel icon={MapPinHouse} title="Välj en plats" className="place-pane-panel"><PaneEmpty /></Panel>}
    </div>
  </div></div>;
}

/** "Välj en plats" with room around it (2026-10-22, punkt 5: Anläggningar get more room and air). */
function PaneEmpty({ testId }: { testId?: string }) {
  return <div className="place-pane-empty" data-testid={testId}>
    <span className="place-icon" data-level="address" aria-hidden="true"><MapPin /></span>
    <p className="text-sm text-muted-foreground">Det du väljer i trädet visas här.</p>
  </div>;
}

/**
 * One address or object: what it is, what can be done, rounds due, latest jobs, rounds and limits. Beside the tree it is a
 * `Panel` with the name as title, where it lies as description and the everyday actions in the header (the rest in ⋯); the
 * objects under it stand in the tree only. On level 1 it is the place's own screen, with every action as a button and what
 * lies under it as rows (the tree is another screen there).
 */
function PlaceSummary<T extends BrowserPlace>({ place, depth, native = false, address = null, under, onOpenChild, onAdd, maintenance, scanned: scannedLabel, canEdit, canManage, busy, notice = "", loadDetail, cache, onSettled, onUse, blocked, onShowOnMap, onEdit, onStatus, onDelete }: {
  place: T; depth: number; native?: boolean; address?: T | null; maintenance: boolean; scanned: boolean; canEdit: boolean; canManage: boolean; busy: boolean;
  /** An error from the last change, shown over the content. */
  notice?: string;
  /** The objects (or sub-objects) right under the place; level 1 lists them as rows. */
  under: T[]; onOpenChild: (child: T) => void;
  /** Nytt objekt / Nytt underobjekt, when one may be added here. */
  onAdd: (() => void) | null;
  loadDetail?: (id: string, page: number) => Promise<PlaceDetailData>;
  /** What has been read before in this visit, shown at once and then read again. */
  cache?: Map<string, PlaceDetailData>;
  /** The content is complete (read, or nothing to read): the column may take its height as its least height. */
  onSettled?: () => void;
  /** Whether jobs, rounds or limit values point to the place (null while it is read): the action card's Ta bort follows it. */
  onUse?: (id: string, inUse: boolean | null) => void;
  /** A place with objects under it stays until they are removed. */
  blocked: boolean;
  onShowOnMap?: (place: T) => void;
  onEdit: () => void; onStatus: () => void; onDelete: () => void;
}) {
  // One component for every place (no remount on a click): what was read is kept by place id, so switching shows the
  // new place's own facts at once and what was read for it before, never an emptied panel.
  const [read, setRead] = useState<{ id: string; data: PlaceDetailData } | null>(null);
  const detail = read?.id === place.id ? read.data : cache?.get(place.id) ?? null;
  // The place being read; a read that comes back for a place no longer shown is only kept for later.
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const loading = loadingId === place.id;
  // A place whose read failed: its own facts show, without grey rows.
  const [failedId, setFailedId] = useState<string | null>(null);
  // Not read yet: from the first drawing (the read starts a microtask later), so the panel never shows "Inget gjort här ännu" first.
  const pending = !detail && Boolean(loadDetail) && failedId !== place.id;
  const load = async (id: string, page: number) => {
    if (!loadDetail) return;
    setLoadingId(id);
    try {
      const next = await loadDetail(id, page);
      if (page === 1) cache?.set(id, next);
      setRead((current) => current?.id === id || !current || page === 1 ? { id, data: next } : current);
    } catch { if (page === 1) setFailedId(id); /* the place's own facts still show */ } finally { setLoadingId((current) => current === id ? null : current); }
  };
  useEffect(() => { queueMicrotask(() => void load(place.id, 1)); }, [place.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const settled = Boolean(detail) || !loadDetail;
  useLayoutEffect(() => { if (settled) onSettled?.(); }, [settled, place.id, detail]); // eslint-disable-line react-hooks/exhaustive-deps
  const isObject = Boolean(place.parentId);
  const level = placeTreeLevel(depth);
  const childLevel = placeTreeLevel(depth + 1);
  const childWord = depth === 0 ? "objekt" : "underobjekt";
  const unused = !blocked && (place.links ?? 0) === 0 && !(detail?.history.total) && !(detail?.rounds.length) && !(detail?.limits.length);
  // In use: something points to it. Read from its jobs, rounds and limit values once they are read; without them (Local, a
  // failed read) only the links count, and the store still refuses what is in use.
  const inUse = (place.links ?? 0) > 0 || Boolean(detail?.history.total || detail?.rounds.length || detail?.limits.length) ? true : pending ? null : false;
  useEffect(() => { onUse?.(place.id, inUse); }, [place.id, inUse]); // eslint-disable-line react-hooks/exhaustive-deps
  // Kundregister skapar inga jobb (2026-10-22): a round due here is shown only when its protocol already exists, and
  // opens that protocol; a round is started from Driftronder, never from the register.
  const due = detail?.rounds.filter((round) => round.active && round.current && round.current.state !== "done" && round.current.taskId) ?? [];
  // A scanned label (2026-10-22) leads only to a round protocol made beforehand: several are a short choice, none a short
  // notice – the scan never creates a job, so neither a round to start nor a new work order is offered as its result.
  const scanned = scannedLabel && Boolean(detail);
  const scanTargets = scanned && detail ? scanJobs(detail.rounds, place.id) : [];
  const facts = maintenance && placeHasObjectData(place) ? ([["Objekttyp", place.objectType],
    ["Driftstatus", place.operatingState ? OPERATING_STATE_LABELS[place.operatingState as keyof typeof OPERATING_STATE_LABELS] : ""], ["Tillverkare", place.manufacturer], ["Modell", place.model],
    ["Serienummer", place.serialNumber], ["Installerad", place.installedOn], ...(place.attributes ?? []).map((item) => [item.label, item.value])] as [string, string | undefined][]).filter(([, value]) => value) : [];
  const description = place.description && place.description !== place.name ? place.description : "";
  const where = isObject ? [place.objectType?.trim(), `på ${address ? placeName(address) : "adressen"}`].filter(Boolean).join(" · ") : placeAddressLine(place) || "Adress";
  const onMap = onShowOnMap && place.latitude != null && place.longitude != null ? () => onShowOnMap(place) : null;
  // Only a place nothing points to; the store also checks rounds, quotes and limit values and says why it refuses.
  const removable = canEdit && unused;
  const badges = <>
    {!place.isActive ? <Badge variant="outline" className={indicatorBadge("neutral")}>Pausad</Badge> : null}
    {place.openWorkOrders ? <Badge variant="outline" className={indicatorBadge("warning")}>{place.openWorkOrders} {place.openWorkOrders === 1 ? "öppen arbetsorder" : "öppna arbetsordrar"}</Badge> : null}
  </>;
  // Level 1 (the place's own screen): Nytt objekt and Redigera as buttons; on display 2–3 every action is in the action card
  // above the tree (Hantera anläggningar, 2026-10-24). Nothing starts a job (no Ny arbetsorder här, no QR label).
  const everyday = <>
    {onAdd ? <Button variant="outline" onClick={onAdd} data-testid="place-add-child"><Plus />{depth === 0 ? "Nytt objekt" : "Nytt underobjekt"}</Button> : null}
    {canEdit ? <Button variant="outline" onClick={onEdit} data-testid="place-edit"><Pencil />Redigera</Button> : null}
  </>;
  const content = <>
    {notice ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" data-testid="place-list-error">{notice}</p> : null}
    {!place.isActive || place.openWorkOrders ? <div className="flex flex-wrap gap-1.5" data-testid="place-state">{badges}</div> : null}
    {description ? <p className="whitespace-pre-wrap text-sm">{description}</p> : null}
    {facts.length ? <div className="space-y-2" data-testid="place-object-data">
      <div className="flex flex-wrap gap-1.5" data-testid="place-badges"><PlaceBadges place={{ ...place, isActive: true }} /></div>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2" data-testid="place-overview">
        {facts.map(([label, value]) => <div key={label} className="flex gap-2"><dt className="text-muted-foreground">{label}</dt><dd className="font-medium">{value}</dd></div>)}
      </dl>
    </div> : null}
    {scanned ? scanTargets.length ? <div data-testid="place-scan-jobs">
      <h4 className="text-xs font-semibold text-muted-foreground">{scanTargets.length > 1 ? "Vilken rond gör du?" : "Planerat jobb här"}</h4>
      <div className="mt-1.5 flex flex-wrap gap-2">{scanTargets.map((job) => <Button key={job.taskId} asChild variant="outline"><Link href={job.href} data-testid="place-scan-job"><Play />{job.title} · {formatSwedish(`${job.date}T12:00:00`, { day: "numeric", month: "short" })}</Link></Button>)}</div>
    </div> : <p role="status" className="notice" data-testid="place-scan-none">Inget planerat jobb här.</p>
    : scannedLabel ? null : due.length ? <div data-testid="place-rounds-due">
      <h4 className="text-xs font-semibold text-muted-foreground">Påbörjade ronder här</h4>
      <div className="mt-1.5 flex flex-wrap gap-2">{due.map((round) => <Button key={round.id} asChild variant="outline"><Link href={roundHref(round, round.current!, place.id)}><CircleDashed />{round.title}</Link></Button>)}</div>
    </div> : null}
    {/* The latest jobs on their way: the section's heading and grey rows in their height, so the panel does not grow under the eye. */}
    {pending ? <section className="place-loading" aria-label="Senaste arbetsordrar">
      <h4 className="text-xs font-semibold text-muted-foreground">Senaste arbetsordrar{isObject ? "" : " på adressen"}</h4>
      <RowsSkeleton rows={2} dense label="Hämtar jobben här…" />
    </section> : null}
    {detail ? <>
      <section data-testid="place-history" aria-label="Senaste arbetsordrar">
        <h4 className="text-xs font-semibold text-muted-foreground">Senaste arbetsordrar{isObject ? "" : " på adressen"}</h4>
        {detail.history.items.length ? <ul className="mt-1.5 divide-y text-sm">{detail.history.items.map((item) => <li key={`${item.kind}-${item.id}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
          <span className="min-w-0"><Link className="font-medium hover:text-primary hover:underline" href={item.href}>{item.title || "Utan rubrik"}</Link>
            <span className="text-xs text-muted-foreground"> · {[typeLabel(item.kind), item.below ? `på ${item.below}` : "", formatSwedish(item.updatedAt, { dateStyle: "short" })].filter(Boolean).join(" · ")}</span></span>
          <Badge variant="outline" className={indicatorBadge(item.status === "NEEDS_ACTION" ? "danger" : statusTone(item.status))}>{statusLabel(item.status)}</Badge>
        </li>)}</ul> : <p className="mt-1 text-sm text-muted-foreground">Inget gjort här ännu.</p>}
        <ShowMore shown={detail.history.items.length} total={detail.history.total} busy={loading} onMore={() => void load(place.id, detail.history.page + 1)} />
      </section>
      {detail.rounds.length ? <section data-testid="place-rounds" aria-label="Driftronder">
        <h4 className="text-xs font-semibold text-muted-foreground">Driftronder</h4>
        <ul className="mt-1.5 divide-y text-sm">{detail.rounds.map((round) => <li key={round.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
          <span className="min-w-0"><span className="font-medium">{round.title}</span><span className="text-xs text-muted-foreground"> · {[listPlaceLabel(round.facilityName, round.tempPlace), round.ruleText, round.active ? "" : "Pausad"].filter(Boolean).join(" · ")}</span></span>
          {round.next ? <span className="text-xs text-muted-foreground">Nästa {round.next}</span> : null}
        </li>)}</ul>
      </section> : null}
      {detail.limits.length ? <section data-testid="place-limits" aria-label="Gränsvärden">
        <h4 className="text-xs font-semibold text-muted-foreground">Gränsvärden</h4>
        <ul className="mt-1.5 space-y-0.5 text-sm text-muted-foreground">{detail.limits.map((limit) => <li key={limit.id}><span className="font-medium text-foreground">{limit.templateName}</span>{limit.objectName ? ` · ${limit.objectName}` : ""} · {limit.count} {limit.count === 1 ? "gränsvärde" : "gränsvärden"}</li>)}</ul>
      </section> : null}
    </> : null}
  </>;

  if (native) return <div className="space-y-5" data-testid="place-detail" data-place-id={place.id}>
    {/* Level 1: the top bar carries the name. */}
    <div className="space-y-1">
      <h3 className="sr-only">{placeName(place)}</h3>
      <p className="text-sm text-muted-foreground" data-testid="place-where">{where}</p>
    </div>
    <div className="flex flex-wrap items-center gap-2" data-testid="place-actions">
      {everyday}
      {onMap ? <Button variant="outline" onClick={onMap} data-testid="place-show-on-map"><MapPin />Visa på karta</Button> : null}
      {canManage ? <Button variant="outline" disabled={busy} onClick={onStatus} data-testid="place-status">{place.isActive ? <><Pause />Pausa</> : <><Play />Aktivera</>}</Button> : null}
      {removable ? <Button variant="outline" disabled={busy} onClick={onDelete} className="text-destructive" data-testid="place-delete"><Trash2 />Ta bort</Button> : null}
    </div>
    {under.length ? <ListGroup title={`${childWord[0].toUpperCase()}${childWord.slice(1)} här`} testId="place-children-list">
      {under.map((child) => <ListRow key={child.id} type="customer" icon={placeIcon(child, childLevel)} title={placeName(child)} subtitle={placeTreeLine(child, depth + 1) || undefined}
        pill={!child.isActive ? { label: "Pausad", tone: "neutral" } : null} onClick={() => onOpenChild(child)} testId="place-child" />)}
    </ListGroup> : null}
    {content}
  </div>;

  // The information card for the chosen level (2026-10-24): an overview first – the level, how much lies under it and
  // the jobs registered there – then the latest jobs as history (nothing that starts a job, punkt 5). The actions are in the
  // action card above (Hantera anläggningar), so the card's header is only its name and where it lies. The jobs' number has
  // its own grey word of one line's height while it is read, so nothing moves when it comes.
  const overview = <dl className="place-overview-facts" data-testid="place-summary-facts">
    <div><dt>Vald nivå</dt><dd data-testid="place-summary-level">{placeLevelName(depth)}</dd></div>
    <div><dt>{depth === 0 ? "Objekt" : "Underobjekt"}</dt><dd className="tabular-nums" data-testid="place-summary-children">{under.length}</dd></div>
    <div><dt>Registrerade arbetsordrar</dt><dd className="tabular-nums" data-testid="place-summary-jobs">{detail ? detail.history.total : pending ? <SkeletonText className="w-8" /> : (place.links ?? 0)}</dd></div>
  </dl>;
  return <div data-testid="place-detail" data-place-id={place.id}>
    <Panel title={placeName(place)} description={where} className="place-pane-panel"
      leadingActions={<span className="place-icon" data-level={level} aria-hidden="true">{createElement(placeIcon(place, level))}</span>}>
      <div className="space-y-5" data-testid="place-content">
        {overview}
        {content}
        {!notice && !description && !facts.length && !due.length && !detail && !pending ? <p className="text-sm text-muted-foreground">Inget gjort här ännu.</p> : null}
      </div>
    </Panel>
  </div>;
}
