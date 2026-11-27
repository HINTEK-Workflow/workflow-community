"use client";

import { useEffect, useState } from "react";
import { RowChevron } from "@/components/row-chevron";
import { Popover } from "radix-ui";
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ListPlus, LoaderCircle, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EditorMoreMenu } from "@/components/editor-ribbon";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { DialogActions, Empty, Field, Modal, QuantityStepper, RowsSkeleton } from "@/features/kfid/ui";
import { ArticleBareCard, ArticleHitCard, HitInfo, HitThumb, type ArticleAddControls } from "@/features/catalogue/article-hit";
import {
  hitIsFavorite, hitOfSnapshot, listQuantity, rowOfListLine, rowOfResolved,
  type ArticleListLineView, type ArticleListSummary, type ArticleListView, type ArticleRefInput, type CatalogueFavoriteView, type RefSnapshot,
} from "@/lib/catalogue/lists";
import type { CatalogueHit } from "@/lib/catalogue/snapshot";
import { formatSek } from "@/lib/workflow/expenses";
import { announce } from "@/lib/workflow/toast";
import { cn } from "@/lib/utils";
import { articleUnit, quantityShown, typedQuantity, unitTakesDecimals } from "@/lib/workflow/quantity-step";
import { IconButton } from "@/components/ui/icon-button";
import { RemoveButton } from "@/components/ui/remove-button";

/**
 * Favoriter och artikellistor in the article search (2026-10-16, docs/artikellistor.md): the person's favourites
 * (a star on a hit) and the company's lists ("Lägg i lista ▾" on a hit; the tab Listor opens a list, adds one line or the
 * whole list). Everything goes through /api/catalogue-lists; the server decides who may see, use and change.
 */
type Off = "" | "loading" | string;

export function useArticleCollections() {
  const [favorites, setFavorites] = useState<CatalogueFavoriteView[] | null>(null);
  const [lists, setLists] = useState<ArticleListSummary[] | null>(null);
  /** "" = available; "loading"; otherwise why not (no right, a Local company). */
  const [off, setOff] = useState<Off>("loading");
  const [busyKey, setBusyKey] = useState("");

  useEffect(() => {
    let current = true;
    Promise.all([
      api<{ favorites: CatalogueFavoriteView[] }>("/api/catalogue-lists?part=favorites", { cache: "no-store" }),
      api<{ lists: ArticleListSummary[] }>("/api/catalogue-lists?part=lists", { cache: "no-store" }),
    ]).then(([fav, all]) => { if (current) { setFavorites(fav.favorites); setLists(all.lists); setOff(""); } })
      .catch((cause: Error) => { if (current) { setFavorites([]); setLists([]); setOff(cause.message || "Favoriter och listor går inte att visa här."); } });
    return () => { current = false; };
  }, []);

  const favoriteOfHit = (hit: CatalogueHit) => favorites?.find((favorite) => hitIsFavorite(hit, [favorite])) ?? null;
  const favoriteOfKey = (key: string | null) => (key ? favorites?.find((favorite) => favorite.key === key) ?? null : null);

  const mark = async (busy: string, ref: ArticleRefInput, snapshot?: RefSnapshot) => {
    setBusyKey(busy);
    try {
      const { favorite } = await api<{ favorite: CatalogueFavoriteView }>("/api/catalogue-lists", { method: "POST", body: JSON.stringify({ action: "favorite", ref, snapshot }) });
      setFavorites((current) => [favorite, ...(current ?? []).filter((item) => item.key !== favorite.key)]);
      announce(`${favorite.snapshot.name} är en favorit.`);
    } catch (cause) { announce((cause as Error).message, true); } finally { setBusyKey(""); }
  };
  const unmark = async (busy: string, favorite: CatalogueFavoriteView) => {
    setBusyKey(busy);
    try {
      await api("/api/catalogue-lists", { method: "POST", body: JSON.stringify({ action: "unfavorite", id: favorite.id }) });
      setFavorites((current) => (current ?? []).filter((item) => item.id !== favorite.id));
      // Ångra (ART-19): the star is put back with the same article.
      const ref: ArticleRefInput | null = favorite.productId ? { productId: favorite.productId } : favorite.articleId ? { articleId: favorite.articleId } : null;
      announce(`${favorite.snapshot.name} är inte längre en favorit.`, false, ref ? [{ label: "Ångra", run: () => void mark(busy, ref, favorite.snapshot) }] : undefined);
    } catch (cause) { announce((cause as Error).message, true); } finally { setBusyKey(""); }
  };
  const summaryOf = (list: ArticleListView): ArticleListSummary => ({ id: list.id, name: list.name, description: list.description, lineCount: list.lineCount, createdByName: list.createdByName, updatedAt: list.updatedAt, canEdit: list.canEdit });
  const remember = (list: ArticleListView) => setLists((current) => [...(current ?? []).filter((item) => item.id !== list.id), summaryOf(list)].sort((a, b) => a.name.localeCompare(b.name, "sv")));
  const forget = (id: string) => setLists((current) => (current ?? []).filter((item) => item.id !== id));
  const addToList = async (listId: string, line: { ref: ArticleRefInput; quantity: string; snapshot?: RefSnapshot }, name = "") => {
    const before = lists?.find((item) => item.id === listId)?.lineCount ?? null;
    try {
      const { list } = await api<{ list: ArticleListView }>("/api/catalogue-lists", { method: "POST", body: JSON.stringify({ action: "add_lines", id: listId, lines: [line] }) });
      remember(list);
      // The same article again does not make a second line, it raises the antal – and the message says so (K2, decision 13).
      const merged = before !== null && list.lineCount === before ? list.lines.find((item) => item.name === name || item.article?.hit?.name === name) : undefined;
      announce(merged ? `Finns redan i listan ${list.name} – antal ${merged.quantity}.` : `Tillagd i listan ${list.name}.`);
      return list;
    } catch (cause) { announce((cause as Error).message, true); return null; }
  };
  const createList = async (input: { name: string; description: string }, lines: unknown[] = []) => {
    const { list } = await api<{ list: ArticleListView }>("/api/catalogue-lists", { method: "POST", body: JSON.stringify({ action: "create", list: input, lines }) });
    remember(list);
    return list;
  };
  return { favorites, lists, off, busyKey, favoriteOfHit, favoriteOfKey, mark, unmark, addToList, createList, remember, forget };
}
export type ArticleCollections = ReturnType<typeof useArticleCollections>;

/** The star on a hit: filled when it is one of the person's favourites. */
export function FavoriteStar({ active, busy, name, onToggle, testId = "article-favorite" }: { active: boolean; busy: boolean; name: string; onToggle: () => void; testId?: string }) {
  const label = active ? `Ta bort ${name} från favoriter` : `Spara ${name} som favorit`;
  return <IconButton label={label} title={active ? "Ta bort från favoriter" : "Spara som favorit"} className="size-9 touch:size-11" aria-pressed={active} disabled={busy} onClick={onToggle} data-testid={testId}>
    {busy ? <LoaderCircle className="animate-spin" /> : <Star className={cn(active && "fill-amber-400 text-amber-500")} />}
  </IconButton>;
}

/**
 * "Lägg i lista ▾" (2026-10-26): everything is done in the drop-down. Each list the person may change is a row with
 * its name, its own `− antal +` (the article's antal in that list; the first + puts it in with the antal field's value) and
 * the bin (takes the article out of that list); "Ny lista…" last. The lists are read when it opens, so the antal is the one
 * in force. A popover, not a menu: + and − never close it, and the rows are big enough to press on a phone.
 */
export function AddToListMenu({ collections, name, unit = "", line }: { collections: ArticleCollections; name: string; unit?: string; line: () => { ref: ArticleRefInput; quantity: string; snapshot?: RefSnapshot } }) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  /** This article's line per list (null = not in it; missing = not read yet). */
  const [lines, setLines] = useState<Record<string, { lineId: string; quantity: number } | null>>({});
  const [busy, setBusy] = useState("");
  const editable = (collections.lists ?? []).filter((list) => list.canEdit);
  const shownUnit = articleUnit(unit);
  const decimals = unitTakesDecimals(shownUnit);
  /** The article's line in a list: by the product or article it points at, otherwise by its name. */
  const lineIn = (list: ArticleListView) => {
    const ref = line().ref;
    const byRef = list.lines.find((item) => item.article && (("productId" in ref && item.article.productId === ref.productId) || ("articleId" in ref && item.article.articleId === ref.articleId)));
    const mine = byRef ?? list.lines.find((item) => item.name === name || item.article?.hit?.name === name);
    return mine ? { lineId: mine.id, quantity: listQuantity(mine.quantity) ?? 1 } : null;
  };
  const read = (list: ArticleListView) => setLines((current) => ({ ...current, [list.id]: lineIn(list) }));
  const opened = (value: boolean) => {
    setOpen(value);
    if (!value) return;
    // Read every list once per opening: someone else may have changed one since.
    setLines({});
    for (const list of editable) void api<{ list: ArticleListView }>(`/api/catalogue-lists?id=${encodeURIComponent(list.id)}`, { cache: "no-store" })
      .then((answer) => read(answer.list)).catch(() => setLines((current) => ({ ...current, [list.id]: null })));
  };
  const put = async (listId: string, quantity?: string) => {
    setBusy(listId);
    try { const list = await collections.addToList(listId, { ...line(), ...(quantity ? { quantity } : {}) }, name); if (list) read(list); } finally { setBusy(""); }
  };
  /** The article's line in `listId` to `next`, or out of the list when `next` is null. */
  const change = async (listId: string, listName: string, next: number | null) => {
    const known = lines[listId];
    if (!known) return;
    setBusy(listId);
    try {
      const fresh = await api<{ list: ArticleListView }>(`/api/catalogue-lists?id=${encodeURIComponent(listId)}`, { cache: "no-store" });
      const saved = fresh.list.lines.filter((item) => next !== null || item.id !== known.lineId)
        .map((item) => ({ id: item.id, quantity: item.id === known.lineId && next !== null ? quantityShown(next) : item.quantity, ...(item.article ? {} : { name: item.name, unit: item.unit }) }));
      const result = await api<{ list: ArticleListView }>("/api/catalogue-lists", { method: "POST", body: JSON.stringify({ action: "update", id: listId, revision: fresh.list.revision, lines: saved }) });
      collections.remember(result.list);
      read(result.list);
      if (next === null) announce(`${name || "Raden"} är borttagen ur listan ${listName}.`);
    } catch (cause) { announce((cause as Error).message, true); } finally { setBusy(""); }
  };
  const typed = (listId: string, listName: string, text: string) => {
    const answer = typedQuantity(text, shownUnit);
    if ("problem" in answer) { announce(answer.problem, true); return; }
    if (lines[listId]) void change(listId, listName, answer.value > 0 ? answer.value : null);
    else if (answer.value > 0) void put(listId, quantityShown(answer.value));
  };
  return <>
    <Popover.Root open={open} onOpenChange={opened}>
      <Popover.Trigger asChild><Button type="button" size="sm" variant="outline" className="h-9 touch:h-11" aria-label={`Lägg ${name} i en lista`} data-testid="article-to-list"><ListPlus />Lägg i lista<ChevronDown /></Button></Popover.Trigger>
      <Popover.Portal><Popover.Content align="end" sideOffset={6} collisionPadding={16} className="z-50 max-h-(--radix-popover-content-available-height) w-[min(22rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg" aria-label={`Listor för ${name}`} data-testid="article-to-list-menu">
        {editable.length ? <ul className="divide-y">{editable.map((list) => {
          const known = lines[list.id];
          const loaded = known !== undefined;
          const remove = () => void change(list.id, list.name, null);
          return <li key={list.id} className="flex min-h-11 items-center gap-2 px-1.5 py-1.5" data-testid="article-to-list-item" data-list={list.name}>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium" title={list.name}>{list.name}</span>
              <span className="block text-xs text-muted-foreground">{list.lineCount} {list.lineCount === 1 ? "rad" : "rader"}</span></span>
            <QuantityStepper size="field" value={known?.quantity ?? 0} min={known ? (decimals ? 0.01 : 1) : 0} label={`Antal ${name} i listan ${list.name}`} unit={shownUnit} decimals={decimals}
              disabled={!loaded || busy === list.id} testId="article-list-stepper" format={quantityShown} reserveDelete
              parts={{ minus: "article-list-minus", plus: "article-list-plus", value: "article-list-qty", remove: "article-list-remove-added", unit: "article-list-unit" }}
              onChange={(next) => void (known ? change(list.id, list.name, next) : put(list.id))} onType={(text) => typed(list.id, list.name, text)}
              onRemove={known ? remove : undefined} onDelete={known ? remove : undefined} />
          </li>;
        })}</ul> : null}
        {editable.length ? <div className="my-1 h-px bg-border" /> : null}
        <button type="button" onClick={() => { setOpen(false); setCreating(true); }} className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm outline-none hover:bg-secondary focus-visible:bg-secondary" data-testid="article-to-new-list"><Plus className="size-4 opacity-80" />Ny lista…</button>
      </Popover.Content></Popover.Portal>
    </Popover.Root>
    <ListFormDialog open={creating} onOpenChange={setCreating} title="Ny lista" saveLabel="Skapa och lägg till" onSave={async (input) => {
      const list = await collections.createList(input, [line()]);
      read(list);
      announce(`Listan ${list.name} är skapad med ${name}.`);
    }} />
  </>;
}

/** Ny lista / Byt namn: a small dialog with the name and a description. */
export function ListFormDialog({ open, onOpenChange, title, saveLabel = "Spara", initial, onSave }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; saveLabel?: string; initial?: { name: string; description: string }; onSave: (input: { name: string; description: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  if (open !== shown) { setShown(open); if (open) { setName(initial?.name ?? ""); setDescription(initial?.description ?? ""); setError(""); } }
  const save = async () => {
    if (!name.trim()) { setError("Skriv listans namn."); return; }
    setBusy(true); setError("");
    try { await onSave({ name: name.trim(), description: description.trim() }); onOpenChange(false); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  };
  return <Modal open={open} onOpenChange={onOpenChange} title={title} size="compact">
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }} data-testid="article-list-form">
      <Field id="article-list-name" label="Namn" value={name} onChange={setName} placeholder="Till exempel Standard elcentral" required />
      <Field id="article-list-description" label="Beskrivning" value={description} onChange={setDescription} help="Valfri – när listan används." />
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogActions cancel={{ onClick: () => onOpenChange(false) }} primary={{ label: saveLabel, type: "submit", busy, busyLabel: "Sparar…", testId: "article-list-save" }} />
    </form>
  </Modal>;
}

/** The note under an article that has no offers in the register now. */
const bareNote = (snapshot: RefSnapshot) => snapshot.source === "solar" ? "Från Solars katalog – inget pris i era prisfiler. Skriv inköpspriset på raden." : "Finns inte längre i era prisfiler – läggs till utan pris.";

/** Favoriter: the person's marked articles at once, without a search, with today's prices and Lägg till. */
export function FavoritesPane({ collections, controls }: { collections: ArticleCollections; controls: ArticleAddControls }) {
  const { favorites } = collections;
  if (collections.off && collections.off !== "loading") return <p className="notice" data-testid="article-favorites-off">{collections.off}</p>;
  if (!favorites) return <RowsSkeleton />;
  if (!favorites.length) return <Empty title="Inga favoriter ännu" description="Tryck på stjärnan vid en artikel i sökningen, så finns den här nästa gång." />;
  return <ul className="space-y-3" data-testid="article-favorites">
    {favorites.map((favorite) => {
      const busyKey = `fav:${favorite.id}`;
      const star = <FavoriteStar active busy={collections.busyKey === busyKey} name={favorite.snapshot.name} onToggle={() => void collections.unmark(busyKey, favorite)} />;
      const list = <AddToListMenu collections={collections} name={favorite.snapshot.name} unit={favorite.hit?.unit ?? favorite.snapshot.unit} line={() => ({ ref: favorite.productId ? { productId: favorite.productId } : favorite.articleId ? { articleId: favorite.articleId } : { eNumber: favorite.snapshot.eNumber || undefined, gtin: favorite.snapshot.gtin || undefined }, quantity: controls.quantityOf(`fav:${favorite.key}`), snapshot: favorite.snapshot })} />;
      if (favorite.hit) return <ArticleHitCard key={favorite.id} hit={favorite.hit} controls={controls} quantityKey={`fav:${favorite.key}`} actions={<>{star}{list}</>} testId="article-favorite-item" />;
      const addKey = `fav:${favorite.key}`;
      return <ArticleBareCard key={favorite.id} name={favorite.snapshot.name} info={favorite.snapshot.product} unit={favorite.snapshot.unit} thumbHit={solarThumbHit(favorite.snapshot, favorite.key)} note={bareNote(favorite.snapshot)} controls={controls} addKey={addKey}
        onAdd={(quantity) => void controls.run(addKey, rowOfResolved(favorite, quantity ?? controls.quantityOf(addKey), crypto.randomUUID()))} actions={<>{star}{list}</>} testId="article-favorite-item" stepperTestId="article-favorite-stepper" />;
    })}
  </ul>;
}

/** A Solar article of the catalogue (no register offers) as a hit that can ask for its picture when it comes into view. */
function solarThumbHit(snapshot: RefSnapshot, key: string): CatalogueHit | undefined {
  if (snapshot.source !== "solar" || !snapshot.supplierArticleNo) return undefined;
  return { ...hitOfSnapshot(snapshot, key), catalog: { wholesaler: "solar", articleNo: snapshot.supplierArticleNo, name: "", description: "", productType: "", series: "", status: "", statusText: "" } };
}

/** A moment for the page to take the row it was given before the next one (its rows are read from the last render). */
const settle = () => new Promise<void>((resolve) => { requestAnimationFrame(() => window.setTimeout(resolve, 0)); });

/** Listor: the company's lists; one opened shows its lines, each with Lägg till, and Lägg till hela listan. */
export function ListsPane({ collections, controls, docName }: { collections: ArticleCollections; controls: ArticleAddControls; docName?: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  if (collections.off && collections.off !== "loading") return <p className="notice" data-testid="article-lists-off">{collections.off}</p>;
  if (openId) return <ArticleListScreen key={openId} id={openId} collections={collections} controls={controls} docName={docName} onBack={() => setOpenId(null)} />;
  const create = <Button type="button" variant="outline" onClick={() => setCreating(true)} data-testid="article-list-new"><Plus />Ny lista</Button>;
  return <div className="space-y-3" data-testid="article-lists">
    {!collections.lists ? <RowsSkeleton /> : !collections.lists.length
      ? <Empty title="Inga listor ännu" description="Artiklar som brukar höra ihop, till exempel Standard elcentral. Lägg till dem med Lägg i lista vid sökträffen.">{create}</Empty>
      : <>
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-muted-foreground">Företagets listor. Alla som väljer artiklar kan använda dem.</p>{create}</div>
        <ul className="divide-y rounded-lg border bg-card">{collections.lists.map((list) => <li key={list.id}>
          <button type="button" className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-[var(--surface-hover)]" onClick={() => setOpenId(list.id)} data-testid="article-list-row">
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{list.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{[`${list.lineCount} ${list.lineCount === 1 ? "rad" : "rader"}`, list.description, list.createdByName ? `av ${list.createdByName}` : ""].filter(Boolean).join(" · ")}</span></span>
            <RowChevron />
          </button>
        </li>)}</ul>
      </>}
    <ListFormDialog open={creating} onOpenChange={setCreating} title="Ny lista" saveLabel="Skapa" onSave={async (input) => { const list = await collections.createList(input); setOpenId(list.id); }} />
  </div>;
}

/** What a line says under its name: the supplier and price in force, free text, or that the article is gone. */
function lineMeta(line: ArticleListLineView, pricesHidden: boolean): string {
  if (!line.article) return "Fritext";
  const hit = line.article.hit;
  if (!hit) return line.article.snapshot.source === "solar" ? "Solars katalog – inget pris i era prisfiler" : "Finns inte längre i era prisfiler";
  const price = hit.price ? `${formatSek(hit.price.unitPrice)} kr/${hit.unit || "st"}` : pricesHidden ? "" : "Inget pris";
  return [hit.supplierName, hit.supplierArticleNo ? `art.nr ${hit.supplierArticleNo}` : hit.eNumber ? `E ${hit.eNumber}` : "", price].filter(Boolean).join(" · ");
}

function ArticleListScreen({ id, collections, controls, docName, onBack }: { id: string; collections: ArticleCollections; controls: ArticleAddControls; docName?: string; onBack: () => void }) {
  const [list, setList] = useState<ArticleListView | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [free, setFree] = useState({ name: "", unit: "st", quantity: "1" });
  const [confirm, confirmElement] = useConfirm();

  useEffect(() => {
    let current = true;
    api<{ list: ArticleListView }>(`/api/catalogue-lists?id=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((result) => { if (current) setList(result.list); })
      .catch((cause: Error) => { if (current) setError(cause.message); });
    return () => { current = false; };
  }, [id]);

  const shown = (next: ArticleListView) => { setList(next); setQuantities({}); collections.remember(next); };
  /** Saves the lines as they now stand (order, antal, removed); the server keeps the revision. */
  const saveLines = async (lines: { id?: string; quantity: string; name?: string; unit?: string }[]) => {
    if (!list) return false;
    setSaving(true);
    try {
      const result = await api<{ list: ArticleListView }>("/api/catalogue-lists", { method: "POST", body: JSON.stringify({ action: "update", id: list.id, revision: list.revision, lines }) });
      shown(result.list);
      return true;
    } catch (cause) { announce((cause as Error).message, true); return false; } finally { setSaving(false); }
  };
  const asSaved = (lines: readonly ArticleListLineView[]) => lines.map((line) => ({ id: line.id, quantity: line.quantity, ...(line.article ? {} : { name: line.name, unit: line.unit }) }));

  if (error) return <div className="space-y-3"><BackRow onBack={onBack} /><p role="alert" className="notice text-destructive">{error}</p></div>;
  if (!list) return <div className="space-y-3"><BackRow onBack={onBack} /><RowsSkeleton /></div>;
  const lines = list.lines;
  const move = (index: number, step: number) => { const next = [...lines]; const [moved] = next.splice(index, 1); next.splice(index + step, 0, moved); void saveLines(asSaved(next)); };
  const remove = async (line: ArticleListLineView) => { if (await saveLines(asSaved(lines.filter((item) => item.id !== line.id)))) announce(`${line.name} är borttagen ur listan.`); };
  const changeQuantity = (line: ArticleListLineView) => {
    const typed = quantities[line.id];
    if (typed === undefined || typed.trim() === line.quantity) return;
    if (listQuantity(typed) === null) { announce("Antalet måste vara större än 0.", true); setQuantities((current) => { const next = { ...current }; delete next[line.id]; return next; }); return; }
    void saveLines(asSaved(lines).map((item) => (item.id === line.id ? { ...item, quantity: typed.trim() } : item)));
  };
  const addFree = () => {
    if (!free.name.trim()) { announce("Skriv radens text.", true); return; }
    if (listQuantity(free.quantity) === null) { announce("Antalet måste vara större än 0.", true); return; }
    void saveLines([...asSaved(lines), { quantity: free.quantity.trim(), name: free.name.trim(), unit: free.unit.trim() }]);
    setFree({ name: "", unit: "st", quantity: "1" });
  };
  const addAll = async () => {
    setProgress({ done: 0, total: lines.length });
    let done = 0;
    for (const line of lines) {
      if (await controls.run(`line:${line.id}`, rowOfListLine(line, crypto.randomUUID()))) done += 1;
      setProgress({ done, total: lines.length });
      await settle();
    }
    setProgress(null);
    if (done) announce(`${done} ${done === 1 ? "rad" : "rader"} från ${list.name} är tillagd${done === 1 ? "" : "a"}.`);
  };
  const removeList = async () => {
    if (!(await confirm({ title: `Ta bort listan ${list.name}?`, message: "Listan försvinner för alla i företaget. Rader som redan lagts till i dokument påverkas inte.", confirmLabel: "Ta bort listan", tone: "danger" }))) return;
    try {
      await api("/api/catalogue-lists", { method: "POST", body: JSON.stringify({ action: "delete", id: list.id }) });
      collections.forget(list.id);
      announce(`Listan ${list.name} är borttagen.`);
      onBack();
    } catch (cause) { announce((cause as Error).message, true); }
  };

  return <div className="space-y-3" data-testid="article-list">
    <BackRow onBack={onBack} />
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <h3 className="section-title [overflow-wrap:anywhere]" data-testid="article-list-name">{list.name}</h3>
        <p className="text-xs text-muted-foreground">{[list.description, list.createdByName ? `Skapad av ${list.createdByName}` : "", list.canEdit ? "" : "Bara den som skapade listan och en administratör kan ändra den."].filter(Boolean).join(" · ")}</p>
      </div>
      {list.canEdit ? <EditorMoreMenu label={`Åtgärder för ${list.name}`} testId="article-list-more" items={[
        { label: "Byt namn och beskrivning", onSelect: () => setRenaming(true), testId: "article-list-rename" },
        { label: "Ta bort listan", onSelect: () => void removeList(), danger: true, icon: Trash2, testId: "article-list-delete" },
      ]} /> : null}
    </div>
    {!lines.length ? <p className="notice">Listan är tom. Lägg till artiklar med Lägg i lista vid en sökträff{list.canEdit ? ", eller skriv en fritextrad nedan" : ""}.</p>
      : <ul className="divide-y rounded-lg border bg-card" data-testid="article-list-lines">{lines.map((line, index) => <li key={line.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5" data-testid="article-list-line">
        {line.article?.hit ? <HitThumb hit={line.article.hit} /> : null}
        <span className="min-w-0 flex-1 basis-48"><span className="block font-medium [overflow-wrap:anywhere]">{line.article?.hit?.name ?? line.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{lineMeta(line, list.pricesHidden)}</span></span>
        {list.canEdit
          ? <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Input className="h-9 w-20" inputMode="decimal" aria-label={`Antal ${line.name}`} value={quantities[line.id] ?? line.quantity} disabled={saving}
              onChange={(event) => setQuantities((current) => ({ ...current, [line.id]: event.target.value }))} onBlur={() => changeQuantity(line)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); changeQuantity(line); } }} data-testid="article-list-quantity" />{line.article?.hit?.unit || line.unit}</label>
          : <span className="text-sm tabular-nums">{line.quantity} {line.article?.hit?.unit || line.unit}</span>}
        {list.canEdit ? <span className="flex items-center">
          <IconButton label={`Flytta upp ${line.name}`} title="Flytta upp" className="size-9" disabled={saving || index === 0} onClick={() => move(index, -1)}><ArrowUp /></IconButton>
          <IconButton label={`Flytta ned ${line.name}`} title="Flytta ned" className="size-9" disabled={saving || index === lines.length - 1} onClick={() => move(index, 1)}><ArrowDown /></IconButton>
          <RemoveButton label={`Ta bort ${line.name}`} title="Ta bort" className="size-9" disabled={saving} onClick={() => void remove(line)} data-testid="article-list-remove" />
        </span> : null}
        {controls.stepper(`line:${line.id}`, line.article?.hit?.name ?? line.name, line.article?.hit?.unit || line.unit, (quantity) => void controls.run(`line:${line.id}`, rowOfListLine(quantity ? { ...line, quantity } : line, crypto.randomUUID())), "article-list-line-stepper")}
        {line.article?.hit ? <HitInfo hit={line.article.hit} /> : null}
      </li>)}</ul>}
    {list.canEdit ? <form className="field-group grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_6rem_6rem_auto] sm:items-end" onSubmit={(event) => { event.preventDefault(); addFree(); }} data-testid="article-list-free">
      <label className="grid min-w-0 gap-1.5 text-xs font-medium">Fritextrad<Input value={free.name} onChange={(event) => setFree((current) => ({ ...current, name: event.target.value }))} placeholder="Till exempel Kabelstege, kapas på plats" data-testid="article-list-free-name" /></label>
      <label className="grid gap-1.5 text-xs font-medium">Antal<Input inputMode="decimal" value={free.quantity} onChange={(event) => setFree((current) => ({ ...current, quantity: event.target.value }))} /></label>
      <label className="grid gap-1.5 text-xs font-medium">Enhet<Input value={free.unit} onChange={(event) => setFree((current) => ({ ...current, unit: event.target.value }))} /></label>
      <Button type="submit" variant="outline" disabled={saving} data-testid="article-list-free-add"><Plus />Lägg till rad</Button>
    </form> : null}
    {lines.length ? <div className="flex flex-wrap items-start justify-between gap-3">
      <p className="text-sm text-muted-foreground" data-testid="article-list-total">{list.pricesHidden ? `${lines.length} ${lines.length === 1 ? "rad" : "rader"}` : `Summa ${formatSek(list.total.amount)} kr exkl. moms${list.total.unpriced ? ` · ${list.total.unpriced} ${list.total.unpriced === 1 ? "rad" : "rader"} utan pris` : ""}`}</p>
      <Button type="button" disabled={Boolean(progress) || controls.busy} onClick={() => void addAll()} data-testid="article-list-add-all">
        {progress ? <><LoaderCircle className="animate-spin" />Lägger till {progress.done + 1 > progress.total ? progress.total : progress.done + 1} av {progress.total}…</> : <><Plus />Lägg till hela listan ({lines.length} {lines.length === 1 ? "rad" : "rader"})</>}
      </Button>
      {docName ? <p className="flex w-full min-w-0 justify-end gap-1 text-xs text-muted-foreground" data-testid="article-list-target"><span className="shrink-0">Läggs till i </span><span className="min-w-0 truncate" title={docName}>{docName}</span></p> : null}
    </div> : null}
    <ListFormDialog open={renaming} onOpenChange={setRenaming} title="Byt namn på listan" initial={{ name: list.name, description: list.description }} onSave={async (input) => {
      const result = await api<{ list: ArticleListView }>("/api/catalogue-lists", { method: "POST", body: JSON.stringify({ action: "update", id: list.id, revision: list.revision, ...input }) });
      shown(result.list);
    }} />
    {confirmElement}
  </div>;
}

function BackRow({ onBack }: { onBack: () => void }) {
  return <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={onBack} data-testid="article-list-back"><ChevronLeft />Alla listor</Button>;
}

