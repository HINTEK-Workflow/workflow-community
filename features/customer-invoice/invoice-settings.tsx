"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { CheckField, Field, Panel } from "@/features/kfid/ui";
import { announce } from "@/lib/workflow/toast";
import type { InvoiceSettingsView } from "@/lib/customer-invoice/model";

/**
 * Fakturering under Inställningar → Arbetssätt (owner's decision 2026-11-04, on for everyone since 2026-11-05): the company can turn it off. Each change is saved when the field is left, as on
 * the other settings pages. Turning it on with an accounting link asks first: the company chooses where its invoices are made.
 * Only the company's admin changes it; the server decides.
 */
type Fields = { nextNumber: string; prefix: string; paymentDays: string; lateTerms: string; iban: string; bic: string };
const fieldsOf = (view: InvoiceSettingsView): Fields => ({ nextNumber: String(view.settings.nextNumber), prefix: view.settings.prefix, paymentDays: view.settings.paymentDays === null ? "" : String(view.settings.paymentDays), lateTerms: view.settings.lateTerms, iban: view.settings.iban, bic: view.settings.bic });

export function CustomerInvoiceSettings() {
  const router = useRouter();
  const [view, setView] = useState<InvoiceSettingsView | null>(null);
  const [fields, setFields] = useState<Fields | null>(null);
  const [error, setError] = useState("");
  const [ask, confirmDialog] = useConfirm();
  const queue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    let live = true;
    api<InvoiceSettingsView>("/api/customer-invoices?settings=1", { cache: "no-store" }).then((next) => { if (live) { setView(next); setFields(fieldsOf(next)); } }).catch((cause: Error) => { if (live) setError(cause.message); });
    return () => { live = false; };
  }, []);
  if (error && !view) return <p className="text-sm text-destructive" role="alert">{error}</p>;
  if (!view || !fields) return <p className="text-sm text-muted-foreground">Hämtar…</p>;
  const { settings } = view;
  const disabled = !view.canEdit;
  const save = (patch: Partial<InvoiceSettingsView["settings"]>, next: Fields, confirmOverlap = false) => {
    const days = next.paymentDays.trim();
    const payload = {
      enabled: settings.enabled, useOcr: settings.useOcr, vatExempt: settings.vatExempt, ...patch, confirmOverlap,
      nextNumber: Number(next.nextNumber), prefix: next.prefix, paymentDays: days === "" ? null : Number(days), lateTerms: next.lateTerms, iban: next.iban, bic: next.bic,
    };
    queue.current = queue.current.then(async () => {
      try {
        const saved = await api<InvoiceSettingsView>("/api/customer-invoices", { method: "POST", body: JSON.stringify({ action: "settings", settings: payload }) });
        setView(saved); setError("");
        // The menu item follows the setting.
        if (saved.settings.enabled !== settings.enabled) router.refresh();
        announce("Inställningarna för fakturering är sparade.");
      } catch (cause) { setError((cause as Error).message); announce((cause as Error).message, true); }
    });
  };
  const changed = () => { const saved = fieldsOf(view); return (Object.keys(saved) as (keyof Fields)[]).some((key) => saved[key] !== fields[key]); };
  const leave = () => { if (changed()) save({}, fields); };
  const text = (key: keyof Fields) => ({ value: fields[key], disabled, onChange: (value: string) => setFields({ ...fields, [key]: value }) });
  const turn = async (on: boolean) => {
    if (on && view.connected) {
      const yes = await ask({ title: `Företaget är kopplat till ${view.connected}`, message: `Fakturor kan då skapas på två ställen. Workflow skickar inget till ${view.connected}, men samma arbete får inte faktureras i båda. Vill ni fakturera i Workflow?`, confirmLabel: "Fakturera i Workflow", tone: "danger" });
      if (!yes) return;
      save({ enabled: true }, fields, true);
    } else save({ enabled: on }, fields);
  };
  return <div data-testid="customer-invoice-settings"><Panel title="Fakturor" description="Workflow kan göra fakturor av fakturaunderlag.">
    {confirmDialog}
    <div className="space-y-4">
      {view.connected ? <p className="notice text-sm" data-testid="customer-invoice-overlap">Företaget är kopplat till {view.connected}. Fakturera bara på ett ställe, annars kan samma arbete faktureras två gånger.</p> : null}
      <CheckField id="invoice-enabled" label="Utfärda fakturor i Workflow" description="Av: ingen faktura kan skapas och inget om fakturor visas." checked={settings.enabled} disabled={disabled} onChange={(on) => void turn(on)} testId="customer-invoice-enabled" />
      <div className="field-group grid gap-4 rounded-lg border p-3 sm:grid-cols-3" onBlur={leave}>
        <Field id="invoice-next" label="Startnummer" {...text("nextNumber")} disabled={disabled || settings.issued > 0} help={settings.issued ? "Låst: företaget har utfärdat fakturor." : "Nästa faktura får det här numret."} />
        <Field id="invoice-prefix" label="Prefix (valfritt)" {...text("prefix")} help="Till exempel 2026-." />
        <Field id="invoice-days" label="Betalningsvillkor (dagar)" {...text("paymentDays")} />
        <Field id="invoice-iban" label="IBAN (valfritt)" {...text("iban")} />
        <Field id="invoice-bic" label="BIC (valfritt)" {...text("bic")} />
        <Field id="invoice-late" label="Vid försenad betalning (valfritt)" {...text("lateTerms")} className="sm:col-span-3" multiline help="Tomt: mallens text används." />
      </div>
      <CheckField id="invoice-ocr" label="Använd OCR-nummer" description="Workflow räknar ut ett OCR-nummer med kontrollsiffra. Bankgirot måste vara anslutet till OCR hos banken. Av: fakturanumret är betalningsreferens." checked={settings.useOcr} disabled={disabled} onChange={(useOcr) => save({ useOcr }, fields)} testId="customer-invoice-ocr" />
      <CheckField id="invoice-exempt" label="Företaget säljer utan moms" description="Undantaget för liten omsättning. Inget momsregistreringsnummer krävs och ingen moms läggs på." checked={settings.vatExempt} disabled={disabled} onChange={(vatExempt) => save({ vatExempt }, fields)} testId="customer-invoice-exempt" />
      {view.sellerProblems.length ? <div className="notice text-sm" data-testid="customer-invoice-seller-problems"><p className="font-medium">Det här saknas innan en faktura kan utfärdas:</p><ul className="mt-1 list-disc space-y-0.5 pl-5">{view.sellerProblems.map((problem) => <li key={problem.key}>{problem.text}</li>)}</ul></div> : null}
      <p className="text-xs text-muted-foreground">Bankgiro, plusgiro, säte och F-skatt anges under Företagsuppgifter. Vem som får fakturera styrs av rätten Fakturera på varje användare.</p>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  </Panel></div>;
}
