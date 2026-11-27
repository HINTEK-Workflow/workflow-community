"use client";

import { plural } from "@/lib/plural";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, LoaderCircle, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/features/kfid/api";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { useDetailLevel } from "@/features/workflow/use-detail-level";
import { cn } from "@/lib/utils";
import type { ExtractedFile } from "@/lib/import/detect";
import { CODE_TARGET_LABELS, CODE_TARGETS } from "@/lib/payroll/codes";
import type { AbsencePlanAnswer } from "@/lib/payroll/server";

/**
 * Frånvaro från tid- eller lönesystem on the Import page (2026-10-29): the preview of an absence file – new, changed, unchanged,
 * conflicts and errors – the company's unknown codes to map once, a choice per conflict, and Importera. The server plans the
 * file again before it writes, so nothing here decides on its own. The same file imported again changes nothing.
 */
type Preview = Extract<AbsencePlanAnswer, { allowed: true }>;
type Row = Preview["preview"]["rows"][number];
const ACTION_LABEL: Record<Row["action"], string> = { new: "Ny", changed: "Ändrad", unchanged: "Oförändrad", conflict: "Krock", ignored: "Hoppas över", error: "Fel" };
const ACTION_TONE: Record<Row["action"], "success" | "warning" | "danger" | "neutral"> = { new: "success", changed: "success", unchanged: "neutral", conflict: "warning", ignored: "neutral", error: "danger" };
const fileBody = (file: ExtractedFile) => { const { headers, rows, kind, name, mimeType, size, sheet, rowCount, truncated } = file; return { headers, rows, kind, name, mimeType, size, sheet, rowCount, truncated }; };
const range = (row: Row) => `${row.from === row.to ? row.from : `${row.from} – ${row.to}`}${row.hours ? ` ${row.hours.start}–${row.hours.end}` : ""}`;

export function AbsenceImportCard({ file, mapping, answer }: { file: ExtractedFile; mapping: Record<string, string | null>; answer: AbsencePlanAnswer }) {
  const level = useDetailLevel();
  const [plan, setPlan] = useState(answer);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<Record<string, "replace" | "keep">>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ counts: Record<string, number>; status: string; errors: { row: number; message: string }[] } | null>(null);
  // A new answer (another column choice) starts the card over (adjusted while rendering, as React recommends).
  const [seen, setSeen] = useState(answer);
  if (seen !== answer) { setSeen(answer); setPlan(answer); setResult(null); setChoices({}); }
  if (!plan.allowed) return <p className="rounded-lg border p-3 text-sm text-muted-foreground" data-testid="absence-import-denied">{plan.message}</p>;
  const { preview } = plan;
  const toWrite = preview.counts.new + preview.counts.changed + Object.values(choices).filter((choice) => choice === "replace").length;

  async function remap(next: Record<string, string>) {
    setCodes(next); setBusy(true); setError("");
    try { setPlan((await api<{ plan: { absence: AbsencePlanAnswer } }>("/api/import", { method: "POST", body: JSON.stringify({ action: "plan", file: fileBody(file), target: "absence", mapping, codeMap: next }) })).plan.absence); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Förhandsgranskningen kunde inte göras."); }
    finally { setBusy(false); }
  }
  async function apply() {
    setBusy(true); setError("");
    try { setResult(await api("/api/import", { method: "POST", body: JSON.stringify({ action: "absence_apply", file: fileBody(file), mapping, codeMap: codes, choices, skip: [], saveTemplate: true }) })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Importen misslyckades."); }
    finally { setBusy(false); }
  }

  const shown = level === 1 ? preview.rows.filter((row) => row.action === "conflict" || row.action === "error") : preview.rows;
  return <div className="space-y-3" data-testid="absence-import">
    <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="absence-import-counts">
      {(["new", "changed", "unchanged", "conflict", "ignored", "error"] as const).filter((action) => preview.counts[action]).map((action) =>
        <span key={action} className={cn("rounded-full px-2 py-0.5 text-xs font-medium", indicatorBadge(ACTION_TONE[action]))}>{preview.counts[action]} {ACTION_LABEL[action].toLowerCase()}</span>)}
      <span className="text-xs text-muted-foreground">Källa: {plan.system === "Inget valt" ? "fil" : plan.system}</span>
    </div>
    {plan.importedBefore ? <p className={cn("rounded-lg border p-3 text-sm", indicatorBadge("neutral"))}>Samma fil importerades {plan.importedBefore.slice(0, 10)}. Inget dubbleras.</p> : null}

    {preview.unknownCodes.length ? <div className="rounded-lg border p-3" data-testid="absence-import-codes">
      <p className="text-sm font-medium">Koppla koderna</p>
      <p className="text-xs text-muted-foreground">Kopplingen sparas för företaget när du importerar.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {preview.unknownCodes.map((item) => <label key={item.code} className="grid gap-1 text-xs font-medium">
          <span className="truncate">{item.code} <span className="font-normal text-muted-foreground">({item.rows} {item.rows === 1 ? "rad" : "rader"})</span></span>
          <select className="form-select h-9" value={codes[item.code] ?? ""} disabled={busy} aria-label={`Typ för koden ${item.code}`} onChange={(event) => void remap({ ...codes, [item.code]: event.target.value })}>
            <option value="">{item.suggestion ? `Välj (förslag: ${CODE_TARGET_LABELS[item.suggestion]})` : "Välj typ…"}</option>
            {CODE_TARGETS.map((target) => <option key={target} value={target}>{CODE_TARGET_LABELS[target]}</option>)}
          </select>
        </label>)}
      </div>
    </div> : null}
    {preview.suggestedCodes.length && level > 1 ? <p className="text-xs text-muted-foreground">Föreslagna typer: {preview.suggestedCodes.map((item) => `${item.code} → ${CODE_TARGET_LABELS[item.type]}`).join(", ")}. De sparas vid import.</p> : null}

    {error ? <p role="alert" className={cn("rounded-lg border p-3 text-sm", indicatorBadge("danger"))}>{error}</p> : null}
    {shown.length ? <div className="max-h-96 overflow-auto rounded-lg border">
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <thead><tr className="bg-[var(--panel-header)] text-left text-xs"><th className="border-b px-3 py-2 font-semibold">Rad</th><th className="border-b px-3 py-2 font-semibold">Person</th><th className="border-b px-3 py-2 font-semibold">Frånvaro</th><th className="border-b px-3 py-2 font-semibold">Läge</th></tr></thead>
        <tbody>{shown.map((row) => <tr key={`${row.index}-${row.key}`} className="border-b last:border-b-0" data-testid="absence-import-row">
          <td className="px-3 py-1.5 align-top text-xs text-muted-foreground">{row.index + 2}</td>
          <td className="px-3 py-1.5 align-top"><span className="font-medium">{row.personName || "–"}</span>{row.employeeNumber ? <span className="block text-[11px] text-muted-foreground">Nr {row.employeeNumber}</span> : null}</td>
          <td className="px-3 py-1.5 align-top text-xs">{row.typeLabel || row.code}{row.from ? <span className="block text-muted-foreground">{range(row)}{row.statusLabel && row.statusLabel !== "Godkänd" ? ` · ${row.statusLabel}` : ""}</span> : null}</td>
          <td className="px-3 py-1.5 align-top text-xs">
            <span className={cn("rounded-full px-2 py-0.5", indicatorBadge(ACTION_TONE[row.action]))}>{ACTION_LABEL[row.action]}</span>
            {row.conflict ? <span className="mt-1 block">Krockar med {row.conflict.label}.
              {!result ? <span className="mt-1 flex flex-wrap gap-1">{(["keep", "replace"] as const).map((choice) => <button key={choice} type="button" aria-pressed={(choices[row.key] ?? "keep") === choice}
                className={cn("rounded-md border px-1.5 py-0.5", (choices[row.key] ?? "keep") === choice && "bg-secondary font-medium")} onClick={() => setChoices({ ...choices, [row.key]: choice })} data-testid={`absence-conflict-${choice}`}>
                {choice === "keep" ? "Behåll befintlig" : "Ersätt med filens"}</button>)}</span> : null}</span> : null}
            {row.issues.map((issue) => <span key={issue} className="block text-amber-700 dark:text-amber-400">{issue}</span>)}
          </td>
        </tr>)}</tbody>
      </table>
    </div> : <p className="text-sm text-muted-foreground">{level === 1 ? "Inga krockar eller fel." : "Inga rader i filen."}</p>}
    {preview.rows.length > shown.length ? <p className="text-xs text-muted-foreground">{plural(preview.rows.length - shown.length, "rad", "rader")} utan anmärkning visas på visning 2 och 3.</p> : null}

    {result ? <p role="status" className={cn("flex items-start gap-2 rounded-lg border p-3 text-sm", indicatorBadge(result.status === "ok" ? "success" : "warning"))} data-testid="absence-import-result">
      {result.status === "ok" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
      {result.counts.created} nya, {result.counts.changed} ändrade, {result.counts.unchanged} oförändrade{result.counts.replaced ? `, ${result.counts.replaced} ersatte annan frånvaro` : ""}{result.counts.errors ? `, ${result.counts.errors} med fel` : ""}. Planeringen räknar med den godkända frånvaron.
    </p> : <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground">Bara godkänd frånvaro påverkar planeringen. Inget tas bort för att det saknas i filen.</p>
      <Button type="button" disabled={busy || !toWrite} onClick={() => void apply()} data-testid="absence-import-apply">{busy ? <LoaderCircle className="animate-spin" /> : <Upload />}Importera {toWrite}</Button>
    </div>}
  </div>;
}

type NumbersAnswer = { allowed: false; message: string } | { allowed: true; rows: { index: number; personName: string; email: string; employeeNumber: string; previous: string | null; action: "new" | "changed" | "unchanged" | "error"; issues: string[] }[] };

/** Anställningsnummer till medarbetare: matched by e-mail; a number another member has is shown, never moved silently. */
export function EmployeeNumbersCard({ file, mapping, answer }: { file: ExtractedFile; mapping: Record<string, string | null>; answer: NumbersAnswer }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ saved: number; errors: number } | null>(null);
  if (!answer.allowed) return <p className="rounded-lg border p-3 text-sm text-muted-foreground">{answer.message}</p>;
  const toWrite = answer.rows.filter((row) => row.action === "new" || row.action === "changed").length;
  async function apply() {
    setBusy(true); setError("");
    try { setDone(await api("/api/import", { method: "POST", body: JSON.stringify({ action: "employee_numbers_apply", file: fileBody(file), mapping }) })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Importen misslyckades."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3" data-testid="employee-numbers-import">
    <ul className="divide-y rounded-lg border text-sm">
      {answer.rows.slice(0, 200).map((row) => <li key={row.index} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
        <span className="min-w-0"><span className="font-medium">{row.personName || row.email || `Rad ${row.index + 2}`}</span> <span className="text-xs text-muted-foreground">{row.employeeNumber}{row.previous && row.previous !== row.employeeNumber ? ` (var ${row.previous})` : ""}</span></span>
        <span className="text-xs">{row.action === "error" ? <span className="text-destructive">{row.issues.join("; ")}</span> : row.action === "unchanged" ? "Oförändrad" : row.action === "changed" ? "Ändras" : "Ny"}</span>
      </li>)}
    </ul>
    {error ? <p role="alert" className={cn("rounded-lg border p-3 text-sm", indicatorBadge("danger"))}>{error}</p> : null}
    {done ? <p role="status" className={cn("rounded-lg border p-3 text-sm", indicatorBadge(done.errors ? "warning" : "success"))}>{done.saved} anställningsnummer sparade{done.errors ? `, ${done.errors} rader med fel` : ""}.</p>
      : <div className="flex justify-end"><Button type="button" disabled={busy || !toWrite} onClick={() => void apply()} data-testid="employee-numbers-apply">{busy ? <LoaderCircle className="animate-spin" /> : <Upload />}Spara {toWrite}</Button></div>}
  </div>;
}
