"use client";

import { useState } from "react";
import Link from "next/link";
import { Blocks, SlidersHorizontal } from "lucide-react";
import { DialogActions, Modal, Panel, SwitchRow } from "@/features/kfid/ui";
import { api } from "@/features/kfid/api";
import { FEATURE_DEFINITIONS, type FeatureKey, type FeatureSettings as FeatureValues } from "@/lib/workflow/feature-settings";
import { ALWAYS_ON_PARTS, applyModuleChanges, MODULE_DEFINITIONS, MODULE_EFFECTS, moduleOn, moduleTitle, type ModuleChanges, type ModuleKey } from "@/lib/workflow/modules";
import type { ModuleImpactRow } from "@/lib/workflow/modules-server";
import { PageHeader } from "@/components/page-shell";

type ChangeFeature = (action: string, on: boolean, message: string) => void;

/**
 * The company's on/off choices as switches with one line each (UX-granskningen C4, 2026-10-22), saved at once.
 * Each choice has exactly one place: Objektdata and the risk exception on Arbetssätt (Kontor och avdelningar and Mät igen were removed
 * 2026-10-24). The server refuses use of a function that is off (object data); this only sets the choice.
 */
export function FeatureSwitches({ keys, values, busy, local, onChange }: {
  keys: readonly FeatureKey[]; values: FeatureValues; busy: boolean;
  /** A company with its data in a local file: a Cloud-only choice is not offered. */
  local: boolean; onChange: ChangeFeature;
}) {
  const shown = FEATURE_DEFINITIONS.filter((feature) => keys.includes(feature.key) && !(local && feature.cloudOnly));
  return <div className="divide-y" data-testid="feature-switches">
    {shown.map((feature) => <SwitchRow key={feature.key} id={`feature-${feature.key}`} testId={`feature-${feature.key}`} title={feature.title} text={feature.short}
      checked={values[feature.key]} disabled={busy}
      onCheckedChange={(on) => onChange(feature.action, on, `${feature.title} är ${on ? "påslaget" : "avslaget"}.`)} />)}
  </div>;
}

type ModuleQuestion = { key: ModuleKey; on: boolean; turnedOff: ModuleKey[]; turnedOn: ModuleKey[]; impact: { key: ModuleKey; rows: ModuleImpactRow[] }[] };

/**
 * Företagets moduler (0.39.0): a section on Arbetssätt, with the shared switches. Before a module goes off the admin sees what is
 * affected, with counts, and confirms; a module that takes another with it says so. A module that is on with nothing else to say is
 * saved at once, like the switches above. While one is off its history is one tap away. In Local this is display only: the file is on
 * the person's computer, so the server cannot stop anything there and has nothing to count.
 */
export function ModuleSettings({ disabled, busy, local, notify, onChange }: {
  disabled: readonly string[]; busy: boolean; local: boolean;
  notify: (text: string, error?: boolean) => void;
  onChange: (changes: ModuleChanges, message: string) => Promise<boolean>;
}) {
  const [question, setQuestion] = useState<ModuleQuestion | null>(null);
  const [asking, setAsking] = useState(false);
  const message = (key: ModuleKey, on: boolean) => `${moduleTitle(key)} är ${on ? "på" : "av"}.`;
  const choose = async (key: ModuleKey, on: boolean) => {
    const change = applyModuleChanges(disabled, { [key]: on });
    if (on && change.turnedOn.length <= 1) { await onChange({ [key]: true }, message(key, true)); return; }
    let impact: ModuleQuestion["impact"] = [];
    if (!on && !local) {
      setAsking(true);
      try {
        const query = change.turnedOff.map((item) => `module=${encodeURIComponent(item)}`).join("&");
        impact = (await api<{ impact: ModuleQuestion["impact"] }>(`/api/workspace?action=module_impact&${query}`)).impact;
      } catch (cause) {
        notify((cause as Error).message, true);
        return;
      } finally {
        setAsking(false);
      }
    }
    setQuestion({ key, on, turnedOff: change.turnedOff, turnedOn: change.turnedOn, impact });
  };
  const others = question ? (question.on ? question.turnedOn : question.turnedOff).filter((item) => item !== question.key) : [];
  const counted = question ? question.impact.flatMap((part) => part.rows.filter((row) => row.count > 0).map((row) => ({ ...row, module: part.key }))) : [];
  return <Panel title="Moduler" description={`Det företaget använder, av eller på för alla. Alltid på: ${ALWAYS_ON_PARTS.join(", ")}.`} icon={Blocks}>
    <div className="divide-y" data-testid="module-settings">
      {MODULE_DEFINITIONS.map((item) => {
        const on = moduleOn(disabled, item.key);
        return <div key={item.key} data-testid={`module-row-${item.key}`}>
          <SwitchRow id={`module-${item.key}`} testId={`module-${item.key}`} title={item.title} text={item.short} checked={on} disabled={busy || asking} onCheckedChange={(next) => void choose(item.key, next)} />
          {!on && item.historyHref ? <p className="pb-2 text-xs"><Link className="underline underline-offset-2" href={item.historyHref} data-testid={`module-history-${item.key}`}>Läs det som finns</Link></p> : null}
        </div>;
      })}
    </div>
    {local ? <p className="notice mt-3 text-xs" data-testid="module-settings-local">Med data i en lokal fil gäller valet bara vad som visas. Filen finns på din dator, så servern kan inte stoppa något.</p> : null}
    <Modal open={Boolean(question)} onOpenChange={(open) => { if (!open) setQuestion(null); }} title={question ? `${moduleTitle(question.key)} ${question.on ? "på" : "av"}` : ""} size="form">
      {question ? <div className="space-y-4 text-sm" data-testid="module-confirm">
        {others.length ? <p data-testid="module-confirm-others">{question.on ? `${moduleTitle(question.key)} behöver ${others.map(moduleTitle).join(" och ")}, som också slås på.` : `${others.map(moduleTitle).join(" och ")} behöver ${moduleTitle(question.key)} och stängs också av.`}</p> : null}
        {question.on ? null : <>
          {counted.length ? <ul className="divide-y rounded-lg border" data-testid="module-confirm-counts">{counted.map((row) => <li key={`${row.module}-${row.label}`} className="flex items-baseline justify-between gap-3 px-3 py-2"><span className="min-w-0">{row.label}</span><span className="shrink-0 font-medium tabular-nums">{row.count.toLocaleString("sv-SE")}</span></li>)}</ul> : local ? null : <p data-testid="module-confirm-empty">Det finns inget i modulen just nu.</p>}
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">{question.turnedOff.flatMap((item) => MODULE_EFFECTS[item]).map((line) => <li key={line}>{line}</li>)}</ul>
          <p>Inget raderas. Det som finns går att läsa och exportera, och slår du på modulen igen finns allt kvar.</p>
        </>}
        <DialogActions cancel={{ onClick: () => setQuestion(null) }} primary={{ label: question.on ? "Slå på" : "Stäng av", busy, testId: "module-confirm-yes", onClick: () => { const current = question; void onChange({ [current.key]: current.on }, message(current.key, current.on)).then((saved) => { if (saved) setQuestion(null); }); } }} />
      </div> : null}
    </Modal>
  </Panel>;
}

/** Inställningar → Arbetssätt (2026-10-07; switches since C4): the page heading and the company's functions. */
export function FeatureSettings({ values, busy, local, onChange }: { values: FeatureValues; busy: boolean; local: boolean; onChange: ChangeFeature }) {
  return <div className="space-y-6" data-testid="feature-settings">
    <PageHeader title="Arbetssätt" description="Slå på det företaget använder. Det som stängs av syns inte, men det som redan skrivits finns kvar." />
    <Panel title="Valfria funktioner" description="Av eller på för hela företaget." icon={SlidersHorizontal}>
      <FeatureSwitches keys={["maintenance", "riskException"]} values={values} busy={busy} local={local} onChange={onChange} />
    </Panel>
  </div>;
}
