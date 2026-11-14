// Swedish organisation numbers (2026-10-03: registration asks only for the number; no register lookup yet, since
// Bolagsverket's lookup costs). Ten digits with a Luhn check digit; twelve digits with a 16/19/20 prefix are accepted.

/** The ten digits of a valid number, or null. */
export function normalizeOrgNumber(value: string): string | null {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 12 && /^(16|19|20)/.test(digits)) digits = digits.slice(2);
  if (digits.length !== 10) return null;
  let sum = 0;
  for (let index = 0; index < 9; index++) {
    let part = Number(digits[index]) * (index % 2 === 0 ? 2 : 1);
    if (part > 9) part -= 9;
    sum += part;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[9]) ? digits : null;
}

/** NNNNNN-NNNN, as it is written. */
export const formatOrgNumber = (digits: string) => `${digits.slice(0, 6)}-${digits.slice(6)}`;

// ---------- Enskild firma (2026-11-04) ----------
// A sole trader has no organisation number of its own: the personal number (personnummer, or samordningsnummer) is used in
// its place, written NNNNNN-NNNN too. The two kinds are told apart by the third digit: an organisation number has 2 or higher
// there (the month of a personal number is 01-12), so a personal number is never taken for an organisation number or the
// other way round. Both are stored in the same field, in the same form, so uniqueness and lookups work as before.

export type CompanyType = "company" | "soleTrader";
export const COMPANY_TYPES: readonly CompanyType[] = ["company", "soleTrader"];

const luhnOk = (digits: string) => {
  let sum = 0;
  for (let index = 0; index < 9; index++) {
    let part = Number(digits[index]) * (index % 2 === 0 ? 2 : 1);
    if (part > 9) part -= 9;
    sum += part;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[9]);
};

/** The ten digits of a valid personnummer or samordningsnummer (day + 60), or null. A century prefix 19 or 20 is accepted. */
export function normalizePersonalNumber(value: string): string | null {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 12 && /^(19|20)/.test(digits)) digits = digits.slice(2);
  if (digits.length !== 10 || !luhnOk(digits)) return null;
  const month = Number(digits.slice(2, 4));
  const day = Number(digits.slice(4, 6));
  if (month < 1 || month > 12) return null;
  return (day >= 1 && day <= 31) || (day >= 61 && day <= 91) ? digits : null;
}

/** The ten digits of a valid organisation number as a company has it (not a personal number), or null. */
export function normalizeCompanyOrgNumber(value: string): string | null {
  const digits = normalizeOrgNumber(value);
  return digits && Number(digits[2]) >= 2 ? digits : null;
}

/** The number a company of the given kind is registered with, ten digits, or null. */
export const normalizePartyNumber = (value: string, type: CompanyType) => type === "soleTrader" ? normalizePersonalNumber(value) : normalizeCompanyOrgNumber(value);

/** True for something that has the shape of a personal number (valid, third digit 0 or 1): used to tell a person who chose "company" by mistake. */
export const looksLikePersonalNumber = (value: string) => normalizePersonalNumber(value) !== null && normalizeCompanyOrgNumber(value) === null;

export const MASK = "••••";
/** A personal number as it is shown wherever the whole number is not needed: the last four digits hidden (ÅÅMMDD-••••). */
export function maskPersonalNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 6 ? `${digits.slice(0, 6)}-${MASK}` : MASK;
}
export const isMaskedNumber = (value: string) => value.includes("•") || value.includes("*");

/** The company's number for someone who may not see a sole trader's whole personal number; an organisation number is public and stays. */
export const numberForOthers = (value: string, type: CompanyType | undefined) => type === "soleTrader" && value ? maskPersonalNumber(value) : value;

/** What the form says about the number: "Organisationsnummer" or "Personnummer". */
export const partyNumberLabel = (type: CompanyType) => type === "soleTrader" ? "Personnummer" : "Organisationsnummer";
