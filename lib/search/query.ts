import { compactText, foldText, SEARCH_STOPWORDS, tokenize } from "./normalize";
import { isAbbreviation, synonymsFor, vocabularyCorrections } from "./synonyms";
import type { SearchType } from "./types";

/**
 * How one query word may match: anywhere in a word ("infix", from three letters), only at the start of a word
 * ("wordPrefix", one or two letters such as "E1"), or only as a whole word ("word", the abbreviations in the synonym
 * table).
 */
export type SearchMatchMode = "infix" | "wordPrefix" | "word";
/** `typo`: a word from the synonym table that the query word is a misspelling of. */
export type SearchAlternative = { text: string; mode: SearchMatchMode; synonym: boolean; typo?: boolean };
/** A query word and what it may also be written as; every term must match somewhere in a record. */
export type SearchTerm = { text: string; alternatives: SearchAlternative[] };

export type SearchStatusKey = "open" | "done" | "archived" | "planned" | "in_progress" | "paused" | "needs_action" | "draft" | "cancelled";
export type SearchFilters = {
  types: SearchType[] | null;
  /** typ:ao, typ:risk and typ:protokoll narrow tasks to these kinds. */
  taskKinds: string[] | null;
  status: SearchStatusKey | null;
  /** Folded text the customer's name must contain (kund:) and the place's whole way (plats:). */
  customer: string | null;
  place: string | null;
};
export type ParsedSearch = {
  /** The free text without filters, folded. */
  folded: string;
  terms: SearchTerm[];
  filters: SearchFilters;
  /** Ids from a pasted link or QR label (/p/<id>, ?taskId=…) or a bare id. */
  ids: string[];
  /** The filters as the person wrote them, for the chips under the box. */
  filterLabels: string[];
  /** Something to search for: words, a filter or an id. */
  active: boolean;
};

export const SEARCH_MAX_TERMS = 8;
export const SEARCH_MAX_LENGTH = 200;

const TYPE_WORDS: Record<string, { types: SearchType[]; taskKinds?: string[] }> = {
  projekt: { types: ["project"] },
  offert: { types: ["quote"] }, offerter: { types: ["quote"] },
  fakturaunderlag: { types: ["invoice_basis"] }, underlag: { types: ["invoice_basis"] }, faktura: { types: ["invoice_basis"] },
  uppgift: { types: ["task"] }, uppgifter: { types: ["task"] },
  ao: { types: ["task"], taskKinds: ["WORK_ORDER"] }, arbetsorder: { types: ["task"], taskKinds: ["WORK_ORDER"] }, arbetsordrar: { types: ["task"], taskKinds: ["WORK_ORDER"] },
  risk: { types: ["task"], taskKinds: ["RISK_ASSESSMENT"] }, riskbedomning: { types: ["task"], taskKinds: ["RISK_ASSESSMENT"] }, rb: { types: ["task"], taskKinds: ["RISK_ASSESSMENT"] },
  protokoll: { types: ["task"], taskKinds: ["FORM"] },
  kontroll: { types: ["task"], taskKinds: ["FORM"] }, kontroller: { types: ["task"], taskKinds: ["FORM"] }, kfid: { types: ["task"], taskKinds: ["FORM"] },
  rapport: { types: ["report"] }, rapporter: { types: ["report"] }, rapportarkiv: { types: ["report"] },
  kund: { types: ["customer"] }, kunder: { types: ["customer"] },
  plats: { types: ["place"] }, platser: { types: ["place"] }, anlaggning: { types: ["place"] }, objekt: { types: ["place"] },
  rond: { types: ["round"] }, ronder: { types: ["round"] }, driftrond: { types: ["round"] }, driftronder: { types: ["round"] },
  formular: { types: ["form"] }, mall: { types: ["form"] }, mallar: { types: ["form"] },
  avvikelse: { types: ["deviation"] }, avvikelser: { types: ["deviation"] }, tillbud: { types: ["deviation"] }, olycksfall: { types: ["deviation"] },
  maskin: { types: ["machine"] }, maskiner: { types: ["machine"] },
  person: { types: ["person"] }, personer: { types: ["person"] }, kollega: { types: ["person"] }, anvandare: { types: ["person"] },
  sida: { types: ["command"] }, sidor: { types: ["command"] }, installning: { types: ["command"] }, installningar: { types: ["command"] },
};
const STATUS_WORDS: Record<string, SearchStatusKey> = {
  oppen: "open", oppna: "open", oppet: "open", aktiv: "open", aktiva: "open", pagaende: "open",
  klar: "done", klara: "done", slutford: "done", slutforda: "done", avslutad: "done", avslutade: "done", fardig: "done", fardiga: "done",
  arkiverad: "archived", arkiverade: "archived", arkiv: "archived", pausad: "paused", pausade: "paused",
  planerad: "planned", planerade: "planned", pagar: "in_progress",
  atgard: "needs_action", atgardas: "needs_action", behover: "needs_action", utkast: "draft", utgatt: "cancelled", utgar: "cancelled",
};

const ID_IN_LINK = /(?:\/p\/|[?&](?:taskId|placeId|projectId|customerId|id)=)([A-Za-z0-9_-]{8,100})/g;
const BARE_ID = /^(?:c[a-z0-9]{20,32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function termFor(text: string): SearchTerm {
  const alternatives: SearchAlternative[] = [{ text, mode: text.length <= 2 ? "wordPrefix" : "infix", synonym: false }];
  const compact = compactText(text);
  if (compact !== text && compact.length >= 2) alternatives.push({ text: compact, mode: "infix", synonym: false });
  for (const synonym of synonymsFor(text)) alternatives.push({ text: synonym, mode: isAbbreviation(synonym) ? "word" : "infix", synonym: true });
  for (const corrected of vocabularyCorrections(text)) alternatives.push({ text: corrected, mode: isAbbreviation(corrected) ? "word" : "infix", synonym: true, typo: true });
  return { text, alternatives };
}

export function parseSearchQuery(input: string): ParsedSearch {
  let rest = (input ?? "").slice(0, SEARCH_MAX_LENGTH);
  const ids = new Set<string>();
  for (const match of rest.matchAll(ID_IN_LINK)) ids.add(match[1]);
  // A pasted link is an id, never words to search for.
  rest = rest.replace(/\S*(?:\/p\/|[?&](?:taskId|placeId|projectId|customerId|id)=)\S*/g, " ");
  const filters: SearchFilters = { types: null, taskKinds: null, status: null, customer: null, place: null };
  const filterLabels: string[] = [];
  const leftovers: string[] = [];
  rest = rest.replace(/(^|\s)(kund|plats|status|typ):(?:"([^"]*)"|(\S*))/giu, (_all, lead: string, key: string, quoted: string | undefined, plain: string | undefined) => {
    const value = foldText(quoted ?? plain ?? "").trim();
    const name = key.toLowerCase();
    if (!value) return lead;
    if (name === "kund") { filters.customer = value; filterLabels.push(`Kund: ${quoted ?? plain}`); }
    else if (name === "plats") { filters.place = value; filterLabels.push(`Plats: ${quoted ?? plain}`); }
    else if (name === "status" && STATUS_WORDS[compactText(value)]) { filters.status = STATUS_WORDS[compactText(value)]; filterLabels.push(`Status: ${quoted ?? plain}`); }
    else if (name === "typ" && TYPE_WORDS[compactText(value)]) {
      const type = TYPE_WORDS[compactText(value)];
      filters.types = type.types;
      filters.taskKinds = type.taskKinds ?? null;
      filterLabels.push(`Typ: ${quoted ?? plain}`);
    } else leftovers.push(value);
    return lead;
  });
  const words = tokenize(foldText(rest)).concat(leftovers.flatMap((value) => tokenize(value)));
  const plain: string[] = [];
  for (const word of words) {
    if (BARE_ID.test(word)) ids.add(word);
    else plain.push(word.slice(0, 60));
  }
  const meaningful = plain.filter((word) => !SEARCH_STOPWORDS.has(word));
  const kept = (meaningful.length ? meaningful : plain).filter((word, index, all) => all.indexOf(word) === index).slice(0, SEARCH_MAX_TERMS);
  const terms = kept.map(termFor);
  const hasFilter = Boolean(filters.types || filters.status || filters.customer || filters.place);
  return {
    folded: kept.join(" "),
    terms,
    filters,
    ids: [...ids].slice(0, 5),
    filterLabels,
    active: terms.length > 0 || ids.size > 0 || hasFilter,
  };
}

/** Short enough to wait for more typing: one letter and nothing else. */
export const searchTooShort = (parsed: ParsedSearch) => !parsed.ids.length && !parsed.filterLabels.length && parsed.folded.replace(/\s/g, "").length < 2;
