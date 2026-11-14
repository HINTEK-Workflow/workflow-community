"use client";

import { plural } from "@/lib/plural";
import { useState } from "react";
import { Calculator, ClipboardPaste, Plus, Save, Trash2 } from "lucide-react";
import { useNativeTopBar } from "@/components/native";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/features/kfid/confirm";
import { Panel } from "@/features/kfid/ui";
import { AMPACITY_MAX_ROWS, AMPACITY_SLOTS, CABLE_TYPE_MAX_ROWS, CABLE_TYPE_NAME_MAX, DEVICE_LABEL, DEVICE_MAX_ROWS, DEVICE_TYPES, type AmpacityMaterial, type DeviceType } from "@/lib/calculators/company-data";
import { freeSlot, mergeRows, modelFromValues, parsePastedRows, sameModel, saveInputs, SINGLE_FIELDS, type CableTypeDraft, type DeviceRowDraft, type PanelModel, type RowDraft, type TableDraft } from "@/lib/calculators/company-values-edit";
import type { CompanyValue, CompanyValueInput } from "@/lib/workflow/company-values";
import { RemoveButton } from "@/components/ui/remove-button";

/**
 * The calculators' own values under Inställningar → Värden och referenser (2026-10-07): the reactance, the limit
 * for the voltage drop, the voltage factors and temperatures, and the company's tables of how much current a cable of
 * each area may carry (up to three, each named by its source) and the list Mina skyddsapparater with the trip current Ia per device and required time (Kalkylator, 2026-10-12). Workflow delivers none of it. Only the company's
 * administrator changes it; one save writes the rows that changed. What is typed stays until saved, also when the page
 * above reads the values again. As a screen of its own at level 1 (`screen`), Avbryt and Spara sit in the top bar like on
 * every other fill-in page (2026-10-13) and the panel's own save button is left out; Spara closes the screen.
 * KA4 (2026-11-01): the company's own cable types, and several rows of one protective device are its curve.
 */
const MATERIAL_TITLE = { cu: "Koppar", al: "Aluminium" } as const;
const numeric = { type: "text", inputMode: "decimal", autoComplete: "off", autoCapitalize: "off", spellCheck: false } as const;

export function CalculatorValuesPanel({ values, canEdit, onSave, screen }: { values: readonly CompanyValue[]; canEdit: boolean; onSave: (inputs: CompanyValueInput[]) => Promise<boolean>;
  /** Level 1: the panel is a screen with Avbryt/Spara in the top bar (M1); `onClose` leaves it. */
  screen?: { title: string; onClose: () => void } }) {
  const [confirm, confirmCard] = useConfirm();
  const [note, setNote] = useState("");
  const [seen, setSeen] = useState(values);
  const [model, setModel] = useState<PanelModel>(() => modelFromValues(values));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // The values were read again: an untouched panel follows them, an edited one keeps what was typed.
  if (seen !== values) {
    const untouched = sameModel(model, modelFromValues(seen));
    setSeen(values);
    if (untouched) setModel(modelFromValues(values));
  }
  const dirty = !sameModel(model, modelFromValues(values));
  const editable = canEdit && !saving;
  const setTable = (slot: number, change: (table: TableDraft) => TableDraft) => setModel((current) => ({ ...current, tables: current.tables.map((table) => (table.slot === slot ? change(table) : table)) }));

  const save = async () => {
    const result = saveInputs(values, model);
    if ("error" in result) { setError(result.error); return; }
    setError("");
    if (!result.inputs.length) return;
    setSaving(true);
    let saved = false;
    try { saved = await onSave(result.inputs); } finally { setSaving(false); }
    if (saved) screen?.onClose();
  };
  useNativeTopBar(screen ? {
    title: screen.title,
    cancel: { onClick: () => void (async () => {
      if (dirty && !await confirm({ title: "Kasta ändringarna?", message: "Det du har skrivit sedan skärmen öppnades sparas inte.", confirmLabel: "Kasta", cancelLabel: "Fortsätt redigera", tone: "danger" })) return;
      screen.onClose();
    })() },
    // A disabled Spara still answers (no dead button): with nothing changed it says so.
    save: canEdit ? { busy: saving, disabled: !dirty, onClick: () => { if (saving) return; if (!dirty) { setNote("Inget är ändrat ännu."); return; } setNote(""); void save(); } } : null,
  } : null);

  return <Panel title="Kalkylator" description="Värden som Kalkylatorn använder. Workflow levererar ingen tabell och ingen gräns: ange era egna värden och var de kommer ifrån."
    icon={Calculator} className="scroll-mt-24">
    <div className="space-y-8" data-testid="calc-values">
      <section className="space-y-4" aria-labelledby="calc-values-single">
        <div>
          <h3 id="calc-values-single" className="text-sm font-semibold">Kabel och beräkningsvillkor</h3>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Förval i Kalkylatorn när fältet där lämnas tomt.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {SINGLE_FIELDS.map((field) => <div key={field.key} className="grid min-w-0 content-start gap-1.5" data-testid={`calc-value-${field.key}`}>
            <Label htmlFor={`calc-value-${field.key}`} className="field-label flex-wrap text-xs font-medium">{field.label}{field.unit ? ` (${field.unit})` : ""}</Label>
            <Input id={`calc-value-${field.key}`} {...numeric} className="bg-card" value={model.singles[field.key] ?? ""} disabled={!editable}
              onChange={(event) => setModel((current) => ({ ...current, singles: { ...current.singles, [field.key]: event.target.value } }))} />
            <p className="text-xs leading-5 text-muted-foreground">{field.help}</p>
          </div>)}
        </div>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <TextField id="calc-values-source" label="Källa" value={model.singleSource} max={300} disabled={!editable} onChange={(text) => setModel((current) => ({ ...current, singleSource: text }))} />
          <TextField id="calc-values-reference" label="Version eller datum" value={model.singleReference} max={120} disabled={!editable} onChange={(text) => setModel((current) => ({ ...current, singleReference: text }))} />
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="calc-values-tables">
        <div>
          <h3 id="calc-values-tables" className="text-sm font-semibold">Belastbarhet per area</h3>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Hur mycket ström en kabel av en viss area får bära enligt företagets egen tabell. Kabeldimensionering hämtar värdet här. Källan namnger tabellen, till exempel förläggningssättet. Upp till {AMPACITY_SLOTS} tabeller.</p>
        </div>
        {model.tables.map((table) => <TableEditor key={table.slot} table={table} disabled={!editable} onChange={(change) => setTable(table.slot, change)}
          onRemove={model.tables.length > 1 ? () => setModel((current) => ({ ...current, tables: current.tables.filter((item) => item.slot !== table.slot) })) : undefined} />)}
        {freeSlot(model) !== null && editable ? <Button type="button" variant="outline" onClick={() => setModel((current) => { const slot = freeSlot(current); return slot === null ? current : { ...current, tables: [...current.tables, { slot, source: "", reference: "", cu: [], al: [] }].sort((a, b) => a.slot - b.slot) }; })} data-testid="calc-values-add-table"><Plus />Lägg till tabell</Button> : null}
      </section>

      <section className="space-y-4" aria-labelledby="calc-values-types" data-testid="calc-cable-types">
        <div>
          <h3 id="calc-values-types" className="text-sm font-semibold">Kabeltyper</h3>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Företagets egna kablar. Kalkylatorn fyller i värdena när du väljer typen. Workflow levererar ingen lista. Upp till {CABLE_TYPE_MAX_ROWS} typer.</p>
        </div>
        <TextField id="calc-types-source" label="Källa" value={model.cableTypes.source} max={300} disabled={!editable} onChange={(text) => setModel((current) => ({ ...current, cableTypes: { ...current.cableTypes, source: text } }))} />
        <CableTypeRows rows={model.cableTypes.rows} disabled={!editable} onChange={(rows) => setModel((current) => ({ ...current, cableTypes: { ...current.cableTypes, rows } }))} />
      </section>

      <section className="space-y-4" aria-labelledby="calc-values-devices" data-testid="calc-devices">
        <div>
          <h3 id="calc-values-devices" className="text-sm font-semibold">Mina skyddsapparater</h3>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Utlösningsströmmen Ia för en skyddsapparat och en kravtid, ur tillverkarens tabell. Frånkopplingstid och Största gruppledningslängd fyller i Ia härifrån. Flera rader med samma typ och märkström blir skyddets kurva. Workflow levererar ingen tabell: ange era egna värden och var de kommer ifrån. Upp till {DEVICE_MAX_ROWS} rader.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <TextField id="calc-devices-source" label="Källa" value={model.devices.source} max={300} disabled={!editable} onChange={(text) => setModel((current) => ({ ...current, devices: { ...current.devices, source: text } }))} />
          <TextField id="calc-devices-reference" label="Version eller datum" value={model.devices.reference} max={120} disabled={!editable} onChange={(text) => setModel((current) => ({ ...current, devices: { ...current.devices, reference: text } }))} />
        </div>
        <DeviceRows rows={model.devices.rows} disabled={!editable} onChange={(rows) => setModel((current) => ({ ...current, devices: { ...current.devices, rows } }))} />
      </section>

      {error ? <p role="alert" className="notice text-destructive" data-testid="calc-values-error">{error}</p> : null}
      {canEdit && !screen ? <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={!dirty || saving} onClick={() => void save()} data-testid="calc-values-save"><Save />Spara värdena för Kalkylatorn</Button>
        {dirty ? <p className="text-xs text-muted-foreground">Det du skrivit är inte sparat ännu.</p> : null}
      </div> : null}
      {canEdit && screen && (dirty || note) ? <p className="text-xs text-muted-foreground" role="status" data-testid="calc-values-note">{dirty ? "Det du skrivit är inte sparat ännu." : note}</p> : null}
    </div>
    {confirmCard}
  </Panel>;
}

function TextField({ id, label, value, max, disabled, onChange }: { id: string; label: string; value: string; max: number; disabled: boolean; onChange: (text: string) => void }) {
  return <div className="grid min-w-0 content-start gap-1.5">
    <Label htmlFor={id} className="field-label text-xs font-medium">{label}</Label>
    <Input id={id} data-testid={id} type="text" className="bg-card" value={value} disabled={disabled} maxLength={max} onChange={(event) => onChange(event.target.value)} />
  </div>;
}

function TableEditor({ table, disabled, onChange, onRemove }: { table: TableDraft; disabled: boolean; onChange: (change: (table: TableDraft) => TableDraft) => void; onRemove?: () => void }) {
  return <div className="field-group space-y-4 rounded-xl border p-4" data-testid={`calc-table-${table.slot}`}>
    <div className="flex items-center justify-between gap-3">
      <h4 className="text-sm font-semibold">Tabell {table.slot}</h4>
      {onRemove && !disabled ? <Button type="button" variant="ghost" onClick={onRemove} data-testid={`calc-table-${table.slot}-remove`}><Trash2 />Ta bort tabellen</Button> : null}
    </div>
    <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <TextField id={`calc-table-${table.slot}-source`} label="Källa (namnger tabellen)" value={table.source} max={300} disabled={disabled} onChange={(text) => onChange((current) => ({ ...current, source: text }))} />
      <TextField id={`calc-table-${table.slot}-reference`} label="Version eller datum" value={table.reference} max={120} disabled={disabled} onChange={(text) => onChange((current) => ({ ...current, reference: text }))} />
    </div>
    <div className="grid gap-6 lg:grid-cols-2">
      {(["cu", "al"] as const).map((material) => <RowList key={material} slot={table.slot} material={material} rows={table[material]} disabled={disabled}
        onChange={(rows) => onChange((current) => ({ ...current, [material]: rows }))} />)}
    </div>
  </div>;
}

function RowList({ slot, material, rows, disabled, onChange }: { slot: number; material: "cu" | "al"; rows: RowDraft[]; disabled: boolean; onChange: (rows: RowDraft[]) => void }) {
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const id = `calc-table-${slot}-${material}`;
  const edit = (index: number, change: Partial<RowDraft>) => onChange(rows.map((row, at) => (at === index ? { ...row, ...change } : row)));
  const paste = () => {
    const parsed = parsePastedRows(text);
    if (!parsed.rows.length) { setNote("Inga rader hittades. Skriv area och belastbarhet på varje rad."); return; }
    onChange(mergeRows(rows, parsed.rows).slice(0, AMPACITY_MAX_ROWS));
    setNote(`${plural(parsed.rows.length, "rad", "rader")} lades till${parsed.skipped ? `, ${parsed.skipped} hoppades över` : ""}.`);
    setText("");
    setPasting(false);
  };
  return <div className="space-y-2" data-testid={id}>
    <p className="text-sm font-medium">{MATERIAL_TITLE[material]}</p>
    {rows.length ? <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.5rem] gap-x-2 gap-y-2 max-lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem]">
      <span className="text-xs font-medium text-muted-foreground">Area (mm²)</span><span className="text-xs font-medium text-muted-foreground">Belastbarhet (A)</span><span />
      {rows.map((row, index) => <RowFields key={index} id={`${id}-${index}`} row={row} index={index} disabled={disabled} onEdit={(change) => edit(index, change)} onRemove={() => onChange(rows.filter((_, at) => at !== index))} />)}
    </div> : <p className="text-xs leading-5 text-muted-foreground">Inga rader. Kabelarea säger Ej bedömd för {MATERIAL_TITLE[material].toLowerCase()} tills de finns.</p>}
    {!disabled ? <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={rows.length >= AMPACITY_MAX_ROWS} onClick={() => onChange([...rows, { area: "", amps: "" }])} data-testid={`${id}-add`}><Plus />Lägg till rad</Button>
      <Button type="button" variant="ghost" onClick={() => { setPasting(!pasting); setNote(""); }} aria-expanded={pasting} data-testid={`${id}-paste-toggle`}><ClipboardPaste />Klistra in rader</Button>
    </div> : null}
    {pasting ? <div className="space-y-2">
      <Label htmlFor={`${id}-paste`} className="field-label text-xs font-medium">Area och belastbarhet, en rad per area (från ett kalkylblad)</Label>
      <textarea id={`${id}-paste`} className="form-textarea" value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} data-testid={`${id}-paste`} />
      <Button type="button" onClick={paste} data-testid={`${id}-paste-add`}>Lägg till raderna</Button>
    </div> : null}
    {note ? <p className="text-xs text-muted-foreground" role="status">{note}</p> : null}
  </div>;
}

function RowFields({ id, row, index, disabled, onEdit, onRemove }: { id: string; row: RowDraft; index: number; disabled: boolean; onEdit: (change: Partial<RowDraft>) => void; onRemove: () => void }) {
  return <>
    <Input id={`${id}-area`} {...numeric} className="bg-card" aria-label={`Area, rad ${index + 1}`} value={row.area} disabled={disabled} onChange={(event) => onEdit({ area: event.target.value })} />
    <Input id={`${id}-amps`} {...numeric} className="bg-card" aria-label={`Belastbarhet, rad ${index + 1}`} value={row.amps} disabled={disabled} onChange={(event) => onEdit({ amps: event.target.value })} />
    {disabled ? <span /> : <RemoveButton label={`Ta bort rad ${index + 1}`} onClick={onRemove} />}
  </>;
}

/** The rows of Kabeltyper: every field has its label above it, and the row follows the room it has (390–1920 px), not the screen. */
function CableTypeRows({ rows, disabled, onChange }: { rows: CableTypeDraft[]; disabled: boolean; onChange: (rows: CableTypeDraft[]) => void }) {
  const edit = (index: number, change: Partial<CableTypeDraft>) => onChange(rows.map((row, at) => (at === index ? { ...row, ...change } : row)));
  return <div className="@container space-y-2" data-testid="calc-cable-type-rows">
    {rows.length ? rows.map((row, index) => <CableTypeFields key={index} index={index} row={row} disabled={disabled} onEdit={(change) => edit(index, change)} onRemove={() => onChange(rows.filter((_, at) => at !== index))} />)
      : <p className="text-xs leading-5 text-muted-foreground">Inga kabeltyper. Då skriver du in kabelns värden i Kalkylatorn.</p>}
    {!disabled ? <Button type="button" variant="outline" disabled={rows.length >= CABLE_TYPE_MAX_ROWS} onClick={() => onChange([...rows, { name: "", material: rows[rows.length - 1]?.material ?? "cu", area: "", resistance: "", reactance: "" }])} data-testid="calc-cable-type-add"><Plus />Lägg till kabeltyp</Button> : null}
  </div>;
}

function CableTypeFields({ index, row, disabled, onEdit, onRemove }: { index: number; row: CableTypeDraft; disabled: boolean; onEdit: (change: Partial<CableTypeDraft>) => void; onRemove: () => void }) {
  const id = `calc-cable-type-${index}`;
  const number = (key: "area" | "resistance" | "reactance", label: string) => <div className="grid min-w-0 content-start gap-1.5">
    <Label htmlFor={`${id}-${key}`} className="field-label flex-wrap text-xs font-medium">{label}</Label>
    <Input id={`${id}-${key}`} data-testid={`${id}-${key}`} {...numeric} className="bg-card" value={row[key]} disabled={disabled} onChange={(event) => onEdit({ [key]: event.target.value })} />
  </div>;
  return <div className="field-group grid grid-cols-2 gap-3 rounded-xl border p-3 @3xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2.75rem] @3xl:items-end" data-testid={id}>
    <div className="col-span-2 grid min-w-0 content-start gap-1.5 @3xl:col-span-1">
      <Label htmlFor={`${id}-name`} className="field-label text-xs font-medium">Namn</Label>
      <Input id={`${id}-name`} data-testid={`${id}-name`} type="text" className="bg-card" value={row.name} disabled={disabled} maxLength={CABLE_TYPE_NAME_MAX} onChange={(event) => onEdit({ name: event.target.value })} />
    </div>
    <div className="grid min-w-0 content-start gap-1.5">
      <Label htmlFor={`${id}-material`} className="field-label text-xs font-medium">Material</Label>
      <select id={`${id}-material`} data-testid={`${id}-material`} className="form-select" value={row.material} disabled={disabled} onChange={(event) => onEdit({ material: event.target.value as AmpacityMaterial })}>
        <option value="cu">{MATERIAL_TITLE.cu}</option><option value="al">{MATERIAL_TITLE.al}</option>
      </select>
    </div>
    {number("area", "Area (mm²)")}
    {number("resistance", "R vid 20 °C (Ω/km)")}
    {number("reactance", "X (Ω/km, valfritt)")}
    {disabled ? null : <div className="col-span-2 flex justify-end @3xl:col-span-1"><RemoveButton label={`Ta bort kabeltyp ${index + 1}`} onClick={onRemove} /></div>}
  </div>;
}

const DEVICE_COLUMNS = "grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2.5rem] max-lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2.75rem]";

function DeviceRows({ rows, disabled, onChange }: { rows: DeviceRowDraft[]; disabled: boolean; onChange: (rows: DeviceRowDraft[]) => void }) {
  const edit = (index: number, change: Partial<DeviceRowDraft>) => onChange(rows.map((row, at) => (at === index ? { ...row, ...change } : row)));
  return <div className="space-y-2" data-testid="calc-device-rows">
    {rows.length ? <div className={`grid ${DEVICE_COLUMNS} gap-x-2 gap-y-2`}>
      <span className="text-xs font-medium text-muted-foreground">Typ</span><span className="text-xs font-medium text-muted-foreground">In (A)</span><span className="text-xs font-medium text-muted-foreground">Tid (s)</span><span className="text-xs font-medium text-muted-foreground">Ia (A)</span><span />
      {rows.map((row, index) => <DeviceRowFields key={index} index={index} row={row} disabled={disabled} onEdit={(change) => edit(index, change)} onRemove={() => onChange(rows.filter((_, at) => at !== index))} />)}
    </div> : <p className="text-xs leading-5 text-muted-foreground">Inga rader. Då skriver du in Ia i Kalkylatorn.</p>}
    {!disabled ? <Button type="button" variant="outline" disabled={rows.length >= DEVICE_MAX_ROWS} onClick={() => onChange([...rows, { type: rows[rows.length - 1]?.type ?? "gg", rated: "", time: rows[rows.length - 1]?.time ?? "", trip: "" }])} data-testid="calc-device-add"><Plus />Lägg till skyddsapparat</Button> : null}
  </div>;
}

function DeviceRowFields({ index, row, disabled, onEdit, onRemove }: { index: number; row: DeviceRowDraft; disabled: boolean; onEdit: (change: Partial<DeviceRowDraft>) => void; onRemove: () => void }) {
  return <>
    <select className="form-select" aria-label={`Typ, rad ${index + 1}`} value={row.type} disabled={disabled} onChange={(event) => onEdit({ type: event.target.value as DeviceType })} data-testid={`calc-device-${index}-type`}>
      {DEVICE_TYPES.map((type) => <option key={type} value={type}>{DEVICE_LABEL[type]}</option>)}
    </select>
    <Input {...numeric} className="bg-card" aria-label={`Märkström, rad ${index + 1}`} value={row.rated} disabled={disabled} onChange={(event) => onEdit({ rated: event.target.value })} data-testid={`calc-device-${index}-rated`} />
    <Input {...numeric} className="bg-card" aria-label={`Kravtid, rad ${index + 1}`} value={row.time} disabled={disabled} onChange={(event) => onEdit({ time: event.target.value })} data-testid={`calc-device-${index}-time`} />
    <Input {...numeric} className="bg-card" aria-label={`Utlösningsström Ia, rad ${index + 1}`} value={row.trip} disabled={disabled} onChange={(event) => onEdit({ trip: event.target.value })} data-testid={`calc-device-${index}-trip`} />
    {disabled ? <span /> : <RemoveButton label={`Ta bort rad ${index + 1}`} onClick={onRemove} />}
  </>;
}
