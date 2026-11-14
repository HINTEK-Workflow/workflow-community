"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { customerContact, customerTitle } from "@/lib/kfid/customer-name";

export type CustomerAccordionItem = {
  id: string;
  name: string;
  company?: string | null;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
};

export function CustomerAccordionList({ items, leading, actions, work, editor }: {
  items: CustomerAccordionItem[];
  leading?: (item: CustomerAccordionItem) => ReactNode;
  actions: (item: CustomerAccordionItem) => ReactNode;
  /** The customer's work in one line (projects, work orders, risk assessments). */
  work: (item: CustomerAccordionItem) => ReactNode;
  /**
   * The customer's edit form, folded out in the row (plan 1Q, 2026-10-11); null while the row is not being edited.
   * An edited row is open and shows the form instead of the details.
   */
  editor?: (item: CustomerAccordionItem) => ReactNode | null;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return (
    /* Up to 1280 px (QA 2026-10-10: at 1024–1279 px beside the menu the table scrolled sideways and cut Ny uppgift). */
    <div className="customer-accordion-list overflow-hidden rounded-xl border bg-card xl:hidden" data-testid="customer-accordion-list">
      {items.map((item, index) => {
        const editing = editor?.(item) ?? null;
        const expanded = expandedId === item.id || editing !== null;
        const detailsId = `customer-details-${item.id}`;
        return (
          <section key={item.id} className={index ? "border-t" : undefined} data-customer-row={item.id}>
            <div className="flex min-w-0 items-center gap-3 px-4 py-3">
              {leading?.(item)}
              <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpandedId(expanded ? null : item.id)}>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-medium">{customerTitle(item)}</span>
                  <span className="mt-0.5 block break-words text-xs text-muted-foreground">
                    {customerContact(item)}
                  </span>
                </span>
                <ChevronDown className={`size-4 shrink-0 text-muted-foreground ${expanded ? "" : "-rotate-90"}`} aria-hidden="true" />
              </button>
            </div>
            {editing ? <div id={detailsId} className="border-t bg-muted/20 px-4 py-4" data-testid="customer-accordion-edit">{editing}</div> : null}
            {expanded && !editing && (
              <div id={detailsId} className="border-t bg-muted/20 px-4 py-4" data-testid="customer-accordion-details">
                <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
                  <div className="min-w-0"><dt className="text-xs text-muted-foreground">Adress</dt><dd className="mt-1 break-words">{[item.address, item.postalCode, item.city].filter(Boolean).join(", ") || "—"}</dd></div>
                  <div className="min-w-0"><dt className="text-xs text-muted-foreground">Kontakt</dt><dd className="mt-1 min-w-0 break-words">
                    {item.email && <a className="block break-all hover:text-primary" href={`mailto:${item.email}`}>{item.email}</a>}
                    {(item.phone || item.mobile) && <a className="mt-1 block break-all text-muted-foreground hover:text-primary" href={`tel:${item.phone || item.mobile}`}>{item.phone || item.mobile}</a>}
                    {!item.email && !item.phone && !item.mobile && "—"}
                  </dd></div>
                  <div className="min-w-0 sm:col-span-2"><dt className="text-xs text-muted-foreground">Arbete</dt><dd className="mt-1">{work(item)}</dd></div>
                </dl>
                <div className="mt-4">{actions(item)}</div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
