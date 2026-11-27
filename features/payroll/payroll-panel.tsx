"use client";

import { plural } from "@/lib/plural";
import { formatSwedish } from "@/lib/swedish-time";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLoadEffect } from "@/lib/use-load-effect";
import { ArrowUp, Clock, Download, Eye, FileSpreadsheet, FileText, History, ListChecks, Plus, Trash2, Users, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/features/kfid/api";
import { CheckField, DialogActions, Field, Modal, Panel } from "@/features/kfid/ui";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { useDetailLevel } from "@/features/workflow/use-detail-level";
import { saveBlob } from "@/lib/download";
import { announce } from "@/lib/workflow/toast";
import { cn } from "@/lib/utils";
import { ABSENCE_LABELS, ABSENCE_TYPES } from "@/lib/workflow/absence";
import { CODE_TARGET_LABELS, CODE_TARGETS, OFFERED_PAYROLL_MODES, PAYROLL_MODE_LABELS, PAYROLL_SYSTEM_LABELS, PAYROLL_SYSTEMS } from "@/lib/payroll/codes";
import { ABSENCE_EXPORT_FIELDS, DATE_FORMATS, DELIMITER_LABELS, DELIMITERS, ENCODING_LABELS, ENCODINGS, EXPORT_FORMAT_LABELS, EXPORT_FORMATS, EXPORT_KIND_LABELS, formatHours, WORKED_EXPORT_FIELDS, type ExportTemplate } from "@/lib/payroll/export";
import { basisStatusText, type BasisPerson } from "@/lib/payroll/basis";
import type { PayrollSettings } from "@/lib/payroll/settings";
import { ABSENCE_RETENTION_MAX_MONTHS, ABSENCE_RETENTION_MIN_MONTHS } from "@/lib/absence/retention";
import { TimeTypesSection } from "@/features/payroll/time-types-panel";
import { KEY_STATUS, KeyCard, KeyCardGrid } from "@/features/integrations/key-card";

/**
 * Lön och frånvaro (2026-10-29): two parts of the same data, both under Tid → Lön och export (beslut 13, 2026-11-01). PayrollExportPanel for
 * admins and the Teamet right – choose a template and a period, preview, download. PayrollSettingsPanel for admins – which
 * system, the mode (files by hand; SFTP and API are hidden until built, 2026-11-20) and its true state, code mappings,
 * export codes, export templates, employee numbers and the latest runs. Absence and staff files are imported on the Import page.
 * Display levels: 1 shows the essentials, 2 adds the mappings and history, 3 everything (the template editor).
 */
type Run = { id: string; direction: string; mode: string; system: string; kind: string; fileName: string; status: string; counts: Record<string, unknown>; errors: { row?: number; message?: string }[]; createdAt: string };
type Overview = {
  settings: Omit<PayrollSettings, "importTemplates"> & { importTemplates: { name: string; savedAt: string; fingerprint: string }[] };
  canEdit: boolean; systemLabel: string; modeState: { ok: boolean; text: string }; keys: { sftp: boolean; api: boolean };
  staff: { withNumber: number; total: number }; waitingApproval: number; presets: ExportTemplate[]; runs: Run[];
};
const RUN_KIND: Record<string, string> = { absence: "Frånvaro", employee_numbers: "Anställningsnummer", worked_time: "Arbetad tid", payroll_basis: "Löneunderlag" };
const RUN_STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" }> = { ok: { label: "Klar", tone: "success" }, partial: { label: "Delvis", tone: "warning" }, failed: { label: "Misslyckades", tone: "danger" } };
/** Dates as in the rest of the app ("31 okt. 2026 23:06"), on the Swedish clock (resa 4, 2026-11-06). */
const when = (iso: string) => formatSwedish(iso, { dateStyle: "medium", timeStyle: "short" });
const lastRun = (word: string, iso: string | null) => (iso ? `Senaste ${word} ${when(iso)}` : `Ingen ${word} ännu`);
/** A month's first and last day; `back` months before the current one (1 = last month, the default). */
const monthRange = (back = 1) => {
  const now = new Date(); const first = new Date(Date.UTC(now.getFullYear(), now.getMonth() - back, 1)); const last = new Date(Date.UTC(now.getFullYear(), now.getMonth() - back + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
};
/** The months to choose among: this month and the twelve before it, as YYYY-MM with a Swedish name. */
const MONTH_CHOICES = Array.from({ length: 13 }, (_, back) => monthRange(back)).map((range) => ({ key: range.from.slice(0, 7), range,
  label: new Date(`${range.from}T12:00:00Z`).toLocaleDateString("sv-SE", { month: "long", year: "numeric", timeZone: "UTC" }) }));
const monthOf = (period: { from: string; to: string }) => MONTH_CHOICES.find((item) => item.range.from === period.from && item.range.to === period.to)?.key ?? "";
/** `problems` and `refusal` (2026-10-31): what keeps the file from being made, and the message Skapa fil would give. */
type Preview = { header: string[]; rows: string[][]; total: number; withoutNumber: number; withoutCode?: number; errors?: string[]; warnings?: string[]; fileName: string; problems?: string[]; refusal?: string | null };
type BasisAnswer = { people: BasisPerson[]; warnings: string[]; onlyApproved: boolean; fileName: string };
const hoursText = (minutes: number) => `${formatHours(minutes, ",")} h`;

/** Lines to check, in the warning or danger tone, folded after the first five. */
function Notes({ lines, tone, testId }: { lines: readonly string[]; tone: "warning" | "danger"; testId: string }) {
  if (!lines.length) return null;
  const list = (items: readonly string[]) => <ul className="space-y-0.5">{items.map((line, index) => <li key={index}>{line}</li>)}</ul>;
  return <div role={tone === "danger" ? "alert" : undefined} className={cn("rounded-lg border p-3 text-xs", indicatorBadge(tone))} data-testid={testId}>
    {list(lines.slice(0, 5))}
    {lines.length > 5 ? <details className="mt-1"><summary className="cursor-pointer">{lines.length - 5} till</summary>{list(lines.slice(5))}</details> : null}
  </div>;
}

/** Saves the answer of a file request under the name the server gave it. */
async function downloadFile(body: unknown, fallback: string) {
  const response = await fetch("/api/payroll", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "Filen kunde inte skapas.");
  saveBlob(await response.blob(), decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? fallback));
}

function useOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [hidden, setHidden] = useState(false);
  const load = useCallback(async () => {
    try { setData(await api<Overview>("/api/payroll", { cache: "no-store" })); }
    catch { setHidden(true); }
  }, []);
  useLoadEffect(load);
  return { data, hidden, load };
}

/**
 * Export till lön under Tid: the period (a month or from–to) and "Bara godkända månader" first, then Löneunderlag (the summary
 * per person to read, as PDF or CSV) and the file to the payroll system (template, preview, file).
 */
export function PayrollExportPanel() {
  const { data, hidden } = useOverview();
  const level = useDetailLevel();
  const [templateId, setTemplateId] = useState("preset-absence-period");
  const [period, setPeriod] = useState(() => monthRange());
  const [onlyApproved, setOnlyApproved] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [basis, setBasis] = useState<BasisAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (hidden || !data) return null;
  const templates = [...data.settings.exportTemplates, ...data.presets];
  const periodRequest = { from: period.from, to: period.to, userIds: [], onlyApproved };
  const request = { templateId, ...periodRequest };
  const changePeriod = (next: { from: string; to: string }) => { setPeriod(next); setPreview(null); setBasis(null); };
  async function run(step: () => Promise<void>, failed: string) {
    setBusy(true); setError("");
    try { await step(); } catch (cause) { setError(cause instanceof Error ? cause.message : failed); } finally { setBusy(false); }
  }
  const look = () => run(async () => setPreview(await api("/api/payroll", { method: "POST", body: JSON.stringify({ action: "export_preview", request }) })), "Förhandsgranskningen misslyckades.");
  // The preview follows the file, so what the template left out is said also to someone who went straight to the file (beslut 8).
  const download = () => run(async () => { await downloadFile({ action: "export", request }, "export.csv"); announce("Filen är skapad."); const shown = await api<Preview>("/api/payroll", { method: "POST", body: JSON.stringify({ action: "export_preview", request }) }).catch(() => null); if (shown) setPreview(shown); }, "Exporten misslyckades.");
  const showBasis = () => run(async () => setBasis(await api("/api/payroll", { method: "POST", body: JSON.stringify({ action: "basis", request: periodRequest }) })), "Underlaget kunde inte läsas.");
  const basisFile = (format: "pdf" | "csv") => run(async () => { await downloadFile({ action: "basis_file", request: periodRequest, format }, `loneunderlag.${format}`); announce("Löneunderlaget är skapat."); }, "Underlaget kunde inte skapas.");
  return <Panel className="@container" icon={FileSpreadsheet} title="Export till lönesystem" description={`Löneunderlag och filer${data.systemLabel !== "Inget valt" ? ` till ${data.systemLabel}` : ""}.`}>
    <div className="grid gap-3 @xl:grid-cols-3" data-testid="payroll-period">
      <Field id="payroll-export-month" label="Månad" value={monthOf(period)} onChange={(key) => { const found = MONTH_CHOICES.find((item) => item.key === key); if (found) changePeriod(found.range); }}
        options={MONTH_CHOICES.map((item) => item.key)} optionLabels={{ "": "Egen period", ...Object.fromEntries(MONTH_CHOICES.map((item) => [item.key, item.label])) }} />
      <Field id="payroll-export-from" label="Från" type="date" value={period.from} onChange={(from) => changePeriod({ ...period, from })} />
      <Field id="payroll-export-to" label="Till och med" type="date" value={period.to} onChange={(to) => changePeriod({ ...period, to })} />
    </div>
    <CheckField id="payroll-only-approved" className="mt-3" label="Bara godkända månader" description="Tid och frånvaro i månader som inte är godkända tas inte med." checked={onlyApproved}
      onChange={(checked) => { setOnlyApproved(checked); setPreview(null); setBasis(null); }} testId="payroll-only-approved" />
    {error ? <p role="alert" className={cn("mt-3 whitespace-pre-line rounded-lg border p-3 text-sm", indicatorBadge("danger"))} data-testid="payroll-export-error">{error}</p> : null}

    <section className="mt-5 space-y-2" data-testid="payroll-basis">
      <h3 className="text-sm font-semibold">Löneunderlag</h3>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={() => void showBasis()} data-testid="payroll-basis-show"><Eye />Visa underlaget</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void basisFile("pdf")} data-testid="payroll-basis-pdf"><FileText />PDF</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void basisFile("csv")} data-testid="payroll-basis-csv"><Download />CSV</Button>
      </div>
      {basis ? <BasisSummary basis={basis} level={level} /> : null}
    </section>

    <section className="mt-5 space-y-2" data-testid="payroll-export">
      <h3 className="text-sm font-semibold">Fil till lönesystemet</h3>
      <Field id="payroll-export-template" label="Mall" value={templateId} onChange={(value) => { setTemplateId(value); setPreview(null); }} options={templates.map((item) => item.id)} optionLabels={Object.fromEntries(templates.map((item) => [item.id, item.name]))} className="sm:max-w-md" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={() => void look()} data-testid="payroll-export-preview"><Eye />Förhandsgranska</Button>
        {/* Spärrarna (2026-10-31): after a preview that shows what keeps the file out, the button says why; the server refuses anyway. */}
        <Button type="button" disabled={busy} disabledReason={preview?.refusal ? (preview.problems?.length ? "Rätta det som saknas först." : "Inget att exportera för perioden.") : null} onClick={() => void download()} data-testid="payroll-export-download"><Download />Skapa fil</Button>
        {data.staff.withNumber < data.staff.total ? <span className="text-xs text-muted-foreground">{data.staff.total - data.staff.withNumber} medarbetare saknar anställningsnummer.</span> : null}
      </div>
    </section>
    {preview ? <div className="mt-3 space-y-2" data-testid="payroll-export-result">
      <p className="text-sm">{plural(preview.total, "rad", "rader")} · {preview.fileName}{preview.withoutNumber ? <span className="text-amber-700 dark:text-amber-400"> · {preview.withoutNumber} utan anställningsnummer</span> : null}{preview.withoutCode ? <span className="text-amber-700 dark:text-amber-400" data-testid="payroll-export-without-code"> · {preview.withoutCode} utan lönekod för tidstypen</span> : null}</p>
      <Notes lines={preview.errors ?? []} tone="danger" testId="payroll-export-errors" />
      {preview.problems?.length && !preview.errors?.length ? <Notes lines={["Filen skapas inte förrän det här är rättat:", ...preview.problems.map((line) => `${line}.`)]} tone="danger" testId="payroll-export-problems" /> : null}
      {preview.problems?.length && preview.errors?.length ? <p className="text-xs text-muted-foreground" data-testid="payroll-export-problems">Filen skapas inte förrän raderna ovan är rättade.</p> : null}
      <Notes lines={preview.warnings ?? []} tone="warning" testId="payroll-export-warnings" />
      {preview.rows.length ? <div className="max-h-80 overflow-auto rounded-lg border">
        <table className="w-full border-collapse text-xs"><thead><tr className="bg-[var(--panel-header)] text-left">{preview.header.map((cell, index) => <th key={index} className="whitespace-nowrap border-b px-2 py-1.5 font-semibold">{cell}</th>)}</tr></thead>
          <tbody>{preview.rows.slice(0, level === 1 ? 10 : 50).map((row, index) => <tr key={index} className="border-b last:border-b-0">{row.map((cell, column) => <td key={column} className="whitespace-nowrap px-2 py-1">{cell}</td>)}</tr>)}</tbody></table>
      </div> : <p className="text-sm text-muted-foreground">Inget att exportera för perioden.</p>}
    </div> : null}
  </Panel>;
}

/** Löneunderlaget on the page: one row per person with the totals and the month's status; the types under it from level 2. */
function BasisSummary({ basis, level }: { basis: BasisAnswer; level: number }) {
  return <div className="space-y-2" data-testid="payroll-basis-result">
    <Notes lines={basis.warnings} tone="warning" testId="payroll-basis-warnings" />
    {basis.people.length ? <div className="max-h-96 overflow-auto rounded-lg border">
      <table className="w-full border-collapse text-xs">
        <thead><tr className="bg-[var(--panel-header)] text-left">{["Person", "Status", "Arbetad tid", "Frånvaro"].map((cell) => <th key={cell} className="whitespace-nowrap border-b px-2 py-1.5 font-semibold">{cell}</th>)}</tr></thead>
        <tbody>{basis.people.map((person) => <tr key={person.userId} className="border-b align-top last:border-b-0">
          <td className="px-2 py-1.5"><span className="font-medium">{person.name}</span><span className="block text-muted-foreground">{person.employeeNumber || "Saknar anställningsnummer"}</span></td>
          <td className="whitespace-nowrap px-2 py-1.5">{basisStatusText(person)}</td>
          <td className="px-2 py-1.5"><span className="font-medium">{hoursText(person.workedMinutes)}</span>
            {level > 1 ? person.worked.map((item) => <span key={`${item.timeType}|${item.code}`} className="block text-muted-foreground">{item.timeType} {item.code ? `(${item.code})` : "(utan kod)"} {hoursText(item.minutes)}</span>) : null}</td>
          <td className="px-2 py-1.5"><span className="font-medium">{hoursText(person.absenceMinutes)}</span>
            {level > 1 ? person.absence.map((item) => <span key={item.type} className="block text-muted-foreground">{item.label} {item.code ? `(${item.code})` : "(utan kod)"} {item.days} d, {hoursText(item.minutes)}</span>) : null}</td>
        </tr>)}</tbody>
      </table>
    </div> : <p className="text-sm text-muted-foreground">Ingen tid eller godkänd frånvaro i perioden.</p>}
  </div>;
}

/**
 * Lön och frånvaro under Tid → Lön och export and Kopplingar → Lön och export. The same card as every key card (2026-11-12):
 * the connection (system, mode, storage time, the SFTP server at level 3) with ONE Spara and "Ej sparade ändringar", the export
 * codes and the explanations under Mer, and – beside it where there is room – the payroll system's key (`keyCard`). The lists
 * (time types, absence codes, export templates, history) follow as cards of their own and save each change as before.
 */
export function PayrollSettingsPanel({ keyCard }: { /** The payroll system's key card, beside this one. */ keyCard?: React.ReactNode } = {}) {
  const { data, hidden, load } = useOverview();
  const level = useDetailLevel();
  // The person's changes on top of the saved settings; cleared after each save, so the page shows what is stored.
  const [changes, setDraft] = useState<PayrollSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<ExportTemplate | null>(null);
  const [staffOpen, setStaffOpen] = useState(false);
  if (hidden || !data) return null;
  const draft: PayrollSettings = changes ?? { ...data.settings, importTemplates: [] };
  const edit = data.canEdit;
  async function post(body: unknown, done: string) {
    setBusy(true); setError("");
    try { await api("/api/payroll", { method: "POST", body: JSON.stringify(body) }); announce(done); setDraft(null); await load(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Det gick inte att spara."); return false; }
    finally { setBusy(false); }
  }
  const saved = (value: Pick<PayrollSettings, "system" | "systemName" | "mode" | "importedEditable" | "exportCodes" | "sftp" | "absenceRetentionMonths">) =>
    ({ system: value.system, systemName: value.systemName, mode: value.mode, importedEditable: value.importedEditable, exportCodes: value.exportCodes, sftp: value.sftp, absenceRetentionMonths: value.absenceRetentionMonths });
  const dirty = edit && changes !== null && JSON.stringify(saved(changes)) !== JSON.stringify(saved(data.settings));
  const save = () => post({ action: "settings", settings: saved(draft) }, "Inställningarna är sparade.");
  const codes = Object.entries(data.settings.codeMap).sort(([a], [b]) => a.localeCompare(b, "sv"));
  const card = <KeyCard icon={Workflow} title="Lön och frånvaro" statusTestId="payroll-status"
    status={{ ...(data.settings.system === "none" ? KEY_STATUS.missing : data.settings.lastError ? KEY_STATUS.failed : data.modeState.ok ? KEY_STATUS.works : { label: "Åtgärd", tone: "warning" as const }),
      problem: data.settings.lastError || (!data.modeState.ok ? data.modeState.text : null) }}
    problemTestId="payroll-mode-state" save={edit ? { dirty, onSave: save } : undefined} saveTestId="payroll-save"
    actions={edit ? <Button type="button" variant="outline" onClick={() => setStaffOpen(true)} data-testid="payroll-staff"><Users />Anställningsnummer</Button> : null}
    more={<>
      <p>Koppling till företagets tid- eller lönesystem. Frånvaro läses in på Import.</p>
      <p>{lastRun("import", data.settings.lastImportAt)} · {lastRun("export", data.settings.lastExportAt).toLowerCase()}.</p>
      {edit && level > 1 ? <div className="space-y-2 text-foreground" data-testid="payroll-export-codes">
        <p className="text-xs font-semibold">Tidkoder vid export</p>
        <div className="grid gap-2 @lg:grid-cols-2">
          {ABSENCE_TYPES.map((type) => <Field key={type} id={`export-code-${type}`} label={ABSENCE_LABELS[type]} value={draft.exportCodes[type] ?? ""} onChange={(code) => setDraft({ ...draft, exportCodes: { ...draft.exportCodes, [type]: code } })} placeholder="Kod i lönesystemet" />)}
        </div>
      </div> : null}
    </>}>
    <div className="space-y-4" data-testid="payroll-settings">
      <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{data.systemLabel}</span> · {data.staff.withNumber} av {data.staff.total} medarbetare har anställningsnummer.{data.waitingApproval ? ` Frånvaroposter som väntar på godkännande i lönesystemet: ${data.waitingApproval}.` : ""}</p>
      {edit ? <div className="grid gap-3 @lg:grid-cols-2">
        <Field id="payroll-system" label="System" value={draft.system} onChange={(system) => setDraft({ ...draft, system: system as PayrollSettings["system"] })} options={[...PAYROLL_SYSTEMS]} optionLabels={PAYROLL_SYSTEM_LABELS} />
        {draft.system === "other" ? <Field id="payroll-system-name" label="Systemets namn" value={draft.systemName} onChange={(systemName) => setDraft({ ...draft, systemName })} /> : null}
        {/* Sätt (2026-11-20): only Filer för hand can be chosen. The field is shown just while an older saved mode (SFTP, API)
            is still stored, so the company sees it and can change back; otherwise there is nothing to choose. */}
        {OFFERED_PAYROLL_MODES.includes(draft.mode) ? null
          : <Field id="payroll-mode" label="Sätt" value={draft.mode} onChange={(mode) => setDraft({ ...draft, mode: mode as PayrollSettings["mode"] })} options={[...OFFERED_PAYROLL_MODES, draft.mode]} optionLabels={PAYROLL_MODE_LABELS} />}
        {/* Frånvarons lagringstid (2026-10-30): removed every night when it ended longer ago. */}
        <Field id="payroll-absence-retention" label="Lagringstid för frånvaro (månader)" type="number" value={draft.absenceRetentionMonths} onChange={(value) => setDraft({ ...draft, absenceRetentionMonths: Math.round(Number(value)) || 0 })} help={`${ABSENCE_RETENTION_MIN_MONTHS}–${ABSENCE_RETENTION_MAX_MONTHS}. Äldre frånvaro tas bort varje natt.`} />
      </div> : null}
      {edit ? <CheckField id="payroll-imported-editable" label="Importerad frånvaro får ändras i Workflow" checked={draft.importedEditable} onChange={(importedEditable) => setDraft({ ...draft, importedEditable })} /> : null}

      {edit && draft.mode === "sftp" && level === 3 ? <section className="space-y-3 pt-2" aria-label="SFTP" data-testid="payroll-sftp">
        <h4 className="text-xs font-semibold text-foreground">SFTP</h4>
        <div className="grid gap-3 @lg:grid-cols-2">
          <Field id="sftp-host" label="Server" value={draft.sftp.host} onChange={(host) => setDraft({ ...draft, sftp: { ...draft.sftp, host } })} placeholder="sftp.example.se" />
          <Field id="sftp-port" label="Port" type="number" value={draft.sftp.port} onChange={(port) => setDraft({ ...draft, sftp: { ...draft.sftp, port: Number(port) || 22 } })} />
          <Field id="sftp-user" label="Användare" value={draft.sftp.username} onChange={(username) => setDraft({ ...draft, sftp: { ...draft.sftp, username } })} />
          <Field id="sftp-import" label="Mapp för import" value={draft.sftp.importDir} onChange={(importDir) => setDraft({ ...draft, sftp: { ...draft.sftp, importDir } })} />
          <Field id="sftp-export" label="Mapp för export" value={draft.sftp.exportDir} onChange={(exportDir) => setDraft({ ...draft, sftp: { ...draft.sftp, exportDir } })} />
          <Field id="sftp-hostkey" label="Serverns fingerprint" value={draft.sftp.hostKey} onChange={(hostKey) => setDraft({ ...draft, sftp: { ...draft.sftp, hostKey } })} placeholder="SHA256:…" />
        </div>
        <p className="text-xs text-muted-foreground">Lösenordet eller nyckeln läggs under Lönesystemets nyckel ({data.keys.sftp ? "finns" : "saknas"}). Den lagras krypterad för företaget.</p>
      </section> : null}
      {error ? <p role="alert" className={cn("rounded-lg border p-3 text-sm", indicatorBadge("danger"))}>{error}</p> : null}
    </div>
  </KeyCard>;
  return <>
    <KeyCardGrid label="Lön och frånvaro" testId="payroll-grid">
      <li className="min-w-0">{card}</li>
      {keyCard ? <li className="min-w-0">{keyCard}</li> : null}
    </KeyCardGrid>

    {/* Tidstyper (2026-10-29): the company's own kinds of time and their codes for the export. */}
    <Panel icon={Clock} title="Tidstyper" description="Företagets egna typer av tid. Varje typs kod följer med i exporten till lönesystemet."><TimeTypesSection framed={false} /></Panel>

    {level > 1 ? <div data-testid="payroll-codes"><Panel icon={ListChecks} title="Frånvarokoder" collapsible defaultCollapsed count={codes.length} description="Lönesystemets koder och vad de betyder i Workflow.">
      {codes.length ? <ul className="grid gap-3 @xl:grid-cols-2">{codes.map(([code, type]) => <li key={code} className="grid gap-1.5 text-xs font-medium">
        <span className="truncate">{code}</span>
        <select className="form-select h-9" value={type} disabled={!edit || busy} aria-label={`Typ för koden ${code}`} onChange={(event) => void post({ action: "codes", codes: { [code]: event.target.value } }, "Koden är sparad.")}>
          {CODE_TARGETS.map((target) => <option key={target} value={target}>{CODE_TARGET_LABELS[target]}</option>)}<option value="">Ta bort kopplingen</option>
        </select></li>)}</ul> : <p className="text-sm text-muted-foreground">Koderna kopplas första gången en frånvarofil importeras.</p>}
    </Panel></div> : null}

    {level > 1 ? <div data-testid="payroll-templates"><Panel icon={FileSpreadsheet} title="Exportmallar" collapsible defaultCollapsed count={data.settings.exportTemplates.length + data.presets.length} description={`${plural(data.settings.exportTemplates.length, "egen", "egna")} och Workflows mallar.`}
      actions={edit && level === 3 ? <Button type="button" size="sm" variant="outline" onClick={() => setEditing({ ...data.presets[0], id: `own-${Date.now().toString(36)}`, name: "Ny exportmall" })}><Plus />Ny mall</Button> : undefined}>
      <ul className="divide-y rounded-lg border text-sm">{[...data.settings.exportTemplates, ...data.presets].map((template) => <li key={template.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <span className="min-w-0"><span className="font-medium">{template.name}</span> <span className="text-xs text-muted-foreground">{template.format === "paxml" ? "Tid och frånvaro · PAXml" : <>{EXPORT_KIND_LABELS[template.kind]} · {template.format === "xlsx" ? "Excel" : DELIMITER_LABELS[template.delimiter]} · {template.columns.length} kolumner</>}{template.id.startsWith("preset-") ? " · Workflows mall" : ""}</span></span>
        {edit && level === 3 ? <span className="flex gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(template.id.startsWith("preset-") ? { ...template, id: `own-${Date.now().toString(36)}`, name: `${template.name} (egen)` } : template)}>{template.id.startsWith("preset-") ? "Kopiera" : "Ändra"}</Button>
          {!template.id.startsWith("preset-") ? <Button type="button" size="sm" variant="ghost" aria-label={`Ta bort ${template.name}`} disabled={busy} onClick={() => void post({ action: "template_delete", id: template.id }, "Mallen är borttagen.")}><Trash2 /></Button> : null}
        </span> : null}
      </li>)}</ul>
    </Panel></div> : null}

    {level > 1 ? <div data-testid="payroll-history"><Panel icon={History} title="Historik" collapsible defaultCollapsed count={data.runs.length} description="Senaste import och export.">
      {data.runs.length ? <ul className="divide-y rounded-lg border text-sm">{data.runs.map((run) => <li key={run.id} className="px-3 py-2">
        <p className="flex flex-wrap items-center gap-2"><span className={cn("rounded-full px-2 py-0.5 text-xs", indicatorBadge(RUN_STATUS[run.status]?.tone ?? "warning"))}>{RUN_STATUS[run.status]?.label ?? run.status}</span>
          <span className="font-medium">{run.direction === "import" ? "Import" : "Export"} · {RUN_KIND[run.kind] ?? run.kind}</span><span className="text-xs text-muted-foreground">{when(run.createdAt)} · {run.fileName}</span></p>
        <p className="text-xs text-muted-foreground">{Object.entries(run.counts).filter(([, value]) => typeof value === "number" && value).map(([key, value]) => `${COUNT_LABEL[key] ?? key} ${value}`).join(" · ")}</p>
        {run.errors.length ? <details className="text-xs"><summary className="cursor-pointer text-amber-700 dark:text-amber-400">{plural(run.errors.length, "rad", "rader")} med fel</summary><ul className="mt-1 space-y-0.5">{run.errors.map((item, index) => <li key={index}>{item.row ? `Rad ${item.row}: ` : ""}{item.message}</li>)}</ul></details> : null}
      </li>)}</ul> : <p className="text-sm text-muted-foreground">Ingen import eller export än.</p>}
    </Panel></div> : null}
    {editing ? <TemplateEditor template={editing} busy={busy} onClose={() => setEditing(null)} onSave={async (template) => { if (await post({ action: "template_save", template }, "Mallen är sparad.")) setEditing(null); }} /> : null}
    {staffOpen ? <StaffNumbers onClose={() => { setStaffOpen(false); void load(); }} /> : null}
  </>;
}
const COUNT_LABEL: Record<string, string> = { created: "nya", changed: "ändrade", unchanged: "oförändrade", replaced: "ersatte", ignored: "överhoppade", conflictsKept: "krockar kvar", errors: "fel", saved: "sparade", rows: "rader", people: "personer", warnings: "att kontrollera", monthsLeftOut: "månader inte med" };

/** An export template: what, how the file is written, and the columns in order (level 3). */
function TemplateEditor({ template, busy, onClose, onSave }: { template: ExportTemplate; busy: boolean; onClose: () => void; onSave: (template: ExportTemplate) => Promise<void> }) {
  const [value, setValue] = useState(template);
  const fields: Record<string, string> = value.kind === "absence" ? ABSENCE_EXPORT_FIELDS : WORKED_EXPORT_FIELDS;
  const set = (patch: Partial<ExportTemplate>) => setValue((current) => ({ ...current, ...patch }));
  const unused = useMemo(() => Object.keys(fields).filter((field) => field === "fixed" || !value.columns.some((column) => column.field === field)), [fields, value.columns]);
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title="Exportmall" size="compact" nativeScreen>
    <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void onSave(value); }} data-testid="payroll-template-editor">
      <Field id="template-name" label="Namn" value={value.name} onChange={(name) => set({ name })} required />
      <div className="grid grid-cols-2 gap-3">
        {/* PAXml (2026-10-30): the format decides the content – worked time per person, day and type, and absence per day. */}
        <Field id="template-format" label="Format" value={value.format} onChange={(format) => set(format === "paxml" ? { format: "paxml", kind: "worked_time", rowsPer: "dayType" } : { format: format as ExportTemplate["format"] })} options={[...EXPORT_FORMATS]} optionLabels={EXPORT_FORMAT_LABELS} />
        {value.format !== "paxml" ? <Field id="template-kind" label="Innehåll" value={value.kind} onChange={(kind) => set({ kind: kind as ExportTemplate["kind"], rowsPer: kind === "absence" ? "period" : "day", columns: [{ field: "employeeNumber", header: "", value: "" }] })} options={["absence", "worked_time"]} optionLabels={EXPORT_KIND_LABELS} /> : null}
        {value.format !== "paxml" ? <Field id="template-rows" label="En rad per" value={value.rowsPer} onChange={(rowsPer) => set({ rowsPer: rowsPer as ExportTemplate["rowsPer"] })} options={value.kind === "absence" ? ["period", "day"] : ["entry", "day", "dayType"]} optionLabels={{ period: "Frånvaro", day: "Person och dag", entry: "Tidpost", dayType: "Person, dag och tidstyp" }} /> : null}
        {value.format === "csv" ? <Field id="template-delimiter" label="Avgränsare" value={value.delimiter} onChange={(delimiter) => set({ delimiter: delimiter as ExportTemplate["delimiter"] })} options={[...DELIMITERS]} optionLabels={DELIMITER_LABELS} /> : null}
        {value.format === "csv" ? <Field id="template-encoding" label="Teckenkodning" value={value.encoding} onChange={(encoding) => set({ encoding: encoding as ExportTemplate["encoding"] })} options={[...ENCODINGS]} optionLabels={ENCODING_LABELS} /> : null}
        {value.format === "csv" ? <Field id="template-extension" label="Filändelse" value={value.extension} onChange={(extension) => set({ extension: extension as ExportTemplate["extension"] })} options={["csv", "txt", "tsv"]} /> : null}
        {value.format !== "paxml" ? <Field id="template-date" label="Datumformat" value={value.dateFormat} onChange={(dateFormat) => set({ dateFormat: dateFormat as ExportTemplate["dateFormat"] })} options={[...DATE_FORMATS]} /> : null}
        {value.format !== "paxml" ? <Field id="template-decimal" label="Decimaltecken" value={value.decimal} onChange={(decimal) => set({ decimal: decimal as ExportTemplate["decimal"] })} options={[",", "."]} optionLabels={{ ",": "Komma (7,50)", ".": "Punkt (7.50)" }} /> : null}
      </div>
      {value.format === "paxml" ? <p className="text-xs text-muted-foreground">Filen följer PAXml 2.0. Den innehåller arbetad tid per person, dag och tidstyp med tidstypens lönekod, och godkänd frånvaro per dag med frånvarons exportkod.</p> : null}
      {value.format !== "paxml" ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.header} onChange={(event) => set({ header: event.target.checked })} />Rubrikrad först</label> : null}
      {value.kind === "absence" ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.statuses.includes("APPLIED")} onChange={(event) => set({ statuses: event.target.checked ? ["APPROVED", "APPLIED"] : ["APPROVED"] })} />Ta med ansökt frånvaro</label> : null}
      {value.format !== "paxml" ? <div className="grid gap-2">
        <p className="text-xs font-semibold text-muted-foreground">Kolumner i ordning</p>
        {value.columns.map((column, index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
          <Field id={`column-${index}`} label={fields[column.field] ?? column.field} value={column.field === "fixed" ? column.value : column.header} placeholder={column.field === "fixed" ? "Text" : "Rubrik i filen"}
            onChange={(text) => set({ columns: value.columns.map((item, at) => (at === index ? (item.field === "fixed" ? { ...item, value: text } : { ...item, header: text }) : item)) })} className="col-span-2" />
          <span className="flex gap-1">
            <Button type="button" size="icon" variant="ghost" aria-label="Flytta upp" disabled={!index} onClick={() => set({ columns: value.columns.map((item, at) => (at === index - 1 ? value.columns[index] : at === index ? value.columns[index - 1] : item)) })}><ArrowUp /></Button>
            <Button type="button" size="icon" variant="ghost" aria-label="Ta bort kolumnen" disabled={value.columns.length < 2} onClick={() => set({ columns: value.columns.filter((_, at) => at !== index) })}><Trash2 /></Button>
          </span>
        </div>)}
        {unused.length ? <select className="form-select h-9" value="" aria-label="Lägg till kolumn" onChange={(event) => { if (event.target.value) set({ columns: [...value.columns, { field: event.target.value, header: "", value: "" }] }); }}>
          <option value="">Lägg till kolumn…</option>{unused.map((field) => <option key={field} value={field}>{fields[field]}</option>)}
        </select> : null}
      </div> : null}
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Spara", type: "submit", busy, busyLabel: "Sparar…", testId: "payroll-template-save" }} />
    </form>
  </Modal>;
}

/**
 * Anställningsnummer per medarbetare (admins): the match key for absence files and the number in exports – and Ingen fast
 * arbetstid for hourly staff (2026-10-30), set by the admin next to the number.
 */
function StaffNumbers({ onClose }: { onClose: () => void }) {
  const [staff, setStaff] = useState<{ userId: string; name: string; email: string; employeeNumber: string | null; noFixedHours: boolean }[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [hourly, setHourly] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void api<{ staff: NonNullable<typeof staff> }>("/api/payroll?staff=1", { cache: "no-store" }).then((result) => { setStaff(result.staff); setValues(Object.fromEntries(result.staff.map((person) => [person.userId, person.employeeNumber ?? ""]))); setHourly(Object.fromEntries(result.staff.map((person) => [person.userId, person.noFixedHours]))); }).catch((cause) => setError(cause instanceof Error ? cause.message : "Listan kunde inte läsas.")); }, []);
  async function save() {
    if (!staff) return;
    setBusy(true); setError("");
    try {
      for (const person of staff) {
        if ((person.employeeNumber ?? "") !== (values[person.userId] ?? "").trim()) await api("/api/payroll", { method: "POST", body: JSON.stringify({ action: "employee_number", userId: person.userId, employeeNumber: values[person.userId] ?? "" }) });
        if (person.noFixedHours !== Boolean(hourly[person.userId])) await api("/api/payroll", { method: "POST", body: JSON.stringify({ action: "fixed_hours", userId: person.userId, noFixedHours: Boolean(hourly[person.userId]) }) });
      }
      announce("Uppgifterna är sparade."); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Det gick inte att spara."); }
    finally { setBusy(false); }
  }
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title="Anställda" size="compact" nativeScreen>
    <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void save(); }} data-testid="payroll-staff-numbers">
      <p className="text-xs text-muted-foreground">Samma nummer som i lönesystemet. Det kopplar frånvarofiler till personen och står i exporten. Vill du lägga in många på en gång importerar du en fil med anställningsnummer och e-post under Import.</p>
      {staff ? staff.map((person) => <div key={person.userId} className="grid gap-1.5">
        <Field id={`number-${person.userId}`} label={person.name} hint={person.email} value={values[person.userId] ?? ""} onChange={(text) => setValues({ ...values, [person.userId]: text })} />
        <CheckField id={`hourly-${person.userId}`} label="Ingen fast arbetstid (timanställd)" checked={Boolean(hourly[person.userId])} onChange={(checked) => setHourly({ ...hourly, [person.userId]: checked })} />
      </div>) : <p className="text-sm text-muted-foreground">Läser…</p>}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Spara", type: "submit", busy, busyLabel: "Sparar…", testId: "payroll-staff-save" }} />
    </form>
  </Modal>;
}
