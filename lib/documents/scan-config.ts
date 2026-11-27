import type { ClamConfig, ScanVerdict } from "./clamav";

/**
 * Which virus scan this installation runs for documents (0.87.0), from DOCUMENT_SCAN and CLAMAV_* (lib/env.ts):
 *  - "clamav": every upload is sent to clamd and the document is served only once it is clean. While clamd cannot be reached the
 *    document waits ("Väntar på virussökning") and is tried again; it is never served unscanned.
 *  - "off": no scanner on this installation (a Community install without ClamAV, DOCUMENT_SCAN=off or no CLAMAV_HOST with "auto").
 *    The document is served at once and marked "Inte virussökt" everywhere it is shown, so nobody takes it for scanned. When a
 *    scanner is set up later, the unscanned documents are scanned the next time the list is read.
 * Pure, so the tests can give it any settings.
 */
export type ScanSetting = { mode: "clamav"; clam: ClamConfig } | { mode: "off" };
export type ScanEnv = { DOCUMENT_SCAN: "auto" | "clamav" | "off"; CLAMAV_HOST?: string; CLAMAV_PORT: number; CLAMAV_TIMEOUT_MS: number };

export function scanSettingOf(env: ScanEnv): ScanSetting {
  if (env.DOCUMENT_SCAN === "off") return { mode: "off" };
  const host = env.CLAMAV_HOST?.trim();
  // DOCUMENT_SCAN=clamav without a host is refused when the settings are read (lib/env.ts); "auto" without one is off.
  if (!host) return { mode: "off" };
  return { mode: "clamav", clam: { host, port: env.CLAMAV_PORT, timeoutMs: env.CLAMAV_TIMEOUT_MS } };
}

/** How many times a waiting document is tried before it is left for a person (it stays waiting and is never served). */
export const SCAN_MAX_ATTEMPTS = 50;

/**
 * What a scan's verdict changes on the document: clean is served, infected loses its bytes at once (`removeFile`), and an answer
 * that could not be had leaves the status as it was – a waiting file keeps waiting, an unscanned one stays as it was – with the
 * reason in fixed words. Pure, for the tests.
 */
export function scanUpdate(verdict: ScanVerdict, current: "pending" | "unscanned", now: Date) {
  if (verdict.result === "clean") return { removeFile: false, data: { scanStatus: "clean", scanSignature: null, scanError: null, scannedAt: now } };
  if (verdict.result === "infected") return { removeFile: true, data: { scanStatus: "infected", scanSignature: verdict.signature, scanError: null, scannedAt: now, storagePath: null } };
  return { removeFile: false, data: { scanStatus: current, scanError: SCAN_ERROR_TEXT[verdict.reason] } };
}
export const SCAN_ERROR_TEXT: Record<Extract<ScanVerdict, { result: "error" }>["reason"], string> = {
  unreachable: "Virussökningen kunde inte nås.",
  timeout: "Virussökningen svarade inte i tid.",
  "too-large": "Filen är större än virussökningen tar emot.",
  "scanner-error": "Virussökningen gav ett fel.",
  "unreadable-answer": "Virussökningens svar gick inte att läsa.",
};
