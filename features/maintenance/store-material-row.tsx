"use client";

import { useState } from "react";
import Link from "next/link";
import { Undo2, Warehouse } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { announce } from "@/lib/workflow/toast";
import type { MaterialRow } from "@/lib/workflow/expenses";
import { storeRowLabel } from "@/lib/workflow/store-rows";
import { maintenancePost } from "./maintenance-api";

/** Förrådet under Underhåll (features/maintenance/maintenance-page.tsx, `&tab=store`). */
export const STORE_HREF = "/?view=maintenance&tab=store";

/**
 * Uttag ur förrådet på arbetsordern (2026-10-30): a row the store wrote is shown locked – Benämning, Antal, Enhet
 * and Art.nr as text, where it came from, and the way to change it: Lämna tillbaka (the store's return) or Förrådet. À-pris
 * and Påslag stay the price right's own fields (`priceFields`). The server keeps the row as stored whatever a save sends
 * (lib/workflow/store-rows.ts); the work order page reads the new version by itself after a return (live sync).
 */
export function StoreMaterialRow({ row, priceFields, canReturn }: { row: MaterialRow; priceFields?: React.ReactNode; canReturn: boolean }) {
  const [busy, setBusy] = useState(false);
  const ref = row.storeRef;
  if (!ref) return null;
  const giveBack = async () => {
    setBusy(true);
    try { await maintenancePost({ action: "return", id: ref.transactionId }); announce(`${row.name} är tillbaka i förrådet.`); }
    catch (cause) { announce((cause as Error).message, true); } finally { setBusy(false); }
  };
  const facts = [[row.quantity, row.unit].filter((value) => value?.trim()).join(" "), row.articleNo ? `Art.nr ${row.articleNo}` : ""].filter(Boolean).join(" · ");
  return <div className="grid grid-cols-2 items-end gap-x-2 gap-y-3 rounded-lg border p-3" data-testid="material-row" data-store-row={ref.return ? "return" : "withdrawal"}>
    <div className="col-span-full flex flex-wrap items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={row.name}>{row.name}</p>
        <p className="text-xs text-muted-foreground tabular-nums" data-testid="store-row-facts">{facts}</p>
      </div>
      <Badge variant="outline" className={indicatorBadge(ref.return ? "neutral" : "info")} data-testid="store-row-label"><Warehouse aria-hidden="true" />{storeRowLabel(row)}</Badge>
    </div>
    {priceFields}
    <div className="col-span-full flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground">{ref.return ? "Återlämnad efter fakturering." : "Antal ändras i förrådet."}</p>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="ghost" size="sm"><Link href={STORE_HREF} data-testid="store-row-open">Förrådet</Link></Button>
        {!ref.return && canReturn ? <Button type="button" variant="outline" size="sm" busy={busy} busyLabel="Lämnar tillbaka…" onClick={() => void giveBack()} data-testid="store-row-return"><Undo2 />Lämna tillbaka</Button> : null}
      </div>
    </div>
  </div>;
}
