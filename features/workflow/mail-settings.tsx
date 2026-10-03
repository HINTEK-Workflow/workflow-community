"use client";

import { useCallback, useEffect, useState } from "react";
import { Mail, RotateCcw, Save, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { Panel } from "@/features/kfid/ui";
import type { PublicMailSettings } from "@/lib/mail/settings";

type Form = Omit<PublicMailSettings, "source" | "hasPassword" | "blockedReason"> & { password: string; clearPassword: boolean };

const toForm = (settings: PublicMailSettings): Form => ({
  host: settings.host === "localhost" && settings.source === "server" ? "" : settings.host,
  port: settings.port,
  secure: settings.secure,
  user: settings.user,
  fromName: settings.fromName,
  fromAddress: settings.fromAddress,
  invitations: settings.invitations,
  roundReminders: settings.roundReminders,
  alerts: settings.alerts,
  alertEmail: settings.alertEmail,
  password: "",
  clearPassword: false,
});

const field = "grid gap-1.5 text-xs font-medium text-muted-foreground";

/**
 * E-post (2026-09-30): the superadmin sets the installation's SMTP server, sender and which mail is sent here
 * instead of in the server's .env. The password is only written; the page shows whether one is saved.
 */
export function MailSettings({ notify }: { notify: (text: string, error?: boolean) => void }) {
  const [settings, setSettings] = useState<PublicMailSettings | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "test">("");
  const load = useCallback(async () => {
    try {
      const next = await api<PublicMailSettings>("/api/superadmin/mail-settings", { cache: "no-store" });
      setSettings(next); setForm(toForm(next)); setError("");
    } catch (cause) { setError((cause as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (error) return <Panel title="E-post"><p role="alert" className="text-sm text-destructive">{error}</p></Panel>;
  if (!settings || !form) return <Panel title="E-post"><p className="text-sm text-muted-foreground">Hämtar inställningarna…</p></Panel>;
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => current && { ...current, [key]: value });

  const save = async () => {
    setBusy("save");
    try {
      const { password, clearPassword, ...rest } = form;
      const next = await api<PublicMailSettings>("/api/superadmin/mail-settings", {
        method: "PUT",
        body: JSON.stringify({ ...rest, ...(password ? { password } : {}), clearPassword }),
      });
      setSettings(next); setForm(toForm(next)); notify("E-postinställningarna är sparade.");
    } catch (cause) { notify((cause as Error).message, true); } finally { setBusy(""); }
  };
  const test = async () => {
    setBusy("test");
    try {
      const result = await api<{ to: string }>("/api/superadmin/mail-settings", { method: "POST", body: "{}" });
      notify(`Testmejlet är skickat till ${result.to}.`);
    } catch (cause) { notify((cause as Error).message, true); } finally { setBusy(""); }
  };

  return <div className="space-y-6">
    <div>
      <h1 className="page-title">E-post</h1>
      <p className="page-description mt-2">Servern som skickar e-post, avsändaren och vilka utskick som är påslagna.</p>
    </div>
    {settings.blockedReason ? <div className="notice" role="status"><p>{settings.blockedReason}</p></div> : null}

    <Panel title="Utgående e-post (SMTP)" description="Uppgifterna finns hos din e-postleverantör. Lösenordet sparas krypterat och visas aldrig igen.">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={field}>Server<Input value={form.host} placeholder="smtp.exempel.se" autoComplete="off" onChange={(event) => set("host", event.target.value)} /></label>
        <div className="grid grid-cols-2 gap-4">
          <label className={field}>Port<Input type="number" min={1} max={65535} value={form.port} onChange={(event) => set("port", Number(event.target.value) || 0)} /></label>
          <label className={field}>Kryptering<select className="form-select" aria-label="Kryptering" value={form.secure ? "ssl" : "starttls"} onChange={(event) => set("secure", event.target.value === "ssl")}>
            <option value="starttls">STARTTLS (oftast port 587)</option>
            <option value="ssl">SSL/TLS (oftast port 465)</option>
          </select></label>
        </div>
        <label className={field}>Användarnamn<Input value={form.user} autoComplete="off" onChange={(event) => set("user", event.target.value)} /></label>
        <div className={field}>
          <label htmlFor="smtp-password">Lösenord</label>
          <div className="flex gap-2">
            <Input id="smtp-password" type="password" value={form.password} autoComplete="new-password"
              placeholder={form.clearPassword ? "Tas bort när du sparar" : settings.hasPassword ? "••••••••••" : "Inget lösenord"}
              onChange={(event) => { set("password", event.target.value); set("clearPassword", false); }} />
            {settings.hasPassword ? (form.clearPassword
              ? <Button type="button" variant="outline" className="shrink-0" onClick={() => set("clearPassword", false)}><RotateCcw />Ångra</Button>
              : <Button type="button" variant="outline" size="icon" className="size-10 shrink-0" aria-label="Ta bort lösenordet" title="Ta bort lösenordet"
                  onClick={() => { set("password", ""); set("clearPassword", true); }}><Trash2 /></Button>) : null}
          </div>
        </div>
        <label className={field}>Avsändarens namn<Input value={form.fromName} onChange={(event) => set("fromName", event.target.value)} /></label>
        <label className={field}>Avsändarens e-postadress<Input type="email" value={form.fromAddress} onChange={(event) => set("fromAddress", event.target.value)} /></label>
      </div>
    </Panel>

    <Panel title="Utskick" description="Lösenordsåterställning och verifiering av e-post skickas alltid. Det här styr övriga utskick.">
      <div className="space-y-3">
        <label className="flex items-start gap-3 text-sm"><Checkbox className="mt-0.5" checked={form.invitations} onCheckedChange={(value) => set("invitations", value === true)} />
          <span><span className="font-medium">Inbjudningar</span><span className="block text-muted-foreground">Nya medlemmar får en inbjudan med länk.</span></span></label>
        <label className="flex items-start gap-3 text-sm"><Checkbox className="mt-0.5" checked={form.roundReminders} onCheckedChange={(value) => set("roundReminders", value === true)} />
          <span><span className="font-medium">Påminnelser om driftronder</span><span className="block text-muted-foreground">Skickas på morgonen den dag en rond ska göras.</span></span></label>
        <label className="flex items-start gap-3 text-sm"><Checkbox className="mt-0.5" checked={form.alerts} onCheckedChange={(value) => set("alerts", value === true)} />
          <span><span className="font-medium">Driftlarm</span><span className="block text-muted-foreground">När backup eller övervakning larmar.</span></span></label>
        {form.alerts ? <label className={`${field} max-w-md`}>Mottagare av driftlarm<Input type="email" value={form.alertEmail} onChange={(event) => set("alertEmail", event.target.value)} /></label> : null}
      </div>
    </Panel>

    <div className="flex flex-wrap gap-3">
      <Button onClick={() => void save()} disabled={Boolean(busy)}><Save />{busy === "save" ? "Sparar…" : "Spara"}</Button>
      <Button variant="outline" onClick={() => void test()} disabled={Boolean(busy) || Boolean(settings.blockedReason)}>
        {busy === "test" ? <Mail /> : <Send />}{busy === "test" ? "Skickar…" : "Skicka testmejl till mig"}
      </Button>
    </div>
    <p className="text-xs text-muted-foreground">Testmejlet skickas med de sparade inställningarna. Spara först om du har ändrat något.</p>
    <Newsletter />
  </div>;
}

/** Nyhetsutskick (2026-10-03): how many said yes when they created their account or in Mina inställningar, and the list. */
function Newsletter() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => { void api<{ count: number }>("/api/newsletter").then((result) => setCount(result.count)).catch(() => setCount(null)); }, []);
  return <Panel title="Nyhetsutskick" description="De som sagt ja till mejl om ändringar och förbättringar i Workflow, när kontot skapades eller under Mina inställningar.">
    <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="newsletter-recipients">
      <span>{count === null ? "Hämtar…" : count === 1 ? "1 mottagare" : `${count} mottagare`}</span>
      <Button asChild variant="outline" size="sm"><a href="/api/newsletter?format=csv" download>Ladda ner listan (CSV)</a></Button>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">Skicka bara till dem på listan, och ta med hur man avböjer (Mina inställningar → Nyheter i Workflow).</p>
  </Panel>;
}
