"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-shell";
import { api } from "@/features/kfid/api";
import { ArticleBrowser, type ArticleAdd } from "@/features/catalogue/article-browser";
import { purchaseLineFromRow, type PurchaseView } from "@/lib/purchases/model";
import { announce } from "@/lib/workflow/toast";

/**
 * Artiklar (2026-10-16, docs/proposals/inkop-och-artiklar-2026-10-16.md 2): the shared article search
 * (`ArticleBrowser`, the same one a quote, a purchase, a work order and an invoice basis open with "Lägg till artiklar"),
 * here putting what is added into a purchase – the open one, or a new one the first time – like a shopping cart.
 */
type Draft = { id: string; label: string; title: string; project: string };
type Basket = { id: string; label: string; count: number };

export function ArticlesPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [target, setTarget] = useState("new");
  const [basket, setBasket] = useState<Basket | null>(null);
  const [error, setError] = useState("");
  // The purchase being filled, read when the next article comes: Lägg till hela listan adds row after row before a render.
  const basketNow = useRef<Basket | null>(null);
  const targetNow = useRef(target);
  useEffect(() => { targetNow.current = target; }, [target]);

  useEffect(() => {
    let current = true;
    api<{ drafts: Draft[] }>("/api/purchases?part=drafts", { cache: "no-store" })
      .then((result) => { if (current) setDrafts(result.drafts); })
      .catch((cause: Error & { status?: number }) => { if (current && (cause.status === 403 || cause.status === 409)) setError(cause.message); });
    return () => { current = false; };
  }, []);

  const add = async ({ row, supplierName, fromCatalogue }: ArticleAdd) => {
    const id = basketNow.current?.id ?? (targetNow.current === "new" ? null : targetNow.current);
    try {
      const result = await api<{ id: string; label: string; lineIds: string[] }>("/api/purchases", { method: "POST", body: JSON.stringify({ action: "add_lines", id, lines: [{ ...purchaseLineFromRow(row), supplierName }] }) });
      const next = { id: result.id, label: result.label, count: (basketNow.current?.id === result.id ? basketNow.current.count : 0) + 1 };
      basketNow.current = next;
      setBasket(next);
      announce(`${row.name} är tillagd i inköp ${result.label}${fromCatalogue ? ", utan pris" : ""}.`);
      // The id of the new line, so the card can adjust or take away that very line (decision 13).
      return result.lineIds[0] ?? true;
    } catch (cause) { announce((cause as Error).message, true); return false; }
  };
  /** The justerare on a card: the line's antal, or the line taken away (the purchase is read and saved again, as its own page does). */
  const adjust = async (lineId: string, quantity: string | null) => {
    const purchaseId = basketNow.current?.id;
    if (!purchaseId) return false;
    try {
      const { purchase } = await api<{ purchase: PurchaseView }>(`/api/purchases?id=${encodeURIComponent(purchaseId)}`, { cache: "no-store" });
      // Without the right to see prices the lines come back without them; saving them here would erase the prices.
      if (purchase.pricesHidden) { announce("Öppna inköpet för att ändra antalet.", true); return false; }
      const lines = quantity === null ? purchase.lines.filter((line) => line.id !== lineId) : purchase.lines.map((line) => line.id === lineId ? { ...line, quantity } : line);
      await api("/api/purchases", { method: "POST", body: JSON.stringify({ action: "save", id: purchaseId, revision: purchase.revision, purchase: { title: purchase.title, notes: purchase.notes, projectId: purchase.project?.id ?? null, customerId: purchase.customer?.id ?? null, workOrderId: purchase.workOrder?.id ?? null, lines } }) });
      const next = { id: purchaseId, label: purchase.label, count: Math.max(0, (basketNow.current?.count ?? 1) - (quantity === null ? 1 : 0)) };
      basketNow.current = next;
      setBasket(next);
      return true;
    } catch (cause) { announce((cause as Error).message, true); return false; }
  };

  return <div className="space-y-5" data-testid="articles-page">
    <PageHeader title="Artiklar" description="Sök bland era artiklar och lägg dem i ett inköp. Priserna är era inköpspriser exklusive moms."
      actions={basket ? <Button asChild><Link href={`/?view=purchase&purchaseId=${encodeURIComponent(basket.id)}`} data-testid="articles-open-basket"><ShoppingCart />Öppna inköp {basket.label} ({basket.count})</Link></Button> : null} />
    {error ? <p role="alert" className="notice text-destructive">{error}</p> : null}
    <ArticleBrowser onAdd={add} onAdjust={adjust} toolbar={
      <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground sm:w-72">Lägg i inköp
        <select className="form-select min-w-0" value={basket?.id ?? target} onChange={(event) => { basketNow.current = null; setBasket(null); targetNow.current = event.target.value; setTarget(event.target.value); }} aria-label="Lägg i inköp" data-testid="articles-target">
          {basket && !drafts.some((draft) => draft.id === basket.id) ? <option value={basket.id}>{basket.label}</option> : null}
          <option value="new">Nytt inköp</option>
          {drafts.map((draft) => <option key={draft.id} value={draft.id}>{[draft.label, draft.title, draft.project].filter(Boolean).join(" · ")}</option>)}
        </select>
      </label>} />
  </div>;
}
