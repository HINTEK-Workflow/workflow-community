"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ClipboardList, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Panel } from "@/features/kfid/ui";
import { api } from "@/features/kfid/api";
import { ListEmpty, ListGroup, ListSkeleton, NativeActions, NativePage, useNativeTopBar } from "@/components/native";
import { PageHeader } from "@/components/page-shell";
import { PLACE_KIND_LABELS, placeKindOf, placeName, placePath, placeTree } from "@/lib/workflow/customer-facility";
import { paperFooterLine, paperSheets, type PaperModel, type PaperRow } from "@/lib/workflow/round-paper";
import { formatSwedish } from "@/lib/swedish-time";
import { useNativeMode } from "./use-detail-level";

/** The answer of `/api/form-schedules?paper=` (lib/kfid/rounds-server.ts loadRoundPaper). */
type Paper = {
  round: { id: string; title: string; customerName: string; facilityName: string; workOrder?: { id: string; title: string } | null; ruleText: string; assignedToName: string };
  formName: string; paper: PaperModel;
  places: { id: string; parentId: string | null; name: string; kind: string }[];
  company: { name: string; legal: string[] };
};

/**
 * Printing shows only the sheets (as the QR sheet, features/workflow/place-labels.tsx): a copy lies directly in <body> and is the
 * only thing printed, so the app's frame never cuts it; each sheet starts on a new A4 page and the phone's print dialog can save
 * it as PDF. Black on white, so it copies well.
 */
const PRINT_CSS = `@media print { html, body { height: auto !important; overflow: visible !important; background: #fff !important; } body > *:not(.round-paper-print) { display: none !important; } .round-paper-print { display: block !important; } .round-paper-sheet { break-after: page; } .round-paper-sheet:last-child { break-after: auto; } @page { size: A4; margin: 12mm 12mm 14mm; } }`;

const Box = ({ label }: { label: string }) => <span className="inline-flex items-center gap-1 whitespace-nowrap"><span aria-hidden="true" className="inline-block size-[3.6mm] shrink-0 border border-black" />{label}</span>;
const Line = ({ grow = true }: { grow?: boolean }) => <span aria-hidden="true" className={`${grow ? "min-w-[25mm] flex-1" : "w-[25mm]"} inline-block border-b border-black/60`} style={{ height: "5mm" }} />;
const Blank = ({ label, wide = false }: { label: string; wide?: boolean }) => <span className={`flex min-w-0 items-end gap-1.5 ${wide ? "flex-[2]" : "flex-1"}`}><span className="shrink-0 text-black/70">{label}</span><Line /></span>;

/** One row to fill in: the point, the boxes, and a line for value or comment. */
function PaperRowView({ row }: { row: PaperRow }) {
  const help = row.help ? <p className="text-[7.5pt] leading-tight text-black/60">{row.help}</p> : null;
  if (row.kind === "table") return <div className="py-1.5" style={{ breakInside: "avoid" }} data-paper-row="table">
    <p className="font-semibold">{row.label}</p>{help}
    <table className="mt-1 w-full border-collapse text-[8pt]">
      <thead><tr>{row.rows.some(Boolean) ? <th className="border border-black/50 px-1 py-0.5 text-left font-medium" /> : null}{row.columns.map((column, index) => <th key={index} className="border border-black/50 px-1 py-0.5 text-left font-medium">{column.label}{column.unit ? ` (${column.unit})` : ""}</th>)}</tr></thead>
      <tbody>{row.rows.map((label, index) => <tr key={index} style={{ height: "7mm" }}>{row.rows.some(Boolean) ? <td className="border border-black/50 px-1">{label}</td> : null}{row.columns.map((_, column) => <td key={column} className="border border-black/50" />)}</tr>)}</tbody>
    </table>
  </div>;
  const answer: ReactNode = row.kind === "check" ? <><Box label="OK" /><Box label="Brist" /><Box label="Ej aktuellt" /></>
    : row.kind === "yesno" ? <><Box label="Ja" /><Box label="Nej" />{row.notApplicable ? <Box label="Ej aktuellt" /> : null}</>
    : row.kind === "choice" ? <span className="flex flex-wrap gap-x-3 gap-y-1">{row.options.map((option) => <Box key={option} label={option} />)}</span>
    : row.kind === "value" ? <span className="flex min-w-[45mm] items-end gap-1"><span className="text-black/70">Värde</span><Line />{row.unit ? <span>{row.unit}</span> : null}</span>
    : null;
  return <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 border-b border-black/20 py-1.5" style={{ breakInside: "avoid" }} data-paper-row={row.kind}>
    <div className="min-w-0">
      <p className="[overflow-wrap:anywhere]">{row.label}</p>
      {row.kind === "value" && row.range ? <p className="text-[7.5pt] leading-tight text-black/60">{row.range}</p> : null}
      {help}
    </div>
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">{answer}</div>
    {row.kind === "text"
      ? <div className="col-span-2 mt-1 space-y-1.5">{Array.from({ length: row.lines }, (_, index) => <div key={index} className="flex"><Line /></div>)}</div>
      : <div className="col-span-2 mt-1 flex items-end gap-1.5"><span className="text-[7.5pt] text-black/60">Kommentar</span><Line /></div>}
  </div>;
}

/** One sheet: the head, the rows, the notes and signatures, and the documents' footer. */
function Sheet({ data, point, index, count, printedAt, testId }: { data: Paper; point: Paper["places"][number] | null; index: number; count: number; printedAt: string; testId?: string }) {
  const where = point ? [data.round.customerName, placePath(data.places, point.parentId ?? null), placeName(point)].filter(Boolean).join(" › ")
    : [data.round.customerName, data.round.facilityName].filter(Boolean).join(" › ");
  return <section className="round-paper-sheet flex min-h-[260mm] flex-col bg-white p-[2mm] text-[9pt] leading-snug text-black" data-testid={testId}>
    <header className="border-b-2 border-black pb-2">
      <p className="text-[8pt] font-semibold uppercase tracking-wide text-black/70">Rondprotokoll</p>
      <h2 className="text-[15pt] font-bold leading-tight">{data.round.title}</h2>
      <p className="mt-0.5 text-[8.5pt] text-black/70">{[data.formName, data.round.ruleText, data.round.workOrder?.title ? `Arbetsorder: ${data.round.workOrder.title}` : ""].filter(Boolean).join(" · ")}</p>
      {where ? <p className="mt-0.5 text-[9pt] font-medium" data-testid={testId ? "round-paper-where" : undefined}>{point ? "Punkt: " : "Plats: "}{where}</p> : null}
    </header>
    <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2"><Blank label="Datum" /><Blank label="Tid" /><Blank label="Utförd av" wide /></div>
    <div className="mt-3 flex-1">
      {data.paper.sections.map((section) => <div key={section.id} className="mt-3 first:mt-0">
        <h3 className="border-b border-black/60 pb-0.5 text-[10.5pt] font-bold" style={{ breakAfter: "avoid" }}>{section.title}</h3>
        {section.rows.map((row) => <PaperRowView key={row.id} row={row} />)}
      </div>)}
      <div className="mt-4" style={{ breakInside: "avoid" }}>
        <h3 className="border-b border-black/60 pb-0.5 text-[10.5pt] font-bold">Övriga anteckningar och brister</h3>
        <div className="mt-1.5 space-y-2">{[0, 1, 2].map((line) => <div key={line} className="flex"><Line /></div>)}</div>
      </div>
      <div className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 print:grid-cols-2" style={{ breakInside: "avoid" }}>
        {data.paper.signatures.map((signature, at) => <div key={at} className="space-y-1.5">
          <p className="font-semibold">{signature.label}</p>
          <div className="flex gap-3"><Blank label="Namn" wide /><Blank label="Datum" /></div>
          <div className="flex"><Blank label="Signatur" /></div>
        </div>)}
      </div>
    </div>
    {/* The documents' footer (docs/rapportprinciper.md): the company in bold with its legal line, then what the sheet is and when it was printed. */}
    <footer className="mt-4 border-t border-black/30 pt-1 text-[7pt] leading-[1.4] text-black/70" data-testid={testId ? "round-paper-footer" : undefined}>
      <p><span className="font-bold text-black">{data.company.name}</span>{data.company.legal.length ? ` · ${data.company.legal.join(" · ")}` : ""}</p>
      <p>{paperFooterLine({ sheet: index + 1, sheets: count, printedAt })}</p>
    </footer>
  </section>;
}

/**
 * Rondprotokoll på papper (0.92.0): from a round, a sheet to tick by hand when the service cannot be reached – the form's points with
 * empty boxes, lines for value and comment, date and signature. A round with points in the place tree gets one sheet per chosen
 * point (as the QR sheet chooses them); without points one sheet for the round. Nothing is saved; the results are entered in
 * Workflow afterwards. Also in the phone's app, where the print dialog can save the sheets as PDF or share them.
 */
export function RoundPaper({ roundId }: { roundId: string }) {
  const native = useNativeMode();
  const [data, setData] = useState<Paper | null>(null);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [loadError, setError] = useState("");
  const error = roundId ? loadError : "Ingen rond är vald. Öppna ronden under Driftronder.";
  useNativeTopBar(native ? { title: "Rondprotokoll på papper", back: { label: "Driftronder" } } : null);
  useEffect(() => {
    if (!roundId) return;
    void (async () => {
      try {
        const result = await api<Paper>(`/api/form-schedules?paper=${encodeURIComponent(roundId)}`);
        setData(result);
        // From the start only the round's own place (the top of its points); more are ticked by hand.
        setSelected((current) => current ?? new Set(result.places.filter((place) => !result.places.some((other) => other.id === place.parentId)).map((place) => place.id)));
      } catch (issue) { setError((issue as Error).message); }
    })();
  }, [roundId]);
  const rows = useMemo(() => data ? placeTree(data.places) : [], [data]);
  const ordered = rows.map(({ place }) => place);
  const sheets = data ? paperSheets(ordered, selected ?? new Set()) : [];
  const [printedAt] = useState(() => formatSwedish(new Date().toISOString(), { dateStyle: "short", timeStyle: "short" }));
  const toggle = (id: string, on: boolean) => setSelected((current) => { const next = new Set(current ?? []); if (on) next.add(id); else next.delete(id); return next; });
  const sheetList = (print: boolean) => data ? <div className={print ? "round-paper-print hidden" : "space-y-6"} aria-hidden={print || undefined}>
    {sheets.map((point, index) => <Sheet key={point?.id ?? "round"} data={data} point={point} index={index} count={sheets.length} printedAt={printedAt} testId={print ? undefined : "round-paper-sheet"} />)}
  </div> : null;
  const printing = <>
    <style>{PRINT_CSS}</style>
    {data && typeof document !== "undefined" ? createPortal(sheetList(true), document.body) : null}
  </>;
  const empty = data && !data.paper.rowCount ? "Formuläret har inga punkter att kryssa. Bladet får bara datum, anteckningar och signatur." : null;
  const printButton = <Button type="button" onClick={() => window.print()} disabled={!data} data-testid="round-paper-print"><Printer />Skriv ut</Button>;
  const pointRows = (className: string) => rows.map(({ place, depth }) => <label key={place.id} className={className} style={{ paddingLeft: `${(native ? 0.875 : 0) + depth * 1.1}rem` }}>
    <Checkbox checked={Boolean(selected?.has(place.id))} onCheckedChange={(value) => toggle(place.id, value === true)} aria-label={`Blad för ${placeName(place)}`} />
    <span className="min-w-0 flex-1 truncate">{placeName(place)}</span>
    <span className="shrink-0 text-xs text-muted-foreground">{PLACE_KIND_LABELS[placeKindOf(place)]}</span>
  </label>);
  const chosenCount = data ? data.places.filter((place) => selected?.has(place.id)).length : 0;
  const pointsLine = data?.places.length ? `${chosenCount} av ${data.places.length} punkter valda. Varje vald punkt får ett eget blad.` : "Ronden har inga punkter i platsträdet. Ett blad för hela ronden.";

  if (native) {
    if (error) return <NativePage testId="round-paper"><ListGroup><div role="alert"><ListEmpty>{error}</ListEmpty></div></ListGroup></NativePage>;
    if (!data) return <NativePage testId="round-paper"><ListSkeleton rows={3} label="Hämtar ronden…" /></NativePage>;
    return <NativePage testId="round-paper">
      {printing}
      {data.places.length ? <ListGroup title={data.round.title} footer={pointsLine} testId="round-paper-points">
        {pointRows("native-row flex items-center gap-3 text-[0.9375rem]")}
      </ListGroup> : <ListGroup title={data.round.title}><ListEmpty>{pointsLine}</ListEmpty></ListGroup>}
      <NativeActions footer="Skrivardialogen kan också spara bladen som PDF eller dela dem.">{printButton}</NativeActions>
      {empty ? <p className="px-4 text-sm text-muted-foreground">{empty}</p> : null}
      <div className="mt-4 overflow-hidden rounded-[.875rem] bg-white p-3">{sheetList(false)}</div>
    </NativePage>;
  }

  if (error) return <div className="space-y-6" data-testid="round-paper"><PageHeader title="Rondprotokoll på papper" /><Panel title="Protokollet kunde inte hämtas"><p role="alert" className="text-sm text-destructive">{error}</p></Panel></div>;
  return <div className="space-y-6" data-testid="round-paper">
    {printing}
    <PageHeader title="Rondprotokoll på papper" description={data ? `${data.round.title}. Skriv ut och fortsätt på papper om tjänsten inte går att nå. För in resultatet i Workflow efteråt.` : "Hämtar ronden…"} actions={printButton} />
    <Panel icon={ClipboardList} title="Punkter" description={data ? pointsLine : "Hämtar punkter…"}>
      {data?.places.length ? <div className="grid gap-1">{pointRows("flex items-center gap-2 text-sm touch:min-h-11")}</div> : null}
      {empty ? <p className="text-sm text-muted-foreground">{empty}</p> : null}
    </Panel>
    <div className="rounded-lg border bg-white p-4 shadow-none">{sheetList(false)}</div>
  </div>;
}
