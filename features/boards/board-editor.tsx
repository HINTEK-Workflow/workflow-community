"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, Pencil, Send, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { EDITOR_BUTTON, EDITOR_SIDE_PANEL, EDITOR_SIDE_PANEL_HEAD, EditorActions, EditorBar, EditorRibbon, EditorRibbonButton, EditorRibbonSheet, EditorSegmented, EditorStatus, EditorUndoRedo, type EditorRibbonGroup, type EditorRibbonItem } from "@/components/editor-ribbon";
import { PageSkeleton } from "@/components/page-shell";
import { useConfirm } from "@/features/kfid/confirm";
import { EditorHeader } from "@/features/workflow/editor-header";
import { SidePanel } from "@/features/workflow/form-builder/dialogs";
import { useIsPhone } from "@/features/workflow/use-detail-level";
import { clampRect, firstFree, GRID_COLUMNS, placeItem, reorient, stackedOrder, type Rect } from "@/lib/boards/grid";
import { CARDS, cardDefinition, cardHeading, DISTANCE, DISTANCES, duplicateCard, newCardId, normalizeLayout, type BoardCard, type BoardLayout, type CardType, type Distance } from "@/lib/boards/model";
import { metricDefinition } from "@/lib/boards/metrics";
import type { Visibility } from "@/lib/boards/privacy";
import type { CardData } from "@/lib/boards/shapes";
import { useLoadEffect } from "@/lib/use-load-effect";
import { useUnsavedGuard } from "@/lib/workflow/use-unsaved-guard";
import { announce, notice } from "@/lib/workflow/toast";
import { cn } from "@/lib/utils";
import { CheckField, Panel } from "@/features/kfid/ui";
import { appImageUrl, boardsGet, boardsPost, type BoardDetail, type BoardFeedAnswer, type TableListItem } from "./boards-api";
import { BoardImages } from "./board-card";
import { BoardCanvas, useLibraryDrag } from "./board-canvas";
import { BoardSettingsPanel, CardPanel } from "./board-properties";
import { CARD_ICON } from "./card-icons";
import { PublishDialog } from "./publish-dialog";
import { BoardPreview, PREVIEW_SIZES, type PreviewSizeKey, type PreviewTurn } from "./board-preview";
import { ReadabilityBySize, ReadabilityWarning } from "./board-readability";
import { screenSize, TV_INCHES, tvInches } from "@/lib/boards/capacity";

/**
 * Tavlans redigerare (Tavlor etapp 1, 2026-11-18; rebuilt like Skapa formulär 2026-11-19):
 * the board's head with Publicera (no Visa tavlan since 2026-11-20: the board's name in the list opens its page), then one fixed bar (components/editor-ribbon.tsx, the same as the form builder's)
 * with Ångra/Gör om, the mode Redigera/Förhandsgranska and "Sparat", and directly under it the card types as a full-width icon
 * ribbon – click one to add it at the first free place, or drag it onto a cell. The grid is the sheet; the chosen card's settings
 * stand beside it from 1280 px (with nothing chosen: the board's own), and in a panel from the side on smaller screens. The draft
 * saves itself a moment after each change, with the board's revision as the version check; Publicera makes a locked version after
 * "Det här syns". Förhandsgranska shows the board on an iPad, a computer or a tv, lying or standing, at each viewing distance. On a
 * phone the board is only arranged: which cards show there.
 */
type SaveState = "saved" | "saving" | "unsaved" | "error";
type Mode = "build" | "preview";
const SAVE_DELAY_MS = 900;

/** The ribbon's groups. A card type not named here (a new one) lands in Fler, so the ribbon always offers every type. */
const RIBBON_GROUPS: { label: string; types: readonly CardType[] }[] = [
  { label: "Tal", types: ["kpi", "gauge"] },
  { label: "Data", types: ["chart", "table", "status", "events"] },
  { label: "Innehåll", types: ["text", "image", "clock"] },
];

export function BoardEditor({ boardId }: { boardId: string }) {
  const [board, setBoard] = useState<BoardDetail | null>(null);
  const [failed, setFailed] = useState("");
  const load = useCallback(async () => {
    try { setBoard(await boardsGet<BoardDetail>(`part=board&id=${encodeURIComponent(boardId)}`)); }
    catch (error) { setFailed(error instanceof Error ? error.message : "Tavlan kunde inte läsas."); }
  }, [boardId]);
  useLoadEffect(load);
  if (failed) return <p className="notice" role="alert">{failed}</p>;
  if (!board) return <PageSkeleton label="Hämtar tavlan…" panels={2} />;
  if (!board.canEdit || !board.draft) return <p className="notice" role="alert">Du saknar behörighet att ändra tavlor.</p>;
  return <Editor key={board.id} initial={board} />;
}

/** A card type in the ribbon: click to add, or drag onto the grid (as the form builder's blocks). */
function RibbonCard({ item }: { item: EditorRibbonItem; testId: string }) {
  const { setNodeRef, attributes, listeners, isDragging } = useLibraryDrag(item.key as CardType, item.disabled);
  return <EditorRibbonButton ref={setNodeRef} {...attributes} {...listeners} icon={item.icon} label={item.label} title={item.hint} aria-label={item.ariaLabel} onClick={item.onSelect} disabled={item.disabled}
    className={cn("touch-none", isDragging && "opacity-40")} data-testid={`board-add-${item.key}`} data-ribbon-item={item.key} />;
}

function Editor({ initial }: { initial: BoardDetail }) {
  const phone = useIsPhone();
  const [confirm, confirmElement] = useConfirm();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [layout, setLayout] = useState<BoardLayout>(initial.draft!);
  const [past, setPast] = useState<BoardLayout[]>([]);
  const [future, setFuture] = useState<BoardLayout[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [state, setState] = useState<SaveState>("saved");
  const [tables, setTables] = useState<TableListItem[]>([]);
  const [feed, setFeed] = useState<Record<string, CardData> | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(initial.published);
  const [now, setNow] = useState(() => Date.now());
  const [mode, setMode] = useState<Mode>("build");
  const [size, setSize] = useState<PreviewSizeKey>("tv1080");
  const [turn, setTurn] = useState<PreviewTurn>("landscape");
  /** The distance seen in Förhandsgranska; null is the board's own. */
  const [seenAt, setSeenAt] = useState<Distance | null>(null);
  /** A tv's size in inches for the readability warning (Skärmstorlek); null is the distance's usual size. */
  const [tvSize, setTvSize] = useState<number | null>(null);
  const revision = useRef(initial.revision);
  const pending = useRef<{ name: string; description: string; layout: BoardLayout } | null>(null);
  const saving = useRef<Promise<boolean> | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => { const tick = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(tick); }, []);
  const loadTables = useCallback(async () => { try { setTables((await boardsGet<{ items: TableListItem[] }>("part=tables")).items); } catch { /* the choice says there are none */ } }, []);
  useLoadEffect(loadTables);
  const refreshFeed = useCallback(async () => {
    try { setFeed((await boardsGet<BoardFeedAnswer>(`part=feed&draft=1&id=${encodeURIComponent(initial.id)}`)).cards); } catch { /* the cards keep what they had */ }
  }, [initial.id]);
  useLoadEffect(refreshFeed);

  /** Saves what is waiting, one request at a time; true when everything is saved. */
  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    if (saving.current) await saving.current;
    const next = pending.current;
    if (!next) return true;
    pending.current = null;
    setState("saving");
    const run = (async () => {
      try {
        const answer = await boardsPost<{ revision: number }>({ action: "save_board", id: initial.id, revision: revision.current, board: next });
        revision.current = answer.revision;
        if (!pending.current) setState("saved");
        void refreshFeed();
        return true;
      } catch (error) {
        pending.current ??= next;
        setState("error");
        announce(error instanceof Error ? error.message : "Tavlan kunde inte sparas.", true);
        return false;
      } finally { saving.current = null; }
    })();
    saving.current = run;
    return run;
  }, [initial.id, refreshFeed]);
  const queue = (next: { name: string; description: string; layout: BoardLayout }) => {
    pending.current = next;
    setState("unsaved");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void flush(); }, SAVE_DELAY_MS);
  };
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  useUnsavedGuard(state !== "saved", confirm, flush);

  const change = (next: BoardLayout, remember = true) => {
    const clean = normalizeLayout(next);
    if (remember) { setPast((items) => [...items.slice(-49), layout]); setFuture([]); }
    setLayout(clean);
    queue({ name, description, layout: clean });
  };
  const undo = () => { const last = past.at(-1); if (!last) return; setPast(past.slice(0, -1)); setFuture([layout, ...future]); setLayout(last); queue({ name, description, layout: last }); };
  const redo = () => { const [first, ...rest] = future; if (!first) return; setFuture(rest); setPast([...past, layout]); setLayout(first); queue({ name, description, layout: first }); };
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) { event.preventDefault(); undo(); }
      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey))) { event.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });

  const select = (id: string | null) => { setSelected(id); if (id) setMode("build"); };
  const newCard = (type: CardType, rect: Rect): BoardCard => ({ id: newCardId(), type, ...rect, title: "", data: null, settings: type === "clock" ? { showDate: true, showWeek: true } : {} });
  const add = (type: CardType) => {
    const definition = cardDefinition(type);
    const spot = firstFree(layout.cards, definition.start.w, definition.start.h, layout.rows) ?? firstFree(layout.cards, definition.size.minW, definition.size.minH, layout.rows);
    if (!spot) { announce("Tavlan är full. Gör ett kort mindre eller ta bort ett kort först.", true); return; }
    const size = firstFree(layout.cards, definition.start.w, definition.start.h, layout.rows) ? definition.start : { w: definition.size.minW, h: definition.size.minH };
    const card = newCard(type, { ...spot, ...size });
    change({ ...layout, cards: [...layout.cards, card] });
    select(card.id);
  };
  /** A card type dropped on a cell: it takes that place and pushes the cards it lands on down, as a moved card does. */
  const addAt = (type: CardType, rect: Rect) => {
    const card = newCard(type, rect);
    const next = placeItem([...layout.cards, card], card.id, rect, layout.rows, GRID_COLUMNS, cardDefinition(type).size);
    if (!next) { announce("Det finns inte plats för kortet där. Gör plats på tavlan eller välj en annan plats.", true); return; }
    change({ ...layout, cards: next });
    select(card.id);
  };
  const remove = (id: string) => { change({ ...layout, cards: layout.cards.filter((card) => card.id !== id) }); setSelected(null); setPanelOpen(false); };
  const duplicate = (id: string) => {
    const copyId = newCardId();
    const next = duplicateCard(layout, id, copyId);
    if (!next) { announce("Det finns inte plats för en kopia av kortet. Gör plats på tavlan först.", true); return; }
    change(next);
    select(copyId);
  };
  const placeCard = (card: BoardCard, rect: Rect) => {
    const next = placeItem(layout.cards, card.id, clampRect(rect, layout.rows, GRID_COLUMNS, cardDefinition(card.type).size), layout.rows, GRID_COLUMNS, cardDefinition(card.type).size);
    if (next) change({ ...layout, cards: next });
    else announce("Det finns inte plats för kortet där. Gör plats på tavlan eller välj en annan plats.", true);
  };
  const updateCard = (card: BoardCard) => change({ ...layout, cards: layout.cards.map((item) => item.id === card.id ? card : item) });
  const chosen = layout.cards.find((card) => card.id === selected) ?? null;

  const labels = useMemo(() => Object.fromEntries(layout.cards.flatMap((card) => {
    if (card.data?.kind === "metric") return [[card.id, metricDefinition(card.data.metric).label]];
    if (card.data?.kind === "table") { const table = tables.find((item) => item.id === (card.data as { sourceId: string }).sourceId); return table ? [[card.id, table.name]] : []; }
    return [];
  })), [layout.cards, tables]);

  const publish = async (visibility: Visibility) => {
    if (!(await flush())) return false;
    try {
      const answer = await boardsPost<{ number: number; publishedAt: string }>({ action: "publish_board", id: initial.id, revision: revision.current, publish: { visibility } });
      setPublished((current) => ({ id: current?.id ?? "", number: answer.number, publishedAt: answer.publishedAt, layout, visibility }));
      notice(`Version ${answer.number} är publicerad.`);
      return true;
    } catch (error) { announce(error instanceof Error ? error.message : "Tavlan kunde inte publiceras.", true); return false; }
  };

  const header = <EditorHeader title={name || "Tavla"} kind="Tavla"
    detail={<span>{published ? `Publicerad version ${published.number}` : "Inte publicerad"}</span>}
    primaryAction={initial.canPublish ? <Button type="button" onClick={async () => { if (await flush()) setPublishing(true); }} data-testid="board-publish"><Send aria-hidden="true" />Publicera</Button> : undefined} />;

  // The card types as the ribbon's groups – the same items for the ribbon and the panel on a small tablet. A type not in a group lands in Fler.
  const named = new Set(RIBBON_GROUPS.flatMap((group) => group.types));
  const ribbonItem = (type: CardType): EditorRibbonItem => {
    const definition = cardDefinition(type);
    return { key: type, label: definition.label, icon: CARD_ICON[definition.icon], hint: `${definition.label}: ${definition.description} Klicka eller dra till tavlan.`, ariaLabel: `Lägg till ${definition.label}`, onSelect: () => add(type) };
  };
  const others = CARDS.filter((card) => !named.has(card.type)).map((card) => card.type);
  const groups: EditorRibbonGroup[] = [
    ...RIBBON_GROUPS.map((group) => ({ label: group.label, items: group.types.filter((type) => CARDS.some((card) => card.type === type)).map(ribbonItem) })),
    ...(others.length ? [{ label: "Fler", items: others.map(ribbonItem) }] : []),
  ];

  if (phone) return <div className="space-y-4">
    {header}{confirmElement}
    <p className="notice" role="status">Bygg tavlan på en dator eller surfplatta. På telefonen väljer du vilka kort som syns här.</p>
    <Panel title="Korten på telefonen">
      {layout.cards.length ? <ul className="space-y-3">{stackedOrder(layout.cards).map((card) => <li key={card.id}>
        <CheckField id={`phone-${card.id}`} label={card.title || labels[card.id] || cardDefinition(card.type).label} description={cardDefinition(card.type).label} checked={!card.hideOnPhone}
          onChange={(value) => updateCard({ ...card, hideOnPhone: value ? undefined : true })} />
      </li>)}</ul> : <p className="text-sm text-muted-foreground">Tavlan har inga kort ännu.</p>}
    </Panel>
  </div>;

  const settings = chosen
    ? <BoardImages url={appImageUrl}><CardPanel key={chosen.id} card={chosen} rows={layout.rows} metrics={initial.metrics} tables={tables} data={feed?.[chosen.id]} label={labels[chosen.id] ?? feed?.[chosen.id]?.label} now={now}
      onChange={updateCard} onRect={(rect) => placeCard(chosen, rect)} onDuplicate={() => duplicate(chosen.id)} onRemove={() => remove(chosen.id)} /></BoardImages>
    : <BoardSettingsPanel name={name} description={description} layout={layout}
      onName={(value) => { setName(value.slice(0, 80)); queue({ name: value.slice(0, 80).trim() || initial.name, description, layout }); }}
      onDescription={(value) => { setDescription(value.slice(0, 300)); queue({ name: name.trim() || initial.name, description: value.slice(0, 300), layout }); }}
      onOrientation={(orientation) => change(reorient(layout, orientation))}
      onDistance={(distance) => change({ ...layout, distance })} />;
  const panelTitle = chosen ? (cardHeading(chosen, labels[chosen.id] ?? feed?.[chosen.id]?.label) || cardDefinition(chosen.type).label) : "Tavlans inställningar";
  const boardDistance = layout.distance ?? "near";
  const shownDistance = seenAt ?? boardDistance;
  // The names the readability warning gives the cards: as in the grid (a source's name for a card without a title of its own).
  const warningLabels = { ...Object.fromEntries(Object.entries(feed ?? {}).flatMap(([id, data]) => data.label ? [[id, data.label]] : [])), ...labels };

  // The one fixed bar (as Skapa formulär's): Ångra/Gör om, the mode, the save status and, below 1280 px, the settings button; the card
  // types lie under it in full width and stay, switched off, in Förhandsgranska, so nothing moves when the mode changes.
  const bar = <EditorBar testId="board-editor-bar" ribbon={<EditorRibbon label="Kort att lägga till" groups={groups} disabled={mode !== "build"} testId="board-ribbon" Item={RibbonCard} />}>
    <EditorUndoRedo canUndo={past.length > 0} canRedo={future.length > 0} onUndo={undo} onRedo={redo} />
    <EditorSegmented label="Läge" value={mode} onChange={(next) => { setMode(next); if (next === "preview") setPanelOpen(false); }} testId="board-mode" compactOnPhone
      options={[{ value: "build" as const, label: "Redigera", icon: Pencil }, { value: "preview" as const, label: "Förhandsgranska", icon: Eye }]} />
    <EditorStatus tone={state === "error" ? "error" : state === "unsaved" || state === "saving" ? "unsaved" : "saved"} testId="board-save-state">
      {state === "saving" ? "Sparar…" : state === "unsaved" ? "Ej sparat" : state === "error" ? "Kunde inte spara" : "Sparat"}
    </EditorStatus>
    <EditorActions>
      <Button type="button" variant="ghost" className={cn(EDITOR_BUTTON, "xl:hidden")} onClick={() => setPanelOpen(true)} disabled={mode !== "build"} data-testid="board-panel-open">
        <Settings2 aria-hidden="true" /><span className="max-sm:sr-only">{chosen ? "Kortets inställningar" : "Tavlans inställningar"}</span>
      </Button>
    </EditorActions>
  </EditorBar>;

  const preview = <div className="space-y-3 rounded-xl border bg-card p-3 shadow-sm sm:p-4" data-testid="board-preview-sheet">
    <div className="flex flex-wrap items-center gap-2" data-testid="board-view-sizes">
      <EditorSegmented label="Skärm" value={size} onChange={setSize} testId="board-preview-size" options={PREVIEW_SIZES.map((item) => ({ value: item.key, label: item.label }))} />
      <EditorSegmented label="Skärmens läge" value={turn} onChange={setTurn} testId="board-preview-turn" options={[{ value: "landscape" as const, label: "Liggande" }, { value: "portrait" as const, label: "Stående" }]} />
      <EditorSegmented label="Avstånd" value={shownDistance} onChange={(value) => setSeenAt(value === boardDistance ? null : value)} testId="board-preview-distance"
        options={DISTANCES.map((value) => ({ value, label: DISTANCE[value].label }))} />
    </div>
    <p className="text-xs text-muted-foreground" data-testid="board-preview-distance-hint">{DISTANCE[shownDistance].label}: {DISTANCE[shownDistance].hint}{seenAt ? ` Tavlans eget avstånd är ${DISTANCE[boardDistance].label}. En fast skärm kan välja ett annat avstånd.` : ""}</p>
    {screenSize(size).tv ? <div className="flex flex-wrap items-center gap-2">
      <EditorSegmented label="TV-storlek" value={String(tvInches(shownDistance, tvSize))} onChange={(value) => setTvSize(Number(value))} testId="board-preview-inches"
        options={TV_INCHES.map((inches) => ({ value: String(inches), label: `${inches} tum` }))} />
      <span className="text-xs text-muted-foreground" data-testid="board-preview-inches-hint">{tvSize ? "Varningarna räknar med den här storleken." : `Vanlig storlek på avståndet ${DISTANCE[shownDistance].label}. Välj er egen tv:s storlek.`}</span>
    </div> : null}
    <ReadabilityBySize layout={layout} turn={turn} distance={shownDistance} inches={tvSize} />
    <ReadabilityWarning layout={layout} size={size} turn={turn} distance={shownDistance} inches={tvSize} labels={warningLabels} onSelect={select} testId="board-preview-warning" />
    <BoardImages url={appImageUrl}><BoardPreview layout={layout} feed={feed} labels={labels} now={now} size={size} turn={turn} distance={shownDistance} /></BoardImages>
  </div>;

  return <div className="space-y-5" data-testid="board-editor">
    {header}{confirmElement}
    <BoardCanvas layout={layout} feed={feed} labels={labels} selected={selected} onSelect={select} onCards={(cards) => change({ ...layout, cards })} onRemove={remove} onAddAt={addAt} now={now}
      toolbar={<>{bar}{mode === "build" ? <ReadabilityWarning layout={layout} size={size} turn={layout.orientation} distance={boardDistance} inches={tvSize} labels={warningLabels} onSelect={select} /> : null}</>} replace={mode === "preview" ? preview : undefined}
      beside={<aside aria-label="Inställningar" className={cn(EDITOR_SIDE_PANEL, "hidden xl:block")} data-testid="board-properties">
        <div className={cn(EDITOR_SIDE_PANEL_HEAD, "justify-between px-4 py-2.5")}>
          <h2 className="truncate text-sm font-semibold">{panelTitle}</h2>
          {chosen ? <IconButton label="Stäng kortets inställningar" onClick={() => setSelected(null)}><X /></IconButton> : null}
        </div>
        {settings}
      </aside>} />
    <EditorRibbonSheet groups={groups} label="Lägg till kort" description="Kortet hamnar på första lediga plats." testId="board-add-sheet" />
    <SidePanel side="start" open={panelOpen && mode === "build"} onOpenChange={setPanelOpen} title={panelTitle}><div className="-m-4">{settings}</div></SidePanel>
    <PublishDialog boardId={initial.id} labels={labels} open={publishing} onClose={() => setPublishing(false)} onPublish={publish} />
  </div>;
}
