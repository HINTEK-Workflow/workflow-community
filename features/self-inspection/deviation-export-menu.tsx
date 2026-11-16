"use client";

import { FileSpreadsheet, FileText } from "lucide-react";
import { ExportMenu, type ExportSelection } from "@/features/workflow/export-menu";
import { saveBlob } from "@/lib/download";
import {
  createDeviationsPdf, DEVIATION_EXPORT_SECTIONS, deviationEntryLabel, deviationExportFilename, deviationsCsv, exportPhotoIds,
  type DeviationExportFormat, type DeviationExportSections,
} from "@/lib/self-inspection/deviation-export";
import { DEVIATION_STATUSES, DEVIATION_TYPES, deviationType, isIncidentType, type DeviationView } from "@/lib/self-inspection/model";
import type { KitIdentity } from "@/lib/workflow/report-kit";
import { fetchReportFonts } from "@/lib/workflow/report-fonts";
import type { DeviationPhotosApi } from "./deviation-photos";

/**
 * Exportera på Avvikelser (2026-10-30): the shared export window (features/workflow/export-menu.tsx) for the log –
 * the entries the filter shows as choices, the parts to include, PDF and CSV. Cloud makes the file on the server
 * (app/api/self-inspection/deviation-export, which reads the log again with the reader's rights); Local and the demo draw
 * the same file in the browser from what the backend already let them read, like the programme's PDF.
 */
export type DeviationExportRequest = { format: DeviationExportFormat; entries: DeviationView[]; sections: DeviationExportSections; scope?: string };
export type DeviationExporter = (request: DeviationExportRequest) => Promise<void>;

const MIME = { pdf: "application/pdf", csv: "text/csv;charset=utf-8" } as const;

/** The file drawn in the browser (Local, the demo). Photos only where the backend hands out their bytes (`photos`); `identity` is the
 * company's colours, logo and sender when the backend has them (Local), otherwise the name alone (the demo). */
export function browserDeviationExporter(company: string, photos?: DeviationPhotosApi, identity?: () => Promise<KitIdentity>): DeviationExporter {
  return async ({ format, entries, sections, scope }) => {
    const filename = deviationExportFilename(entries, format);
    if (format === "csv") { saveBlob(deviationsCsv(entries, sections), filename, MIME.csv); return; }
    const fontBytes = await fetchReportFonts();
    const bytes = new Map<string, Uint8Array>();
    if (photos && sections.photos !== false) await Promise.all(exportPhotoIds(entries).map(async (id) => {
      try { const response = await fetch(photos.href(id)); if (response.ok) bytes.set(id, new Uint8Array(await response.arrayBuffer())); } catch { /* counted in the PDF */ }
    }));
    const pdf = await createDeviationsPdf({ identity: identity ? await identity() : { company }, fontBytes, entries, sections, photos: bytes, scope });
    // The demo's copy is stamped Demo like its other PDFs (2026-11-16), through the same step as the programme's PDF.
    const { browserPdfCopy } = await import("@/features/demo/demo-pdf");
    const copy = await browserPdfCopy(new Uint8Array(pdf), filename);
    saveBlob(copy.bytes as unknown as BlobPart, copy.filename, MIME.pdf);
  };
}

/** Cloud: the server makes the file; the demo (no server) draws it in the browser. */
export function cloudDeviationExporter(company: string, photos?: DeviationPhotosApi): DeviationExporter {
  return async (request) => {
    if ((window as typeof window & { __workflowDemo?: boolean }).__workflowDemo) return browserDeviationExporter(company, photos)(request);
    const response = await fetch("/api/self-inspection/deviation-export", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ format: request.format, ids: request.entries.map((entry) => entry.id), sections: request.sections, scope: request.scope }) });
    if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || "Exporten kunde inte skapas.");
    saveBlob(await response.blob(), deviationExportFilename(request.entries, request.format), MIME[request.format]);
  };
}

/** The parts offered: Utredning only when a near miss or an accident is among them, Bilder only where photos are kept. */
const sectionsFor = (entries: readonly DeviationView[], photos: boolean) => DEVIATION_EXPORT_SECTIONS.filter((section) =>
  (section.key !== "investigation" || entries.some((entry) => isIncidentType(entry.type))) && (section.key !== "photos" || photos)).map((section) => ({ key: section.key, label: section.label }));
const picked = (selection: ExportSelection): DeviationExportSections => Object.fromEntries(DEVIATION_EXPORT_SECTIONS.map((section) => [section.key, selection.sections[section.key] ?? false]));

/** Exportera for the list: the entries the filter shows, all ticked. */
export function DeviationListExport({ entries, scope, photos, exporter, disabled, testId = "deviations-export" }: { entries: DeviationView[]; scope: string; photos: boolean; exporter: DeviationExporter; disabled?: boolean; testId?: string }) {
  const run = (format: DeviationExportFormat) => async (selection: ExportSelection) => {
    const wanted = new Set(selection.selected);
    await exporter({ format, entries: entries.filter((entry) => wanted.has(entry.id)), sections: picked(selection), scope });
  };
  return <ExportMenu testId={testId} title="Exportera avvikelser" description={`${entries.length} ${entries.length === 1 ? "post" : "poster"} med valt urval (${scope}).`} disabled={disabled || !entries.length}
    choicesLabel="Poster" choices={entries.map((entry) => ({ id: entry.id, title: `${deviationEntryLabel(entry)} · ${entry.title}`,
      detail: [entry.kind === "IMPROVEMENT" ? "" : DEVIATION_TYPES[deviationType(entry.type)], DEVIATION_STATUSES[entry.status]].filter(Boolean).join(" · ") }))}
    sections={sectionsFor(entries, photos)}
    formats={[
      { id: "deviations-pdf", label: "PDF", icon: FileText, primary: true, run: run("pdf") },
      { id: "deviations-csv", label: "CSV (Excel)", icon: FileSpreadsheet, run: run("csv") },
    ]} />;
}

/** Exportera for one entry: the same report with that entry alone. */
export function DeviationEntryExport({ entry, photos, exporter, size, testId = "deviation-export" }: { entry: DeviationView; photos: boolean; exporter: DeviationExporter; size?: "sm"; testId?: string }) {
  return <ExportMenu testId={testId} size={size} title={`Exportera ${deviationEntryLabel(entry).toLowerCase()}`} description={entry.title} sections={sectionsFor([entry], photos)}
    formats={[{ id: "deviation-pdf", label: "PDF", icon: FileText, primary: true, run: async (selection) => exporter({ format: "pdf", entries: [entry], sections: picked(selection) }) }]} />;
}
