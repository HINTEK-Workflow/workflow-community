"use client";

import { useId, useMemo, useState } from "react";
import { Check, ChevronDown, FileSpreadsheet, LoaderCircle, ShoppingCart, TriangleAlert } from "lucide-react";
import { Popover } from "radix-ui";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { DisabledReason } from "@/components/ui/disabled-reason";
import { Input } from "@/components/ui/input";
import { DialogActions } from "@/features/kfid/ui";
import { DialogPage } from "@/features/kfid/dialog-page";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { cn } from "@/lib/utils";
import { exportFileName, formatCsv, formatText, splitParts } from "@/lib/wholesale/format";
import { cleanRowWholesale, WHOLESALERS, WHOLESALER_LABELS, type RowPack, type RowWholesale, type WholesalerId } from "@/lib/wholesale/model";
import { exportBlockReason, prepareLines, type PreparedRow } from "@/lib/wholesale/prepare";
import { profileOf } from "@/lib/wholesale/profiles";
import type { WholesaleSource } from "@/lib/wholesale/sources";
import { IconButton } from "@/components/ui/icon-button";
import { saveBlob } from "@/lib/download";

/**
 * Grossistexport (2026-10-12, Tilläggsprompt_Grossistexport): the one component for offert, arbetsorder and
 * materiallista. A wholesaler picker (Solar, Ahlsell, Sonepar, Rexel) and two buttons, Kopiera and Exportera Excel (Rexel
 * has CSV in the same button's menu). The picked wholesaler decides article number, column order and format; the review
 * shows every row, what is wrong with it and what will be ordered, before anything is copied or saved as a file.
 *
 * Nothing is sent anywhere: the text and the file are made in the browser from the rows the person already sees, so it
 * works the same in Cloud, Local (.hwf) and the demo, and the person's rights decide what rows there are. Prices,
 * statuses and the rows themselves are never changed by an export; only what the person enters for a row
 * (a wholesaler's article number, an order unit) is saved on the row when the caller lets it (`onSaveRow`).
 * Kopiera and Exportera confirm inside the dialog ("Kopierat" on the button and a line under the buttons), never with the
 * workspace toast, which would cover the preview on a phone (2026-10-13).
 */
const LAST_KEY = "wf.wholesaler";

export function WholesaleExport({ source, label, onSaveRow, disabled, testId = "wholesale-export", variant = "outline" }: {
  source: WholesaleSource;
  /** What is exported, for the title and the file name ("Offert O-0012"). */
  label: string;
  /** Saves what the person entered for a row on the row itself; absent where the rows are read only. */
  onSaveRow?: (rowId: string, wholesale: RowWholesale | undefined) => void;
  disabled?: boolean;
  testId?: string;
  variant?: "outline" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  const empty = !source.lines.length;
  const reason = empty ? "Det finns inget material att exportera." : null;
  return <>
    <Button type="button" variant={variant} disabled={disabled} disabledReason={reason} onClick={() => setOpen(true)} data-testid={testId}><ShoppingCart />Till grossist</Button>
    {open ? <WholesaleDialog source={source} label={label} onSaveRow={onSaveRow} onClose={() => setOpen(false)} testId={testId} /> : null}
  </>;
}

function readLast(): WholesalerId {
  try { const value = localStorage.getItem(LAST_KEY); if (value && (WHOLESALERS as readonly string[]).includes(value)) return value as WholesalerId; } catch { /* storage blocked */ }
  return "solar";
}

function WholesaleDialog({ source, label, onSaveRow, onClose, testId }: { source: WholesaleSource; label: string; onSaveRow?: (rowId: string, wholesale: RowWholesale | undefined) => void; onClose: () => void; testId: string }) {
  const native = useNativeMode();
  const [wholesaler, setWholesaler] = useState<WholesalerId>(readLast);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [edited, setEdited] = useState<Record<string, RowWholesale | undefined>>({});
  const [partIndex, setPartIndex] = useState(1);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [failure, setFailure] = useState("");
  // The confirmation stands in the dialog, under its buttons (2026-10-13): the workspace toast would lie over the
  // preview on a phone while the dialog is open. Gone again as soon as something changes.
  const [confirmation, setConfirmation] = useState("");
  const setCopied = (value: boolean) => { if (!value) setConfirmation(""); };
  const profile = profileOf(wholesaler);
  const reasonId = useId();

  const lines = useMemo(() => source.lines.map((line) => line.id in edited ? { ...line, wholesale: edited[line.id] } : line), [source.lines, edited]);
  const preparation = useMemo(() => prepareLines(lines, wholesaler, { excluded, confirmed }), [lines, wholesaler, excluded, confirmed]);
  const parts = useMemo(() => splitParts(preparation.ready, wholesaler), [preparation.ready, wholesaler]);
  const part = parts[Math.min(partIndex, parts.length) - 1] ?? parts[0];
  const blocked = source.blocked || exportBlockReason(preparation);
  const size = native ? "lg" : "default";

  const pick = (next: WholesalerId) => {
    setWholesaler(next); setPartIndex(1); setManual(null); setFailure(""); setCopied(false); setDone(new Set());
    try { localStorage.setItem(LAST_KEY, next); } catch { /* storage blocked */ }
  };
  const change = (rowId: string, next: RowWholesale | undefined) => {
    const cleaned = cleanRowWholesale(next);
    setEdited((current) => ({ ...current, [rowId]: cleaned }));
    setCopied(false);
    onSaveRow?.(rowId, cleaned);
  };
  const toggleExcluded = (rowId: string) => setExcluded((current) => { const next = new Set(current); if (next.has(rowId)) next.delete(rowId); else next.add(rowId); return next; });
  const toggleConfirmed = (key: string) => setConfirmed((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  const markDone = () => setDone((current) => new Set(current).add(`${wholesaler}-${part.index}`));
  const partName = part.of > 1 ? ` (del ${part.index} av ${part.of})` : "";
  function copied() {
    setManual(null); markDone();
    setConfirmation(`Underlaget för ${profile.label}${partName} är kopierat (${part.lines.length} ${part.lines.length === 1 ? "rad" : "rader"}). Inget har skickats eller beställts.`);
  }
  const save = (bytes: BlobPart, name: string, type: string) => saveBlob(bytes, name, type);
  async function exportFile(kind: "xlsx" | "csv") {
    if (blocked || !part) return;
    setBusy(kind); setFailure("");
    try {
      const name = exportFileName(wholesaler, label, part);
      if (kind === "csv") save(formatCsv(part.lines, wholesaler), `${name}.csv`, "text/csv;charset=utf-8");
      else { const { createWholesaleWorkbook } = await import("@/lib/wholesale/xlsx"); save(await createWholesaleWorkbook(part.lines, wholesaler) as BlobPart, `${name}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); }
      markDone();
      setConfirmation(`Filen för ${profile.label}${partName} är skapad. Inget har skickats eller beställts.`);
    } catch (issue) { setFailure(issue instanceof Error ? issue.message : "Filen kunde inte skapas."); } finally { setBusy(""); }
  }

  const counts = `${source.lines.length} ${source.lines.length === 1 ? "materialrad" : "materialrader"}${preparation.excluded ? `, ${preparation.excluded} utesluten${preparation.excluded === 1 ? "" : "a"}` : ""}${preparation.merged ? `, ${preparation.merged} sammanslagen${preparation.merged === 1 ? "" : "a"}` : ""}`;
  // Larger than the popup ceiling (Popupstorlek, 2026-10-13): a page on displays 2 and 3, a screen at level 1.
  return <DialogPage pageKey="grossist" size="page" panelTitle="Underlag till grossisten" open onOpenChange={(next) => { if (!next) onClose(); }} title={`Till grossist: ${label}`}>
    <div className="space-y-4" data-testid={`${testId}-dialog`}>
      <p className="text-sm leading-6 text-muted-foreground">
        Workflow förbereder underlaget. Du klistrar in eller importerar det hos grossisten, granskar varukorgen och slutför beställningen där. Inget skickas härifrån, inga priser följer med och inget markeras som beställt.
      </p>
      <div role="radiogroup" aria-label="Grossist" className="grid grid-cols-4 gap-1 rounded-[10px] bg-secondary p-0.5" data-testid={`${testId}-picker`}>
        {WHOLESALERS.map((id) => <button key={id} type="button" role="radio" aria-checked={wholesaler === id} onClick={() => pick(id)} data-testid={`${testId}-pick-${id}`}
          className={cn("min-w-0 truncate rounded-[8px] px-2 text-sm font-medium", native ? "h-11" : "h-10", wholesaler === id ? "bg-card text-foreground shadow-xs" : "text-muted-foreground")}>{WHOLESALER_LABELS[id]}</button>)}
      </div>
      <p className="text-xs leading-5 text-muted-foreground" data-testid={`${testId}-counts`}>
        {profile.label} tar {profile.identifierLabel}. {counts}.{source.skipped ? ` ${source.skipped} ${source.skipped === 1 ? "rad" : "rader"} som inte är material (arbete, resor, utgifter, fritext) tas inte med.` : ""}
      </p>

      <ul className="space-y-2" aria-label="Materialrader" data-testid={`${testId}-rows`}>
        {preparation.rows.map((row) => <RowReview key={row.id} row={row} profileLabel={profile.label} wholesaler={wholesaler} line={lines.find((line) => line.id === row.id)!}
          native={native} excluded={row.excluded} onToggleExcluded={() => toggleExcluded(row.id)} onChange={(next) => change(row.id, next)} saved={Boolean(onSaveRow)} testId={testId} />)}
      </ul>

      {preparation.warnings.map((warning) => <p key={warning} className="flex items-start gap-2 text-xs leading-5 text-amber-800 dark:text-amber-200"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{warning}</p>)}

      <section aria-label="Förhandsgranskning" data-testid={`${testId}-preview`}>
        <h3 className="text-sm font-semibold">Det här exporteras till {profile.label}</h3>
        {preparation.lines.length ? <div className="mt-2 overflow-hidden rounded-xl border bg-card" role="table" aria-label="Förhandsgranskning">
          <div role="row" className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_4.5rem_4rem] gap-2 border-b bg-secondary/60 px-3 py-1.5 text-xs font-medium text-muted-foreground">
            <span role="columnheader" className="min-w-0">{/* A phone has no room for the long word beside Benämning. */}<span className="sm:hidden" aria-hidden="true">Art.nr</span><span className="max-sm:sr-only">Artikelnummer</span></span><span role="columnheader">Benämning</span><span role="columnheader" className="text-right">Antal</span><span role="columnheader">Enhet</span>
          </div>
          {preparation.lines.map((line) => <div key={line.key} role="row" className="border-b px-3 py-2 text-sm last:border-b-0" data-testid={`${testId}-line`}>
            <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_4.5rem_4rem] gap-2">
              <span role="cell" className="break-all font-mono text-xs leading-5" data-testid={`${testId}-line-article`}>{line.identifier}</span>
              <span role="cell" className="min-w-0 break-words">{line.name}</span>
              <span role="cell" className="text-right tabular-nums font-medium" data-testid={`${testId}-line-quantity`}>{line.quantity}</span>
              <span role="cell" className="min-w-0 break-words">{line.unit}</span>
            </div>
            {line.rounded ? <label className="mt-1.5 flex items-start gap-2 text-xs leading-5 text-amber-800 dark:text-amber-200">
              <input type="checkbox" className="mt-1 size-4" checked={line.confirmed} onChange={() => toggleConfirmed(line.confirmKey)} data-testid={`${testId}-confirm`} />
              <span>Behovet är {String(line.consumption).replace(".", ",")} {line.consumptionUnit}, men inköpet avrundas till {line.quantity} {line.unit}. Jag bekräftar det beställda antalet.</span>
            </label> : null}
          </div>)}
        </div> : <p className="mt-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Ingen rad är klar än. Åtgärda eller uteslut raderna ovan.</p>}
        {profile.xlsxHeader ? <p className="mt-2 text-xs leading-5 text-muted-foreground">Filen har rubrikraden från {profile.label}s mall.</p> : <p className="mt-2 text-xs leading-5 text-muted-foreground">Filen och texten har inga rubriker: bara dataraderna.</p>}
      </section>

      {parts.length > 1 ? <div className="rounded-lg border bg-secondary/40 p-3" data-testid={`${testId}-parts`}>
        <p className="text-sm font-medium">{preparation.ready.length} rader: delas i {parts.length} delar</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{profile.label} rekommenderar högst {profile.recommendedMaxLines} rader i en order (en rekommendation, inte en verifierad gräns). Ta en del i taget; ingen rad utelämnas.</p>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Del">
          {parts.map((item) => <Button key={item.index} type="button" size={size} variant={item.index === part.index ? "default" : "outline"} onClick={() => { setPartIndex(item.index); setManual(null); setCopied(false); }} data-testid={`${testId}-part-${item.index}`}>
            Del {item.index} av {item.of} · rad {item.from}–{item.to}{done.has(`${wholesaler}-${item.index}`) ? " ✓" : ""}
          </Button>)}
        </div>
      </div> : null}

      {manual !== null ? <div data-testid={`${testId}-manual`}>
        <p className="text-sm font-medium">Kopieringen fungerade inte. Markera texten och kopiera den själv.</p>
        <textarea readOnly className="form-textarea mt-2 min-h-32 w-full font-mono text-xs" value={manual} aria-label={`Text att kopiera till ${profile.label}`} onFocus={(event) => event.currentTarget.select()} ref={(element) => element?.select()} />
      </div> : null}

      <div className={cn("flex gap-2", native ? "flex-col" : "flex-wrap items-center")} data-testid={`${testId}-actions`}>
        <CopyButton size={size} disabled={Boolean(busy)} disabledReason={blocked || null} aria-describedby={blocked ? reasonId : undefined} value={() => formatText(part.lines, wholesaler)} onCopied={copied} onFailed={(text) => { setCopied(false); setManual(text); }} data-testid={`${testId}-copy`} />
        {profile.csv ? <ExcelMenu size={size} native={native} busy={busy} blocked={blocked} reasonId={reasonId} onExport={(kind) => void exportFile(kind)} testId={testId} />
          : <Button type="button" size={size} disabled={Boolean(busy)} disabledReason={blocked || null} aria-describedby={blocked ? reasonId : undefined} onClick={() => void exportFile("xlsx")} data-testid={`${testId}-excel`}>
            {busy === "xlsx" ? <LoaderCircle className="animate-spin" /> : <FileSpreadsheet />}Exportera Excel
          </Button>}
      </div>
      <DisabledReason id={reasonId} reason={blocked} />
      <p role="status" className={cn("flex items-start gap-2 text-xs leading-5 text-emerald-700 dark:text-emerald-300", !confirmation && "sr-only")} data-testid={`${testId}-status`}>
        {confirmation ? <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> : null}{confirmation}
      </p>
      {failure ? <p role="alert" className="text-xs text-destructive">{failure}</p> : null}
      <p className="text-xs leading-5 text-muted-foreground" data-testid={`${testId}-hint`}>{profile.pasteHint}{profile.copyHint ? ` ${profile.copyHint}` : ""}</p>
      <DialogActions cancel={{ label: "Stäng", onClick: onClose }} />
    </div>
  </DialogPage>;
}

/** Exportera Excel, and for Rexel CSV in the same button's menu (the file Rexel documents for import). */
function ExcelMenu({ size, native, busy, blocked, reasonId, onExport, testId }: { size: "default" | "lg"; native: boolean; busy: string; blocked: string; reasonId: string; onExport: (kind: "xlsx" | "csv") => void; testId: string }) {
  const [menu, setMenu] = useState(false);
  return <div className={cn("flex", native && "w-full")}>
    <Button type="button" size={size} className={cn("rounded-r-none", native && "flex-1")} disabled={Boolean(busy)} disabledReason={blocked || null} aria-describedby={blocked ? reasonId : undefined} onClick={() => onExport("xlsx")} data-testid={`${testId}-excel`}>
      {busy === "xlsx" ? <LoaderCircle className="animate-spin" /> : <FileSpreadsheet />}Exportera Excel
    </Button>
    <Popover.Root open={menu} onOpenChange={setMenu}>
      <Popover.Trigger asChild>
        <IconButton label="Fler format" variant="default" size={size} className="rounded-l-none border-l border-primary-foreground/30 px-2" disabled={Boolean(busy)} disabledReason={blocked || null} data-testid={`${testId}-formats`}><ChevronDown /></IconButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-[80] w-56 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg">
          <Button type="button" variant="ghost" size={size} className="w-full justify-start" onClick={() => { setMenu(false); onExport("xlsx"); }}><FileSpreadsheet />Excel (.xlsx)</Button>
          <Button type="button" variant="ghost" size={size} className="w-full justify-start" onClick={() => { setMenu(false); onExport("csv"); }} data-testid={`${testId}-csv`}>{busy === "csv" ? <LoaderCircle className="animate-spin" /> : <FileSpreadsheet />}CSV (.csv)</Button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  </div>;
}

/** One row of the review: what it is, the number it will be ordered with, what is wrong, and how to fix or leave it out. */
function RowReview({ row, profileLabel, wholesaler, line, native, excluded, onToggleExcluded, onChange, saved, testId }: {
  row: PreparedRow; profileLabel: string; wholesaler: WholesalerId; line: { wholesale?: RowWholesale; unit: string }; native: boolean; excluded: boolean;
  onToggleExcluded: () => void; onChange: (next: RowWholesale | undefined) => void; saved: boolean; testId: string;
}) {
  const problem = row.issues.length > 0;
  const [open, setOpen] = useState(false);
  const editing = (open || (problem && !excluded)) && !excluded;
  const own = line.wholesale?.ids?.[wholesaler] ?? "";
  const pack: RowPack = line.wholesale?.packs?.[wholesaler] ?? { orderUnit: "", perUnit: "", multiple: "" };
  const setId = (value: string) => onChange({ ...line.wholesale, ids: { ...line.wholesale?.ids, [wholesaler]: value } });
  const setPack = (patch: Partial<RowPack>) => onChange({ ...line.wholesale, packs: { ...line.wholesale?.packs, [wholesaler]: { ...pack, ...patch } } });
  const field = "space-y-1 text-xs font-medium text-muted-foreground";
  return <li className={cn("rounded-xl border bg-card p-3", problem && !excluded && "border-destructive/40", excluded && "opacity-60")} data-testid={`${testId}-row`} data-state={excluded ? "excluded" : problem ? "problem" : "ok"}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="break-words text-sm font-medium">{row.name}</p>
        <p className="text-xs text-muted-foreground">{row.quantityText || "Antal saknas"} {row.unit}{row.identifier ? <> · <span className="break-all font-mono">{row.identifier}</span> <span>({row.originNote})</span></> : ""}</p>
      </div>
      <div className="flex shrink-0 gap-1">
        {!excluded ? <Button type="button" variant="ghost" size={native ? "lg" : "sm"} onClick={() => setOpen(!open)} aria-expanded={editing} data-testid={`${testId}-edit`}>{editing && !problem ? "Klar" : "Ändra"}</Button> : null}
        <Button type="button" variant="ghost" size={native ? "lg" : "sm"} onClick={onToggleExcluded} data-testid={`${testId}-exclude`}>{excluded ? "Ta med igen" : "Uteslut"}</Button>
      </div>
    </div>
    {excluded ? <p className="mt-1 text-xs text-muted-foreground">Utesluten: följer inte med i exporten.</p> : null}
    {!excluded && row.issues.map((issue) => <p key={issue.message} role="alert" className="mt-1.5 flex items-start gap-2 text-xs leading-5 text-destructive" data-testid={`${testId}-issue`}><TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{issue.message}</p>)}
    {editing ? <div className="mt-3 space-y-3 border-t pt-3" data-testid={`${testId}-row-editor`}>
      {row.candidates.length ? <div>
        <p className="text-xs font-medium text-muted-foreground">Nummer på raden (välj om det är rätt hos {profileLabel})</p>
        <div className="mt-1.5 flex flex-wrap gap-2">{row.candidates.map((candidate) => <Button key={candidate.value} type="button" size={native ? "lg" : "sm"} variant={own === candidate.value ? "default" : "outline"} onClick={() => setId(candidate.value)} data-testid={`${testId}-candidate`}>
          <span className="font-mono">{candidate.value}</span><span className="font-sans text-[0.7rem] opacity-80">{candidate.label}</span></Button>)}</div>
      </div> : null}
      <label className={field}>Artikelnummer hos {profileLabel}
        <Input value={own} maxLength={60} autoComplete="off" spellCheck={false} placeholder="Skriv numret hos grossisten" onChange={(event) => setId(event.target.value)} data-testid={`${testId}-own-id`} />
      </label>
      <div>
        <p className="text-xs font-medium text-muted-foreground">Beställningsenhet, om grossisten säljer i en annan enhet än du förbrukar ({row.unit || "enhet saknas"})</p>
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          <label className={field}>Enhet<Input value={pack.orderUnit} maxLength={40} placeholder="rulle" onChange={(event) => setPack({ orderUnit: event.target.value })} data-testid={`${testId}-pack-unit`} /></label>
          <label className={field}>{row.unit || "Förbrukning"} per enhet<Input value={pack.perUnit} inputMode="decimal" maxLength={20} placeholder="100" onChange={(event) => setPack({ perUnit: event.target.value })} data-testid={`${testId}-pack-per`} /></label>
          <label className={field}>Ordermultipel<Input value={pack.multiple ?? ""} inputMode="numeric" maxLength={20} placeholder="1" onChange={(event) => setPack({ multiple: event.target.value })} data-testid={`${testId}-pack-multiple`} /></label>
        </div>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{saved ? "Det du anger sparas på raden och används nästa gång." : "Det du anger gäller bara den här exporten."}</p>
    </div> : null}
  </li>;
}
