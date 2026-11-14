"use client";

import { useState } from "react";
import { BadgeCheck, CircleAlert, FileText, XCircle, MessageSquareReply, ListChecks, ListOrdered, Sigma, ScrollText } from "lucide-react";
import { PageHeader } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { api } from "@/features/kfid/api";
import { CheckField, Field, Panel } from "@/features/kfid/ui";
import { formatSek } from "@/lib/workflow/expenses";
import { QUOTE_CUSTOMER_TYPE_LABELS, REVERSE_VAT_LABEL, REVERSE_VAT_TEXT } from "@/lib/quotes/model";
import type { PublicQuotePage, PublicQuoteView } from "@/lib/quotes/customer-link";
import { saveResponse } from "@/lib/download";
import { DownloadButton } from "@/components/ui/download-button";

/**
 * Offert per e-post, steg E (2026-10-09): the customer's page, reached from the e-mail without an account. The
 * public document layout of the legal pages (one centred column, no app shell) with the shared PageHeader, Panel,
 * Field and CheckField. It shows only what the server's allow-list sends: the company, the lines at the selling price,
 * the sums with VAT and ROT, the validity, the terms and, for an ÄTA, the changes. "Acceptera" needs the name and the
 * tick box (the link's method "simple"); "Avböj" takes an optional reason. The server decides every answer again.
 */
const percentText = (value: number) => String(value).replace(".", ",");
const kr = (value: number | null) => value === null ? "–" : `${formatSek(value)} kr`;

export function CustomerQuoteView({ token, initial }: { token: string; initial: PublicQuotePage }) {
  const [page, setPage] = useState(initial);
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declineName, setDeclineName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const quote = page.quote;

  const answer = async (decision: "accept" | "decline") => {
    setBusy(true);
    setError("");
    try {
      const body = decision === "accept" ? { token, decision, name, agree } : { token, decision, name: declineName, reason };
      const result = await api<{ page: PublicQuotePage }>("/api/customer-quote", { method: "POST", body: JSON.stringify(body) });
      setPage(result.page);
      setDeclining(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  };

  // Ladda ner som PDF (plan 1D): the same PDF the company sends, fetched with the token in the body and saved as a file.
  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    setDownloading(true);
    setError("");
    try {
      const response = await fetch("/api/customer-quote/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), cache: "no-store" });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error || "Offerten kunde inte laddas ner just nu.");
      }
      await saveResponse(response, `offert-${quote?.label ?? ""}.pdf`);
    } catch (cause) { setError((cause as Error).message); } finally { setDownloading(false); }
  };

  const tone = page.state === "accepted" ? "text-emerald-700 dark:text-emerald-300" : page.state === "open" ? "" : "text-muted-foreground";
  return <main className="mx-auto w-full max-w-4xl space-y-5 px-4 py-8 pb-28 sm:px-8 sm:py-10 sm:pb-28" data-testid="customer-quote" data-state={page.state}>
    {/* The public page has no breadcrumbs: who the quote is from opens the line under the title (no eyebrow, 2026-10-30). */}
    <PageHeader className="mb-0" icon={FileText}
      title={quote?.title || page.label || "Offert"}
      description={quote ? `${page.company ? `Offert från ${page.company} · ` : ""}${quote.label}${quote.sentDate ? ` · skickad ${quote.sentDate}` : ""}${quote.validUntil ? ` · gäller till och med ${quote.validUntil}` : ""}` : page.label || undefined} />

    {page.message ? <p role="status" className={`notice flex items-start gap-2 ${tone}`} data-testid="customer-quote-message">
      {page.state === "accepted" ? <BadgeCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : page.state === "declined" ? <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
      <span>{page.message}{page.answer?.name ? ` Namn: ${page.answer.name}.` : ""}</span>
    </p> : null}

    {quote ? <QuoteContents quote={quote} /> : null}
    {quote ? <div className="flex flex-wrap items-center gap-3" data-testid="customer-quote-download">
      <DownloadButton onClick={() => void download()} data-testid="customer-quote-pdf" busy={downloading} busyLabel="Hämtar…">Ladda ner som PDF</DownloadButton>
      <span className="text-xs text-muted-foreground">Samma dokument som företaget skickar.</span>
      {error && page.state !== "open" ? <p role="alert" className="w-full text-sm text-destructive" data-testid="customer-quote-error">{error}</p> : null}
    </div> : null}

    {page.state === "open" && quote && page.method ? <Panel icon={MessageSquareReply} title="Ditt svar" description="Svaret skickas direkt till företaget. Det går inte att ändra efteråt.">
      <div className="space-y-5" data-testid="customer-quote-answer">
        {page.method.kind === "form" ? <div className="space-y-4">
          <CheckField id="customer-quote-agree" label={page.method.statement} checked={agree} onChange={setAgree} disabled={busy} testId="customer-quote-agree" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="customer-quote-name" label="Ditt namn" value={name} onChange={setName} autoComplete="name" disabled={busy} help="Skriv för- och efternamn. Tid, IP-adress och webbläsare sparas med svaret." />
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="button" disabled={busy} disabledReason={!agree ? "Kryssa i rutan först." : name.trim().length < 2 ? "Skriv ditt namn först." : ""} onClick={() => void answer("accept")} data-testid="customer-quote-accept"><BadgeCheck />Acceptera offerten</Button>
            {!declining ? <Button type="button" variant="outline" disabled={busy} onClick={() => setDeclining(true)} data-testid="customer-quote-decline-open"><XCircle />Avböj offerten</Button> : null}
          </div>
        </div> : <p className="text-sm text-muted-foreground">Kontakta {page.company} för att acceptera offerten.</p>}

        {declining ? <div className="field-group space-y-4 rounded-lg border p-3" data-testid="customer-quote-decline">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="customer-quote-decline-name" label="Ditt namn (valfritt)" value={declineName} onChange={setDeclineName} autoComplete="name" disabled={busy} />
          </div>
          <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">Varför avböjer du? (valfritt)
            <textarea className="form-textarea min-h-24" maxLength={1000} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} data-testid="customer-quote-reason" />
          </label>
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setDeclining(false)}>Avbryt</Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={() => void answer("decline")} data-testid="customer-quote-decline-send"><XCircle />Avböj offerten</Button>
          </div>
        </div> : null}
        {error ? <p role="alert" className="text-sm text-destructive" data-testid="customer-quote-error">{error}</p> : null}
      </div>
    </Panel> : null}
  </main>;
}

/** The quote as the customer sees it: the same contents as the PDF, selling prices only. */
function QuoteContents({ quote }: { quote: PublicQuoteView }) {
  const totals = quote.totals;
  const rot = totals.rotPercent !== null && totals.rot > 0;
  return <>
    <Panel icon={FileText} title="Uppgifter">
      <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2" data-testid="customer-quote-facts">
        <div><dt className="text-xs text-muted-foreground">Från</dt><dd className="font-medium">{quote.company.name}{quote.company.senderName ? <span className="font-normal text-muted-foreground"> · {quote.company.senderName}</span> : null}</dd></div>
        {quote.company.email ? <div><dt className="text-xs text-muted-foreground">Kontakt</dt><dd><a className="text-primary hover:underline" href={`mailto:${quote.company.email}`}>{quote.company.email}</a></dd></div> : null}
        {quote.customerName ? <div><dt className="text-xs text-muted-foreground">Till</dt><dd>{quote.customerName} ({QUOTE_CUSTOMER_TYPE_LABELS[quote.customerType]})
          {quote.customerContact ? <span className="block text-muted-foreground" data-testid="customer-quote-contact">{quote.customerContact}</span> : null}
          {quote.customerAddress ? <span className="block text-muted-foreground" data-testid="customer-quote-address">{quote.customerAddress}</span> : null}</dd></div> : null}
        {quote.placeName ? <div><dt className="text-xs text-muted-foreground">Plats</dt><dd>{quote.placeName}</dd></div> : null}
        <div><dt className="text-xs text-muted-foreground">Offertnummer</dt><dd>{quote.label}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Giltig till och med</dt><dd>{quote.validUntil || "Inte angivet"}</dd></div>
      </dl>
    </Panel>
    {quote.description.trim() ? <Panel icon={ListChecks} title="Omfattning"><p className="whitespace-pre-line text-sm leading-6">{quote.description}</p></Panel> : null}
    <Panel icon={ListOrdered} title="Specifikation" description="Priser i kronor exklusive moms.">
      {quote.lines.length ? <ul className="divide-y rounded-lg border" data-testid="customer-quote-lines">
        {quote.lines.map((line, index) => <li key={index} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_6rem_8rem_8rem]" data-testid="customer-quote-line">
          <span className="min-w-0 break-words font-medium">{line.name}<span className="block text-xs font-normal text-muted-foreground">{line.articleNo ? `Art.nr ${line.articleNo} · ` : ""}{line.kindLabel}{line.rotLabour ? " · arbetskostnad (ROT)" : ""}</span></span>
          <span className="tabular-nums text-muted-foreground max-sm:order-3">{line.quantity} {line.unit}</span>
          <span className="tabular-nums text-muted-foreground max-sm:order-4 sm:text-right">à {kr(line.price)}</span>
          <span className="text-right font-semibold tabular-nums">{kr(line.amount)}</span>
        </li>)}
      </ul> : <p className="text-sm text-muted-foreground">Offerten har inga rader.</p>}
    </Panel>
    {quote.change ? <Panel title={`Ändringar mot version ${quote.change.ofVersion}`} description="Ändrings- och tilläggsarbete mot den accepterade versionen. Belopp exklusive moms.">
      <ul className="divide-y rounded-lg border">{quote.change.lines.map((line, index) => <li key={index} className="flex flex-wrap justify-between gap-2 px-3 py-2 text-sm">
        <span className="min-w-0 break-words">{line.name} <span className="text-muted-foreground">({line.change === "added" ? "tillagt" : line.change === "removed" ? "borttaget" : "ändrat"})</span></span>
        <span className="tabular-nums">{line.amountDelta > 0 ? "+" : ""}{formatSek(line.amountDelta)} kr</span>
      </li>)}</ul>
      <p className="mt-2 text-sm font-semibold">Förändring exklusive moms: {quote.change.netDelta > 0 ? "+" : ""}{formatSek(quote.change.netDelta)} kr</p>
    </Panel> : null}
    <Panel icon={Sigma} title="Summa">
      <dl className="grid gap-y-1.5 text-sm" data-testid="customer-quote-totals">
        {totals.material ? <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Material</dt><dd className="tabular-nums">{kr(totals.material)}</dd></div> : null}
        {totals.labour ? <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Arbete</dt><dd className="tabular-nums">{kr(totals.labour)}</dd></div> : null}
        {totals.other ? <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Övrigt</dt><dd className="tabular-nums">{kr(totals.other)}</dd></div> : null}
        <div className="flex justify-between gap-3 border-t pt-1.5"><dt>Summa exklusive moms</dt><dd className="tabular-nums" data-testid="customer-quote-net">{kr(totals.net)}</dd></div>
        <div className="flex justify-between gap-3"><dt>{quote.reverseVat ? "Moms" : `Moms ${percentText(totals.vatPercent)} %`}</dt><dd className="tabular-nums">{quote.reverseVat ? REVERSE_VAT_LABEL : kr(totals.vat)}</dd></div>
        <div className={`flex justify-between gap-3 ${rot ? "" : "border-t pt-1.5 font-semibold"}`}><dt>{rot ? "Summa inklusive moms" : "Att betala inklusive moms"}</dt><dd className="tabular-nums" data-testid="customer-quote-gross">{kr(totals.gross)}</dd></div>
        {rot ? <>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Arbetskostnad inkl. moms (underlag)</dt><dd className="tabular-nums">{kr(totals.rotBaseInclVat)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Preliminärt ROT-avdrag {percentText(totals.rotPercent ?? 0)} %{totals.rotCapped ? " (tak)" : ""}</dt><dd className="tabular-nums">-{kr(totals.rot)}</dd></div>
          <div className="flex justify-between gap-3 border-t pt-1.5 font-semibold"><dt>Att betala efter ROT-avdrag</dt><dd className="tabular-nums" data-testid="customer-quote-to-pay">{kr(totals.toPay)}</dd></div>
        </> : null}
      </dl>
      {quote.reverseVat ? <p className="mt-2 text-xs text-muted-foreground" data-testid="customer-quote-reverse-vat">{REVERSE_VAT_TEXT}{quote.buyerVatNumber ? ` Köparens momsreg.nr: ${quote.buyerVatNumber}.` : ""}</p> : null}
      {rot ? <p className="mt-2 text-xs text-muted-foreground">ROT-avdraget är preliminärt. Andel och tak är angivna av företaget, och avdraget förutsätter att du har rätt till det.</p> : null}
    </Panel>
    {quote.terms.trim() ? <Panel icon={ScrollText} title="Villkor"><p className="whitespace-pre-line text-sm leading-6" data-testid="customer-quote-terms">{quote.terms}</p></Panel> : null}
  </>;
}
