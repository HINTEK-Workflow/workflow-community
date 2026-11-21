"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatSwedish } from "@/lib/swedish-time";
import { cn } from "@/lib/utils";
import { REGISTER_POLL_MS, registerProgress } from "@/lib/catalogue/register-progress";
import type { ServerKeyStatus, SolarRegisterStatus } from "@/lib/integrations/server-keys";
import { api } from "../../features/kfid/api";
import { useConfirm } from "../../features/kfid/confirm";
import { KeyCardActions } from "./key-card";

type Row = ServerKeyStatus & { lastCheck: { ok: boolean; message: string; at: string } | null };
type Notify = (text: string, error?: boolean) => void;

/**
 * Det gemensamma artikelregistret (2026-10-17): how many of Solar's articles every company searches, when the catalogue
 * was last fetched, "Hämta hela katalogen" for the product owner – and, since 2026-10-18, a status line with progress while the
 * import waits or runs (read again every few seconds only while something is going on) and "Avbryt". The button only asks: the
 * scheduled job (register:sync, every ten minutes) runs the import on the server, one page at a time, never a price.
 */
export function SolarRegister({ row, notify, onReplaced }: { row: Row; notify: Notify; onReplaced: (server: Row[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [confirm, confirmElement] = useConfirm();
  // The latest small status read; it counts only while the card's own data is the one it was read against.
  const [live, setLive] = useState<{ base: SolarRegisterStatus; value: SolarRegisterStatus } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const base = row.solarRegister!;
  const register = live?.base === base ? live.value : base;
  const when = (value: string) => formatSwedish(value, { dateStyle: "medium", timeStyle: "short" });
  const progress = registerProgress({
    requested: Boolean(register.requested), running: register.running ? { kind: register.running.kind, pages: register.running.pages, written: register.running.written, cancelling: register.running.cancelling } : null,
    knownTotal: register.knownTotal, lastRun: register.lastRun,
  }, when);

  const read = async () => {
    const result = await api<{ solarRegister: SolarRegisterStatus }>("/api/integration-keys?scope=register");
    setLive({ base, value: result.solarRegister });
  };
  useEffect(() => {
    if (!progress.polling) return undefined;
    const timer = setInterval(() => { void read().catch(() => undefined); }, REGISTER_POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `read` only closes over `base`, which is part of the key below.
  }, [progress.polling, base]);

  const ask = async () => {
    if (!(await confirm({ title: "Hämta hela Solars katalog?", message: "Tar ungefär en halvtimme och startar inom tio minuter. Inga priser hämtas.", confirmLabel: "Hämta katalogen" }))) return;
    setBusy(true);
    try {
      const result = await api<{ ok: boolean; message: string; server: Row[] }>("/api/integration-keys", { method: "POST", body: JSON.stringify({ action: "request_register_import" }) });
      onReplaced(result.server);
      notify(result.message, !result.ok);
    } catch (cause) { notify((cause as Error).message, true); } finally { setBusy(false); }
  };
  const cancel = async () => {
    if (register.running && !(await confirm({ title: "Avbryta hämtningen?", message: "Det som hämtats hittills tas bort. Tidigare artiklar ligger kvar.", confirmLabel: "Avbryt hämtningen", cancelLabel: "Fortsätt hämta", tone: "danger" }))) return;
    setBusy(true);
    try {
      const result = await api<{ ok: boolean; message: string; server: Row[] }>("/api/integration-keys", { method: "POST", body: JSON.stringify({ action: "cancel_register_import" }) });
      onReplaced(result.server);
      notify(result.message, !result.ok);
    } catch (cause) { notify((cause as Error).message, true); } finally { setBusy(false); }
  };

  const importReason = !row.configured ? "Lägg in Solars nyckel först." : !register.apiEnabled ? "Slå på API-anslutningen först." : register.running ? "En hämtning pågår." : register.requested ? "En hämtning är redan begärd." : null;
  const text = progress.text || (!register.apiEnabled ? "API-anslutningen är av. Nya prisfiler läses in som företagens egna rader." : "");
  const failed = progress.phase === "failed" || progress.phase === "cancelled";
  return <div className="grid gap-2 text-xs text-muted-foreground" data-testid="solar-register">
    {confirmElement}
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="min-w-0 flex-1">
        <span className="font-medium text-foreground">Artikelregister:</span>{" "}
        <span data-testid="solar-register-count">{register.articles ? `${register.articles.toLocaleString("sv-SE")} artiklar som alla företag söker i` : "tomt – sökningen använder bara företagens egna prisfiler"}</span>
        {register.lastFullAt ? <> · hela katalogen {when(register.lastFullAt)}</> : null}
        {register.syncedFrom && register.syncedFrom !== register.lastFullAt ? <> · ändringar {when(register.syncedFrom)}</> : null}
      </p>
      {/* The buttons stand in the card's one action row (2026-11-12); what they do is told here. */}
      <KeyCardActions>
      <Button type="button" variant="outline" disabledReason={importReason} onClick={() => void ask()} data-testid="solar-register-import" title={importReason ?? "Tar ungefär en halvtimme."} busy={busy} busyLabel="Kontrollerar…">
        <RefreshCw />{register.lastFullAt ? "Hämta hela katalogen nu" : "Hämta hela katalogen"}
      </Button>
      {progress.canCancel ? <Button type="button" variant="outline" disabled={busy} onClick={() => void cancel()} data-testid="solar-register-cancel"><Square />Avbryt hämtningen</Button> : null}
      </KeyCardActions>
    </div>
    {text ? <p role="status" data-testid="solar-register-state" data-phase={progress.phase} className={cn(failed && progress.phase === "failed" && "text-red-700 dark:text-red-300")}>{text}</p> : null}
    {progress.percent !== null ? <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Förlopp för katalogen" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} data-testid="solar-register-bar">
      <div className="h-full rounded-full bg-primary" style={{ width: `${progress.percent}%` }} />
    </div> : null}
    {register.history.length > 1 ? <div>
      <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" aria-expanded={historyOpen} onClick={() => setHistoryOpen((value) => !value)} data-testid="solar-register-history-toggle">{historyOpen ? "Dölj importhistorik" : `Importhistorik (${register.history.length})`}</button>
      {historyOpen ? <ul className="mt-1 space-y-0.5" data-testid="solar-register-history">
        {register.history.map((run) => <li key={run.startedAt} className={run.ok ? undefined : "text-red-700 dark:text-red-300"}>{when(run.finishedAt)} · {run.kind === "changes" ? "ändringar" : "hela katalogen"}{run.trial ? " (prov)" : ""} · {run.cancelled ? "avbruten" : run.ok ? "ok" : "fel"} – {run.message}</li>)}
      </ul> : null}
    </div> : null}
    <p>Registret har aldrig priser. Ändringar hämtas varje natt och hela katalogen en gång i månaden.</p>
  </div>;
}
