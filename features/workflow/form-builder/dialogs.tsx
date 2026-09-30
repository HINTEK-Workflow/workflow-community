"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { AlertTriangle, CheckCircle2, History, Rocket, RotateCcw, Search, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ShowMore } from "@/features/kfid/ui";
import { cn } from "@/lib/utils";
import { formatSwedish } from "@/lib/swedish-time";
import type { EditorDocument } from "@/lib/workflow/form-editor";
import { diffFormVersions, formDisplayName, formPublishChecks, type FormMeta, type PublishIssue } from "@/lib/workflow/form-publish";
import { FormTypeCardContent, FormIcon } from "../form-card";
import { formColorClass } from "../form-colors";
import { indicatorBadge } from "../indicator-tone";
import { request, type TemplateDetail } from "./use-form-draft";

const time = (value: string) => formatSwedish(value, { dateStyle: "short", timeStyle: "short" });
type ListItem = { id: string; name: string; displayName: string; color: string; icon: string; status: TemplateDetail["status"]; publishedVersion: number | null; updatedAt: string; protocols: number; hasDraftChanges: boolean };

export function statusText(status: TemplateDetail["status"], publishedVersion: number | null, changes: boolean) {
  if (status === "PUBLISHED") return `Publicerad v${publishedVersion}${changes ? ` · utkast till v${(publishedVersion ?? 0) + 1}` : ""}`;
  if (status === "UNPUBLISHED") return `Avpublicerad (v${publishedVersion})`;
  return "Utkast";
}

/** A panel sliding in from the right, for Mina formulär and, on smaller screens, the libraries and settings. */
export function SidePanel({ open, onOpenChange, title, description, children, side = "right" }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: ReactNode; side?: "left" | "right" }) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/30" />
      <Dialog.Content className={cn("workspace-modal fixed inset-y-0 z-50 flex w-[26rem] max-w-[92vw] flex-col border bg-card shadow-xl", side === "right" ? "right-0" : "left-0")}>
        <div className="panel-header flex items-start justify-between gap-3 border-b px-5 py-4">
          <div><Dialog.Title className="section-title">{title}</Dialog.Title><Dialog.Description className={description ? "mt-1 text-xs text-muted-foreground" : "sr-only"}>{description ?? title}</Dialog.Description></div>
          <Dialog.Close asChild><Button variant="ghost" size="icon" aria-label="Stäng"><X /></Button></Dialog.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">{children}</div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

/** Mina formulär: 20 at a time from the server, with search and a status filter (bounded lists, 2026-09-26). */
type Original = { id: string; name: string; displayName: string; description: string; icon: string; color: string; publishedVersion: number };

export function FormsPanel({ open, onOpenChange, currentId, onOpen, onOpenOriginal }: { open: boolean; onOpenChange: (open: boolean) => void; currentId: string | null; onOpen: (id: string) => void; onOpenOriginal?: (id: string) => void }) {
  // HINTEK's originals a company has not made its own version of (2026-09-27); empty for HINTEK itself.
  const [originals, setOriginals] = useState<Original[]>([]);
  useEffect(() => {
    if (!open || !onOpenOriginal) return;
    let active = true;
    request<{ originals: Original[] }>("/api/forms/admin?originals=1").then((result) => { if (active) setOriginals(result.originals); }).catch(() => { if (active) setOriginals([]); });
    return () => { active = false; };
  }, [open, onOpenOriginal]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [items, setItems] = useState<ListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async (nextPage: number, append: boolean) => {
    setBusy(true); setError("");
    try {
      const result = await request<{ templates: ListItem[]; total: number; page: number }>(`/api/forms/admin?page=${nextPage}${status ? `&status=${status}` : ""}${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ""}`);
      setItems((current) => append && current ? [...current, ...result.templates] : result.templates);
      setTotal(result.total); setPage(result.page);
    } catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void load(0, false), query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [open, query, status]); // eslint-disable-line react-hooks/exhaustive-deps
  return <SidePanel open={open} onOpenChange={onOpenChange} title="Mina formulär" description="Formulär som ni har skapat eller importerat. Publicerade formulär visas under Ny uppgift – HINTEK:s för alla kunder, ett företags bara hos företaget.">
    <div className="grid gap-3">
      <label className="relative block"><span className="sr-only">Sök formulär</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Sök formulär" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Status">
        {[["", "Alla"], ["DRAFT", "Utkast"], ["PUBLISHED", "Publicerade"], ["UNPUBLISHED", "Avpublicerade"]].map(([value, label]) => <Button key={value} type="button" size="sm" variant={status === value ? "secondary" : "ghost"} aria-pressed={status === value} onClick={() => setStatus(value)}>{label}</Button>)}
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="grid gap-1.5" data-testid="form-list">
        {items === null ? <p role="status" className="text-sm text-muted-foreground">Hämtar formulär…</p> : !items.length ? <p className="text-sm text-muted-foreground">{query || status ? "Inga formulär matchar." : "Inga formulär ännu."}</p>
          : items.map((item) => <button key={item.id} type="button" aria-current={item.id === currentId || undefined} onClick={() => onOpen(item.id)}
            className={cn("flex items-center gap-3 rounded-lg border p-2.5 text-left transition-colors hover:bg-secondary", item.id === currentId ? "border-primary/40 bg-secondary" : "bg-card")}>
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", formColorClass(item.color))}><FormIcon icon={item.icon} className="size-4" /></span>
            <span className="grid min-w-0 gap-0.5">
              <span className="truncate text-sm font-semibold">{item.name}</span>
              <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <Badge variant="outline" className={indicatorBadge(item.status === "PUBLISHED" ? "success" : item.status === "DRAFT" ? "warning" : "neutral")}>{statusText(item.status, item.publishedVersion, item.hasDraftChanges && item.status === "PUBLISHED")}</Badge>
                {item.protocols} protokoll · ändrad {time(item.updatedAt)}
              </span>
            </span>
          </button>)}
      </div>
      {items ? <ShowMore shown={items.length} total={total} busy={busy} onMore={() => void load(page + 1, true)} /> : null}
      {originals.length && onOpenOriginal ? <section className="mt-2 grid gap-1.5 border-t pt-3" aria-label="HINTEK:s formulär" data-testid="form-originals">
        <h3 className="text-sm font-semibold">HINTEK:s formulär</h3>
        <p className="text-xs text-muted-foreground">Ändra ett av HINTEK:s formulär för ert företag. Er första ändring blir ert företags egen version; originalet påverkas inte och ni kan alltid återställa till det.</p>
        {originals.map((item) => <button key={item.id} type="button" onClick={() => onOpenOriginal(item.id)} className="flex items-center gap-3 rounded-lg border bg-card p-2.5 text-left transition-colors hover:bg-secondary">
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", formColorClass(item.color))}><FormIcon icon={item.icon} className="size-4" /></span>
          <span className="grid min-w-0 gap-0.5"><span className="truncate text-sm font-semibold">{item.displayName || item.name}</span><span className="text-xs text-muted-foreground">HINTEK · version {item.publishedVersion}</span></span>
        </button>)}
      </section> : null}
    </div>
  </SidePanel>;
}

function IssueList({ title, issues, tone, onSelect }: { title: string; issues: PublishIssue[]; tone: "danger" | "warning"; onSelect: (issue: PublishIssue) => void }) {
  if (!issues.length) return null;
  return <section className={cn("rounded-lg border p-3 text-sm", indicatorBadge(tone))} aria-label={title}>
    <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4" />{title} ({issues.length})</p>
    <ul className="mt-2 space-y-1">{issues.map((issue, index) => <li key={index}>{issue.blockId || issue.meta
      ? <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => onSelect(issue)}>{issue.message}</button> : issue.message}</li>)}</ul>
  </section>;
}

/**
 * Publicera version N (2026-09-26): checks (errors stop, warnings can be accepted), what changed since the
 * latest version, what it means for existing protocols, and the card under Ny uppgift exactly as customers see it.
 */
type PublishProps = {
  open: boolean; onOpenChange: (open: boolean) => void; meta: FormMeta; document: EditorDocument; detail: TemplateDetail | null; busy: boolean;
  onPublish: (acceptWarnings: boolean) => void; onSelectIssue: (issue: PublishIssue) => void;
};
export function PublishDialog(props: PublishProps) {
  const latest = props.detail?.latest ?? null;
  const changed = useMemo(() => diffFormVersions(latest ? { meta: latest.meta, document: latest.document } : null, { meta: props.meta, document: props.document }).length > 0, [latest, props.meta, props.document]);
  const nextVersion = !latest ? 1 : changed ? latest.version + 1 : latest.version;
  // The body mounts each time the dialog opens, so "Jag har läst varningarna" always starts unticked.
  return <Modal open={props.open} onOpenChange={props.onOpenChange} title={`Publicera version ${nextVersion}`} className="max-w-3xl"><PublishBody {...props} nextVersion={nextVersion} /></Modal>;
}

function PublishBody({ onOpenChange, meta, document, detail, busy, onPublish, onSelectIssue, nextVersion }: PublishProps & { nextVersion: number }) {
  const [accepted, setAccepted] = useState(false);
  const latest = detail?.latest ?? null;
  const checks = useMemo(() => formPublishChecks(meta, document, latest?.document ?? null), [meta, document, latest]);
  const changes = useMemo(() => diffFormVersions(latest ? { meta: latest.meta, document: latest.document } : null, { meta, document }), [meta, document, latest]);
  const protocols = detail?.versions.reduce((sum, version) => sum + version.protocols, 0) ?? 0;
  const blocked = checks.errors.length > 0 || (checks.warnings.length > 0 && !accepted);
  return <div className="grid gap-5 text-sm" data-testid="publish-dialog">
      {checks.errors.length ? null : <p className={cn("flex items-center gap-2 rounded-lg border p-3", indicatorBadge("success"))}><CheckCircle2 className="size-4" />Formuläret kan publiceras.</p>}
      <IssueList title="Måste rättas" issues={checks.errors} tone="danger" onSelect={(issue) => { onOpenChange(false); onSelectIssue(issue); }} />
      <IssueList title="Varningar" issues={checks.warnings} tone="warning" onSelect={(issue) => { onOpenChange(false); onSelectIssue(issue); }} />
      {checks.warnings.length && !checks.errors.length ? <label className="flex items-center gap-2"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />Jag har läst varningarna och vill publicera ändå.</label> : null}
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="grid content-start gap-4">
          <section aria-label="Ändringar"><h3 className="text-sm font-semibold">{detail?.latest ? `Ändringar sedan version ${detail.latest.version}` : "Första versionen"}</h3>
            {changes.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">{changes.slice(0, 30).map((change, index) => <li key={index}>{change.text}</li>)}{changes.length > 30 ? <li>… och {changes.length - 30} till.</li> : null}</ul>
              : <p className="mt-2 text-muted-foreground">Inga ändringar. Version {detail?.latest?.version} publiceras igen.</p>}
          </section>
          <section aria-label="Påverkan" className="rounded-lg border bg-muted/30 p-3"><h3 className="text-sm font-semibold">Påverkan</h3>
            <p className="mt-1 text-muted-foreground">Ändringarna gäller nya uppgifter. {protocols ? `${protocols} befintliga protokoll behåller sin version och ändras inte.` : "Det finns inga protokoll ännu."} Publicerade versioner kan aldrig ändras i efterhand.</p>
          </section>
        </div>
        <section aria-label="Så visas den under Ny uppgift"><h3 className="mb-2 text-sm font-semibold">Så visas den under Ny uppgift</h3>
          <div className="flex min-h-52 flex-col rounded-xl border bg-card p-5 shadow-xs"><FormTypeCardContent form={{ ...meta, name: formDisplayName(meta), version: nextVersion }} /></div>
        </section>
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Avbryt</Button>
        <Button type="button" disabled={blocked || busy} onClick={() => onPublish(accepted)} data-testid="publish-confirm"><Rocket />{busy ? "Publicerar…" : `Publicera version ${nextVersion}`}</Button>
      </div>
    </div>;
}

/** Versions, publication status and the form's history, with Återställ from a published version. */
type VersionsProps = {
  open: boolean; onOpenChange: (open: boolean) => void; detail: TemplateDetail | null; busy: boolean;
  onRestore: (version: number) => void; onUnpublish: () => void; onRepublish: () => void; onDelete: () => void;
};
export function VersionsDialog(props: VersionsProps) {
  if (!props.detail) return null;
  return <Modal open={props.open} onOpenChange={props.onOpenChange} title="Versioner, historik och radering" className="max-w-2xl"><VersionsBody {...props} detail={props.detail} /></Modal>;
}

function VersionsBody({ detail, busy, onRestore, onUnpublish, onRepublish, onDelete }: VersionsProps & { detail: TemplateDetail }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const protocols = detail.versions.reduce((sum, version) => sum + version.protocols, 0);
  return <div className="grid gap-5 text-sm">
      <section aria-label="Versioner" className="grid gap-2">
        {detail.versions.length ? detail.versions.map((version) => <div key={version.version} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5">
          <span><span className="font-semibold">Version {version.version}</span>{version.version === detail.publishedVersion && detail.status === "PUBLISHED" ? <Badge variant="outline" className={cn("ml-2", indicatorBadge("success"))}>Publicerad</Badge> : null}
            <span className="block text-xs text-muted-foreground">{time(version.createdAt)} · {version.protocols} protokoll</span></span>
          {confirm === `restore-${version.version}`
            ? <span className="flex gap-1"><Button type="button" size="sm" disabled={busy} onClick={() => onRestore(version.version)}>Ersätt utkastet</Button><Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(null)}>Avbryt</Button></span>
            : <Button type="button" size="sm" variant="outline" onClick={() => setConfirm(`restore-${version.version}`)}><RotateCcw />Återställ utkastet från version {version.version}</Button>}
        </div>) : <p className="text-muted-foreground">Formuläret har inte publicerats ännu.</p>}
        <p className="text-xs text-muted-foreground">Återställning ersätter bara utkastet. Inget publiceras och inga protokoll ändras.</p>
      </section>
      <div className="flex flex-wrap gap-2">
        {detail.status === "PUBLISHED" ? <Button type="button" variant="outline" disabled={busy} onClick={onUnpublish}>Avpublicera</Button> : null}
        {detail.status === "UNPUBLISHED" ? <Button type="button" variant="outline" disabled={busy} onClick={onRepublish}>Publicera version {detail.publishedVersion} igen</Button> : null}
      </div>
      <p className="text-xs text-muted-foreground">Avpublicering tar bort typen från Ny uppgift. Protokoll, deras data och PDF:er finns alltid kvar.</p>
      {/* Permanent deletion (2026-09-26), also with protocols: every protocol keeps its own copy of the form. */}
      <section aria-label="Radera formuläret" className="rounded-lg border border-destructive/30 p-3">
        <h3 className="text-sm font-semibold">Radera formuläret permanent</h3>
        <p className="mt-1 text-xs text-muted-foreground">Formuläret, alla dess versioner och historiken tas bort och det försvinner från Ny uppgift. Det går inte att ångra.{protocols ? ` De ${protocols} befintliga protokollen raderas inte: de behåller sin egen kopia av formuläret och kan fortfarande öppnas, redigeras och skrivas ut.` : ""}</p>
        <Button type="button" size="sm" variant="destructive" className="mt-2" disabled={busy} onClick={onDelete} data-testid="delete-form"><Trash2 />Radera permanent</Button>
      </section>
      <section aria-label="Historik"><h3 className="flex items-center gap-2 text-sm font-semibold"><History className="size-4" />Historik</h3>
        <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto text-xs">{detail.events.map((event) => <li key={event.id}><span className="font-medium">{event.summary}</span> · {event.actorName} · {time(event.createdAt)}</li>)}</ul>
        <p className="mt-1 text-[11px] text-muted-foreground">De 25 senaste händelserna. Autosparningar visas inte.</p>
      </section>
    </div>;
}
