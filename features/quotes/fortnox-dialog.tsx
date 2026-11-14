"use client";

import { useEffect, useId, useState } from "react";
import { Eye, LoaderCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DisabledReason } from "@/components/ui/disabled-reason";
import { api } from "@/features/kfid/api";
import { DialogActions } from "@/features/kfid/ui";
import { CompanyGapsWarning } from "@/features/kfid/company-gaps-warning";
import { DialogPage } from "@/features/kfid/dialog-page";
import { formatSek } from "@/lib/workflow/expenses";
import { fortnoxCustomerNumberProblem, type FortnoxInvoicePayload } from "@/lib/quotes/fortnox";
import { FORTNOX_KEY_PLACE } from "@/lib/quotes/accounting";

type Preview = { payload: FortnoxInvoicePayload | null; issues: string[]; keyName: string | null; blocked: string | null;
  /** Kundnummer i bokföringen as kept on the customer (plan 1L), filled in when the window opens. */
  customerNumber?: string };

/** Where the company's key is added, in words that read the same at level 1 (no link there). */
const NO_KEY = `Företagets Fortnox-nyckel saknas. En administratör lägger till den under ${FORTNOX_KEY_PLACE}.`;
const EMPTY_CUSTOMER = fortnoxCustomerNumberProblem("");

/**
 * Skicka till Fortnox (2026-10-09, steg D; shared since 2026-10-10 by the quote and the fakturaunderlag): the
 * customer's number in Fortnox, first "Visa vad som skickas" (nothing leaves Workflow), then the send through the
 * company's own key. `endpoint` takes fortnox_preview and fortnox_send with `id` and `customerNumber`.
 * QA 2026-10-10: what stops a send – a local test instance, no key, a line without a price, no customer number – is said
 * at once in visible text, and the buttons are pressable with their reason (`disabledReason`). The window is a small
 * dialog (a screen at level 1), never a second view over the view it was opened from; what is sent is shown as a short
 * list instead of a scrolling JSON box.
 */
export function FortnoxDialog({ endpoint, id, intro, notes, onSent, onClose, testId = "quote-fortnox" }: {
  endpoint: string;
  id: string;
  /** What happens in Fortnox (and in Workflow) when it is sent. */
  intro: string;
  /** Short neutral lines under the intro (ROT on a quote). */
  notes?: { text: string; testId?: string }[];
  /** After a successful send, with Fortnox's document number ("" when Fortnox gave none). */
  onSent: (documentNumber: string) => void;
  onClose: () => void;
  testId?: string;
}) {
  const [customerNumber, setCustomerNumber] = useState("");
  // What stops a send whatever the customer number is: asked once when the window opens (nothing leaves Workflow).
  const [status, setStatus] = useState<{ blockers: string[] } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const previewReasonId = useId();
  const sendReasonId = useId();
  const blockersId = useId();
  const call = <T,>(action: string, number = customerNumber) => api<T>(endpoint, { method: "POST", body: JSON.stringify({ action, id, customerNumber: number }) });
  useEffect(() => {
    let active = true;
    api<Preview>(endpoint, { method: "POST", body: JSON.stringify({ action: "fortnox_preview", id, customerNumber: "" }) }).then((result) => {
      if (!active) return;
      const blockers = [result.blocked ?? "", result.keyName ? "" : NO_KEY, ...result.issues.filter((issue) => issue !== EMPTY_CUSTOMER)].filter(Boolean);
      setStatus({ blockers: [...new Set(blockers)] });
      // The customer's number in the accounting system (plan 1L): filled in, still changeable; a sent number is kept on the customer.
      if (result.customerNumber) setCustomerNumber((current) => current || result.customerNumber || "");
    }).catch((cause) => { if (active) { setStatus({ blockers: [] }); setError((cause as Error).message); } });
    return () => { active = false; };
  }, [endpoint, id]);
  const show = async () => {
    setBusy(true); setError("");
    try { setPreview(await call<Preview>("fortnox_preview")); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true); setError("");
    try {
      const result = await call<{ documentNumber: string }>("fortnox_send");
      onSent(result.documentNumber);
      onClose();
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  };
  const customerProblem = fortnoxCustomerNumberProblem(customerNumber);
  const blockers = status?.blockers ?? [];
  const previewIssues = preview ? preview.issues.filter((issue) => !blockers.includes(issue)) : [];
  const previewReason = !status ? "Kontrollerar vad som behövs …" : customerProblem;
  const sendReason = !status ? "Kontrollerar vad som behövs …" : blockers[0] || customerProblem || previewIssues[0] || (!preview?.payload ? "Tryck på Visa vad som skickas först." : "");
  const sendReasonShown = !sendReason ? "" : blockers.includes(sendReason) ? "blockers" : sendReason === previewReason ? "preview" : previewIssues.includes(sendReason) ? "issues" : "here";
  const invoice = preview?.payload?.Invoice;
  // The invoice to be sent can be long: larger than the popup ceiling (Popupstorlek, 2026-10-13), so a page on
  // displays 2 and 3 and a screen at level 1.
  return <DialogPage pageKey="fortnox" size="page" panelTitle="Fakturan till Fortnox" open onOpenChange={(next) => { if (!next) onClose(); }} title="Skicka till Fortnox">
    <div className="space-y-4" data-testid={testId}>
      <p className="text-sm leading-6 text-muted-foreground">{intro}</p>
      <CompanyGapsWarning />
      {notes?.map((note) => <p key={note.text} className="text-xs leading-5 text-muted-foreground" data-testid={note.testId}>{note.text}</p>)}
      {!status ? <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />Kontrollerar vad som behövs …</p>
        : blockers.length ? <div id={blockersId} className="notice text-sm" data-testid={`${testId}-blockers`}>
          <p className="font-medium">Det här behövs innan något kan skickas:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">{blockers.map((issue) => <li key={issue}>{issue}</li>)}</ul>
        </div> : null}
      <label className="field-stack text-xs font-medium text-muted-foreground">Kundnummer i Fortnox
        <Input value={customerNumber} maxLength={50} placeholder="Kundens nummer i Fortnox" onChange={(event) => { setCustomerNumber(event.target.value); setPreview(null); }} data-testid={`${testId}-customer`} />
        <span className="block font-normal">Hämtas från kunden och sparas där efter sändningen.</span>
      </label>
      <div className="space-y-1.5">
        <Button type="button" variant="outline" disabled={busy} disabledReason={previewReason || null} aria-describedby={previewReason ? previewReasonId : undefined} onClick={() => void show()} data-testid={`${testId}-preview`}>
          {busy && !preview ? <LoaderCircle className="animate-spin" /> : <Eye />}Visa vad som skickas
        </Button>
        <DisabledReason id={previewReasonId} reason={previewReason} />
      </div>
      {previewIssues.length ? <ul role="alert" className="list-disc space-y-1 pl-5 text-sm text-destructive">{previewIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
      {invoice ? <dl className="space-y-1.5 rounded-lg border bg-muted/40 p-3 text-sm" data-testid={`${testId}-payload`}>
        <div className="flex flex-wrap justify-between gap-x-3"><dt className="text-muted-foreground">Kundnummer</dt><dd className="font-medium">{invoice.CustomerNumber}</dd></div>
        <div className="flex flex-wrap justify-between gap-x-3"><dt className="text-muted-foreground">Fakturadatum</dt><dd className="tabular-nums">{invoice.InvoiceDate}</dd></div>
        <div className="flex flex-wrap justify-between gap-x-3"><dt className="text-muted-foreground">Referens</dt><dd>{invoice.ExternalInvoiceReference1}</dd></div>
        <div className="border-t pt-1.5"><dt className="text-muted-foreground">Rader (pris per enhet exkl. moms)</dt>
          <dd><ul className="mt-1 space-y-1">{invoice.InvoiceRows.map((row, index) => <li key={index} className="flex justify-between gap-3">
            <span className="min-w-0 [overflow-wrap:anywhere]">{row.Description}</span>
            <span className="shrink-0 tabular-nums">{row.DeliveredQuantity} × {formatSek(row.Price)} kr</span>
          </li>)}</ul></dd>
        </div>
      </dl> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {/* The send's reason is said once: in the list above, under Visa vad som skickas, or here. */}
      <DisabledReason id={sendReasonId} reason={sendReasonShown === "here" ? sendReason : ""} />
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Skicka till Fortnox", icon: <Send />, onClick: () => void send(), busy: busy && Boolean(preview), busyLabel: "Skickar…", disabledReason: sendReason || null,
        describedBy: sendReasonShown === "blockers" ? blockersId : sendReasonShown === "preview" ? previewReasonId : sendReasonShown === "here" ? sendReasonId : undefined, testId: `${testId}-send` }} />
    </div>
  </DialogPage>;
}
