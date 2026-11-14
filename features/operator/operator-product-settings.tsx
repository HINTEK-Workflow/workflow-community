"use client";

import { useCallback, useState } from "react";
import { HardHat } from "lucide-react";
import { CheckField, Panel } from "@/features/kfid/ui";
import { api } from "@/features/kfid/api";
import { useLoadEffect } from "@/lib/use-load-effect";

/**
 * Installation → Drift och säkerhet → Operatörssidan (2026-10-30): the product owner's switch for the
 * prepared AI troubleshooting step. Off: no company sees the step and nothing is asked, whatever the company chose.
 */
export function OperatorProductSettings({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setOn((await api<{ aiTroubleshooting: boolean }>("/api/superadmin/operator-page", { cache: "no-store" })).aiTroubleshooting); } catch (error) { notify((error as Error).message, true); }
  }, [notify]);
  useLoadEffect(load);
  const save = async (next: boolean) => {
    setBusy(true);
    try { await api("/api/superadmin/operator-page", { method: "POST", body: JSON.stringify({ aiTroubleshooting: next }) }); setOn(next); notify(next ? "AI-felsökning kan slås på av företagen." : "AI-felsökning är av för alla företag."); }
    catch (error) { notify((error as Error).message, true); }
    finally { setBusy(false); }
  };
  return <Panel icon={HardHat} title="Operatörssidan" description="Felanmälan för operatörer. Företagen sköter sina konton själva." collapsible defaultCollapsed>
    {on === null ? <p className="text-sm text-muted-foreground" role="status">Hämtar…</p>
      : <CheckField id="operator-product-ai" label="AI-felsökning före felanmälan (förberedd)" checked={on} disabled={busy} onChange={(next) => void save(next)}
        description="Av: inget visas och ingenting frågas. På: varje företag väljer själv. Förslagen bygger på företagets egen historik och maskinens larm." testId="operator-product-ai" />}
  </Panel>;
}
