"use client";
import { useCallback, useRef, useState } from "react";
import { FileJson, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { DialogPage } from "@/features/kfid/dialog-page";
import { DialogActions, Empty, Panel, RowsSkeleton } from "@/features/kfid/ui";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { formatSwedish } from "@/lib/swedish-time";
import { useLoadEffect } from "@/lib/use-load-effect";
import { RemoveButton } from "@/components/ui/remove-button";
import { saveBlob } from "@/lib/download";
import { DownloadButton } from "@/components/ui/download-button";

/**
 * Integrationsmotorn E4 (2026-10-24, beslut 3): format profiles – how a device's own JSON is read by
 * /api/ingest/v1/raw – as data the admin writes, tries on a real sample ("så här tolkas provet"), exports and imports. And a
 * source's caught samples ("Fånga prov", 24 hours, at most 20). The profile is JSON in a closed form; the page checks it on
 * the server and says what is wrong, never runs anything. Pages of their own (DialogPage), nothing over a page.
 */
export type ProfileRow = { id: string; name: string; version: number; definition: unknown; updatedAt: string; sources: number; valid: boolean; idempotency: string };
type ProfileList = { profiles: ProfileRow[]; example: { name: string; definition: unknown }; limit: number };
type Preview = { records: number; readings: { key: string; kind: string; value: unknown; at: string }[]; rejectedRecords: { index: number; reason: string }[]; rejectedReadings: { record: number; path: string; reason: string }[]; overLimit: number; idempotency: string };

const REASON: Record<string, string> = { not_an_object: "posten är inget objekt", bad_time: "tiden går inte att läsa", time_window: "tiden ligger utanför −7 dygn/+5 minuter", bad_id: "id saknas eller är fel", missing: "värdet saknas", bad_value: "värdet går inte att tolka" };
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const when = (value: string) => formatSwedish(value, { dateStyle: "short", timeStyle: "medium" });

export function useProfiles() {
  const [data, setData] = useState<ProfileList | null>(null);
  const load = useCallback(async () => { try { setData(await api<ProfileList>("/api/machine-sources?profiles=1", { cache: "no-store" })); } catch { setData({ profiles: [], example: { name: "", definition: {} }, limit: 50 }); } }, []);
  useLoadEffect(load);
  return { data, reload: load };
}

export function MachineProfilesSection({ data, reload, notify }: { data: ProfileList | null; reload: () => Promise<void>; notify: (text: string, error?: boolean) => void }) {
  const [editing, setEditing] = useState<{ id?: string; name: string; definition: string } | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const file = useRef<HTMLInputElement>(null);
  const post = (payload: Record<string, unknown>) => api<Record<string, unknown>>("/api/machine-sources", { method: "POST", body: JSON.stringify(payload) });
  const remove = async (profile: ProfileRow) => {
    if (!(await confirm({ title: "Ta bort profilen?", message: `”${profile.name}” tas bort. Det går inte att ångra.`, confirmLabel: "Ta bort", tone: "danger" }))) return;
    try { await post({ action: "delete_profile", id: profile.id }); notify("Profilen är borttagen."); await reload(); } catch (cause) { notify((cause as Error).message, true); }
  };
  const exportFile = async (profile: ProfileRow) => {
    try {
      const content = await api<unknown>(`/api/machine-sources?profileId=${encodeURIComponent(profile.id)}&export=1`, { cache: "no-store" });
      saveBlob(pretty(content), `${profile.name.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "formatprofil"}.json`, "application/json");
    } catch (cause) { notify((cause as Error).message, true); }
  };
  const importFile = async (picked: File | undefined) => {
    if (!picked) return;
    try {
      if (picked.size > 64 * 1024) throw new Error("Filen är för stor (högst 64 kB).");
      let parsed: unknown;
      try { parsed = JSON.parse(await picked.text()); } catch { throw new Error("Filen är inte giltig JSON."); }
      await post({ action: "import_profile", file: parsed });
      notify("Profilen är importerad.");
      await reload();
    } catch (cause) { notify((cause as Error).message, true); } finally { if (file.current) file.current.value = ""; }
  };
  // Ett eget kort (2026-11-12) under källornas kort, its buttons at the top right like the Maskiner card's.
  return <div data-testid="machine-profiles"><Panel icon={FileJson} title="Formatprofiler" description="Profilen talar om hur Workflow läser den JSON som en enhet skickar. Gör en profil för varje sorts enhet."
    actions={<>
      <Button type="button" variant="outline" size="sm" onClick={() => file.current?.click()} data-testid="machine-profile-import"><Upload />Importera</Button>
      <input ref={file} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => void importFile(event.target.files?.[0])} data-testid="machine-profile-file" />
      <Button type="button" size="sm" disabled={!data} onClick={() => data && setEditing({ name: data.example.name, definition: pretty(data.example.definition) })} data-testid="machine-profile-new"><Plus />Ny profil</Button>
    </>}>
    {confirmElement}
    {!data ? <RowsSkeleton rows={1} dense label="Hämtar profilerna…" />
      : !data.profiles.length ? <Empty compact title="Inga profiler ännu" description="En ny profil börjar med Workflows exempel." />
      : <ul className="divide-y rounded-lg border">{data.profiles.map((profile) => <li key={profile.id} className="grid gap-2 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" data-testid="machine-profile">
        <div className="min-w-0 [overflow-wrap:anywhere]">
          <p className="flex flex-wrap items-center gap-2"><FileJson className="size-4 text-muted-foreground" aria-hidden="true" /><span className="font-medium">{profile.name}</span>
            {profile.valid ? null : <Badge variant="outline" className={indicatorBadge("danger")}>Inte giltig</Badge>}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Version {profile.version} · {profile.sources} {profile.sources === 1 ? "källa" : "källor"}{profile.idempotency ? ` · ${profile.idempotency}` : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing({ id: profile.id, name: profile.name, definition: pretty(profile.definition) })} data-testid="machine-profile-edit"><Pencil />Ändra</Button>
          <DownloadButton size="sm" onClick={() => void exportFile(profile)} data-testid="machine-profile-export">Exportera</DownloadButton>
          <RemoveButton label={`Ta bort ${profile.name}`} title="Ta bort" onClick={() => void remove(profile)} data-testid="machine-profile-remove" />
        </div>
      </li>)}</ul>}
    {editing ? <ProfileEditor initial={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); notify("Profilen är sparad."); await reload(); }} /> : null}
  </Panel></div>;
}

function ProfileEditor({ initial, onClose, onSaved }: { initial: { id?: string; name: string; definition: string }; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(initial.name);
  const [definition, setDefinition] = useState(initial.definition);
  const [sample, setSample] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = () => { try { return JSON.parse(definition) as unknown; } catch { throw new Error("Profilen är inte giltig JSON."); } };
  const run = async (action: "preview_profile" | "save_profile") => {
    setBusy(true); setError("");
    try {
      if (action === "preview_profile") setPreview(await api<Preview>("/api/machine-sources", { method: "POST", body: JSON.stringify({ action, definition: parsed(), sample }) }));
      else { await api("/api/machine-sources", { method: "POST", body: JSON.stringify({ action, id: initial.id, name, definition: parsed() }) }); await onSaved(); }
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  };
  const label = "field-label text-xs font-medium";
  return <DialogPage pageKey="formatprofil" size="page" open onOpenChange={(next) => { if (!next) onClose(); }} title={initial.id ? "Ändra formatprofil" : "Ny formatprofil"} panelTitle="Formatprofil"
    description="Sökvägar till poster, tid, id och värden. Tidsformat: iso, unix_s, unix_ms eller received. Inga uttryck.">
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void run("save_profile"); }} data-testid="machine-profile-editor">
      <div className="grid gap-1.5"><label htmlFor="profile-name" className={label}>Namn</label>
        <Input id="profile-name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} data-testid="machine-profile-name" /></div>
      <div className="grid gap-1.5"><label htmlFor="profile-definition" className={label}>Profil (JSON)</label>
        <textarea id="profile-definition" className="form-textarea min-h-64 font-mono text-xs" spellCheck={false} value={definition} onChange={(event) => setDefinition(event.target.value)} data-testid="machine-profile-definition" /></div>
      <div className="grid gap-1.5"><label htmlFor="profile-sample" className={label}>Prov att pröva mot (klistra in en kropp, till exempel från Fånga prov)</label>
        <textarea id="profile-sample" className="form-textarea min-h-32 font-mono text-xs" spellCheck={false} value={sample} onChange={(event) => setSample(event.target.value)} data-testid="machine-profile-sample" />
        <div><Button type="button" variant="outline" size="sm" disabled={busy || !sample.trim()} onClick={() => void run("preview_profile")} data-testid="machine-profile-preview">Så här tolkas provet</Button></div></div>
      {error ? <p role="alert" className="notice text-destructive" data-testid="machine-profile-error">{error}</p> : null}
      {preview ? <section className="rounded-lg border p-3 text-sm" aria-label="Så här tolkas provet" data-testid="machine-profile-result">
        <p className="font-medium">{preview.records} {preview.records === 1 ? "post" : "poster"} · {preview.readings.length} värden</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{preview.idempotency}</p>
        {preview.readings.length ? <ul className="mt-2 divide-y text-xs">{preview.readings.slice(0, 50).map((reading, index) => <li key={`${reading.key}-${index}`} className="grid gap-1 py-1 sm:grid-cols-[minmax(0,1fr)_8rem_10rem]" data-testid="machine-profile-reading">
          <span className="font-mono [overflow-wrap:anywhere]">{reading.key}</span><span className="[overflow-wrap:anywhere]">{String(reading.value)}</span><span className="tabular-nums text-muted-foreground">{when(reading.at)}</span>
        </li>)}</ul> : null}
        {preview.rejectedRecords.length || preview.rejectedReadings.length ? <ul className="mt-2 space-y-0.5 text-xs text-danger" data-testid="machine-profile-rejected">
          {preview.rejectedRecords.map((item) => <li key={`r${item.index}`}>Post {item.index + 1}: {REASON[item.reason] ?? item.reason}</li>)}
          {preview.rejectedReadings.slice(0, 20).map((item, index) => <li key={`v${index}`}>Post {item.record + 1}, {item.path}: {REASON[item.reason] ?? item.reason}</li>)}
        </ul> : null}
        {preview.overLimit ? <p className="mt-1 text-xs text-danger">{preview.overLimit} värden över gränsen (200 per anrop) ignorerades.</p> : null}
      </section> : null}
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Spara profilen", type: "submit", disabled: busy, disabledReason: !name.trim() ? "Skriv ett namn först." : null, testId: "machine-profile-save" }} />
    </form>
  </DialogPage>;
}

type Sample = { id: string; receivedAt: string; body: string };
/** Fånga prov: the bodies the source sent while it was on (24 hours, at most 20), to write a profile from. */
export function MachineSamplesPage({ source, onClose, notify }: { source: { id: string; name: string }; onClose: () => void; notify: (text: string, error?: boolean) => void }) {
  const [data, setData] = useState<{ captureUntil: string | null; samples: Sample[] } | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => { try { setData(await api(`/api/machine-sources?sourceId=${encodeURIComponent(source.id)}&samples=1`, { cache: "no-store" })); setError(""); } catch (cause) { setError((cause as Error).message); } }, [source.id]);
  useLoadEffect(load);
  const clear = async () => {
    try { await api("/api/machine-sources", { method: "POST", body: JSON.stringify({ action: "delete_samples", id: source.id }) }); notify("Proven är borttagna."); await load(); } catch (cause) { notify((cause as Error).message, true); }
  };
  return <DialogPage pageKey="prov" size="page" open onOpenChange={(next) => { if (!next) onClose(); }} title={`Prov – ${source.name}`} panelTitle="Fångade prov"
    description="Meddelandena som källan skickade medan Fånga prov var på. De raderas efter 24 timmar och skickas aldrig till AI.">
    <div className="space-y-3" data-testid="machine-samples">
      {error ? <p role="alert" className="notice text-destructive">{error}</p> : !data ? <RowsSkeleton rows={2} dense label="Hämtar proven…" />
        : <>
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{data.captureUntil ? `Fånga prov är på till ${when(data.captureUntil)}.` : "Fånga prov är av."} {data.samples.length} av högst 20.</p>
            {data.samples.length ? <Button type="button" variant="outline" size="sm" onClick={() => void clear()} data-testid="machine-samples-clear"><Trash2 />Ta bort proven</Button> : null}</div>
          {!data.samples.length ? <Empty title="Inga prov ännu" description="Slå på Fånga prov och låt enheten skicka till rådata-intaget." />
            : <ul className="space-y-3">{data.samples.map((sample) => <li key={sample.id} className="rounded-lg border p-3" data-testid="machine-sample">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs tabular-nums text-muted-foreground">{when(sample.receivedAt)}</span>
                <CopyButton variant="ghost" size="sm" className="-my-1 text-primary touch:h-11" value={sample.body} onCopied={() => notify("Provet är kopierat.")} onFailed={() => notify("Markera och kopiera provet själv.", true)} /></div>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs [overflow-wrap:anywhere]">{sample.body}</pre>
            </li>)}</ul>}
        </>}
    </div>
  </DialogPage>;
}
