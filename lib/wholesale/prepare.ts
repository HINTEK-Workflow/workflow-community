import { parseAmount } from "@/lib/workflow/expenses";
import { WHOLESALER_LABELS, type RowPack, type RowWholesale, type WholesalerId } from "./model";
import { profileOf, type WholesaleProfile } from "./profiles";

/**
 * Förberedelse av materialrader för en grossists beställning (2026-10-12): which article number a row may use at
 * the chosen wholesaler, the quantity as an ORDER quantity, the merging of equal rows and every reason a row cannot be
 * exported yet. Pure and separate from the formatting (format.ts): the same preparation serves all four profiles, and
 * nothing here changes a price, a status or a row.
 *
 * Rules (Tilläggsprompten, "Gemensamma regler"):
 * - only the chosen wholesaler's own identifier is used; an unsafe or missing link is a visible problem on the row, never
 *   a guess from a similar name or from the same digits in another number system;
 * - the consumption quantity is turned into an order quantity only with a factor the person entered (or a unit that
 *   already is the order unit); a missing factor is an error on that row; a rounding up must be confirmed;
 * - rows are merged only when wholesaler article, order unit and order terms are equal;
 * - no negative, empty or invalid quantity; no decimal quantity (not verified at any wholesaler), no ambiguous "1.000".
 */

/** A material row or quote line as the export reads it. Prices, discounts and markup are deliberately not part of it. */
export type WholesaleSourceLine = {
  id: string;
  name: string;
  /** The consumption quantity as typed ("12", "2,5"). */
  quantity: string;
  /** The consumption unit as typed ("st", "m"). */
  unit: string;
  /** The article number the row shows and where it came from (the supplier's name; "" = typed by hand). */
  articleNo?: string;
  articleSource?: string;
  /** The picked article's copy: supplier, the supplier's number, E-nummer, and the unit the article is sold in. */
  supplierName?: string;
  /** Which wholesaler the picked article's supplier is, as the company set it (2026-10-13 natt); otherwise read from its name. */
  supplierWholesaler?: WholesalerId;
  supplierArticleNo?: string;
  eNumber?: string;
  manufacturerArticleNo?: string;
  priceUnit?: string;
  /** The row's own notes for wholesalers (saved on the row). */
  wholesale?: RowWholesale;
};

export type IdentifierOrigin = "user" | "eNumber" | "supplier" | "manufacturer";
export type Candidate = { value: string; label: string };
export type IssueCode =
  | "no-identifier" | "unsafe-identifier" | "non-ascii" | "no-quantity" | "bad-quantity" | "ambiguous-quantity" | "non-positive" | "too-large"
  | "missing-factor" | "bad-factor" | "decimal-quantity";
export type RowIssue = { code: IssueCode; message: string };

export type PreparedRow = {
  id: string;
  name: string;
  quantityText: string;
  unit: string;
  identifier: string | null;
  origin: IdentifierOrigin | null;
  /** Where the identifier comes from, in words, for the review ("E-nummer på raden"). */
  originNote: string;
  /** The numbers on the row the person may pick for this wholesaler (never used without a choice). */
  candidates: Candidate[];
  excluded: boolean;
  pack: RowPack | null;
  issues: RowIssue[];
  /** The merged line the row belongs to, when it has one. */
  lineKey: string | null;
};

export type ExportLine = {
  key: string;
  identifier: string;
  /** The first row's name (with "+ n rader" when merged). */
  name: string;
  /** The quantity to order, a whole number. */
  quantity: number;
  unit: string;
  consumption: number;
  consumptionUnit: string;
  rowIds: string[];
  /** The order quantity is above what the rows need (a whole package or an order multiple). */
  rounded: boolean;
  /** What the person confirms: this merged line with exactly this order quantity (a changed quantity needs a new confirmation). */
  confirmKey: string;
  confirmed: boolean;
  issues: RowIssue[];
};

export type Preparation = {
  wholesaler: WholesalerId;
  rows: PreparedRow[];
  lines: ExportLine[];
  /** Lines that may be exported: no issue, and rounded ones only when confirmed. */
  ready: ExportLine[];
  /** Rows with an issue of their own, and lines whose order quantity is rounded and not yet confirmed. */
  needAction: number;
  needConfirmation: ExportLine[];
  excluded: number;
  /** Rows that were merged into another row's line. */
  merged: number;
  warnings: string[];
  /** True when nothing blocks Kopiera and Exportera. */
  canExport: boolean;
};

export type PrepareOptions = {
  /** Rows the person explicitly left out. */
  excluded?: ReadonlySet<string>;
  /** `confirmKey`s of the merged lines whose rounded order quantity the person confirmed. */
  confirmed?: ReadonlySet<string>;
};

const SYNTHETIC_E = /^E \d+$/;
const FORMULA_START = /^[=+\-@]/;
const UNIT_ALIASES: Record<string, string> = { styck: "st", stk: "st", meter: "m", fp: "förp", förpackning: "förp", pkt: "förp", paket: "förp", ring: "ring", rulle: "rulle" };
export const normalizeUnit = (unit: string) => {
  const key = unit.trim().toLocaleLowerCase("sv-SE").replace(/\./g, "").replace(/\s+/g, " ");
  return UNIT_ALIASES[key] ?? key;
};

const WORD = /[^a-z0-9åäö]+/;
/** True when a supplier's name names the wholesaler as a word ("Ahlsell Sverige AB"); a similar name never counts. */
export function supplierIsWholesaler(supplierName: string | undefined, wholesaler: WholesalerId) {
  return Boolean(supplierName) && supplierName!.toLocaleLowerCase("sv-SE").split(WORD).includes(wholesaler);
}

const clean = (value: string | undefined) => (value ?? "").replace(/\s+/g, " ").trim();

/** The numbers on the row, with words for what each is; used as choices, never applied without the person's choice. */
export function identifierCandidates(line: WholesaleSourceLine): Candidate[] {
  const found: Candidate[] = [];
  const add = (value: string | undefined, label: string) => { const text = clean(value); if (text && !found.some((item) => item.value === text)) found.push({ value: text, label }); };
  add(line.eNumber, "E-nummer");
  add(line.supplierArticleNo, line.supplierName ? `Artikelnummer hos ${line.supplierName}` : "Leverantörens artikelnummer");
  if (line.articleNo && !SYNTHETIC_E.test(clean(line.articleNo))) add(line.articleNo, clean(line.articleSource) ? `Artikelnummer (${clean(line.articleSource)})` : "Artikelnummer på raden");
  add(line.manufacturerArticleNo, "Tillverkarens artikelnummer");
  return found;
}

type Resolved = { value: string; origin: IdentifierOrigin; note: string };

/** The chosen wholesaler's verified identifier for a row, or null (then the person chooses or excludes the row). */
export function resolveIdentifier(line: WholesaleSourceLine, profile: WholesaleProfile): Resolved | null {
  const own = clean(line.wholesale?.ids?.[profile.id]);
  // Ett artikelregister (2026-10-12): the wholesaler's own number of the same product, from its own price file.
  if (own && clean(line.wholesale?.linked?.[profile.id]) === own) return { value: own, origin: "supplier", note: `Från prislistan hos ${profile.label} (samma produkt i artikelregistret)` };
  if (own) return { value: own, origin: "user", note: `Angivet av dig för ${profile.label}` };
  for (const rule of profile.identifiers) {
    if (rule === "eNumber") {
      const e = clean(line.eNumber);
      if (e) return { value: e, origin: "eNumber", note: "E-nummer på raden" };
    } else if (rule === "supplier") {
      if ((line.supplierWholesaler ? line.supplierWholesaler === profile.id : supplierIsWholesaler(line.supplierName, profile.id)) && clean(line.supplierArticleNo)) return { value: clean(line.supplierArticleNo), origin: "supplier", note: `Från prislistan ${clean(line.supplierName)}` };
      const typed = clean(line.articleNo);
      if (supplierIsWholesaler(line.articleSource, profile.id) && typed && !SYNTHETIC_E.test(typed)) return { value: typed, origin: "supplier", note: `Artikelnummer från ${clean(line.articleSource)}` };
    } else if (rule === "manufacturer") {
      const m = clean(line.manufacturerArticleNo);
      if (m) return { value: m, origin: "manufacturer", note: "Tillverkarens artikelnummer på raden" };
    }
  }
  return null;
}

/** Characters the wholesaler may read as a field separator, or that a spreadsheet may read as a formula. */
const FORBIDDEN: Record<WholesalerId, RegExp> = {
  solar: /[\s,;|]/, ahlsell: /[\t\r\n]/, sonepar: /[\s,;|]/, rexel: /[;\r\n"]/,
};

function identifierIssue(value: string, profile: WholesaleProfile): RowIssue | null {
  if (FORBIDDEN[profile.id].test(value)) return { code: "unsafe-identifier", message: `Artikelnumret ${value} innehåller ett tecken som ${profile.label} kan läsa som skiljetecken. Ange ett annat nummer eller utesluta raden.` };
  if (FORMULA_START.test(value)) return { code: "unsafe-identifier", message: `Artikelnumret ${value} börjar med ett tecken som ett kalkylblad kan läsa som formel. Ange ett annat nummer eller utesluta raden.` };
  if (/[\u0000-\u001f\u007f]/.test(value)) return { code: "unsafe-identifier", message: "Artikelnumret innehåller styrtecken." };
  if (profile.asciiOnly && /[^\x20-\x7e]/.test(value)) return { code: "non-ascii", message: `Artikelnumret ${value} har tecken utanför ASCII. Teckenkodningen är inte verifierad hos ${profile.label}; ange ett annat nummer eller utesluta raden.` };
  return null;
}

/** A whole number or a decimal quantity as typed, or an issue. "1.000" and "1,000" are ambiguous and refused. */
function readQuantity(text: string): { value: number } | { issue: RowIssue } {
  const trimmed = text.trim();
  if (!trimmed) return { issue: { code: "no-quantity", message: "Antal saknas." } };
  if (/^\d{1,3}[.,]\d{3}$/.test(trimmed)) return { issue: { code: "ambiguous-quantity", message: `Antalet ${trimmed} kan läsas som ett tal med decimaler eller med tusentalsavgränsare. Skriv det utan punkt eller komma.` } };
  const value = parseAmount(trimmed);
  if (value === null) return { issue: { code: "bad-quantity", message: `Antalet "${trimmed}" kan inte läsas som ett tal.` } };
  if (!(value > 0)) return { issue: { code: "non-positive", message: "Antalet måste vara större än noll." } };
  if (value > 1_000_000) return { issue: { code: "too-large", message: "Antalet är orimligt stort." } };
  return { value };
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

type Factor = { orderUnit: string; perUnit: number; multiple: number } | { issue: RowIssue } | null;

/** The order unit conversion of the row: entered pack, nothing needed (units agree), or a missing factor. */
function readFactor(line: WholesaleSourceLine, pack: RowPack | null): Factor {
  if (pack) {
    const perUnit = parseAmount(pack.perUnit);
    const multiple = pack.multiple?.trim() ? parseAmount(pack.multiple) : 1;
    if (!pack.orderUnit.trim()) return { issue: { code: "bad-factor", message: "Ange beställningsenhet för omräkningen (till exempel rulle)." } };
    if (perUnit === null || !(perUnit > 0)) return { issue: { code: "bad-factor", message: `Omräkningen är ogiltig: ange hur många ${clean(line.unit) || "enheter"} det går på en ${pack.orderUnit.trim()}.` } };
    if (multiple === null || !(multiple >= 1) || !near(multiple, Math.round(multiple))) return { issue: { code: "bad-factor", message: "Ordermultipeln måste vara ett helt tal, 1 eller större." } };
    return { orderUnit: pack.orderUnit.trim(), perUnit, multiple: Math.round(multiple) };
  }
  const priceUnit = clean(line.priceUnit);
  if (priceUnit && normalizeUnit(priceUnit) !== normalizeUnit(line.unit)) {
    return { issue: { code: "missing-factor", message: `Raden räknas i ${clean(line.unit) || "okänd enhet"} men artikeln säljs per ${priceUnit}. Ange hur många ${clean(line.unit) || "enheter"} det går på en ${priceUnit}.` } };
  }
  return null;
}

export function prepareLines(lines: readonly WholesaleSourceLine[], wholesaler: WholesalerId, options: PrepareOptions = {}): Preparation {
  const profile = profileOf(wholesaler);
  const excluded = options.excluded ?? new Set<string>();
  const confirmed = options.confirmed ?? new Set<string>();
  const rows: PreparedRow[] = [];
  type Group = { key: string; identifier: string; name: string; unit: string; consumptionUnit: string; perUnit: number | null; multiple: number; consumption: number; rowIds: string[] };
  const groups = new Map<string, Group>();
  const rowById = new Map<string, PreparedRow>();

  for (const line of lines) {
    const resolved = resolveIdentifier(line, profile);
    const pack = line.wholesale?.packs?.[wholesaler] ?? null;
    const row: PreparedRow = {
      id: line.id, name: clean(line.name) || "Utan benämning", quantityText: clean(line.quantity), unit: clean(line.unit),
      identifier: resolved?.value ?? null, origin: resolved?.origin ?? null, originNote: resolved?.note ?? "",
      candidates: identifierCandidates(line), excluded: excluded.has(line.id), pack, issues: [], lineKey: null,
    };
    rows.push(row); rowById.set(row.id, row);
    if (row.excluded) continue;
    if (!resolved) row.issues.push({ code: "no-identifier", message: `Raden saknar ett artikelnummer som är säkert för ${profile.label} (${profile.identifierLabel}). Välj ett nummer, ange ett eller uteslut raden.` });
    else { const issue = identifierIssue(resolved.value, profile); if (issue) row.issues.push(issue); }
    const quantity = readQuantity(line.quantity);
    if ("issue" in quantity) row.issues.push(quantity.issue);
    const factor = readFactor(line, pack);
    if (factor && "issue" in factor) row.issues.push(factor.issue);
    if (row.issues.length || !resolved || "issue" in quantity || (factor && "issue" in factor)) continue;
    const orderUnit = factor ? factor.orderUnit : clean(line.unit);
    const perUnit = factor ? factor.perUnit : null;
    const multiple = factor ? factor.multiple : 1;
    const key = [resolved.value, normalizeUnit(orderUnit), perUnit ?? "", multiple].join("\u0000");
    const group = groups.get(key);
    if (group) { group.consumption = round6(group.consumption + quantity.value); group.rowIds.push(line.id); }
    else groups.set(key, { key, identifier: resolved.value, name: row.name, unit: orderUnit, consumptionUnit: clean(line.unit), perUnit, multiple, consumption: quantity.value, rowIds: [line.id] });
    row.lineKey = key;
  }

  const exportLines: ExportLine[] = [];
  for (const group of groups.values()) {
    const issues: RowIssue[] = [];
    let quantity = group.consumption;
    let rounded = false;
    if (group.perUnit !== null) {
      const steps = Math.ceil(group.consumption / group.perUnit / group.multiple - 1e-9);
      quantity = steps * group.multiple;
      rounded = !near(quantity * group.perUnit, group.consumption);
    }
    if (!near(quantity, Math.round(quantity))) {
      issues.push({ code: "decimal-quantity", message: `Antalet ${String(group.consumption).replace(".", ",")} ${group.consumptionUnit} är inte ett helt antal. Decimalantal är inte verifierade hos ${profile.label}; ange en omräkning till hela förpackningar eller ändra antalet.` });
    }
    const confirmKey = `${group.key}\u0001${Math.round(quantity)}`;
    exportLines.push({
      key: group.key, identifier: group.identifier,
      name: group.rowIds.length > 1 ? `${group.name} + ${group.rowIds.length - 1} ${group.rowIds.length === 2 ? "rad" : "rader"}` : group.name,
      quantity: Math.round(quantity), unit: group.unit, consumption: group.consumption, consumptionUnit: group.consumptionUnit,
      rowIds: group.rowIds, rounded, confirmKey, confirmed: rounded && confirmed.has(confirmKey), issues,
    });
    // A problem of the merged line is shown on every row that makes it up.
    for (const id of group.rowIds) rowById.get(id)?.issues.push(...issues);
  }

  const ready = exportLines.filter((line) => !line.issues.length && (!line.rounded || line.confirmed));
  const needConfirmation = exportLines.filter((line) => line.rounded && !line.confirmed && !line.issues.length);
  const needAction = rows.filter((row) => row.issues.length).length;
  const warnings: string[] = [];
  const byIdentifier = new Map<string, number>();
  for (const line of exportLines) byIdentifier.set(line.identifier, (byIdentifier.get(line.identifier) ?? 0) + 1);
  for (const [identifier, count] of byIdentifier) if (count > 1) warnings.push(`Artikel ${identifier} finns på ${count} rader med olika enhet eller förpackning och slås inte ihop. Kontrollera att det stämmer.`);
  const merged = exportLines.reduce((sum, line) => sum + line.rowIds.length - 1, 0);
  return {
    wholesaler, rows, lines: exportLines, ready, needAction, needConfirmation, excluded: rows.filter((row) => row.excluded).length, merged, warnings,
    canExport: needAction === 0 && needConfirmation.length === 0 && ready.length > 0,
  };
}

/** Why Kopiera and Exportera cannot be used yet, or "" when they can. */
export function exportBlockReason(preparation: Preparation): string {
  const label = WHOLESALER_LABELS[preparation.wholesaler];
  if (preparation.needAction) return `${preparation.needAction} ${preparation.needAction === 1 ? "rad behöver" : "rader behöver"} åtgärdas eller uteslutas innan underlaget för ${label} kan skapas.`;
  if (preparation.needConfirmation.length) return `Bekräfta ${preparation.needConfirmation.length === 1 ? "det ändrade beställningsantalet" : "de ändrade beställningsantalen"} först.`;
  if (!preparation.ready.length) return "Det finns inget material att exportera.";
  return "";
}
