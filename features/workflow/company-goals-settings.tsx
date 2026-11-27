"use client";

import { useEffect, useRef, useState } from "react";
import { Target } from "lucide-react";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { Panel } from "@/features/kfid/ui";
import { announce } from "@/lib/workflow/toast";
import { companyGoalsSchema, parseGoalInput, type CompanyGoals } from "@/lib/workflow/company-goals";

type GoalKey = keyof CompanyGoals;
const FIELDS: { key: GoalKey; label: string; testId: string; inputMode: "numeric" | "decimal" }[] = [
  { key: "completedWorkOrdersPerMonth", label: "Färdigställda arbetsordrar per månad", testId: "company-goals-work-orders", inputMode: "numeric" },
  { key: "invoicedPerMonth", label: "Fakturerat per månad (kr)", testId: "company-goals-invoiced", inputMode: "numeric" },
  { key: "quoteWinRatePercent", label: "Vunna offerter (%)", testId: "company-goals-win-rate", inputMode: "decimal" },
];
const textOf = (goals: CompanyGoals) => Object.fromEntries(FIELDS.map(({ key }) => [key, goals[key] === null ? "" : String(goals[key])])) as Record<GoalKey, string>;

/**
 * Mål under Inställningar → Arbetssätt (2026-10-28: "Företagets egna mål ska ersätta hårdkodade mål", "Företaget
 * ska kunna ange egna ekonomiska mål"): the work-order goal the statistics draw, and the economy goals Ekonomi reads.
 * An empty field is no goal. Saved when the field is left, like Priser och villkor (docs/ui-system.md 2.3); only the
 * company's admin sees and changes it. Cloud only.
 */
export function CompanyGoalsPanel() {
  const [text, setText] = useState<Record<GoalKey, string> | null>(null);
  const [error, setError] = useState("");
  const savedKey = useRef("");
  const queue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    let active = true;
    api<{ goals: CompanyGoals }>("/api/company-goals", { cache: "no-store" })
      .then((result) => { if (active) { setText(textOf(result.goals)); savedKey.current = JSON.stringify(result.goals); } })
      .catch((cause: Error) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, []);
  if (error) return <Panel icon={Target} title="Mål"><p role="alert" className="text-sm text-destructive">{error}</p></Panel>;
  if (!text) return <Panel icon={Target} title="Mål"><p role="status" className="text-sm text-muted-foreground">Hämtar…</p></Panel>;
  const values = Object.fromEntries(FIELDS.map(({ key }) => [key, parseGoalInput(text[key])])) as Record<GoalKey, number | null | undefined>;
  const parsed = companyGoalsSchema.safeParse(values);
  const bad = new Set(FIELDS.filter(({ key }) => values[key] === undefined || (!parsed.success && parsed.error.issues.some((issue) => issue.path[0] === key))).map(({ key }) => key));
  const problems = [...new Set(FIELDS.filter(({ key }) => bad.has(key)).map(({ key }) => values[key] === undefined ? "Skriv ett tal." : parsed.success ? "" : parsed.error.issues.find((issue) => issue.path[0] === key)?.message ?? ""))].filter(Boolean);
  const commit = () => {
    if (!parsed.success) return;
    const key = JSON.stringify(parsed.data);
    if (key === savedKey.current) return;
    savedKey.current = key;
    queue.current = queue.current.then(async () => {
      try {
        await api<{ goals: CompanyGoals }>("/api/company-goals", { method: "POST", body: JSON.stringify({ goals: parsed.data }) });
        announce("Målen är sparade.");
      } catch (cause) {
        savedKey.current = "";
        announce((cause as Error).message, true);
      }
    });
  };
  const leave = { onBlur: commit, onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") commit(); } };
  return <div data-testid="company-goals"><Panel icon={Target} title="Mål" description="Lämna fältet tomt om ni inte har något mål. Det du skriver sparas när du lämnar fältet.">
    <div className="space-y-4">
      <div className="field-group grid gap-4 rounded-lg border p-3 sm:grid-cols-3">
        {FIELDS.map((field) => (
          <label key={field.key} className="space-y-1.5 text-xs font-medium text-muted-foreground">{field.label}
            <Input inputMode={field.inputMode} placeholder="Inget mål" value={text[field.key]} aria-invalid={bad.has(field.key) || undefined}
              onChange={(event) => setText({ ...text, [field.key]: event.target.value })} {...leave} data-testid={field.testId} />
          </label>
        ))}
        <p className="text-xs text-muted-foreground sm:col-span-3">Arbetsordermålet visas i Statistik.</p>
      </div>
      {problems.length ? <p role="alert" className="text-xs text-destructive">{problems.join(" ")} Ändringen sparas när värdet går att läsa.</p> : null}
    </div>
  </Panel></div>;
}
