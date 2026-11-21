"use client";

import { useCallback, useState } from "react";
import { Layers } from "lucide-react";
import { ChoiceCard } from "@/components/ui/choice-card";
import { Panel } from "@/features/kfid/ui";
import { useLoadEffect } from "@/lib/use-load-effect";
import { useInstance } from "@/components/instance-provider";

type ProfileModel = { kind: string; model: string; features: string[]; euVerified: boolean; euSource: string; limitations: string; priced: boolean };
type Profile = { id: "standard" | "eu"; name: string; provider: string; released: boolean; ready: boolean; euVerified: boolean; usualCredits: number | null; models: ProfileModel[] };
type Data = { profiles: Profile[]; chosen: "standard" | "eu"; requireEu: boolean; canManage: boolean };

/** One model line: what it is for, its name, what it can do, its EU status and its limits. */
function ModelLine({ model, neverEu }: { model: ProfileModel; neverEu: boolean }) {
  return <li className="leading-5">
    <span className="font-medium text-foreground">{model.kind}:</span> {model.model}
    {model.features.length ? ` · ${model.features.join(", ")}` : ""}
    {neverEu ? " · Kan behandlas utanför EU" : model.euVerified ? ` · EU verifierad (${model.euSource})` : " · Kan behandlas utanför EU"}
    {model.limitations ? ` · ${model.limitations}` : ""}
  </li>;
}

/**
 * AI-profil (2026-10-24, svar 1): the company's admin chooses among the profiles Workflow released, on price, functions and data
 * processing; the server still chooses the level per task. With "Uppgifterna måste behandlas inom EU" only EU-verified models can be
 * used (2026-11-21: the EU mark follows each model card, not the profile's name), and a profile that is not ready gives no AI –
 * never another provider. The choice is saved at once, like the other AI choices.
 */
export function AiProfileChoice({ requireEu, locked, onChoose }: { requireEu: boolean; locked: boolean; onChoose: (profile: "standard" | "eu") => Promise<void> | void }) {
  const [data, setData] = useState<Data | null>(null);
  const { operator, features } = useInstance();
  const load = useCallback(async () => {
    const response = await fetch("/api/ai/profiles", { cache: "no-store" });
    if (response.ok) setData(await response.json() as Data);
  }, []);
  useLoadEffect(load);
  // No profile to choose among (the public demo, an installation without a released profile): the card stays away.
  if (!data || !data.profiles.length) return null;
  const choose = async (id: string) => { await onChoose(id as "standard" | "eu"); await load(); };
  return <Panel icon={Layers} title="AI-profil" description={`Vilken AI-modell företaget använder. ${operator} väljer nivå per uppgift.`}>
    <div className="grid gap-3" role="radiogroup" aria-label="AI-profil" data-testid="ai-profiles">
      {data.profiles.map((profile) => {
        const blocked = requireEu && !profile.euVerified;
        // The price in credits is Cloud's (2026-11-20); an installation with its own key pays its provider directly.
        // Vanliga frågor ingår i abonnemanget (2026-11-21): Cloud shows that, not a price in credits.
        const price = !features.credits ? "egen nyckel hos leverantören" : profile.usualCredits === null ? "pris saknas" : profile.usualCredits === 0 ? "ingår i abonnemanget" : `ca ${profile.usualCredits} krediter per vanlig fråga`;
        return <ChoiceCard key={profile.id} name="ai-profile" value={profile.id} checked={data.chosen === profile.id} onChange={(id) => void choose(id)}
          disabled={locked || !data.canManage || blocked || (!profile.ready && data.chosen !== profile.id)}
          title={<span data-testid={`ai-profile-${profile.id}`}>{profile.name} – {profile.provider}</span>}
          badge={blocked ? "Inte tillgänglig – kräver EU" : profile.euVerified ? "EU verifierad" : profile.id === "standard" ? "Kan behandlas utanför EU" : profile.ready ? undefined : "Inte klar"}
          description={<>
            <span className="block" data-testid={`ai-profile-${profile.id}-price`}>{price}{profile.ready ? "" : " · inte klar på servern"}</span>
            {/* The models are details (kundresa 2026-11-07, L22): folded under one line, also when the profile cannot be used. */}
            {profile.models.length ? <details className="mt-1" data-testid={`ai-profile-${profile.id}-models`}>
              <summary className="cursor-pointer text-xs">Modeller</summary>
              <ul className="mt-1 list-none p-0">{profile.models.map((model) => <ModelLine key={`${profile.id}-${model.kind}`} model={model} neverEu={profile.id === "standard"} />)}</ul>
            </details> : null}
          </>} />;
      })}
      {requireEu ? <p className="text-xs text-muted-foreground">Företaget kräver behandling i EU, så bara modeller i EU används. Finns ingen sådan är AI avstängd.</p> : null}
    </div>
  </Panel>;
}
