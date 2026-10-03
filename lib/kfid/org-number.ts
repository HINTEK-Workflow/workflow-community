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
