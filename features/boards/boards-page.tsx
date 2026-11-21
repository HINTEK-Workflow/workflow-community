"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Copy, Presentation, Monitor, Pencil, Plus, Smartphone, Trash2 } from "lucide-react";
import { AreaIcon } from "@/components/area-icon";
import { ListCard, ListCardGrid, ListFilterBar, useListPrefs } from "@/components/list-filter-bar";
import { PageHeader } from "@/components/page-shell";
import { RowChevron } from "@/components/row-chevron";
import { DelayedSkeleton } from "@/components/skeleton";
import { Button } from "@/components/ui/button";
import { EditorMoreMenu } from "@/components/editor-ribbon";
import { useEntryState } from "@/components/history-nav";
import { useConfirm } from "@/features/kfid/confirm";
import { api } from "@/features/kfid/api";
import { DialogActions, Empty, Field, Modal, NoPermission, RowsSkeleton } from "@/features/kfid/ui";
import { useWorkspaceData } from "@/features/kfid/use-workspace-data";
import { BOARD_PRESETS, type BoardPreset } from "@/lib/boards/model";
import { BOARD_TEMPLATES, type BoardTemplateKey } from "@/lib/boards/templates";
import { boardsTabOf, type BoardsTab } from "@/lib/boards/tabs";
import type { BoardsAccess } from "@/lib/boards/access";
import { listSearchMatches, listSortOptions, sortListItems } from "@/lib/list-filter";
import { formatSwedish } from "@/lib/swedish-time";
import { announce } from "@/lib/workflow/toast";
import type { WorkListScope } from "@/lib/workflow/work-list";
import { cn } from "@/lib/utils";
import { boardHref, boardsPost, type BoardList, type BoardListItem } from "./boards-api";
import { BoardEditor } from "./board-editor";
import { BoardView } from "./board-view";
import { TablesPage } from "./tables-page";
import { ScreensPage } from "./screens-page";
import { LinksPage } from "./links-page";

/**
 * Tavlor (2026-11-18, frågorna 1–2): a menu button of its own; the page has the tabs Tavlor, Tabeller, Skärmar and Länkar,
 * drawn by the shell under the heading. A board opens as its own page (`&board=`), its editor under it
 * (`&edit=1`). Every list follows the shared filter row. The server decides what each person sees and may do.
 */
export function BoardsPage({ personId }: { personId: string }) {
  const search = useSearchParams();
  const board = search.get("board");
  const tab = boardsTabOf(search.get("tab"));
  const access = useWorkspaceData<BoardsAccess>("/api/boards?part=access", (signal) => api<BoardsAccess>("/api/boards?part=access", { signal }));
  if (board && search.get("edit") === "1") return <BoardEditor boardId={board} />;
  if (board) return <BoardView boardId={board} />;
  if (!access.data) return access.error ? <p className="notice" role="alert">{access.error}</p> : <DelayedSkeleton testId="boards-loading"><RowsSkeleton rows={5} /></DelayedSkeleton>;
  return <BoardsTabs tab={tab} access={access.data} personId={personId} />;
}

function BoardsTabs({ tab, access, personId }: { tab: BoardsTab; access: BoardsAccess; personId: string }) {
  if (tab === "screens") return <ScreensPage access={access} />;
  if (tab === "links") return <LinksPage access={access} />;
  if (tab === "tables") return access.read ? <TablesPage access={access} /> : <NoPermission page />;
  if (!access.read) return <NoPermission page />;
  return <BoardsList access={access} personId={personId} />;
}

/** Naming (2026-11-19): "Tavlor" in the menu, "KPI-tavlor" where it explains; never the English word. */
export const BOARDS_SUBTITLE = "KPI-tavlor med nyckeltal, diagram och information för skärmar och möten.";
const SORTS = ["updated", "title"] as const;
const SCOPES: readonly WorkListScope[] = ["mine", "all"];

function BoardsList({ access, personId }: { access: BoardsAccess; personId: string }) {
  const router = useRouter();
  const prefs = useListPrefs("boards", personId, { sorts: SORTS, scopes: access.edit ? SCOPES : [], scope: "all" });
  const scope = prefs.scope ?? "all";
  const [query, setQuery] = useEntryState("boards.q", "");
  const [creating, setCreating] = useState<{ copyOf?: BoardListItem } | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const read = useWorkspaceData<BoardList>("/api/boards?part=list", (signal) => api<BoardList>("/api/boards?part=list", { signal, cache: "no-store" }));
  const items = useMemo(() => {
    const all = (read.data?.items ?? []).filter((item) => (scope === "all" || item.mine) && listSearchMatches(query, [item.name, item.description]));
    return sortListItems(all, prefs.sort === "title" ? [{ value: (item) => item.name.toLocaleLowerCase("sv-SE") }] : [{ value: (item) => item.updatedAt, direction: "desc" }]);
  }, [read.data, scope, query, prefs.sort]);
  const remove = async (item: BoardListItem) => {
    const ok = await confirm({ title: `Ta bort ${item.name}?`, message: "Tavlan försvinner från listan, skärmarna och länkarna. Tabellerna finns kvar.", confirmLabel: "Ta bort", tone: "danger" });
    if (!ok) return;
    try { await boardsPost({ action: "delete_board", id: item.id }); void read.reload(); }
    catch (error) { announce(error instanceof Error ? error.message : "Tavlan kunde inte tas bort.", true); }
  };
  const menu = (item: BoardListItem) => access.edit ? <EditorMoreMenu label={`Åtgärder för ${item.name}`} testId="board-row-menu" items={[
    { label: "Redigera", icon: Pencil, onSelect: () => router.push(boardHref(item.id, true)) },
    { label: "Kopiera", icon: Copy, onSelect: () => setCreating({ copyOf: item }) },
    { label: "Ta bort", icon: Trash2, danger: true, onSelect: () => void remove(item) },
  ]} /> : null;
  const published = (item: BoardListItem) => item.published ? `Version ${item.published.number}` : "Inte publicerad";
  const changed = (item: BoardListItem) => `Ändrad ${formatSwedish(item.updatedAt, { day: "numeric", month: "short" })}${item.updatedBy ? ` av ${item.updatedBy}` : ""}`;
  return <div className="space-y-5" data-testid="boards-list" data-view={prefs.view}>
    <PageHeader title="Tavlor" description={BOARDS_SUBTITLE}
      actions={access.edit ? <Button type="button" onClick={() => setCreating({})} data-testid="board-new"><Plus aria-hidden="true" />Ny tavla</Button> : undefined} />
    {confirmElement}
    {read.error ? <p role="alert" className="notice text-destructive">{read.error}</p> : null}
    <ListFilterBar testId="boards"
      scope={access.edit ? { value: scope, scopes: SCOPES, onChange: prefs.setScope } : undefined}
      search={{ label: "Sök tavlor", placeholder: "Namn eller beskrivning…", value: query, onChange: setQuery }}
      sort={{ value: prefs.sort, options: listSortOptions(SORTS), onChange: prefs.setSort }}
      view={{ value: prefs.view, onChange: prefs.setView }} />
    {!read.data ? <DelayedSkeleton testId="boards-loading"><div className="rounded-xl border bg-card px-3.5 py-3"><RowsSkeleton rows={5} label="Hämtar tavlor…" /></div></DelayedSkeleton>
      : !items.length ? (!query && scope === "all"
        ? <div className="rounded-xl border bg-card"><Empty title="Inga tavlor än" description={access.edit ? "En KPI-tavla samlar nyckeltal och information på en skärm. Börja med en av exempeltavlorna." : "Här visas tavlorna när de har publicerats."}>
          {access.edit ? <Button type="button" onClick={() => setCreating({})}><Plus aria-hidden="true" />Ny tavla</Button> : null}
        </Empty></div>
        : <div className="notice">Inget matchar urvalet. Ändra filter eller sökning.</div>)
      : prefs.view === "cards" ? <ListCardGrid testId="boards-cards">{items.map((item) => <ListCard key={item.id} testId="boards-card" href={boardHref(item.id)}
          icon={<AreaIcon area="project" icon={Presentation} />} title={item.name} subtitle={item.description || undefined}
          badges={<span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium", item.published ? "border-transparent bg-[#dcf5e6] text-[#14632f] dark:bg-emerald-950 dark:text-emerald-200" : "border-transparent bg-muted text-muted-foreground")}>{published(item)}</span>}
          facts={[{ icon: item.orientation === "portrait" ? Smartphone : Monitor, label: "Format", value: `${item.orientation === "portrait" ? "Stående" : "Liggande"} · ${item.cards} kort` }, { icon: Pencil, label: "Ändrad", value: changed(item) }]}
          footer={menu(item)} />)}</ListCardGrid>
      : <div role="table" aria-label="Tavlor" className="overflow-hidden rounded-xl border bg-card shadow-xs" data-testid="boards-table">
        <div role="row" className="hidden gap-x-3 bg-[var(--panel-header)] px-3.5 py-2.5 text-xs font-semibold text-muted-foreground md:grid md:grid-cols-[minmax(0,1fr)_9rem_12rem_2.5rem_2.5rem]">
          <span role="columnheader">Tavla</span><span role="columnheader">Publicerad</span><span role="columnheader">Ändrad</span><span role="columnheader"><span className="sr-only">Åtgärder</span></span><span role="columnheader"><span className="sr-only">Öppna</span></span>
        </div>
        <div role="rowgroup" className="divide-y">{items.map((item) => <div key={item.id} role="row" className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3.5 py-3 text-sm transition-colors hover:bg-secondary/50 md:grid-cols-[minmax(0,1fr)_9rem_12rem_2.5rem_2.5rem]" data-testid="boards-row">
          <span role="cell" className="flex min-w-0 items-center gap-3">
            <AreaIcon area="project" icon={Presentation} />
            <span className="min-w-0"><Link href={boardHref(item.id)} className="stretched-link block truncate font-semibold hover:text-primary">{item.name}</Link>
              <span className="block truncate text-xs text-muted-foreground">{[item.description, `${item.orientation === "portrait" ? "Stående" : "Liggande"} · ${item.cards} kort`].filter(Boolean).join(" · ")}</span></span>
          </span>
          <span role="cell" className="text-xs text-muted-foreground max-md:hidden">{published(item)}</span>
          <span role="cell" className="truncate text-xs text-muted-foreground max-md:hidden">{changed(item)}</span>
          <span role="cell" className="relative z-10 flex justify-end">{menu(item)}</span>
          <span role="cell" className="hidden justify-end md:flex"><RowChevron /></span>
        </div>)}</div>
      </div>}
    {creating ? <NewBoardDialog copyOf={creating.copyOf} onClose={() => setCreating(null)} /> : null}
  </div>;
}

type Start = { kind: "template"; key: BoardTemplateKey } | { kind: "preset"; key: BoardPreset };
const startValue = (start: Start) => `${start.kind}:${start.key}`;

/**
 * Ny tavla (2026-11-19): ten ready example boards built on Workflow's own measures, or an empty division. Choosing an example
 * gives the board its name until the person writes one of their own.
 */
function NewBoardDialog({ copyOf, onClose }: { copyOf?: BoardListItem; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(copyOf ? `${copyOf.name} (kopia)` : BOARD_TEMPLATES[0]!.label);
  const [named, setNamed] = useState(Boolean(copyOf));
  const [start, setStart] = useState<Start>({ kind: "template", key: BOARD_TEMPLATES[0]!.key });
  const [busy, setBusy] = useState(false);
  // Our own check under the field, never the browser's bubble (filmed 2026-11-20: Tom tavla without a name).
  const [tried, setTried] = useState(false);
  const nameError = tried && !name.trim() ? "Ge tavlan ett namn." : undefined;
  const choose = (next: Start) => {
    setStart(next);
    if (!named) setName(next.kind === "template" ? BOARD_TEMPLATES.find((item) => item.key === next.key)!.label : "");
  };
  const create = async () => {
    setTried(true);
    if (!name.trim()) { document.getElementById("new-board-name")?.focus(); return; }
    setBusy(true);
    try {
      const board = copyOf ? { name: name.trim(), copyOf: copyOf.id } : start.kind === "template" ? { name: name.trim(), template: start.key } : { name: name.trim(), preset: start.key };
      const { id } = await boardsPost<{ id: string }>({ action: "create_board", board });
      onClose();
      router.push(boardHref(id, true));
    } catch (error) { announce(error instanceof Error ? error.message : "Tavlan kunde inte skapas.", true); setBusy(false); }
  };
  const option = (value: Start, label: string, description: string) => {
    const on = startValue(start) === startValue(value);
    return <label key={startValue(value)} className={cn("flex cursor-pointer flex-col gap-0.5 rounded-lg border p-3 text-sm transition-colors", on ? "border-primary bg-primary/10" : "bg-card hover:bg-muted")} data-testid={`board-start-${value.key}`}>
      <span className="flex items-center gap-2 font-semibold"><input type="radio" name="board-start" value={startValue(value)} checked={on} onChange={() => choose(value)} className="accent-[var(--primary)]" />{label}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </label>;
  };
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title={copyOf ? "Kopiera tavla" : "Ny tavla"} size="form">
    <form className="space-y-4" noValidate onSubmit={(event) => { event.preventDefault(); void create(); }} data-testid="board-new-dialog">
      <Field id="new-board-name" label="Namn" value={name} onChange={(value) => { setName(value.slice(0, 80)); setNamed(true); }} required error={nameError} placeholder="Till exempel Verkstaden" />
      {!copyOf ? <>
        <fieldset className="grid gap-2" data-testid="board-templates"><legend className="field-label mb-1 text-xs font-medium">Börja med en exempeltavla</legend>
          <div className="grid gap-2 sm:grid-cols-2">{BOARD_TEMPLATES.map((item) => option({ kind: "template", key: item.key }, item.label, item.description))}</div>
          <p className="text-xs text-muted-foreground">Exemplen bygger på Workflows egna mått. Du ändrar, lägger till och tar bort kort som du vill. Ett kort som du inte har rätt att se säger det i stället för att visa siffrorna.</p>
        </fieldset>
        <fieldset className="grid gap-2"><legend className="field-label mb-1 text-xs font-medium">Eller börja med en tom indelning</legend>
          <div className="grid gap-2 sm:grid-cols-2">{BOARD_PRESETS.map((item) => option({ kind: "preset", key: item.key }, item.label, item.description))}</div>
        </fieldset>
      </> : <p className="text-sm text-muted-foreground">Kopian får samma kort och inställningar som utkastet av {copyOf.name}. Den publiceras inte förrän du väljer det.</p>}
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: copyOf ? "Kopiera" : "Skapa", type: "submit", busy, busyLabel: "Skapar…", testId: "board-new-create" }} />
    </form>
  </Modal>;
}