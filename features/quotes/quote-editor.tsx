"use client";

import type { EditorMenuItem } from "@/components/editor-ribbon";
import { useModuleOn } from "@/features/workflow/use-modules";
import { useReturnTo } from "@/features/kfid/use-return-to";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRegisterEditorActions } from "@/components/workspace-actions";
import { BadgeCheck, CalendarClock, ChevronsUpDown, ClipboardList, Copy, FileDown, FileText, FolderKanban, Hammer, History, Info, ListOrdered, Lock, Mail, Package, PackageOpen, Search, Plus, Receipt, Save, Send, Sigma, Trash2, Users, XCircle, ScrollText, Undo2 } from "lucide-react";
import { isDenied, NoAccess } from "@/features/quotes/no-access";
import { CustomerLinkPanel, NativeCustomerLink, SendQuoteDialog, SendQuoteScreen } from "@/features/quotes/send-quote-dialog";
import { ListEmpty, ListFact, ListGroup, ListRow, NativeActions, NativeFlowBar, NativeLead, NativeMenuPage, NativePage, ShowMoreMarker, useNativeScreen, useNativeTopBar, type NativeTopBarConfig } from "@/components/native";
import { useNativeReduced } from "@/features/workflow/use-detail-level";
import { returnToWork, useLeavePage } from "@/components/history-nav";
import { leaveWithoutAsking } from "@/lib/workflow/leave-guard";
import { parseQuoteScreen, QUOTE_SCREEN_TITLE, quoteLineGroups, quoteLineSubtitle, type QuoteScreen } from "@/lib/quotes/native";
import { Checkbox } from "@/components/ui/checkbox";
import { taskHref } from "@/features/workflow/next-steps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WholesaleExport } from "@/features/wholesale/wholesale-export";
import { fromQuoteLines } from "@/lib/wholesale/sources";
import { api } from "@/features/kfid/api";
import { DISCARD_QUESTION, useConfirm } from "@/features/kfid/confirm";
import { CheckField, Panel } from "@/features/kfid/ui";
import type { CustomerItem, ProjectItem } from "@/features/kfid/types";
import { quoteFieldsFromProject, quoteTypeFromCustomer } from "@/lib/quotes/project-defaults";
import { DealBasicsFields, SharedBasicsPanel } from "@/features/workflow/shared-basics";
import { adoptCreated, editorKey, FirstChangeSave } from "@/lib/workflow/use-first-change-save";
import { EditorHeader, type EditorFact } from "@/features/workflow/editor-header";
import { PriceMark } from "@/features/workflow/catalogue-picker";
import { ArticleBrowserDialog, type ArticleAdd } from "@/features/catalogue/article-browser";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { quoteStatusTone } from "@/features/quotes/quote-status";
import { todayInSweden } from "@/lib/catalogue/snapshot";
import { formatPrice, formatSek, MATERIAL_UNIT_SUGGESTIONS, parseAmount } from "@/lib/workflow/expenses";
import { parsePercent } from "@/lib/workflow/material-prices";
import { useUnsavedGuard } from "@/lib/workflow/use-unsaved-guard";
import { announce } from "@/lib/workflow/toast";
import { useUndoRemove } from "@/features/kfid/use-undo-remove";
import { ArticleNoField, clearPriceWithUndo, ClearablePrice, enterAddsLine, LINE_TABLE_BOX, LINE_TABLE_GRID, LINE_TABLE_LABEL, LINE_TABLE_LABEL_TEXT, LINE_TABLE_NARROW_INPUT, LINE_TABLE_ROW, LINE_TABLE_SHELL, LineCells, LineTableHeader } from "@/features/quotes/line-table";
import { cn } from "@/lib/utils";
import { addDays, DEFAULT_QUOTE_VALID_DAYS, DEFAULT_ROT_CAP, DEFAULT_ROT_PERCENT, type PriceSettings } from "@/lib/quotes/settings";
import { PageHeader, STANDARD_PAGE_WIDTH, usePageTrail } from "@/components/page-shell";
import { EditorAside, EditorAsideLayout } from "@/components/editor-aside";
import { QuoteExportMenu } from "@/features/quotes/quote-export";
import { NativeQuoteWorkOrders, QuoteWorkOrdersPanel } from "@/features/quotes/quote-work-orders";
import { quotedWork } from "@/lib/quotes/conversion";
import { RowProduct } from "@/features/catalogue/product-info";
import { PurchaseChangedNotice, readPurchase, usePurchaseChanges, usePurchaseQuickPick } from "@/features/purchases/purchase-link";
import { purchaseRefsOf, quoteLinesFromPurchase, quoteSumLineFromPurchase, refreshQuoteLines, type QuoteLineFromPurchase } from "@/lib/purchases/model";
import {
  parseKronor, parseShare, quantityProblem, QUOTE_CUSTOMER_TYPE_LABELS, QUOTE_CUSTOMER_TYPES, QUOTE_LINE_DEFAULT_UNIT, QUOTE_LINE_KIND_LABELS, QUOTE_LINE_KINDS, QUOTE_STATUS_LABELS, QUOTE_VAT_PERCENT,
  quoteLineNumbers, quoteRotOf, quoteSendIssues, quoteTotals, quoteVersionDiff,
  type QuoteAction, type QuoteCustomerType, type QuoteLineKind, type QuoteLineView, type QuoteView,
  REVERSE_VAT_LABEL,
} from "@/lib/quotes/model";
import { RemoveButton } from "@/components/ui/remove-button";
import { DownloadButton } from "@/components/ui/download-button";
import { customerTitle } from "@/lib/kfid/customer-name";

/**
 * Offert (2026-10-09, steg B): one page for a quote, with the shared editor header (type, title, status, facts,
 * then the secondary buttons and Spara at the far right). A draft is written here: customer and place, project, valid
 * until, the scope, lines of Material, Arbete and Övrigt (benämning, antal, enhet, à-pris, påslag, belopp), the sums
 * with VAT 25 % shown separately, and the company's own terms. "Markera som skickad" locks the prices – the PDF is sent
 * to the customer by the person. "Skicka till kund" (steg E) mails the customer a link instead, where the quote is
 * accepted or declined without an account; the answer comes back as the status, a notice and the panel Skickad till kunden. A sent quote is read only; "Ny version" copies it
 * into a new draft with the same number. The server decides every action again.
 * Steg C + moms/ROT (2026-10-09): a new quote can start from a project's or a work order's material
 * (`?view=quote&projectId=…&from=project` or `&taskId=…&from=task`, or "Hämta projektets material" on a draft); an
 * accepted quote gets "Skapa arbetsorder" and "ÄTA" (a new version shown with its changes against the accepted one). The
 * quote has a customer type and its own VAT rate; a private person's quote may carry ROT on the lines marked as labour,
 * with the share and cap from the company's settings as editable defaults.
 */
type MaterialSource = { projectId?: string; taskId?: string };
type MaterialImport = { name: string; projectId: string | null; customerId: string | null; facilityId: string | null; lines: QuoteLineView[]; rows: number; mixedPrices: number };
type Draft = {
  title: string; description: string; customerId: string | null; facilityId: string | null; projectId: string | null; validUntil: string; terms: string; lines: QuoteLineView[];
  customerType: QuoteCustomerType; vatPercent: string; rotEnabled: boolean; rotPercent: string; rotCap: string;
  reverseVat: boolean; buyerVatNumber: string;
};
const emptyDraft = (settings: PriceSettings | null, today: string, projectId: string | null, customerId: string | null): Draft => ({
  title: "", description: "", customerId, facilityId: null, projectId, validUntil: addDays(today, settings?.validDays ?? DEFAULT_QUOTE_VALID_DAYS), terms: settings?.terms ?? "", lines: [],
  customerType: "COMPANY", vatPercent: String(QUOTE_VAT_PERCENT), rotEnabled: false, rotPercent: settings?.rotPercent ?? DEFAULT_ROT_PERCENT, rotCap: settings?.rotCap ?? DEFAULT_ROT_CAP,
  reverseVat: false, buyerVatNumber: "",
});
const draftOf = (quote: QuoteView, settings: PriceSettings | null): Draft => ({
  title: quote.title, description: quote.description, customerId: quote.customer?.id ?? null, facilityId: quote.facility?.id ?? null, projectId: quote.project?.id ?? null,
  validUntil: quote.validUntil, terms: quote.terms, lines: quote.lines,
  customerType: quote.customerType ?? "COMPANY", vatPercent: formatPrice(quote.vatPercent), rotEnabled: quote.rotEnabled ?? false,
  rotPercent: quote.rotPercent !== null && quote.rotPercent !== undefined ? formatPrice(quote.rotPercent) : settings?.rotPercent ?? DEFAULT_ROT_PERCENT,
  rotCap: quote.rotCap !== null && quote.rotCap !== undefined ? formatPrice(quote.rotCap) : settings?.rotCap ?? DEFAULT_ROT_CAP,
  reverseVat: quote.reverseVat ?? false, buyerVatNumber: quote.buyerVatNumber ?? "",
});
const materialUrl = (source: MaterialSource) => `/api/quotes?part=materials&${source.taskId ? `taskId=${encodeURIComponent(source.taskId)}` : `projectId=${encodeURIComponent(source.projectId ?? "")}`}`;
const importedText = (result: MaterialImport) => `${result.lines.length} ${result.lines.length === 1 ? "rad" : "rader"} från ${result.rows} materialrader i ${result.name || "materiallistan"}.${result.mixedPrices ? ` ${result.mixedPrices} ${result.mixedPrices === 1 ? "rad hade" : "rader hade"} olika à-pris – det senaste används.` : ""} Kontrollera antal och priser och spara.`;
/** What the server gets: the draft as typed; empty lines without a name are left out. */
/** A quote line made from a purchase (Inköp → offert, 2026-10-16), with an id of its own on the page. */
const lineFromPurchase = (line: QuoteLineFromPurchase): QuoteLineView => ({ id: crypto.randomUUID(), ...line } as QuoteLineView);
// A new row starts with antal 1 (decision 1), so a row never filled in (antal still "1", nothing else) is left out like an empty one.
const payloadOf = (draft: Draft) => ({ ...draft, lines: draft.lines.filter((line) => line.name.trim() || line.unitPrice.trim() || (line.quantity.trim() && line.quantity.trim() !== "1")).map((line) => ({ ...line, id: undefined })) });
/** The first row that would be refused for its antal (decision 1), with the text; rows left out of the payload are not checked. */
const quantityIssueOf = (draft: Draft) => {
  for (const line of payloadOf(draft).lines) {
    const problem = quantityProblem(line.quantity);
    if (problem) { const source = draft.lines.find((item) => item.name === line.name && item.quantity === line.quantity); return { id: source?.id, text: `${problem} Se raden ”${line.name.trim() || "utan benämning"}”.` }; }
  }
  return null;
};

const STATUS_QUESTION: Record<"accept" | "decline" | "expire", { title: string; message: string; confirm: string }> = {
  accept: { title: "Markera som accepterad?", message: "Offerten går då inte att ta bort. Ändringar och tillägg görs som ÄTA.", confirm: "Markera som accepterad" },
  decline: { title: "Markera som avböjd?", message: "Offerten avslutas och kan inte ändras. Du kan göra en ny version.", confirm: "Markera som avböjd" },
  expire: { title: "Markera som utgången?", message: "Offerten avslutas och kan inte ändras. Du kan göra en ny version.", confirm: "Markera som utgången" },
};
const ACTION_DONE: Record<"send" | "accept" | "decline" | "expire", string> = { send: "Offerten är skickad och låst.", accept: "Offerten är accepterad och låst.", decline: "Offerten är avböjd och låst.", expire: "Offerten är utgången och låst." };

export function QuoteEditor({ quoteId, projectId, customerId, customers, projects, source, adoptKey = "new" }: { quoteId?: string; projectId?: string; customerId?: string; customers: CustomerItem[]; projects: ProjectItem[]; source?: MaterialSource; /** The key of this editor while new, kept by the quote it creates. */ adoptKey?: string }) {
  const router = useRouter();
  const [confirm, confirmCard] = useConfirm();
  const today = todayInSweden();
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [settings, setSettings] = useState<PriceSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  // Nivå 1 på mobil: the draft as last read or saved, which Avbryt on a screen puts back.
  const [saved, setSaved] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  // The opened offer names its breadcrumb as its heading does (Översikt › Offerter › <offer>), not "Offert" (resor 2026-11-03).
  usePageTrail({ quote: quote?.title.trim() || undefined });
  const [imported, setImported] = useState("");
  // Offert per e-post (steg E): the dialog, and the test link a loopback test instance returns instead of mailing it.
  const [sendOpen, setSendOpen] = useState(false);
  // Lägg till artiklar (2026-10-16): the shared article search over the quote.
  const [browsing, setBrowsing] = useState(false);
  // Företagets moduler (0.39.0): with Inköp och artiklar off a quote line is plain text.
  const articlesOn = useModuleOn("purchasing");
  const [testUrl, setTestUrl] = useState("");
  const focusLine = useRef<string | null>(null);
  const unitListId = "quote-unit-suggestions";
  // Nivå 1 på mobil (2026-10-10): the quote as a menu of rows; each row opens a screen of its own (`&step=`).
  const { native, step } = useNativeScreen();
  // Export is office work: on a phone it is a group of the quote's menu with Visa mer (A2).
  const reduced = useNativeReduced();
  const params = useSearchParams();
  // Inköp → offert (2026-10-16): ?purchaseId=&purchaseMode=sum adds the purchase's lines, or its sum on one line, to the
  // draft once (a new quote, or a draft); nothing is saved until the person saves.
  const [fromPurchase] = useState(() => params.get("purchaseId") ? { id: params.get("purchaseId")!, sum: params.get("purchaseMode") === "sum" } : null);
  const purchaseApplied = useRef(false);
  const sendForm = useRef<HTMLFormElement | null>(null);
  // Kundtyp från kunden (2026-10-10): a new quote that starts with a customer (from the customer card, a project
  // or a material list) takes the customer's type as soon as the customer list holds it – once, so a change stays.
  const [typeFrom, setTypeFrom] = useState<string | null>(null);

  const sourceProject = source?.projectId, sourceTask = source?.taskId;
  // Ny … som utkast (2026-11-14): the quote this editor just created, and what was sent; the draft typed meanwhile stays.
  const adopting = useRef<{ id: string; sent: string } | null>(null);
  const draftLatest = useRef<Draft | null>(null);
  useEffect(() => { draftLatest.current = draft; });
  // Read when a new quote starts, without reloading the quote each time the list of projects is redrawn.
  const projectsRef = useRef(projects);
  useEffect(() => { projectsRef.current = projects; }, [projects]);
  const load = useCallback(async () => {
    try {
      const [loaded, priceSettings] = await Promise.all([
        quoteId ? api<{ quote: QuoteView }>(`/api/quotes?id=${encodeURIComponent(quoteId)}`, { cache: "no-store" }).then((result) => result.quote)
          // A new quote asks the list once whether the person may make quotes at all (no silent opening of an editor that refuses at Spara).
          : api<{ canEdit: boolean }>("/api/quotes?filter=open&page=1&mine=1", { cache: "no-store" }).then((result) => { if (!result.canEdit) throw Object.assign(new Error("Du saknar behörighet att ändra offerter."), { status: 403 }); return null; }),
        api<{ settings: PriceSettings }>("/api/quotes?part=settings", { cache: "no-store" }).then((result) => result.settings).catch(() => null),
      ]);
      setSettings(priceSettings);
      setQuote(loaded);
      const kept = adopting.current && adopting.current.id === quoteId && draftLatest.current ? adopting.current : null;
      adopting.current = null;
      if (kept && loaded && draftLatest.current) {
        setSaved(draftOf(loaded, priceSettings));
        setDirty(JSON.stringify(draftLatest.current) !== kept.sent);
        setError("");
        return;
      }
      let next = loaded ? draftOf(loaded, priceSettings) : emptyDraft(priceSettings, todayInSweden(), projectId ?? null, customerId ?? null);
      // Ny offert from a project's page starts with what the project knows (customer, place, heading, scope).
      const startProject = !loaded && projectId ? projectsRef.current.find((item) => item.id === projectId) : undefined;
      if (startProject) next = { ...next, ...quoteFieldsFromProject(next, startProject) };
      let fromMaterial = false;
      // Materiallista → offert (steg C): a new quote from a project's or a work order's material rows, not saved until the person saves.
      if (!loaded && (sourceProject || sourceTask)) {
        const result = await api<MaterialImport>(materialUrl({ projectId: sourceProject, taskId: sourceTask }), { cache: "no-store" });
        next = { ...next, title: result.name ? `Material – ${result.name}`.slice(0, 200) : "", projectId: result.projectId, customerId: result.customerId ?? next.customerId, facilityId: result.facilityId, lines: result.lines };
        setImported(importedText(result));
        fromMaterial = true;
      }
      if (fromPurchase && !purchaseApplied.current && (!loaded || loaded.actions.includes("edit"))) {
        purchaseApplied.current = true;
        const { purchase, markupPercent } = await readPurchase(fromPurchase.id);
        const markup = priceSettings?.markupPercent ?? markupPercent;
        const made = fromPurchase.sum ? [quoteSumLineFromPurchase(purchase, markup)] : quoteLinesFromPurchase(purchase, markup);
        next = { ...next, ...(!loaded && !next.title.trim() ? { title: purchase.title.slice(0, 200) } : {}), ...(!loaded && !next.projectId && purchase.project ? { projectId: purchase.project.id } : {}),
          ...(!loaded && !next.customerId && purchase.customer ? { customerId: purchase.customer.id } : {}), lines: [...next.lines, ...made.map(lineFromPurchase)] };
        setImported(fromPurchase.sum ? `Inköp ${purchase.label} är tillagt som en rad med summan. Kontrollera påslaget och spara.` : `${made.length} ${made.length === 1 ? "rad" : "rader"} från inköp ${purchase.label}. Kontrollera påslagen och spara.`);
        fromMaterial = true;
      }
      setDraft(next);
      setSaved(next);
      setDirty(fromMaterial);
      setTypeFrom(!loaded && next.customerId ? next.customerId : null);
      setError("");
    } catch (cause) { if (isDenied(cause)) setDenied(true); setError((cause as Error).message); }
  }, [quoteId, projectId, customerId, sourceProject, sourceTask, fromPurchase]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the quote is read when the page opens or changes quote
  useEffect(() => { void load(); }, [load]);
  // A new quote not yet created: the browser's and the phone's Bakåt ask too (2026-10-13).
  const releaseBack = useUnsavedGuard(dirty, confirm, undefined, { browserBack: !quoteId });
  const leavePage = useLeavePage();
  // Samband (2026-10-26): a quote opened from a work order or a project leads back there; a new one has Avbryt on a computer too.
  const way = useReturnTo();
  // Level 1: the quote as a screen was opened (a new, still empty line included), so Avbryt asks only about what the
  // person changed on this screen (2026-10-13).
  const screenKey = native ? `${step ?? ""}|${params.get("line") ?? ""}` : "";
  const screenStart = useRef<string | null>(null);
  const draftNow = useRef(draft);
  useEffect(() => { draftNow.current = draft; });
  useEffect(() => { screenStart.current = JSON.stringify(draftNow.current); }, [screenKey]);
  // Ångra (2026-10-11): a removed line is put back, in its place and with everything it held, from the toast or Ctrl/Cmd+Z.
  const undoRemove = useUndoRemove<QuoteLineView>((update) => { setDraft((current) => current && { ...current, lines: update(current.lines) }); setDirty(true); });
  useEffect(() => {
    if (!focusLine.current) return;
    const field = document.querySelector<HTMLInputElement>(`[data-line="${focusLine.current}"] input[name="quote-line-name"]`);
    focusLine.current = null;
    field?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    field?.focus();
  });

  // Adjusted while rendering (React's "adjust state when a value changes"): the customer list may arrive after the quote.
  if (draft && typeFrom) {
    const startCustomer = customers.find((item) => item.id === typeFrom);
    if (startCustomer) {
      setTypeFrom(null);
      if (draft.customerId === typeFrom) {
        const typed = { ...draft, ...quoteTypeFromCustomer(draft, startCustomer) };
        setDraft(typed);
        if (!dirty) setSaved(typed);
      }
    }
  }
  // Inköp (2026-10-16): lines picked into a purchase before 2026-10-26 follow it on save, and "Inköpet har ändrats" for lines
  // taken from a purchase. No new question is asked here (2026-10-26).
  const quoteEditable = quote ? quote.actions.includes("edit") : true;
  const quickPick = usePurchaseQuickPick({ disabled: !quoteEditable, kind: "quote", documentId: quote?.id ?? null, projectId: draft?.projectId ?? null, title: draft?.title ?? "" });
  const purchaseChanges = usePurchaseChanges(purchaseRefsOf((draft?.lines ?? []).filter((line) => !line.purchaseRef?.origin)), Boolean(quote) && quoteEditable);
  // The bottom bar's Spara on phone and tablet (Editor mode) presses the page's own Spara (2026-10-10: it stayed grey); the
  // floating navigation (2026-10-27) presses the same Spara, the header's Avbryt and its "Tillbaka till …".
  const pressQuote = (testId: string) => document.querySelector<HTMLButtonElement>(`[data-testid=${testId}]`)?.click();
  useRegisterEditorActions({ save: () => pressQuote("quote-save"), canSave: Boolean(draft) && (quote ? quote.actions.includes("edit") && dirty : true), busy, dirty,
    cancel: draft && !quote ? () => pressQuote("quote-new-cancel") : undefined,
    back: quote && way ? { label: way.label, run: () => pressQuote("return-to-origin") } : undefined });
  if (denied) return <div className="space-y-4"><PageHeader className="mb-0" title="Offert" /><NoAccess /></div>;
  if (error && !draft) return <div className="space-y-4"><PageHeader className="mb-0" title="Offert" /><p role="alert" className="notice text-destructive">{error}</p></div>;
  if (!draft) return <p role="status" className="text-sm text-muted-foreground">Hämtar offerten…</p>;

  const editable = quote ? quote.actions.includes("edit") : true;
  const can = (action: QuoteAction) => Boolean(quote?.actions.includes(action));
  const vatPercent = parseShare(draft.vatPercent);
  const rot = quoteRotOf(draft);
  const rotOn = draft.customerType === "PRIVATE" && draft.rotEnabled;
  const totals = quoteTotals(draft.lines, vatPercent ?? QUOTE_VAT_PERCENT, rot);
  // ÄTA: the changes against the accepted version, live while the draft is written.
  const ataChange = quote?.changeBase ? quoteVersionDiff(quote.changeBase, draft.lines) : quote?.change ?? null;
  // Omvänd byggmoms is for a company only: a customer or Kundtyp that makes the quote a private person's takes it away, and the VAT comes back.
  const change = (patch: Partial<Draft>) => { const next = { ...draft, ...patch }; setDraft(next.customerType === "PRIVATE" && next.reverseVat ? { ...next, reverseVat: false, vatPercent: String(QUOTE_VAT_PERCENT) } : next); setDirty(true); };
  // Functional, so an Ångra or a justerare that comes later never writes back an older copy of the draft.
  const patchLine = (id: string, patch: Partial<QuoteLineView>) => { setDraft((current) => current && { ...current, lines: current.lines.map((line) => line.id === id ? { ...line, ...patch } : line) }); setDirty(true); };
  // Ta bort raden goes at once, with or without content; Ångra in the toast (or Ctrl/Cmd+Z) puts it back (2026-10-11, replaces the question).
  const removeDraftLine = (id: string) => undoRemove(draft.lines, id);
  // Grossistexport (2026-10-12): the Material lines to a wholesaler; what is entered for a line is saved on it while the quote is a draft.
  const wholesaleSource = fromQuoteLines(draft.lines);
  const wholesaleButton = (variant: "outline" | "ghost") => <WholesaleExport source={wholesaleSource} label={quote ? `Offert ${quote.label}` : "Offert"} variant={variant} testId="quote-wholesale"
    onSaveRow={editable ? (id, wholesale) => patchLine(id, { wholesale }) : undefined} />;
  const addLine = (kind: QuoteLineKind): string => {
    const id = crypto.randomUUID();
    focusLine.current = id;
    change({ lines: [...draft.lines, { id, kind, name: kind === "LABOUR" ? "Arbete" : "", quantity: "1", unit: QUOTE_LINE_DEFAULT_UNIT[kind], unitPrice: kind === "LABOUR" ? settings?.hourlyRate ?? "" : "", markupPercent: kind === "MATERIAL" ? settings?.markupPercent ?? "" : "", ...(kind === "LABOUR" && rotOn ? { rotLabour: true } : {}) }] });
    return id;
  };
  /**
   * Lägg till artiklar (2026-10-16): each article added in the shared search becomes a new Material line. Samband
   * (2026-10-26, as from the work order): the search only puts the article on the quote – no question about a purchase
   * (a purchase is made under Inköp, or from the quote's rows with Till grossist).
   */
  const addArticle = ({ row }: ArticleAdd) => {
    const line: QuoteLineView = { id: crypto.randomUUID(), kind: "MATERIAL", name: row.name, quantity: row.quantity || "1", unit: row.unit, unitPrice: row.unitPrice ?? "",
      markupPercent: settings?.markupPercent ?? "", rotLabour: false, ...(row.catalogue ? { catalogue: row.catalogue } : {}), articleNo: row.articleNo ?? "", articleSource: row.articleSource ?? "",
      manufacturerArticleNo: row.manufacturerArticleNo ?? "", ...(row.wholesale ? { wholesale: row.wholesale } : {}), ...(row.product ? { product: row.product } : {}) } as QuoteLineView;
    setDraft((current) => current && { ...current, lines: [...current.lines, line] });
    setDirty(true);
    return line.id;
  };
  /** The justerare on a search card (decision 13): the added row's antal, or the row taken away at 0. */
  const adjustArticle = (rowId: string, quantity: string | null) => {
    if (quantity === null) setDraft((current) => current && { ...current, lines: current.lines.filter((item) => item.id !== rowId) });
    else patchLine(rowId, { quantity });
    setDirty(true);
  };
  /** Uppdatera offerten: the purchase's lines (or sum) as they are now replace those taken from it; markups stay. */
  const refreshFromPurchase = async (purchaseId: string) => {
    setBusy(true);
    try {
      const { purchase, markupPercent } = await readPurchase(purchaseId);
      change({ lines: refreshQuoteLines(draft.lines, purchase, settings?.markupPercent ?? markupPercent, lineFromPurchase) });
      announce(`Raderna från inköp ${purchase.label} är uppdaterade. Kontrollera och spara.`);
    } catch (cause) { announce((cause as Error).message, true); } finally { setBusy(false); }
  };

  /** "Hämta projektets material": the project's material rows are added last as new lines. */
  const importMaterials = async () => {
    if (!draft.projectId) return;
    setBusy(true);
    try {
      const result = await api<MaterialImport>(materialUrl({ projectId: draft.projectId }), { cache: "no-store" });
      if (!result.lines.length) { announce("Projektets arbetsordrar har inget material än."); return; }
      change({ lines: [...draft.lines, ...result.lines] });
      setImported(importedText(result));
    } catch (cause) { announce((cause as Error).message, true); } finally { setBusy(false); }
  };
  /** ROT on or off: switching it on marks the Arbete lines as labour and fills in the company's share and cap if empty. */
  const toggleRot = (on: boolean) => change({
    rotEnabled: on,
    rotPercent: draft.rotPercent || settings?.rotPercent || DEFAULT_ROT_PERCENT, rotCap: draft.rotCap || settings?.rotCap || DEFAULT_ROT_CAP,
    lines: on && !draft.lines.some((line) => line.rotLabour) ? draft.lines.map((line) => line.kind === "LABOUR" ? { ...line, rotLabour: true } : line) : draft.lines,
  });
  /** Accepterad offert → arbetsorder (steg C): the quote's material becomes the new work order's material. */
  const createWorkOrder = async () => {
    if (!quote) return;
    const materialCount = quote.lines.filter((line) => line.kind === "MATERIAL").length;
    const otherCount = quote.lines.filter((line) => line.kind === "OTHER").length;
    const work = quotedWork(quote.lines);
    const carried = [
      `${materialCount} ${materialCount === 1 ? "materialrad" : "materialrader"}`,
      ...(work.lines.length ? [work.minutes !== null ? `arbetet som uppskattad tid, ${formatPrice(work.minutes / 60)} h` : "arbetet som text i beskrivningen"] : []),
      ...(otherCount ? [`${otherCount} ${otherCount === 1 ? "övrig rad" : "övriga rader"} som utgifter`] : []),
    ];
    if (!await confirm({
      title: "Skapa arbetsorder från offerten?",
      message: `${quote.workOrder ? `Offerten har redan arbetsordern ${quote.workOrder.title}. ` : ""}En ny arbetsorder skapas med ${carried.join(", ")}.`,
      confirmLabel: "Skapa arbetsorder",
    })) return;
    setBusy(true);
    try {
      const created = await api<{ id: string }>("/api/quotes", { method: "POST", body: JSON.stringify({ action: "work_order", id: quote.id }) });
      announce("Arbetsordern är skapad från offerten.");
      router.push(taskHref({ id: created.id, kind: "WORK_ORDER" }));
    } catch (cause) { announce((cause as Error).message, true); } finally { setBusy(false); }
  };

  /** Saves the draft; returns the quote's id, or null when it could not be saved. */
  const save = async (override?: Draft, quiet = false): Promise<string | null> => {
    const current = override ?? draft;
    // A row with antal 0, below 0 or no number is pointed out before anything is sent (decisions 1; ART-06, ART-16).
    const issue = quantityIssueOf(current);
    if (issue) {
      announce(issue.text, true);
      if (issue.id) window.setTimeout(() => { const field = document.querySelector<HTMLInputElement>(`[data-line="${issue.id}"] input[aria-label="Antal"], [data-line="${issue.id}"] [data-testid="native-quote-line-quantity"]`); field?.scrollIntoView({ block: "center", behavior: "smooth" }); field?.focus(); }, 0);
      return null;
    }
    setBusy(true);
    try {
      if (!quote) {
        // Off the browser-back entry first, so the created quote takes the form's own entry in the history.
        await releaseBack();
        const created = await api<{ id: string }>("/api/quotes", { method: "POST", body: JSON.stringify({ action: "create", quote: payloadOf(current) }) });
        void quickPick.syncAfterSave(created.id, current.lines);
        setDirty(false);
        if (!quiet) announce("Offerten är sparad.");
        adoptCreated(created.id, adoptKey);
        adopting.current = { id: created.id, sent: JSON.stringify(current) };
        const createdHref = `/?view=quote&quoteId=${encodeURIComponent(created.id)}`;
        router.replace(way ? way.pass(createdHref) : createdHref);
        return created.id;
      }
      await api("/api/quotes", { method: "POST", body: JSON.stringify({ action: "save", id: quote.id, revision: quote.revision, quote: payloadOf(current) }) });
      void quickPick.syncAfterSave(quote.id, current.lines);
      if (!quiet) announce("Offerten är sparad.");
      await load();
      return quote.id;
    } catch (cause) {
      announce((cause as Error).message, true);
      return null;
    } finally { setBusy(false); }
  };
  const changeStatus = async (to: "send" | "accept" | "decline" | "expire") => {
    if (!quote) return;
    if (to === "send") {
      const issues = quoteSendIssues(draft, today);
      if (issues.length) { announce(issues.join(" "), true); return; }
      if (!await confirm({ title: "Markera offerten som skickad?", message: "Priserna och raderna låses. Skicka PDF:en till kunden själv. Ändringar görs sedan som en ny version.", confirmLabel: "Markera som skickad" })) return;
      if (dirty && !await save(undefined, true)) return;
    } else {
      // Accepterad, Avböjd and Utgången cannot be taken back: say what happens first (decision 7).
      const ask = STATUS_QUESTION[to];
      if (!await confirm({ title: ask.title, message: ask.message, confirmLabel: ask.confirm })) return;
    }
    setBusy(true);
    try {
      const fresh = dirty ? null : quote;
      const revision = fresh?.revision ?? (await api<{ quote: QuoteView }>(`/api/quotes?id=${encodeURIComponent(quote.id)}`, { cache: "no-store" })).quote.revision;
      await api("/api/quotes", { method: "POST", body: JSON.stringify({ action: "status", id: quote.id, revision, to }) });
      announce(ACTION_DONE[to]);
      await load();
    } catch (cause) { announce((cause as Error).message, true); } finally { setBusy(false); }
  };
  /**
   * Skicka till kund (steg E): a draft is checked and saved first, then sent with the link (the server locks it); a sent
   * quote gets a new link. The server decides again and mails it.
   */
  const openSendToCustomer = () => {
    if (!quote) return;
    if (quote.storedStatus === "DRAFT") {
      const issues = quoteSendIssues(draft, today);
      if (issues.length) { announce(issues.join(" "), true); return; }
    }
    setSendOpen(true);
  };
  const sendToCustomer = async (input: { email: string; message: string }): Promise<boolean> => {
    if (!quote) return false;
    if (dirty && !await save()) return false;
    setBusy(true);
    try {
      const revision = quote.storedStatus === "DRAFT" ? (await api<{ quote: QuoteView }>(`/api/quotes?id=${encodeURIComponent(quote.id)}`, { cache: "no-store" })).quote.revision : undefined;
      const result = await api<{ email: string; testUrl?: string; demo?: boolean }>("/api/quotes", { method: "POST", body: JSON.stringify({ action: "send_link", id: quote.id, revision, ...input }) });
      setSendOpen(false);
      setTestUrl(result.testUrl ?? "");
      announce(result.testUrl ? "Länken är skapad. E-post skickas aldrig från en lokal testinstans – testlänken visas under Skickad till kunden."
        : result.demo ? "I demon skickas ingen e-post. Prova kundens svar under Skickad till kunden." : `Offerten är skickad till ${result.email}.`);
      await load();
      return true;
    } catch (cause) { announce((cause as Error).message, true); return false; } finally { setBusy(false); }
  };
  /** The demo only: the customer's answer, simulated (no e-mail, no customer page in the demo). */
  const demoAnswer = async (decision: "ACCEPTED" | "DECLINED") => {
    if (!quote) return;
    setBusy(true);
    try {
      await api("/api/quotes", { method: "POST", body: JSON.stringify({ action: "demo_answer", id: quote.id, decision }) });
      announce(decision === "ACCEPTED" ? `Kunden har accepterat offerten ”${quote.title}”.` : `Kunden har avböjt offerten ”${quote.title}”.`);
      await load();
    } catch (cause) { announce((cause as Error).message, true); } finally { setBusy(false); }
  };
  const newVersion = async () => {
    if (!quote) return;
    setBusy(true);
    try {
      const created = await api<{ id: string }>("/api/quotes", { method: "POST", body: JSON.stringify({ action: "new_version", id: quote.id }) });
      announce(quote.status === "ACCEPTED" ? `ÄTA är skapad som version ${quote.version + 1}. Den accepterade versionen finns kvar oförändrad.` : `Version ${quote.version + 1} är skapad som utkast. Den tidigare versionen finns kvar oförändrad.`);
      router.push(`/?view=quote&quoteId=${encodeURIComponent(created.id)}`);
    } catch (cause) { announce((cause as Error).message, true); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!quote || !await confirm({ title: "Ta bort utkastet?", message: `${quote.label} tas bort. Det går inte att ångra.`, confirmLabel: "Ta bort", tone: "danger" })) return;
    setBusy(true);
    try {
      await api("/api/quotes", { method: "POST", body: JSON.stringify({ action: "delete", id: quote.id }) });
      setDirty(false);
      announce("Utkastet är borttaget.");
      router.push("/?view=quotes");
    } catch (cause) { announce((cause as Error).message, true); } finally { setBusy(false); }
  };
  const openPdf = async () => {
    // The demo has no server: the PDF is not made there, like the other reports (features/demo).
    if ((window as typeof window & { __workflowDemo?: boolean }).__workflowDemo) { announce("Rapporter och filer skapas inte i demon. I Workflow öppnas offerten som PDF."); return; }
    const id = dirty || !quote ? await save() : quote.id;
    if (id) window.open(`/api/quotes/${encodeURIComponent(id)}/pdf?inline=1`, "_blank", "noopener");
  };

  const status = quote?.status ?? "DRAFT";
  const facts: EditorFact[] = [
    ...(quote ? [{ icon: FileText, label: quote.label }] : []),
    { icon: Users, label: customerTitle(customers.find((customer) => customer.id === draft.customerId)) || quote?.customer?.name || "Ingen kund" },
    { icon: CalendarClock, label: draft.validUntil ? `Giltig till ${draft.validUntil}` : "Ingen giltighetstid", keep: true },
    { icon: Package, label: draft.customerType === "PRIVATE" ? `${formatSek(totals.toPay)} kr inkl. moms${totals.rot ? " efter ROT" : ""}` : `${formatSek(totals.net)} kr exkl. moms` },
    ...(quote?.changeOfVersion ? [{ icon: Copy, label: `ÄTA till version ${quote.changeOfVersion}` }] : []),
    // Every work order made from the quote (plan 1D): one named, several counted; the panel lists them all.
    ...(quote?.workOrders.length ? [{ icon: ClipboardList, label: quote.workOrders.length === 1 ? `Arbetsorder: ${quote.workOrders[0].title}` : `${quote.workOrders.length} arbetsordrar` }] : []),
    ...(quote && !editable ? [{ icon: Lock, label: quote.superseded ? "Ersatt av en nyare version" : "Låst", iconClassName: "text-muted-foreground" }] : []),
  ];
  const sendIssues = quoteSendIssues(draft, today);
  const sendReason = status !== "DRAFT" ? "" : !quote ? "Spara offerten först." : sendIssues.join(" ");
  const availableProjects = projects.filter((project) => project.id === draft.projectId || (!project.archivedAt && !project.closedAt && (!draft.customerId || !project.customerId || project.customerId === draft.customerId)));

  // A chosen project fills in its customer, place, heading and scope; nothing already written is replaced.
  const pickProject = (id: string | null) => {
    const project = id ? projects.find((item) => item.id === id) : undefined;
    if (!id || !project) { change({ projectId: id }); return; }
    change({ projectId: id, ...quoteFieldsFromProject(draft, project, (customerId) => customers.find((item) => item.id === customerId)) });
  };

  // The panels shared by the page and, at level 1 on a phone, by the quote's screens.
  // Grunduppgifter, variant Affär (Lika är rätt, 2026-11-14): the same card, order and customer field as the work order.
  const basicsPanel = <SharedBasicsPanel description="Kund, plats och projekt hör till ert företag. Offerten gäller till och med datumet." testId="quote-basics-panel">
    <DealBasicsFields idPrefix="quote" disabled={!editable}
      title={{ value: draft.title, placeholder: "Till exempel Byte av elcentral", onChange: (title) => change({ title }) }}
      project={{ value: draft.projectId, options: availableProjects, current: quote?.project ?? null, onChange: (id) => pickProject(id) }}
      workOrder={quote?.workOrders.length === 1 ? { id: quote.workOrders[0].id, title: quote.workOrders[0].title } : null}
      customer={{ customers, customerId: draft.customerId, facilityId: draft.facilityId, search: true,
        onChange: (next) => change({ customerId: next.customerId, facilityId: next.facilityId, projectId: draft.projectId && next.customerId && projects.find((project) => project.id === draft.projectId)?.customerId && projects.find((project) => project.id === draft.projectId)?.customerId !== next.customerId ? null : draft.projectId,
          // A new customer brings its type (Företag / Privatperson); the quote’s own choice stays while the customer is the same.
          ...(next.customerId && next.customerId !== draft.customerId ? quoteTypeFromCustomer(draft, next.customer ?? customers.find((item) => item.id === next.customerId)) : {}) }) }}
      description={{ label: "Omfattning (visas i offerten)", ariaLabel: "Omfattning", value: draft.description, onChange: (description) => change({ description }) }}>
      <label className="space-y-2 text-xs font-medium text-muted-foreground">Kundtyp
        {/* From the customer when one is chosen (2026-10-10); a change here applies to this quote only. */}
        <select className="form-select" value={draft.customerType} disabled={!editable} onChange={(event) => { const type = event.target.value as QuoteCustomerType; change({ customerType: type, ...(type === "COMPANY" ? { rotEnabled: false } : {}) }); }} aria-label="Kundtyp" data-testid="quote-customer-type">
          {QUOTE_CUSTOMER_TYPES.map((type) => <option key={type} value={type}>{QUOTE_CUSTOMER_TYPE_LABELS[type]}</option>)}
        </select>
        {draft.customerId && editable ? <span className="block font-normal" data-testid="quote-customer-type-help">Förval från kunden. En ändring gäller bara den här offerten.</span> : null}
      </label>
      <label className="space-y-2 text-xs font-medium text-muted-foreground">Giltig till
        <Input type="date" value={draft.validUntil} disabled={!editable} onChange={(event) => change({ validUntil: event.target.value })} aria-label="Giltig till" />
      </label>
    </DealBasicsFields>
  </SharedBasicsPanel>;
  const summaPanel = <Panel icon={Sigma} title="Summa" description="Beloppen visas exklusive och inklusive moms. Momssatsen gäller den här offerten.">
    {/* At level 1 a locked quote shows only the sums; its rate and ROT are read in them. */}
    {editable || !native ? <div className="field-group mb-4 grid gap-4 rounded-lg border p-3 sm:grid-cols-3" data-testid="quote-money-settings">
      <label className="space-y-1.5 text-xs font-medium text-muted-foreground">Moms (%)
        <Input inputMode="decimal" value={draft.vatPercent} aria-invalid={vatPercent === null || undefined} disabled={!editable || draft.reverseVat} onChange={(event) => change({ vatPercent: event.target.value })} data-testid="quote-vat-percent" />
      </label>
      {/* Omvänd byggmoms (2026-11-01): the person chooses it for a company; the VAT is then 0 % and the document says why. */}
      {draft.customerType === "COMPANY" ? <>
        <CheckField id="quote-reverse-vat" className="sm:col-span-3" label="Omvänd byggmoms" description="Köparen redovisar momsen. Offerten visar det." checked={draft.reverseVat} disabled={!editable}
          onChange={(on) => change({ reverseVat: on, vatPercent: on ? "0" : String(QUOTE_VAT_PERCENT) })} testId="quote-reverse-vat" />
        {draft.reverseVat ? <label className="space-y-1.5 text-xs font-medium text-muted-foreground sm:col-span-3">Köparens momsregistreringsnummer
          <Input value={draft.buyerVatNumber} maxLength={40} disabled={!editable} onChange={(event) => change({ buyerVatNumber: event.target.value })} data-testid="quote-buyer-vat" />
        </label> : null}
      </> : null}
      {/* 2026-10-09: the tick box on a row of its own under Moms, the ROT fields in the row after it. */}
      {draft.customerType === "PRIVATE" ? <>
        <CheckField id="quote-rot-enabled" className="sm:col-span-3" label="ROT-avdrag på arbetskostnaden" checked={draft.rotEnabled} disabled={!editable}
          onChange={toggleRot} testId="quote-rot" />
        {draft.rotEnabled ? <>
          <label className="space-y-1.5 text-xs font-medium text-muted-foreground">ROT-andel (%)
            <Input inputMode="decimal" value={draft.rotPercent} aria-invalid={parseShare(draft.rotPercent) === null || undefined} disabled={!editable} onChange={(event) => change({ rotPercent: event.target.value })} data-testid="quote-rot-percent" />
          </label>
          <label className="space-y-1.5 text-xs font-medium text-muted-foreground">Tak för avdraget (kr)
            <Input inputMode="decimal" value={draft.rotCap} aria-invalid={parseKronor(draft.rotCap) === null || undefined} disabled={!editable} onChange={(event) => change({ rotCap: event.target.value })} data-testid="quote-rot-cap" />
          </label>
          <p className="-mt-2.5 text-xs text-muted-foreground sm:col-span-3">Andel och tak är förval från era inställningar. Ni ansvarar själva för att de stämmer för kunden. Markera arbetsraderna under Rader.</p>
        </> : null}
      </> : <p className="text-xs text-muted-foreground sm:col-span-3">ROT-avdrag finns för offerter till privatpersoner (välj Kundtyp).</p>}
    </div> : null}
    {/* One aligned list (label left, amount right), not two columns that read zigzag (QA 2026-10-10). */}
    <dl className="grid max-w-xl gap-y-1.5 text-sm" data-testid="quote-totals">
      {QUOTE_LINE_KINDS.filter((kind) => totals.byKind[kind]).map((kind) => <div key={kind} className="flex justify-between gap-3"><dt className="text-muted-foreground">{QUOTE_LINE_KIND_LABELS[kind]}</dt><dd className="tabular-nums">{formatSek(totals.byKind[kind])} kr</dd></div>)}
      <div className="flex justify-between gap-3 border-t pt-1.5"><dt>Summa exklusive moms</dt><dd className="tabular-nums" data-testid="quote-net">{formatSek(totals.net)} kr</dd></div>
      <div className="flex justify-between gap-3"><dt>{draft.reverseVat ? "Moms" : `Moms ${formatPrice(totals.vatPercent)} %`}</dt><dd className="tabular-nums" data-testid="quote-vat">{draft.reverseVat ? REVERSE_VAT_LABEL : `${formatSek(totals.vat)} kr`}</dd></div>
      <div className={cn("flex justify-between gap-3", !totals.rot && "font-semibold")}><dt>{totals.rot ? "Summa inklusive moms" : "Att betala inklusive moms"}</dt><dd className="tabular-nums" data-testid="quote-gross">{formatSek(totals.gross)} kr</dd></div>
      {rotOn ? <>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Arbetskostnad inkl. moms (underlag)</dt><dd className="tabular-nums">{formatSek(totals.rotBaseInclVat)} kr</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Preliminärt ROT-avdrag{totals.rotCapped ? " (tak)" : ""}</dt><dd className="tabular-nums" data-testid="quote-rot-amount">-{formatSek(totals.rot)} kr</dd></div>
        <div className="flex justify-between gap-3 border-t pt-1.5 font-semibold"><dt>Att betala efter ROT-avdrag</dt><dd className="tabular-nums" data-testid="quote-to-pay">{formatSek(totals.toPay)} kr</dd></div>
      </> : null}
    </dl>
    {totals.unpriced ? <p className="mt-2 text-xs text-muted-foreground">{totals.unpriced} {totals.unpriced === 1 ? "rad saknar" : "rader saknar"} à-pris och ingår inte i summan.</p> : null}
    {/* The company's own figures: never printed on the customer's PDF. */}
    <div className="field-group mt-4 max-w-xl rounded-md border p-3 text-sm" data-testid="quote-margin">
      <p className="text-xs font-medium text-muted-foreground">Bara för er – visas inte för kunden</p>
      <p className="mt-1 flex flex-wrap gap-x-5 gap-y-1"><span>Inköp material: <span className="tabular-nums">{formatSek(totals.purchase)} kr</span></span><span>Påslag: <span className="tabular-nums">{formatSek(totals.margin)} kr</span></span></p>
    </div>
  </Panel>;
  const termsPanel = <Panel icon={ScrollText} title="Villkor" description="Ert företags villkor, till exempel betalningsvillkor.">
    <textarea className="form-textarea min-h-28" value={draft.terms} maxLength={5000} disabled={!editable} onChange={(event) => change({ terms: event.target.value })} aria-label="Villkor" data-testid="quote-terms" />
  </Panel>;
  if (native) {
    // ---------- Nivå 1 på mobil (2026-10-10, docs/ui-system.md 9) ----------
    // A quote is a menu of rows; Rader, Uppgifter, Summa, Skicka till kund, Versioner and Ändringar are screens of their own
    // (`&step=`, one line `&step=rad&line=<id>`). Changing something is a screen with Avbryt/Spara in the top bar; Avbryt
    // asks when something is changed (2026-10-13) and puts back what was saved. Export is office work: in visning 2,
    // and on a phone with Visa mer (A2).
    const screen = parseQuoteScreen(step);
    const screenHref = (to: QuoteScreen | null, lineId?: string) => {
      const next = new URLSearchParams(params.toString());
      if (to) next.set("step", to); else next.delete("step");
      if (lineId) next.set("line", lineId); else next.delete("line");
      return `/?${next.toString()}`;
    };
    // Rows are buttons, not links: moving between the quote's own screens is no way out of the quote.
    const open = (to: QuoteScreen, lineId?: string) => router.push(screenHref(to, lineId));
    const goBack = (to: QuoteScreen | null = screen === "rad" ? "rader" : null) => returnToWork(screenHref(to), (href) => router.push(href));
    const cancelScreen = () => void (async () => {
      const changedHere = dirty && JSON.stringify(draft) !== screenStart.current;
      if (changedHere && !(await confirm(DISCARD_QUESTION))) return;
      if (saved) setDraft(saved); setDirty(false); setImported(""); leaveWithoutAsking(); goBack();
    })();
    const saveScreen = () => { void save().then((id) => { if (id) goBack(); }); };
    const line = screen === "rad" ? draft.lines.find((item) => item.id === params.get("line")) ?? null : null;
    const editing = Boolean(quote && editable && (screen === "uppgifter" || screen === "summa" || (screen === "rad" && line) || (screen === "rader" && dirty)));
    const create = () => {
      if (!draft.title.trim()) { announce("Skriv en rubrik så kan du skapa offerten.", true); document.getElementById("quote-title")?.focus(); return; }
      void save();
    };
    const openSend = () => {
      if (quote?.storedStatus === "DRAFT" && sendIssues.length) { announce(sendIssues.join(" "), true); return; }
      open("skicka");
    };
    const removeLine = async (id: string) => {
      // A line never saved goes as Avbryt would take it away; a saved one asks first and the quote is saved without it.
      if (!saved?.lines.some((item) => item.id === id)) { cancelScreen(); return; }
      if (!await confirm({ title: "Ta bort raden?", message: "Raden tas bort från offerten.", confirmLabel: "Ta bort", tone: "danger" })) return;
      const next = { ...draft, lines: draft.lines.filter((item) => item.id !== id) };
      setDraft(next);
      if (await save(next)) goBack();
    };
    const addNativeLine = (kind: QuoteLineKind) => open("rad", addLine(kind));
    const canSendLink = Boolean(quote && (can("send") || (quote.storedStatus === "SENT" && can("accept"))));
    // M3 (2026-10-12): Rader → Uppgifter → Summa → Skicka till kund as one flow with Föregående / Nästa (the send step only
    // when the person may send). A step with unsaved changes is saved before moving on; the steps replace each other in the history.
    const flowSteps = quote && editable ? [{ key: "rader", label: "Rader" }, { key: "uppgifter", label: "Uppgifter" }, { key: "summa", label: "Summa" }, ...(canSendLink ? [{ key: "skicka", label: "Skicka till kund" }] : [])] : [];
    const flowIndex = screen ? flowSteps.findIndex((item) => item.key === screen) : -1;
    const flowTo = (index: number) => {
      const target = flowSteps[index]?.key;
      if (!target) return;
      const move = () => {
        if (target === "skicka" && quote?.storedStatus === "DRAFT" && sendIssues.length) { announce(sendIssues.join(" "), true); return; }
        router.replace(screenHref(target as QuoteScreen));
      };
      if (dirty) void save().then((id) => { if (id) move(); }); else move();
    };
    const bar: NativeTopBarConfig | null = !quote
      // Avbryt asks when something is filled in, and never leaves Workflow (2026-10-13: router.back() did on a direct link).
      ? { title: "Ny offert", cancel: { onClick: () => void (async () => { if (dirty && !(await confirm(DISCARD_QUESTION))) return; leaveWithoutAsking(); leavePage("/?view=quotes"); })() }, save: { label: "Skapa", busy, onClick: create } }
      : screen === "skicka" ? { title: QUOTE_SCREEN_TITLE.skicka, cancel: { onClick: () => goBack() }, ...(flowIndex < 0 ? { save: { label: "Skicka", busy, onClick: () => sendForm.current?.requestSubmit() } } : {}) }
      : screen ? { title: screen === "rad" && line ? QUOTE_LINE_KIND_LABELS[line.kind] : QUOTE_SCREEN_TITLE[screen], ...(editing ? { cancel: { onClick: cancelScreen }, save: { busy, onClick: saveScreen } } : { back: { label: screen === "rad" ? "Rader" : "Offerten" } }) }
      : { title: draft.title.trim() || quote.title, back: { label: "Offerter" } };
    const customerName = customerTitle(customers.find((customer) => customer.id === draft.customerId)) || quote?.customer?.name || "";
    const sumText = rotOn && totals.rot ? `${formatSek(totals.toPay)} kr` : `${formatSek(totals.gross)} kr`;
    const lockedText = quote && !editable ? (quote.superseded ? "Det här är en tidigare version. Den visas som den var." : status === "ACCEPTED" ? "Offerten är accepterad och låst. Ändringar och tillägg görs som ÄTA." : status === "DECLINED" ? "Offerten är avböjd och låst. Gör en ny version för att ändra den." : status === "EXPIRED" ? "Offerten är utgången och låst. Gör en ny version för att ändra den." : "Offerten är skickad och låst. Gör en ny version för att ändra den.") : "";
    const screenBox = (testId: string, children: React.ReactNode) => <div className="native-page native-screen space-y-1 pb-4" data-testid={testId}>{children}</div>;
    const importedNotice = imported ? <p className="notice mb-2 flex items-start gap-2" role="status" data-testid="quote-imported"><PackageOpen className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{imported}</p> : null;
    let body: React.ReactNode;
    if (!quote) {
      // Ny offert: the quote's basics as a form screen with Avbryt and Skapa; lines, sums and terms once it is created.
      body = screenBox("native-quote-new", <>
        {importedNotice}
        <NativeLead>{basicsPanel}</NativeLead>
        <ListGroup footer={draft.lines.length ? "Raderna följer med när offerten skapas." : "Rader, summa och villkor fyller du i när offerten är skapad."}>
          <ListRow type="quote" icon={ListOrdered} title="Rader" value={String(draft.lines.length)} chevron={false} />
        </ListGroup>
      </>);
    } else if (screen === "rader") {
      const groups = quoteLineGroups(draft.lines);
      body = <NativePage testId="native-quote-lines">
        {importedNotice}
        {editable ? <NativeActions testId="native-quote-add">
          {articlesOn ? <Button type="button" variant="ghost" onClick={() => setBrowsing(true)} data-testid="quote-add-articles"><Search />Lägg till artiklar</Button> : null}
          <Button type="button" variant="ghost" onClick={() => addNativeLine("MATERIAL")} data-testid="quote-add-material"><Plus />Lägg till material</Button>
          <Button type="button" variant="ghost" onClick={() => addNativeLine("LABOUR")} data-testid="quote-add-labour"><Hammer />Lägg till arbete</Button>
          <Button type="button" variant="ghost" onClick={() => addNativeLine("OTHER")} data-testid="quote-add-other"><Plus />Lägg till övrigt</Button>
          {draft.projectId ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void importMaterials()} data-testid="quote-import-materials"><PackageOpen />Hämta projektets material</Button> : null}
        </NativeActions> : null}
        {groups.length ? groups.map((group) => <ListGroup key={group.kind} title={group.label} testId={`native-quote-lines-${group.kind.toLowerCase()}`}>
          {group.lines.map((item) => { const amount = quoteLineNumbers(item).amount; return <ListRow key={item.id} type="quote" icon={item.kind === "LABOUR" ? Hammer : item.kind === "OTHER" ? Receipt : Package} twoLines
            title={item.name.trim() || "Utan benämning"} subtitle={[quoteLineSubtitle(item), rotOn && item.rotLabour ? "ROT" : ""].filter(Boolean).join(" · ")}
            value={amount === null ? "Inget pris" : `${formatSek(amount)} kr`} onClick={() => open("rad", item.id)} testId="native-quote-line-row" />; })}
        </ListGroup>) : <ListGroup><ListEmpty>Inga rader än.{editable ? " Lägg till material, arbete eller övrigt." : ""}</ListEmpty></ListGroup>}
        <ListGroup footer={totals.unpriced ? `${totals.unpriced} ${totals.unpriced === 1 ? "rad saknar" : "rader saknar"} à-pris och ingår inte i summan.` : "Belopp exklusive moms, med påslag."}>
          <ListRow type="neutral" icon={Sigma} title="Summa" subtitle="Exklusive moms" value={`${formatSek(totals.net)} kr`} onClick={() => open("summa")} testId="native-quote-lines-sum" />
        </ListGroup>
      </NativePage>;
    } else if (screen === "rad") {
      body = !line ? <NativePage><ListGroup><ListEmpty>Raden finns inte längre. Gå tillbaka till raderna.</ListEmpty></ListGroup></NativePage>
        : editable ? screenBox("native-quote-line", <>
          <NativeQuoteLineForm line={line} rot={rotOn} unitListId={unitListId} onPatch={(patch) => patchLine(line.id, patch)} />
          <NativeActions><Button type="button" variant="destructive" disabled={busy} onClick={() => void removeLine(line.id)} data-testid="native-quote-line-remove"><Trash2 />Ta bort raden</Button></NativeActions>
        </>)
        : <NativePage testId="native-quote-line"><NativeQuoteLineFacts line={line} rot={rotOn} /></NativePage>;
    } else if (screen === "uppgifter") {
      body = screenBox("native-quote-basics", <><NativeLead>{basicsPanel}</NativeLead>{termsPanel}</>);
    } else if (screen === "summa") {
      body = screenBox("native-quote-sum", <NativeLead>{summaPanel}</NativeLead>);
    } else if (screen === "skicka") {
      body = screenBox("native-quote-send-screen", <SendQuoteScreen formRef={sendForm} validUntil={draft.validUntil}
        defaultEmail={customers.find((customer) => customer.id === draft.customerId)?.email ?? ""} defaultMessage={settings?.emailMessage ?? ""}
        draft={quote.storedStatus === "DRAFT"} resend={Boolean(quote.customerLink && quote.customerLink.state === "active")}
        onSend={(input) => { void sendToCustomer(input).then((sent) => { if (sent) goBack(null); }); }} />);
    } else if (screen === "versioner") {
      body = <NativePage testId="native-quote-versions"><ListGroup footer="Varje skickad version finns kvar som den skickades.">
        {quote.versions.map((version) => <ListRow key={version.id} type="quote" icon={History} title={`Version ${version.version}${version.id === quote.id ? " (visas)" : ""}`}
          href={version.id === quote.id ? undefined : `/?view=quote&quoteId=${encodeURIComponent(version.id)}`} pill={{ label: QUOTE_STATUS_LABELS[version.status], tone: quoteStatusTone(version.status) }} />)}
      </ListGroup></NativePage>;
    } else if (screen === "andringar" && ataChange) {
      body = <NativePage testId="quote-change"><ListGroup footer={`Mot version ${quote.changeOfVersion}. Belopp exklusive moms.`}>
        {ataChange.lines.length ? ataChange.lines.map((item) => <ListRow key={`${item.kind}-${item.name}-${item.unit}`} title={item.name} twoLines
          subtitle={`${item.change === "added" ? "Tillagt" : item.change === "removed" ? "Borttaget" : "Ändrat"} · ${item.before ? formatPrice(item.before.quantity) : "–"} → ${item.after ? formatPrice(item.after.quantity) : "–"}${item.unit ? ` ${item.unit}` : ""}`}
          value={`${item.amountDelta > 0 ? "+" : ""}${formatSek(item.amountDelta)} kr`} />) : <ListEmpty>Inga ändringar än. Ändra antal, lägg till eller ta bort rader.</ListEmpty>}
        <ListRow title="Förändring exkl. moms" value={`${ataChange.netDelta > 0 ? "+" : ""}${formatSek(ataChange.netDelta)} kr`} testId="quote-change-delta" />
      </ListGroup></NativePage>;
    } else {
      // The quote's menu: facts, the customer's answer, the quote's parts and its actions as rows.
      const resend = quote.storedStatus === "SENT" && Boolean(quote.customerLink);
      body = <NativeMenuPage testId="native-quote"
        tiles={[
          { title: "Rader", subtitle: totals.unpriced ? `${totals.unpriced} utan pris` : `${draft.lines.length} ${draft.lines.length === 1 ? "rad" : "rader"}`, type: "quote", icon: ListOrdered, onClick: () => open("rader"), testId: "native-row-rader" },
          ...(editable ? [{ title: "Uppgifter", subtitle: "Kund, villkor", type: "neutral" as const, icon: Info, onClick: () => open("uppgifter"), testId: "native-row-uppgifter" }] : []),
        ]}
        groups={ataChange || quote.versions.length > 1 ? [{ title: "Offerten", testId: "native-quote-parts", rows: [
          ...(ataChange ? [{ key: "andringar", type: "quote" as const, icon: Copy, title: `Ändringar mot version ${quote.changeOfVersion}`, value: `${ataChange.netDelta > 0 ? "+" : ""}${formatSek(ataChange.netDelta)} kr`, onClick: () => open("andringar"), testId: "native-row-andringar" }] : []),
          ...(quote.versions.length > 1 ? [{ key: "versioner", type: "neutral" as const, icon: History, title: "Versioner", value: String(quote.versions.length), onClick: () => open("versioner"), testId: "native-row-versioner" }] : []),
        ] }] : []}>
        <ListGroup testId="native-quote-facts" footer={lockedText || undefined}>
          <ListFact label="Status"><span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[0.6875rem] font-semibold", indicatorBadge(quoteStatusTone(status)))} data-testid="quote-status">{QUOTE_STATUS_LABELS[status]}</span></ListFact>
          <ListFact label="Nummer">{`${quote.changeOfVersion ? "ÄTA" : "Offert"} ${quote.label}`}</ListFact>
          <ListFact label="Kund">{[customerName || "Ingen kund", quote.facility?.name].filter(Boolean).join("\n")}</ListFact>
          <ListFact label="Giltig till">{draft.validUntil || "Ingen giltighetstid"}</ListFact>
          <ListRow type="quote" icon={Sigma} title="Summa" subtitle={rotOn && totals.rot ? "Att betala efter ROT-avdrag" : "Inklusive moms"} value={sumText} onClick={() => open("summa")} testId="native-quote-sum-row" />
          {quote.project ? <ListRow type="project" icon={FolderKanban} title={quote.project.name} subtitle="Projekt" href={`/?view=project&projectId=${encodeURIComponent(quote.project.id)}`} /> : null}
          {draft.description.trim() ? <ListFact label="Omfattning">{draft.description}</ListFact> : null}
        </ListGroup>
        <NativeCustomerLink link={quote.customerLink} response={quote.customerResponse} testUrl={testUrl} busy={busy} demo={Boolean(quote.customerLink?.demo)} onDemoAnswer={(decision) => void demoAnswer(decision)} />
        <NativeQuoteWorkOrders quote={quote} />
        {!editable && draft.terms.trim() ? <ListGroup title="Villkor"><ListFact label="Företagets villkor">{draft.terms}</ListFact></ListGroup> : null}
        <NativeActions title="Skicka" testId="native-quote-send-actions">
          {canSendLink ? <Button type="button" variant="ghost" disabled={busy} disabledReason={sendReason} onClick={openSend} data-testid="quote-send-customer"><Mail />{resend ? "Skicka igen" : "Skicka till kund"}</Button> : null}
          <DownloadButton variant="ghost" disabled={busy} onClick={() => void openPdf()} data-testid="quote-pdf">Visa som PDF</DownloadButton>
          {/* Till grossist is a row of the quote's menu (2026-10-13), not a group of its own under Rader. */}
          {wholesaleButton("ghost")}
          {can("send") ? <Button type="button" variant="ghost" disabled={busy} disabledReason={sendReason} onClick={() => void changeStatus("send")} data-testid="quote-send"><Send />Markera som skickad</Button> : null}
        </NativeActions>
        {can("accept") || can("decline") || can("expire") ? <NativeActions title="Markera svaret själv" footer="När kunden har svarat på annat sätt än via länken, till exempel per telefon." testId="native-quote-answer-actions">
          {can("accept") ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void changeStatus("accept")} data-testid="quote-accept"><BadgeCheck />Accepterad</Button> : null}
          {can("decline") ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void changeStatus("decline")} data-testid="quote-decline"><XCircle />Avböjd</Button> : null}
          {can("expire") ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void changeStatus("expire")} data-testid="quote-expire"><CalendarClock />Utgången</Button> : null}
        </NativeActions> : null}
        {quote.canCreateWorkOrder || can("new_version") || can("delete") ? <NativeActions title="Hantering" testId="native-quote-manage-actions">
          {quote.canCreateWorkOrder ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void createWorkOrder()} data-testid="quote-work-order"><ClipboardList />Skapa arbetsorder</Button> : null}
          {can("new_version") ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void newVersion()} data-testid="quote-new-version"><Copy />{status === "ACCEPTED" ? "ÄTA (ändring/tillägg)" : "Ny version"}</Button> : null}
          {can("delete") ? <Button type="button" variant="destructive" disabled={busy} onClick={() => void remove()} data-testid="quote-delete"><Trash2 />Ta bort utkastet</Button> : null}
        </NativeActions> : null}
        {reduced ? <ShowMoreMarker /> : <NativeActions title="Exportera" testId="native-quote-export-actions"><QuoteExportMenu quote={quote} disabled={busy || dirty} /></NativeActions>}
      </NativeMenuPage>;
    }
    return <div data-testid="quote-editor" data-status={status} data-native-screen={screen ?? "menu"}>
      {confirmCard}
      {quickPick.dialog}
      <ArticleBrowserDialog open={browsing} onOpenChange={setBrowsing} onAdd={addArticle} onAdjust={adjustArticle} docWord="offerten" docName={quote ? `Offert ${quote.label}${draft.title.trim() ? ` (${draft.title.trim()})` : ""}` : `${draft.title.trim() || "Ny offert"} – sparas när du trycker Spara`} />
      <NativeQuoteTopBar config={bar} />
      <datalist id={unitListId}>{MATERIAL_UNIT_SUGGESTIONS.map((unit) => <option key={unit} value={unit} />)}</datalist>
      {body}
      {flowIndex >= 0 ? <NativePage testId="native-quote-flow-page"><NativeFlowBar steps={flowSteps} index={flowIndex} onPrevious={() => flowTo(flowIndex - 1)} onNext={() => flowTo(flowIndex + 1)}
        finish={{ label: "Skicka till kund", busy, onClick: () => sendForm.current?.requestSubmit() }} testId="native-quote-flow" /></NativePage> : null}
    </div>;
  }
  const hasMore = !quote || can("send") || can("expire") || can("delete") || (status === "SENT" && (can("new_version") || (quote.storedStatus === "SENT" && can("accept"))));
  const moreActions: EditorMenuItem[] = [
    ...(!quote || can("send") ? [{ label: "Markera som skickad", icon: Send, disabled: busy || Boolean(sendReason), onSelect: () => void changeStatus("send"), testId: "quote-send" }] : []),
    ...(quote?.storedStatus === "SENT" && can("accept") ? [{ label: quote.customerLink ? "Skicka igen" : "Skicka till kund", icon: Mail, disabled: busy || Boolean(sendReason), onSelect: () => openSendToCustomer(), testId: "quote-send-customer" }] : []),
    ...(can("expire") ? [{ label: "Utgången", icon: CalendarClock, disabled: busy, onSelect: () => void changeStatus("expire"), testId: "quote-expire" }] : []),
    ...(can("new_version") && status === "SENT" ? [{ label: "Ny version", icon: Copy, disabled: busy, onSelect: () => void newVersion(), testId: "quote-new-version" }] : []),
    ...(can("delete") ? [{ label: "Ta bort utkastet", icon: Trash2, danger: true, disabled: busy, onSelect: () => void remove(), testId: "quote-delete" }] : []),
  ];
  return <div className={cn("space-y-5", STANDARD_PAGE_WIDTH)} data-testid="quote-editor" data-status={status} data-standard-page="">
    {confirmCard}
    {/* Ny offert opens as a draft and is saved by itself at the first change once it has a rubrik (the server asks for one). */}
    <FirstChangeSave isNew={!quote && !quoteId} dirty={dirty} ready={Boolean(draft.title.trim())} busy={busy} change={draft} save={() => save()} />
    {/* The standard top (plan 1Q, 2026-10-11): all buttons top right – Ta bort utkastet (red) furthest left, the
        secondary ones, the main action Spara furthest right – like every other page. */}
    <EditorHeader
      kind={quote?.changeOfVersion ? "ÄTA – ändrings- och tilläggsarbete" : undefined}
      title={draft.title.trim() || (quote ? quote.title : "Ny offert")}
      detail={<span className={cn("inline-flex rounded-full border px-2.5 py-0.5 font-medium", indicatorBadge(quoteStatusTone(status)))} data-testid="quote-status">{QUOTE_STATUS_LABELS[status]}</span>}
      facts={facts}
      // Högst fyra knappar (2026-11-14): EditorHeader moves what does not fit under Mer, PDF first; the rows that are
      // seldom pressed on a draft and a sent quote always live there (UT4, 2026-11-01).
      actions={[
        { key: "pdf", node: <DownloadButton disabled={busy} onClick={() => void openPdf()} data-testid="quote-pdf">PDF</DownloadButton>, menu: { label: "Visa som PDF", icon: FileDown, disabled: busy, onSelect: () => void openPdf(), testId: "quote-pdf" } },
        quote ? { key: "export", node: <QuoteExportMenu quote={quote} disabled={busy || dirty} /> } : null,
        // Offert per e-post (steg E). Shown on every draft, also before the first save, so the row of buttons does not change when it is saved.
        !quote || can("send") ? { key: "send-customer", keep: true, node: <Button type="button" variant="outline" disabled={busy} disabledReason={sendReason} onClick={openSendToCustomer} data-testid="quote-send-customer"><Mail />{quote?.storedStatus === "SENT" && quote.customerLink ? "Skicka igen" : "Skicka till kund"}</Button> } : null,
        can("accept") ? { key: "accept", keep: true, node: <Button type="button" variant="outline" disabled={busy} onClick={() => void changeStatus("accept")} data-testid="quote-accept"><BadgeCheck />Accepterad</Button>, menu: { label: "Accepterad", icon: BadgeCheck, disabled: busy, onSelect: () => void changeStatus("accept"), testId: "quote-accept" } } : null,
        can("decline") ? { key: "decline", keep: true, node: <Button type="button" variant="outline" disabled={busy} onClick={() => void changeStatus("decline")} data-testid="quote-decline"><XCircle />Avböjd</Button>, menu: { label: "Avböjd", icon: XCircle, disabled: busy, onSelect: () => void changeStatus("decline"), testId: "quote-decline" } } : null,
        quote?.canCreateWorkOrder ? { key: "work-order", keep: true, node: <Button type="button" variant="outline" disabled={busy} onClick={() => void createWorkOrder()} data-testid="quote-work-order"><ClipboardList />Skapa arbetsorder</Button>, menu: { label: "Skapa arbetsorder", icon: ClipboardList, disabled: busy, onSelect: () => void createWorkOrder(), testId: "quote-work-order" } } : null,
        can("new_version") && status !== "SENT" ? { key: "new-version", node: <Button type="button" variant="outline" disabled={busy} onClick={() => void newVersion()} data-testid="quote-new-version"><Copy />{status === "ACCEPTED" ? "ÄTA (ändring/tillägg)" : "Ny version"}</Button>, menu: { label: status === "ACCEPTED" ? "ÄTA (ändring/tillägg)" : "Ny version", icon: Copy, disabled: busy, onSelect: () => void newVersion(), testId: "quote-new-version" } } : null,
      ]}
      moreActions={hasMore ? moreActions : undefined}
      moreTestId="quote-more"
      primaryAction={editable ? <Button type="button" className="min-w-28" disabled={busy || (!dirty && Boolean(quote))} onClick={() => void save()} data-testid="quote-save"><Save />Spara</Button> : undefined}
      // Why the quote cannot be marked as sent yet, as visible text under the buttons (never only a tooltip).
      primaryReason={quote && sendReason ? `Markera som skickad: ${sendReason}` : ""}
      cancelAction={!quote ? <Button type="button" variant="outline" disabled={busy} onClick={() => void (async () => { if (dirty && !(await confirm(DISCARD_QUESTION))) return; await releaseBack(); leaveWithoutAsking(); if (way) way.cancel(); else leavePage("/?view=quotes"); })()} data-testid="quote-new-cancel">Avbryt</Button>
        : way ? <Button type="button" variant="outline" disabled={busy} onClick={() => void (async () => { if (dirty && !(await save())) return; leaveWithoutAsking(); way.done(); })()} data-testid="return-to-origin"><Undo2 />{way.label}</Button> : null}
    />
    {quote && !editable ? <p className="notice flex items-start gap-2" role="status" data-testid="quote-locked"><Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {quote.superseded ? "Det här är en tidigare version. Den visas som den var." : status === "ACCEPTED" ? "Offerten är accepterad och låst. Ändringar och tillägg görs som ÄTA." : status === "DECLINED" ? "Offerten är avböjd och låst. Gör en ny version för att ändra den." : status === "EXPIRED" ? "Offerten är utgången och låst. Gör en ny version för att ändra den." : "Offerten är skickad och låst. Gör en ny version för att ändra den."}
    </p> : null}
    {quote ? <CustomerLinkPanel link={quote.customerLink} response={quote.customerResponse} testUrl={testUrl} busy={busy}
      demo={Boolean(quote.customerLink?.demo)} onDemoAnswer={(decision) => void demoAnswer(decision)} /> : null}
    {quote ? <SendQuoteDialog open={sendOpen} onOpenChange={setSendOpen} busy={busy} validUntil={draft.validUntil}
      defaultEmail={customers.find((customer) => customer.id === draft.customerId)?.email ?? ""} defaultMessage={settings?.emailMessage ?? ""}
      draft={quote.storedStatus === "DRAFT"} resend={Boolean(quote.customerLink && quote.customerLink.state === "active")} onSend={(input) => void sendToCustomer(input)} /> : null}
    {imported ? <p className="notice flex items-start gap-2" role="status" data-testid="quote-imported"><PackageOpen className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{imported}</p> : null}

    {/* Högerställd sammanfattning (2026-10-16): Summa beside the panels on a wide screen at level 3. */}
    <EditorAsideLayout testId="quote-layout" fit="table">
    {basicsPanel}

    {quickPick.dialog}
    <ArticleBrowserDialog open={browsing} onOpenChange={setBrowsing} onAdd={addArticle} onAdjust={adjustArticle} docWord="offerten" docName={quote ? `Offert ${quote.label}${draft.title.trim() ? ` (${draft.title.trim()})` : ""}` : `${draft.title.trim() || "Ny offert"} – sparas när du trycker Spara`} />
    <PurchaseChangedNotice changed={purchaseChanges} busy={busy} docWord="offerten" onRefresh={(id) => void refreshFromPurchase(id)} />
    <Panel icon={ListOrdered} title="Rader" description="À-pris är inköpspris eller timpris exkl. moms. Kunden ser bara priset med påslag.">
      {/* The add buttons stay where they are; a new line appears last, is scrolled to and gets focus. */}
      {/* Till grossist stands in the same row as the line actions (2026-10-13), alone when the quote is locked. */}
      {editable || quote ? <div className="flex flex-wrap gap-2" data-testid="quote-line-actions">
        {editable ? <>
          {articlesOn ? <Button type="button" onClick={() => setBrowsing(true)} data-testid="quote-add-articles"><Search />Lägg till artiklar</Button> : null}
          <Button type="button" variant="outline" onClick={() => addLine("MATERIAL")} data-testid="quote-add-material"><Plus />Lägg till material</Button>
          <Button type="button" variant="outline" onClick={() => addLine("LABOUR")} data-testid="quote-add-labour"><Hammer />Lägg till arbete</Button>
          <Button type="button" variant="outline" onClick={() => addLine("OTHER")} data-testid="quote-add-other"><Plus />Lägg till övrigt</Button>
          {draft.projectId ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void importMaterials()} data-testid="quote-import-materials"><PackageOpen />Hämta projektets material</Button> : null}
        </> : null}
        {quote ? wholesaleButton("outline") : null}
      </div> : null}
      <datalist id={unitListId}>{MATERIAL_UNIT_SUGGESTIONS.map((unit) => <option key={unit} value={unit} />)}</datalist>
      {/* A table from a wide window (50 rem), cards under that: features/quotes/line-table.tsx, shared with the invoice basis. */}
      <div className={cn(LINE_TABLE_BOX, (editable || quote) && "mt-3")}>
        {/* A table only when there are lines; the empty line is a plain paragraph (the objective analysis 2026-10-24). */}
        <div className={draft.lines.length ? LINE_TABLE_SHELL : "space-y-2"} role={draft.lines.length ? "table" : undefined} aria-label={draft.lines.length ? "Offertens rader" : undefined} data-testid="quote-lines">
        {draft.lines.length ? <LineTableHeader /> : null}
        {!draft.lines.length ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Inga rader än.{editable ? " Lägg till material, arbete eller övrigt." : ""}</p> : null}
        {draft.lines.map((line) => <QuoteLineRow key={line.id} line={line} editable={editable} unitListId={unitListId} rot={rotOn}
          onPatch={(patch) => patchLine(line.id, patch)} onRemove={() => removeDraftLine(line.id)} onEnterLast={() => addLine(line.kind)} />)}
        </div>
      </div>
    </Panel>

    {ataChange ? <Panel title={`Ändringar mot version ${quote?.changeOfVersion}`} description="ÄTA: ändringar och tillägg mot den accepterade versionen. Belopp exkl. moms.">
      <div data-testid="quote-change">
        {!ataChange.lines.length ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Inga ändringar än. Ändra antal, lägg till eller ta bort rader.</p> : <ul className="divide-y rounded-lg border">
          {ataChange.lines.map((line) => <li key={`${line.kind}-${line.name}-${line.unit}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_6rem_10rem_8rem]">
            <span className="min-w-0 break-words font-medium">{line.name}{line.unit ? <span className="font-normal text-muted-foreground"> ({line.unit})</span> : null}</span>
            <span className="text-xs text-muted-foreground sm:text-sm">{line.change === "added" ? "Tillagt" : line.change === "removed" ? "Borttaget" : "Ändrat"}</span>
            <span className="tabular-nums text-muted-foreground">{line.before ? formatPrice(line.before.quantity) : "–"} → {line.after ? formatPrice(line.after.quantity) : "–"}</span>
            <span className="text-right tabular-nums">{line.amountDelta > 0 ? "+" : ""}{formatSek(line.amountDelta)} kr</span>
          </li>)}
        </ul>}
        <p className="mt-2 text-sm font-semibold" data-testid="quote-change-delta">Förändring exkl. moms: {ataChange.netDelta > 0 ? "+" : ""}{formatSek(ataChange.netDelta)} kr</p>
      </div>
    </Panel> : null}

    <EditorAside label="Offertens summa" testId="quote-aside">{summaPanel}</EditorAside>

    {termsPanel}

    {quote ? <QuoteWorkOrdersPanel quote={quote} /> : null}

    {quote && quote.versions.length > 1 ? <Panel icon={History} title="Versioner" description="Varje skickad version finns kvar som den skickades." collapsible defaultCollapsed count={quote.versions.length} foldKey="quote-versions">
      <ul className="divide-y rounded-lg border" data-testid="quote-versions">{quote.versions.map((version) => <li key={version.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
        {version.id === quote.id ? <span className="font-medium">Version {version.version} (visas)</span> : <Link className="text-primary hover:underline" href={`/?view=quote&quoteId=${encodeURIComponent(version.id)}`}>Version {version.version}</Link>}
        <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium", indicatorBadge(quoteStatusTone(version.status)))}>{QUOTE_STATUS_LABELS[version.status]}</span>
      </li>)}</ul>
    </Panel> : null}
    </EditorAsideLayout>
  </div>;
}

/** The quote named in the address (`?view=quote&quoteId=…`), or a new one; a new id starts the page afresh. */
export function QuoteEditorFromAddress(props: Omit<React.ComponentProps<typeof QuoteEditor>, "quoteId" | "source">) {
  const params = useSearchParams();
  const quoteId = params.get("quoteId")?.slice(0, 100) || undefined;
  // Materiallista → offert (steg C): `from=project` (with projectId) or `from=task&taskId=…` (a work order).
  const from = params.get("from");
  const taskId = params.get("taskId")?.slice(0, 100) || undefined;
  const source = from === "task" && taskId ? { taskId } : from === "project" && props.projectId ? { projectId: props.projectId } : undefined;
  // A quote made here by its first change keeps its editor (lib/workflow/use-first-change-save.ts).
  const fresh = `new-${from ?? ""}-${taskId ?? ""}`;
  return <QuoteEditor key={editorKey(quoteId, fresh)} adoptKey={fresh} quoteId={quoteId} source={source} {...props} />;
}

/**
 * One line. In a wide window (50 rem) a row of the table - Typ, Art.nr, Benämning, Antal, Enhet, À-pris, Påslag, Belopp,
 * Ta bort - with the headings once on top (2026-10-11); otherwise a card with the labels above its fields (QA
 * 2026-10-10: placeholders alone said nothing once filled in): Typ and Art.nr, Benämning on its own row, then Antal,
 * Enhet, À-pris, Påslag, the amount and Ta bort. Enter in Påslag adds a line of the same kind.
 */
function QuoteLineRow({ line, editable, unitListId, rot, onPatch, onRemove, onEnterLast }: {
  line: QuoteLineView; editable: boolean; unitListId: string; rot: boolean;
  onPatch: (patch: Partial<QuoteLineView>) => void; onRemove: () => void; onEnterLast: () => void;
}) {
  const numbers = quoteLineNumbers(line);
  const badQuantity = Boolean(line.quantity.trim()) && quantityProblem(line.quantity) !== null;
  const badPrice = Boolean(line.unitPrice.trim()) && parseAmount(line.unitPrice) === null;
  const badMarkup = Boolean(line.markupPercent.trim()) && parsePercent(line.markupPercent) === null;
  const labour = line.kind === "LABOUR";
  const material = line.kind === "MATERIAL";
  return <div data-line={line.id} data-testid="quote-line" role="row" className={cn(LINE_TABLE_GRID, LINE_TABLE_ROW, "grid grid-cols-2 items-end gap-x-3 gap-y-3 rounded-lg border p-3 sm:grid-cols-4")}><LineCells>
    <label className={LINE_TABLE_LABEL}><span className={LINE_TABLE_LABEL_TEXT}>Typ</span>
      <select className="form-select @[50rem]:pl-2" aria-label="Typ" value={line.kind} disabled={!editable} onChange={(event) => onPatch({ kind: event.target.value as QuoteLineKind })}>
        {QUOTE_LINE_KINDS.map((kind) => <option key={kind} value={kind}>{QUOTE_LINE_KIND_LABELS[kind]}</option>)}
      </select>
    </label>
    {/* Art.nr: a material line's own field; other kinds keep the column empty so the row's columns stand still. */}
    {material || line.articleNo ? <ArticleNoField value={line.articleNo ?? ""} source={line.articleSource} manufacturer={line.manufacturerArticleNo ?? line.catalogue?.manufacturerArticleNo} disabled={!editable}
      onChange={(articleNo) => onPatch({ articleNo, articleSource: "" })} testId="quote-line-article-no" />
      : <span aria-hidden="true" className="hidden @[50rem]:block" />}
    {/* Materialsökningen (2026-10-09): a material line's Benämning searches the catalogue (the price file), as on a work order. */}
    {/* Benämning is an ordinary field (2026-10-16): articles are added with Lägg till artiklar; here the row is adjusted or written by hand. */}
    <label className={cn(LINE_TABLE_LABEL, "col-span-2 sm:col-span-4 @[50rem]:col-span-1")}><span className={LINE_TABLE_LABEL_TEXT}>Benämning</span><Input name="quote-line-name" aria-label="Benämning" title={line.name} value={line.name} maxLength={300} disabled={!editable} onChange={(event) => onPatch({ name: event.target.value })} /></label>
    <label className={LINE_TABLE_LABEL}><span className={LINE_TABLE_LABEL_TEXT}>{labour ? "Timmar" : "Antal"}</span><Input aria-label="Antal" inputMode="decimal" className={LINE_TABLE_NARROW_INPUT} value={line.quantity} title={badQuantity ? quantityProblem(line.quantity) ?? undefined : undefined} aria-invalid={badQuantity || undefined} disabled={!editable} onChange={(event) => onPatch({ quantity: event.target.value })} /></label>
    <label className={LINE_TABLE_LABEL}><span className={LINE_TABLE_LABEL_TEXT}>Enhet</span><Input aria-label="Enhet" list={unitListId} autoComplete="off" className={LINE_TABLE_NARROW_INPUT} value={line.unit} maxLength={40} disabled={!editable} onChange={(event) => onPatch({ unit: event.target.value })} /></label>
    <label className={LINE_TABLE_LABEL}><span className={LINE_TABLE_LABEL_TEXT}>{labour ? "Timpris (kr)" : "À-pris (kr)"}</span><span className="relative block"><Input aria-label={labour ? "Timpris (kr)" : "À-pris (kr)"} inputMode="decimal" className={LINE_TABLE_NARROW_INPUT} value={line.unitPrice} aria-invalid={badPrice || undefined} disabled={!editable} onChange={(event) => onPatch({ unitPrice: event.target.value })} /><PriceMark snapshot={line.catalogue} unitPrice={line.unitPrice} /></span></label>
    <label className={LINE_TABLE_LABEL}><span className={LINE_TABLE_LABEL_TEXT}>Påslag (%)</span><Input aria-label="Påslag (%)" inputMode="decimal" className={LINE_TABLE_NARROW_INPUT} value={line.markupPercent} aria-invalid={badMarkup || undefined} disabled={!editable} onChange={(event) => onPatch({ markupPercent: event.target.value })} onKeyDown={editable ? enterAddsLine(onEnterLast) : undefined} data-testid="quote-line-markup" /></label>
    <div className={cn(LINE_TABLE_LABEL, "sm:col-span-3 sm:text-right @[50rem]:col-span-1")}><span className={LINE_TABLE_LABEL_TEXT}>Belopp</span>
      <p className="flex min-h-10 items-center text-sm tabular-nums sm:justify-end @[50rem]:justify-end" data-testid="quote-line-amount">{numbers.amount === null ? <span className="font-normal text-muted-foreground">Inget pris</span> : <span className="truncate font-semibold text-foreground">{formatSek(numbers.amount)} kr</span>}</p>
    </div>
    <div className="flex min-h-10 items-center justify-end">
      {editable ? <RemoveButton label="Ta bort raden" onClick={onRemove} data-testid="quote-line-remove" /> : null}
    </div>
    {rot ? <label className="col-span-full flex min-h-8 items-center gap-2 text-xs text-muted-foreground @[50rem]:pt-1">
      <Checkbox checked={Boolean(line.rotLabour)} disabled={!editable} onCheckedChange={(checked) => onPatch({ rotLabour: checked === true })} data-testid="quote-line-rot" />Arbetskostnad (ingår i ROT-underlaget)
    </label> : null}
    {line.product ? <RowProduct info={line.product} images={false} className="col-span-full @[50rem]:pb-1" /> : null}
    {line.catalogue ? <div className="col-span-full @[50rem]:pb-1"><ClearablePrice snapshot={line.catalogue} unitPrice={line.unitPrice} editable={editable} onClear={() => clearPriceWithUndo(line, onPatch)} /></div> : null}
  </LineCells></div>;
}


/** The quote's top bar at level 1 (drawn only there). */
function NativeQuoteTopBar({ config }: { config: NativeTopBarConfig | null }) {
  useNativeTopBar(config);
  return null;
}

const nativeLabel = "block space-y-1.5 text-xs font-medium text-muted-foreground";

/**
 * One line at level 1 on a phone (2026-10-10): its own screen with the labels above the fields – Typ, Benämning
 * (a material line searches the catalogue as on a work order), Antal and Enhet, À-pris and Påslag – and the amount the
 * customer sees. Avbryt and Spara are in the top bar; Ta bort raden is under the fields.
 */
function NativeQuoteLineForm({ line, rot, unitListId, onPatch }: {
  line: QuoteLineView; rot: boolean; unitListId: string; onPatch: (patch: Partial<QuoteLineView>) => void;
}) {
  const numbers = quoteLineNumbers(line);
  const badQuantity = Boolean(line.quantity.trim()) && quantityProblem(line.quantity) !== null;
  const badPrice = Boolean(line.unitPrice.trim()) && parseAmount(line.unitPrice) === null;
  const badMarkup = Boolean(line.markupPercent.trim()) && parsePercent(line.markupPercent) === null;
  const labour = line.kind === "LABOUR";
  return <div data-line={line.id} className="native-group space-y-4 p-4" data-testid="native-quote-line-form">
    <label className={nativeLabel}>Typ
      <span className="native-picker-field text-foreground">
        <span className="min-w-0 flex-1 truncate">{QUOTE_LINE_KIND_LABELS[line.kind]}</span>
        <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground/70" />
        <select aria-label="Typ" value={line.kind} onChange={(event) => onPatch({ kind: event.target.value as QuoteLineKind })}>
          {QUOTE_LINE_KINDS.map((kind) => <option key={kind} value={kind}>{QUOTE_LINE_KIND_LABELS[kind]}</option>)}
        </select>
      </span>
    </label>
    <label className={nativeLabel}>Benämning<Input name="quote-line-name" value={line.name} maxLength={300} onChange={(event) => onPatch({ name: event.target.value })} /></label>
    <div className="grid grid-cols-2 gap-3">
      <label className={nativeLabel}>{labour ? "Timmar" : "Antal"}<Input inputMode="decimal" value={line.quantity} aria-invalid={badQuantity || undefined} onChange={(event) => onPatch({ quantity: event.target.value })} data-testid="native-quote-line-quantity" /></label>
      <label className={nativeLabel}>Enhet<Input list={unitListId} autoComplete="off" value={line.unit} maxLength={40} onChange={(event) => onPatch({ unit: event.target.value })} /></label>
      <label className={nativeLabel}>{labour ? "Timpris (kr)" : "À-pris (kr)"}<span className="relative block"><Input inputMode="decimal" value={line.unitPrice} aria-invalid={badPrice || undefined} onChange={(event) => onPatch({ unitPrice: event.target.value })} data-testid="native-quote-line-price" /><PriceMark snapshot={line.catalogue} unitPrice={line.unitPrice} /></span></label>
      <label className={nativeLabel}>Påslag (%)<Input inputMode="decimal" value={line.markupPercent} aria-invalid={badMarkup || undefined} onChange={(event) => onPatch({ markupPercent: event.target.value })} /></label>
    </div>
    <p className="-mt-2 text-xs leading-5 text-muted-foreground">À-pris är ert inköpspris eller timpris exklusive moms. Kunden ser bara priset med påslag.</p>
    {line.product ? <RowProduct info={line.product} images={false} /> : null}
    {line.catalogue ? <ClearablePrice snapshot={line.catalogue} unitPrice={line.unitPrice} editable onClear={() => clearPriceWithUndo(line, onPatch)} /> : null}
    {rot ? <CheckField id={`quote-line-rot-${line.id}`} label="Arbetskostnad (ingår i ROT-underlaget)" checked={Boolean(line.rotLabour)} onChange={(checked) => onPatch({ rotLabour: checked })} testId="quote-line-rot" /> : null}
    <p className="flex items-baseline justify-between gap-3 border-t pt-3 text-[0.9375rem]"><span className="text-muted-foreground">Belopp exkl. moms</span>
      <span className="font-semibold tabular-nums" data-testid="quote-line-amount">{numbers.amount === null ? "Inget pris" : `${formatSek(numbers.amount)} kr`}</span></p>
  </div>;
}

/** A line of a locked quote at level 1: its facts as rows, read only. */
function NativeQuoteLineFacts({ line, rot }: { line: QuoteLineView; rot: boolean }) {
  const numbers = quoteLineNumbers(line);
  return <ListGroup testId="native-quote-line-facts">
    <ListFact label="Benämning">{line.name || "Utan benämning"}</ListFact>
    <ListFact label={line.kind === "LABOUR" ? "Timmar" : "Antal"}>{quoteLineSubtitle(line)}</ListFact>
    <ListFact label={line.kind === "LABOUR" ? "Timpris" : "À-pris"}>{line.unitPrice.trim() ? `${line.unitPrice} kr` : "Inget pris"}{line.markupPercent.trim() ? ` · påslag ${line.markupPercent} %` : ""}</ListFact>
    {rot && line.rotLabour ? <ListFact label="ROT">Arbetskostnad, ingår i ROT-underlaget</ListFact> : null}
    <ListFact label="Belopp exkl. moms">{numbers.amount === null ? "Inget pris" : `${formatSek(numbers.amount)} kr`}</ListFact>
  </ListGroup>;
}
