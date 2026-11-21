"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { RowChevron } from "@/components/row-chevron";
import Link from "next/link";
import { FolderKanban, Mail, MapPin, Phone, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AreaIcon } from "@/components/area-icon";
import { PageHeader } from "@/components/page-shell";
import { ListCard, ListCardGrid, ListFilterBar, type ListChip } from "@/components/list-filter-bar";
import { customerContact, customerTitle } from "@/lib/kfid/customer-name";
import { CUSTOMER_FILTER_LABEL, CUSTOMER_FILTERS, CUSTOMER_SORTS, type CustomerFilter, type CustomerSort } from "@/lib/kfid/customer-list";
import { listSortOptions } from "@/lib/list-filter";
import type { WorkListView } from "@/lib/workflow/work-list";
import { Empty } from "./ui";
import { DelayedSkeleton, RowsSkeleton } from "@/components/skeleton";

/** What a row of the customer register needs of a customer (Cloud and Local alike). */
export type RegisterCustomer = { id: string; name: string; company?: string | null; customerType?: string | null; city?: string | null; address?: string | null; phone?: string | null; mobile?: string | null; email?: string | null; projects?: number | null };

const CUSTOMER_SORT_OPTIONS = listSortOptions(CUSTOMER_SORTS);
/** The chips of the customer list: Alla | Företag | Privatpersoner, with counts once they are known. */
export const customerChips = (counts: Partial<Record<CustomerFilter, number>> | null | undefined): ListChip<CustomerFilter>[] => CUSTOMER_FILTERS.map((value) => ({ value, label: CUSTOMER_FILTER_LABEL[value], count: counts?.[value] ?? null }));

/** The address of a customer's page; the chosen customer is kept in the address (`customerId`). */
export const customerCardHref = (id: string) => `/?view=customers&customerId=${encodeURIComponent(id)}`;

/**
 * The names the register's rows showed during this visit (2026-10-16): a customer's page opened from a row shows the name
 * in its header and trail at once while the card is read, instead of a placeholder that changes length when it comes.
 */
const shownNames = new Map<string, string>();
export const rememberedCustomerName = (id: string) => shownNames.get(id);

/**
 * Kunder | Alla objekt (decision B5; Lika är rätt, 2026-11-13): the tabs are the shell's tab row. With Alla objekt
 * chosen (`objects`), CustomerRegisterSwitch hands the places' register here and the register's list page draws it under
 * its own header, with the same Papperskorg and Ny kund as Kunder; `leave` goes back to Kunder (Papperskorg opens Kunder's).
 */
export const RegisterTabsContext = createContext<{ objects: { register: ReactNode; leave: () => void } | null } | null>(null);

/**
 * Kundregistret som listsida (2026-10-14, replaces the list beside the card of plan 1R and the frame of
 * 2026-10-13): an ordinary list page as Mina projekt – the standard header with Ny kund, the shared toppvisning (
 * 2026-10-31: chips, search, sort, Rader | Kort), and one row or card per customer that opens the customer's own page in the
 * normal page width. The company stands first and the contact person under it (beslut 18, lib/kfid/customer-name.ts).
 * Display 2 and 3, Cloud and Local; the phone (level 1) keeps its own list.
 */
export function CustomerListPage({ title = "Kunder", description, onTrash, onNew, intro, items, query, onQuery, searchLabel, filter, sort, view, footer, error, loading, emptyText, count }: {
  title?: string;
  description: string;
  /** The header's buttons, the same on Kunder and Alla objekt: Papperskorg, then Ny kund (primary, last; only with the right). */
  onTrash: () => void;
  onNew?: () => void;
  /** Something between the toolbar and the list (Local's notice). */
  intro?: ReactNode;
  items: RegisterCustomer[];
  query: string;
  onQuery: (value: string) => void;
  searchLabel: string;
  /** The chips, the sort and Rader | Kort of the toppvisning. */
  filter: { chips: ListChip<CustomerFilter>[]; value: CustomerFilter; onChange: (value: CustomerFilter) => void };
  sort: { value: CustomerSort; onChange: (value: CustomerSort) => void };
  view: { value: WorkListView; onChange: (value: WorkListView) => void };
  /** The pager under the list. */
  footer?: ReactNode;
  error?: string;
  loading?: boolean;
  emptyText: string;
  count?: number;
}) {
  const objects = useContext(RegisterTabsContext)?.objects ?? null;
  useEffect(() => { for (const item of items) shownNames.set(item.id, customerTitle(item)); }, [items]);
  const actions = <>
    <Button variant="outline" onClick={() => { objects?.leave(); onTrash(); }} data-testid="customer-trash-toggle"><Trash2 />Papperskorg</Button>
    {onNew ? <Button onClick={onNew} data-testid="customer-new"><Plus />Ny kund</Button> : null}
  </>;
  // Alla objekt: the same header buttons, the places' register as the list.
  if (objects) return <div className="min-w-0" data-testid="object-register-page">
    <PageHeader title="Alla objekt" description="Kundernas anläggningar och objekt, med öppna arbetsordrar." actions={actions} />
    {objects.register}
  </div>;
  const cards = view.value === "cards" && items.length > 0 && !error;
  return <div className="min-w-0" data-testid="customer-register-page" data-view={view.value}>
    <PageHeader title={title} description={description} actions={actions} />
    <ListFilterBar testId="customers" label="Sök och sortera kunder"
      chips={{ label: "Visa", chips: filter.chips, value: filter.value, onChange: filter.onChange, testId: "customers-filter" }}
      search={{ label: searchLabel, placeholder: "Sök namn, företag, adress eller kontaktuppgifter…", value: query, onChange: onQuery }}
      sort={{ value: sort.value, options: CUSTOMER_SORT_OPTIONS, onChange: sort.onChange }}
      view={view} />
    {intro ? <div className="mt-4">{intro}</div> : null}
    <section aria-label={count !== undefined ? `${title}, ${count} ${count === 1 ? "kund" : "kunder"}` : title} className={cards ? "mt-4" : "mt-4 overflow-hidden rounded-xl border bg-card shadow-xs"} data-testid="customer-list">
      {error ? <p role="alert" className="p-4 text-sm text-destructive">{error}</p>
        : cards ? <ListCardGrid testId="customer-cards" busy={loading}>{items.map((item) => <ListCard key={item.id} testId="customer-list-row" data={{ "data-customer-id": item.id }} href={customerCardHref(item.id)} linkLabel={`Kundkort för ${customerTitle(item)}`}
          icon={<AreaIcon area="customer" />} title={customerTitle(item)} subtitle={customerContact(item)}
          facts={[
            item.address || item.city ? { icon: MapPin, label: "Adress", value: [item.address, item.city].filter(Boolean).join(", ") } : null,
            item.phone || item.mobile ? { icon: Phone, label: "Telefon", value: item.phone || item.mobile } : null,
            item.email ? { icon: Mail, label: "E-post", value: item.email } : null,
            item.projects != null ? { icon: FolderKanban, label: "Projekt", value: `${item.projects} projekt` } : null,
          ]} />)}</ListCardGrid>
        : items.length ? <ul className="divide-y" aria-busy={loading}>{items.map((item) => {
          const where = [customerContact(item), [item.address, item.city].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
          return <li key={item.id}><Link href={customerCardHref(item.id)} aria-label={`Kundkort för ${customerTitle(item)}`} className="tap-card flex min-h-14 min-w-0 items-center gap-3 px-4 py-2.5 outline-none hover:bg-secondary/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" data-testid="customer-list-row" data-customer-id={item.id}>
            {/* The icon standard (2026-10-24: "komplettera saknade ikoner, bland annat i kundlistan"): the customer's soft square. */}
            <AreaIcon area="customer" />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{customerTitle(item)}</span>{where ? <span className="block truncate text-xs text-muted-foreground" title={where}>{where}</span> : null}</span>
            {item.projects != null ? <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{item.projects} projekt</span> : null}
            <RowChevron />
          </Link></li>;
        })}</ul>
        : loading ? <DelayedSkeleton className="px-4 py-2.5" testId="customer-list-loading"><RowsSkeleton rows={7} label="Hämtar kunder…" /></DelayedSkeleton>
        : <div className="p-4"><Empty title="Inga kunder" description={emptyText} /></div>}
    </section>
    {footer ? <div className="mt-3">{footer}</div> : null}
  </div>;
}
