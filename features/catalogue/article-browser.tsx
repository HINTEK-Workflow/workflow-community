"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListChecks, LoaderCircle, Search, Star } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ListToolbar } from "@/components/page-shell";
import { api } from "@/features/kfid/api";
import { DialogActions, Empty } from "@/features/kfid/ui";
import { DialogPage } from "@/features/kfid/dialog-page";
import { Segmented } from "@/features/workflow/work-list";
import { externalHit, solarSearchNote, solarStockText, type ExternalProduct, type SolarSearchState } from "@/features/workflow/catalogue-picker";
import { ArticleBareCard, ArticleColumns, ArticleHitCard, ArticleSyncContext, isSolarHit, useArticleAdd, type ArticleAdd, type ArticleAdjust, type ArticleSync } from "@/features/catalogue/article-hit";
import type { ProductInfo } from "@/lib/catalogue/product-info";
import { ThumbQueue } from "@/lib/catalogue/thumb-queue";
import { AddToListMenu, FavoritesPane, FavoriteStar, ListsPane, useArticleCollections } from "@/features/catalogue/article-collections";
import { applyArticle, type CatalogueHit } from "@/lib/catalogue/snapshot";
import { catalogRefOfHit, externalRefKey, refInputOfHit, snapshotOfHit } from "@/lib/catalogue/lists";
import type { SolarStock } from "@/lib/integrations/solar";

/**
 * Artikelsöket, ett och samma överallt (2026-10-16: "när man söker efter artiklar så skall det vara som på sidan där
 * man söker efter artiklar och sedan läggs det till som rader … man ska inte söka i raderna, lite så som grossisterna
 * fungerar då man bygger en varukorg"). The company's own register searched by words or numbers (and Solar's catalogue
 * for a whole E-nummer or EAN), each product with its picture, facts, every supplier's offer and Solar's stock, and
 * `− antal +` per offer (the first + adds it). What is added is a row made the one way every row is made (`applyArticle`), handed
 * to the page: Artiklar puts it in a purchase, a quote, a purchase, a work order and an invoice basis add it as a line.
 * Several in a row without closing; nothing here decides rights – the server does.
 *
 * Favoriter och listor (2026-10-16, docs/artikellistor.md): three tabs – Sök, Favoriter (the person's starred
 * articles at once, with today's prices) and Listor (the company's article lists: one line or the whole list at once). A
 * star and "Lägg i lista ▾" stand on every hit. Every row, from whichever tab, goes through the same `onAdd`.
 */
export type { ArticleAdd } from "@/features/catalogue/article-hit";

type ThumbPicture = Pick<ProductInfo, "imageUrl" | "imageSig">;
const THUMB_PARALLEL = 4;
const THUMB_PER_SEARCH = 200;

type Tab = "search" | "favorites" | "lists";
const TABS = [
  { value: "search" as const, label: "Sök", icon: <Search aria-hidden="true" /> },
  { value: "favorites" as const, label: "Favoriter", icon: <Star aria-hidden="true" /> },
  { value: "lists" as const, label: "Listor", icon: <ListChecks aria-hidden="true" /> },
];

export function ArticleBrowser({ onAdd, onAdjust, toolbar, docName, autoFocus = false, testId = "article-browser" }: {
  /** Adds the row; false (or a thrown error) when it was not added. A string is the added row's id for `onAdjust`. */
  onAdd: (added: ArticleAdd) => Promise<boolean | string | void> | boolean | string | void;
  /** Antal ± or take away the row that was added: − and the bin of `− antal +` change it; without it each + is one more row. */
  onAdjust?: ArticleAdjust;
  /** Something of the page's own beside the search field (Artiklar: which purchase). */
  toolbar?: React.ReactNode;
  /** Which document the rows go to ("Inköp I-0006"): said under "Lägg till hela listan". */
  docName?: string;
  autoFocus?: boolean;
  testId?: string;
}) {
  const [tab, setTab] = useState<Tab>("search");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CatalogueHit[] | null>(null);
  const [answered, setAnswered] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [empty, setEmpty] = useState(false);
  const [external, setExternal] = useState<ExternalProduct | null>(null);
  const [solar, setSolar] = useState<SolarSearchState | undefined>(undefined);
  const [stock, setStock] = useState<Record<string, SolarStock | null>>({});
  const [thumbs, setThumbs] = useState<Record<string, ThumbPicture | "">>({});
  const [queue] = useState(() => new ThumbQueue<ThumbPicture>(
    (sap) => api<{ found: boolean; product?: ProductInfo | null }>(`/api/catalogue?master=${encodeURIComponent(sap)}&kind=sap`, { cache: "no-store" }).then((answer) => (answer.found && answer.product?.imageUrl ? answer.product : "")),
    (id, picture) => setThumbs((current) => ({ ...current, [id]: picture })), THUMB_PARALLEL, THUMB_PER_SEARCH, 1));
  // Before the first search nothing is known about Solar (Favoriter opens first): the pictures are asked for then too; the server answers "not found" quietly when Solar is off.
  const solarOn = solar === undefined || (solar !== "off" && solar !== "unavailable");
  useEffect(() => { queue.enable(solarOn); }, [queue, solarOn]);
  const controls = useArticleAdd(onAdd, onAdjust);
  const collections = useArticleCollections();
  const field = useRef<HTMLInputElement | null>(null);
  const trimmed = query.trim();
  useEffect(() => { if (autoFocus && tab === "search") field.current?.focus(); }, [autoFocus, tab]);

  // A short pause before asking, and an older answer never replaces a newer one.
  useEffect(() => {
    if (trimmed.length < 2) return;
    let current = true;
    const timer = window.setTimeout(() => {
      setBusy(true);
      api<{ articles: CatalogueHit[]; catalogueEmpty?: boolean; external?: ExternalProduct; solar?: SolarSearchState }>(`/api/catalogue?search=${encodeURIComponent(trimmed)}`, { cache: "no-store" })
        .then((result) => { if (current) { queue.reset(); setHits(result.articles); setExternal(result.external ?? null); setSolar(result.solar); setEmpty(Boolean(result.catalogueEmpty)); setAnswered(trimmed); setError(""); } })
        .catch((cause: Error) => { if (current) { setHits([]); setExternal(null); setError(cause.message); } })
        .finally(() => { if (current) setBusy(false); });
    }, 200);
    return () => { current = false; window.clearTimeout(timer); };
  }, [trimmed, queue]);
  // Solar after the choice (2026-10-17: "synkning mot API sker först efter artikeln är vald"): the search reads only the
  // price files; choosing an article (opening its Produktinfo) asks Solar once for its master data and stock.
  const eNumberOf = (hit: CatalogueHit) => (hit.common?.kind === "E" ? hit.common.number : hit.eNumber);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [products, setProducts] = useState<Record<string, ProductInfo | null>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const asked = useRef(new Set<string>());
  const askSolar = useCallback(async (hit: CatalogueHit) => {
    if (asked.current.has(hit.id)) return;
    asked.current.add(hit.id);
    const eNumber = eNumberOf(hit);
    // The register's article (2026-10-17) is asked for by the wholesaler's own number; otherwise by the E-nummer or the EAN.
    const solarRow = [hit, ...(hit.offers ?? [])].map((offer) => offer.catalog).find((info) => info?.wholesaler === "solar");
    const sap = solarRow?.articleNo ?? "";
    const identifier = sap ? `${encodeURIComponent(sap)}&kind=sap` : /^\d{7}$/.test(eNumber ?? "") ? eNumber! : [hit, ...(hit.offers ?? [])].map((offer) => offer.gtin ?? "").find((gtin) => /^\d{8,14}$/.test(gtin));
    if (!identifier) return;
    setLoading((current) => ({ ...current, [hit.id]: true }));
    try {
      const [master, stockAnswer] = await Promise.all([
        hit.product ? Promise.resolve(null) : api<{ found: boolean; product?: ProductInfo | null }>(`/api/catalogue?master=${sap ? identifier : encodeURIComponent(identifier)}`, { cache: "no-store" }).catch(() => null),
        /^\d{7}$/.test(eNumber ?? "") ? api<{ available: boolean; stock?: Record<string, SolarStock | null> }>(`/api/catalogue?stock=${eNumber}`, { cache: "no-store" }).catch(() => null) : Promise.resolve(null),
      ]);
      if (master?.found && master.product) setProducts((current) => ({ ...current, [hit.id]: master.product ?? null }));
      if (stockAnswer?.available && stockAnswer.stock) setStock((known) => ({ ...known, ...stockAnswer.stock }));
    } finally { setLoading((current) => ({ ...current, [hit.id]: false })); }
  }, []);
  // Miniatyrer (2026-10-18: "inget sparas på servern, API:et hämtar bild vid behov"): a Solar hit that comes into view asks the
  // master-data answer for its picture link – at most 4 at a time, one per article, a miss or an error is asked once more after a moment; the server keeps
  // the answer 24 hours (ExternalProductCache) and answers a flood with "not found". A miss or an error leaves the space empty.
  const wantThumb = useCallback((hit: CatalogueHit) => {
    if (hit.product?.imageUrl || !isSolarHit(hit)) return;
    queue.want(hit.id, [hit, ...(hit.offers ?? [])].map((offer) => offer.catalog).find((info) => info?.wholesaler === "solar")?.articleNo ?? "");
  }, [queue]);
  const sync = useMemo<ArticleSync>(() => ({
    thumb: (hit) => [products[hit.id], thumbs[hit.id] || null, hit.product].find((picture) => picture?.imageUrl) ?? { imageUrl: "" },
    wantThumb,
    open: (id) => Boolean(chosen[id]),
    choose: (hit) => { setChosen((current) => ({ ...current, [hit.id]: !current[hit.id] })); void askSolar(hit); },
    // Adding a row asks Solar for nothing (2026-10-19): the extended product information is fetched only when the person opens Produktinfo.
    added: () => undefined,
    product: (hit) => products[hit.id] ?? hit.product,
    stockText: (hit) => solarStockText(stock[eNumberOf(hit) ?? ""]),
    loading: (id) => Boolean(loading[id]),
  }), [chosen, products, stock, loading, askSolar, thumbs, wantThumb]);

  const addExternal = (product: ExternalProduct, quantity?: string) => {
    const key = `solar:${product.eNumber || product.gtin}`;
    const row = applyArticle({ id: crypto.randomUUID(), name: product.name, quantity: quantity ?? controls.quantityOf(key), unit: product.unit }, externalHit(product));
    void controls.run(key, { row, supplierName: "Solar", fromCatalogue: true });
  };
  /** The star and "Lägg i lista ▾" of a hit of the register (only where favourites and lists can be used). */
  const hitActions = (hit: CatalogueHit) => {
    if (collections.off) return null;
    // A register article no price file has is marked by its E-nummer or EAN, like a product of Solar's catalogue.
    if (hit.catalogOnly) return catalogActions(hit);
    const favorite = collections.favoriteOfHit(hit);
    const busyKey = `hit:${hit.id}`;
    return <>
      <FavoriteStar active={Boolean(favorite)} busy={collections.busyKey === busyKey} name={hit.name} onToggle={() => void (favorite ? collections.unmark(busyKey, favorite) : collections.mark(busyKey, refInputOfHit(hit)))} />
      <AddToListMenu collections={collections} name={hit.name} unit={hit.unit} line={() => ({ ref: refInputOfHit(hit), quantity: controls.quantityOf(hit.id) })} />
    </>;
  };
  const catalogActions = (hit: CatalogueHit) => {
    // By the E-nummer or EAN, otherwise by the wholesaler and its own article number (2026-10-17, the "W:" key).
    const target = catalogRefOfHit(hit);
    if (!target) return null;
    const { key, ref } = target;
    const favorite = collections.favoriteOfKey(key);
    const busyKey = `hit:${hit.id}`;
    const snapshot = snapshotOfHit(hit, "solar");
    return <>
      <FavoriteStar active={Boolean(favorite)} busy={collections.busyKey === busyKey} name={hit.name} onToggle={() => void (favorite ? collections.unmark(busyKey, favorite) : collections.mark(busyKey, ref, snapshot))} />
      <AddToListMenu collections={collections} name={hit.name} unit={hit.unit} line={() => ({ ref, quantity: controls.quantityOf(hit.id), snapshot })} />
    </>;
  };
  const externalActions = (product: ExternalProduct) => {
    const key = externalRefKey(product);
    if (collections.off || !key) return null;
    const favorite = collections.favoriteOfKey(key);
    const busyKey = `solar:${key}`;
    const ref = { eNumber: /^\d{7}$/.test(product.eNumber) ? product.eNumber : undefined, gtin: product.gtin || undefined };
    const snapshot = snapshotOfHit(externalHit(product), "solar");
    return <>
      <FavoriteStar active={Boolean(favorite)} busy={collections.busyKey === busyKey} name={product.name} onToggle={() => void (favorite ? collections.unmark(busyKey, favorite) : collections.mark(busyKey, ref, snapshot))} />
      <AddToListMenu collections={collections} name={product.name} unit={product.unit} line={() => ({ ref, quantity: controls.quantityOf(`solar:${product.eNumber || product.gtin}`), snapshot })} />
    </>;
  };

  const shown = trimmed.length >= 2 && answered === trimmed ? hits ?? [] : [];
  const shownExternal = trimmed.length >= 2 && answered === trimmed ? external : null;
  const note = solarSearchNote(solar);
  return <ArticleSyncContext.Provider value={sync}><div className="min-w-0 space-y-4" data-testid={testId}>
    {error ? <p role="alert" className="notice text-destructive">{error}</p> : null}
    <ListToolbar>
      <Segmented label="Visa artiklar" value={tab} options={TABS} onChange={setTab} testId="article-browser-tabs" />
      {tab === "search" ? <div className="relative min-w-0"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input ref={field} type="search" aria-label="Sök artikel" placeholder="Benämning, artikelnummer, E-nummer, RSK eller EAN…" value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" data-testid="articles-search" />
        {busy ? <LoaderCircle className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden="true" /> : null}
      </div> : null}
      {toolbar}
    </ListToolbar>
    {tab === "favorites" ? <FavoritesPane collections={collections} controls={controls} />
      : tab === "lists" ? <ListsPane collections={collections} controls={controls} docName={docName} />
      : trimmed.length < 2 ? <Empty title="Sök en artikel" description={trimmed.length === 1 ? "Skriv minst två tecken." : "Sök på benämning, produkttyp eller nummer. Priset kommer från era prisfiler."} />
      : busy && answered !== trimmed && !shown.length ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Söker…</p>
      : !shown.length && !shownExternal ? <div className="notice" data-testid="articles-none">{empty ? <>Inga träffar i era prisfiler.{note ? ` ${note}` : ""} Priser kommer från prisfiler under <Link className="underline" href="/?view=import">Import</Link>.</> : `Ingen artikel matchar. ${note || "Pröva en del av benämningen eller ett annat nummer."}`}</div>
      : <div className="space-y-2"><ArticleColumns /><ul className="space-y-3" data-testid="articles-results">
        {shownExternal ? <ArticleBareCard name={shownExternal.name} info={externalHit(shownExternal).product} unit={shownExternal.unit} controls={controls} addKey={`solar:${shownExternal.eNumber || shownExternal.gtin}`} onAdd={(quantity) => addExternal(shownExternal, quantity)}
          stockText={solarStockText(stock[shownExternal.eNumber])} actions={externalActions(shownExternal)}
          note={shownExternal.inPriceFiles ? "Finns också i era prisfiler – se priserna nedan." : "Inget pris: varan finns inte i era prisfiler. Skriv inköpspriset på raden."} /> : null}
        {shown.map((hit) => <ArticleHitCard key={hit.id} hit={hit} controls={controls} actions={hitActions(hit)}
          note={hit.catalogOnly ? `${hit.supplierName}: inget pris – varan finns inte i era prisfiler. Skriv inköpspriset på raden.` : undefined} />)}
      </ul></div>}
  </div></ArticleSyncContext.Provider>;
}

/**
 * "Lägg till artiklar" on a document (a quote, a purchase, a work order, an invoice basis): the same search as Artiklar as a
 * page of its own (DialogPage: Bakåt closes it; a screen on a phone), each added article a new row of the document.
 * Samband (2026-10-26): the page knows where it came from – "Tillbaka till arbetsordern" (top right, in sight while
 * the list is scrolled) leads back to the document at the rows, with what was added on it.
 */
export function ArticleBrowserDialog({ open, onOpenChange, title = "Lägg till artiklar", onAdd, onAdjust, docWord, docName }: {
  open: boolean; onOpenChange: (open: boolean) => void; title?: string; onAdd: (added: ArticleAdd) => Promise<boolean | string | void> | boolean | string | void;
  /** Antal ± / take away a row added here (− and the bin of `− antal +`); without it each + is one more row. */
  onAdjust?: ArticleAdjust;
  /** "offerten", "inköpet", "arbetsordern", "fakturaunderlaget" – where the rows go. */
  docWord: string;
  /** The document itself ("Inköp I-0006", "Nytt inköp – sparas när du trycker Spara"): stands on the page so it is never unclear where the rows go. */
  docName?: string;
}) {
  const [count, setCount] = useState(0);
  const close = (value: boolean) => { if (!value) setCount(0); onOpenChange(value); };
  // A page of its own on displays 2–3 and a screen at level 1 (the popup ceiling: big content is never a big box).
  return <DialogPage pageKey="artiklar" open={open} onOpenChange={close} title={title} panelTitle={false} size="page" untracked guardBack={false}>
    <div className="space-y-4" data-testid="article-browser-dialog">
      <div className="space-y-0.5 text-sm text-muted-foreground" data-testid="article-browser-doc">
        {docName ? <p className="flex min-w-0 gap-1" data-testid="article-browser-doc-name"><span className="shrink-0">Läggs till i </span><strong className="min-w-0 truncate font-semibold text-foreground" title={docName}>{docName}</strong></p> : null}
        <p>Varje artikel du lägger till blir en rad i {docWord}.</p>
      </div>
      {open ? <ArticleBrowser autoFocus docName={docName} onAdd={async (added) => { const ok = await onAdd(added); if (ok !== false) setCount((value) => value + 1); return ok; }}
        onAdjust={onAdjust ? async (rowId, quantity) => { const ok = await onAdjust(rowId, quantity); if (ok !== false && quantity === null) setCount((value) => Math.max(0, value - 1)); return ok; } : undefined} /> : null}
      <DialogActions primary={{ label: `Tillbaka till ${docWord}${count ? ` (${count} tillagd${count === 1 ? "" : "a"})` : ""}`, onClick: () => close(false), testId: "article-browser-done" }} />
    </div>
  </DialogPage>;
}
