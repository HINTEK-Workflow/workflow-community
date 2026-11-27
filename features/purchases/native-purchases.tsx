"use client";

import { useRouter } from "next/navigation";
import { DelayedSkeleton } from "@/components/skeleton";
import { ListEmpty, ListGroup, ListRow, ListSkeleton, NativePage, NativePickerRow, NativeSearch, NativeSegmented, useNativeTopBar } from "@/components/native";
import { purchaseStatusTone } from "@/features/purchases/purchase-editor";
import { purchaseName, PURCHASE_FILTER_LABELS, PURCHASE_FILTERS, PURCHASE_STATUS_LABELS, type PurchaseFilter, type PurchaseListItem, type PurchaseStatus } from "@/lib/purchases/model";
import { formatSek } from "@/lib/workflow/expenses";

/** The groups of the phone's list, in the order a purchase goes: what is being made, what is ordered, what has come. */
const GROUPS: { status: PurchaseStatus; label: string }[] = [
  { status: "DRAFT", label: "Utkast" },
  { status: "ORDERED", label: "Beställda" },
  { status: "DELIVERED", label: "Levererade" },
  { status: "CANCELLED", label: "Makulerade" },
];

/**
 * Inköp at level 1 on a phone (Lika är rätt, 2026-11-14): the same app screen as Offerter – the top bar (title and Nytt
 * inköp), the compact search, Mina | Alla, the status filter as one row that opens the phone's own list, and the purchases as rows
 * grouped by status. A row: the name, the suppliers or the project, the sum excl. VAT (when the person may see prices), and the
 * status as a pill. The same server list, filters and paging as the ordinary page.
 */
export function NativePurchasesList({ items, total, hasMore, busy, error, canEdit, scope, onScope, filter, onFilter, query, onQuery, onMore }: {
  items: PurchaseListItem[] | null; total: number; hasMore: boolean; busy: boolean; error: string; canEdit: boolean;
  scope: "mine" | "all"; onScope: (scope: "mine" | "all") => void; filter: PurchaseFilter; onFilter: (filter: PurchaseFilter) => void;
  query: string; onQuery: (query: string) => void; onMore: () => void;
}) {
  const router = useRouter();
  useNativeTopBar({ title: "Inköp", save: canEdit ? { label: "Nytt inköp", onClick: () => router.push("/?view=purchase") } : null });
  const groups = items ? GROUPS.map((group) => ({ ...group, items: items.filter((item) => item.status === group.status) })).filter((group) => group.items.length) : [];
  return <NativePage testId="native-purchases">
    <NativeSearch value={query} onChange={onQuery} label="Sök inköp" placeholder="Namn, projekt eller nummer" />
    <NativeSegmented label="Mina eller alla" testId="purchases-scope" value={scope} onChange={onScope} options={[["mine", "Mina"], ["all", "Alla"]]} />
    <ListGroup testId="native-purchases-filter">
      <NativePickerRow label="Filter" display={PURCHASE_FILTER_LABELS[filter]}>
        <select aria-label="Status" value={filter} onChange={(event) => onFilter(event.target.value as PurchaseFilter)}>
          {PURCHASE_FILTERS.map((value) => <option key={value} value={value}>{PURCHASE_FILTER_LABELS[value]}</option>)}
        </select>
      </NativePickerRow>
    </ListGroup>
    {error ? <p role="alert" className="notice mt-3 text-destructive">{error}</p> : null}
    {!items ? <DelayedSkeleton><ListSkeleton rows={6} label="Hämtar inköp…" testId="native-purchases-loading" /></DelayedSkeleton>
      : !items.length ? <ListGroup><ListEmpty>{filter === "open" && !query ? "Inga pågående inköp." : "Inget matchar urvalet. Ändra filter eller sökning."}</ListEmpty></ListGroup>
      : <div aria-busy={busy} data-testid="native-purchase-rows">
        {groups.map((group) => <ListGroup key={group.status} title={group.label} testId={`native-purchase-group-${group.status.toLowerCase()}`} alignPills>
          {group.items.map((item) => <ListRow key={item.id} href={`/?view=purchase&purchaseId=${encodeURIComponent(item.id)}`} type="purchase" title={purchaseName(item)} testId="purchase-row"
            subtitle={[item.amount ? `${formatSek(item.amount)} kr` : "", item.project?.name || item.suppliers.join(", ") || `${item.lines} ${item.lines === 1 ? "rad" : "rader"}`].filter(Boolean).join(" · ")}
            pill={{ label: PURCHASE_STATUS_LABELS[item.status], tone: purchaseStatusTone(item.status) }} />)}
        </ListGroup>)}
        <p className="px-4 pt-3 text-xs text-muted-foreground" role="status">Visar {items.length} av {total} · summor exklusive moms</p>
        {hasMore ? <ListGroup><ListRow title={<span className="text-primary">{busy ? "Hämtar…" : "Visa fler inköp"}</span>} chevron={false} onClick={busy ? undefined : onMore} testId="purchases-more" /></ListGroup> : null}
      </div>}
  </NativePage>;
}
