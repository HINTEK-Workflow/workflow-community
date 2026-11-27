import { compactText, editDistance, endsWord, foldText, startsWord, typoAllowance, wordsOf } from "./normalize";
import type { ParsedSearch, SearchAlternative, SearchFilters, SearchTerm } from "./query";
import { SEARCH_TYPE_LABELS, SEARCH_TYPES, type SearchCandidate, type SearchFieldWeight, type SearchGroup, type SearchHit, type SearchResponse, type SearchType } from "./types";

/**
 * Ranking for Sök (2026-10-05), the same in Cloud, Local and the demo: every query word must match somewhere;
 * a whole word in the title counts most, then the start of a word, then codes and markings, then names around the
 * record (customer, place, project, assignee) and last long text. Typing errors are allowed in titles and names with
 * a lower score. Open work, the person's own work and recent work are lifted a little; archived work is lowered.
 */
const FIELD_WEIGHT: Record<SearchFieldWeight, number> = { title: 1, code: 0.9, meta: 0.6, path: 0.6, body: 0.35 };
const WHOLE_WORD = 1, WORD_START = 0.85, INSIDE_WORD = 0.5, COMPACT_START = 0.9, COMPACT_INSIDE = 0.6, TYPO = 0.45, TYPO_PREFIX = 0.4, SYNONYM = 0.9;
/** A word the database found but in text that is not sent to the ranking (protocol answers, long notes). */
const UNSEEN_TEXT = 0.2;
const RECENT_DAYS = 90;

type PreparedField = { label: string; weight: SearchFieldWeight; folded: string; compact: string; words: string[] };
const prepare = (candidate: SearchCandidate): PreparedField[] => candidate.fields
  .filter((field) => field.text)
  .map((field) => {
    const folded = foldText(field.text);
    return { label: field.label, weight: field.weight, folded, compact: field.weight === "code" ? compactText(folded) : "", words: wordsOf(folded).map((item) => item.word) };
  });

/** How well one spelling matches one field, 0 when it does not. */
function alternativeQuality(alternative: SearchAlternative, field: PreparedField): number {
  const text = field.folded;
  let best = 0;
  let index = text.indexOf(alternative.text);
  for (let guard = 0; index >= 0 && guard < 25 && best < WHOLE_WORD; guard += 1) {
    const start = startsWord(text, index);
    const end = endsWord(text, index + alternative.text.length);
    const quality = start && end ? WHOLE_WORD : start && alternative.mode !== "word" ? WORD_START : !start && alternative.mode === "infix" ? INSIDE_WORD : 0;
    if (quality > best) best = quality;
    index = text.indexOf(alternative.text, index + 1);
  }
  // Markings and numbers without their separators: "e12" finds "E-12", "0701234567" finds "070-123 45 67".
  if (best < COMPACT_START && field.compact && alternative.mode !== "word") {
    const compact = compactText(alternative.text);
    if (compact.length >= 2 && field.compact.startsWith(compact)) best = COMPACT_START;
    else if (compact.length >= 3 && best < COMPACT_INSIDE && field.compact.includes(compact)) best = COMPACT_INSIDE;
  }
  return alternative.synonym ? best * SYNONYM : best;
}

/** A typing error in a title, marking or name: "jordfelsbrytrae", "Tosrlanda". Never for numbers. */
function typoQuality(term: SearchTerm, field: PreparedField): number {
  const word = term.text;
  const allowance = typoAllowance(word.length);
  if (!allowance || /\d/.test(word) || field.weight === "body") return 0;
  let best = 0;
  for (const candidate of field.words) {
    if (Math.abs(candidate.length - word.length) <= allowance && editDistance(word, candidate, allowance) <= allowance) return TYPO;
    if (candidate.length > word.length && editDistance(word, candidate.slice(0, word.length), allowance) <= allowance) best = TYPO_PREFIX;
  }
  return best;
}

type TermMatch = { value: number; field: PreparedField | null; typo: boolean };
function matchTerm(term: SearchTerm, fields: PreparedField[]): TermMatch {
  let best: TermMatch = { value: 0, field: null, typo: false };
  for (const field of fields) {
    for (const alternative of term.alternatives) {
      const value = alternativeQuality(alternative, field) * FIELD_WEIGHT[field.weight] * (alternative.typo ? TYPO / WHOLE_WORD : 1);
      if (value > best.value) best = { value, field, typo: Boolean(alternative.typo) };
    }
  }
  if (best.value > 0) return best;
  for (const field of fields) {
    const value = typoQuality(term, field) * FIELD_WEIGHT[field.weight];
    if (value > best.value) best = { value, field, typo: true };
  }
  return best;
}

const STATUS_FILTER_STATES: Partial<Record<string, string>> = { open: "open", done: "done", archived: "archived" };
/** kund:, plats:, status: and typ: (2026-10-05); a record without the asked-for information does not pass. */
export function passesFilters(filters: SearchFilters, candidate: SearchCandidate): boolean {
  if (filters.types && !filters.types.includes(candidate.type)) return false;
  if (filters.taskKinds && candidate.type === "task" && !filters.taskKinds.includes(candidate.kind ?? "")) return false;
  if (filters.status) {
    const state = STATUS_FILTER_STATES[filters.status];
    if (!(candidate.statusKeys ?? []).includes(filters.status) && !(state && candidate.state === state)) return false;
  }
  if (filters.customer && !foldText(candidate.customerText).includes(filters.customer)) return false;
  if (filters.place && !foldText(candidate.placeText).includes(filters.place)) return false;
  return true;
}

const timeOf = (value: SearchCandidate["updatedAt"]) => value instanceof Date ? value.getTime() : typeof value === "number" ? value : value ? Date.parse(value) : NaN;

export type ScoredCandidate = { score: number; why?: string; fuzzy: boolean };
/** The candidate's score, or null when a query word is not found (or a filter does not fit). */
export function scoreCandidate(parsed: ParsedSearch, candidate: SearchCandidate, now = Date.now()): ScoredCandidate | null {
  if (!passesFilters(parsed.filters, candidate)) return null;
  const fields = prepare(candidate);
  let total = 0, fuzzy = false, allInTitle = parsed.terms.length > 0;
  const hidden = new Set<string>();
  const visible = [foldText(candidate.title), foldText(candidate.subtitle)];
  for (const term of parsed.terms) {
    let match = matchTerm(term, fields);
    if (!match.value) {
      if (!candidate.guaranteed && !candidate.exactId) return null;
      match = { value: UNSEEN_TEXT, field: null, typo: false };
    }
    total += match.value;
    fuzzy ||= match.typo;
    if (match.field?.weight !== "title") allInTitle = false;
    const shown = match.field?.weight === "title" || visible.some((text) => term.alternatives.some((alternative) => text.includes(alternative.text)));
    if (!shown) hidden.add(match.field?.label ?? "Innehåll");
  }
  let score = parsed.terms.length ? (total / parsed.terms.length) * 100 : 0;
  const title = foldText(candidate.title);
  if (parsed.folded) {
    if (title === parsed.folded) score += 40;
    else if (title.startsWith(parsed.folded)) score += 22;
    else if (parsed.terms.length > 1 && title.includes(parsed.folded)) score += 10;
  }
  if (allInTitle) score += 10;
  if (candidate.exactId) score += 200;
  if (candidate.mine) score += 8;
  if (candidate.state === "open") score += 5;
  else if (candidate.state === "archived") score -= 12;
  const updated = timeOf(candidate.updatedAt);
  if (Number.isFinite(updated)) score += 6 * Math.max(0, 1 - Math.max(0, now - updated) / (RECENT_DAYS * 86_400_000));
  const why = hidden.size ? [...hidden].slice(0, 2).join(", ") : undefined;
  return { score: Math.round(score * 10) / 10, why, fuzzy };
}

/** A candidate with its text folded once, for searching the same records again and again while the person types. */
export type IndexedCandidate = { candidate: SearchCandidate; haystack: string; words: string[] };
export function indexCandidate(candidate: SearchCandidate): IndexedCandidate {
  const folded = candidate.fields.filter((field) => field.text).map((field) => ({ weight: field.weight, text: foldText(field.text) }));
  const codes = folded.filter((field) => field.weight === "code").map((field) => compactText(field.text));
  const words = [...new Set(folded.filter((field) => field.weight !== "body").flatMap((field) => wordsOf(field.text).map((item) => item.word)))];
  return { candidate, haystack: [...folded.map((field) => field.text), ...codes].join("\n"), words };
}
/** A cheap test before the full score: could every query word be in this record (exactly or with a typing error)? */
export function mayMatch(parsed: ParsedSearch, indexed: IndexedCandidate): boolean {
  if (indexed.candidate.exactId) return true;
  return parsed.terms.every((term) => term.alternatives.some((alternative) => indexed.haystack.includes(alternative.text) || indexed.haystack.includes(compactText(alternative.text)))
    || (typoAllowance(term.text.length) > 0 && !/\d/.test(term.text) && indexed.words.some((word) => {
      const allowance = typoAllowance(term.text.length);
      return editDistance(term.text, word, allowance) <= allowance || (word.length > term.text.length && editDistance(term.text, word.slice(0, term.text.length), allowance) <= allowance);
    })));
}

export type GroupTotals =Partial<Record<SearchType, { total: number; fetched: number }>>;
/**
 * Scores, removes duplicates and groups. `totals` comes from the database: how many records matched in all and how
 * many of them were sent here, so the count in a group heading is right even when only the best are sent.
 */
export function rankCandidates(parsed: ParsedSearch, candidates: SearchCandidate[], options: { now?: number; perGroup?: number; totals?: GroupTotals } = {}): SearchResponse {
  const now = options.now ?? Date.now();
  const perGroup = options.perGroup ?? 6;
  const best = new Map<string, SearchHit>();
  for (const candidate of candidates) {
    const scored = scoreCandidate(parsed, candidate, now);
    if (!scored) continue;
    const key = `${candidate.type}:${candidate.id}`;
    const previous = best.get(key);
    if (previous && previous.score >= scored.score) continue;
    best.set(key, { type: candidate.type, id: candidate.id, title: candidate.title, subtitle: candidate.subtitle, href: candidate.href, score: scored.score, state: candidate.state, ...(scored.why ? { why: scored.why } : {}), ...(scored.fuzzy ? { fuzzy: true } : {}) });
  }
  const byType = new Map<SearchType, SearchHit[]>();
  for (const hit of best.values()) byType.set(hit.type, [...(byType.get(hit.type) ?? []), hit]);
  const groups: SearchGroup[] = [];
  for (const type of SEARCH_TYPES) {
    const hits = (byType.get(type) ?? []).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "sv"));
    if (!hits.length) continue;
    const totals = options.totals?.[type];
    const count = hits.length + Math.max(0, (totals?.total ?? 0) - (totals?.fetched ?? 0));
    groups.push({ type, label: SEARCH_TYPE_LABELS[type], count, more: count > Math.min(perGroup, hits.length), hits: hits.slice(0, perGroup) });
  }
  groups.sort((a, b) => b.hits[0].score - a.hits[0].score || SEARCH_TYPES.indexOf(a.type) - SEARCH_TYPES.indexOf(b.type));
  return { groups, fuzzy: groups.some((group) => group.hits.some((hit) => hit.fuzzy)) };
}

/** Combines groups ranked in different places (the server's records, the forms and pages ranked in the browser). */
export function mergeSearchResponses(...responses: SearchResponse[]): SearchResponse {
  const groups = responses.flatMap((response) => response.groups);
  groups.sort((a, b) => (b.hits[0]?.score ?? 0) - (a.hits[0]?.score ?? 0) || SEARCH_TYPES.indexOf(a.type) - SEARCH_TYPES.indexOf(b.type));
  return { groups, fuzzy: responses.some((response) => response.fuzzy) };
}

/** Where the query's words are in a text, for <mark>: [start, end) pairs in the original text, merged and sorted. */
export function highlightRanges(text: string, parsed: ParsedSearch): [number, number][] {
  if (!text || !parsed.terms.length) return [];
  const folded = foldText(text);
  const ranges: [number, number][] = [];
  for (const term of parsed.terms) {
    for (const alternative of term.alternatives) {
      if (alternative.text.length < 1) continue;
      let index = folded.indexOf(alternative.text);
      for (let guard = 0; index >= 0 && guard < 20; guard += 1) {
        const end = index + alternative.text.length;
        const start = startsWord(folded, index);
        const ok = alternative.mode === "infix" || (start && (alternative.mode === "wordPrefix" || endsWord(folded, end)));
        if (ok) ranges.push([index, end]);
        index = folded.indexOf(alternative.text, index + 1);
      }
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged.slice(0, 20);
}
