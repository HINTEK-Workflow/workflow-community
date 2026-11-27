/** What Sök finds (2026-10-05), in the order the groups are shown when their best hits score the same. */
export const SEARCH_TYPES = ["command", "task", "report", "project", "quote", "invoice_basis", "customer", "place", "round", "deviation", "machine", "form", "person"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];
export const SEARCH_TYPE_LABELS: Record<SearchType, string> = {
  command: "Gå till",
  task: "Uppgifter",
  report: "Sparade rapporter",
  project: "Projekt",
  quote: "Offerter",
  invoice_basis: "Fakturaunderlag",
  customer: "Kunder",
  place: "Platser",
  round: "Driftronder",
  deviation: "Avvikelser",
  machine: "Maskiner",
  form: "Formulär",
  person: "Personer",
};

/** Open work ranks above finished work, and finished above archived, paused or removed. */
export type SearchState = "open" | "done" | "archived";

/** How much a match in a field counts: the title most, codes and markings next, long text least. */
export type SearchFieldWeight = "title" | "code" | "meta" | "path" | "body";
export type SearchField = { label: string; text: string; weight: SearchFieldWeight };

/** One record to rank, from SQL (Cloud), the open .hwf file (Local) or the demo. */
export type SearchCandidate = {
  type: SearchType;
  id: string;
  title: string;
  subtitle: string;
  href: string;
  fields: SearchField[];
  updatedAt?: string | number | Date | null;
  /** Assigned to, responsible for or created by the person searching. */
  mine?: boolean;
  state?: SearchState;
  /** A task's kind (WORK_ORDER, RISK_ASSESSMENT, FORM), for typ: filters. */
  kind?: string;
  /** Status words for status: filters, such as "open", "in_progress", "done". */
  statusKeys?: string[];
  /** The customer's and the place's names, for kund: and plats: filters. */
  customerText?: string;
  placeText?: string;
  /** The database already found every word somewhere in the record, also in long text that is not sent here. */
  guaranteed?: boolean;
  /** Found by its id or a pasted link (a QR label's /p/<id>). */
  exactId?: boolean;
};

export type SearchHit = {
  type: SearchType;
  id: string;
  title: string;
  subtitle: string;
  href: string;
  score: number;
  state?: SearchState;
  /** Where the words were found when it is not in the title or subtitle, e.g. "Märkning" or "Innehåll". */
  why?: string;
  /** Found with a typing error allowed. */
  fuzzy?: boolean;
};

export type SearchGroup = { type: SearchType; label: string; count: number; more: boolean; hits: SearchHit[] };
export type SearchResponse = { groups: SearchGroup[]; fuzzy: boolean };
