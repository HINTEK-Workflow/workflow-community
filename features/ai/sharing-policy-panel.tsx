"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Save, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Panel } from "@/features/kfid/ui";

type Policy = {
  enabled: boolean;
  shareChatContent: boolean;
  shareCustomers: boolean;
  shareControls: boolean;
  shareDocuments: boolean;
  shareConversationHistory: boolean;
  allowedModules: "KFID"[];
};

const labels: { key: "shareChatContent" | "shareCustomers" | "shareControls" | "shareDocuments" | "shareConversationHistory"; title: string; help: string }[] = [
  { key: "shareChatContent", title: "Chattinnehåll", help: "Krävs för att frågor ska kunna skickas till AI-leverantören." },
  { key: "shareCustomers", title: "Kundregister", help: "Tillåt att behöriga kundnamn och kundmetadata används som källor." },
  { key: "shareControls", title: "Kontroller före idrifttagning", help: "Tillåt att behöriga kontrolluppgifter används som källor när modulen Kontroll före idrifttagning också är tillåten." },
  { key: "shareDocuments", title: "Dokument och bilagor", help: "Tillåt endast filnamn och kontrollkoppling i detta steg. Filinnehåll skickas inte." },
  { key: "shareConversationHistory", title: "Tidigare konversationshistorik", help: "Tillåt att tidigare meddelanden i samma personliga konversation skickas med." },
];

export function AiSharingPolicyPanel() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/ai/policy", { cache: "no-store" });
      if (!response.ok) throw new Error("AI-inställningarna kunde inte hämtas.");
      const data = await response.json() as { policy: Policy; canManage: boolean };
      setPolicy(data.policy);
      setCanManage(data.canManage);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI-inställningarna kunde inte hämtas.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!policy || !canManage) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/ai/policy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(policy),
      });
      const data = await response.json() as { policy?: Policy; error?: string };
      if (!response.ok || !data.policy) throw new Error(data.error || "AI-inställningarna kunde inte sparas.");
      setPolicy(data.policy);
      setNotice("Företagets AI-delning är sparad och loggad.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI-inställningarna kunde inte sparas.");
    } finally { setBusy(false); }
  }

  return (
    <Panel title="HINTEK AI – företagets delning" description="Företagsadmin bestämmer separat vilken information som får lämna Workflow. Alla val kontrolleras även på servern.">
      {!policy ? <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-4 animate-spin" /> Hämtar AI-inställningar…</p> : (
        <div className="space-y-4">
          <label className="flex items-start gap-3 rounded-xl border p-4">
            <Checkbox checked={policy.enabled} disabled={!canManage || busy} onCheckedChange={(checked) => setPolicy({ ...policy, enabled: checked === true })} />
            <span><span className="block text-sm font-medium">Aktivera HINTEK AI för företaget</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Aktivering kräver även chattinnehåll och att serverns provider är redo.</span></span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            {labels.map((item) => <label key={item.key} className="flex items-start gap-3 rounded-xl border p-4">
              <Checkbox checked={policy[item.key]} disabled={!canManage || busy} onCheckedChange={(checked) => setPolicy({ ...policy, [item.key]: checked === true })} />
              <span><span className="block text-sm font-medium">{item.title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{item.help}</span></span>
            </label>)}
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-sm font-medium">Moduler som AI får använda</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Endast aktiva Workflow-moduler visas. Nya moduler blir avstängda som standard och kräver ett nytt uttryckligt val.</p>
            <label className="mt-3 flex items-start gap-3">
              <Checkbox
                checked={policy.allowedModules.includes("KFID")}
                disabled={!canManage || busy}
                onCheckedChange={(checked) => setPolicy({ ...policy, allowedModules: checked === true ? ["KFID"] : [] })}
              />
              <span><span className="block text-sm font-medium">Kontroll före idrifttagning</span><span className="mt-1 block text-xs text-muted-foreground">Ger AI rätt att använda de kontrollkällor som markerats ovan, aldrig andra tenants data.</span></span>
            </label>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">AI får aldrig generell åtkomst till hela sidan. Den får endast serverhämtade uppgifter inom användarens befintliga behörighet och företagets val ovan.</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" disabled={!canManage || busy || (policy.enabled && !policy.shareChatContent)} onClick={() => void save()}>{busy ? <LoaderCircle className="animate-spin" /> : <Save />} Spara AI-val</Button>
            {!canManage ? <span className="text-xs text-muted-foreground">Endast företagsadmin kan ändra valen.</span> : null}
            {policy.enabled && !policy.shareChatContent ? <span className="text-xs text-amber-700">Godkänn chattinnehåll för att kunna aktivera AI.</span> : null}
          </div>
          {notice ? <p role="status" className="flex items-center gap-2 text-sm text-emerald-700"><ShieldCheck className="size-4" />{notice}</p> : null}
        </div>
      )}
      {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}
    </Panel>
  );
}
