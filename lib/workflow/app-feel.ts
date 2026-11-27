/**
 * Appkänslan (produktägarens beslut 2026-11-23; docs/ui-system.md 9, docs/ui/APPKANSLA-FORSLAG-2026-11-22.md): the pure rules
 * behind an app view that follows the phone's and the tablet's own conventions – Apple's on iPhone and iPad, Material 3 on
 * Android – and a tablet that starts in the app view (visning 1).
 * Display only: nothing here ever changes what a person may do.
 */

/** Whose conventions the app view follows where the two differ. Unknown (a computer's app column) reads as Apple's. */
export type Platform = "ios" | "android";
/**
 * The platform from the browser's own words. An iPad says "Macintosh" since iPadOS 13; it is told from a Mac by its touch
 * points, which only the browser knows (the server leaves it open and the shell decides).
 */
export function platformOf(userAgent: string | null | undefined, maxTouchPoints = 0): Platform | null {
  const ua = userAgent ?? "";
  if (/\bAndroid\b/.test(ua)) return "android";
  if (/\b(iPhone|iPad|iPod)\b/.test(ua)) return "ios";
  if (/\bMacintosh\b/.test(ua) && maxTouchPoints > 1) return "ios";
  return null;
}

/**
 * Surfplattans appvy: a tablet at layout level 1 fills its window with the app (a rail at the side instead of the tab bar)
 * instead of the 560 px column. From this width the lists that have things to open show them beside the list
 * (list–detail); below it – a tablet held upright – one pane at a time, as on a phone.
 */
export const SPLIT_MIN_WIDTH = 1000;
/** The window that shows the opened thing beside its list: the same app in a frame, as the app column is. */
export const SPLIT_FRAME = "hintek-split-detail";
export const isSplitFrame = (name: string | null | undefined) => name === SPLIT_FRAME;
/** The list's window asks the pane's app to show another of its things: { type, href } – an address inside Workflow only. */
export const SPLIT_OPEN_MESSAGE = "hintek-split:open";
export const splitOpenHref = (data: unknown): string | null => {
  if (!data || typeof data !== "object" || (data as { type?: unknown }).type !== SPLIT_OPEN_MESSAGE) return null;
  const href = (data as { href?: unknown }).href;
  return typeof href === "string" && href.startsWith("/?") ? href : null;
};

/** The lists whose things open beside them, and how an address says "one of this list's things". */
const SPLIT_LISTS: Record<string, (params: URLSearchParams) => boolean> = {
  tasks: (params) => params.get("view") === "workflow_task" && Boolean(params.get("taskId")),
  work_orders: (params) => params.get("view") === "workflow_task" && Boolean(params.get("taskId")),
  controls: (params) => params.get("view") === "workflow_task" && Boolean(params.get("taskId")),
  projects: (params) => params.get("view") === "project" && Boolean(params.get("projectId")),
  customers: (params) => params.get("view") === "customers" && Boolean(params.get("customerId")),
  quotes: (params) => params.get("view") === "quote" && Boolean(params.get("quoteId")),
  rounds: (params) => params.get("view") === "rounds" && Boolean(params.get("roundId") ?? params.get("round")),
  purchases: (params) => params.get("view") === "purchase" && Boolean(params.get("purchaseId")),
  notifications: (params) => params.get("view") === "workflow_task" && Boolean(params.get("taskId")),
};
/** Whether the page at `params` is a list drawn with a pane beside it (a list itself, never one of its things). */
export function splitListView(params: URLSearchParams): string | null {
  const view = params.get("view") ?? "stats";
  if (!(view in SPLIT_LISTS)) return null;
  // The list's own address only: an opened thing, a step or a form of the same view is a page of its own.
  for (const key of ["customerId", "roundId", "round", "step", "item", "new", "edit", "tool"]) if (params.has(key)) return null;
  return view;
}
/**
 * The address to show in the pane when a link in the list `listView` is followed, or null when the link leads somewhere
 * else (another page, a form) and is followed as usual. Only addresses inside Workflow ("/?…").
 */
export function splitDetailHref(listView: string, href: string | null | undefined): string | null {
  if (!href || !href.startsWith("/?")) return null;
  const opens = SPLIT_LISTS[listView];
  if (!opens) return null;
  let params: URLSearchParams;
  try { params = new URL(href, "http://local").searchParams; } catch { return null; }
  return opens(params) ? href : null;
}
/**
 * The thing opened beside a list is kept in the list's own address (`oppnat`), so a reload or a copied link shows it again.
 * Only an address the list itself would open in the pane (splitDetailHref) is ever read back; anything else is ignored.
 */
export const SPLIT_OPEN_PARAM = "oppnat";
export const splitOpenFromAddress = (listView: string, params: URLSearchParams): string | null => splitDetailHref(listView, params.get(SPLIT_OPEN_PARAM));
/** The list's address with `href` as the opened thing (or without one): path and query only. */
export function splitAddress(pathname: string, search: string, href: string | null): string {
  const params = new URLSearchParams(search);
  if (href) params.set(SPLIT_OPEN_PARAM, href); else params.delete(SPLIT_OPEN_PARAM);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * Hem's standard order (appkänsla, punkt 11): what I am doing now first (Fortsätt), then what the day asks of me (the lists
 * of Gör detta nu, Förfallet, Mina avvikelser), then the shortcuts, and the notices last. Only the order: the same tiles.
 * Used for a Hem nobody has arranged; a person's own order is theirs.
 */
export function proposedHomeOrder<K extends string>(tiles: readonly K[]): K[] {
  const rank = (key: string) => key === "continue" ? 0 : key === "next" || key === "overdue" || key === "deviations" ? 1 : key === "notices" ? 3 : 2;
  return tiles.map((key, index) => ({ key, index })).sort((a, b) => rank(a.key) - rank(b.key) || a.index - b.index).map((item) => item.key);
}
export const sameOrder = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((key, index) => key === b[index]);

/** Dra för att hämta nytt: how far the finger has pulled the page (0–1 of the way to a refresh), with a soft resistance. */
export const PULL_REFRESH = { threshold: 72, max: 110 } as const;
export function pullDistance(dy: number): number {
  if (dy <= 0) return 0;
  return Math.min(PULL_REFRESH.max, dy * 0.5);
}
export const pullRefreshes = (dy: number) => pullDistance(dy) >= PULL_REFRESH.threshold;
