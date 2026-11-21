"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Save, Table2, Trash2 } from "lucide-react";
import { AreaIcon } from "@/components/area-icon";
import { PageHeader, PageSkeleton, usePageTrail } from "@/components/page-shell";
import { RowChevron } from "@/components/row-chevron";
import { DelayedSkeleton } from "@/components/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RemoveButton } from "@/components/ui/remove-button";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { DialogActions, Empty, Field, Modal, Panel, RowsSkeleton } from "@/features/kfid/ui";
import { useWorkspaceData } from "@/features/kfid/use-workspace-data";
import type { BoardsAccess } from "@/lib/boards/access";
import { COLUMN_TYPE_LABEL, columnKeyFor, MAX_COLUMNS, MAX_ROWS, TABLE_COLUMN_TYPES, type TableColumn } from "@/lib/boards/table";
import { formatSwedish } from "@/lib/swedish-time";
import { useLoadEffect } from "@/lib/use-load-effect";
import { useUnsavedGuard } from "@/lib/workflow/use-unsaved-guard";
import { announce, notice } from "@/lib/workflow/toast";
import { TABLES_SENTENCE } from "@/lib/boards/tabs";
import { boardsGet, boardsPost, type TableDetail, type TableListItem } from "./boards-api";

/**
 * Tabeller (Tavlor etapp 1, 2026-11-18): the company's own tables for the boards – "Dagens mål", "Veckans meddelande", "Produktion per
 * linje". The list, and a table's own page (`&table=`) where its columns and rows are written and saved with Spara. File import, push
 * and fetched sources fill the same tables in etapp 3.
 */
const tableHref = (id: string) => `/?view=boards&tab=tables&table=${encodeURIComponent(id)}`;

export function TablesPage({ access }: { access: BoardsAccess }) {
  const table = useSearchParams().get("table");
  if (table) return <TableEditor key={table} tableId={table} />;
  return <TablesList access={access} />;
}

function TablesList({ access }: { access: BoardsAccess }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const read = useWorkspaceData<{ items: TableListItem[] }>("/api/boards?part=tables", (signal) => api("/api/boards?part=tables", { signal, cache: "no-store" }));
  const create = async () => {
    if (!name.trim()) { announce("Ge tabellen ett namn.", true); return; }
    setBusy(true);
    try { const { id } = await boardsPost<{ id: string }>({ action: "create_table", table: { name: name.trim() } }); setCreating(false); router.push(tableHref(id)); }
    catch (error) { announce(error instanceof Error ? error.message : "Tabellen kunde inte skapas.", true); }
    finally { setBusy(false); }
  };
  const items = read.data?.items;
  if (access.demo) return <div className="space-y-5" data-testid="board-tables">
    <PageHeader title="Tavlor" description={TABLES_SENTENCE} />
    <p className="notice" role="status" data-testid="boards-demo-tables">Egna tabeller sparas inte i demon. Exempeltavlorna visar Workflows egna mått, räknade på demons påhittade uppgifter.</p>
  </div>;
  return <div className="space-y-5" data-testid="board-tables">
    <PageHeader title="Tavlor" description={TABLES_SENTENCE}
      actions={access.edit ? <Button type="button" onClick={() => { setName(""); setCreating(true); }} data-testid="table-new"><Plus aria-hidden="true" />Ny tabell</Button> : undefined} />
    {read.error ? <p role="alert" className="notice text-destructive">{read.error}</p> : null}
    {!items ? <DelayedSkeleton><div className="rounded-xl border bg-card px-3.5 py-3"><RowsSkeleton rows={4} label="Hämtar tabeller…" /></div></DelayedSkeleton>
      : !items.length ? <div className="rounded-xl border bg-card"><Empty title="Inga tabeller än" description={`${TABLES_SENTENCE} Skapa en med Ny tabell och välj Egen tabell i ett korts inställningar.`}>
        {access.edit ? <Button type="button" onClick={() => setCreating(true)}><Plus aria-hidden="true" />Ny tabell</Button> : null}
      </Empty></div>
      : <div className="divide-y overflow-hidden rounded-xl border bg-card" role="list" aria-label="Tabeller">{items.map((item) => <div key={item.id} role="listitem" className="relative flex items-center gap-3 px-3.5 py-3 text-sm hover:bg-secondary/50" data-testid="board-table-row">
        <AreaIcon area="project" icon={Table2} />
        <span className="min-w-0 flex-1"><Link href={tableHref(item.id)} className="stretched-link block truncate font-semibold hover:text-primary">{item.name}</Link>
          <span className="block truncate text-xs text-muted-foreground">{item.columns.length} kolumner · {item.rows} rader · ändrad {formatSwedish(item.updatedAt, { day: "numeric", month: "short" })}{item.updatedBy ? ` av ${item.updatedBy}` : ""}</span></span>
        <RowChevron />
      </div>)}</div>}
    <Modal open={creating} onOpenChange={setCreating} title="Ny tabell" size="compact">
      <form className="space-y-4" noValidate onSubmit={(event) => { event.preventDefault(); void create(); }}>
        <Field id="new-table-name" label="Namn" value={name} onChange={(value) => setName(value.slice(0, 80))} required placeholder="Till exempel Dagens mål" />
        <p className="text-xs text-muted-foreground">Tabellen får kolumnerna Namn och Värde. Du ändrar dem på nästa sida.</p>
        <DialogActions cancel={{ onClick: () => setCreating(false) }} primary={{ label: "Skapa", type: "submit", busy, busyLabel: "Skapar…", testId: "table-new-create" }} />
      </form>
    </Modal>
  </div>;
}

type EditRow = { key: string; values: Record<string, string> };
const STATE_CHOICES = [["", "–"], ["ok", "OK"], ["varning", "Varning"], ["fel", "Fel"]] as const;
const toText = (value: string | number | null | undefined) => value === null || value === undefined ? "" : String(value);

function TableEditor({ tableId }: { tableId: string }) {
  const [table, setTable] = useState<TableDetail | null>(null);
  const [failed, setFailed] = useState("");
  const load = useCallback(async () => {
    try { setTable(await boardsGet<TableDetail>(`part=table&id=${encodeURIComponent(tableId)}`)); }
    catch (error) { setFailed(error instanceof Error ? error.message : "Tabellen kunde inte läsas."); }
  }, [tableId]);
  useLoadEffect(load);
  if (failed) return <p className="notice" role="alert">{failed}</p>;
  if (!table) return <PageSkeleton label="Hämtar tabellen…" />;
  return <TableForm initial={table} />;
}

let rowKey = 0;
const nextKey = () => `r${(rowKey += 1)}`;

function TableForm({ initial }: { initial: TableDetail }) {
  const router = useRouter();
  const [confirm, confirmElement] = useConfirm();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [columns, setColumns] = useState<TableColumn[]>(initial.columns);
  const [rows, setRows] = useState<EditRow[]>(() => initial.rows.map((row) => ({ key: nextKey(), values: Object.fromEntries(Object.entries(row.values).map(([key, value]) => [key, toText(value)])) })));
  const [revision, setRevision] = useState(initial.revision);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  usePageTrail({ heading: name || initial.name });
  const touch = () => setDirty(true);
  const save = async (): Promise<boolean> => {
    if (!name.trim()) { announce("Ge tabellen ett namn.", true); return false; }
    setBusy(true);
    try {
      const answer = await boardsPost<{ revision: number }>({ action: "save_table", id: initial.id, revision, table: { name: name.trim(), description, columns, rows: rows.map((row) => ({ values: row.values })) } });
      setRevision(answer.revision);
      setDirty(false);
      notice("Tabellen är sparad.");
      return true;
    } catch (error) { announce(error instanceof Error ? error.message : "Tabellen kunde inte sparas.", true); return false; }
    finally { setBusy(false); }
  };
  useUnsavedGuard(dirty && !busy, confirm, initial.canEdit ? save : undefined);
  const remove = async () => {
    if (!(await confirm({ title: `Ta bort ${initial.name}?`, message: "Kort som visar tabellen säger att datakällan inte finns längre.", confirmLabel: "Ta bort", tone: "danger" }))) return;
    try { await boardsPost({ action: "delete_table", id: initial.id }); setDirty(false); router.push("/?view=boards&tab=tables"); }
    catch (error) { announce(error instanceof Error ? error.message : "Tabellen kunde inte tas bort.", true); }
  };
  const addColumn = () => {
    if (columns.length >= MAX_COLUMNS) return;
    const label = `Kolumn ${columns.length + 1}`;
    setColumns([...columns, { key: columnKeyFor(label, columns.map((column) => column.key)), label, type: "text" }]);
    touch();
  };
  const setColumn = (index: number, patch: Partial<TableColumn>) => { setColumns(columns.map((column, at) => at === index ? { ...column, ...patch } : column)); touch(); };
  const removeColumn = (index: number) => { setColumns(columns.filter((_, at) => at !== index)); touch(); };
  const setCell = (key: string, column: string, value: string) => { setRows(rows.map((row) => row.key === key ? { ...row, values: { ...row.values, [column]: value } } : row)); touch(); };
  const editable = initial.canEdit;
  return <div className="space-y-5" data-testid="board-table-editor">
    {confirmElement}
    <PageHeader title={name || initial.name} description="Värdena visas på de kort som läser tabellen."
      actions={editable ? <>
        <Button type="button" variant="outline" className="text-destructive" onClick={() => void remove()}><Trash2 aria-hidden="true" />Ta bort</Button>
        <Button type="button" onClick={() => void save()} busy={busy} busyLabel="Sparar…" disabled={!dirty} data-testid="table-save"><Save aria-hidden="true" />Spara</Button>
      </> : undefined} />
    <Panel title="Tabellen" icon={Table2}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="table-name" label="Namn" value={name} onChange={(value) => { setName(value.slice(0, 80)); touch(); }} disabled={!editable} required />
        <Field id="table-description" label="Beskrivning" value={description} onChange={(value) => { setDescription(value.slice(0, 300)); touch(); }} disabled={!editable} />
      </div>
    </Panel>
    <Panel title="Kolumner" description={`Högst ${MAX_COLUMNS} kolumner. Typen avgör hur värdet visas: tal kan räknas ihop och status visas som en lampa.`}
      actions={editable ? <Button type="button" size="sm" variant="outline" onClick={addColumn} disabled={columns.length >= MAX_COLUMNS}><Plus aria-hidden="true" />Kolumn</Button> : undefined}>
      <ul className="space-y-3">{columns.map((column, index) => <li key={column.key} className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_7rem_auto]" data-testid="table-column">
        <Field id={`col-${column.key}-label`} label="Namn" value={column.label} onChange={(label) => setColumn(index, { label: label.slice(0, 60) })} disabled={!editable} />
        <Field id={`col-${column.key}-type`} label="Typ" value={column.type} onChange={(type) => setColumn(index, { type: type as TableColumn["type"] })} options={[...TABLE_COLUMN_TYPES]} optionLabels={COLUMN_TYPE_LABEL} disabled={!editable} />
        <Field id={`col-${column.key}-unit`} label="Enhet" value={column.unit ?? ""} onChange={(unit) => setColumn(index, { unit: unit.slice(0, 12) || undefined })} disabled={!editable || column.type !== "number"} />
        {editable ? <RemoveButton label={`Ta bort kolumnen ${column.label}`} disabled={columns.length <= 1} onClick={() => removeColumn(index)} /> : <span />}
      </li>)}</ul>
    </Panel>
    <Panel title="Rader" description={`${rows.length} av högst ${MAX_ROWS}.`}
      actions={editable ? <Button type="button" size="sm" variant="outline" disabled={rows.length >= MAX_ROWS} onClick={() => { setRows([...rows, { key: nextKey(), values: {} }]); touch(); }} data-testid="table-add-row"><Plus aria-hidden="true" />Rad</Button> : undefined}>
      {rows.length ? <div className="overflow-x-auto">
        <table className="data-table w-full min-w-[32rem] text-sm">
          <thead><tr>{columns.map((column) => <th key={column.key} scope="col" className="text-left text-xs font-semibold text-muted-foreground">{column.label}{column.unit ? ` (${column.unit})` : ""}</th>)}<th scope="col"><span className="sr-only">Ta bort</span></th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={row.key} data-testid="table-row">
            {columns.map((column) => <td key={column.key} className="py-1 pr-2">
              {column.type === "status"
                ? <select aria-label={`${column.label}, rad ${index + 1}`} className="form-select" value={row.values[column.key] ?? ""} disabled={!editable} onChange={(event) => setCell(row.key, column.key, event.target.value)}>
                  {STATE_CHOICES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  {row.values[column.key] && !STATE_CHOICES.some(([value]) => value === row.values[column.key]) ? <option value={row.values[column.key]}>{row.values[column.key]}</option> : null}
                </select>
                : <Input aria-label={`${column.label}, rad ${index + 1}`} className="w-full bg-card" type={column.type === "date" ? "date" : "text"} inputMode={column.type === "number" ? "decimal" : undefined}
                  value={row.values[column.key] ?? ""} disabled={!editable} onChange={(event) => setCell(row.key, column.key, event.target.value)} />}
            </td>)}
            <td className="w-10">{editable ? <RemoveButton label={`Ta bort rad ${index + 1}`} onClick={() => { setRows(rows.filter((item) => item.key !== row.key)); touch(); }} /> : null}</td>
          </tr>)}</tbody>
        </table>
      </div> : <p className="text-sm text-muted-foreground">Inga rader ännu.</p>}
    </Panel>
  </div>;
}
