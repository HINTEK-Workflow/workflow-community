"use client";

import { useRef, useState, type ReactNode } from "react";
import { Camera, ImageIcon, LoaderCircle, MessageSquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formLimitText, type FormBand, type FormLeafBlock, type FormLimitValue, type FormValues } from "@/lib/workflow/form-document";
import { formatSwedish } from "@/lib/swedish-time";
import { indicatorBadge, indicatorChoice, indicatorText, type IndicatorTone } from "./indicator-tone";

export type FormAttachment = { id: string; filename: string; mimeType: string };
/**
 * Pictures inside the form (2026-09-26, field use): a thumbnail for a stored attachment and a direct upload that
 * stores the file as the task's attachment and returns its id, so a thermal image is taken and placed in one step.
 */
export type FormMedia = { thumbnail?: (attachmentId: string) => string | null; upload?: (file: File) => Promise<string | null> };

/** A level's colour, the same meaning as everywhere in Workflow (green ok, amber moderate, red high). */
export function bandClass(band: FormBand | null) {
  if (!band || band.tone === "neutral") return "border-border bg-muted/40 text-foreground";
  if (band.tone === "critical") return "border-red-600 bg-red-600 text-white dark:border-red-500 dark:bg-red-700";
  return indicatorBadge(band.tone);
}

export type AnswerChoice = { value: string; text: string; tone: IndicatorTone };

/**
 * A compact group of answer buttons (2026-09-29): one frame with the answers side by side, the chosen one filled in
 * its colour – green for OK, red for Ej OK or a deviating answer, grey for Ej aktuellt, Ja green and Nej red as well – and
 * the others in a quiet hint of their colour. A second click on the chosen answer clears it.
 */
export function AnswerButtons({ id, label, value, choices, disabled, compact = false, onChange }: { id?: string; label: string; value: string | null | undefined; choices: AnswerChoice[]; disabled: boolean; compact?: boolean; onChange: (value: string | null) => void }) {
  return <div id={id} role="group" aria-label={label} className="inline-flex w-fit max-w-full shrink-0 flex-wrap gap-0.5 self-start justify-self-start rounded-lg border bg-card p-0.5" data-testid="answer-buttons">
    {choices.map((choice) => {
      const chosen = value === choice.value;
      return <button key={choice.value} type="button" aria-pressed={chosen} disabled={disabled} onClick={() => onChange(chosen ? null : choice.value)}
        className={cn("h-8 rounded-md px-2.5 text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60 max-md:h-9", compact && "px-2",
          chosen ? indicatorChoice(choice.tone) : cn("hover:bg-muted", choice.tone === "info" ? "text-foreground" : indicatorText(choice.tone)))}>{choice.text}</button>;
    })}
  </div>;
}

/** Ja/Nej (and Ej aktuellt) in the same colours as OK/Ej OK everywhere (2026-09-30): Ja green, Nej red, Ej aktuellt grey – unless the form says Ja is the deviation, then Ja is red and Nej green. */
export function YesNo({ id, value, allowNotApplicable, disabled, onChange, label, compact = false, deviationOn = "NONE" }: { id?: string; value: string | null; allowNotApplicable: boolean; disabled: boolean; onChange: (value: string | null) => void; label: string; compact?: boolean; deviationOn?: "NONE" | "YES" | "NO" }) {
  const tone = (answer: "YES" | "NO"): IndicatorTone => deviationOn === "NONE" ? (answer === "YES" ? "success" : "danger") : deviationOn === answer ? "danger" : "success";
  const choices: AnswerChoice[] = [{ value: "YES", text: "Ja", tone: tone("YES") }, { value: "NO", text: "Nej", tone: tone("NO") }, ...(allowNotApplicable ? [{ value: "NA", text: compact ? "E/A" : "Ej aktuellt", tone: "neutral" as const }] : [])];
  return <AnswerButtons id={id} label={label} value={value} choices={choices} disabled={disabled} compact={compact} onChange={onChange} />;
}

/** A five-step (or other) scale: stores 1, 2, 3 … and shows "3 · Möjlig". */
export function ScaleSelect({ value, steps, label, disabled, compact = false, onChange, id }: { value: unknown; steps: string[]; label: string; disabled: boolean; compact?: boolean; onChange: (value: number | null) => void; id?: string }) {
  const current = typeof value === "number" ? value : Number.isFinite(Number(value)) && value !== "" && value !== null ? Number(value) : "";
  return <select id={id} aria-label={label} className={cn("form-select", compact && "h-9")} value={current} disabled={disabled} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}>
    <option value="">Välj</option>
    {steps.map((step, index) => <option key={step} value={index + 1}>{index + 1} · {step}</option>)}
  </select>;
}

/** Suggestions for a long text (e.g. common hazards): one tap fills the field. */
export function SuggestionChips({ suggestions, onPick, disabled }: { suggestions: string[]; onPick: (value: string) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  if (!suggestions.length || disabled) return null;
  return <div className="flex flex-wrap items-center gap-1.5">
    <button type="button" className="text-xs font-medium text-primary hover:underline" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? "Dölj förslag" : "Förslag"}</button>
    {open ? suggestions.map((item) => <button key={item} type="button" className="rounded-full border bg-card px-2.5 py-1 text-xs hover:border-primary/40 hover:bg-secondary" onClick={() => { onPick(item); setOpen(false); }}>{item}</button>) : null}
  </div>;
}

/**
 * Chooses pictures (or files) among the task's attachments, with thumbnails where the storage can show them and a
 * direct "Ta bild eller välj fil" that uploads and selects in one step.
 */
export function ImagePicker({ label, accept, selected, attachments, media, readOnly, onChange, compact = false }: {
  label: string; accept: "images" | "files"; selected: string[]; attachments: FormAttachment[]; media?: FormMedia; readOnly: boolean; onChange: (next: string[]) => void; compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [choosing, setChoosing] = useState(false);
  const usable = accept === "files" ? attachments : attachments.filter((item) => item.mimeType.startsWith("image/"));
  const chosen = selected.map((id) => usable.find((item) => item.id === id)).filter((item): item is FormAttachment => Boolean(item));
  const others = usable.filter((item) => !selected.includes(item.id));
  const thumb = (item: FormAttachment, size: string) => {
    const url = item.mimeType.startsWith("image/") ? media?.thumbnail?.(item.id) : null;
    // eslint-disable-next-line @next/next/no-img-element -- a private attachment behind the session, not a static asset
    return url ? <img src={url} alt={item.filename} className={cn(size, "rounded-md border object-cover")} loading="lazy" /> : <span className={cn(size, "flex items-center justify-center overflow-hidden rounded-md border bg-muted px-1 text-center text-[10px] leading-tight text-muted-foreground")}>{item.filename}</span>;
  };
  async function upload(file: File) {
    if (!media?.upload) return;
    setBusy(true); setError("");
    try { const id = await media.upload(file); if (id) onChange([...selected, id]); }
    catch (issue) { setError((issue as Error).message); } finally { setBusy(false); }
  }
  const size = compact ? "size-10" : "size-20";
  return <div className="mt-1 grid gap-2">
    {chosen.length ? <ul className="flex flex-wrap gap-2" aria-label={`Valda: ${label}`}>{chosen.map((item) => <li key={item.id} className="relative">
      {thumb(item, size)}
      {!readOnly ? <button type="button" className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-xs hover:text-destructive" aria-label={`Ta bort ${item.filename} från ${label}`} onClick={() => onChange(selected.filter((id) => id !== item.id))}><X className="size-3" /></button> : null}
    </li>)}</ul> : readOnly ? <span className="text-xs text-muted-foreground">Inga valda.</span> : null}
    {!readOnly ? <div className="flex flex-wrap items-center gap-1.5">
      {media?.upload ? <label className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-card px-2.5 text-xs font-medium hover:border-primary/40 hover:bg-secondary", compact ? "h-8" : "h-9", busy && "pointer-events-none opacity-60")}>
        {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}{busy ? "Laddar upp…" : accept === "files" ? "Lägg till fil" : compact ? "Bild" : "Ta bild eller välj fil"}
        <input className="sr-only" type="file" aria-label={`Lägg till ${accept === "files" ? "fil" : "bild"}: ${label}`} accept={accept === "files" ? "image/jpeg,image/png,image/webp,application/pdf,text/plain,.docx,.xlsx" : "image/jpeg,image/png,image/webp"} disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} />
      </label> : null}
      {others.length ? <Button type="button" size="sm" variant="ghost" className={compact ? "h-8 px-2" : undefined} aria-expanded={choosing} onClick={() => setChoosing((open) => !open)}><ImageIcon />{choosing ? "Stäng" : `Välj bland bilagor (${others.length})`}</Button> : null}
      {!media?.upload && !others.length ? <span className="text-xs text-muted-foreground">{accept === "files" ? "Lägg till filer" : "Lägg till bilder"} under Bilder och dokument och välj dem här.</span> : null}
    </div> : null}
    {choosing && !readOnly ? <ul className="flex flex-wrap gap-2 rounded-lg border border-dashed p-2" aria-label={`Bilagor att välja till ${label}`}>{others.map((item) => <li key={item.id}><button type="button" className="grid justify-items-center gap-1 rounded-md p-1 text-[10px] hover:bg-muted" aria-label={`Välj ${item.filename}`} onClick={() => onChange([...selected, item.id])}>{thumb(item, "size-14")}<span className="max-w-14 truncate">{item.filename}</span></button></li>)}</ul> : null}
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
  </div>;
}

export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

/**
 * The camera on a control row or point (2026-09-28): a real button with a hidden file input, so it is never hidden by
 * the measurement row's label rules and its icon is centred like the control's. Uploads and returns in one step.
 */
export function CameraButton({ label, count = 0, onUpload, className }: { label: string; count?: number; onUpload: (file: File) => Promise<void>; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return <>
    {/* A light blue background already at rest (2026-09-29), so the camera reads as a button. */}
    <Button type="button" variant="ghost" size="icon" className={cn("measurement-camera relative size-8 shrink-0 bg-secondary text-primary hover:bg-primary/15 hover:text-primary", className)} aria-label={label} title={label} disabled={busy} onClick={() => input.current?.click()}>
      {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Camera className="size-5" />}
      {count ? <span className="absolute -bottom-1 -right-1 min-w-4 rounded-full border bg-card px-1 text-center text-[10px] font-semibold leading-4 text-foreground">{count}</span> : null}
    </Button>
    <input ref={input} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" accept={IMAGE_ACCEPT}
      onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; setBusy(true); void onUpload(file).finally(() => setBusy(false)); }} />
  </>;
}

/** A number's configurable limits under the field: the alarm and warning ranges, where they come from and the state. */
export function LimitHint({ limit, level }: { limit: FormLimitValue & { unit: string }; level: "ok" | "warning" | "alarm" | null }) {
  const set = [limit.low, limit.high, limit.warnLow, limit.warnHigh].some((value) => value !== null);
  const origin = limit.origin === "object" ? "objektets gränsvärden" : limit.origin === "facility" ? "anläggningens gränsvärden" : "formulärets gränsvärden";
  return <span className="text-xs font-normal text-muted-foreground" data-testid="form-limit">
    {level === "alarm" ? <strong className={cn("mr-1.5", indicatorText("danger"))}>Larm</strong> : level === "warning" ? <strong className={cn("mr-1.5", indicatorText("warning"))}>Varning</strong> : null}
    {set ? `Larm ${formLimitText(limit.low, limit.high, limit.unit)} · varning ${formLimitText(limit.warnLow, limit.warnHigh, limit.unit)} (${origin})` : `Gränsvärde ej angivet${limit.source ? ` – ${limit.source.charAt(0).toLowerCase()}${limit.source.slice(1)}` : ""}.`}
    {set && limit.source ? ` · ${limit.source}` : ""}
  </span>;
}

/** A comment and a deviation of one's own on a control point (2026-09-28): folded to a small link until used. */
export function FieldRemark({ label, value, readOnly, onChange }: { label: string; value?: FormValues["remarks"][string]; readOnly: boolean; onChange: (value: FormValues["remarks"][string]) => void }) {
  const current = value ?? { comment: "", deviation: false };
  const [open, setOpen] = useState(Boolean(current.comment || current.deviation));
  if (!open) return readOnly ? null : <button type="button" className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline" onClick={() => setOpen(true)}><MessageSquarePlus className="size-3.5" />Kommentar eller avvikelse</button>;
  return <span className={cn("grid gap-1.5 rounded-lg border p-2", current.deviation ? indicatorBadge("danger") : "bg-muted/20")} data-testid="form-remark">
    <Input className="h-9" aria-label={`Kommentar: ${label}`} placeholder="Kommentar" value={current.comment} disabled={readOnly} maxLength={1000} onChange={(event) => onChange({ ...current, comment: event.target.value })} />
    <label className="inline-flex w-fit items-center gap-2 text-xs font-medium"><input type="checkbox" className="size-4" checked={current.deviation} disabled={readOnly} onChange={(event) => onChange({ ...current, deviation: event.target.checked })} />Markera som avvikelse</label>
  </span>;
}

/**
 * A signature (2026-09-28, compact): the name and, beside it at the same height, the statement with its tick box –
 * no large framed box. Ticking stamps the time, printed in the report with the signer's role.
 */
export function SignatureBlock({ block, label, required, value, readOnly, onChange }: { block: Extract<FormLeafBlock, { type: "signature" }>; label: ReactNode; required: ReactNode; value?: FormValues["signatures"][string]; readOnly: boolean; onChange: (value: FormValues["signatures"][string]) => void }) {
  const signature = value ?? { name: "", confirmed: false, signedAt: null };
  return <fieldset id={`form-${block.id}`} aria-label={block.label} className="grid min-w-0 items-end gap-x-4 gap-y-2 pb-4 @lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]" data-testid="form-signature">
    <label className="space-y-2 text-xs font-medium text-muted-foreground">{label}{required}<Input placeholder={block.placeholder || undefined} value={signature.name} disabled={readOnly} onChange={(event) => onChange({ ...signature, name: event.target.value })} /></label>
    <div className="relative">
      <label className="flex min-h-10 items-center gap-2.5 text-sm"><input type="checkbox" className="size-4 shrink-0" disabled={readOnly} checked={signature.confirmed} onChange={(event) => onChange({ ...signature, confirmed: event.target.checked, signedAt: event.target.checked ? new Date().toISOString() : null })} /><span className="leading-5">{block.statement || "Bekräftad"}</span></label>
      {signature.confirmed && signature.signedAt ? <span className="absolute left-0 top-full pl-6.5 text-[11px] leading-4 text-muted-foreground">Bekräftad {formatSwedish(signature.signedAt, { dateStyle: "short", timeStyle: "short" })}</span> : null}
    </div>
  </fieldset>;
}
