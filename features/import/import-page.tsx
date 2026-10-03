"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ChevronDown, FileSpreadsheet, FileText, FileUp, LoaderCircle, Paperclip, Search, Sparkles, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/features/kfid/ui";
import { useConfirm } from "@/features/kfid/confirm";
import { api } from "@/features/kfid/api";
import { cn } from "@/lib/utils";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { IMPORT_TARGETS, TARGET_FIELDS, TARGET_LABEL, type Detection, type ExtractedFile, type ImportTarget, type PlanItem } from "@/lib/import/detect";
import { PENDING_FORM_IMPORT_KEY, type ImportResult } from "@/lib/workflow/form-import";
import { MAX_PORTABLE_JSON_BYTES, PENDING_CONTROL_IMPORT_KEY } from "@/lib/kfid/portable";

type Plan = { target: ImportTarget; items: PlanItem[]; control?: ImportResult; truncated: boolean; total?: number };
type AiInfo = { used: boolean; reason?: string; chargedCredits?: number; model?: string };
type SavedFile = { id: string; filename: string; mimeType: string; size: number; createdAt: string };
type Analyzed = { id: string; file: ExtractedFile; detection: Detection; plan: Plan | null; ai: AiInfo; saved?: SavedFile | null; saveError?: string };
type Entry = Analyzed & {
  /** The original file, kept for an attachment upload. */
  original?: File;
  target: ImportTarget;
  mapping: Record<string, string | null>;
  planning: boolean;
  results?: { index: number; title: string; kind: PlanItem["kind"]; ok: boolean; id?: string; url?: string; error?: string; skipped?: boolean }[];
  counts?: { created: number; skipped: number; failed: number };
  busy?: boolean;
  error?: string;
  notice?: string;
  attachTo?: { id: string; title: string; kind: string } | null;
};
type SearchHit = { id: string; title: string; kind: string; status?: string };

const ACCEPT = ".xlsx,.xlsm,.csv,.tsv,.txt,.md,.docx,.json,.hwf,.pdf,.png,.jpg,.jpeg,.webp";
const KIND_LABEL: Record<PlanItem["kind"], string> = { customer: "Kund", project: "Projekt", work_order: "Arbetsorder", planned_activity: "Aktivitet" };
const percent = (value: number) => `${Math.round(value * 100)} %`;
const TEMPLATES: { target: keyof typeof TARGET_FIELDS; name: string; example: string[] }[] = [
  { target: "customers", name: "kunder", example: ["Anna Andersson", "Elkraft Norr AB", "anna@example.invalid", "070-000 00 00", "", "Elvägen 1", "123 45", "Umeå", ""] },
  { target: "projects", name: "projekt", example: ["Ny elcentral Elvägen 1", "2026-10-05", "2026-10-30", "Elkraft Norr AB", "Byte av central och mätning", "Elvägen 1", "ORD-1001", ""] },
  { target: "work_orders", name: "arbetsordrar", example: ["Byte av elcentral", "Befintlig central byts mot ny", "2026-10-15", "Ny elcentral Elvägen 1", "Elkraft Norr AB", "", ""] },
  { target: "planning", name: "planering", example: ["Montage central", "2026-10-07", "08:00", "16:00", "Ny elcentral Elvägen 1", ""] },
];

/** A CSV template with the fields of a kind of import and one example row, made in the browser. */
function templateHref(target: keyof typeof TARGET_FIELDS, example: string[]) {
  const quote = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;
  const lines = [TARGET_FIELDS[target].map((field) => quote(field.label)).join(";"), TARGET_FIELDS[target].map((_, index) => quote(example[index] ?? "")).join(";")];
  return `data:text/csv;charset=utf-8,${encodeURIComponent(`﻿${lines.join("\r\n")}\r\n`)}`;
}

/**
 * Import (2026-10-01): one page for every file. The rules – and Workflow AI when the company allows it – say
 * what a file holds and where it belongs; the person answers the questions the page asks, checks the rows and imports.
 * Rows are created with the same tools as the API, MCP and the assistant, so permissions and validation are the app's.
 */
export function ImportPage({ canBuildForms = false }: { canBuildForms?: boolean }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [useAi, setUseAi] = useState(true);
  const [aiAvailable, setAiAvailable] = useState<{ ok: boolean; reason: string } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [savedFiles, setSavedFiles] = useState<SavedFile[]>([]);
  const input = useRef<HTMLInputElement | null>(null);
  const router = useRouter();

  const update = useCallback((id: string, patch: Partial<Entry> | ((entry: Entry) => Partial<Entry>)) => {
    setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, ...(typeof patch === "function" ? patch(entry) : patch) } : entry)));
  }, []);

  const loadSaved = useCallback(async () => {
    try { setSavedFiles((await api<{ files: SavedFile[] }>("/api/import", { cache: "no-store" })).files); } catch { /* the list is a convenience; the page works without it */ }
  }, []);
  useEffect(() => { void loadSaved(); }, [loadSaved]);

  const analyze = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setAnalyzing(true); setError("");
    try {
      const form = new FormData();
      for (const file of files.slice(0, 10)) form.append("file", file);
      if (useAi) form.set("ai", "1");
      const result = await api<{ files: Analyzed[]; aiAvailable: { ok: boolean; reason: string } }>("/api/import", { method: "POST", body: form });
      setAiAvailable(result.aiAvailable);
      setEntries((current) => [...current, ...result.files.map((item, index): Entry => ({ ...item, original: files[index], target: item.detection.target, mapping: item.detection.mapping, planning: false, attachTo: null }))]);
      void loadSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Filerna kunde inte analyseras."); } finally { setAnalyzing(false); }
  }, [useAi, loadSaved]);

  const replan = useCallback(async (entry: Entry, target: ImportTarget, mapping: Record<string, string | null>) => {
    update(entry.id, { target, mapping, planning: true, error: "", results: undefined, counts: undefined });
    if (["unknown", "attachment", "forms_file", "control_file", "hwf_file"].includes(target)) { update(entry.id, { plan: null, planning: false }); return; }
    try {
      const { headers, rows, text, kind, name, mimeType, size, sheet, aiRows } = entry.file;
      const result = await api<{ plan: Plan }>("/api/import", { method: "POST", body: JSON.stringify({ action: "plan", file: { headers, rows, text, kind, name, mimeType, size, sheet, aiRows }, target, mapping }) });
      update(entry.id, { plan: result.plan, planning: false });
    } catch (cause) { update(entry.id, { planning: false, error: cause instanceof Error ? cause.message : "Planen kunde inte göras." }); }
  }, [update]);

  const apply = useCallback(async (entry: Entry) => {
    if (!entry.plan?.items.length) return;
    update(entry.id, { busy: true, error: "" });
    try {
      const result = await api<{ results: NonNullable<Entry["results"]>; counts: NonNullable<Entry["counts"]> }>("/api/import", { method: "POST", body: JSON.stringify({ action: "apply", items: entry.plan.items }) });
      update(entry.id, { busy: false, results: result.results, counts: result.counts });
    } catch (cause) { update(entry.id, { busy: false, error: cause instanceof Error ? cause.message : "Importen misslyckades." }); }
  }, [update]);

  const importForms = useCallback(async (entry: Entry, duplicates: "skip" | "copy") => {
    update(entry.id, { busy: true, error: "", notice: "" });
    try {
      const result = await api<{ imported: { id: string; name: string }[]; skipped: { id: string; name: string }[]; verified: boolean; exportedBy: string }>("/api/forms/admin", { method: "POST", body: JSON.stringify({ action: "import", file: entry.file.json, duplicates }) });
      const count = (value: number) => (value === 1 ? "1 formulär" : `${value} formulär`);
      update(entry.id, { busy: false, notice: [result.imported.length ? `${count(result.imported.length)} importerades från ${result.exportedBy}${result.verified ? " (verifierad utgivare)" : ""}. De är utkast under Skapa formulär.` : "", result.skipped.length ? `${count(result.skipped.length)} fanns redan och hoppades över.` : ""].filter(Boolean).join(" ") || "Filen innehöll inga formulär." });
    } catch (cause) { update(entry.id, { busy: false, error: cause instanceof Error ? cause.message : "Formulären kunde inte importeras." }); }
  }, [update]);

  const attach = useCallback(async (entry: Entry) => {
    if (!entry.original || !entry.attachTo) return;
    update(entry.id, { busy: true, error: "" });
    try {
      const form = new FormData();
      form.set("taskId", entry.attachTo.id);
      form.set("file", entry.original);
      await api("/api/workflow-task-files", { method: "POST", body: form });
      update(entry.id, { busy: false, notice: `Filen ligger nu som bilaga på ${entry.attachTo.title}.` });
    } catch (cause) { update(entry.id, { busy: false, error: cause instanceof Error ? cause.message : "Bilagan kunde inte laddas upp." }); }
  }, [update]);

  const openControl = useCallback(async (entry: Entry) => {
    try {
      if (!entry.original) throw new Error("no file");
      if (entry.original.size > MAX_PORTABLE_JSON_BYTES) throw new Error("JSON-filen är för stor. Maximal storlek är 2 MB.");
      window.sessionStorage.setItem(PENDING_CONTROL_IMPORT_KEY, await entry.original.text());
    } catch (cause) { update(entry.id, { error: cause instanceof Error && /för stor/.test(cause.message) ? cause.message : "Webbläsaren kunde inte lämna över filen." }); return; }
    router.push("/?view=new&importControl=1");
  }, [router, update]);

  const openInBuilder = useCallback((entry: Entry) => {
    const control = entry.plan?.control;
    if (!control) return;
    try { window.sessionStorage.setItem(PENDING_FORM_IMPORT_KEY, JSON.stringify({ name: entry.file.name.replace(/\.[a-z0-9]+$/i, ""), sections: control.sections, limits: control.limits })); }
    catch { update(entry.id, { error: "Webbläsaren kunde inte lämna över kontrollpunkterna. Importera dem i Skapa formulär (⋯ → Importera kontrollpunkter) i stället." }); return; }
    router.push("/?view=forms&new=1");
  }, [router, update]);

  const onDrop = (event: DragEvent) => { event.preventDefault(); setDragging(false); void analyze([...event.dataTransfer.files]); };

  return <div className="space-y-6" data-testid="import-page">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="page-title">Import</h1>
        <p className="page-description mt-2">Ladda upp Excel, CSV, Word, text eller en fil från Workflow. Sidan känner av vad filen innehåller och var det hör hemma, frågar när den är osäker och skapar sedan raderna med dina egna behörigheter.</p>
      </div>
    </div>

    <Panel title="Ladda upp filer" description="Kunder, projekt, arbetsordrar, planering, kontrollpunkter till ett formulär, formulärfiler eller bilagor.">
      <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="import-input" onChange={(event) => { const files = [...(event.target.files ?? [])]; event.target.value = ""; void analyze(files); }} />
      <div role="button" tabIndex={0} aria-label="Välj filer att importera" onClick={() => input.current?.click()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); input.current?.click(); } }}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
        className={cn("flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors hover:border-primary/50 hover:bg-secondary/40", dragging && "border-primary bg-secondary/60")} data-testid="import-dropzone">
        {analyzing ? <LoaderCircle className="size-7 animate-spin text-primary" /> : <FileUp className="size-7 text-primary" />}
        <p className="text-sm font-medium">{analyzing ? "Analyserar…" : "Släpp filer här eller klicka för att välja"}</p>
        <p className="text-xs text-muted-foreground">Högst 10 filer och 10 MB per fil. Excel, CSV, Word, text, JSON, PDF och bilder.</p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className={cn("flex items-center gap-2", aiAvailable && !aiAvailable.ok && "text-muted-foreground")}>
          <input type="checkbox" checked={useAi} onChange={(event) => setUseAi(event.target.checked)} /><Sparkles className="size-4 text-primary" />Låt Workflow AI hjälpa till när reglerna är osäkra
        </label>
        {aiAvailable && !aiAvailable.ok ? <span className="text-xs text-muted-foreground" data-testid="import-ai-unavailable">{aiAvailable.reason}</span> : null}
      </div>
      {error ? <p role="alert" className={cn("mt-3 rounded-lg border p-3 text-sm", indicatorBadge("danger"))}>{error}</p> : null}
      <details className="mt-4 rounded-lg border bg-muted/20 p-3 text-sm">
        <summary className="cursor-pointer font-medium">Mallar och vad som känns igen</summary>
        <ul className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
          <li><strong className="text-foreground">Kunder:</strong> kolumner som Namn, Företag, E-post, Telefon, Adress, Postnummer, Ort.</li>
          <li><strong className="text-foreground">Projekt:</strong> Projektnamn, Startdatum, Slutdatum, Kund, Arbetsplats, Referens, Ansvarig.</li>
          <li><strong className="text-foreground">Arbetsordrar:</strong> Rubrik, Beskrivning, Klart senast, Projekt, Kund, Ansvarig.</li>
          <li><strong className="text-foreground">Planering:</strong> Aktivitet, Datum, Start, Slut, Projekt.</li>
          <li><strong className="text-foreground">Kontrollpunkter:</strong> importmallens kolumner (kontrollpunkt, svarstyp …) eller en text med numrerade punkter.</li>
          <li><strong className="text-foreground">Formulärfil:</strong> en exporterad JSON-fil från Workflow. <strong className="text-foreground">Bilaga:</strong> PDF och bilder läggs på en uppgift.</li>
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">{TEMPLATES.map((template) => <a key={template.target} href={templateHref(template.target, template.example)} download={`mall-${template.name}.csv`} className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-card px-2.5 text-xs font-medium hover:bg-secondary"><FileSpreadsheet className="size-3.5" />Mall: {template.name}</a>)}</div>
      </details>
    </Panel>

    <SavedFiles files={savedFiles} onChanged={loadSaved} />

    {entries.map((entry) => <FileCard key={entry.id} entry={entry} canBuildForms={canBuildForms}
      onTarget={(target) => void replan(entry, target, entry.mapping)}
      onMapping={(mapping) => void replan(entry, entry.target, mapping)}
      onItem={(index, patch) => update(entry.id, (current) => ({ plan: current.plan ? { ...current.plan, items: current.plan.items.map((item) => (item.index === index ? { ...item, ...patch } : item)) } : current.plan }))}
      onApply={() => void apply(entry)} onImportForms={(duplicates) => void importForms(entry, duplicates)} onAttach={() => void attach(entry)} onAttachTo={(task) => update(entry.id, { attachTo: task })}
      onOpenInBuilder={() => openInBuilder(entry)} onOpenControl={() => void openControl(entry)} onRemove={() => setEntries((current) => current.filter((item) => item.id !== entry.id))} />)}
  </div>;
}

function FileCard({ entry, canBuildForms, onTarget, onMapping, onItem, onApply, onImportForms, onAttach, onAttachTo, onOpenInBuilder, onOpenControl, onRemove }: {
  entry: Entry; canBuildForms: boolean; onTarget: (target: ImportTarget) => void; onMapping: (mapping: Record<string, string | null>) => void; onItem: (index: number, patch: Partial<PlanItem>) => void;
  onApply: () => void; onImportForms: (duplicates: "skip" | "copy") => void; onAttach: () => void; onAttachTo: (task: SearchHit | null) => void; onOpenInBuilder: () => void; onOpenControl: () => void; onRemove: () => void;
}) {
  const { file, detection, plan, target } = entry;
  const tableTarget = target in TARGET_FIELDS ? (target as keyof typeof TARGET_FIELDS) : null;
  const summary = file.kind === "table" ? `Tabell${file.sheet ? ` (blad ${file.sheet})` : ""} · ${file.rows?.length ?? 0} rader · kolumner: ${(file.headers ?? []).slice(0, 8).join(", ")}${(file.headers?.length ?? 0) > 8 ? " …" : ""}`
    : file.kind === "text" ? `Text · ${(file.text ?? "").split(/\r?\n/).filter((line) => line.trim()).length} rader` : file.kind === "json" ? "JSON-fil" : "Fil som inte kan läsas som text";
  const Icon = file.kind === "table" ? FileSpreadsheet : file.kind === "binary" ? Paperclip : FileText;
  const options = useMemo(() => {
    const seen = new Set<ImportTarget>();
    const list: ImportTarget[] = [];
    for (const candidate of [...detection.candidates.map((item) => item.target), ...(file.kind === "table" ? (["customers", "projects", "work_orders", "planning", "control_points"] as const) : file.kind === "text" ? (["work_order_text", "control_points"] as const) : []), "attachment" as const]) if (!seen.has(candidate)) { seen.add(candidate); list.push(candidate); }
    return list;
  }, [detection.candidates, file.kind]);
  const itemsToCreate = plan?.items.filter((item) => !item.skip).length ?? 0;
  const done = Boolean(entry.results);
  return <Panel title={file.name} description={summary} className="overflow-hidden" leadingActions={<span className="panel-icon flex size-9 items-center justify-center rounded-lg"><Icon className="size-4" /></span>}
    actions={<Button type="button" variant="ghost" size="icon" aria-label={`Ta bort ${file.name} från listan`} onClick={onRemove}><X /></Button>}>
    <div className="space-y-4" data-testid="import-file">
      {/* What the rules (and the AI) made of it. A plain attachment needs no justification (2026-10-02 found
          the confidence badge, reasons and credit count cluttered for what is just a file to attach somewhere). */}
      <div className="rounded-lg border bg-muted/20 p-3 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{detection.target === "unknown" ? "Osäkert vad filen innehåller." : `Ser ut som: ${TARGET_LABEL[detection.target]}`}</span>
          {detection.target !== "unknown" && detection.target !== "attachment" ? <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", indicatorBadge(detection.confidence >= 0.8 ? "success" : "warning"))}>{percent(detection.confidence)} säkert</span> : null}
          {entry.ai.used && entry.ai.chargedCredits ? <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"><Sparkles className="size-3" />AI hjälpte till · {entry.ai.chargedCredits} krediter</span> : null}
        </p>
        {detection.reasons.length && detection.target !== "attachment" ? <p className="mt-1 text-xs text-muted-foreground">{detection.reasons.join(" · ")}</p> : null}
        {entry.ai.reason && !entry.ai.used ? <p className="mt-1 text-xs text-muted-foreground">{entry.ai.reason}</p> : null}
      </div>

      {/* The question, as buttons to click (2026-10-02): what is this? */}
      <div data-testid="import-target">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{detection.target === "unknown" && target === "unknown" ? "Vad innehåller filen?" : "Importeras som"}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {options.map((option) => <button key={option} type="button" aria-pressed={target === option} onClick={() => onTarget(option)}
            className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition-colors", target === option ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/40 hover:bg-secondary hover:text-primary")}>
            {TARGET_LABEL[option]}{detection.candidates.find((item) => item.target === option) && option !== detection.target ? ` (${percent(detection.candidates.find((item) => item.target === option)!.confidence)})` : ""}
          </button>)}
          <label className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1.5 text-xs font-medium"><span className="sr-only">Annat</span>
            <select className="bg-transparent outline-none" value={options.includes(target) ? "" : target} onChange={(event) => { if (event.target.value) onTarget(event.target.value as ImportTarget); }} aria-label="Annat innehåll">
              <option value="">Annat…</option>{IMPORT_TARGETS.filter((item) => !options.includes(item) && item !== "unknown" && item !== "hwf_file" && item !== "forms_file" && item !== "control_file").map((item) => <option key={item} value={item}>{TARGET_LABEL[item]}</option>)}
            </select><ChevronDown className="size-3.5" /></label>
        </div>
      </div>

      {/* Column mapping for a table. */}
      {tableTarget && file.kind === "table" ? <details open={TARGET_FIELDS[tableTarget].some((field) => field.required && !entry.mapping[field.key])} className="rounded-lg border" data-testid="import-mapping">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Kolumner → fält{TARGET_FIELDS[tableTarget].some((field) => field.required && !entry.mapping[field.key]) ? <span className={cn("ml-2 rounded-full px-2 py-0.5 text-xs", indicatorBadge("warning"))}>obligatoriskt fält saknar kolumn</span> : null}</summary>
        <div className="grid gap-2 border-t p-3 sm:grid-cols-2 lg:grid-cols-3">
          {TARGET_FIELDS[tableTarget].map((field) => <label key={field.key} className="grid gap-1 text-xs font-medium">{field.label}{field.required ? <span className="text-destructive"> *</span> : null}
            <select className="form-select h-9" value={entry.mapping[field.key] ?? ""} onChange={(event) => onMapping({ ...entry.mapping, [field.key]: event.target.value || null })} aria-label={`Kolumn för ${field.label}`}>
              <option value="">– ingen kolumn –</option>{(file.headers ?? []).map((header) => <option key={header} value={header}>{header}</option>)}
            </select></label>)}
        </div>
      </details> : null}

      {entry.planning ? <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-4 animate-spin" />Gör en plan…</p> : null}
      {entry.error ? <p role="alert" className={cn("rounded-lg border p-3 text-sm", indicatorBadge("danger"))}>{entry.error}</p> : null}
      {entry.notice ? <p role="status" className={cn("rounded-lg border p-3 text-sm", indicatorBadge("success"))}>{entry.notice}</p> : null}

      {/* Control points → the form builder. */}
      {target === "control_points" && plan?.control ? <div className="rounded-lg border p-3 text-sm" data-testid="import-control-points">
        <p><strong>{plan.control.points} kontrollpunkter</strong> i {plan.control.sections.length} avsnitt{plan.control.limits.length ? `, ${plan.control.limits.length} gränsvärden` : ""}.</p>
        <ul className="mt-1 text-xs text-muted-foreground">{plan.control.sections.slice(0, 8).map((section) => <li key={section.id}>• {section.title}: {section.blocks.length} block</li>)}</ul>
        {plan.control.issues.length ? <p className="mt-2 text-xs text-amber-700">{plan.control.issues.slice(0, 3).join(" ")}</p> : null}
        {canBuildForms ? <Button type="button" className="mt-3" onClick={onOpenInBuilder}><FileSpreadsheet />Öppna i Skapa formulär</Button>
          : <p className="mt-2 text-xs text-muted-foreground">Kontrollpunkter blir ett formulär i Skapa formulär, som företagets administratör bygger och publicerar.</p>}
      </div> : null}

      {/* A form file → drafts. */}
      {target === "forms_file" ? <div className="flex flex-wrap items-center gap-2 text-sm">
        {canBuildForms ? <><Button type="button" disabled={entry.busy || Boolean(entry.notice)} onClick={() => onImportForms("skip")}><Upload />Importera formulären som utkast</Button><Button type="button" variant="outline" disabled={entry.busy || Boolean(entry.notice)} onClick={() => onImportForms("copy")}>Importera även dubbletter som kopior</Button>
          {entry.notice ? <Link href="/?view=forms" className="text-primary underline underline-offset-4">Öppna Skapa formulär</Link> : null}</>
          : <p className="text-xs text-muted-foreground">Formulärfiler importeras av företagets administratör under Ny uppgift → Importera.</p>}
      </div> : null}

      {/* A control's JSON file → the control editor shows what it holds before anything is saved. */}
      {target === "control_file" ? <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button type="button" disabled={entry.busy} onClick={onOpenControl}><Upload />Öppna i Kontroll före idrifttagning</Button>
        <p className="w-full text-xs text-muted-foreground">Kontrollen visas först som förhandsgranskning. Inget sparas förrän du sparar kontrollen; bilder och kundkoppling följer inte med filen.</p>
      </div> : null}

      {target === "hwf_file" ? <p className="rounded-lg border p-3 text-sm text-muted-foreground">En .hwf-fil är en lokal arbetsyta. Öppna den under Lagring → Lokal fil, eller läs in den i Cloud via Mitt företag → Cloud-import. Den importeras inte här.</p> : null}

      {/* An attachment: pick the task. */}
      {target === "attachment" && entry.saved ? <p role="status" className={cn("rounded-lg border p-3 text-sm", indicatorBadge("success"))} data-testid="import-saved">Filen är sparad under Importerade filer ovanför. Där väljer du själv vilken uppgift den ska ligga på, nu eller senare.</p>
        : target === "attachment" && entry.saveError ? <p role="alert" className={cn("rounded-lg border p-3 text-sm", indicatorBadge("danger"))}>{entry.saveError}</p>
        : target === "attachment" ? <AttachPicker entry={entry} onAttachTo={onAttachTo} onAttach={onAttach} /> : null}

      {/* Rows to create. */}
      {plan && plan.items.length && target !== "control_points" ? <div data-testid="import-plan">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm"><strong>{itemsToCreate}</strong> {itemsToCreate === 1 ? "rad skapas" : "rader skapas"}{plan.items.some((item) => item.skip) ? `, ${plan.items.filter((item) => item.skip).length} hoppas över` : ""}{plan.items.some((item) => item.issues.length) ? ` · ${plan.items.filter((item) => item.issues.length).length} med anmärkning` : ""}{plan.truncated ? ` · bara de första ${plan.items.length} av ${plan.total} raderna åt gången` : ""}</p>
          {!done ? <Button type="button" disabled={entry.busy || !itemsToCreate} onClick={onApply} data-testid="import-apply">{entry.busy ? <LoaderCircle className="animate-spin" /> : <Upload />}Importera {itemsToCreate}</Button> : null}
        </div>
        <div className="mt-2 max-h-96 overflow-auto rounded-lg border">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead><tr className="bg-[var(--panel-header)] text-left text-xs"><th className="w-8 border-b px-2 py-2"><span className="sr-only">Importera</span></th><th className="border-b px-3 py-2 font-semibold">Rad</th><th className="border-b px-3 py-2 font-semibold">Uppgifter</th><th className="border-b px-3 py-2 font-semibold">Anmärkning</th>{done ? <th className="border-b px-3 py-2 font-semibold">Resultat</th> : null}</tr></thead>
            <tbody>{plan.items.map((item) => {
              const result = entry.results?.find((row) => row.index === item.index);
              const details = Object.entries(item.data).filter(([key, value]) => !["name", "title", "projectId", "customerId", "assignedToUserId", "responsibleUserId"].includes(key) && value !== "" && value !== null && value !== undefined).slice(0, 5).map(([key, value]) => `${key}: ${String(value).slice(0, 60)}`).join(" · ");
              return <tr key={item.index} className={cn("border-b last:border-b-0", item.skip && "text-muted-foreground")} data-testid="import-row">
                <td className="px-2 py-1.5 align-top"><input type="checkbox" aria-label={`Importera ${item.title}`} checked={!item.skip} disabled={done} onChange={(event) => onItem(item.index, { skip: !event.target.checked })} /></td>
                <td className="px-3 py-1.5 align-top"><span className="font-medium">{item.title}</span><span className="block text-[11px] text-muted-foreground">{KIND_LABEL[item.kind]} · rad {item.index + 2}</span></td>
                <td className="px-3 py-1.5 align-top text-xs text-muted-foreground">{details || "–"}</td>
                <td className="px-3 py-1.5 align-top text-xs">
                  {item.duplicateOf ? <span className="block"><span className={cn("rounded-full px-2 py-0.5", indicatorBadge("warning"))}>Finns redan: {item.duplicateOf.name}</span>{!done ? <span className="ml-2 inline-flex gap-1"><button type="button" className={cn("rounded-md border px-1.5 py-0.5", item.skip && "bg-secondary font-medium")} onClick={() => onItem(item.index, { skip: true })}>Hoppa över</button><button type="button" className={cn("rounded-md border px-1.5 py-0.5", !item.skip && "bg-secondary font-medium")} onClick={() => onItem(item.index, { skip: false })}>Skapa ändå</button></span> : null}</span> : null}
                  {item.issues.map((issue) => <span key={issue} className="block text-amber-700">{issue}</span>)}
                </td>
                {done ? <td className="px-3 py-1.5 align-top text-xs">{result?.skipped ? "Överhoppad" : result?.ok ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="size-3.5" />{result.url ? <Link href={result.url} className="underline underline-offset-4">Skapad – öppna</Link> : "Skapad"}</span> : result ? <span className="inline-flex items-center gap-1 text-destructive"><AlertTriangle className="size-3.5" />{result.error}</span> : "–"}</td> : null}
              </tr>;
            })}</tbody>
          </table>
        </div>
        {entry.counts ? <p className={cn("mt-2 rounded-lg border p-3 text-sm", indicatorBadge(entry.counts.failed ? "warning" : "success"))} data-testid="import-result">{entry.counts.created} skapade, {entry.counts.skipped} överhoppade, {entry.counts.failed} misslyckade.</p> : null}
      </div> : plan && !plan.items.length && target !== "control_points" && !entry.planning ? <p className="text-sm text-muted-foreground">Inga rader att importera med den här tolkningen.</p> : null}
    </div>
  </Panel>;
}

const sizeText = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} kB`);

/** The person's own saved files that have no task yet (2026-10-02: the file is saved first, the person chooses where later). */
function SavedFiles({ files, onChanged }: { files: SavedFile[]; onChanged: () => Promise<void> }) {
  const [confirm, confirmElement] = useConfirm();
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<SearchHit | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  if (!files.length && !message) return null;
  const attach = async (file: SavedFile) => {
    if (!picked) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api<{ taskTitle: string }>("/api/import", { method: "POST", body: JSON.stringify({ action: "attach", id: file.id, taskId: picked.id }) });
      setMessage(`${file.filename} ligger nu som bilaga på ${result.taskTitle}.`); setOpen(null); setPicked(null);
      await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Bilagan kunde inte läggas på uppgiften."); } finally { setBusy(false); }
  };
  const discard = async (file: SavedFile) => {
    if (!(await confirm({ title: "Ta bort filen?", message: `${file.filename} tas bort för gott. Den ligger inte på någon uppgift.`, confirmLabel: "Ta bort", tone: "danger" }))) return;
    setBusy(true); setError(""); setMessage("");
    try { await api("/api/import", { method: "POST", body: JSON.stringify({ action: "discard", id: file.id }) }); await onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Filen kunde inte tas bort."); } finally { setBusy(false); }
  };
  return <div data-testid="import-saved-files"><Panel title="Importerade filer" description="Sparade filer som inte ligger på någon uppgift än. Bara du ser dem. Välj själv vilken uppgift de ska på; oanvända rensas med företagets lagringstid.">
    <div className="space-y-3">
      {message ? <p role="status" className={cn("rounded-lg border p-3 text-sm", indicatorBadge("success"))}>{message}</p> : null}
      {error ? <p role="alert" className={cn("rounded-lg border p-3 text-sm", indicatorBadge("danger"))}>{error}</p> : null}
      <ul className="divide-y rounded-lg border">
        {files.map((file) => <li key={file.id} className="p-3" data-testid="import-saved-file">
          <div className="flex flex-wrap items-center gap-2">
            <Paperclip className="size-4 text-primary" />
            <a href={`/api/import?file=${encodeURIComponent(file.id)}`} className="min-w-0 flex-1 truncate font-medium underline-offset-4 hover:underline">{file.filename}</a>
            <span className="text-xs text-muted-foreground">{sizeText(file.size)}</span>
            <Button type="button" size="sm" variant={open === file.id ? "secondary" : "default"} disabled={busy} onClick={() => { setOpen(open === file.id ? null : file.id); setPicked(null); }}>Lägg på uppgift</Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} aria-label={`Ta bort ${file.filename}`} onClick={() => void discard(file)}><Trash2 /></Button>
          </div>
          {open === file.id ? <TaskPicker picked={picked} onPick={setPicked} busy={busy} actionLabel="Lägg som bilaga" onAction={() => void attach(file)} /> : null}
        </li>)}
      </ul>
    </div>
    {confirmElement}
  </Panel></div>;
}

/** A file picked on the page itself (not saved first): the task search, then one click. */
function AttachPicker({ entry, onAttachTo, onAttach }: { entry: Entry; onAttachTo: (task: SearchHit | null) => void; onAttach: () => void }) {
  return <div className="rounded-lg border p-3 text-sm" data-testid="import-attach">
    <p className="font-medium">Lägg filen som bilaga på en uppgift</p>
    <p className="mt-1 text-xs text-muted-foreground">Sök en arbetsorder, riskbedömning eller ett protokoll. Bilagor sparas på uppgiften och följer med i rapporten.</p>
    <TaskPicker picked={entry.attachTo ?? null} onPick={onAttachTo} busy={Boolean(entry.busy) || Boolean(entry.notice)} actionLabel="Ladda upp som bilaga" onAction={onAttach} />
  </div>;
}

/** Which task a file goes on: the shared search, then one click. */
function TaskPicker({ picked, onPick, busy, actionLabel, onAction }: { picked: SearchHit | null; onPick: (task: SearchHit | null) => void; busy: boolean; actionLabel: string; onAction: () => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    let active = true;
    // The search waits a moment after typing; the state follows the answer, not the effect itself.
    const timer = window.setTimeout(() => {
      if (query.trim().length < 2) { setHits([]); setSearching(false); return; }
      setSearching(true);
      fetch(`/api/workflow-search?q=${encodeURIComponent(query.trim())}`, { cache: "no-store" }).then((response) => (response.ok ? response.json() : { tasks: [] })).then((data: { tasks?: SearchHit[] }) => { if (active) setHits((data.tasks ?? []).slice(0, 8)); }).catch(() => undefined).finally(() => { if (active) setSearching(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query]);
  return <div>
    <div className="relative mt-2"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Sök uppgift…" className="pl-9" aria-label="Sök uppgift att lägga bilagan på" /></div>
    {searching ? <p className="mt-2 text-xs text-muted-foreground">Söker…</p> : null}
    {hits.length ? <ul className="mt-2 divide-y rounded-lg border">{hits.map((hit) => <li key={hit.id}><button type="button" className={cn("flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-secondary", picked?.id === hit.id && "bg-secondary")} onClick={() => onPick(hit)}><span className="min-w-0 flex-1 truncate">{hit.title}</span><span className="text-xs text-muted-foreground">{hit.kind === "WORK_ORDER" ? "Arbetsorder" : hit.kind === "RISK_ASSESSMENT" ? "Riskbedömning" : "Protokoll"}</span></button></li>)}</ul> : null}
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button type="button" disabled={!picked || busy} onClick={onAction}><Paperclip />{actionLabel}{picked ? ` på ${picked.title}` : ""}</Button>
      {picked ? <Button type="button" variant="ghost" size="sm" onClick={() => onPick(null)}><Trash2 />Välj annan</Button> : null}
    </div>
  </div>;
}
