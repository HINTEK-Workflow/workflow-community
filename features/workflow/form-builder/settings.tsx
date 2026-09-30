"use client";

import type { ReactNode } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { BAND_TONES, COLUMN_INPUTS, FIELD_INPUTS, FIELD_PREFILLS, formBlockCanBeNarrow, formLeafBlocks, FORM_WIDTH_LABEL, FORM_WIDTHS, type FormBand, type FormColumn, type FormFieldBlock, type FormIssue, type FormLeafBlock, type FormSection, type FormTableBlock } from "@/lib/workflow/form-document";
import { newColumn, newId, type EditorDocument } from "@/lib/workflow/form-editor";
import { FORM_ICONS } from "@/lib/workflow/form-publish";
import { FORM_ICON_COMPONENTS } from "../form-card";
import { indicatorBadge } from "../indicator-tone";
import { FormulaEditor } from "./formula-editor";
import { INPUT_LABEL } from "./labels";
import { ConditionSetting, LimitChoice } from "./rounds-settings";

type Patch = Partial<FormLeafBlock> | Partial<FormSection>;
const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);
const numberOrNull = (value: string) => value.trim() === "" || !Number.isFinite(Number(value.replace(",", "."))) ? null : Number(value.replace(",", "."));
const numberText = (value: number | null) => value === null ? "" : String(value).replace(".", ",");
const PREFILL_LABEL: Record<(typeof FIELD_PREFILLS)[number], string> = {
  none: "Nej", customer: "Kundens namn", contact: "Kundens kontaktperson", email: "Kundens e-post", facility: "Anläggningen (annars projektet)", project: "Projektets namn", assignee: "Ansvarig för uppgiften", user: "Den inloggade användaren", today: "Dagens datum",
};
const TONE_LABEL: Record<FormBand["tone"], string> = { neutral: "Neutral", success: "Grön", warning: "Gul", danger: "Röd", critical: "Mörkröd" };

function Group({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }) {
  return <details open={open} className="group/settings border-t pt-3 first:border-t-0 first:pt-0">
    <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-wide text-muted-foreground marker:hidden [&::-webkit-details-marker]:hidden">
      <span className="inline-block w-3 transition-transform group-open/settings:rotate-90">›</span>{title}
    </summary>
    <div className="mt-3 grid gap-3">{children}</div>
  </details>;
}

function TextSetting({ label, value, onChange, area, mono, max, placeholder, id }: { label: string; value: string; onChange: (value: string) => void; area?: boolean; mono?: boolean; max?: number; placeholder?: string; id?: string }) {
  return <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">{label}
    {area ? <textarea id={id} className={cn("form-textarea", mono && "font-mono text-xs")} value={value} maxLength={max} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      : <Input id={id} className={mono ? "font-mono text-xs" : undefined} value={value} maxLength={max} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />}
  </label>;
}
const Check = ({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) =>
  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
const Select = ({ label, value, onChange, children }: { label: string; value: string | number; onChange: (value: string) => void; children: ReactNode }) =>
  <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">{label}<select className="form-select" value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>;

/** The Ja/nej fields a requirement or a Godkänd can follow (the control's Autobedömning). */
const yesNoFields = (document: EditorDocument) => formLeafBlocks(document).filter((block): block is FormFieldBlock => block.type === "field" && block.input === "yesno");

/**
 * Levels of a computed value (the risk assessment's "Låg … Mycket hög"): from a value upwards a name and a colour.
 * Shown on screen and in the PDF as "15 · Hög".
 */
function BandsEditor({ bands, onChange }: { bands: FormBand[]; onChange: (bands: FormBand[]) => void }) {
  const update = (index: number, patch: Partial<FormBand>) => onChange(bands.map((band, position) => position === index ? { ...band, ...patch } : band));
  return <div className="grid gap-1.5">
    <p className="text-xs font-medium text-muted-foreground">Nivåer (från värdet och uppåt)</p>
    {bands.map((band, index) => <div key={index} className="grid grid-cols-[4rem_minmax(0,1fr)_6rem_2rem] gap-1.5">
      <Input aria-label={`Nivå ${index + 1} från`} value={numberText(band.from)} onChange={(event) => update(index, { from: numberOrNull(event.target.value) ?? 0 })} />
      <Input aria-label={`Nivå ${index + 1} namn`} placeholder="Namn" value={band.label} maxLength={60} onChange={(event) => update(index, { label: event.target.value })} />
      <select aria-label={`Nivå ${index + 1} färg`} className="form-select" value={band.tone} onChange={(event) => update(index, { tone: event.target.value as FormBand["tone"] })}>{BAND_TONES.map((tone) => <option key={tone} value={tone}>{TONE_LABEL[tone]}</option>)}</select>
      <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={`Ta bort nivå ${index + 1}`} onClick={() => onChange(bands.filter((_, position) => position !== index))}><Trash2 /></Button>
    </div>)}
    {bands.length < 10 ? <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => onChange([...bands, { from: (bands.at(-1)?.from ?? 0) + 1, label: "", tone: "neutral" }])}><Plus />Nivå</Button> : null}
  </div>;
}

/**
 * Settings for the selected block (Daniel 2026-09-26): grouped as Grund, Alternativ, Validering, Avvikelse, Formel and
 * Visning. The same panel is the right-hand column on a large screen and a panel on top of the canvas on a smaller one.
 * The building blocks added backwards from the control and the risk assessment (Daniel 2026-09-27) have their settings
 * in the same groups: moments, PDF style, measurement rows, Godkänd, scales, levels and prefill.
 */
export function BlockSettings({ document, block, issues, onPatch, onMove, onDuplicate, onRemove, onMoveToSection }: {
  document: EditorDocument; block: FormLeafBlock | FormSection; issues: FormIssue[];
  onPatch: (patch: Patch, group: string) => void; onMove: (delta: -1 | 1) => void; onDuplicate: () => void; onRemove: () => void; onMoveToSection: (sectionId: string) => void;
}) {
  const set = (key: string) => (value: unknown) => onPatch({ [key]: value } as Patch, `${block.id}:${key}`);
  const sectionOf = document.blocks.find((section) => section.id === block.id || section.blocks.some((item) => item.id === block.id));
  return <div className="grid gap-4" data-testid="block-settings">
    {issues.length ? <ul className={cn("space-y-1 rounded-lg border p-2.5 text-xs", indicatorBadge("warning"))}>{issues.map((issue, index) => <li key={index} className="flex gap-1.5"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{issue.message}</li>)}</ul> : null}
    {block.type === "section" ? <>
      <Group title="Avsnitt">
        <TextSetting label="Rubrik (tom = inget rubrikfält)" value={block.title} max={200} onChange={set("title")} id="settings-first" />
        <TextSetting label="Beskrivning" area value={block.description} max={1000} onChange={set("description")} />
        <Check label="Kan väljas bort i protokollet (ett moment)" checked={block.optional} onChange={set("optional")} />
        {block.optional ? <Check label="Påslaget från början" checked={block.defaultOn} onChange={set("defaultOn")} /> : null}
        <Check label="Hopfällt tills man öppnar det" checked={block.collapsed} onChange={set("collapsed")} />
        {block.optional ? <TextSetting label="Förklaring bakom (i) i momentvalet" area value={block.help} max={1000} onChange={set("help")} /> : null}
        <TextSetting label="Rubrik i uppgiften (tom = som i PDF:en)" value={block.taskTitle} max={200} onChange={set("taskTitle")} />
      </Group>
      <Group title="Villkorad visning" open={Boolean(block.showIf.key)}><ConditionSetting document={document} condition={block.showIf} onChange={set("showIf")} /></Group>
      <Group title="PDF" open={false}>
        <Select label="Avsnittet i PDF:en" value={block.pdfStyle} onChange={set("pdfStyle")}>
          <option value="standard">Med rubrik</option>
          <option value="untitled">Utan rubrik (som kontrollens grunduppgifter)</option>
          <option value="chapter">Eget kapitel med stor rubrik (som Stöd vid bedömning)</option>
        </Select>
        {block.pdfStyle !== "chapter" ? <Check label="Börja på ny sida i PDF" checked={block.newPage} onChange={set("newPage")} /> : null}
      </Group>
    </> : <LeafSettings document={document} block={block} set={set} onPatch={onPatch} />}

    <div className="flex flex-wrap gap-1.5 border-t pt-3">
      <Button type="button" size="sm" variant="outline" onClick={() => onMove(-1)}><ArrowUp />Upp</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => onMove(1)}><ArrowDown />Ned</Button>
      <Button type="button" size="sm" variant="outline" onClick={onDuplicate}><Copy />Duplicera</Button>
      <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={onRemove}><Trash2 />Ta bort</Button>
    </div>
    {block.type !== "section" && document.blocks.length > 1 ? <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">Flytta till avsnitt
      <select className="form-select" value={sectionOf?.id ?? ""} onChange={(event) => onMoveToSection(event.target.value)}>
        {document.blocks.map((section, index) => <option key={section.id} value={section.id}>{section.title || `Avsnitt ${index + 1} (utan rubrik)`}</option>)}
      </select>
    </label> : null}
  </div>;
}

function LeafSettings({ document, block, set, onPatch }: { document: EditorDocument; block: FormLeafBlock; set: (key: string) => (value: unknown) => void; onPatch: (patch: Patch, group: string) => void }) {
  if (block.type === "pagebreak") return <p className="text-sm text-muted-foreground">Sidbrytningen startar en ny sida i PDF:en. Den syns inte när uppgiften fylls i.</p>;
  const visibility = "visibility" in block ? block.visibility : null;
  return <>
    <Group title="Grund">
      {block.type === "heading" ? <>
        <TextSetting id="settings-first" label="Rubrik" value={block.text} max={200} onChange={set("text")} />
        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">Nivå<select className="form-select" value={block.level} onChange={(event) => set("level")(Number(event.target.value))}><option value={1}>1 – huvudrubrik</option><option value={2}>2 – rubrik</option><option value={3}>3 – underrubrik</option></select></label>
      </> : null}
      {block.type === "text" ? <TextSetting id="settings-first" label="Hjälptext" area value={block.text} max={5000} onChange={set("text")} /> : null}
      {block.type === "note" ? <>
        <TextSetting id="settings-first" label="Rubrik" value={block.title} max={200} onChange={set("title")} />
        <TextSetting label="Text (ny rad = nytt stycke)" area value={block.text} max={5000} onChange={set("text")} />
        <Select label="Visning i uppgiften" value={block.style} onChange={set("style")}><option value="folded">Hopfällt tills man öppnar det</option><option value="card">Öppet kort (rader som ”1 – …” blir en numrerad lista)</option><option value="notice">Notisrad (rubrik: text)</option></Select>
      </> : null}
      {"label" in block ? <TextSetting id="settings-first" label="Etikett" value={block.label} max={200} onChange={set("label")} /> : null}
      {"key" in block ? <TextSetting label="Intern fältkod" mono value={block.key} max={40} onChange={(value) => set("key")(value.toLowerCase())} /> : null}
      {block.type === "field" ? <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">Fälttyp<select className="form-select" value={block.input} onChange={(event) => set("input")(event.target.value)}>{FIELD_INPUTS.map((input) => <option key={input} value={input}>{INPUT_LABEL[input]}</option>)}</select></label> : null}
      {"help" in block ? <TextSetting label="Hjälptext" value={block.help} max={500} onChange={set("help")} /> : null}
      {block.type === "field" || block.type === "signature" ? <Check label="Obligatoriskt" checked={block.required} onChange={set("required")} /> : null}
      {block.type === "field" && !["yesno", "date", "datetime"].includes(block.input) ? <TextSetting label="Platshållare i fältet" value={block.placeholder} max={200} onChange={set("placeholder")} /> : null}
      {block.type === "signature" ? <>
        <TextSetting label="Intygstext vid rutan (tom = Bekräftad)" value={block.statement} max={300} onChange={set("statement")} />
        <TextSetting label="Platshållare i namnfältet" value={block.placeholder} max={120} onChange={set("placeholder")} />
        <Select label="Roll" value={block.role} onChange={set("role")}><option value="other">Ingen särskild</option><option value="performer">Utförare</option><option value="reviewer">Granskare</option><option value="approver">Godkännare</option></Select>
        <Select label="Ska vara en annan person än" value={block.distinctFrom} onChange={set("distinctFrom")}><option value="">Ingen kontroll</option>{formLeafBlocks(document).flatMap((item) => item.type === "signature" && item.id !== block.id ? [<option key={item.id} value={item.key}>{item.label}</option>] : [])}</Select>
      </> : null}
      {block.type === "field" ? <DefaultValue block={block} onChange={set("defaultValue")} /> : null}
      {block.type === "field" && block.input !== "yesno" ? <Select label="Fylls i från uppgiften" value={block.prefill} onChange={set("prefill")}>{FIELD_PREFILLS.map((item) => <option key={item} value={item}>{PREFILL_LABEL[item]}</option>)}</Select> : null}
      {block.type === "field" && block.input === "yesno" ? <Check label="Visa som växel bland momenten (som Autobedömning)" checked={block.momentSwitch} onChange={set("momentSwitch")} /> : null}
      {block.type === "field" && block.input === "number" ? <TextSetting label="Enhet" value={block.unit} max={20} placeholder="t.ex. V, A, MΩ" onChange={set("unit")} /> : null}
      {block.type === "field" ? <Check label="Kommentar och egen avvikelse på punkten" checked={block.remarks} onChange={set("remarks")} /> : null}
      {"width" in block && formBlockCanBeNarrow(block) ? <div className="grid gap-1.5 text-xs font-medium text-muted-foreground">Bredd (dra även i fältets högerkant)
        <div className="flex rounded-lg border p-0.5" role="group" aria-label="Bredd">{FORM_WIDTHS.map((width) => <Button key={width} type="button" size="sm" className="flex-1 px-0" variant={block.width === width ? "secondary" : "ghost"} aria-pressed={block.width === width} aria-label={`Bredd ${FORM_WIDTH_LABEL[width]}`} onClick={() => set("width")(width)}>{FORM_WIDTH_LABEL[width]}</Button>)}</div>
      </div> : null}
    </Group>

    {block.type === "field" && block.input === "choice" ? <Group title="Alternativ">
      <TextSetting label="Alternativ (ett per rad)" area value={block.options.join("\n")} onChange={(value) => onPatch({ options: lines(value) } as Patch, `${block.id}:options`)} />
      <Check label="Flera val (flerval)" checked={block.multiple} onChange={set("multiple")} />
    </Group> : null}

    {block.type === "field" && (block.input === "number" || block.input === "text" || block.input === "textarea") ? <Group title="Validering" open={false}>
      <p className="text-[11px] text-muted-foreground">Värden utanför gränserna stoppar slutförandet.</p>
      {block.input === "number" ? <>
        <div className="grid grid-cols-2 gap-2">
          <TextSetting label="Lägsta tillåtna" value={numberText(block.allowedMin)} onChange={(value) => set("allowedMin")(numberOrNull(value))} />
          <TextSetting label="Högsta tillåtna" value={numberText(block.allowedMax)} onChange={(value) => set("allowedMax")(numberOrNull(value))} />
        </div>
        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">Decimaler<select className="form-select" value={block.decimals ?? ""} onChange={(event) => set("decimals")(event.target.value === "" ? null : Number(event.target.value))}><option value="">Valfritt</option>{[0, 1, 2, 3, 4].map((count) => <option key={count} value={count}>Högst {count}</option>)}</select></label>
      </> : <TextSetting label="Längsta text (tecken)" value={block.maxLength === null ? "" : String(block.maxLength)} onChange={(value) => { const parsed = numberOrNull(value); set("maxLength")(parsed === null ? null : Math.max(1, Math.min(2000, Math.round(parsed)))); }} />}
    </Group> : null}

    {block.type === "field" && (block.input === "number" || block.input === "yesno" || block.input === "choice") || block.type === "computed" ? <Group title="Avvikelse" open={false}>
      <p className="text-[11px] text-muted-foreground">En avvikelse markeras i uppgiften och PDF:en och kräver en kommentar, men stoppar inte slutförandet.</p>
      {block.type === "field" && block.input === "number" ? <div className="grid grid-cols-2 gap-2">
        <TextSetting label="Avvikelse under" value={numberText(block.min)} onChange={(value) => set("min")(numberOrNull(value))} />
        <TextSetting label="Avvikelse över" value={numberText(block.max)} onChange={(value) => set("max")(numberOrNull(value))} />
      </div> : null}
      {block.type === "field" && block.input === "yesno" ? <>
        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">Markera avvikelse när svaret är<select className="form-select" value={block.deviationOn} onChange={(event) => set("deviationOn")(event.target.value)}><option value="NONE">Ingen avvikelse</option><option value="NO">Nej</option><option value="YES">Ja</option></select></label>
        <Check label="Tillåt Ej aktuellt" checked={block.allowNotApplicable} onChange={set("allowNotApplicable")} />
      </> : null}
      {block.type === "field" && block.input === "choice" ? <fieldset className="grid gap-1.5"><legend className="mb-1 text-xs font-medium text-muted-foreground">Markera avvikelse när man väljer</legend>
        {block.options.map((option) => <Check key={option} label={option} checked={block.deviationOptions.includes(option)} onChange={(checked) => set("deviationOptions")(checked ? [...block.deviationOptions, option] : block.deviationOptions.filter((item) => item !== option))} />)}
      </fieldset> : null}
      {block.type === "computed" ? <Check label="Markera avvikelse när resultatet är Nej" checked={block.passCondition} onChange={set("passCondition")} /> : null}
    </Group> : null}

    {(block.type === "field" && block.input === "number") || block.type === "computed" ? <Group title="Gränsvärde och trend" open={Boolean(block.limitKey || block.trend)}>
      <LimitChoice document={document} limitKey={block.limitKey} trend={block.trend} onChange={(patch) => onPatch(patch as Patch, `${block.id}:limit`)} />
    </Group> : null}

    {block.type === "computed" ? <Group title="Formel">
      <FormulaEditor id={`formula-${block.id}`} value={block.formula} document={document} ownKey={block.key} onChange={(value) => onPatch({ formula: value } as Patch, `${block.id}:formula`)} />
      <TextSetting label="Enhet" value={block.unit} max={20} onChange={set("unit")} />
      <BandsEditor bands={block.bands} onChange={set("bands")} />
    </Group> : null}

    {block.type === "checklist" ? <Group title="Punkter">
      <Select label="Visning" value={block.mode} onChange={set("mode")}><option value="assessment">Bedömning – OK, Ej OK, Ej aktuellt</option><option value="check">Kryssrutor – bocka i det som är kontrollerat</option></Select>
      <TextSetting label="Punkter (en per rad)" area value={block.items.map((item) => item.text).join("\n")} onChange={(value) => onPatch({ items: lines(value).map((line, index) => ({ id: block.items[index]?.id ?? newId(), text: line })) } as Patch, `${block.id}:items`)} />
      <Check label="Alla punkter måste bedömas" checked={block.required} onChange={set("required")} />
      <Check label="Kamera på varje punkt" checked={block.photos} onChange={set("photos")} />
      {block.mode === "assessment" ? <Select label="Ej OK kan registreras som brist i tabellen" value={block.deviationTable} onChange={set("deviationTable")}><option value="">Nej</option>{formLeafBlocks(document).filter((item): item is FormTableBlock => item.type === "table").map((table) => <option key={table.id} value={table.key}>{table.label}</option>)}</Select> : null}
    </Group> : null}

    {block.type === "images" ? <Group title="Bilder och filer">
      <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">Tar emot<select className="form-select" value={block.accept} onChange={(event) => set("accept")(event.target.value)}><option value="images">Bara bilder</option><option value="files">Bilder och andra filer</option></select></label>
      <TextSetting label="Minsta antal" value={String(block.minCount)} onChange={(value) => set("minCount")(Math.max(0, Math.min(50, Math.round(Number(value) || 0))))} />
      <Select label="Bilderna i PDF:en" value={block.pdfInline ? "inline" : "after"} onChange={(value) => set("pdfInline")(value === "inline")}><option value="inline">I formuläret</option><option value="after">Som bilagor efter protokollet (som kontrollen)</option></Select>
    </Group> : null}

    {block.type === "matrix" ? <Group title="Riskmatris">
      <Select label="Storlek" value={block.size} onChange={(value) => set("size")(Number(value))}>{[3, 4, 5, 6].map((size) => <option key={size} value={size}>{size} × {size}</option>)}</Select>
      <div className="grid grid-cols-2 gap-2"><TextSetting label="Vågrätt" value={block.xLabel} max={60} onChange={set("xLabel")} /><TextSetting label="Lodrätt" value={block.yLabel} max={60} onChange={set("yLabel")} /></div>
      <Check label="Sträcker sig över två rader (kortare block läggs bredvid)" checked={block.tall} onChange={set("tall")} />
      <BandsEditor bands={block.bands} onChange={set("bands")} />
    </Group> : null}

    {block.type === "table" ? <TableSettings document={document} block={block} onPatch={(patch) => onPatch(patch as Patch, `${block.id}:table`)} /> : null}

    {block.type === "field" ? <Group title="PDF" open={false}>
      <TextSetting label="Rubrik i PDF (tom = fältets namn)" value={block.pdfLabel} max={120} onChange={set("pdfLabel")} />
      <Check label="Markera rutan i PDF:en (som kontrollens Projekt / anläggning)" checked={block.highlight} onChange={set("highlight")} />
    </Group> : null}

    {"showIf" in block ? <Group title="Villkorad visning" open={Boolean(block.showIf.key)}><ConditionSetting document={document} ownKey={"key" in block ? block.key : undefined} condition={block.showIf} onChange={set("showIf")} /></Group> : null}

    {visibility ? <Group title="Visning" open={false}>
      <Check label="Visas när uppgiften fylls i" checked={visibility.task} onChange={(task) => set("visibility")({ ...visibility, task })} />
      <Check label="Visas i PDF:en" checked={visibility.pdf} onChange={(pdf) => set("visibility")({ ...visibility, pdf })} />
    </Group> : null}
  </>;
}

function DefaultValue({ block, onChange }: { block: FormFieldBlock; onChange: (value: string | number | null) => void }) {
  const value = block.defaultValue === null ? "" : String(block.defaultValue);
  const label = "Standardvärde";
  if (block.input === "choice") return <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">{label}<select className="form-select" value={value} onChange={(event) => onChange(event.target.value || null)}><option value="">Inget</option>{block.options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
  if (block.input === "yesno") return <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">{label}<select className="form-select" value={value} onChange={(event) => onChange(event.target.value || null)}><option value="">Inget</option><option value="YES">Ja</option><option value="NO">Nej</option>{block.allowNotApplicable ? <option value="NA">Ej aktuellt</option> : null}</select></label>;
  if (block.input === "date" || block.input === "datetime") return null;
  return <TextSetting label={label} value={value} onChange={(next) => onChange(next === "" ? null : block.input === "number" ? next.replace(",", ".") : next)} />;
}

/** A column's value for new rows or the example row, by its kind. */
function ColumnValue({ label, column, value, onChange }: { label: string; column: FormColumn; value: FormColumn["defaultValue"]; onChange: (value: FormColumn["defaultValue"]) => void }) {
  if (column.input === "check" || column.input === "assessment") return <Check label={label} checked={value === true} onChange={(checked) => onChange(checked ? true : null)} />;
  if (column.input === "choice") return <Select label={label} value={typeof value === "string" ? value : ""} onChange={(next) => onChange(next || null)}><option value="">Inget</option>{column.options.map((option) => <option key={option} value={option}>{option}</option>)}</Select>;
  if (column.input === "scale") return <Select label={label} value={typeof value === "number" ? value : ""} onChange={(next) => onChange(next ? Number(next) : null)}><option value="">Inget</option>{column.options.map((option, index) => <option key={option} value={index + 1}>{index + 1} · {option}</option>)}</Select>;
  return <TextSetting label={label} value={value === null ? "" : String(value)} onChange={(next) => onChange(next === "" ? null : column.input === "number" && Number.isFinite(Number(next.replace(",", "."))) ? Number(next.replace(",", ".")) : next)} />;
}

/** One column's settings: the kind of answer first, the rest folded under "Mer" so a simple table stays simple. */
function ColumnSettings({ document, block, column, index, update, move, remove }: {
  document: EditorDocument; block: FormTableBlock; column: FormColumn; index: number; update: (patch: Partial<FormColumn>) => void; move: (delta: -1 | 1) => void; remove: () => void;
}) {
  const switches = yesNoFields(document);
  const valued = column.input !== "formula" && column.input !== "images";
  return <fieldset className="grid gap-2 rounded-lg border p-2.5" data-testid="column-settings">
    <legend className="px-1 text-xs font-medium">Kolumn {index + 1}</legend>
    <div className="grid grid-cols-2 gap-2"><Input aria-label="Kolumnens etikett" value={column.label} onChange={(event) => update({ label: event.target.value })} /><Input aria-label="Kolumnens interna kod" className="font-mono text-xs" value={column.key} onChange={(event) => update({ key: event.target.value.toLowerCase() })} /></div>
    <div className="grid grid-cols-2 gap-2"><select aria-label="Kolumnens typ" className="form-select" value={column.input} onChange={(event) => update({ input: event.target.value as FormColumn["input"] })}>{COLUMN_INPUTS.map((input) => <option key={input} value={input}>{INPUT_LABEL[input]}</option>)}</select><Input aria-label="Enhet" placeholder="Enhet" value={column.unit} onChange={(event) => update({ unit: event.target.value })} /></div>
    {column.input === "formula" ? <>
      <FormulaEditor id={`formula-${column.id}`} value={column.formula} document={document} rowColumns={block.columns.filter((item) => item.key !== column.key)} onChange={(formula) => update({ formula })} />
      <Check label="Markera avvikelse när resultatet är Nej" checked={column.passCondition} onChange={(passCondition) => update({ passCondition })} />
    </> : null}
    {column.input === "assessment" ? <div className="grid gap-2 rounded-md bg-muted/40 p-2">
      <Select label="Godkänd bestäms" value={column.mode} onChange={(mode) => update({ mode: mode as FormColumn["mode"] })}><option value="auto">Automatiskt av villkoret</option><option value="manual">För hand – den som fyller i bockar i</option><option value="switch">Av villkoret när ett Ja/nej-fält är Ja, annars för hand</option></Select>
      {column.mode === "switch" ? <Select label="Ja/nej-fältet (t.ex. Autobedömning)" value={column.switchKey} onChange={(switchKey) => update({ switchKey })}><option value="">Välj fält</option>{switches.map((field) => <option key={field.id} value={field.key}>{field.label}</option>)}</Select> : null}
      {column.mode !== "manual" ? <><p className="text-[11px] text-muted-foreground">Villkor för godkänt, t.ex. [uppmatt] &gt;= [grans]. VÄXLA ger olika gränser per val: VÄXLA([profil]; &quot;EN&quot;; 300; &quot;TT&quot;; 200).</p>
        <FormulaEditor id={`formula-${column.id}`} value={column.formula} document={document} rowColumns={block.columns.filter((item) => item.key !== column.key)} onChange={(formula) => update({ formula })} /></> : null}
    </div> : null}
    {column.input === "number" ? <div className="grid grid-cols-3 gap-2"><Input aria-label="Avvikelse under" placeholder="Avv. under" value={numberText(column.min)} onChange={(event) => update({ min: numberOrNull(event.target.value) })} /><Input aria-label="Avvikelse över" placeholder="Avv. över" value={numberText(column.max)} onChange={(event) => update({ max: numberOrNull(event.target.value) })} /><select aria-label="Summering" className="form-select" value={column.total} onChange={(event) => update({ total: event.target.value as FormColumn["total"] })}><option value="none">Ingen summa</option><option value="sum">Summa</option><option value="min">Lägsta</option><option value="max">Högsta</option><option value="avg">Medel</option></select></div> : null}
    {column.input === "choice" ? <textarea aria-label="Alternativ" className="form-textarea" placeholder="Ett alternativ per rad" value={column.options.join("\n")} onChange={(event) => update({ options: lines(event.target.value) })} /> : null}
    {column.input === "scale" ? <textarea aria-label="Skalans steg" className="form-textarea" placeholder="Ett steg per rad, det första är 1" value={column.options.join("\n")} onChange={(event) => update({ options: lines(event.target.value) })} /> : null}
    {column.input === "choice" && column.options.length ? <fieldset className="grid gap-1"><legend className="mb-1 text-[11px] text-muted-foreground">Avvikelse när man väljer</legend>{column.options.map((option) => <Check key={option} label={option} checked={column.deviationOptions.includes(option)} onChange={(checked) => update({ deviationOptions: checked ? [...column.deviationOptions, option] : column.deviationOptions.filter((item) => item !== option) })} />)}</fieldset> : null}
    <Input aria-label="Kolumnens hjälptext" placeholder="Hjälptext (valfri)" value={column.help} maxLength={300} onChange={(event) => update({ help: event.target.value })} />
    <details className="group/column">
      <summary className="cursor-pointer list-none text-xs font-medium text-primary marker:hidden [&::-webkit-details-marker]:hidden">Mer för kolumnen</summary>
      <div className="mt-2 grid gap-2">
        {valued ? <div className="grid grid-cols-2 gap-2"><ColumnValue label="Värde på nya rader" column={column} value={column.defaultValue} onChange={(defaultValue) => update({ defaultValue })} /><ColumnValue label="Värde på exempelraden" column={column} value={column.exampleValue} onChange={(exampleValue) => update({ exampleValue })} /></div> : null}
        {column.input === "choice" && column.options.length ? <fieldset className="grid gap-1"><legend className="mb-1 text-[11px] text-muted-foreground">Räknas som ej ifyllt (t.ex. Ej mätt)</legend>{column.options.map((option) => <Check key={option} label={option} checked={column.notFilledOptions.includes(option)} onChange={(checked) => update({ notFilledOptions: checked ? [...column.notFilledOptions, option] : column.notFilledOptions.filter((item) => item !== option) })} />)}</fieldset> : null}
        {column.input === "text" || column.input === "textarea" || column.input === "number" ? <TextSetting label="Förslag (ett per rad)" area value={column.suggestions.join("\n")} onChange={(value) => update({ suggestions: lines(value) })} /> : null}
        {column.required && valued ? <Select label="Obligatorisk" value={column.requiredIf} onChange={(requiredIf) => update({ requiredIf })}><option value="">Alltid</option>{switches.map((field) => <option key={field.id} value={field.key}>Bara när {field.label} är Ja</option>)}</Select> : null}
        {column.input === "formula" ? <BandsEditor bands={column.bands} onChange={(bands) => update({ bands })} /> : null}
        {column.input === "number" ? <div className="grid grid-cols-3 gap-2">
          <TextSetting label="Lägsta tillåtna" value={numberText(column.allowedMin)} onChange={(value) => update({ allowedMin: numberOrNull(value) })} />
          <TextSetting label="Högsta tillåtna" value={numberText(column.allowedMax)} onChange={(value) => update({ allowedMax: numberOrNull(value) })} />
          <Select label="Decimaler" value={column.decimals ?? ""} onChange={(value) => update({ decimals: value === "" ? null : Number(value) })}><option value="">Valfritt</option>{[0, 1, 2, 3, 4].map((count) => <option key={count} value={count}>Högst {count}</option>)}</Select>
        </div> : null}
        {column.input === "number" || column.input === "formula" ? <LimitChoice document={document} limitKey={column.limitKey} trend={column.trend} onChange={(patch) => update(patch)} /> : null}
        {column.trend && block.rowMode !== "fixed" ? <p className="text-[11px] text-muted-foreground">Trend följs per fast rad – välj Fasta rader för tabellen.</p> : null}
        {column.input === "text" || column.input === "textarea" || column.input === "number" ? <TextSetting label="Platshållare i fältet" value={column.placeholder} max={200} onChange={(placeholder) => update({ placeholder })} /> : null}
        {block.layout === "cards" || block.taskLayout === "cards" ? <>
          <p className="text-xs font-medium text-muted-foreground">I kortet</p>
          <div className="grid grid-cols-2 gap-2">
            <TextSetting label="Etikett i kortet (tom = etiketten)" value={column.cardLabel} max={120} onChange={(cardLabel) => update({ cardLabel })} />
            <Select label="Bredd" value={column.cardWidth} onChange={(cardWidth) => update({ cardWidth: cardWidth as FormColumn["cardWidth"] })}><option value="auto">Efter typ</option><option value="quarter">Fjärdedel</option><option value="half">Halv</option><option value="full">Hel</option></Select>
          </div>
          <TextSetting label="Grupp i kortet (fält med samma gruppnamn ramas in, t.ex. Före skyddsåtgärd)" value={column.group} max={120} onChange={(group) => update({ group })} />
          {column.input === "formula" ? <Select label="Visas" value={column.placement === "header" ? "header" : "body"} onChange={(placement) => update({ placement: placement as FormColumn["placement"] })}><option value="body">Bland fälten</option><option value="header">Som märke i kortets rubrikrad (Före: 15 · Hög)</option></Select> : null}
        </> : null}
        {block.layout === "rows" || block.taskLayout === "rows" ? <>
          <p className="text-xs font-medium text-muted-foreground">I mätraderna</p>
          <div className="grid grid-cols-2 gap-2">
            <TextSetting label="Bredd (t.ex. 2.3fr, 4.5rem)" value={column.screenWidth} max={60} placeholder="auto" onChange={(screenWidth) => update({ screenWidth })} />
            <Select label="Rad" value={column.line} onChange={(line) => update({ line: Number(line) === 2 ? 2 : 1 })}><option value={1}>Första raden</option><option value={2}>Andra raden</option></Select>
          </div>
          {column.input === "formula" ? <Select label="Visas" value={column.placement === "note" ? "note" : "body"} onChange={(placement) => update({ placement: placement as FormColumn["placement"] })}><option value="body">Som värde</option><option value="note">Som text under raden</option></Select> : null}
        </> : null}
        <p className="text-xs font-medium text-muted-foreground">I PDF:en</p>
        <Select label="Kolumnen" value={column.pdf} onChange={(pdf) => update({ pdf: pdf as FormColumn["pdf"] })}><option value="show">Visas</option><option value="hide">Visas inte</option>{index ? <option value="join">Slås ihop med kolumnen före (t.ex. 24 / 26 ms)</option> : null}</Select>
        {column.pdf === "show" ? <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2"><TextSetting label="Rubrik i PDF (tom = etiketten)" value={column.pdfLabel} max={120} onChange={(pdfLabel) => update({ pdfLabel })} /><TextSetting label="Bredd" value={column.pdfWidth === null ? "" : String(column.pdfWidth)} placeholder="auto" onChange={(value) => update({ pdfWidth: numberOrNull(value) })} /></div> : null}
      </div>
    </details>
    <div className="flex flex-wrap items-center gap-1">
      {column.input !== "formula" && column.input !== "assessment" ? <Check label="Obligatorisk" checked={column.required} onChange={(required) => update({ required })} /> : null}
      <span className="ml-auto flex gap-0.5">
        <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={`Flytta kolumn ${index + 1} vänster`} disabled={!index} onClick={() => move(-1)}><ArrowUp className="-rotate-90" /></Button>
        <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={`Flytta kolumn ${index + 1} höger`} disabled={index === block.columns.length - 1} onClick={() => move(1)}><ArrowDown className="-rotate-90" /></Button>
        <Button type="button" size="icon" variant="ghost" className="size-8 text-destructive" aria-label={`Ta bort kolumn ${index + 1}`} disabled={block.columns.length === 1} onClick={remove}><Trash2 /></Button>
      </span>
    </div>
  </fieldset>;
}

/** The layout the task shows: the PDF layout unless the table chose another for the task. */
const tableLayoutOf = (block: FormTableBlock) => block.taskLayout === "same" ? block.layout : block.taskLayout;

function TableSettings({ document, block, onPatch }: { document: EditorDocument; block: FormTableBlock; onPatch: (patch: Partial<FormTableBlock>) => void }) {
  const setColumns = (columns: FormColumn[]) => onPatch({ columns });
  const updateColumn = (id: string, patch: Partial<FormColumn>) => setColumns(block.columns.map((column) => column.id === id ? { ...column, ...patch } : column));
  const moveColumn = (index: number, delta: -1 | 1) => { const next = [...block.columns]; const target = index + delta; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; setColumns(next); };
  const cells = block.columns.map((column) => column.key);
  const hasAssessment = block.columns.some((column) => column.input === "assessment");
  const add = (column: FormColumn) => setColumns([...block.columns, column]);
  return <Group title="Tabell">
    <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">Visning<select className="form-select" value={block.layout} onChange={(event) => onPatch({ layout: event.target.value as FormTableBlock["layout"] })}><option value="grid">Tabell – en rad per mätning</option><option value="rows">Mätrader – kompakta rader som i kontrollen</option><option value="cards">Objektkort – fält och bilder per objekt</option></select></label>
    <Select label="Visning i uppgiften (PDF:en följer Visning ovan)" value={block.taskLayout} onChange={(taskLayout) => onPatch({ taskLayout: taskLayout as FormTableBlock["taskLayout"] })}><option value="same">Samma som i PDF:en</option><option value="grid">Tabell</option><option value="rows">Mätrader (kolumner kan läggas på två rader)</option><option value="cards">Objektkort</option></Select>
    {block.layout === "cards" || block.taskLayout === "cards" ? <>
      <div className="grid grid-cols-2 gap-2">
        <TextSetting label="Vad ett kort heter (t.ex. Objekt, Risk)" value={block.itemLabel} max={60} onChange={(itemLabel) => onPatch({ itemLabel })} />
        <TextSetting label="I flertal (t.ex. objekt, risker)" value={block.itemLabelPlural} max={60} onChange={(itemLabelPlural) => onPatch({ itemLabelPlural })} />
      </div>
      <TextSetting label="Kortets rubrik i PDF (kolumnkoder inom klamrar)" mono value={block.cardTitle} max={200} placeholder="{placering} · {profil} · typ {typ}" onChange={(cardTitle) => onPatch({ cardTitle })} />
    </> : null}
    <div className="grid grid-cols-2 gap-2">
      <TextSetting label="Text när listan är tom" value={block.emptyTitle} max={200} placeholder="Inga rader ännu …" onChange={(emptyTitle) => onPatch({ emptyTitle })} />
      {block.layout === "cards" || block.taskLayout === "cards" ? <TextSetting label="Knappen när listan är tom" value={block.emptyAction} max={120} placeholder="Lägg till …" onChange={(emptyAction) => onPatch({ emptyAction })} /> : null}
    </div>
    {block.layout === "cards" || block.taskLayout === "cards" ? <Select label="Ikon när listan är tom" value={block.emptyIcon} onChange={(emptyIcon) => onPatch({ emptyIcon })}><option value="">Urklipp</option>{FORM_ICONS.map((icon) => <option key={icon} value={icon}>{FORM_ICON_COMPONENTS[icon].label}</option>)}</Select> : null}
    <Check label="Kopiera-knapp på raderna och korten" checked={block.copyRows} onChange={(copyRows) => onPatch({ copyRows })} />
    {block.layout === "cards" || block.taskLayout === "cards" ? <Check label="Skapa arbetsorder från ett kort (uppföljning av en brist)" checked={block.workOrders} onChange={(workOrders) => onPatch({ workOrders })} /> : null}
    {block.rowMode === "free" && tableLayoutOf(block) !== "rows" ? <Check label="Nytt protokoll börjar utan rad (den som fyller i lägger till den första)" checked={block.startEmpty} onChange={(startEmpty) => onPatch({ startEmpty })} /> : null}
    <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">Rader<select className="form-select" value={block.rowMode} onChange={(event) => onPatch({ rowMode: event.target.value as "fixed" | "free" })}><option value="free">Fria rader – den som fyller i lägger till</option><option value="fixed">Fasta rader – bestäms här</option></select></label>
    {block.rowMode === "fixed" ? <TextSetting label="Fasta rader (en per rad)" area value={block.fixedRows.join("\n")} onChange={(value) => onPatch({ fixedRows: lines(value) })} /> : null}
    <Check label="Minst en ifylld rad krävs" checked={block.required} onChange={(required) => onPatch({ required })} />
    {block.rowMode === "free" ? <Check label="Exempelrad kan läggas till (tas bort före slutförande)" checked={block.allowExample} onChange={(allowExample) => onPatch({ allowExample })} /> : null}
    <p className="text-xs font-semibold">Kolumner</p>
    {block.columns.map((column, index) => <ColumnSettings key={column.id} document={document} block={block} column={column} index={index} update={(patch) => updateColumn(column.id, patch)} move={(delta) => moveColumn(index, delta)} remove={() => setColumns(block.columns.filter((item) => item.id !== column.id))} />)}
    <div className="flex flex-wrap gap-1.5">
      <Button type="button" size="sm" variant="outline" onClick={() => add(newColumn("Värde", "number", cells))}><Plus />Talkolumn</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => add(newColumn("Text", "text", cells))}><Plus />Textkolumn</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => add(newColumn("Kontrollerad", "check", cells))}><Plus />Kryssruta</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => add({ ...newColumn("Bedömning", "scale", cells), options: ["Låg", "Medel", "Hög"] })}><Plus />Skala</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => add(newColumn("Bilder", "images", cells))}><Plus />Bildkolumn</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => add({ ...newColumn("Resultat", "formula", cells), formula: cells.length >= 2 ? `[${cells[cells.length - 2]}] * [${cells[cells.length - 1]}]` : "1" })}><Plus />Formelkolumn</Button>
      {!hasAssessment ? <Button type="button" size="sm" variant="outline" onClick={() => add({ ...newColumn("Godkänd", "assessment", cells), formula: cells.length >= 2 ? `[${cells[cells.length - 2]}] >= [${cells[cells.length - 1]}]` : "" })}><Plus />Godkänd</Button> : null}
    </div>
    <p className="text-[11px] text-muted-foreground">I andra formler används kolumnerna som {block.key}.kod, till exempel Summa av {block.label} · {block.columns[0]?.label}.</p>
  </Group>;
}
