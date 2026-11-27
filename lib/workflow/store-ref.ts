import { z } from "zod";

/**
 * Uttag ur förrådet (2026-10-30): what a work order's material row carries when the store wrote it – the store's log
 * row and the location's name. Kept apart so the task model can read it without the rest (lib/workflow/store-rows.ts).
 */
export const storeRefSchema = z.object({
  /** The store's log row: the WITHDRAWAL, or for a return row the RETURN. */
  transactionId: z.string().trim().min(1).max(100),
  locationName: z.string().trim().max(120).default(""),
  /** A return row (negative quantity) for a withdrawal already on an invoice basis. */
  return: z.literal(true).optional(),
});
export type StoreRef = z.output<typeof storeRefSchema>;
