import { z } from "zod";

/**
 * Inköp (2026-10-16): what a quote line or a work order's material row carries when it came from a purchase – the
 * purchase, its number for the eye, the revision it was taken at, and the line (absent for the one quote line with the
 * whole sum). `origin` = the row was picked on the document and added to the purchase from there (snabbvalet), so the
 * document's own later changes go to the purchase. Kept apart so the quote and task models can read it without the rest.
 */
export const purchaseRefSchema = z.object({
  purchaseId: z.string().trim().min(1).max(100),
  label: z.string().trim().max(20).default(""),
  revision: z.number().int().min(1),
  lineId: z.string().trim().max(100).optional(),
  sum: z.literal(true).optional(),
  origin: z.literal(true).optional(),
});
export type PurchaseRef = z.output<typeof purchaseRefSchema>;
export const readPurchaseRef = (value: unknown): PurchaseRef | undefined => { const parsed = purchaseRefSchema.safeParse(value); return parsed.success ? parsed.data : undefined; };
