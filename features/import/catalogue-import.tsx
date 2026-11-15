"use client";

import { plural } from "@/lib/plural";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, LoaderCircle, Pencil, Search, Tags, Trash2, Upload } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CollapsibleSection, Panel } from "@/features/kfid/ui";
import { useConfirm } from "@/features/kfid/confirm";
import { api } from "@/features/kfid/api";
import { cn } from "@/lib/utils";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { countsAgainst, mappingFits, type CatalogueMapping, type CatalogueParseOptions, type CatalogueRow, type CatalogueRowError, type CatalogueRowErrorKind } from "@/lib/catalogue/model";
import { CATALOGUE_FIELDS, PRICE_SCALES, type PriceScale } from "@/lib/catalogue/fields";
import type { ColumnSuggestions } from "@/lib/catalogue/columns";
import type { PriceFileFormat, PriceFileInfo } from "@/lib/catalogue/file/open";
import { parseStarts } from "@/lib/catalogue/file/fixed-width";
import { priceAgeHint, priceDateText, type CatalogueHit, offerFacts, offerWarning } from "@/lib/catalogue/snapshot";
import { BASE_PRICE_NOTE, PRICE_KIND_LABELS, PRICE_KINDS, type PriceKind } from "@/lib/catalogue/price-kind";
import type { RebatePreview } from "@/lib/catalogue/rebate-server";
import { announce } from "@/lib/workflow/toast";
import { verdictOf } from "@/lib/catalogue/verdict";
import { WHOLESALER_LABELS, WHOLESALERS, type WholesalerId } from "@/lib/wholesale/model";
import { formatPrice } from "@/lib/workflow/expenses";
import { IconButton } from "@/components/ui/icon-button";
import { RemoveButton } from "@/components/ui/remove-button";
import { companyRowLimitMessage, companyRowsAfter, wholesalerBoxText, type ImportGateReason } from "@/lib/catalogue/gate-text";

/**
 * Artiklar och priser, steg 1 (2026-10-08): the price-file part of the Import page and the company's catalogue.
 * The person names their own supplier, maps the columns once (saved per supplier and suggested again for the same
 * headings), checks the rows and imports. Prices are history; a work order keeps a copy of the price it was given.
 *
 * Prisfiler etapp 1 (2026-10-12): the file is read as a stream on the server, so a list of several hundred
 * thousand rows works. "Så läses filen" shows how it was read and lets the person correct it (headings or not, the
 * positions of a fixed-width file, prices in hundredths, the article number as E-nummer); columns suggested from the
 * content are shown with their reason and must be confirmed; duplicated article numbers, shifted rows and zero prices
 * are reported, never dropped in silence. The choices are saved with the supplier's columns and used for its next file.
 */
export type CataloguePreview = {
  rows: CatalogueRow[]; rowCount: number; errors: CatalogueRowError[]; errorCount: number; missing: string[]; total: number;
  previous: { date: string; supplierName: string } | null;
  /** Per supplier id: the file's articles it already has and how many keep their price (pris ändrat 2026-10-08). */
  bySupplier?: Record<string, { matched: number; unchanged: number }>;
  /** Rows with a discount group (prisfil 2026-10-08). */
  withDiscountGroup?: number;
  /** The file has more rows than one import reads (rowLimit). */
  fileTruncated?: boolean; rowLimit?: number;
  /** The company's limit on rows from price files, when this installation has one (2026-11-01). */
  companyRows?: { limit: number; stored: number; replaced: Record<string, number> } | null;
  /** Prisfiler etapp 1 (2026-10-12). */
  errorsByKind?: Record<CatalogueRowErrorKind, number>;
  withCommonNumber?: number; zeroPrices?: number;
  format?: PriceFileInfo; columns?: ColumnSuggestions; parse?: CatalogueParseOptions;
  /** The first rows as read, and the columns the preview used (the suggestion when the file was read anew). */
  sample?: string[][]; mapping?: Record<string, string | null>;
  /** Prisexempel (2026-10-13 natt): rows from the start, middle and end; per supplier id the largest price changes. */
  examples?: CatalogueRow[];
  changes?: Record<string, { articleNo: string; name: string; unit: string; before: number; after: number; amount: number; perQuantity: number }[]>;
  highPrices?: number;
  /** Why the file looks like a discount letter rather than a price list. */
  rebate?: string | null;
  /** A discount letter of a known format (2026-10-14): what it holds and how much of each matching supplier it reaches. */
  rebateFile?: RebatePreview;
};
/** How the person wants the file read and parsed; sent with the preview and the import. */
export type PriceOptions = { format: PriceFileFormat; parse: CatalogueParseOptions };
type SavedFormat = PriceFileFormat & CatalogueParseOptions;
type LatestImport = { fileName: string; date: string; rowCount: number; priceKind: PriceKind; oldest: string | null; newest: string | null;
  /** The supplier's articles with a price of this kind the file did not have (2026-10-15). */ missing?: number };
type Supplier = { id: string; name: string; customerNumber: string; wholesaler?: WholesalerId | null; latestImport?: LatestImport | null; articles: number;
  /** The latest GNP list and net price list, the two price layers (2026-10-15). */ priceLists?: Partial<Record<PriceKind, LatestImport>>;
  /** Articles without an E-nummer, RSK, EAN or manufacturer's number: only this supplier's product (2026-10-15). */ unmatched?: number;
  /** The latest discount letter read in (2026-10-14). */ latestRebate?: { fileName: string; date: string; rules: number } | null; profiles: { fingerprint: string; mapping: CatalogueMapping; format?: SavedFormat | null; updatedAt: string }[] };
type ImportRow = { id: string; fileName: string; supplierName: string; createdAt: string; createdBy: string; rowCount: number; newArticles: number; changedPrices: number; unchangedPrices: number; failedRows: number; prices: number; priceKind?: PriceKind; rebate?: boolean };
type Overview = { gateReasons?: Partial<Record<WholesalerId, ImportGateReason | null>>; suppliers: Supplier[]; imports: ImportRow[]; articles: CatalogueHit[]; articleCount: number; page: number; pageSize: number; access: { read: boolean; pick: boolean; edit: boolean }; today: string };
type ImportResult = { notInCatalogue?: number; unitDiffers?: number; sameArticle?: number; synced?: string | null; fileRows?: string | null; newArticles: number; changedPrices: number; unchangedPrices: number; prices: number; confirmed?: number; failedRows: number; missingArticles?: number; supplier: { id: string; name: string };
  /** A discount letter's rules (2026-10-14). */ groups?: number; articles?: number; netPrices?: number };

/** Artiklar och priser in one plain sentence (2026-10-14); the rest of the facts fold away under it. */
export const CATALOGUE_HELP = "Läs in era prislistor och rabattbrev. Priserna sparas som historik och delas aldrig med andra företag.";
/** The rest of the facts, short sentences, behind Visa mer. */
const CATALOGUE_HELP_MORE = [
  "Ett nytt pris sparas bara när det ändrats. Gamla priser skrivs aldrig över.",
  "Ett oförändrat pris märks som bekräftat på importdagen.",
  "Priser är i kr exkl. moms. Det senaste priset gäller. Bekräftad betyder att en senare fil hade samma pris.",
  "Artiklar som saknas i en ny fil behåller sitt senaste pris.",
  "Utan grossistens artikelkatalog sparas bara filens rader, för ert företag. En ny fil ersätter den förra av samma slag. En rad utan katalog saknar bild och lagersaldo.",
  "Samma produkt hos flera grossister samlas, en rad per grossist. Varje grossist behåller sitt artikelnummer, sin status och sitt pris. Priser jämförs bara för samma enhet och förpackning.",
  "Artikelsöket söker även i Solars katalog. Priset kommer alltid från era egna prisfiler.",
  "Ett rabattbrev räknar om grundpriset till ert nettopris. Leverantörens nettoprislista gäller före det.",
  "Arbetsorder, offert, inköp och fakturaunderlag får en kopia av priset. Den ändras inte efteråt.",
  "Prisfiler skickas aldrig till Workflow AI.",
];

/** The short help and, folded under it, the rest of the facts (the shared CollapsibleSection). */
function CatalogueHelp({ testId }: { testId: string }) {
  const [open, setOpen] = useState(false);
  return <div className="space-y-2" data-testid={testId}>
    <p className="text-xs leading-5 text-muted-foreground">{CATALOGUE_HELP}</p>
    <CollapsibleSection title="Så sparas priserna" summary="Visa mer" open={open} onOpenChange={setOpen} testId={`${testId}-more`}>
      <ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-muted-foreground">{CATALOGUE_HELP_MORE.map((line) => <li key={line}>{line}</li>)}</ul>
    </CollapsibleSection>
  </div>;
}

const NEW = "__new__";
const FIELD_LABEL = Object.fromEntries(CATALOGUE_FIELDS.map((field) => [field.key, field.label]));
const SCALE_LABEL: Record<PriceScale, string> = { 1: "Kronor (som det står)", 100: "Hundradelar – dela med 100", 1000: "Tusendelar – dela med 1 000" };

/** The options a saved profile gives, split into how the file is read and how it is parsed. */
const optionsOf = (saved: SavedFormat | null | undefined): PriceOptions => ({
  format: { ...(saved?.header ? { header: saved.header } : {}), ...(saved?.fixedStarts?.length ? { fixedStarts: saved.fixedStarts } : {}), ...(saved?.sheet ? { sheet: saved.sheet } : {}) },
  parse: { ...(saved?.priceScale && saved.priceScale > 1 ? { priceScale: saved.priceScale } : {}), ...(saved?.articleNoIsENumber ? { articleNoIsENumber: true } : {}) },
});

/** The suppliers and their saved mappings, for the import card; null while loading, an error text when not allowed. */
function useSuppliers(version: number) {
  const [state, setState] = useState<{ suppliers: Supplier[] | null; error: string; canEdit: boolean; gateReasons: Overview["gateReasons"] }>({ suppliers: null, error: "", canEdit: false, gateReasons: {} });
  useEffect(() => {
    let active = true;
    api<Overview>("/api/catalogue?page=1", { cache: "no-store" })
      .then((data) => { if (active) setState({ suppliers: data.suppliers, error: "", canEdit: data.access.edit, gateReasons: data.gateReasons ?? {} }); })
      .catch((cause: Error) => { if (active) setState({ suppliers: [], error: cause.message, canEdit: false, gateReasons: {} }); });
    return () => { active = false; };
  }, [version]);
  return state;
}

const ERROR_KIND_LABEL: Record<CatalogueRowErrorKind, string> = {
  invalid: "Rader som inte kan läsas",
  conflict: "Samma artikelnummer, olika produkter",
  duplicate: "Dubbletter (samma artikel två gånger)",
  shifted: "Förskjutna rader (fel antal fält)",
};

/** The price file on the Import page: supplier, how the file is read, preview with warnings, and import. */
export function CatalogueImportCard({ file, headers, mapping, preview, options, onMapping, onReplan, version, onImported, wholesaler: chosenWholesaler }: {
  /** The file itself: it is sent again for the import, since only its first rows are in the browser (prisfil 2026-10-08). */
  file: File | undefined; headers: string[]; mapping: Record<string, string | null>; preview: CataloguePreview | undefined;
  /** How the file is read and parsed now (the page keeps it with the file). */
  options: PriceOptions;
  onMapping: (mapping: Record<string, string | null>) => void;
  /** Reads the file again with other choices, with these columns – or, with null, the columns suggested for the new reading. */
  onReplan: (mapping: Record<string, string | null> | null, options: PriceOptions) => void;
  version: number; /** Called with a short result text when the import is done; the Import page closes the file card and shows the text once (ART-01). */ onImported: (text: string) => void;
  /** The wholesaler whose box the file was chosen in (Grossistrutorna, 2026-10-13 natt). */
  wholesaler?: WholesalerId | null;
}) {
  const { suppliers, error: supplierError, canEdit, gateReasons } = useSuppliers(version);
  const [supplierId, setSupplierId] = useState("");
  const [newName, setNewName] = useState("");
  const [customerNumber, setCustomerNumber] = useState("");
  const [newWholesaler, setNewWholesaler] = useState<WholesalerId | "">("");
  const [rebateAnyway, setRebateAnyway] = useState(false);
  const [updateNames, setUpdateNames] = useState(false);
  const [saveProfile, setSaveProfile] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [profileNote, setProfileNote] = useState("");
  const [fromProfile, setFromProfile] = useState(false);
  const [checked, setChecked] = useState(false);
  const [startsText, setStartsText] = useState("");
  // Fel fil (2026-10-14): read anyway, as the wholesaler the file is or as the company's own list.
  const [acceptOther, setAcceptOther] = useState(false);
  // Detaljer is folded for a known file and open otherwise, until the person opens or folds it.
  const [detailsOpen, setDetailsOpen] = useState<boolean | undefined>(undefined);
  const fingerprint = preview?.format?.fingerprint ?? "";
  // A saved mapping is applied only when it differs from the columns already chosen (no plan loop).
  const applyMapping = (next: CatalogueMapping) => { if (JSON.stringify(next) !== JSON.stringify(Object.fromEntries(Object.entries(mapping).filter(([key]) => key in next)))) onMapping({ ...Object.fromEntries(Object.keys(mapping).map((key) => [key, null])), ...next }); };
  /** A saved profile: its way of reading the file first (that may change the columns), then its columns. */
  const applyProfile = (profile: Supplier["profiles"][number]) => {
    const saved = optionsOf(profile.format);
    const differs = JSON.stringify(saved.format.fixedStarts ?? null) !== JSON.stringify(preview?.format?.kind === "fixed" ? preview.format.fixedStarts ?? null : null)
      || (saved.format.header && saved.format.header !== (preview?.format?.hasHeader ? "yes" : "no"))
      || JSON.stringify(saved.parse) !== JSON.stringify(options.parse);
    setFromProfile(true);
    if (differs) onReplan({ ...Object.fromEntries(Object.keys(mapping).map((key) => [key, null])), ...profile.mapping }, saved);
    else applyMapping(profile.mapping);
  };

  const choose = (id: string) => {
    setSupplierId(id); setProfileNote("");
    const supplier = suppliers?.find((item) => item.id === id);
    const profile = supplier?.profiles.find((item) => item.fingerprint === fingerprint) ?? supplier?.profiles.find((item) => mappingFits(item.mapping, headers));
    if (supplier && profile) { setProfileNote(`Filen läses och kolumnerna väljs som du sparade för ${supplier.name}.`); applyProfile(profile); }
  };

  // A saved mapping for this file's layout picks its supplier, its way of reading and its columns by itself, once.
  useEffect(() => {
    if (!suppliers || supplierId || !preview) return;
    const match = preview.format ? suppliers.find((supplier) => supplier.profiles.some((profile) => profile.fingerprint === fingerprint)) : undefined;
    const timer = window.setTimeout(() => {
      if (match && !preview.format?.variant) { const profile = match.profiles.find((item) => item.fingerprint === fingerprint)!; setSupplierId(match.id); setProfileNote(`Filen läses och kolumnerna väljs som du sparade för ${match.name}.`); applyProfile(profile); return; }
      // Never a supplier picked by itself (2026-10-13 natt: a Sonepar file could land on Ahlsell) – only when the file
      // or the box says which wholesaler it is: that wholesaler's one account, or a new supplier named after it.
      const known = preview.rebateFile?.format.wholesaler ?? preview.format?.variant?.wholesaler ?? chosenWholesaler ?? null;
      const accounts = known ? suppliers.filter((supplier) => supplier.wholesaler === known) : [];
      if (known && accounts.length === 1) choose(accounts[0].id);
      else if (known && !accounts.length) { setSupplierId(NEW); setNewName(WHOLESALER_LABELS[known]); setNewWholesaler(known); }
      else setSupplierId(suppliers.length ? "" : NEW);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [suppliers, preview?.format, preview?.rebateFile]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const starts = preview?.format?.fixedStarts?.join(", ") ?? "";
    const timer = window.setTimeout(() => setStartsText(starts), 0);
    return () => window.clearTimeout(timer);
  }, [preview?.format?.fixedStarts]);

  const rebateFile = preview?.rebateFile ?? null;
  const run = async () => {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const supplier = supplierId === NEW ? { name: newName, customerNumber, wholesaler: newWholesaler || null } : { id: supplierId };
      const form = new FormData();
      form.set("file", file);
      // Rabattbrev (2026-10-14): the letter is read as rules for the supplier, never as a price list.
      if (rebateFile) form.set("options", JSON.stringify({ supplier, kind: "rebate" }));
      else {
        form.set("options", JSON.stringify({ supplier, mapping, updateNames, saveProfile }));
        // The positions the preview used, so the import reads the file exactly as shown.
        const format: PriceFileFormat = { ...options.format, ...(preview?.format?.kind === "fixed" && preview.format.fixedStarts ? { fixedStarts: preview.format.fixedStarts } : {}) };
        form.set("format", JSON.stringify(format));
        form.set("parse", JSON.stringify(options.parse));
      }
      const done = await api<ImportResult>("/api/catalogue", { method: "POST", body: form });
      setResult(done);
      const n = (value: number) => value.toLocaleString("sv-SE");
      const warn = !rebateFile && done.synced && (done.notInCatalogue || done.unitDiffers) ? ` ${n(done.notInCatalogue ?? 0)} rader fanns inte i katalogen${done.unitDiffers ? `, ${n(done.unitDiffers)} har annan enhet` : ""} och lästes inte in.` : "";
      onImported(`${done.supplier.name}: ${rebateFile ? "rabattbrevet är inläst." : `${n(done.newArticles)} nya, ${n(done.changedPrices)} ändrade och ${n(done.unchangedPrices)} oförändrade priser.`}${warn}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Importen misslyckades."); } finally { setBusy(false); }
  };

  if (supplierError) return <p role="alert" className={cn("rounded-lg border p-3 text-sm", indicatorBadge("warning"))} data-testid="catalogue-import-denied">{supplierError}</p>;
  if (!suppliers) return <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-4 animate-spin" />Hämtar leverantörer…</p>;
  if (!canEdit) return <p role="alert" className={cn("rounded-lg border p-3 text-sm", indicatorBadge("warning"))} data-testid="catalogue-import-denied">Du saknar behörighet att importera artiklar och priser. Företagets administratör kan ge behörigheten Artiklar och priser → Redigera.</p>;
  const count = (value: number) => value.toLocaleString("sv-SE");
  // Kolumnförslag (2026-10-12): a column taken from the content (not its heading) is the person's to confirm.
  const guessed = (preview?.columns?.suggestions ?? []).filter((item) => item.source === "content" && mapping[item.field] === item.column);
  const needsCheck = guessed.length > 0 && !fromProfile;
  const rebate = preview?.rebate ?? null;
  // Rätt fil eller fel fil (2026-10-14): one line that says what the file is, from its content alone.
  const verdict = verdictOf(preview, chosenWholesaler ?? null, count);
  const blocked = verdict.tone === "danger" && !acceptOther;
  const supplierReady = Boolean(supplierId && supplierId !== NEW) || Boolean(newName.trim());
  // A wholesaler without a working catalogue takes the file too (2026-11-01): what happens to it is said here, not first after Importera.
  const gateWholesaler = supplierId === NEW ? newWholesaler || null : suppliers.find((supplier) => supplier.id === supplierId)?.wholesaler ?? null;
  const asOwnRows = !rebateFile && gateWholesaler ? gateReasons?.[gateWholesaler] ?? null : null;
  // The company's limit (2026-11-01): the page says it before the import does. A wholesaler's file takes the place of its previous one; the catalogue's prices are not counted.
  const limits = preview?.companyRows && !rebateFile && (asOwnRows || !gateWholesaler) && supplierId ? preview.companyRows : null;
  const overLimit = Boolean(limits && companyRowsAfter({ stored: limits.stored, replaced: supplierId === NEW ? 0 : limits.replaced[supplierId] ?? 0, fileRows: preview?.rowCount ?? 0, own: !gateWholesaler,
    newArticles: supplierId === NEW ? preview?.rowCount ?? 0 : countsAgainst(preview?.rowCount ?? 0, preview?.bySupplier?.[supplierId]).newArticles }) > limits.limit);
  const ready = Boolean(file && preview && !blocked && supplierReady && !overLimit && (rebateFile ? rebateFile.counts.groups + rebateFile.counts.articles + rebateFile.counts.netPrices > 0
    : !preview.missing.length && preview.rowCount && !preview.fileTruncated && (!needsCheck || checked) && (!rebate || rebateAnyway)));
  // Grundpris eller nettopris (2026-10-13 natt): the person's choice, otherwise what the price column's heading says.
  const priceKind: PriceKind = options.parse.priceKind ?? preview?.columns?.priceKind ?? "NET";
  const changes = preview?.changes && supplierId && supplierId !== NEW ? preview.changes[supplierId] ?? [] : [];
  const perText = (row: { amount: number; perQuantity: number; unit: string }) => `${formatPrice(row.amount)} kr${row.perQuantity !== 1 ? ` / ${count(row.perQuantity)} ${row.unit || "st"}` : row.unit ? ` / ${row.unit}` : ""}`;
  const showGroup = Boolean(mapping.discountGroup);
  // Pris ändrat (2026-10-08): what the import will do with the supplier picked – a new supplier has only new articles.
  const against = preview && !rebateFile && !preview.missing.length && preview.bySupplier && supplierId
    ? countsAgainst(preview.rowCount, supplierId === NEW ? undefined : preview.bySupplier[supplierId]) : null;
  const againstName = supplierId === NEW ? newName.trim() || "den nya leverantören" : suppliers.find((supplier) => supplier.id === supplierId)?.name ?? "";
  const format = preview?.format;
  // Reading the file another way gives other columns: the server suggests them anew. A price scale or E-nummer choice keeps them.
  const replan = (next: Partial<PriceOptions>) => { setFromProfile(false); setChecked(false); onReplan(next.format ? null : mapping, { format: { ...options.format, ...next.format }, parse: { ...options.parse, ...next.parse } }); };
  const scale: PriceScale = options.parse.priceScale ?? 1;
  const eSuggested = preview?.columns?.articleNoLooksLikeENumber;
  const kinds = preview?.errorsByKind;
  const coverage = rebateFile && supplierId && supplierId !== NEW ? rebateFile.coverage[supplierId] : undefined;
  const rebateExamples = rebateFile && supplierId && supplierId !== NEW ? rebateFile.examples[supplierId] ?? [] : [];
  const actionLabel = rebateFile ? "Läs in rabattbrevet" : `Importera ${count(preview?.rowCount ?? 0)}`;
  return <div className="space-y-3" data-testid="catalogue-import">
    {/* After a done import only the result stays: the verdict and the file's details belong to the file that was just read (ART-01). */}
    {preview && !result ? <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border p-3 text-sm", indicatorBadge(verdict.tone))} data-testid="catalogue-verdict" data-verdict={verdict.tone === "success" ? "right" : verdict.tone === "danger" ? "wrong" : "unknown"}>
      {verdict.tone === "success" ? <CheckCircle2 className="size-4 shrink-0" /> : <AlertTriangle className="size-4 shrink-0" />}
      <span className="min-w-0 flex-1 font-medium">{verdict.text}</span>
      {verdict.tone === "danger" && !acceptOther ? <Button type="button" size="sm" variant="outline" onClick={() => { setAcceptOther(true); if (!verdict.other) setDetailsOpen(true); }} data-testid="catalogue-verdict-accept">{verdict.other ? `Läs in som ${WHOLESALER_LABELS[verdict.other]}` : "Läs in ändå"}</Button> : null}
    </div> : null}

    {/* Leverantören: one row; the file or the box chooses it when it can. */}
    <div className="field-group grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
      <label className="grid gap-1 text-xs font-medium">Leverantör
        <select className="form-select h-9" value={supplierId} onChange={(event) => choose(event.target.value)} aria-label="Leverantör" data-testid="catalogue-supplier">
          {supplierId === "" ? <option value="" disabled>Välj leverantör…</option> : null}
          {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}{supplier.customerNumber ? ` (kundnr ${supplier.customerNumber})` : ""}</option>)}
          <option value={NEW}>Ny leverantör…</option>
        </select></label>
      {supplierId === NEW ? <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-medium">Namn<Input value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={120} placeholder="Leverantörens namn" aria-label="Ny leverantörs namn" data-testid="catalogue-supplier-name" /></label>
        <label className="grid gap-1 text-xs font-medium">Ert kundnummer (valfritt)<Input value={customerNumber} onChange={(event) => setCustomerNumber(event.target.value)} maxLength={60} aria-label="Kundnummer hos leverantören" /></label>
        <label className="grid gap-1 text-xs font-medium sm:col-span-2">Grossist
          <select className="form-select h-9" value={newWholesaler} onChange={(event) => setNewWholesaler(event.target.value as WholesalerId | "")} aria-label="Grossist" data-testid="catalogue-supplier-wholesaler">
            <option value="">Annan leverantör</option>
            {WHOLESALERS.map((id) => <option key={id} value={id}>{WHOLESALER_LABELS[id]}</option>)}
          </select></label>
      </div> : null}
    </div>

    {/* Rabattbrev (2026-10-14): what the letter reaches and three prices before and after, then one button. */}
    {rebateFile ? <div className="space-y-2 rounded-lg border p-3 text-sm" data-testid="catalogue-rebate-preview">
      <p>{[rebateFile.counts.groups ? `${count(rebateFile.counts.groups)} grupprabatter` : "", rebateFile.counts.articles ? `${count(rebateFile.counts.articles)} artikelrabatter` : "", rebateFile.counts.netPrices ? `${count(rebateFile.counts.netPrices)} nettopriser` : ""].filter(Boolean).join(" · ")}{rebateFile.errorCount ? ` · ${count(rebateFile.errorCount)} rader kan inte läsas` : ""}</p>
      {coverage ? <p data-testid="catalogue-rebate-coverage">Gäller {count(coverage.covered)} av {count(coverage.articles)} artiklar hos {againstName}.</p>
        : <p className="text-muted-foreground">Läs in grossistens prislista också – nettopriset räknas från dess grundpris.</p>}
      {rebateExamples.length ? <ul className="divide-y" data-testid="catalogue-rebate-examples">{rebateExamples.map((item) => <li key={`${item.articleNo}-${item.name}`} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1">
        <span className="min-w-0"><span className="text-xs text-muted-foreground">{item.articleNo || "–"} · </span>{item.name}</span>
        <span className="tabular-nums">{formatPrice(item.basePrice)} → <strong>{formatPrice(item.netPrice)} kr</strong>{item.unit ? `/${item.unit}` : ""} <span className="text-xs text-muted-foreground">(−{String(item.percent).replace(".", ",")} %)</span></span>
      </li>)}</ul> : null}
      {rebateFile.errors.length ? <ul className="space-y-0.5 text-xs text-amber-800">{rebateFile.errors.slice(0, 5).map((item) => <li key={item.line}>Rad {item.line}: {item.message}</li>)}</ul> : null}
    </div> : null}

    {preview && (rebateFile || !preview.missing.length) && !result ? <div className="flex flex-wrap items-center gap-2">
      <Button type="button" disabled={busy || !ready} onClick={() => void run()} data-testid="catalogue-apply">{busy ? <LoaderCircle className="animate-spin" /> : <Upload />}{actionLabel}</Button>
      {overLimit && limits ? <span role="alert" className={cn("rounded-lg border p-2 text-xs", indicatorBadge("warning"))} data-testid="catalogue-over-limit">{companyRowLimitMessage(limits.limit)}</span> : null}
      {asOwnRows ? <span className="w-full text-xs text-muted-foreground" data-testid="catalogue-own-rows">Bara filens rader sparas, för ert företag. En ny fil ersätter den förra av samma slag.</span> : null}
      {against ? <span className="text-xs text-muted-foreground" data-testid="catalogue-preview-against">{count(against.newArticles)} nya · {count(against.changedPrices)} ändrade · {count(against.unchangedPrices)} oförändrade priser</span> : null}
    </div> : null}
    {/* A large file takes a while on the server (prisfil 2026-10-08): the wait is said, not just a spinning icon. */}
    {busy && !rebateFile && preview ? <p role="status" className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm" data-testid="catalogue-importing"><LoaderCircle className="size-4 animate-spin text-primary" />Importerar {count(preview.rowCount)} artiklar{preview.rowCount > 100_000 ? " – det kan ta någon minut" : ""}. Stäng inte sidan.</p> : null}
    {error ? <p role="alert" className={cn("rounded-lg border p-3 text-sm", indicatorBadge("danger"))}>{error}</p> : null}
    {result ? <p role="status" className={cn("rounded-lg border p-3 text-sm", indicatorBadge(result.failedRows ? "warning" : "success"))} data-testid="catalogue-result">
      <CheckCircle2 className="mr-1 inline size-4" />{result.supplier.name}: {rebateFile
        ? `rabattbrevet är inläst (${count(result.groups ?? 0)} grupprabatter, ${count(result.articles ?? 0)} artikelrabatter, ${count(result.netPrices ?? 0)} nettopriser). Sökningen visar nu era nettopriser.`
        : `${count(result.newArticles)} nya artiklar, ${count(result.changedPrices)} ändrade och ${count(result.unchangedPrices)} oförändrade priser${result.failedRows ? `, ${plural(result.failedRows, "rad", "rader")} med fel hoppades över` : ""}.${result.missingArticles ? (result.fileRows ? ` ${count(result.missingArticles)} tidigare artiklar fanns inte med i filen och har inget pris längre.` : ` ${count(result.missingArticles)} tidigare artiklar fanns inte med i filen – de behåller sitt senaste pris och märks i sökningen.`) : ""}`}
      {/* Synkad mot grossistens katalog (2026-10-17): what the file had that the catalogue does not. */}
      {!rebateFile && result.synced && (result.notInCatalogue || result.unitDiffers || result.sameArticle) ? <span className="mt-1 block" data-testid="catalogue-result-sync">
        {result.notInCatalogue ? `${plural(result.notInCatalogue, "rad", "rader", count)} fanns inte i grossistens katalog och lästes inte in. ` : ""}
        {result.unitDiffers ? `${plural(result.unitDiffers, "rad", "rader", count)} har samma E-nummer som en katalogartikel men en annan enhet och lästes inte in – kontrollera dem. ` : ""}
        {result.sameArticle ? `${plural(result.sameArticle, "rad", "rader", count)} gällde en katalogartikel som en tidigare rad i filen redan har prissatt, och lästes inte in. ` : ""}
      </span> : null}
    </p> : null}

    {/* Detaljer (2026-10-14: "ingen hel uppsats"): how the file is read, the columns and the rows – folded for a known file. */}
    {preview && !rebateFile && !result ? <CollapsibleSection title="Detaljer" summary="Hur filen läses, prisexempel och raderna" open={detailsOpen ?? !verdict.known} onOpenChange={setDetailsOpen} testId="catalogue-details">
      {profileNote ? <p className="text-xs text-muted-foreground" data-testid="catalogue-profile-note">{profileNote}</p> : null}
      {rebate ? <label className="flex items-center gap-2 text-xs" data-testid="catalogue-rebate"><input type="checkbox" checked={rebateAnyway} onChange={(event) => setRebateAnyway(event.target.checked)} data-testid="catalogue-rebate-anyway" />Det är en prislista – läs in den ändå</label> : null}
      {format ? <div className="grid gap-3 sm:grid-cols-2" data-testid="catalogue-format">
        <p className="text-xs sm:col-span-2"><span className="font-medium">Så läses filen: </span>{format.kind === "xlsx" ? `Excel${format.sheet ? `, bladet ${format.sheet}` : ""}` : format.kind === "fixed" ? `text med fast kolumnbredd, ${format.lineLength} tecken per rad` : `text med kolumner åtskilda av ${format.separator === "\t" ? "tabb" : `”${format.separator}”`}`}{format.encoding ? ` · ${format.encoding === "windows-1252" ? "Windows-1252" : format.encoding.toUpperCase()}` : ""} · {format.hasHeader ? "första raden är rubriker" : "ingen rubrikrad"}</p>
        {format.kind !== "fixed" ? <label className="grid gap-1 text-xs font-medium">Rubrikrad
          <select className="form-select h-9" value={options.format.header ?? "auto"} onChange={(event) => replan({ format: { header: event.target.value as "auto" | "yes" | "no" } })} aria-label="Rubrikrad" data-testid="catalogue-header">
            <option value="auto">Avgör från innehållet{format.headerGuess ? " (rubriker)" : " (ingen rubrik)"}</option>
            <option value="yes">Första raden är rubriker</option>
            <option value="no">Filen saknar rubrikrad</option>
          </select></label> : <div className="grid gap-1 text-xs font-medium sm:col-span-2">
          <label htmlFor="catalogue-fixed-starts">Kolumnernas första tecken (1 = radens början)</label>
          <div className="flex flex-wrap gap-2">
            <Input id="catalogue-fixed-starts" className="h-9 min-w-48 flex-1" value={startsText} onChange={(event) => setStartsText(event.target.value)} placeholder="1, 21, 33" data-testid="catalogue-fixed-starts" />
            <Button type="button" size="sm" variant="outline" onClick={() => replan({ format: { fixedStarts: parseStarts(startsText) } })} data-testid="catalogue-fixed-apply">Läs om</Button>
            {format.suggestedStarts && JSON.stringify(format.suggestedStarts) !== JSON.stringify(format.fixedStarts) ? <Button type="button" size="sm" variant="ghost" onClick={() => replan({ format: { fixedStarts: format.suggestedStarts } })}>Använd förslaget</Button> : null}
          </div>
        </div>}
        <label className="grid gap-1 text-xs font-medium">Priserna i filen är
          <select className="form-select h-9" value={priceKind} onChange={(event) => replan({ parse: { priceKind: event.target.value as PriceKind } })} aria-label="Priserna i filen är" data-testid="catalogue-price-kind">
            {PRICE_KINDS.map((kind) => <option key={kind} value={kind}>{PRICE_KIND_LABELS[kind]}</option>)}
          </select></label>
        <label className="grid gap-1 text-xs font-medium">Priset i filen
          <select className="form-select h-9" value={String(scale)} onChange={(event) => replan({ parse: { priceScale: Number(event.target.value) as PriceScale } })} aria-label="Priset i filen" data-testid="catalogue-price-scale">
            {PRICE_SCALES.map((value) => <option key={value} value={value}>{SCALE_LABEL[value]}</option>)}
          </select></label>
        {mapping.articleNo && !mapping.eNumber && !options.parse.eNumberRule ? <label className="flex items-start gap-2 text-xs sm:col-span-2">
          <input type="checkbox" className="mt-0.5" checked={Boolean(options.parse.articleNoIsENumber)} onChange={(event) => replan({ parse: { articleNoIsENumber: event.target.checked } })} data-testid="catalogue-article-e" />
          <span>Artikelnumret är E-nummer (sju siffror){eSuggested ? ` – ${Math.round(eSuggested.share * 100)} % har den formen` : ""}</span>
        </label> : null}
        <label className="flex items-center gap-2 text-xs sm:col-span-2"><input type="checkbox" checked={saveProfile} onChange={(event) => setSaveProfile(event.target.checked)} />Spara valen för leverantören</label>
        <label className="flex items-center gap-2 text-xs sm:col-span-2"><input type="checkbox" checked={updateNames} onChange={(event) => setUpdateNames(event.target.checked)} />Uppdatera benämning och enhet på befintliga artiklar</label>
        {preview.sample?.length && (format.kind === "fixed" || !format.hasHeader) ? <div className="overflow-auto rounded-lg border sm:col-span-2" data-testid="catalogue-raw">
          <table className="w-full border-collapse text-xs">
            <thead><tr className="bg-[var(--panel-header)] text-left">{format.headers.map((header) => <th key={header} className="whitespace-nowrap border-b px-2 py-1.5 font-semibold">{header}</th>)}</tr></thead>
            <tbody>{preview.sample.slice(0, 3).map((row, index) => <tr key={index} className="border-b last:border-b-0">{row.map((value, column) => <td key={column} className="whitespace-nowrap px-2 py-1 font-mono">{value || "–"}</td>)}</tr>)}</tbody>
          </table>
        </div> : null}
      </div> : null}

      {guessed.length ? <div className={cn("rounded-lg border p-3 text-sm", indicatorBadge("warning"))} data-testid="catalogue-guessed">
        <p className="font-medium">Kolumner föreslagna från innehållet</p>
        <ul className="mt-1 space-y-0.5 text-xs">{guessed.map((item) => <li key={item.field}>{FIELD_LABEL[item.field] ?? item.field}: <strong>{item.column}</strong> – {item.reason}</li>)}</ul>
        {needsCheck ? <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} data-testid="catalogue-guessed-ok" />Jag har kontrollerat kolumnerna</label> : null}
      </div> : null}

      {preview.previous ? <p className="text-xs text-muted-foreground">Samma innehåll importerades {preview.previous.date} ({preview.previous.supplierName}). Oförändrade priser märks bara som bekräftade.</p> : null}
      {preview.missing.length ? <p className={cn("rounded-lg border p-3 text-sm", indicatorBadge("warning"))} data-testid="catalogue-missing">Välj kolumn för: {preview.missing.join(", ")} (Kolumner → fält ovanför).</p> : null}
      {!preview.missing.length ? <div data-testid="catalogue-preview">
        <p className="text-sm" data-testid="catalogue-preview-count"><strong>{count(preview.rowCount)}</strong> {preview.rowCount === 1 ? "artikel" : "artiklar"} med pris{preview.withCommonNumber ? ` · ${count(preview.withCommonNumber)} med E- eller RSK-nummer` : ""}{preview.errorCount ? ` · ${plural(preview.errorCount, "rad", "rader", count)} importeras inte` : ""}{preview.zeroPrices ? ` · ${count(preview.zeroPrices)} utan pris (0 kr)` : ""}</p>
        {preview.examples?.length ? <div className="mt-2 rounded-lg border p-3" data-testid="catalogue-examples">
          <p className="text-sm font-medium">Prisexempel{priceKind === "BASE" ? ` · ${BASE_PRICE_NOTE.toLowerCase()}` : ""}</p>
          <ul className="mt-1 divide-y text-sm">{preview.examples.map((row) => <li key={row.line} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1" data-testid="catalogue-example">
            <span className="min-w-0"><span className="text-xs text-muted-foreground">{row.articleNo || (row.eNumber ? `E ${row.eNumber}` : "–")} · </span>{row.name}</span>
            <span className="tabular-nums">{perText(row)}</span>
          </li>)}</ul>
        </div> : null}
        {changes.length ? <div className="mt-2 rounded-lg border p-3" data-testid="catalogue-changes">
          <p className="text-sm font-medium">Största prisändringarna mot {againstName}</p>
          <ul className="mt-1 divide-y text-sm">{changes.map((change) => {
            const percent = Math.round(((change.after - change.before) / change.before) * 100);
            return <li key={`${change.articleNo}-${change.name}`} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1" data-testid="catalogue-change">
              <span className="min-w-0"><span className="text-xs text-muted-foreground">{change.articleNo || "–"} · </span>{change.name}</span>
              <span className="tabular-nums">{formatPrice(change.before)} → {formatPrice(change.after)} kr/{change.unit || "st"} <span className={cn("ml-1 rounded-full px-1.5 py-0.5 text-xs", indicatorBadge(Math.abs(percent) >= 50 ? "warning" : "neutral"))}>{percent > 0 ? "+" : ""}{percent} %</span></span>
            </li>;
          })}</ul>
        </div> : null}
        {preview.highPrices ? <p className={cn("mt-2 rounded-lg border p-3 text-sm", indicatorBadge("warning"))} data-testid="catalogue-high">{count(preview.highPrices)} artiklar kostar över 10 miljoner kr – kontrollera dem.</p> : null}
        {preview.fileTruncated ? <p role="alert" className={cn("mt-2 rounded-lg border p-3 text-sm", indicatorBadge("warning"))} data-testid="catalogue-too-many">Filen har fler än {count(preview.rowLimit ?? 0)} rader. Dela upp den.</p> : null}
        <div className="mt-2 max-h-96 overflow-auto rounded-lg border">
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <thead><tr className="bg-[var(--panel-header)] text-left text-xs"><th className="border-b px-2 py-2 font-semibold">Rad</th><th className="border-b px-2 py-2 font-semibold">Art.nr</th><th className="border-b px-2 py-2 font-semibold">E/RSK</th><th className="border-b px-2 py-2 font-semibold">Benämning</th><th className="border-b px-2 py-2 font-semibold">Enhet</th>{showGroup ? <th className="border-b px-2 py-2 font-semibold">Rabattgrupp</th> : null}<th className="border-b px-2 py-2 text-right font-semibold">Pris</th><th className="border-b px-2 py-2 font-semibold">Prisdatum</th></tr></thead>
            <tbody>{preview.rows.map((row) => <tr key={row.line} className="border-b last:border-b-0 align-top" data-testid="catalogue-preview-row">
              <td className="px-2 py-1.5 text-xs text-muted-foreground">{row.line}</td>
              <td className="px-2 py-1.5 text-xs">{row.articleNo || "–"}</td>
              <td className="px-2 py-1.5 text-xs">{row.eNumber ? `E ${row.eNumber}` : row.rskNumber ? `RSK ${row.rskNumber}` : "–"}</td>
              <td className="px-2 py-1.5">{row.name}{row.warnings.map((warning) => <span key={warning} className="block text-xs text-amber-700">{warning}</span>)}</td>
              <td className="px-2 py-1.5 text-xs">{row.unit || "–"}</td>
              {showGroup ? <td className="px-2 py-1.5 text-xs">{row.discountGroup || "–"}</td> : null}
              <td className="px-2 py-1.5 text-right tabular-nums">{formatPrice(row.amount)}{row.perQuantity !== 1 ? ` / ${row.perQuantity}` : ""}</td>
              <td className="px-2 py-1.5 text-xs">{row.priceDate}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {preview.errors.length ? <details className="mt-2 rounded-lg border p-3 text-sm" open={!preview.rowCount || Boolean(kinds?.conflict)} data-testid="catalogue-errors">
          <summary className="cursor-pointer font-medium text-amber-800">Rader som inte importeras ({count(preview.errorCount)})</summary>
          {(["conflict", "shifted", "duplicate", "invalid"] as CatalogueRowErrorKind[]).map((kind) => {
            const items = preview.errors.filter((item) => (item.kind ?? "invalid") === kind);
            const total = kinds?.[kind] ?? items.length;
            if (!total) return null;
            return <div key={kind} className="mt-2" data-testid={`catalogue-errors-${kind}`}>
              <p className="text-xs font-semibold">{ERROR_KIND_LABEL[kind]} ({count(total)})</p>
              <ul className="mt-1 space-y-0.5 text-xs">{items.slice(0, 50).map((item) => <li key={`${item.line}-${item.message}`}>Rad {item.line}: {item.message}</li>)}</ul>
              {total > Math.min(50, items.length) ? <p className="mt-1 text-xs text-muted-foreground">… och {count(total - Math.min(50, items.length))} till.</p> : null}
            </div>;
          })}
        </details> : null}
      </div> : null}
    </CollapsibleSection> : null}
  </div>;
}

/**
 * Grossistrutorna (2026-10-13 natt, docs/proposals/grossist-api-och-prisimport-2026-10-13.md 4): Solar, Ahlsell,
 * Sonepar and Rexel as four boxes of one shared component, each with what the company has read from that wholesaler – the
 * latest file, its price dates and whether the prices are base prices (no discount letter yet) – and Välj fil, which
 * reads the file on this page with the wholesaler chosen. A company with two accounts at one wholesaler has one supplier
 * per account. Nothing is fetched from the wholesalers; the prices come from the company's own files, and a file can always be read in (2026-11-01).
 */
function WholesalerBox({ wholesaler, accounts, canEdit, reason, onPick }: { wholesaler: WholesalerId; accounts: Supplier[]; canEdit: boolean;
  /** Why the wholesaler has no working catalogue, null when it has one. */ reason?: ImportGateReason | null; onPick: (files: File[], wholesaler: WholesalerId) => void }) {
  const [dragging, setDragging] = useState(false);
  // Rätt fil eller fel fil (2026-10-14): a price list or a discount letter is always a table (Excel, CSV or text);
  // anything else dropped here is said to be wrong at once instead of going on to the page's general import.
  const [wrong, setWrong] = useState("");
  const label = WHOLESALER_LABELS[wholesaler];
  const take = (files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (!/\.(xlsx|xlsm|csv|tsv|txt)$/i.test(file.name)) { setWrong(`Fel fil – ${file.name} är inte en prislista eller ett rabattbrev. Välj grossistens Excel-, CSV- eller textfil.`); return; }
    setWrong("");
    onPick([file], wholesaler);
  };
  const read = accounts.filter((account) => account.latestImport);
  const linked = accounts.reduce((sum, account) => sum + account.articles, 0);
  // The same dashed edge as the page's drop area (2026-10-14): a file can be dropped here too.
  return <div className={cn("flex min-w-0 flex-col gap-2 rounded-xl border-2 border-dashed bg-card p-3 transition-colors", dragging && "border-primary bg-secondary/60")} data-testid={`wholesaler-box-${wholesaler}`}
    onDragOver={canEdit ? (event) => { event.preventDefault(); setDragging(true); } : undefined} onDragLeave={() => setDragging(false)}
    onDrop={canEdit ? (event) => { event.preventDefault(); setDragging(false); take([...event.dataTransfer.files]); } : undefined}>
    <h3 className="text-sm font-semibold">{label}</h3>
    {/* Short texts only (2026-10-17); the server's longer message stays in the API, not in the box. */}
    {/* What is true (användartest 2026-10-31, S3): the shared article catalogue, never prices through an API. */}
    <p className="text-xs text-muted-foreground" data-testid="wholesaler-status">{wholesalerBoxText(wholesaler, reason ?? null)}</p>
    {/* How many of the company's articles the wholesaler's price files have: linked to its catalogue when it has one, otherwise the file's own rows (2026-11-01). */}
    {reason ? (linked ? <p className="text-xs text-muted-foreground" data-testid={`wholesaler-rows-${wholesaler}`}>{linked.toLocaleString("sv-SE")} {linked === 1 ? "artikel" : "artiklar"} från prisfil</p> : null)
      : <p className="text-xs text-muted-foreground" data-testid={`wholesaler-linked-${wholesaler}`}>{linked.toLocaleString("sv-SE")} {linked === 1 ? "kopplad artikel" : "kopplade artiklar"} mot prisfil</p>}
    {read.map((account) => {
        const latest = account.latestImport!;
        const rebate = account.latestRebate;
        // GNP, nettoprislista och rabattbrev are three layers of one supplier (2026-10-15): each is read in and replaced on
        // its own; a net price list's prices go before the GNP list's, and the letter turns the GNP prices into net prices.
        const base = account.priceLists?.BASE ?? (latest.priceKind === "BASE" ? latest : undefined);
        const net = account.priceLists?.NET ?? (latest.priceKind !== "BASE" ? latest : undefined);
        const state = net ? { tone: "success" as const, text: base ? "Nettoprislista före grundpris" : "Nettoprislista" } : rebate ? { tone: "success" as const, text: "Nettopriser via rabattbrevet" } : { tone: "warning" as const, text: "Grundpris – rabattbrev saknas" };
        const missing = (list?: LatestImport) => list?.missing ? ` · ${list.missing.toLocaleString("sv-SE")} fanns inte med` : "";
        return <div key={account.id} className="space-y-1 text-xs" data-testid="wholesaler-account">
          {read.length > 1 || account.customerNumber ? <p className="font-medium">{account.name}{account.customerNumber ? ` · kundnr ${account.customerNumber}` : ""}</p> : null}
          {base ? <p className="text-muted-foreground" data-testid="wholesaler-base">Grundprislista (GNP) {base.date} · {base.rowCount.toLocaleString("sv-SE")} rader{missing(base)}</p> : null}
          {net ? <p className="text-muted-foreground" data-testid="wholesaler-net">Nettoprislista {net.date} · {net.rowCount.toLocaleString("sv-SE")} rader{missing(net)}</p> : null}
          {rebate ? <p className="text-muted-foreground" data-testid="wholesaler-rebate">Rabattbrev {rebate.date} · {rebate.rules.toLocaleString("sv-SE")} rabatter</p> : null}
          {account.unmatched ? <p className="text-muted-foreground" data-testid="wholesaler-unmatched">{account.unmatched.toLocaleString("sv-SE")} artiklar utan E-nummer, RSK, EAN eller tillverkarnummer – jämförs inte med andra grossister</p> : null}
          <p className={cn("w-fit rounded-full px-2 py-0.5", indicatorBadge(state.tone))} data-testid="wholesaler-kind">{state.text}</p>
        </div>;
      })}
    {/* The same blue button as the page's Välj filer (2026-10-14), in the middle of the box (2026-10-17): the free room under the texts, so the boxes' buttons stand level; the data-slot gives it the shared touch height. */}
    {canEdit ? <div className="flex flex-1 items-center justify-center py-2" data-testid={`wholesaler-pick-area-${wholesaler}`}><label className={cn(buttonVariants(), "cursor-pointer")} data-slot="button" data-variant="default" data-size="default" data-testid={`wholesaler-pick-${wholesaler}`}><Upload />Välj fil
      <input type="file" className="sr-only" accept=".xlsx,.xlsm,.csv,.tsv,.txt" aria-label={`Välj prisfil från ${label}`} onChange={(event) => { const files = [...(event.target.files ?? [])]; event.target.value = ""; take(files); }} /></label></div> : null}
    {wrong ? <p role="alert" className={cn("rounded-lg border p-2 text-xs", indicatorBadge("danger"))} data-testid="wholesaler-wrong-file">{wrong}</p> : null}
  </div>;
}

/** The company's catalogue on the Import page: suppliers, imports (removable) and articles with their latest price. */
export function CataloguePanel({ version, onChanged, onPick }: { version: number; onChanged: () => void;
  /** A file chosen or dropped in a wholesaler's box: read on the page with that wholesaler chosen. */ onPick?: (files: File[], wholesaler: WholesalerId) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [hidden, setHidden] = useState(false);
  const [query, setQuery] = useState("");
  const [supplierId, setSupplierId] = useState("");
  // Omatchade artiklar och artiklar som saknas i senaste prisfilen (2026-10-15): a narrowing of the list.
  const [filter, setFilter] = useState<"" | "unmatched" | "missing">("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string; customerNumber: string; wholesaler: WholesalerId | null } | null>(null);
  const [confirm, confirmElement] = useConfirm();

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (query.trim()) params.set("q", query.trim());
      if (supplierId) params.set("supplierId", supplierId);
      if (filter) params.set("filter", filter);
      setData(await api<Overview>(`/api/catalogue?${params}`, { cache: "no-store" })); setHidden(false);
    } catch (cause) { if ((cause as { status?: number }).status === 403 || (cause as { status?: number }).status === 409) setHidden(true); else setError((cause as Error).message); }
  }, [page, query, supplierId, filter]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer); }, [load, version]);

  if (hidden || !data) return null;
  const canEdit = data.access.edit;
  const act = async (body: Record<string, unknown>) => {
    setBusy(true); setError("");
    try { await api("/api/catalogue", { method: "POST", body: JSON.stringify(body) }); onChanged(); await load(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Åtgärden misslyckades."); return false; } finally { setBusy(false); }
  };
  const removeImport = async (item: ImportRow) => {
    if (!(await confirm({ title: "Ta bort importen?", message: `Priserna från ${item.fileName} tas bort ur katalogen. Artiklar som då saknar pris tas också bort. Offerter, inköp och arbetsordrar behåller de priser de redan fått.`, confirmLabel: "Ta bort", tone: "danger" }))) return;
    if (await act({ action: "delete_import", id: item.id })) announce("Importen är borttagen.");
  };
  const removeSupplier = async (supplier: Supplier) => {
    if (!(await confirm({ title: "Ta bort leverantören?", message: `${supplier.name} tas bort med ${supplier.articles} artiklar, alla priser, importer, rabattbrev och sparade kolumnval. Det går inte att ångra. Arbetsordrar behåller de priser de redan fått.`, confirmLabel: "Ta bort", tone: "danger" }))) return;
    if (supplierId === supplier.id) setSupplierId("");
    if (await act({ action: "delete_supplier", id: supplier.id })) announce("Leverantören är borttagen.");
  };
  const pages = Math.max(1, Math.ceil(data.articleCount / data.pageSize));
  return <div data-testid="catalogue-panel"><Panel icon={Tags} title="Artiklar och priser" description="Företagets katalog från egna prisfiler. Släpp en prisfil ovanför för att lägga till priser.">
    <div className="space-y-4">
      <CatalogueHelp testId="catalogue-panel-help" />
      {error ? <p role="alert" className={cn("rounded-lg border p-3 text-sm", indicatorBadge("danger"))}>{error}</p> : null}
      {onPick ? <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4" data-testid="wholesaler-boxes">
        {WHOLESALERS.map((id) => <WholesalerBox key={id} wholesaler={id} accounts={data.suppliers.filter((supplier) => supplier.wholesaler === id)} canEdit={canEdit} reason={data.gateReasons?.[id] ?? null} onPick={onPick} />)}
      </div> : null}
      {!data.suppliers.length ? <p className="text-sm text-muted-foreground">Inga leverantörer ännu. Släpp en prisfil i rutan ovanför.</p> : <>
        <div>
          <h3 className="text-sm font-semibold">Leverantörer</h3>
          <ul className="mt-2 divide-y rounded-lg border">{data.suppliers.map((supplier) => <li key={supplier.id} className="flex flex-wrap items-center gap-2 p-3 text-sm" data-testid="catalogue-supplier-row">
            {editing?.id === supplier.id ? <>
              <Input className="h-9 max-w-56" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} maxLength={120} aria-label="Leverantörens namn" />
              <Input className="h-9 max-w-40" value={editing.customerNumber} onChange={(event) => setEditing({ ...editing, customerNumber: event.target.value })} maxLength={60} placeholder="Kundnummer" aria-label="Kundnummer" />
              <select className="form-select h-9 w-auto" value={editing.wholesaler ?? ""} onChange={(event) => setEditing({ ...editing, wholesaler: (event.target.value || null) as WholesalerId | null })} aria-label="Grossist">
                <option value="">Annan leverantör</option>{WHOLESALERS.map((id) => <option key={id} value={id}>{WHOLESALER_LABELS[id]}</option>)}
              </select>
              <Button type="button" size="sm" disabled={busy} onClick={() => void act({ action: "update_supplier", ...editing }).then(() => setEditing(null))}>Spara</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Avbryt</Button>
            </> : <>
              <Tags className="size-4 text-primary" />
              <span className="min-w-0 flex-1 truncate font-medium">{supplier.name}{supplier.wholesaler && !supplier.name.toLowerCase().includes(WHOLESALER_LABELS[supplier.wholesaler].toLowerCase()) ? <span className="ml-2 text-xs font-normal text-muted-foreground">{WHOLESALER_LABELS[supplier.wholesaler]}</span> : null}{supplier.customerNumber ? <span className="ml-2 text-xs font-normal text-muted-foreground">kundnr {supplier.customerNumber}</span> : null}</span>
              <span className="text-xs text-muted-foreground">{supplier.wholesaler && !data.gateReasons?.[supplier.wholesaler] ? `${supplier.articles} ${supplier.articles === 1 ? "kopplad artikel" : "kopplade artiklar"} mot prisfil` : `${supplier.articles} ${supplier.articles === 1 ? "artikel" : "artiklar"}`}</span>
              {canEdit ? <><IconButton label={`Ändra ${supplier.name}`} disabled={busy} onClick={() => setEditing({ id: supplier.id, name: supplier.name, customerNumber: supplier.customerNumber, wholesaler: supplier.wholesaler ?? null })}><Pencil /></IconButton>
                <RemoveButton label={`Ta bort ${supplier.name}`} disabled={busy} onClick={() => void removeSupplier(supplier)} /></> : null}
            </>}
          </li>)}</ul>
        </div>
        {data.imports.length ? <details className="rounded-lg border p-3 text-sm" data-testid="catalogue-imports">
          <summary className="cursor-pointer font-medium">Importer ({data.imports.length}{data.imports.length >= 20 ? ", de senaste" : ""})</summary>
          <ul className="mt-2 divide-y">{data.imports.map((item) => <li key={item.id} className="flex flex-wrap items-center gap-2 py-2" data-testid="catalogue-import-row">
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{item.fileName}</span><span className="block text-xs text-muted-foreground">{item.supplierName} · {item.createdAt.slice(0, 10)}{item.createdBy ? ` · ${item.createdBy}` : ""} · {item.rebate ? `rabattbrev, ${item.rowCount} rader` : `${item.newArticles} nya artiklar, ${item.changedPrices} ändrade priser, ${item.unchangedPrices} bekräftade`}{item.failedRows ? `, ${item.failedRows} rader med fel` : ""}</span></span>
            {canEdit ? <Button type="button" size="sm" variant="ghost" disabled={busy} aria-label={`Ta bort importen ${item.fileName}`} onClick={() => void removeImport(item)}><Trash2 />Ta bort</Button> : null}
          </li>)}</ul>
        </details> : null}
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Sök benämning, artikelnummer eller E-nummer…" className="pl-9" aria-label="Sök i katalogen" /></div>
            <select className="form-select w-auto" value={supplierId} onChange={(event) => { setSupplierId(event.target.value); setPage(1); }} aria-label="Visa leverantör"><option value="">Alla leverantörer</option>{data.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select>
            <select className="form-select w-auto" value={filter} onChange={(event) => { setFilter(event.target.value as typeof filter); setPage(1); }} aria-label="Visa artiklar" data-testid="catalogue-filter">
              <option value="">Alla artiklar</option>
              <option value="unmatched">Utan gemensamt nummer (jämförs inte)</option>
              <option value="missing">Saknas i senaste prisfilen</option>
            </select>
          </div>
          {filter === "unmatched" ? <p className="mt-2 text-xs text-muted-foreground" data-testid="catalogue-filter-note">Artiklar utan E-nummer, RSK, EAN eller tillverkarens nummer kan inte jämföras med samma vara hos en annan grossist. Lägg till numret i filen så matchas de nästa gång.</p> : null}
          {filter === "missing" ? <p className="mt-2 text-xs text-muted-foreground" data-testid="catalogue-filter-note">Artiklar som leverantörens senaste prisfil inte hade med. De behåller sitt senaste pris. Kontrollera med grossisten om de har utgått.</p> : null}
          {data.articles.length ? <div className="mt-2 overflow-auto rounded-lg border"><table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead><tr className="bg-[var(--panel-header)] text-left text-xs"><th className="border-b px-2 py-2 font-semibold">Artikel</th><th className="border-b px-2 py-2 font-semibold">Leverantör</th><th className="border-b px-2 py-2 text-right font-semibold">À-pris</th><th className="border-b px-2 py-2 font-semibold">Källa och prisdatum</th></tr></thead>
            <tbody>{data.articles.map((article) => {
              const hint = article.price ? priceAgeHint(article.price, data.today) : "";
              return <tr key={article.id} className="border-b last:border-b-0 align-top" data-testid="catalogue-article-row">
                <td className="px-2 py-1.5">{article.name}<span className="block text-xs text-muted-foreground">{[article.supplierArticleNo && `art.nr ${article.supplierArticleNo}`, article.eNumber && `E ${article.eNumber}`, article.unit, article.discountGroup && `rabattgrupp ${article.discountGroup}`, ...offerFacts(article)].filter(Boolean).join(" · ")}</span>
                  {offerWarning(article) ? <span className={cn("mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[11px]", indicatorBadge("warning"))} data-testid="catalogue-article-warning">{offerWarning(article)}</span> : null}</td>
                <td className="px-2 py-1.5 text-xs">{article.supplierName}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{article.price ? `${formatPrice(article.price.unitPrice)} kr${article.unit ? `/${article.unit}` : ""}` : "–"}{article.price?.priceKind === "BASE" ? <span className="block text-[11px] text-amber-700">grundpris</span> : null}</td>
                <td className="px-2 py-1.5 text-xs">{article.price ? <>{article.price.sourceFileName}, {priceDateText(article.price)}{hint ? <span className={cn("ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5", indicatorBadge("warning"))}><AlertTriangle className="size-3" />{hint}</span> : null}</> : "Inget pris"}</td>
              </tr>;
            })}</tbody>
          </table></div> : <p className="mt-2 text-sm text-muted-foreground">Inga artiklar matchar.</p>}
          {pages > 1 ? <div className="mt-2 flex items-center justify-end gap-2 text-xs"><Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Föregående</Button><span>Sida {page} av {pages}</span><Button type="button" size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Nästa</Button></div> : null}
        </div>
      </>}
    </div>
    {confirmElement}
  </Panel></div>;
}

