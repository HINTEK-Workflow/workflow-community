"use client";

import { useState } from "react";
import { FileSpreadsheet, Send } from "lucide-react";
import { ExportMenu, type ExportFormat, type ExportSelection } from "@/features/workflow/export-menu";
import { FortnoxDialog } from "@/features/quotes/fortnox-dialog";
import { announce } from "@/lib/workflow/toast";
import type { QuoteStatus } from "@/lib/quotes/model";
import { ACCOUNTS_PLACE, FORTNOX_CONNECTION_READY } from "@/lib/quotes/accounting";
import { saveResponse } from "@/lib/download";

/**
 * Export av offert/fakturaunderlag (2026-10-09, steg D) with the shared export window: CSV (one row per quote
 * line) for any quote, and Fortnox as an invoice draft through the company's own key – first "Visa vad som skickas", then
 * send. No SIE for quotes (2026-11-01): a quote is no sale; only an invoiced fakturaunderlag goes to the accounting.
 */
async function downloadCsv(ids: string[]) {
  await downloadExport(`/api/quotes/export?format=csv&ids=${ids.map(encodeURIComponent).join(",")}`, "offert.csv");
}

/** Fetches an export file and saves it under the name the server gives (also the fakturaunderlag, 2026-10-10). */
export async function downloadExport(address: string, fallbackName: string) {
  const response = await fetch(address, { cache: "no-store" });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(data?.error || "Exporten misslyckades.");
  }
  await saveResponse(response, fallbackName);
}

type Ids = (selection: ExportSelection) => string[];
const csvFormat = (ids: Ids): ExportFormat => ({ id: "quote-csv", label: "CSV", icon: FileSpreadsheet, primary: true, run: (selection) => downloadCsv(ids(selection)) });

/** On the quote page, beside PDF. A quote not yet saved has nothing to export. */
export function QuoteExportMenu({ quote, disabled }: { quote: { id: string; label: string; status: QuoteStatus } | null; disabled?: boolean }) {
  const [fortnox, setFortnox] = useState(false);
  if (!quote) return null;
  const accepted = quote.status === "ACCEPTED";
  return <>
    <ExportMenu testId="quote-export" title={`Exportera offert ${quote.label}`} disabled={disabled}
      description={FORTNOX_CONNECTION_READY ? `CSV ger en rad per offertrad. Fortnox gäller en accepterad offert, och kontona anges under ${ACCOUNTS_PLACE}. Till bokföringen går det godkända fakturaunderlaget.` : "CSV ger en rad per offertrad. Till bokföringen går det godkända fakturaunderlaget."}
      formats={[csvFormat(() => [quote.id]),
        ...(FORTNOX_CONNECTION_READY ? [{ id: "quote-fortnox", label: "Fortnox …", icon: Send, disabled: !accepted, hint: accepted ? undefined : "Fortnox tar emot en accepterad offert.", run: () => setFortnox(true) }] : [])]} />
    {FORTNOX_CONNECTION_READY && fortnox ? <FortnoxDialog endpoint="/api/quotes/export" id={quote.id} onClose={() => setFortnox(false)}
      intro="Offerten blir ett fakturaunderlag (utkast) i företagets Fortnox. Inget bokförs eller skickas till kunden förrän ni gör det i Fortnox."
      // ROT is not mapped to Fortnox yet (TODO in lib/quotes/fortnox.ts): said in one neutral line.
      notes={[{ text: "ROT-avdrag skickas inte till Fortnox än. Har offerten ROT fyller ni i det i Fortnox.", testId: "quote-fortnox-rot" }]}
      onSent={(documentNumber) => announce(`Offert ${quote.label} finns nu som fakturaunderlag i Fortnox${documentNumber ? ` (nr ${documentNumber})` : ""}.`)} /> : null}
  </>;
}

/** On the list: the quotes shown, picked in the export window, as CSV. */
export function QuotesBulkExport({ items }: { items: { id: string; label: string; title: string; status: QuoteStatus }[] | null }) {
  return <ExportMenu testId="quotes-export" title="Exportera offerter" choicesLabel="Offerter"
    description="Offerterna i listan som CSV."
    choices={items ? items.map((item) => ({ id: item.id, title: `${item.label} · ${item.title}`, detail: item.status === "ACCEPTED" ? "Accepterad" : undefined })) : null}
    formats={[
      csvFormat((selection) => selection.selected),
    ]} />;
}
