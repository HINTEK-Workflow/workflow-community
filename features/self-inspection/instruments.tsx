"use client";

import { AreaIcon } from "@/components/area-icon";
import { useCallback, useState } from "react";
import Link from "next/link";
import { ClipboardList, Gauge, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { ListEmpty, ListGroup, ListRow, NativeLargeTitle, NativePage, useNativeScreen, useNativeTopBar } from "@/components/native";
import { withScreen } from "@/lib/workflow/native-mode";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogActions, Empty, Field } from "@/features/kfid/ui";
import { DialogPage } from "@/features/kfid/dialog-page";
import { DISCARD_QUESTION, useConfirm } from "@/features/kfid/confirm";
import { useLeavePage } from "@/components/history-nav";
import { leaveWithoutAsking } from "@/lib/workflow/leave-guard";
import { useUnsavedGuard } from "@/lib/workflow/use-unsaved-guard";
import { api } from "@/features/kfid/api";
import { announce } from "@/lib/workflow/toast";
import { cn } from "@/lib/utils";
import type { DueState, InstrumentProtocolsView, InstrumentView, InstrumentsView, SelfInspectionAction, SelfInspectionView } from "@/lib/self-inspection/model";
import { StateBadge } from "./registers";
import { siDate } from "./shared";
import { INSTRUMENT_ORDER_MESSAGE } from "@/lib/self-inspection/model";
import type { SelfInspectionBackend } from "./self-inspection-page";
import { useLoadEffect } from "@/lib/use-load-effect";
import { PageHeader } from "@/components/page-shell";
import { IconButton } from "@/components/ui/icon-button";
import { RemoveButton } from "@/components/ui/remove-button";

/**
 * Instrument (2026-10-07): the company's measuring instruments with calibration, a page of its own under Kvalitet
 * (it was a tab in Egenkontroll). Everyone reads the register, to choose an instrument in a protocol; the company's admins
 * keep it. Cloud reads one lean query and writes through /api/self-inspection (the same actions as before, so the same
 * rules and the same permission); Local and the demo answer from the programme's document. Only drawing here.
 */
export type InstrumentsBackend = {
  load: () => Promise<InstrumentsView>;
  act: (input: SelfInspectionAction) => Promise<InstrumentsView>;
  /** Protokoll med detta instrument (plan 1L, 2026-10-11): Cloud asks the server; Local and the demo have no list. */
  protocols?: (id: string) => Promise<InstrumentProtocolsView>;
};
const part = (view: Pick<SelfInspectionView, "canEdit" | "instruments">): InstrumentsView => ({ canEdit: view.canEdit, instruments: view.instruments });

/** Local and the demo: the register is read from, and changed in, the same document as the programme. */
export const instrumentsBackendFrom = (backend: SelfInspectionBackend): InstrumentsBackend => ({
  load: async () => part(await backend.load()),
  act: async (input) => part(await backend.act(input)),
});
export const cloudInstrumentsBackend = (): InstrumentsBackend => ({
  load: () => api<InstrumentsView>("/api/self-inspection?part=instruments", { cache: "no-store" }),
  act: async (input) => part(await api<SelfInspectionView>("/api/self-inspection", { method: "POST", body: JSON.stringify(input) })),
  protocols: (id) => api<InstrumentProtocolsView>(`/api/self-inspection?part=instrument-protocols&id=${encodeURIComponent(id)}`, { cache: "no-store" }),
});

const PROTOCOL_STATUS: Record<string, string> = { PLANNED: "Planerad", IN_PROGRESS: "Pågår", PAUSED: "Pausad", NEEDS_ACTION: "Behöver åtgärdas", COMPLETED: "Färdigställd", CANCELLED: "Utgått" };

/**
 * Protokoll med detta instrument (2026-10-11, plan 1L): a fold under the instrument that asks the server for the
 * protocols that chose it from the register (by the stored id; an older protocol without the id is not listed). Only
 * drawn for someone who may read protocols; the server checks the same.
 */
function InstrumentProtocols({ id, load, native = false }: { id: string; load: (id: string) => Promise<InstrumentProtocolsView>; native?: boolean }) {
  const [state, setState] = useState<{ open: boolean; busy: boolean; list: InstrumentProtocolsView["protocols"] | null; error: string }>({ open: false, busy: false, list: null, error: "" });
  // Innehåll först när det är klart (2026-10-24): the list is read first and the fold opens in one sweep with it;
  // meanwhile the button says it is busy. A second click while busy takes the wish back.
  const toggle = async () => {
    if (state.open || state.busy) { setState((current) => ({ ...current, open: false, busy: false })); return; }
    if (state.list !== null) { setState((current) => ({ ...current, open: true, error: "" })); return; }
    setState((current) => ({ ...current, busy: true, error: "" }));
    try { const result = await load(id); setState((current) => current.busy ? { ...current, busy: false, open: true, list: result.protocols } : { ...current, list: result.protocols }); }
    catch (cause) { setState((current) => current.busy ? { ...current, busy: false, open: true, error: (cause as Error).message } : current); }
  };
  const href = (taskId: string) => `/?view=workflow_task&taskId=${encodeURIComponent(taskId)}&taskType=FORM`;
  const list = state.list ?? [];
  const body = !state.open ? null
    : state.error ? <p role="alert" className="text-xs text-destructive">{state.error}</p>
    : !list.length ? <p className="text-xs text-muted-foreground" data-testid="instrument-protocols-empty">Inga protokoll har valt instrumentet ur registret.</p>
    : <ul className="divide-y rounded-lg border bg-background text-sm" data-testid="instrument-protocols">
      {list.map((item) => <li key={item.id}><Link href={href(item.id)} className="flex min-h-10 items-center justify-between gap-3 px-3 py-2 hover:bg-secondary/60">
        <span className="min-w-0 truncate font-medium text-primary">{item.title}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{PROTOCOL_STATUS[item.status] ?? item.status} · {siDate(item.completedAt ?? item.updatedAt)}</span>
      </Link></li>)}
    </ul>;
  return <div className={cn("space-y-2", native ? "pt-2" : "mt-3")} data-testid="instrument-protocols-fold">
    <Button type="button" variant={native ? "outline" : "ghost"} size="sm" className={native ? "h-11 w-full" : undefined} aria-expanded={state.open} aria-busy={state.busy || undefined} onClick={() => void toggle()} data-testid="instrument-protocols-open">{state.busy ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <ClipboardList />}Protokoll med detta instrument</Button>
    {state.busy ? <span role="status" className="sr-only">Hämtar protokollen…</span> : null}
    {body}
  </div>;
}

type InstrumentDraft = { id?: string; name: string; serialNumber: string; calibratedAt: string; nextCalibrationAt: string; note: string; active: boolean };
const NEW_INSTRUMENT: InstrumentDraft = { name: "", serialNumber: "", calibratedAt: "", nextCalibrationAt: "", note: "", active: true };
const CALIBRATION_LABEL: Record<DueState, string> = { NONE: "Ingen kalibrering planerad", OK: "Kalibrerad", DUE_SOON: "Kalibrering inom 30 dagar", OVERDUE: "Kalibrering förfallen" };
/** One date format with the Rapportarkiv: "1 okt. 2026" (KTR-09). */
const dayOrNull = (value: string) => value || null;

export function InstrumentsPage({ backend }: { backend: InstrumentsBackend }) {
  const [view, setView] = useState<InstrumentsView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<InstrumentDraft | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const reload = useCallback(async () => {
    try { setView(await backend.load()); setError(""); } catch (cause) { setError((cause as Error).message); }
  }, [backend]);
  useLoadEffect(reload);
  /** One change; true when it went through (so a dialog can stay open when it did not). */
  const run = async (input: SelfInspectionAction, done: string) => {
    setBusy(true);
    try {
      setView(await backend.act(input));
      announce(done);
      return true;
    } catch (cause) {
      announce((cause as Error).message, true);
      if ((cause as { status?: number }).status === 409) void reload();
      return false;
    } finally { setBusy(false); }
  };
  const remove = async (item: InstrumentView) => {
    if (!await confirm({ title: "Ta bort instrumentet?", message: `${item.name} tas bort ur registret. Protokoll som redan har instrumentet behåller sina uppgifter.`, confirmLabel: "Ta bort", tone: "danger" })) return;
    await run({ action: "remove_instrument", id: item.id }, "Instrumentet är borttaget.");
  };
  const canEdit = Boolean(view?.canEdit);
  // Nivå 1 på mobil (2026-10-09): the register as rows; an instrument is changed on its own screen (`&step=instrument`)
  // with Avbryt/Spara in the top bar and Ta bort inside it, never in a dialog.
  const { native, step } = useNativeScreen();
  const router = useRouter();
  const params = useSearchParams();
  const editingScreen = native && step === "instrument" && draft !== null;
  // The instrument's screen as it was opened: Avbryt and every Bakåt ask only when something is changed (2026-10-13).
  const [draftStart, setDraftStart] = useState("");
  const dirty = editingScreen && JSON.stringify(draft) !== draftStart;
  const releaseBack = useUnsavedGuard(dirty && !busy, confirm, undefined, { browserBack: true });
  const leavePage = useLeavePage();
  // Back to the register: where the person came from, or the register itself on a direct link – never out of Workflow.
  const leaveScreen = () => { leaveWithoutAsking(); leavePage(withScreen(params.toString(), null)); };
  const cancelScreen = () => void (async () => { if (dirty && !(await confirm(DISCARD_QUESTION))) return; leaveScreen(); })();
  const saveDraft = async () => {
    if (!draft) return false;
    if (draft.calibratedAt && draft.nextCalibrationAt && draft.nextCalibrationAt <= draft.calibratedAt) { announce(INSTRUMENT_ORDER_MESSAGE, true); return false; }
    return run({ action: "save_instrument", instrument: { ...(draft.id ? { id: draft.id } : {}), name: draft.name, serialNumber: draft.serialNumber, calibratedAt: dayOrNull(draft.calibratedAt),
      nextCalibrationAt: dayOrNull(draft.nextCalibrationAt), note: draft.note, active: draft.active } }, draft.id ? "Instrumentet är uppdaterat." : "Instrumentet är tillagt.");
  };
  useNativeTopBar(editingScreen && draft ? { title: draft.id ? "Ändra instrument" : "Nytt instrument", cancel: { onClick: cancelScreen },
    save: { busy, disabled: !draft.name.trim(), onClick: () => { if (!draft.name.trim()) { announce("Skriv instrumentets typ först.", true); return; } void releaseBack().then(saveDraft).then((done) => { if (done) leaveScreen(); }); } } }
    : native && !editingScreen ? { title: "Instrument", save: canEdit ? { label: "Ny", onClick: () => openDraft(NEW_INSTRUMENT) } : null } : null);
  // Avbryt, Escape and Bakåt in the dialog or page ask "Kasta ändringarna?" themselves when something is changed (KTR-08); a second question here asked twice.
  const closeDraft = () => setDraft(null);
  function openDraft(next: InstrumentDraft) { setDraft(next); setDraftStart(JSON.stringify(next)); if (native) router.push(withScreen(params.toString(), "instrument")); }
  if (native) {
    if (editingScreen && draft) return <div className="space-y-4 pb-4" data-testid="native-instrument-screen">
      {confirmElement}
      <div className="grid gap-4">
        <Field id="si-instrument-name" label="Instrument (typ)" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
        <Field id="si-instrument-serial" label="Serienummer" value={draft.serialNumber} onChange={(serialNumber) => setDraft({ ...draft, serialNumber })} />
        <Field id="si-instrument-calibrated" type="date" label="Kalibrerad" value={draft.calibratedAt} onChange={(calibratedAt) => setDraft({ ...draft, calibratedAt })} />
        <Field id="si-instrument-next" type="date" label="Nästa kalibrering" value={draft.nextCalibrationAt} onChange={(nextCalibrationAt) => setDraft({ ...draft, nextCalibrationAt })} />
      </div>
      <label className="grid gap-1.5"><span className="text-xs font-medium">Anteckning</span><textarea className="form-textarea" value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
      <label className="flex min-h-11 items-center gap-2 text-sm"><Checkbox checked={draft.active} onCheckedChange={(value) => setDraft({ ...draft, active: value === true })} />Används (visas i protokollen)</label>
      {draft.id && backend.protocols && view?.protocolsReadable ? <InstrumentProtocols id={draft.id} load={backend.protocols} native /> : null}
      {draft.id ? <Button type="button" variant="destructive" size="lg" className="w-full" disabled={busy}
        onClick={() => { const item = view?.instruments.find((entry) => entry.id === draft.id); if (item) void (async () => { if (!await confirm({ title: "Ta bort instrumentet?", message: `${item.name} tas bort ur registret. Protokoll som redan har instrumentet behåller sina uppgifter.`, confirmLabel: "Ta bort", tone: "danger" })) return; if (await run({ action: "remove_instrument", id: item.id }, "Instrumentet är borttaget.")) leaveScreen(); })(); }}
        data-testid="instrument-delete"><Trash2 />Ta bort instrument</Button> : null}
    </div>;
    return <NativePage testId="instruments-page">
      {confirmElement}
      <NativeLargeTitle inBar >Instrument</NativeLargeTitle>
      {error ? <p role="alert" className="notice text-destructive">{error}</p> : null}
      <ListGroup testId="self-inspection-instruments" footer={canEdit ? "Klockan påminner 30 dagar före nästa kalibrering." : "I ett protokoll väljs instrumentet ur registret."}>
        {!view ? <ListEmpty>Hämtar instrumenten…</ListEmpty>
          : view.instruments.length ? view.instruments.map((item) => <ListRow key={item.id} type="tools" icon={Gauge} title={item.name} twoLines className={cn(!item.active && "opacity-70")}
            subtitle={[item.serialNumber && `S/N ${item.serialNumber}`, item.nextCalibrationAt && `Nästa kalibrering ${siDate(item.nextCalibrationAt)}`, !item.active && "används inte"].filter(Boolean).join(" · ") || "Inga datum angivna"}
            pill={item.active && item.state !== "NONE" ? { label: item.state === "OK" ? "Kalibrerad" : item.state === "DUE_SOON" ? "Snart" : "Förfallen", tone: item.state === "OK" ? "success" : item.state === "DUE_SOON" ? "warning" : "danger" } : null}
            onClick={canEdit ? () => openDraft({ id: item.id, name: item.name, serialNumber: item.serialNumber, calibratedAt: item.calibratedAt ?? "", nextCalibrationAt: item.nextCalibrationAt ?? "", note: item.note, active: item.active }) : undefined}
            testId="instrument-row" />)
          : <ListEmpty>{canEdit ? "Inga instrument ännu. Lägg till med +." : "Administratören lägger till företagets instrument."}</ListEmpty>}
      </ListGroup>
    </NativePage>;
  }
  return <section className="space-y-5" data-testid="instruments-page">
    {confirmElement}
    <PageHeader title="Instrument" description={`Företagets mätinstrument och kalibrering.${canEdit ? " Klockan påminner 30 dagar före nästa kalibrering." : ""}`}
      actions={canEdit ? <Button onClick={() => openDraft(NEW_INSTRUMENT)}><Plus />Lägg till instrument</Button> : null} />
    {error ? <p role="alert" className="notice text-destructive">{error}</p> : !view ? <p role="status">Hämtar instrumenten…</p>
      : view.instruments.length ? <ul className="space-y-3" data-testid="self-inspection-instruments">{view.instruments.map((item) => <li key={item.id} className={cn("rounded-xl border bg-card p-4", !item.active && "opacity-70")}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          {/* The icon standard (2026-10-24): the list row's soft square in Instrument's colour, as in the app view. */}
          <div className="flex min-w-0 flex-1 items-start gap-3">
          <AreaIcon area="tools" icon={Gauge} />
          <div className="min-w-0">
            <p className="break-words text-sm font-semibold">{item.name}{item.serialNumber ? <span className="font-normal text-muted-foreground"> · S/N {item.serialNumber}</span> : null}</p>
            <p className="mt-1 text-xs text-muted-foreground">{[item.calibratedAt && `Kalibrerad ${siDate(item.calibratedAt)}`, item.nextCalibrationAt && `nästa ${siDate(item.nextCalibrationAt)}`, !item.active && "används inte"].filter(Boolean).join(" · ") || "Inga datum angivna"}</p>
            {item.note && <p className="mt-1 whitespace-pre-line text-sm">{item.note}</p>}
            {backend.protocols && view.protocolsReadable ? <InstrumentProtocols id={item.id} load={backend.protocols} /> : null}
          </div>
          </div>
          <div className="flex items-center gap-1">
            {item.active && <StateBadge state={item.state} labels={CALIBRATION_LABEL} />}
            {canEdit && <>
              <IconButton label={`Ändra ${item.name}`} onClick={() => openDraft({ id: item.id, name: item.name, serialNumber: item.serialNumber, calibratedAt: item.calibratedAt ?? "", nextCalibrationAt: item.nextCalibrationAt ?? "", note: item.note, active: item.active })}><Pencil /></IconButton>
              <RemoveButton label={`Ta bort ${item.name}`} disabled={busy} onClick={() => void remove(item)} />
            </>}
          </div>
        </div>
      </li>)}</ul> : <Empty title="Inga instrument ännu" description={canEdit ? "Lägg till företagets mätinstrument med serienummer och kalibrering." : "Administratören lägger till företagets instrument."} />}
    {draft && <DialogPage pageKey="instrument" size="form" open onOpenChange={(open) => { if (!open) void closeDraft(); }} title={draft.id ? "Ändra instrument" : "Lägg till instrument"} panelTitle="Instrument">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="si-instrument-name" label="Instrument (typ)" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
          <Field id="si-instrument-serial" label="Serienummer" value={draft.serialNumber} onChange={(serialNumber) => setDraft({ ...draft, serialNumber })} />
          <Field id="si-instrument-calibrated" type="date" label="Kalibrerad" value={draft.calibratedAt} onChange={(calibratedAt) => setDraft({ ...draft, calibratedAt })} />
          <Field id="si-instrument-next" type="date" label="Nästa kalibrering" value={draft.nextCalibrationAt} onChange={(nextCalibrationAt) => setDraft({ ...draft, nextCalibrationAt })} />
        </div>
        <label className="grid gap-1.5"><span className="text-xs font-medium">Anteckning</span><textarea className="form-textarea" value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={draft.active} onCheckedChange={(value) => setDraft({ ...draft, active: value === true })} />Används (visas i protokollen)</label>
        {/* The shared actions row, so a view offers Avbryt and Spara in the bottom bar like every other form (simulation 0.6.4). */}
        <DialogActions cancel={{ onClick: () => void closeDraft() }} primary={{ label: "Spara", busy, busyLabel: "Sparar…", disabledReason: draft.name.trim() ? null : "Skriv instrumentets typ först.", onClick: async () => {
          const done = await saveDraft();
          if (done) setDraft(null);
        } }} />
      </div>
    </DialogPage>}
  </section>;
}
