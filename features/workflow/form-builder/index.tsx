"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { closestCenter, DndContext, DragOverlay, KeyboardSensor, MouseSensor, pointerWithin, TouchSensor, useSensor, useSensors, type Announcements, type CollisionDetection, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { DropdownMenu } from "radix-ui";
import { AlertTriangle, Eye, FileText, FolderOpen, MoreHorizontal, PencilRuler, Plus, Redo2, Rocket, Save, Undo2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/features/kfid/confirm";
import { cn } from "@/lib/utils";
import { formatSwedish } from "@/lib/swedish-time";
import { formLeafBlocks, validateFormDocument, type FormLeafBlock, type FormSection } from "@/lib/workflow/form-document";
import { createBlock, duplicateBlock, emptySection, findEditorBlock, insertBlock, insertionPoint, insertSection, LIBRARY, locate, moveBlock, moveBlockTo, moveSectionTo, removeBlock, uniqueKey, updateBlock, type EditorDocument, type LibraryType } from "@/lib/workflow/form-editor";
import type { PublishIssue } from "@/lib/workflow/form-publish";
import { indicatorBadge } from "../indicator-tone";
import { FormCanvas, type CanvasActions } from "./canvas";
import { FormsPanel, PublishDialog, SidePanel, statusText, VersionsDialog } from "./dialogs";
import { blockName } from "./labels";
import { FieldRibbon, FieldSheetButton } from "./library";
import { LimitsEditor } from "./rounds-settings";
import { MetaPanel } from "./meta-panel";
import { ExecutionPreview } from "./preview";
import { openFormPreviewPdf } from "../form-preview-pdf";
import { KFID_FORM_ID, RISK_FORM_ID } from "@/lib/workflow/builtin-originals";
import { BlockSettings } from "./settings";
import { useFormDraft } from "./use-form-draft";
import { useBuilderTour, useTourSeen } from "./tour";

type Mode = "build" | "preview";
const editableTarget = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
const clock = (value: string) => formatSwedish(value, { timeStyle: "short" });

// Collisions: a section only lands among sections; a block prefers the block under the pointer, then the section's
// body, so dropping on an empty section or below the last block works too.
const collisions: CollisionDetection = (args) => {
  const kind = args.active.data.current?.kind;
  if (kind === "section") return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((item) => item.data.current?.kind === "section") });
  const candidates = args.droppableContainers.filter((item) => item.data.current?.kind !== "section");
  const hits = pointerWithin({ ...args, droppableContainers: candidates });
  const block = hits.find((hit) => candidates.find((item) => item.id === hit.id)?.data.current?.kind === "block");
  if (block) return [block];
  if (hits.length) return hits;
  // Keyboard (no pointer): step between blocks. Moving into an empty section is done with the buttons or "Flytta till avsnitt".
  const blocks = candidates.filter((item) => item.data.current?.kind === "block");
  return closestCenter({ ...args, droppableContainers: blocks.length ? blocks : candidates });
};

/**
 * "Skapa formulär" (Daniel 2026-09-26): straight into an editor. Grunduppgifter on top, then one fixed bar with the
 * editor commands and the field ribbon, and the form as a sheet that uses the width of the workspace. Settings appear
 * only for the selected block. Only the superadmin sees it.
 */
export function FormBuilder({ userName, tourSeen, onTourSeen }: { userName?: string; /** Whether the person has seen the guided tour (their preferences); undefined without a server. */ tourSeen?: boolean; onTourSeen?: () => Promise<void> } = {}) {
  const [confirm, confirmCard] = useConfirm();
  const draft = useFormDraft({ confirm });
  const { snapshot } = draft;
  const document = snapshot.document;
  const [mode, setMode] = useState<Mode>("build");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [metaOpen, setMetaOpen] = useState(true);
  const [formsOpen, setFormsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean; undo?: boolean } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement | null>(null);
  // Control points from a spreadsheet (2026-09-28): added as new sections with their limits; nothing is published.
  const importPoints = async (file: File) => {
    const body = new FormData();
    body.set("file", file);
    body.set("keys", [...formLeafBlocks(document).flatMap((block) => "key" in block ? [block.key] : []), ...document.limits.map((limit) => limit.key)].join(","));
    await run(async () => {
      const response = await fetch("/api/forms/admin/import-points", { method: "POST", body });
      const result = await response.json() as { sections?: FormSection[]; limits?: EditorDocument["limits"]; issues?: string[]; points?: number; error?: string };
      if (!response.ok || !result.sections) throw new Error(result.error || "Filen kunde inte importeras.");
      const sections = result.sections;
      draft.changeDocument((current) => ({ ...current, blocks: [...current.blocks.filter((section) => section.blocks.length || section.title), ...sections], limits: [...current.limits, ...(result.limits ?? []).filter((limit) => !current.limits.some((item) => item.key === limit.key))] }));
      setNotice({ text: `${result.points ?? 0} kontrollpunkter importerades i ${sections.length} avsnitt.${result.issues?.length ? ` ${result.issues.slice(0, 3).join(" ")}` : ""} Granska dem och spara utkastet.` });
    });
  };

  // A new form starts with Grunduppgifter open; an existing one starts collapsed. They fold away by themselves once
  // the form has a name and its first block, so the sheet gets the room.
  useEffect(() => { if (!draft.loading) setMetaOpen(!draft.templateId); }, [draft.loading, draft.templateId]);
  useEffect(() => { setSelectedId(null); setMode("build"); }, [draft.templateId]);
  const leafCount = formLeafBlocks(document).length;
  const hadBlocks = useRef(leafCount > 0);
  useEffect(() => {
    if (leafCount > 0 && !hadBlocks.current && snapshot.meta.name.trim()) setMetaOpen(false);
    hadBlocks.current = leafCount > 0;
  }, [leafCount, snapshot.meta.name]);

  const issues = useMemo(() => validateFormDocument(document).issues, [document]);
  const selected = findEditorBlock(document, selectedId);
  const detail = draft.detail;
  const changed = draft.dirty || Boolean(detail?.hasDraftChanges);
  const status = !draft.templateId ? "Nytt formulär, inte sparat" : detail ? statusText(detail.status, detail.publishedVersion, changed && detail.status !== "DRAFT") : "Utkast";
  const nextVersion = !detail?.latest ? 1 : changed ? detail.latest.version + 1 : detail.latest.version;
  const protocols = detail?.versions.reduce((sum, version) => sum + version.protocols, 0) ?? 0;
  // The preview reads as what the form is: HINTEK's originals and the company's versions of them are a control or a risk assessment, not "Formulär".
  const originalId = draft.base?.id ?? detail?.base?.id ?? draft.templateId;
  const previewArea = originalId === KFID_FORM_ID ? "kfid" : originalId === RISK_FORM_ID ? "risk-assessment" : "forms";

  // ---------- document operations (the same for drag, buttons and keys) ----------
  const select = useCallback((id: string | null) => { setSelectedId(id); if (id) setMode("build"); }, []);
  const add = useCallback((type: LibraryType, at?: { sectionId: string; index: number }) => {
    if (type === "section") {
      const section = emptySection("Nytt avsnitt");
      draft.changeDocument((current) => insertSection(current, section, selectedId));
      select(section.id);
      return;
    }
    // Made from the rendered document (state updaters run later), so the new block can be selected at once.
    const created = createBlock(type, document);
    draft.changeDocument((current) => insertBlock(current, created, at ?? insertionPoint(current, selectedId)));
    select(created.id);
  }, [document, draft, selectedId, select]);

  const patch = useCallback((id: string, value: Partial<FormLeafBlock> | Partial<FormSection>, group: string) => {
    draft.changeDocument((current) => {
      const block = findEditorBlock(current, id);
      let next = value as Record<string, unknown>;
      // The internal code follows the label until it has been changed by hand.
      if (block && "key" in block && "label" in next && typeof next.label === "string" && block.key === uniqueKey(current, block.label, block.id))
        next = { ...next, key: uniqueKey(current, next.label || "falt", block.id) };
      return updateBlock(current, id, next);
    }, group);
  }, [draft]);

  const remove = useCallback((id: string) => {
    const block = findEditorBlock(document, id);
    draft.changeDocument((current) => removeBlock(current, id));
    if (selectedId === id) setSelectedId(null);
    setNotice({ text: `${block?.type === "section" ? `Avsnittet ${block.title || "utan rubrik"}` : block ? blockName(block) : "Blocket"} togs bort.`, undo: true });
  }, [document, draft, selectedId]);

  const actions: CanvasActions = useMemo(() => ({
    select,
    move: (id, delta) => draft.changeDocument((current) => moveBlock(current, id, delta)),
    duplicate: (id) => { const result = duplicateBlock(document, id); draft.changeDocument(() => result.document); if (result.newId) select(result.newId); },
    remove,
    openSettings: (id) => { select(id); setSettingsOpen(true); },
    rename: (id, value) => {
      const block = findEditorBlock(document, id);
      if (!block) return;
      patch(id, block.type === "section" ? { title: value } : block.type === "heading" || block.type === "text" ? { text: value } : block.type === "note" ? { title: value } : { label: value }, `${id}:label`);
    },
    resize: (id, width) => patch(id, { width } as Partial<FormLeafBlock>, `${id}:width`),
  }), [document, draft, patch, remove, select]);

  // ---------- the guided tour (2026-09-28) ----------
  const { seen: tourSeenNow, markSeen } = useTourSeen(tourSeen, onTourSeen);
  const tour = useBuilderTour({ seen: tourSeenNow, markSeen, controls: {
    setMode,
    clearSelection: () => setSelectedId(null),
    openMeta: () => setMetaOpen(true),
    selectMeasured: () => {
      const measured = formLeafBlocks(document).find((block) => (block.type === "field" && block.input === "number") || block.type === "computed" || block.type === "table") ?? formLeafBlocks(document)[0];
      if (!measured) return false;
      setSelectedId(measured.id);
      return true;
    },
  } });

  // ---------- drag and drop ----------
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const nameOf = useCallback((id: string | number) => {
    const text = String(id);
    if (text.startsWith("library:")) return LIBRARY.find((item) => `library:${item.type}` === text)?.label ?? "Fältet";
    if (text.startsWith("body:")) { const section = findEditorBlock(document, text.slice(5)); return section?.type === "section" ? `slutet av ${section.title || "avsnittet"}` : "avsnittet"; }
    const block = findEditorBlock(document, text);
    return !block ? "blocket" : block.type === "section" ? `avsnittet ${block.title || "utan rubrik"}` : blockName(block);
  }, [document]);
  const announcements: Announcements = {
    onDragStart: ({ active }) => `${nameOf(active.id)} är lyft. Flytta med piltangenterna och släpp med mellanslag. Escape avbryter.`,
    onDragOver: ({ active, over }) => over ? `${nameOf(active.id)} är över ${nameOf(over.id)}.` : `${nameOf(active.id)} är utanför formuläret.`,
    onDragEnd: ({ active, over }) => over ? `${nameOf(active.id)} släpptes vid ${nameOf(over.id)}.` : `${nameOf(active.id)} släpptes utan att flyttas.`,
    onDragCancel: ({ active }) => `Flytten av ${nameOf(active.id)} avbröts.`,
  };
  const onDragStart = (event: DragStartEvent) => setDragging(String(event.active.id));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    if (!over || active.id === over.id) return;
    const from = active.data.current as { kind: string; type?: LibraryType } | undefined;
    const to = over.data.current as { kind: string; sectionId?: string } | undefined;
    const target = (current: EditorDocument): { sectionId: string; index: number } | null => {
      if (to?.kind === "block") { const at = locate(current, String(over.id)); return at ? { sectionId: current.blocks[at.section].id, index: at.index } : null; }
      const sectionId = to?.kind === "body" ? to.sectionId! : String(over.id);
      const section = current.blocks.find((item) => item.id === sectionId);
      return section ? { sectionId, index: section.blocks.length } : null;
    };
    if (from?.kind === "library" && from.type) {
      if (from.type === "section") {
        const section = emptySection("Nytt avsnitt");
        draft.changeDocument((current) => insertSection(current, section, to?.kind === "body" ? to.sectionId : String(over.id)));
        select(section.id);
      } else add(from.type, target(document) ?? undefined);
      return;
    }
    if (from?.kind === "section") {
      const fromIndex = document.blocks.findIndex((item) => item.id === active.id);
      const toIndex = document.blocks.findIndex((item) => item.id === over.id);
      if (fromIndex >= 0 && toIndex >= 0) draft.changeDocument((current) => moveSectionTo(current, String(active.id), toIndex > fromIndex ? toIndex + 1 : toIndex));
      return;
    }
    if (from?.kind === "block") draft.changeDocument((current) => {
      const place = target(current);
      const at = locate(current, String(active.id));
      if (!place || !at) return current;
      // Within a section, dropping on a later block puts the block after it (like sorting a list).
      const sameSection = current.blocks[at.section].id === place.sectionId;
      return moveBlockTo(current, String(active.id), place.sectionId, sameSection && to?.kind === "block" && place.index > at.index ? place.index + 1 : place.index);
    });
  };

  // ---------- keys ----------
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "s") { event.preventDefault(); void draft.save(); return; }
      if (editableTarget(event.target)) return;
      if (event.key === "Escape" && selectedId && !window.document.querySelector("[role=dialog], [role=alertdialog], [role=menu]")) { setSelectedId(null); return; }
      if (!mod) return;
      if (event.key.toLowerCase() === "z" && !event.shiftKey) { event.preventDefault(); draft.undo(); }
      else if ((event.key.toLowerCase() === "z" && event.shiftKey) || event.key.toLowerCase() === "y") { event.preventDefault(); draft.redo(); }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [draft, selectedId]);

  // ---------- commands ----------
  const run = async (task: () => Promise<unknown>, success?: string) => {
    setBusy(true); setNotice(null);
    try { await task(); if (success) setNotice({ text: success }); return true; }
    catch (issue) { setNotice({ text: (issue as Error).message, error: true }); return false; }
    finally { setBusy(false); }
  };
  const publish = async (acceptWarnings: boolean) => {
    if ((draft.dirty || !draft.templateId) && !(await draft.save())) { setPublishOpen(false); return; }
    const ok = await run(async () => {
      const result = await draft.command({ action: "publish", draftRevision: draft.currentRevision(), acceptWarnings });
      setNotice({ text: `Version ${String(result?.version ?? "")} är publicerad och visas under Ny uppgift. Befintliga protokoll behåller sin version.` });
    });
    if (ok) setPublishOpen(false);
  };
  const deleteForm = async () => {
    const ok = await confirm({ title: "Radera formuläret permanent?", message: `${snapshot.meta.name || "Formuläret"}, alla dess versioner och historiken tas bort. Det går inte att ångra.${protocols ? ` ${protocols} protokoll finns kvar med sin egen kopia av formuläret.` : ""}`, confirmLabel: "Radera permanent", tone: "danger" });
    if (!ok) return;
    if (await run(() => draft.command({ action: "delete" }), "Formuläret är raderat.")) setVersionsOpen(false);
  };
  const openOriginal = async (id: string) => { if (!(await draft.leave())) return; setFormsOpen(false); await draft.openOriginal(id); };
  const resetToOriginal = async () => {
    const ok = await confirm({ title: "Återställa till HINTEK:s original?", message: `Ert företags version av ${detail?.base?.name ?? "formuläret"} tas bort och ni använder HINTEK:s original igen.${protocols ? ` ${protocols} protokoll behåller sin egen kopia.` : ""}`, confirmLabel: "Återställ till originalet", tone: "danger" });
    if (ok) await run(() => draft.resetToOriginal(), "Ert företag använder HINTEK:s original igen.");
  };
  const openForm = async (id: string) => { if (id === draft.templateId) { setFormsOpen(false); return; } if (!(await draft.leave())) return; setFormsOpen(false); await draft.open(id); };
  const newForm = async () => { if (!(await draft.leave())) return; setFormsOpen(false); draft.startNew(); setMetaOpen(true); window.setTimeout(() => window.document.getElementById("form-meta-name")?.focus(), 50); };
  const reloadStored = async () => {
    if (await confirm({ title: "Läsa in det sparade formuläret?", message: "Dina osparade ändringar i den här fliken försvinner.", confirmLabel: "Läs in det", tone: "danger" })) await draft.open(draft.templateId!);
  };
  const selectIssue = (issue: PublishIssue) => {
    if (issue.meta || !issue.blockId) { setMetaOpen(true); window.setTimeout(() => window.document.getElementById(`form-meta-${issue.meta ?? "name"}`)?.focus(), 50); return; }
    select(issue.blockId);
    window.setTimeout(() => window.document.querySelector(`[data-block-id="${issue.blockId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
  };

  const saveText = draft.status.kind === "saving" ? "Sparar…" : draft.status.kind === "conflict" ? "Ändrat i en annan flik" : draft.status.kind === "error" ? "Kunde inte spara"
    : !draft.templateId ? (draft.dirty ? "Inte sparat, bara på den här enheten" : "Tomt formulär") : draft.dirty ? "Osparade ändringar"
    : draft.status.kind === "saved" ? `Sparad ${clock(draft.status.at)}` : detail ? `Sparad ${clock(detail.updatedAt)}` : "";

  if (draft.loading) return <p role="status" className="text-sm text-muted-foreground">Öppnar formulärbyggaren…</p>;

  const settings = selected
    ? <BlockSettings key={selected.id} document={document} block={selected} issues={issues.filter((issue) => issue.blockId === selected.id)}
        onPatch={(value, group) => patch(selected.id, value, group)} onMove={(delta) => actions.move(selected.id, delta)} onDuplicate={() => actions.duplicate(selected.id)}
        onRemove={() => { remove(selected.id); setSettingsOpen(false); }} onMoveToSection={(sectionId) => draft.changeDocument((current) => moveBlockTo(current, selected.id, sectionId, current.blocks.find((item) => item.id === sectionId)?.blocks.length ?? 0))} />
    : null;
  const selectedTitle = selected ? (selected.type === "section" ? `Avsnitt${selected.title ? ` · ${selected.title}` : ""}` : blockName(selected)) : "";

  return <div className="space-y-5" data-testid="form-builder">
    {confirmCard}
    <input ref={importInput} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" data-testid="import-points-input" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importPoints(file); }} />
    <div className="flex flex-wrap items-start justify-between gap-4" data-tour="builder-header">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Skapa formulär</p>
        <h1 className="page-title mt-1 truncate">{snapshot.meta.name || "Nytt formulär"}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><Badge variant="outline" className={indicatorBadge(detail?.status === "PUBLISHED" ? "success" : detail?.status === "UNPUBLISHED" ? "neutral" : "warning")}>{status}</Badge>{draft.templateId ? `${protocols} protokoll` : "Sparas först när du trycker Spara utkast."}</p>
      </div>
      <div className="flex flex-wrap gap-2" data-tour="builder-start">
        {tour.helpButton}
        <Button type="button" variant="outline" onClick={() => setFormsOpen(true)} data-tour="builder-forms"><FolderOpen />Mina formulär</Button>
        <Button type="button" variant="outline" onClick={() => void newForm()} data-tour="builder-new"><Plus />Nytt formulär</Button>
      </div>
    </div>

    {/* A HINTEK original opened by a company, and the company's own version of one (Daniel 2026-09-27). */}
    {tour.offerCard}
    {draft.base ? <p role="status" className="notice" data-testid="form-original-notice">HINTEK:s original, version {draft.base.version}. När du ändrar något sparas det som ert företags egen version – originalet påverkas inte.</p> : null}
    {detail?.base ? <p role="status" className="notice flex flex-wrap items-center gap-2" data-testid="form-copy-notice">Ert företags version av HINTEK:s {detail.base.name}{detail.base.version ? ` (från version ${detail.base.version})` : ""}.{detail.base.updated ? ` HINTEK har publicerat version ${detail.base.latest} av originalet.` : ""}
      <Button type="button" size="sm" variant="outline" onClick={() => void resetToOriginal()}>Återställ till originalet</Button></p> : null}
    {draft.staleRecoveryAt ? <p role="alert" className={cn("flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm", indicatorBadge("warning"))} data-testid="form-stale-recovery">
      Osparade ändringar från {clock(draft.staleRecoveryAt)} finns på den här enheten, men formuläret har ändrats efter dem. De är inte återställda, så att inget skrivs över.
      <Button type="button" size="sm" variant="outline" onClick={draft.applyStaleRecovery}>Återställ ändå</Button>
      <Button type="button" size="sm" variant="ghost" onClick={draft.discardStaleRecovery}>Förkasta</Button></p> : null}
    {draft.recoveredAt ? <p role="status" className="notice flex flex-wrap items-center gap-2">Osparade ändringar från {clock(draft.recoveredAt)} återställdes från den här enheten.<Button type="button" size="sm" variant="ghost" onClick={() => void draft.discardRecovery()}>Förkasta</Button></p> : null}
    {draft.status.kind === "conflict" ? <p role="alert" className={cn("flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm", indicatorBadge("danger"))}>Formuläret har ändrats i en annan flik. Autosparningen är stoppad så att inget skrivs över.
      <Button type="button" size="sm" variant="outline" onClick={() => void reloadStored()}>Läs in det</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => void draft.saveAsCopy()}>Spara som kopia</Button></p> : null}
    {draft.status.kind === "error" ? <p role="alert" className={cn("rounded-xl border p-3 text-sm", indicatorBadge("danger"))}>{draft.status.message}</p> : null}
    {draft.error ? <p role="alert" className={cn("rounded-xl border p-3 text-sm", indicatorBadge("danger"))}>{draft.error}</p> : null}

    <div data-tour="builder-meta"><MetaPanel meta={snapshot.meta} status={status} version={detail?.publishedVersion ?? null} open={metaOpen} onToggle={() => setMetaOpen((value) => !value)} onChange={(value, group) => draft.changeMeta(value, group)}
      settings={{ report: document.report, moments: document.moments, task: document.task }} onSettings={(value, group) => draft.changeDocument((current) => ({ ...current, ...value }), group)}
      titleFields={formLeafBlocks(document).flatMap((block) => block.type === "field" && block.input === "text" ? [{ key: block.key, label: block.label }] : [])}
      limits={<LimitsEditor document={document} onChange={(patch) => draft.changeDocument((current) => ({ ...current, ...patch }), "limits")} />} /></div>

    <DndContext sensors={sensors} collisionDetection={collisions} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}
      accessibility={{ announcements, screenReaderInstructions: { draggable: "Tryck mellanslag för att lyfta. Flytta med piltangenterna och tryck mellanslag igen för att släppa. Escape avbryter." } }}>
      {/* One fixed bar under the top bar: the editor commands and, while building, the field ribbon. The commands use one
          compact editor height, like a word processor (Daniel 2026-09-27: "mer anpassade för editorns utformning"):
          32 px on a computer; below 1024 px Workflow's 44 px touch height applies. */}
      <div className="sticky top-16 z-30 rounded-xl border bg-card/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/90" data-testid="editor-row" data-tour="builder-bar">
        <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
          <span className="flex">
            <Button type="button" size="icon" variant="ghost" className="size-8" aria-label="Ångra" title="Ångra (Ctrl+Z)" disabled={!draft.canUndo} onClick={draft.undo}><Undo2 /></Button>
            <Button type="button" size="icon" variant="ghost" className="size-8" aria-label="Gör om" title="Gör om (Ctrl+Y)" disabled={!draft.canRedo} onClick={draft.redo}><Redo2 /></Button>
          </span>
          <div className="flex h-8 rounded-[var(--radius-control)] border bg-background/78 p-0.5 max-lg:h-11" role="group" aria-label="Läge" data-tour="builder-mode">
            {([["build", "Bygg", <PencilRuler key="b" />], ["preview", "Förhandsgranska", <Eye key="p" />]] as const).map(([value, label, icon]) =>
              <Button key={value} type="button" className="h-full min-h-0! rounded-[calc(var(--radius-control)-2px)] px-2.5" variant={mode === value ? "secondary" : "ghost"} aria-pressed={mode === value} onClick={() => setMode(value)}>{icon}<span className="max-sm:sr-only">{label}</span></Button>)}
          </div>
          <Button type="button" variant="ghost" className="h-8 px-2.5" title="Öppnar PDF:en med exempeldata i en ny flik" onClick={() => openFormPreviewPdf({ meta: snapshot.meta, document })} data-testid="pdf-preview" data-tour="builder-pdf"><FileText /><span className="max-sm:sr-only">PDF</span></Button>
          <span role="status" className={cn("min-w-0 flex-1 basis-20 truncate text-xs", draft.status.kind === "error" || draft.status.kind === "conflict" ? "text-destructive" : "text-muted-foreground")} data-testid="save-status">
            {draft.dirty || draft.status.kind === "saving" ? <span aria-hidden="true" className="mr-1.5 inline-block size-2 rounded-full bg-amber-500" /> : null}{saveText}
          </span>
          <div className="ml-auto flex items-center gap-2" data-tour="builder-publish-group">
            <Button type="button" variant="outline" className="hidden h-8 px-2.5 sm:inline-flex" disabled={draft.status.kind === "saving"} onClick={() => void draft.save()} data-tour="builder-save"><Save />Spara utkast</Button>
            <Button type="button" className="hidden h-8 px-2.5 sm:inline-flex" onClick={() => setPublishOpen(true)} data-testid="publish-open" data-tour="builder-publish"><Rocket />Publicera version {nextVersion}</Button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild><Button type="button" size="icon" variant="ghost" className="size-8" aria-label="Fler åtgärder"><MoreHorizontal /></Button></DropdownMenu.Trigger>
              <DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={6} className="z-50 w-60 rounded-xl border bg-popover p-1.5 shadow-lg">
                {([
                  ["Spara utkast", () => void draft.save(), false, "sm:hidden"],
                  [`Publicera version ${nextVersion}`, () => setPublishOpen(true), false, "sm:hidden"],
                  ["Importera kontrollpunkter från Excel", () => importInput.current?.click(), false, ""],
                  ["Ladda ned importmall", () => { const link = window.document.createElement("a"); link.href = "/api/forms/admin/import-points"; link.download = "kontrollpunkter-mall.xlsx"; link.click(); }, false, ""],
                  ["Versioner och historik", () => setVersionsOpen(true), !draft.templateId, ""],
                  ...(detail?.base ? [["Återställ till originalet", () => void resetToOriginal(), false, ""] as const] : []),
                  ["Radera formulär permanent", () => void deleteForm(), !draft.templateId, "text-destructive"],
                ] as const).map(([label, onSelect, disabled, className]) =>
                  <DropdownMenu.Item key={label} disabled={disabled} onSelect={onSelect} className={cn("flex cursor-pointer rounded-md px-2 py-2 text-sm outline-none data-[disabled]:cursor-default data-[disabled]:opacity-50 data-[highlighted]:bg-secondary", className)}>{label}</DropdownMenu.Item>)}
                {draft.templateId && protocols > 0 ? <p className="px-2 pb-1 text-[11px] text-muted-foreground">Protokollen behåller sin kopia av formuläret om det raderas.</p> : null}
              </DropdownMenu.Content></DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>
        {/* The icon ribbon in full width under the buttons, on every screen (Daniel 2026-09-29: not a tool panel beside the sheet). */}
        {mode === "build" ? <div className="border-t px-2 py-1 max-md:hidden" data-tour="builder-blocks"><FieldRibbon onAdd={(type) => add(type)} /></div> : null}
      </div>
      {notice ? <p role={notice.error ? "alert" : "status"} className={cn("notice flex flex-wrap items-center gap-2", notice.error && "text-destructive")}>{notice.text}{notice.undo ? <Button type="button" size="sm" variant="ghost" onClick={() => { draft.undo(); setNotice(null); }}><Undo2 />Ångra</Button> : null}</p> : null}

      {mode === "build" ? <div className={cn("grid items-start gap-4", selected && "xl:grid-cols-[minmax(0,1fr)_22rem]")}>
        {/* The sheet: white like a page and as wide as the bar with the icons above (Daniel 2026-09-27). A click on the
            sheet beside the blocks clears the selection. */}
        <div className="min-w-0">
          <div className="min-h-[28rem] w-full rounded-xl border bg-card px-3 pb-8 pt-6 shadow-sm sm:px-6 lg:px-8" onClick={(event) => { if (event.target === event.currentTarget) setSelectedId(null); }} data-testid="form-sheet" data-tour="builder-sheet">
            <FormCanvas document={document} selectedId={selectedId} issues={issues} actions={actions} />
            {issues.length && !selected ? <button type="button" className={cn("mt-6 flex w-full items-center gap-2 rounded-lg border p-2.5 text-left text-xs", indicatorBadge("warning"))} onClick={() => issues[0].blockId && select(issues[0].blockId)} data-testid="form-issues">
              <AlertTriangle className="size-3.5 shrink-0" />{issues.length} att rätta före publicering. Första: {issues[0].message}
            </button> : null}
          </div>
        </div>
        {selected ? <aside aria-label="Inställningar" className="sticky top-52 hidden max-h-[calc(100dvh-14rem)] overflow-y-auto rounded-xl border bg-card xl:block" data-tour="builder-properties">
          <div className="panel-header flex items-center justify-between gap-2 border-b px-4 py-2.5">
            <h2 className="truncate text-sm font-semibold">{selectedTitle}</h2>
            <Button type="button" size="icon" variant="ghost" className="size-8" aria-label="Stäng inställningarna" onClick={() => setSelectedId(null)}><X /></Button>
          </div>
          <div className="p-4">{settings}</div>
        </aside> : null}
      </div> : <div className="mx-auto w-full max-w-[76rem]" data-tour="builder-preview">{/* As wide as the task really is (Daniel 2026-09-29): the page's content width, not the builder's wider page. */}<ExecutionPreview document={document} meta={snapshot.meta} area={previewArea} publisher={detail?.publisher} userName={userName} /></div>}
      {mode === "build" ? <FieldSheetButton onAdd={(type) => add(type)} /> : null}
      <DragOverlay dropAnimation={null}>{dragging ? <div className="rounded-lg border bg-card px-3 py-2 text-sm font-medium shadow-lg">{nameOf(dragging)}</div> : null}</DragOverlay>
    </DndContext>

    {/* Smaller screens: the settings open as a panel on top of the sheet. */}
    <SidePanel open={settingsOpen && Boolean(selected)} onOpenChange={setSettingsOpen} title={selectedTitle || "Inställningar"}>{settings}</SidePanel>
    <FormsPanel open={formsOpen} onOpenChange={setFormsOpen} currentId={draft.templateId} onOpen={(id) => void openForm(id)} onOpenOriginal={(id) => void openOriginal(id)} />
    <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} meta={snapshot.meta} document={document} detail={detail} busy={busy || draft.status.kind === "saving"} onPublish={(accept) => void publish(accept)} onSelectIssue={selectIssue} />
    <VersionsDialog open={versionsOpen} onOpenChange={setVersionsOpen} detail={detail} busy={busy}
      onRestore={(version) => void run(() => draft.command({ action: "restore_version", version, draftRevision: draft.currentRevision() }), `Utkastet är återställt från version ${version}.`).then((ok) => ok && setVersionsOpen(false))}
      onUnpublish={() => void run(() => draft.command({ action: "unpublish" }), "Formuläret är avpublicerat. Befintliga protokoll finns kvar.")}
      onRepublish={() => void run(() => draft.command({ action: "republish" }), "Formuläret är publicerat igen.")}
      onDelete={() => void deleteForm()} />
  </div>;
}
