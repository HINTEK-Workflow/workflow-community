"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { PageHeader } from "@/components/page-shell";
import { DownloadButton } from "@/components/ui/download-button";
import { saveResponse } from "@/lib/download";
import { signedSek, type PublicInvoicePage } from "@/lib/customer-invoice/model";

/**
 * Kundens sida för en faktura med personnummer (2026-11-04), without an account: what the invoice says and the PDF, which holds the
 * personal number. Only the allow-listed view reaches this page, and the number never does.
 */
const STATE_TEXT: Record<Exclude<PublicInvoicePage["state"], "open">, string> = {
  expired: "Länken har slutat gälla. Kontakta företaget för en ny.",
  revoked: "Länken har ersatts. Använd den senaste länken eller kontakta företaget.",
  limited: "För många försök. Vänta en stund och försök igen.",
};

export function CustomerInvoiceLinkView({ token, initial }: { token: string; initial: PublicInvoicePage }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { invoice } = initial;
  const download = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/customer-invoice-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error || "Det gick inte att hämta fakturan.");
      await saveResponse(response, "faktura.pdf");
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  };
  const facts: [string, string][] = invoice ? [
    ["Avser", invoice.title], ["Fakturadatum", invoice.issuedOn],
    ...(invoice.dueOn ? [["Förfallodatum", invoice.dueOn] as [string, string]] : []),
    [invoice.credit ? "Krediterat belopp" : "Att betala", `${signedSek(invoice.toPay)} kr`],
    ...invoice.payment.map((way): [string, string] => [way.label, way.value]),
    ...(invoice.reference && !invoice.credit ? [[invoice.ocr ? "OCR-nummer" : "Ange vid betalning", invoice.reference] as [string, string]] : []),
  ] : [];
  return <main className="mx-auto w-full max-w-4xl space-y-5 px-4 py-8 pb-28 sm:px-8 sm:py-10 sm:pb-28" data-testid="customer-invoice" data-state={initial.state}>
    <PageHeader className="mb-0" icon={FileText} title={invoice ? `${invoice.credit ? "Kreditfaktura" : "Faktura"} ${invoice.label}` : "Faktura"} description={initial.company || undefined} />
    {initial.state !== "open" ? <p role="status" className="notice text-sm" data-testid="customer-invoice-state">{STATE_TEXT[initial.state]}</p> : null}
    {invoice?.creditedNote ? <p className="notice text-sm">Fakturan är krediterad.</p> : null}
    {invoice ? <>
      <dl className="grid gap-x-5 gap-y-1.5 text-sm sm:grid-cols-2" data-testid="customer-invoice-facts">
        {facts.map(([label, value]) => <div key={label} className="flex min-w-0 flex-wrap gap-x-1.5"><dt className="text-muted-foreground">{label}:</dt><dd className="min-w-0 font-medium break-words">{value}</dd></div>)}
      </dl>
      <div className="flex flex-wrap items-center gap-3"><DownloadButton type="button" busy={busy} onClick={() => void download()} data-testid="customer-invoice-download">Ladda ner som PDF</DownloadButton></div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </> : null}
  </main>;
}
