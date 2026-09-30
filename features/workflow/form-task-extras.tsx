"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Gauge, Pencil, Save, TrendingUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { Panel } from "@/features/kfid/ui";
import { cn } from "@/lib/utils";
import { formatSwedish } from "@/lib/swedish-time";
import { formLimitText, type FormDocument, type FormValues } from "@/lib/workflow/form-document";
import { formLimitObject, resolveFormLimits, sameLimits, type FormLimitProfile, type FormLimitProfileInput, type LimitProfileValue } from "@/lib/workflow/form-limits";
import { formTrendKeys, formTrendSeries, formTrendValue, type FormTrendSeries } from "@/lib/workflow/form-trend";

/** Local keeps its limit profiles in the file; the editor gets them and a save function (Cloud uses /api/form-limits). */
export type LocalLimits = { profiles: FormLimitProfile[]; save: (input: FormLimitProfileInput) => Promise<void> };

const ORIGIN_LABEL = { form: "Formuläret", facility: "Anläggningen", object: "Objektet" } as const;
const numberText = (value: number | null) => value === null ? "" : String(value).replace(".", ",");
const parseNumber = (text: string) => { const trimmed = text.trim().replace(",", "."); return trimmed === "" || !Number.isFinite(Number(trimmed)) ? null : Number(trimmed); };

/**
 * Gränsvärden (2026-09-28): the limits the protocol is judged by – the facility's (or the object's) own values where the
 * company has set them, else the form's – with where each value comes from. A protocol that is not completed follows
 * the current profile and keeps a snapshot of it; the company's administrator changes the values for the facility here.
 */
export function FormLimitsPanel({ document, values, onValues, templateId, facilityId, facilityName, readOnly, local }: {
  document: FormDocument; values: FormValues; onValues: (values: FormValues) => void; templateId: string; facilityId: string | null; facilityName: string; readOnly: boolean; local?: LocalLimits;
}) {
  const [remote, setRemote] = useState<{ family: string; canEdit: boolean; profiles: FormLimitProfile[] } | null>(null);
  const [editing, setEditing] = useState<Record<string, Record<keyof Omit<LimitProfileValue, "source">, string> & { source: string }> | null>(null);
  const [perObject, setPerObject] = useState(false);
  const [message, setMessage] = useState("");
  const object = formLimitObject(document, values);
  const load = useCallback(async () => {
    if (local || !document.limits.length) return;
    try { setRemote(await api<{ family: string; canEdit: boolean; profiles: FormLimitProfile[] }>(`/api/form-limits?${new URLSearchParams({ templateId, ...(facilityId ? { facilityId } : {}) })}`)); }
    catch (issue) { setMessage((issue as Error).message); }
  }, [local, document.limits.length, templateId, facilityId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Read the profiles again when the facility or form changes.
  useEffect(() => { void load(); }, [load]);
  const profiles = useMemo(() => (local ? local.profiles.filter((profile) => profile.templateId === templateId) : remote?.profiles ?? []).filter((profile) => profile.facilityId === facilityId), [local, remote, templateId, facilityId]);
  const loaded = Boolean(local || remote);
  const resolved = useMemo(() => resolveFormLimits(document, profiles, facilityId, object), [document, profiles, facilityId, object]);
  // A protocol that is not completed follows the profile; a completed one keeps the limits it was judged by.
  useEffect(() => {
    if (!loaded || readOnly || !document.limits.length || sameLimits(values.limits, resolved)) return;
    onValues({ ...values, limits: resolved });
  }, [loaded, readOnly, resolved]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!document.limits.length) return null;
  const canEdit = !readOnly && Boolean(facilityId) && (local ? true : Boolean(remote?.canEdit));
  const current = (key: string) => values.limits[key] ?? resolved[key];
  const startEditing = () => {
    const objectProfile = object ? profiles.find((profile) => profile.objectName.toLowerCase() === object.toLowerCase()) : undefined;
    setPerObject(Boolean(objectProfile));
    setEditing(Object.fromEntries(document.limits.map((limit) => {
      const value = current(limit.key);
      return [limit.key, { low: numberText(value?.low ?? null), high: numberText(value?.high ?? null), warnLow: numberText(value?.warnLow ?? null), warnHigh: numberText(value?.warnHigh ?? null), source: value?.source ?? limit.source }];
    })));
  };
  const save = async () => {
    if (!editing || !facilityId) return;
    const objectName = perObject ? object : "";
    const existing = profiles.find((profile) => profile.objectName.toLowerCase() === objectName.toLowerCase());
    const input: FormLimitProfileInput = { templateId: remote?.family ?? templateId, facilityId, objectName, version: existing?.version,
      values: Object.fromEntries(Object.entries(editing).map(([key, value]) => [key, { low: parseNumber(value.low), high: parseNumber(value.high), warnLow: parseNumber(value.warnLow), warnHigh: parseNumber(value.warnHigh), source: value.source.trim() }])) };
    try {
      if (local) await local.save(input);
      else { await api("/api/form-limits", { method: "POST", body: JSON.stringify(input) }); await load(); }
      setEditing(null);
      setMessage(`Gränsvärdena för ${facilityName || "anläggningen"}${objectName ? ` · ${objectName}` : ""} är sparade.`);
    } catch (issue) { setMessage((issue as Error).message); }
  };
  const cell = (key: string, field: "low" | "warnLow" | "warnHigh" | "high", label: string) => editing
    ? <Input className="h-9 w-20" inputMode="decimal" aria-label={`${label}: ${document.limits.find((limit) => limit.key === key)?.label}`} value={editing[key][field]} onChange={(event) => setEditing({ ...editing, [key]: { ...editing[key], [field]: event.target.value } })} />
    : <span className="tabular-nums">{numberText(current(key)?.[field] ?? null) || "–"}</span>;
  return <Panel title="Gränsvärden" collapsible defaultCollapsed={!document.limits.some((limit) => current(limit.key)?.high !== null || current(limit.key)?.low !== null)}
    description={facilityId ? `Gäller ${facilityName || "anläggningen"}${object ? ` · ${object}` : ""}. Värdena hämtas från anläggningens tillstånd och tillverkarens anvisningar – inte från formuläret.` : "Koppla protokollet till en anläggning för att använda anläggningens egna gränsvärden."}
    leadingActions={<span className="panel-icon" aria-hidden="true"><Gauge className="size-4" /></span>}
    actions={canEdit && !editing ? <Button type="button" size="sm" variant="outline" onClick={startEditing} data-testid="form-limits-edit"><Pencil />Ändra för anläggningen</Button> : undefined}>
    <div className="overflow-x-auto rounded-lg border" data-testid="form-limits">
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <thead><tr className="bg-[var(--panel-header)] text-left text-xs"><th className="px-3 py-2 font-semibold">Storhet</th><th className="px-2 py-2 font-semibold">Larm lägst</th><th className="px-2 py-2 font-semibold">Varning lägst</th><th className="px-2 py-2 font-semibold">Varning högst</th><th className="px-2 py-2 font-semibold">Larm högst</th><th className="px-3 py-2 font-semibold">Källa</th><th className="px-3 py-2 font-semibold">Gäller från</th></tr></thead>
        <tbody>{document.limits.map((limit) => <tr key={limit.key} className="border-t align-middle">
          <th scope="row" className="px-3 py-1.5 text-left font-medium">{limit.label}{limit.unit ? <span className="font-normal text-muted-foreground"> ({limit.unit})</span> : null}</th>
          <td className="px-2 py-1.5">{cell(limit.key, "low", "Larm lägst")}</td><td className="px-2 py-1.5">{cell(limit.key, "warnLow", "Varning lägst")}</td>
          <td className="px-2 py-1.5">{cell(limit.key, "warnHigh", "Varning högst")}</td><td className="px-2 py-1.5">{cell(limit.key, "high", "Larm högst")}</td>
          <td className="px-3 py-1.5 text-xs text-muted-foreground">{editing ? <Input className="h-9 min-w-40" aria-label={`Källa: ${limit.label}`} value={editing[limit.key].source} onChange={(event) => setEditing({ ...editing, [limit.key]: { ...editing[limit.key], source: event.target.value } })} /> : current(limit.key)?.source || limit.source || "–"}</td>
          <td className="px-3 py-1.5 text-xs">{ORIGIN_LABEL[current(limit.key)?.origin ?? "form"]}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {editing ? <div className="mt-3 flex flex-wrap items-center gap-2">
      {object && document.limitObjectKey ? <label className="mr-auto inline-flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={perObject} onChange={(event) => setPerObject(event.target.checked)} />Bara för {object}</label> : <span className="mr-auto text-xs text-muted-foreground">Tomma rutor betyder att formulärets värde gäller.</span>}
      <Button type="button" variant="ghost" onClick={() => setEditing(null)}><X />Avbryt</Button>
      <Button type="button" onClick={() => void save()}><Save />Spara gränsvärden</Button>
    </div> : null}
    {message ? <p role="status" className="mt-2 text-xs text-muted-foreground">{message}</p> : null}
  </Panel>;
}

/**
 * Trender (2026-09-28): each number marked for trend over the earlier protocols of the same form at the same facility
 * (or customer), with this protocol's value last and the limits drawn as labelled reference lines. One small chart per
 * measure – never two scales in one chart – each with a tooltip and a table of the values.
 */
export function FormTrendPanel({ document, values, templateId, templateVersion, taskId, facilityId, customerId, local }: {
  document: FormDocument; values: FormValues; templateId: string; templateVersion: number; taskId: string; facilityId: string | null; customerId: string | null;
  local?: { id: string; kind: string; status: string; facilityId?: string | null; customerId: string | null; updatedAt?: string; data: unknown }[];
}) {
  const keys = useMemo(() => formTrendKeys(document), [document]);
  const [remote, setRemote] = useState<FormTrendSeries[]>([]);
  const [table, setTable] = useState(false);
  // The charts are drawn first when the folded panel has a size: Recharts warns about a 0 × 0 chart otherwise (F12).
  const [chartArea, setChartArea] = useState<HTMLDivElement | null>(null);
  const [sized, setSized] = useState(false);
  useEffect(() => {
    if (!chartArea || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setSized(entry.contentRect.width > 0));
    observer.observe(chartArea);
    return () => observer.disconnect();
  }, [chartArea]);
  useEffect(() => {
    if (local || !keys.length || (!facilityId && !customerId)) return;
    let active = true;
    const params = new URLSearchParams({ formTrend: templateId, version: String(templateVersion), ...(facilityId ? { facilityId } : { customerId: customerId! }), ...(taskId ? { exclude: taskId } : {}) });
    api<{ series: FormTrendSeries[] }>(`/api/workflow-tasks?${params}`).then((result) => { if (active) setRemote(result.series); }).catch(() => { if (active) setRemote([]); });
    return () => { active = false; };
  }, [local, keys.length, templateId, templateVersion, taskId, facilityId, customerId]);
  const history = useMemo(() => local ? formTrendSeries(document, values, local.filter((task) => task.kind === "FORM" && task.id !== taskId
    && (task.data as { details?: { templateId?: string } }).details?.templateId === templateId && (facilityId ? task.facilityId === facilityId : customerId ? task.customerId === customerId : false))) : remote,
  [local, remote, document, values, taskId, templateId, facilityId, customerId]);
  if (!keys.length || (!facilityId && !customerId)) return null;
  const series = keys.map((key) => {
    const past = history.find((item) => item.key === key.key);
    const now = formTrendValue(document, values, key.key);
    const limit = values.limits[key.limitKey] ?? past?.limit ?? null;
    return { ...key, limit, points: [...(past?.points ?? []).map((point) => ({ label: formatSwedish(point.date.length > 10 ? point.date : `${point.date}T12:00:00`, { dateStyle: "short" }), value: point.value })), ...(now === null ? [] : [{ label: "Nu", value: now }])] };
  });
  const count = Math.max(0, ...history.map((item) => item.points.length));
  return <Panel title="Trender" collapsible defaultCollapsed description={`${count ? `De senaste ${count} protokollen` : "Inga tidigare protokoll ännu"} för ${facilityId ? "anläggningen" : "kunden"} och det här protokollets värden. Gränserna visas som streckade linjer.`}
    leadingActions={<span className="panel-icon" aria-hidden="true"><TrendingUp className="size-4" /></span>}
    actions={<Button type="button" size="sm" variant="ghost" aria-pressed={table} onClick={() => setTable((value) => !value)}>{table ? "Visa diagram" : "Visa tabell"}</Button>}>
    <div ref={setChartArea} className="grid gap-4 @container md:grid-cols-2" data-testid="form-trends">{series.map((item) => <figure key={item.key} className="min-w-0 rounded-lg border p-3">
      <figcaption className="flex items-baseline justify-between gap-2 text-sm font-medium"><span className="truncate">{item.label}</span><span className="text-xs font-normal text-muted-foreground">{item.unit}</span></figcaption>
      {!item.points.length ? <p className="py-6 text-center text-xs text-muted-foreground">Inga värden ännu.</p> : table
        ? <table className="mt-2 w-full text-xs tabular-nums"><tbody>{item.points.map((point, index) => <tr key={index} className="border-t"><td className="py-1 text-muted-foreground">{point.label}</td><td className="py-1 text-right">{numberText(point.value)} {item.unit}</td></tr>)}</tbody></table>
        : <div className="mt-2 h-40 min-w-0">
          {sized ? <ResponsiveContainer width="100%" height="100%">
            <LineChart data={item.points} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} minTickGap={24} stroke="var(--border)" />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} stroke="var(--border)" domain={["auto", "auto"]} width={52} />
              <Tooltip contentStyle={{ background: "var(--card)", color: "var(--foreground)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(value) => [`${numberText(Number(value))} ${item.unit}`.trim(), item.label]} />
              {item.limit?.high !== null && item.limit?.high !== undefined ? <ReferenceLine y={item.limit.high} stroke="#dc2626" strokeDasharray="5 4" label={{ value: "Larm", position: "insideTopRight", fontSize: 10, fill: "var(--muted-foreground)" }} /> : null}
              {item.limit?.low !== null && item.limit?.low !== undefined ? <ReferenceLine y={item.limit.low} stroke="#dc2626" strokeDasharray="5 4" label={{ value: "Larm", position: "insideBottomRight", fontSize: 10, fill: "var(--muted-foreground)" }} /> : null}
              {item.limit?.warnHigh !== null && item.limit?.warnHigh !== undefined ? <ReferenceLine y={item.limit.warnHigh} stroke="#d97706" strokeDasharray="3 4" label={{ value: "Varning", position: "insideTopRight", fontSize: 10, fill: "var(--muted-foreground)" }} /> : null}
              {item.limit?.warnLow !== null && item.limit?.warnLow !== undefined ? <ReferenceLine y={item.limit.warnLow} stroke="#d97706" strokeDasharray="3 4" label={{ value: "Varning", position: "insideBottomRight", fontSize: 10, fill: "var(--muted-foreground)" }} /> : null}
              <Line type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: "var(--card)" }} activeDot={{ r: 5 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer> : null}
        </div>}
      {item.limit ? <p className={cn("mt-1 text-[11px] text-muted-foreground")}>Larm {formLimitText(item.limit.low, item.limit.high, item.unit)} · varning {formLimitText(item.limit.warnLow, item.limit.warnHigh, item.unit)}</p> : null}
      {item.points.length >= 2 ? <p className="text-[11px] text-muted-foreground">Senast {numberText(item.points.at(-1)!.value)} {item.unit} ({item.points.at(-1)!.value >= item.points.at(-2)!.value ? "+" : "−"}{numberText(Math.abs(Math.round((item.points.at(-1)!.value - item.points.at(-2)!.value) * 100) / 100))} mot föregående)</p> : null}
    </figure>)}</div>
  </Panel>;
}
