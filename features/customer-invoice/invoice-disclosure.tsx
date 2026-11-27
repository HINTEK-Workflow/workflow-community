"use client";

import { useCallback, useState } from "react";
import { FileDown, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/features/kfid/api";
import { DialogActions, Field, Modal, Panel } from "@/features/kfid/ui";
import { saveResponse } from "@/lib/download";
import { useLoadEffect } from "@/lib/use-load-effect";
import { DISCLOSURE_REASON_MIN } from "@/lib/staff-register/model";

type Company = { id: string; name: string; erased: boolean; rows: number; from: string; to: string; keptThrough: string };

/**
 * Fakturor på begäran (2026-11-04), beside Personalliggare på begäran: an erased or switched-off company has no login, so the
 * superadmin hands one kept invoice at a time out on request, with a required reason that is written to the company's history.
 * Shows only the company, the count and the dates.
 */
export function CustomerInvoiceDisclosure() {
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [error, setError] = useState("");
  const [choice, setChoice] = useState<Company | null>(null);
  const [label, setLabel] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const load = useCallback(async () => {
    try { setCompanies((await api<{ companies: Company[] }>("/api/superadmin/customer-invoices")).companies); }
    catch (issue) { setError((issue as Error).message); }
  }, []);
  useLoadEffect(load);
  const disclose = async () => {
    if (!choice) return;
    setBusy(true); setFormError("");
    try {
      const response = await fetch("/api/superadmin/customer-invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId: choice.id, label, reason }) });
      if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error || "Åtgärden misslyckades.");
      await saveResponse(response, "faktura.pdf");
      setChoice(null); setLabel(""); setReason("");
    } catch (issue) { setFormError((issue as Error).message); } finally { setBusy(false); }
  };
  return <Panel icon={Receipt} title="Fakturor på begäran" description="Raderade eller avstängda företag kan inte logga in. Deras sparade fakturor lämnas ut härifrån på begäran, en i taget, med skäl.">
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : !companies ? <p role="status" className="text-sm text-muted-foreground">Hämtar…</p>
      : !companies.length ? <p className="text-sm text-muted-foreground">Inga raderade eller avstängda företag har sparade fakturor.</p>
      : <ul className="divide-y rounded-xl border text-sm" data-testid="customer-invoice-disclosure">{companies.map((company) => <li key={company.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <span><span className="font-medium">{company.name}</span> <span className="text-muted-foreground">({company.erased ? "raderat" : "avstängt"})</span>
          <span className="mt-1 block text-xs text-muted-foreground">{company.rows} fakturor · {company.from} – {company.to} · sparas till och med {company.keptThrough}</span></span>
        <Button variant="outline" onClick={() => { setChoice(company); setFormError(""); }}><FileDown />Lämna ut</Button>
      </li>)}</ul>}
    {choice ? <Modal open onOpenChange={(open) => { if (!open) setChoice(null); }} title="Lämna ut faktura" size="compact">
      <div className="space-y-4">
        <p className="text-sm">{choice.name}. PDF:en kan innehålla personnummer i klartext och sparas inte på servern.</p>
        <Field id="invoice-disclosure-label" label="Fakturanummer" value={label} onChange={setLabel} />
        <Field id="invoice-disclosure-reason" label="Skäl" value={reason} onChange={setReason} multiline />
        {formError ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}
      </div>
      <DialogActions cancel={{ label: "Avbryt", onClick: () => setChoice(null) }} primary={{ label: "Lämna ut", busy, busyLabel: "Hämtar…", onClick: () => void disclose(), disabledReason: label.trim() && reason.trim().length >= DISCLOSURE_REASON_MIN ? null : "Skriv fakturanummer och skäl." }} />
    </Modal> : null}
  </Panel>;
}
