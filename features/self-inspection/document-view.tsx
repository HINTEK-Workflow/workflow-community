"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ChevronDown, ClipboardCheck, ClipboardList, Eye, Heading, List, ListOrdered, ListPlus, ListTree, Pencil, Pilcrow, Plus, Save, ShieldCheck, Table2, Trash2, Wrench, X, BookOpen } from "lucide-react";
import { EDITOR_BUTTON, EditorActions, EditorBar, EditorMoreMenu, EditorRibbon, EditorRibbonSheet, EditorSegmented, EditorStatus, EditorUndoRedo, type EditorRibbonGroup } from "@/components/editor-ribbon";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckField, DialogActions, Empty, Field, Modal, Panel } from "@/features/kfid/ui";
import { useConfirm } from "@/features/kfid/confirm";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { useFoldsDocument, useShowMoreNote } from "@/features/workflow/use-detail-level";
import { useUnsavedGuard } from "@/lib/workflow/use-unsaved-guard";
import { cn } from "@/lib/utils";
import {
  ACTIVITY_GROUPS, ACTIVITY_TYPES, activityLabel, ANCHORS, CHECK_DISCLAIMER, CHECK_KINDS, peopleOverview, programContent, requirementCoverage, responsibleRoles,
  type ActivityTypeKey, type CheckKind, type ProgramCheck, type ProgramContent, type SelfInspectionView, type VersionView,
} from "@/lib/self-inspection/model";
import { partFlags, programOutline, remapSectionAnchors, shiftOpenParts, type DataBlock, type OutlineEntry, type PartFlags } from "@/lib/self-inspection/outline";
import { formatProgramLines, insertProgramSnippet, TEXT_SNIPPETS, type LineFormat } from "@/lib/self-inspection/text";
import { EreList, PeopleAppendix, PeopleTable, RolesAppendix } from "./organisation";
import { MarkedText } from "./marked-text";
import { OrgTreeView } from "./org-tree";
import { markersIn } from "@/lib/self-inspection/structure";
import { selfInspectionHref } from "@/lib/self-inspection/tabs";
import Link from "next/link";
import { goTo, ProgramText, siDate, Tag, type Run } from "./shared";
import { ListEmpty, ListFact, ListGroup, ListRow, NativeActions, NativePage, useNativeTopBar } from "@/components/native";
import { IconButton } from "@/components/ui/icon-button";
import { RemoveButton } from "@/components/ui/remove-button";
import { DownloadButton } from "@/components/ui/download-button";

/**
 * Egenkontroll's Program tab (2026-10-06): an overview, the automatic field check kept apart from the legal
 * question, and the programme as one document with a contents list – read mode shows it as the finished document,
 * edit mode the same document with fields. Roles, people and competence are part of it and frozen on Fastställ.
 */
type Mode = "read" | "edit";
const noop = () => {};
/** What each mode puts in the one editor bar (the bar itself is drawn by ProgramTab). */
type BarParts = {
  history?: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
  status: ReactNode;
  ribbon?: ReactNode;
  save?: { dirty: boolean; onSave: () => void; onDiscard: () => void };
  /** The contents list's button for smaller screens. */
  contents?: ReactNode;
};

export function ProgramTab({ view, busy, run, pdf, onDirtyChange, editing, onEditingChange, deviations }: {
  /** The log's open entries of the programme's type, shown as a row of the overview (2026-11-24). */
  deviations?: { open: number; href: string };
  view: SelfInspectionView; busy: boolean; run: Run; pdf: (version: VersionView) => Promise<void>; onDirtyChange: (dirty: boolean) => void;
  /**
   * 2026-10-07: the programme is first shown as the page it is meant to be (the shared width, no editor bar); an
   * administrator chooses Redigera programmet to open the editor, which has Redigera, Läsläge (the page as it is shown)
   * and PDF, like Skapa formulär. `editing` lives in the address (?edit=1), which also makes the page wide.
   */
  editing: boolean; onEditingChange: (next: boolean) => void;
}) {
  const [mode, setMode] = useState<Mode>("edit");
  const [source, setSource] = useState<"current" | "draft">("current");
  const [approving, setApproving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirm, confirmElement] = useConfirm();
  const current = view.current;
  const program = view.program;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  const leaveEdits = useCallback(async () => {
    if (!dirty) return true;
    if (!await confirm({ title: "Lämna redigeringen?", message: "Ändringar som inte har sparats går förlorade.", confirmLabel: "Lämna utan att spara", tone: "danger" })) return false;
    setDirty(false);
    return true;
  }, [dirty, confirm]);
  const switchMode = useCallback(async (next: Mode) => {
    if (next === mode) return true;
    if (mode === "edit" && !await leaveEdits()) return false;
    setMode(next);
    return true;
  }, [mode, leaveEdits]);
  /** Redigera programmet: the editor opens in Redigera. */
  const openEditor = useCallback(() => { setMode("edit"); onEditingChange(true); }, [onEditingChange]);
  /** Stäng: back to the page as it is shown. */
  const closeEditor = useCallback(async () => { if (mode === "edit" && !await leaveEdits()) return; onEditingChange(false); }, [mode, leaveEdits, onEditingChange]);
  const inEditor = editing && Boolean(program && view.canEdit);
  /** "Gå till" from the check: the draft in the editor, then the place. */
  const jump = useCallback(async (anchor?: string) => {
    if (!anchor) return;
    if (program && !inEditor) openEditor();
    else if (program && mode !== "edit" && !await switchMode("edit")) return;
    requestAnimationFrame(() => requestAnimationFrame(() => goTo(anchor)));
  }, [program, inEditor, openEditor, mode, switchMode]);

  if (!view.hasProgram) return view.canEdit
    ? <Panel icon={BookOpen} title="Egenkontrollprogram"><Empty title="Inget program ännu" description="Skapa företagets program från Workflows mall. Företaget ansvarar för att innehållet stämmer.">
      <Button disabled={busy} onClick={() => void run({ action: "create_program" }, "Programmet skapades från mallen. Fyll i grunduppgifterna och fastställ en första version.")}><Plus />Skapa från mallen</Button>
    </Empty></Panel>
    : <Panel icon={BookOpen} title="Egenkontrollprogram"><Empty title="Inget program ännu" description="Företagets administratör har ännu inte fastställt något egenkontrollprogram." /></Panel>;

  // What read mode shows: members the current version; admins the current version or the draft when it has changes.
  // With the people's levels and the hired staff the next approved version will take (2026-11-24).
  const draftContent = program ? programContent(program, undefined, program.extras) : null;
  const showDraft = Boolean(draftContent && (!current || (program?.changedSinceApproval && source === "draft")));
  const readContent: ProgramContent | null = showDraft ? draftContent : current?.content ?? null;

  // One bar for both modes (2026-10-07): the same controls in the same places in Läsläge and Redigera, and in the
  // same order as Skapa formulär and the landing editor – undo, the mode, the status, PDF, Spara utkast, Fastställ and ⋯.
  // What does not apply in Läsläge is disabled, never removed (the ribbon too), so nothing moves when the mode changes.
  const editor = Boolean(program && view.canEdit);
  const modeSwitch = program ? <EditorSegmented label="Läge" value={mode} onChange={(next) => void switchMode(next)} compactOnPhone
    options={[{ value: "edit", label: "Redigera", icon: Pencil }, { value: "read", label: "Läsläge", icon: Eye }]} /> : null;
  const approveLabel = `Fastställ version ${(current?.number ?? 0) + 1}`;
  const canApproveNow = Boolean(view.canApprove && program?.changedSinceApproval && !busy && !dirty);
  const approveTitle = dirty ? "Spara utkastet först." : program?.changedSinceApproval ? undefined : "Utkastet är oförändrat sedan senaste versionen.";
  const bar = (parts: BarParts) => <EditorBar testId="self-inspection-toolbar"
    ribbon={editor ? parts.ribbon ?? <EditorRibbon label="Redigera programmet" groups={programRibbon(null)} testId="self-inspection-ribbon" disabled /> : null}>
    {editor ? <EditorUndoRedo canUndo={parts.history?.canUndo ?? false} canRedo={parts.history?.canRedo ?? false} onUndo={parts.history?.undo ?? noop} onRedo={parts.history?.redo ?? noop} /> : null}
    {modeSwitch}
    {parts.contents}
    {parts.status}
    <EditorActions>
      {editor ? <Button type="button" variant="ghost" className={cn(EDITOR_BUTTON, "max-sm:hidden")} onClick={() => void closeEditor()} data-testid="self-inspection-close-editor"><X />Stäng</Button> : null}
      {current ? <DownloadButton variant="ghost" className={cn(EDITOR_BUTTON, editor && "max-sm:hidden")} disabled={busy} onClick={() => void pdf(current)}>PDF</DownloadButton> : null}
      {editor ? <Button type="button" variant="outline" className={cn(EDITOR_BUTTON, "max-sm:hidden")} disabled={busy || !parts.save?.dirty} onClick={parts.save?.onSave}><Save />Spara utkast</Button> : null}
      {view.canApprove && program ? <Button type="button" className={cn(EDITOR_BUTTON, "min-w-44 max-sm:hidden")} disabled={!canApproveNow} onClick={() => setApproving(true)} title={approveTitle}><ShieldCheck />{approveLabel}</Button> : null}
      {editor ? <EditorMoreMenu items={[
        { label: "Spara utkast", onSelect: () => parts.save?.onSave(), disabled: busy || !parts.save?.dirty, className: "sm:hidden" },
        ...(view.canApprove ? [{ label: approveLabel, onSelect: () => setApproving(true), disabled: !canApproveNow, className: "sm:hidden" }] : []),
        ...(current ? [{ label: "Ladda ned PDF", onSelect: () => void pdf(current), disabled: busy, className: "sm:hidden" }] : []),
        { label: "Kasta osparade ändringar", onSelect: () => parts.save?.onDiscard(), disabled: !parts.save?.dirty, danger: true },
        { label: "Stäng redigeringen", onSelect: () => void closeEditor() },
      ]} /> : null}
    </EditorActions>
  </EditorBar>;
  // Läsläge's status slot: which version is shown when the draft has changes, otherwise which version applies.
  const readStatus = current && program?.changedSinceApproval
    ? <div className="flex flex-1 items-center sm:basis-32"><EditorSegmented label="Visa" value={source} onChange={setSource}
      options={[{ value: "current", label: `Version ${current.number}` }, { value: "draft", label: "Utkastet" }]} /></div>
    : <EditorStatus tone="saved" testId="self-inspection-save-status">{current ? `Version ${current.number} gäller` : program ? "Inget är fastställt ännu" : ""}</EditorStatus>;

  const readHeading = showDraft ? "Utkast – inte fastställt" : current ? `Version ${current.number} · fastställd ${siDate(current.approvedAt)}${current.approvedByName ? ` av ${current.approvedByName}` : ""}` : "";
  const readIntro = showDraft ? <p className="notice">{current ? "Du ser utkastet, som inte är fastställt. Medarbetarna ser version " + current.number + "." : "Utkastet är inte fastställt. Medarbetarna ser programmet först när en version fastställts."}</p> : null;
  const readVersions = view.canEdit ? view.versions : current ? [current] : [];

  // The editor (?edit=1): the one bar with Redigera, Läsläge and PDF. Läsläge draws the page exactly as it is shown,
  // at the shared width in the middle of the wide editor page.
  if (inEditor && program) return <div className="space-y-5">
    {confirmElement}
    <Checks checks={program.checks} onJump={jump} />
    {mode === "edit"
      ? <DocumentEditor key={program.id} view={view} busy={busy} run={run} onDirtyChange={setDirty} renderBar={bar} />
      : readContent ? <ProgramDocument content={readContent} heading={readHeading} versions={readVersions} bar={(contents) => bar({ status: readStatus, contents })} intro={readIntro} bodyClassName="mx-auto w-full max-w-7xl" />
        : bar({ status: readStatus })}
    {approving && <ApproveDialog view={view} busy={busy} run={run} onClose={() => setApproving(false)} onApproved={() => onEditingChange(false)} />}
  </div>;

  // The page as it is shown (2026-10-07): the shared width, no editor bar. PDF and Redigera programmet stand in the page's
  // top (2026-11-24, docs/ui-system.md: the page's actions top right); here only which version is shown.
  return <div className="space-y-5">
    {confirmElement}
    <Overview view={view} onJump={jump} deviations={deviations} />
    {current && <ReadConfirmation view={view} busy={busy} run={run} />}
    {program && view.canEdit && <Checks checks={program.checks} onJump={jump} />}
    {(current || program) && <div className="flex flex-wrap items-center gap-3" data-testid="self-inspection-page-bar">
      {current && program?.changedSinceApproval && view.canEdit
        ? <EditorSegmented label="Visa" value={source} onChange={setSource} options={[{ value: "current", label: `Version ${current.number}` }, { value: "draft", label: "Utkastet" }]} />
        : <p className="text-sm text-muted-foreground" data-testid="self-inspection-page-status">{current ? `Version ${current.number} gäller` : "Inget är fastställt ännu"}</p>}
    </div>}
    {readContent ? <ProgramDocument content={readContent} heading={readHeading} versions={readVersions} intro={readIntro} editLinks={view.canEdit} />
      : program ? <Panel icon={BookOpen} title="Egenkontrollprogram"><Empty title="Inget är fastställt ännu" description="Medarbetarna ser programmet när en version har fastställts." /></Panel> : null}
    {view.confirmations && current && <Panel icon={Eye} title="Vilka har läst" description={`Bekräftelser för version ${current.number}.`} collapsible defaultCollapsed>
      <ul className="divide-y text-sm" data-testid="self-inspection-confirmations">{view.confirmations.map((item) => <li key={item.personId} className="flex flex-wrap items-center justify-between gap-2 py-2">
        <span>{item.name}</span>
        <span className={cn("rounded-full border px-2.5 py-0.5 text-xs", indicatorBadge(item.confirmedAt ? "success" : "neutral"))}>{item.confirmedAt ? `Läst ${siDate(item.confirmedAt)}` : "Inte bekräftat"}</span>
      </li>)}</ul>
    </Panel>}
  </div>;
}

// ---------- Nivå 1 på mobil ----------

/**
 * Program at level 1 on a phone (2026-10-10: field work, the phone's own lists): the facts of the programme as
 * rows (version, who is responsible, the yearly review), Jag har läst, PDF and the contents as rows – each part of the
 * document is a screen of its own (`&section=`, so Bakåt works) with its text, tables and appendices. Members and
 * administrators read the version in force; the draft, the field check and Redigera programmet are office work in
 * display level 2 – on a phone the ordinary page with Visa mer (A2). Display only – the backend decides who may do what.
 */
export function NativeProgram({ view, busy, run, pdf }: { view: SelfInspectionView; busy: boolean; run: Run; pdf: (version: VersionView) => Promise<void> }) {
  const section = useSearchParams().get("section");
  const createNote = useShowMoreNote("Programmet skapas från Workflows mall i visning 2 (Lagom).");
  const editNote = useShowMoreNote("Redigera, kontrollera och fastställ programmet i visning 2 (Lagom).");
  const current = view.current;
  const program = view.program;
  const content = current?.content ?? null;
  const outline = useMemo(() => content ? programOutline(content.sections) : [], [content]);
  const versions = view.canEdit ? view.versions : current ? [current] : [];
  const toc = content ? tocFor(outline, [{ anchor: "si-requirements", label: "Föreskriftens minsta innehåll" }, ...(versions.length ? [{ anchor: ANCHORS.history, label: "Versioner" }] : [])]) : [];
  const at = section ? toc.findIndex((entry) => entry.anchor === section) : -1;
  useNativeTopBar({ title: "Program" });
  const href = (anchor: string) => `/?view=self_inspection&tab=program&section=${encodeURIComponent(anchor)}`;
  if (content && at >= 0) {
    const shown = toc[at]!;
    const entry = outline.find((item) => item.anchor === shown.anchor);
    const part = entry?.sectionIndex === undefined ? null : content.sections[entry.sectionIndex];
    const next = toc[at + 1];
    return <NativePage testId="native-program-section">
      <h2 className="px-1 pt-2 text-xl font-semibold leading-7 [overflow-wrap:anywhere]" data-testid="native-program-section-title">{shown.label}</h2>
      {part?.legalRef ? <p className="mt-1 flex flex-wrap items-center gap-1.5 px-1 text-xs text-muted-foreground"><Tag>Krav</Tag>{part.legalRef}</p> : null}
      <div className="native-group mt-3 space-y-4 p-4">
        {part ? <MarkedText text={part.body} content={content} /> : null}
        {entry ? entry.kind === "appendix" ? <Appendix entry={entry} content={content} /> : <Blocks blocks={entry.blocks} content={content} entry={entry} sectionBody={part?.body} /> : null}
        {shown.anchor === "si-requirements" ? <Coverage sections={content.sections} /> : null}
        {shown.anchor === ANCHORS.history ? <ul className="divide-y text-sm">{versions.map((version) => <li key={version.id} className="py-2">
          <span className="font-medium">Version {version.number}</span> · {siDate(version.approvedAt)}{version.approvedByName ? ` · ${version.approvedByName}` : ""} · {version.changeReason}
        </li>)}</ul> : null}
      </div>
      {next ? <ListGroup><ListRow title={next.label} subtitle="Nästa del" href={href(next.anchor)} twoLines testId="native-program-next" /></ListGroup> : null}
    </NativePage>;
  }
  if (!view.hasProgram) return <NativePage testId="native-program">
    <ListGroup footer={view.canEdit ? createNote : undefined}>
      <ListEmpty>{view.canEdit ? "Företaget har inget egenkontrollprogram ännu." : "Företagets administratör har ännu inte fastställt något egenkontrollprogram."}</ListEmpty>
    </ListGroup>
  </NativePage>;
  const roles = current?.content.roles ?? (program ? programContent(program).roles : []);
  const responsible = responsibleRoles(roles).flatMap((role) => role.members.map((member) => member.name || "Okänd person"));
  const eres = roles.filter((role) => role.isEre).flatMap((role) => role.members.map((member) => member.name || "Okänd person"));
  const review = view.review;
  const late = review.status === "OVERDUE" ? "Förfallen" : review.status === "DUE_SOON" ? "Snart" : "";
  return <NativePage testId="native-program">
    <ListGroup title="Programmet" testId="native-program-facts">
      <ListFact label="Gällande version">{current ? `Version ${current.number} · fastställd ${siDate(current.approvedAt)}${current.approvedByName ? ` av ${current.approvedByName}` : ""}` : "Ingen fastställd ännu"}</ListFact>
      {program?.changedSinceApproval && current && view.canEdit ? <ListFact label="Utkast" tone="warning">Utkastet har ändringar som inte är fastställda.</ListFact> : null}
      <ListFact label="Ansvarig för programmet" tone={responsible.length ? undefined : "warning"}>{responsible.join(", ") || "Ingen utsedd"}</ListFact>
      <ListFact label="Elinstallatör för regelefterlevnad">{eres.join(", ") || "Ingen utsedd"}</ListFact>
      <ListFact label={late ? `Årlig översyn · ${late}` : "Årlig översyn"} tone={late ? "warning" : undefined}>{`Senaste: ${review.lastReviewedAt ? siDate(review.lastReviewedAt) : "ingen ännu"} · Nästa: ${review.nextDue ? siDate(review.nextDue) : "när en version är fastställd"}`}</ListFact>
    </ListGroup>
    {current ? view.myConfirmation
      ? <ListGroup><ListRow type="round" icon={CheckCircle2} title={`Du har läst version ${current.number}`} subtitle={`Bekräftat ${siDate(view.myConfirmation)}`} chevron={false} testId="self-inspection-confirmed" /></ListGroup>
      : <NativeActions footer={`Läs programmet och bekräfta att du tagit del av version ${current.number}.`}>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => void run({ action: "confirm_read", versionNumber: current.number }, "Tack – din bekräftelse är sparad.")}><CheckCircle2 />Jag har läst</Button>
      </NativeActions> : null}
    {content ? <ListGroup title="Innehåll" testId="native-program-contents">{toc.map((entry) => <ListRow key={entry.anchor} title={entry.label} href={href(entry.anchor)} twoLines />)}</ListGroup>
      : <ListGroup><ListEmpty>Inget är fastställt ännu. Medarbetarna ser programmet när en version har fastställts.</ListEmpty></ListGroup>}
    {current ? <NativeActions footer={view.canEdit ? editNote : undefined}>
      <DownloadButton variant="ghost" disabled={busy} onClick={() => void pdf(current)}>Ladda ned PDF</DownloadButton>
    </NativeActions> : null}
    {view.confirmations && current ? <ListGroup title="Vilka har läst" testId="self-inspection-confirmations">{view.confirmations.map((item) => <ListRow key={item.personId} title={item.name}
      pill={{ label: item.confirmedAt ? `Läst ${siDate(item.confirmedAt)}` : "Inte bekräftat", tone: item.confirmedAt ? "success" : "neutral" }} />)}</ListGroup> : null}
  </NativePage>;
}

// ---------- overview ----------

function Overview({ view, onJump, deviations }: { view: SelfInspectionView; onJump: (anchor?: string) => void; deviations?: { open: number; href: string } }) {
  const current = view.current;
  const program = view.program;
  const roles = current?.content.roles ?? (program ? programContent(program).roles : []);
  const responsible = responsibleRoles(roles).flatMap((role) => role.members.map((member) => member.name || "Okänd person"));
  const eres = roles.filter((role) => role.isEre).flatMap((role) => role.members.map((member) => member.name || "Okänd person"));
  const review = view.review;
  const reviewTone = review.status === "OVERDUE" ? "danger" : review.status === "DUE_SOON" ? "warning" : review.status === "OK" ? "success" : "neutral";
  const counts = (kind: CheckKind) => program?.checks.filter((check) => check.kind === kind).length ?? 0;
  const tile = "rounded-xl border bg-card p-4";
  const label = "text-xs font-medium text-muted-foreground";
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="self-inspection-overview">
    <div className={tile}>
      <p className={label}>Gällande version</p>
      <p className="mt-1 text-base font-semibold">{current ? `Version ${current.number}` : "Ingen fastställd"}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{current ? `Fastställd ${siDate(current.approvedAt)}${current.approvedByName ? ` av ${current.approvedByName}` : ""}` : "Fastställ en första version när utkastet är klart."}</p>
      {program?.changedSinceApproval && current && <p className="mt-2"><Tag tone="warning">Utkastet har ändringar som inte är fastställda</Tag></p>}
    </div>
    <div className={tile}>
      <p className={label}>Ansvarig för programmet</p>
      <p className="mt-1 text-sm font-semibold">{responsible.join(", ") || <span className="text-amber-800 dark:text-amber-200">Ingen utsedd</span>}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">Elinstallatör för regelefterlevnad: {eres.join(", ") || "ingen utsedd"}</p>
    </div>
    <div className={tile}>
      <p className={label}>Årlig översyn</p>
      <p className="mt-1 text-sm">Senaste: <span className="font-semibold">{review.lastReviewedAt ? siDate(review.lastReviewedAt) : "ingen ännu"}</span></p>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">Nästa: <span className="font-semibold">{review.nextDue ? siDate(review.nextDue) : "när en version är fastställd"}</span>
        {review.status !== "NONE" && review.status !== "OK" && <span className={cn("rounded-full border px-2 py-0.5 text-[0.6875rem]", indicatorBadge(reviewTone))}>{review.status === "OVERDUE" ? "Förfallen" : "Snart"}</span>}</p>
      {/* Avvikelser (2026-11-24): a row of the overview, not an action of the page's top. */}
      {deviations ? <p className="mt-1 text-sm">Avvikelser: <Link href={deviations.href} className="font-semibold text-primary hover:underline" data-testid="self-inspection-deviations-link">{deviations.open} {deviations.open === 1 ? "öppen" : "öppna"}</Link></p> : null}
    </div>
    <div className={tile}>
      {program ? <>
        <p className={label}>Kompletteringsbehov</p>
        {/* The whole row is the button and is 44 px high on a touch screen (2026-10-17: "Malltext kvar" was 83 × 20 px and the
            three were 6 px apart); a computer sees the same words and numbers as before. A row without anything to do is plain text. */}
        <ul className="mt-1 space-y-1 text-sm touch:mt-2 touch:space-y-2">
          {(["MISSING", "TEMPLATE", "REMINDER"] as const).map((kind) => {
            const tone = !counts(kind) ? "success" : kind === "MISSING" ? "warning" : "neutral";
            return <li key={kind}>
              <button type="button" className="group flex w-full items-center justify-between gap-2 rounded-lg text-left touch:min-h-11 touch:px-3 touch:enabled:bg-secondary touch:enabled:active:bg-accent"
                disabled={!counts(kind)} onClick={() => onJump(program.checks.find((check) => check.kind === kind)?.anchor)}>
                <span className="group-enabled:group-hover:underline">{CHECK_KINDS[kind].label}</span>
                <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium", indicatorBadge(tone), tone === "neutral" && "touch:bg-card")}>{counts(kind)}</span>
              </button>
            </li>;
          })}
        </ul>
      </> : <>
        <p className={label}>Din bekräftelse</p>
        <p className="mt-1 text-sm font-semibold">{view.myConfirmation ? `Läst ${siDate(view.myConfirmation)}` : current ? "Inte bekräftad ännu" : "–"}</p>
      </>}
    </div>
  </div>;
}

function ReadConfirmation({ view, busy, run }: { view: SelfInspectionView; busy: boolean; run: Run }) {
  const current = view.current!;
  if (view.myConfirmation) return <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="self-inspection-confirmed"><CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />Du bekräftade att du läst version {current.number} {siDate(view.myConfirmation)}.</p>;
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-secondary p-4">
    <p className="text-sm">Läs programmet och bekräfta att du tagit del av version {current.number}. Det visar att du omfattas av programmet.</p>
    <Button disabled={busy} onClick={() => void run({ action: "confirm_read", versionNumber: current.number }, "Tack – din bekräftelse är sparad.")}><CheckCircle2 />Jag har läst</Button>
  </div>;
}

// ---------- the automatic field check and the regulation's minimum ----------

function Checks({ checks, onJump }: { checks: ProgramCheck[]; onJump: (anchor?: string) => void }) {
  const kinds = (["MISSING", "TEMPLATE", "REMINDER"] as const).map((kind) => ({ kind, items: checks.filter((check) => check.kind === kind) }));
  return <Panel title="Kontroll av ifyllda uppgifter" description="Workflow kontrollerar utkastet automatiskt. Kontrollen stoppar inget, så programmet kan fastställas ändå." collapsible defaultCollapsed={!checks.some((check) => check.kind === "MISSING")}
    icon={ClipboardCheck}>
    <div className="space-y-4" data-testid="self-inspection-checks">
      {checks.length ? kinds.filter((group) => group.items.length).map((group) => <section key={group.kind} aria-label={CHECK_KINDS[group.kind].label} data-check-kind={group.kind}
        className={cn("rounded-xl border p-4", group.kind === "MISSING" ? indicatorBadge("warning") : "bg-card")}>
        <p className="flex items-center gap-2 text-sm font-semibold">{group.kind === "MISSING" && <AlertTriangle className="size-4" aria-hidden="true" />}{CHECK_KINDS[group.kind].label} ({group.items.length})</p>
        <p className="mt-0.5 text-xs">{CHECK_KINDS[group.kind].description}</p>
        <ul className="mt-2 space-y-1.5 text-sm touch:space-y-2">{group.items.map((check) => <li key={check.text} className="flex flex-wrap items-start justify-between gap-2">
          <span className={cn("min-w-0 flex-1", check.anchor && "touch:py-2.5")}>{check.text}</span>
          {check.anchor && <button type="button" className="shrink-0 rounded-md text-xs font-medium text-primary hover:underline touch:inline-flex touch:min-h-11 touch:items-center touch:bg-secondary touch:px-3 touch:text-sm touch:hover:no-underline" onClick={() => onJump(check.anchor)}>Gå till</button>}
        </li>)}</ul>
      </section>) : <p className="flex items-center gap-2 text-sm"><CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />Alla fält som kontrolleras är ifyllda.</p>}
      <p className="text-xs text-muted-foreground" data-testid="self-inspection-check-disclaimer">{CHECK_DISCLAIMER}</p>
    </div>
  </Panel>;
}

function Coverage({ sections }: { sections: ProgramContent["sections"] }) {
  const rows = requirementCoverage(sections);
  return <div className="space-y-3" data-testid="self-inspection-coverage">
    <p className="text-xs text-muted-foreground">Kraven i ELSÄK-FS 2017:3 3 kap. med egna ord, och vilka avsnitt som hänvisar till dem. Att ett avsnitt hänvisar till en paragraf betyder inte att kravet är uppfyllt.</p>
    <ul className="divide-y rounded-xl border">{rows.map((row) => <li key={row.ref} className="grid gap-1.5 px-4 py-3 text-sm md:grid-cols-[6rem_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] md:gap-3 [&>*]:min-w-0 [&>*]:[overflow-wrap:anywhere]">
      <span className="font-medium">{row.ref}</span>
      <span>{row.requirement}</span>
      {/* Each link is its own 44 px row on a touch screen (2026-10-17: two links stood 20 px high with nothing between them). */}
      <span>{row.sections.length ? row.sections.map((section) => <button key={section.anchor} type="button" className="mr-2 inline-flex min-h-6 items-center text-left text-primary hover:underline touch:mr-0 touch:flex touch:min-h-11 touch:w-full" onClick={() => goTo(section.anchor)}>{section.title}</button>)
        : <Tag tone="warning">Inget avsnitt hänvisar hit</Tag>}</span>
      <span className="text-xs text-muted-foreground"><span className="md:hidden">Stöd i Workflow: </span>{row.support}</span>
    </li>)}</ul>
  </div>;
}

// ---------- contents list ----------

function useActiveAnchor(anchors: string[]) {
  const [active, setActive] = useState(anchors[0] ?? "");
  const key = anchors.join("|");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((records) => {
      const visible = records.filter((record) => record.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActive(visible.target.id);
    }, { rootMargin: "-20% 0px -65% 0px" });
    for (const anchor of key.split("|")) { const element = document.getElementById(anchor); if (element) observer.observe(element); }
    return () => observer.disconnect();
  }, [key]);
  return active;
}

type TocEntry = { anchor: string; label: string; sub?: boolean };
/** Where a part of the document stops when the contents list jumps to it: just under the sticky editor bar. */
const SCROLL_MARGIN = "scroll-mt-[calc(1.5rem+var(--editor-bar-h,3rem))] lg:scroll-mt-[calc(5rem+var(--editor-bar-h,3rem))]";

function ContentsList({ entries, active, onPick }: { entries: TocEntry[]; active: string; onPick?: () => void }) {
  return <ol className="space-y-0.5 text-sm">{entries.map((entry) => <li key={entry.anchor}>
    <a href={`#${entry.anchor}`} aria-current={entry.anchor === active ? "location" : undefined}
      onClick={(event) => {
        event.preventDefault();
        // A list that folds away (a phone's) closes first and the scroll is worked out after it: the document moves up under the bar when
        // the list closes, so scrolling at once ended a list's height too far down (2026-10-17).
        if (onPick) { onPick(); requestAnimationFrame(() => requestAnimationFrame(() => goTo(entry.anchor))); } else goTo(entry.anchor);
      }}
      className={cn("block rounded-md px-2.5 py-1.5 leading-5 transition-colors hover:bg-muted touch:flex touch:min-h-11 touch:items-center touch:py-1", entry.sub && "pl-5 text-[0.8125rem]",
        entry.anchor === active ? "bg-secondary font-medium text-secondary-foreground" : "text-muted-foreground")}>{entry.label}</a>
  </li>)}</ol>;
}

/** The contents list beside the document on a computer; it stays just under the editor bar while scrolling. */
function ContentsNav({ entries, active }: { entries: TocEntry[]; active: string }) {
  return <nav aria-label="Innehåll" className="hidden lg:block">
    <div className="sticky top-[calc(5rem+var(--editor-bar-h,0px))] max-h-[calc(100dvh-6rem-var(--editor-bar-h,0px))] overflow-y-auto rounded-xl border bg-card p-3" data-testid="self-inspection-contents">
      <p className="mb-2 flex items-center gap-2 px-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><ListTree className="size-4" aria-hidden="true" />Innehåll</p>
      <ContentsList entries={entries} active={active} />
    </div>
  </nav>;
}

/**
 * Smaller screens in the editor bar (2026-10-07: the bar as low as possible on a phone): the contents list is one
 * button in the bar's row, not a row of its own; it opens the list just under the bar.
 */
function ContentsButton({ entries, active }: { entries: TocEntry[]; active: string }) {
  const [open, setOpen] = useState(false);
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!nav.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  const current = entries.find((entry) => entry.anchor === active);
  // Not positioned itself: the list is placed against the sticky bar, in its full width.
  return <nav ref={nav} aria-label="Innehåll i mobilen" className="lg:hidden">
    <Button type="button" variant="ghost" className={cn(EDITOR_BUTTON, "gap-1.5 max-lg:min-w-11")} aria-expanded={open} aria-label="Innehåll" title={current ? `Innehåll · ${current.label}` : "Innehåll"} onClick={() => setOpen((value) => !value)}>
      <ListTree /><span className="max-sm:sr-only">Innehåll</span>
    </Button>
    {open && <div className="absolute inset-x-2 top-full z-40 mt-1 max-h-[60dvh] overflow-y-auto rounded-xl border bg-card p-2 shadow-lg" data-testid="self-inspection-contents-menu">
      <ContentsList entries={entries} active={active} onPick={() => setOpen(false)} />
    </div>}
  </nav>;
}

/** Smaller screens without an editor bar: the contents folded into one line that stays at the top. */
function ContentsMenu({ entries, active }: { entries: TocEntry[]; active: string }) {
  const [open, setOpen] = useState(false);
  const current = entries.find((entry) => entry.anchor === active);
  return <nav aria-label="Innehåll i mobilen" className="sticky top-16 z-10 lg:hidden">
    <div className="rounded-xl border bg-card shadow-xs">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex min-h-11 w-full items-center justify-between gap-2 px-4 text-left text-sm">
        <span className="min-w-0 truncate"><span className="font-semibold">Innehåll</span>{current ? <span className="text-muted-foreground"> · {current.label}</span> : null}</span>
        <ChevronDown className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && <div className="max-h-[60dvh] overflow-y-auto border-t p-2"><ContentsList entries={entries} active={active} onPick={() => setOpen(false)} /></div>}
    </div>
  </nav>;
}

const entryLabel = (entry: OutlineEntry) => entry.kind === "appendix" ? `Bilaga ${entry.number}. ${entry.title}` : entry.number ? `${entry.number}. ${entry.title}` : entry.title;

/** The contents list for an outline, with the requirement overview and the version history at the end. */
function tocFor(outline: OutlineEntry[], extra: TocEntry[]): TocEntry[] {
  return [...outline.map((entry) => ({ anchor: entry.anchor, label: entryLabel(entry) })), ...extra];
}

// ---------- read mode ----------

function SectionHeading({ entry, legalRef, children }: { entry: OutlineEntry; legalRef?: string; children?: React.ReactNode }) {
  return <div className="flex flex-wrap items-start justify-between gap-2 border-b pb-2">
    <div className="min-w-0 max-w-[70ch]">
      <h3 className="text-base font-semibold leading-6">{entryLabel(entry)}</h3>
      {legalRef ? <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><Tag>Krav</Tag>{legalRef}</p> : null}
    </div>
    {children}
  </div>;
}

function Facts({ content }: { content: Pick<ProgramContent, "activityTypes" | "worksOnOthersInstallations" | "registrationCheckedAt"> }) {
  const groups = ACTIVITY_GROUPS.map((group) => ({ label: group.label, types: ACTIVITY_TYPES.filter((type) => type.group === group.key && content.activityTypes.includes(type.key)).map((type) => type.label) })).filter((group) => group.types.length);
  return <dl className="grid gap-4 rounded-xl border bg-muted/20 p-4 text-sm sm:grid-cols-2">
    <div className="sm:col-span-2"><dt className="text-xs font-medium text-muted-foreground">Verksamhetstyper</dt>
      <dd className="mt-1">{groups.length ? <ul className="space-y-1">{groups.map((group) => <li key={group.label}><span className="text-muted-foreground">{group.label}: </span>{group.types.join(", ")}</li>)}</ul> : <Tag tone="warning">Inga angivna</Tag>}</dd></div>
    <div><dt className="text-xs font-medium text-muted-foreground">Arbete på andras anläggningar</dt><dd className="mt-1">{content.worksOnOthersInstallations ? "Ja – verksamheten är registrerad hos Elsäkerhetsverket" : "Nej"}</dd></div>
    <div><dt className="text-xs font-medium text-muted-foreground">Registreringen senast kontrollerad</dt><dd className="mt-1">{content.registrationCheckedAt ? siDate(content.registrationCheckedAt) : <Tag tone="warning">Ej angivet</Tag>}</dd></div>
  </dl>;
}

/**
 * What Workflow fills in under a section, only to read – also in the editor (2026-11-25: "vid redigering av
 * egenkontrollprogrammet skall det bara vara den delen (texten), resten sköts från menyknapparna med respektive inställning").
 * The roles, the chart, the people and the hired staff are changed under their own parts in the tab row; the programme's facts
 * with Programmets uppgifter in the editor's ribbon.
 */
function Blocks({ blocks, content, entry, sectionBody }: { blocks: DataBlock[]; content: ProgramContent; entry: OutlineEntry;
  /** The section's own text: a block it already places with a marker (2026-11-24) is not drawn twice. */ sectionBody?: string }) {
  const people = peopleOverview(content);
  const placed = new Set(sectionBody ? markersIn(sectionBody) : []);
  const shown = blocks.filter((block) => !(block === "orgchart" && placed.has("organisation")) && !(block === "ere" && placed.has("ere")) && !(block === "competence" && placed.has("personal")));
  return <>{shown.map((block) => <div key={block} id={block === "facts" && entry.kind !== "facts" ? ANCHORS.facts : undefined} className="scroll-mt-32">
    {block === "facts" ? <Facts content={content} />
      : block === "ere" ? <EreList roles={content.roles} />
        // Organisation och ansvar (2026-11-24): the chart, read only; it is built under Organisation och ansvar.
        : block === "orgchart" ? <OrgTreeView content={content} />
          : <PeopleTable people={people} />}
  </div>)}</>;
}

function Appendix({ entry, content, editLinks = false }: { entry: OutlineEntry; content: ProgramContent;
  /** The page as it is shown: an admin's discreet way to where the roles are kept (never in the editor, 2026-11-25). */ editLinks?: boolean }) {
  const people = peopleOverview(content);
  return <>
    <Blocks blocks={entry.blocks} content={content} entry={entry} />
    {/* Rollbeskrivningar (2026-11-24): the roles are kept on their own page; the appendix only shows them. */}
    {entry.number === "A" ? <>
      {editLinks ? <p className="text-sm" data-testid="self-inspection-roles-moved">Rollerna ändras i <Link href={selfInspectionHref("roles")} className="text-primary hover:underline">Rollbeskrivningar</Link> och trädet i <Link href={selfInspectionHref("organisation")} className="text-primary hover:underline">Organisation och ansvar</Link>.</p> : null}
      <RolesAppendix roles={content.roles} people={people} />
      {content.commonDuties ? <div className="rounded-xl border bg-muted/20 p-4" data-testid="self-inspection-common-duties"><p className="text-xs font-medium text-muted-foreground">Gemensamt för alla roller</p><ProgramText text={content.commonDuties} className="mt-1" /></div> : null}
    </> : <PeopleAppendix people={people} />}
  </>;
}

/**
 * One part of the document, read or edited. On a computer it is open with its heading, as it always was. On a phone and a tablet
 * (`folded`, 2026-10-17: the document was 28 000 px tall on a phone, 2026-10-18: the editor 22 000 and a tablet 15 000) it is a row
 * of 48 px with the part's name, its marks and an arrow that opens the text – a plain `<details>`, so nothing is hidden for good.
 * `goTo` (the contents list, a check, the requirement overview) opens the part it sends the person to; the part keeps its id for it.
 *
 * The editor (2026-10-18) owns which parts are open (`open`, `onOpenChange`: every part starts folded and the one being worked in is
 * open) and fills the row with `marks` – what the field check found, what is changed and not yet saved – so a folded part still says
 * that something in it needs attention. `tools` (move, remove) stand in the heading while the part is open on a computer and at the
 * top of the opened part when folded. `active` and `onFocusCapture` mark the part the person works in.
 */
function DocumentPart({ id, label, folded, spacing, heading, legalRef, marks, tools, open, onOpenChange, active, onFocusCapture, children }: {
  id: string; label: string; folded: boolean; spacing: string; heading: ReactNode; legalRef?: string; marks?: ReactNode; tools?: ReactNode;
  open?: boolean; onOpenChange?: (open: boolean) => void; active?: boolean; onFocusCapture?: React.FocusEventHandler<HTMLElement>; children: ReactNode;
}) {
  if (!folded) return <section id={id} aria-label={label} className={cn(SCROLL_MARGIN, spacing, active && "outline-2 outline-offset-8 outline-primary/30")} data-active={active ? "" : undefined} onFocusCapture={onFocusCapture}>{heading}{children}</section>;
  // The part being worked in is marked inside its own edges, so the mark never leaves the document's card.
  return <details id={id} className={cn(SCROLL_MARGIN, "group", active && "outline-2 -outline-offset-2 outline-primary/30")} data-testid="self-inspection-fold" data-active={active ? "" : undefined} open={open} onFocusCapture={onFocusCapture}
    onToggle={onOpenChange ? (event) => { if (event.target === event.currentTarget) onOpenChange(event.currentTarget.open); } : undefined}>
    <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-5 py-2 text-base font-semibold leading-6 [&::-webkit-details-marker]:hidden sm:px-8">
      <span className="min-w-0 flex-1"><span className="block [overflow-wrap:anywhere]">{label}</span>{marks}</span>
      <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground -rotate-90 group-open:rotate-0" />
    </summary>
    <div className="space-y-4 px-5 pb-6 pt-1 sm:px-8">
      {tools ? <div className="flex justify-end gap-2" data-testid="self-inspection-part-tools">{tools}</div> : null}
      {legalRef ? <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><Tag>Krav</Tag>{legalRef}</p> : null}
      {children}
    </div>
  </details>;
}

/** The marks in a folded part's row: what the field check found there, and what is changed and not yet saved. */
function PartMarks({ flags, untitled, changed }: { flags?: PartFlags; untitled?: boolean; changed?: "new" | "changed" }) {
  if (!flags?.missing && !flags?.template && !flags?.reminder && !untitled && !changed) return null;
  return <span className="mt-1 flex flex-wrap gap-1" data-testid="self-inspection-part-marks">
    {flags?.missing ? <Tag tone="warning">{flags.missing} saknas</Tag> : null}
    {untitled ? <Tag tone="warning">Rubrik saknas</Tag> : null}
    {flags?.template ? <Tag>Malltext kvar</Tag> : null}
    {flags?.reminder ? <Tag>Påminnelse</Tag> : null}
    {changed ? <Tag tone="primary">{changed === "new" ? "Nytt, inte sparat" : "Ändrat, inte sparat"}</Tag> : null}
  </span>;
}

export function ProgramDocument({ content, heading, versions, bar, intro, bodyClassName, editLinks = false }: { content: ProgramContent; heading: string; versions: VersionView[];
  /** An admin's way from the parts Workflow fills in to where they are kept ("Ändra i Rollbeskrivningar", 2026-11-24); only on the page as it is shown, never in the editor (2026-11-25). */ editLinks?: boolean;
  /** The editor bar above the document; it gets the folded contents list for smaller screens. */
  bar?: (contents: ReactNode) => ReactNode; intro?: ReactNode;
  /** Around the document under the bar: the editor's Läsläge centres it at the shared page width. */
  bodyClassName?: string }) {
  const outline = useMemo(() => programOutline(content.sections), [content.sections]);
  const toc = tocFor(outline, [{ anchor: "si-requirements", label: "Föreskriftens minsta innehåll" }, ...(versions.length ? [{ anchor: ANCHORS.history, label: "Versioner" }] : [])]);
  const active = useActiveAnchor(toc.map((entry) => entry.anchor));
  const folded = useFoldsDocument();
  // A column on phones (so the folded contents list can stay at the top while scrolling), two columns on a computer.
  const body = <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]" data-testid="self-inspection-document">
    <ContentsNav entries={toc} active={active} />
    {bar ? null : <ContentsMenu entries={toc} active={active} />}
    <article className="min-w-0 rounded-xl border bg-card" aria-label={content.title}>
      <header className="border-b px-5 py-5 sm:px-8">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">Egenkontrollprogram</p>
        <h2 className="mt-1 max-w-[70ch] text-xl font-semibold leading-7">{content.title}</h2>
        {heading && <p className="mt-1 text-sm text-muted-foreground">{heading}</p>}
      </header>
      <div className={folded ? "divide-y" : "space-y-10 px-5 py-6 sm:px-8"}>
        {outline.map((entry) => {
          const section = entry.sectionIndex === undefined ? null : content.sections[entry.sectionIndex];
          return <DocumentPart key={entry.anchor} id={entry.anchor} label={entryLabel(entry)} folded={folded} spacing="space-y-4" legalRef={section?.legalRef}
            heading={<SectionHeading entry={entry} legalRef={section?.legalRef} />}>
            {/* A readable line length (about 70 characters); tables, the chart and the appendices keep the full width. */}
            {section && <MarkedText text={section.body} content={content} className="max-w-[70ch]" editLinks={editLinks} />}
            {entry.kind === "appendix" ? <Appendix entry={entry} content={content} editLinks={editLinks} /> : <Blocks blocks={entry.blocks} content={content} entry={entry} sectionBody={section?.body} />}
          </DocumentPart>;
        })}
        <DocumentPart id="si-requirements" label="Föreskriftens minsta innehåll" folded={folded} spacing="space-y-4"
          heading={<div className="border-b pb-2"><h3 className="text-base font-semibold">Föreskriftens minsta innehåll</h3></div>}>
          <Coverage sections={content.sections} />
        </DocumentPart>
        {versions.length > 0 && <DocumentPart id={ANCHORS.history} label="Versioner" folded={folded} spacing="space-y-3"
          heading={<div className="border-b pb-2"><h3 className="text-base font-semibold">Versioner</h3></div>}>
          <ul className="divide-y text-sm">{versions.map((version) => <li key={version.id} className="py-2">
            <span className="font-medium">Version {version.number}</span> · {siDate(version.approvedAt)}{version.approvedByName ? ` · ${version.approvedByName}` : ""} · {version.changeReason}
            <span className="ml-2 font-mono text-[0.6875rem] text-muted-foreground" title="Kontrollsumma (SHA-256) för versionens innehåll">{version.hash.slice(0, 12)}</span>
          </li>)}</ul>
        </DocumentPart>}
      </div>
    </article>
  </div>;
  if (!bar) return <div className="space-y-5">{intro}{body}</div>;
  return <div className="space-y-5">{bar(<ContentsButton entries={toc} active={active} />)}<div className={cn("space-y-5", bodyClassName)}>{intro}{body}</div></div>;
}

// ---------- edit mode ----------

type SectionDraft = { id?: string; key: string; title: string; body: string; legalRef: string };
type DraftState = { title: string; activityTypes: ActivityTypeKey[]; worksOnOthersInstallations: boolean; registrationCheckedAt: string; sections: SectionDraft[] };
const stateOf = (program: NonNullable<SelfInspectionView["program"]>): DraftState => ({
  title: program.title, activityTypes: [...program.activityTypes], worksOnOthersInstallations: program.worksOnOthersInstallations, registrationCheckedAt: program.registrationCheckedAt ?? "",
  sections: [...program.sections].sort((a, b) => a.sortOrder - b.sortOrder).map(({ id, key, title, body, legalRef }) => ({ id, key, title, body, legalRef })),
});
const comparable = (state: DraftState) => JSON.stringify({ ...state, activityTypes: [...state.activityTypes].sort() });
/** Undo history of the text being edited; typing in one field within a moment is one step, like a word processor. */
type History = { states: DraftState[]; index: number; group?: string; at?: number };
const editableTarget = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
const textArea = (index: number) => document.querySelector<HTMLTextAreaElement>(`[data-si-text="${index}"]`);

function DocumentEditor({ view, busy, run, onDirtyChange, renderBar }: { view: SelfInspectionView; busy: boolean; run: Run; onDirtyChange: (dirty: boolean) => void;
  /** The Program tab's one bar, with this editor's undo, status, save and ribbon. */
  renderBar: (parts: BarParts) => ReactNode }) {
  const program = view.program!;
  const [history, setHistory] = useState<History>(() => ({ states: [stateOf(program)], index: 0 }));
  const state = history.states[history.index];
  const setState = useCallback((update: React.SetStateAction<DraftState>, group?: string) => setHistory((current) => {
    const before = current.states[current.index];
    const next = typeof update === "function" ? update(before) : update;
    if (next === before) return current;
    const now = Date.now();
    // The same field again within a moment replaces the last step instead of adding one for every key press.
    if (group && current.group === group && current.at && now - current.at < 1500 && current.index > 0)
      return { states: [...current.states.slice(0, current.index), next], index: current.index, group, at: now };
    const states = [...current.states.slice(0, current.index + 1), next].slice(-100);
    return { states, index: states.length - 1, group, at: now };
  }), []);
  const canUndo = history.index > 0;
  const canRedo = history.index < history.states.length - 1;
  const undo = useCallback(() => setHistory((current) => ({ ...current, index: Math.max(0, current.index - 1), group: undefined })), []);
  const redo = useCallback(() => setHistory((current) => ({ ...current, index: Math.min(current.states.length - 1, current.index + 1), group: undefined })), []);
  // The section being worked in: the ribbon's text and section commands act on it.
  const [active, setActive] = useState<number | null>(null);
  // On a phone and a tablet every part is a folded row (2026-10-18); these are the ones that are open, by anchor. The part being
  // worked in opens by itself (a tap on its row, "Gå till", Nytt avsnitt); the others stay folded, so the page stays short.
  const folded = useFoldsDocument();
  const [openParts, setOpenParts] = useState<ReadonlySet<string>>(() => new Set());
  // Ångra and Gör om bring back an older order of the sections: the open parts follow their sections (not the places they had).
  const shown = useRef({ states: history.states, index: history.index });
  useEffect(() => {
    const before = shown.current;
    shown.current = { states: history.states, index: history.index };
    if (before.states !== history.states || before.index === history.index) return;
    const anchors = remapSectionAnchors([...openParts].map((anchor) => ({ anchor })), before.states[before.index].sections, history.states[history.index].sections).map((item) => item.anchor);
    const kept = new Set([...openParts].filter((anchor) => !/^si-section-\d+$/.test(anchor)));
    for (const anchor of anchors) kept.add(anchor);
    setOpenParts(kept);
  }, [history]); // eslint-disable-line react-hooks/exhaustive-deps -- reads the open parts as they are when the history steps
  const setPartOpen = useCallback((anchor: string, open: boolean) => setOpenParts((current) => current.has(anchor) === open ? current
    : new Set(open ? [...current, anchor] : [...current].filter((item) => item !== anchor))), []);
  // The section whose text the cursor is in: the text commands wait for it, so a click in a date or a checkbox never
  // formats a text the person is not looking at.
  const [textIndex, setTextIndex] = useState<number | null>(null);
  // The revision the text was read at. The editor's own role and competence changes move it along; someone else's do not.
  const [base, setBase] = useState(program.revision);
  const [confirm, confirmElement] = useConfirm();
  const dirty = comparable(state) !== comparable(stateOf(program));
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useUnsavedGuard(dirty, confirm);

  // Programmets uppgifter (2026-11-25): set from the ribbon in a dialog of their own, never in the text.
  const [factsOpen, setFactsOpen] = useState(false);
  const save = async () => {
    if (busy || !dirty) return;
    const next = await run({ action: "save_program", revision: base, title: state.title, activityTypes: state.activityTypes, worksOnOthersInstallations: state.worksOnOthersInstallations,
      registrationCheckedAt: state.registrationCheckedAt || null, sections: state.sections.map(({ id, title, body, legalRef }) => ({ id, title, body, legalRef })) }, "Utkastet är sparat.");
    // New sections got their ids on the server: read them back, so the next save changes them instead of adding them again.
    if (next?.program) { const saved = stateOf(next.program); setBase(next.program.revision); setHistory((current) => ({ states: [...current.states.slice(0, current.index), saved], index: current.index })); }
  };
  // Ctrl+Z / Ctrl+Y outside a field (a field keeps the browser's own undo while typing), Ctrl+S saves.
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; });
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "s") { event.preventDefault(); void saveRef.current(); return; }
      if (editableTarget(event.target)) return;
      if (event.key.toLowerCase() === "z" && !event.shiftKey) { event.preventDefault(); undo(); }
      else if ((event.key.toLowerCase() === "z" && event.shiftKey) || event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [undo, redo]);

  const change = (index: number, patch: Partial<SectionDraft>, group?: string) => setState((current) => ({ ...current, sections: current.sections.map((item, at) => at === index ? { ...item, ...patch } : item) }), group);
  const move = (index: number, by: number) => {
    if (index + by < 0 || index + by >= state.sections.length) return;
    setState((current) => { const sections = [...current.sections]; const [item] = sections.splice(index, 1); sections.splice(index + by, 0, item); return { ...current, sections }; });
    setOpenParts((current) => shiftOpenParts(current, { kind: "move", from: index, to: index + by }));
    setActive(index + by);
    setTextIndex((current) => current === index ? index + by : current);
  };
  const remove = async (index: number) => {
    const section = state.sections[index];
    if (!section || state.sections.length < 2) return;
    if (!await confirm({ title: "Ta bort avsnittet?", message: `”${section.title}” tas bort ur utkastet när du sparar. Fastställda versioner påverkas inte.`, confirmLabel: "Ta bort", tone: "danger" })) return;
    setState((current) => ({ ...current, sections: current.sections.filter((_, at) => at !== index) }));
    setOpenParts((current) => shiftOpenParts(current, { kind: "remove", at: index }));
    setActive(null);
    setTextIndex(null);
  };
  const addSection = () => {
    // A new section goes before Bilagor, which stays last (KTR-14).
    const last = state.sections.length - 1;
    const attachmentsLast = state.sections[last]?.key === "appendices";
    const at = Math.min(active === null ? state.sections.length : active + 1, attachmentsLast ? last : state.sections.length);
    setState((current) => { const sections = [...current.sections]; sections.splice(at, 0, { key: "", title: "Nytt avsnitt", body: "", legalRef: "" }); return { ...current, sections }; });
    setOpenParts((current) => shiftOpenParts(current, { kind: "insert", at }));
    setActive(at);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const field = document.getElementById(`si-section-${at}-title`) as HTMLInputElement | null;
      field?.scrollIntoView({ block: "center", behavior: "smooth" });
      field?.select();
    }));
  };
  /** The ribbon's text commands act on the lines under the cursor in the section being worked in. */
  const format = (kind: LineFormat | "table") => {
    if (textIndex === null) return;
    const area = textArea(textIndex);
    const section = state.sections[textIndex];
    if (!area || !section) return;
    const result = kind === "table" ? insertProgramSnippet(section.body, area.selectionEnd, TEXT_SNIPPETS.table) : formatProgramLines(section.body, area.selectionStart, area.selectionEnd, kind);
    change(textIndex, { body: result.text });
    const index = textIndex;
    requestAnimationFrame(() => { const element = textArea(index); if (element) { element.focus(); element.setSelectionRange(result.start, result.end); } });
  };

  const noSection = active === null || !state.sections[active];
  const groups = programRibbon({
    format, addSection, move: (by) => { if (active !== null) move(active, by); }, remove: () => { if (active !== null) void remove(active); }, facts: () => setFactsOpen(true),
    noText: textIndex === null || !state.sections[textIndex], addAfter: active !== null,
    noUp: noSection || active === 0, noDown: noSection || active === state.sections.length - 1, noRemove: noSection || state.sections.length < 2,
  });
  const discard = async () => {
    if (!dirty || !await confirm({ title: "Kasta ändringarna?", message: "Texten blir som i det sparade utkastet. Roller, personer och kompetens är redan sparade.", confirmLabel: "Kasta", tone: "danger" })) return;
    setState(stateOf(program)); setBase(program.revision);
  };

  // The document as it will read, from the text being edited and the draft's roles and people.
  const content: ProgramContent = { ...programContent(program, undefined, program.extras), title: state.title, activityTypes: state.activityTypes, worksOnOthersInstallations: state.worksOnOthersInstallations,
    registrationCheckedAt: state.registrationCheckedAt || null, sections: state.sections.map(({ key, title, body, legalRef }) => ({ key, title, body, legalRef })) };
  const outline = programOutline(content.sections);
  const toc = tocFor(outline, []);
  const activeAnchor = useActiveAnchor(toc.map((entry) => entry.anchor));
  // What the folded rows say (2026-10-18): the field check per part, and what is changed and not yet saved.
  // The check was made on the saved order; an unsaved move carries its marks with the section.
  const flags = partFlags(outline, remapSectionAnchors(program.checks, program.sections, state.sections));
  const savedSections = new Map(program.sections.map((item) => [item.id, item]));
  const factsChanged = state.registrationCheckedAt !== (program.registrationCheckedAt ?? "") || state.worksOnOthersInstallations !== program.worksOnOthersInstallations
    || [...state.activityTypes].sort().join() !== [...program.activityTypes].sort().join();

  return <div className="space-y-5" data-testid="self-inspection-editor">
    {confirmElement}
    {renderBar({
      history: { canUndo, canRedo, undo, redo },
      status: <EditorStatus tone={dirty ? "unsaved" : "saved"} testId="self-inspection-save-status">{dirty ? "Ändringar som inte är sparade" : "Allt är sparat i utkastet"}</EditorStatus>,
      ribbon: <EditorRibbon label="Redigera programmet" groups={groups} testId="self-inspection-ribbon" />,
      save: { dirty, onSave: () => void save(), onDiscard: () => void discard() },
      contents: <ContentsButton entries={toc} active={activeAnchor} />,
    })}
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <ContentsNav entries={toc} active={activeAnchor} />
      <article className="min-w-0 rounded-xl border bg-card" aria-label={`Redigera ${state.title}`}>
        <header className="border-b px-5 py-5 sm:px-8">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">Egenkontrollprogram · utkast</p>
          <Field id="si-title" label="Programmets namn" value={state.title} onChange={(title) => setState((current) => ({ ...current, title }), "title")} className="mt-2 max-w-xl" />
          <p className="mt-2 max-w-[70ch] text-xs text-muted-foreground">Inget når medarbetarna förrän en version fastställs.</p>
        </header>
        <div className={folded ? "divide-y" : "space-y-10 px-5 py-6 sm:px-8"}>
          {outline.map((entry) => {
            const index = entry.sectionIndex;
            const section = index === undefined ? null : state.sections[index];
            const isActive = index !== undefined && index === active;
            const tools = section && index !== undefined ? <>
              <IconButton label={`Flytta ${section.title} upp`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp /></IconButton>
              <IconButton label={`Flytta ${section.title} ned`} disabled={index === state.sections.length - 1} onClick={() => move(index, 1)}><ArrowDown /></IconButton>
              <RemoveButton label={`Ta bort ${section.title}`} disabled={state.sections.length < 2} onClick={() => void remove(index)} />
            </> : null;
            // A folded part says in its row what needs attention in it and what is changed and not yet saved.
            const saved = section?.id ? savedSections.get(section.id) : undefined;
            const sectionChanged = section && (!saved || saved.title !== section.title || saved.body !== section.body || saved.legalRef !== section.legalRef);
            const changed = sectionChanged ? (saved ? "changed" : "new") : entry.blocks.includes("facts") && factsChanged ? "changed" : undefined;
            return <DocumentPart key={section?.id ?? entry.anchor} id={entry.anchor} label={entryLabel(entry)} folded={folded} spacing="space-y-4 rounded-lg" active={isActive}
              onFocusCapture={index === undefined ? undefined : (event) => { setActive(index); setTextIndex(event.target instanceof HTMLTextAreaElement && event.target.dataset.siText !== undefined ? index : null); }}
              open={openParts.has(entry.anchor)} onOpenChange={(open) => setPartOpen(entry.anchor, open)}
              marks={<PartMarks flags={flags.get(entry.anchor)} untitled={section ? !section.title.trim() : false} changed={changed} />} tools={tools}
              heading={<SectionHeading entry={entry}>{tools && <div className="flex gap-1">{tools}</div>}</SectionHeading>}>
              {section && index !== undefined && <SectionFields index={index} section={section} onChange={(patch, group) => change(index, patch, group)} />}
              {entry.kind === "appendix" ? <Appendix entry={entry} content={content} /> : <Blocks blocks={entry.blocks} content={content} entry={entry} />}
            </DocumentPart>;
          })}
        </div>
      </article>
    </div>
    <EditorRibbonSheet groups={groups} label="Verktyg" icon={Wrench} description="Formatera texten där markören står, lägg till och flytta avsnitt, eller ändra programmets uppgifter." testId="self-inspection-tools-sheet" />
    {factsOpen ? <Modal open onOpenChange={(open) => { if (!open) setFactsOpen(false); }} title="Programmets uppgifter" size="form">
      <div className="space-y-4" data-testid="self-inspection-facts-dialog">
        <FactsEditor state={state} setState={setState} />
        <p className="text-xs text-muted-foreground">Ändringarna hamnar i utkastet och sparas med Spara utkast.</p>
        <DialogActions primary={{ label: "Klar", onClick: () => setFactsOpen(false), testId: "self-inspection-facts-done" }} />
      </div>
    </Modal> : null}
  </div>;
}

function FactsEditor({ state, setState }: { state: DraftState; setState: React.Dispatch<React.SetStateAction<DraftState>> }) {
  return <div className="space-y-4">
    <div className="grid gap-4 md:grid-cols-2">
      <Field id="si-checked" type="date" label="Registreringen hos Elsäkerhetsverket kontrollerad" value={state.registrationCheckedAt} onChange={(registrationCheckedAt) => setState((current) => ({ ...current, registrationCheckedAt }))} />
    </div>
    {/* 2026-10-09: the tick box on a row of its own, not beside a field. */}
    <CheckField id="si-others-installations" label="Företaget arbetar på anläggningar som andra äger" checked={state.worksOnOthersInstallations}
      onChange={(worksOnOthersInstallations) => setState((current) => ({ ...current, worksOnOthersInstallations }))} />
    <fieldset>
      <legend className="text-xs font-medium">Verksamhetstyper</legend>
      <div className="mt-2 grid gap-4 md:grid-cols-2">
        {ACTIVITY_GROUPS.map((group) => <div key={group.key}>
          <p className="text-xs text-muted-foreground">{group.label}</p>
          <div className="mt-1.5 space-y-1.5">{ACTIVITY_TYPES.filter((type) => type.group === group.key).map((type) => <label key={type.key} className="flex items-center gap-2 text-sm">
            <Checkbox checked={state.activityTypes.includes(type.key)} onCheckedChange={(value) => setState((current) => ({ ...current, activityTypes: value === true ? [...current.activityTypes, type.key] : current.activityTypes.filter((key) => key !== type.key) }))} />{activityLabel(type.key)}
          </label>)}</div>
        </div>)}
      </div>
    </fieldset>
  </div>;
}

/**
 * The ribbon of the programme editor (2026-10-07). Without actions (Läsläge) it is drawn the same but switched
 * off, so the bar keeps its height when the mode changes.
 */
type ProgramRibbonActions = {
  format: (kind: LineFormat | "table") => void; addSection: () => void; move: (by: -1 | 1) => void; remove: () => void; facts: () => void;
  noText: boolean; addAfter: boolean; noUp: boolean; noDown: boolean; noRemove: boolean;
};
const READ_ONLY_RIBBON: ProgramRibbonActions = { format: noop, addSection: noop, move: noop, remove: noop, facts: noop, noText: true, addAfter: false, noUp: true, noDown: true, noRemove: true };
function programRibbon(actions: ProgramRibbonActions | null): EditorRibbonGroup[] {
  const { format, addSection, move, remove, facts, noText, addAfter, noUp, noDown, noRemove } = actions ?? READ_ONLY_RIBBON;
  const textHint = (text: string) => noText ? `${text} – klicka först i ett avsnitts text` : text;
  return [
    { label: "Text", items: [
      { key: "heading", label: "Rubrik", icon: Heading, hint: textHint("Rubrik i texten (## )"), onSelect: () => format("heading"), disabled: noText, keepFocus: true },
      { key: "paragraph", label: "Stycke", icon: Pilcrow, hint: textHint("Vanligt stycke utan markering"), onSelect: () => format("paragraph"), disabled: noText, keepFocus: true },
      { key: "bullets", label: "Punktlista", icon: List, hint: textHint("Punktlista (- )"), onSelect: () => format("bullets"), disabled: noText, keepFocus: true },
      { key: "numbered", label: "Numrerad lista", icon: ListOrdered, hint: textHint("Numrerad lista (1. 2. 3.)"), onSelect: () => format("numbered"), disabled: noText, keepFocus: true },
      { key: "table", label: "Tabell", icon: Table2, hint: textHint("Tabell med rader som börjar med |"), onSelect: () => format("table"), disabled: noText, keepFocus: true },
    ] },
    { label: "Avsnitt", items: [
      { key: "add", label: "Nytt avsnitt", icon: ListPlus, hint: addAfter ? "Nytt avsnitt efter det markerade" : "Nytt avsnitt sist i programmet", onSelect: addSection },
      { key: "up", label: "Flytta upp", icon: ArrowUp, hint: "Flytta det markerade avsnittet upp", onSelect: () => move(-1), disabled: noUp, keepFocus: true },
      { key: "down", label: "Flytta ned", icon: ArrowDown, hint: "Flytta det markerade avsnittet ned", onSelect: () => move(1), disabled: noDown, keepFocus: true },
      { key: "remove", label: "Ta bort", icon: Trash2, tone: "danger", hint: "Ta bort det markerade avsnittet", onSelect: remove, disabled: noRemove },
    ] },
    // Programmets uppgifter (2026-11-25): the settings that are not text, in a dialog of their own.
    { label: "Programmet", items: [
      { key: "facts", label: "Uppgifter", icon: ClipboardList, hint: "Verksamhetstyper, arbete på andras anläggningar och när registreringen kontrollerades", onSelect: facts, disabled: !actions },
    ] },
  ];
}

function SectionFields({ index, section, onChange }: { index: number; section: SectionDraft; onChange: (patch: Partial<SectionDraft>, group?: string) => void }) {
  // A readable line length for the text being written (about 70 characters), like the finished document.
  return <div className="max-w-[70ch] space-y-3">
    <div className="grid gap-4 md:grid-cols-2">
      <Field id={`si-section-${index}-title`} label="Rubrik" value={section.title} onChange={(title) => onChange({ title }, `title:${index}`)} />
      <Field id={`si-section-${index}-ref`} label="Hänvisning till krav" value={section.legalRef} onChange={(legalRef) => onChange({ legalRef }, `ref:${index}`)} />
    </div>
    <div className="grid gap-1.5">
      <span className="text-xs font-medium" aria-hidden="true">Text</span>
      {/* Formatted with the ribbon in the editor bar (2026-10-07): Rubrik, Stycke, the lists and Tabell act on the lines under the cursor. */}
      <textarea data-si-text={index} aria-label={`Text för ${section.title}`} className="form-textarea block min-h-48 w-full resize-y text-sm"
        value={section.body} onChange={(event) => onChange({ body: event.target.value }, `body:${index}`)} />
      <p className="text-xs text-muted-foreground">Varje rad blir ett stycke. Använd knapparna i verktygsraden för rubrik, punkt och tabell. Text inom [ ] ska ersättas.</p>
    </div>
  </div>;
}

// ---------- approve ----------

function ApproveDialog({ view, busy, run, onClose, onApproved }: { view: SelfInspectionView; busy: boolean; run: Run; onClose: () => void; /** After a version is approved: back to the page as it is shown. */ onApproved?: () => void }) {
  const program = view.program!;
  const number = (view.current?.number ?? 0) + 1;
  const [reason, setReason] = useState(view.current ? "" : "Första versionen av programmet.");
  const missing = program.checks.filter((check) => check.kind === "MISSING");
  const template = program.checks.filter((check) => check.kind === "TEMPLATE");
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title={`Fastställ version ${number}`} size="compact">
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Utkastet sparas som version {number} och kan inte ändras efteråt. Texten, rollerna, personerna och deras kompetens sparas som de är nu, så senare ändringar påverkar inte versionen. Alla medlemmar ser den nya versionen och påminns om att läsa den.</p>
      {(missing.length > 0 || template.length > 0) && <div className={cn("rounded-xl border p-4 text-sm", indicatorBadge("warning"))} data-testid="self-inspection-warnings" role="status">
        {missing.length > 0 && <><p className="font-semibold">{CHECK_KINDS.MISSING.label} ({missing.length})</p><ul className="mt-1 list-disc space-y-0.5 pl-5">{missing.map((check) => <li key={check.text}>{check.text}</li>)}</ul></>}
        {template.length > 0 && <p className={cn(missing.length > 0 && "mt-2")}>{CHECK_KINDS.TEMPLATE.label}: {template.length}</p>}
        <p className="mt-2 text-xs">Varningarna stoppar inget – programmet kan fastställas ändå.</p>
      </div>}
      <p className="text-xs text-muted-foreground">{CHECK_DISCLAIMER}</p>
      <label className="grid gap-1.5"><span className="text-xs font-medium">Vad har ändrats, eller varför fastställs versionen?</span>
        <textarea className="form-textarea" value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Avbryt</Button>
        <Button disabled={busy || !reason.trim()} onClick={async () => { if (await run({ action: "approve", revision: program.revision, changeReason: reason }, `Version ${number} är fastställd.`)) { onClose(); onApproved?.(); } }}><ShieldCheck />Fastställ</Button>
      </div>
    </div>
  </Modal>;
}
