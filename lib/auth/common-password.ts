import { isCommonWord } from "../operator/common-passwords";

/**
 * Vanliga lösenord (säkerhetsgranskning 2026-11-20, L3; ASVS V2.1.7): the same offline list as the operator accounts
 * (lib/operator/common-passwords.ts) now also stops an ordinary account's password – at Skapa konto, Återställ lösenord,
 * Byt lösenord, an accepted invitation and admin:create. A common word is refused also with a year, a few digits or a sign
 * after it ("Password1234", "Sommar2026!!"). Pure: the server, the scripts and the tests read the same rule.
 */
export const COMMON_PASSWORD_REFUSAL = "Lösenordet är för vanligt. Välj ett annat.";

export function isCommonPassword(password: string): boolean {
  const compact = password.toLowerCase().replace(/\s+/g, "");
  const base = compact.replace(/[\d!?.#*@_\-+]{0,6}$/, "");
  return isCommonWord(compact) || (base.length >= 3 && isCommonWord(base));
}
