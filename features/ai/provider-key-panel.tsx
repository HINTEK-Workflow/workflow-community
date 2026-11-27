"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, KeyRound, LoaderCircle, Save, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, SwitchRow } from "@/features/kfid/ui";
import { KeySection, useKeyCardPart } from "@/features/integrations/key-card";
import { SecretField } from "@/features/kfid/secret-field";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { cn } from "@/lib/utils";
import { useLoadEffect } from "@/lib/use-load-effect";

type View = {
  enabled: boolean; dpaApproved: boolean; evalApproved: boolean;
  source: "app" | "server"; keySource: "app" | "server" | "none"; keyHint: string | null; keyUnreadable: boolean;
  updatedAt: string | null; updatedBy: string | null;
};
type Form = Pick<View, "enabled" | "dpaApproved" | "evalApproved">;

/**
 * Workflow AI:s leverantör i appen (2026-10-03: "jag vill kunna sköta detta från Workflow"): the OpenAI key and the
 * switches that turn Workflow AI on, for the superadmin. Community only since 2026-11-21 (F11): Cloud runs on Azure alone. The key is a SecretField (2026-10-07): label above,
 * field and buttons in one row, the explanation under it; dots when a key exists and a bin that removes it.
 *
 * One Kontrollera (2026-10-24, answer 5): inside the OpenAI card (`bindCheck`) the field has no button of its own –
 * the card's Kontrollera checks the key typed in the field when a new one is there, else the saved one (the card's own
 * server check). The key is never shown in clear text.
 */
export function ProviderKeyPanel({ onChanged, bare = false, enabled: switchedOn, bindCheck }: { onChanged?: () => void; bare?: boolean;
  /** The OpenAI card's switch in its header (2026-10-17) owns "Workflow AI på/av": its state, so it is asked once. */
  enabled?: boolean;
  /** The card's Kontrollera takes over the typed key's check while a new key is in the field (null: the saved key). */
  bindCheck?: (handler: (() => Promise<void>) | null) => void }) {
  const [view, setView] = useState<View | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"save" | "check" | "clear" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const apply = (next: View) => { setView(next); setForm({ enabled: next.enabled, dpaApproved: next.dpaApproved, evalApproved: next.evalApproved }); };
  const load = useCallback(async () => {
    try { apply(await api<View>("/api/superadmin/ai-provider", { cache: "no-store" })); }
    catch (cause) { setMessage({ ok: false, text: (cause as Error).message }); }
  }, []);
  useLoadEffect(load);
  const send = async (kind: "save" | "check" | "clear", payload: unknown) => {
    setBusy(kind); setMessage(null);
    try { return await api<View & { ok?: boolean; message?: string }>("/api/superadmin/ai-provider", { method: "POST", body: JSON.stringify(payload) }); }
    catch (cause) { setMessage({ ok: false, text: (cause as Error).message }); return null; }
    finally { setBusy(null); }
  };
  const check = async () => {
    const result = await send("check", { action: "check", apiKey: apiKey.trim() || undefined });
    if (result) setMessage({ ok: Boolean(result.ok), text: result.message ?? "" });
  };
  const typed = Boolean(apiKey.trim());
  // Inside the OpenAI card (2026-11-11) the card's one Spara saves the key and the choices; alone the panel keeps its own.
  const formDirty = Boolean(view && form && (form.dpaApproved !== view.dpaApproved || form.evalApproved !== view.evalApproved || (switchedOn === undefined && form.enabled !== view.enabled)));
  const inCard = useKeyCardPart(typed || formDirty, async () => { if (!form) return false; return save(); });
  // Registered anew after every render, so the card always calls the latest field value; nothing here sets state.
  useEffect(() => {
    if (!bindCheck) return;
    bindCheck(typed ? check : null);
    return () => bindCheck(null);
  });
  if (!view || !form) { const waiting = <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Hämtar…</p>; return bare ? <div className="sm:col-span-2">{waiting}</div> : <Panel icon={KeyRound} title="Workflow AI:s leverantör">{waiting}</Panel>; }

  const hasKey = view.keySource !== "none" || Boolean(apiKey.trim());
  const missing = [
    !(switchedOn ?? form.enabled) && "AI är inte påslaget",
    !hasKey && "nyckel saknas",
    !form.dpaApproved && "avtalet är inte bekräftat",
    !form.evalApproved && "provsviten är inte godkänd",
  ].filter(Boolean) as string[];
  async function save() {
    if (!form) return false;
    const result = await send("save", { action: "save", settings: { ...form, enabled: switchedOn ?? form.enabled, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) } });
    if (result) { apply(result); setApiKey(""); setMessage({ ok: true, text: "Sparat. Ändringen gäller för alla företag inom 15 sekunder." }); onChanged?.(); }
    return Boolean(result);
  }
  const clear = async () => {
    if (!(await confirm({ title: "Ta bort nyckeln?", message: "Workflow AI slutar svara tills en ny nyckel läggs in.", confirmLabel: "Ta bort", tone: "danger" }))) return;
    const result = await send("clear", { action: "clear_key" });
    if (result) { apply(result); setMessage({ ok: true, text: "Nyckeln är borttagen." }); onChanged?.(); }
  };
  // Ja/nej as switches (2026-11-11); saved with Spara like the key.
  const toggle = (key: keyof Form, label: string, help: string) => <SwitchRow id={`openai-${key}`} title={label} text={help} checked={Boolean(form[key])} onCheckedChange={(value) => setForm({ ...form, [key]: value })} testId={`openai-${key}`} />;

  // C6 (2026-10-21): the OpenAI key in one place – inside the OpenAI card on Tjänster och nycklar (bare: the card has the header).
  const frame = (children: React.ReactNode) => bare ? <div className="sm:col-span-2">{children}</div> : <Panel title="Workflow AI:s leverantör" description="Slå på AI och lägg in nyckeln till er AI-leverantör. Det gäller för alla företag i installationen."
    icon={KeyRound}>{children}</Panel>;
  return frame(<>

    <div className="space-y-3" data-testid="ai-provider-key">
      {/* Bara när något stoppar AI (2026-11-01); det som står rätt behöver inte sägas. */}
      {missing.length ? <p className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200" data-testid="ai-provider-state">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        <span>{`Workflow AI är av: ${missing.join(", ")}.`}</span>
      </p> : null}
      <SecretField keepBin id="openai-key" label="OpenAI-nyckel" ariaLabel="Ny OpenAI-nyckel" mono value={apiKey} onChange={setApiKey} stored={view.keySource !== "none"}
        tail={view.keySource === "app" ? view.keyHint?.slice(-4) : undefined} placeholder="sk-…" busy={Boolean(busy)} removeLabel="Ta bort nyckeln" onRemove={view.keySource === "app" ? () => void clear() : undefined}
        actions={bindCheck ? undefined : <Button type="button" variant="outline" disabled={Boolean(busy) || (!apiKey.trim() && view.keySource === "none")} onClick={() => void check()}>{busy === "check" ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}Kontrollera nyckeln</Button>}
        hint={view.keyUnreadable ? "Den sparade nyckeln kan inte läsas. Lägg in den igen." : undefined} />
      <KeySection>
        <div className="grid">
          {switchedOn !== undefined ? null : toggle("enabled", "Slå på Workflow AI", "Av: inget skickas till OpenAI.")}
          {toggle("dpaApproved", "OpenAI:s avtal är godkänt", "Personuppgiftsbiträdesavtalet och rättslig grund.")}
          {toggle("evalApproved", "Provsviten är godkänd", "Körd lokalt med påhittade uppgifter.")}
          {/* Bara Azure räknas som EU (2026-11-01); since 2026-11-21 only its EU-verified models. */}
          <p className="text-xs text-muted-foreground" data-testid="ai-provider-not-eu">OpenAI räknas inte som behandling i EU. Företag som kräver EU kör bara på EU-verifierade Azure-modeller.</p>
        </div>
      </KeySection>

      {message ? <p role={message.ok ? "status" : "alert"} className={cn("text-sm", message.ok ? "text-emerald-700 dark:text-emerald-300" : "text-destructive")}>{message.text}</p> : null}
      {inCard ? null : <Button type="button" className="mobile-form-action" disabled={Boolean(busy)} onClick={() => void save()} data-testid="ai-provider-save">{busy === "save" ? <LoaderCircle className="animate-spin" /> : <Save />}Spara</Button>}
    </div>
    {confirmElement}
  </>);

}
