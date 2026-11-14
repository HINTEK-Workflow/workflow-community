"use client";

import { leaveWithoutAsking } from "@/lib/workflow/leave-guard";
import { useLeavePage } from "@/components/history-nav";
import { useReturnTo } from "@/features/kfid/use-return-to";
import { withReturn } from "@/lib/workflow/return-link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, ClipboardList, FileText, FolderKanban, Lock, Package, PackageCheck, Plus, RotateCcw, Save, Search, ShoppingCart, Trash2, Truck, Sigma } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ChoiceCard } from "@/components/ui/choice-card";
import { Input } from "@/components/ui/input";
import { PageHeader, STANDARD_PAGE_WIDTH, usePageTrail } from "@/components/page-shell";
import { EditorAside, EditorAsideLayout } from "@/components/editor-aside";
import { useRegisterEditorActions } from "@/components/workspace-actions";
import { api } from "@/features/kfid/api";
import { DISCARD_QUESTION, useConfirm } from "@/features/kfid/confirm";
import { isDenied, NoAccess } from "@/features/quotes/no-access";
import { DialogActions, Modal, Panel } from "@/features/kfid/ui";
import type { CustomerItem, ProjectItem } from "@/features/kfid/types";
import { useUndoRemove } from "@/features/kfid/use-undo-remove";
import { ArticleNoField, clearPriceWithUndo, ClearablePrice, LINE_TABLE_BOX, LINE_TABLE_LABEL, LINE_TABLE_LABEL_TEXT, LINE_TABLE_NARROW_INPUT, LINE_TABLE_ROW, LINE_TABLE_SHELL, LineCells, LineTableHeader, PURCHASE_COLUMNS, PURCHASE_TABLE_GRID } from "@/features/quotes/line-table";
import { WholesaleExport } from "@/features/wholesale/wholesale-export";
import { RowProduct } from "@/features/catalogue/product-info";
import { PriceMark } from "@/features/workflow/catalogue-picker";
import { ArticleBrowserDialog, type ArticleAdd } from "@/features/catalogue/article-browser";
import { EditorHeader, type EditorFact } from "@/features/workflow/editor-header";
import { customerFromProject, DealBasicsFields, SharedBasicsPanel } from "@/features/workflow/shared-basics";
import { adoptCreated, editorKey, FirstChangeSave } from "@/lib/workflow/use-first-change-save";
import { indicatorBadge, type IndicatorTone } from "@/features/workflow/indicator-tone";
import {
  lineSupplier, purchaseEditable, purchaseLineAmount, purchaseName, PURCHASE_STATUS_LABELS, purchaseTotals, type PurchaseAction, type PurchaseLineView, type PurchaseStatus, type PurchaseView,
} from "@/lib/purchases/model";
import { quantityProblem } from "@/lib/quotes/model";
import { fromMaterialRows } from "@/lib/wholesale/sources";
import { formatSek, MATERIAL_UNIT_SUGGESTIONS, parseAmount, type MaterialRow } from "@/lib/workflow/expenses";
import { useUnsavedGuard } from "@/lib/workflow/use-unsaved-guard";
import { announce } from "@/lib/workflow/toast";
import { formatSwedish } from "@/lib/swedish-time";
import { cn } from "@/lib/utils";
import { RemoveButton } from "@/components/ui/remove-button";

/**
 * Inköp (2026-10-16, docs/proposals/inkop-och-artiklar-2026-10-16.md): one purchase as a page – the underlag while
 * it is a draft (search articles from every supplier into it, like a shopping cart) and the order once it is marked
 * ordered, with each line ticked off when it has come. Only purchase prices: the selling price is set on the quote.
 * The buttons: Till grossist (the existing order file), Lägg i offert (as lines or as one sum), Lägg som material (on a
 * work order) and the status. Built from the shared editor header, panels and line table; the server decides.
 */
export const purchaseStatusTone = (status: PurchaseStatus): IndicatorTone => status === "DELIVERED" ? "success" : status === "ORDERED" ? "info" : status === "CANCELLED" ? "neutral" : "warning";

type Line = PurchaseLineView & { pickedArticleId?: string };
type Draft = { title: string; notes: string; projectId: string | null; customerId: string | null; workOrderId: string | null; lines: Line[] };
const emptyLine = (): Line => ({ id: crypto.randomUUID(), name: "", quantity: "1", unit: "st", unitPrice: "", supplierName: "", deliveredAt: null, sourceKind: null, sourceId: null });
const draftOf = (purchase: PurchaseView | null, projectId: string | null): Draft => purchase
  ? { title: purchase.title, notes: purchase.notes, projectId: purchase.project?.id ?? null, customerId: purchase.customer?.id ?? null, workOrderId: purchase.workOrder?.id ?? null, lines: purchase.lines }
  : { title: "", notes: "", projectId, customerId: null, workOrderId: null, lines: [] };
/** What the server gets: rows without a name are left out (a row just added and never filled in). */
const payloadOf = (draft: Draft, saved: boolean) => ({ ...draft, lines: draft.lines.filter((line) => line.name.trim()).map((line) => ({ ...line, id: saved ? line.id : undefined })) });
/** The first named row whose antal would be refused (decision 1), with the text that points out the row. */
const quantityIssueOf = (draft: Draft) => {
  const line = draft.lines.find((item) => item.name.trim() && quantityProblem(item.quantity));
  return line ? { id: line.id, text: `${quantityProblem(line.quantity)} Se raden ”${line.name.trim()}”.` } : null;
};
const ACTION_DONE: Record<Exclude<PurchaseAction, "delete">, string> = { order: "", reopen: "Inköpet är ett utkast igen.", cancel: "Inköpet är makulerat." };

export function PurchaseEditorFromAddress(props: { projects: ProjectItem[]; customers: CustomerItem[] }) {
  const params = useSearchParams();
  const purchaseId = params.get("purchaseId") ?? undefined;
  // A purchase made here by its first change keeps its editor (lib/workflow/use-first-change-save.ts).
  return <PurchaseEditor key={editorKey(purchaseId)} purchaseId={purchaseId} projectId={params.get("projectId")} {...props} />;
}

export function PurchaseEditor({ purchaseId, projectId, projects, customers }: { purchaseId?: string; projectId: string | null; projects: ProjectItem[]; customers: CustomerItem[] }) {
  const router = useRouter();
  const [confirm, confirmCard] = useConfirm();
  const [purchase, setPurchase] = useState<PurchaseView | null>(null);
  // The trail names the saved purchase, as an offert's does (Lika är rätt, 2026-11-13).
  usePageTrail({ purchase: purchase ? purchaseName({ title: purchase.title, label: purchase.label }) : undefined });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [toQuote, setToQuote] = useState(false);
  const [toWorkOrder, setToWorkOrder] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const focusLine = useRef<string | null>(null);
  const unitListId = "purchase-unit-suggestions";
  // Ny … som utkast (2026-11-14): the purchase this editor just created, and what was sent; the draft typed meanwhile stays.
  const adopting = useRef<{ id: string; sent: string } | null>(null);
  const draftNow = useRef<Draft | null>(null);
  useEffect(() => { draftNow.current = draft; });

  const load = useCallback(async () => {
    try {
      if (!purchaseId) {
        // A new purchase asks the list once whether the person may make purchases at all (403 = the box, not an editor that refuses at Spara).
        const check = await api<{ canEdit: boolean }>("/api/purchases?filter=draft&page=1&mine=1", { cache: "no-store" });
        if (!check.canEdit) throw Object.assign(new Error("Du saknar behörighet att ändra inköp."), { status: 403 });
      }
      const loaded = purchaseId ? (await api<{ purchase: PurchaseView }>(`/api/purchases?id=${encodeURIComponent(purchaseId)}`, { cache: "no-store" })).purchase : null;
      setPurchase(loaded);
      const kept = adopting.current && adopting.current.id === purchaseId && draftNow.current ? adopting.current : null;
      adopting.current = null;
      if (kept && draftNow.current) setDirty(JSON.stringify(draftNow.current) !== kept.sent);
      else { setDraft(draftOf(loaded, projectId)); setDirty(false); }
      setError("");
    } catch (cause) { if (isDenied(cause)) setDenied(true); setError((cause as Error).message); }
  }, [purchaseId, projectId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the purchase is read when the page opens
  useEffect(() => { void load(); }, [load]);
  const releaseBack = useUnsavedGuard(dirty, confirm, undefined, { browserBack: !purchaseId });
  // Avbryt on a new purchase (samband, 2026-10-26): one step back, asking first when something is filled in.
  const leavePage = useLeavePage();
  const way = useReturnTo();
  const cancelNew = async () => {
    if (dirty && !(await confirm(DISCARD_QUESTION))) return;
    await releaseBack();
    leaveWithoutAsking();
    if (way) way.cancel(); else leavePage("/?view=purchases");
  };
  const undoRemove = useUndoRemove<Line>((update) => { setDraft((current) => current && { ...current, lines: update(current.lines) }); setDirty(true); });
  useEffect(() => {
    if (!focusLine.current) return;
    const field = document.querySelector<HTMLInputElement>(`[data-line="${focusLine.current}"] input[name="purchase-line-name"]`);
    focusLine.current = null;
    field?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    field?.focus();
  });
  const status: PurchaseStatus = purchase?.status ?? "DRAFT";
  const editable = purchaseEditable(status) && (purchase?.canEdit ?? true);
  // The bottom bar's and the floating navigation's Spara and Avbryt press the page's own buttons (2026-10-27).
  useRegisterEditorActions({ save: () => document.querySelector<HTMLButtonElement>("[data-testid=purchase-save]")?.click(), canSave: Boolean(draft) && editable && (purchase ? dirty : true), busy, dirty,
    cancel: draft && !purchaseId ? () => void cancelNew() : undefined });
  if (denied) return <div className="space-y-4"><PageHeader className="mb-0" title="Inköp" /><NoAccess /></div>;
  if (error && !draft) return <div className="space-y-4"><PageHeader className="mb-0" title="Inköp" /><p role="alert" className="notice text-destructive">{error}</p></div>;
  if (!draft) return <p role="status" className="text-sm text-muted-foreground">Hämtar inköpet…</p>;

  const pricesHidden = Boolean(purchase?.pricesHidden);
  const totals = purchaseTotals(draft.lines);
  const can = (action: PurchaseAction) => Boolean(purchase?.actions.includes(action));
  const change = (patch: Partial<Draft>) => { setDraft({ ...draft, ...patch }); setDirty(true); };
  // Functional, so an Ångra or a justerare that comes later never writes back an older copy of the draft.
  const patchLine = (id: string, patch: Partial<Line>) => { setDraft((current) => current && { ...current, lines: current.lines.map((line) => line.id === id ? { ...line, ...patch } : line) }); setDirty(true); };
  const addLine = () => { const line = emptyLine(); focusLine.current = line.id; change({ lines: [...draft.lines, line] }); };
  /** Lägg till artiklar (2026-10-16): each article added in the shared search becomes a new line, made the one way rows are made. */
  const addArticle = ({ row, supplierName }: ArticleAdd) => {
    const id = crypto.randomUUID();
    setDraft((current) => current && { ...current, lines: [...current.lines, {
      id, name: row.name, quantity: row.quantity || "1", unit: row.unit, unitPrice: row.unitPrice ?? "", supplierName, deliveredAt: null, sourceKind: null, sourceId: null,
      ...(row.catalogue ? { catalogue: row.catalogue } : {}), articleNo: row.articleNo ?? "", articleSource: row.articleSource ?? "", manufacturerArticleNo: row.manufacturerArticleNo ?? "",
      ...(row.wholesale ? { wholesale: row.wholesale } : {}), ...(row.product ? { product: row.product } : {}), ...(row.pickedArticleId ? { pickedArticleId: row.pickedArticleId } : {}),
    }] });
    setDirty(true);
    return id;
  };
  /** The justerare on a search card (decision 13): the added row's antal, or the row taken away at 0. */
  const adjustArticle = (rowId: string, quantity: string | null) => {
    if (quantity === null) setDraft((current) => current && { ...current, lines: current.lines.filter((item) => item.id !== rowId) });
    else patchLine(rowId, { quantity });
    setDirty(true);
  };

  /** Saves the draft; returns the purchase's id, or null. */
  const save = async (): Promise<string | null> => {
    const issue = quantityIssueOf(draft);
    if (issue) {
      announce(issue.text, true);
      window.setTimeout(() => { const field = document.querySelector<HTMLInputElement>(`[data-line="${issue.id}"] input[aria-label="Antal"]`); field?.scrollIntoView({ block: "center", behavior: "smooth" }); field?.focus(); }, 0);
      return null;
    }
    setBusy(true);
    try {
      if (!purchase) {
        await releaseBack();
        const created = await api<{ id: string }>("/api/purchases", { method: "POST", body: JSON.stringify({ action: "create", purchase: payloadOf(draft, false) }) });
        setDirty(false);
        announce("Inköpet är sparat.");
        adoptCreated(created.id);
        adopting.current = { id: created.id, sent: JSON.stringify(draft) };
        router.replace(`/?view=purchase&purchaseId=${encodeURIComponent(created.id)}`);
        return created.id;
      }
      if (dirty) {
        await api("/api/purchases", { method: "POST", body: JSON.stringify({ action: "save", id: purchase.id, revision: purchase.revision, purchase: payloadOf(draft, true) }) });
        // Saved: leaving now asks nothing, also while the purchase is read back (the browser's own leave question came
        // up there, purchases.browser.cjs 2026-10-23).
        setDirty(false);
        announce("Inköpet är sparat.");
        await load();
      }
      return purchase.id;
    } catch (cause) { announce((cause as Error).message, true); return null; } finally { setBusy(false); }
  };
  const changeStatus = async (to: Exclude<PurchaseAction, "delete">) => {
    if (!purchase) return;
    if (to === "order" && !await confirm({ title: "Markera inköpet som beställt?", message: "Raderna låses. Skicka beställningen till grossisten med Till grossist om du inte redan gjort det. Bocka sedan av raderna när de kommer.", confirmLabel: "Markera som beställt" })) return;
    if (to === "cancel" && !await confirm({ title: "Makulera inköpet?", message: "Inköpet finns kvar att läsa men används inte längre.", confirmLabel: "Makulera", tone: "danger" })) return;
    if (dirty && !await save()) return;
    setBusy(true);
    try { await api("/api/purchases", { method: "POST", body: JSON.stringify({ action: "status", id: purchase.id, to }) }); if (ACTION_DONE[to]) announce(ACTION_DONE[to]); await load(); }
    catch (cause) { announce((cause as Error).message, true); } finally { setBusy(false); }
  };
  const deliver = async (line: Line, delivered: boolean) => {
    if (!purchase) return;
    setBusy(true);
    try {
      const result = await api<{ status: PurchaseStatus; delivered: number; lines: number }>("/api/purchases", { method: "POST", body: JSON.stringify({ action: "deliver", id: purchase.id, lineId: line.id, delivered }) });
      announce(result.status === "DELIVERED" ? "Alla rader har kommit." : `${result.delivered} av ${result.lines} rader har kommit.`);
      await load();
    } catch (cause) { announce((cause as Error).message, true); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!purchase || !await confirm({ title: "Ta bort utkastet?", message: `${purchase.label} tas bort. Det går inte att ångra.`, confirmLabel: "Ta bort", tone: "danger" })) return;
    setBusy(true);
    try { await api("/api/purchases", { method: "POST", body: JSON.stringify({ action: "delete", id: purchase.id }) }); setDirty(false); announce("Utkastet är borttaget."); router.push("/?view=purchases"); }
    catch (cause) { announce((cause as Error).message, true); } finally { setBusy(false); }
  };
  /** Lägg i offert / Lägg som material: saved first, then the document opens with the purchase's lines added (saved there as usual). */
  const openWith = async (href: (id: string) => string) => {
    const id = !purchase || dirty ? await save() : purchase.id;
    // The quote or work order leads back to the purchase (samband, 2026-10-26).
    if (id) router.push(withReturn(href(id), `/?view=purchase&purchaseId=${encodeURIComponent(id)}`));
  };

  // Grossistexport: the purchase's lines as material rows, the same window as on a quote and a work order.
  const wholesaleRows: MaterialRow[] = draft.lines.map((line) => ({ id: line.id, name: line.name, quantity: line.quantity, unit: line.unit, ...(line.catalogue ? { catalogue: line.catalogue } : {}),
    ...(line.articleNo ? { articleNo: line.articleNo, articleSource: line.articleSource } : {}), ...(line.manufacturerArticleNo ? { manufacturerArticleNo: line.manufacturerArticleNo } : {}), ...(line.wholesale ? { wholesale: line.wholesale } : {}) }));
  const facts: EditorFact[] = [
    ...(purchase ? [{ icon: ShoppingCart, label: purchase.label }] : []),
    ...(draft.projectId ? [{ icon: FolderKanban, label: projects.find((project) => project.id === draft.projectId)?.name ?? purchase?.project?.name ?? "Projekt" }] : []),
    ...(purchase?.workOrder ? [{ icon: ClipboardList, label: purchase.workOrder.title }] : []),
    { icon: Package, label: pricesHidden ? `${totals.lines} ${totals.lines === 1 ? "rad" : "rader"}` : `${formatSek(totals.amount)} kr inköp exkl. moms`, keep: true },
    ...(status === "ORDERED" || status === "DELIVERED" ? [{ icon: Truck, label: `${totals.delivered} av ${totals.lines} har kommit` }] : []),
    ...(purchase && !editable ? [{ icon: Lock, label: "Låst", iconClassName: "text-muted-foreground" }] : []),
  ];
  const hasLines = draft.lines.some((line) => line.name.trim());

  return <div className={cn("space-y-5", STANDARD_PAGE_WIDTH)} data-testid="purchase-editor" data-status={status} data-standard-page="">
    {confirmCard}
    {/* Nytt inköp opens as a draft and is saved by itself at the first change. */}
    <FirstChangeSave isNew={!purchase && !purchaseId} dirty={dirty} ready={editable} busy={busy} change={draft} save={save} />
    <EditorHeader
      title={purchase ? purchaseName({ title: draft.title, label: purchase.label }) : draft.title.trim() || "Nytt inköp"}
      detail={<span className={cn("inline-flex rounded-full border px-2.5 py-0.5 font-medium", indicatorBadge(purchaseStatusTone(status)))} data-testid="purchase-status">{PURCHASE_STATUS_LABELS[status]}</span>}
      facts={facts}
      // Högst fyra knappar (2026-11-14): Ta bort utkastet, Lägg som material and Makulera move under Mer first.
      actions={[
        { key: "wholesale", node: <WholesaleExport source={fromMaterialRows(wholesaleRows)} label={purchase ? `Inköp ${purchase.label}` : "Inköp"} testId="purchase-wholesale"
          onSaveRow={editable ? (id, wholesale) => patchLine(id, { wholesale }) : undefined} /> },
        { key: "to-quote", keep: true, node: <Button type="button" variant="outline" disabled={busy || !hasLines} onClick={() => setToQuote(true)} data-testid="purchase-to-quote"><FileText />Lägg i offert</Button>,
          menu: { label: "Lägg i offert", icon: FileText, disabled: busy || !hasLines, onSelect: () => setToQuote(true), testId: "purchase-to-quote" } },
        { key: "to-work-order", node: <Button type="button" variant="outline" disabled={busy || !hasLines} onClick={() => setToWorkOrder(true)} data-testid="purchase-to-work-order"><ClipboardList />Lägg som material</Button>,
          menu: { label: "Lägg som material", icon: ClipboardList, disabled: busy || !hasLines, onSelect: () => setToWorkOrder(true), testId: "purchase-to-work-order" } },
        can("order") ? { key: "order", keep: true, node: <Button type="button" variant="outline" disabled={busy} onClick={() => void changeStatus("order")} data-testid="purchase-order"><PackageCheck />Markera som beställt</Button>,
          menu: { label: "Markera som beställt", icon: PackageCheck, disabled: busy, onSelect: () => void changeStatus("order"), testId: "purchase-order" } } : null,
        can("reopen") ? { key: "reopen", keep: true, node: <Button type="button" variant="outline" disabled={busy} onClick={() => void changeStatus("reopen")} data-testid="purchase-reopen"><RotateCcw />Öppna igen</Button>,
          menu: { label: "Öppna igen", icon: RotateCcw, disabled: busy, onSelect: () => void changeStatus("reopen"), testId: "purchase-reopen" } } : null,
        can("cancel") ? { key: "cancel", node: <Button type="button" variant="outline" disabled={busy} onClick={() => void changeStatus("cancel")} data-testid="purchase-cancel"><Ban />Makulera</Button>,
          menu: { label: "Makulera", icon: Ban, disabled: busy, onSelect: () => void changeStatus("cancel"), testId: "purchase-cancel" } } : null,
      ]}
      // The red button looks like the work order's Ta bort (one style for the red button, Lika är rätt).
      destructiveAction={can("delete") ? { key: "delete", node: <Button type="button" variant="outline" className="text-destructive" disabled={busy} onClick={() => void remove()} data-testid="purchase-delete"><Trash2 />Ta bort utkastet</Button>,
        menu: { label: "Ta bort utkastet", icon: Trash2, disabled: busy, onSelect: () => void remove(), testId: "purchase-delete" } } : undefined}
      moreTestId="purchase-more"
      cancelAction={purchaseId ? undefined : <Button type="button" variant="outline" disabled={busy} onClick={() => void cancelNew()} data-testid="purchase-new-cancel">Avbryt</Button>}
      primaryAction={editable ? <Button type="button" className="min-w-28" disabled={busy || (!dirty && Boolean(purchase))} onClick={() => void save()} data-testid="purchase-save"><Save />Spara</Button> : undefined}
    />
    {purchase && !editable ? <p className="notice flex items-start gap-2" role="status" data-testid="purchase-locked"><Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {status === "ORDERED" ? `Beställt ${purchase.orderedAt ? formatSwedish(purchase.orderedAt, { dateStyle: "medium" }) : ""}. Raderna är låsta; bocka av dem när de kommer. Öppna igen för att ändra.` : status === "DELIVERED" ? "Alla rader har kommit." : "Inköpet är makulerat."}
    </p> : null}

    {/* Högerställd sammanfattning (2026-10-16): Summa per leverantör beside the panels on a wide screen at level 3. */}
    <EditorAsideLayout testId="purchase-layout" fit="table">
    {/* Grunduppgifter, variant Affär (Lika är rätt, 2026-11-14): Rubrik, Projekt, Arbetsorder, Kund (the shared field, no place) and Anteckning. */}
    <SharedBasicsPanel description="Rubriken syns bara för er. Projektet föreslås när en offert eller arbetsorder söker artiklar." testId="purchase-basics-panel">
      <DealBasicsFields idPrefix="purchase" disabled={!editable}
        title={{ value: draft.title, placeholder: "Till exempel Centralbyte Storgatan", testId: "purchase-title", onChange: (title) => change({ title }) }}
        project={{ value: draft.projectId, options: projects, current: purchase?.project ?? null, testId: "purchase-project",
          // A chosen project fills an empty customer (the chain, Lika är rätt).
          onChange: (id, project) => change({ projectId: id, customerId: customerFromProject({ customerId: draft.customerId, facilityId: null }, project).customerId }) }}
        workOrder={purchase?.workOrder ?? null}
        customer={{ customers, customerId: draft.customerId, facilityId: null, noPlace: true, search: true, testId: "purchase-customer", onChange: (next) => change({ customerId: next.customerId }) }}
        description={{ label: "Anteckning (bara för er)", ariaLabel: "Anteckning", value: draft.notes, onChange: (notes) => change({ notes }) }} />
    </SharedBasicsPanel>

    <Panel icon={Package} title="Artiklar" description="Sök på benämning, artikelnummer, E-nummer, RSK eller EAN. Priset är inköpspris exkl. moms; försäljningspriset sätts i offerten.">
      {editable ? <div className="flex flex-wrap gap-2" data-testid="purchase-line-actions">
        <Button type="button" onClick={() => setBrowsing(true)} data-testid="purchase-add-articles"><Search />Lägg till artiklar</Button>
        <Button type="button" variant="outline" onClick={addLine} data-testid="purchase-add-line"><Plus />Lägg till rad</Button>
      </div> : null}
      <datalist id={unitListId}>{MATERIAL_UNIT_SUGGESTIONS.map((unit) => <option key={unit} value={unit} />)}</datalist>
      {draft.lines.length ? <div className={cn(LINE_TABLE_BOX, editable && "mt-4")}><div role="table" aria-label="Artiklar" className={LINE_TABLE_SHELL} data-testid="purchase-lines">
        <LineTableHeader grid={PURCHASE_TABLE_GRID} columns={PURCHASE_COLUMNS} lastVisible={!editable} />
        {draft.lines.map((line) => <PurchaseLineRow key={line.id} line={line} editable={editable} deliverable={status === "ORDERED" || status === "DELIVERED"} busy={busy} unitListId={unitListId} pricesHidden={pricesHidden}
          onPatch={(patch) => patchLine(line.id, patch)} onRemove={() => undoRemove(draft.lines, line.id)} onDeliver={(value) => void deliver(line, value)} onEnterLast={addLine} />)}
      </div></div> : <p className="mt-3 text-sm text-muted-foreground" data-testid="purchase-empty">Inga artiklar än. {editable ? "Lägg till en artikel och sök fram den, eller bläddra bland artiklarna." : ""}</p>}
    </Panel>

    {totals.lines && !pricesHidden ? <EditorAside label="Inköpets summa" testId="purchase-aside"><Panel icon={Sigma} title="Summa per leverantör" description="Inköpspris exklusive moms. Kunden ser aldrig leverantör, inköpspris eller rabatt.">
      <dl className="grid max-w-xl gap-y-1.5 text-sm" data-testid="purchase-totals">
        {totals.bySupplier.map((entry) => <div key={entry.supplierName} className="flex justify-between gap-3"><dt className="text-muted-foreground">{entry.supplierName} <span className="text-xs">({entry.lines} {entry.lines === 1 ? "rad" : "rader"})</span></dt><dd className="tabular-nums">{formatSek(entry.amount)} kr</dd></div>)}
        <div className="flex justify-between gap-3 border-t pt-1.5 font-semibold"><dt>Totalt inköp</dt><dd className="tabular-nums" data-testid="purchase-total">{formatSek(totals.amount)} kr</dd></div>
      </dl>
      {totals.unpriced ? <p className="mt-2 text-xs text-muted-foreground">{totals.unpriced} {totals.unpriced === 1 ? "rad saknar" : "rader saknar"} inköpspris och ingår inte i summan.</p> : null}
    </Panel></EditorAside> : null}
    </EditorAsideLayout>

    <ArticleBrowserDialog open={browsing} onOpenChange={setBrowsing} onAdd={addArticle} onAdjust={adjustArticle} docWord="inköpet" docName={purchase ? `Inköp ${purchase.label}${draft.title.trim() ? ` (${draft.title.trim()})` : ""}` : `${draft.title.trim() || "Nytt inköp"} – sparas när du trycker Spara`} />
    <ToQuoteDialog open={toQuote} onOpenChange={setToQuote} busy={busy} projectId={draft.projectId}
      onConfirm={(quoteId, sum) => { setToQuote(false); void openWith((id) => `/?view=quote${quoteId ? `&quoteId=${encodeURIComponent(quoteId)}` : ""}&purchaseId=${encodeURIComponent(id)}${sum ? "&purchaseMode=sum" : ""}`); }} />
    <ToWorkOrderDialog open={toWorkOrder} onOpenChange={setToWorkOrder} busy={busy} linked={purchase?.workOrder ?? null} projectId={draft.projectId}
      onConfirm={(taskId) => { setToWorkOrder(false); void openWith((id) => `/?view=workflow_task&taskType=WORK_ORDER&taskId=${encodeURIComponent(taskId)}&purchaseId=${encodeURIComponent(id)}`); }} />
  </div>;
}

function PurchaseLineRow({ line, editable, deliverable, busy, unitListId, pricesHidden, onPatch, onRemove, onDeliver, onEnterLast }: {
  line: Line; editable: boolean; deliverable: boolean; busy: boolean; unitListId: string; pricesHidden: boolean;
  onPatch: (patch: Partial<Line>) => void; onRemove: () => void; onDeliver: (delivered: boolean) => void; onEnterLast: () => void;
}) {
  const amount = purchaseLineAmount(line);
  const badQuantity = Boolean(line.quantity.trim()) && quantityProblem(line.quantity) !== null;
  const badPrice = Boolean(line.unitPrice.trim()) && parseAmount(line.unitPrice) === null;
  return <div data-line={line.id} data-testid="purchase-line" role="row" data-delivered={line.deliveredAt ? "" : undefined} className={cn(PURCHASE_TABLE_GRID, LINE_TABLE_ROW, "grid grid-cols-2 items-end gap-x-3 gap-y-3 rounded-lg border p-3 sm:grid-cols-4")}><LineCells>
    <ArticleNoField value={line.articleNo ?? ""} source={line.articleSource} manufacturer={line.manufacturerArticleNo ?? line.catalogue?.manufacturerArticleNo} disabled={!editable} onChange={(articleNo) => onPatch({ articleNo, articleSource: "" })} testId="purchase-line-article-no" />
    {editable ? <div className={cn(LINE_TABLE_LABEL, "col-span-2 sm:col-span-3 @[50rem]:col-span-1")}><span className={LINE_TABLE_LABEL_TEXT}>Benämning</span>
      <Input name="purchase-line-name" aria-label="Benämning" title={line.name} value={line.name} maxLength={300} placeholder="Benämning" onChange={(event) => onPatch({ name: event.target.value })} /></div>
      : <p className={cn(LINE_TABLE_LABEL, "col-span-2 sm:col-span-3 @[50rem]:col-span-1")}><span className={LINE_TABLE_LABEL_TEXT}>Benämning</span><span className="flex min-h-10 items-center text-sm font-normal text-foreground">{line.name}</span></p>}
    {line.catalogue || !editable ? <p className={LINE_TABLE_LABEL}><span className={LINE_TABLE_LABEL_TEXT}>Leverantör</span><span className="flex min-h-10 items-center truncate text-sm font-normal text-foreground" title={lineSupplier(line)}>{lineSupplier(line)}</span></p>
      : <label className={LINE_TABLE_LABEL}><span className={LINE_TABLE_LABEL_TEXT}>Leverantör</span><Input aria-label="Leverantör" value={line.supplierName} maxLength={200} placeholder="Leverantör" onChange={(event) => onPatch({ supplierName: event.target.value })} /></label>}
    <label className={LINE_TABLE_LABEL}><span className={LINE_TABLE_LABEL_TEXT}>Antal</span><Input aria-label="Antal" inputMode="decimal" className={LINE_TABLE_NARROW_INPUT} value={line.quantity} title={badQuantity ? quantityProblem(line.quantity) ?? undefined : undefined} aria-invalid={badQuantity || undefined} disabled={!editable} onChange={(event) => onPatch({ quantity: event.target.value })} /></label>
    <label className={LINE_TABLE_LABEL}><span className={LINE_TABLE_LABEL_TEXT}>Enhet</span><Input aria-label="Enhet" list={unitListId} autoComplete="off" className={LINE_TABLE_NARROW_INPUT} value={line.unit} maxLength={40} disabled={!editable} onChange={(event) => onPatch({ unit: event.target.value })} /></label>
    <label className={LINE_TABLE_LABEL}><span className={LINE_TABLE_LABEL_TEXT}>Inköpspris (kr)</span><span className="relative block">
      <Input aria-label="Inköpspris (kr)" inputMode="decimal" className={LINE_TABLE_NARROW_INPUT} value={pricesHidden ? "" : line.unitPrice} placeholder={pricesHidden ? "Dolt" : undefined} aria-invalid={badPrice || undefined} disabled={!editable || pricesHidden}
        onChange={(event) => onPatch({ unitPrice: event.target.value })} onKeyDown={editable ? (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onEnterLast(); } } : undefined} />
      {pricesHidden ? null : <PriceMark snapshot={line.catalogue} unitPrice={line.unitPrice} />}</span></label>
    <div className={cn(LINE_TABLE_LABEL, "sm:text-right @[50rem]:col-span-1")}><span className={LINE_TABLE_LABEL_TEXT}>Belopp</span>
      <p className="flex min-h-10 items-center text-sm tabular-nums sm:justify-end @[50rem]:justify-end" data-testid="purchase-line-amount">{pricesHidden ? <span className="text-muted-foreground">–</span> : amount === null ? <span className="font-normal text-muted-foreground">Inget pris</span> : <span className="truncate font-semibold text-foreground">{formatSek(amount)} kr</span>}</p>
    </div>
    <div className="flex min-h-10 items-center justify-end @[50rem]:justify-center">
      {deliverable ? <label className="flex items-center gap-2 text-xs text-muted-foreground"><Checkbox checked={Boolean(line.deliveredAt)} disabled={busy} onCheckedChange={(checked) => onDeliver(checked === true)} aria-label={`${line.name} har kommit`} data-testid="purchase-line-delivered" /><span className="@[50rem]:sr-only">Har kommit</span></label>
        : editable ? <RemoveButton label="Ta bort raden" onClick={onRemove} data-testid="purchase-line-remove" /> : null}
    </div>
    {line.product ? <RowProduct info={line.product} className="col-span-full @[50rem]:pb-1" /> : null}
    {line.catalogue && editable && !pricesHidden ? <div className="col-span-full @[50rem]:pb-1"><ClearablePrice snapshot={line.catalogue} unitPrice={line.unitPrice} editable={editable} onClear={() => clearPriceWithUndo(line, onPatch)} /></div> : null}
  </LineCells></div>;
}

type QuoteChoice = { id: string; label: string; title: string };
/** Lägg i offert: a new quote or an open draft, and the lines one by one or as one sum. */
function ToQuoteDialog({ open, onOpenChange, busy, projectId, onConfirm }: { open: boolean; onOpenChange: (open: boolean) => void; busy: boolean; projectId: string | null; onConfirm: (quoteId: string | null, sum: boolean) => void }) {
  const [quotes, setQuotes] = useState<QuoteChoice[] | null>(null);
  const [target, setTarget] = useState("new");
  const [mode, setMode] = useState("lines");
  useEffect(() => {
    if (!open) return;
    let current = true;
    api<{ items: { id: string; label: string; title: string }[] }>(`/api/quotes?filter=DRAFT${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""}`, { cache: "no-store" })
      .then((result) => { if (current) setQuotes(result.items.slice(0, 10)); }).catch(() => { if (current) setQuotes([]); });
    return () => { current = false; };
  }, [open, projectId]);
  return <Modal open={open} onOpenChange={onOpenChange} title="Lägg i offert" size="compact">
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onConfirm(target === "new" ? null : target, mode === "sum"); }} data-testid="purchase-to-quote-dialog">
      <fieldset className="grid gap-2" aria-label="Hur">
        <ChoiceCard name="purchase-quote-mode" value="lines" checked={mode === "lines"} onChange={setMode} title="Som rader" description="Varje artikel blir en materialrad med ert påslag." />
        <ChoiceCard name="purchase-quote-mode" value="sum" checked={mode === "sum"} onChange={setMode} title="Som en summa" description="En rad, Material, med hela inköpet och ert påslag. Kunden ser bara summan." />
      </fieldset>
      <fieldset className="grid max-h-[40vh] gap-2 overflow-y-auto" aria-label="Offert">
        <ChoiceCard name="purchase-quote-target" value="new" checked={target === "new"} onChange={setTarget} title="Ny offert" />
        {quotes === null ? <p className="text-xs text-muted-foreground" role="status">Hämtar offertutkast…</p>
          : quotes.map((quote) => <ChoiceCard key={quote.id} name="purchase-quote-target" value={quote.id} checked={target === quote.id} onChange={setTarget} title={`${quote.label} · ${quote.title}`} description="Utkast" />)}
      </fieldset>
      <p className="text-xs text-muted-foreground">Offerten öppnas med raderna tillagda. Spara den som vanligt. Ändras inköpet senare kan offerten uppdateras så länge den är ett utkast.</p>
      <DialogActions cancel={{ onClick: () => onOpenChange(false) }} primary={{ label: "Öppna offerten", type: "submit", busy, testId: "purchase-to-quote-confirm" }} />
    </form>
  </Modal>;
}

type WorkOrderChoice = { id: string; title: string; projectName: string; customerName: string };
/** Lägg som material: the purchase's own work order first, then the company's open work orders (the project's first). */
function ToWorkOrderDialog({ open, onOpenChange, busy, linked, projectId, onConfirm }: { open: boolean; onOpenChange: (open: boolean) => void; busy: boolean; linked: { id: string; title: string } | null; projectId: string | null; onConfirm: (taskId: string) => void }) {
  const [orders, setOrders] = useState<(WorkOrderChoice & { projectId?: string | null })[] | null>(null);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState(linked?.id ?? "");
  useEffect(() => {
    if (!open) return;
    let current = true;
    const timer = window.setTimeout(() => {
      api<{ items: (WorkOrderChoice & { projectId: string | null })[] }>(`/api/work-orders?scope=all&filter=open${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ""}`, { cache: "no-store" })
        .then((result) => { if (current) setOrders([...result.items].sort((a, b) => Number(b.projectId === projectId) - Number(a.projectId === projectId))); })
        .catch(() => { if (current) setOrders([]); });
    }, query ? 250 : 0);
    return () => { current = false; window.clearTimeout(timer); };
  }, [open, query, projectId]);
  const shown = [...(linked ? [{ id: linked.id, title: linked.title, projectName: "", customerName: "", projectId: null }] : []), ...(orders ?? []).filter((order) => order.id !== linked?.id)];
  return <Modal open={open} onOpenChange={onOpenChange} title="Lägg som material" size="compact">
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (target) onConfirm(target); }} data-testid="purchase-to-work-order-dialog">
      <Input type="search" aria-label="Sök arbetsorder" placeholder="Sök arbetsorder, kund eller projekt…" value={query} onChange={(event) => setQuery(event.target.value)} />
      <fieldset className="grid max-h-[45vh] gap-2 overflow-y-auto" aria-label="Arbetsorder">
        {orders === null ? <p className="text-xs text-muted-foreground" role="status">Hämtar arbetsordrar…</p>
          : !shown.length ? <p className="text-sm text-muted-foreground">Ingen öppen arbetsorder matchar.</p>
          : shown.slice(0, 20).map((order) => <ChoiceCard key={order.id} name="purchase-work-order" value={order.id} checked={target === order.id} onChange={setTarget} title={order.title}
            description={order.id === linked?.id ? "Inköpets arbetsorder" : [order.customerName, order.projectName].filter(Boolean).join(" · ") || undefined} />)}
      </fieldset>
      <p className="text-xs text-muted-foreground">Arbetsordern öppnas med de rader den inte redan har. Den sparas som vanligt.</p>
      <DialogActions cancel={{ onClick: () => onOpenChange(false) }} primary={{ label: "Öppna arbetsordern", type: "submit", busy, disabled: !target, testId: "purchase-to-work-order-confirm" }} />
    </form>
  </Modal>;
}
