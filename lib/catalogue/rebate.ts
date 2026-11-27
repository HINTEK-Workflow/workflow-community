import { articleNoCore } from "@/lib/catalogue/normalize";
import { normalizeHeader } from "@/lib/import/detect";
import type { WholesalerId } from "@/lib/wholesale/model";

/**
 * Rabattbrev och avtalsfiler (2026-10-14: "läs in rabattbreven på riktigt"): a wholesaler's discount letter is
 * read into rules – a discount per product group, a discount per article, or a fixed net price per article – and the
 * company's net price is computed from the wholesaler's base price when someone searches or picks an article. Pure, so
 * the Import page's preview, the import and the tests read a file the same way. Investigated in the local report
 * tmp/prisfiler-fragor/rapport.md (never in Git); only the field names and positions are used here.
 *
 * The rules (the minimum the four wholesalers' files need):
 * - a chain of discounts multiplies: 1 − (1 − r1)(1 − r2), so 20 % and 2 % make 21,6 %;
 * - a fixed net price is never discounted further;
 * - the most specific rule wins: the article's net price, then the article's discount, then the group's discount – the
 *   longest group code that the article's group starts with (a main group covers its sub-groups);
 * - the net price is rounded to whole öre at the end, never the discount on the way.
 *
 * Formats, recognised from the content alone (never the file name):
 * - "solar-csv": semicolons, headings Kod;Produktgrupp|Rabattgrupp;Artikelnr;RSK-nr;Benämning;Rabatt;Rabatt2;NtoPris;ArtRabatt,
 *   Kod V = group (Rabatt, follow-on Rabatt2), A = article (ArtRabatt), P = net price (NtoPris); decimals with a comma.
 * - "solar-txt": fixed width, 130 characters; a header line, then the group (1–20) or the article (21–40), the discount
 *   (91–95) and the follow-on discount (96–100) in hundredths of a percent, valid from/to (115–122/123–130).
 * - "rexel-txt": semicolons, no headings: material group (five characters); discount 1; discount 2 – whole tenths of a
 *   percent ("701" = 70,1 %).
 * - "sonepar-txt": fixed width; line 1 the agreement, line 2 the headings (Mg, Rabatt …), data from line 3: Mg 4–6,
 *   discount 11–14, extra discounts 21–24 and 31–34, written 99.9.
 * - "ahlsell-txt": fixed width; line 1 the agreement head, then per line: type 1–2, chain flag 3, article 11–30 or
 *   material class 31–36, discount 37–40 and special discount 41–44 in tenths of a percent, net price 45–53 in öre,
 *   chain discount 54–57 in tenths of a percent (used when the flag is J).
 */
export type RebateKind = "GROUP" | "ARTICLE" | "NET";
export type RebateRow = {
  line: number;
  kind: RebateKind;
  /** GROUP: the group code in upper case without spaces; ARTICLE/NET: the article number's core (lib/catalogue/normalize.ts). */
  key: string;
  /** The article number or group as written, to show. */
  label: string;
  /** Percent, e.g. 70.1; the second is a follow-on discount in the chain (0 when none). */
  percent: number;
  percent2: number;
  /** NET: the price of one unit in kronor. */
  netPrice: number | null;
};
export type RebateFormatId = "solar-csv" | "solar-txt" | "rexel-txt" | "sonepar-txt" | "ahlsell-txt";
export type RebateFormat = { id: RebateFormatId; wholesaler: WholesalerId; label: string };
export const REBATE_FORMATS: Record<RebateFormatId, RebateFormat> = {
  "solar-csv": { id: "solar-csv", wholesaler: "solar", label: "Solar avtalsfil" },
  "solar-txt": { id: "solar-txt", wholesaler: "solar", label: "Solar avtalsfil (text)" },
  "rexel-txt": { id: "rexel-txt", wholesaler: "rexel", label: "Rexel rabattbrev" },
  "sonepar-txt": { id: "sonepar-txt", wholesaler: "sonepar", label: "Sonepar rabattbrev" },
  "ahlsell-txt": { id: "ahlsell-txt", wholesaler: "ahlsell", label: "Ahlsell avtalsfil" },
};
export type RebateRead = {
  format: RebateFormat;
  rows: RebateRow[];
  /** Rows that could not be read, with the reason (the first 200 are kept, all are counted). */
  errors: { line: number; message: string }[];
  errorCount: number;
  /** Rows left out on purpose: an expired validity, or a zero discount on an article. */
  skipped: number;
};

/** A discount letter has at most this many rules (the largest real one has a few thousand). */
export const MAX_REBATE_ROWS = 100_000;
const ERRORS_KEPT = 200;

export const groupKey = (value: string) => value.replace(/\s+/g, "").toUpperCase().slice(0, 40);
export const articleKey = (value: string) => articleNoCore(value).slice(0, 60);

/** 1 − Π(1 − p): several discounts after each other, in percent ("20 and 2 → 21.6"). */
export function chainPercent(...percents: number[]): number {
  const remaining = percents.reduce((left, percent) => left * (1 - Math.max(0, Math.min(100, percent)) / 100), 1);
  return Math.round((1 - remaining) * 1_000_000) / 10_000;
}

export type RebateMatch = { kind: RebateKind; key: string; percent: number; percent2: number; netPrice: number | null };
export type NetPrice = { unitPrice: number; percent: number; rule: RebateKind };

/** The company's price from the base price and the rule that applies: a net price as it is, otherwise the chain. */
export function netPriceOf(basePrice: number, match: RebateMatch): NetPrice | null {
  if (match.kind === "NET") return match.netPrice !== null && match.netPrice >= 0 ? { unitPrice: round2(match.netPrice), percent: basePrice > 0 ? Math.round((1 - match.netPrice / basePrice) * 10_000) / 100 : 0, rule: "NET" } : null;
  const percent = chainPercent(match.percent, match.percent2);
  return { unitPrice: round2(basePrice * (1 - percent / 100)), percent, rule: match.kind };
}
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * The rule for one article among a letter's rules: the article's net price, then its discount, then the longest group
 * code its group starts with. Pure, for the tests and as the reference for the SQL in lib/catalogue/rebate-server.ts.
 */
export function pickRebate(rules: readonly RebateMatch[], article: { articleNo: string; eNumber?: string; group: string }): RebateMatch | null {
  const keys = new Set([articleKey(article.articleNo), article.eNumber ? articleKey(article.eNumber) : ""].filter(Boolean));
  const group = groupKey(article.group);
  const order = { NET: 0, ARTICLE: 1, GROUP: 2 } as const;
  return rules.filter((rule) => (rule.kind === "GROUP" ? Boolean(group) && group.startsWith(rule.key) : keys.has(rule.key)))
    .sort((a, b) => order[a.kind] - order[b.kind] || b.key.length - a.key.length)[0] ?? null;
}

/** "70,1" / "70.10" / "" → a number; null when unreadable. */
function decimal(text: string): number | null {
  const value = text.trim().replace(/\s/g, "").replace(",", ".");
  if (!value) return 0;
  return /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : null;
}
const digits = (text: string, scale: number): number | null => {
  const value = text.trim();
  if (!value) return 0;
  return /^\d+$/.test(value) ? Number(value) / scale : null;
};

class Collector {
  rows: RebateRow[] = [];
  errors: { line: number; message: string }[] = [];
  errorCount = 0;
  skipped = 0;
  fail(line: number, message: string) { this.errorCount++; if (this.errors.length < ERRORS_KEPT) this.errors.push({ line, message }); }
  add(row: RebateRow) {
    if (this.rows.length >= MAX_REBATE_ROWS) { this.fail(row.line, `fler än ${MAX_REBATE_ROWS} regler – resten läses inte`); return; }
    if (row.percent < 0 || row.percent > 100 || row.percent2 < 0 || row.percent2 > 100) { this.fail(row.line, "rabatten är inte mellan 0 och 100 %"); return; }
    this.rows.push(row);
  }
  result(format: RebateFormat): RebateRead { return { format, rows: this.rows, errors: this.errors, errorCount: this.errorCount, skipped: this.skipped }; }
}

/** Splits a line of a semicolon file (the discount files have no quoted fields; a quote is kept as written). */
const fieldsOf = (line: string) => line.split(";").map((cell) => cell.trim());

const SOLAR_HEADINGS = ["kod", "artikelnr", "rabatt", "rabatt2", "ntopris", "artrabatt"];
function readSolarCsv(lines: string[]): RebateRead | null {
  const headings = fieldsOf(lines[0] ?? "").map(normalizeHeader);
  if (!SOLAR_HEADINGS.every((heading) => headings.includes(heading)) || !(headings.includes("produktgrupp") || headings.includes("rabattgrupp"))) return null;
  const at = (name: string) => headings.indexOf(name);
  const col = { kod: at("kod"), group: at("produktgrupp") >= 0 ? at("produktgrupp") : at("rabattgrupp"), article: at("artikelnr"), r1: at("rabatt"), r2: at("rabatt2"), net: at("ntopris"), art: at("artrabatt") };
  const out = new Collector();
  lines.slice(1).forEach((text, index) => {
    const line = index + 2;
    if (!text.trim()) return;
    const cells = fieldsOf(text);
    const kod = (cells[col.kod] ?? "").toUpperCase();
    if (kod === "V") {
      const group = cells[col.group] ?? "";
      const r1 = decimal(cells[col.r1] ?? ""); const r2 = decimal(cells[col.r2] ?? "");
      if (!group) return out.fail(line, "gruppraden saknar produktgrupp");
      if (r1 === null || r2 === null) return out.fail(line, "rabatten kan inte läsas");
      out.add({ line, kind: "GROUP", key: groupKey(group), label: group, percent: r1, percent2: r2, netPrice: null });
    } else if (kod === "A" || kod === "P") {
      const article = cells[col.article] ?? "";
      if (!articleKey(article)) return out.fail(line, "artikelraden saknar artikelnummer");
      if (kod === "A") {
        const percent = decimal(cells[col.art] ?? "");
        if (percent === null) return out.fail(line, "artikelrabatten kan inte läsas");
        out.add({ line, kind: "ARTICLE", key: articleKey(article), label: article, percent, percent2: 0, netPrice: null });
      } else {
        const net = decimal(cells[col.net] ?? "");
        if (net === null || !(cells[col.net] ?? "").trim()) return out.fail(line, "nettopriset kan inte läsas");
        out.add({ line, kind: "NET", key: articleKey(article), label: article, percent: 0, percent2: 0, netPrice: net });
      }
    } else out.fail(line, `okänd kod ”${kod.slice(0, 5)}” (V, A eller P)`);
  });
  return out.result(REBATE_FORMATS["solar-csv"]);
}

function readSolarTxt(lines: string[], today: string): RebateRead | null {
  const body = lines.slice(1).filter((line) => line.trim());
  if (!/^\d{13}\s/.test(lines[0] ?? "") || body.length < 1) return null;
  const shaped = body.filter((line) => line.length === 130 && /^\d{10}$/.test(line.slice(90, 100)) && /^\d{16}$/.test(line.slice(114, 130)));
  if (shaped.length / body.length < 0.9) return null;
  const out = new Collector();
  const until = today.replace(/-/g, "");
  lines.slice(1).forEach((text, index) => {
    const line = index + 2;
    if (!text.trim()) return;
    if (text.length !== 130) return out.fail(line, `raden har ${text.length} tecken, inte 130`);
    const group = text.slice(0, 20).trim(); const article = text.slice(20, 40).trim();
    const r1 = digits(text.slice(90, 95), 100); const r2 = digits(text.slice(95, 100), 100);
    if (r1 === null || r2 === null) return out.fail(line, "rabatten kan inte läsas");
    if (text.slice(100, 114).trim()) return out.fail(line, "raden har ett nettopris – läs in avtalsfilen som CSV i stället");
    const validTo = text.slice(122, 130);
    if (/^\d{8}$/.test(validTo) && validTo < until) { out.skipped++; return; }
    if (article) out.add({ line, kind: "ARTICLE", key: articleKey(article), label: article, percent: r1, percent2: r2, netPrice: null });
    else if (group) out.add({ line, kind: "GROUP", key: groupKey(group), label: group, percent: r1, percent2: r2, netPrice: null });
    else out.fail(line, "raden saknar produktgrupp och artikelnummer");
  });
  return out.result(REBATE_FORMATS["solar-txt"]);
}

function readRexelTxt(lines: string[]): RebateRead | null {
  const body = lines.filter((line) => line.trim());
  const shape = /^[0-9A-ZÅÄÖ]{2,5};\d{1,3};\d{0,3};?$/i;
  if (body.length < 3 || body.filter((line) => shape.test(line.trim())).length / body.length < 0.95) return null;
  const out = new Collector();
  lines.forEach((text, index) => {
    const line = index + 1;
    if (!text.trim()) return;
    const cells = fieldsOf(text);
    const r1 = digits(cells[1] ?? "", 10); const r2 = digits(cells[2] ?? "", 10);
    if (!cells[0] || r1 === null || r2 === null) return out.fail(line, "raden kan inte läsas (materialgrupp;rabatt 1;rabatt 2)");
    out.add({ line, kind: "GROUP", key: groupKey(cells[0]), label: cells[0], percent: r1, percent2: r2, netPrice: null });
  });
  return out.result(REBATE_FORMATS["rexel-txt"]);
}

function readSoneparTxt(lines: string[]): RebateRead | null {
  const heading = lines[1] ?? "";
  if (!/\bmg\b/i.test(heading) || !/rabatt/i.test(heading)) return null;
  const out = new Collector();
  const percentAt = (text: string, from: number, to: number) => decimal(text.slice(from - 1, to));
  lines.slice(2).forEach((text, index) => {
    const line = index + 3;
    if (!text.trim()) return;
    const group = text.slice(3, 6).trim();
    const r1 = percentAt(text, 11, 14); const r2 = percentAt(text, 21, 24); const r3 = percentAt(text, 31, 34);
    if (!group || r1 === null || r2 === null || r3 === null) return out.fail(line, "raden kan inte läsas (Mg på tecken 4–6, rabatter som 99.9)");
    // The third discount is part of the chain too (the description says it is always 0 today).
    out.add({ line, kind: "GROUP", key: groupKey(group), label: group, percent: r1, percent2: chainPercent(r2, r3), netPrice: null });
  });
  return out.rows.length ? out.result(REBATE_FORMATS["sonepar-txt"]) : null;
}

function readAhlsellTxt(lines: string[]): RebateRead | null {
  const body = lines.slice(1).filter((line) => line.trim());
  const row = /^0[13][JN ]\d{7}/;
  if (!/^0[13]\d{7}/.test(lines[0] ?? "") || body.length < 1 || body.filter((line) => row.test(line) && /^\d{21}$/.test(line.slice(36, 57))).length / body.length < 0.9) return null;
  const out = new Collector();
  lines.slice(1).forEach((text, index) => {
    const line = index + 2;
    if (!text.trim()) return;
    if (!row.test(text) || text.length < 57) return out.fail(line, "raden har inte avtalsfilens form");
    const chain = text[2] === "J";
    const article = text.slice(10, 30).trim(); const group = text.slice(30, 36).trim();
    const discount = digits(text.slice(36, 40), 10); const special = digits(text.slice(40, 44), 10);
    const net = digits(text.slice(44, 53), 100); const chained = chain ? digits(text.slice(53, 57), 10) : 0;
    if (discount === null || special === null || net === null || chained === null) return out.fail(line, "rabatt eller nettopris kan inte läsas");
    if (article) {
      if (net > 0) out.add({ line, kind: "NET", key: articleKey(article), label: article, percent: 0, percent2: 0, netPrice: net });
      else if (special > 0 || discount > 0) out.add({ line, kind: "ARTICLE", key: articleKey(article), label: article, percent: special || discount, percent2: chained, netPrice: null });
      else out.skipped++;
    } else if (group) out.add({ line, kind: "GROUP", key: groupKey(group), label: group, percent: discount, percent2: chained, netPrice: null });
    else out.fail(line, "raden saknar artikelnummer och materialklass");
  });
  return out.result(REBATE_FORMATS["ahlsell-txt"]);
}

/**
 * Reads a discount letter from its text, or returns null when the text is not one of the known formats. `today`
 * (ÅÅÅÅ-MM-DD) leaves out rules whose validity has ended (the text variant of Solar's file).
 */
export function readRebateText(text: string, today: string): RebateRead | null {
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return null;
  return readSolarCsv(lines) ?? readSolarTxt(lines, today) ?? readRexelTxt(lines) ?? readAhlsellTxt(lines) ?? readSoneparTxt(lines);
}

/** Counts for the Import page: groups, article discounts and net prices. */
export function rebateCounts(rows: readonly RebateRow[]) {
  const counts = { groups: 0, articles: 0, netPrices: 0 };
  for (const row of rows) { if (row.kind === "GROUP") counts.groups++; else if (row.kind === "ARTICLE") counts.articles++; else counts.netPrices++; }
  return counts;
}
