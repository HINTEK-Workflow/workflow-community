"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChoiceCard } from "@/components/ui/choice-card";
import { announce } from "@/lib/workflow/toast";
import { api } from "@/features/kfid/api";
import { DialogActions, Modal } from "@/features/kfid/ui";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { cn } from "@/lib/utils";
import { purchaseLineFromRow, type PurchaseSourceKind, type PurchaseStatus, type PurchaseView } from "@/lib/purchases/model";
import type { PurchaseRef } from "@/lib/purchases/ref";
import type { CatalogueSnapshot } from "@/lib/catalogue/snapshot";
import type { RowWholesale } from "@/lib/wholesale/model";

/**
 * Inköp på offerten och arbetsordern (2026-10-16, docs/proposals/inkop-och-artiklar-2026-10-16.md 4): the search
 * on the rows stays. The first time an article is picked on a new document, one question: put the articles in a purchase
 * (a new one, or an open draft) or just the row. The choice holds for the document: later picks go to the same purchase,
 * and after a save the purchase follows the rows' benämning, antal and enhet. No more questions after the first.
 */
export type PickedRow = {
  id: string; name: string; quantity: string; unit: string; unitPrice?: string; catalogue?: CatalogueSnapshot; articleNo?: string; articleSource?: string;
  manufacturerArticleNo?: string; wholesale?: RowWholesale; pickedArticleId?: string; purchaseRef?: PurchaseRef;
};
type Draft = { id: string; label: string; title: string; project: string };
type Choice = { kind: "new" } | { kind: "existing"; id: string } | { kind: "none" } | { kind: "cancel" };

/** "Bara raden" is remembered per document in this browser, so a reopened document does not ask again (2026-10-18). */
const declinedKey = (kind: PurchaseSourceKind, id: string) => `wf-quickpick-declined:${kind}:${id}`;
const readDeclined = (kind: PurchaseSourceKind, id: string | null) => { try { return Boolean(id) && window.localStorage.getItem(declinedKey(kind, id!)) === "1"; } catch { return false; } };
const writeDeclined = (kind: PurchaseSourceKind, id: string) => { try { window.localStorage.setItem(declinedKey(kind, id), "1"); } catch { /* the question may be asked again */ } };

const DOC_WORD: Record<PurchaseSourceKind, { the: string; a: string }> = { quote: { the: "offerten", a: "den här offerten" }, work_order: { the: "arbetsordern", a: "den här arbetsordern" } };

export function usePurchaseQuickPick({ disabled, kind, documentId, projectId, workOrderId, title }: {
  disabled: boolean; kind: PurchaseSourceKind; documentId: string | null; projectId: string | null; workOrderId?: string | null; title: string;
}) {
  const [asking, setAsking] = useState<{ drafts: Draft[]; resolve: (choice: Choice) => void } | null>(null);
  const [choice, setChoice] = useState<string>("new");
  const off = useRef(false);
  const declined = useRef(readDeclined(kind, documentId));
  /** Lines this page added per purchase, so a line let go of before the first save can be forgotten. */
  const added = useRef(new Map<string, Set<string>>());
  const docRef = useRef({ documentId, projectId, workOrderId, title });
  useEffect(() => { docRef.current = { documentId, projectId, workOrderId, title }; });

  const add = useCallback(async (purchaseId: string | null, row: PickedRow): Promise<PurchaseRef | null> => {
    const doc = docRef.current;
    try {
      const result = await api<{ id: string; label: string; revision: number; lineIds: string[] }>("/api/purchases", { method: "POST", body: JSON.stringify({
        action: "add_lines", id: purchaseId, lines: [purchaseLineFromRow(row)],
        create: { title: doc.title.trim() ? `Material – ${doc.title.trim()}`.slice(0, 200) : "", projectId: doc.projectId, workOrderId: kind === "work_order" ? doc.documentId ?? doc.workOrderId ?? null : doc.workOrderId ?? null },
        source: doc.documentId ? { kind, id: doc.documentId } : null,
      }) });
      const lineId = result.lineIds[0];
      if (!added.current.has(result.id)) added.current.set(result.id, new Set());
      added.current.get(result.id)!.add(lineId);
      return { purchaseId: result.id, label: result.label, revision: result.revision, lineId, origin: true };
    } catch (cause) {
      const status = (cause as { status?: number }).status;
      // No right to purchases, or a Local company: the row works as before and nobody is asked again.
      if (status === 403 || status === 409) { off.current = true; return null; }
      announce(`Artikeln kom inte med i inköpet: ${(cause as Error).message}`, true);
      return null;
    }
  }, [kind]);

  /** After a row got an article: to the document's purchase, or the one question on the document's first pick. */
  const onPicked = useCallback(async (row: PickedRow, rows: readonly PickedRow[], apply: (rowId: string, ref: PurchaseRef | undefined) => void, onCancel?: () => void): Promise<void> => {
    // The public demo answers /api/purchases in the browser (features/demo/demo-purchases.ts), so it is asked there too.
    if (disabled || off.current) return;
    const others = rows.filter((item) => item.id !== row.id);
    const own = others.find((item) => item.purchaseRef?.origin)?.purchaseRef ?? (row.purchaseRef?.origin ? row.purchaseRef : undefined);
    if (own) { const ref = await add(own.purchaseId, row); if (ref) apply(row.id, ref); return; }
    // Only the document's first picked article asks; an older document with picked rows, or "Bara raden", never does.
    if (declined.current || others.some((item) => item.catalogue || item.pickedArticleId || item.purchaseRef)) return;
    let drafts: Draft[] = [];
    try {
      const doc = docRef.current;
      const params = new URLSearchParams({ part: "drafts", ...(doc.projectId ? { projectId: doc.projectId } : {}), ...(doc.workOrderId ? { workOrderId: doc.workOrderId } : {}) });
      drafts = (await api<{ drafts: Draft[] }>(`/api/purchases?${params}`, { cache: "no-store" })).drafts;
    } catch {
      // Without purchases here (no right, a Local company, an installation without them) the row works as before, never asked again.
      off.current = true; return;
    }
    const picked = await new Promise<Choice>((resolve) => { setChoice("new"); setAsking({ drafts, resolve }); });
    setAsking(null);
    // Avbryt (or closing the question) stops the adding itself; the page takes the row back (ART-10).
    if (picked.kind === "cancel") { onCancel?.(); return; }
    if (picked.kind === "none") { declined.current = true; if (docRef.current.documentId) writeDeclined(kind, docRef.current.documentId); return; }
    const ref = await add(picked.kind === "existing" ? picked.id : null, row);
    if (ref) { apply(row.id, ref); announce(`Artikeln är tillagd i inköp ${ref.label}. Följande artiklar hamnar också där.`); }
    return;
  }, [add, disabled, kind]);

  /** After the document was saved: each purchase it picked into follows its rows (and forgets the rows let go of). */
  const syncAfterSave = useCallback(async (savedId: string, rows: readonly PickedRow[]) => {
    if (disabled || off.current) return;
    if (declined.current) writeDeclined(kind, savedId);
    const byPurchase = new Map<string, { lineId: string; name: string; quantity: string; unit: string }[]>();
    for (const row of rows) {
      const ref = row.purchaseRef;
      if (!ref?.origin || !ref.lineId) continue;
      byPurchase.set(ref.purchaseId, [...(byPurchase.get(ref.purchaseId) ?? []), { lineId: ref.lineId, name: row.name, quantity: row.quantity, unit: row.unit }]);
    }
    for (const id of added.current.keys()) if (!byPurchase.has(id)) byPurchase.set(id, []);
    for (const [id, lines] of byPurchase) {
      const listed = new Set(lines.map((line) => line.lineId));
      const forget = [...(added.current.get(id) ?? [])].filter((lineId) => !listed.has(lineId));
      try {
        await api("/api/purchases", { method: "POST", body: JSON.stringify({ action: "sync", id, source: { kind, id: savedId }, lines, forget }) });
        added.current.set(id, new Set([...(added.current.get(id) ?? [])].filter((lineId) => listed.has(lineId))));
      } catch { /* the purchase follows at the next save; the document itself is saved */ }
    }
  }, [disabled, kind]);

  const word = DOC_WORD[kind];
  const dialog = <Modal open={Boolean(asking)} onOpenChange={(open) => { if (!open && asking) asking.resolve({ kind: "cancel" }); }} title="Spara artiklarna i ett inköp?" size="compact">
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (!asking) return; asking.resolve(choice === "new" ? { kind: "new" } : choice === "none" ? { kind: "none" } : { kind: "existing", id: choice }); }} data-testid="purchase-quick-pick">
      <p className="text-sm text-muted-foreground">Artiklar du söker fram i {word.the} kan samlas i ett inköp, som sedan blir beställningen till grossisten. Frågan kommer en gång för {word.a}. Ett nytt inköp skapas direkt och finns kvar även om du inte sparar {word.the}.</p>
      <fieldset className="grid max-h-[50vh] gap-2 overflow-y-auto" aria-label="Inköp">
        <ChoiceCard name="purchase-choice" value="new" checked={choice === "new"} onChange={setChoice} title="Nytt inköp" description={`Ett nytt inköp för ${word.a}.`} />
        {asking?.drafts.map((draft) => <ChoiceCard key={draft.id} name="purchase-choice" value={draft.id} checked={choice === draft.id} onChange={setChoice}
          title={`${draft.label}${draft.title ? ` · ${draft.title}` : ""}`} description={draft.project ? `Utkast · ${draft.project}` : "Utkast"} />)}
        <ChoiceCard name="purchase-choice" value="none" checked={choice === "none"} onChange={setChoice} title="Bara raden" description="Inget inköp skapas. Det går snabbast när du själv beställer direkt hos grossisten." />
      </fieldset>
      <DialogActions cancel={{ onClick: () => asking?.resolve({ kind: "cancel" }) }} primary={{ label: "Fortsätt", type: "submit", testId: "purchase-quick-pick-confirm" }} />
    </form>
  </Modal>;
  return { onPicked, syncAfterSave, dialog };
}

/**
 * Inköpet har ändrats (Uppdatera offerten): the purchases a document's rows were taken from (not the ones it picked into
 * itself), and those that have changed since. `refresh` reads one purchase with the company's markup.
 */
export function usePurchaseChanges(refs: ReadonlyMap<string, number>, enabled: boolean) {
  const key = [...refs.entries()].map(([id, revision]) => `${id}:${revision}`).sort().join(",");
  const [answer, setAnswer] = useState<{ key: string; items: { id: string; label: string; title: string; status: PurchaseStatus }[] }>({ key: "", items: [] });
  useEffect(() => {
    if (!enabled || !key) return;
    let current = true;
    const wanted = new Map(key.split(",").map((part) => { const [id, revision] = part.split(":"); return [id, Number(revision)] as const; }));
    api<{ purchases: { id: string; label: string; title: string; revision: number; status: PurchaseStatus }[] }>(`/api/purchases?part=refs&ids=${encodeURIComponent([...wanted.keys()].join(","))}`, { cache: "no-store" })
      .then((result) => { if (current) setAnswer({ key, items: result.purchases.filter((item) => item.revision > (wanted.get(item.id) ?? item.revision)) }); })
      .catch(() => { if (current) setAnswer({ key, items: [] }); });
    return () => { current = false; };
  }, [key, enabled]);
  // Only the answer for the rows as they are now; a document whose rows were updated asks again.
  return enabled && answer.key === key ? answer.items : [];
}

export async function readPurchase(id: string) {
  return api<{ purchase: PurchaseView; markupPercent: string }>(`/api/purchases?id=${encodeURIComponent(id)}`, { cache: "no-store" });
}

/** "Inköp I-0007 har ändrats sedan raderna lades in" with Uppdatera, on a document that may still be changed. */
export function PurchaseChangedNotice({ changed, busy, onRefresh, docWord }: { changed: { id: string; label: string; title: string }[]; busy: boolean; onRefresh: (id: string) => void; docWord: string }) {
  if (!changed.length) return null;
  return <div className="space-y-2" data-testid="purchase-changed">
    {changed.map((item) => <div key={item.id} className={cn("flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm", indicatorBadge("info"))} role="status">
      <span className="flex min-w-0 items-center gap-2"><ShoppingCart className="size-4 shrink-0" aria-hidden="true" />
        <span>Inköp {item.label}{item.title ? ` (${item.title})` : ""} har ändrats sedan raderna lades in.</span></span>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onRefresh(item.id)} data-testid="purchase-refresh"><RefreshCw />Uppdatera {docWord}</Button>
    </div>)}
  </div>;
}
