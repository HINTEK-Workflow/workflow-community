"use client";

import { useState } from "react";
import { clearWorkspaceCache } from "@/lib/workflow/workspace-cache";
import { useRouter } from "next/navigation";
import { Eye } from "lucide-react";
import { ChoiceCard } from "@/components/ui/choice-card";
import { Panel } from "@/features/kfid/ui";
import { SUPERADMIN_VIEW, VIEW_AS_LABELS, VIEW_AS_MODES, type ViewAs } from "@/lib/workflow/view-as";

/**
 * "Visa som" (2026-10-03), under Installation → Drift (since 2026-10-07; Inställningar before) for the superadmin only: shows the app as a customer's owner, an
 * employee or a free Local company sees it, display only, and the banner at the top ends it. Superadmin is the default: everything in the company (lib/workflow/view-as.ts).
 */
export function ViewAsPanel({ current, notify }: { current: ViewAs | null; notify: (text: string, error?: boolean) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const choose = async (mode: ViewAs | null) => {
    setBusy(true);
    try {
      const response = await fetch("/api/view-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
      if (!response.ok) throw new Error("Visa som kunde inte ändras.");
      // Visa som is a scope of its own in the tab's memory (stabil sidladdning steg 7): nothing kept carries over.
      clearWorkspaceCache();
      router.push("/?view=stats");
      router.refresh();
    } catch (cause) { notify((cause as Error).message, true); } finally { setBusy(false); }
  };
  return <Panel title="Visa som" description="Välj hur Workflow ska visas. Valet gäller bara dig. Som kund eller medarbetare ändras bara menyer och sidor, inte dina behörigheter."
    icon={Eye}>
    <div className="@container"><div className="grid gap-3 @lg:grid-cols-2 @5xl:grid-cols-4" data-testid="view-as-choices">
      <ChoiceCard name="view-as" value="superadmin" checked={!current} disabled={busy} onChange={() => void choose(null)} title={SUPERADMIN_VIEW.label} description={SUPERADMIN_VIEW.description} />
      {VIEW_AS_MODES.map((mode) => <ChoiceCard key={mode} name="view-as" value={mode} checked={current === mode} disabled={busy} onChange={() => void choose(mode)}
        title={VIEW_AS_LABELS[mode].label} description={VIEW_AS_LABELS[mode].description} />)}
    </div></div>
  </Panel>;
}
