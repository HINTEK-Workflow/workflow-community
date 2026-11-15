"use client";

import { plural } from "@/lib/plural";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ChevronDown, FileSpreadsheet, FileText, FileUp, LoaderCircle, Paperclip, Search, Sparkles, Trash2, Upload, FileStack } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CollapsibleSection, Empty, Panel } from "@/features/kfid/ui";
import { useConfirm } from "@/features/kfid/confirm";
import { api } from "@/features/kfid/api";
import { cn } from "@/lib/utils";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { IMPORT_TARGETS, MAPPABLE_FIELDS, TARGET_FIELDS, TARGET_LABEL, type Detection, type ExtractedFile, type ImportTarget, type PlanItem } from "@/lib/import/detect";
import { PENDING_FORM_IMPORT_KEY, type ImportResult } from "@/lib/workflow/form-import";
import { useLoadEffect } from "@/lib/use-load-effect";
import { CATALOGUE_FIELDS } from "@/lib/catalogue/fields";
import { CatalogueImportCard, CataloguePanel, type CataloguePreview, type PriceOptions } from "@/features/import/catalogue-import";
import { notice } from "@/lib/workflow/toast";
import type { WholesalerId } from "@/lib/wholesale/model";
import { PageHeader } from "@/components/page-shell";
import { useAiAvailable } from "@/features/ai/proposal-client";
import { RemoveButton } from "@/components/ui/remove-button";
import { AbsenceImportCard, EmployeeNumbersCard } from "@/features/import/absence-import";
import type { AbsencePlanAnswer } from "@/lib/payroll/server";

type Plan = { target: ImportTarget; items: PlanItem[]; control?: ImportResult; truncated: boolean; total?: number; catalogue?: CataloguePreview;
  /** Frånvaro och anställningsnummer (2026-10-29): their own previews (features/import/absence-import.tsx). */
  absence?: AbsencePlanAnswer; employeeNumbers?: Parameters<typeof EmployeeNumbersCard>[0]["answer"] };
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
  /** Artiklar och priser (2026-10-12): how the person wants the price file read and parsed, once changed. */
  priceOptions?: PriceOptions;
  /** The wholesaler whose box the file was chosen in (Grossistrutorna, 2026-10-13 natt). */
  wholesaler?: WholesalerId;
};
type SearchHit = { id: string; title: string; kind: string; status?: string };

const ACCEPT = ".xlsx,.xlsm,.csv,.tsv,.txt,.md,.docx,.json,.hwf,.pdf,.png,.jpg,.jpeg,.webp";
const KIND_TARGET: Record<PlanItem["kind"], keyof typeof TARGET_FIELDS> = { customer: "customers", project: "projects", work_order: "work_orders", planned_activity: "planning", competence: "competence" };
/** The Swedish name of a plan field, for the preview (never the English key). */
const fieldLabel = (kind: PlanItem["kind"], key: string) => TARGET_FIELDS[KIND_TARGET[kind]].find((field) => field.key === key)?.label ?? key;
const KIND_LABEL: Record<PlanItem["kind"], string> = { customer: "Kund", project: "Projekt", work_order: "Arbetsorder", planned_activity: "Aktivitet", competence: "Kompetens" };
const percent = (value: number) => `${Math.round(value * 100)} %`;
const TEMPLATES: { target: keyof typeof TARGET_FIELDS; name: string; example: string[] }[] = [
  { target: "customers", name: "kunder", example: ["Anna Andersson", "Elkraft Norr AB", "anna@example.invalid", "070-000 00 00", "", "Elvägen 1", "123 45", "Umeå", ""] },
  { target: "projects", name: "projekt", example: ["Ny elcentral Elvägen 1", "2026-10-05", "2026-10-30", "Elkraft Norr AB", "Byte av central och mätning", "Elvägen 1", "ORD-1001", ""] },
  { target: "work_orders", name: "arbetsordrar", example: ["Byte av elcentral", "Befintlig central byts mot ny", "2026-10-15", "Ny elcentral Elvägen 1", "Elkraft Norr AB", "", ""] },
  { target: "planning", name: "planering", example: ["Montage central", "2026-10-07", "08:00", "16:00", "Ny elcentral Elvägen 1", ""] },
  // Kompetens (2026-10-08): one training per row on a person's competence card (admins); an invented example.
  { target: "competence", name: "kompetens", example: ["Anna Andersson", "Arbete nära spänning", "Påhittad utbildare", "2026-03-15", "2029-03-15", ""] },
];

/** A CSV template with the fields of a kind of import and one example row, made in the browser. */
function templateHref(target: keyof typeof TARGET_FIELDS | "catalogue" | "absence" | "employee_numbers", example: string[]) {
  const quote = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;
  const fields = target === "catalogue" ? CATALOGUE_FIELDS : target === "absence" || target === "employee_numbers" ? MAPPABLE_FIELDS[target]! : TARGET_FIELDS[target];
  const lines = [fields.map((field) => quote(field.label)).join(";"), fields.map((_, index) => quote(example[index] ?? "")).join(";")];
  return `data:text/csv;charset=utf-8,${encodeURIComponent(`﻿${lines.join("\r\n")}\r\n`)}`;
}

/**
 * Import (2026-10-01): one page for every file. The rules – and Workflow AI when the company allows it – say
 * what a file holds and where it belongs; the person answers the questions the page asks, checks the rows and imports.
 * Rows are created with the same tools as the API, MCP and the assistant, so permissions and validation are the app's.
 */
/**
 * `canImportArticles` (2026-10-24, analysens fråga 6): the price-file part – Artiklar och priser as a target, its
 * template and the catalogue panel – is shown and read only for the one who may import articles (catalogue:edit); the
 * server refuses the others anyway, and the page no longer asks it.
 */
export function ImportPage({ canBuildForms = false, canImportArticles = false }: { canBuildForms?: boolean; canImportArticles?: boolean }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [useAi, setUseAi] = useState(true);
  // The box is ticked only when AI is on for the company (kunder2 2026-10-18).
  const aiOn = useAiAvailable();
  const [aiAvailable, setAiAvailable] = useState<{ ok: boolean; reason: string } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [savedFiles, setSavedFiles] = useState<SavedFile[]>([]);
  // Artiklar och priser (2026-10-08): bumped after an import or a removal, so the import cards and the catalogue reload.
  const [catalogueVersion, setCatalogueVersion] = useState(0);
  // Mallar och vad som känns igen starts folded (2026-10-14).
  const [guideOpen, setGuideOpen] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const router = useRouter();

  const update = useCallback((id: string, patch: Partial<Entry> | ((entry: Entry) => Partial<Entry>)) => {
    setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, ...(typeof patch === "function" ? patch(entry) : patch) } : entry)));
  }, []);

  const loadSaved = useCallback(async () => {
    try { setSavedFiles((await api<{ files: SavedFile[] }>("/api/import", { cache: "no-store" })).files); } catch { /* the list is a convenience; the page works without it */ }
  }, []);
  useLoadEffect(loadSaved);

  const analyze = useCallback(async (files: File[], wholesaler?: WholesalerId) => {
    if (!files.length) return;
    setAnalyzing(true); setError("");
    try {
      const form = new FormData();
      for (const file of files.slice(0, 10)) form.append("file", file);
      if (useAi && aiOn) form.set("ai", "1");
      const result = await api<{ files: Analyzed[]; aiAvailable: { ok: boolean; reason: string } }>("/api/import", { method: "POST", body: form });
      setAiAvailable(result.aiAvailable);
      // A file from a wholesaler's box is a price file of that wholesaler: read as Artiklar och priser.
      // Without the right to import articles a file read as a price list gets the rules' next guess instead.
      const targetOf = (detection: Detection): ImportTarget => canImportArticles || detection.target !== "catalogue" ? detection.target
        : detection.candidates.find((item) => item.target !== "catalogue")?.target ?? "unknown";
      const added = result.files.map((item, index): Entry => ({ ...item, original: files[index], target: targetOf(item.detection), mapping: item.detection.mapping, planning: false, attachTo: null, ...(wholesaler && canImportArticles ? { wholesaler } : {}) }));
      setEntries((current) => [...current, ...added]);
      void loadSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Filerna kunde inte analyseras."); } finally { setAnalyzing(false); }
  }, [useAi, aiOn, loadSaved, canImportArticles]);

  const replan = useCallback(async (entry: Entry, target: ImportTarget, mapping: Record<string, string | null> | null, priceOptions?: PriceOptions) => {
    const options = priceOptions ?? entry.priceOptions;
    update(entry.id, { target, ...(mapping ? { mapping } : {}), ...(priceOptions ? { priceOptions } : {}), planning: true, error: "", results: undefined, counts: undefined });
    if (["unknown", "attachment", "forms_file", "hwf_file"].includes(target)) { update(entry.id, { plan: null, planning: false }); return; }
    try {
      const { headers, rows, text, kind, name, mimeType, size, sheet, aiRows, rowCount, truncated } = entry.file;
      // A price list is sent again as the file (prisfil 2026-10-08): it may have tens of thousands of rows, and only the
      // first 1 000 are in the browser. The server reads every row and answers with counts and the first rows.
      let body: BodyInit;
      if (target === "catalogue" && kind === "table" && entry.original) {
        const form = new FormData();
        form.set("action", "plan"); form.set("mapping", JSON.stringify(mapping ?? entry.mapping)); form.set("file", entry.original);
        // Prisfiler etapp 1 (2026-10-12): how the file is read; without columns given, the server suggests them for the new reading.
        if (options) { form.set("format", JSON.stringify(options.format)); form.set("parse", JSON.stringify(options.parse)); }
        if (!mapping) form.set("remap", "1");
        body = form;
      } else body = JSON.stringify({ action: "plan", file: { headers, rows, text, kind, name, mimeType, size, sheet, aiRows, rowCount, truncated }, target, mapping: mapping ?? entry.mapping });
      const result = await api<{ plan: Plan }>("/api/import", { method: "POST", body });
      update(entry.id, { plan: result.plan, planning: false, ...(result.plan.catalogue?.mapping ? { mapping: result.plan.catalogue.mapping } : {}) });
    } catch (cause) { update(entry.id, { planning: false, error: cause instanceof Error ? cause.message : "Planen kunde inte göras." }); }
  }, [update]);
  // A file from a wholesaler's box that the rules did not take for a price list is read as Artiklar och priser, once.
  const routed = useRef(new Set<string>());
  useEffect(() => {
    for (const entry of entries) if (entry.wholesaler && entry.target !== "catalogue" && entry.file.kind === "table" && !routed.current.has(entry.id)) { routed.current.add(entry.id); void replan(entry, "catalogue", null); }
  }, [entries, replan]);

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

  const openInBuilder = useCallback((entry: Entry) => {
    const control = entry.plan?.control;
    if (!control) return;
    try { window.sessionStorage.setItem(PENDING_FORM_IMPORT_KEY, JSON.stringify({ name: entry.file.name.replace(/\.[a-z0-9]+$/i, ""), sections: control.sections, limits: control.limits })); }
    catch { update(entry.id, { error: "Webbläsaren kunde inte lämna över kontrollpunkterna. Importera dem i Skapa formulär (⋯ → Importera kontrollpunkter) i stället." }); return; }
    router.push("/?view=forms&new=1");
  }, [router, update]);

  const onDrop = (event: DragEvent) => { event.preventDefault(); setDragging(false); void analyze([...event.dataTransfer.files]); };

  return <div className="space-y-6" data-testid="import-page">
    <PageHeader title="Import" description="Ladda upp Excel, CSV, Word, text eller en fil från Workflow. Sidan känner igen innehållet och frågar när den är osäker." />

    <Panel icon={Upload} title="Ladda upp filer" description={entries.length || analyzing ? "Kunder, projekt, arbetsordrar, planering, artiklar och priser, kontrollpunkter till ett formulär, formulärfiler eller bilagor." : undefined}>
      <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="import-input" onChange={(event) => { const files = [...(event.target.files ?? [])]; event.target.value = ""; void analyze(files); }} />
      {/* No file yet (open finding 2026-10-09: the empty state was sparse): the shared Empty inside the drop area, with
          what can be imported in one line and the primary action as a real button. Once a file is on the page the
          compact drop area takes its place for more files. */}
      {!entries.length && !analyzing ? <div onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
        className={cn("rounded-xl border-2 border-dashed transition-colors", dragging && "border-primary bg-secondary/60")} data-testid="import-dropzone">
        <ImportEmptyState onPick={() => input.current?.click()} />
      </div> : <div role="button" tabIndex={0} aria-label="Välj filer att importera" onClick={() => input.current?.click()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); input.current?.click(); } }}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
        className={cn("flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors hover:border-primary/50 hover:bg-secondary/40", dragging && "border-primary bg-secondary/60")} data-testid="import-dropzone">
        {analyzing ? <LoaderCircle className="size-7 animate-spin text-primary" /> : <FileUp className="size-7 text-primary" />}
        <p className="text-sm font-medium">{analyzing ? "Analyserar…" : "Släpp filer här eller klicka för att välja"}</p>
        <p className="text-xs text-muted-foreground">{IMPORT_LIMITS}</p>
      </div>}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className={cn("flex items-center gap-2", !aiOn && "text-muted-foreground")}>
          <input type="checkbox" checked={useAi && aiOn} disabled={!aiOn} onChange={(event) => setUseAi(event.target.checked)} /><Sparkles className="size-4 text-primary" />Låt Workflow AI hjälpa till när reglerna är osäkra
        </label>
        {!aiOn ? <span className="text-xs text-muted-foreground" data-testid="import-ai-unavailable">{aiAvailable?.reason || "AI är inte påslagen för företaget."}</span> : aiAvailable && !aiAvailable.ok ? <span className="text-xs text-muted-foreground" data-testid="import-ai-unavailable">{aiAvailable.reason}</span> : null}
      </div>
      {error ? <p role="alert" className={cn("mt-3 rounded-lg border p-3 text-sm", indicatorBadge("danger"))}>{error}</p> : null}
      {/* The templates and what is recognised (2026-10-14: less prominent): the shared CollapsibleSection, folded
          from the start with a one-line summary. */}
      <CollapsibleSection className="mt-4" title="Mallar och vad som känns igen" summary="Mallar (CSV/Excel) för kunder, projekt, arbetsordrar och fler"
        open={guideOpen} onOpenChange={setGuideOpen} testId="import-guide">
        <p className="text-xs text-muted-foreground">Ta en mall eller en egen fil med liknande kolumner. Du ser raderna och kan rätta kolumnerna innan något skapas.</p>
        <ImportGuide canBuildForms={canBuildForms} canImportArticles={canImportArticles} />
      </CollapsibleSection>
    </Panel>

    <SavedFiles files={savedFiles} onChanged={loadSaved} />

    {entries.map((entry) => <FileCard key={entry.id} entry={entry} canBuildForms={canBuildForms} canImportArticles={canImportArticles} catalogueVersion={catalogueVersion} onCatalogueChanged={(text) => { setCatalogueVersion((value) => value + 1); setEntries((current) => current.filter((item) => item.id !== entry.id)); notice(text); }}
      // Artiklar och priser has fields of its own: choosing it guesses its columns afresh (2026-10-08) – from the headings
      // and the content, on the server (2026-10-12).
      onTarget={(target) => void replan(entry, target, target === "catalogue" && entry.target !== "catalogue" ? null : entry.mapping)}
      onMapping={(mapping) => void replan(entry, entry.target, mapping)}
      onReplan={(mapping, options) => void replan(entry, entry.target, mapping, options)}
      onItem={(index, patch) => update(entry.id, (current) => ({ plan: current.plan ? { ...current.plan, items: current.plan.items.map((item) => (item.index === index ? { ...item, ...patch } : item)) } : current.plan }))}
      onApply={() => void apply(entry)} onImportForms={(duplicates) => void importForms(entry, duplicates)} onAttach={() => void attach(entry)} onAttachTo={(task) => update(entry.id, { attachTo: task })}
      onOpenInBuilder={() => openInBuilder(entry)} onRemove={() => setEntries((current) => current.filter((item) => item.id !== entry.id))} />)}

    {canImportArticles ? <CataloguePanel version={catalogueVersion} onChanged={() => setCatalogueVersion((value) => value + 1)} onPick={(files, wholesaler) => { void analyze(files, wholesaler); window.scrollTo({ top: 0, behavior: "smooth" }); }} /> : null}
  </div>;
}

const IMPORT_LIMITS = "Högst 10 filer och 10 MB per fil (Excel och CSV upp till 20 MB, prisfiler upp till 60 MB). Excel, CSV, Word, text, JSON, PDF och bilder.";

/** The Import page before any file (the shared Empty): what can be imported, and Välj filer as the primary action. */
export function ImportEmptyState({ onPick }: { onPick: () => void }) {
  return <Empty title="Inga filer att importera än"
    description="Kunder, projekt, arbetsordrar, planering, kompetens, artiklar och priser, kontrollpunkter och bilagor.">
    <Button type="button" onClick={onPick} data-testid="import-pick"><FileUp />Välj filer</Button>
    <p className="max-w-md text-xs text-muted-foreground">Eller släpp filerna här. {IMPORT_LIMITS}</p>
  </Empty>;
}

/** What the page recognises, with a template where there is one (the CSV templates are made in the browser; the
 * control points template is the form builder's own Excel file, for those who build forms). */
function ImportGuide({ canBuildForms, canImportArticles }: { canBuildForms: boolean; canImportArticles: boolean }) {
  // The table kinds name their columns from the import's own field list, so the guide never drifts from what is read.
  const kinds: { title: string; text: string; download?: { href: string; file: string; label: string } }[] = [
    ...TEMPLATES.map((template) => ({ title: template.name[0].toUpperCase() + template.name.slice(1), text: TARGET_FIELDS[template.target].map((field) => field.label).join(", "),
      download: { href: templateHref(template.target, template.example), file: `mall-${template.name}.csv`, label: "Mall (CSV)" } })),
    ...(!canImportArticles ? [] : [{ title: "Artiklar och priser", text: `${CATALOGUE_FIELDS.map((field) => field.label).join(", ")}. Från ditt företags egna prislistor. Leverantören namnger du själv.`,
      download: { href: templateHref("catalogue", ["12345", "1234567", "", "Installationskabel 3G1,5", "m", "1250,00", "100", "2026-10-01", "12A", ""]), file: "mall-artiklar-och-priser.csv", label: "Mall (CSV)" } }]),
    // Frånvaro (2026-10-29): a file from a time or payroll system; an invented example.
    { title: "Frånvaro", text: "Anställningsnummer eller e-post, frånvarokod, från, till och med, timmar, status. Från ett tid- eller lönesystem.", download: { href: templateHref("absence", ["1001", "", "", "Semester", "2026-11-02", "2026-11-06", "", "", "", "", "Godkänd", ""]), file: "mall-franvaro.csv", label: "Mall (CSV)" } },
    { title: "Kontrollpunkter", text: "Importmallens kolumner (kontrollpunkt, svarstyp …) eller en text med numrerade punkter.", download: canBuildForms ? { href: "/api/forms/admin/import-points", file: "kontrollpunkter-mall.xlsx", label: "Mall (Excel)" } : undefined },
    { title: "Formulärfil och bilagor", text: "En exporterad JSON-fil från Workflow. PDF och bilder sparas och läggs på en uppgift." },
  ];
  return <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
    {kinds.map((kind) => <li key={kind.title} className="flex min-h-full flex-col gap-2 rounded-lg border bg-card p-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{kind.title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{kind.text}</span>
      </span>
      {kind.download ? <a href={kind.download.href} download={kind.download.file} className="mt-auto inline-flex h-8 w-fit items-center gap-1.5 rounded-md border bg-card px-2.5 text-xs font-medium hover:bg-secondary hover:text-primary" aria-label={`${kind.download.label}: ${kind.title.toLowerCase()}`}><FileSpreadsheet className="size-3.5" />{kind.download.label}</a> : null}
    </li>)}
  </ul>;
}

function FileCard({ entry, canBuildForms, canImportArticles, catalogueVersion, onCatalogueChanged, onTarget, onMapping, onReplan, onItem, onApply, onImportForms, onAttach, onAttachTo, onOpenInBuilder, onRemove }: {
  entry: Entry; canBuildForms: boolean; canImportArticles: boolean; catalogueVersion: number; onCatalogueChanged: (text: string) => void; onTarget: (target: ImportTarget) => void; onMapping: (mapping: Record<string, string | null>) => void; onReplan: (mapping: Record<string, string | null> | null, options: PriceOptions) => void; onItem: (index: number, patch: Partial<PlanItem>) => void;
  onApply: () => void; onImportForms: (duplicates: "skip" | "copy") => void; onAttach: () => void; onAttachTo: (task: SearchHit | null) => void; onOpenInBuilder: () => void; onRemove: () => void;
}) {
  const { file, detection, plan, target } = entry;
  // The columns are mapped for the created rows' kinds and for Artiklar och priser.
  const fields = MAPPABLE_FIELDS[target] ?? null;
  // A price file's columns are the ones the server read (headings, or numbered / fixed-width columns), 2026-10-12.
  const columnsOf = target === "catalogue" && plan?.catalogue?.format?.headers ? plan.catalogue.format.headers : file.headers ?? [];
  const fieldMissing = target === "catalogue" ? Boolean(plan?.catalogue?.missing.length) : Boolean(fields?.some((field) => field.required && !entry.mapping[field.key]));
  const rowTotal = file.rowCount ?? file.rows?.length ?? 0;
  const summary = file.kind === "table" ? `Tabell${file.sheet ? ` (blad ${file.sheet})` : ""} · ${rowTotal.toLocaleString("sv-SE")} rader · kolumner: ${(file.headers ?? []).slice(0, 8).join(", ")}${(file.headers?.length ?? 0) > 8 ? " …" : ""}`
    : file.kind === "text" ? `Text · ${plural((file.text ?? "").split(/\r?\n/).filter((line) => line.trim()).length, "rad", "rader")}` : file.kind === "json" ? "JSON-fil" : "Fil som inte kan läsas som text";
  const Icon = file.kind === "table" ? FileSpreadsheet : file.kind === "binary" ? Paperclip : FileText;
  const options = useMemo(() => {
    const seen = new Set<ImportTarget>();
    const list: ImportTarget[] = [];
    for (const candidate of [...detection.candidates.map((item) => item.target), ...(file.kind === "table" ? (["customers", "projects", "work_orders", "planning", "catalogue", "competence", "absence", "control_points"] as const) : file.kind === "text" ? (["work_order_text", "control_points"] as const) : []), "attachment" as const]) if (!seen.has(candidate) && (canImportArticles || candidate !== "catalogue")) { seen.add(candidate); list.push(candidate); }
    return list;
  }, [detection.candidates, file.kind, canImportArticles]);
  const itemsToCreate = plan?.items.filter((item) => !item.skip).length ?? 0;
  const done = Boolean(entry.results);
  return <Panel title={file.name} description={summary} className="overflow-hidden" icon={Icon}
    actions={<RemoveButton label={`Ta bort ${file.name} från listan`} onClick={onRemove} />}>
    <div className="space-y-4" data-testid="import-file">
      {/* What the rules (and the AI) made of it. A plain attachment needs no justification (2026-10-02 found
          the confidence badge, reasons and credit count cluttered for what is just a file to attach somewhere). */}
      {/* A price file says what it is in one line of its own (Rätt fil / Fel fil, 2026-10-14): no second summary here. */}
      {target === "catalogue" && plan?.catalogue ? null : <div className="rounded-lg border bg-muted/20 p-3 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{detection.target === "unknown" ? "Osäkert vad filen innehåller." : `Ser ut som: ${TARGET_LABEL[detection.target]}`}</span>
          {detection.target !== "unknown" && detection.target !== "attachment" ? <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", indicatorBadge(detection.confidence >= 0.8 ? "success" : "warning"))}>{percent(detection.confidence)} säkert</span> : null}
          {entry.ai.used && entry.ai.chargedCredits ? <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"><Sparkles className="size-3" />AI hjälpte till · {entry.ai.chargedCredits} krediter</span> : null}
        </p>
        {detection.reasons.length && detection.target !== "attachment" ? <p className="mt-1 text-xs text-muted-foreground">{detection.reasons.join(" · ")}</p> : null}
        {entry.ai.reason && !entry.ai.used ? <p className="mt-1 text-xs text-muted-foreground">{entry.ai.reason}</p> : null}
      </div>}

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
              <option value="">Annat…</option>{IMPORT_TARGETS.filter((item) => !options.includes(item) && item !== "unknown" && item !== "hwf_file" && item !== "forms_file" && (canImportArticles || item !== "catalogue")).map((item) => <option key={item} value={item}>{TARGET_LABEL[item]}</option>)}
            </select><ChevronDown className="size-3.5" /></label>
        </div>
      </div>

      {/* Column mapping for a table. */}
      {fields && file.kind === "table" ? <details open={fieldMissing} className="field-group rounded-lg border" data-testid="import-mapping">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Kolumner → fält{fieldMissing ? <span className={cn("ml-2 rounded-full px-2 py-0.5 text-xs", indicatorBadge("warning"))}>obligatoriskt fält saknar kolumn</span> : null}</summary>
        <div className="grid gap-2 border-t p-3 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map((field) => <label key={field.key} className="grid gap-1 text-xs font-medium">{field.label}{field.required ? <span className="text-destructive"> *</span> : null}
            <select className="form-select h-9" value={entry.mapping[field.key] ?? ""} onChange={(event) => onMapping({ ...entry.mapping, [field.key]: event.target.value || null })} aria-label={`Kolumn för ${field.label}`}>
              <option value="">– ingen kolumn –</option>{columnsOf.map((header) => <option key={header} value={header}>{header}</option>)}
            </select></label>)}
        </div>
      </details> : null}

      {entry.planning ? <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-4 animate-spin" />{target === "catalogue" ? "Läser prisfilen…" : "Gör en plan…"}</p> : null}
      {/* Only the price list reads more than 1 000 rows (prisfil 2026-10-08); the other kinds say so instead of dropping rows silently. */}
      {file.kind === "table" && target !== "catalogue" && fields && rowTotal > (file.rows?.length ?? 0) ? <p className={cn("rounded-lg border p-3 text-sm", indicatorBadge("warning"))} data-testid="import-row-limit">Filen har {rowTotal.toLocaleString("sv-SE")} rader. Bara de första {(file.rows?.length ?? 0).toLocaleString("sv-SE")} läses för den här sortens import – dela upp filen.</p> : null}
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

      {/* Artiklar och priser (2026-10-08): the supplier, the preview and the import; never through the AI. */}
      {target === "catalogue" && file.kind === "table" ? <CatalogueImportCard file={entry.original} headers={columnsOf} mapping={entry.mapping} preview={entry.planning ? undefined : plan?.catalogue}
        options={entry.priceOptions ?? { format: {}, parse: plan?.catalogue?.parse ?? {} }} onMapping={onMapping} onReplan={onReplan} version={catalogueVersion} onImported={onCatalogueChanged} wholesaler={entry.wholesaler} /> : null}

      {/* Frånvaro och anställningsnummer (2026-10-29): previewed against the company, never through the AI. */}
      {target === "absence" && file.kind === "table" && plan?.absence && !entry.planning ? <AbsenceImportCard file={file} mapping={entry.mapping} answer={plan.absence} /> : null}
      {target === "employee_numbers" && file.kind === "table" && plan?.employeeNumbers && !entry.planning ? <EmployeeNumbersCard file={file} mapping={entry.mapping} answer={plan.employeeNumbers} /> : null}

      {/* A form file → drafts. */}
      {target === "forms_file" ? <div className="flex flex-wrap items-center gap-2 text-sm">
        {canBuildForms ? <><Button type="button" disabled={entry.busy || Boolean(entry.notice)} onClick={() => onImportForms("skip")}><Upload />Importera formulären som utkast</Button><Button type="button" variant="outline" disabled={entry.busy || Boolean(entry.notice)} onClick={() => onImportForms("copy")}>Importera även dubbletter som kopior</Button>
          {entry.notice ? <Link href="/?view=forms" className="text-primary underline underline-offset-4">Öppna Skapa formulär</Link> : null}</>
          : <p className="text-xs text-muted-foreground">Formulärfiler importeras av företagets administratör under Ny uppgift → Importera.</p>}
      </div> : null}

      {target === "hwf_file" ? <p className="rounded-lg border p-3 text-sm text-muted-foreground">En .hwf-fil är en lokal arbetsyta. Öppna den under Lagring → Lokal fil. Den importeras inte här.</p> : null}

      {/* An attachment: pick the task. */}
      {target === "attachment" && entry.saved ? <p role="status" className={cn("rounded-lg border p-3 text-sm", indicatorBadge("success"))} data-testid="import-saved">Filen är sparad under Importerade filer ovanför. Där väljer du själv vilken uppgift den ska ligga på, nu eller senare.</p>
        : target === "attachment" && entry.saveError ? <p role="alert" className={cn("rounded-lg border p-3 text-sm", indicatorBadge("danger"))}>{entry.saveError}</p>
        : target === "attachment" ? <AttachPicker entry={entry} onAttachTo={onAttachTo} onAttach={onAttach} /> : null}

      {/* Rows to create. */}
      {plan && plan.items.length && target !== "control_points" ? <div data-testid="import-plan">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm"><strong>{itemsToCreate}</strong> {itemsToCreate === 1 ? "rad skapas" : "rader skapas"}{plan.items.some((item) => item.skip) ? `, ${plan.items.filter((item) => item.skip).length} hoppas över` : ""}{plan.items.some((item) => item.issues.length) ? ` · ${plan.items.filter((item) => item.issues.length).length} med anmärkning` : ""}{plan.items.some((item) => item.issues.some((issue) => issue.startsWith("ogiltig e-post"))) ? ` · ${plan.items.filter((item) => item.issues.some((issue) => issue.startsWith("ogiltig e-post"))).length} med ogiltig e-post` : ""}{plan.truncated ? ` · bara de första ${plan.items.length} av ${plan.total} raderna åt gången` : ""}</p>
          {!done ? <Button type="button" disabled={entry.busy || !itemsToCreate} onClick={onApply} data-testid="import-apply">{entry.busy ? <LoaderCircle className="animate-spin" /> : <Upload />}Importera {itemsToCreate}</Button> : null}
        </div>
        <div className="mt-2 max-h-96 overflow-auto rounded-lg border">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead><tr className="bg-[var(--panel-header)] text-left text-xs"><th className="w-8 border-b px-2 py-2"><span className="sr-only">Importera</span></th><th className="border-b px-3 py-2 font-semibold">Rad</th><th className="border-b px-3 py-2 font-semibold">Uppgifter</th><th className="border-b px-3 py-2 font-semibold">Anmärkning</th>{done ? <th className="border-b px-3 py-2 font-semibold">Resultat</th> : null}</tr></thead>
            <tbody>{plan.items.map((item) => {
              const result = entry.results?.find((row) => row.index === item.index);
              const details = Object.entries(item.data).filter(([key, value]) => !["name", "title", "projectId", "customerId", "assignedToUserId", "responsibleUserId"].includes(key) && value !== "" && value !== null && value !== undefined).slice(0, 5).map(([key, value]) => `${fieldLabel(item.kind, key)}: ${String(value).slice(0, 60)}`).join(" · ");
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
      </div> : plan && !plan.items.length && !["control_points", "catalogue", "absence", "employee_numbers"].includes(target) && !entry.planning ? <p className="text-sm text-muted-foreground">Inga rader att importera med den här tolkningen.</p> : null}
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
  return <div data-testid="import-saved-files"><Panel icon={FileStack} title="Importerade filer" description="Filer som inte ligger på någon uppgift än. Bara du ser dem.">
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
            <RemoveButton label={`Ta bort ${file.filename}`} disabled={busy} onClick={() => void discard(file)} />
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
