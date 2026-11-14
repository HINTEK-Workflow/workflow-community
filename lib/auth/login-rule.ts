// "Vem får logga in" (2026-10-06): Installation → Inloggning chooses who may sign in – Alla (everyone
// with an account), Endast (only the listed addresses and domains) or Alla utom blockerade (the listed are refused).
// The value lives in SystemSettings.loginAccess; this module holds the last value read (lib/auth/registration.ts
// refreshes it every 15 seconds) so the synchronous access checks can use it without a database import.
// An empty value means "not chosen yet": the older behaviour – "Tillåt nya konton" and PILOT_ACCESS_EMAILS – applies.

export type LoginAccessMode = "ALL" | "ONLY" | "BLOCK";
export type LoginRule = { mode: LoginAccessMode | null; allow: string[]; block: string[] };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DOMAIN = /^@[^@\s]+\.[^@\s]+$/;

/** One list entry: a full address or a domain written "@foretag.se" (a bare "foretag.se" is read as the domain). */
export function normalizeLoginEntry(value: string): string | null {
  const item = value.trim().toLowerCase();
  if (!item) return null;
  if (EMAIL.test(item) || DOMAIN.test(item)) return item;
  if (!item.includes("@") && DOMAIN.test(`@${item}`)) return `@${item}`;
  return null;
}

/** The lines of a textarea (or commas): the valid entries, unique, and the lines that were not understood. */
export function parseLoginList(text: string): { entries: string[]; invalid: string[] } {
  const entries = new Set<string>();
  const invalid: string[] = [];
  for (const line of text.split(/[\n,;]+/)) {
    if (!line.trim()) continue;
    const entry = normalizeLoginEntry(line);
    if (entry) entries.add(entry); else invalid.push(line.trim());
  }
  return { entries: [...entries], invalid };
}

export function readLoginRule(value: unknown): LoginRule {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const list = (items: unknown) => (Array.isArray(items) ? items.map((item) => normalizeLoginEntry(String(item))).filter((item): item is string => Boolean(item)) : []);
  const mode = raw.mode === "ALL" || raw.mode === "ONLY" || raw.mode === "BLOCK" ? raw.mode : null;
  return { mode, allow: list(raw.allow), block: list(raw.block) };
}

export function loginListMatches(email: string, list: readonly string[]) {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  const domain = at >= 0 ? normalized.slice(at) : "";
  return list.some((entry) => entry === normalized || (entry.startsWith("@") && entry === domain));
}

/** Whether the chosen rule lets this address in. "Not chosen yet" refuses nobody here (the older checks apply). */
export function ruleAllows(rule: LoginRule, email: string) {
  if (rule.mode === "ONLY") return loginListMatches(email, rule.allow);
  if (rule.mode === "BLOCK") return !loginListMatches(email, rule.block);
  return true;
}

let current: LoginRule = { mode: null, allow: [], block: [] };
export const loginRule = () => current;
export function setLoginRule(rule: LoginRule) { current = rule; }
