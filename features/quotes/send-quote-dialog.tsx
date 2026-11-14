"use client";

import { useState } from "react";
import { BadgeCheck, Link2, XCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogActions, Field, Modal, Panel } from "@/features/kfid/ui";
import { ListFact, ListGroup, NativeActions } from "@/components/native";
import { formatSwedish } from "@/lib/swedish-time";
import { CompanyGapsWarning } from "@/features/kfid/company-gaps-warning";
import { CUSTOMER_LINK_STATE_LABELS, type QuoteCustomerLinkView, type QuoteCustomerResponseView } from "@/lib/quotes/customer-link";

/**
 * Offert per e-post, steg E (2026-10-09): "Skicka till kund" in the quote's editor. A small dialog with the
 * customer's e-mail (from the customer register when there is one) and an optional message (the company's standard text
 * from Priser och offerter when set). A draft is sent – and locked – at the same time; a sent quote gets a new link and
 * the earlier one stops working. The panel under the header says to whom and when it was sent, whether it was opened,
 * and the customer's answer. On a loopback test instance no e-mail is sent and the test link is shown; in the demo the
 * customer's answer can be tried with two buttons.
 */
export function SendQuoteDialog({ open, onOpenChange, defaultEmail, defaultMessage, validUntil, draft, resend, busy, onSend }: {
  open: boolean; onOpenChange: (open: boolean) => void; defaultEmail: string; defaultMessage: string; validUntil: string;
  draft: boolean; resend: boolean; busy: boolean; onSend: (input: { email: string; message: string }) => void;
}) {
  // The fields start from the defaults each time the dialog opens (it is drawn only while open).
  return open ? <SendQuoteForm key={`${defaultEmail}|${defaultMessage}`} {...{ onOpenChange, defaultEmail, defaultMessage, validUntil, draft, resend, busy, onSend }} /> : null;
}

const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

/** The fields of Skicka till kund: in the dialog on level 2–3 and the computer, on a screen of its own at level 1. */
function SendQuoteFields({ email, setEmail, message, setMessage, validUntil, draft, resend }: {
  email: string; setEmail: (value: string) => void; message: string; setMessage: (value: string) => void; validUntil: string; draft: boolean; resend: boolean;
}) {
  return <>
    <CompanyGapsWarning />
    <Field id="quote-send-email" type="email" label="Kundens e-post" value={email} onChange={setEmail} required autoComplete="email" />
    {/* Why Skicka is off, in words (ART-17). */}
    {email.trim() && !validEmail(email) ? <p className="-mt-2 text-xs text-destructive" role="status" data-testid="quote-send-email-hint">Skriv en e-postadress, till exempel namn@foretag.se.</p> : null}
    <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">Meddelande (valfritt)
      <textarea className="form-textarea min-h-24" maxLength={2000} value={message} onChange={(event) => setMessage(event.target.value)} data-testid="quote-send-message" />
    </label>
    <p className="text-xs leading-5 text-muted-foreground">
      Kunden får en länk till offerten och kan acceptera eller avböja den utan konto. Länken gäller till och med {validUntil || "giltighetsdatumet"}.
      {draft ? " Offerten låses när den skickas. Ändringar görs sedan som en ny version." : ""}
      {resend ? " Den tidigare länken slutar fungera." : ""}
    </p>
  </>;
}

function SendQuoteForm({ onOpenChange, defaultEmail, defaultMessage, validUntil, draft, resend, busy, onSend }: Omit<React.ComponentProps<typeof SendQuoteDialog>, "open">) {
  const [email, setEmail] = useState(defaultEmail);
  const [message, setMessage] = useState(defaultMessage);
  const valid = validEmail(email);
  return <Modal open onOpenChange={onOpenChange} title="Skicka offerten till kunden" size="form">
    <form className="space-y-4" data-testid="quote-send-customer-dialog" onSubmit={(event) => { event.preventDefault(); if (valid) onSend({ email: email.trim(), message: message.trim() }); }}>
      <SendQuoteFields {...{ email, setEmail, message, setMessage, validUntil, draft, resend }} />
      <DialogActions cancel={{ onClick: () => onOpenChange(false) }} primary={{ label: "Skicka", type: "submit", disabled: !valid, busy, busyLabel: "Skickar…", testId: "quote-send-customer-submit" }} />
    </form>
  </Modal>;
}

/**
 * Skicka till kund at level 1 on a phone (2026-10-10): the same fields on a screen of its own, no dialog; Avbryt
 * and Skicka are in the top bar, whose Skicka submits this form. A missing or odd address is said in words.
 */
export function SendQuoteScreen({ formRef, defaultEmail, defaultMessage, validUntil, draft, resend, onSend }: {
  formRef: React.RefObject<HTMLFormElement | null>; defaultEmail: string; defaultMessage: string; validUntil: string; draft: boolean; resend: boolean;
  onSend: (input: { email: string; message: string }) => void;
}) {
  const [email, setEmail] = useState(defaultEmail);
  const [message, setMessage] = useState(defaultMessage);
  const [tried, setTried] = useState(false);
  const valid = validEmail(email);
  return <form ref={formRef} noValidate className="native-group space-y-4 p-4" data-testid="native-quote-send"
    onSubmit={(event) => { event.preventDefault(); setTried(true); if (valid) onSend({ email: email.trim(), message: message.trim() }); }}>
    <SendQuoteFields {...{ email, setEmail, message, setMessage, validUntil, draft, resend }} />
    {tried && !valid ? <p role="alert" className="text-sm font-medium text-destructive" data-testid="native-quote-send-invalid">Ange kundens e-postadress.</p> : null}
  </form>;
}

const when = (iso: string) => formatSwedish(new Date(iso), { dateStyle: "short", timeStyle: "short" });

export function CustomerLinkPanel({ link, response, testUrl, demo, busy, onDemoAnswer }: {
  link: QuoteCustomerLinkView | null | undefined; response: QuoteCustomerResponseView | null | undefined; testUrl: string;
  demo: boolean; busy: boolean; onDemoAnswer: (decision: "ACCEPTED" | "DECLINED") => void;
}) {
  if (!link && !response) return null;
  // The same header as the quote's other panels (Grunduppgifter, Rader, Summa): no icon.
  return <Panel icon={Send} title="Skickad till kunden">
    <div className="space-y-3 text-sm" data-testid="quote-customer-link">
      {link ? <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
        <div><dt className="text-xs text-muted-foreground">Skickad till</dt><dd className="break-all">{link.email}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Skickad</dt><dd>{when(link.sentAt)}</dd></div>
        {/* "Inte än" only while the customer has not answered: an answer means the quote was opened (QA 2026-10-10). */}
        {link.openedAt || !response ? <div><dt className="text-xs text-muted-foreground">Öppnad av kunden</dt><dd data-testid="quote-customer-link-opened">{link.openedAt ? when(link.openedAt) : "Inte än"}</dd></div> : null}
        <div><dt className="text-xs text-muted-foreground">Länken</dt><dd data-testid="quote-customer-link-state">{CUSTOMER_LINK_STATE_LABELS[link.state]}{link.state === "active" && link.validUntil ? `, till och med ${link.validUntil}` : ""}</dd></div>
      </dl> : null}
      {response ? <p className={`notice flex items-start gap-2 ${response.decision === "ACCEPTED" ? "text-emerald-700 dark:text-emerald-300" : ""}`} data-testid="quote-customer-response" data-decision={response.decision}>
        {response.decision === "ACCEPTED" ? <BadgeCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
        <span>{response.decision === "ACCEPTED" ? "Accepterad" : "Avböjd"} av kunden {when(response.at)}{response.name ? `, ${response.name} (${response.methodLabel.toLowerCase()})` : ""}.{response.reason ? ` Skäl: ${response.reason}` : ""}</span>
      </p> : null}
      {testUrl ? <p className="notice break-all" data-testid="quote-test-link"><Link2 className="mr-1 inline size-4" aria-hidden="true" />E-post skickas aldrig från en lokal testinstans. Testlänk: <a className="text-primary hover:underline" href={testUrl} target="_blank" rel="noopener noreferrer">{testUrl}</a></p> : null}
      {demo && link?.state === "active" && !response ? <div className="space-y-2" data-testid="quote-demo-answer">
        <p className="text-xs text-muted-foreground">I demon skickas ingen e-post. Prova hur kundens svar kommer tillbaka:</p>
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="outline" disabled={busy} onClick={() => onDemoAnswer("ACCEPTED")} data-testid="quote-demo-accept"><BadgeCheck />Kunden accepterar</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onDemoAnswer("DECLINED")} data-testid="quote-demo-decline"><XCircle />Kunden avböjer</Button>
        </div>
      </div> : null}
    </div>
  </Panel>;
}

/**
 * Skickad till kunden at level 1 on a phone (2026-10-10): the same facts as rows of one group – to whom and when
 * it was sent, whether the customer opened it, the link, and the customer's answer – and in the demo the two answers as
 * rows. Read only; the answer comes from the customer's own page.
 */
export function NativeCustomerLink({ link, response, testUrl, demo, busy, onDemoAnswer }: React.ComponentProps<typeof CustomerLinkPanel>) {
  if (!link && !response) return null;
  return <>
    <ListGroup title="Skickad till kunden" testId="quote-customer-link">
      {response ? <ListFact label="Kundens svar" testId="quote-customer-response">
        <span data-decision={response.decision} className={response.decision === "ACCEPTED" ? "font-medium text-emerald-700 dark:text-emerald-300" : "font-medium text-destructive"}>
          {response.decision === "ACCEPTED" ? "Accepterad" : "Avböjd"} av kunden {when(response.at)}{response.name ? `, ${response.name}` : ""}
        </span>{response.name ? ` (${response.methodLabel.toLowerCase()}).` : "."}{response.reason ? `\nSkäl: ${response.reason}` : ""}
      </ListFact> : null}
      {link ? <>
        <ListFact label="Skickad till">{link.email}</ListFact>
        <ListFact label="Skickad">{when(link.sentAt)}</ListFact>
        {link.openedAt || !response ? <ListFact label="Öppnad av kunden" testId="quote-customer-link-opened">{link.openedAt ? when(link.openedAt) : "Inte än"}</ListFact> : null}
        <ListFact label="Länken" testId="quote-customer-link-state">{CUSTOMER_LINK_STATE_LABELS[link.state]}{link.state === "active" && link.validUntil ? `, till och med ${link.validUntil}` : ""}</ListFact>
      </> : null}
      {testUrl ? <ListFact label="Testlänk (ingen e-post från en lokal testinstans)" testId="quote-test-link"><a className="text-primary" href={testUrl} target="_blank" rel="noopener noreferrer">{testUrl}</a></ListFact> : null}
    </ListGroup>
    {demo && link?.state === "active" && !response ? <NativeActions title="Prova kundens svar" footer="I demon skickas ingen e-post. Prova hur kundens svar kommer tillbaka." testId="quote-demo-answer">
      <Button type="button" variant="ghost" disabled={busy} onClick={() => onDemoAnswer("ACCEPTED")} data-testid="quote-demo-accept"><BadgeCheck />Kunden accepterar</Button>
      <Button type="button" variant="ghost" disabled={busy} onClick={() => onDemoAnswer("DECLINED")} data-testid="quote-demo-decline"><XCircle />Kunden avböjer</Button>
    </NativeActions> : null}
  </>;
}
