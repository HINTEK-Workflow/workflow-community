"use client";

import { useCallback, useState } from "react";
import { Globe2, LoaderCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, SwitchRow } from "@/features/kfid/ui";
import { KEY_STATUS, KeyCard, KeyFields, KeyTextField, type KeyCardStatus } from "@/features/integrations/key-card";
import { useServerKeySectionStatus } from "@/features/integrations/server-key-status";
import { SecretField } from "@/features/kfid/secret-field";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { cn } from "@/lib/utils";
import { useLoadEffect } from "@/lib/use-load-effect";
import { AZURE_ROUTE_MODELS, type AzureModelInfo, type AzurePreset, type AzureRouteModel } from "@/lib/ai/azure-settings";
import { AzureModelCards } from "@/features/ai/azure-model-cards";
import { fromModelForm, modelCardsFor, toModelForm, type AzureModelForm } from "@/features/ai/azure-model-form";

type View = {
  enabled: boolean; endpoint: string; deployments: Record<AzureRouteModel, string>; euConfirmed: boolean; dpaApproved: boolean;
  models: AzureModelInfo[]; preset: AzurePreset | null;
  hasKey: boolean; keyHint: string | null; keyUnreadable: boolean; problem: string | null; updatedAt: string | null; updatedBy: string | null;
};
/** What a check or a trial question answered: Azure's text, the model, the tokens – never the key. */
type ProbeResult = { ok: boolean; message: string; answer: string; model: string; deployment: string; usage?: { inputTokens: number; cachedInputTokens: number; outputTokens: number }; ms?: number; priced?: boolean };
type Form = Pick<View, "enabled" | "endpoint" | "deployments" | "euConfirmed" | "dpaApproved"> & { models: AzureModelForm[] };

const MODEL_LABEL: Record<AzureRouteModel, string> = { "gpt-5.6-luna": "Enkla svar (luna)", "gpt-5.6-terra": "Dokument och förslag (terra)", "gpt-5.6-sol": "Granskning (sol)" };
const when = (value: string | null) => (value ? new Date(value).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", dateStyle: "short", timeStyle: "short" }) : "");

/**
 * EU-leverantören (2026-10-19): Azure OpenAI is the second AI provider, used only for companies that require processing in
 * the EU. The superadmin gives the resource address, the key and the deployment names and confirms that the resource is in the
 * EU and that the agreement is in place. Nothing is on until all of it is; a company that requires the EU never gets another provider.
 */
export function AzureProviderPanel({ notify }: { notify?: (text: string, error?: boolean) => void } = {}) {
  const [view, setView] = useState<View | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [apiKey, setApiKey] = useState("");
  // The bin marks the key for removal until the card is saved (2026-11-11).
  const [removeKey, setRemoveKey] = useState(false);
  const [busy, setBusy] = useState<"save" | "check" | "clear" | "probe" | null>(null);
  const [question, setQuestion] = useState("Svara kort på svenska: vad är 2 + 2?");
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [checked, setChecked] = useState<boolean | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const apply = (next: View) => { setView(next); setForm({ enabled: next.enabled, endpoint: next.endpoint, deployments: next.deployments, euConfirmed: next.euConfirmed, dpaApproved: next.dpaApproved, models: (next.models ?? []).map(toModelForm) }); };
  const load = useCallback(async () => {
    try { apply(await api<View>("/api/superadmin/ai-azure", { cache: "no-store" })); }
    catch (cause) { setMessage({ ok: false, text: (cause as Error).message }); }
  }, []);
  useLoadEffect(load);
  // One status (2026-11-01): Fungerar after a check answered here; Fel when it is switched on and cannot be used.
  const blocker = view?.problem ?? null;
  const status: KeyCardStatus | null = !view ? null : !view.hasKey ? KEY_STATUS.missing
    : checked === false ? { ...KEY_STATUS.failed, problem: message?.text ?? null }
    : blocker ? { ...(view.enabled ? KEY_STATUS.failed : KEY_STATUS.untested), problem: `EU-leverantören är inte klar: ${blocker}` }
    : checked ? KEY_STATUS.works : KEY_STATUS.untested;
  // Slå på EU-leverantören in the page's overview (2026-11-11): saved at once with the saved values; the server refuses it until all is in place.
  const toggle = view ? {
    label: "EU-leverantören", on: view.enabled, disabledReason: view.hasKey ? null : "Lägg in nyckeln först.",
    onChange: async (on: boolean) => {
      setBusy("save");
      try {
        const next = await api<View>("/api/superadmin/ai-azure", { method: "POST", body: JSON.stringify({ action: "save", settings: { enabled: on, endpoint: view.endpoint, deployments: view.deployments, euConfirmed: view.euConfirmed, dpaApproved: view.dpaApproved } }) });
        setView(next); setForm((current) => current && { ...current, enabled: next.enabled });
        notify?.(on ? "EU-leverantören är påslagen." : "EU-leverantören är avstängd.");
        return true;
      } catch (cause) { notify?.((cause as Error).message, true); return false; } finally { setBusy(null); }
    },
  } : undefined;
  useServerKeySectionStatus("azure", status ? { label: status.label, tone: status.tone, detail: status.problem ?? undefined, name: "EU-leverantör (Azure OpenAI)", toggle } : null);
  if (!view || !form) return <KeyCard icon={Globe2} title="EU-leverantör (Azure OpenAI)" status={null} saveable><p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Hämtar…</p></KeyCard>;

  const send = async (kind: "save" | "check" | "clear" | "probe", payload: unknown) => {
    setBusy(kind); setMessage(null);
    try { return await api<View & Partial<ProbeResult>>("/api/superadmin/ai-azure", { method: "POST", body: JSON.stringify(payload) }); }
    catch (cause) { setMessage({ ok: false, text: (cause as Error).message }); return null; }
    finally { setBusy(null); }
  };
  const cards = modelCardsFor(form.deployments, form.models, view.preset);
  const setCard = (next: AzureModelForm) => setForm({ ...form, models: [...form.models.filter((model) => model.deployment !== next.deployment), next] });
  const save = async () => {
    const models = cards.map(fromModelForm);
    if (models.some((model) => !model)) { setMessage({ ok: false, text: "Ett pris ska vara ett tal större än 0 (USD per miljon tokens), eller tomt." }); return false; }
    if (removeKey) {
      if (!(await confirm({ title: "Ta bort nyckeln?", message: "Företag som kräver EU får ingen AI tills en ny nyckel läggs in.", confirmLabel: "Ta bort", tone: "danger" }))) return false;
      const cleared = await send("clear", { action: "clear_key" });
      if (!cleared) return false;
      setRemoveKey(false);
    }
    const result = await send("save", { action: "save", settings: { ...form, models, ...(apiKey.trim() && !removeKey ? { apiKey: apiKey.trim() } : {}) } });
    if (result) { apply(result); setApiKey(""); setMessage({ ok: true, text: "Sparat. Ändringen gäller för alla företag inom 15 sekunder." }); notify?.("EU-leverantören är sparad."); }
    return Boolean(result);
  };
  const savedModels = JSON.stringify((view.models ?? []).map(toModelForm));
  const dirty = removeKey || Boolean(apiKey.trim()) || form.endpoint !== view.endpoint || JSON.stringify(form.deployments) !== JSON.stringify(view.deployments)
    || form.euConfirmed !== view.euConfirmed || form.dpaApproved !== view.dpaApproved || JSON.stringify(form.models) !== savedModels;
  // The form's unsaved address, key and first deployment, so a value can be tried before it is saved.
  const tried = () => ({ endpoint: form.endpoint.trim() || undefined, apiKey: apiKey.trim() || undefined, deployment: form.deployments["gpt-5.6-luna"].trim() || undefined });
  const check = async () => {
    const result = await send("check", { action: "check", ...tried() });
    if (result) { setChecked(Boolean(result.ok)); setMessage({ ok: Boolean(result.ok), text: result.message ?? "" }); }
  };
  const ask = async () => {
    setProbe(null);
    const result = await send("probe", { action: "probe", ...tried(), question: question.trim() || undefined });
    if (result) setProbe({ ok: Boolean(result.ok), message: result.message ?? "", answer: result.answer ?? "", model: result.model ?? "", deployment: result.deployment ?? "", usage: result.usage, ms: result.ms, priced: result.priced });
  };
  // Ja/nej as switches (2026-11-11), saved with Spara; on/off is in the overview.
  const choice = (key: "euConfirmed" | "dpaApproved", label: string, help: string) => <SwitchRow id={`azure-${key}`} title={label} text={help} checked={form[key]} onCheckedChange={(value) => setForm({ ...form, [key]: value })} testId={`azure-${key}`} />;
  return <div data-testid="ai-azure"><KeyCard icon={Globe2} title="EU-leverantör (Azure OpenAI)" status={status} statusTestId="ai-azure-status" problemTestId="ai-azure-state" moreTestId="ai-azure-more" moreOpenWhen={Boolean(view.hasKey && view.problem && view.enabled)}
    check={{ onClick: () => void check(), busy: busy === "check", disabled: Boolean(busy) || (!apiKey.trim() && !view.hasKey), label: "Kontrollera Azure", testId: "azure-check" }}
    save={{ dirty, onSave: save }} saveTestId="ai-azure-save"
    settings={<div className="grid">
      {choice("euConfirmed", "Resursen ligger i EU", "Kontrollerat: resursen och driftsättningarna är i EU eller EU Data Zone.")}
      {choice("dpaApproved", "Microsofts avtal är godkänt", "Personuppgiftsbiträdesavtalet och rättslig grund.")}
    </div>}
    more={<>
      <p>Används bara för företag som kräver behandling inom EU. Utan den är AI avstängd för dem; ingen annan leverantör används i stället.</p>
      {view.updatedAt ? <p>Senast ändrat {when(view.updatedAt)} av {view.updatedBy}.</p> : null}
      <section className="grid gap-3 pt-2" aria-labelledby="azure-probe-title" data-testid="azure-probe">
        <h4 id="azure-probe-title" className="text-xs font-semibold text-foreground">Provfråga</h4>
        <Field id="azure-probe-question" label="Fråga" value={question} onChange={setQuestion} multiline help="Bara påhittad text. Debiteras inget företag." />
        <Button type="button" variant="outline" className="w-fit" disabled={Boolean(busy) || !question.trim() || (!apiKey.trim() && !view.hasKey)} onClick={() => void ask()} data-testid="azure-probe-send">{busy === "probe" ? <LoaderCircle className="animate-spin" /> : <Send />}Skicka provfrågan</Button>
        {probe ? <div role={probe.ok ? "status" : "alert"} className={cn("grid gap-1 rounded-lg border p-3 text-sm", !probe.ok && "border-destructive/40 text-destructive")} data-testid="azure-probe-result">
          <p className="font-medium">{probe.message}</p>
          {probe.answer ? <p className="whitespace-pre-wrap" data-testid="azure-probe-answer">{probe.answer}</p> : null}
          {probe.ok && probe.usage ? <p className="text-xs text-muted-foreground" data-testid="azure-probe-usage">Modell {probe.model} · driftsättning {probe.deployment} · tokens in {probe.usage.inputTokens} (cache {probe.usage.cachedInputTokens}) · ut {probe.usage.outputTokens} · {Math.round((probe.ms ?? 0) / 100) / 10} s{probe.priced ? "" : " · pris saknas, kostnaden räknas inte"}</p> : null}
        </div> : null}
      </section>
      <AzureModelCards cards={cards} onChange={setCard} />
    </>}>
    <div className="space-y-3">
      <KeyFields>
        <SecretField keepBin id="azure-key" label="Azure-nyckel" ariaLabel="Ny Azure-nyckel" mono value={apiKey} onChange={(value) => { setApiKey(value); setRemoveKey(false); }} stored={view.hasKey} removed={removeKey}
          tail={view.keyHint?.slice(-4)} placeholder="Nyckel från Azure-resursen" busy={Boolean(busy)} removeLabel="Ta bort nyckeln" onRemove={view.hasKey ? () => { setApiKey(""); setRemoveKey(true); } : undefined} onUndo={() => setRemoveKey(false)}
          hint={view.keyUnreadable ? "Den sparade nyckeln kan inte läsas. Lägg in den igen." : undefined} />
        <KeyTextField id="azure-endpoint" label="Resursens adress" value={form.endpoint} placeholder="https://<resurs>.services.ai.azure.com" onChange={(value) => setForm({ ...form, endpoint: value })} testId="azure-endpoint" removeLabel="Töm adressen" />
        {AZURE_ROUTE_MODELS.map((model) => <KeyTextField key={model} id={`azure-dep-${model}`} label={MODEL_LABEL[model]} value={form.deployments[model]} removeLabel={`Töm ${MODEL_LABEL[model].toLowerCase()}`}
          onChange={(value) => setForm({ ...form, deployments: { ...form.deployments, [model]: value } })} testId={`azure-deployment-${model}`} />)}
      </KeyFields>
      {message ? <p role={message.ok ? "status" : "alert"} className={cn("text-sm", message.ok ? "text-emerald-700 dark:text-emerald-300" : "text-destructive")}>{message.text}</p> : null}
    </div>
    {confirmElement}
  </KeyCard></div>;
}
