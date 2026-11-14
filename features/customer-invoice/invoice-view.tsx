"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, CheckCircle2, FilePlus2, FileText, RotateCcw, Send, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { DialogActions, Field, Modal } from "@/features/kfid/ui";
import { DialogPage } from "@/features/kfid/dialog-page";
import { downloadExport } from "@/features/quotes/quote-export";
import { announce } from "@/lib/workflow/toast";
import { formatPrice } from "@/lib/workflow/expenses";
import { swedishDayKey } from "@/lib/swedish-time";
import { invoiceEventWord, sentToOf, signedSek, vatRowLabel, type InvoiceView } from "@/lib/customer-invoice/model";
import { PaymentPill } from "./invoices-list";

/**
 * En utfärdad faktura (owner's decision 2026-11-04): locked, shown as text with the buyer, the lines, the sums and its log. PDF,
 * Skicka, Markera som betald (with Ångra) and Kreditera; after a credit, a new basis to correct. The identity number is only
 * ever masked here; it stands in full on the document alone.
 */
export function InvoiceViewPage({ id, startSend = false, onClose, onChanged, onOpen }: { id: string; /** Right after issuing: the send dialog opens by itself, with the customer's address. */ startSend?: boolean; onClose: () => void; onChanged: () => void; onOpen: (id: string) => void }) {
  const router = useRouter();
  const [invoice, setInvoice] = useState<InvoiceView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"credit" | "send" | "paid" | null>(null);
  const [reason, setReason] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [paidOn, setPaidOn] = useState("");
  const [ask, confirmDialog] = useConfirm();
  const [sendWaiting, setSendWaiting] = useState(startSend);
  if (sendWaiting && invoice) {
    setSendWaiting(false);
    if (invoice.canEdit) { setEmail(invoice.buyerEmail ?? ""); setDialog("send"); }
  }
  const load = useCallback(async () => {
    try {
      const result = await api<{ invoice: InvoiceView }>(`/api/customer-invoices?id=${encodeURIComponent(id)}`, { cache: "no-store" }, { change: false });
      setInvoice(result.invoice); setError("");
    } catch (cause) { setError((cause as Error).message); }
  }, [id]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the invoice is read when the view opens
  useEffect(() => { void load(); }, [load]);
  const post = async <T,>(body: Record<string, unknown>, done: (result: T) => void) => {
    setBusy(true); setError("");
    try {
      done(await api<T>("/api/customer-invoices", { method: "POST", body: JSON.stringify(body) }));
      setDialog(null);
      await load(); onChanged();
    } catch (cause) { setError((cause as Error).message); announce((cause as Error).message, true); } finally { setBusy(false); }
  };
  const title = invoice ? `${invoice.kind === "CREDIT" ? "Kreditfaktura" : "Faktura"} ${invoice.label}` : "Faktura";
  const page = (body: React.ReactNode) => <DialogPage open onOpenChange={(value) => { if (!value) onClose(); }} title={title} pageKey="fakturan" size="view" panelTitle={false} guardBack={false} untracked>
    {confirmDialog}<div className="space-y-5" data-testid="invoice-view">{body}</div><DialogActions cancel={{ label: "Stäng", onClick: onClose }} />
  </DialogPage>;
  if (!invoice) return page(error ? <p role="alert" className="text-sm text-destructive">{error}</p> : <p className="text-sm text-muted-foreground">Hämtar…</p>);
  const { content } = invoice;
  const isInvoice = invoice.kind === "INVOICE";
  const credited = Boolean(invoice.creditId);
  const undoPaid = async () => {
    const yes = await ask({ title: "Ångra betald?", message: "Fakturan blir obetald igen. Det står kvar i loggen.", confirmLabel: "Ångra betald" });
    if (yes) await post({ action: "unpaid", id }, () => announce(`${invoice.label} är obetald igen.`));
  };
  const openDialog = (next: "credit" | "send" | "paid") => {
    setError("");
    if (next === "paid") setPaidOn(swedishDayKey(new Date()));
    if (next === "send") setEmail(invoice.buyerEmail ?? "");
    setDialog(next);
  };
  const lastSent = invoice.events.find((event) => event.action === "sent");
  const facts: [string, string][] = [
    ["Köpare", [content.buyer.name, content.buyer.address].filter(Boolean).join(", ")],
    ["Avser", content.title],
    ["Fakturadatum", content.issuedOn],
    ...(content.dueOn ? [["Förfallodatum", content.dueOn] as [string, string]] : []),
    ["Utfört", [content.performedFrom, content.performedOn].filter(Boolean).join(" – ")],
    ["Betalningsreferens", content.reference],
    ...(content.buyerVatNumber ? [["Köparens momsreg.nr", content.buyerVatNumber] as [string, string]] : []),
    ...(invoice.identityMasked ? [["Köparens personnummer", invoice.identityMasked] as [string, string]] : []),
    ...(content.rot?.propertyDesignation ? [["Fastighetsbeteckning", content.rot.propertyDesignation] as [string, string]] : []),
    ...(content.rot?.brfOrganizationNumber ? [["Bostadsrättsförening", `${content.rot.brfOrganizationNumber}, lgh ${content.rot.apartmentNumber}`] as [string, string]] : []),
    ...(content.creditOf ? [["Krediterar", `${content.creditOf.label}, ${content.creditOf.issuedOn}`] as [string, string], ["Orsak", content.creditOf.reason] as [string, string]] : []),
    ...(invoice.creditId ? [["Krediterad med", invoice.creditLabel] as [string, string]] : []),
    ...(invoice.paidOn ? [["Betald", invoice.paidOn] as [string, string]] : []),
    ["Skickad", lastSent ? `${swedishDayKey(new Date(lastSent.createdAt))}${sentToOf(lastSent.detail) ? ` till ${sentToOf(lastSent.detail)}` : ""}` : "Inte än"],
    ["Utfärdad av", invoice.createdByName],
  ];
  return page(<>
    <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-muted-foreground">Låst. Fel rättas med en kreditfaktura.</span><PaymentPill state={invoice.state} /></div>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex flex-wrap items-center gap-2" data-testid="invoice-actions">
      <Button type="button" variant="outline" onClick={() => void downloadExport(`/api/customer-invoices?id=${encodeURIComponent(id)}&format=pdf`, `faktura-${invoice.label}.pdf`).catch((cause: Error) => announce(cause.message, true))} data-testid="invoice-pdf"><FileText />Ladda ner PDF</Button>
      {invoice.canEdit ? <>
        <Button type="button" variant={lastSent ? "outline" : "default"} disabled={busy} onClick={() => openDialog("send")} data-testid="invoice-send"><Send />Skicka</Button>
        {isInvoice && !credited && !invoice.paidOn ? <Button type="button" variant="outline" disabled={busy} onClick={() => openDialog("paid")} data-testid="invoice-paid"><CheckCircle2 />Markera som betald</Button> : null}
        {isInvoice && !credited && invoice.paidOn ? <Button type="button" variant="outline" disabled={busy} onClick={() => void undoPaid()} data-testid="invoice-unpaid"><Undo2 />Ångra betald</Button> : null}
        {isInvoice && !credited ? <Button type="button" variant="outline" disabled={busy} onClick={() => openDialog("credit")} data-testid="invoice-credit"><RotateCcw />Kreditera</Button> : null}
        {isInvoice && credited ? <Button type="button" variant="outline" disabled={busy} onClick={() => void post<{ basisId: string }>({ action: "correct", id }, () => { announce("Ett nytt underlag är skapat."); router.push("/?view=invoice_bases"); })} data-testid="invoice-correct"><FilePlus2 />Nytt underlag att rätta</Button> : null}
        {invoice.creditId ? <Button type="button" variant="ghost" onClick={() => onOpen(invoice.creditId!)} data-testid="invoice-open-credit"><BadgeCheck />Öppna {invoice.creditLabel}</Button> : null}
      </> : null}
    </div>
    <dl className="grid gap-x-5 gap-y-1.5 text-sm sm:grid-cols-2" data-testid="invoice-facts">
      {facts.map(([label, value]) => <div key={label} className="flex min-w-0 flex-wrap gap-x-1.5"><dt className="text-muted-foreground">{label}:</dt><dd className="min-w-0 font-medium break-words">{value}</dd></div>)}
    </dl>
    <div className="overflow-hidden rounded-lg border" data-testid="invoice-lines">
      <div className="divide-y text-sm">{content.lines.map((line) => <div key={line.id} className="flex items-baseline justify-between gap-4 px-3 py-2">
        <div className="min-w-0"><p className="break-words font-medium">{line.name}</p><p className="text-xs text-muted-foreground tabular-nums">{signedSek(line.quantity).replace(/,00$/, "")} {line.unit} · à {signedSek(line.unitPrice)} kr · moms {formatPrice(line.vatPercent)} %</p></div>
        <span className="shrink-0 tabular-nums">{signedSek(line.amount)} kr</span>
      </div>)}</div>
    </div>
    <dl className="divide-y rounded-lg border text-sm" data-testid="invoice-sums">
      <Sum label="Summa exkl. moms" value={signedSek(content.net)} />
      {content.reverseVat ? <Sum label="Moms" value="Omvänd betalningsskyldighet" /> : content.vatRows.map((row) => <Sum key={row.percent} label={vatRowLabel(row.percent)} value={signedSek(row.vat)} />)}
      {content.rot ? <><Sum label="Summa inkl. moms" value={signedSek(content.gross)} /><Sum label="Arbetskostnad inkl. moms" value={signedSek(content.rot.labourInclVat)} /><Sum label="Skattereduktion ROT" value={signedSek(-content.rot.deduction)} /></> : null}
      <Sum label={invoice.kind === "CREDIT" ? "Krediterat belopp" : "Att betala"} value={`${signedSek(content.toPay)} kr`} strong />
    </dl>
    <div data-testid="invoice-log"><p className="mb-1.5 text-sm font-semibold">Logg</p>
      <ul className="divide-y rounded-lg border text-sm">{invoice.events.map((event) => <li key={event.id} className="px-3 py-2"><span className="font-medium">{invoiceEventWord(event.action)}</span> {event.action === "sent" && sentToOf(event.detail) ? `till ${sentToOf(event.detail)}` : event.detail} <span className="text-xs text-muted-foreground">{swedishDayKey(new Date(event.createdAt))} · {event.actorName}</span></li>)}</ul>
    </div>
    <Modal open={dialog === "paid"} onOpenChange={(value) => { if (!value) setDialog(null); }} title="Markera som betald" size="compact">
      <Field id="invoice-paid-on" type="date" label="Betaldag" value={paidOn} onChange={setPaidOn} />
      <DialogActions cancel={{ label: "Avbryt", onClick: () => setDialog(null) }} primary={{ label: "Markera", busy, busyLabel: "Sparar…", testId: "invoice-paid-submit", disabledReason: paidOn ? null : "Välj betaldag.", onClick: () => void post({ action: "paid", id, paidOn }, () => announce(`${invoice.label} är markerad som betald.`)) }} />
    </Modal>
    <Modal open={dialog === "credit"} onOpenChange={(value) => { if (!value) setDialog(null); }} title={`Kreditera ${invoice.label}`} size="compact">
      <div className="space-y-3">
        <p className="text-sm">Hela fakturan krediteras med en ny kreditfaktura med eget nummer.</p>
        {invoice.paidOn ? <p className="notice text-sm">Fakturan är betald. Pengarna betalas tillbaka utanför Workflow.</p> : null}
        {content.rot ? <p className="notice text-sm">Fakturan har ROT. Har begäran gått till Skatteverket måste den rättas där.</p> : null}
        <Field id="invoice-credit-reason" label="Varför krediteras fakturan" value={reason} onChange={setReason} multiline />
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </div>
      <DialogActions cancel={{ label: "Avbryt", onClick: () => setDialog(null) }} primary={{ label: "Skapa kreditfaktura", busy, busyLabel: "Skapar…", testId: "invoice-credit-submit", disabledReason: reason.trim() ? null : "Skriv varför.", onClick: () => void post<{ id: string; label: string }>({ action: "credit", id, reason }, (made) => announce(`Kreditfaktura ${made.label} är utfärdad.`)) }} />
    </Modal>
    <Modal open={dialog === "send"} onOpenChange={(value) => { if (!value) setDialog(null); }} title={`Skicka ${invoice.label}`} size="compact">
      <div className="space-y-3">
        <Field id="invoice-send-email" type="email" label="E-post" value={email} onChange={setEmail} />
        <Field id="invoice-send-message" label="Meddelande (valfritt)" value={message} onChange={setMessage} multiline />
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </div>
      <DialogActions cancel={{ label: "Avbryt", onClick: () => setDialog(null) }} primary={{ label: "Skicka", busy, busyLabel: "Skickar…", testId: "invoice-send-submit", disabledReason: email.trim() ? null : "Skriv en e-postadress.", onClick: () => void post<{ email: string; notice?: string }>({ action: "send", id, email: email.trim(), message: message.trim() }, (sent) => announce(sent.notice || `Skickad till ${sent.email}.`)) }} />
    </Modal>
  </>);
}

function Sum({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={`flex items-baseline justify-between gap-4 px-3 py-2 ${strong ? "font-semibold" : ""}`}><dt>{label}</dt><dd className="text-right tabular-nums">{value}</dd></div>;
}
