"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, FileCheck2, FileText, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { CheckField, DialogActions, Field, Modal } from "@/features/kfid/ui";
import { DialogPage } from "@/features/kfid/dialog-page";
import { saveResponse } from "@/lib/download";
import { announce } from "@/lib/workflow/toast";
import { formatPrice } from "@/lib/workflow/expenses";
import { buildInvoice, INVOICE_PAYMENT_LABELS, invoiceDetailsSchema, signedSek, vatRowLabel, type InvoiceBasisState, type InvoiceDetails, type InvoicePrepare } from "@/lib/customer-invoice/model";

/**
 * "Skapa faktura" on a basis (owner's decision 2026-11-04). The button is there only with the company's setting on, the right
 * Fakturera and an invoice that can still be made: the server answers 404 otherwise, and then nothing is drawn. The page shows what
 * is missing, exactly and live, by the same rule as the server, which decides again when issuing.
 */
export function InvoiceFromBasis({ basisId, dirty, blocked = null, onChanged }: { basisId: string; dirty: boolean; blocked?: string | null; onChanged: () => void }) {
  const router = useRouter();
  const [state, setState] = useState<InvoiceBasisState | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    api<InvoiceBasisState>(`/api/customer-invoices?basis=${encodeURIComponent(basisId)}`, { cache: "no-store" }, { change: false }).then((next) => { if (live) setState(next); }).catch(() => { if (live) setState(null); });
    return () => { live = false; };
  }, [basisId]);
  if (!state) return null;
  if (state.invoice) return <Button asChild variant="outline"><Link href={`/?view=customer_invoices&invoice=${encodeURIComponent(state.invoice.id)}`} data-testid="invoice-from-basis-open"><FileText />Faktura {state.invoice.label}</Link></Button>;
  if (!state.canIssue) return null;
  return <>
    <Button type="button" disabledReason={state.refusal || blocked || (dirty ? "Spara ändringarna först." : null)} onClick={() => setOpen(true)} data-testid="invoice-from-basis"><FileCheck2 />Skapa faktura</Button>
    {open ? <IssueInvoice basisId={basisId} onClose={() => setOpen(false)} onIssued={(id) => {
      // Closing the page steps back in the history: the invoice opens once that step is done, or the step would undo the move.
      let moved = false;
      const go = () => { if (!moved) { moved = true; router.push(`/?view=customer_invoices&invoice=${encodeURIComponent(id)}&send=1`); } };
      window.addEventListener("popstate", go, { once: true });
      window.setTimeout(go, 600);
      setOpen(false); onChanged();
    }} /> : null}
  </>;
}

/** On the work order, under Historik (2026-11-05): the basis's invoice, what is paid and whether it has been sent. */
export function InvoiceOfBasisStatus({ basisId }: { basisId: string }) {
  const [state, setState] = useState<InvoiceBasisState | null>(null);
  useEffect(() => {
    let live = true;
    api<InvoiceBasisState>(`/api/customer-invoices?basis=${encodeURIComponent(basisId)}`, { cache: "no-store" }, { change: false }).then((next) => { if (live) setState(next); }).catch(() => { if (live) setState(null); });
    return () => { live = false; };
  }, [basisId]);
  const invoice = state?.invoice;
  if (!invoice) return null;
  const href = `/?view=customer_invoices&invoice=${encodeURIComponent(invoice.id)}`;
  return <div className="px-3.5 pb-2.5 text-sm" data-testid="invoice-of-basis" data-sent={invoice.sentOn ? "true" : "false"}>
    <Link href={href} className="font-medium text-primary underline-offset-2 hover:underline">Faktura {invoice.label}</Link>
    <span className="text-muted-foreground"> är {INVOICE_PAYMENT_LABELS[invoice.state].toLocaleLowerCase("sv")}.</span>
    {invoice.sentOn
      ? <p className="text-xs text-muted-foreground">Skickad {invoice.sentOn}{invoice.sentTo ? ` till ${invoice.sentTo}` : ""}.</p>
      : <p className="text-xs text-muted-foreground">Fakturan är inte skickad än. <Link href={`${href}&send=1`} className="font-medium text-primary underline-offset-2 hover:underline">Skicka</Link></p>}
  </div>;
}

type RotFields = InvoiceDetails["rot"];
const BLANK_ROT: RotFields = { personalNumber: "", propertyDesignation: "", brfOrganizationNumber: "", apartmentNumber: "", workPlace: "" };

function IssueInvoice({ basisId, onClose, onIssued }: { basisId: string; onClose: () => void; onIssued: (id: string) => void }) {
  const [prepared, setPrepared] = useState<InvoicePrepare | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [performedFrom, setPerformedFrom] = useState("");
  const [performedOn, setPerformedOn] = useState("");
  const [paymentDays, setPaymentDays] = useState("");
  const [exemptionText, setExemptionText] = useState("");
  const [rot, setRot] = useState<RotFields>(BLANK_ROT);
  const [lineVat, setLineVat] = useState<Record<string, string>>({});
  const [ownRates, setOwnRates] = useState(false);
  const [brf, setBrf] = useState(false);
  const [proformaOpen, setProformaOpen] = useState(false);
  const [proformaEmail, setProformaEmail] = useState("");
  const [ask, confirmDialog] = useConfirm();
  useEffect(() => {
    let live = true;
    api<InvoicePrepare>(`/api/customer-invoices?prepare=${encodeURIComponent(basisId)}`, { cache: "no-store" }, { change: false }).then((next) => {
      if (!live) return;
      setPrepared(next); setProformaEmail(next.defaults.email); setPerformedFrom(next.defaults.performedFrom); setPerformedOn(next.defaults.performedOn); setPaymentDays(next.defaults.paymentDays); setRot({ ...BLANK_ROT, workPlace: next.defaults.workPlace });
    }).catch((cause: Error) => { if (live) setError(cause.message); });
    return () => { live = false; };
  }, [basisId]);
  const details = useMemo(() => invoiceDetailsSchema.parse({ performedFrom, performedOn, paymentDays, exemptionText, lineVat: ownRates ? lineVat : {}, rot: brf ? { ...rot, propertyDesignation: "" } : { ...rot, brfOrganizationNumber: "", apartmentNumber: "" } }), [performedFrom, performedOn, paymentDays, exemptionText, ownRates, lineVat, rot, brf]);
  const built = useMemo(() => prepared ? buildInvoice(prepared.source, details) : null, [prepared, details]);
  const title = "Skapa faktura";
  const page = (content: React.ReactNode, actions?: React.ReactNode) => <DialogPage open onOpenChange={(value) => { if (!value) onClose(); }} title={title} pageKey="faktura" size="page" panelTitle={false} guardBack={false} untracked>
    {confirmDialog}<div className="space-y-5" data-testid="invoice-issue">{content}</div>{actions}
  </DialogPage>;
  if (!prepared || !built) return page(error ? <p role="alert" className="text-sm text-destructive">{error}</p> : <p className="text-sm text-muted-foreground">Hämtar…</p>, <DialogActions cancel={{ label: "Stäng", onClick: onClose }} />);
  const { content, problems, warnings } = built;
  const canVary = !content.reverseVat && !content.seller.vatExempt;
  const zeroLine = canVary && content.lines.some((line) => line.vatPercent === 0);
  const rotOn = Boolean(content.rot);
  const preview = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/customer-invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", basisId, details }) });
      if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error || "Förhandsgranskningen misslyckades.");
      await saveResponse(response, "faktura-forhandsgranskning.pdf");
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  };
  const issue = async () => {
    const yes = await ask({ title: "Utfärda fakturan?", message: "Fakturan får nästa nummer och låses. Fel rättas med en kreditfaktura.", confirmLabel: "Utfärda" });
    if (!yes) return;
    setBusy(true); setError("");
    try {
      const made = await api<{ id: string; label: string }>("/api/customer-invoices", { method: "POST", body: JSON.stringify({ action: "issue", basisId, revision: prepared.revision, details }) });
      announce(`Faktura ${made.label} är utfärdad.`);
      onIssued(made.id);
    } catch (cause) { setError((cause as Error).message); announce((cause as Error).message, true); } finally { setBusy(false); }
  };
  const proformaPdf = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/customer-invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "proforma", basisId, details }) });
      if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error || "Proformafakturan kunde inte skapas.");
      await saveResponse(response, `proforma-${prepared.source.basis.label}.pdf`);
      setProformaOpen(false);
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  };
  const proformaSend = async () => {
    setBusy(true); setError("");
    try {
      const sent = await api<{ email: string; notice?: string }>("/api/customer-invoices", { method: "POST", body: JSON.stringify({ action: "proforma", basisId, details, email: proformaEmail.trim() }) });
      announce(sent.notice || `Proformafakturan är skickad till ${sent.email}.`);
      setProformaOpen(false);
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  };
  const sellerMissing = problems.some((problem) => problem.key.startsWith("seller.") || problem.key === "rot.fSkatt");
  // Resa 2026-11-06: the way to fix it under the list, one link per place (the company's details, the customer).
  // Momsfrihet and IBAN are set under Arbetssätt → Fakturering (kundresa 2026-11-07, M36): a link there too.
  const settingsMissing = problems.some((problem) => problem.key === "seller.vatNumber" || problem.key === "seller.payment");
  const buyerMissing = Boolean(prepared.customerId) && problems.some((problem) => problem.key === "buyer.address" || problem.key === "buyer.vatNumber");
  const fixLink = "font-medium text-primary underline-offset-2 hover:underline";
  const missingReason = problems.length ? `Det saknas ${problems.length === 1 ? "en uppgift" : `${problems.length} uppgifter`}. Se listan.` : null;
  return page(<>
    {prepared.connected ? <p className="notice text-sm" data-testid="invoice-issue-overlap">Företaget är kopplat till {prepared.connected}. Skapa inte samma faktura där.</p> : null}
    {problems.length ? <div role="alert" className="notice text-sm" data-testid="invoice-issue-missing"><p className="font-medium">Det här saknas:</p><ul className="mt-1 list-disc space-y-0.5 pl-5">{problems.map((problem) => <li key={problem.key} data-problem={problem.key}>{problem.text}</li>)}</ul>
      {sellerMissing || buyerMissing ? <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">{sellerMissing ? <Link href="/?view=company" className={fixLink} data-testid="invoice-issue-company">Öppna företagsuppgifterna</Link> : null}{settingsMissing ? <Link href="/?view=company_features#settings-invoicing" className={fixLink} data-testid="invoice-issue-settings">Öppna Arbetssätt → Fakturering</Link> : null}{buyerMissing ? <Link href={`/?view=customers&customerId=${encodeURIComponent(prepared.customerId!)}`} className={fixLink} data-testid="invoice-issue-customer">Öppna kunden</Link> : null}</p> : null}</div> : null}
    {warnings.length ? <div className="notice text-sm" data-testid="invoice-issue-warnings"><ul className="list-disc space-y-0.5 pl-5">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <dl className="grid gap-x-5 gap-y-1 text-sm sm:grid-cols-2">
      <div className="flex min-w-0 gap-1.5"><dt className="text-muted-foreground">Köpare:</dt><dd className="min-w-0 font-medium">{content.buyer.name || "Saknas"}</dd></div>
      <div className="flex min-w-0 gap-1.5"><dt className="text-muted-foreground">Avser:</dt><dd className="min-w-0 font-medium">{content.title}</dd></div>
      {content.buyerVatNumber ? <div className="flex min-w-0 gap-1.5"><dt className="text-muted-foreground">Köparens momsreg.nr:</dt><dd className="font-medium">{content.buyerVatNumber}</dd></div> : null}
      <div className="flex min-w-0 gap-1.5"><dt className="text-muted-foreground">Fakturadatum:</dt><dd className="font-medium">{content.issuedOn}</dd></div>
      {content.dueOn ? <div className="flex min-w-0 gap-1.5"><dt className="text-muted-foreground">Förfallodatum:</dt><dd className="font-medium" data-testid="invoice-issue-due">{content.dueOn}</dd></div> : null}
    </dl>
    <div className="field-group grid gap-4 rounded-lg border p-3 sm:grid-cols-3">
      <Field id="invoice-from" type="date" label="Arbetet började (valfritt)" value={performedFrom} onChange={setPerformedFrom} />
      <Field id="invoice-on" type="date" label="Arbetet klart" value={performedOn} onChange={setPerformedOn} />
      <Field id="invoice-terms" label="Betalningsvillkor (dagar)" value={paymentDays} onChange={setPaymentDays} />
    </div>
    {rotOn ? <div className="field-group grid gap-4 rounded-lg border p-3 sm:grid-cols-2" data-testid="invoice-issue-rot">
      <Field id="invoice-pn" label="Köparens personnummer" value={rot.personalNumber} autoComplete="off" onChange={(personalNumber) => setRot({ ...rot, personalNumber })} help="Sparas bara låst i fakturan, inte på kunden." />
      <Field id="invoice-place" label="Arbetsplats" value={rot.workPlace} onChange={(workPlace) => setRot({ ...rot, workPlace })} />
      <CheckField id="invoice-brf" label="Bostadsrätt" checked={brf} onChange={setBrf} className="sm:col-span-2" />
      {brf ? <>
        <Field id="invoice-brf-org" label="Föreningens organisationsnummer" value={rot.brfOrganizationNumber} onChange={(brfOrganizationNumber) => setRot({ ...rot, brfOrganizationNumber })} />
        <Field id="invoice-apartment" label="Lägenhetsnummer" value={rot.apartmentNumber} onChange={(apartmentNumber) => setRot({ ...rot, apartmentNumber })} />
      </> : <Field id="invoice-property" label="Fastighetsbeteckning" value={rot.propertyDesignation} onChange={(propertyDesignation) => setRot({ ...rot, propertyDesignation })} />}
    </div> : null}
    {canVary ? <div className="space-y-3">
      <CheckField id="invoice-rates" label="Olika momssatser på raderna" checked={ownRates} onChange={setOwnRates} testId="invoice-issue-own-rates" />
      {ownRates ? <div className="field-group grid gap-3 rounded-lg border p-3">{prepared.source.basis.lines.map((line) => <div key={line.id} className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-3 text-sm">
        <span className="min-w-0 break-words">{line.name || "Utan benämning"}</span>
        <Field id={`invoice-vat-${line.id}`} label="Moms %" value={lineVat[line.id] ?? formatPrice(prepared.lineVatPercent)} onChange={(value) => setLineVat({ ...lineVat, [line.id]: value })} />
      </div>)}</div> : null}
      {zeroLine ? <Field id="invoice-exemption" label="Varför 0 % moms" value={exemptionText} onChange={setExemptionText} /> : null}
    </div> : null}
    <div className="rounded-lg border" data-testid="invoice-issue-sums">
      <dl className="divide-y text-sm">
        <SumRow label="Summa exkl. moms" value={signedSek(content.net)} />
        {content.reverseVat ? <SumRow label="Moms" value="Omvänd betalningsskyldighet" /> : content.vatRows.map((row) => <SumRow key={row.percent} label={vatRowLabel(row.percent)} value={signedSek(row.vat)} />)}
        {content.rot ? <>
          <SumRow label="Summa inkl. moms" value={signedSek(content.gross)} />
          <SumRow label="Arbetskostnad inkl. moms" value={signedSek(content.rot.labourInclVat)} />
          <SumRow label="Material och övrigt inkl. moms" value={signedSek(content.rot.otherInclVat)} />
          <SumRow label={`Skattereduktion ROT${content.rot.capped ? " (tak)" : ""}`} value={signedSek(-content.rot.deduction)} />
        </> : null}
        <SumRow label="Att betala" value={`${signedSek(content.toPay)} kr`} strong />
      </dl>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={busy} onClick={() => void preview()} data-testid="invoice-issue-preview"><Eye />Förhandsgranska PDF</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => { setError(""); setProformaOpen(true); }} data-testid="invoice-issue-proforma"><FileText />Proformafaktura</Button>
    </div>
    <Modal open={proformaOpen} onOpenChange={setProformaOpen} title="Proformafaktura" size="compact">
      <div className="space-y-3" data-testid="invoice-proforma">
        <p className="text-sm">Kunden kan lägga en inköpsorder på beloppet. Den är inget betalningskrav, får inget fakturanummer och bokförs inte.</p>
        <Field id="invoice-proforma-email" type="email" label="E-post" value={proformaEmail} onChange={setProformaEmail} />
        <Button type="button" variant="outline" disabled={busy} onClick={() => void proformaPdf()} data-testid="invoice-proforma-pdf"><FileText />Ladda ner PDF</Button>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </div>
      <DialogActions cancel={{ label: "Avbryt", onClick: () => setProformaOpen(false) }} primary={{ label: "Skicka", icon: <Send />, onClick: () => void proformaSend(), busy, busyLabel: "Skickar…", disabledReason: proformaEmail.trim() ? null : "Skriv en e-postadress.", testId: "invoice-proforma-send" }} />
    </Modal>
  </>, <DialogActions cancel={{ label: "Avbryt", onClick: onClose }} primary={{ label: "Utfärda faktura", onClick: () => void issue(), busy, busyLabel: "Utfärdar…", disabledReason: missingReason, testId: "invoice-issue-submit" }} />);
}

function SumRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={`flex items-baseline justify-between gap-4 px-3 py-2 ${strong ? "font-semibold" : ""}`}><dt>{label}</dt><dd className="text-right tabular-nums">{value}</dd></div>;
}
