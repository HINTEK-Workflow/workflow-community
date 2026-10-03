"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Mail, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, Panel } from "@/features/kfid/ui";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { formatSwedish } from "@/lib/swedish-time";
import { ChoiceCard } from "@/components/ui/choice-card";
import { useInstance } from "@/components/instance-provider";
import { MailingEditor } from "@/features/workflow/mailing-editor";
import { mailingProblems, starterMailing, type MailingDocument } from "@/lib/mail/mailing-document";

type Audience = "NEWSLETTER" | "ADMINS";
type Row = { id: string; subject: string; audience: Audience; status: "QUEUED" | "SENT"; createdAt: string; finishedAt: string | null; sent: number; pending: number; failed: number; skipped: number };
type Data = { audiences: Record<Audience, number>; blockedReason: string | null; keptMonths: number; mailings: Row[] };

const AUDIENCE: Record<Audience, { label: string; description: string }> = {
  NEWSLETTER: { label: "Nyhetsbrev", description: "Till dem som har sagt ja till nyheter. Mejlet får en länk för att avböja." },
  ADMINS: { label: "Viktig information", description: "Till ägare och administratörer i alla aktiva företag. Bara om tjänsten, till exempel driftstopp eller ändrade villkor – aldrig marknadsföring." },
};

/**
 * Utskick (2026-10-03): the superadmin writes a newsletter or important information, tries it on themselves and
 * sends it. A blank line starts a new paragraph; web addresses become links. The queue sends it within minutes.
 */
export function Mailings({ notify }: { notify: (text: string, error?: boolean) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [audience, setAudience] = useState<Audience>("NEWSLETTER");
  const [subject, setSubject] = useState("");
  const [document, setDocument] = useState<MailingDocument>(starterMailing);
  const instance = useInstance();
  const [busy, setBusy] = useState<"" | "test" | "send">("");
  const [confirm, confirmElement] = useConfirm();
  const load = useCallback(async () => {
    try { setData(await api<Data>("/api/superadmin/mailings", { cache: "no-store" })); setError(""); }
    catch (cause) { setError((cause as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (action: "test" | "send") => {
    if (action === "send") {
      const count = data?.audiences[audience] ?? 0;
      if (!(await confirm({ title: "Skicka utskicket?", message: `”${subject}” skickas som ${AUDIENCE[audience].label.toLowerCase()} till ${count} mottagare. Det går inte att ångra.`, confirmLabel: "Skicka" }))) return;
    }
    setBusy(action);
    try {
      const result = await api<{ to?: string; recipients?: number }>("/api/superadmin/mailings", { method: "POST", body: JSON.stringify({ action, audience, subject, document }) });
      if (action === "test") notify(`Testmejlet är skickat till ${result.to}.`);
      else { notify(`Utskicket köas till ${result.recipients} mottagare och skickas inom några minuter.`); setSubject(""); setDocument(starterMailing()); }
      await load();
    } catch (cause) { notify((cause as Error).message, true); } finally { setBusy(""); }
  };

  if (error) return <Panel title="Utskick"><p role="alert" className="text-sm text-destructive">{error}</p></Panel>;
  if (!data) return <Panel title="Utskick"><p className="text-sm text-muted-foreground">Hämtar…</p></Panel>;
  const problems = mailingProblems(document);
  const ready = subject.trim().length >= 3 && !problems.length;
  const removeMailing = async (row: Row) => {
    if (!(await confirm({ title: "Ta bort utskicket?", message: `”${row.subject}” och dess mottagarlista tas bort ur historiken. Mejlen som redan skickats påverkas inte.`, confirmLabel: "Ta bort", tone: "danger" }))) return;
    try { await api(`/api/superadmin/mailings?id=${encodeURIComponent(row.id)}`, { method: "DELETE" }); notify("Utskicket är borttaget ur historiken."); await load(); }
    catch (cause) { notify((cause as Error).message, true); }
  };
  return <div className="space-y-6">
    {confirmElement}
    <div>
      <h1 className="page-title">Utskick</h1>
      <p className="page-description mt-2">Nyhetsbrev och viktig information till användarna, via installationens e-postserver.</p>
    </div>
    {data.blockedReason ? <div className="notice" role="status"><p>{data.blockedReason}</p></div> : null}
    <Panel title="Nytt utskick" leadingActions={<span className="panel-icon" aria-hidden="true"><Mail className="size-4" /></span>}>
      <fieldset className="grid gap-3 sm:grid-cols-2" data-testid="mailing-audience">
        <legend className="sr-only">Mottagare</legend>
        {(Object.keys(AUDIENCE) as Audience[]).map((key) => <ChoiceCard key={key} name="mailing-audience" value={key} checked={audience === key} onChange={() => setAudience(key)}
          title={AUDIENCE[key].label} badge={`${data.audiences[key]} mottagare`} description={AUDIENCE[key].description} />)}
      </fieldset>
      <label className="mt-4 grid gap-1.5 text-xs font-medium text-muted-foreground">Ämne<Input value={subject} maxLength={150} onChange={(event) => setSubject(event.target.value)} /></label>
      <div className="mt-4"><MailingEditor document={document} onChange={setDocument} name={instance.name} newsletter={audience === "NEWSLETTER"} notify={notify} /></div>
      {problems.length ? <p className="mt-3 text-xs text-muted-foreground" data-testid="mailing-problems">Innan det kan skickas: {problems.join(" ")}</p> : null}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button type="button" variant="outline" disabled={!ready || Boolean(busy) || Boolean(data.blockedReason)} onClick={() => void run("test")}><Mail />{busy === "test" ? "Skickar…" : "Skicka test till mig"}</Button>
        <Button type="button" disabled={!ready || Boolean(busy) || !data.audiences[audience]} onClick={() => void run("send")}><Send />{busy === "send" ? "Köar…" : "Skicka"}</Button>
      </div>
    </Panel>
    <Panel title="Skickade utskick" description={`De senaste tjugo. Ett utskick och dess mottagarlista tas bort av sig självt efter ${data.keptMonths} månader.`}>
      {data.mailings.length ? <ul className="divide-y rounded-lg border text-sm" data-testid="mailing-history">
        {data.mailings.map((item) => <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
          <span className="min-w-0 flex-1 font-medium">{item.subject}</span>
          <span className="text-xs text-muted-foreground">{AUDIENCE[item.audience].label} · {formatSwedish(item.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
          <span className="text-xs" data-testid="mailing-counts">{item.status === "SENT" ? "Klart" : "Skickas"} · {item.sent} skickade{item.pending ? ` · ${item.pending} i kö` : ""}{item.failed ? ` · ${item.failed} misslyckades` : ""}{item.skipped ? ` · ${item.skipped} hoppades över` : ""}</span>
          {item.status === "SENT" ? <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={`Ta bort ${item.subject}`} onClick={() => void removeMailing(item)}><Trash2 /></Button> : null}
        </li>)}
      </ul> : <Empty title="Inga utskick ännu" description="Det du skickar visas här med hur många som fick det." />}
    </Panel>
    <Panel title="Listan över nyhetsbrev" description="De som har sagt ja till mejl om ändringar och förbättringar, när kontot skapades eller under Mina inställningar.">
      <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="newsletter-recipients">
        <span>{data.audiences.NEWSLETTER === 1 ? "1 mottagare" : `${data.audiences.NEWSLETTER} mottagare`}</span>
        <Button asChild variant="outline" size="sm"><a href="/api/newsletter?format=csv" download><Download />Ladda ner listan (CSV)</a></Button>
      </div>
    </Panel>
  </div>;
}
