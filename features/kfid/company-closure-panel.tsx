"use client";

import { useCallback, useState } from "react";
import { CalendarClock, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { formatSwedishDate, swedishDayKey } from "@/lib/swedish-time";
import { useLoadEffect } from "@/lib/use-load-effect";
import { api } from "./api";
import { useConfirm } from "./confirm";
import { Modal, Panel } from "./ui";

type Item = {
  organizationId: string; name: string; status: "COUNTING" | "DUE" | "STARTS" | "CANCELS";
  endedAt: string | null; firstNoticeAt: string | null; exportUntil: string | null; postponedUntil: string | null; postponeReason: string;
  dueAt: string | null; reminders: number; note: string;
};
type Preview = { members: number; anonymised: number; customers: number; projects: number; tasks: number; quotes: number; files: number; keptRegisterRows: number; keptInvoices?: number };
type DryRun = {
  autoErase: boolean; limit: number; laterRuns: number;
  erase: { organizationId: string; name: string; preview: Preview }[];
  start: { organizationId: string; name: string }[]; remind: { organizationId: string; name: string }[]; cancel: { organizationId: string; name: string }[];
};

const statusText: Record<Item["status"], string> = { COUNTING: "Nedräkning", DUE: "Förfallen", STARTS: "Börjar nästa natt", CANCELS: "Avbryts nästa natt" };
const day = (value: string | null) => value ? formatSwedishDate(value, { dateStyle: "medium" }) : "–";

/**
 * Radering efter avslut (2026-10-10), under Installation → Kundföretag: the companies whose Cloud
 * agreement has ended, counting down and due, with dates; Skjut upp with a required reason; a dry-run that shows what
 * the next night would do; and the switch "Automatisk radering påslagen" – off until the superadmin has seen the list.
 * Metadata and counts only, never the company's work (lib/company-closure).
 */
export function CompanyClosurePanel() {
  const [data, setData] = useState<{ autoErase: boolean; items: Item[] } | null>(null);
  const [error, setError] = useState("");
  const [dryRun, setDryRun] = useState<DryRun | null>(null);
  const [postpone, setPostpone] = useState<Item | null>(null);
  const [form, setForm] = useState({ until: "", reason: "" });
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, confirmElement] = useConfirm();
  const load = useCallback(async () => {
    try { setData(await api<{ autoErase: boolean; items: Item[] }>("/api/superadmin/company-closures")); setError(""); }
    catch (issue) { setError((issue as Error).message); }
  }, []);
  useLoadEffect(load);

  async function toggle(enabled: boolean) {
    const ok = await confirm(enabled
      ? { title: "Slå på automatisk radering?", message: "Jobbet raderar då varje natt de företag som är förfallna i listan, högst tre per natt. Bokföringsunderlag och personalliggaren sparas. Radering går inte att ångra.", confirmLabel: "Slå på", tone: "danger" }
      : { title: "Slå av automatisk radering?", message: "Jobbet fortsätter att räkna ned och skicka besked, men raderar inget.", confirmLabel: "Slå av" });
    if (!ok) return;
    setBusy(true);
    try { await api("/api/superadmin/company-closures", { method: "PATCH", body: JSON.stringify({ action: "auto_erase", enabled }) }); setDryRun(null); await load(); }
    catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  }

  async function runDry() {
    setBusy(true);
    try { setDryRun((await api<{ dryRun: DryRun }>("/api/superadmin/company-closures?dryRun=1")).dryRun); }
    catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  }

  return <Panel title="Radering efter avslut" description="Företag vars Cloud-avtal har upphört. De kan exportera i 30 dagar. Därefter raderas företagets data. Bokföringsunderlag och personalliggaren sparas så länge lagen kräver."
    icon={CalendarClock}>
    {confirmElement}
    <div data-testid="company-closure">
      <label className="mb-4 flex items-start gap-3 rounded-xl border p-4">
        <Checkbox checked={data?.autoErase === true} disabled={!data || busy} onCheckedChange={(checked) => void toggle(checked === true)} data-testid="company-closure-auto-erase" />
        <span><span className="block text-sm font-medium">Automatisk radering påslagen</span>
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">Av: jobbet räknar ned och skickar besked men raderar inget. På: förfallna företag raderas natten efter raderingsdatumet, högst tre per natt.</span></span>
      </label>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : !data ? <p role="status" className="text-sm text-muted-foreground">Hämtar…</p>
        : !data.items.length ? <p className="text-sm text-muted-foreground">Inga företag har ett avslutat Cloud-avtal.</p>
        : <ul className="divide-y rounded-xl border text-sm">{data.items.map((item) =>
          <li key={item.organizationId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" data-testid="company-closure-row">
            <span className="min-w-0">
              <span className="font-medium">{item.name}</span> <span className="text-muted-foreground">({statusText[item.status]})</span>
              <span className="mt-1 block text-xs text-muted-foreground">Avtalet upphörde {day(item.endedAt)} · besked {day(item.firstNoticeAt)} · raderas efter {day(item.dueAt)}{item.reminders ? ` · ${item.reminders} påminnelser` : ""}</span>
              {item.postponedUntil ? <span className="mt-1 block text-xs text-muted-foreground">Uppskjutet till {day(item.postponedUntil)}: {item.postponeReason}</span> : null}
              <span className="mt-1 block text-xs text-muted-foreground">{item.note}</span>
            </span>
            {item.status === "COUNTING" || item.status === "DUE" ? <Button variant="outline" disabled={busy} onClick={() => {
              setPostpone(item); setFormError("");
              setForm({ until: item.dueAt ? swedishDayKey(new Date(new Date(item.dueAt).getTime() + 30 * 86_400_000)) : "", reason: "" });
            }}><CalendarClock />Skjut upp</Button> : null}
          </li>)}</ul>}
      <div className="mt-4">
        <Button variant="outline" disabled={busy} onClick={() => void runDry()} data-testid="company-closure-dry-run"><ListChecks />Visa vad nästa körning gör</Button>
      </div>
      {dryRun ? <div className="mt-4 space-y-2 rounded-xl border p-4 text-sm" data-testid="company-closure-dry-run-result">
        <p className="font-medium">Provkörning – inget har ändrats</p>
        {dryRun.erase.length ? <>
          <p>{dryRun.autoErase ? "Raderas nästa natt:" : "Skulle raderas om automatisk radering var påslagen:"}</p>
          <ul className="list-disc space-y-1 pl-5">{dryRun.erase.map((item) => <li key={item.organizationId}>
            <span className="font-medium">{item.name}</span>: {item.preview.anonymised} av {item.preview.members} personer anonymiseras, {item.preview.customers} kunder, {item.preview.projects} projekt, {item.preview.tasks} uppgifter, {item.preview.quotes} offerter och {item.preview.files} filer raderas{item.preview.keptRegisterRows ? `; ${item.preview.keptRegisterRows} rader i personalliggaren sparas` : ""}{item.preview.keptInvoices ? `; ${item.preview.keptInvoices} fakturor sparas i sju år` : ""}.
          </li>)}</ul>
          {dryRun.laterRuns ? <p className="text-muted-foreground">{dryRun.laterRuns} till väntar på senare nätter (högst {dryRun.limit} per natt).</p> : null}
        </> : <p>Inget företag raderas.</p>}
        {dryRun.start.length ? <p>Får första beskedet: {dryRun.start.map((item) => item.name).join(", ")}.</p> : null}
        {dryRun.remind.length ? <p>Får en påminnelse: {dryRun.remind.map((item) => item.name).join(", ")}.</p> : null}
        {dryRun.cancel.length ? <p>Nedräkningen avbryts: {dryRun.cancel.map((item) => item.name).join(", ")}.</p> : null}
      </div> : null}
    </div>
    {postpone ? <Modal open onOpenChange={(open) => { if (!open && !busy) setPostpone(null); }} title="Skjut upp raderingen" size="form">
      <form className="space-y-4" onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true); setFormError("");
        try {
          await api("/api/superadmin/company-closures", { method: "PATCH", body: JSON.stringify({ action: "postpone", organizationId: postpone.organizationId, until: form.until, reason: form.reason }) });
          setPostpone(null); setDryRun(null); await load();
        } catch (issue) { setFormError((issue as Error).message); }
        finally { setBusy(false); }
      }}>
        <p className="text-sm">{postpone.name} raderas i dag efter {day(postpone.dueAt)}. Företaget får nya påminnelser före det nya datumet.</p>
        <div><label htmlFor="closure-postpone-until" className="mb-2 block text-xs font-medium">Nytt raderingsdatum</label>
          <Input id="closure-postpone-until" type="date" required value={form.until} onChange={(event) => setForm({ ...form, until: event.target.value })} /></div>
        <div><label htmlFor="closure-postpone-reason" className="mb-2 block text-xs font-medium">Skäl (sparas i företagets historik)</label>
          <Input id="closure-postpone-reason" required minLength={3} maxLength={300} placeholder="T.ex. kunden har bett om mer tid för exporten" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} data-testid="company-closure-reason" /></div>
        {formError ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => setPostpone(null)}>Avbryt</Button>
          <Button type="submit" disabled={busy || form.reason.trim().length < 3 || !form.until}><CalendarClock />Skjut upp</Button>
        </div>
      </form>
    </Modal> : null}
  </Panel>;
}
