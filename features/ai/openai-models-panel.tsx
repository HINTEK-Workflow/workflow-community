"use client";

import { useCallback, useState } from "react";
import { Coins, LoaderCircle, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/features/kfid/ui";
import { api } from "@/features/kfid/api";
import { cn } from "@/lib/utils";
import { useLoadEffect } from "@/lib/use-load-effect";
import type { AzureModelInfo } from "@/lib/ai/azure-settings";
import { AzureModelCards } from "@/features/ai/azure-model-cards";
import { fromModelForm, toModelForm, type AzureModelForm } from "@/features/ai/azure-model-form";

/**
 * OpenAI:s modeller och priser (2026-10-24, svar 3): the same cards as the EU provider's – price in, cache and out per million
 * tokens with source and date, functions, limits – so a new price needs no code change. Never EU (2026-11-01). The prices the
 * code had are the starting values. A card without a price stops customers' runs on the Standard profile (pris saknas).
 */
export function OpenAiModelsPanel() {
  const [cards, setCards] = useState<AzureModelForm[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    try { setCards((await api<{ models: AzureModelInfo[] }>("/api/superadmin/ai-provider", { cache: "no-store" })).models.map(toModelForm)); }
    catch (cause) { setMessage({ ok: false, text: (cause as Error).message }); }
  }, []);
  useLoadEffect(load);
  if (!cards) return null;
  const save = async () => {
    const models = cards.map(fromModelForm);
    if (models.some((model) => !model)) { setMessage({ ok: false, text: "Ett pris ska vara ett tal större än 0 (USD per miljon tokens), eller tomt." }); return; }
    setBusy(true); setMessage(null);
    try {
      const result = await api<{ models: AzureModelInfo[] }>("/api/superadmin/ai-provider", { method: "POST", body: JSON.stringify({ action: "save_models", models }) });
      setCards(result.models.map(toModelForm));
      setMessage({ ok: true, text: "Sparat. Gäller nya AI-svar. Tidigare körningar behåller sitt pris." });
    } catch (cause) { setMessage({ ok: false, text: (cause as Error).message }); }
    finally { setBusy(false); }
  };
  return <Panel icon={Coins} title="OpenAI-modeller och priser" description="Profilen Standard. Priserna ändras här utan kod. Startvärdena kommer från koden.">
    <div className="space-y-4" data-testid="openai-models-panel">
      <AzureModelCards provider="OpenAI" testId="openai-models" neverEu cards={cards} onChange={(next) => setCards(cards.map((card) => card.deployment === next.deployment ? next : card))} />
      {message ? <p role={message.ok ? "status" : "alert"} className={cn("text-sm", message.ok ? "text-emerald-700 dark:text-emerald-300" : "text-destructive")}>{message.text}</p> : null}
      <Button type="button" className="mobile-form-action" disabled={busy} onClick={() => void save()} data-testid="openai-models-save">{busy ? <LoaderCircle className="animate-spin" /> : <Save />}Spara</Button>
    </div>
  </Panel>;
}
