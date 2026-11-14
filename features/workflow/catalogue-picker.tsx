"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, LoaderCircle, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { cn } from "@/lib/utils";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { articleNumberOf, hitProductType, hitWithOffer, offerFacts, offerWarning, percentText, priceAgeHint, priceMarkOf, priceSourceText, todayInSweden, type CatalogueHit, type CatalogueSnapshot } from "@/lib/catalogue/snapshot";
import { BASE_PRICE_NOTE } from "@/lib/catalogue/price-kind";
import { formatPrice } from "@/lib/workflow/expenses";
import { solarStatusText, type SolarStock } from "@/lib/integrations/solar";
import { productInfoOfApi } from "@/lib/catalogue/product-info";
import { ProductStatus, ProductThumb } from "@/features/catalogue/product-info";

/** At most this many hits are listed under the field; the search itself returns up to 20. */
const SHOWN_HITS = 8;

/** A product of Solar's catalogue found for a whole E-nummer or GTIN (2026-10-14): master data only, never a price. */
export type ExternalProduct = { source: "solar"; name: string; unit: string; eNumber: string; gtin: string; manufacturer: string; manufacturerArticleNo: string; imageUrl: string; imageSig?: string; inPriceFiles: boolean;
  /** Solar's SAP material number and product status code (2026-10-15), absent when Solar gave none. */ sapMaterialNumber?: string; status?: string };

/** The catalogue's product as a hit the row can take: name, unit, E-nummer and the manufacturer's number – no price. */
export const externalHit = (product: ExternalProduct): CatalogueHit => ({
  id: `solar:${product.eNumber || product.gtin}`, name: product.name, unit: product.unit.toLowerCase(), supplierArticleNo: "", eNumber: product.eNumber,
  supplierName: "Solars katalog", manufacturerArticleNo: product.manufacturerArticleNo, ...(product.gtin ? { gtin: product.gtin } : {}), ...(product.manufacturer ? { manufacturer: product.manufacturer } : {}), price: null,
  // Produktens uppgifter (2026-10-16): the same facts and picture follow the row as in the hit.
  product: productInfoOfApi("solar", { eNumber: product.eNumber, gtin: product.gtin, manufacturer: product.manufacturer, manufacturerArticleNo: product.manufacturerArticleNo, imageUrl: product.imageUrl, imageSig: product.imageSig, statusText: solarStatusText(product.status) }),
});

/**
 * Benämning är sökfältet (2026-10-09, materialsökningen): typing in the material row's name searches the
 * company's catalogue, and the hits fold out right under the field – full width of the field, never past the screen's
 * edge (the earlier search box hung from a small icon and started outside a phone's screen). Picking a hit fills
 * Benämning, the unit, the article number with its source and, for someone who may see prices, the price. A name that is
 * not in the catalogue is simply kept as typed. The catalogue is Cloud only; in a Local file and without the right the
 * field is a plain text field.
 *
 * Sök i prisfilen (2026-10-11): the search was not found – the field looked like any text field, nothing
 * showed before two letters were typed, and an empty catalogue only said "Ingen artikel hittades". So the field now has a
 * search icon and, in focus, says what it searches (name, article number, the manufacturer's number); the hits show
 * supplier and price over the rows below; "Inga träffar i prisfilen" says so, and an empty catalogue points to Import.
 */
/**
 * Lagersaldo hos Solar (2026-10-15): "Solar: 12 st i lager" beside a hit with an E-nummer – the stock Solar
 * promises near the company's postal code, asked once per search for the hits shown. When the installation has no Solar
 * key or the company no postal code, nothing is asked again in this visit.
 */
let solarStockOff = false;
const stockNumber = (hit: CatalogueHit) => hit.common?.kind === "E" ? hit.common.number : hit.eNumber ?? "";
/**
 * Solars katalog utan prisfil (2026-10-16: "det ska inte behövas"): what the search says about Solar when the company's
 * own files gave nothing. Solar's API looks up one product by a whole number; it cannot search on words.
 */
export type SolarSearchState = "found" | "known" | "not-found" | "not-number" | "unavailable" | "off";
export function solarSearchNote(solar: SolarSearchState | undefined): string {
  switch (solar) {
    case "not-number": return "Skriv ett helt E-nummer (7 siffror) eller EAN så hämtas varan från Solars katalog.";
    case "not-found": return "Solars katalog har ingen vara med det numret.";
    case "unavailable": return "Solars katalog svarade inte just nu. Försök igen om en stund.";
    default: return "";
  }
}

export function solarStockText(item: SolarStock | null | undefined): string {
  if (!item || item.stock === null) return "";
  // The moment Solar was asked (kept at most ten minutes), so a saldo is never taken for anything but a fresh answer.
  const at = item.fetchedAt ? new Date(item.fetchedAt) : null;
  const when = at && !Number.isNaN(at.getTime()) ? ` · kl. ${at.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm" })}` : "";
  return (item.stock > 0 ? `Solar: ${item.stock.toLocaleString("sv-SE")} ${(item.unit || "st").toLowerCase()} i lager` : "Solar: inte i lager") + when;
}

export function ArticleSearchField({ value, onChange, onPick, local, disabled = false, name, className, label = "Benämning" }: {
  value: string;
  onChange: (name: string) => void;
  onPick: (hit: CatalogueHit) => void;
  local: boolean;
  disabled?: boolean;
  name?: string;
  className?: string;
  label?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<CatalogueHit[]>([]);
  const [searching, setSearching] = useState(false);
  /** The query the shown hits answer: "no hits" is only said for a search that has finished, never while it is still to start. */
  const [answered, setAnswered] = useState("");
  const [error, setError] = useState("");
  /** The search found nothing because the company has no article at all (and whether this person may import a file). */
  const [emptyCatalogue, setEmptyCatalogue] = useState<{ canImport: boolean } | null>(null);
  const [solar, setSolar] = useState<SolarSearchState | undefined>(undefined);
  /** Grossistens katalog (2026-10-14): the product Solar's catalogue has for a whole E-nummer or GTIN. */
  const [external, setExternal] = useState<ExternalProduct | null>(null);
  const [stock, setStock] = useState<Record<string, SolarStock | null>>({});
  const [focused, setFocused] = useState(false);
  /**
   * Where the hits open: under the field, or over it when there is too little room under it (a view's footer or the bottom bar
   * would cover them; 2026-10-11, the invoice basis). Measured when the person focuses or types, never while drawing.
   */
  const [placement, setPlacement] = useState({ above: false, max: 288 });
  const measure = () => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom - 104;
    const above = rect.top - 72;
    const flip = below < 200 && above > below;
    setPlacement({ above: flip, max: Math.max(120, Math.min(288, flip ? above : below)) });
  };
  // Searches start only from what the person typed (not when a saved row is drawn), and stop for good when the
  // catalogue cannot be used here (Local, no right): the field is then a plain text field.
  const [typed, setTyped] = useState(false);
  const [unavailable, setUnavailable] = useState(local);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement | null>(null);
  const today = todayInSweden();
  const query = value.trim();
  const searchable = typed && !unavailable && !disabled && query.length >= 2;

  useEffect(() => {
    if (!searchable) return;
    let current = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      api<{ articles: CatalogueHit[]; catalogueEmpty?: boolean; canImport?: boolean; external?: ExternalProduct; solar?: SolarSearchState }>(`/api/catalogue?search=${encodeURIComponent(query)}`, { cache: "no-store" })
        .then((data) => { if (current) { setAnswered(query); setSolar(data.solar); setHits(data.articles); setExternal(data.external ?? null); setEmptyCatalogue(data.catalogueEmpty && !data.external ? { canImport: Boolean(data.canImport) } : null); setError(""); setActive(-1); } })
        .catch((cause: Error & { status?: number }) => {
          if (!current) return;
          setHits([]);
          if (cause.status === 403 || cause.status === 409) setUnavailable(true);
          else setError(cause.message);
        })
        .finally(() => { if (current) setSearching(false); });
    }, 250);
    return () => { current = false; window.clearTimeout(timer); };
  }, [searchable, query]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const shown = searchable ? hits.slice(0, SHOWN_HITS) : [];
  const shownExternal = searchable && answered === query ? external : null;
  const stockKey = [...shown.map(stockNumber), shownExternal?.eNumber ?? ""].filter((value) => /^\d{7}$/.test(value)).join(",");
  useEffect(() => {
    if (local || solarStockOff || !stockKey) return;
    const wanted = stockKey.split(",").filter((value) => !(value in stock));
    if (!wanted.length) return;
    let current = true;
    api<{ available: boolean; stock?: Record<string, SolarStock | null> }>(`/api/catalogue?stock=${wanted.join(",")}`, { cache: "no-store" })
      .then((data) => { if (!data.available) { solarStockOff = true; return; } if (current && data.stock) setStock((known) => ({ ...known, ...data.stock })); })
      .catch(() => undefined);
    return () => { current = false; };
  }, [local, stockKey]); // eslint-disable-line react-hooks/exhaustive-deps -- what is known is only read to skip it
  const listOpen = open && searchable && (searching || Boolean(error) || shown.length > 0 || Boolean(shownExternal) || answered === query);
  // In focus with fewer than two letters: a short line says what the field searches.
  const hintOpen = !unavailable && !disabled && focused && !listOpen && query.length < 2;
  const pick = (hit: CatalogueHit) => {
    onPick(hit); setOpen(false); setTyped(false); setHits([]); setExternal(null); setActive(-1);
    // Grunddata (2026-10-14): the picked product learns the wholesaler catalogue's master data on the server; nothing waits for it.
    if (hit.common?.kind === "E" && !hit.id.startsWith("solar:")) void fetch(`/api/catalogue?master=${encodeURIComponent(hit.common.number)}`, { cache: "no-store" }).catch(() => undefined);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && listOpen) { event.preventDefault(); setOpen(false); return; }
    if (!listOpen || !shown.length) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => (index + 1) % shown.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => (index <= 0 ? shown.length - 1 : index - 1)); }
    else if (event.key === "Enter" && active >= 0) { event.preventDefault(); pick(shown[active]); }
  };
  return <div ref={box} className={cn("relative min-w-0", className)} data-testid="article-search">
    {unavailable ? null : <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />}
    <Input aria-label={label} placeholder={unavailable ? "Benämning" : "Sök artikel eller skriv benämning"} value={value} name={name} maxLength={300} disabled={disabled} autoComplete="off"
      role={unavailable ? undefined : "combobox"} aria-expanded={unavailable ? undefined : listOpen} aria-controls={unavailable ? undefined : listId} aria-autocomplete={unavailable ? undefined : "list"}
      aria-activedescendant={listOpen && active >= 0 ? `${listId}-${active}` : undefined}
      onChange={(event) => { onChange(event.target.value); setTyped(true); setOpen(true); measure(); }} onFocus={() => { setFocused(true); measure(); if (typed) setOpen(true); }} onBlur={() => setFocused(false)} onKeyDown={onKeyDown} className={cn("pr-9", !unavailable && "pl-8")} />
    {value && !disabled ? <button type="button" className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-primary" aria-label="Rensa benämningen" onClick={() => { onChange(""); setTyped(false); setOpen(false); }}><X className="size-4" /></button> : null}
    {hintOpen ? <p className={cn("absolute left-0 z-30 w-max max-w-[min(26rem,calc(100vw-2rem))] rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-muted-foreground shadow-md", placement.above ? "bottom-full mb-1" : "top-full mt-1")} data-testid="article-search-hint">Skriv minst två tecken för att söka i prisfilen på benämning, artikelnummer eller tillverkarens nummer.</p> : null}
    {/* Over the rows below it, never clipped by the row or the panel: it is as wide as the field but at least 26 rem, and never past the screen. */}
    {listOpen ? <div className={cn("absolute left-0 z-40 w-full min-w-[min(26rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg", placement.above ? "bottom-full mb-1" : "top-full mt-1")} data-testid="article-search-results">
      {(searching || (answered !== query && !error)) && !shown.length ? <p className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground" role="status"><LoaderCircle className="size-3.5 animate-spin" />Söker i artiklar och priser…</p> : null}
      {error ? <p role="alert" className="px-2 py-2 text-xs text-destructive">{error}</p> : null}
      {/* Solars katalog (2026-10-14): name, unit and numbers for a number no price file has; the price comes from the company's own files. */}
      {shownExternal ? <button type="button" className="flex min-h-11 w-full cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-secondary" onPointerDown={(event) => event.preventDefault()} onClick={() => pick(externalHit(shownExternal))} data-testid="article-search-external">
        <ProductThumb info={externalHit(shownExternal).product} /><span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex w-full items-baseline gap-2"><span className="min-w-0 flex-1 truncate text-sm font-medium">{shownExternal.name}</span><span className="shrink-0 text-[11px] text-muted-foreground">{shownExternal.inPriceFiles ? "finns i er prisfil" : "inget pris – inte i era prisfiler"}</span></span>
        <span className="truncate text-[11px] text-muted-foreground">{["Solars katalog", shownExternal.eNumber ? `E ${shownExternal.eNumber}` : "", shownExternal.manufacturer, shownExternal.manufacturerArticleNo ? `tillv. ${shownExternal.manufacturerArticleNo}` : "", shownExternal.gtin ? `GTIN ${shownExternal.gtin}` : "", shownExternal.sapMaterialNumber ? `SAP ${shownExternal.sapMaterialNumber}` : "", shownExternal.unit].filter(Boolean).join(" · ")}</span>
        {solarStatusText(shownExternal.status) ? <span className={cn("w-fit rounded-full px-2 py-0.5 text-[11px]", indicatorBadge("warning"))} data-testid="article-search-external-status">{solarStatusText(shownExternal.status)}</span> : null}
        {solarStockText(stock[shownExternal.eNumber]) ? <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400" data-testid="article-search-stock">{solarStockText(stock[shownExternal.eNumber])}</span> : null}
      </span></button> : null}
      {!searching && !error && !shown.length && !shownExternal && answered === query ? <div className="space-y-1 px-2 py-2 text-xs text-muted-foreground" data-testid="article-search-none">
        {emptyCatalogue && solar && solar !== "off"
          // Without price files Solar's catalogue still answers a whole number; the price file is a suggestion, not a demand.
          ? <p data-testid="article-search-empty-catalogue"><span className="font-medium text-foreground">Inga prisfiler än.</span> {solarSearchNote(solar)}{emptyCatalogue.canImport ? <> Priser kommer från prisfiler under <Link href="/?view=import" className="font-medium text-primary underline underline-offset-2" onPointerDown={(event) => event.stopPropagation()}>Import</Link>.</> : null}</p>
          : emptyCatalogue
          ? <p data-testid="article-search-empty-catalogue"><span className="font-medium text-foreground">Prisfilen är tom.</span> {emptyCatalogue.canImport ? <>Importera en prisfil på sidan <Link href="/?view=import" className="font-medium text-primary underline underline-offset-2" onPointerDown={(event) => event.stopPropagation()}>Import</Link> så kan du söka material här.</> : "Be den som ansvarar för artiklar och priser att importera en prisfil."}</p>
          : <p><span className="font-medium text-foreground">Inga träffar i prisfilen.</span> {solarSearchNote(solar) || "Prova ett annat ord eller ett artikelnummer."}</p>}
        <p>Raden sparas med benämningen som du skrivit.</p>
      </div> : null}
      {shown.length ? <ul id={listId} role="listbox" aria-label="Artiklar" className="overflow-y-auto overscroll-contain" style={{ maxHeight: placement.max }}>
        {shown.map((hit, index) => {
          const hint = hit.price ? priceAgeHint(hit.price, today) : "";
          const number = articleNumberOf(hit);
          return <li key={hit.id} id={`${listId}-${index}`} role="option" aria-selected={index === active}
            className={cn("flex min-h-11 cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-left", index === active ? "bg-secondary" : "hover:bg-secondary")}
            onPointerDown={(event) => event.preventDefault()} onClick={() => pick(hit)} onMouseMove={() => setActive(index)} data-testid="article-search-hit">
            <ProductThumb info={hit.product} /><span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex w-full items-baseline gap-2"><span className="min-w-0 flex-1 truncate text-sm font-medium">{hit.name}</span>{hit.priceHidden ? null : <span className="shrink-0 text-sm tabular-nums">{hit.price?.rebate ? <span className="mr-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400" data-testid="article-search-discount">{hit.price.rebate.rule === "NET" ? "Avtalspris" : `${percentText(hit.price.rebate.percent)} %`} <s className="font-normal text-muted-foreground">{formatPrice(hit.price.rebate.basePrice)}</s></span> : null}{hit.price ? `${formatPrice(hit.price.unitPrice)} kr${hit.unit ? `/${hit.unit}` : ""}` : "inget pris"}</span>}</span>
            <span className="truncate text-[11px] text-muted-foreground">{[hit.common ? `${hit.common.kind} ${hit.common.number}` : "", number ? `Art.nr ${number}` : "", hit.supplierName, hitProductType(hit), hit.manufacturerArticleNo ? `tillv. ${hit.manufacturerArticleNo}` : "", hit.supplierOnly ? "bara hos denna leverantör" : ""].filter(Boolean).join(" · ")}</span>
            {/* Förpackning, multipel, minsta beställning och lagervara from the price file (2026-10-15); the price stays per the unit above. */}
            {offerFacts(hit).length ? <span className="truncate text-[11px] text-muted-foreground" data-testid="article-search-facts">{offerFacts(hit).join(" · ")}</span> : null}
            {offerWarning(hit) ? <span className={cn("w-fit rounded-full px-2 py-0.5 text-[11px]", indicatorBadge("warning"))} data-testid="article-search-warning">{offerWarning(hit)}</span> : null}
            {solarStockText(stock[stockNumber(hit)]) ? <span className={cn("w-fit text-[11px] font-medium", (stock[stockNumber(hit)]?.stock ?? 0) > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")} data-testid="article-search-stock">{solarStockText(stock[stockNumber(hit)])}</span> : null}
            {/* Ett artikelregister (2026-10-12): the same product at the company's other suppliers, each with its own
                number and price; a tap picks that supplier's offer instead. */}
            {(hit.offers?.length ?? 0) > 1 ? <span className="flex flex-wrap gap-1" data-testid="article-search-offers">{hit.offers!.map((offer) => <button key={offer.id} type="button"
              className={cn("rounded-md border px-1.5 py-0.5 text-left text-[11px] tabular-nums hover:border-primary/50 hover:text-primary", offer.id === hit.id && "border-primary/60 bg-secondary font-medium")}
              aria-label={`Välj ${offer.supplierName}, artikelnummer ${offer.supplierArticleNo || "saknas"}`} onPointerDown={(event) => event.preventDefault()}
              onClick={(event) => { event.stopPropagation(); pick(hitWithOffer(hit, offer.id)); }} data-testid="article-search-offer">
              {offer.supplierName} · {offer.supplierArticleNo || "–"}{hit.priceHidden ? "" : ` · ${offer.price ? `${formatPrice(offer.price.unitPrice)} kr/${offer.unit || "st"}${offer.price.priceKind === "BASE" ? " (grundpris)" : ""}` : "inget pris"}`}{offerWarning(offer) ? ` · ${offerWarning(offer)}` : ""}
            </button>)}</span> : null}
            {/* Grundpris (2026-10-13 natt): the wholesaler's price before the company's discount is said where it is chosen. */}
            {!hit.priceHidden && hit.price?.priceKind === "BASE" ? <span className={cn("w-fit rounded-full px-2 py-0.5 text-[11px]", indicatorBadge("warning"))} data-testid="article-search-base-price">{BASE_PRICE_NOTE}</span> : null}
            {hint ? <span className={cn("w-fit rounded-full px-2 py-0.5 text-[11px]", indicatorBadge("warning"))}>{hint}</span> : null}
            {/* A wholesaler's status stands on the wholesaler's own row (offerWarning, 2026-10-17); only a hit without register rows shows the product's. */}
            {hit.product?.statusText && !hitProductType(hit) && !hit.offers?.some((offer) => offer.catalog) ? <ProductStatus info={hit.product} /> : null}
          </span></li>;
        })}
      </ul> : null}
      {hits.length > SHOWN_HITS ? <p className="px-2 pb-1 pt-1.5 text-[11px] text-muted-foreground">Visar {SHOWN_HITS} av {hits.length}. Skriv fler ord, ett artikelnummer eller E-nummer för att hitta rätt.</p> : null}
    </div> : null}
  </div>;
}

/**
 * Artikelnummer med källa och tillverkarens artikelnummer (2026-10-09) under a material row. A number from the
 * catalogue says which supplier it is from; a number typed by hand is the company's own. Changing a copied number makes
 * it the company's own.
 */
export function ArticleNumberFields({ articleNo, articleSource, manufacturerArticleNo, onPatch, disabled = false }: {
  articleNo?: string; articleSource?: string; manufacturerArticleNo?: string;
  onPatch: (patch: { articleNo?: string; articleSource?: string; manufacturerArticleNo?: string }) => void;
  disabled?: boolean;
}) {
  const source = (articleNo ?? "").trim() ? (articleSource?.trim() ? `Leverantör: ${articleSource.trim()}` : "Eget nummer") : "";
  return <div className="col-span-full grid grid-cols-2 items-end gap-2 sm:grid-cols-[10rem_10rem_minmax(0,1fr)]" data-testid="material-article-numbers">
    <label className="space-y-1.5 text-xs font-medium text-muted-foreground">Artikelnummer
      <Input aria-label="Artikelnummer" placeholder="Art.nr" value={articleNo ?? ""} maxLength={60} disabled={disabled} onChange={(event) => onPatch({ articleNo: event.target.value, articleSource: "" })} />
    </label>
    <label className="space-y-1.5 text-xs font-medium text-muted-foreground">Tillverkarens art.nr
      <Input aria-label="Tillverkarens artikelnummer" placeholder="Valfritt" value={manufacturerArticleNo ?? ""} maxLength={60} disabled={disabled} onChange={(event) => onPatch({ manufacturerArticleNo: event.target.value })} />
    </label>
    <p className="col-span-2 min-h-5 text-xs text-muted-foreground sm:col-span-1 sm:pb-2.5" data-testid="material-article-source">{source}</p>
  </div>;
}

/** Under a material row with a copied price: the price, where it came from and, when old, a hint to check it. */
export function CopiedPrice({ snapshot, unitPrice, onClear, showPrice = true }: { snapshot: CatalogueSnapshot; unitPrice?: string; onClear: () => void;
  /** Off when the row's à-pris is already shown in its own field (Priser på materialraden, 2026-10-09). */
  showPrice?: boolean }) {
  const hint = priceAgeHint(snapshot, todayInSweden());
  return <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground col-span-full" data-testid="material-price">
    {showPrice ? <span className="font-medium text-foreground tabular-nums">{unitPrice || snapshot.unitPrice} kr{snapshot.unit ? `/${snapshot.unit}` : ""} exkl. moms</span> : <span className="font-medium text-foreground">Priset kommer från</span>}
    <span>{priceSourceText(snapshot)}</span>
    {hint ? <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5", indicatorBadge("warning"))}><AlertTriangle className="size-3" />{hint}</span> : null}
    <button type="button" className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-secondary hover:text-foreground" onClick={onClear} aria-label="Ta bort priset från raden"><X className="size-3" />Ta bort priset</button>
  </div>;
}

/**
 * Rabatten i prisfältet (2026-10-14, as the wholesalers' web shops): over the row's one À-pris field, small, the
 * discount from the company's discount letter ("32,98 %") or "Avtalspris" with the base price struck through beside it,
 * or "Grundpris" for a base price without a letter. Drawn over the field's top edge, so the row keeps its layout; gone
 * as soon as the person types another price. Place it in a `relative` wrapper around the field.
 */
export function PriceMark({ snapshot, unitPrice }: { snapshot?: Pick<CatalogueSnapshot, "unitPrice" | "priceKind" | "rebate">; unitPrice?: string }) {
  const mark = priceMarkOf(snapshot, unitPrice);
  if (!mark) return null;
  return <span className="pointer-events-none absolute -top-2 right-1.5 z-[1] flex items-baseline gap-1 whitespace-nowrap rounded bg-card px-1 text-[10px] leading-none" data-testid="price-mark" data-tone={mark.tone}>
    <span className={mark.tone === "discount" ? "font-semibold text-emerald-700 dark:text-emerald-400" : "font-medium text-amber-700 dark:text-amber-400"}>{mark.label}</span>
    {mark.basePrice ? <s className="text-muted-foreground" aria-label={`Grundpris ${mark.basePrice} kr`}>{mark.basePrice}</s> : null}
  </span>;
}
