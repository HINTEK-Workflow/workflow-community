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
import { useInstance } from "@/components/instance-provider";
import { cn } from "@/lib/utils";
import { useLoadEffect } from "@/lib/use-load-effect";
import { AI_PROFILE_IDS, AI_PROFILE_NAME, AZURE_LEVEL_LABEL, AZURE_ROUTE_MODELS, type AiProfileId, type AzureModelInfo, type AzurePreset, type AzureRouteModel, type AzureTranscription } from "@/lib/ai/azure-settings";
import { AzureModelCards } from "@/features/ai/azure-model-cards";
import { fromModelForm, modelCardsFor, toModelForm, type AzureModelForm } from "@/features/ai/azure-model-form";

type Deployments = Record<AzureRouteModel, string>;
type View = {
  enabled: boolean; endpoint: string; deployments: Deployments; standardDeployments: Deployments; dpaApproved: boolean;
  /** Tal till text per profile (2026-11-21), "" = none, and why each does not work (null when it does). */
  transcription?: AzureTranscription; voiceProblems?: Record<AiProfileId, string | null>;
  models: AzureModelInfo[]; preset: AzurePreset | null;
  hasKey: boolean; keyHint: string | null; keyUnreadable: boolean; problem: string | null; problems?: Record<AiProfileId, string | null>;
  updatedAt: string | null; updatedBy: string | null;
};
/** What a check or a trial question answered: Azure's text, the model, the tokens – never the key. */
type ProbeResult = { ok: boolean; message: string; answer: string; model: string; deployment: string; usage?: { inputTokens: number; cachedInputTokens: number; outputTokens: number }; ms?: number; priced?: boolean };
type Form = Pick<View, "enabled" | "endpoint" | "deployments" | "standardDeployments" | "dpaApproved"> & { transcription: AzureTranscription; models: AzureModelForm[] };
const NO_TRANSCRIPTION: AzureTranscription = { standard: "", eu: "" };

const when = (value: string | null) => (value ? new Date(value).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", dateStyle: "short", timeStyle: "short" }) : "");
/** The form's field for a profile's deployments: EU keeps the older name `deployments`. */
const SET: Record<AiProfileId, "standardDeployments" | "deployments"> = { standard: "standardDeployments", eu: "deployments" };

/**
 * Workflow AI (Azure) (2026-10-19, 2026-11-21): in Cloud Workflow AI runs only here. One resource and one key serve both AI
 * profiles, each with its own deployments: Standard (for example Global Standard, may be processed outside the EU) and EU (only
 * models whose card says EU verified, with a source). The superadmin gives the address, the key and the deployments, fills in each
 * model's card and confirms Microsoft's agreement. Nothing is on until all of it is; a profile that is not ready gives its companies
 * no AI, never another model.
 */
export function AzureProviderPanel({ notify }: { notify?: (text: string, error?: boolean) => void } = {}) {
  const { community } = useInstance();
  const [view, setView] = useState<View | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [apiKey, setApiKey] = useState("");
  // The bin marks the key for removal until the card is saved (2026-11-11).
  const [removeKey, setRemoveKey] = useState(false);
  const [busy, setBusy] = useState<"save" | "check" | "clear" | "probe" | null>(null);
  const [question, setQuestion] = useState("Svara kort på svenska: vad är 2 + 2?");
  const [probeProfile, setProbeProfile] = useState<AiProfileId>("standard");
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [checked, setChecked] = useState<boolean | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const apply = (next: View) => { setView(next); setForm({ enabled: next.enabled, endpoint: next.endpoint, deployments: next.deployments, standardDeployments: next.standardDeployments ?? next.deployments, transcription: next.transcription ?? NO_TRANSCRIPTION, dpaApproved: next.dpaApproved, models: (next.models ?? []).map(toModelForm) }); };
  const load = useCallback(async () => {
    try { apply(await api<View>("/api/superadmin/ai-azure", { cache: "no-store" })); }
    catch (cause) { setMessage({ ok: false, text: (cause as Error).message }); }
  }, []);
  useLoadEffect(load);
  const name = "Workflow AI (Azure)";
  // One status (2026-11-01): Fungerar after a check answered here; Fel when it is switched on and cannot be used.
  const blocker = view?.problem ?? null;
  const status: KeyCardStatus | null = !view ? null : !view.hasKey ? KEY_STATUS.missing
    : checked === false ? { ...KEY_STATUS.failed, problem: message?.text ?? null }
    : blocker ? { ...(view.enabled ? KEY_STATUS.failed : KEY_STATUS.untested), problem: `Azure är inte klar: ${blocker}` }
    : checked ? KEY_STATUS.works : KEY_STATUS.untested;
  // Slå på i sidans översikt (2026-11-11): saved at once with the saved values; the server refuses it until all is in place.
  const toggle = view ? {
    label: community ? "Azure" : "Workflow AI", on: view.enabled, disabledReason: view.hasKey ? null : "Lägg in nyckeln först.",
    onChange: async (on: boolean) => {
      setBusy("save");
      try {
        const next = await api<View>("/api/superadmin/ai-azure", { method: "POST", body: JSON.stringify({ action: "save", settings: { enabled: on, endpoint: view.endpoint, deployments: view.deployments, standardDeployments: view.standardDeployments, dpaApproved: view.dpaApproved } }) });
        setView(next); setForm((current) => current && { ...current, enabled: next.enabled });
        notify?.(on ? "Azure är påslagen." : "Azure är avstängd.");
        return true;
      } catch (cause) { notify?.((cause as Error).message, true); return false; } finally { setBusy(null); }
    },
  } : undefined;
  useServerKeySectionStatus("azure", status ? { label: status.label, tone: status.tone, detail: status.problem ?? undefined, name, toggle } : null);
  if (!view || !form) return <KeyCard icon={Globe2} title={name} status={null} saveable><p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Hämtar…</p></KeyCard>;

  const send = async (kind: "save" | "check" | "clear" | "probe", payload: unknown) => {
    setBusy(kind); setMessage(null);
    try { return await api<View & Partial<ProbeResult>>("/api/superadmin/ai-azure", { method: "POST", body: JSON.stringify(payload) }); }
    catch (cause) { setMessage({ ok: false, text: (cause as Error).message }); return null; }
    finally { setBusy(null); }
  };
  const cards = modelCardsFor(form.deployments, form.models, view.preset, form.standardDeployments, form.transcription);
  // Which profile and level use each card, so EU is marked where it matters.
  const usedBy: Record<string, string> = {};
  for (const profile of AI_PROFILE_IDS) for (const level of AZURE_ROUTE_MODELS) {
    const deployment = form[SET[profile]][level].trim();
    if (deployment) usedBy[deployment] = [usedBy[deployment], `${AI_PROFILE_NAME[profile]}: ${AZURE_LEVEL_LABEL[level].toLowerCase()}`].filter(Boolean).join(", ");
  }
  for (const profile of AI_PROFILE_IDS) {
    const deployment = form.transcription[profile].trim();
    if (deployment) usedBy[deployment] = [usedBy[deployment], `${AI_PROFILE_NAME[profile]}: tal till text`].filter(Boolean).join(", ");
  }
  const setCard = (next: AzureModelForm) => setForm({ ...form, models: [...form.models.filter((model) => model.deployment !== next.deployment), next] });
  const save = async () => {
    const models = cards.map(fromModelForm);
    if (models.some((model) => !model)) { setMessage({ ok: false, text: "Ett pris ska vara ett tal större än 0 (USD per miljon tokens), eller tomt." }); return false; }
    if (removeKey) {
      if (!(await confirm({ title: "Ta bort nyckeln?", message: community ? "Företag som använder Azure får ingen AI tills en ny nyckel läggs in." : "Inga företag får Workflow AI tills en ny nyckel läggs in.", confirmLabel: "Ta bort", tone: "danger" }))) return false;
      const cleared = await send("clear", { action: "clear_key" });
      if (!cleared) return false;
      setRemoveKey(false);
    }
    const result = await send("save", { action: "save", settings: { ...form, models, ...(apiKey.trim() && !removeKey ? { apiKey: apiKey.trim() } : {}) } });
    if (result) { apply(result); setApiKey(""); setMessage({ ok: true, text: "Sparat. Ändringen gäller för alla företag inom 15 sekunder." }); notify?.("Azure är sparad."); }
    return Boolean(result);
  };
  const savedModels = JSON.stringify((view.models ?? []).map(toModelForm));
  const dirty = removeKey || Boolean(apiKey.trim()) || form.endpoint !== view.endpoint || JSON.stringify(form.deployments) !== JSON.stringify(view.deployments)
    || JSON.stringify(form.standardDeployments) !== JSON.stringify(view.standardDeployments ?? view.deployments)
    || JSON.stringify(form.transcription) !== JSON.stringify(view.transcription ?? NO_TRANSCRIPTION)
    || form.dpaApproved !== view.dpaApproved || JSON.stringify(form.models) !== savedModels;
  // The form's unsaved address, key and the chosen profile's first deployment, so a value can be tried before it is saved.
  const tried = () => ({ profile: probeProfile, endpoint: form.endpoint.trim() || undefined, apiKey: apiKey.trim() || undefined, deployment: form[SET[probeProfile]]["gpt-5.6-luna"].trim() || undefined });
  const check = async () => {
    const result = await send("check", { action: "check", ...tried() });
    if (result) { setChecked(Boolean(result.ok)); setMessage({ ok: Boolean(result.ok), text: result.message ?? "" }); }
  };
  const ask = async () => {
    setProbe(null);
    const result = await send("probe", { action: "probe", ...tried(), question: question.trim() || undefined });
    if (result) setProbe({ ok: Boolean(result.ok), message: result.message ?? "", answer: result.answer ?? "", model: result.model ?? "", deployment: result.deployment ?? "", usage: result.usage, ms: result.ms, priced: result.priced });
  };
  const setDeployment = (profile: AiProfileId, level: AzureRouteModel, value: string) => setForm({ ...form, [SET[profile]]: { ...form[SET[profile]], [level]: value } });
  return <div data-testid="ai-azure"><KeyCard icon={Globe2} title={name} status={status} statusTestId="ai-azure-status" problemTestId="ai-azure-state" moreTestId="ai-azure-more" moreOpenWhen={Boolean(view.hasKey && view.problem && view.enabled)}
    check={{ onClick: () => void check(), busy: busy === "check", disabled: Boolean(busy) || (!apiKey.trim() && !view.hasKey), label: "Kontrollera Azure", testId: "azure-check" }}
    save={{ dirty, onSave: save }} saveTestId="ai-azure-save"
    settings={<div className="grid">
      {/* Ja/nej as a switch (2026-11-11), saved with Spara; on/off is in the overview. EU is marked per model below, not here (2026-11-21). */}
      <SwitchRow id="azure-dpaApproved" title="Microsofts avtal är godkänt" text="Personuppgiftsbiträdesavtalet och rättslig grund." checked={form.dpaApproved} onCheckedChange={(value) => setForm({ ...form, dpaApproved: value })} testId="azure-dpaApproved" />
    </div>}
    more={<>
      <p>{community ? "Azure används för profilen EU, och för Standard när Leverantör för Standard är Azure." : "Workflow AI körs bara här."} Profilen Standard använder sina driftsättningar och kan behandlas utanför EU. Profilen EU använder bara modeller som är markerade EU verifierad. Är en profil inte klar får dess företag ingen AI, och ingen annan modell används i stället.</p>
      {view.problems ? <ul className="grid gap-1 text-xs" data-testid="ai-azure-profiles">
        {AI_PROFILE_IDS.map((profile) => <li key={profile} data-testid={`ai-azure-profile-${profile}`}><span className="font-medium">{AI_PROFILE_NAME[profile]}:</span> {view.problems?.[profile] ?? "Klar."}</li>)}
        {view.voiceProblems ? AI_PROFILE_IDS.map((profile) => <li key={`${profile}-voice`} data-testid={`ai-azure-voice-${profile}`}><span className="font-medium">{AI_PROFILE_NAME[profile]}, tal till text:</span> {view.voiceProblems?.[profile] ?? "Klar."}</li>) : null}
      </ul> : null}
      <p>Bilder i chatten fungerar när modellen för enkla svar har Bilder ikryssat på sitt kort. Tal till text kräver en egen driftsättning per profil, till exempel gpt-4o-mini-transcribe. Ljudet sparas inte.</p>
      {view.updatedAt ? <p>Senast ändrat {when(view.updatedAt)} av {view.updatedBy}.</p> : null}
      <section className="grid gap-3 pt-2" aria-labelledby="azure-probe-title" data-testid="azure-probe">
        <h4 id="azure-probe-title" className="text-xs font-semibold text-foreground">Provfråga</h4>
        <label className="field-stack">Profil
          <select className="form-select" value={probeProfile} onChange={(event) => setProbeProfile(event.target.value as AiProfileId)} data-testid="azure-probe-profile">
            {AI_PROFILE_IDS.map((profile) => <option key={profile} value={profile}>{AI_PROFILE_NAME[profile]}</option>)}
          </select>
          <span className="text-xs font-normal text-muted-foreground">Kontrollera och Provfråga använder profilens driftsättning för enkla svar.</span>
        </label>
        <Field id="azure-probe-question" label="Fråga" value={question} onChange={setQuestion} multiline help="Bara påhittad text. Debiteras inget företag." />
        <Button type="button" variant="outline" className="w-fit" disabled={Boolean(busy) || !question.trim() || (!apiKey.trim() && !view.hasKey)} onClick={() => void ask()} data-testid="azure-probe-send">{busy === "probe" ? <LoaderCircle className="animate-spin" /> : <Send />}Skicka provfrågan</Button>
        {probe ? <div role={probe.ok ? "status" : "alert"} className={cn("grid gap-1 rounded-lg border p-3 text-sm", !probe.ok && "border-destructive/40 text-destructive")} data-testid="azure-probe-result">
          <p className="font-medium">{probe.message}</p>
          {probe.answer ? <p className="whitespace-pre-wrap" data-testid="azure-probe-answer">{probe.answer}</p> : null}
          {probe.ok && probe.usage ? <p className="text-xs text-muted-foreground" data-testid="azure-probe-usage">Modell {probe.model} · driftsättning {probe.deployment} · tokens in {probe.usage.inputTokens} (cache {probe.usage.cachedInputTokens}) · ut {probe.usage.outputTokens} · {Math.round((probe.ms ?? 0) / 100) / 10} s{probe.priced ? "" : " · pris saknas, kostnaden räknas inte"}</p> : null}
        </div> : null}
      </section>
      <AzureModelCards cards={cards} onChange={setCard} usedBy={usedBy} />
    </>}>
    <div className="space-y-3">
      <KeyFields>
        <SecretField keepBin id="azure-key" label="Azure-nyckel" ariaLabel="Ny Azure-nyckel" mono value={apiKey} onChange={(value) => { setApiKey(value); setRemoveKey(false); }} stored={view.hasKey} removed={removeKey}
          tail={view.keyHint?.slice(-4)} placeholder="Nyckel från Azure-resursen" busy={Boolean(busy)} removeLabel="Ta bort nyckeln" onRemove={view.hasKey ? () => { setApiKey(""); setRemoveKey(true); } : undefined} onUndo={() => setRemoveKey(false)}
          hint={view.keyUnreadable ? "Den sparade nyckeln kan inte läsas. Lägg in den igen." : undefined} />
        <KeyTextField id="azure-endpoint" label="Resursens adress" value={form.endpoint} placeholder="https://<resurs>.services.ai.azure.com" onChange={(value) => setForm({ ...form, endpoint: value })} testId="azure-endpoint" removeLabel="Töm adressen" />
        {/* Driftsättningar per profil (2026-11-21): Standard first (for example Global Standard), then EU (Data Zone EUR). */}
        {AI_PROFILE_IDS.flatMap((profile) => AZURE_ROUTE_MODELS.map((level) => {
          const label = `${AI_PROFILE_NAME[profile]} · ${AZURE_LEVEL_LABEL[level]}`;
          return <KeyTextField key={`${profile}-${level}`} id={`azure-${profile}-dep-${level}`} label={label} value={form[SET[profile]][level]} removeLabel={`Töm ${label.toLowerCase()}`}
            onChange={(value) => setDeployment(profile, level, value)} testId={profile === "eu" ? `azure-deployment-${level}` : `azure-standard-deployment-${level}`} />;
        }))}
        {/* Tal till text (2026-11-21): optional per profile, for the chat's microphone; its card below needs a price, and EU a verified source. */}
        {AI_PROFILE_IDS.map((profile) => {
          const label = `${AI_PROFILE_NAME[profile]} · Tal till text (valfri)`;
          return <KeyTextField key={`${profile}-voice`} id={`azure-${profile}-voice`} label={label} value={form.transcription[profile]} placeholder="Till exempel gpt-4o-mini-transcribe" removeLabel={`Töm ${label.toLowerCase()}`}
            hint={view.voiceProblems?.[profile] ? undefined : "Mikrofonen i chatten fungerar för profilen."}
            onChange={(value) => setForm({ ...form, transcription: { ...form.transcription, [profile]: value } })} testId={`azure-${profile}-voice`} />;
        })}
      </KeyFields>
      {message ? <p role={message.ok ? "status" : "alert"} className={cn("text-sm", message.ok ? "text-emerald-700 dark:text-emerald-300" : "text-destructive")}>{message.text}</p> : null}
    </div>
    {confirmElement}
  </KeyCard></div>;
}
