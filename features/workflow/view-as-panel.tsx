"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChoiceCard } from "@/components/ui/choice-card";
import { Panel } from "@/features/kfid/ui";
import { VIEW_AS_LABELS, VIEW_AS_MODES, type ViewAs } from "@/lib/workflow/view-as";

/**
 * "Visa som" (2026-10-03), under Inställningar for the superadmin only: shows the app as a customer's owner, an
 * employee or a free Local company sees it. Display only; the banner at the top ends it.
 */
export function ViewAsPanel({ current, notify }: { current: ViewAs | null; notify: (text: string, error?: boolean) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const choose = async (mode: ViewAs | null) => {
    setBusy(true);
    try {
      const response = await fetch("/api/view-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
      if (!response.ok) throw new Error("Visa som kunde inte ändras.");
      router.push("/?view=stats");
      router.refresh();
    } catch (cause) { notify((cause as Error).message, true); } finally { setBusy(false); }
  };
  return <Panel title="Visa som" description="Se hur Workflow ser ut för en kund. Bara menyer och sidor ändras – dina rättigheter och data är desamma. Gäller bara dig."
    leadingActions={<span className="panel-icon" aria-hidden="true"><Eye className="size-4" /></span>}>
    <div className="grid gap-3 sm:grid-cols-3" data-testid="view-as-choices">
      {VIEW_AS_MODES.map((mode) => <ChoiceCard key={mode} name="view-as" value={mode} checked={current === mode} disabled={busy} onChange={() => void choose(mode)}
        title={VIEW_AS_LABELS[mode].label} description={VIEW_AS_LABELS[mode].description} />)}
    </div>
    {current ? <Button type="button" variant="outline" className="mt-4" disabled={busy} onClick={() => void choose(null)}>Visa som superadmin igen</Button> : null}
  </Panel>;
}
