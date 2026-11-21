import { safeReturnTo, withParam } from "./navigation";

/**
 * Samband (2026-10-26, docs/proposals/navigering-samband-2026-10-26.md): "det finns alltid ett samband och det
 * sambandet ska bete sig som man förväntar sig just där man är". A page opened from another page to create, add or choose
 * something carries the way back in its address, `returnTo=<the address it was opened from>`:
 * - Avbryt goes exactly one step back, to that page as it was (components/history-nav.tsx, `returnToOrigin`);
 * - Spara / Klar goes back there too, with what was made marked for the field it was asked for (`pick<Kind>=<id>`),
 *   which that field takes once and removes from the address (the customer field's `pickCustomer` since 2026-10-09).
 * Every page between (Ny uppgift → the new protocol) passes `returnTo` on, so the way back survives a chain of steps.
 * Pure: the pages, the tests and the map read the same rules.
 */
export const RETURN_PARAM = "returnTo";

/** What a sub-page can hand back to the field it was opened for. */
export type PickKind = "Customer" | "Task" | "Place";
export const pickParam = (kind: PickKind) => `pick${kind}`;
const PICK_KEYS = new Set(["pickCustomer", "pickTask", "pickPlace"]);

/** An address without the one-time markers a return adds, so the same page compares equal before and after. */
export function withoutPicks(address: string): string {
  const [path, query = ""] = address.split("?");
  const params = new URLSearchParams(query);
  for (const key of [...params.keys()]) if (PICK_KEYS.has(key)) params.delete(key);
  const rest = params.toString();
  return rest ? `${path}?${rest}` : path;
}

/** The link to a sub-page with the way back to `from` (the page it is opened from, markers left out). */
export function withReturn(href: string, from: string | null | undefined): string {
  const back = safeReturnTo(from ? withoutPicks(from) : null);
  return back ? withParam(href, RETURN_PARAM, back) : href;
}

/** The way back an address carries, or null (only an address inside Workflow, `/?…`, is followed). */
export function returnOf(address: string | URLSearchParams | null | undefined): string | null {
  if (!address) return null;
  const params = typeof address === "string" ? new URLSearchParams(address.split("?")[1] ?? "") : address;
  return safeReturnTo(params.get(RETURN_PARAM));
}

/** A link onward from a sub-page (Ny uppgift → the chosen type) keeps the way back of the page it is on. */
export function passReturn(href: string, current: string | URLSearchParams | null | undefined): string {
  const back = returnOf(current ?? null);
  return back ? withParam(href, RETURN_PARAM, back) : href;
}

/** The address Spara leads to: the page it came from, with the new thing marked for its field. */
export function returnWithPick(returnTo: string, kind: PickKind, id: string): string {
  return withParam(withoutPicks(returnTo), pickParam(kind), id);
}

/** Whether a visit in the history belongs to the same chain of sub-pages (it carries the same way back). */
export function sameReturnChain(url: string, returnTo: string): boolean {
  return returnOf(url) === returnTo;
}

/** "arbetsordern", "projektet" …: what the page a sub-page was opened from is, for "Tillbaka till …". */
export function returnTargetWord(returnTo: string | null | undefined): string {
  if (!returnTo) return "föregående sida";
  const params = new URLSearchParams(returnTo.split("?")[1] ?? "");
  const view = params.get("view") ?? "";
  if (view === "workflow_task" || view === "new") {
    const type = params.get("taskType");
    if (type === "WORK_ORDER") return "arbetsordern";
    if (type === "RISK_ASSESSMENT") return "riskbedömningen";
    return "uppgiften";
  }
  const words: Record<string, string> = {
    project: "projektet", projects: "projektet", project_planning: "planeringen", quote: "offerten", purchase: "inköpet",
    customers: params.get("customerId") ? "kunden" : "kunderna", place: "platsen", rounds: "driftronderna", planning: "kalendern",
    time: "tidrapporten", settings: "inställningarna", company: "företaget", company_settings: "företaget",
    stats: "översikten", tasks: "uppgifterna", work_orders: "arbetsordrarna", quotes: "offerterna", invoice_bases: "fakturaunderlagen", customer_invoices: "fakturorna", purchases: "inköpen",
    articles: "artiklarna", new_task: "Ny uppgift", self_inspection: "egenkontrollen", import: "importen", forms: "formuläret",
  };
  return words[view] ?? "föregående sida";
}

/** The label of the button that leads back after the work on a sub-page is done ("Tillbaka till arbetsordern"). */
export const returnLabel = (returnTo: string | null | undefined) => `Tillbaka till ${returnTargetWord(returnTo)}`;
