import { ABSENCE_LABELS, ABSENCE_TYPES, type AbsenceStatus, type AbsenceType } from "@/lib/workflow/absence";

/**
 * Lön och frånvaro (2026-10-29): the external systems a company can name, how their absence codes become Workflow's types, and
 * how a file's status words become a status. No code list of any vendor is built in – the company's own codes are mapped once
 * and saved per company; the suggestions below only read plain Swedish and English words.
 */
export const PAYROLL_SYSTEMS = ["none", "flex_hrm", "fortnox", "spiris", "visma", "other"] as const;
export type PayrollSystem = (typeof PAYROLL_SYSTEMS)[number];
export const PAYROLL_SYSTEM_LABELS: Record<PayrollSystem, string> = {
  none: "Inget valt", flex_hrm: "Flex HRM", fortnox: "Fortnox Lön", spiris: "Spiris", visma: "Visma Lön", other: "Annat system",
};
export const PAYROLL_MODES = ["manual", "sftp", "api"] as const;
export type PayrollMode = (typeof PAYROLL_MODES)[number];
export const PAYROLL_MODE_LABELS: Record<PayrollMode, string> = { manual: "Filer för hand", sftp: "Automatiskt via SFTP", api: "API" };
/**
 * The modes a company can choose (2026-11-20): SFTP and API are hidden until they are built – no SFTP client is installed and
 * no payroll API is verified. A mode saved earlier is still read and shown, so nothing a company stored is lost.
 */
export const OFFERED_PAYROLL_MODES: readonly PayrollMode[] = ["manual"];

/** The label shown for a system ("Annat system" shows the company's own name for it). */
export const systemLabel = (system: string | null | undefined, systemName = "") =>
  system === "other" && systemName.trim() ? systemName.trim() : PAYROLL_SYSTEM_LABELS[(system ?? "none") as PayrollSystem] ?? (system || "Fil");

/** The key an imported absence is stored under: the system, or "file" when the company has named none. */
export const sourceSystemKey = (system: string | null | undefined) => (!system || system === "none" ? "file" : system);
export const sourceSystemLabel = (key: string | null | undefined, systemName = "") => (!key || key === "file" ? "Fil" : systemLabel(key, systemName));

/** A code as it is compared: trimmed, lower case, inner spaces single. */
export const normalizeCode = (code: string) => code.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 60);

export type CodeTarget = AbsenceType | "IGNORE";
export type CodeMap = Record<string, CodeTarget>;
export const CODE_TARGETS: readonly CodeTarget[] = [...ABSENCE_TYPES, "IGNORE"];
export const CODE_TARGET_LABELS: Record<CodeTarget, string> = { ...ABSENCE_LABELS, IGNORE: "Hoppa över (påverkar inte planeringen)" };

// Words, not anyone's code list: a code or text containing them is suggested as the type (the person confirms it).
const WORDS: [RegExp, AbsenceType][] = [
  [/\bvab\b|vård av (sjukt )?barn|tillfällig föräldra/, "VAB"],
  [/föräldra|parental/, "PARENTAL"],
  [/sjuk|sick|karens/, "SICK"],
  [/semester|vacation|holiday/, "VACATION"],
  [/\bflex/, "FLEX"],
  [/\bkomp|jourledig|compensat/, "COMP"],
  [/utbildning|\bkurs|training|course/, "TRAINING"],
  [/tjänstledig|ledig|permission|\bleave\b/, "LEAVE"],
];

/** The type a code maps to: the company's saved mapping first, then a suggestion from its words (null = unknown). */
export function typeOfCode(code: string, map: CodeMap): { type: CodeTarget | null; suggested: boolean } {
  const key = normalizeCode(code);
  if (!key) return { type: null, suggested: false };
  if (map[key]) return { type: map[key], suggested: false };
  if ((ABSENCE_TYPES as readonly string[]).includes(code.trim().toUpperCase())) return { type: code.trim().toUpperCase() as AbsenceType, suggested: true };
  const found = WORDS.find(([pattern]) => pattern.test(key));
  return found ? { type: found[1], suggested: true } : { type: null, suggested: false };
}

/** A status written in a file → Workflow's status. Empty means approved (a file of approved absence often has no column). */
export function statusOf(text: string): AbsenceStatus | null {
  const value = normalizeCode(text);
  if (!value) return "APPROVED";
  if (/^(godk|attest|bevilj|beslutad|approved|accepted|ja$|yes$|1$|ok$)/.test(value)) return "APPROVED";
  if (/^(ans[oö]k|s[oö]kt|v[aä]ntar|preliminär|ej attest|applied|pending|requested|0$)/.test(value)) return "APPLIED";
  if (/^(avsl|nekad|avvisad|rejected|denied|declined|nej$|no$)/.test(value)) return "REJECTED";
  if (/^(makul|[aå]tertag|borttag|annuller|struken|cancel|withdrawn|deleted)/.test(value)) return "WITHDRAWN";
  return null;
}
