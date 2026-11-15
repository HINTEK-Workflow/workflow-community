"use client";

import { useCallback, useState } from "react";
import { Mail, Save, Send, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { Panel } from "@/features/kfid/ui";
import { SecretField } from "@/features/kfid/secret-field";
import { KeyCardActions, KeyFields, KeySection, KeyTextField, useKeyCardPart } from "@/features/integrations/key-card";
import type { PublicMailSettings } from "@/lib/mail/settings";
import { useLoadEffect } from "@/lib/use-load-effect";

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
  notices: settings.notices,
  alertEmail: settings.alertEmail,
  password: "",
  clearPassword: false,
});

const field = "grid gap-1.5 text-xs font-medium text-muted-foreground";

/**
 * E-post (2026-09-30): the superadmin sets the installation's SMTP server, sender and which mail is sent here
 * instead of in the server's .env. The password is only written; the page shows whether one is saved. Since 2026-10-15
 * the first part of Installation → E-post och utskick. C6 (2026-10-21): every value in one place –
 * `part="server"` is the e-mail server's details, drawn inside the E-post card on Tjänster och nycklar (`bare`, the card
 * has the header), with Spara and the test mail; `part="delivery"` is which mails are sent, a card on Drift och säkerhet.
 * Both read and save the same settings, each sending back what it showed.
 */
export function MailSettings({ notify, part, bare = false }: { notify: (text: string, error?: boolean) => void; part: "server" | "delivery"; bare?: boolean }) {
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
  useLoadEffect(load);
  // Inside the e-mail card on Tjänster och nycklar (2026-11-11) the card's one Spara saves the server's details.
  const dirty = Boolean(settings && form && JSON.stringify(form) !== JSON.stringify(toForm(settings)));
  const inCard = useKeyCardPart(part === "server" && dirty, () => save());

  const waiting = (text: React.ReactNode) => bare ? <div className="sm:col-span-2">{text}</div> : <Panel icon={part === "server" ? Mail : MailCheck} title={part === "server" ? "Utgående e-post (SMTP)" : "Automatisk e-post"}>{text}</Panel>;
  if (error) return waiting(<p role="alert" className="text-sm text-destructive">{error}</p>);
  if (!settings || !form) return waiting(<p className="text-sm text-muted-foreground">Hämtar inställningarna…</p>);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => current && { ...current, [key]: value });

  async function save() {
    if (!form) return false;
    setBusy("save");
    try {
      const { password, clearPassword, ...rest } = form;
      const next = await api<PublicMailSettings>("/api/superadmin/mail-settings", {
        method: "PUT",
        body: JSON.stringify({ ...rest, ...(password ? { password } : {}), clearPassword }),
      });
      setSettings(next); setForm(toForm(next)); notify("E-postinställningarna är sparade.");
      return true;
    } catch (cause) { notify((cause as Error).message, true); return false; } finally { setBusy(""); }
  }
  const test = async () => {
    setBusy("test");
    try {
      const result = await api<{ to: string }>("/api/superadmin/mail-settings", { method: "POST", body: "{}" });
      notify(`Testmejlet är skickat till ${result.to}.`);
    } catch (cause) { notify((cause as Error).message, true); } finally { setBusy(""); }
  };

  const saveButton = <Button onClick={() => void save()} disabled={Boolean(busy)} data-testid="mail-settings-save" busy={busy === "save"} busyLabel="Sparar…"><Save />Spara</Button>;
  if (part === "delivery") return <Panel icon={MailCheck} title="Automatisk e-post" description="Lösenordsåterställning och verifiering skickas alltid. Det här styr övrig e-post.">
    <div className="space-y-3" data-testid="mail-delivery">
      <label className="flex items-start gap-3 text-sm"><Checkbox className="mt-0.5" checked={form.invitations} onCheckedChange={(value) => set("invitations", value === true)} />
        <span><span className="font-medium">Inbjudningar</span><span className="block text-muted-foreground">Nya medlemmar får en inbjudan med länk.</span></span></label>
      <label className="flex items-start gap-3 text-sm"><Checkbox className="mt-0.5" checked={form.roundReminders} onCheckedChange={(value) => set("roundReminders", value === true)} />
        <span><span className="font-medium">Påminnelser om driftronder</span><span className="block text-muted-foreground">Skickas på morgonen den dag en rond ska göras.</span></span></label>
      <label className="flex items-start gap-3 text-sm"><Checkbox className="mt-0.5" checked={form.notices} onCheckedChange={(value) => set("notices", value === true)} data-testid="notices-switch" />
        <span><span className="font-medium">Notiser till dem som valt det</span><span className="block text-muted-foreground">Klockans påminnelser som e-post, bara till dem som själva slagit på det under Mina inställningar → Notiser. Ett samlat meddelande, aldrig mer än en gång per notis.</span></span></label>
      <label className="flex items-start gap-3 text-sm"><Checkbox className="mt-0.5" checked={form.alerts} onCheckedChange={(value) => set("alerts", value === true)} />
        <span><span className="font-medium">Driftlarm</span><span className="block text-muted-foreground">Drift, backup, servrar och nycklar som behöver åtgärd.</span></span></label>
      {form.alerts ? <label className={`${field} max-w-md`}>Mottagare av driftlarm<Input type="email" value={form.alertEmail} onChange={(event) => set("alertEmail", event.target.value)} /></label> : null}
      <div className="pt-1">{saveButton}</div>
    </div>
  </Panel>;

  const testButton = <Button variant="outline" onClick={() => void test()} disabled={Boolean(busy) || Boolean(settings.blockedReason)} busy={busy === "test"} busyLabel="Skickar…" title="Med de sparade inställningarna.">
    {busy === "test" ? <Mail /> : <Send />}Skicka testmejl till mig
  </Button>;
  const server = <div className="@container space-y-3" data-testid="mail-settings-server">
    {settings.blockedReason ? <div className="notice" role="status"><p>{settings.blockedReason}</p></div> : null}
    <KeyFields>
      <KeyTextField id="smtp-user" label="Användarnamn" value={form.user} onChange={(value) => set("user", value)} removeLabel="Töm användarnamnet" />
      <SecretField keepBin id="smtp-password" label="Lösenord" autoComplete="new-password" value={form.password}
        onChange={(text) => { set("password", text); set("clearPassword", false); }}
        stored={settings.hasPassword} removed={form.clearPassword} placeholder="Inget lösenord" removeLabel="Ta bort lösenordet"
        onRemove={() => { set("password", ""); set("clearPassword", true); }} onUndo={() => set("clearPassword", false)} />
    </KeyFields>
    <KeySection>
      <div className="grid gap-3 @xl:grid-cols-2">
        <KeyTextField id="smtp-host" label="Server" value={form.host} placeholder="smtp.exempel.se" onChange={(value) => set("host", value)} removeLabel="Töm servern" />
        <div className="grid grid-cols-2 gap-3">
          <label className={field}>Port<Input type="number" min={1} max={65535} value={form.port} onChange={(event) => set("port", Number(event.target.value) || 0)} /></label>
          <label className={field}>Kryptering<select className="form-select" aria-label="Kryptering" value={form.secure ? "ssl" : "starttls"} onChange={(event) => set("secure", event.target.value === "ssl")}>
            <option value="starttls">STARTTLS (oftast port 587)</option>
            <option value="ssl">SSL/TLS (oftast port 465)</option>
          </select></label>
        </div>
        <KeyTextField id="smtp-from-name" label="Avsändarens namn" value={form.fromName} onChange={(value) => set("fromName", value)} removeLabel="Töm namnet" />
        <KeyTextField id="smtp-from-address" label="Avsändarens e-postadress" type="email" value={form.fromAddress} onChange={(value) => set("fromAddress", value)} removeLabel="Töm adressen" />
      </div>
    </KeySection>
    {/* In a key card the test stands in the card's one action row, after Spara (2026-11-12). */}
    {inCard ? <KeyCardActions>{testButton}</KeyCardActions> : <div className="flex flex-wrap gap-3">{saveButton}{testButton}</div>}
  </div>;
  return bare ? <div className="sm:col-span-2">{server}</div>
    : <Panel icon={Mail} title="Utgående e-post (SMTP)" description="Uppgifterna får du av e-postleverantören. Lösenordet sparas krypterat.">{server}</Panel>;
}

/** Nyhetsutskick (2026-10-03): how many said yes when they created their account or in Mina inställningar, and the list. */
