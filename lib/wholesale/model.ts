import { z } from "zod";

/**
 * Grossistexport (2026-10-12, Tilläggsprompt_Grossistexport): what a material row remembers for an order at a
 * wholesaler. Nothing here is a register: it is one small, optional, additive field on the row itself, kept the same
 * way on a work order's material row (lib/workflow/task-model.ts) and on a quote line (inside its `catalogue` JSON,
 * lib/quotes/model.ts), so Cloud, Local (.hwf) and the demo read it alike.
 */
export const WHOLESALERS = ["solar", "ahlsell", "sonepar", "rexel"] as const;
export type WholesalerId = (typeof WHOLESALERS)[number];
export const WHOLESALER_LABELS: Record<WholesalerId, string> = { solar: "Solar", ahlsell: "Ahlsell", sonepar: "Sonepar", rexel: "Rexel" };

/**
 * How the consumption unit of the row turns into the wholesaler's order unit, as the person entered it:
 * `perUnit` consumption units go into one order unit (100 m per rulle), `multiple` is the order multiple in order units.
 */
export type RowPack = { orderUnit: string; perUnit: string; multiple?: string };

/** The row's own notes per wholesaler: the article number to order with, and the order unit conversion. */
export type RowWholesale = {
  ids?: Partial<Record<WholesalerId, string>>;
  packs?: Partial<Record<WholesalerId, RowPack>>;
  /**
   * Ett artikelregister (2026-10-12): the numbers among `ids` that came from the company's product register when
   * the article was picked – the same E-nummer or RSK-nummer in that wholesaler's own price file. Kept only while the
   * id is unchanged, so a number the person typed is never called the price list's.
   */
  linked?: Partial<Record<WholesalerId, string>>;
};

const idText = z.string().trim().max(60);
export const rowWholesaleSchema = z.object({
  ids: z.partialRecord(z.enum(WHOLESALERS), idText).optional(),
  packs: z.partialRecord(z.enum(WHOLESALERS), z.object({
    orderUnit: z.string().trim().max(40),
    perUnit: z.string().trim().max(20),
    multiple: z.string().trim().max(20).optional(),
  })).optional(),
  linked: z.partialRecord(z.enum(WHOLESALERS), idText).optional(),
});

/** The note without empty entries; undefined when nothing is left (so a row without notes stores nothing). */
export function cleanRowWholesale(value: RowWholesale | null | undefined): RowWholesale | undefined {
  if (!value) return undefined;
  const ids: Partial<Record<WholesalerId, string>> = {};
  const linked: Partial<Record<WholesalerId, string>> = {};
  const packs: Partial<Record<WholesalerId, RowPack>> = {};
  for (const id of WHOLESALERS) {
    const articleNo = value.ids?.[id]?.trim().slice(0, 60);
    if (articleNo) ids[id] = articleNo;
    if (articleNo && value.linked?.[id]?.trim() === articleNo) linked[id] = articleNo;
    const pack = value.packs?.[id];
    if (pack && (pack.orderUnit.trim() || pack.perUnit.trim())) {
      const multiple = pack.multiple?.trim().slice(0, 20);
      packs[id] = { orderUnit: pack.orderUnit.trim().slice(0, 40), perUnit: pack.perUnit.trim().slice(0, 20), ...(multiple ? { multiple } : {}) };
    }
  }
  const result: RowWholesale = { ...(Object.keys(ids).length ? { ids } : {}), ...(Object.keys(packs).length ? { packs } : {}), ...(Object.keys(linked).length ? { linked } : {}) };
  return Object.keys(result).length ? result : undefined;
}

/** Reads a stored value; anything unreadable is left out. */
export function readRowWholesale(value: unknown): RowWholesale | undefined {
  const parsed = rowWholesaleSchema.safeParse(value);
  return parsed.success ? cleanRowWholesale(parsed.data as RowWholesale) : undefined;
}
