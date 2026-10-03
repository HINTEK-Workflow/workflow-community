"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/features/kfid/ui";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { cn } from "@/lib/utils";
import type { DigestFacts } from "@/lib/ai/daily-digest";

type Digest = { day: string; text: string; facts: DigestFacts; source: string };
const dayText = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", weekday: "long", day: "numeric", month: "long" });

/**
 * Dagsammanställningen on Översikt (2026-10-02: "för teamet i dashboarden, inte överdrivet, mer konstatera hur
 * progressionen ligger till"): the night's short digest of the latest day with activity – a few plain sentences and
 * the numbers they rest on. Nothing is shown when the company has not chosen it or there is no fresh digest.
 */
export function DailyDigestCard() {
  const [digest, setDigest] = useState<Digest | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/ai/digest", { cache: "no-store" }).then((response) => (response.ok ? response.json() : null)).then((result: { digest?: Digest | null } | null) => { if (active && result?.digest) setDigest(result.digest); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  if (!digest) return null;
  const facts = digest.facts;
  const done = facts.completed.workOrders + facts.completed.protocols + facts.completed.riskAssessments + facts.completed.controls;
  const chips: { label: string; value: number; tone: "success" | "neutral" | "warning" | "danger" }[] = [
    { label: "slutförda", value: done, tone: "success" },
    // As on Nyckeltal: paused work is still under way.
    { label: "pågår", value: facts.open.inProgress + facts.open.paused, tone: "neutral" },
    { label: "har passerat sitt datum", value: facts.overdue, tone: "danger" },
    { label: "behöver åtgärdas", value: facts.open.needsAction, tone: "warning" },
  ];
  const day = dayText.format(new Date(`${digest.day}T12:00:00Z`));
  return <Panel title="Dagsammanställning" description={`Läget efter ${day}. Skrivs på natten utifrån det som har registrerats i Workflow.`} collapsible>
    <div data-testid="daily-digest" data-source={digest.source}>
      <p className="max-w-4xl text-sm leading-6">{digest.text}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {chips.filter((chip) => chip.value > 0 || chip.tone === "success").map((chip) => <span key={chip.label} className={cn("rounded-full border px-2.5 py-1 text-xs", indicatorBadge(chip.value > 0 ? chip.tone : "neutral"))}><strong className="font-semibold text-foreground">{chip.value}</strong> {chip.label}</span>)}
      </div>
    </div>
  </Panel>;
}
