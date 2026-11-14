import { ACCOUNTING_FIELDS, FORTNOX_CONNECTION_READY, type AccountingSettings } from "@/lib/quotes/accounting";
import { isOtherKeyProvider, keyState } from "@/lib/integrations/key-catalog";

/**
 * Kopplingar (2026-10-31, användartest S1/S2; one page with a list of the areas since 2026-11-02; four areas since
 * 2026-11-03): Inställningar › Kopplingar was one long page with seven different things. Now the company's connections stand in
 * a list, each with its status in one line, and the open area's settings, keys and status beside it. The area is the address's
 * ?section= (/?view=advanced&section=payroll), so the older anchors keep working. Lön och export opens here too, with the same
 * content as Tid's tab (features/payroll/time-payroll-tab.tsx).
 *
 * Every key beside its connection (2026-11-03, replaces "alla nycklar på ett ställe" of 2026-10-15): Bokföring holds the
 * accounts (under Arbetssätt → Avancerat until then), the SIE export and the Fortnox key; Lön och export the payroll system's SFTP
 * or API key; Maskiner its sources' keys; API och MCP the keys Workflow issues. Grossister och prisfiler and Import och export
 * are no areas any more: they were links to Import, Artiklar and the exports' own pages, with a status that was no status. Older
 * keys of no connection (AI, Microsoft 365, "Annan tjänst") stay under Övriga nycklar on API och MCP until the owner removes them.
 *
 * Pure: the statuses are counted from what the existing endpoints answer, so the overview and the tests read the same rules.
 */
export const CONNECTION_AREA_KEYS = ["accounting", "payroll", "machines", "api", "web"] as const;
export type ConnectionAreaKey = (typeof CONNECTION_AREA_KEYS)[number];

export type ConnectionArea = { key: ConnectionAreaKey; title: string; description: string };
export const CONNECTION_AREAS: readonly ConnectionArea[] = [
  { key: "accounting", title: "Bokföring", description: FORTNOX_CONNECTION_READY ? "Konton, SIE-fil och Fortnox-nyckel." : "Konton och SIE-fil." },
  { key: "payroll", title: "Lön och export", description: "Lönesystem, dess nyckel, koder och mallar, som under Tid." },
  { key: "machines", title: "Maskiner", description: "Styrsystem som skickar larm, driftläge och diagnoser." },
  { key: "api", title: "API och MCP", description: "Egna system och AI-klienter som läser och skriver i Workflow." },
  // Webb och sociala medier (2026-11-10): the WordPress site of Min webbsida and Facebook och Instagram for Inlägg,
  // each with its keys and status on its own card.
  { key: "web", title: "Webb och sociala medier", description: "Företagets WordPress-webbplats, Facebook, Instagram och LinkedIn." },
];

/** The area an address names (?section=), or null for the overview. */
export const connectionArea = (section: string | null | undefined) => CONNECTION_AREAS.find((area) => area.key === section) ?? null;
/** Every area, Lön och export too, opens beside the list (2026-11-02); Tid's tab shows the same content. */
export const connectionAreaHref = (key: ConnectionAreaKey) => `/?view=advanced&section=${key}`;
export const CONNECTIONS_HREF = "/?view=advanced";
/**
 * Where the rows removed on 2026-11-03 send an older address: the keys' row to Lön och export (the only keys still added by
 * hand live there), Grossister och prisfiler and Import och export to Import. app/page.tsx redirects.
 */
export const RETIRED_SECTION_TARGET: Readonly<Record<string, string>> = { keys: connectionAreaHref("payroll"), wholesale: "/?view=import", files: "/?view=import" };

/** One line per card: Påslagen, Av or Behöver åtgärd, and what it is about. `unknown` while it is read or when it could not be. */
export type AreaState = "on" | "off" | "action" | "unknown";
export type AreaStatus = { state: AreaState; detail: string };
export const AREA_STATE_LABEL: Record<AreaState, string> = { on: "Påslagen", off: "Av", action: "Behöver åtgärd", unknown: "Okänt" };
export const AREA_STATE_TONE: Record<AreaState, "success" | "neutral" | "warning"> = { on: "success", off: "neutral", action: "warning", unknown: "neutral" };

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const listed = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} och ${items.at(-1)}` : items[0] ?? "");

type KeyLike = { kind: "API" | "MCP" | "EXTERNAL"; provider?: string | null; expiresAt: string | null; revokedAt: string | null; name?: string };

/** API och MCP: the company's active keys and connected apps; a key that has run out or soon will needs a new one. */
export function apiAreaStatus(keys: readonly KeyLike[], connections: number, now = new Date()): AreaStatus {
  const issued = keys.filter((key) => key.kind !== "EXTERNAL" && !key.revokedAt);
  const expired = issued.filter((key) => keyState(key, now) === "expired").length;
  const expiring = issued.filter((key) => keyState(key, now) === "expiring").length;
  if (expired) return { state: "action", detail: `${count(expired, "nyckel har", "nycklar har")} gått ut` };
  if (expiring) return { state: "action", detail: `${count(expiring, "nyckel går", "nycklar går")} ut snart` };
  const api = issued.filter((key) => key.kind === "API").length;
  const mcp = issued.filter((key) => key.kind === "MCP").length;
  const parts = [api ? count(api, "API-nyckel", "API-nycklar") : "", mcp ? count(mcp, "MCP-nyckel", "MCP-nycklar") : "", connections ? count(connections, "ansluten app", "anslutna appar") : ""].filter(Boolean);
  return parts.length ? { state: "on", detail: parts.join(" · ") } : { state: "off", detail: "Inga nycklar eller anslutna appar" };
}

/** The active pasted keys of no connection: shown under Övriga nycklar until the owner removes them; nothing is deleted by code. */
export const otherKeys = <T extends KeyLike>(keys: readonly T[]) => keys.filter((key) => key.kind === "EXTERNAL" && !key.revokedAt && isOtherKeyProvider(key.provider));
/** The providers the company has an active pasted key for (a Fortnox row shows its card even while the connection is closed). */
export const activeExternalProviders = (keys: readonly KeyLike[]) => [...new Set(keys.filter((key) => key.kind === "EXTERNAL" && !key.revokedAt).map((key) => key.provider ?? "other"))];

type SourceLike = { name: string; status: "active" | "expired" | "revoked" | "inactive" };
/** Maskiner: the sources that may send; a source whose key has run out, or alarm proposals waiting, need someone. */
export function machinesAreaStatus(sources: readonly SourceLike[], waiting: number): AreaStatus {
  const expired = sources.filter((source) => source.status === "expired");
  if (expired.length) return { state: "action", detail: `Nyckeln har gått ut: ${listed(expired.map((source) => source.name))}` };
  if (waiting) return { state: "action", detail: `${count(waiting, "larmförslag väntar", "larmförslag väntar")} på beslut` };
  const active = sources.filter((source) => source.status === "active").length;
  return active ? { state: "on", detail: count(active, "aktiv källa", "aktiva källor") } : { state: "off", detail: "Inga aktiva källor" };
}

/** The accounts a SIE file or a Fortnox invoice always needs (the ROT claim only when a quote has ROT). */
export const REQUIRED_ACCOUNTING_FIELDS = ACCOUNTING_FIELDS.filter((field) => field.key !== "rotReceivableAccount" && field.key !== "reverseVatAccount");

/** Bokföring: on when the accounts are in; a Fortnox key without the accounts, or half the accounts, needs them. */
export function accountingAreaStatus(settings: AccountingSettings, fortnoxKey: string | null): AreaStatus {
  const missing = REQUIRED_ACCOUNTING_FIELDS.filter((field) => !String(settings[field.key] ?? "").trim());
  const key = FORTNOX_CONNECTION_READY ? fortnoxKey : null;
  const ways = ["SIE-fil", ...(key ? ["Fortnox-nyckel"] : [])].join(" · ");
  if (!missing.length) return { state: "on", detail: `Konton inlagda · ${ways}` };
  if (missing.length === REQUIRED_ACCOUNTING_FIELDS.length && !key) return { state: "off", detail: "Inga konton inlagda" };
  return { state: "action", detail: `Saknas: ${listed(missing.map((field) => field.label.toLowerCase()))}` };
}

type PayrollLike = { settings: { system: string; mode: string; lastError?: string | null }; systemLabel: string; modeState: { ok: boolean; text: string }; staff: { withNumber: number; total: number } };
/** Lön och export: off until a system is chosen; a mode that does not work, an error or people without number need someone. */
export function payrollAreaStatus(payroll: PayrollLike, modeLabel: string): AreaStatus {
  if (payroll.settings.lastError) return { state: "action", detail: payroll.settings.lastError };
  if (!payroll.modeState.ok) return { state: "action", detail: payroll.modeState.text || modeLabel };
  if (payroll.settings.system === "none") return { state: "off", detail: "Inget lönesystem valt" };
  const without = payroll.staff.total - payroll.staff.withNumber;
  if (without > 0) return { state: "action", detail: `${count(without, "medarbetare saknar", "medarbetare saknar")} anställningsnummer` };
  return { state: "on", detail: `${payroll.systemLabel} · ${modeLabel}` };
}

type WebsiteLike = { configured: boolean; passwordUnreadable: boolean; passwordStored: boolean };
type MetaLike = { status: "missing" | "unchecked" | "choose" | "ok" | "action" | "invalid"; page: string | null; instagram: string | null; message?: string | null };
type LinkedInLike = { status: MetaLike["status"]; author: string | null; message?: string | null };
/**
 * Webb och sociala medier: on when something is connected and works; a password that cannot be read, a token that no longer
 * works, missing permissions or a page not chosen need someone. null for a part that could not be read.
 */
export function webAreaStatus(website: WebsiteLike | null, meta: MetaLike | null, linkedin: LinkedInLike | null = null): AreaStatus {
  if (website?.passwordUnreadable) return { state: "action", detail: "WordPress: lösenordet behöver klistras in igen" };
  if (meta && (meta.status === "invalid" || meta.status === "action" || meta.status === "choose"))
    return { state: "action", detail: meta.status === "choose" ? "Facebook: välj sida" : meta.status === "invalid" ? "Facebook och Instagram: ny token behövs" : "Facebook och Instagram: behöver åtgärd" };
  if (linkedin && (linkedin.status === "invalid" || linkedin.status === "action" || linkedin.status === "choose"))
    return { state: "action", detail: linkedin.status === "choose" ? "LinkedIn: välj var inläggen ska" : linkedin.status === "invalid" ? "LinkedIn: koppla igen" : "LinkedIn: behöver åtgärd" };
  const parts = [
    website?.configured ? "WordPress" : "",
    meta && meta.status !== "missing" && meta.page ? (meta.instagram ? "Facebook och Instagram" : "Facebook") : "",
    linkedin && linkedin.status === "ok" && linkedin.author ? "LinkedIn" : "",
  ].filter(Boolean);
  if (!website && !meta && !linkedin) return { state: "unknown", detail: "Kunde inte läsas" };
  return parts.length ? { state: "on", detail: parts.join(" · ") } : { state: "off", detail: "Inget kopplat" };
}
