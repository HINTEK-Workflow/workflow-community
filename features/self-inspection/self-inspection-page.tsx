"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpenCheck, CalendarCheck, ClipboardList, GraduationCap, History, ShieldAlert, ClipboardPen } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, Field, Panel } from "@/features/kfid/ui";
import { useConfirm } from "@/features/kfid/confirm";
import { api } from "@/features/kfid/api";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { announce } from "@/lib/workflow/toast";
import { swedishDayKey } from "@/lib/swedish-time";
import { cn } from "@/lib/utils";
import { ANCHORS, REVIEW_OUTCOMES, type CardVersion, type SelfInspectionAction, type SelfInspectionView, type VersionView } from "@/lib/self-inspection/model";
import { NativeProgram, ProgramDocument, ProgramTab } from "./document-view";
import { goTo, siDate, type CredentialFilesApi, type Run } from "./shared";
import { CompetenceTab } from "./registers";
import { MOVED_TABS } from "./moved-tabs";
import { RiskClassesTab } from "./risk-classes";
import { DEVIATION_SOURCES_SENTENCE, DeviationsTab, entryLabel, newDeviationType } from "./deviations";
import { cloudDeviationPhotos, type DeviationPhotosApi } from "./deviation-photos";
import { cloudDeviationExporter, type DeviationExporter } from "./deviation-export-menu";
import { ListEmpty, ListGroup, NativeMenuPage, NativePage, ShowMoreMarker, useNativeTopBar } from "@/components/native";
import { useNativeReduced, useShowMoreNote } from "@/features/workflow/use-detail-level";
import { PageHeader } from "@/components/page-shell";
import { InPageTabs } from "@/features/workflow/in-page-tabs";
import { saveBlob } from "@/lib/download";
import type { KitIdentity } from "@/lib/workflow/report-kit";
import { fetchReportFonts } from "@/lib/workflow/report-fonts";
import { DownloadButton } from "@/components/ui/download-button";

/**
 * Egenkontroll (2026-10-06): the company's self-inspection programme with tabs Program (the programme as one
 * document with its roles, people and competence – ./document-view.tsx), Kompetenskort, Årlig översyn and Versioner.
 * The instrument register is a page of its own under Kvalitet and a customer's special requirements are a field on the
 * customer card (2026-10-07); links to the old tabs lead there. Avvikelser (2026-10-30) is a page of its own –
 * `mode="deviations"`, the company's whole deviation log, read through the same backend – and the programme links to it.
 * Cloud talks to /api/self-inspection; Local and the demo pass a backend that keeps the same document in the file or in
 * memory. Only drawing here – the backend decides who may do what.
 */
export type SelfInspectionBackend = {
  load: () => Promise<SelfInspectionView>;
  act: (input: SelfInspectionAction) => Promise<SelfInspectionView>;
  pdf: (version: VersionView, company: string) => Promise<void>;
  /** Local: a person is named in the file instead of chosen among the company's members. */
  namedPeople?: boolean;
  /** Kommentarer (Cloud): each entry has its thread. */
  comments?: boolean;
  /** Where the programme is kept, said once under the heading. */
  storageNote?: string;
  /** Certificates on the competence cards (Cloud only). */
  files?: CredentialFilesApi;
  /** Kompetenskort v2 (2026-10-08): one card's versions, newest first (read on its own, bounded). */
  history?: (personId: string) => Promise<CardVersion[]>;
  /** Avvikelse ↔ arbetsorder (2026-10-10): "Skapa arbetsorder" on a log entry; the answer is the new view. */
  createWorkOrder?: (deviationId: string) => Promise<SelfInspectionView>;
  /** Photos on the log's entries (Cloud; shown only when the view says the backend keeps them). */
  photos?: DeviationPhotosApi;
  /** Exportera på Avvikelser (2026-10-30): Cloud makes the file on the server; without one (Local) it is drawn in the browser. */
  deviationExporter?: (company: string) => DeviationExporter;
};

function download(bytes: Uint8Array | Blob, filename: string) {
  saveBlob(bytes instanceof Blob ? bytes : bytes as unknown as BlobPart, filename, "application/pdf");
}
const pdfName = (version: VersionView) => `${version.content.title}-version-${version.number}.pdf`.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-");

/**
 * The PDF drawn in the browser with the same report kit (Local and the demo, which have no server for it): the company's identity
 * (Local) or its name alone (the demo). The demo's copy is stamped Demo on every page (2026-11-06).
 */
export async function downloadSelfInspectionPdfInBrowser(version: VersionView, company: string | (() => Promise<KitIdentity>), demo = false) {
  const fontBytes = await fetchReportFonts();
  const { createSelfInspectionPdf } = await import("@/lib/self-inspection/report");
  const bytes = await createSelfInspectionPdf({ identity: typeof company === "string" ? { company } : await company(), fontBytes, version });
  const { browserPdfCopy } = await import("@/features/demo/demo-pdf");
  const copy = await browserPdfCopy(new Uint8Array(bytes), pdfName(version), demo);
  download(copy.bytes, copy.filename);
}

export function cloudSelfInspectionBackend(): SelfInspectionBackend {
  return {
    load: () => api<SelfInspectionView>("/api/self-inspection", { cache: "no-store" }),
    history: async (personId) => (await api<{ versions: CardVersion[] }>(`/api/self-inspection?part=card-history&personId=${encodeURIComponent(personId)}`, { cache: "no-store" })).versions,
    act: (input) => api<SelfInspectionView>("/api/self-inspection", { method: "POST", body: JSON.stringify(input) }),
    createWorkOrder: (deviationId) => api<SelfInspectionView>("/api/self-inspection", { method: "POST", body: JSON.stringify({ action: "create_work_order", deviationId }) }),
    files: {
      upload: async (credentialId, file) => {
        const form = new FormData();
        form.set("credentialId", credentialId);
        form.set("file", file);
        await api("/api/self-inspection/credential-files", { method: "POST", body: form });
      },
      remove: async (fileId) => { await api(`/api/self-inspection/credential-files/${encodeURIComponent(fileId)}`, { method: "DELETE" }); },
      href: (fileId) => `/api/self-inspection/credential-files/${encodeURIComponent(fileId)}`,
    },
    photos: cloudDeviationPhotos(api),
    comments: true,
    deviationExporter: (company) => cloudDeviationExporter(company, cloudDeviationPhotos(api)),
    pdf: async (version, company) => {
      // The demo answers /api from memory and has no PDF route; it draws the same PDF in the browser.
      if ((window as typeof window & { __workflowDemo?: boolean }).__workflowDemo) return downloadSelfInspectionPdfInBrowser(version, company, true);
      const response = await fetch(`/api/self-inspection/report?version=${version.number}`, { cache: "no-store" });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || "PDF:en kunde inte skapas.");
      download(await response.blob(), pdfName(version));
    },
  };
}

type Tab = "program" | "competence" | "review" | "versions" | "levels";
const TABS: { key: Tab; label: string; icon: typeof BookOpenCheck; admin?: boolean }[] = [
  { key: "program", label: "Program", icon: BookOpenCheck },
  // Etapp 3 (2026-10-06): the competence cards beside the programme.
  { key: "competence", label: "Kompetenskort", icon: GraduationCap },
  { key: "review", label: "Årlig översyn", icon: CalendarCheck, admin: true },
  { key: "versions", label: "Versioner", icon: History, admin: true },
  // Krävd nivå (2026-10-07, named so 2026-10-09): the level the company requires per task type, the counterpart of the roles' levels.
  { key: "levels", label: "Krävd nivå", icon: ShieldAlert, admin: true },
];
/** The log's entries of the programme's own type (2026-10-30: the programme keeps a short link to them). */
export const SELF_INSPECTION_LOG_HREF = "/?view=deviations&type=SELF_INSPECTION";

/**
 * An older address of the log (`/?view=self_inspection&tab=deviations…`, a bookmark or a reminder sent before 2026-10-30)
 * as the log's own address, with the entry, the filters and Rapportera avvikelse kept.
 */
export function movedDeviationsHref(params: { get: (key: string) => string | null }): string {
  const kept = ["deviation", "filter", "type", "new"].flatMap((key) => { const value = params.get(key); return value ? [`&${key}=${encodeURIComponent(value)}`] : []; });
  return `/?view=deviations${kept.join("")}`;
}

export function SelfInspectionPage({ backend, revision, mode = "programme" }: { backend: SelfInspectionBackend; revision?: string;
  /** `deviations`: the page Avvikelser – the company's deviation log alone (2026-10-30). */ mode?: "programme" | "deviations" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [view, setView] = useState<SelfInspectionView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, confirmElement] = useConfirm();
  const dirty = useRef(false);
  const onDirtyChange = useCallback((value: boolean) => { dirty.current = value; }, []);
  const log = mode === "deviations";
  const requested = searchParams.get("tab");
  // The programme is read like any page; its editor opens with ?edit=1 (2026-10-07: "ett läge där sidan visas som
  // den ska, väljer jag att redigera …"), which is also what makes the page wide (app-shell).
  const editing = !log && searchParams.get("edit") === "1" && Boolean(view?.canEdit);
  const setEditing = useCallback((next: boolean) => router.replace(next ? "/?view=self_inspection&edit=1" : "/?view=self_inspection", { scroll: false }), [router]);
  const tabs = TABS.filter((tab) => !tab.admin || view?.canEdit);
  // The roles used to have their own tab; they are part of the document now (appendix A).
  const tab: Tab = tabs.some((item) => item.key === requested) ? requested as Tab : "program";
  // Nivå 1 på mobil (2026-10-09): Egenkontroll as a menu of rows – Program and Kompetenskort, each a screen of its
  // own (`&tab=`, so Bakåt works). Årlig översyn, Versioner and Krävd nivå are office work in display level 2; on a phone
  // Visa mer draws the ordinary page with its tabs in the app (A2: nothing is out of reach).
  const native = useNativeReduced();
  const officeNote = useShowMoreNote("Årlig översyn, versioner och krävd nivå finns i visning 2 (Lagom).");
  const nativeTabs = tabs.filter((item) => !item.admin);
  const nativeScreen = !log && native && nativeTabs.some((item) => item.key === requested) ? requested as Tab : null;
  // Avvikelse ↔ arbetsorder (2026-10-10): `&deviation=` points out one entry – marked in the list, its own screen at level 1.
  const focusId = log ? searchParams.get("deviation") : null;
  const focused = focusId ? view?.deviations.find((item) => item.id === focusId) ?? null : null;
  const startNew = log ? newDeviationType(searchParams.get("new")) : null;
  // Program and Kompetenskort set their own bar (a part of the programme, a person's card); one entry of the log names itself.
  useNativeTopBar(log && focused ? { title: entryLabel(focused) } : nativeScreen && !view ? { title: TABS.find((item) => item.key === nativeScreen)!.label } : null);
  const selectTab = async (next: Tab) => {
    if (dirty.current && !await confirm({ title: "Lämna utkastet?", message: "Ändringar i texten som inte har sparats går förlorade.", confirmLabel: "Lämna utan att spara", tone: "danger" })) return;
    dirty.current = false;
    // A step of its own, as every tab row (2026-11-02): Tillbaka goes to the tab before.
    router.push(next === "program" ? "/?view=self_inspection" : `/?view=self_inspection&tab=${next}`, { scroll: false });
  };
  useEffect(() => {
    if (log || requested !== "roles" || !view) return;
    requestAnimationFrame(() => requestAnimationFrame(() => goTo(ANCHORS.roles)));
  }, [log, requested, view]);
  // The instrument register and the customers' requirements left Egenkontroll (2026-10-07), and the deviation log is a page
  // of its own (2026-10-30): an old link goes to where they are now.
  const movedTo = log || !requested ? undefined : requested === "deviations" ? movedDeviationsHref(searchParams) : MOVED_TABS[requested];
  useEffect(() => { if (movedTo) router.replace(movedTo, { scroll: false }); }, [movedTo, router]);

  const reload = useCallback(async () => {
    try { setView(await backend.load()); setError(""); } catch (cause) { setError((cause as Error).message); }
    // Local passes its file's revision, so a change saved elsewhere in the tab is read again.
  }, [backend]);
  // Started one microtask later, as useLoadEffect does (react-hooks/set-state-in-effect).
  useEffect(() => { queueMicrotask(() => void reload()); }, [reload, revision]);

  /** One change; the answer is the new view (null when it did not go through, so a dialog can stay open). */
  const run = useCallback<Run>(async (input, done) => {
    setBusy(true);
    try {
      const next = await backend.act(input);
      setView(next);
      if (done) announce(done);
      return next;
    } catch (cause) {
      announce((cause as Error).message, true);
      // A conflict means someone else saved: read again so the next attempt starts from what is stored.
      if ((cause as { status?: number }).status === 409) void reload();
      return null;
    } finally { setBusy(false); }
  }, [backend, reload]);
  // Avvikelse ↔ arbetsorder (2026-10-10): Skapa arbetsorder on a log entry; the entry shows the order at once.
  const createWorkOrder = backend.createWorkOrder ? async (deviationId: string) => {
    setBusy(true);
    try {
      setView(await backend.createWorkOrder!(deviationId));
      announce("Arbetsordern är skapad och kopplad till avvikelsen.");
    } catch (cause) {
      announce((cause as Error).message, true);
      if ((cause as { status?: number }).status === 409) void reload();
    } finally { setBusy(false); }
  } : undefined;
  const pdf = async (version: VersionView) => {
    setBusy(true);
    try { await backend.pdf(version, view?.company ?? ""); } catch (cause) { announce((cause as Error).message, true); } finally { setBusy(false); }
  };
  const openSelfInspection = useMemo(() => view ? view.deviations.filter((entry) => (entry.type ?? "SELF_INSPECTION") === "SELF_INSPECTION" && entry.status !== "DONE").length : 0, [view]);

  // Avvikelser (2026-10-30): the log as a page of its own, with all types; neutral words, not Egenkontroll's.
  if (log) {
    const tabProps = { view: view!, busy, run, reload, photos: backend.photos, comments: backend.comments, focusId, createWorkOrder, startNew, exporter: view && backend.deviationExporter ? backend.deviationExporter(view.company) : undefined };
    // Where the entries come from stands at every display level (förenkling 0.77.0); the rest from level 2.
    const description = <span>{DEVIATION_SOURCES_SENTENCE}<span data-detail-min="2"> Avvikelser, riskobservationer, tillbud och olycksfall, med åtgärd och uppföljning.{backend.storageNote ? ` ${backend.storageNote}` : ""}</span></span>;
    if (native) return <section data-testid="deviations-page">
      {error ? <p role="alert" className="notice text-destructive">{error}</p> : !view ? <NativePage className="pt-2"><ListGroup><ListEmpty>Hämtar avvikelser…</ListEmpty></ListGroup></NativePage>
        : <div className="pt-2"><DeviationsTab key={focusId ?? "list"} {...tabProps} native /></div>}
    </section>;
    return <section className="space-y-6" data-testid="deviations-page">
      {/* The header's actions (Exportera, Ny förbättring, Rapportera avvikelse) belong to the log, so the log draws the header once it is read. */}
      {error || !view ? <PageHeader title="Avvikelser" description={description} /> : null}
      {error ? <p role="alert" className="notice text-destructive">{error}</p> : !view ? <p role="status">Hämtar avvikelser…</p>
        : <DeviationsTab key={focusId ?? "list"} {...tabProps} header={(actions, heading) => <PageHeader title={heading?.title ?? "Avvikelser"} description={heading?.description ?? description} actions={actions} />} />}
    </section>;
  }

  if (native) return <section data-testid="self-inspection">
    {confirmElement}
    <ShowMoreMarker when={Boolean(view?.canEdit)} />
    {/* M2 (2026-10-12): Program as the big tile, the log of the programme's own type beside it, Kompetenskort as a row; the title is the top bar's. */}
    {!nativeScreen ? <>
      {error ? <p role="alert" className="notice text-destructive">{error}</p> : null}
      {!view ? <NativePage className="pt-2"><ListGroup testId="native-self-inspection-rows"><ListEmpty>Hämtar egenkontrollprogrammet…</ListEmpty></ListGroup></NativePage> : <NativeMenuPage testId="native-self-inspection-menu"
        tiles={[
          ...nativeTabs.filter((item) => item.key === "program").map((item) => ({ title: item.label, type: "control" as const, icon: item.icon,
            subtitle: view.current ? `Version ${view.current.number}` : undefined, href: `/?view=self_inspection&tab=${item.key}`, testId: `native-self-inspection-${item.key}` })),
          { title: "Avvikelser", type: "risk" as const, icon: ClipboardList, subtitle: `${openSelfInspection} ${openSelfInspection === 1 ? "öppen" : "öppna"}`, href: SELF_INSPECTION_LOG_HREF, testId: "native-self-inspection-deviations" },
        ]}
        groups={[{ testId: "native-self-inspection-rows", footer: view.canEdit ? officeNote : undefined,
          rows: nativeTabs.filter((item) => item.key === "competence").map((item) => ({ key: item.key, type: "customer" as const, icon: item.icon, title: item.label, subtitle: "Roller, utbildningar och intyg",
            href: `/?view=self_inspection&tab=${item.key}`, testId: `native-self-inspection-${item.key}` })) }]} />}
    </> : !view ? <p role="status" className="py-6 text-sm text-muted-foreground">Hämtar…</p> : <div className="space-y-5 pt-2">
      {nativeScreen === "program" && <NativeProgram view={view} busy={busy} run={run} pdf={pdf} />}
      {nativeScreen === "competence" && <CompetenceTab native view={view} busy={busy} run={run} files={backend.files} history={backend.history} reload={reload} />}
    </div>}
  </section>;
  return <section className="space-y-6" data-testid="self-inspection">
    {confirmElement}
    <PageHeader title="Egenkontroll" description={<span data-detail-min="2">Företagets egenkontrollprogram: roller, kompetens och årlig översyn.{backend.storageNote ? ` ${backend.storageNote}` : ""}</span>}
      actions={<Button variant="outline" asChild><Link href={SELF_INSPECTION_LOG_HREF} data-testid="self-inspection-deviations-link"><ClipboardList />Avvikelser{view ? ` (${openSelfInspection} ${openSelfInspection === 1 ? "öppen" : "öppna"})` : ""}</Link></Button>} />
    {error ? <p role="alert" className="notice text-destructive">{error}</p> : !view ? <p role="status">Hämtar egenkontrollprogrammet…</p> : <>
      {tabs.length > 1 && <InPageTabs label="Egenkontroll" tabs={tabs} current={tab} onSelect={(next) => void selectTab(next)} />}
      {tab === "program" && <ProgramTab view={view} busy={busy} run={run} pdf={pdf} namedPeople={Boolean(backend.namedPeople)} onDirtyChange={onDirtyChange} editing={editing} onEditingChange={setEditing} />}
      {tab === "competence" && <CompetenceTab view={view} busy={busy} run={run} files={backend.files} history={backend.history} reload={reload} />}
      {tab === "review" && view.canEdit && <ReviewTab view={view} busy={busy} run={run} />}
      {tab === "versions" && view.canEdit && <VersionsTab view={view} busy={busy} pdf={pdf} />}
      {tab === "levels" && view.canEdit && <RiskClassesTab view={view} busy={busy} run={run} />}
    </>}
  </section>;
}

const date = siDate;

// ---------- yearly review ----------

function ReviewTab({ view, busy, run }: { view: SelfInspectionView; busy: boolean; run: Run }) {
  const [form, setForm] = useState({ reviewedAt: swedishDayKey(new Date()), registrationChecked: false, deviationsReviewed: false, competenceFollowed: false, outcome: "NO_CHANGES" as keyof typeof REVIEW_OUTCOMES, notes: "" });
  const state = view.review;
  const tone = state.status === "OVERDUE" ? "danger" : state.status === "DUE_SOON" ? "warning" : state.status === "OK" ? "success" : "neutral";
  if (!view.hasProgram) return <Panel icon={CalendarCheck} title="Årlig översyn"><Empty title="Inget program ännu" description="Översynen görs när programmet har en fastställd version." /></Panel>;
  return <div className="space-y-5">
    <div className={cn("rounded-xl border p-4", indicatorBadge(tone))} data-testid="self-inspection-review-state">
      <p className="text-sm font-semibold">{state.status === "NONE" ? "Ingen version är fastställd ännu" : state.status === "OVERDUE" ? `Översynen skulle ha gjorts senast ${date(state.nextDue)}` : `Nästa översyn senast ${date(state.nextDue)}`}</p>
      <p className="mt-1 text-xs">Översyn görs minst en gång per år. {state.lastReviewedAt ? `Senaste översyn ${date(state.lastReviewedAt)}.` : "Ingen översyn är registrerad ännu."} Klockan påminner 30 dagar före.</p>
    </div>
    <Panel icon={ClipboardPen} title="Registrera översyn">
      <div className="space-y-4">
        <Field id="si-review-date" type="date" label="Datum" value={form.reviewedAt} onChange={(reviewedAt) => setForm({ ...form, reviewedAt })} className="max-w-xs" />
        {([["registrationChecked", "Registreringen hos Elsäkerhetsverket är kontrollerad och aktuell"], ["deviationsReviewed", "Avvikelser och handlingsplan är genomgångna"], ["competenceFollowed", "Planen för kompetens följs"]] as const).map(([key, label]) =>
          <label key={key} className="flex items-center gap-2 text-sm"><Checkbox checked={form[key]} onCheckedChange={(value) => setForm({ ...form, [key]: value === true })} />{label}</label>)}
        <Field id="si-review-outcome" label="Beslut" value={form.outcome} onChange={(outcome) => setForm({ ...form, outcome: outcome as typeof form.outcome })} options={Object.keys(REVIEW_OUTCOMES)} optionLabels={REVIEW_OUTCOMES} className="max-w-md" />
        <label className="grid gap-1.5"><span className="text-xs font-medium">Anteckningar</span><textarea className="form-textarea" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
        {form.outcome === "CHANGES_NEEDED" && <p className="notice">Ändra utkastet under Program och fastställ en ny version när ändringarna är gjorda.</p>}
        <div className="flex justify-end"><Button disabled={busy} onClick={() => void run({ action: "add_review", review: form }, "Översynen är registrerad.").then((ok) => { if (ok) setForm((current) => ({ ...current, notes: "" })); })}><CalendarCheck />Registrera översyn</Button></div>
      </div>
    </Panel>
    <Panel icon={History} title="Gjorda översyner" collapsible defaultCollapsed count={view.reviews.length} foldKey="self-inspection-reviews">
      {view.reviews.length ? <ul className="divide-y text-sm" data-testid="self-inspection-reviews">{view.reviews.map((item) => <li key={item.id} className="py-3">
        <p className="font-medium">{date(item.reviewedAt)} · {REVIEW_OUTCOMES[item.outcome]}</p>
        <p className="mt-1 text-xs text-muted-foreground">{[item.reviewedByName, item.versionNumber ? `version ${item.versionNumber}` : "", item.registrationChecked ? "registreringen kontrollerad" : "registreringen ej kontrollerad", item.deviationsReviewed ? "avvikelser genomgångna" : "", item.competenceFollowed ? "kompetensplanen följs" : ""].filter(Boolean).join(" · ")}</p>
        {item.notes && <p className="mt-1 whitespace-pre-line">{item.notes}</p>}
      </li>)}</ul> : <p className="text-sm text-muted-foreground">Ingen översyn är registrerad ännu.</p>}
    </Panel>
  </div>;
}

// ---------- versions ----------

function VersionsTab({ view, busy, pdf }: { view: SelfInspectionView; busy: boolean; pdf: (version: VersionView) => Promise<void> }) {
  const [open, setOpen] = useState<VersionView | null>(null);
  if (!view.versions.length) return <Panel icon={History} title="Versioner"><Empty title="Inga fastställda versioner" description="När utkastet fastställs sparas det här som en version som inte kan ändras." /></Panel>;
  // An older version reads as the document it was, with the roles, people and competence it froze.
  if (open) return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button variant="outline" onClick={() => setOpen(null)}>Tillbaka till versionerna</Button>
      <DownloadButton disabled={busy} onClick={() => void pdf(open)}>PDF</DownloadButton>
    </div>
    <ProgramDocument content={open.content} heading={`Version ${open.number} · fastställd ${date(open.approvedAt)}${open.approvedByName ? ` av ${open.approvedByName}` : ""} · ${open.changeReason}`} versions={[]} />
  </div>;
  return <div className="space-y-5">
    <Panel icon={History} title="Versioner" description="Fastställda versioner sparas och ändras aldrig.">
      <ul className="divide-y" data-testid="self-inspection-versions">{view.versions.map((version) => <li key={version.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Version {version.number}{version.number === view.current?.number ? " · gällande" : ""}</p>
          <p className="mt-1 text-xs text-muted-foreground">Fastställd {date(version.approvedAt)}{version.approvedByName ? ` av ${version.approvedByName}` : ""} · {version.changeReason}</p>
          <p className="mt-0.5 font-mono text-[0.6875rem] text-muted-foreground" title="Kontrollsumma (SHA-256) för versionens innehåll">{version.hash.slice(0, 16)}</p>
          {version.content.redactions?.length ? <p className="mt-0.5 text-xs text-muted-foreground" data-testid="self-inspection-version-redacted">Uppgifter om {version.content.redactions.length === 1 ? "en raderad person" : `${version.content.redactions.length} raderade personer`} togs bort {version.content.redactions[version.content.redactions.length - 1]!.at}. Namn och roll står kvar; kontrollsumman gäller versionen som den fastställdes.</p> : null}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setOpen(version)}>Visa</Button>
          <DownloadButton disabled={busy} onClick={() => void pdf(version)}>PDF</DownloadButton>
        </div>
      </li>)}</ul>
    </Panel>
  </div>;
}
