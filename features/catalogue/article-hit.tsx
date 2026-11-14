"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QuantityStepper } from "@/features/kfid/ui";
import { ProductFacts, ProductStatus, ProductThumb } from "@/features/catalogue/product-info";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { applyArticle, hitProductType, hitWithOffer, offerWarning, type CatalogueHit, type CatalogueOffer } from "@/lib/catalogue/snapshot";
import { productFacts, productInfoOfOffer, type ProductInfo } from "@/lib/catalogue/product-info";
import type { ArticleRowAdd } from "@/lib/catalogue/lists";
import { formatSek } from "@/lib/workflow/expenses";
import { cn } from "@/lib/utils";
import { announce } from "@/lib/workflow/toast";
import { parseAmount } from "@/lib/workflow/expenses";
import { articleUnit, quantityShown, typedQuantity, unitTakesDecimals } from "@/lib/workflow/quantity-step";
import { WHOLESALER_LABELS } from "@/lib/wholesale/model";

/**
 * One hit of the article search, the same card wherever an article is shown (Sök, Favoriter, a list's lines): picture,
 * facts, Solar's stock, every supplier's offer with its price, the antal field and `− antal +` per offer. The adding itself
 * (`useArticleAdd`) is shared by the tabs of one ArticleBrowser, so the added antal follows the offer between them.
 */
export type ArticleAdd = ArticleRowAdd;

/**
 * Changes the row an offer was added as (2026-10-18, decision 13): the new antal as text, or null to take the row away
 * again. A page that gives it lets − and the bin change the added row; without it each + adds one more row. false (or a throw) = not done.
 */
export type ArticleAdjust = (rowId: string, quantity: string | null) => Promise<boolean | void> | boolean | void;
type AddedRow = { rowId: string; quantity: number; name: string };

export function useArticleAdd(onAdd: (added: ArticleAdd) => Promise<boolean | string | void> | boolean | string | void, onAdjust?: ArticleAdjust) {
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState("");
  const [added, setAdded] = useState<Record<string, AddedRow>>({});
  /** Adds one row; true when the page took it. A page that returns the row's id (a string) is adjusted by that id. */
  const run = async (key: string, add: ArticleAdd): Promise<boolean> => {
    const known = added[key];
    // Already added and adjustable: one more is the same row's antal + 1, never a second row (ART-04).
    if (known && onAdjust) return adjust(key, 1);
    setAdding(key);
    try {
      const result = await onAdd(add);
      const quantity = Math.max(parseAmount(add.row.quantity) ?? 1, 0.01);
      // A page without the justerare gets a new row each time; the stepper then counts them all.
      if (result !== false) setAdded((current) => ({ ...current, [key]: { rowId: typeof result === "string" ? result : add.row.id, quantity: (onAdjust ? 0 : current[key]?.quantity ?? 0) + quantity, name: add.row.name } }));
      return result !== false;
    } catch { return false; } finally { setAdding(""); }
  };
  /** The justerare: antal ± `delta` on the row that was added; at 0 the row is taken away. */
  const adjust = async (key: string, delta: number): Promise<boolean> => {
    const known = added[key];
    if (!known || !onAdjust) return false;
    const next = Math.round((known.quantity + delta) * 100) / 100;
    setAdding(key);
    try {
      const ok = await onAdjust(known.rowId, next > 0 ? quantityShown(next) : null);
      if (ok === false) return false;
      if (next > 0) setAdded((current) => ({ ...current, [key]: { ...known, quantity: next } }));
      else { setAdded((current) => { const rest = { ...current }; delete rest[key]; return rest; }); announce(`${known.name} är borttagen.`); }
      return true;
    } catch { return false; } finally { setAdding(""); }
  };
  const quantityOf = (key: string, fallback = "1") => quantities[key]?.trim() || fallback;
  /**
   * The field beside the price ("1 st"): what the first + adds, in the article's own unit (st when it has none). `compact`
   * (a row of the article list) without the label above, which the columns give.
   */
  const quantityField = (key: string, name: string, fallback = "1", compact = false, unit = "") => {
    const shownUnit = articleUnit(unit);
    const input = <span className="inline-flex items-center gap-1.5"><Input className="h-9 w-16 touch:h-11" inputMode={unitTakesDecimals(shownUnit) ? "decimal" : "numeric"} aria-label={`Antal ${name} (${shownUnit})`} value={quantities[key] ?? fallback} onChange={(event) => setQuantities((current) => ({ ...current, [key]: event.target.value }))} />
      <span className="min-w-6 text-xs text-muted-foreground" data-testid="article-quantity-unit">{shownUnit}</span></span>;
    return compact ? input : <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">Antal{input}</label>;
  };
  /**
   * − antal + on every article row (2026-10-26), the same before and after: 0 until the article is added; + adds it
   * (`onFirst`, with the field's antal), then + and − change the added row by 1 and the bin takes it away. The antal can be
   * typed in the middle (2,5 only where the unit takes decimals). `testId` names the parts (`-minus`, `-plus`, `-qty`, `-remove`).
   */
  const stepper = (key: string, name: string, unit: string, onFirst: (quantity?: string) => void, testId = "article-stepper") => {
    const row = added[key];
    const shownUnit = articleUnit(unit);
    const decimals = unitTakesDecimals(shownUnit);
    const adjustable = Boolean(row && onAdjust);
    const typed = (text: string) => {
      const answer = typedQuantity(text, shownUnit);
      if ("problem" in answer) { announce(answer.problem, true); return; }
      if (!row) { if (answer.value > 0) onFirst(quantityShown(answer.value)); return; }
      if (adjustable) void adjust(key, answer.value - row.quantity);
    };
    const remove = () => { if (row) void adjust(key, -row.quantity); };
    return <QuantityStepper size="field" value={row?.quantity ?? 0} min={!row ? 0 : adjustable ? (decimals ? 0.01 : 1) : row.quantity} label={`Tillagt antal ${name}`} unit={shownUnit} decimals={decimals}
      disabled={Boolean(adding)} testId={testId} format={quantityShown} reserveDelete
      parts={{ minus: `${testId}-minus`, plus: `${testId}-plus`, value: `${testId}-qty`, remove: `${testId}-remove`, unit: `${testId}-unit` }}
      onChange={(next) => { if (!row || !adjustable) onFirst(); else void adjust(key, next - row.quantity); }}
      onType={!row || adjustable ? typed : undefined}
      onRemove={adjustable ? remove : undefined} onDelete={adjustable ? remove : undefined} />;
  };
  /** The row for one supplier's offer of a hit, with the antal typed at the hit (or in the stepper). */
  const addOffer = (hit: CatalogueHit, offer: CatalogueOffer, quantityKey = hit.id, quantity?: string) => {
    const chosen = hitWithOffer(hit, offer.id);
    const row = applyArticle({ id: crypto.randomUUID(), name: chosen.name, quantity: quantity ?? quantityOf(quantityKey), unit: chosen.unit }, chosen);
    // A register article no price file has (2026-10-17): added without a price, from the wholesaler's catalogue.
    void run(offer.id, offer.catalogOnly && offer.catalog ? { row, supplierName: WHOLESALER_LABELS[offer.catalog.wholesaler], fromCatalogue: true } : { row, supplierName: chosen.supplierName, fromCatalogue: false });
  };
  return { run, adding, busy: Boolean(adding), quantityOf, quantityField, stepper, addOffer };
}
export type ArticleAddControls = ReturnType<typeof useArticleAdd>;

/**
 * Solar's part of a hit, fetched only once the article is chosen (2026-10-17: "synkning mot API sker först efter artikeln
 * är vald"): the search itself reads only the price files; opening a hit's product info, or adding it, asks Solar for the
 * product's master data and stock. Given by the ArticleBrowser; without it a card opens its own facts without asking anyone.
 */
export type ArticleSync = {
  open: (hitId: string) => boolean;
  choose: (hit: CatalogueHit) => void;
  added: (hit: CatalogueHit) => void;
  product: (hit: CatalogueHit) => ProductInfo | null | undefined;
  stockText: (hit: CatalogueHit) => string;
  loading: (hitId: string) => boolean;
  /** The thumbnail's picture when it is known (asked for with `wantThumb`, kept 24 hours on the server), otherwise an empty link. */
  thumb?: (hit: CatalogueHit) => Pick<ProductInfo, "imageUrl" | "imageSig">;
  /** The hit came into view: ask Solar for its picture, a few at a time. */
  wantThumb?: (hit: CatalogueHit) => void;
};
export const ArticleSyncContext = createContext<ArticleSync | null>(null);

/** A hit of Solar's catalogue (the register's article): the only hits whose picture is asked for in the list. */
export const isSolarHit = (hit: CatalogueHit) => [hit, ...(hit.offers ?? [])].some((offer) => offer.catalog?.wholesaler === "solar");

/**
 * The hit's thumbnail (2026-10-18: "inget sparas på servern, API:et hämtar bild vid behov"): a fixed 48 px space, so
 * nothing moves; the picture is asked for first when the hit comes into view, and nothing is shown when there is none.
 */
export function HitThumb({ hit }: { hit: CatalogueHit }) {
  const sync = useContext(ArticleSyncContext);
  const slot = useRef<HTMLSpanElement | null>(null);
  const picture = sync?.thumb?.(hit) ?? hit.product;
  const url = picture?.imageUrl ?? "";
  const solar = isSolarHit(hit);
  const want = sync?.wantThumb;
  useEffect(() => {
    const element = slot.current;
    if (!solar || url || !want || !element) return;
    if (typeof IntersectionObserver === "undefined") { want(hit); return; }
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { want(hit); observer.disconnect(); } }, { rootMargin: "120px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [solar, url, want, hit]);
  if (!solar && !url) return null;
  return <span ref={slot} className="size-12 shrink-0" data-testid="article-thumb-slot"><ProductThumb info={picture} size="xl" name={hit.name} zoom blank /></span>;
}

/** The columns of the article rows (2026-10-17: first the article number, the supplier, the description and the price). */
export function ArticleColumns() {
  return <div className="article-offer-row hidden gap-x-4 border-x border-transparent px-3 pb-1 text-xs font-medium text-muted-foreground sm:grid" aria-hidden="true" data-testid="article-columns">
    <span>Art.nr</span><span>Leverantör</span><span>Beskrivning</span><span className="text-right">Pris</span><span>Antal</span>
  </div>;
}

/**
 * A product of the company's register: one row per supplier's offer with the facts every price file has – article number,
 * supplier, description, price – the antal field and `− antal +` (2026-10-17, 2026-10-26). The same for every supplier, with or without
 * an API; "Produktinfo" (or a click on the description) chooses the article and shows the picture, the numbers, the status and,
 * for Solar, the stock. `actions` (star, Lägg i lista) sit in the product's own line under the rows.
 */
export function ArticleHitCard({ hit, controls, actions, quantityKey = hit.id, quantityFallback = "1", note, testId = "article-result" }: {
  hit: CatalogueHit; controls: ArticleAddControls; actions?: ReactNode; quantityKey?: string; quantityFallback?: string; note?: ReactNode; testId?: string;
}) {
  const sync = useContext(ArticleSyncContext);
  const [ownOpen, setOwnOpen] = useState(false);
  const detailsId = useId();
  const open = sync ? sync.open(hit.id) : ownOpen;
  const toggle = () => { if (sync) sync.choose(hit); else setOwnOpen((value) => !value); };
  const offers = hit.offers?.length ? hit.offers : [hit];
  return <li className="rounded-lg border bg-card" data-testid={testId} data-open={open || undefined}>
    <ul className="divide-y" aria-label={`Leverantörer för ${hit.name}`}>{offers.map((offer) => {
      // One antal per offer when the product has several, the hit's own when it has one.
      const key = offers.length > 1 ? `${quantityKey}:${offer.id}` : quantityKey;
      const pack = [offer.packageSize ? `förp. ${offer.packageSize}` : "", offer.orderMultiple ? `multipel ${offer.orderMultiple}` : "", offer.minOrderQuantity ? `minst ${offer.minOrderQuantity}` : "", offer.stocked ? "lagerförd" : ""].filter(Boolean).join(" · ");
      return <li key={offer.id} className="article-offer-row grid items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm" data-testid="article-offer">
        <span className="tabular-nums [overflow-wrap:anywhere]" data-testid="article-offer-no"><span className="text-xs text-muted-foreground sm:sr-only">Art.nr </span>{offer.supplierArticleNo || "–"}</span>
        <span className="min-w-0 truncate font-medium" data-testid="article-offer-supplier">{offer.supplierName}</span>
        <span className="flex min-w-0 gap-3">
        <HitThumb hit={hit} />
        <span className="min-w-0">
          <button type="button" className="text-left font-semibold [overflow-wrap:anywhere] hover:text-primary touch:inline-flex touch:min-h-11 touch:items-center" aria-expanded={open} aria-controls={detailsId} onClick={toggle}>{hit.name}</button>
          {pack ? <span className="block text-xs text-muted-foreground">{pack}</span> : null}
          {hitProductType(hit) ? <span className="block text-xs text-muted-foreground" data-testid="article-offer-type">{hitProductType(hit)}</span> : null}
          {/* The row's own warning: the price file's status, the wholesaler's status from the register (on its own row only), an uncertain link, a missing price file. */}
          {offerWarning(offer) ? <span className={cn("mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px]", indicatorBadge(offer.notInLatest && !offer.status && !offer.catalog?.statusText && !offer.catalogCheck ? "neutral" : "warning"))} data-testid="article-offer-warning">{offerWarning(offer)}</span> : null}
        </span>
        </span>
        <span className="tabular-nums sm:text-right">{offer.price ? <><span className="font-semibold">{formatSek(offer.price.unitPrice)} kr</span><span className="block text-[11px] text-muted-foreground">{offer.price.priceKind === "BASE" ? "grundpris" : offer.price.priceKind === "NET" ? "nettopris" : "per enhet"}</span></> : <span className="text-xs text-muted-foreground">{hit.priceHidden ? "Pris dolt" : "Inget pris"}</span>}</span>
        <span className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:justify-end">{controls.quantityField(key, hit.name, quantityFallback, true, offer.unit)}{controls.stepper(offer.id, hit.name, offer.unit, (quantity) => { controls.addOffer(hit, offer, key, quantity); sync?.added(hit); })}</span>
      </li>;
    })}</ul>
    <div className="flex flex-wrap items-center gap-2 border-t px-3 py-1">
      <Button type="button" variant="ghost" size="sm" className="-ml-2 text-muted-foreground touch:h-11" aria-expanded={open} aria-controls={detailsId} onClick={toggle} data-testid="article-details-toggle">
        <ChevronDown className={cn("transition-transform", !open && "-rotate-90")} />Produktinfo
      </Button>
      {note ? <span className="min-w-0 flex-1 text-xs text-muted-foreground max-sm:order-last max-sm:basis-full">{note}</span> : <span className="flex-1" />}
      {actions}
    </div>
    {open ? <HitDetails hit={hit} id={detailsId} /> : null}
  </li>;
}

/**
 * The opened Produktinfo of a hit (facts, Solar's stock): what `sync.choose` has asked for. Shown by the card and by a list line.
 * No picture or empty box here (2026-10-26): the thumbnail already stands on the row.
 */
export function HitDetails({ hit, id, className = "border-t px-3 py-3" }: { hit: CatalogueHit; id?: string; className?: string }) {
  const sync = useContext(ArticleSyncContext);
  const eNumber = hit.common?.kind === "E" ? hit.common.number : hit.eNumber;
  const product = (sync ? sync.product(hit) : null) ?? hit.product;
  const stockText = sync?.stockText(hit) ?? "";
  const info = productInfoOfOffer({ ...hit, eNumber: eNumber ?? "" }, product ?? null);
  const loading = Boolean(sync?.loading(hit.id));
  return <div id={id} className={cn("flex items-start gap-3", className)} data-testid="article-details">
    <div className="min-w-0 text-sm">
      <ProductFacts info={info} className="text-xs" />
      {/* Never an empty box: without the picture (2026-10-26) an article without facts says so. */}
      {!loading && !stockText && !productFacts(info).length ? <p className="text-xs text-muted-foreground" data-testid="article-details-empty">Ingen mer produktinfo.</p> : null}
      {/* A wholesaler's status stands on the wholesaler's own row above (2026-10-17), not on the product. */}
      {loading ? <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground" role="status"><LoaderCircle className="size-3.5 animate-spin" />Hämtar produktinfo…</p> : null}
      {stockText ? <p className="mt-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400" data-testid="article-stock">{stockText}</p> : null}
    </div>
  </div>;
}

/** A list line's Produktinfo: the toggle, and the facts under it while it is open. */
export function HitInfo({ hit }: { hit: CatalogueHit }) {
  const sync = useContext(ArticleSyncContext);
  if (!sync) return null;
  return <div className="basis-full" data-testid="article-line-info"><HitInfoToggle hit={hit} />{sync.open(hit.id) ? <HitDetails hit={hit} className="px-1 py-2" /> : null}</div>;
}

/** "Produktinfo" on a list line: opens the facts and asks Solar then (and only then) – the information is fetched where it is looked at. */
export function HitInfoToggle({ hit }: { hit: CatalogueHit }) {
  const sync = useContext(ArticleSyncContext);
  if (!sync) return null;
  const open = sync.open(hit.id);
  return <Button type="button" variant="ghost" size="sm" className="text-muted-foreground touch:h-11" aria-expanded={open} onClick={() => sync.choose(hit)} data-testid="article-line-info-toggle">
    <ChevronDown className={cn("transition-transform", !open && "-rotate-90")} />Produktinfo
  </Button>;
}

/**
 * An article without the register's offers: a product of Solar's catalogue, or a favourite / list line whose article is no
 * longer in the price files – its name, unit and facts, no price, the antal field and `− antal +`.
 */
export function ArticleBareCard({ name, info, unit, note, controls, addKey, onAdd, actions, quantityFallback = "1", stockText, thumbHit, testId = "article-external", stepperTestId = "article-external-stepper" }: {
  /** A Solar article without register offers: its picture is asked for when the card comes into view, like a hit's. */
  thumbHit?: CatalogueHit;
  name: string; info: ProductInfo | null | undefined; unit: string; note: ReactNode; controls: ArticleAddControls; addKey: string; onAdd: (quantity?: string) => void; actions?: ReactNode; quantityFallback?: string; stockText?: string; testId?: string; stepperTestId?: string;
}) {
  return <li className="rounded-xl border bg-card p-3.5" data-testid={testId}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-1 basis-56 items-start gap-3">
        {thumbHit ? <HitThumb hit={thumbHit} /> : <ProductThumb info={info ?? undefined} size="lg" name={name} zoom />}
        <div className="min-w-0">
          <p className="font-semibold [overflow-wrap:anywhere]">{name}</p>
          <ProductFacts info={info ?? undefined} source className="text-xs" />
          <ProductStatus info={info ?? undefined} />
          {stockText ? <p className="mt-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400" data-testid="article-external-stock">{stockText}</p> : null}
          <p className="mt-1 text-xs text-muted-foreground">{note}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">{controls.quantityField(addKey, name, quantityFallback, false, unit)}{controls.stepper(addKey, name, unit, onAdd, stepperTestId)}{actions}</div>
    </div>
  </li>;
}
