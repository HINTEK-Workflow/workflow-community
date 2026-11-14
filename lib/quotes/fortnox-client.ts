import "server-only";
import { ApiError } from "@/lib/kfid/errors";
import type { FortnoxInvoicePayload } from "./fortnox";
import { FORTNOX_KEY_PLACE } from "./accounting";

/**
 * The only place that talks to Fortnox (steg D). Called only when the company has saved a Fortnox key under
 * Företagsnycklar and a person with Offerter – redigera presses "Skicka till Fortnox". The key is sent as a bearer
 * token and never logged or returned. Tests never reach this file: they test the payload builder (fortnox.ts), and the
 * fetch function can be replaced.
 */
export const FORTNOX_INVOICES_URL = "https://api.fortnox.se/3/invoices";
const TIMEOUT_MS = 15_000;

export type FortnoxFetch = (url: string, init: RequestInit) => Promise<Response>;

export async function createFortnoxInvoice(token: string, payload: FortnoxInvoicePayload, fetchImpl: FortnoxFetch = fetch): Promise<{ documentNumber: string }> {
  let response: Response;
  try {
    response = await fetchImpl(FORTNOX_INVOICES_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(502, "Fortnox svarade inte. Försök igen om en stund.");
  }
  const data = await response.json().catch(() => null) as { Invoice?: { DocumentNumber?: string | number }; ErrorInformation?: { message?: string; Message?: string } } | null;
  if (response.status === 401 || response.status === 403) throw new ApiError(502, `Fortnox godtog inte nyckeln. Byt nyckeln under ${FORTNOX_KEY_PLACE}.`);
  if (!response.ok) {
    // Fortnox's own message tells what was wrong (for example an unknown customer number); it never holds the key.
    const message = (data?.ErrorInformation?.message ?? data?.ErrorInformation?.Message ?? "").toString().slice(0, 300);
    throw new ApiError(502, message ? `Fortnox: ${message}` : `Fortnox svarade med fel (${response.status}).`);
  }
  return { documentNumber: String(data?.Invoice?.DocumentNumber ?? "") };
}
