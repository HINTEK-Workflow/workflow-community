"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type Announcements, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { LucideIcon } from "lucide-react";
import { GripVertical, Menu, Plus, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TypeKey } from "@/lib/workflow/native-mode";
import { HOME_TILE, MAX_TABS, TAB, type HomeTileKey, type TabKey } from "@/lib/workflow/native-layout";
import { ListGroup, ListRow } from "./list";
import { TypeIcon } from "./type-icon";
import { NATIVE_HOME_ICON, NATIVE_TAB_ICON } from "./layout-icons";

/**
 * Hem and the tab bar edited in place like a phone's home screen (2026-10-21, UX-granskningen A1 and avsnitt 3;
 * reworked 2026-10-26): hold a tile to start. One screen with two parts that follow the same pattern – Hemskärmen and
 * Flikraden – each with what is shown (drag to move, × to remove), "Kan läggas till" (+ to add) and its own Återställ.
 * The tiles look as they do on Hem (the same faces, order and lines); a tile shown only sometimes says when. Klart in the
 * top bar saves. The same stored choice (`nativeLayout`). Display only: only what the person may use is offered.
 *
 * Moving (2026-10-26, "det går inte att bestämma var en ruta ska ligga"): pointer events for finger and mouse alike; a
 * moved item lets neither the browser scroll (touch-action: none, .native-movable) nor the edge swipe go back
 * (data-no-edge-swipe, which left the edit mode); the keyboard (Mellanslag, pilar, Mellanslag) for whoever does not drag.
 */

/** What a tile shows, the same on Hem and in the edit mode (features/workflow/native-home.tsx). */
export type HomeTileFace = {
  key: HomeTileKey;
  title: ReactNode;
  subtitle?: ReactNode;
  type: TypeKey;
  icon?: LucideIcon;
  wide: boolean;
  /** Shown only sometimes: when (Checka in, Fortsätt). */
  when?: string;
  /** Whether Hem shows it right now (a tile shown only sometimes may be away). */
  present: boolean;
};

const SCREEN_READER_MOVE = { draggable: "Mellanslag lyfter och släpper. Piltangenter flyttar. Escape avbryter." };

/** The shared drag and drop of both parts: finger and mouse through pointer events, and the keyboard. */
function SortableArea<K extends string>({ id, items, name, strategy, onMove, children }: {
  id: string;
  items: readonly K[];
  name: (key: K) => string;
  strategy: "grid" | "list";
  onMove: (next: K[]) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    // A few pixels before a drag starts, so a tap is still a tap.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const label = (value: string | number) => name(value as K);
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Lyfte ${label(active.id)}.`,
    onDragOver: ({ active, over }) => over ? `${label(active.id)} är vid ${label(over.id)}.` : `${label(active.id)} är inte vid någon plats.`,
    onDragEnd: ({ active, over }) => over ? `${label(active.id)} släpptes vid ${label(over.id)}.` : `${label(active.id)} släpptes.`,
    onDragCancel: ({ active }) => `Flytten av ${label(active.id)} avbröts.`,
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = items.indexOf(active.id as K);
    const to = items.indexOf(over.id as K);
    if (from >= 0 && to >= 0) onMove(arrayMove([...items], from, to));
  };
  return <DndContext id={id} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}
    accessibility={{ announcements, screenReaderInstructions: SCREEN_READER_MOVE }}>
    <SortableContext items={[...items]} strategy={strategy === "grid" ? rectSortingStrategy : verticalListSortingStrategy}>{children}</SortableContext>
  </DndContext>;
}

/** One movable item: its ref, the handle's props and the moving style. */
function useMovable(id: string, roleDescription: string) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, attributes: { roleDescription } });
  return {
    itemRef: setNodeRef,
    style: { transform: CSS.Translate.toString(transform), transition },
    dragging: isDragging,
    handle: { ref: setActivatorNodeRef, "data-no-edge-swipe": "", ...attributes, ...listeners },
  };
}

/** Each part's own Återställ at its foot (2026-10-26: one for Hem, one for the tab bar). */
function ResetRow({ label, onReset, testId }: { label: string; onReset: () => void; testId: string }) {
  return <ListGroup>
    <ListRow icon={RotateCcw} type="neutral" title={label} chevron={false} onClick={onReset} testId={testId} />
  </ListGroup>;
}

/** Hemskärmen: the tiles as on Hem, movable; Notiser (always the list under the tiles on Hem) stays last. */
export function HomeEditGrid({ faces, columns, addable, onMove, onRemove, onAdd, onReset }: {
  faces: readonly HomeTileFace[];
  columns: 2 | 3 | 4;
  /** Tiles the person may use but does not show. */
  addable: readonly HomeTileKey[];
  onMove: (next: HomeTileKey[]) => void;
  onRemove: (key: HomeTileKey) => void;
  onAdd: (key: HomeTileKey) => void;
  onReset: () => void;
}) {
  const movable = faces.filter((face) => face.key !== "notices");
  const notices = faces.find((face) => face.key === "notices");
  const keys = movable.map((face) => face.key);
  return <section aria-labelledby="native-home-edit-tiles-title" data-testid="native-home-edit-tiles">
    <h2 id="native-home-edit-tiles-title" className="native-group-title">Hemskärmen</h2>
    <SortableArea id="native-home-edit" items={keys} name={(key) => HOME_TILE[key]?.label ?? key} strategy="grid"
      onMove={(next) => onMove(notices ? [...next, "notices"] : next)}>
      <ul className="native-home-grid" data-cols={columns} data-editing="" data-testid="native-home-edit-grid" aria-label="Rutorna på hemskärmen">
        {movable.map((face) => <MovableTile key={face.key} face={face} onRemove={() => onRemove(face.key)} />)}
        {notices ? <li className="relative col-span-full min-w-0" data-testid="native-home-edit-notices">
          <div className="native-tile native-tile-wiggle" data-wide=""><TileFace face={notices} /></div>
          <RemoveTile face={notices} onRemove={() => onRemove("notices")} />
        </li> : null}
      </ul>
    </SortableArea>
    <ListGroup title="Kan läggas till" className="native-home-pool" testId="native-home-pool-tiles">
      {addable.length ? addable.map((key) => <ListRow key={key} type={HOME_TILE[key].type} icon={NATIVE_HOME_ICON[key]} title={HOME_TILE[key].label} subtitle={HOME_TILE_POOL_HINT[key] ?? HOME_TILE[key].hint}
        onClick={() => onAdd(key)} chevron={false} accessory={<Plus aria-hidden="true" className="size-5 text-primary" />} ariaLabel={`Lägg till ${HOME_TILE[key].label} på hemskärmen`} testId={`native-home-sheet-add-${key}`} />)
        : <ListRow title="Alla rutor finns på hemskärmen" chevron={false} />}
    </ListGroup>
    <ResetRow label="Återställ hemskärmen" onReset={onReset} testId="native-home-reset-tiles" />
  </section>;
}
/** In "Kan läggas till", a tile shown only sometimes says when, as it does on the screen. */
const HOME_TILE_POOL_HINT: Partial<Record<HomeTileKey, string>> = { notices: "Listan under rutorna" };

/** The tile's face as on Hem: icon, title, its line; and for a tile shown only sometimes, when. */
function TileFace({ face }: { face: HomeTileFace }) {
  return <>
    <TypeIcon type={face.type} icon={face.icon} size="tile" />
    <span className="block min-w-0">
      <span className="block truncate text-[0.9375rem] font-semibold">{face.title}</span>
      {face.subtitle && face.present ? <span className="native-tile-hint block truncate text-xs text-muted-foreground">{face.subtitle}</span> : null}
      {face.when ? <span className="native-tile-when" data-testid={`native-home-when-${face.key}`}>{face.when}</span> : null}
    </span>
  </>;
}

function RemoveTile({ face, onRemove }: { face: HomeTileFace; onRemove: () => void }) {
  const label = HOME_TILE[face.key].label;
  return <button type="button" className="native-home-remove" aria-label={`Ta bort ${label} från hemskärmen`} onClick={onRemove} data-testid={`native-home-remove-${face.key}`}>
    <span><X aria-hidden="true" className="size-3.5" /></span>
  </button>;
}

/** A tile in the edit mode: its face from Hem, wiggling, moved by dragging (or with the keyboard), × in the corner. */
function MovableTile({ face, onRemove }: { face: HomeTileFace; onRemove: () => void }) {
  const { itemRef, style, dragging, handle } = useMovable(face.key, "flyttbar ruta");
  return <li ref={itemRef} style={style} className={cn("relative min-w-0", face.wide && "col-span-full", dragging && "z-10 opacity-80")} data-testid={`native-home-edit-${face.key}`}>
    <div {...handle} aria-label={`Flytta ${HOME_TILE[face.key].label}`} data-wide={face.wide || undefined} data-conditional={face.when ? (face.present ? "shown" : "away") : undefined}
      className="native-tile native-tile-wiggle native-movable cursor-grab select-none active:cursor-grabbing"><TileFace face={face} /></div>
    <RemoveTile face={face} onRemove={onRemove} />
  </li>;
}

/**
 * Flikraden: "I flikraden" (movable, × to remove, Mer always last) and "Kan läggas till" (+ to add, also the ones taken
 * away, 2026-10-26), apart and in a colour of their own; at most four and Mer.
 */
export function TabBarEditor({ tabs, allowedTabs, onTabs, onReset }: {
  tabs: readonly TabKey[];
  allowedTabs: readonly TabKey[];
  onTabs: (next: TabKey[]) => void;
  onReset: () => void;
}) {
  const shownTabs = tabs.filter((key) => allowedTabs.includes(key));
  const poolTabs = allowedTabs.filter((key) => !tabs.includes(key));
  const full = shownTabs.length >= MAX_TABS;
  return <section aria-labelledby="native-home-edit-tabs-title" className="pt-4" data-testid="native-home-sheet-tabs">
    <h2 id="native-home-edit-tabs-title" className="native-group-title">Flikraden</h2>
    <h3 className="native-group-subtitle">I flikraden</h3>
    <SortableArea id="native-tab-edit" items={shownTabs} name={(key) => TAB[key]?.label ?? key} strategy="list" onMove={onTabs}>
      <ul className="native-group" aria-label="Knapparna i flikraden" data-testid="native-tab-edit-list">
        {shownTabs.map((key) => <MovableTab key={key} id={key} onRemove={shownTabs.length > 1 ? () => onTabs(shownTabs.filter((item) => item !== key)) : undefined} />)}
        <li className="native-row" data-testid="native-tab-edit-more">
          <TypeIcon type="neutral" icon={Menu} />
          <span className="min-w-0 flex-1"><span className="block text-[0.9375rem] font-medium leading-5">Mer</span>
            <span className="block truncate text-[0.8125rem] leading-[1.125rem] text-muted-foreground">Alltid sist</span></span>
        </li>
      </ul>
    </SortableArea>
    <p className="px-4 pt-1.5 text-xs leading-5 text-muted-foreground">{full ? "Fullt: fyra knappar och Mer. Ta bort en för att lägga till." : "Högst fyra knappar och Mer."}</p>
    <ListGroup title="Kan läggas till" className="native-home-pool" testId="native-home-pool-tabs">
      {poolTabs.length ? poolTabs.map((key) => <ListRow key={key} icon={NATIVE_TAB_ICON[key]} type="neutral" title={TAB[key].label} subtitle={TAB[key].hint} chevron={false} testId={`native-home-sheet-tab-add-${key}`}
        onClick={full ? undefined : () => onTabs([...shownTabs, key])} ariaLabel={`Lägg till ${TAB[key].label} i flikraden`}
        accessory={<Plus aria-hidden="true" className={cn("size-5", full ? "text-muted-foreground" : "text-primary")} />} />)
        : <ListRow title="Alla knappar finns i flikraden" chevron={false} />}
    </ListGroup>
    <ResetRow label="Återställ flikraden" onReset={onReset} testId="native-home-reset-tabs" />
  </section>;
}

function MovableTab({ id, onRemove }: { id: TabKey; onRemove?: () => void }) {
  const { itemRef, style, dragging, handle } = useMovable(id, "flyttbar knapp");
  const tab = TAB[id];
  return <li ref={itemRef} style={style} className={cn("native-row", dragging && "z-10 opacity-80")} data-testid={`native-home-sheet-tab-${id}`}>
    <div {...handle} aria-label={`Flytta ${tab.label}`} className="native-movable flex min-h-11 min-w-0 flex-1 cursor-grab select-none items-center gap-3 active:cursor-grabbing">
      <TypeIcon type="neutral" icon={NATIVE_TAB_ICON[id]} />
      <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-medium leading-5">{tab.label}</span>
      <GripVertical aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
    </div>
    {onRemove ? <button type="button" className="native-home-row-action" aria-label={`Ta bort ${tab.label} från flikraden`} onClick={onRemove} data-testid={`native-home-sheet-tab-remove-${id}`}><X aria-hidden="true" className="size-4" /></button> : null}
  </li>;
}

/** The whole edit screen: Hemskärmen, then Flikraden; opened from a held tab it starts at Flikraden. */
export function HomeEditScreen({ focus, children }: { focus: "tiles" | "tabs"; children: ReactNode }) {
  const screen = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (focus !== "tabs") return;
    screen.current?.querySelector<HTMLElement>("[data-testid=native-home-sheet-tabs]")?.scrollIntoView({ block: "start" });
  }, [focus]);
  return <div ref={screen} className="native-home-edit" data-testid="native-home-edit">{children}</div>;
}
