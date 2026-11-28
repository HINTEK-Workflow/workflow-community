"use client";

import { useCallback, useState } from "react";
import { KeyRound } from "lucide-react";
import { SwitchRow } from "@/features/kfid/ui";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { SecretField } from "@/features/kfid/secret-field";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { formatSwedish } from "@/lib/swedish-time";
import { useLoadEffect } from "@/lib/use-load-effect";
import { KEY_STATUS, KeyCard, KeyFields, KeySection, KeyTextField, type KeyCardStatus } from "@/features/integrations/key-card";
import { COMPANY_KEY_MODEL_LABEL, COMPANY_KEY_PROVIDER_LABEL, COMPANY_KEY_PROVIDERS, companyKeyValueHint, type CompanyKeyProvider } from "@/lib/ai/company-key";
import type { CompanyKeyView } from "@/lib/ai/company-key-server";

type Draft = { provider: CompanyKeyProvider; endpoint: string; model: string; euAttested: boolean; apiKey: string; removeKey: boolean };
const draftOf = (view: CompanyKeyView): Draft => ({ provider: view.provider, endpoint: view.endpoint, model: view.model, euAttested: view.euAttested, apiKey: "", removeKey: false });
const when = (at: string) => formatSwedish(at, { dateStyle: "medium" });

/**
 * Använd företagets egen AI-nyckel (2026-11-27) under Inställningar → Arbetssätt → Workflow AI: the shared key card (status,
 * Kontrollera, the fields with dots and a bin, one Spara, Mer). The switch is saved at once like every switch on the page; the
 * provider, the address, the model, the EU statement and the key with the card's Spara. Only the company's admin sees it; the server
 * checks the same. Workflow AI is the default, and the price is the same.
 */
export function CompanyKeyPanel({ notify }: { notify?: (text: string, error?: boolean) => void }) {
  const [view, setView] = useState<CompanyKeyView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [confirm, confirmElement] = useConfirm();
  const say = useCallback((text: string, failed = false) => { if (notify) notify(text, failed); else if (failed) setError(text); }, [notify]);
  const load = useCallback(async () => {
    try {
      const result = await api<{ companyKey: CompanyKeyView }>("/api/ai/company-key", { cache: "no-store" });
      setView(result.companyKey); setDraft(draftOf(result.companyKey)); setError("");
    } catch (cause) { setError((cause as Error).message); }
  }, []);
  useLoadEffect(load);
  if (error && !view) return <p role="alert" className="text-sm text-destructive">{error}</p>;
  if (!view || !draft) return null;

  const post = async (payload: Record<string, unknown>) => {
    // billingNote (Cloud, 2026-11-27): e.g. that the price with the own key applies from the next price version.
    const result = await api<{ companyKey: CompanyKeyView; ok?: boolean; message?: string; billingNote?: string }>("/api/ai/company-key", { method: "POST", body: JSON.stringify(payload) });
    setView(result.companyKey);
    return result;
  };
  const saved = { provider: view.provider, endpoint: view.endpoint, model: view.model, euAttested: view.euAttested };
  const toggle = async (on: boolean) => {
    if (on && !(await confirm({ title: "Använda företagets egen AI-nyckel?", message: "All AI i företaget går då via er egen nyckel, även agenter som körs på schema. Saknas nyckeln eller fungerar den inte pausas AI med ett besked. Workflows nyckel används aldrig i stället.", confirmLabel: "Slå på" }))) return;
    setBusy(true);
    try {
      const result = await post({ action: "save", on, ...saved });
      say(`${on ? "Företagets egen AI-nyckel används nu för all AI." : "Workflow AI används igen."}${result.billingNote ? ` ${result.billingNote}` : ""}`);
    } catch (cause) { say((cause as Error).message, true); } finally { setBusy(false); }
  };
  const dirty = draft.provider !== view.provider || draft.endpoint.trim() !== view.endpoint || draft.model.trim() !== view.model || draft.euAttested !== view.euAttested || Boolean(draft.apiKey.trim()) || draft.removeKey;
  const save = async () => {
    if (draft.removeKey && !(await confirm({ title: "Ta bort nyckeln?", message: view.on ? "AI pausas för företaget tills en ny nyckel läggs in eller egen AI-nyckel stängs av." : "Nyckeln raderas.", confirmLabel: "Ta bort", tone: "danger" }))) return false;
    try {
      const next = await post({ action: "save", on: view.on, provider: draft.provider, endpoint: draft.provider === "azure-openai" ? draft.endpoint.trim() : "", model: draft.model.trim(),
        euAttested: draft.provider === "azure-openai" && draft.euAttested, ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}), ...(draft.removeKey ? { removeKey: true } : {}) });
      setDraft(draftOf(next.companyKey));
      say("Egen AI-nyckel: sparat.");
      return true;
    } catch (cause) { say((cause as Error).message, true); return false; }
  };
  const check = async () => {
    setChecking(true);
    try { const result = await post({ action: "check" }); say(result.message ?? "", !result.ok); }
    catch (cause) { say((cause as Error).message, true); } finally { setChecking(false); }
  };
  const status: KeyCardStatus = !view.key ? (view.on ? { ...KEY_STATUS.failed, problem: view.problem } : KEY_STATUS.missing)
    : view.on && view.problem ? { ...KEY_STATUS.failed, problem: view.problem } : view.on ? { label: "Används", tone: "success" } : { label: "Av", tone: "neutral" };
  const azure = draft.provider === "azure-openai";
  return <div data-testid="company-ai-key">
    {confirmElement}
    <KeyCard icon={KeyRound} title="Företagets egen AI-nyckel" status={status} statusTestId="company-ai-key-status" problemTestId="company-ai-key-problem"
      check={{ onClick: () => void check(), busy: checking, disabled: dirty, disabledReason: dirty ? "Spara först." : !view.key ? "Lägg in nyckeln först." : null, label: "Kontrollera företagets AI-nyckel", testId: "company-ai-key-check" }}
      save={{ dirty, onSave: save, blocked: azure && view.requireEu && !draft.euAttested ? "Företaget kräver EU: intyga att Azure-resursen ligger i EU." : !azure && view.requireEu ? "Företaget kräver EU: en OpenAI-nyckel kan inte användas." : null }}
      saveTestId="company-ai-key-save" moreTestId="company-ai-key-more"
      more={<>
        <p>Av från början: då används Workflow AI. På: all AI i företaget, även agenter som körs på schema, går via företagets egen nyckel hos er leverantör, som fakturerar er direkt. Körningarna står som Företagets nyckel under Användning och räknas inte mot veckans kvot. Abonnemangets pris är detsamma.</p>
        <p>Saknas nyckeln eller fungerar den inte pausas AI med ett besked. Workflow går aldrig över till Workflows nyckel av sig själv. Namn byts mot alias som vanligt innan något skickas.</p>
        <p>Kräver företaget behandling inom EU går bara företagets egen Azure-resurs, och bara när du intygat att den ligger i EU. En OpenAI-nyckel spärras då.</p>
        <p>Bilder och tal till text i chatten fungerar inte ännu med egen nyckel.</p>
        {view.updatedAt ? <p data-testid="company-ai-key-changed">Senast ändrad {when(view.updatedAt)}{view.updatedBy ? ` av ${view.updatedBy}` : ""}.</p> : null}
      </>}>
      <SwitchRow id="company-ai-key-on" testId="company-ai-key-on" title="Använd företagets egen AI-nyckel" checked={view.on} disabled={busy}
        text={view.on ? "All AI i företaget går via er egen nyckel." : "Av: Workflow AI används."} onCheckedChange={(on) => void toggle(on)} />
      <div className="grid gap-1.5">
        <Label htmlFor="company-ai-key-provider" className="field-label text-xs font-medium">Leverantör</Label>
        <select id="company-ai-key-provider" className="form-select" value={draft.provider} data-testid="company-ai-key-provider"
          onChange={(event) => setDraft({ ...draft, provider: event.target.value as CompanyKeyProvider, apiKey: "", removeKey: false })}>
          {COMPANY_KEY_PROVIDERS.map((provider) => <option key={provider} value={provider} disabled={provider === "openai" && view.requireEu}>{COMPANY_KEY_PROVIDER_LABEL[provider]}{provider === "openai" && view.requireEu ? " (spärrad: företaget kräver EU)" : ""}</option>)}
        </select>
      </div>
      <KeyFields testId="company-ai-key-fields">
        {azure ? <KeyTextField id="company-ai-key-endpoint" label="Adress till Azure-resursen" value={draft.endpoint} placeholder="https://<resurs>.openai.azure.com" mono
          onChange={(endpoint) => setDraft({ ...draft, endpoint })} testId="company-ai-key-endpoint" /> : null}
        <KeyTextField id="company-ai-key-model" label={COMPANY_KEY_MODEL_LABEL[draft.provider]} value={draft.model} mono placeholder={azure ? "Driftsättningens namn" : "Till exempel gpt-5.4-mini"}
          onChange={(model) => setDraft({ ...draft, model })} testId="company-ai-key-model" hint="En resonerande modell som klarar strikta svar och verktyg. Den används för alla AI-funktioner." />
        <SecretField keepBin id="company-ai-key-value" label="Nyckel" value={draft.apiKey} stored={Boolean(view.key) && draft.provider === view.provider} tail={view.key?.hint.replace(/^[•.]+/, "") ?? null}
          removed={draft.removeKey} onRemove={() => setDraft({ ...draft, apiKey: "", removeKey: true })} onUndo={() => setDraft({ ...draft, removeKey: false })}
          onChange={(apiKey) => setDraft({ ...draft, apiKey, removeKey: false })} placeholder="Klistra in nyckeln från leverantören" mono removeLabel="Ta bort nyckeln"
          hint={`${companyKeyValueHint(draft.provider)} Sparas krypterad för företaget. Efteråt visas bara de sista tecknen.`} testId="company-ai-key-value" />
      </KeyFields>
      {azure ? <KeySection title="EU">
        <label className="flex items-start gap-2 text-sm" htmlFor="company-ai-key-eu">
          <Checkbox id="company-ai-key-eu" checked={draft.euAttested} onCheckedChange={(value) => setDraft({ ...draft, euAttested: value === true })} data-testid="company-ai-key-eu" />
          <span>Jag intygar att företagets Azure-resurs och dess driftsättning ligger i EU.{view.requireEu ? " Krävs eftersom företaget kräver behandling inom EU." : ""}</span>
        </label>
        {view.euAttested && view.euAttestedAt ? <p className="text-xs text-muted-foreground" data-testid="company-ai-key-eu-by">Intygat {when(view.euAttestedAt)}{view.euAttestedBy ? ` av ${view.euAttestedBy}` : ""}.</p> : null}
      </KeySection> : null}
    </KeyCard>
  </div>;
}
