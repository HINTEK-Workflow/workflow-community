"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, RotateCcw, Server } from "lucide-react";
import { clientExtensions } from "@ee/client";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { CollapsibleSection, Panel } from "@/features/kfid/ui";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { SERVER_BADGE_LABEL, SERVER_BADGE_TONE, STALE_ADVICE, uptimeText, type CommandStep, type ServerOneClick, type ServerView } from "@/lib/ops/host-status";
import { formatSwedish } from "@/lib/swedish-time";
import { cn } from "@/lib/utils";

/**
 * Servrar och uppdateringar (2026-10-25: "Detta vill jag även kunna veta från prodadmin."): a part of
 * Installation → Drift och säkerhet with one card per server – its state as a badge, the pending and security
 * updates, restart, kernel, uptime, whether the automatic security updates are effectively on and when apt last
 * succeeded – and a folded "Kommandon för hand" with the exact commands. Read from /api/superadmin/server-updates (the
 * superadmin only). The app runs nothing on the servers.
 *
 * Uppdatera servrarna (2026-11-06: "jag klickar på en knapp och powershell-fönster öppnas på min dator, då är det bara
 * min ssh-nyckel som fungerar"): where the installation has a handler on the administrator's computer, one link updates both
 * servers in the right order and Starta om (only when a restart is needed, after a question) restarts one. The links only
 * open the handler; it asks again and runs a fixed list of actions with the person's own SSH key.
 */
type ServerCard = ServerView & { commands: CommandStep[] };
/** Uppdatera servrarna (Workflow's handler, ee/ui/server-one-click.tsx); none without ee/. */
const { ServerOneClickRow } = clientExtensions;
type Answer = { servers: ServerCard[]; readAt: string; staleHours: number; alertDays: number; oneClick?: ServerOneClick | null };

const when = (iso: string | null | undefined) => (iso ? formatSwedish(iso) : "–");

function Badge({ badge, testId }: { badge: ServerView["badges"][number]; testId?: string }) {
  return <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold", indicatorBadge(SERVER_BADGE_TONE[badge]))} data-testid={testId} data-badge={badge}>{SERVER_BADGE_LABEL[badge]}</span>;
}

function Fact({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return <div className="min-w-0">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="break-words text-sm" data-testid={testId}>{children}</dd>
  </div>;
}

export function CommandRow({ step }: { step: CommandStep }) {
  const [manual, setManual] = useState(false);
  return <div className="space-y-1">
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-semibold">{step.label}</span>
      <CopyButton size="sm" value={step.command} aria-label={`Kopiera: ${step.label}`} onCopied={() => setManual(false)} onFailed={() => setManual(true)} />
    </div>
    <pre className="overflow-x-auto whitespace-pre rounded-md bg-muted px-3 py-2 font-mono text-xs" data-testid="server-command">{step.command}</pre>
    {manual ? <p className="text-xs text-muted-foreground" role="status">Kopieringen nekades. Markera texten och kopiera själv.</p> : null}
  </div>;
}

function ServerCardView({ server, staleHours, restartHref, onRestart }: { server: ServerCard; staleHours: number; restartHref?: string; onRestart: (host: string, href: string) => void }) {
  const [open, setOpen] = useState(false);
  const status = server.status;
  const automaticText = !status ? "–" : status.automatic.effective ? "På" : `Avstängda${status.automatic.zeroFiles.length ? ` (${status.automatic.zeroFiles.join(", ")})` : ""}`;
  return <section className="field-group space-y-3 rounded-md border p-3" data-testid={`server-card-${server.host}`} data-state={server.badges[0]}>
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{server.host}</h3>
      {server.badges.map((badge, index) => <Badge key={badge} badge={badge} testId={index === 0 ? `server-badge-${server.host}` : undefined} />)}
    </div>
    {server.rebootNeeded && server.fresh && restartHref ? <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => onRestart(server.host, restartHref)} data-testid={`server-restart-${server.host}`}><RotateCcw />Starta om</Button>
      <span className="text-xs text-muted-foreground">Öppnar PowerShell på din dator.</span>
    </div> : null}
    {!status ? <p className="text-sm text-muted-foreground">Ingen status. {STALE_ADVICE}</p> : <>
      {!server.fresh ? <p className="text-sm text-danger" role="status">Ingen färsk status ({server.ageHours} h gammal, gräns {staleHours} h). {STALE_ADVICE}</p> : null}
      <dl className="grid gap-3 sm:grid-cols-2">
        <Fact label="Väntande paket" testId={`server-pending-${server.host}`}>{status.updates.pending}{status.updates.security ? `, varav ${status.updates.security} säkerhet` : ""}</Fact>
        <Fact label="Viktigast">{server.important.length ? server.important.join(", ") : status.updates.security ? status.updates.securityPackages.slice(0, 4).join(", ") : "–"}</Fact>
        <Fact label="Omstart" testId={`server-reboot-${server.host}`}>{server.rebootNeeded ? `Krävs sedan ${when(status.reboot.since)}${status.reboot.packages.length ? ` (${status.reboot.packages.slice(0, 3).join(", ")})` : ""}` : "Krävs inte"}</Fact>
        <Fact label="Kärna">{status.kernel.running ?? "–"}{status.kernel.newerInstalled && status.kernel.newestInstalled ? ` (installerad: ${status.kernel.newestInstalled})` : ""}</Fact>
        <Fact label="Drifttid">{uptimeText(status.uptimeSeconds) ?? "–"}</Fact>
        <Fact label="Automatiska säkerhetsuppdateringar" testId={`server-automatic-${server.host}`}>{automaticText}</Fact>
        <Fact label="Apt lyckades senast">{when(status.apt.updateSuccess)}{status.apt.unattendedUpgrades ? ` · automatisk uppgradering ${when(status.apt.unattendedUpgrades)}` : ""}</Fact>
        <Fact label="Statusen lästes">{when(status.generatedAt)}{status.os ? ` · ${status.os}` : ""}</Fact>
      </dl>
      {server.listsOld ? <p className="text-xs text-muted-foreground">Paketlistorna hämtades senast {when(status.updates.listsUpdatedAt)}; antalet kan vara för lågt.</p> : null}
    </>}
    <CollapsibleSection title="Kommandon för hand" summary="Att kopiera och köra själv" open={open} onOpenChange={setOpen} testId={`server-howto-${server.host}`}>
      <p className="text-xs text-muted-foreground">Databasservern först, sedan appservern. Ta backup och kontrollera den före ingrepp på appservern.</p>
      {server.commands.map((step) => <CommandRow key={step.label} step={step} />)}
    </CollapsibleSection>
  </section>;
}

export function ServerUpdates() {
  const [data, setData] = useState<Answer | null>(null);
  const [state, setState] = useState<"loading" | "idle" | "error">("loading");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setState("loading");
    try { setData(await api<Answer>("/api/superadmin/server-updates", { cache: "no-store" })); setState("idle"); }
    catch (error) { setMessage((error as Error).message); setState("error"); }
  }, []);
  const [confirm, confirmElement] = useConfirm();
  const restart = async (host: string, href: string) => {
    const ok = await confirm({
      title: `Starta om ${host}?`, confirmLabel: "Starta om", tone: "danger",
      message: "PowerShell öppnas på din dator och frågar en gång till. Appen kan vara borta en minut eller två medan servern startar.",
    });
    if (ok) window.location.href = href;
  };
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load();
  }, [load]);
  return <Panel icon={Server} title="Servrar och uppdateringar" description="Väntande uppdateringar, omstart och automatiska säkerhetsuppdateringar per server."
    actions={<Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={state === "loading"} data-testid="server-updates-reload"><RefreshCw />Läs igen</Button>}>
    <div data-testid="server-updates" data-state={state}>
      {state === "error" ? <p className="text-sm text-destructive" role="alert">{message}</p> : null}
      {state === "loading" && !data ? <p className="text-sm text-muted-foreground" role="status">Hämtar…</p> : null}
      {data && !data.servers.length ? <p className="text-sm text-muted-foreground">Ingen server har skrivit någon status ännu.</p> : null}
      {data?.oneClick && data.servers.length && ServerOneClickRow ? <ServerOneClickRow oneClick={data.oneClick} unknown={data.servers.filter((server) => !server.fresh).map((server) => server.host)} /> : null}
      {data?.servers.length ? <div className="grid gap-4 lg:grid-cols-2">
        {data.servers.map((server) => <ServerCardView key={server.host} server={server} staleHours={data.staleHours} restartHref={data.oneClick?.restart[server.host]} onRestart={(host, href) => void restart(host, href)} />)}
      </div> : null}
    </div>
    {confirmElement}
  </Panel>;
}
