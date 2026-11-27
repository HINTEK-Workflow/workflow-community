"use client";

import { ClipboardPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formLeafBlocks, newFormRow, type FormDocument, type FormLeafBlock, type FormTableBlock, type FormValues } from "@/lib/workflow/form-document";
import { AnswerButtons, CameraButton, type AnswerChoice, type FormAttachment, type FormMedia } from "./form-inputs";
import type { FormRowOptions } from "./form-table";
import type { FormActions } from "./form-renderer";
import { checklistTarget, DeviationOrder } from "./deviation-order";
import { indicatorBadge } from "./indicator-tone";

type Answer = { state: "OK" | "NOT_OK" | "NA" | null; comment: string; images?: string[] };
const ASSESSMENT_CHOICES: AnswerChoice[] = [{ value: "OK", text: "OK", tone: "success" }, { value: "NOT_OK", text: "Ej OK", tone: "danger" }, { value: "NA", text: "Ej aktuellt", tone: "neutral" }];
type Row = FormValues["tables"][string][number];

/** The row a point that is not OK becomes in the form's table of deviations: its text, comment and pictures carried over. */
export function deviationRow(table: FormTableBlock, checklistKey: string, item: { id: string; text: string }, answer?: Answer): Row {
  const row = newFormRow(table, `row-${Date.now().toString(36)}`) as Row;
  const text = table.columns.find((column) => column.input === "text");
  const long = table.columns.find((column) => column.input === "textarea");
  const pictures = table.columns.find((column) => column.input === "images");
  if (text) row.cells[text.key] = item.text;
  if (long && answer?.comment) row.cells[long.key] = answer.comment;
  if (pictures && answer?.images?.length) row.cells[pictures.key] = answer.images;
  row.source = { checklist: checklistKey, item: item.id };
  return row;
}

const rowUsed = (row: Row) => Boolean(row.source || row.example || Object.values(row.cells).some((cell) => Array.isArray(cell) ? cell.length > 0 : cell !== null && cell !== undefined && cell !== "" && cell !== false));

/**
 * A checklist of control points judged OK, Ej OK or Ej aktuellt, with a comment on a point that is not OK. With
 * `photos` every point has a camera (2026-09-28); with `deviationTable` a point that is not OK is registered as a
 * deviation row – description, risk, action, responsible and date – in the form's table of deviations (the safety
 * round's "brist"), with the point's comment and pictures carried over.
 */
export function AssessmentChecklist({ block, document, values, onChange, readOnly, attachments = [], media, label, quietLabel = false, rowOptions, actions }: {
  block: Extract<FormLeafBlock, { type: "checklist" }>; document?: FormDocument; values: FormValues; onChange: (values: FormValues) => void; readOnly: boolean; attachments?: FormAttachment[]; media?: FormMedia; label: React.ReactNode; quietLabel?: boolean; rowOptions?: FormRowOptions;
  /** A point that is not OK can become a work order when the checklist has no table of deviations (2026-10-06). */
  actions?: FormActions;
}) {
  const answers = (values.checklists[block.key] ?? {}) as Record<string, Answer>;
  const setItem = (itemId: string, patch: Partial<Answer>) => {
    const current = answers[itemId];
    onChange({ ...values, checklists: { ...values.checklists, [block.key]: { ...answers, [itemId]: { state: current?.state ?? null, comment: current?.comment ?? "", ...(current?.images ? { images: current.images } : {}), ...patch } } } });
  };
  const table = document && block.deviationTable ? formLeafBlocks(document).find((item): item is FormTableBlock => item.type === "table" && item.key === block.deviationTable) : undefined;
  const registered = (itemId: string) => (values.tables[table?.key ?? ""] ?? []).some((row) => row.source?.checklist === block.key && row.source.item === itemId);
  const register = (item: { id: string; text: string }) => {
    if (!table) return;
    const row = deviationRow(table, block.key, item, answers[item.id]);
    // An untouched empty row the table opened with is replaced rather than left above the new one.
    const kept = (values.tables[table.key] ?? []).filter(rowUsed);
    onChange({ ...values, tables: { ...values.tables, [table.key]: rowOptions?.rowsOnTop ? [row, ...kept] : [...kept, row] } });
    window.setTimeout(() => window.document.getElementById(`form-${table.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
  };
  const pictures = (ids: string[]) => ids.map((id) => attachments.find((item) => item.id === id)).filter((item): item is FormAttachment => Boolean(item));
  return <fieldset id={`form-${block.id}`} className="min-w-0 space-y-2" data-testid="form-checklist"><legend className={cn("mb-2 text-sm font-semibold", quietLabel && "sr-only")}>{label}</legend>
    {block.help && !quietLabel ? <p className="text-xs text-muted-foreground">{block.help}</p> : null}
    {block.items.map((item) => {
      const answer = answers[item.id];
      const images = answer?.images ?? [];
      const target = checklistTarget(block.key, item.id);
      const linked = values.workOrders?.[target];
      // Without a table of deviations, the point itself becomes a work order (with one, "Registrera brist" leads there).
      const order = !table && ((answer?.state === "NOT_OK" && actions) || linked) ? <DeviationOrder actions={actions} readOnly={readOnly} targetId={target} existing={linked}
        title={`Åtgärda: ${item.text}`} description={`${block.label}: ${item.text} är inte OK.${answer?.comment?.trim() ? `\n${answer.comment.trim()}` : ""}`}
        fault={[item.text, answer?.comment?.trim()].filter(Boolean).join(" – ")} onLinked={(id) => onChange({ ...values, workOrders: { ...(values.workOrders ?? {}), [target]: id } })} /> : null;
      // Compact rows (2026-09-29): the point, then its camera and answers on the same line. The point keeps at least 12rem
      // (2026-11-26): on a phone the camera and answers go to their own line under it instead of squeezing it to a word per line.
      return <div key={item.id} className={cn("rounded-lg border px-3 py-1.5", answer?.state === "NOT_OK" ? indicatorBadge("danger") : "bg-card")} data-testid="form-checklist-item" data-deviation-target={target}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5"><span className="min-w-0 grow basis-48 break-words text-sm" data-testid="form-checklist-text">{item.text}</span>
          <div className="ml-auto flex items-center gap-1">
            {block.photos && media?.upload && !readOnly ? <CameraButton label={`Bild: ${item.text}`} count={images.length} onUpload={async (file) => { const id = await media.upload!(file); if (id) setItem(item.id, { images: [...images, id] }); }} /> : null}
            <AnswerButtons label={item.text} value={answer?.state} choices={ASSESSMENT_CHOICES} disabled={readOnly} onChange={(state) => setItem(item.id, { state: state as Answer["state"] })} />
          </div>
        </div>
        {answer?.state === "NOT_OK" || answer?.comment || linked ? <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input className="h-9 min-w-48 flex-1" aria-label={`Kommentar: ${item.text}`} placeholder="Kommentar" value={answer?.comment ?? ""} disabled={readOnly} onChange={(event) => setItem(item.id, { comment: event.target.value })} />
          {table && answer?.state === "NOT_OK" ? registered(item.id)
            ? <span className="text-xs font-medium" data-testid="form-deviation-registered">Registrerad under {table.label}</span>
            : !readOnly ? <Button type="button" size="sm" variant="outline" onClick={() => register(item)}><ClipboardPlus />Registrera brist</Button> : null : null}
          {order}
        </div> : null}
        {images.length ? <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`Bilder: ${item.text}`}>{pictures(images).map((picture) => {
          const url = media?.thumbnail?.(picture.id);
          return <li key={picture.id} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- a private attachment behind the session */}
            {url ? <img src={url} alt={picture.filename} className="size-12 rounded-md border object-cover" loading="lazy" /> : <span className="flex size-12 items-center justify-center overflow-hidden rounded-md border bg-muted px-1 text-center text-[9px] leading-tight text-muted-foreground">{picture.filename}</span>}
            {!readOnly ? <button type="button" className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border bg-card text-[10px] text-muted-foreground hover:text-destructive" aria-label={`Ta bort ${picture.filename}`} onClick={() => setItem(item.id, { images: images.filter((id) => id !== picture.id) })}>×</button> : null}
          </li>;
        })}</ul> : null}
      </div>;
    })}
  </fieldset>;
}
