/**
 * Logga in med telefonen (2026-11-27): the WebAuthn hint "hybrid" asks the browser to show the QR code for a phone at
 * once (for signing in, and for saving a passkey in the phone). Only a hint, added in the browser: it is not part of what
 * is signed, the server checks the answer exactly as any passkey's, and a browser without hints shows its usual choice.
 * Client-safe (no imports), used by the login page and Mina inställningar → Säkerhet.
 */
export const withPhoneHint = <T extends object>(options: T): T & { hints: "hybrid"[] } => ({ ...options, hints: ["hybrid"] });
