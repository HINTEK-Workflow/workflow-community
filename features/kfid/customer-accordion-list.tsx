"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

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
  controlCount: number;
};

export function CustomerAccordionList({ items, leading, actions, controlLink }: {
  items: CustomerAccordionItem[];
  leading?: (item: CustomerAccordionItem) => ReactNode;
  actions: (item: CustomerAccordionItem) => ReactNode;
  controlLink: (item: CustomerAccordionItem) => ReactNode;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return (
    <div className="customer-accordion-list overflow-hidden rounded-xl border bg-card lg:hidden" data-testid="customer-accordion-list">
      {items.map((item, index) => {
        const expanded = expandedId === item.id;
        const detailsId = `customer-details-${item.id}`;
        return (
          <section key={item.id} className={index ? "border-t" : undefined} data-customer-row={item.id}>
            <div className="flex min-w-0 items-center gap-3 px-4 py-3">
              {leading?.(item)}
              <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpandedId(expanded ? null : item.id)}>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-medium">{item.name}</span>
                  <span className="mt-0.5 block break-words text-xs text-muted-foreground">
                    {[item.company, `${item.controlCount} ${item.controlCount === 1 ? "kontroll" : "kontroller"}`].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
            </div>
            {expanded && (
              <div id={detailsId} className="border-t bg-muted/20 px-4 py-4" data-testid="customer-accordion-details">
                <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
                  <div className="min-w-0"><dt className="text-xs text-muted-foreground">Adress</dt><dd className="mt-1 break-words">{[item.address, item.postalCode, item.city].filter(Boolean).join(", ") || "—"}</dd></div>
                  <div className="min-w-0"><dt className="text-xs text-muted-foreground">Kontakt</dt><dd className="mt-1 min-w-0 break-words">
                    {item.email && <a className="block break-all hover:text-primary" href={`mailto:${item.email}`}>{item.email}</a>}
                    {(item.phone || item.mobile) && <a className="mt-1 block break-all text-muted-foreground hover:text-primary" href={`tel:${item.phone || item.mobile}`}>{item.phone || item.mobile}</a>}
                    {!item.email && !item.phone && !item.mobile && "—"}
                  </dd></div>
                  <div className="min-w-0 sm:col-span-2"><dt className="text-xs text-muted-foreground">Kontroller</dt><dd className="mt-1">{controlLink(item)}</dd></div>
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
