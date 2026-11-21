"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { CollapsibleSection, Panel } from "@/features/kfid/ui";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import {
  ageHours, BACKUP_KIND_LABEL, BACKUP_KINDS, BACKUP_LIST_MISSING_TEXT, BACKUP_LIST_STALE_HOURS, BACKUP_PART_LABEL, BACKUP_PARTS, bytesText, keepText, offsiteKeepText,
  type BackupList, type BackupPart,
} from "@/lib/ops/backup-list";
import { durationText, MONITOR_THRESHOLDS, SERVER_JOB_STATUS_LABEL, SERVER_JOB_STATUS_TONE, type ServerJobStatus } from "@/lib/ops/server-jobs";
import type { ServerJobView } from "@/lib/ops/server-jobs-server";
import { formatSwedish } from "@/lib/swedish-time";
import { cn } from "@/lib/utils";

/**
 * Serverjobb (2026-11-14): a part of Installation → Drift och säkerhet beside Servrar och uppdateringar. Every
 * scheduled job with its schedule in words, its last run (time, result, a short line, how long) and its next; the jobs that
 * run in the app have Pausa/Starta and Kör nu (asking first for the ones that send mail, publish, touch billing or remove
 * data). The servers' own jobs and the backups on the database server are shown only: they are never changed, removed,
 * restored or downloaded from the app, and the monitor's limits are changed on the server. Read from
 * /api/superadmin/server-jobs (the superadmin only).
 */
type Answer = { jobs: ServerJobView[]; backups: BackupList | null; databaseServer: boolean; thresholds: (typeof MONITOR_THRESHOLDS)[number][]; readAt: string };

const when = (iso: string | null | undefined) => (iso ? formatSwedish(iso) : "–");
const POLL_MS = 5_000;

function StatusBadge({ status, testId }: { status: ServerJobStatus; testId?: string }) {
  return <span className={cn("inline-flex shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold", indicatorBadge(SERVER_JOB_STATUS_TONE[status]))} data-testid={testId} data-status={status}>{SERVER_JOB_STATUS_LABEL[status]}</span>;
}

function Fact({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return <div className="min-w-0">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="break-words text-sm" data-testid={testId}>{children}</dd>
  </div>;
}

function lastText(job: ServerJobView) {
  const last = job.last;
  if (!last) return job.lastNote ?? "Inte kört än";
  const parts = [when(last.finishedAt ?? last.startedAt), durationText(last.durationMs), last.trigger === "manual" ? "Kör nu" : null].filter(Boolean);
  return parts.join(" · ");
}

function JobRow({ job, busy, onPause, onRun }: { job: ServerJobView; busy: boolean; onPause: (job: ServerJobView, paused: boolean) => void; onRun: (job: ServerJobView) => void }) {
  const status = job.running ? "running" : job.last?.status ?? null;
  return <li className="field-group space-y-2 rounded-md border p-3" data-testid={`server-job-${job.key}`} data-paused={job.paused ? "1" : "0"}>
    <div className="flex flex-wrap items-center gap-2">
      <h4 className="min-w-0 flex-1 text-sm font-semibold">{job.name}</h4>
      {job.paused ? <span className={cn("inline-flex shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold", indicatorBadge("neutral"))} data-testid={`server-job-paused-${job.key}`}>Pausat</span> : null}
      {status ? <StatusBadge status={status} testId={`server-job-status-${job.key}`} /> : null}
    </div>
    <p className="text-xs text-muted-foreground">{job.description}</p>
    <dl className="grid gap-2 sm:grid-cols-3">
      <Fact label="Schema" testId={`server-job-schedule-${job.key}`}>{job.schedule}</Fact>
      <Fact label="Senast">{lastText(job)}</Fact>
      <Fact label="Nästa">{job.paused ? "Pausat" : when(job.nextRunAt)}</Fact>
    </dl>
    {job.last?.message ? <p className="break-words text-xs text-muted-foreground" data-testid={`server-job-message-${job.key}`}>{job.last.message}</p> : null}
    {job.controllable ? <div className="flex flex-wrap items-center gap-3 pt-1">
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm" htmlFor={`server-job-switch-${job.key}`}>
        <Switch id={`server-job-switch-${job.key}`} checked={!job.paused} disabled={busy} onCheckedChange={(on) => onPause(job, !on)} data-testid={`server-job-switch-${job.key}`} />
        {job.paused ? "Pausat" : "Igång"}
      </label>
      <Button type="button" size="sm" variant="outline" disabled={busy || job.paused || job.running} onClick={() => onRun(job)} data-testid={`server-job-run-${job.key}`}><Play />Kör nu</Button>
    </div> : null}
  </li>;
}

function BackupPartView({ part, list }: { part: BackupPart; list: BackupList }) {
  const [open, setOpen] = useState(false);
  const copies = list.copies.filter((copy) => copy.part === part);
  const total = BACKUP_KINDS.reduce((sum, kind) => sum + list.totals[part][kind].bytes, 0);
  return <section className="field-group space-y-2 rounded-md border p-3" data-testid={`backup-part-${part}`}>
    <h4 className="text-sm font-semibold">{BACKUP_PART_LABEL[part]}</h4>
    <dl className="grid gap-2 sm:grid-cols-3">
      {BACKUP_KINDS.map((kind) => <Fact key={kind} label={BACKUP_KIND_LABEL[kind]} testId={`backup-total-${part}-${kind}`}>
        {list.totals[part][kind].count} st · {bytesText(list.totals[part][kind].bytes)}
      </Fact>)}
    </dl>
    <p className="text-xs text-muted-foreground">{keepText(list.keep[part])}. Totalt {bytesText(total)}.</p>
    <CollapsibleSection title="Alla kopior" summary={`${copies.length} st`} open={open} onOpenChange={setOpen} testId={`backup-copies-${part}`}>
      {copies.length ? <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr><th className="py-1 pr-3 font-medium">Tid</th><th className="py-1 pr-3 font-medium">Typ</th><th className="py-1 pr-3 font-medium">Storlek</th>{part === "db" ? <th className="py-1 pr-3 font-medium">Lästes tillbaka</th> : null}<th className="py-1 font-medium">Fil</th></tr>
          </thead>
          <tbody>
            {copies.map((copy) => <tr key={`${copy.kind}-${copy.name}`} className="border-t" data-testid="backup-copy">
              <td className="whitespace-nowrap py-1 pr-3">{when(copy.time)}</td>
              <td className="whitespace-nowrap py-1 pr-3">{BACKUP_KIND_LABEL[copy.kind]}</td>
              <td className="whitespace-nowrap py-1 pr-3">{bytesText(copy.bytes)}</td>
              {part === "db" ? <td className="whitespace-nowrap py-1 pr-3">{copy.verified === "pg_restore" ? `Ja${copy.tables ? `, ${copy.tables} tabeller` : ""}` : "–"}</td> : null}
              <td className="break-all py-1 font-mono">{copy.name}</td>
            </tr>)}
          </tbody>
        </table>
      </div> : <p className="text-sm text-muted-foreground">Inga kopior.</p>}
    </CollapsibleSection>
  </section>;
}

function Backups({ list }: { list: BackupList | null }) {
  if (!list) return <p className="text-sm text-muted-foreground" data-testid="backup-list-missing">{BACKUP_LIST_MISSING_TEXT}</p>;
  const age = ageHours(list.generatedAt);
  const offsite = list.status.offsite;
  return <div className="space-y-3" data-testid="backup-list">
    {age !== null && age > BACKUP_LIST_STALE_HOURS ? <p className="text-sm text-danger" role="status">Listan är {age} timmar gammal. Kontrollera att listjobbet på databasservern går.</p> : null}
    <dl className="grid gap-2 sm:grid-cols-3">
      <Fact label="Listan lästes">{when(list.generatedAt)}</Fact>
      <Fact label="Disken med backuperna" testId="backup-disk">{list.disk.usedPercent !== null ? `${list.disk.usedPercent} % använd` : "–"}{list.disk.freeBytes !== null ? ` · ${bytesText(list.disk.freeBytes)} ledigt` : ""}</Fact>
      <Fact label="Kopia på annan plats" testId="backup-offsite">{offsite ? `${offsite.result === "ok" ? "Lyckades" : "Misslyckades"} ${when(offsite.time)}` : list.offsite.configured ? "Ingen kopia än" : "Inte inställd"}</Fact>
    </dl>
    <p className="text-xs text-muted-foreground" data-testid="backup-offsite-keep">{offsiteKeepText(list.offsite)}</p>
    <div className="grid gap-3 lg:grid-cols-2">{BACKUP_PARTS.map((part) => <BackupPartView key={part} part={part} list={list} />)}</div>
    <p className="text-xs text-muted-foreground">Backuperna är krypterade och kan bara läsas, inte ändras, tas bort eller hämtas härifrån.</p>
  </div>;
}

export function ServerJobs({ notify }: { notify?: (text: string, error?: boolean) => void }) {
  const [data, setData] = useState<Answer | null>(null);
  const [state, setState] = useState<"loading" | "idle" | "error">("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setState("loading");
    try { setData(await api<Answer>("/api/superadmin/server-jobs", { cache: "no-store" }, { change: false })); setState("idle"); }
    catch (error) { setMessage((error as Error).message); setState("error"); }
  }, []);
  const [confirm, confirmElement] = useConfirm();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load();
  }, [load]);
  // While a job runs or was just started: read again every few seconds, until it is done.
  const waiting = Boolean(data?.jobs.some((job) => job.running || (job.requestedAt && (!job.last?.startedAt || job.requestedAt > job.last.startedAt) && Date.parse(data.readAt) - Date.parse(job.requestedAt) < 120_000)));
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => void load(true), POLL_MS);
    return () => window.clearInterval(timer);
  }, [waiting, load]);

  const pause = async (job: ServerJobView, paused: boolean) => {
    setBusy(job.key);
    try {
      await api("/api/superadmin/server-jobs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: job.key, paused }) });
      notify?.(paused ? `${job.name} är pausat.` : `${job.name} är igång igen.`);
      await load(true);
    } catch (error) { notify?.((error as Error).message, true); }
    finally { setBusy(null); }
  };
  const run = async (job: ServerJobView) => {
    if (job.confirm) {
      const ok = await confirm({ title: `Köra ${job.name} nu?`, confirmLabel: "Kör nu", message: `${job.description} Jobbet körs direkt, utöver schemat.` });
      if (!ok) return;
    }
    setBusy(job.key);
    try {
      await api("/api/superadmin/server-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: job.key }) });
      notify?.(`${job.name} startas.`);
      await load(true);
    } catch (error) { notify?.((error as Error).message, true); }
    finally { setBusy(null); }
  };

  const appJobs = data?.jobs.filter((job) => job.place === "app") ?? [];
  const serverJobs = data?.jobs.filter((job) => job.place !== "app") ?? [];
  // The Community edition has no database server: its backup is the server's own nightly job, listed among the jobs.
  const withDatabaseServer = data ? data.databaseServer : true;
  return <Panel icon={Clock} title="Serverjobb" description={withDatabaseServer ? "Schemalagda jobb, senaste och nästa körning, och backuperna på databasservern." : "Schemalagda jobb med senaste och nästa körning."}
    actions={<Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={state === "loading"} data-testid="server-jobs-reload"><RefreshCw />Läs igen</Button>}>
    <div className="space-y-5" data-testid="server-jobs" data-state={state}>
      {state === "error" ? <p className="text-sm text-destructive" role="alert">{message}</p> : null}
      {state === "loading" && !data ? <p className="text-sm text-muted-foreground" role="status">Hämtar…</p> : null}
      {data ? <>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Jobb i appen</h3>
          <p className="text-xs text-muted-foreground">Ett pausat jobb hoppas över tills det startas igen. Schemat ändras på servern.</p>
          <ul className="grid gap-3 lg:grid-cols-2">{appJobs.map((job) => <JobRow key={job.key} job={job} busy={busy === job.key} onPause={(item, paused) => void pause(item, paused)} onRun={(item) => void run(item)} />)}</ul>
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Jobb på servrarna</h3>
          <p className="text-xs text-muted-foreground">Jobben körs av servrarna själva. Här kan du bara se dem.</p>
          <ul className="grid gap-3 lg:grid-cols-2">{serverJobs.map((job) => <JobRow key={job.key} job={job} busy onPause={() => undefined} onRun={() => undefined} />)}</ul>
        </section>
        {data.databaseServer ? <section className="space-y-2">
          <h3 className="text-sm font-semibold">Backuper på databasservern</h3>
          <Backups list={data.backups} />
        </section> : null}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Bevakningens gränser</h3>
          <dl className="grid gap-2 sm:grid-cols-2" data-testid="server-job-thresholds">
            {data.thresholds.map((limit) => <Fact key={limit.key} label={limit.label}>{limit.value} {limit.unit}</Fact>)}
          </dl>
          <p className="text-xs text-muted-foreground">Gränserna ändras på servern.</p>
        </section>
      </> : null}
    </div>
    {confirmElement}
  </Panel>;
}
