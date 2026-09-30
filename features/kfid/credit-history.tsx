"use client";

import { useState } from "react";
import { formatSwedish } from "@/lib/swedish-time";
import { api } from "./api";
import type { Overview } from "./types";
import { Panel, ShowMore } from "./ui";

type CreditEntryRow = Overview["entries"][number];

// Credit history for admins (Daniel 2026-09-26): newest 25 first, older pages on request, never the whole ledger.
export function CreditHistory({ entries, total }: { entries: CreditEntryRow[]; total: number }) {
  const [older, setOlder] = useState<CreditEntryRow[]>([]);
  const [busy, setBusy] = useState(false);
  const shown = [...entries, ...older];
  const loadMore = async () => {
    setBusy(true);
    try {
      const oldest = shown[shown.length - 1]?.createdAt ?? "";
      const page = await api<{ entries: CreditEntryRow[] }>(`/api/workspace?action=creditEntries&before=${encodeURIComponent(oldest)}`);
      setOlder((current) => [...current, ...page.entries]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Kredithistorik" description={total ? `${total} händelser, senaste först.` : undefined}>
      {shown.length ? (
        <div>
          {shown.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between gap-4 border-b py-2 last:border-0">
              <div>
                <p className="text-sm font-medium">{entry.description}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{formatSwedish(entry.createdAt, { dateStyle: "short", timeStyle: "short" })}</p>
              </div>
              <span className={`text-sm font-semibold tabular-nums ${entry.amount > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-foreground"}`}>
                {entry.amount > 0 ? "+" : ""}
                {entry.amount}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Ingen historik ännu.</p>
      )}
      <ShowMore shown={shown.length} total={total} busy={busy} onMore={() => void loadMore()} />
    </Panel>
  );
}
