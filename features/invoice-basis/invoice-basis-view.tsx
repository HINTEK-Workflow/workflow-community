"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { BookOpenCheck, CheckCircle2, ChevronsUpDown, ClipboardList, FileSpreadsheet, FileText, FolderKanban, ListOrdered, Plus, Receipt, Search, Send, Sigma, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ListEmpty, ListFact, ListGroup, ListRow, NativeActions } from "@/components/native";
import { api } from "@/features/kfid/api";
import { DISCARD_QUESTION, useConfirm } from "@/features/kfid/confirm";
import { CheckField, DialogActions, Panel } from "@/features/kfid/ui";
import type { CustomerItem, ProjectItem } from "@/features/kfid/types";
import { useCustomerOptions } from "@/features/kfid/customer-options";
import { EditorAside, EditorAsideLayout } from "@/components/editor-aside";
import { EDITOR_PRIMARY_REASON_ID, EditorHeader, type EditorFact } from "@/features/workflow/editor-header";
import { customerFromProject, DealBasicsFields, SharedBasicsPanel } from "@/features/workflow/shared-basics";
import type { CustomerPlaceChange } from "@/features/workflow/customer-field";
import { FirstChangeSave } from "@/lib/workflow/use-first-change-save";
import { DialogPage } from "@/features/kfid/dialog-page";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { ExportMenu } from "@/features/workflow/export-menu";
import { FortnoxDialog } from "@/features/quotes/fortnox-dialog";
import { downloadExport } from "@/features/quotes/quote-export";
import { cn } from "@/lib/utils";
import { ACCOUNTS_PLACE, FORTNOX_CONNECTION_READY } from "@/lib/quotes/accounting";
import { swedishDayKey } from "@/lib/swedish-time";
import { announce } from "@/lib/workflow/toast";
import { useUndoRemove } from "@/features/kfid/use-undo-remove";
import { PriceMark } from "@/features/workflow/catalogue-picker";
import { ArticleBrowserDialog, type ArticleAdd } from "@/features/catalogue/article-browser";
import { ArticleNoField, enterAddsLine, LINE_TABLE_BOX, LINE_TABLE_GRID, LINE_TABLE_LABEL, LINE_TABLE_LABEL_TEXT, LINE_TABLE_NARROW_INPUT, LINE_TABLE_ROW, LINE_TABLE_SHELL, LineTableHeader } from "@/features/quotes/line-table";
import { useBrowserBackGuard } from "@/lib/workflow/use-back-guard";
import { formatPrice, formatSek, MATERIAL_UNIT_SUGGESTIONS, parseAmount } from "@/lib/workflow/expenses";
import { parsePercent } from "@/lib/workflow/material-prices";
import { parseKronor, parseShare, QUOTE_LINE_KIND_LABELS, QUOTE_LINE_KINDS, QUOTE_VAT_PERCENT, quoteLineNumbers, quoteRotOf, REVERSE_VAT_LABEL, REVERSE_VAT_TEXT, type QuoteCustomerType, type QuoteLineKind } from "@/lib/quotes/model";
import { DEFAULT_ROT_CAP, DEFAULT_ROT_PERCENT } from "@/lib/quotes/settings";
import {
  blankInvoiceLine, invoiceBasisTotals, invoiceBasisStatusText, invoiceLineHoursText, invoiceLineSubtitle, invoiceReadyProblem, patchInvoiceLine, INVOICE_BASIS_MAX_LINES,
  type InvoiceBasisLine, type InvoiceBasisListItem, type InvoiceBasisStatus, type InvoiceBasisSummary, type InvoiceBasisView, type InvoicePriceDefaults,
} from "@/lib/invoice-basis/model";
import { RemoveButton } from "@/components/ui/remove-button";
import { clientExtensions } from "@ee/client";

const { InvoiceFromBasis } = clientExtensions;

/**
 * Ett fakturaunderlag (2026-10-10): a page over the list with the lines in fixed columns – Typ, Benämning, Antal, Enhet,
 * À-pris, Påslag, Belopp – the sums (net, VAT, to pay), Exportera (CSV, SIE only once invoiced, Fortnox), Markera som fakturerat
 * and Ta bort. Lika är rätt (2026-11-14): on a computer it is an editor like the offert – the shared header with every
 * button top right (at most four, the rest under Mer), Grunduppgifter (variant Affär: Rubrik, Projekt, Arbetsorder, Kund, Plats,
 * Moms, Anteckning) as the first card, Rader as a card and Summa beside them. An invoiced basis is shown locked, as text, with
 * when and by whom. Nytt fakturaunderlag on a job or project opens a proposal: nothing is saved until Skapa underlaget (QA
 * 2026-10-10); Nytt fakturaunderlag on the list opens an empty basis that is saved at its first change. At level 1 on a phone the
 * same view is a screen: the lines are rows, one line opens as its own screen (Avbryt/Spara in the top bar, Ta bort raden under
 * the fields, as a work order's material row), and the bases of the job or project are the screen before it.
 */
export const invoiceDay = (iso: string | null) => iso ? swedishDayKey(new Date(iso)) : "";
export const statusTone = (status: InvoiceBasisStatus) => status === "INVOICED" ? "success" as const : "warning" as const;

/** The job or project a basis is made on. */
export type InvoiceBasisRef = { taskId?: string; projectId?: string };
/** How an empty basis is saved at its first change (the start of an invoice, Cloud): its id and number. */
export type BlankInvoiceStart = { create: (input: { customerId: string | null; title: string }) => Promise<{ id: string; label: string }> };
/** What the view shows: a saved basis, the proposal of a new one for a job or project, or an empty one from the list. */
export type InvoiceBasisTarget = { id: string } | { proposal: InvoiceBasisRef } | { blank: BlankInvoiceStart };
const refQuery = (ref: InvoiceBasisRef) => ref.taskId ? `taskId=${encodeURIComponent(ref.taskId)}` : `projectId=${encodeURIComponent(ref.projectId ?? "")}`;
const targetKey = (target: InvoiceBasisTarget | null) => !target ? "" : "id" in target ? `id=${encodeURIComponent(target.id)}` : "blank" in target ? "blank=1" : `proposal=1&${refQuery(target.proposal)}`;
const isNewTarget = (target: InvoiceBasisTarget | null) => Boolean(target && !("id" in target));

type DraftTax = { reverseVat: boolean; buyerVatNumber: string; rotEnabled: boolean; rotPercent: string; rotCap: string };
type Draft = { title: string; note: string; vatPercent: string; tax: DraftTax; lines: InvoiceBasisLine[]; customerId: string | null; facilityId: string | null; projectId: string | null };
const draftOf = (basis: InvoiceBasisView): Draft => ({
  title: basis.title, note: basis.note, vatPercent: formatPrice(basis.vatPercent), lines: basis.lines,
  customerId: basis.customer?.id ?? null, facilityId: basis.facility?.id ?? null, projectId: basis.project?.id ?? null,
  tax: {
    reverseVat: basis.tax?.reverseVat ?? false, buyerVatNumber: basis.tax?.buyerVatNumber ?? "", rotEnabled: basis.tax?.rotEnabled ?? false,
    rotPercent: basis.tax?.rotPercent !== null && basis.tax?.rotPercent !== undefined ? formatPrice(basis.tax.rotPercent) : basis.priceDefaults?.rotPercent ?? DEFAULT_ROT_PERCENT,
    rotCap: basis.tax?.rotCap !== null && basis.tax?.rotCap !== undefined ? formatPrice(basis.tax.rotCap) : basis.priceDefaults?.rotCap ?? DEFAULT_ROT_CAP,
  },
});
const sameDraft = (left: Draft, right: Draft) => JSON.stringify(left) === JSON.stringify(right);
const NO_DEFAULTS: InvoicePriceDefaults = { hourlyRate: "", markupPercent: "" };
/** The same button words as the quote (2026-10-11): one name for one thing. */
const ADD_LINE_LABELS: Record<QuoteLineKind, string> = { MATERIAL: "Lägg till material", LABOUR: "Lägg till arbete", OTHER: "Lägg till övrigt" };
/** A line with something in it – what it took from the work, or anything written since it was added – asks before it is removed. */
const invoiceLineHasContent = (line: InvoiceBasisLine, defaults: InvoicePriceDefaults | null | undefined) => {
  if (line.sources.length) return true;
  const fresh = blankInvoiceLine(line.kind, line.id, defaults);
  return (["name", "quantity", "unit", "unitPrice", "markupPercent"] as const).some((key) => line[key].trim() !== fresh[key].trim());
};

/** One basis or proposal: read, change, create, save, mark as invoiced, delete. */
/**
 * What removing a line that came from work means: it is not invoiced here, and the work it covered is not offered again. Said when
 * such a line is removed (the toast, or the question on a phone), not under the heading (resa 2026-11-06).
 */
const workNote = (proposal: boolean) => proposal ? "Arbetet bakom den räknas ändå som fakturerat." : "Arbetet bakom den kan inte tas med i ett annat underlag.";
function removeLineNote(proposal: boolean) {
  return proposal ? `Raden tas inte med. ${workNote(proposal)}` : `Raden tas bort. ${workNote(proposal)} Vill du börja om, ta bort hela underlaget.`;
}

function useInvoiceBasis(target: InvoiceBasisTarget | null, onChanged: () => void) {
  const [basis, setBasis] = useState<InvoiceBasisView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = targetKey(target);
  // An empty basis saved at its first change (2026-11-14): when it is read back, what was typed meanwhile stays.
  const adopting = useRef<string | null>(null);
  const draftNow = useRef<Draft | null>(null);
  useEffect(() => { draftNow.current = draft; });
  const load = useCallback(async (keep = false) => {
    if (!key) return;
    try {
      const result = await api<{ basis: InvoiceBasisView }>(`/api/invoice-bases?${key}`, { cache: "no-store" });
      setBasis(result.basis);
      const typed = keep ? draftNow.current : null;
      setDraft(typed ? { ...typed, title: typed.title.trim() ? typed.title : result.basis.title } : draftOf(result.basis));
      setError("");
    } catch (cause) { setError((cause as Error).message); }
  }, [key]);
  useEffect(() => {
    const kept = Boolean(adopting.current) && key === `id=${encodeURIComponent(adopting.current ?? "")}`;
    adopting.current = null;
    if (kept) { void load(true); return; }
    setBasis(null); setDraft(null); setError("");
    void load();
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = Boolean(basis && draft && !sameDraft(draftOf(basis), draft));
  const post = async <T,>(body: Record<string, unknown>): Promise<T | null> => {
    setBusy(true); setError("");
    try { return await api<T>("/api/invoice-bases", { method: "POST", body: JSON.stringify(body) }); }
    catch (cause) { setError((cause as Error).message); announce((cause as Error).message, true); return null; }
    finally { setBusy(false); }
  };
  // Kund, plats och projekt (2026-11-14): the project only where the basis may choose one.
  const fields = (next: Draft) => ({ title: next.title, note: next.note, vatPercent: next.vatPercent, tax: next.tax, lines: next.lines,
    customerId: next.customerId, facilityId: next.facilityId, ...(basis?.projectLocked ? {} : { projectId: next.projectId }) });
  /** Skapa underlaget: the proposal as changed is saved with the next number and takes its sources; its id, or null. */
  const create = async (): Promise<{ id: string; label: string } | null> => {
    if (!basis?.proposal || !draft || !target || !("proposal" in target)) return null;
    setBusy(true); setError("");
    try {
      const created = await api<{ id: string; label: string }>("/api/invoice-bases", { method: "POST", body: JSON.stringify({ action: "create", ...target.proposal, proposal: basis.proposal, basis: fields(draft) }) });
      announce(`${created.label} är skapat.`);
      onChanged();
      return created;
    } catch (cause) {
      const message = (cause as Error).message;
      announce(message, true);
      // The work changed meanwhile: the proposal is read again (the server says so in the message).
      if ((cause as { status?: number }).status === 409) await load();
      setError(message);
      onChanged();
      return null;
    } finally { setBusy(false); }
  };
  /** Nytt fakturaunderlag from the list: saved at the first change (or Spara) with the next number; what is typed follows at once. */
  const createBlank = async (): Promise<{ id: string; label: string } | null> => {
    if (!basis?.blank || !draft || !target || !("blank" in target)) return null;
    setBusy(true); setError("");
    try {
      const created = await target.blank.create({ customerId: draft.customerId, title: draft.title });
      await api("/api/invoice-bases", { method: "POST", body: JSON.stringify({ action: "save", id: created.id, revision: 1, basis: fields({ ...draft, title: draft.title.trim() || "Faktura" }) }) });
      adopting.current = created.id;
      announce(`${created.label} är sparat som utkast.`);
      onChanged();
      return created;
    } catch (cause) {
      const message = (cause as Error).message;
      announce(message, true);
      setError(message);
      return null;
    } finally { setBusy(false); }
  };
  const save = async (next: Draft | null = draft) => {
    if (!basis || !next || basis.proposal || basis.blank) return false;
    const done = await post<{ revision: number }>({ action: "save", id: basis.id, revision: basis.revision, basis: fields(next) });
    if (!done) return false;
    await load(); onChanged();
    return true;
  };
  const invoice = async () => {
    if (!basis || basis.proposal) return false;
    const done = await post({ action: "invoice", id: basis.id, revision: basis.revision });
    if (!done) return false;
    announce(`${basis.label} är markerat som fakturerat.`);
    await load(); onChanged();
    return true;
  };
  const remove = async () => {
    if (!basis || basis.proposal) return false;
    const done = await post({ action: "delete", id: basis.id });
    if (!done) return false;
    announce(`${basis.label} är borttaget. Det som fanns i underlaget kan tas med i ett nytt. Numret används inte igen.`);
    onChanged();
    return true;
  };
  return { basis, draft, setDraft, dirty, busy, error, load, create, createBlank, save, invoice, remove, reset: () => { if (basis) setDraft(draftOf(basis)); } };
}
type BasisState = ReturnType<typeof useInvoiceBasis>;

const LINE_LABEL = "block min-w-0 space-y-1.5 text-xs font-medium text-muted-foreground";
const DESTRUCTIVE = "text-destructive hover:bg-destructive/10 hover:text-destructive";
/** A datalist's own arrow is hidden, so Enhet looks like the fields around it; the suggestions still come while typing. */
const NO_LIST_ARROW = "[&::-webkit-calendar-picker-indicator]:hidden";

/**
 * The basis as a view. `target` opens it straight on a basis or on the proposal of a new one; without it (level 1, with
 * `summary` and `subject`) the job's or project's bases come first and a basis opens from there.
 */
export function InvoiceBasisModal({ target, open, onClose, onChanged, native = false, summary, subject, projects }: {
  target: InvoiceBasisTarget | null;
  open: boolean;
  onClose: () => void;
  /** Something was created, saved, marked or deleted: the panel reads its list again. */
  onChanged: () => void;
  /** Level 1 on a phone: the list of bases is the first screen. */
  native?: boolean;
  summary?: InvoiceBasisSummary | null;
  /** The job or project of the list (level 1): Nytt fakturaunderlag opens its proposal. */
  subject?: InvoiceBasisRef;
  /** The company's projects, for a basis that may choose one (made from nothing); without them the project is only shown. */
  projects?: ProjectItem[];
}) {
  const [current, setCurrent] = useState<InvoiceBasisTarget | null>(target);
  const [lineId, setLineId] = useState<string | null>(null);
  const [lineStart, setLineStart] = useState<InvoiceBasisLine | null>(null);
  // A new target from outside (the panel opened another basis) replaces the one shown.
  const [lastTarget, setLastTarget] = useState(targetKey(target));
  if (targetKey(target) !== lastTarget) { setLastTarget(targetKey(target)); setCurrent(target); setLineId(null); }
  const state = useInvoiceBasis(open ? current : null, onChanged);
  // Kund och plats (Grunduppgifter, 2026-11-14): the company's customers, read once for every editor.
  const customers = useCustomerOptions(open && !native);
  const [confirm, confirmElement] = useConfirm();
  const listFirst = native && !target;
  const backToList = () => { setLineId(null); setCurrent(null); };
  // Being closed by the view's own ways out (Avbryt, Stäng, the app's Bakåt): a browser step back then goes on as asked.
  const closing = useRef(false);
  useEffect(() => { if (open) closing.current = false; }, [open]);
  const close = () => { closing.current = true; setLineId(null); onClose(); };
  const leave = () => { if (listFirst) backToList(); else close(); };
  // The browser's or the phone's Bakåt with unsaved changes asks first, like every other way out (QA 2026-10-10).
  useBrowserBackGuard(open && state.dirty, {
    // The view is the page "fakturaunderlag"; a page opened from it (Lägg till artiklar) is waited for.
    page: "fakturaunderlag",
    ask: () => confirm(DISCARD_QUESTION),
    onLeave: () => { state.reset(); leave(); },
    skip: () => closing.current,
  });
  const line = lineId && state.draft ? state.draft.lines.find((item) => item.id === lineId) ?? null : null;
  const proposal = Boolean(state.basis?.proposal);
  // At level 1 the number stays in the title at 360 px ("Underlag F-0003"; QA 2026-10-10: "Fakturaunderlag F-…").
  const title = !current ? "Fakturaunderlag"
    : native && line ? QUOTE_LINE_KIND_LABELS[line.kind]
    : isNewTarget(current) || proposal || state.basis?.blank ? (native ? "Nytt underlag" : "Nytt fakturaunderlag")
    : state.basis ? (native ? `Underlag ${state.basis.label}` : `Fakturaunderlag ${state.basis.label}`) : "Fakturaunderlag";
  const created = (id: string) => setCurrent({ id });
  return <DialogPage pageKey="fakturaunderlag" width="wide" panelTitle={false} header={false} guardBack={false} untracked open={open} onOpenChange={(next) => { if (!next) close(); }} title={title} size="page" nativeBack={native && !current ? (subject?.taskId ? "Jobbet" : "Projektet") : undefined} modalClassName="data-[native-view]:bg-background">
    <div className="space-y-5" data-testid="invoice-basis-view">
      {confirmElement}
      {!current ? <NativeBasisList summary={summary ?? null} onOpen={(next) => setCurrent({ id: next })} onCreate={subject ? () => setCurrent({ proposal: subject }) : undefined} />
        : !state.basis || !state.draft ? <p className={cn("text-sm", state.error ? "text-destructive" : "text-muted-foreground")} role={state.error ? "alert" : "status"}>{state.error || (proposal || (current && "proposal" in current) ? "Räknar fram förslaget…" : "Hämtar underlaget…")}</p>
        : native && line ? <NativeLineScreen line={line} state={state} confirm={confirm}
          onCancel={() => { state.setDraft((draft) => draft && ({ ...draft, lines: lineStart ? draft.lines.map((item) => item.id === line.id ? lineStart : item) : draft.lines.filter((item) => item.id !== line.id) })); setLineId(null); }}
          onDone={() => setLineId(null)} />
        : <BasisContent state={state} native={native} confirm={confirm} onClose={listFirst ? backToList : close} onDeleted={leave} onCreated={created}
          title={title} customers={customers} projects={projects ?? []}
          onOpenLine={(next, start) => { setLineStart(start); setLineId(next); }} />}
    </div>
  </DialogPage>;
}

/** Level 1: the job's or project's bases as rows, with Nytt fakturaunderlag first. */
function NativeBasisList({ summary, onOpen, onCreate }: { summary: InvoiceBasisSummary | null; onOpen: (id: string) => void; onCreate?: () => void }) {
  if (!summary) return <p className="text-sm text-muted-foreground" role="status">Hämtar fakturaunderlagen…</p>;
  const notes = [summary.notCompleted, summary.quoteNote].filter(Boolean).join(" ");
  return <div className="space-y-1" data-testid="invoice-basis-native-list">
    {summary.canEdit && onCreate ? <ListGroup footer={summary.newReason || "Visar ett förslag med avslutad tid, material och utgifter som inte redan finns i ett underlag. Inget sparas förrän du skapar underlaget."}>
      <ListRow type="quote" icon={Plus} title="Nytt fakturaunderlag" onClick={summary.newReason ? undefined : onCreate}
        className={summary.newReason ? "opacity-50" : undefined} ariaLabel={summary.newReason ? `Nytt fakturaunderlag (inte tillgängligt). ${summary.newReason}` : undefined} testId="invoice-basis-native-new" chevron={false} />
    </ListGroup> : null}
    <ListGroup title="Underlag" footer={notes || undefined} testId="invoice-basis-native-bases">
      {summary.bases.length ? summary.bases.map((item) => <BasisRow key={item.id} item={item} onOpen={() => onOpen(item.id)} />) : <ListEmpty>Inga fakturaunderlag än.</ListEmpty>}
    </ListGroup>
  </div>;
}

function BasisRow({ item, onOpen }: { item: InvoiceBasisListItem; onOpen: () => void }) {
  return <ListRow type="quote" icon={Receipt} title={`${item.label} · ${item.title}`} subtitle={[invoiceBasisStatusText(item, invoiceDay), item.scope === "project" ? "Projektet" : ""].filter(Boolean).join(" · ")}
    subtitleTone={item.status === "DRAFT" ? "primary" : undefined} value={`${formatSek(item.net)} kr`} onClick={onOpen} testId="invoice-basis-native-row" twoLines />;
}

type Confirm = ReturnType<typeof useConfirm>[0];
const unpricedText = (count: number) => `${count} ${count === 1 ? "rad saknar" : "rader saknar"}`;

/** The basis itself: facts, the lines, the sums and its actions; the same data at every level, drawn for the device. */
function BasisContent({ state, native, confirm, onClose, onDeleted, onCreated, onOpenLine, title, customers, projects }: {
  state: BasisState; native: boolean; confirm: Confirm; onClose: () => void; onDeleted: () => void; onCreated: (id: string) => void; onOpenLine: (id: string, start: InvoiceBasisLine | null) => void;
  title: string; customers: CustomerItem[]; projects: ProjectItem[];
}) {
  const basis = state.basis!;
  const draft = state.draft!;
  const proposal = Boolean(basis.proposal);
  const blank = Boolean(basis.blank);
  // Not saved yet: a proposal (Skapa underlaget) or an empty basis (saved at its first change).
  const unsaved = proposal || blank;
  const editable = basis.canEdit;
  const defaults = basis.priceDefaults ?? NO_DEFAULTS;
  const [fortnox, setFortnox] = useState(false);
  const reasonId = useId();
  const unitListId = useId();
  const vat = parseShare(draft.vatPercent);
  // The chosen customer's type decides Omvänd byggmoms or ROT; the basis's own until the customer list is read.
  const chosenCustomer = customers.find((item) => item.id === draft.customerId);
  const customerType: QuoteCustomerType = draft.customerId === (basis.customer?.id ?? null) ? basis.customerType ?? "COMPANY" : chosenCustomer?.customerType ?? "COMPANY";
  const rot = quoteRotOf({ customerType, rotEnabled: draft.tax.rotEnabled, rotPercent: draft.tax.rotPercent, rotCap: draft.tax.rotCap });
  const rotOn = customerType === "PRIVATE" && draft.tax.rotEnabled;
  const totals = invoiceBasisTotals(draft.lines, vat ?? basis.vatPercent, rot);
  const change = (patch: Partial<Draft>) => state.setDraft((current) => current && ({ ...current, ...patch }));
  const patchLine = (id: string, patch: Partial<InvoiceBasisLine>) => change({ lines: draft.lines.map((line) => line.id === id ? patchInvoiceLine(line, patch, defaults) : line) });
  // Ta bort rad (2026-10-11): at once, with or without content; Ångra in the toast (or Ctrl/Cmd+Z) puts the line back where it
  // stood. Nothing is saved before Spara / Skapa underlaget, so the removal is still only a change to the draft. (On a phone a
  // removal saves at once, so there the question stays.)
  const undoRemove = useUndoRemove<InvoiceBasisLine>((update) => state.setDraft((current) => current && ({ ...current, lines: update(current.lines) })));
  const removeLine = (id: string) => undoRemove(draft.lines, id, draft.lines.find((line) => line.id === id)?.sources.length ? { text: `Raden är borttagen. ${workNote(proposal)}` } : {});
  /** Lägg till artiklar (2026-10-16): each article added in the shared search becomes a new Material line. */
  const [browsing, setBrowsing] = useState(false);
  const addArticle = ({ row }: ArticleAdd) => {
    const line = patchInvoiceLine(blankInvoiceLine("MATERIAL", crypto.randomUUID(), defaults), { name: row.name, quantity: row.quantity || "1", unit: row.unit,
      ...(row.unitPrice !== undefined ? { unitPrice: row.unitPrice } : {}), articleNo: row.articleNo ?? "", articleSource: row.articleSource ?? "", manufacturerArticleNo: row.manufacturerArticleNo ?? "", catalogue: row.catalogue }, defaults);
    state.setDraft((current) => current && ({ ...current, lines: [...current.lines, line] }));
    return line.id;
  };
  /** `− antal +` on a search card (2026-10-26, as in the quote): the added line's antal, or the line taken away at 0. */
  const adjustArticle = (lineId: string, quantity: string | null) => {
    state.setDraft((current) => current && ({ ...current, lines: quantity === null ? current.lines.filter((item) => item.id !== lineId)
      : current.lines.map((item) => item.id === lineId ? patchInvoiceLine(item, { quantity }, defaults) : item) }));
  };
  const addLine = (kind: QuoteLineKind) => {
    const line = { ...blankInvoiceLine(kind, crypto.randomUUID(), defaults), ...(rotOn && kind === "LABOUR" ? { rotLabour: true } : {}) };
    change({ lines: [...draft.lines, line] });
    if (native) onOpenLine(line.id, null);
    // Centered, so the new line is never left under the view's footer (its search hits need room too).
    else window.setTimeout(() => { const field = document.querySelector<HTMLInputElement>(`[data-line="${line.id}"] input[name="invoice-line-name"]`); field?.focus({ preventScroll: true }); field?.scrollIntoView({ block: "center" }); }, 0);
  };
  // A new customer brings what fits it: Omvänd byggmoms is a company's, ROT a private person's (the server checks the same).
  const chooseCustomer = (next: CustomerPlaceChange) => {
    const nextType: QuoteCustomerType = next.customer?.customerType === "PRIVATE" ? "PRIVATE" : "COMPANY";
    const tax = nextType === "PRIVATE" ? { ...draft.tax, reverseVat: false, buyerVatNumber: "" } : { ...draft.tax, rotEnabled: false };
    change({ customerId: next.customerId, facilityId: next.facilityId, tax, ...(nextType === "PRIVATE" && draft.tax.reverseVat ? { vatPercent: String(QUOTE_VAT_PERCENT) } : {}) });
  };
  const facts: [string, string][] = [
    ...(basis.task ? [["Arbetsorder", basis.task.title] as [string, string]] : []),
    ...(basis.project ? [["Projekt", basis.project.name] as [string, string]] : []),
    ...(basis.customer ? [["Kund", basis.customer.name] as [string, string]] : []),
    ...(basis.facility ? [["Plats", basis.facility.name] as [string, string]] : []),
  ];
  const statusText = proposal ? "Förslag – inte sparat" : blank ? "Nytt – sparas när du skriver" : basis.status === "INVOICED" ? `Fakturerat ${invoiceDay(basis.invoicedAt)}${basis.invoicedByName ? ` av ${basis.invoicedByName}` : ""}` : "Utkast";
  const blockedReason = state.dirty ? "Spara ändringarna först. Exporten och markeringen gäller det sparade underlaget." : "";
  // An invoiced basis is locked: a line without a price could never be invoiced afterwards (QA 2026-10-10).
  const markReason = blockedReason || invoiceReadyProblem(draft.lines, draft.tax);
  const unpricedHint = totals.unpriced ? `${unpricedText(totals.unpriced)} pris. Sätt pris på alla rader för fakturering${FORTNOX_CONNECTION_READY ? " och Fortnox" : ""}.` : undefined;
  const markInvoiced = async () => {
    if (markReason) { announce(markReason); return; }
    if (!await confirm({ title: `Markera ${basis.label} som fakturerat?`, message: "Underlaget låses med dagens datum och ditt namn. Det som finns i det faktureras aldrig igen.", confirmLabel: "Markera som fakturerat" })) return;
    await state.invoice();
  };
  const remove = async () => {
    if (!await confirm({ title: `Ta bort ${basis.label}?`, message: "Underlaget tas bort och allt det tog med – tid, material och utgifter – kan tas med i ett nytt underlag. Numret används inte igen.", confirmLabel: "Ta bort underlaget", tone: "danger" })) return;
    if (await state.remove()) onDeleted();
  };
  const createBasis = async () => { const done = await state.create(); if (done) onCreated(done.id); };
  const createBlank = async () => { const done = await state.createBlank(); if (done) onCreated(done.id); return done; };
  // Accounts are set by an administrator; the path is said in words, so it reads the same at level 1 (no link there).
  const exportDescription = [
    "CSV ger en rad per rad i underlaget.",
    `${editable && FORTNOX_CONNECTION_READY ? "SIE och Fortnox använder" : "SIE använder"} företagets egna konton. Kontona anges av en administratör under ${ACCOUNTS_PLACE}.`,
    // Bara godkänt underlag bokförs (2026-11-01): SIE only once the basis is marked as invoiced; the API refuses a draft too.
    basis.status === "INVOICED" ? "CSV och SIE markerar inte underlaget som fakturerat." : "SIE kan hämtas när underlaget är markerat som fakturerat. CSV markerar inte underlaget.",
  ].join(" ");
  const sieHint = basis.status !== "INVOICED" ? "SIE görs när underlaget är markerat som fakturerat." : unpricedHint;
  const exportMenu = unsaved ? null : <ExportMenu testId="invoice-basis-export" title={`Exportera ${basis.label}`} disabled={Boolean(blockedReason) || state.busy} description={exportDescription}
    formats={[
      { id: "invoice-basis-pdf", label: "PDF", icon: FileText, run: () => downloadExport(`/api/invoice-bases/export?format=pdf&id=${encodeURIComponent(basis.id)}`, `fakturaunderlag-${basis.label}.pdf`) },
      { id: "invoice-basis-csv", label: "CSV", icon: FileSpreadsheet, primary: true, run: () => downloadExport(`/api/invoice-bases/export?format=csv&id=${encodeURIComponent(basis.id)}`, `fakturaunderlag-${basis.label}.csv`) },
      { id: "invoice-basis-sie", label: "SIE (bokföring)", icon: BookOpenCheck, disabled: Boolean(sieHint), hint: sieHint, run: () => downloadExport(`/api/invoice-bases/export?format=sie&id=${encodeURIComponent(basis.id)}`, `fakturaunderlag-${basis.label}.si`) },
      // Fortnox only for a draft the person may change: an invoiced basis is never sent again.
      ...(editable && FORTNOX_CONNECTION_READY ? [{ id: "invoice-basis-fortnox", label: "Fortnox …", icon: Send, disabled: Boolean(unpricedHint), hint: unpricedHint, run: () => setFortnox(true) }] : []),
    ]} />;
  const fortnoxDialog = FORTNOX_CONNECTION_READY && fortnox ? <FortnoxDialog endpoint="/api/invoice-bases/export" id={basis.id} testId="invoice-basis-fortnox" onClose={() => setFortnox(false)}
    intro="Underlaget blir ett fakturautkast i företagets Fortnox. När det har skickats markeras underlaget som fakturerat här. Inget bokförs eller skickas till kunden förrän ni gör det i Fortnox."
    onSent={(documentNumber) => { announce(`${basis.label} finns nu som fakturautkast i Fortnox${documentNumber ? ` (nr ${documentNumber})` : ""} och är markerat som fakturerat.`); void state.load(); }} /> : null;
  const markShown = editable && !unsaved;
  const markButton = markShown ? <Button type="button" variant="outline" disabled={state.busy} disabledReason={markReason || null} aria-describedby={markReason ? (native ? reasonId : EDITOR_PRIMARY_REASON_ID) : undefined} onClick={() => void markInvoiced()} data-testid="invoice-basis-mark"><CheckCircle2 />Markera som fakturerat</Button> : null;
  const removeButton = editable && !unsaved ? <Button type="button" variant={native ? "ghost" : "outline"} className={native ? DESTRUCTIVE : "text-destructive"} disabled={state.busy} onClick={() => void remove()} data-testid="invoice-basis-delete"><Trash2 />Ta bort underlaget</Button> : null;
  // Fakturor (2026-11-04): shown only with the company's setting on and the right Fakturera; it asks the server itself.
  const invoiceAction = InvoiceFromBasis && !unsaved ? <InvoiceFromBasis key={`${basis.id}-${basis.revision}`} basisId={basis.id} dirty={state.dirty} blocked={draft.lines.length ? null : "Lägg till minst en rad."} onChanged={() => void state.load()} /> : null;
  const proposalNote = "Förslaget är inte sparat. Skapa underlaget ger nästa nummer och tar med tid, material och utgifter. Avbryt sparar inget.";
  const actions = <DialogActions className={native ? undefined : "contents"} cancel={{ label: editable ? "Avbryt" : "Stäng", onClick: onClose }}
    primary={proposal ? { label: "Skapa underlaget", onClick: () => void createBasis(), busy: state.busy, busyLabel: "Skapar…", testId: "invoice-basis-create" }
      : blank ? { label: "Spara", onClick: () => void createBlank(), busy: state.busy, busyLabel: "Sparar…", testId: "invoice-basis-save" }
      : editable ? { label: "Spara", onClick: () => void state.save(), busy: state.busy, busyLabel: "Sparar…", disabledReason: state.dirty ? null : "Inget är ändrat.", testId: "invoice-basis-save" } : null} />;
  // Ny … som utkast (Lika är rätt, 2026-11-14): the empty basis from the list is saved by itself at its first change.
  const firstSave = <FirstChangeSave isNew={blank} dirty={state.dirty} ready={editable} busy={state.busy} change={draft} save={createBlank} />;

  if (native) {
    return <>
      {fortnoxDialog}{firstSave}
      <div className="space-y-1" data-testid="invoice-basis-native">
        <ListGroup>
          <ListFact label="Status" testId="invoice-basis-status">{statusText}</ListFact>
          {facts.map(([label, value]) => <ListFact key={label} label={label}>{value}</ListFact>)}
        </ListGroup>
        {proposal ? <p className="notice my-2 text-sm" data-testid="invoice-basis-proposal-note">{proposalNote}</p> : null}
        {basis.quoteNote ? <p className="notice my-2 text-sm" data-testid="invoice-basis-quote-note">{basis.quoteNote}</p> : null}
        {state.error ? <p role="alert" className="px-1 py-2 text-sm text-destructive">{state.error}</p> : null}
        <ListGroup title="Rader" testId="invoice-basis-native-lines">
          {editable && draft.lines.length < INVOICE_BASIS_MAX_LINES ? <>
            <ListRow type="quote" icon={Plus} title={ADD_LINE_LABELS.MATERIAL} onClick={() => addLine("MATERIAL")} chevron={false} testId="invoice-basis-native-add-material" />
            <ListRow type="time" icon={Plus} title={ADD_LINE_LABELS.LABOUR} onClick={() => addLine("LABOUR")} chevron={false} testId="invoice-basis-native-add-labour" />
            <ListRow type="neutral" icon={Plus} title={ADD_LINE_LABELS.OTHER} onClick={() => addLine("OTHER")} chevron={false} />
          </> : null}
          {draft.lines.length ? draft.lines.map((line) => {
            const amount = quoteLineNumbers(line).amount;
            return <ListRow key={line.id} title={line.name || "Utan benämning"} subtitle={`${QUOTE_LINE_KIND_LABELS[line.kind]} · ${invoiceLineSubtitle(line)}`} subtitleTone={amount === null ? "danger" : undefined}
              value={amount === null ? undefined : `${formatSek(amount)} kr`} onClick={editable ? () => onOpenLine(line.id, line) : undefined} testId="invoice-basis-native-line" twoLines />;
          }) : <ListEmpty>Underlaget har inga rader.</ListEmpty>}
        </ListGroup>
        <ListGroup title="Summa" footer={totals.unpriced ? `${unpricedText(totals.unpriced)} à-pris och ingår inte i summan.` : undefined} testId="invoice-basis-totals">
          {QUOTE_LINE_KINDS.filter((kind) => totals.byKind[kind]).map((kind) => <ListRow key={kind} title={QUOTE_LINE_KIND_LABELS[kind]} value={`${formatSek(totals.byKind[kind])} kr`} />)}
          <ListRow title="Summa exkl. moms" value={`${formatSek(totals.net)} kr`} testId="invoice-basis-net" />
          <ListRow title={draft.tax.reverseVat ? "Moms" : `Moms ${formatPrice(totals.vatPercent)} %`} value={draft.tax.reverseVat ? REVERSE_VAT_LABEL : `${formatSek(totals.vat)} kr`} />
          <ListRow title={draft.tax.reverseVat ? "Att betala" : "Att betala inkl. moms"} value={`${formatSek(totals.gross)} kr`} testId="invoice-basis-gross" />
          {rotOn ? <>
            <ListRow title={`Preliminärt ROT-avdrag${totals.rotCapped ? " (tak)" : ""}`} value={`-${formatSek(totals.rot)} kr`} testId="invoice-basis-rot" />
            <ListRow title="Att betala efter ROT-avdrag" value={`${formatSek(totals.toPay)} kr`} testId="invoice-basis-to-pay" />
          </> : null}
        </ListGroup>
        {editable ? <ListGroup title="Uppgifter"><div className="space-y-4 p-4" role="listitem">
          <BasisFields draft={draft} vatBad={vat === null} onChange={change} customerType={customerType} />
        </div></ListGroup> : basis.note ? <ListGroup title="Anteckning"><ListFact label="Bara för er">{basis.note}</ListFact></ListGroup> : null}
        {unsaved ? null : <NativeActions title="Hantering" footer={markReason || undefined} testId="invoice-basis-native-actions">
          {invoiceAction}{exportMenu}{markButton}{removeButton}
        </NativeActions>}
      </div>
      {actions}
    </>;
  }

  // The computer (Lika är rätt, 2026-11-14): the editor template of the offert – the shared header with every button top
  // right, Grunduppgifter (variant Affär) first, Rader as a card and Summa beside them.
  const headerFacts: EditorFact[] = [
    ...(basis.label ? [{ icon: Receipt, label: basis.label }] : []),
    ...(basis.customer ? [{ icon: Users, label: basis.customer.name }] : []),
    ...(basis.task ? [{ icon: ClipboardList, label: basis.task.title }] : basis.project ? [{ icon: FolderKanban, label: basis.project.name }] : []),
    { icon: Sigma, label: `${formatSek(totals.net)} kr exkl. moms`, keep: true },
  ];
  const customerNote = proposal ? (basis.task ? "Följer arbetsordern." : "Följer projektet.") : undefined;
  const basics = editable ? <SharedBasicsPanel description="Kund och plats står på fakturan. Anteckningen är bara för er." testId="invoice-basis-basics-panel">
    <DealBasicsFields idPrefix="invoice-basis"
      title={{ value: draft.title, testId: "invoice-basis-title", onChange: (value) => change({ title: value }) }}
      project={basis.projectLocked || proposal ? { value: draft.projectId, options: [], onChange: () => undefined, locked: { name: basis.project?.name ?? "Inget projekt", note: basis.task ? "Följer arbetsordern." : basis.project ? "Följer arbetet i underlaget." : undefined } }
        : { value: draft.projectId, options: projects, current: basis.project, testId: "invoice-basis-project",
          // A chosen project fills an empty customer and place (the chain, Lika är rätt).
          onChange: (id, project) => change({ projectId: id, ...customerFromProject({ customerId: draft.customerId, facilityId: draft.facilityId }, project) }) }}
      workOrder={basis.task}
      customer={{ customers, customerId: draft.customerId, facilityId: draft.facilityId, search: !proposal, locked: proposal, lockedNote: customerNote, label: "Kund", testId: "invoice-basis-customer", onChange: chooseCustomer }}
      description={{ label: "Anteckning (bara för er)", ariaLabel: "Anteckning", value: draft.note, maxLength: 2000, testId: "invoice-basis-note", onChange: (value) => change({ note: value }) }}>
      <TaxFields draft={draft} vatBad={vat === null} onChange={change} customerType={customerType} wide="md:col-span-2 xl:col-span-3" />
    </DealBasicsFields>
  </SharedBasicsPanel>
    : <SharedBasicsPanel testId="invoice-basis-basics-panel">
      <dl className="grid gap-x-6 gap-y-3 text-sm md:grid-cols-2 xl:grid-cols-3" data-testid="invoice-basis-basics">
        {([["Rubrik", basis.title], ...facts, ["Moms", draft.tax.reverseVat ? REVERSE_VAT_LABEL : `${formatPrice(basis.vatPercent)} %`], ["Anteckning (bara för er)", basis.note]] as [string, string][]).filter(([, value]) => value.trim()).map(([label, value]) =>
          <div key={label} className={cn("min-w-0", label.startsWith("Anteckning") && "md:col-span-2 xl:col-span-3")}><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{value}</dd></div>)}
      </dl>
    </SharedBasicsPanel>;
  return <>
    {fortnoxDialog}{firstSave}
    <EditorHeader title={title} pageHeading={false}
      detail={<span className={cn("inline-flex rounded-full border px-2.5 py-0.5 font-medium", indicatorBadge(statusTone(basis.status)))} data-testid="invoice-basis-status">{statusText}</span>}
      facts={headerFacts}
      // Högst fyra knappar (2026-11-14): Skapa faktura and Exportera open their own windows and stay; Ta bort moves under Mer first.
      destructiveAction={removeButton ? { key: "delete", node: removeButton, menu: { label: "Ta bort underlaget", icon: Trash2, disabled: state.busy, onSelect: () => void remove(), testId: "invoice-basis-delete" } } : undefined}
      actions={[
        invoiceAction ? { key: "invoice", node: invoiceAction } : null,
        exportMenu ? { key: "export", node: exportMenu } : null,
        markButton ? { key: "mark", keep: true, node: markButton, menu: { label: "Markera som fakturerat", icon: CheckCircle2, disabled: state.busy || Boolean(markReason), onSelect: () => void markInvoiced(), testId: "invoice-basis-mark" } } : null,
      ]}
      moreTestId="invoice-basis-more"
      primaryAction={actions}
      primaryReason={markShown && markReason ? `Markera som fakturerat: ${markReason}` : ""}
    />
    {proposal ? <p className="notice text-sm" data-testid="invoice-basis-proposal-note">{proposalNote}</p> : null}
    {basis.status === "INVOICED" ? <p className="notice text-sm" data-testid="invoice-basis-locked">Underlaget är fakturerat {invoiceDay(basis.invoicedAt)}{basis.invoicedByName ? ` av ${basis.invoicedByName}` : ""} och låst. Det som finns i det faktureras aldrig igen.</p> : null}
    {basis.quoteNote ? <p className="notice text-sm" data-testid="invoice-basis-quote-note">{basis.quoteNote}</p> : null}
    {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}

    <EditorAsideLayout testId="invoice-basis-layout" fit="table">
      {basics}
      <Panel icon={ListOrdered} title="Rader" description="Belopp exklusive moms. Påslaget räknas på à-priset.">
        {editable && draft.lines.length < INVOICE_BASIS_MAX_LINES ? <div className="flex flex-wrap gap-2" data-testid="invoice-basis-add">
          {/* The same words as the quote's buttons (2026-10-11): Lägg till material / arbete / övrigt. */}
          <Button type="button" onClick={() => setBrowsing(true)} data-testid="invoice-basis-add-articles"><Search />Lägg till artiklar</Button>
          <ArticleBrowserDialog open={browsing} onOpenChange={setBrowsing} onAdd={addArticle} onAdjust={adjustArticle} docWord="fakturaunderlaget" docName={basis.label ? `Fakturaunderlag ${basis.label}` : undefined} />
          {QUOTE_LINE_KINDS.map((kind) => <Button key={kind} type="button" variant="outline" onClick={() => addLine(kind)} data-testid={`invoice-basis-add-${kind.toLowerCase()}`}><Plus />{ADD_LINE_LABELS[kind]}</Button>)}
        </div> : null}
        <datalist id={unitListId}>{MATERIAL_UNIT_SUGGESTIONS.map((unit) => <option key={unit} value={unit} />)}</datalist>
        {/* The same table as the quote's lines (features/quotes/line-table.tsx): rows from a wide container, cards under that. */}
        {draft.lines.length ? <div className={cn(LINE_TABLE_BOX, editable && "mt-4")}><div role="table" aria-label="Fakturaunderlagets rader" className={LINE_TABLE_SHELL}>
          <LineTableHeader />
          {draft.lines.map((line) => editable
            ? <LineRow key={line.id} line={line} rot={rotOn} unitListId={unitListId} onPatch={(patch) => patchLine(line.id, patch)} onRemove={() => removeLine(line.id)} onEnterLast={() => addLine(line.kind)} />
            : <ReadLineRow key={line.id} line={line} rot={rotOn} />)}
        </div></div> : <p className={cn("text-sm text-muted-foreground", editable && "mt-3")}>Underlaget har inga rader.</p>}
      </Panel>
      <EditorAside label="Underlagets summa" testId="invoice-basis-aside"><Panel icon={Sigma} title="Summa" description="Beloppen visas exklusive och inklusive moms.">
        <dl className="grid w-full gap-y-1.5 text-sm" data-testid="invoice-basis-totals">
          {QUOTE_LINE_KINDS.filter((kind) => totals.byKind[kind]).map((kind) => <div key={kind} className="flex justify-between gap-3"><dt className="text-muted-foreground">{QUOTE_LINE_KIND_LABELS[kind]}</dt><dd className="tabular-nums">{formatSek(totals.byKind[kind])} kr</dd></div>)}
          <div className="flex justify-between gap-3 border-t pt-1.5"><dt>Summa exklusive moms</dt><dd className="tabular-nums" data-testid="invoice-basis-net">{formatSek(totals.net)} kr</dd></div>
          <div className="flex justify-between gap-3"><dt>{draft.tax.reverseVat ? "Moms" : `Moms ${formatPrice(totals.vatPercent)} %`}</dt><dd className="tabular-nums">{draft.tax.reverseVat ? REVERSE_VAT_LABEL : `${formatSek(totals.vat)} kr`}</dd></div>
          <div className={cn("flex justify-between gap-3", !rotOn && "font-semibold")}><dt>{draft.tax.reverseVat ? "Att betala" : rotOn ? "Summa inklusive moms" : "Att betala inklusive moms"}</dt><dd className="tabular-nums" data-testid="invoice-basis-gross">{formatSek(totals.gross)} kr</dd></div>
          {rotOn ? <>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Arbetskostnad inkl. moms (underlag)</dt><dd className="tabular-nums">{formatSek(totals.rotBaseInclVat)} kr</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Preliminärt ROT-avdrag{totals.rotCapped ? " (tak)" : ""}</dt><dd className="tabular-nums" data-testid="invoice-basis-rot">-{formatSek(totals.rot)} kr</dd></div>
            <div className="flex justify-between gap-3 border-t pt-1.5 font-semibold"><dt>Att betala efter ROT-avdrag</dt><dd className="tabular-nums" data-testid="invoice-basis-to-pay">{formatSek(totals.toPay)} kr</dd></div>
          </> : null}
          {draft.tax.reverseVat ? <p className="text-xs text-muted-foreground" data-testid="invoice-basis-reverse-vat">{REVERSE_VAT_TEXT}{draft.tax.buyerVatNumber ? ` Köparens momsreg.nr: ${draft.tax.buyerVatNumber}.` : ""}</p> : null}
          {totals.unpriced ? <p className="text-xs text-muted-foreground" data-testid="invoice-basis-unpriced">{unpricedText(totals.unpriced)} à-pris och ingår inte i summan. {`Markera som fakturerat${FORTNOX_CONNECTION_READY ? ", SIE och Fortnox" : " och SIE"} kräver pris på varje rad.`}</p> : null}
        </dl>
      </Panel></EditorAside>
    </EditorAsideLayout>
  </>;
}

/** Moms and Omvänd byggmoms or ROT: the basis's own fields in Grunduppgifter (labels above, help under). */
function TaxFields({ draft, vatBad, onChange, customerType, wide = "sm:col-span-2" }: { draft: Draft; vatBad: boolean; onChange: (patch: Partial<Draft>) => void; customerType: QuoteCustomerType; /** The classes that make the choices take the whole row. */ wide?: string }) {
  const tax = (patch: Partial<DraftTax>) => onChange({ tax: { ...draft.tax, ...patch } });
  return <>
    <label className={LINE_LABEL}>Moms (%)<Input inputMode="decimal" value={draft.vatPercent} disabled={draft.tax.reverseVat} aria-invalid={vatBad || undefined} onChange={(event) => onChange({ vatPercent: event.target.value })} data-testid="invoice-basis-vat" /></label>
    {/* Moms och ROT (2026-11-01), the same choices as on the quote; the customer's type decides which one is offered. */}
    {customerType === "COMPANY" ? <div className={cn("space-y-3", wide)}>
      <CheckField id="invoice-basis-reverse-vat" label="Omvänd byggmoms" description="Köparen redovisar momsen. Underlaget visar det." checked={draft.tax.reverseVat} onChange={(on) => onChange({ vatPercent: on ? "0" : String(QUOTE_VAT_PERCENT), tax: { ...draft.tax, reverseVat: on } })} testId="invoice-basis-reverse-vat-on" />
      {draft.tax.reverseVat ? <label className={LINE_LABEL}>Köparens momsregistreringsnummer<Input value={draft.tax.buyerVatNumber} maxLength={40} onChange={(event) => tax({ buyerVatNumber: event.target.value })} data-testid="invoice-basis-buyer-vat" /></label> : null}
    </div> : <div className={cn("space-y-3", wide)}>
      <CheckField id="invoice-basis-rot" label="ROT-avdrag på arbetskostnaden" checked={draft.tax.rotEnabled} testId="invoice-basis-rot-on"
        onChange={(on) => onChange({ tax: { ...draft.tax, rotEnabled: on }, lines: on && !draft.lines.some((line) => line.rotLabour) ? draft.lines.map((line) => line.kind === "LABOUR" ? { ...line, rotLabour: true } : line) : draft.lines })} />
      {draft.tax.rotEnabled ? <div className="grid gap-3 sm:grid-cols-2">
        <label className={LINE_LABEL}>ROT-andel (%)<Input inputMode="decimal" value={draft.tax.rotPercent} aria-invalid={parseShare(draft.tax.rotPercent) === null || undefined} onChange={(event) => tax({ rotPercent: event.target.value })} data-testid="invoice-basis-rot-percent" /></label>
        <label className={LINE_LABEL}>Tak för avdraget (kr)<Input inputMode="decimal" value={draft.tax.rotCap} aria-invalid={parseKronor(draft.tax.rotCap) === null || undefined} onChange={(event) => tax({ rotCap: event.target.value })} data-testid="invoice-basis-rot-cap" /></label>
        <p className="text-xs text-muted-foreground sm:col-span-2">Andel och tak är era egna. Ni ansvarar för att de stämmer för kunden. Markera arbetsraderna under Rader.</p>
      </div> : null}
    </div>}
  </>;
}

/** Level 1: Rubrik, Moms and the note in one group (the phone's screen of the basis). */
function BasisFields({ draft, vatBad, onChange, customerType }: { draft: Draft; vatBad: boolean; onChange: (patch: Partial<Draft>) => void; customerType: QuoteCustomerType }) {
  return <>
    <label className={LINE_LABEL}>Rubrik<Input value={draft.title} maxLength={200} onChange={(event) => onChange({ title: event.target.value })} data-testid="invoice-basis-title" /></label>
    <TaxFields draft={draft} vatBad={vatBad} onChange={onChange} customerType={customerType} />
    <label className={cn(LINE_LABEL, "sm:col-span-2")}>Anteckning (bara för er)
      <textarea className="form-textarea" value={draft.note} maxLength={2000} onChange={(event) => onChange({ note: event.target.value })} data-testid="invoice-basis-note" />
    </label>
  </>;
}

/** "3 h 4 min" under an Arbete line's hours: the job reports minutes, the line counts decimal hours (QA 2026-10-10). */
function HoursHint({ line, className }: { line: InvoiceBasisLine; className?: string }) {
  const text = invoiceLineHoursText(line);
  return text ? <span className={cn("block text-[0.6875rem] font-normal leading-4 text-muted-foreground", className)} data-testid="invoice-line-hours">{text}</span> : null;
}

/**
 * One line to change: a row of the shared table from a wide container (Typ, Art.nr, Benämning, Antal, Enhet, À-pris, Påslag,
 * Belopp, Ta bort), a small block with labels above the fields under that. A material line's Benämning searches the price
 * file as on the quote; Enter in Påslag adds a line of the same kind (2026-10-11).
 */
function LineRow({ line, rot, unitListId, onPatch, onRemove, onEnterLast }: {
  line: InvoiceBasisLine; rot: boolean; unitListId: string; onPatch: (patch: Partial<InvoiceBasisLine>) => void; onRemove: () => void; onEnterLast: () => void;
}) {
  const amount = quoteLineNumbers(line).amount;
  const bad = { quantity: Boolean(line.quantity.trim()) && parseAmount(line.quantity) === null, price: Boolean(line.unitPrice.trim()) && parseAmount(line.unitPrice) === null, markup: Boolean(line.markupPercent.trim()) && parsePercent(line.markupPercent) === null };
  const labour = line.kind === "LABOUR";
  const material = line.kind === "MATERIAL";
  const cell = (label: string, field: React.ReactNode, className?: string) => <label role="cell" className={cn(LINE_TABLE_LABEL, className)}><span className={LINE_TABLE_LABEL_TEXT}>{label}</span>{field}</label>;
  return <div role="row" data-line={line.id} data-testid="invoice-basis-line" className={cn(LINE_TABLE_GRID, LINE_TABLE_ROW, "grid grid-cols-2 items-end gap-x-3 gap-y-3 rounded-lg border bg-card p-3 sm:grid-cols-4")}>
    {cell("Typ", <select className="form-select @[50rem]:pl-2" value={line.kind} onChange={(event) => onPatch({ kind: event.target.value as QuoteLineKind })}>
      {QUOTE_LINE_KINDS.map((kind) => <option key={kind} value={kind}>{QUOTE_LINE_KIND_LABELS[kind]}</option>)}
    </select>)}
    {material || line.articleNo ? <div role="cell" className="contents"><ArticleNoField value={line.articleNo ?? ""} source={line.articleSource} manufacturer={line.manufacturerArticleNo}
      onChange={(articleNo) => onPatch({ articleNo, articleSource: "" })} testId="invoice-line-article-no" /></div>
      : <span aria-hidden="true" className="hidden @[50rem]:block" />}
    {material
      ? <div role="cell" className={cn(LINE_TABLE_LABEL, "col-span-2 sm:col-span-4 @[50rem]:col-span-1")}><span className={LINE_TABLE_LABEL_TEXT}>Benämning</span>
        <Input name="invoice-line-name" aria-label="Benämning" title={line.name} value={line.name} maxLength={300} placeholder="Benämning" onChange={(event) => onPatch({ name: event.target.value })} /></div>
      : cell("Benämning", <Input name="invoice-line-name" title={line.name} value={line.name} maxLength={300} onChange={(event) => onPatch({ name: event.target.value })} />, "col-span-2 sm:col-span-4 @[50rem]:col-span-1")}
    {cell(labour ? "Timmar" : "Antal", <><Input inputMode="decimal" className={LINE_TABLE_NARROW_INPUT} value={line.quantity} aria-invalid={bad.quantity || undefined} onChange={(event) => onPatch({ quantity: event.target.value })} data-testid="invoice-line-quantity" /><HoursHint line={line} className="@[50rem]:mt-0.5" /></>)}
    {cell("Enhet", <Input list={unitListId} autoComplete="off" className={LINE_TABLE_NARROW_INPUT} value={line.unit} maxLength={40} onChange={(event) => onPatch({ unit: event.target.value })} />)}
    {cell(labour ? "Timpris (kr)" : "À-pris (kr)", <span className="relative block"><Input inputMode="decimal" className={LINE_TABLE_NARROW_INPUT} value={line.unitPrice} aria-invalid={bad.price || undefined} onChange={(event) => onPatch({ unitPrice: event.target.value })} data-testid="invoice-line-price" /><PriceMark snapshot={line.catalogue} unitPrice={line.unitPrice} /></span>)}
    {cell("Påslag (%)", <Input inputMode="decimal" className={LINE_TABLE_NARROW_INPUT} value={line.markupPercent} aria-invalid={bad.markup || undefined} onChange={(event) => onPatch({ markupPercent: event.target.value })} onKeyDown={enterAddsLine(onEnterLast)} data-testid="invoice-line-markup" />)}
    <div role="cell" className={cn(LINE_TABLE_LABEL, "sm:col-span-3 sm:text-right @[50rem]:col-span-1")}><span className={LINE_TABLE_LABEL_TEXT}>Belopp</span>
      <p className="flex min-h-10 items-center text-sm tabular-nums sm:justify-end @[50rem]:justify-end" data-testid="invoice-line-amount">{amount === null ? <span className="font-normal text-muted-foreground">Inget pris</span> : <span className="truncate font-semibold text-foreground">{formatSek(amount)} kr</span>}</p>
    </div>
    <div role="cell" className="flex min-h-10 items-center justify-end">
      <RemoveButton label={`Ta bort raden ${line.name || ""}`.trim()} onClick={onRemove} data-testid="invoice-line-remove" />
    </div>
    {rot ? <label className="col-span-full flex min-h-8 items-center gap-2 text-xs text-muted-foreground @[50rem]:pt-1">
      <Checkbox checked={Boolean(line.rotLabour)} onCheckedChange={(checked) => onPatch({ rotLabour: checked === true })} data-testid="invoice-line-rot" />Arbetskostnad (ingår i ROT-underlaget)
    </label> : null}
  </div>;
}

/**
 * One line of a locked (invoiced) basis, or one the person may only read: the same columns as text that wraps, never
 * greyed-out fields where a long benämning is cut (QA 2026-10-10).
 */
function ReadLineRow({ line, rot }: { line: InvoiceBasisLine; rot: boolean }) {
  const amount = quoteLineNumbers(line).amount;
  const labour = line.kind === "LABOUR";
  const price = parseAmount(line.unitPrice);
  const cell = (label: string, value: React.ReactNode, className?: string) => <div role="cell" className={cn("min-w-0 text-sm", className)}>
    <span className="block text-xs font-medium text-muted-foreground @[50rem]:sr-only">{label}</span><span className="block [overflow-wrap:anywhere]">{value}</span>
  </div>;
  return <div role="row" data-line={line.id} data-testid="invoice-basis-line" className={cn(LINE_TABLE_GRID, LINE_TABLE_ROW, "grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border bg-card p-3 sm:grid-cols-4 @[50rem]:items-start @[50rem]:py-2.5")}>
    {cell("Typ", QUOTE_LINE_KIND_LABELS[line.kind])}
    {line.articleNo ? cell("Art.nr", <span data-testid="invoice-line-article-no-text">{line.articleNo}</span>) : <span aria-hidden="true" className="hidden @[50rem]:block" />}
    {cell("Benämning", <span className="font-medium" data-testid="invoice-line-name-text">{line.name || "Utan benämning"}{rot && line.rotLabour ? <span className="block text-xs font-normal text-muted-foreground">Arbetskostnad (ROT)</span> : null}</span>, "col-span-2 sm:col-span-4 @[50rem]:col-span-1")}
    {cell(labour ? "Timmar" : "Antal", <span className="tabular-nums">{line.quantity}<HoursHint line={line} /></span>)}
    {cell("Enhet", line.unit)}
    {cell(labour ? "Timpris (kr)" : "À-pris (kr)", <span className="tabular-nums">{price === null ? line.unitPrice || "–" : formatSek(price)}</span>)}
    {cell("Påslag (%)", <span className="tabular-nums">{line.markupPercent.trim() || "–"}</span>)}
    {cell("Belopp", <span className="font-semibold tabular-nums" data-testid="invoice-line-amount">{amount === null ? "Inget pris" : `${formatSek(amount)} kr`}</span>, "sm:col-span-2 sm:text-right @[50rem]:col-span-1")}
    <span aria-hidden="true" className="hidden @[50rem]:block" />
  </div>;
}

/** Level 1: one line as its own screen – labels above the fields, the amount, Ta bort raden; Avbryt/Spara in the top bar. */
function NativeLineScreen({ line, state, confirm, onCancel, onDone }: { line: InvoiceBasisLine; state: BasisState; confirm: Confirm; onCancel: () => void; onDone: () => void }) {
  const unitListId = useId();
  const amount = quoteLineNumbers(line).amount;
  const labour = line.kind === "LABOUR";
  // A proposal is not saved yet: the line's Klar and Ta bort only change the proposal, Skapa underlaget saves it.
  const proposal = Boolean(state.basis?.proposal);
  const defaults = state.basis?.priceDefaults ?? NO_DEFAULTS;
  const patch = (next: Partial<InvoiceBasisLine>) => state.setDraft((draft) => draft && ({ ...draft, lines: draft.lines.map((item) => item.id === line.id ? patchInvoiceLine(item, next, defaults) : item) }));
  const label = "block space-y-1.5 text-xs font-medium text-muted-foreground";
  const remove = async () => {
    if (invoiceLineHasContent(line, defaults) && !await confirm({ title: "Ta bort raden?", message: line.sources.length ? removeLineNote(proposal) : `${line.name.trim() || "Raden"} tas bort från underlaget.`, confirmLabel: "Ta bort", tone: "danger" })) return;
    const next = state.draft && { ...state.draft, lines: state.draft.lines.filter((item) => item.id !== line.id) };
    state.setDraft(next);
    if (proposal) { onDone(); return; }
    if (next && await state.save(next)) onDone();
  };
  return <>
    <div className="native-group space-y-4 p-4" data-line={line.id} data-testid="invoice-basis-native-line-form">
      <datalist id={unitListId}>{MATERIAL_UNIT_SUGGESTIONS.map((unit) => <option key={unit} value={unit} />)}</datalist>
      <label className={label}>Typ
        <span className="native-picker-field text-foreground">
          <span className="min-w-0 flex-1 truncate">{QUOTE_LINE_KIND_LABELS[line.kind]}</span>
          <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground/70" />
          <select aria-label="Typ" value={line.kind} onChange={(event) => patch({ kind: event.target.value as QuoteLineKind })}>
            {QUOTE_LINE_KINDS.map((kind) => <option key={kind} value={kind}>{QUOTE_LINE_KIND_LABELS[kind]}</option>)}
          </select>
        </span>
      </label>
      <label className={label}>Benämning<Input name="invoice-line-name" value={line.name} maxLength={300} onChange={(event) => patch({ name: event.target.value })} data-testid="invoice-line-name" /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className={label}>{labour ? "Timmar" : "Antal"}<Input inputMode="decimal" value={line.quantity} aria-invalid={(Boolean(line.quantity.trim()) && parseAmount(line.quantity) === null) || undefined} onChange={(event) => patch({ quantity: event.target.value })} data-testid="invoice-line-quantity" /><HoursHint line={line} /></label>
        <label className={label}>Enhet<Input list={unitListId} autoComplete="off" value={line.unit} maxLength={40} className={NO_LIST_ARROW} onChange={(event) => patch({ unit: event.target.value })} /></label>
        <label className={label}>{labour ? "Timpris (kr)" : "À-pris (kr)"}<span className="relative block"><Input inputMode="decimal" value={line.unitPrice} onChange={(event) => patch({ unitPrice: event.target.value })} data-testid="invoice-line-price" /><PriceMark snapshot={line.catalogue} unitPrice={line.unitPrice} /></span></label>
        <label className={label}>Påslag (%)<Input inputMode="decimal" value={line.markupPercent} onChange={(event) => patch({ markupPercent: event.target.value })} data-testid="invoice-line-markup" /></label>
      </div>
      <p className="flex items-baseline justify-between gap-3 border-t pt-3 text-[0.9375rem]"><span className="text-muted-foreground">Belopp exkl. moms</span>
        <span className="font-semibold tabular-nums" data-testid="invoice-line-amount">{amount === null ? "Inget pris" : `${formatSek(amount)} kr`}</span></p>
      {state.draft?.tax.rotEnabled ? <CheckField id={`invoice-line-rot-${line.id}`} label="Arbetskostnad (ingår i ROT-underlaget)" checked={Boolean(line.rotLabour)} onChange={(checked) => patch({ rotLabour: checked })} testId="invoice-line-rot" /> : null}
    </div>
    {state.error ? <p role="alert" className="px-1 py-2 text-sm text-destructive">{state.error}</p> : null}
    <NativeActions testId="invoice-basis-native-line-actions">
      <Button type="button" variant="ghost" className={DESTRUCTIVE} disabled={state.busy} onClick={() => void remove()} data-testid="invoice-line-remove"><Trash2 />Ta bort raden</Button>
    </NativeActions>
    <DialogActions cancel={{ onClick: onCancel }} primary={proposal ? { label: "Klar", onClick: onDone, testId: "invoice-line-save" }
      : { label: "Spara", busy: state.busy, busyLabel: "Sparar…", onClick: () => { void state.save().then((saved) => { if (saved) onDone(); }); }, testId: "invoice-line-save" }} />
  </>;
}
