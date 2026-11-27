"use client";

import { useCallback, useState } from "react";
import { FileDown, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DISCLOSURE_REASON_MIN } from "@/lib/staff-register/model";
import { useLoadEffect } from "@/lib/use-load-effect";
import { api } from "./api";
import { Modal, Panel } from "./ui";
import { saveResponse } from "@/lib/download";
import { DownloadButton } from "@/components/ui/download-button";

type Site = { projectId: string; name: string; siteId: string; rows: number; from: string; to: string };
type Company = { id: string; name: string; erased: boolean; sites: Site[] };

/**
 * Personalliggare på begäran (2026-10-09 evening), in the product administration's Företag view: an erased or
 * switched-off company has no login, so the superadmin hands its kept register out on request – one building site at a
 * time, as the ordinary CSV, with a required reason that is written to the company's history. Shows only the company,
 * the site and the row count; nothing else of the company's data.
 */
export function StaffRegisterDisclosure() {
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [error, setError] = useState("");
  const [choice, setChoice] = useState<{ company: Company; site: Site } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const load = useCallback(async () => {
    try { setCompanies((await api<{ companies: Company[] }>("/api/superadmin/staff-register")).companies); }
    catch (issue) { setError((issue as Error).message); }
  }, []);
  useLoadEffect(load);

  async function disclose() {
    if (!choice) return;
    setBusy(true); setFormError("");
    try {
      const response = await fetch("/api/superadmin/staff-register", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: choice.company.id, projectId: choice.site.projectId, reason }) });
      if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error || "Åtgärden misslyckades.");
      await saveResponse(response, "personalliggare.csv");
      setChoice(null); setReason("");
    } catch (issue) { setFormError((issue as Error).message); }
    finally { setBusy(false); }
  }

  return <Panel icon={ClipboardList} title="Personalliggare på begäran" description="Raderade eller avstängda företag kan inte logga in. Deras sparade personalliggare lämnas ut härifrån på begäran, med skäl som sparas i företagets historik.">
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : !companies ? <p role="status" className="text-sm text-muted-foreground">Hämtar…</p>
      : !companies.length ? <p className="text-sm text-muted-foreground">Inga raderade eller avstängda företag har sparade rader i personalliggaren.</p>
      : <ul className="divide-y rounded-xl border text-sm" data-testid="staff-register-disclosure">{companies.flatMap((company) => company.sites.map((site) =>
        <li key={site.projectId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <span><span className="font-medium">{company.name}</span> <span className="text-muted-foreground">({company.erased ? "raderat" : "avstängt"})</span>
            <span className="mt-1 block text-xs text-muted-foreground">{site.name || "Byggarbetsplats"}{site.siteId ? ` · id-nr ${site.siteId}` : ""} · {site.rows} rader · {site.from} – {site.to}</span></span>
          <Button variant="outline" onClick={() => { setChoice({ company, site }); setReason(""); setFormError(""); }}><FileDown />Lämna ut</Button>
        </li>))}</ul>}
    {choice ? <Modal open onOpenChange={(open) => { if (!open) setChoice(null); }} title="Lämna ut personalliggare" size="compact">
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void disclose(); }}>
        <p className="text-sm">{choice.company.name} · {choice.site.name || "Byggarbetsplats"} · {choice.site.rows} rader. Filen innehåller personnummer i klartext och sparas inte på servern.</p>
        <label className="block space-y-2 text-xs font-medium text-muted-foreground">Skäl (sparas i företagets historik)
          <Input value={reason} required minLength={DISCLOSURE_REASON_MIN} maxLength={300} placeholder="T.ex. begäran från Skatteverket" onChange={(event) => setReason(event.target.value)} data-testid="staff-register-disclosure-reason" />
        </label>
        {formError ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setChoice(null)}>Avbryt</Button>
          <DownloadButton type="submit" variant="default" disabled={busy || reason.trim().length < DISCLOSURE_REASON_MIN}>Hämta CSV</DownloadButton>
        </div>
      </form>
    </Modal> : null}
  </Panel>;
}
