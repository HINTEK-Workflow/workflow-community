"use client";

import { useState } from "react";
import { Package } from "lucide-react";
import { Modal } from "@/features/kfid/ui";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { productFacts, productImageHref, PRODUCT_SOURCE_LABELS, type ProductInfo } from "@/lib/catalogue/product-info";
import { cn } from "@/lib/utils";

/**
 * Produktens uppgifter, samma överallt (2026-10-16): the one way an article's product is shown – in the article
 * search's suggestions, on Artiklar and under a row of a quote, a purchase or a work order. A thumbnail of the supplier's
 * picture (through our own server, never stored as a file and never from the browser to the supplier, 2026-11-02; a quiet box when there is none or it does not load), then the facts in one order and
 * the supplier's status. Any supplier: the source only names where the facts came from.
 */
export function ProductThumb({ info, size = "md", className, name = "", zoom = false, blank = false }: {
  info?: Pick<ProductInfo, "imageUrl" | "imageSig"> | null; size?: "sm" | "md" | "lg" | "xl"; className?: string;
  /** The article's name: the picture's alt text and the larger picture's title. */
  name?: string;
  /** A click opens the picture larger in a small dialog (2026-10-18). Not inside another button. */
  zoom?: boolean;
  /** Nothing but a quiet space of the same size when there is no picture (a hit in the list: no jump when it arrives or does not). */
  blank?: boolean;
}) {
  const [failed, setFailed] = useState("");
  const [large, setLarge] = useState(false);
  const url = info?.imageUrl ?? "";
  const box = size === "sm" ? "size-7" : size === "lg" ? "size-14" : size === "xl" ? "size-12" : "size-9";
  if (!url || failed === url) {
    if (blank) return <span aria-hidden="true" className={cn("shrink-0", box, className)} data-testid="product-thumb-blank" />;
    return <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center rounded-md bg-secondary text-primary", box, className)} data-testid="product-thumb-empty"><Package className={size === "lg" || size === "xl" ? "size-6" : "size-4"} /></span>;
  }
  // The supplier's own picture through /api/product-image, shown as it is.
  // eslint-disable-next-line @next/next/no-img-element
  const image = <img src={productImageHref({ imageUrl: url, imageSig: info?.imageSig }, 160)} alt={name} loading="lazy" decoding="async" onError={() => setFailed(url)}
    className={cn("shrink-0 rounded-md border bg-white object-contain p-0.5", box, !zoom && className)} data-testid="product-thumb" />;
  if (!zoom) return image;
  return <>
    <button type="button" className={cn("relative shrink-0 cursor-zoom-in rounded-md touch:after:absolute touch:after:-inset-2 touch:after:content-['']", className)} aria-label={name ? `Visa större bild: ${name}` : "Visa större bild"} onClick={() => setLarge(true)} data-testid="product-thumb-zoom">{image}</button>
    <Modal open={large} onOpenChange={setLarge} title={name || "Bild"} size="compact">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={productImageHref({ imageUrl: url, imageSig: info?.imageSig }, 1000)} alt={name} onError={() => { setLarge(false); setFailed(url); }} className="mx-auto max-h-[60dvh] w-full rounded-md bg-white object-contain" data-testid="product-image-large" />
    </Modal>
  </>;
}

/** The facts line: E-nummer · RSK · EAN · tillverkare · tillverkarens nummer, with the source first when asked. */
export function ProductFacts({ info, source = false, extra = [], className }: { info?: ProductInfo | null; source?: boolean; extra?: string[]; className?: string }) {
  const facts = [...(source && info ? [PRODUCT_SOURCE_LABELS[info.source]] : []), ...productFacts(info), ...extra.filter(Boolean)];
  if (!facts.length) return null;
  return <span className={cn("block truncate text-[11px] text-muted-foreground", className)} data-testid="product-facts">{facts.join(" · ")}</span>;
}

/** The supplier's status in words ("Utgången hos Solar"), as a small warning; nothing for a current product. */
export function ProductStatus({ info }: { info?: ProductInfo | null }) {
  if (!info?.statusText) return null;
  return <span className={cn("w-fit rounded-full border px-2 py-0.5 text-[11px]", indicatorBadge("warning"))} data-testid="product-status">{info.statusText}</span>;
}

/**
 * Under a row (quote, purchase, work order): the picked product's thumbnail, facts and status on one quiet line. Nothing
 * when the row has no product facts (a row written by hand).
 */
export function RowProduct({ info, className, images = true }: { info?: ProductInfo | null; className?: string; /** False = text only (a quote shows no pictures, 2026-10-18). */ images?: boolean }) {
  if (!info || !((images && info.imageUrl) || productFacts(info).length || info.statusText)) return null;
  return <div className={cn("flex min-w-0 items-center gap-2", className)} data-testid="row-product">
    {images ? <ProductThumb info={info} size="sm" zoom /> : null}
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"><ProductFacts info={info} source /><ProductStatus info={info} /></div>
  </div>;
}
