"use client";

import { plural } from "@/lib/plural";
import { useModuleOn } from "@/features/workflow/use-modules";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Boxes, ChevronsDownUp, ChevronsUpDown, ClipboardList, Cog, Factory, Gauge, ImageIcon, Layers, ListTree, MapPin, Move, PackageMinus, Pencil, Plus, Rows3, Trash2, Wallet, type LucideIcon,
} from "lucide-react";
import { AreaIcon } from "@/components/area-icon";
import { IconActionBar } from "@/components/icon-action-bar";
import { useEntryState } from "@/components/history-nav";
import { ListFilterBar } from "@/components/list-filter-bar";
import { PageHeader, PageSkeleton } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RemoveButton } from "@/components/ui/remove-button";
import { ListGroup, ListRow, NativeActions, NativePickerRow } from "@/components/native/list";
import { DialogActions, Empty, Field, Modal, Panel, PanelAreaProvider, RowsSkeleton } from "@/features/kfid/ui";
import { useConfirm } from "@/features/kfid/confirm";
import { PartMachineEvents, PartMachineKeyFigures } from "@/features/integrations/machine-status";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { placeIcon, placeParentIds, PlaceTreeView, typeIcon, type PlaceTreeDrag, type PlaceTreeLevel } from "@/features/workflow/place-tree";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { ArticleSearchField } from "@/features/workflow/catalogue-picker";
import { PhotoPicker } from "@/features/self-inspection/deviation-photos";
import { formatSwedish } from "@/lib/swedish-time";
import { announce } from "@/lib/workflow/toast";
import { cn } from "@/lib/utils";
import { useLoadEffect } from "@/lib/use-load-effect";
import { formatDowntime, MAINTENANCE_PRIORITY_LABELS, MAINTENANCE_TYPE_LABELS, type MaintenancePriority, type MaintenanceType } from "@/lib/workflow/maintenance";
import {
  ITEM_SOURCE_LABELS, ITEM_STATUS_LABELS, PART_STATUS_LABELS, PART_STATUS_TONES, PART_STATUSES, partPath, quantityText, rootsOf, subtreeIds, type PartListItem, type PartStatus,
} from "@/lib/maintenance/model";
import {
  childLevelName, nextPlaceLevel, partLevelName, partRollups, PLACE_ALL, placeChoice, PLACE_LEVEL_LABELS, PLACE_NONE, placeLevelsUnder, placePath, placeProblem, placeRollups, placeSubtree, rollupBadges,
  type PlaceLevel, type PlaceListItem, type PlaceRollup,
} from "@/lib/maintenance/place-model";
import { filterPartTree, PART_FILTER_LABEL, PART_FILTERS, type PartFilter } from "@/lib/maintenance/tree-filter";
import { moveBody, placesHolding, planTreeDrop, treeAncestors, wholeTreeParent, type WholeTreeItem } from "@/lib/maintenance/tree-move";
import { runHoursHeldText } from "@/lib/machine/run-hours";
import { hoursText, kronor, maintenanceGet, maintenancePost, partImageUrl, uploadPartImage, type Cost, type ItemRow, type PartDetail, type Spare, type Tree } from "./maintenance-api";
import { MaintenanceItemEditor, NewItemDialog, WithdrawDialog } from "./maintenance-item-editor";
import { MaintenanceHeader, NEW_BUTTON_WIDTH, type MaintenanceView } from "./maintenance-header";
import { StoreView } from "./maintenance-store";
import { PartPlans } from "./maintenance-plans";
import { FigureBox } from "./maintenance-figures";
import { partOptions } from "./part-picker";
import { useSetQuery } from "./use-set-query";

/**
 * Underhåll (2026-10-30; the look of the proposal app/design-lab/arbetsorder-hallare, view underhall): the module's
 * own page – Anläggning (2026-11-02: left one tree, places with their machines and parts folding out, rows can be dragged;
 * right the machine's card with the tab Delar, a part opens its own card, the light icon menu over them) and Förråd. A maintenance item opens as a
 * page of its own (`&item=`). Cloud only; the server decides who sees and changes what. Återkommande underhåll (2026-10-30) is
 * the part's tab Planer (./maintenance-plans.tsx); its work orders show in Planering → Kalender. The page's head and filter
 * row follow Projekt (2026-10-31): ./maintenance-header.tsx and the shared ListFilterBar.
 */
const TABS = ["Översikt", "Delar", "Bilder", "Händelser", "Reservdelar", "Underhållsposter", "Planer", "Kostnad"] as const;
type Tab = (typeof TABS)[number];
const when = (value: string) => formatSwedish(value, { dateStyle: "short", timeStyle: "short" });
const chip = (on: boolean) => cn("touch-target h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-sm", on ? "border-primary/30 bg-secondary font-medium" : "text-muted-foreground hover:text-foreground");
const asTreeItem = (part: PartListItem) => ({ ...part, customerId: part.customerId ?? "", address: "", postalCode: "", city: "", description: "", objectType: part.partType });
type TreeItem = ReturnType<typeof asTreeItem>;
const partIcon = (part: Pick<TreeItem, "name" | "partType">, level: PlaceTreeLevel): LucideIcon => /linje/i.test(part.partType) ? Rows3 : placeIcon({ name: part.name, objectType: part.partType }, level === "address" ? "object" : level);
/**
 * A machine (a part without a parent) has the factory, unless its type or name says what it is (2026-11-02: a press is a
 * hammer, not a cog). The tree and the part card use the same rule, so they always agree.
 */
const machineIcon = (part: Pick<TreeItem, "name" | "partType">): LucideIcon => /linje/i.test(part.partType) ? Rows3 : typeIcon(`${part.partType} ${part.name}`) ?? Factory;
/** A part card: the same symbol as its row in the tree (a part is always at least two steps in). */
const partCardIcon = (part: Pick<TreeItem, "name" | "partType" | "parentId">): LucideIcon => part.parentId ? partIcon(part, "sub") : machineIcon(part);

// The place tree: the same row as the customers' places, and "Alla platser" and "Utan plats" as rows of their own around it.
const asPlaceItem = (place: PlaceListItem) => ({ ...place, customerId: "", address: "", postalCode: "", city: "", description: "", isActive: true });
type PlaceTreeItem = ReturnType<typeof asPlaceItem>;
const pseudoPlace = (id: string, name: string): PlaceTreeItem => asPlaceItem({ id, parentId: null, name, level: "SITE", notes: "", version: 0 });
const ALL_PLACES = pseudoPlace(PLACE_ALL, "Alla platser");
const NO_PLACE = pseudoPlace(PLACE_NONE, "Utan plats");
const EMPTY_SET: ReadonlySet<string> = new Set();
const placeTreeIcon = (item: PlaceTreeItem): LucideIcon => item.id === PLACE_ALL ? Layers : item.id === PLACE_NONE ? Boxes : MapPin;

// The whole tree (2026-11-02): a row is a place, Utan plats, a machine or a part, and each keeps the look it has elsewhere.
type WholeRow = (PlaceTreeItem | TreeItem) & WholeTreeItem;
const wholePlaceRow = (place: PlaceTreeItem): WholeRow => ({ ...place, treeKind: place.id === PLACE_NONE ? "none" : "place" });
const wholePartRow = (part: TreeItem, placeIds: ReadonlySet<string>): WholeRow => part.parentId ? { ...part, treeKind: "part" } : { ...part, parentId: wholeTreeParent(part, placeIds), treeKind: "machine" };
const wholeIcon = (row: WholeRow, level: PlaceTreeLevel): LucideIcon => row.treeKind === "machine" ? machineIcon(row as TreeItem) : row.treeKind === "part" ? partIcon(row as TreeItem, level) : placeTreeIcon(row as PlaceTreeItem);

export function MaintenancePage() {
  const search = useSearchParams();
  const itemId = search.get("item");
  const view: MaintenanceView = search.get("tab") === "store" ? "store" : "machines";
  const setQuery = useSetQuery();
  if (itemId) return <MaintenanceItemEditor key={itemId} itemId={itemId} onClose={(partId) => { setQuery({ item: null, part: partId ?? search.get("part") }); }} />;
  return <PanelAreaProvider area="maintenance"><div data-testid="maintenance-page">
    {view === "store" ? <StoreView /> : <MachinesView partId={search.get("part")} placeParam={search.get("place")} />}
  </div></PanelAreaProvider>;
}

// ---------- Anläggning: the two trees ----------

function MachinesView({ partId, placeParam }: { partId: string | null; placeParam: string | null }) {
  const native = useNativeMode();
  const setQuery = useSetQuery();
  const [tree, setTree] = useState<Tree | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<ReadonlySet<string> | null>(null);
  const [filterFolded, setFilterFolded] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [q, setQ] = useEntryState("maintenance.q", "");
  const [filter, setFilter] = useEntryState<PartFilter>("maintenance.status", "all");
  const [editing, setEditing] = useState<{ mode: "machine" | "child" | "edit" } | { mode: "place" | "edit-place" } | { mode: "move" } | null>(null);
  const [detail, setDetail] = useState<PartDetail | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const loadTree = useCallback(async () => {
    try { setTree(await maintenanceGet<Tree>("part=tree")); setError(""); } catch (cause) { setError((cause as Error).message); }
  }, []);
  useLoadEffect(loadTree);
  const places = useMemo(() => tree?.places ?? [], [tree]);
  const parts = useMemo(() => tree?.parts ?? [], [tree]);
  const items = useMemo(() => parts.map(asTreeItem), [parts]);
  const rollups = useMemo(() => partRollups(parts), [parts]);
  const placeSums = useMemo(() => placeRollups(places, parts.filter((part) => !part.parentId).map((part) => ({ ...part, rollup: rollups.get(part.id) ?? { reported: 0, outOfService: 0, serviceSoon: 0, worst: "IN_SERVICE" as const } }))), [parts, places, rollups]);
  const chosen = partId && items.some((item) => item.id === partId) ? partId : null;
  const chosenItem = chosen ? items.find((item) => item.id === chosen) ?? null : null;
  const rootIds = useMemo(() => rootsOf(items), [items]);
  const chosenRoot = chosen ? items.find((item) => item.id === rootIds.get(chosen)) ?? null : null;
  const choice = placeChoice(placeParam, places, chosenRoot ? chosenRoot.placeId : undefined);
  const realPlace = places.find((place) => place.id === choice) ?? null;
  // Search and Driftstatus work on the whole tree: a match stays with everything above it, folded out so that it is seen.
  const listed = filterPartTree(items, { filter, q });
  const placeItems = useMemo(() => places.map(asPlaceItem), [places]);
  const placeIds = useMemo(() => new Set(places.map((place) => place.id)), [places]);
  const shownPlaces = listed.filtering ? placesHolding(placeItems, listed.shown.filter((item) => !item.parentId).map((item) => item.placeId)) : placeItems;
  const shownParts = listed.shown.map((item) => wholePartRow(item, placeIds));
  const unplaced = new Set(shownParts.filter((row) => row.treeKind === "machine" && row.parentId === PLACE_NONE).map((row) => row.id));
  const inUnplaced = (row: WholeRow) => unplaced.has(rootIds.get(row.id) ?? row.id);
  const placeRows: WholeRow[] = [...shownPlaces.map(wholePlaceRow), ...shownParts.filter((row) => !inUnplaced(row))];
  const noneRows: WholeRow[] = unplaced.size ? [wholePlaceRow(NO_PLACE), ...shownParts.filter(inUnplaced)] : [];
  // Only the answer for the part still chosen is kept: a new part is chosen before the tree is read again, so an older
  // answer (the part chosen meanwhile) can arrive last and would leave "Hämtar delen…" for good.
  const chosenRef = useRef(chosen);
  useEffect(() => { chosenRef.current = chosen; }, [chosen]);
  const loadDetail = useCallback(async () => {
    if (!chosen) { setDetail(null); return; }
    try { const next = await maintenanceGet<PartDetail>(`part=detail&id=${encodeURIComponent(chosen)}`); if (chosenRef.current === chosen) setDetail(next); }
    catch (cause) { if (chosenRef.current === chosen) announce((cause as Error).message, true); }
  }, [chosen]);
  useLoadEffect(loadDetail);
  // On the phone a part is a screen of its own (a new entry, so Bakåt leads to the tree); beside the tree it replaces the entry.
  const selectPart = useCallback((id: string) => setQuery({ part: id, place: null }, native), [native, setQuery]);
  const selectPlace = (id: string) => setQuery({ place: id === PLACE_ALL ? null : id, part: null });
  const parents = [...placeParentIds(placeRows), ...placeParentIds(noneRows)];
  // From the start the places and Utan plats are folded out, the machines folded; the chosen row is always reachable (below).
  const startOpen = [PLACE_NONE, ...placeIds];
  const baseOpen: ReadonlySet<string> = open ?? new Set(startOpen);
  const treeOpen: ReadonlySet<string> = listed.filtering ? new Set(parents.filter((id) => !filterFolded.has(id))) : baseOpen;
  const toggle = (id: string) => {
    if (listed.filtering) { setFilterFolded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); return; }
    setOpen((current) => { const next = new Set(current ?? startOpen); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  // A part chosen from the card, a link or the search is shown in the tree: what is above it folds out, once for each choice.
  const allRows = useMemo(() => [...places.map((place) => ({ id: place.id, parentId: place.parentId })), ...items.map((item) => ({ id: item.id, parentId: wholeTreeParent(item, placeIds) }))], [places, items, placeIds]);
  const [unfoldedFor, setUnfoldedFor] = useState<string | null>(null);
  if (chosen !== unfoldedFor) {
    setUnfoldedFor(chosen);
    if (chosen) setOpen((current) => new Set([...(current ?? startOpen), ...treeAncestors(allRows, chosen)]));
  }
  const canEdit = Boolean(tree?.canEdit);
  const part = detail?.part.id === chosen ? detail : null;
  const pathOf = (place: string | null) => placePath(places, place);
  const removePart = async () => {
    if (!part) return;
    if (!(await confirm({ title: `Ta bort ${part.part.name}?`, message: "Den tas bort med sina bilder. Har den historik går den inte att ta bort. Pausa den i stället.", confirmLabel: "Ta bort", tone: "danger" }))) return;
    try {
      await maintenancePost({ action: "delete_part", id: part.part.id });
      announce(`${part.part.name} togs bort.`);
      setQuery({ part: part.part.parentId });
      await loadTree();
    } catch (cause) { announce((cause as Error).message, true); }
  };
  const removePlace = async () => {
    if (!realPlace) return;
    if (!(await confirm({ title: `Ta bort ${realPlace.name}?`, message: "En plats som har maskiner eller platser under sig kan inte tas bort. Flytta dem först.", confirmLabel: "Ta bort", tone: "danger" }))) return;
    try {
      await maintenancePost({ action: "delete_place", id: realPlace.id });
      announce(`${realPlace.name} togs bort.`);
      setQuery({ place: realPlace.parentId, part: null });
      await loadTree();
    } catch (cause) { announce((cause as Error).message, true); }
  };
  const reload = async () => { await Promise.all([loadTree(), loadDetail()]); };
  // Dra och släpp (2026-11-02): the same rules and the same actions as Flytta and Redigera. A move has no undo (neither has Flytta): it is moved back.
  const dragged = useRef<WholeRow | null>(null);
  const dropOn = (target: WholeRow) => dragged.current ? planTreeDrop({ parts, places, dragged: dragged.current, targetId: target.id }) : ({ act: "same" } as const);
  const moveTo = async (row: WholeRow, target: WholeRow) => {
    const plan = planTreeDrop({ parts, places, dragged: row, targetId: target.id });
    if (plan.act === "same") return;
    if (plan.act === "refuse") { announce(plan.reason, true); return; }
    try {
      if (plan.act === "place") {
        const place = places.find((item) => item.id === row.id)!;
        await maintenancePost({ action: "update_place", id: place.id, version: place.version, place: { parentId: plan.parentId, name: place.name, level: place.level, notes: place.notes } });
      } else {
        // The tree holds no versions or notes: the part is read as Flytta has it, so a part changed meanwhile is also moved as it is now.
        const fresh = await maintenanceGet<PartDetail>(`part=detail&id=${encodeURIComponent(row.id)}`);
        await maintenancePost({ action: "update_part", id: row.id, version: fresh.part.version, part: moveBody(fresh.part, plan) });
      }
      announce(`${row.name} är flyttad.`);
      if (target.id !== PLACE_ALL) setOpen((current) => new Set([...(current ?? startOpen), target.id]));
      await reload();
    } catch (cause) { announce((cause as Error).message, true); }
  };
  const treeDrag: PlaceTreeDrag<WholeRow> | undefined = canEdit && !native ? {
    canDrag: (row) => row.treeKind !== "none" && row.id !== PLACE_ALL,
    start: (row) => { dragged.current = row; },
    end: () => { dragged.current = null; },
    active: () => dragged.current !== null,
    verdict: (target) => { const plan = dropOn(target); return plan.act === "same" ? "same" : plan.act === "refuse" ? "refused" : "ok"; },
    drop: (target) => { const row = dragged.current; dragged.current = null; if (row) void moveTo(row, target); },
  } : undefined;
  const noEdit = canEdit ? null : "Du får inte ändra i Underhåll.";
  const newLabel = part ? `Ny ${childLevelName(part.part.depth).toLowerCase()}` : "Ny maskin";

  // Level 1 (the phone): a part is a screen of its own, pushed on top of the trees (as the customer card's place); the shell's
  // back leads to them. The screen has the part's name as its heading, no view choice and no filter row.
  const partScreen = native && Boolean(partId) && (!tree || Boolean(chosen));
  const top = partScreen ? null : <>
    <MaintenanceHeader view="machines" action={<Button type="button" className={NEW_BUTTON_WIDTH} data-testid="maintenance-new-root" onClick={() => setEditing({ mode: "machine" })}
      disabledReason={!tree ? "Hämtar anläggningen…" : noEdit}><Plus />Ny maskin</Button>} />
    <ListFilterBar testId="maintenance-tree-filter"
      chips={{ label: "Driftstatus", chips: PART_FILTERS.map((value) => ({ value, label: PART_FILTER_LABEL[value], count: tree ? listed.counts[value] : null })), value: filter, onChange: setFilter, testId: "maintenance-status-filter" }}
      search={{ label: "Sök bland maskiner och delar", placeholder: "Sök namn, typ eller märkning", value: q, onChange: setQ, testId: "maintenance-search" }} />
  </>;
  const rootClass = native ? "space-y-2" : "space-y-5";
  if (error) return <div className={rootClass}>{top}<p role="alert" className="notice text-destructive">{error}</p></div>;
  if (!tree) return <div className={rootClass}>{top}<PageSkeleton title={false} label="Hämtar anläggningen…" /></div>;
  const choiceName = choice === PLACE_ALL ? "Alla platser" : choice === PLACE_NONE ? "Utan plats" : realPlace?.name ?? "";
  const selectedLine = chosen && chosenItem
    ? [...pathOf(chosenRoot?.placeId ?? null), ...partPath(items, chosen), chosenItem.name].join(" › ")
    : realPlace ? pathOf(realPlace.id).join(" › ") : choiceName;
  const bar = <IconActionBar title="Hantera anläggning" label="Hantera anläggning" icon={<AreaIcon area="maintenance" icon={ListTree} tone="solid" />} line={`Vald: ${selectedLine}`} testId="maintenance-actions"
    groups={[
      [
        { key: "new-place", label: "Ny plats", icon: MapPin, testId: "maintenance-new-place", disabledReason: noEdit, onClick: () => setEditing({ mode: "place" }) },
        // Ny maskin is the head's (one template for page tops, 2026-11-02); here what goes under the chosen machine or part.
        { key: "new-part", label: part ? newLabel : "Ny del", icon: Plus, testId: "maintenance-new-part", disabledReason: noEdit ?? (part ? null : "Välj en maskin eller del först."), onClick: () => setEditing({ mode: "child" }) },
      ],
      [
        { key: "move", label: "Flytta", icon: Move, testId: "maintenance-move", disabledReason: noEdit ?? (part ? null : "Välj en maskin eller del först."), onClick: () => setEditing({ mode: "move" }) },
        { key: "edit", label: "Redigera", icon: Pencil, testId: "maintenance-edit", disabledReason: noEdit ?? (part || realPlace ? null : "Välj en plats, maskin eller del först."), onClick: () => setEditing(part ? { mode: "edit" } : { mode: "edit-place" }) },
        { key: "delete", label: "Ta bort", icon: Trash2, tone: "danger", testId: "maintenance-delete", disabledReason: noEdit ?? (part || realPlace ? null : "Välj en plats, maskin eller del först."), onClick: () => void (part ? removePart() : removePlace()) },
      ],
    ]}
    end={[
      { key: "open-all", label: "Fäll ut alla", icon: ChevronsUpDown, iconOnly: true, disabledReason: parents.every((id) => treeOpen.has(id)) ? "Allt i trädet är redan utfällt." : null, onClick: () => { setFilterFolded(EMPTY_SET); setOpen(new Set(parents)); } },
      { key: "fold-all", label: "Fäll ihop alla", icon: ChevronsDownUp, iconOnly: true, disabledReason: parents.some((id) => treeOpen.has(id)) ? null : "Allt i trädet är redan hopfällt.", onClick: () => { setFilterFolded(new Set(parents)); setOpen(new Set()); } },
    ]} />;
  const rowLine = (row: WholeRow) => {
    if (row.treeKind === "machine" || row.treeKind === "part") {
      const part = row as TreeItem;
      return <StatusLine text={[part.partType, part.status !== "IN_SERVICE" ? PART_STATUS_LABELS[part.status] : ""].filter(Boolean).join(" · ")} sum={rollups.get(row.id)} />;
    }
    const sum = placeSums.get(row.id);
    return <StatusLine text={row.treeKind === "none" || row.id === PLACE_ALL ? plural(sum?.machines ?? 0, "maskin", "maskiner") : PLACE_LEVEL_LABELS[(row as PlaceTreeItem).level]} sum={sum} />;
  };
  const openRow = (row: WholeRow) => { if (row.treeKind === "machine" || row.treeKind === "part") selectPart(row.id); else selectPlace(row.id); };
  const treeSelected = chosen ?? choice;
  const treeProps = { selected: treeSelected, icon: wholeIcon, line: rowLine, onOpen: openRow, drag: treeDrag } as const;
  const placeTree = <>
    <PlaceTreeView<WholeRow> {...treeProps} places={[{ ...ALL_PLACES, treeKind: "place" }]} open={EMPTY_SET} onToggle={() => undefined} label="Alla platser" testId="maintenance-place-all" />
    {placeRows.length ? <PlaceTreeView<WholeRow> {...treeProps} places={placeRows} open={treeOpen} onToggle={toggle} label="Platser, maskiner och delar" testId="maintenance-places" /> : null}
    {noneRows.length ? <PlaceTreeView<WholeRow> {...treeProps} places={noneRows} open={treeOpen} onToggle={toggle} label="Utan plats" testId="maintenance-place-none" /> : null}
    {listed.filtering && !listed.shown.length ? <Empty compact title="Inget matchar" description="Ändra sökningen eller filtret." />
      : !items.length && !places.length ? <Empty compact title="Inga maskiner än" description="Börja med Ny plats och Ny maskin." /> : null}
  </>;
  const dialog = !editing ? null
    : editing.mode === "place" || editing.mode === "edit-place" ? <PlaceDialog place={editing.mode === "edit-place" ? realPlace : null} parent={editing.mode === "place" ? realPlace : null} places={places} onClose={() => setEditing(null)}
      onSaved={async (id) => { setEditing(null); setQuery({ place: id, part: null }); await reload(); }} />
    : editing.mode === "move" ? part ? <MovePartDialog detail={part} parts={parts} places={places} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} /> : null
    : <PartDialog mode={editing.mode} detail={part} place={realPlace} owners={tree.owners} places={places} onClose={() => setEditing(null)}
      onSaved={async (id) => { setEditing(null); if (id) setQuery({ part: id }); await reload(); }} />;
  const placePane = <PlacePane choice={choice} place={realPlace} sum={placeSums.get(choice)} name={choiceName} path={realPlace ? pathOf(realPlace.parentId) : []} native={native} empty={!places.length && !parts.length} />;

  if (native) {
    if (!partScreen) return <div className={rootClass} data-testid="maintenance-explorer">
      {top}
      <ListGroup title="Platser och maskiner"><div role="listitem"><nav aria-label="Platser och maskiner" className="p-2">{placeTree}</nav></div></ListGroup>
      {placePane}
      {canEdit ? <NativeActions>
        <Button type="button" variant="ghost" onClick={() => setEditing({ mode: "place" })} data-testid="maintenance-new-place"><MapPin />Ny plats</Button>
        <Button type="button" variant="ghost" onClick={() => setEditing({ mode: "machine" })} data-testid="maintenance-new-root"><Factory />Ny maskin</Button>
        {realPlace ? <Button type="button" variant="ghost" onClick={() => setEditing({ mode: "edit-place" })} data-testid="maintenance-edit"><Pencil />Redigera {realPlace.name}</Button> : null}
      </NativeActions> : null}
      {dialog}{confirmElement}
    </div>;
    return <div className="space-y-2" data-testid="maintenance-part-screen">
      <PageHeader title={part?.part.name ?? "Maskin"} />
      {part ? <PartPane key={part.part.id} detail={part} parts={parts} native onChanged={reload} onOpenPart={selectPart} onEdit={() => setEditing({ mode: "edit" })} onMove={() => setEditing({ mode: "move" })} onNewChild={() => setEditing({ mode: "child" })} /> : <RowsSkeleton rows={4} label="Hämtar delen…" />}
      {dialog}{confirmElement}
    </div>;
  }
  return <div className={rootClass}>{top}<div className="place-explorer-wrap" data-testid="maintenance-explorer"><div className="place-explorer">
    <div className="place-explorer-bar">{bar}</div>
    <div className="place-explorer-tree">
      <Panel icon={ListTree} title="Platser och maskiner" className="place-tree-panel">
        <nav aria-label="Platser och maskiner" data-testid="maintenance-tree">{placeTree}</nav>
        {tree.truncated ? <p className="mt-2 text-xs text-muted-foreground">Bara de första 5 000 delarna visas.</p> : null}
      </Panel>
    </div>
    <div className="place-pane">
      {part ? <PartPane key={part.part.id} detail={part} parts={parts} onChanged={reload} onOpenPart={selectPart} onEdit={() => setEditing({ mode: "edit" })} onMove={() => setEditing({ mode: "move" })} onNewChild={() => setEditing({ mode: "child" })} />
        : chosen ? <Panel icon={Cog} title="Hämtar delen…"><RowsSkeleton rows={4} label="Hämtar delen…" /></Panel>
        : placePane}
    </div>
    {dialog}{confirmElement}
  </div></div></div>;
}

/** The second line of a row: a short text, and the worst status from what is under it (Felanmäld with its count). */
function StatusLine({ text, sum }: { text: string; sum?: { reported: number; outOfService: number; serviceSoon: number } }) {
  const badges = sum ? rollupBadges(sum) : [];
  if (!badges.length) return text ? <>{text}</> : null;
  return <span className="inline-flex max-w-full items-center gap-1" data-testid="maintenance-rollup">
    {badges.map((badge) => <span key={badge.label} className={cn("shrink-0 rounded px-1 text-[0.6875rem] font-medium", indicatorBadge(badge.tone))}>{badge.label}</span>)}
    {text ? <span className="truncate">{text}</span> : null}
  </span>;
}

/** Ny plats and Redigera: the fixed level names, only the levels that may lie here. */
function PlaceDialog({ place, parent, places, onClose, onSaved }: { place: PlaceListItem | null; parent: PlaceListItem | null; places: PlaceListItem[]; onClose: () => void; onSaved: (id: string) => Promise<void> }) {
  const initialParent = place ? place.parentId : parent && nextPlaceLevel(parent) ? parent.id : null;
  const [draft, setDraft] = useState({ name: place?.name ?? "", parentId: initialParent ?? "", level: (place?.level ?? nextPlaceLevel(places.find((row) => row.id === initialParent) ?? null) ?? "SITE") as PlaceLevel, notes: place?.notes ?? "" });
  const [busy, setBusy] = useState(false);
  const chosenParent = places.find((row) => row.id === draft.parentId) ?? null;
  const levels = placeLevelsUnder(chosenParent);
  const below = place ? placeSubtree(places, place.id) : [];
  const parentChoices = places.filter((row) => !below.includes(row.id) && placeLevelsUnder(row).length);
  const problem = placeProblem(places, place?.id ?? null, { parentId: draft.parentId || null, level: draft.level });
  const save = async () => {
    setBusy(true);
    try {
      const body = { parentId: draft.parentId || null, name: draft.name, level: draft.level, notes: draft.notes };
      const made = place ? await maintenancePost<{ id: string }>({ action: "update_place", id: place.id, version: place.version, place: body }) : await maintenancePost<{ id: string }>({ action: "create_place", place: body });
      announce("Platsen är sparad.");
      await onSaved(made.id);
    } catch (cause) { announce((cause as Error).message, true); } finally { setBusy(false); }
  };
  return <Modal open onOpenChange={(next) => { if (!next) onClose(); }} title={place ? `Redigera ${place.name}` : "Ny plats"} size="form">
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }} data-testid="maintenance-place-form">
      <Field id="mpl-name" label="Namn" required value={draft.name} placeholder="Till exempel Hall 2" onChange={(name) => setDraft({ ...draft, name })} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="mpl-parent" label="Ligger under" value={draft.parentId} options={["", ...parentChoices.map((row) => row.id)]} optionLabels={Object.fromEntries([["", "Översta nivån"], ...parentChoices.map((row) => [row.id, placePath(places, row.id).join(" › ")])])}
          onChange={(parentId) => { const next = placeLevelsUnder(places.find((row) => row.id === parentId) ?? null); setDraft({ ...draft, parentId, level: next.includes(draft.level) ? draft.level : next[0] ?? draft.level }); }} />
        <Field id="mpl-level" label="Nivå" value={draft.level} options={[...levels]} optionLabels={PLACE_LEVEL_LABELS} onChange={(level) => setDraft({ ...draft, level: level as PlaceLevel })} />
      </div>
      <Field id="mpl-notes" label="Anteckningar" multiline value={draft.notes} onChange={(notes) => setDraft({ ...draft, notes })} />
      {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: place ? "Spara" : "Skapa", type: "submit", busy, busyLabel: "Sparar…", disabledReason: !draft.name.trim() ? "Skriv ett namn först." : problem || null, testId: "maintenance-place-save" }} />
    </form>
  </Modal>;
}

/** Ny maskin (on the chosen place), Ny komponent or Ny del (under the chosen part) and Redigera – one form, the same fields. */
function PartDialog({ mode, detail, place, owners, places, onClose, onSaved }: { mode: "machine" | "child" | "edit"; detail: PartDetail | null; place: PlaceListItem | null; owners: Tree["owners"]; places: PlaceListItem[]; onClose: () => void; onSaved: (id: string | null) => Promise<void> }) {
  const current = mode === "edit" ? detail?.part ?? null : null;
  const [draft, setDraft] = useState({
    name: current?.name ?? "", partType: current?.partType ?? "", marking: current?.marking ?? "", status: (current?.status ?? "IN_SERVICE") as PartStatus,
    notes: current?.notes ?? "", runHours: current?.runHours === null || current?.runHours === undefined ? "" : String(current.runHours), customerId: current?.customerId ?? "", isActive: current?.isActive ?? true,
    placeId: current?.placeId ?? place?.id ?? "",
  });
  const [busy, setBusy] = useState(false);
  const machine = mode === "machine" || (mode === "edit" && !current?.parentId);
  const parentId = mode === "child" ? detail?.part.id ?? null : current?.parentId ?? null;
  const level = mode === "machine" ? "Maskin" : mode === "child" ? childLevelName(detail?.part.depth ?? 0) : partLevelName(current?.depth ?? 0);
  const title = mode === "machine" ? "Ny maskin" : mode === "child" ? `Ny ${level.toLowerCase()} under ${detail?.part.name ?? ""}` : `Redigera ${current?.name ?? ""}`;
  const save = async () => {
    const runHours = draft.runHours.trim() === "" ? null : Number(draft.runHours.replace(",", "."));
    if (runHours !== null && !(Number.isFinite(runHours) && runHours >= 0)) { announce("Drifttimmar ska vara ett tal.", true); return; }
    setBusy(true);
    try {
      const hoursEdited = draft.runHours.trim() !== (current?.runHours === null || current?.runHours === undefined ? "" : String(current.runHours));
      const body = { parentId, placeId: machine ? draft.placeId || null : null, customerId: machine && draft.customerId ? draft.customerId : null, name: draft.name, partType: draft.partType, marking: draft.marking, status: draft.status, notes: draft.notes, ...(hoursEdited ? { runHours } : {}), isActive: draft.isActive };
      if (current) { await maintenancePost({ action: "update_part", id: current.id, version: current.version, part: body }); await onSaved(current.id); announce(`${level}en är sparad.`); }
      else { const made = await maintenancePost<{ id: string }>({ action: "create_part", part: body }); await onSaved(made.id); announce(`${level}en är skapad.`); }
    } catch (cause) { announce((cause as Error).message, true); } finally { setBusy(false); }
  };
  return <Modal open onOpenChange={(next) => { if (!next) onClose(); }} title={title} size="form">
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }} data-testid="maintenance-part-form">
      <Field id="mp-name" label="Namn" required value={draft.name} placeholder={machine ? "Till exempel Press 4" : "Till exempel Hydraulpump"} onChange={(name) => setDraft({ ...draft, name })} />
      {machine ? <Field id="mp-place" label="Plats" value={draft.placeId} options={["", ...places.map((row) => row.id)]} optionLabels={Object.fromEntries([["", "Utan plats"], ...places.map((row) => [row.id, placePath(places, row.id).join(" › ")])])} onChange={(placeId) => setDraft({ ...draft, placeId })} /> : null}
      {/* A company without a customer register never sees the owner: its machines are its own. */}
      {machine && (owners.length || draft.customerId) ? <Field id="mp-owner" label="Ägare" value={draft.customerId} options={["", ...owners.map((owner) => owner.id)]} optionLabels={Object.fromEntries([["", "Eget"], ...owners.map((owner) => [owner.id, owner.name])])}
        onChange={(customerId) => setDraft({ ...draft, customerId })} help="Kunden ser inte maskinen." /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="mp-type" label="Typ" value={draft.partType} placeholder="Pump, Motor, Fläkt …" suggestions={["Press", "Pump", "Motor", "Fläkt", "Kompressor", "Transportband", "Växellåda"]} onChange={(partType) => setDraft({ ...draft, partType })} />
        <Field id="mp-marking" label="Märkning" value={draft.marking} placeholder="Till exempel P4-HP1" onChange={(marking) => setDraft({ ...draft, marking })} />
        <Field id="mp-status" label="Status" value={draft.status} options={[...PART_STATUSES]} optionLabels={PART_STATUS_LABELS} onChange={(status) => setDraft({ ...draft, status: status as PartStatus })} />
        <Field id="mp-hours" label="Drifttimmar" value={draft.runHours} type="text" placeholder="Valfritt" onChange={(runHours) => setDraft({ ...draft, runHours })} help={detail?.part.runHoursFeed && current ? `Följer ${detail.part.runHoursFeed.signalName}. Det du skriver gäller från nu.` : undefined} />
      </div>
      <Field id="mp-notes" label="Anteckningar" multiline value={draft.notes} onChange={(notes) => setDraft({ ...draft, notes })} />
      {current ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: !event.target.checked })} />Pausad</label> : null}
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: current ? "Spara" : "Skapa", type: "submit", busy, busyLabel: "Sparar…", disabledReason: draft.name.trim() ? null : "Skriv ett namn först.", testId: "maintenance-part-save" }} />
    </form>
  </Modal>;
}

/**
 * Flytta: a machine to another place (or Utan plats), or a part to lie under another. Choosing a place makes it a machine, so an older
 * tree where a hall or a line stood as the top can be put right by hand. Everything under it follows, and its history stays.
 */
function MovePartDialog({ detail, parts, places, onClose, onSaved }: { detail: PartDetail; parts: readonly PartListItem[]; places: PlaceListItem[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { part } = detail;
  const start = part.parentId ? `part:${part.parentId}` : part.placeId ? `place:${part.placeId}` : PLACE_NONE;
  const [target, setTarget] = useState(start);
  const [busy, setBusy] = useState(false);
  const below = subtreeIds(parts, part.id);
  const partChoices = partOptions(parts, null, places).filter((row) => !below.includes(row.id));
  const options = [PLACE_NONE, ...places.map((row) => `place:${row.id}`), ...partChoices.map((row) => `part:${row.id}`)];
  const labels = Object.fromEntries<string>([[PLACE_NONE, "Utan plats (som maskin)"], ...places.map((row): [string, string] => [`place:${row.id}`, `Plats: ${placePath(places, row.id).join(" › ")}`]),
    ...partChoices.map((row): [string, string] => [`part:${row.id}`, `Under: ${row.label}`])]);
  const save = async () => {
    setBusy(true);
    try {
      const parentId = target.startsWith("part:") ? target.slice(5) : null;
      const placeId = target.startsWith("place:") ? target.slice(6) : null;
      await maintenancePost({ action: "update_part", id: part.id, version: part.version, part: moveBody(part, { parentId, placeId }) });
      announce(`${part.name} är flyttad.`);
      await onSaved();
    } catch (cause) { announce((cause as Error).message, true); } finally { setBusy(false); }
  };
  return <Modal open onOpenChange={(next) => { if (!next) onClose(); }} title={`Flytta ${part.name}`} size="form">
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }} data-testid="maintenance-move-form">
      <Field id="mm-target" label="Till" value={target} options={options} optionLabels={labels} onChange={setTarget} help="Allt under följer med. Historiken finns kvar." />
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Flytta", type: "submit", busy, busyLabel: "Flyttar…", disabledReason: target === start ? "Välj vart den ska flyttas." : null, testId: "maintenance-move-save" }} />
    </form>
  </Modal>;
}

/** The place's card (Alla platser and Utan plats too): how many machines, what is wrong under it, and the cost summed upward. */
function PlacePane({ choice, place, sum, name, path, native, empty }: { choice: string; place: PlaceListItem | null; sum?: PlaceRollup; name: string; path: string[]; native: boolean; empty: boolean }) {
  const [cost, setCost] = useState<Cost | null>(null);
  const [costError, setCostError] = useState("");
  const load = useCallback(async () => {
    try { setCost(await maintenanceGet<Cost>(`part=place_cost&id=${encodeURIComponent(choice)}`)); setCostError(""); } catch (cause) { setCostError((cause as Error).message); }
  }, [choice]);
  useLoadEffect(load);
  const badges = sum ? rollupBadges(sum) : [];
  const content = empty ? <Empty compact title="Inget här än" description="Börja med Ny plats, till exempel Fabriken, och Ny maskin." /> : <div className="@container space-y-4" data-testid="maintenance-place">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {badges.map((badge) => <Badge key={badge.label} variant="outline" className={indicatorBadge(badge.tone)} data-testid="maintenance-place-status">{badge.label}</Badge>)}
      {!badges.length && sum?.machines ? <Badge variant="outline" className={indicatorBadge("success")} data-testid="maintenance-place-status">Inget fel</Badge> : null}
      {place ? <span>{PLACE_LEVEL_LABELS[place.level]}</span> : null}
      {path.length ? <span>{path.join(" › ")}</span> : null}
    </div>
    <dl className="grid grid-cols-2 gap-3 text-sm @2xl:grid-cols-4">
      <FigureBox label="Maskiner" value={String(sum?.machines ?? 0)} testId="maintenance-place-machines" />
      <FigureBox label="Felanmälda" value={String(sum?.reported ?? 0)} testId="maintenance-place-reported" />
      <FigureBox label="Ur drift" value={String(sum?.outOfService ?? 0)} />
      <FigureBox label="Kostnad" value={cost ? (cost.pricesVisible ? kronor(cost.totals.total) : hoursText(cost.totals.hours)) : "…"} hint={cost ? plural(cost.totals.orders, "arbetsorder", "arbetsordrar") : undefined} testId="maintenance-place-cost" />
    </dl>
    {place?.notes ? <p className="whitespace-pre-wrap text-sm">{place.notes}</p> : null}
    {choice === PLACE_NONE ? <p className="text-sm text-muted-foreground" data-testid="maintenance-none-help">Maskiner som inte står på någon plats. Välj en och flytta den med Flytta, eller ta bort den.</p> : null}
    <CostBody cost={cost} error={costError} scopeText="Allt på platsen och under den." />
  </div>;
  if (native) return <div className="native-group p-4">{content}</div>;
  return <Panel icon={MapPin} title={name}>{content}</Panel>;
}

// ---------- the chosen part ----------

function PartPane({ detail, parts, native = false, onChanged, onOpenPart, onEdit, onMove, onNewChild }: { detail: PartDetail; parts: readonly PartListItem[]; native?: boolean; onChanged: () => Promise<void>; onOpenPart: (id: string) => void; onEdit: () => void; onMove: () => void; onNewChild: () => void }) {
  const [tab, setTab] = useState<Tab>("Översikt");
  const [bigImage, setBigImage] = useState<PartDetail["images"][number] | null>(null);
  const { part } = detail;
  const main = detail.images.find((image) => image.isMain) ?? null;
  const rollup = useMemo(() => partRollups(parts).get(part.id), [parts, part.id]);
  // The part keeps its own status; what is reported on it or under it stands beside (Felanmäld with its count).
  const ownBadges = rollup ? rollupBadges({ reported: rollup.reported, outOfService: 0, serviceSoon: 0 }) : [];
  const levelName = partLevelName(part.depth);
  // The way down: every step opens its own card; the place is only said.
  const way = useMemo(() => {
    const byId = new Map(parts.map((row) => [row.id, row]));
    const steps: { id: string; name: string }[] = [];
    const seen = new Set<string>([part.id]);
    let current = part.parentId ? byId.get(part.parentId) : undefined;
    while (current && !seen.has(current.id)) { seen.add(current.id); steps.unshift({ id: current.id, name: current.name }); current = current.parentId ? byId.get(current.parentId) : undefined; }
    return steps;
  }, [parts, part.id, part.parentId]);
  const facts = <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" data-testid="maintenance-part-facts">
    <Badge variant="outline" className={indicatorBadge(PART_STATUS_TONES[part.status])} data-testid="maintenance-part-status">{PART_STATUS_LABELS[part.status]}</Badge>
    {ownBadges.map((badge) => <Badge key={badge.label} variant="outline" className={indicatorBadge(badge.tone)} data-testid="maintenance-part-reported">{badge.label}</Badge>)}
    {part.isActive ? null : <Badge variant="outline" className={indicatorBadge("neutral")}>Pausad</Badge>}
    <span data-testid="maintenance-part-level">{levelName}</span>
    <span className="inline-flex flex-wrap items-center gap-x-1" data-testid="maintenance-part-way">
      <span>{part.placePath.length ? part.placePath.join(" › ") : "Utan plats"}</span>
      {way.map((step) => <span key={step.id} className="inline-flex items-center gap-x-1"><span aria-hidden="true">›</span><button type="button" className="underline-offset-2 hover:underline" onClick={() => onOpenPart(step.id)} data-testid="maintenance-part-up">{step.name}</button></span>)}
      <span aria-hidden="true">›</span><span className="font-medium text-foreground">{part.name}</span>
    </span>
    {part.marking ? <span>Märkning {part.marking}</span> : null}
    {!part.parentId && part.ownerName ? <span>Kund: {part.ownerName}</span> : null}
  </div>;
  const mainImage = <div className="h-40 overflow-hidden rounded-lg border bg-muted/40 sm:h-52" data-testid="maintenance-main-image">
    {main ? <button type="button" className="block size-full" onClick={() => setBigImage(main)} aria-label={`Visa ${main.name}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the company's own picture, read through the server's access check */}
      <img src={partImageUrl(main.id)} alt={main.name} className="size-full object-cover" />
    </button> : <button type="button" className="flex size-full flex-col items-center justify-center gap-1 text-sm text-muted-foreground" onClick={() => setTab("Bilder")}>
      <ImageIcon className="size-6" aria-hidden="true" />Ingen bild – lägg till under Bilder</button>}
  </div>;
  const content = tab === "Översikt" ? <Overview detail={detail} onEdit={onEdit} onMove={onMove} onChanged={onChanged} />
    : tab === "Delar" ? <PartsTab detail={detail} parts={parts} onOpenPart={onOpenPart} onNewChild={onNewChild} />
    : tab === "Bilder" ? <Images detail={detail} onChanged={onChanged} onOpen={setBigImage} />
    : tab === "Händelser" ? <PartMachineEvents partId={part.id} />
    : tab === "Reservdelar" ? <Spares detail={detail} onChanged={onChanged} />
    : tab === "Underhållsposter" ? <Items detail={detail} onChanged={onChanged} />
    : tab === "Planer" ? <PartPlans partId={part.id} />
    : <CostTab partId={part.id} />;
  const big = <Modal open={Boolean(bigImage)} onOpenChange={(value) => { if (!value) setBigImage(null); }} title={bigImage?.name ?? "Bild"}>
    {bigImage ? <div className="space-y-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- the company's own picture */}
      <img src={partImageUrl(bigImage.id)} alt={bigImage.name} className="max-h-[70dvh] w-full rounded-lg border object-contain" data-testid="maintenance-big-image" />
      {detail.canEdit ? <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabledReason={bigImage.isMain ? "Bilden är redan huvudbild." : null} onClick={async () => {
          try { await maintenancePost({ action: "main_image", id: bigImage.id }); setBigImage(null); announce("Huvudbilden är bytt."); await onChanged(); } catch (cause) { announce((cause as Error).message, true); }
        }}>Gör till huvudbild</Button>
        <Button type="button" variant="outline" className="text-destructive" onClick={async () => {
          try { await maintenancePost({ action: "delete_image", id: bigImage.id }); setBigImage(null); announce("Bilden togs bort."); await onChanged(); } catch (cause) { announce((cause as Error).message, true); }
        }}><Trash2 />Ta bort</Button>
      </div> : null}
    </div> : null}
  </Modal>;
  if (native) return <div className="space-y-2" data-testid="maintenance-part">
    <div className="px-1">{facts}</div>
    {mainImage}
    <ListGroup>
      <NativePickerRow label="Visa" display={tab} testId="maintenance-tab-picker">
        <select aria-label="Delens flik" value={tab} onChange={(event) => setTab(event.target.value as Tab)}>{TABS.map((item) => <option key={item} value={item}>{item}</option>)}</select>
      </NativePickerRow>
    </ListGroup>
    <div className="native-group min-h-80 p-4" data-testid="maintenance-part-content">{content}</div>
    {big}
  </div>;
  return <Panel icon={partCardIcon(part)} title={part.name} leadingIcon={main
    // eslint-disable-next-line @next/next/no-img-element -- the company's own picture
    ? <img src={partImageUrl(main.id)} alt="" className="size-8 shrink-0 rounded-md border object-cover" data-testid="maintenance-part-thumb" /> : undefined}>
    <div data-testid="maintenance-part">
      <div className="mb-3">{facts}</div>
      <div className="mb-4">{mainImage}</div>
      <div className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="group" aria-label="Delens flikar">
        {TABS.map((item) => <button key={item} type="button" aria-current={tab === item ? "true" : undefined} onClick={() => setTab(item)} className={chip(tab === item)} data-testid={`maintenance-tab-${item}`}>{item}</button>)}
      </div>
      <div className="min-h-80" data-testid="maintenance-part-content">{content}</div>
    </div>
    {big}
  </Panel>;
}

/** The tab Delar: everything under the part as a tree. A row opens that part's own card; the arrow folds. */
function PartsTab({ detail, parts, onOpenPart, onNewChild }: { detail: PartDetail; parts: readonly PartListItem[]; onOpenPart: (id: string) => void; onNewChild: () => void }) {
  const { part } = detail;
  const items = useMemo(() => {
    const below = new Set(subtreeIds(parts, part.id));
    below.delete(part.id);
    return parts.filter((row) => below.has(row.id)).map(asTreeItem);
  }, [parts, part.id]);
  const rollups = useMemo(() => partRollups(parts), [parts]);
  const parents = useMemo(() => placeParentIds(items), [items]);
  const [open, setOpen] = useState<ReadonlySet<string> | null>(null);
  const shown = open ?? new Set(parents);
  const newLabel = `Ny ${childLevelName(part.depth).toLowerCase()}`;
  return <div className="space-y-3" data-testid="maintenance-parts-tab">
    {items.length ? <PlaceTreeView places={items} open={shown} onToggle={(id) => setOpen((current) => { const next = new Set(current ?? parents); if (next.has(id)) next.delete(id); else next.add(id); return next; })} icon={partIcon} label={`Delar på ${part.name}`} testId="maintenance-parts"
      line={(item, depth) => <StatusLine text={[partLevelName(part.depth + 1 + depth), item.partType, item.status !== "IN_SERVICE" ? PART_STATUS_LABELS[item.status] : ""].filter(Boolean).join(" · ")} sum={rollups.get(item.id)} />}
      onOpen={(item) => onOpenPart(item.id)} /> : <p className="text-sm text-muted-foreground">Inga delar än. Lägg till dem om du vill följa dem var för sig.</p>}
    {detail.canEdit ? <Button type="button" variant="outline" size="sm" onClick={onNewChild} data-testid="maintenance-part-add"><Plus />{newLabel}</Button> : null}
  </div>;
}

/** Where the hours came from: the machine (with the signal, while it still feeds them) or a person. */
function hoursHint(part: PartDetail["part"]) {
  if (!part.runHoursAt) return part.runHoursFeed ? `Följer ${part.runHoursFeed.signalName}` : "Från en person eller en signal";
  if (part.runHoursOrigin !== "machine") return `Angivet ${when(part.runHoursAt)}`;
  return `Från maskinen ${when(part.runHoursAt)}${part.runHoursFeed ? ` · ${part.runHoursFeed.sourceName}, ${part.runHoursFeed.signalName}` : ""}`;
}

function Overview({ detail, onEdit, onMove, onChanged }: { detail: PartDetail; onEdit: () => void; onMove: () => void; onChanged: () => Promise<void> }) {
  const { part } = detail;
  const [cost, setCost] = useState<Cost | null>(null);
  const load = useCallback(async () => { try { setCost(await maintenanceGet<Cost>(`part=cost&id=${encodeURIComponent(part.id)}`)); } catch { setCost(null); } }, [part.id]);
  useLoadEffect(load);
  return <div className="@container space-y-4">
    <dl className="grid grid-cols-2 gap-3 text-sm @2xl:grid-cols-4">
      <FigureBox label="Drifttimmar" value={part.runHours === null ? "–" : `${part.runHours.toLocaleString("sv-SE")} h`} hint={hoursHint(part)} testId="maintenance-run-hours" />
      <FigureBox label="Stillestånd i år" value={cost ? formatDowntime(cost.downtime.year.minutes) || "0 min" : "…"} hint={cost?.downtime.year.ongoingStops ? `Står nu: ${formatDowntime(cost.downtime.year.ongoingMinutes)}` : "Från underhållsposterna"} testId="maintenance-downtime-year" />
      <FigureBox label="Kostnad" value={cost ? (cost.pricesVisible ? kronor(cost.totals.total) : hoursText(cost.totals.hours)) : "…"} hint={cost ? plural(cost.totals.orders, "arbetsorder", "arbetsordrar") : undefined} testId="maintenance-cost-total" />
      <FigureBox label="Signaler" value={detail.signals.length ? String(detail.signals.length) : "–"} hint={detail.signals.length ? detail.signals.map((signal) => signal.name).join(", ") : "Ingen kopplad"} />
    </dl>
    {part.runHoursHeld ? <div className="notice flex flex-wrap items-center gap-x-3 gap-y-2 text-sm" role="status" data-testid="maintenance-hours-held">
      <span className="min-w-0 flex-1 basis-56">{runHoursHeldText({ held: part.runHoursHeld.value, reason: part.runHoursHeld.reason, current: part.runHours })}{part.runHoursHeld.at ? ` ${when(part.runHoursHeld.at)}.` : ""}</span>
      {detail.canEdit ? <Button type="button" variant="outline" size="sm" data-testid="maintenance-hours-accept" onClick={async () => {
        try {
          await maintenancePost({ action: "update_part", id: part.id, version: part.version, part: { ...moveBody(part, { parentId: part.parentId, placeId: part.placeId }), runHours: part.runHoursHeld!.value } });
          announce("Drifttimmarna är ändrade.");
          await onChanged();
        } catch (cause) { announce((cause as Error).message, true); }
      }}>Använd värdet</Button> : null}
    </div> : null}
    {part.notes ? <p className="whitespace-pre-wrap text-sm">{part.notes}</p> : null}
    {detail.canEdit ? <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" onClick={onEdit} data-testid="maintenance-part-edit"><Pencil />Redigera</Button>
      <Button type="button" variant="outline" size="sm" onClick={onMove} data-testid="maintenance-part-move"><Move />Flytta</Button>
    </div> : null}
    <PartMachineKeyFigures partId={part.id} />
  </div>;
}

function Images({ detail, onChanged, onOpen }: { detail: PartDetail; onChanged: () => Promise<void>; onOpen: (image: PartDetail["images"][number]) => void }) {
  const [busy, setBusy] = useState(false);
  const add = async (files: File[]) => {
    setBusy(true);
    try { for (const file of files) await uploadPartImage(detail.part.id, file); announce(files.length === 1 ? "Bilden lades till." : `${files.length} bilder lades till.`); await onChanged(); }
    catch (cause) { announce((cause as Error).message, true); } finally { setBusy(false); }
  };
  return <div className="space-y-4" data-testid="maintenance-images">
    {detail.images.length ? <ul className="flex flex-wrap gap-3">{detail.images.map((image) => <li key={image.id} className="relative">
      <button type="button" className="block" onClick={() => onOpen(image)} aria-label={`Visa ${image.name}`} data-testid="maintenance-image-thumb">
        {/* eslint-disable-next-line @next/next/no-img-element -- the company's own picture */}
        <img src={partImageUrl(image.id)} alt={image.name} className="size-20 rounded-md border object-cover" />
      </button>
      {image.isMain ? <Badge variant="outline" className={cn(indicatorBadge("info"), "absolute bottom-1 left-1 px-1 py-0 text-[10px]")}>Huvudbild</Badge> : null}
    </li>)}</ul> : <p className="text-sm text-muted-foreground">Inga bilder än.</p>}
    {detail.canEdit ? <PhotoPicker files={[]} onChange={(files) => void add(files)} disabled={busy} label="Lägg till" /> : null}
    <p className="text-xs text-muted-foreground">Företagets egna bilder. Klicka på en bild för att se den större.</p>
  </div>;
}

function Spares({ detail, onChanged }: { detail: PartDetail; onChanged: () => Promise<void> }) {
  const router = useRouter();
  // Företagets moduler (0.39.0): the store orders through a purchase, so Beställ follows Inköp och artiklar.
  const canOrder = useModuleOn("purchasing") && detail.canOrder;
  const [adding, setAdding] = useState(false);
  const [taking, setTaking] = useState<Spare | null>(null);
  const order = async (spare: Spare) => {
    try {
      const made = await maintenancePost<{ id: string; label: string }>({ action: "order", id: spare.itemId });
      announce(`Inköp ${made.label} skapades med ${spare.name}.`, false, [{ label: "Öppna", run: () => router.push(`/?view=purchase&purchaseId=${encodeURIComponent(made.id)}`) }]);
    } catch (cause) { announce((cause as Error).message, true); }
  };
  const unlink = async (spare: Spare) => {
    try { await maintenancePost({ action: "unlink_spare", id: spare.linkId }); await onChanged(); } catch (cause) { announce((cause as Error).message, true); }
  };
  return <div className="space-y-3">
    {detail.spares.length ? <ul className="-mx-4 divide-y border-y text-sm" data-testid="maintenance-spares">{detail.spares.map((spare) => <li key={spare.linkId} className="grid gap-2 px-5 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" data-testid="maintenance-spare">
      <span className="min-w-0"><span className="font-semibold">{spare.name}</span>
        <span className="block text-xs text-muted-foreground">{[spare.ownNumber ? `Nr ${spare.ownNumber}` : "", ...spare.balances.map((row) => `${row.locationName}: ${quantityText(row.quantity)}`)].filter(Boolean).join(" · ")}</span>
        {spare.articleNo || spare.supplierName ? <span className="block text-xs text-muted-foreground" data-testid="maintenance-spare-order-as">Beställs som {[spare.supplierName, spare.articleNo].filter(Boolean).join(" ")}</span> : null}</span>
      <span className="flex flex-wrap items-center gap-2">
        <span className="tabular-nums" data-testid="maintenance-spare-total">{quantityText(spare.total)} {spare.unit}</span>
        {spare.low ? <Badge variant="outline" className={indicatorBadge("warning")}>Lågt</Badge> : null}
        <Button type="button" size="sm" variant="outline" disabledReason={!detail.canWithdraw ? "Du får inte ändra arbetsordrar." : detail.workOrders.length ? null : "Ingen öppen arbetsorder på delen."} onClick={() => setTaking(spare)} data-testid="maintenance-take-out"><PackageMinus />Lägg på arbetsorder</Button>
        {spare.low && canOrder ? <Button type="button" size="sm" onClick={() => void order(spare)} data-testid="maintenance-order"><Boxes />Beställ</Button> : null}
        {detail.canEdit ? <RemoveButton label={`Ta bort ${spare.name} från delen`} onClick={() => void unlink(spare)} /> : null}
      </span>
    </li>)}</ul> : <p className="text-sm text-muted-foreground">Inga reservdelar kopplade.</p>}
    {detail.canEdit ? <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)} data-testid="maintenance-spare-add"><Plus />Koppla reservdel</Button> : null}
    <p className="text-xs text-muted-foreground">Artiklar från artikelregistret. En reservdel dras från förrådet direkt när den läggs på arbetsordern.</p>
    {adding ? <LinkSpareDialog partId={detail.part.id} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await onChanged(); }} /> : null}
    {taking ? <WithdrawDialog spare={taking} workOrders={detail.workOrders} onClose={() => setTaking(null)} onDone={async () => { setTaking(null); await onChanged(); }} /> : null}
  </div>;
}

/** Koppla reservdel: an article from the register (the same search as a material row) or one of the store's own. */
function LinkSpareDialog({ partId, onClose, onSaved }: { partId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await maintenancePost({ action: "link_spare", partId, article: picked ? { articleRef: picked.id } : { name, unit: "st" }, quantity });
      announce("Reservdelen är kopplad.");
      await onSaved();
    } catch (cause) { announce((cause as Error).message, true); } finally { setBusy(false); }
  };
  return <Modal open onOpenChange={(next) => { if (!next) onClose(); }} title="Koppla reservdel" size="form">
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }} data-testid="maintenance-spare-form">
      <ArticleSearchField label="Artikel" value={name} local={false} onChange={(text) => { setName(text); setPicked(null); }} onPick={(hit) => { setPicked({ id: hit.id, name: hit.name }); setName(hit.name); }} />
      <Field id="ms-qty" label="Antal per byte" value={quantity} onChange={setQuantity} />
      <p className="text-xs text-muted-foreground">{picked ? "Från artikelregistret." : name.trim() ? "Väljer du ingen träff sparas den som en egen artikel i förrådet." : "Sök i artikelregistret."}</p>
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Koppla", type: "submit", busy, busyLabel: "Sparar…", disabledReason: name.trim() ? null : "Välj en artikel först.", testId: "maintenance-spare-save" }} />
    </form>
  </Modal>;
}

function Items({ detail, onChanged }: { detail: PartDetail; onChanged: () => Promise<void> }) {
  const setQuery = useSetQuery();
  const [creating, setCreating] = useState(false);
  return <div className="space-y-3">
    {detail.items.length ? <ItemList items={detail.items} /> : <p className="text-sm text-muted-foreground">Inga underhållsposter än.</p>}
    {detail.canEdit ? <Button type="button" variant="outline" size="sm" onClick={() => setCreating(true)} data-testid="maintenance-item-new"><Plus />Ny underhållspost</Button> : null}
    <p className="text-xs text-muted-foreground">En underhållspost gäller en del och ligger i en arbetsorder.</p>
    {creating ? <NewItemDialog partId={detail.part.id} partName={detail.part.name} workOrders={detail.workOrders} onClose={() => setCreating(false)}
      onCreated={async (id) => { setCreating(false); await onChanged(); setQuery({ item: id }, true); }} /> : null}
  </div>;
}

export function ItemList({ items }: { items: ItemRow[] }) {
  const native = useNativeMode();
  const setQuery = useSetQuery();
  const open = (id: string) => setQuery({ item: id }, true);
  if (native) return <ListGroup>{items.map((item) => <ListRow key={item.id} type="maintenance" icon={ClipboardList} title={`${item.partName}${item.fault ? ` · ${item.fault}` : ""}`}
    subtitle={[ITEM_STATUS_LABELS[item.status], item.workOrder?.title ?? "Utan arbetsorder", item.downtimeMinutes ? `Stillestånd ${formatDowntime(item.downtimeMinutes)}` : ""].filter(Boolean).join(" · ")}
    onClick={() => open(item.id)} testId="maintenance-item-row" />)}</ListGroup>;
  return <ul className="-mx-4 divide-y border-y text-sm" data-testid="maintenance-items">{items.map((item) => <li key={item.id}>
    <button type="button" onClick={() => open(item.id)} className="grid w-full gap-1 px-5 py-2 text-left hover:bg-muted sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" data-testid="maintenance-item-row">
      <span className="min-w-0"><span className="block truncate font-medium">{item.partName}{item.fault ? ` · ${item.fault}` : ""}</span>
        <span className="block truncate text-xs text-muted-foreground">{[item.type ? MAINTENANCE_TYPE_LABELS[item.type as MaintenanceType] : "", item.priority ? MAINTENANCE_PRIORITY_LABELS[item.priority as MaintenancePriority] : "",
          item.workOrder?.title ?? "Utan arbetsorder", ITEM_SOURCE_LABELS[item.source], item.downtimeMinutes ? `Stillestånd ${formatDowntime(item.downtimeMinutes)}` : ""].filter(Boolean).join(" · ")}</span></span>
      <span><Badge variant="outline" className={indicatorBadge(item.status === "DONE" ? "success" : item.status === "CANCELLED" ? "neutral" : item.priority === "URGENT" ? "danger" : "info")}>{ITEM_STATUS_LABELS[item.status]}</Badge></span>
    </button>
  </li>)}</ul>;
}

function CostTab({ partId }: { partId: string }) {
  const [cost, setCost] = useState<Cost | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => { try { setCost(await maintenanceGet<Cost>(`part=cost&id=${encodeURIComponent(partId)}`)); setError(""); } catch (cause) { setError((cause as Error).message); } }, [partId]);
  useLoadEffect(load);
  return <CostBody cost={cost} error={error} scopeText="Delen och allt under den." />;
}

/** Kostnaden, for a part or a place: the same boxes and the work orders it comes from. */
function CostBody({ cost, error, scopeText }: { cost: Cost | null; error: string; scopeText: string }) {
  if (error) return <p role="alert" className="notice text-destructive">{error}</p>;
  if (!cost) return <RowsSkeleton rows={3} label="Räknar kostnaden…" />;
  const { totals } = cost;
  return <div className="@container space-y-3" data-testid="maintenance-cost">
    <dl className="grid gap-3 text-sm @lg:grid-cols-2 @3xl:grid-cols-3">
      <div className="rounded-lg border p-3"><dt className="text-xs text-muted-foreground">Tid</dt><dd className="mt-1 font-semibold tabular-nums">{hoursText(totals.hours)}{cost.pricesVisible && totals.time !== null ? ` · ${kronor(totals.time)}` : ""}</dd></div>
      {cost.pricesVisible ? <>
        <div className="rounded-lg border p-3"><dt className="text-xs text-muted-foreground">Material och uttag</dt><dd className="mt-1 font-semibold tabular-nums">{kronor((totals.material ?? 0) + (totals.withdrawals ?? 0))}</dd></div>
        <div className="rounded-lg border p-3"><dt className="text-xs text-muted-foreground">Inköp</dt><dd className="mt-1 font-semibold tabular-nums">{kronor(totals.purchases)}</dd></div>
      </> : null}
      <div className="rounded-lg border p-3"><dt className="text-xs text-muted-foreground">Stillestånd totalt</dt><dd className="mt-1 font-semibold tabular-nums" data-testid="maintenance-downtime-all">{formatDowntime(cost.downtime.all.minutes) || "0 min"}</dd>
        <dd className="text-xs text-muted-foreground">{cost.downtime.all.stops} stopp{cost.downtime.all.ongoingStops ? ` · står nu ${formatDowntime(cost.downtime.all.ongoingMinutes)}` : ""}</dd></div>
      {cost.pricesVisible ? <div className="rounded-lg border p-3"><dt className="text-xs text-muted-foreground">Summa</dt><dd className="mt-1 text-lg font-semibold tabular-nums" data-testid="maintenance-cost-sum">{kronor(totals.total)}</dd></div> : null}
    </dl>
    {cost.orders.length ? <ul className="-mx-4 divide-y border-y text-sm" data-testid="maintenance-cost-orders">{cost.orders.map((row) => <li key={row.orderId} className="grid gap-1 px-5 py-2 sm:grid-cols-[minmax(0,1fr)_8rem] sm:items-center">
      <Link className="min-w-0 truncate font-medium underline-offset-2 hover:underline" href={`/?view=workflow_task&taskType=WORK_ORDER&taskId=${encodeURIComponent(row.orderId)}`}>{row.title}</Link>
      <span className="text-xs text-muted-foreground sm:text-right">{[row.label, hoursText(row.hours), cost.pricesVisible && row.material ? `Material ${kronor(row.material)}` : "", cost.pricesVisible && row.purchases ? `Inköp ${kronor(row.purchases)}` : "", row.downtimeMinutes ? `Stillestånd ${formatDowntime(row.downtimeMinutes)}` : ""].filter(Boolean).join(" · ")}</span>
    </li>)}</ul> : <p className="text-sm text-muted-foreground">Inga arbetsordrar här än.</p>}
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Wallet className="size-3.5" aria-hidden="true" />
      {cost.pricesVisible ? (cost.hourlyRateMissing ? "Tiden räknas i kronor när företaget har ett timpris under Priser och offert." : "Räknas ut från arbetsordrar, uttag och inköp. Du behöver inte fylla i något.") : "Belopp visas bara med rätt att se priser."}</p>
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Gauge className="size-3.5" aria-hidden="true" />{scopeText}</p>
  </div>;
}
