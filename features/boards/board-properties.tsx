"use client";

import { useId, useState, type ReactNode } from "react";
import { Copy, ImageUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RemoveButton } from "@/components/ui/remove-button";
import { CheckField, Field } from "@/features/kfid/ui";
import { EditorSegmented } from "@/components/editor-ribbon";
import { screenCapacity, tvInches } from "@/lib/boards/capacity";
import { GRID_COLUMNS, type Rect } from "@/lib/boards/grid";
import { AGGREGATE_LABEL, CARD_ACCENTS, CHART_KIND_LABEL, CHART_KINDS, cardDefinition, DISTANCE, DISTANCES, distanceGrid, TABLE_AGGREGATES, TEXT_SIZE_LABEL, type BoardCard, type BoardLayout, type CardSettings, type DataRef, type Distance, type TableAggregate } from "@/lib/boards/model";
import type { MetricGroup } from "@/lib/boards/metrics";
import { PERIOD_LABEL, PREVIOUS_PERIOD_LABEL, type Period } from "@/lib/boards/period";
import type { CardData } from "@/lib/boards/shapes";
import type { TableColumn } from "@/lib/boards/table";
import { announce } from "@/lib/workflow/toast";
import { cn } from "@/lib/utils";
import { uploadBoardImage, type MetricOption, type TableListItem } from "./boards-api";
import { BoardCardView } from "./board-card";
import { CARD_ICON } from "./card-icons";
import { isSourceCardType } from "@/lib/boards/cards";
import { SourceCardSettings } from "./cards";
import { TrendFields } from "./cards/trend";

/**
 * Egenskaper (Tavlor etapp 1, 2026-11-18; richer 2026-11-19: better creating and editing of each card): the settings beside the
 * editor's sheet (as Skapa formulär's block settings). With a card chosen: a live picture of the card, then Innehåll (title, what it
 * reads, period and comparison), Mål och enhet, Utseende (colour, emphasis, text size and the type's own choices), Storlek och plats,
 * and Duplicera / Ta bort at the top. Without a card: the board's name, text, format and Avstånd. The fields follow the app's rule:
 * the label above, help under.
 */
const num = (text: string): number | null => { const value = Number(text.replace(",", ".").replace(/\s/g, "")); return text.trim() && Number.isFinite(value) ? value : null; };
const numText = (value: number | null | undefined) => value === null || value === undefined ? "" : String(value);
const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => String(from + index));

function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return <section className="space-y-3 border-t pt-3 first:border-0 first:pt-0" data-testid={testId}><h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>{children}</section>;
}

export function BoardSettingsPanel({ name, description, layout, onName, onDescription, onOrientation, onDistance }: {
  name: string; description: string; layout: BoardLayout;
  onName: (value: string) => void; onDescription: (value: string) => void; onOrientation: (value: BoardLayout["orientation"]) => void;
  onDistance: (value: Distance) => void;
}) {
  const distance = layout.distance ?? "near";
  const grid = distanceGrid(distance, layout.rows);
  return <div className="space-y-4 p-4" data-testid="board-settings">
    <Section title="Tavlan">
      <Field id="board-name" label="Namn" value={name} onChange={onName} required />
      <Field id="board-description" label="Beskrivning" value={description} onChange={onDescription} help="Syns under namnet på tavlans sida och i listan." />
    </Section>
    <Section title="Format">
      <EditorSegmented label="Format" value={layout.orientation} onChange={onOrientation} testId="board-orientation"
        options={[{ value: "landscape", label: "Liggande 16:9" }, { value: "portrait", label: "Stående 9:16" }]} />
      <p className="text-xs text-muted-foreground">Tavlan delas i 24 kolumner och {layout.rows} rader. Korten och texten växer med skärmen, från en surfplatta till en stor tv. Välj Förhandsgranska för att se tavlan i olika storlekar.</p>
    </Section>
    <Section title="Avstånd" testId="board-distance-section">
      <EditorSegmented label="Avstånd" value={distance} onChange={onDistance} testId="board-distance"
        options={DISTANCES.map((value) => ({ value, label: DISTANCE[value].label }))} />
      <p className="text-xs text-muted-foreground" data-testid="board-distance-hint">{DISTANCE[distance].hint} {distance === "near" ? "Texten är så stor som rutorna ger." : `Texten växer upp till ${String(DISTANCE[distance].scale).replace(".", ",")} gånger, som om tavlan hade ${grid.columns} kolumner och ${grid.rows} rader. Det är de små korten som växer mest, och korten ligger kvar där du har lagt dem.`} En fast skärm kan välja ett eget avstånd.</p>
      <p className="text-xs text-muted-foreground" data-testid="board-distance-capacity">På en {tvInches(distance)}-tums tv, en vanlig storlek på det här avståndet, går ungefär {screenCapacity("tv1080", layout.orientation, distance, layout.rows).cards} kort att läsa. Förhandsgranska räknar med er egen tv:s storlek.</p>
    </Section>
    <p className="text-xs text-muted-foreground">Välj ett kort på tavlan för att ändra det. Lägg till kort från raden ovanför tavlan.</p>
  </div>;
}

export function CardPanel({ card, rows, metrics, tables, data, label, now, onChange, onRect, onDuplicate, onRemove }: {
  card: BoardCard;
  /** The board's number of rows, for Storlek och plats. */
  rows: number;
  metrics: MetricOption[];
  tables: TableListItem[];
  /** The card's figures as the canvas has them, for the live picture. */
  data?: CardData;
  label?: string;
  now: number;
  onChange: (card: BoardCard) => void;
  /** A new place or size; the editor pushes other cards out of the way as a drag does. */
  onRect: (rect: Rect) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const id = useId();
  const definition = cardDefinition(card.type);
  const Icon = CARD_ICON[definition.icon];
  const set = (patch: Partial<CardSettings>) => onChange({ ...card, settings: { ...card.settings, ...patch } });
  const takesData = definition.shapes.length > 0;
  const metric = card.data?.kind === "metric" ? metrics.find((item) => item.key === (card.data as { metric: string }).metric) : undefined;
  // The live picture keeps the card's proportions on a 16:9 (or 9:16) board, at the panel's width.
  const portrait = rows > 20;
  const aspect = `${(card.w / GRID_COLUMNS) * (portrait ? 9 : 16)} / ${(card.h / rows) * (portrait ? 16 : 9)}`;
  return <div className="space-y-4 p-4" data-testid="card-settings">
    <div className="flex items-center gap-2">
      <Icon className="size-4 text-primary" aria-hidden="true" />
      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{definition.label}</h2>
      <Button type="button" size="sm" variant="outline" onClick={onDuplicate} data-testid="card-duplicate"><Copy aria-hidden="true" />Duplicera</Button>
      <RemoveButton label="Ta bort kortet" onClick={onRemove} data-testid="card-remove" />
    </div>
    <div className="rounded-lg border bg-muted/40 p-2" data-testid="card-preview">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">Så ser kortet ut</p>
      <div className="mx-auto max-h-56 w-full" style={{ aspectRatio: aspect, maxWidth: `calc(14rem * ${(card.w / card.h).toFixed(3)})` }} aria-hidden="true">
        <BoardCardView card={card} data={data} sourceLabel={label} editing now={now} />
      </div>
    </div>
    <Section title="Innehåll" testId="card-section-content">
      <Field id={`${id}-title`} label="Rubrik" value={card.title} onChange={(title) => onChange({ ...card, title: title.slice(0, 80) })} help={takesData ? "Tomt: datakällans namn." : undefined} />
      {takesData && !isSourceCardType(card.type) ? <DataSection card={card} metrics={metrics} tables={tables} onChange={onChange} /> : null}
      {isSourceCardType(card.type) ? <SourceCardSettings card={card} metrics={metrics} onChange={onChange} /> : null}
      {metric?.periods.length ? <PeriodFields card={card} metric={metric} onChange={onChange} /> : null}
    </Section>
    <TargetSection card={card} set={set} />
    <TypeSettings card={card} set={set} />
    <LookSection card={card} set={set} />
    <Section title="Storlek och plats" testId="card-section-size">
      <div className="grid grid-cols-2 gap-3">
        <Field id={`${id}-x`} label="Kolumn" value={String(card.x + 1)} onChange={(value) => onRect({ x: Number(value) - 1, y: card.y, w: card.w, h: card.h })} options={range(1, GRID_COLUMNS - card.w + 1)} />
        <Field id={`${id}-y`} label="Rad" value={String(card.y + 1)} onChange={(value) => onRect({ x: card.x, y: Number(value) - 1, w: card.w, h: card.h })} options={range(1, rows - card.h + 1)} />
        <Field id={`${id}-w`} label="Bredd" value={String(card.w)} onChange={(value) => onRect({ x: Math.min(card.x, GRID_COLUMNS - Number(value)), y: card.y, w: Number(value), h: card.h })} options={range(definition.size.minW, GRID_COLUMNS)} />
        <Field id={`${id}-h`} label="Höjd" value={String(card.h)} onChange={(value) => onRect({ x: card.x, y: Math.min(card.y, rows - Number(value)), w: card.w, h: Number(value) })} options={range(definition.size.minH, rows)} />
      </div>
      <p className="text-xs text-muted-foreground">Räknat i rutor: {GRID_COLUMNS} kolumner och {rows} rader. Du kan också dra kortet och hörnet. Med tangentbordet flyttar pilarna kortet, och Skift med pilarna ändrar storleken.</p>
      <CheckField id={`${id}-phone`} label="Dölj på telefon" description="På en telefon står korten under varandra." checked={Boolean(card.hideOnPhone)} onChange={(value) => onChange({ ...card, hideOnPhone: value || undefined })} />
    </Section>
  </div>;
}

function DataSection({ card, metrics, tables, onChange }: { card: BoardCard; metrics: MetricOption[]; tables: TableListItem[]; onChange: (card: BoardCard) => void }) {
  const id = useId();
  const shapes = cardDefinition(card.type).shapes;
  const fitting = metrics.filter((metric) => shapes.includes(metric.shape));
  const kind = card.data?.kind ?? (fitting.length ? "metric" : "table");
  const setData = (data: DataRef | null) => onChange({ ...card, data });
  const groups = [...new Set(fitting.map((metric) => metric.group))] as MetricGroup[];
  const metricKey = card.data?.kind === "metric" ? card.data.metric : null;
  const chosenMetric = metricKey ? fitting.find((metric) => metric.key === metricKey) : undefined;
  return <div className="space-y-3">
    <EditorSegmented label="Datakälla" value={kind} testId="card-source-kind" onChange={(next) => setData(next === "metric" ? (fitting[0] ? { kind: "metric", metric: fitting[0].key } : null) : (tables[0] ? { kind: "table", sourceId: tables[0].id } : null))}
      options={[{ value: "metric", label: "Workflow" }, { value: "table", label: "Egen tabell" }]} />
    {kind === "metric" ? (fitting.length ? <div className="grid gap-1.5">
      <label htmlFor={`${id}-metric`} className="field-label text-xs font-medium">Mått</label>
      <select id={`${id}-metric`} className="form-select" value={chosenMetric?.key ?? ""} onChange={(event) => setData({ kind: "metric", metric: event.target.value as MetricOption["key"] })} data-testid="card-metric" aria-describedby={`${id}-metric-help`}>
        {!chosenMetric ? <option value="">Välj…</option> : null}
        {groups.map((group) => <optgroup key={group} label={group}>{fitting.filter((metric) => metric.group === group).map((metric) => <option key={metric.key} value={metric.key}>{metric.label}</option>)}</optgroup>)}
      </select>
      <p id={`${id}-metric-help`} className="text-xs text-muted-foreground">{chosenMetric ? `${chosenMetric.description}${chosenMetric.personal ? " Innehåller namn: utanför appen väljer du vid publiceringen om de syns." : ""}` : "Bara mått du själv har rätt att se visas här."}</p>
    </div> : <p className="text-xs text-muted-foreground">Det finns inga Workflow-mått för den här korttypen som du har rätt att se.</p>)
      : <TableChoice card={card} tables={tables} onChange={setData} />}
  </div>;
}

/** Period and Jämförelse, for a measure that counts over time. */
function PeriodFields({ card, metric, onChange }: { card: BoardCard; metric: MetricOption; onChange: (card: BoardCard) => void }) {
  const id = useId();
  const ref = card.data?.kind === "metric" ? card.data : null;
  if (!ref) return null;
  const period: Period = ref.period && metric.periods.includes(ref.period) ? ref.period : metric.period ?? metric.periods[0]!;
  const comparable = metric.compares && (card.type === "kpi");
  return <>
    <Field id={`${id}-period`} label="Period" value={period} onChange={(value) => onChange({ ...card, data: { ...ref, period: value as Period } })} options={metric.periods} optionLabels={PERIOD_LABEL}
      help={period === "30d" ? "Från och med i dag och 30 dagar bakåt." : "Från periodens början till nu."} />
    {comparable ? <CheckField id={`${id}-compare`} label={`Jämför med ${PREVIOUS_PERIOD_LABEL[period].toLowerCase()}`} description="Visar ändringen i procent under talet." testId="card-compare"
      checked={card.settings.compare !== "none"} onChange={(value) => onChange({ ...card, settings: { ...card.settings, compare: value ? undefined : "none" } })} /> : null}
    {comparable ? <TrendFields card={card} onChange={onChange} /> : null}
  </>;
}

function TableChoice({ card, tables, onChange }: { card: BoardCard; tables: TableListItem[]; onChange: (data: DataRef) => void }) {
  const id = useId();
  if (!tables.length) return <p className="text-xs text-muted-foreground">Det finns inga egna tabeller ännu. Skapa en under fliken Tabeller.</p>;
  const ref = card.data?.kind === "table" ? card.data : { kind: "table" as const, sourceId: "" };
  const table = tables.find((item) => item.id === ref.sourceId);
  const set = (patch: Partial<typeof ref>) => onChange({ ...ref, ...patch, kind: "table" });
  const columns = (type?: TableColumn["type"]) => (table?.columns ?? []).filter((column) => !type || column.type === type);
  const column = (label: string, key: "column" | "labelColumn" | "nameColumn" | "stateColumn" | "textColumn" | "dateColumn" | "titleColumn", choices: TableColumn[], optional = false) =>
    <Field id={`${id}-${key}`} label={label} value={ref[key] ?? ""} onChange={(value) => set({ [key]: value || undefined })} options={[...(optional ? [""] : []), ...choices.map((item) => item.key)]}
      optionLabels={{ "": optional ? "Ingen" : "Välj…", ...Object.fromEntries(choices.map((item) => [item.key, item.label])) }} />;
  const shape = cardDefinition(card.type).shapes[0];
  return <div className="space-y-3">
    <Field id={`${id}-table`} label="Tabell" value={ref.sourceId} onChange={(sourceId) => onChange({ kind: "table", sourceId })} options={tables.map((item) => item.id)} optionLabels={Object.fromEntries(tables.map((item) => [item.id, item.name]))} />
    {table && shape === "number" ? <>
      <Field id={`${id}-aggregate`} label="Räkna" value={ref.aggregate ?? (ref.column ? "sum" : "count")} onChange={(value) => set({ aggregate: value as TableAggregate })} options={[...TABLE_AGGREGATES]} optionLabels={AGGREGATE_LABEL} />
      {(ref.aggregate ?? (ref.column ? "sum" : "count")) !== "count" ? column("Kolumn", "column", columns("number")) : null}
    </> : null}
    {table && shape === "series" ? <>
      {column("Etiketter", "labelColumn", columns())}
      <fieldset className="grid gap-1.5"><legend className="field-label text-xs font-medium">Värden</legend>
        {columns("number").map((item) => <CheckField key={item.key} id={`${id}-v-${item.key}`} label={item.label} checked={(ref.valueColumns ?? []).includes(item.key)}
          onChange={(on) => set({ valueColumns: on ? [...(ref.valueColumns ?? []), item.key].slice(0, 6) : (ref.valueColumns ?? []).filter((key) => key !== item.key) })} />)}
        {!columns("number").length ? <p className="text-xs text-muted-foreground">Tabellen har ingen kolumn med tal.</p> : null}
      </fieldset>
    </> : null}
    {table && shape === "status" ? <>{column("Namn", "nameColumn", columns())}{column("Läge", "stateColumn", columns())}{column("Text", "textColumn", columns(), true)}</> : null}
    {table && shape === "events" ? <>{column("Rubrik", "titleColumn", columns())}{column("Datum", "dateColumn", columns("date"), true)}</> : null}
    {table && shape === "table" ? <p className="text-xs text-muted-foreground">Kortet visar tabellens alla kolumner.</p> : null}
  </div>;
}

function Limits({ card, set }: { card: BoardCard; set: (patch: Partial<CardSettings>) => void }) {
  const id = useId();
  const limits = card.settings.limits ?? { good: null, bad: null, higherIsBetter: true };
  return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-3">
      <Field id={`${id}-good`} label="Bra från" type="number" value={numText(limits.good)} onChange={(value) => set({ limits: { ...limits, good: num(value) } })} />
      <Field id={`${id}-bad`} label="Dåligt från" type="number" value={numText(limits.bad)} onChange={(value) => set({ limits: { ...limits, bad: num(value) } })} />
    </div>
    <CheckField id={`${id}-higher`} label="Högre är bättre" checked={limits.higherIsBetter} onChange={(value) => set({ limits: { ...limits, higherIsBetter: value } })}
      description="Gränserna är företagets egna. Utan gränser får talet ingen färg." />
  </div>;
}

/** Mål och enhet: the figure's target, unit, decimals and the company's own limits. */
function TargetSection({ card, set }: { card: BoardCard; set: (patch: Partial<CardSettings>) => void }) {
  const id = useId();
  if (card.type !== "kpi" && card.type !== "gauge" && card.type !== "chart") return null;
  const unit = <Field id={`${id}-unit`} label="Enhet" value={card.settings.unit ?? ""} onChange={(value) => set({ unit: value.slice(0, 12) || undefined })} placeholder="st, h, kr, %" help="Tomt: måttets egen enhet." />;
  return <Section title="Mål och enhet" testId="card-section-target">
    <Field id={`${id}-target`} label={card.type === "gauge" ? "Mål (100 %)" : card.type === "chart" ? "Mållinje" : "Mål"} type="number" value={numText(card.settings.target)} onChange={(value) => set({ target: num(value) })}
      help={card.type === "chart" ? "En streckad linje i diagrammet. Tomt: ingen." : "Tomt: måttets eget mål, om det har något."} />
    {card.type !== "chart" ? <div className="grid grid-cols-2 gap-3">
      {unit}
      <Field id={`${id}-decimals`} label="Decimaler" value={String(card.settings.decimals ?? "")} onChange={(value) => set({ decimals: value === "" ? undefined : Number(value) })} options={["", "0", "1", "2", "3"]} optionLabels={{ "": "Automatiskt" }} />
    </div> : null}
    {card.type !== "chart" ? <Limits card={card} set={set} /> : null}
  </Section>;
}

/** Utseende: colour and emphasis within the app's tokens, and the text size. */
function LookSection({ card, set }: { card: BoardCard; set: (patch: Partial<CardSettings>) => void }) {
  const id = useId();
  const accent = card.settings.accent ?? "primary";
  return <Section title="Utseende" testId="card-section-look">
    <fieldset className="grid gap-1.5">
      <legend className="field-label mb-1 text-xs font-medium">Färg</legend>
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Färg">
        {CARD_ACCENTS.map((item) => <button key={item.key} type="button" role="radio" aria-checked={accent === item.key} onClick={() => set({ accent: item.key === "primary" ? undefined : item.key })} data-testid={`card-accent-${item.key}`}
          className={cn("flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-primary", accent === item.key ? "border-primary bg-primary/10 font-semibold" : "bg-card hover:bg-muted")}>
          <span className="size-3.5 shrink-0 rounded-full" style={{ background: item.color }} aria-hidden="true" />{item.label}
        </button>)}
      </div>
      <p className="text-xs text-muted-foreground">Färgen används för ikonen, ringen och diagrammet. Har kortet gränser visas deras grönt, gult och rött i stället.</p>
    </fieldset>
    <CheckField id={`${id}-tinted`} label="Framhäv kortet" description="Kortet får en ton av färgen i bakgrunden." testId="card-emphasis" checked={card.settings.emphasis === "tinted"} onChange={(value) => set({ emphasis: value ? "tinted" : undefined })} />
    <div className="grid gap-1.5">
      <span className="field-label text-xs font-medium" id={`${id}-size-label`}>Textstorlek</span>
      <EditorSegmented label="Textstorlek" value={card.settings.textSize ?? "normal"} onChange={(textSize) => set({ textSize: textSize === "normal" ? undefined : textSize })} testId="card-text-size"
        options={(["small", "normal", "large"] as const).map((value) => ({ value, label: TEXT_SIZE_LABEL[value] }))} />
      <p className="text-xs text-muted-foreground">Texten växer redan med kortet. Välj Större för en skärm som ska läsas på håll.</p>
    </div>
  </Section>;
}

function TypeSettings({ card, set }: { card: BoardCard; set: (patch: Partial<CardSettings>) => void }) {
  const id = useId();
  const [uploading, setUploading] = useState(false);
  const stale = <Field id={`${id}-stale`} label="Gammal data efter (minuter)" type="number" value={numText(card.settings.staleMinutes)} onChange={(value) => { const minutes = num(value); set({ staleMinutes: minutes && minutes >= 1 ? Math.min(1440, Math.round(minutes)) : undefined }); }}
    help="Kortet blir grått när siffrorna är äldre än så. Tomt: aldrig." />;
  switch (card.type) {
    case "kpi": case "gauge": return <Section title="Uppdatering">{stale}</Section>;
    case "chart": return <Section title="Diagram">
      <EditorSegmented label="Diagram" value={card.settings.chart ?? "bar"} onChange={(chart) => set({ chart })} options={CHART_KINDS.map((value) => ({ value, label: CHART_KIND_LABEL[value] }))} testId="card-chart-kind" />
      {stale}
    </Section>;
    case "table": return <Section title="Tabell">
      <Field id={`${id}-rows`} label="Högst antal rader" type="number" value={numText(card.settings.rows)} onChange={(value) => { const rows = num(value); set({ rows: rows && rows >= 1 ? Math.min(50, Math.round(rows)) : undefined }); }}
        help="Kortet visar så många rader som får plats och säger hur många det finns." />
      {stale}
    </Section>;
    case "status": case "events": return <Section title="Uppdatering">{stale}</Section>;
    case "text": return <Section title="Text">
      <Field id={`${id}-heading`} label="Rubrik i kortet" value={card.settings.heading ?? ""} onChange={(heading) => set({ heading: heading.slice(0, 120) })} />
      <Field id={`${id}-body`} label="Text" multiline value={card.settings.body ?? ""} onChange={(body) => set({ body: body.slice(0, 2000) })} help="Vanlig text. En tom rad ger ett nytt stycke." />
      <CheckField id={`${id}-center`} label="Centrera" checked={card.settings.align === "center"} onChange={(value) => set({ align: value ? "center" : "left" })} />
      <CheckField id={`${id}-large`} label="Stor brödtext" checked={Boolean(card.settings.large)} onChange={(value) => set({ large: value || undefined })} />
    </Section>;
    case "image": return <Section title="Bild">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm" busy={uploading} busyLabel="Laddar upp…">
          <label className="cursor-pointer"><ImageUp aria-hidden="true" />{card.settings.imageId ? "Byt bild" : "Välj bild"}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" data-testid="card-image-file" onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              setUploading(true);
              try { const { id: imageId } = await uploadBoardImage(file); set({ imageId }); }
              catch (error) { announce(error instanceof Error ? error.message : "Bilden kunde inte laddas upp.", true); }
              finally { setUploading(false); }
            }} />
          </label>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">JPG, PNG eller WebP, högst 10 MB. Bilden sparas i Workflow och hämtas aldrig från någon annan webbplats.</p>
      <Field id={`${id}-alt`} label="Beskrivning för skärmläsare" value={card.settings.alt ?? ""} onChange={(alt) => set({ alt: alt.slice(0, 200) })} />
      <CheckField id={`${id}-cover`} label="Fyll hela kortet" description="Bilden beskärs i kanterna." checked={card.settings.fit === "cover"} onChange={(value) => set({ fit: value ? "cover" : "contain" })} />
    </Section>;
    case "clock": return <Section title="Klocka">
      <CheckField id={`${id}-date`} label="Visa datum" checked={card.settings.showDate !== false} onChange={(value) => set({ showDate: value })} />
      <CheckField id={`${id}-week`} label="Visa veckonummer" checked={Boolean(card.settings.showWeek)} onChange={(value) => set({ showWeek: value || undefined })} />
      <CheckField id={`${id}-seconds`} label="Visa sekunder" checked={Boolean(card.settings.showSeconds)} onChange={(value) => set({ showSeconds: value || undefined })} />
    </Section>;
  }
}
