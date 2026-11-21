"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import { CheckField, Field } from "@/features/kfid/ui";
import { EditorSegmented } from "@/components/editor-ribbon";
import { api } from "@/features/kfid/api";
import { pdfJs } from "@/features/pdf-templates/pdf-page-canvas";
import { announce } from "@/lib/workflow/toast";
import type { DocumentShape } from "@/lib/boards/cards/shapes";
import type { SourceOf } from "@/lib/boards/cards";
import type { BoardCard } from "@/lib/boards/model";
import { Placeholder, useBoardImageUrl } from "../board-card";
import { forgetSourceOptions, useSourceOptions } from "./options";
import { ChartLookFields } from "./trend";

/**
 * Filkorten (2026-11-19). PDF: the chosen page drawn by pdf.js (the same loader as PDF-mallar) to fit the card, or the pages in turn
 * at the chosen interval; the bytes come through Workflow's own route for the board's files. Kalkylblad: the server sends a finished
 * table or chart; here are only the choices. Upload: the same checks and limit as other attachments, at most 10 MB.
 */
type BoardFile = { id: string; name: string; kind: "pdf" | "sheet"; size: number; createdAt: string };

export function PdfBody({ data, source }: { data: DocumentShape; source: SourceOf<"pdf"> | null }) {
  const url = useBoardImageUrl();
  const box = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  // The opened file and a failure are kept with the file they belong to, so a new file starts clean without resetting state in an effect.
  const [opened, setOpened] = useState<{ fileId: string; doc: PDFDocumentProxy } | null>(null);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const doc = opened?.fileId === data.fileId ? opened.doc : null;
  const failed = failedFor === data.fileId;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const first = Math.max(1, source?.page ?? 1);
  const [step, setStep] = useState({ base: first, page: first });
  const wanted = step.base === first ? step.page : first;
  const page = doc ? Math.min(wanted, doc.numPages) : wanted;

  useEffect(() => {
    let active = true;
    let task: PDFDocumentLoadingTask | null = null;
    (async () => {
      try {
        const response = await fetch(url(data.fileId), { credentials: "same-origin" });
        if (!response.ok) throw new Error("fetch");
        const bytes = new Uint8Array(await response.arrayBuffer());
        const pdfjs = await pdfJs();
        if (!active) return;
        task = pdfjs.getDocument({ data: bytes, verbosity: 0 });
        const loaded = await task.promise;
        if (active) setOpened({ fileId: data.fileId, doc: loaded });
      } catch { if (active) setFailedFor(data.fileId); }
    })();
    return () => { active = false; if (task) void task.destroy(); };
  }, [url, data.fileId]);

  useEffect(() => {
    if (!doc || !source?.cycleSeconds || doc.numPages < 2) return;
    const timer = window.setInterval(() => setStep((current) => { const at = current.base === first ? current.page : first; return { base: first, page: at >= doc.numPages ? 1 : at + 1 }; }), source.cycleSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [doc, first, source?.cycleSeconds]);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => { const rect = element.getBoundingClientRect(); setSize({ width: Math.round(rect.width), height: Math.round(rect.height) }); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!doc || !canvas.current || !size.width || !size.height) return;
    let active = true;
    let task: RenderTask | null = null;
    (async () => {
      try {
        const sheet = await doc.getPage(Math.min(page, doc.numPages));
        const base = sheet.getViewport({ scale: 1 });
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        const scale = Math.min(size.width / base.width, size.height / base.height);
        const viewport = sheet.getViewport({ scale: scale * ratio });
        const target = canvas.current;
        if (!active || !target) return;
        target.width = Math.ceil(viewport.width);
        target.height = Math.ceil(viewport.height);
        target.style.width = `${Math.floor(base.width * scale)}px`;
        target.style.height = `${Math.floor(base.height * scale)}px`;
        task = sheet.render({ canvas: target, viewport });
        await task.promise;
      } catch (cause) { if (active && (cause as Error)?.name !== "RenderingCancelledException") setFailedFor(data.fileId); }
    })();
    return () => { active = false; task?.cancel(); };
  }, [doc, page, size, data.fileId]);

  if (failed) return <Placeholder text="PDF-filen kunde inte visas." warn />;
  return <div ref={box} className="relative flex h-full min-h-0 items-center justify-center overflow-hidden" data-testid="board-pdf" data-page={page} data-pages={doc?.numPages ?? 0}>
    <canvas ref={canvas} className="rounded-sm bg-white shadow-sm" role="img" aria-label={`${data.name}, sida ${page}${doc ? ` av ${doc.numPages}` : ""}`} />
    {doc && doc.numPages > 1 ? <span className="absolute bottom-[0.2em] right-[0.2em] rounded bg-background/85 px-[0.35em] text-[0.7em] tabular-nums text-muted-foreground" aria-hidden="true">{page} / {doc.numPages}</span> : null}
  </div>;
}

async function uploadBoardFile(file: File): Promise<{ id: string; name: string; kind: "pdf" | "sheet" }> {
  const form = new FormData();
  form.set("file", file);
  return api("/api/boards/files", { method: "POST", body: form });
}

/** Välj fil: upload a new file, or pick one of the boards' files of the card's kind. */
function FileChoice({ kind, value, onChoose }: { kind: "pdf" | "sheet"; value?: string; onChoose: (id: string) => void }) {
  const id = useId();
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const files = useSourceOptions<BoardFile>("files", undefined, version);
  const fitting = files.items.filter((file) => file.kind === kind);
  return <div className="space-y-3">
    {files.demo ? <p className="text-xs text-muted-foreground" data-testid="card-file-demo">I demon går det inte att ladda upp filer. Med ett eget konto laddar du upp en {kind === "pdf" ? "PDF" : "CSV- eller Excelfil"} här.{fitting.length ? " Prova med exemplet nedan." : ""}</p> : <>
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="outline" size="sm" busy={busy} busyLabel="Laddar upp…">
        <label className="cursor-pointer"><FileUp aria-hidden="true" />{value ? "Ladda upp en annan fil" : "Ladda upp fil"}
          <input type="file" accept={kind === "pdf" ? "application/pdf,.pdf" : ".csv,.tsv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"} className="sr-only" data-testid="card-file-input" onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setBusy(true);
            try {
              const saved = await uploadBoardFile(file);
              if (saved.kind !== kind) throw new Error(kind === "pdf" ? "Välj en PDF-fil." : "Välj en CSV- eller Excelfil.");
              forgetSourceOptions("files");
              setVersion((current) => current + 1);
              onChoose(saved.id);
            } catch (error) { announce(error instanceof Error ? error.message : "Filen kunde inte laddas upp.", true); }
            finally { setBusy(false); }
          }} />
        </label>
      </Button>
    </div>
    <p className="text-xs text-muted-foreground">{kind === "pdf" ? "PDF" : "CSV eller Excel (xlsx)"}, högst 10 MB. Filen sparas bland tavlornas filer i Workflow och kan användas på flera kort.</p>
    </>}
    {fitting.length ? <Field id={`${id}-file`} label="Fil" value={value ?? ""} onChange={(next) => next && onChoose(next)} options={[...(value ? [] : [""]), ...fitting.map((file) => file.id)]}
      optionLabels={{ "": "Välj…", ...Object.fromEntries(fitting.map((file) => [file.id, file.name])) }} /> : null}
  </div>;
}

export function PdfSettings({ source, onSource }: { source: SourceOf<"pdf"> | null; onSource: (source: SourceOf<"pdf">) => void }) {
  const id = useId();
  return <div className="space-y-3">
    <FileChoice kind="pdf" value={source?.fileId} onChoose={(fileId) => onSource({ type: "pdf", ...(source ?? {}), fileId })} />
    {source ? <>
      <Field id={`${id}-page`} label={source.cycleSeconds ? "Börja på sida" : "Sida"} type="number" value={String(source.page ?? 1)} onChange={(value) => { const page = Math.round(Number(value)); onSource({ ...source, page: page > 1 ? Math.min(999, page) : undefined }); }} />
      <CheckField id={`${id}-cycle`} label="Bläddra mellan sidorna" description="Kortet visar sidorna i tur och ordning." testId="card-pdf-cycle" checked={Boolean(source.cycleSeconds)} onChange={(on) => onSource({ ...source, cycleSeconds: on ? 15 : undefined })} />
      {source.cycleSeconds ? <Field id={`${id}-seconds`} label="Sekunder per sida" value={String(source.cycleSeconds)} onChange={(value) => onSource({ ...source, cycleSeconds: Number(value) })} options={["5", "10", "15", "30", "60", "120"]} /> : null}
    </> : null}
  </div>;
}

export function SheetSettings({ card, source, onSource, onChange }: { card: BoardCard; source: SourceOf<"sheet"> | null; onSource: (source: SourceOf<"sheet">) => void; onChange: (card: BoardCard) => void }) {
  const id = useId();
  const columns = useSourceOptions<{ label: string; number: boolean }>("sheet", source?.fileId);
  return <div className="space-y-3">
    <FileChoice kind="sheet" value={source?.fileId} onChoose={(fileId) => onSource({ type: "sheet", view: source?.view ?? "table", fileId })} />
    {source ? <>
      <div className="grid gap-1.5"><span className="field-label text-xs font-medium">Visa som</span>
        <EditorSegmented label="Visa som" value={source.view ?? "table"} onChange={(view) => onSource({ ...source, view })} testId="card-sheet-view"
          options={[{ value: "table", label: "Tabell" }, { value: "chart", label: "Diagram" }]} /></div>
      {source.view === "chart" ? <>
        <Field id={`${id}-label`} label="Etiketter" value={source.labelColumn ?? ""} onChange={(value) => onSource({ ...source, labelColumn: value || undefined })} options={["", ...columns.items.map((column) => column.label)]} optionLabels={{ "": "Första textkolumnen" }} />
        <fieldset className="grid gap-1.5"><legend className="field-label text-xs font-medium">Värden</legend>
          {columns.items.filter((column) => column.number).map((column) => <CheckField key={column.label} id={`${id}-v-${column.label}`} label={column.label} checked={(source.valueColumns ?? []).includes(column.label)}
            onChange={(on) => onSource({ ...source, valueColumns: on ? [...(source.valueColumns ?? []), column.label].slice(0, 6) : (source.valueColumns ?? []).filter((value) => value !== column.label) })} />)}
          {!columns.loading && !columns.items.some((column) => column.number) ? <p className="text-xs text-muted-foreground">Filen har ingen kolumn med bara tal.</p> : <p className="text-xs text-muted-foreground">Inget valt: de tre första kolumnerna med tal.</p>}
        </fieldset>
        <ChartLookFields card={card} onChange={onChange} defaultKind="bar" />
      </> : <p className="text-xs text-muted-foreground">Den första raden med minst två ifyllda celler blir rubriker. Kortet visar så många rader som får plats.</p>}
    </> : null}
  </div>;
}
