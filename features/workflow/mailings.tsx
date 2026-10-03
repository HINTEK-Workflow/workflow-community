"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, Panel } from "@/features/kfid/ui";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { formatSwedish } from "@/lib/swedish-time";

type Audience = "NEWSLETTER" | "ADMINS";
type Row = { id: string; subject: string; audience: Audience; status: "QUEUED" | "SENT"; createdAt: string; finishedAt: string | null; sent: number; pending: number; failed: number; skipped: number };
type Data = { audiences: Record<Audience, number>; blockedReason: string | null; mailings: Row[] };

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
  const [text, setText] = useState("");
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
      const result = await api<{ to?: string; recipients?: number }>("/api/superadmin/mailings", { method: "POST", body: JSON.stringify({ action, audience, subject, body: text }) });
      if (action === "test") notify(`Testmejlet är skickat till ${result.to}.`);
      else { notify(`Utskicket köas till ${result.recipients} mottagare och skickas inom några minuter.`); setSubject(""); setText(""); }
      await load();
    } catch (cause) { notify((cause as Error).message, true); } finally { setBusy(""); }
  };

  if (error) return <Panel title="Utskick"><p role="alert" className="text-sm text-destructive">{error}</p></Panel>;
  if (!data) return <Panel title="Utskick"><p className="text-sm text-muted-foreground">Hämtar…</p></Panel>;
  const ready = subject.trim().length >= 3 && text.trim().length >= 10;
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
        {(Object.keys(AUDIENCE) as Audience[]).map((key) => <label key={key} className={`flex cursor-pointer gap-3 rounded-xl border p-4 text-sm ${audience === key ? "border-primary bg-secondary/40" : ""}`}>
          <input type="radio" name="mailing-audience" className="mt-1" checked={audience === key} onChange={() => setAudience(key)} />
          <span><span className="block font-medium">{AUDIENCE[key].label} · {data.audiences[key]} mottagare</span><span className="mt-1 block text-xs text-muted-foreground">{AUDIENCE[key].description}</span></span>
        </label>)}
      </fieldset>
      <label className="mt-4 grid gap-1.5 text-xs font-medium text-muted-foreground">Ämne<Input value={subject} maxLength={150} onChange={(event) => setSubject(event.target.value)} /></label>
      <label className="mt-4 grid gap-1.5 text-xs font-medium text-muted-foreground">Text
        <textarea className="min-h-56 rounded-md border bg-background p-3 text-sm text-foreground" value={text} maxLength={20000} onChange={(event) => setText(event.target.value)}
          placeholder={"Hej!\n\nSkriv här. En tom rad ger ett nytt stycke, och webbadresser blir länkar."} />
      </label>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button type="button" variant="outline" disabled={!ready || Boolean(busy) || Boolean(data.blockedReason)} onClick={() => void run("test")}><Mail />{busy === "test" ? "Skickar…" : "Skicka test till mig"}</Button>
        <Button type="button" disabled={!ready || Boolean(busy) || !data.audiences[audience]} onClick={() => void run("send")}><Send />{busy === "send" ? "Köar…" : "Skicka"}</Button>
      </div>
    </Panel>
    <Panel title="Skickade utskick" description="De senaste tjugo.">
      {data.mailings.length ? <ul className="divide-y rounded-lg border text-sm" data-testid="mailing-history">
        {data.mailings.map((item) => <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
          <span className="min-w-0 flex-1 font-medium">{item.subject}</span>
          <span className="text-xs text-muted-foreground">{AUDIENCE[item.audience].label} · {formatSwedish(item.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
          <span className="text-xs" data-testid="mailing-counts">{item.status === "SENT" ? "Klart" : "Skickas"} · {item.sent} skickade{item.pending ? ` · ${item.pending} i kö` : ""}{item.failed ? ` · ${item.failed} misslyckades` : ""}{item.skipped ? ` · ${item.skipped} hoppades över` : ""}</span>
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
