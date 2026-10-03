"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, KeyRound, LoaderCircle, Save, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Panel } from "@/features/kfid/ui";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { cn } from "@/lib/utils";

type View = {
  enabled: boolean; dpaApproved: boolean; evalApproved: boolean; region: "GLOBAL" | "EU"; euControlsApproved: boolean;
  source: "app" | "server"; keySource: "app" | "server" | "none"; keyHint: string | null; keyUnreadable: boolean;
  updatedAt: string | null; updatedBy: string | null;
};
type Form = Pick<View, "enabled" | "dpaApproved" | "evalApproved" | "region" | "euControlsApproved">;

const when = (value: string | null) => (value ? new Date(value).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", dateStyle: "short", timeStyle: "short" }) : "");

/**
 * Workflow AI:s leverantör i appen (2026-10-03: "jag vill kunna sköta detta från Workflow"): the OpenAI key and the
 * switches that turn Workflow AI on, for HINTEK's superadmin. Saved here wins over the server's .env.
 */
export function ProviderKeyPanel({ onChanged }: { onChanged?: () => void }) {
  const [view, setView] = useState<View | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"save" | "check" | "clear" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const apply = (next: View) => { setView(next); setForm({ enabled: next.enabled, dpaApproved: next.dpaApproved, evalApproved: next.evalApproved, region: next.region, euControlsApproved: next.euControlsApproved }); };
  const load = useCallback(async () => {
    try { apply(await api<View>("/api/superadmin/ai-provider", { cache: "no-store" })); }
    catch (cause) { setMessage({ ok: false, text: (cause as Error).message }); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!view || !form) return <Panel title="Workflow AI:s leverantör"><p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Hämtar…</p></Panel>;

  const hasKey = view.keySource !== "none" || Boolean(apiKey.trim());
  const missing = [
    !form.enabled && "AI är inte påslaget",
    !hasKey && "nyckel saknas",
    !form.dpaApproved && "avtalet är inte bekräftat",
    !form.evalApproved && "provsviten är inte godkänd",
    form.region === "EU" && !form.euControlsApproved && "EU-kontrollerna är inte bekräftade",
  ].filter(Boolean) as string[];
  const send = async (kind: "save" | "check" | "clear", payload: unknown) => {
    setBusy(kind); setMessage(null);
    try { return await api<View & { ok?: boolean; message?: string }>("/api/superadmin/ai-provider", { method: "POST", body: JSON.stringify(payload) }); }
    catch (cause) { setMessage({ ok: false, text: (cause as Error).message }); return null; }
    finally { setBusy(null); }
  };
  const save = async () => {
    const result = await send("save", { action: "save", settings: { ...form, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) } });
    if (result) { apply(result); setApiKey(""); setMessage({ ok: true, text: "Sparat. Ändringen gäller för alla företag inom 15 sekunder." }); onChanged?.(); }
  };
  const check = async () => {
    const result = await send("check", { action: "check", apiKey: apiKey.trim() || undefined, region: form.region });
    if (result) setMessage({ ok: Boolean(result.ok), text: result.message ?? "" });
  };
  const clear = async () => {
    if (!(await confirm({ title: "Ta bort nyckeln?", message: "Workflow AI slutar svara tills en ny nyckel läggs in (om ingen nyckel finns i serverns .env).", confirmLabel: "Ta bort", tone: "danger" }))) return;
    const result = await send("clear", { action: "clear_key" });
    if (result) { apply(result); setMessage({ ok: true, text: "Nyckeln är borttagen." }); onChanged?.(); }
  };
  const toggle = (key: keyof Form, label: string, help: string) => <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
    <Checkbox className="mt-0.5" checked={Boolean(form[key])} onCheckedChange={(value) => setForm({ ...form, [key]: value === true })} />
    <span><span className="block font-medium">{label}</span><span className="block text-xs text-muted-foreground">{help}</span></span>
  </label>;

  return <Panel title="Workflow AI:s leverantör" description="Slå på AI och lägg in OpenAI-nyckeln här. Det du sparar gäller före serverns .env, för alla företag."
    leadingActions={<span className="panel-icon" aria-hidden="true"><KeyRound className="size-4" /></span>}>
    <div className="space-y-4" data-testid="ai-provider-key">
      <p className={cn("flex items-start gap-2 rounded-lg border p-3 text-sm", missing.length ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100" : "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100")} data-testid="ai-provider-state">
        {missing.length ? <ShieldCheck className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}
        <span>{missing.length ? `Workflow AI är av: ${missing.join(", ")}.` : "Workflow AI är påslaget när du har sparat."}{view.updatedAt ? <span className="block text-xs opacity-80">Senast ändrat {when(view.updatedAt)} av {view.updatedBy}.</span> : <span className="block text-xs opacity-80">Inget sparat i appen ännu – serverns .env gäller.</span>}</span>
      </p>

      <div className="rounded-lg border p-3">
        <p className="text-sm font-medium">OpenAI-nyckel</p>
        <p className="mt-1 text-xs text-muted-foreground">{view.keySource === "app" ? `Sparad i appen: ${view.keyHint}` : view.keySource === "server" ? "Ingen nyckel sparad i appen; nyckeln i serverns .env används." : "Ingen nyckel finns ännu."}{view.keyUnreadable ? " Den sparade nyckeln kan inte läsas (serverns hemlighet har ändrats) – lägg in den igen." : ""}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={view.keySource === "app" ? "Klistra in en ny nyckel för att byta" : "sk-…"} aria-label="Ny OpenAI-nyckel" className="min-w-0 flex-1 basis-64 font-mono" />
          <Button type="button" variant="outline" disabled={Boolean(busy) || (!apiKey.trim() && view.keySource === "none")} onClick={() => void check()}>{busy === "check" ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}Kontrollera nyckeln</Button>
          {view.keySource === "app" ? <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => void clear()}><Trash2 />Ta bort</Button> : null}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Skapa nyckeln på platform.openai.com → API keys (en egen för produktionen) och sätt ett kostnadstak där. Nyckeln sparas krypterad och visas aldrig igen, bara de fyra sista tecknen.</p>
      </div>

      <div className="grid gap-2">
        {toggle("enabled", "Slå på Workflow AI", "Företag som själva har slagit på AI får då svar från AI-modellen. Av betyder att inget skickas till OpenAI.")}
        {toggle("dpaApproved", "OpenAI:s avtal är godkänt", "Jag har godkänt OpenAI:s personuppgiftsbiträdesavtal (DPA) och har rättslig grund för behandlingen.")}
        {toggle("evalApproved", "Provsviten är godkänd", "Den syntetiska provsviten har körts mot OpenAI (lokalt, med påhittade uppgifter) och svaren är godkända.")}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
          <span className="font-medium">Var OpenAI behandlar uppgifterna</span>
          <select className="form-select w-auto" value={form.region} onChange={(event) => setForm({ ...form, region: event.target.value as Form["region"] })} aria-label="Var OpenAI behandlar uppgifterna">
            <option value="GLOBAL">Globalt (standard)</option>
            <option value="EU">EU (kräver ett EU-projekt hos OpenAI)</option>
          </select>
        </div>
        {form.region === "EU" ? toggle("euControlsApproved", "EU-kontrollerna är bekräftade", "OpenAI-projektet är ett EU-projekt med datalagring och behandling i EU.") : null}
      </div>

      {message ? <p role={message.ok ? "status" : "alert"} className={cn("text-sm", message.ok ? "text-emerald-700 dark:text-emerald-300" : "text-destructive")}>{message.text}</p> : null}
      <Button type="button" className="mobile-form-action" disabled={Boolean(busy)} onClick={() => void save()} data-testid="ai-provider-save">{busy === "save" ? <LoaderCircle className="animate-spin" /> : <Save />}Spara</Button>
    </div>
    {confirmElement}
  </Panel>;
}
