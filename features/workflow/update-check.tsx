"use client";

import { useCallback, useState } from "react";
import { api } from "@/features/kfid/api";
import { SwitchRow } from "@/features/kfid/ui";
import { formatSwedishDate } from "@/lib/swedish-time";
import { useLoadEffect } from "@/lib/use-load-effect";

type State = {
  available: boolean; enabled: boolean; version: string;
  newer: { version: string; url: string; publishedAt: string | null } | null;
  checkedAt: string | null; failed: boolean;
};

/**
 * Kontrollera nya versioner (K4.8, 2026-11-28), under Hjälp → Om Workflow for the Community installation's administrator: off
 * from the start; when it is on the server reads the public list of releases once a day and the line says when there is a
 * newer version, with a link to it. Nothing about the installation is sent.
 */
export function UpdateCheck() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setState(await api<State>("/api/superadmin/update-check", { cache: "no-store" })); setError(""); }
    catch (issue) { setError((issue as Error).message); }
  }, []);
  useLoadEffect(load);

  async function toggle(enabled: boolean) {
    setBusy(true);
    try { setState(await api<State>("/api/superadmin/update-check", { method: "POST", body: JSON.stringify({ enabled }) })); setError(""); }
    catch (issue) { setError((issue as Error).message); }
    finally { setBusy(false); }
  }

  if (state && !state.available) return null;
  return <div className="mt-2 border-t pt-2" data-testid="update-check">
    <SwitchRow id="update-check" testId="update-check-switch" title="Kontrollera nya versioner" checked={state?.enabled === true} disabled={!state || busy}
      text="Servern läser en gång om dygnet den publika listan över versioner på GitHub. Inget om installationen skickas." onCheckedChange={(checked) => void toggle(checked)} />
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p>
      : !state?.enabled ? null
      : state.newer ? <p role="status" data-testid="update-check-newer">Version {state.newer.version} finns{state.newer.publishedAt ? ` sedan ${formatSwedishDate(state.newer.publishedAt, { dateStyle: "medium" })}` : ""}. <a className="text-primary underline-offset-4 hover:underline" href={state.newer.url} target="_blank" rel="noopener noreferrer">Läs om versionen</a> och uppdatera enligt INSTALLATION.md, avsnitt 7.</p>
      : state.failed ? <p role="status" className="text-muted-foreground" data-testid="update-check-failed">Listan över versioner gick inte att läsa. Servern försöker igen om ett dygn.</p>
      : <p role="status" className="text-muted-foreground" data-testid="update-check-current">Ni har den senaste versionen.</p>}
  </div>;
}
