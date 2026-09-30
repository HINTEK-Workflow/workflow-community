"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { addCustomerOption, CUSTOMER_OPTION_LIMIT, searchCustomerOptions, useCustomerOptionsTruncated } from "./customer-options";
import type { CustomerItem } from "./types";

/**
 * A search next to a customer choice (2026-09-30) – only for a company with more customers than the choice holds.
 * It asks the server, and the picked customer joins the choice and is selected. Nothing is shown for smaller companies.
 */
export function CustomerSearchBox({ enabled = true, onPick }: { enabled?: boolean; onPick: (customer: CustomerItem) => void }) {
  const truncated = useCustomerOptionsTruncated();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ term: string; customers: CustomerItem[] } | null>(null);
  const term = query.trim();
  useEffect(() => {
    if (!enabled || !truncated || term.length < 2) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void searchCustomerOptions(term).then((customers) => { if (active) setFound({ term, customers }); }).catch(() => { if (active) setFound({ term, customers: [] }); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [enabled, term, truncated]);
  // Results only for the words in the box right now (an older answer is never shown for newer words).
  const results = found && found.term === term && term.length >= 2 ? found.customers : null;
  if (!enabled || !truncated) return null;
  return <div className="space-y-1.5" data-testid="customer-search">
    <label className="relative block">
      <span className="sr-only">Sök kund</span>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input className="pl-8" value={query} placeholder={`Sök bland alla kunder (listan visar ${CUSTOMER_OPTION_LIMIT})`} onChange={(event) => setQuery(event.target.value)} />
    </label>
    {results ? results.length ? <ul className="max-h-48 divide-y overflow-y-auto rounded-lg border text-sm" aria-label="Sökträffar">
      {results.map((customer) => <li key={customer.id}><button type="button" className="w-full px-3 py-2 text-left hover:bg-muted" onClick={() => { addCustomerOption(customer); onPick(customer); setQuery(""); }}>
        <span className="font-medium">{customer.name}</span>{customer.company ? <span className="text-muted-foreground"> · {customer.company}</span> : null}{customer.city ? <span className="text-muted-foreground"> · {customer.city}</span> : null}
      </button></li>)}
    </ul> : <p className="text-xs text-muted-foreground">Ingen kund matchar.</p> : null}
  </div>;
}
