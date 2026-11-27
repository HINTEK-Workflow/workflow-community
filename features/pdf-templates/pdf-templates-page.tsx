"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Eye, EyeOff, FileText, ListTree, Lock, RotateCcw, Save, Search, SlidersHorizontal, Undo2, X } from "lucide-react";
import { EDITOR_BUTTON, EDITOR_SIDE_PANEL, EDITOR_SIDE_PANEL_HEAD, EditorActions, EditorBar, EditorMoreMenu, EditorPanelEmpty, EditorRibbon, EditorSegmented, EditorStatus, EditorUndoRedo, type EditorRibbonGroup } from "@/components/editor-ribbon";
import { PageHeader, useSubPageTrail } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { SidePanel } from "@/features/workflow/form-builder/dialogs";
import { pdfDocumentDef } from "@/lib/pdf-templates/catalog";
import { PDF_EXAMPLE_VARIANTS } from "@/lib/pdf-templates/example-variants";
import { validateOverride, type PdfTraceTarget } from "@/lib/pdf-templates/model";
import type { PdfEditorBlock, PdfEditorDocument } from "@/lib/pdf-templates/server";
import { useLoadEffect } from "@/lib/use-load-effect";
import { useUnsavedGuard } from "@/lib/workflow/use-unsaved-guard";
import { cn } from "@/lib/utils";
import { PdfPages, type PdfPageSize } from "./pdf-page-canvas";

type Notify = (text: string, error?: boolean) => void;
type View = { edition: string; documents: PdfEditorDocument[]; flagged: number };
/** The editor's wish for one block: null follows the default. `confirm`: keep my text against the new default. */
type Draft = { text: string | null; visible: boolean | null; orderIndex: number | null; confirm?: boolean };
type Drafts = Record<string, Draft>;
/** The drafts of every document at once: a page prints blocks of other documents too (the common texts, a risk step). */
type AllDrafts = Record<string, Drafts>;
type History = { states: AllDrafts[]; index: number; group?: string; at?: number };
type Selected = { doc: string; id: string; page?: number; y?: number };
type Rendered = { pdf: Uint8Array; text: string; targets: PdfTraceTarget[]; pages: PdfPageSize[] };

export const PDF_TEMPLATES_HREF = "/?view=pdf_templates";
const docHref = (type: string) => `${PDF_TEMPLATES_HREF}&section=${encodeURIComponent(type)}`;
/** The content width from which the settings stand beside the page; narrower, they open as a layer. */
const NO_TARGETS: readonly PdfTraceTarget[] = [];
const NO_PAGES: readonly PdfPageSize[] = [];
const SIDE_BY_SIDE = 1024;
/** Narrower pages than this are too small to type on: a tap opens the layer with the text field. */
const IN_PLACE_FROM = 480;

const draftsOf = (doc: PdfEditorDocument): Drafts => Object.fromEntries(doc.blocks.filter((block) => block.override).map((block) => [block.id, { text: block.override!.text, visible: block.override!.visible, orderIndex: block.override!.orderIndex }]));
const allDraftsOf = (documents: readonly PdfEditorDocument[]): AllDrafts => Object.fromEntries(documents.map((doc) => [doc.type, draftsOf(doc)]));
const sameDraft = (a: Draft | undefined, b: Draft | undefined) => (a?.text ?? null) === (b?.text ?? null) && (a?.visible ?? null) === (b?.visible ?? null) && (a?.orderIndex ?? null) === (b?.orderIndex ?? null) && Boolean(a?.confirm) === Boolean(b?.confirm);
const emptyDraft = (draft: Draft) => draft.text === null && draft.visible === null && draft.orderIndex === null && !draft.confirm;
const sameDrafts = (a: Drafts, b: Drafts) => [...new Set([...Object.keys(a), ...Object.keys(b)])].every((id) => sameDraft(a[id], b[id]));

/**
 * PDF-mallar (2026-11-03 and 2026-11-04: "PDF:erna kan jag inte alls redigera med en editor som jag kan med
 * egenkontrollprogrammet eller startsidan? Det vill jag ju."): the document itself is the canvas, like the landing editor. The
 * real generator draws the real PDF with invented data; pdf.js shows those very pages, and the generator reports where each
 * template text landed. A click on a text edits it in place and the page is drawn again; the tools on the text hide, show and
 * move it; the panel holds the block's rules, its placeholders, "Förvalet ändrades" and the list of all texts. Texts,
 * visibility and order only, never the layout. Superadmin only; the server checks every call.
 */
export function PdfTemplatesPage({ notify, section, contentLinks = false }: { notify: Notify; section?: string | null; /** The person can open Skapa formulär and Egenkontroll. */ contentLinks?: boolean }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  // Kept stable: a new function on every drawing read the whole view again, ten times a second (2026-11-05).
  const load = useCallback(async () => {
    try { setView(await api<View>("/api/superadmin/pdf-templates", { cache: "no-store" })); setError(""); }
    catch (cause) { setError((cause as Error).message); }
  }, []);
  useLoadEffect(load);
  return <div className="space-y-4" data-testid="pdf-templates">
    <PageHeader title="PDF-mallar" description="Klicka på en text i dokumentet och skriv. Layouten följer designen." />
    {error ? <p role="alert" className="notice text-destructive">{error}</p> : null}
    {!view && !error ? <p className="page-description">Hämtar mallarna…</p> : null}
    {view ? <PdfEditor key={view.edition} view={view} section={section ?? null} contentLinks={contentLinks} notify={notify} onSaved={setView} onReload={load} /> : null}
  </div>;
}

function PdfEditor({ view, section, contentLinks, notify, onSaved, onReload }: { view: View; section: string | null; contentLinks: boolean; notify: Notify; onSaved: (view: View) => void; onReload: () => Promise<void> }) {
  const documents = view.documents;
  const docByType = useMemo(() => new Map(documents.map((doc) => [doc.type, doc])), [documents]);
  const [docType, setDocType] = useState(() => docByType.has(section ?? "") ? section! : documents[0]!.type);
  const doc = docByType.get(docType)!;
  useSubPageTrail(section || docType !== documents[0]!.type ? { label: doc.name, href: PDF_TEMPLATES_HREF } : null);
  const variants = PDF_EXAMPLE_VARIANTS[docType as keyof typeof PDF_EXAMPLE_VARIANTS] ?? [];
  const [variantBy, setVariantBy] = useState<Record<string, string>>({});
  const variant = variantBy[docType] ?? variants[0]?.key ?? null;
  const saved = useMemo(() => allDraftsOf(documents), [documents]);
  const [history, setHistory] = useState<History>({ states: [saved], index: 0 });
  const drafts = history.states[history.index]!;
  const [selected, setSelected] = useState<Selected | null>(null);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<"block" | "all">("block");
  const [panelOpen, setPanelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState("");
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const [hostWidth, setHostWidth] = useState(0);
  const host = useRef<HTMLDivElement>(null);

  const dirtyDocs = useMemo(() => documents.filter((item) => !sameDrafts(drafts[item.type] ?? {}, saved[item.type] ?? {})), [documents, drafts, saved]);
  const dirty = dirtyDocs.length > 0;
  useUnsavedGuard(dirty && !busy, confirm);

  useEffect(() => {
    const element = host.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () => setHostWidth(Math.round(element.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const sideBySide = hostWidth >= SIDE_BY_SIDE;

  const change = useCallback((update: (current: AllDrafts) => AllDrafts, group?: string) => setHistory((current) => {
    const before = current.states[current.index]!;
    const next = update(before);
    if (next === before) return current;
    setStatus(null);
    const now = Date.now();
    // The same text again within a moment replaces the last step instead of adding one for every key press.
    if (group && current.group === group && current.at && now - current.at < 1500 && current.index > 0)
      return { states: [...current.states.slice(0, current.index), next], index: current.index, group, at: now };
    const states = [...current.states.slice(0, current.index + 1), next].slice(-100);
    return { states, index: states.length - 1, group, at: now };
  }), []);
  const canUndo = history.index > 0;
  const canRedo = history.index < history.states.length - 1;
  const undo = useCallback(() => setHistory((current) => ({ ...current, index: Math.max(0, current.index - 1), group: undefined })), []);
  const redo = useCallback(() => setHistory((current) => ({ ...current, index: Math.min(current.states.length - 1, current.index + 1), group: undefined })), []);

  const patch = useCallback((docId: string, id: string, values: Partial<Draft>, group?: string) => change((all) => {
    const own = all[docId] ?? {};
    const next: Draft = { ...(own[id] ?? { text: null, visible: null, orderIndex: null }), ...values };
    if (sameDraft(next, own[id])) return all;
    const copy = { ...own };
    if (emptyDraft(next)) delete copy[id]; else copy[id] = next;
    return { ...all, [docId]: copy };
  }, group), [change]);

  const blockOf = useCallback((docId: string, id: string) => docByType.get(docId)?.blocks.find((block) => block.id === id) ?? null, [docByType]);
  const textOf = useCallback((docId: string, block: PdfEditorBlock) => drafts[docId]?.[block.id]?.text ?? block.defaultText, [drafts]);
  const visibleOf = useCallback((docId: string, block: PdfEditorBlock) => block.mayHide ? drafts[docId]?.[block.id]?.visible ?? true : true, [drafts]);
  const setText = useCallback((docId: string, block: PdfEditorBlock, text: string) => patch(docId, block.id, { text: text === block.defaultText ? null : text, confirm: undefined }, `${docId}:${block.id}`), [patch]);

  const errorOf = useCallback((docId: string, block: PdfEditorBlock) => {
    const draft = drafts[docId]?.[block.id];
    const owner = docByType.get(docId);
    const def = pdfDocumentDef(docId)?.blocks.find((item) => item.id === block.id);
    if (!draft || !def || !owner) return null;
    // What is stored on a text set elsewhere cannot be changed here, so it stops nothing; the server refuses a change.
    if (block.elsewhere) return null;
    const groupSize = block.group ? owner.blocks.filter((other) => other.group === block.group).length : 0;
    return validateOverride(def, { text: draft.text, visible: draft.visible, orderIndex: draft.orderIndex }, groupSize);
  }, [drafts, docByType]);
  const invalid = useMemo(() => dirtyDocs.some((item) => item.blocks.some((block) => errorOf(item.type, block))), [dirtyDocs, errorOf]);

  // The groups' order as it stands: the drafts' places, else the defaults'.
  const groupOrder = useCallback((docId: string, group: string) => (docByType.get(docId)?.blocks ?? []).filter((block) => block.group === group)
    .map((block, index) => ({ block, place: drafts[docId]?.[block.id]?.orderIndex ?? index }))
    .sort((a, b) => a.place - b.place).map((item) => item.block), [docByType, drafts]);
  const move = (docId: string, block: PdfEditorBlock, step: -1 | 1) => {
    if (!block.group) return;
    const order = groupOrder(docId, block.group);
    const from = order.findIndex((item) => item.id === block.id);
    const to = from + step;
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to]!, order[from]!];
    const defaults = (docByType.get(docId)?.blocks ?? []).filter((other) => other.group === block.group);
    const isDefault = order.every((item, index) => defaults[index]!.id === item.id);
    change((all) => {
      const copy = { ...(all[docId] ?? {}) };
      order.forEach((item, index) => {
        const next: Draft = { ...(copy[item.id] ?? { text: null, visible: null, orderIndex: null }), orderIndex: isDefault ? null : index };
        if (emptyDraft(next)) delete copy[item.id]; else copy[item.id] = next;
      });
      return { ...all, [docId]: copy };
    });
  };

  // ---------- the page: the real PDF with the drafts, drawn again a moment after the last change ----------
  const preview = usePreview(docType, variant, drafts, docByType);
  const targets = preview.state?.targets ?? NO_TARGETS;

  // Which of this document's examples print which block: where the list of texts goes to show one.
  // It draws every example of the document (up to eight seconds on the server), so it is read only when something needs it: the list
  // of all texts, or a chosen text that this example does not print.
  const [coverage, setCoverage] = useState<Record<string, Record<string, Record<string, string[]>>>>({});
  const waitingFor = useRef<{ type: string; doc: string; id: string } | null>(null);
  const needsCoverage = tab === "all" || Boolean(selected && preview.state && !targets.some((target) => target.doc === selected.doc && target.id === selected.id));
  useEffect(() => {
    if (coverage[docType] || !needsCoverage) return;
    let active = true;
    void api<{ coverage: Record<string, Record<string, string[]>> }>(`/api/superadmin/pdf-templates/preview?type=${encodeURIComponent(docType)}`, { cache: "no-store" })
      .then((answer) => {
        if (!active) return;
        setCoverage((current) => ({ ...current, [docType]: answer.coverage }));
        // A text chosen in the list before the answer came: the example that prints it is shown now.
        const waiting = waitingFor.current;
        if (waiting?.type !== docType) return;
        waitingFor.current = null;
        const other = answer.coverage[waiting.doc]?.[waiting.id]?.[0];
        if (other) setVariantBy((current) => ({ ...current, [docType]: other }));
      }).catch(() => undefined);
    return () => { active = false; };
  }, [docType, coverage, needsCoverage]);

  const chooseDocument = (type: string) => {
    setDocType(type);
    setSelected(null);
    setEditing(false);
    setConflict("");
    window.history.replaceState(window.history.state, "", docHref(type));
  };

  const select = (target: Selected, edit: boolean) => {
    setSelected(target);
    setTab("block");
    const block = blockOf(target.doc, target.id);
    const inPlace = edit && Boolean(block?.mayEdit) && preview.pageWidth >= IN_PLACE_FROM;
    setEditing(inPlace);
    if (!sideBySide && !inPlace) setPanelOpen(true);
  };

  // A text chosen in the list: shown on this page, or on the example that prints it.
  const goTo = (docId: string, block: PdfEditorBlock) => {
    setSelected({ doc: docId, id: block.id });
    setEditing(false);
    setTab("block");
    const here = targets.find((target) => target.doc === docId && target.id === block.id);
    if (here) { scrollToTarget(here, preview.pages); return; }
    if (!coverage[docType]) { waitingFor.current = { type: docType, doc: docId, id: block.id }; return; }
    const other = coverage[docType]?.[docId]?.[block.id]?.[0];
    if (other && other !== variant) setVariantBy((current) => ({ ...current, [docType]: other }));
  };
  // After another example or a change was drawn the selected text is brought into view once.
  const pendingScroll = useRef<string | null>(null);
  useEffect(() => { pendingScroll.current = selected ? `${selected.doc}:${selected.id}` : null; }, [selected?.doc, selected?.id, variant]); // eslint-disable-line react-hooks/exhaustive-deps -- once per choice
  useEffect(() => {
    if (!selected || editing || pendingScroll.current !== `${selected.doc}:${selected.id}`) return;
    const here = targets.find((target) => target.doc === selected.doc && target.id === selected.id);
    if (here) { pendingScroll.current = null; if (selected.page === undefined) scrollToTarget(here, preview.pages); }
  }, [targets, selected, editing, preview.pages]);

  // Ctrl+Z / Ctrl+Y outside a text being edited (the text keeps the browser's own undo while typing), Ctrl+S saves.
  const saveRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "s") { event.preventDefault(); void saveRef.current(); return; }
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest("input, textarea, select")) return;
      if (event.key.toLowerCase() === "z" && !event.shiftKey) { event.preventDefault(); undo(); }
      else if ((event.key.toLowerCase() === "z" && event.shiftKey) || event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [undo, redo]);

  const save = async () => {
    if (busy || !dirty) return;
    if (invalid) { setStatus({ text: "Rätta texterna som är markerade först.", error: true }); return; }
    setBusy(true);
    setStatus(null);
    let next = documents;
    try {
      for (const item of dirtyDocs) {
        const blocks = Object.entries(drafts[item.type] ?? {}).map(([blockId, draft]) => ({ blockId, text: draft.text, visible: draft.visible, orderIndex: draft.orderIndex, ...(draft.confirm ? { confirm: true } : {}) }));
        const answer = await api<{ changed: string[]; document: PdfEditorDocument }>("/api/superadmin/pdf-templates", { method: "PUT", body: JSON.stringify({ documentType: item.type, basedOn: item.token, blocks }) });
        next = next.map((doc) => doc.type === answer.document.type ? answer.document : doc);
      }
      const nowSaved = allDraftsOf(next);
      // What the server stored (a text equal to its default follows the default) is the state from here on.
      setHistory((current) => ({ states: [...current.states.slice(0, current.index), nowSaved], index: current.index }));
      onSaved({ ...view, documents: next, flagged: next.reduce((sum, doc) => sum + doc.flagged + doc.legal, 0) });
      setStatus({ text: "Mallen är sparad. Nya dokument använder den." });
      notify("Mallen är sparad. Nya dokument använder den.");
    } catch (cause) {
      if (next !== documents) onSaved({ ...view, documents: next, flagged: next.reduce((sum, doc) => sum + doc.flagged + doc.legal, 0) });
      const code = (cause as { status?: number }).status;
      if (code === 409) setConflict((cause as Error).message);
      else setStatus({ text: (cause as Error).message, error: true });
    } finally { setBusy(false); }
  };
  useEffect(() => { saveRef.current = save; });

  const discard = async () => {
    if (!dirty || !(await confirm({ title: "Kasta ändringarna?", message: "Allt du har ändrat sedan du sparade senast tas bort.", confirmLabel: "Kasta", tone: "danger" }))) return;
    change(() => saved);
    setEditing(false);
  };
  const resetDocument = async () => {
    if (!Object.keys(drafts[docType] ?? {}).length) return;
    if (!(await confirm({ title: "Återställa hela dokumentet?", message: "Alla ändringar i det här dokumentet tas bort när du sparar. Förvalen gäller igen.", confirmLabel: "Återställ" }))) return;
    change((all) => ({ ...all, [docType]: {} }));
    setEditing(false);
  };
  const openPdf = () => {
    if (!preview.state) return;
    const url = URL.createObjectURL(new Blob([preview.state.pdf.slice()], { type: "application/pdf" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const block = selected ? blockOf(selected.doc, selected.id) : null;
  const selectedDoc = selected?.doc ?? docType;
  const flaggedOf = (docId: string, item: PdfEditorBlock) => (item.state === "changed" || item.state === "legal") && !drafts[docId]?.[item.id]?.confirm && (drafts[docId]?.[item.id]?.text ?? null) === (item.override?.text ?? null);
  const flaggedHere = doc.blocks.filter((item) => flaggedOf(docType, item)).length;
  const order = block?.group ? groupOrder(selectedDoc, block.group) : [];
  const place = block ? order.findIndex((item) => item.id === block.id) : -1;
  const shownNow = block ? visibleOf(selectedDoc, block) : true;
  const draft = block ? drafts[selectedDoc]?.[block.id] : undefined;
  const hideBlock = (docId: string, item: PdfEditorBlock, visible: boolean) => patch(docId, item.id, { visible: visible ? null : false });
  const resetBlock = (docId: string, item: PdfEditorBlock) => patch(docId, item.id, { text: null, visible: null, confirm: undefined });
  const openSettings = () => { if (!sideBySide) setPanelOpen(true); };

  const ribbon: EditorRibbonGroup[] = [
    { label: "Markerad text", items: [
      { key: "up", label: "Flytta upp", icon: ArrowUp, hint: "Flytta upp i gruppen", onSelect: () => block && move(selectedDoc, block, -1), disabled: !block?.group || place <= 0 },
      { key: "down", label: "Flytta ned", icon: ArrowDown, hint: "Flytta ned i gruppen", onSelect: () => block && move(selectedDoc, block, 1), disabled: !block?.group || place < 0 || place === order.length - 1 },
      { key: "show", label: shownNow ? "Visas" : "Dold", labels: ["Visas", "Dold"], icon: shownNow ? Eye : EyeOff, hint: block && !block.mayHide ? "Krävs – kan inte döljas" : "Visa eller dölj texten", onSelect: () => block && hideBlock(selectedDoc, block, !shownNow), disabled: !block?.mayHide, pressed: Boolean(block) && shownNow },
      { key: "reset", label: "Återställ", icon: RotateCcw, hint: "Återställ texten till förvalet", onSelect: () => block && resetBlock(selectedDoc, block), disabled: !draft || (draft.text === null && draft.visible === null && !draft.confirm) },
      { key: "settings", label: "Inställningar", icon: SlidersHorizontal, hint: "Textens regler och platshållare", onSelect: () => { setTab("block"); openSettings(); }, disabled: !block },
    ] },
    { label: "Dokumentet", items: [
      { key: "all", label: "Alla texter", icon: ListTree, hint: "Alla texter i dokumentet, också de som inte står i det här exemplet", onSelect: () => { setTab("all"); openSettings(); } },
      { key: "open", label: "Visa PDF", icon: FileText, hint: "Öppna den riktiga filen", onSelect: openPdf, disabled: !preview.state },
      { key: "reset-all", label: "Återställ allt", icon: RotateCcw, hint: "Återställ hela dokumentet till förvalen", onSelect: () => void resetDocument(), disabled: !Object.keys(drafts[docType] ?? {}).length },
    ] },
  ];

  const panelContent = <SettingsPanel tab={tab} onTab={setTab} doc={doc} docType={docType} block={block} blockDoc={selectedDoc} docName={(type) => docByType.get(type)?.name ?? type}
    placeholders={docByType.get(selectedDoc)?.placeholders ?? {}} draft={draft} text={block ? textOf(selectedDoc, block) : ""} visible={shownNow} error={block ? errorOf(selectedDoc, block) : null} flagged={Boolean(block && flaggedOf(selectedDoc, block))}
    first={place <= 0} last={place < 0 || place === order.length - 1} printedHere={Boolean(selected && targets.some((target) => target.doc === selected.doc && target.id === selected.id))} printedElsewhere={block ? coverage[docType]?.[selectedDoc]?.[block.id] ?? [] : []} variants={variants}
    groupName={block?.group ? docByType.get(selectedDoc)?.groups[block.group] ?? block.group : null}
    onText={(value) => block && setText(selectedDoc, block, value)} onVisible={(value) => block && hideBlock(selectedDoc, block, value)} onMove={(step) => block && move(selectedDoc, block, step)} onReset={() => block && resetBlock(selectedDoc, block)}
    onKeep={() => block && patch(selectedDoc, block.id, { text: block.override?.text ?? null, confirm: true })} onTakeDefault={() => block && patch(selectedDoc, block.id, { text: null, confirm: undefined })}
    onShowVariant={(key) => setVariantBy((current) => ({ ...current, [docType]: key }))}
    onChoose={(item) => goTo(docType, item)} textOf={(item) => textOf(docType, item)} visibleOf={(item) => visibleOf(docType, item)} flaggedOf={(item) => flaggedOf(docType, item)} changedOf={(item) => Boolean(drafts[docType]?.[item.id])}
    onPage={(item) => targets.some((target) => target.doc === docType && target.id === item.id)} selectedId={selected?.doc === docType ? selected.id : null} />;

  const hiddenHere = doc.blocks.filter((item) => item.mayHide && !visibleOf(docType, item));
  const pageWidth = preview.pageWidth;

  return <div ref={host} className="space-y-4" data-testid="pdf-template-editor" data-document={docType}>
    {confirmElement}
    <EditorBar testId="pdf-template-toolbar" ribbon={<EditorRibbon label="Redigera dokumentet" groups={ribbon} testId="pdf-template-ribbon" />}>
      <EditorUndoRedo canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} />
      <label className="min-w-0 shrink max-sm:w-full"><span className="sr-only">Dokument</span>
        <select className="form-select h-8 max-w-full py-0 text-sm max-lg:h-11 sm:w-56" value={docType} onChange={(event) => chooseDocument(event.target.value)} data-testid="pdf-template-document">
          {documents.map((item) => <option key={item.type} value={item.type}>{item.name}{item.flagged + item.legal ? ` (${item.flagged + item.legal} att se över)` : dirtyDocs.includes(item) ? " (ändrad)" : ""}</option>)}
        </select>
      </label>
      {variants.length > 1 ? <label className="min-w-0 shrink max-sm:w-full"><span className="sr-only">Exempel</span>
        <select className="form-select h-8 max-w-full py-0 text-sm max-lg:h-11 sm:w-44" value={variant ?? ""} onChange={(event) => setVariantBy((current) => ({ ...current, [docType]: event.target.value }))} data-testid="pdf-template-variant">
          {variants.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
      </label> : null}
      <EditorStatus tone={status?.error ? "error" : dirty && !busy ? "unsaved" : "saved"} testId="pdf-template-status">{busy ? "Sparar…" : status?.text ?? (dirty ? "Ändringar som inte är sparade" : flaggedHere ? `${flaggedHere} att se över` : "Allt är sparat")}</EditorStatus>
      <EditorActions>
        <Button type="button" variant="ghost" className={cn(EDITOR_BUTTON, "max-sm:hidden")} disabled={!dirty || busy} onClick={() => void discard()} data-testid="pdf-template-cancel"><Undo2 />Avbryt</Button>
        <Button type="button" variant="outline" className={EDITOR_BUTTON} disabled={!dirty || busy} onClick={() => void save()} data-testid="pdf-template-save"><Save />Spara</Button>
        <EditorMoreMenu testId="pdf-template-more" items={[
          { label: "Alla texter", onSelect: () => { setTab("all"); openSettings(); }, testId: "pdf-template-all" },
          { label: "Visa PDF", onSelect: openPdf, disabled: !preview.state, testId: "pdf-template-open" },
          { label: "Kasta osparade ändringar", onSelect: () => void discard(), disabled: !dirty },
          { label: "Återställ hela dokumentet", onSelect: () => void resetDocument(), disabled: !Object.keys(drafts[docType] ?? {}).length, testId: "pdf-template-reset-all" },
        ]} />
      </EditorActions>
    </EditorBar>
    {conflict ? <div role="alert" className="notice flex flex-wrap items-center gap-3 text-sm" data-testid="pdf-template-conflict">
      <span className="min-w-0 flex-1">{conflict}</span>
      <Button variant="outline" size="sm" onClick={() => { setConflict(""); void onReload(); }}>Ladda om</Button>
    </div> : null}
    {preview.error ? <p role="alert" className="notice text-sm text-destructive">{preview.error}</p> : null}
    {doc.contentIn ? <div className="notice flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm" data-testid="pdf-template-content-elsewhere">
      <span className="min-w-0 flex-1 basis-64">{doc.contentIn.text}</span>
      {contentLinks ? <Button asChild variant="outline" size="sm"><Link href={doc.contentIn.href} data-testid="pdf-template-content-link">{doc.contentIn.link}</Link></Button> : null}
    </div> : null}

    <div className={cn("grid items-start gap-4", sideBySide && "grid-cols-[minmax(0,1fr)_22rem]")}>
      <div className="min-w-0 space-y-3">
        {hiddenHere.length ? <div className="flex flex-wrap items-center gap-1.5 text-sm" data-testid="pdf-template-hidden">
          <span className="text-muted-foreground">Dolda:</span>
          {hiddenHere.map((item) => <Button key={item.id} type="button" variant="outline" size="sm" onClick={() => hideBlock(docType, item, true)} title="Visa igen" data-testid="pdf-template-show-hidden" data-block={item.id}><Eye />{item.name}</Button>)}
        </div> : null}
        <div className="relative mx-auto max-w-[56rem]" data-testid="pdf-template-preview" aria-busy={preview.busy}
          onClick={(event) => { if (!(event.target as HTMLElement).closest("button, textarea, input")) { setSelected(null); setEditing(false); } }}>
          {/* Stands over the page, so nothing moves. Only after a moment: a quick drawing shows nothing. */}
          {preview.slow ? <span role="status" className="pointer-events-none absolute right-2 top-2 z-30 rounded-full border bg-popover px-2.5 py-0.5 text-xs text-muted-foreground shadow-sm" data-testid="pdf-template-drawing">Ritar om…</span> : null}
          {/* The page's own font for the field over a text, so a text reads the same while it is typed. */}
          <style>{`@font-face{font-family:"Pdf Manrope";src:url(/fonts/Manrope-Regular.ttf);font-weight:400}@font-face{font-family:"Pdf Manrope";src:url(/fonts/Manrope-Bold.ttf);font-weight:700}`}</style>
          <PdfPages data={preview.state?.pdf ?? null} pages={preview.pages} label="Dokumentet" onDrawn={preview.onDrawn} overlay={(page) => <PageOverlay page={page} size={preview.pages[page]!} targets={targets} selected={selected} editing={editing} pageWidth={pageWidth}
            blockOf={blockOf} flagged={(docId, item) => flaggedOf(docId, item)} changed={(docId, id) => Boolean(drafts[docId]?.[id])} textOf={textOf} errorOf={errorOf} move={move} groupOrder={groupOrder}
            onSelect={select} onEdit={setEditing} onText={setText} onVisible={hideBlock} onReset={resetBlock} visibleOf={visibleOf} hasChange={(docId, id) => { const own = drafts[docId]?.[id]; return Boolean(own && (own.text !== null || own.visible !== null || own.confirm)); }} />} />
          {/* What the file says, for a screen reader and the tests. */}
          <pre className="sr-only" data-testid="pdf-template-preview-text">{preview.state?.text ?? "Hämtar…"}</pre>
        </div>
      </div>
      {sideBySide ? <aside aria-label="Inställningar" className={cn(EDITOR_SIDE_PANEL)} data-testid="pdf-template-panel">{panelContent}</aside> : null}
    </div>
    {sideBySide ? null : <SidePanel side="start" open={panelOpen} onOpenChange={setPanelOpen} title={tab === "all" ? "Alla texter" : block?.name ?? "Text"}>{panelContent}</SidePanel>}
  </div>;
}

function scrollToTarget(target: PdfTraceTarget, pages: readonly PdfPageSize[]) {
  const page = document.querySelector<HTMLElement>(`[data-testid="pdf-template-page"][data-page="${target.page}"]`);
  const size = pages[target.page];
  if (!page || !size) return;
  const bar = document.querySelector("[data-editor-bar]")?.getBoundingClientRect().bottom ?? 64;
  const box = page.getBoundingClientRect();
  const top = box.top + ((size.height - target.y - target.height) / size.height) * box.height;
  if (top < bar + 12 || top > window.innerHeight - 80) window.scrollTo({ top: Math.max(0, top + window.scrollY - bar - 80), behavior: "smooth" });
}

/** The real PDF with the drafts, fetched a moment after the last change; only the newest request's answer counts. */
function usePreview(docType: string, variant: string | null, drafts: AllDrafts, docByType: Map<string, PdfEditorDocument>) {
  const [state, setState] = useState<Rendered | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shown, setShown] = useState<Rendered | null>(null);
  const [drawnWidth, setDrawnWidth] = useState(0);
  const [slow, setSlow] = useState(false);
  const blocks = useMemo(() => Object.entries(drafts).flatMap(([documentType, own]) => Object.entries(own).map(([blockId, draft]) => {
    const block = docByType.get(documentType)?.blocks.find((item) => item.id === blockId);
    const stored = block?.override;
    // A text the owner changed or confirmed stands on today's default; an untouched one on the version it was made against.
    const basedOnVersion = !stored || draft.confirm || draft.text !== stored.text ? block?.version ?? "" : stored.basedOnVersion;
    return { documentType, blockId, text: draft.text, visible: draft.visible, orderIndex: draft.orderIndex, basedOnVersion };
  })), [drafts, docByType]);
  const request = JSON.stringify({ documentType: docType, variant, blocks });
  const running = useRef(false);
  const wanted = useRef("");
  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      for (;;) {
        const sent = wanted.current;
        try {
          const answer = await api<{ pdf: string; text: string; targets: PdfTraceTarget[]; pages: PdfPageSize[] }>("/api/superadmin/pdf-templates/preview", { method: "POST", body: sent }, { change: false });
          if (wanted.current === sent) {
            setState({ pdf: Uint8Array.from(atob(answer.pdf), (char) => char.charCodeAt(0)), text: answer.text, targets: answer.targets, pages: answer.pages });
            setError("");
          }
        } catch (cause) { if (wanted.current === sent) setError((cause as Error).message); }
        if (wanted.current === sent) break;
      }
    } finally { running.current = false; setBusy(false); }
  }, []);
  useEffect(() => {
    wanted.current = request;
    const timer = setTimeout(() => void run(), 200);
    return () => clearTimeout(timer);
  }, [request, run]);
  // The targets change together with the picture: the new ones take over when the new file has been drawn.
  const latest = useRef<Rendered | null>(null);
  useEffect(() => { latest.current = state; }, [state]);
  const onDrawn = useCallback(() => setShown(latest.current), []);
  const drawing = busy || Boolean(state && shown?.pdf !== state.pdf);
  useEffect(() => {
    if (!drawing) { const clear = setTimeout(() => setSlow(false), 0); return () => clearTimeout(clear); }
    const timer = setTimeout(() => setSlow(true), 400);
    return () => clearTimeout(timer);
  }, [drawing]);
  // The page's width follows the host, not each drawing of the editor (a forced layout on every key press before).
  useEffect(() => {
    const element = document.querySelector<HTMLElement>("[data-testid=pdf-template-pages]");
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () => setDrawnWidth(Math.round(element.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // The canvases follow the page count at once, so the file about to be drawn has somewhere to go.
  const pages = state?.pages ?? NO_PAGES;
  const current = useMemo(() => state && shown ? { ...state, targets: shown.targets } : state, [state, shown]);
  return { state: current, pages, busy, slow, error, onDrawn, pageWidth: drawnWidth };
}

const STATE_BADGE: Record<string, { label: string; tone: "warning" | "info" | "danger" } | null> = {
  default: null, custom: { label: "Ändrad", tone: "info" }, changed: { label: "Förvalet ändrades", tone: "warning" }, legal: { label: "Lagkrav uppdaterades", tone: "danger" },
};

type OverlayProps = {
  page: number; size: PdfPageSize; targets: readonly PdfTraceTarget[]; selected: Selected | null; editing: boolean; pageWidth: number;
  blockOf: (doc: string, id: string) => PdfEditorBlock | null; flagged: (doc: string, block: PdfEditorBlock) => boolean; changed: (doc: string, id: string) => boolean; hasChange: (doc: string, id: string) => boolean;
  textOf: (doc: string, block: PdfEditorBlock) => string; errorOf: (doc: string, block: PdfEditorBlock) => string | null; visibleOf: (doc: string, block: PdfEditorBlock) => boolean;
  move: (doc: string, block: PdfEditorBlock, step: -1 | 1) => void; groupOrder: (doc: string, group: string) => PdfEditorBlock[];
  onSelect: (target: Selected, edit: boolean) => void; onEdit: (editing: boolean) => void; onText: (doc: string, block: PdfEditorBlock, text: string) => void; onVisible: (doc: string, block: PdfEditorBlock, visible: boolean) => void; onReset: (doc: string, block: PdfEditorBlock) => void;
};

/** The rectangles of one occurrence of a block: the lines around the clicked one that belong together. */
function occurrence(targets: readonly PdfTraceTarget[], selected: Selected, page: number) {
  const own = targets.filter((target) => target.page === page && target.doc === selected.doc && target.id === selected.id).sort((a, b) => b.y - a.y);
  if (!own.length) return [];
  const start = selected.y === undefined ? own[0]! : own.reduce((best, item) => Math.abs(item.y - selected.y!) < Math.abs(best.y - selected.y!) ? item : best, own[0]!);
  const index = own.indexOf(start);
  const lines = [start];
  for (let at = index - 1; at >= 0 && own[at]!.y - lines[0]!.y < own[at]!.height * 1.9; at -= 1) lines.unshift(own[at]!);
  for (let at = index + 1; at < own.length && lines.at(-1)!.y - own[at]!.y < own[at]!.height * 1.9; at += 1) lines.push(own[at]!);
  return lines;
}

/** The click targets over a page, and the selected text's field and tools. All in percent of the page, so they follow its size. */
function PageOverlay(props: OverlayProps) {
  const { page, size, targets, selected, editing, pageWidth, blockOf } = props;
  const scale = pageWidth ? pageWidth / size.width : 1;
  const here = targets.filter((target) => target.page === page);
  const place = (x: number, y: number, width: number, height: number): CSSProperties => ({ left: `${(x / size.width) * 100}%`, top: `${((size.height - y - height) / size.height) * 100}%`, width: `${(width / size.width) * 100}%`, height: `${(height / size.height) * 100}%` });
  const lines = selected && selected.page === page ? occurrence(targets, selected, page) : [];
  const selectedBlock = selected && lines.length ? blockOf(selected.doc, selected.id) : null;
  return <div className="absolute inset-0" data-testid="pdf-template-targets">
    {here.map((target, index) => {
      const block = blockOf(target.doc, target.id);
      if (!block) return null;
      const isSelected = selected?.doc === target.doc && selected.id === target.id;
      const warned = props.flagged(target.doc, block);
      // On a small page a small text still gets a target a finger can hit, grown evenly so its middle stays on the text.
      const padY = pageWidth && pageWidth < IN_PLACE_FROM ? Math.max(0, (16 / scale - target.height) / 2) : 0;
      const padX = pageWidth && pageWidth < IN_PLACE_FROM ? Math.max(0, (24 / scale - target.width) / 2) : 0;
      return <button key={index} type="button" aria-label={`Ändra: ${block.name}`} aria-pressed={isSelected} title={block.name}
        data-testid="pdf-template-target" data-doc={target.doc} data-block={target.id} data-state={warned ? block.state : props.changed(target.doc, target.id) ? "custom" : "default"}
        onClick={(event) => { event.stopPropagation(); props.onSelect({ doc: target.doc, id: target.id, page, y: target.y }, true); }}
        style={place(target.x - 1.5 - padX, target.y - 0.5 - padY, target.width + 3 + padX * 2, target.height + 1 + padY * 2)}
        className={cn("absolute cursor-text rounded-[2px] after:hidden outline outline-1 outline-offset-0 outline-transparent transition-colors hover:bg-primary/10 hover:outline-primary focus-visible:outline-2 focus-visible:outline-ring",
          props.changed(target.doc, target.id) && "outline-primary/35", warned && "bg-amber-400/20 outline-amber-500", isSelected && "bg-primary/10 outline-primary")} />;
    })}
    {selected && selectedBlock ? <SelectedText key={`${selected.doc}:${selected.id}:${selected.page}`} {...props} selected={selected} block={selectedBlock} lines={lines} scale={scale} editing={editing} /> : null}
  </div>;
}

/** The selected text on the page: the field over it (the same font, size, weight and colour as the print) and its tools. */
function SelectedText({ size, selected, block, lines, scale, editing, textOf, errorOf, visibleOf, move, groupOrder, onEdit, onText, onVisible, onReset, hasChange }: OverlayProps & { selected: Selected; block: PdfEditorBlock; lines: PdfTraceTarget[]; scale: number }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const atStart = useRef(textOf(selected.doc, block));
  const first = lines[0]!;
  const left = Math.min(...lines.map((line) => line.x));
  const right = Math.max(...lines.map((line) => line.x + line.width));
  const top = Math.max(...lines.map((line) => line.y + line.height));
  const text = textOf(selected.doc, block);
  const error = errorOf(selected.doc, block);
  // The field has room to type: at least as wide as the line, and more towards the side the text grows.
  const minWidth = Math.max(right - left + 6, Math.min(180, size.width - 2 * 20));
  const fieldLeft = first.align === "right" ? Math.max(4, right - minWidth + 3) : first.align === "center" ? Math.max(4, (left + right - minWidth) / 2) : Math.min(left - 3, size.width - minWidth - 4);
  const lineHeight = first.height * 1.1;
  useEffect(() => {
    if (!editing) return;
    const element = field.current;
    if (!element) return;
    element.focus({ preventScroll: true });
    element.setSelectionRange(element.value.length, element.value.length);
  }, [editing]);
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  });
  const order = block.group ? groupOrder(selected.doc, block.group) : [];
  const place = order.findIndex((item) => item.id === block.id);
  const tools = <div className="pointer-events-auto absolute z-20 flex items-center gap-0.5 rounded-lg border bg-popover p-0.5 shadow-md" style={{ left: `${(Math.min(left, size.width - 170) / size.width) * 100}%`, bottom: `${(top / size.height) * 100 + 0.3}%` }} data-testid="pdf-template-tools" onClick={(event) => event.stopPropagation()}>
    {block.group ? <>
      <IconButton size="icon-sm" label="Flytta upp" disabled={place <= 0} onClick={() => move(selected.doc, block, -1)} data-testid="pdf-template-up"><ArrowUp /></IconButton>
      <IconButton size="icon-sm" label="Flytta ned" disabled={place === order.length - 1} onClick={() => move(selected.doc, block, 1)} data-testid="pdf-template-down"><ArrowDown /></IconButton>
    </> : null}
    {block.mayHide
      ? <IconButton size="icon-sm" label="Dölj texten" onClick={() => { onEdit(false); onVisible(selected.doc, block, !visibleOf(selected.doc, block)); }} data-testid="pdf-template-hide"><EyeOff /></IconButton>
      : <span className="flex size-7 items-center justify-center text-muted-foreground" title={block.locked ? "Lagtext – kan inte ändras eller döljas" : "Krävs – kan inte döljas"} data-testid="pdf-template-required"><Lock className="size-3.5" aria-hidden="true" /></span>}
    <IconButton size="icon-sm" label="Återställ texten" disabled={!hasChange(selected.doc, block.id)} onClick={() => onReset(selected.doc, block)} data-testid="pdf-template-reset"><RotateCcw /></IconButton>
    <IconButton size="icon-sm" label="Klar" onClick={() => onEdit(false)} data-testid="pdf-template-done"><X /></IconButton>
  </div>;
  return <>
    {tools}
    {editing && block.mayEdit ? <div className="absolute z-10" style={{ left: `${(fieldLeft / size.width) * 100}%`, top: `${((size.height - top) / size.height) * 100}%`, width: `${(minWidth / size.width) * 100}%` }} onClick={(event) => event.stopPropagation()}>
      <textarea ref={field} value={text} rows={1} maxLength={block.max} spellCheck lang="sv" aria-label={block.name} aria-invalid={error ? true : undefined} data-testid="pdf-template-inline"
        onChange={(event) => onText(selected.doc, block, block.multiline ? event.target.value : event.target.value.replace(/\n/g, " "))}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); onText(selected.doc, block, atStart.current); onEdit(false); }
          if (event.key === "Enter" && !block.multiline) { event.preventDefault(); onEdit(false); }
        }}
        style={{ fontFamily: '"Pdf Manrope", sans-serif', fontSize: `${first.size * scale}px`, lineHeight: `${lineHeight * scale}px`, fontWeight: first.bold ? 700 : 400, color: first.color, textAlign: first.align, background: "#fff", padding: `0 ${2 * scale}px`, letterSpacing: block.kind === "band" ? "0.08em" : undefined }}
        className={cn("block w-full resize-none overflow-hidden rounded-[2px] border-0 outline outline-2 outline-primary", error && "outline-destructive")} />
      {error ? <p role="alert" className="mt-1 rounded bg-popover px-2 py-1 text-xs text-destructive shadow" data-testid="pdf-template-inline-error">{error}</p> : null}
    </div> : null}
  </>;
}

type PanelProps = {
  tab: "block" | "all"; onTab: (tab: "block" | "all") => void; doc: PdfEditorDocument; docType: string; block: PdfEditorBlock | null; blockDoc: string; docName: (type: string) => string; placeholders: Record<string, string>;
  draft: Draft | undefined; text: string; visible: boolean; error: string | null; flagged: boolean; first: boolean; last: boolean; printedHere: boolean; printedElsewhere: readonly string[]; variants: readonly { key: string; label: string }[]; groupName: string | null;
  onText: (text: string) => void; onVisible: (visible: boolean) => void; onMove: (step: -1 | 1) => void; onReset: () => void; onKeep: () => void; onTakeDefault: () => void; onShowVariant: (key: string) => void;
  onChoose: (block: PdfEditorBlock) => void; textOf: (block: PdfEditorBlock) => string; visibleOf: (block: PdfEditorBlock) => boolean; flaggedOf: (block: PdfEditorBlock) => boolean; changedOf: (block: PdfEditorBlock) => boolean; onPage: (block: PdfEditorBlock) => boolean; selectedId: string | null;
};

/** The panel beside the page: the selected text's rules and field, and the list of all the document's texts. */
function SettingsPanel(props: PanelProps) {
  const { tab, onTab } = props;
  return <div data-testid="pdf-template-settings">
    <div className={cn(EDITOR_SIDE_PANEL_HEAD, "px-3 py-2")}>
      <EditorSegmented label="Visa" value={tab} onChange={onTab} testId="pdf-template-panel-tab" options={[{ value: "block", label: "Markerad text" }, { value: "all", label: "Alla texter" }]} />
    </div>
    {tab === "block" ? <BlockSettings {...props} /> : <AllTexts {...props} />}
  </div>;
}

function BlockSettings({ doc, docType, block, blockDoc, docName, placeholders, draft, text, visible, error, flagged, first, last, printedHere, printedElsewhere, variants, groupName, onText, onVisible, onMove, onReset, onKeep, onTakeDefault, onShowVariant }: PanelProps) {
  const area = useRef<HTMLTextAreaElement>(null);
  const line = useRef<HTMLInputElement>(null);
  if (!block) return <EditorPanelEmpty title="Ingen text markerad">
    Klicka på en text i dokumentet och skriv direkt på sidan. Det som inte markeras när du pekar på det är uppgifter från dokumentet, inte malltext{doc.type === "protocol" ? "; formulärets egna texter ändras i formuläret" : doc.type === "self_inspection" ? "; programmets avsnitt ändras i programmet" : ""}.
  </EditorPanelEmpty>;
  const field = block.multiline ? area : line;
  const id = `pdf-block-${block.id}`;
  const badge = flagged ? STATE_BADGE[block.state] : draft ? STATE_BADGE.custom : null;
  const insert = (name: string) => {
    const element = field.current;
    const token = `{${name}}`;
    const start = element?.selectionStart ?? text.length;
    const end = element?.selectionEnd ?? text.length;
    onText(text.slice(0, start) + token + text.slice(end));
    requestAnimationFrame(() => { element?.focus(); element?.setSelectionRange(start + token.length, start + token.length); });
  };
  const shownText = flagged && block.state === "legal" ? block.defaultText : text;
  const elsewhere = variants.filter((item) => printedElsewhere.includes(item.key));
  return <div className="space-y-3 p-4 text-sm" data-testid="pdf-template-block" data-block={block.id} data-doc={blockDoc} data-state={flagged ? block.state : draft ? "custom" : "default"}>
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="min-w-0 flex-1 basis-40 font-medium">{block.name}</label>
      {block.required || block.always || block.locked ? <Badge variant="outline" className={indicatorBadge("neutral")} title={block.locked ? "Lagtext – kan inte ändras eller döljas" : "Krävs – kan inte döljas"}><Lock aria-hidden="true" />{block.locked ? "Lagtext" : "Krävs"}</Badge> : null}
      {badge ? <Badge variant="outline" className={indicatorBadge(badge.tone)} data-testid="pdf-template-block-state">{badge.label}</Badge> : null}
    </div>
    {block.elsewhere ? <p className="notice text-xs" data-testid="pdf-template-elsewhere">{block.elsewhere}</p> : null}
    {blockDoc !== docType ? <p className="text-xs text-muted-foreground" data-testid="pdf-template-other-doc">{blockDoc === "common" ? "Gemensam text: ändringen gäller alla dokument." : `Text från ${docName(blockDoc)}: ändringen gäller där också.`}</p> : null}
    {block.when ? <p className="text-xs text-muted-foreground">Skrivs ut: {block.when.toLowerCase()}.</p> : null}
    {block.multiline
      ? <textarea ref={area} id={id} className={cn("form-textarea min-h-24", !visible && "opacity-60")} value={shownText} maxLength={block.max} readOnly={!block.mayEdit} onChange={(event) => onText(event.target.value)} aria-invalid={error ? true : undefined} data-testid="pdf-template-text" />
      : <Input ref={line} id={id} className={cn(!visible && "opacity-60")} value={shownText} maxLength={block.max} readOnly={!block.mayEdit} onChange={(event) => onText(event.target.value)} aria-invalid={error ? true : undefined} data-testid="pdf-template-text" />}
    {error ? <p role="alert" className="text-xs text-destructive" data-testid="pdf-template-error">{error}</p> : null}
    {block.mayEdit && block.placeholders.length ? <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">Infoga:</span>
      {block.placeholders.map((name) => <Button key={name} type="button" variant="outline" size="sm" title={placeholders[name]} onClick={() => insert(name)} data-testid="pdf-template-placeholder">{`{${name}}`}</Button>)}
    </div> : null}
    {!printedHere ? <div className="notice text-xs" data-testid="pdf-template-not-here">
      {visible ? "Står inte i det här exemplet." : "Dold just nu."}
      {elsewhere.length ? <div className="mt-1.5 flex flex-wrap gap-1.5">{elsewhere.map((item) => <Button key={item.key} type="button" variant="outline" size="sm" onClick={() => onShowVariant(item.key)}>Visa {item.label}</Button>)}</div> : null}
    </div> : null}
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-2 text-xs text-muted-foreground" title={block.mayHide ? undefined : "Krävs – kan inte döljas"}>
        <Switch checked={visible} disabled={!block.mayHide} onCheckedChange={onVisible} aria-label={`Visa ${block.name}`} data-testid="pdf-template-visible" />
        {visible ? "Visas" : "Dold"}
      </span>
      {groupName ? <span className="flex items-center gap-0.5" title={groupName}>
        <IconButton size="icon-sm" label={`Flytta upp i ${groupName.toLowerCase()}`} disabled={first} onClick={() => onMove(-1)} data-testid="pdf-template-panel-up"><ArrowUp /></IconButton>
        <IconButton size="icon-sm" label={`Flytta ned i ${groupName.toLowerCase()}`} disabled={last} onClick={() => onMove(1)} data-testid="pdf-template-panel-down"><ArrowDown /></IconButton>
      </span> : null}
      <Button type="button" variant="ghost" size="sm" className="ml-auto" disabled={!draft || (draft.text === null && draft.visible === null && !draft.confirm)} onClick={onReset} data-testid="pdf-template-panel-reset"><RotateCcw />Återställ</Button>
    </div>
    {flagged ? <ChangedDefault block={block} onKeep={onKeep} onTakeDefault={onTakeDefault} onMerge={() => { onText(block.override?.text ?? block.defaultText); requestAnimationFrame(() => field.current?.focus()); }} /> : null}
  </div>;
}

/** Förvalet ändrades / Lagkrav uppdaterades: the old default, the new default and the owner's text, and the three ways on. */
function ChangedDefault({ block, onKeep, onTakeDefault, onMerge }: { block: PdfEditorBlock; onKeep: () => void; onTakeDefault: () => void; onMerge: () => void }) {
  const legal = block.state === "legal";
  return <div className="space-y-2 rounded-md border p-2 text-sm" data-testid="pdf-template-changed">
    <p className="text-xs text-muted-foreground">{legal ? "Lagkravet har uppdaterats. Det nya förvalet gäller redan i dokumenten." : "Förvalet ändrades i en uppdatering. Din text gäller tills du väljer."}</p>
    <dl className="grid gap-2">
      <div><dt className="text-xs text-muted-foreground">Tidigare förval</dt><dd className="whitespace-pre-wrap [overflow-wrap:anywhere]" data-testid="pdf-template-old-default">{block.override?.basedOnText ?? "—"}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Nytt förval</dt><dd className="whitespace-pre-wrap [overflow-wrap:anywhere]" data-testid="pdf-template-new-default">{block.defaultText}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Din text</dt><dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">{block.override?.text ?? "—"}</dd></div>
    </dl>
    <div className="flex flex-wrap gap-2">
      {legal ? null : <Button variant="outline" size="sm" onClick={onKeep} data-testid="pdf-template-keep">Behåll min text</Button>}
      <Button variant="outline" size="sm" onClick={onTakeDefault} data-testid="pdf-template-take-default">Använd nya förvalet</Button>
      <Button variant="outline" size="sm" onClick={onMerge} data-testid="pdf-template-merge">Slå ihop manuellt</Button>
    </div>
  </div>;
}

/** Every text of the document by the part of the page it belongs to; a click shows it on the page or on the example that prints it. */
function AllTexts({ doc, onChoose, textOf, visibleOf, flaggedOf, changedOf, onPage, selectedId }: PanelProps) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase("sv");
  const groups = new Map<string, PdfEditorBlock[]>();
  for (const block of doc.blocks) {
    if (needle && !`${block.name} ${textOf(block)}`.toLocaleLowerCase("sv").includes(needle)) continue;
    groups.set(block.area, [...(groups.get(block.area) ?? []), block]);
  }
  return <div className="space-y-3 p-3" data-testid="pdf-template-all-texts">
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input className="pl-8" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Sök bland ${doc.blocks.length} texter`} aria-label="Sök bland texterna" data-testid="pdf-template-search" />
    </div>
    {[...groups].map(([name, blocks]) => <section key={name} aria-label={name}>
      <h3 className="mb-1 text-xs font-semibold text-muted-foreground">{name}</h3>
      <ul className="divide-y rounded-md border">
        {blocks.map((block) => <li key={block.id}>
          <button type="button" className={cn("touch-target flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-hover)]", selectedId === block.id && "bg-secondary", !onPage(block) && "text-muted-foreground")} onClick={() => onChoose(block)} data-testid="pdf-template-list-item" data-block={block.id}>
            <span className={cn("min-w-0 flex-1 truncate", !visibleOf(block) && "line-through")} title={block.name}>{textOf(block)}</span>
            {flaggedOf(block) ? <Badge variant="outline" className={indicatorBadge("warning")}>Se över</Badge> : changedOf(block) ? <Badge variant="outline" className={indicatorBadge("info")}>Ändrad</Badge> : null}
          </button>
        </li>)}
      </ul>
    </section>)}
    {!groups.size ? <p className="text-sm text-muted-foreground">Inga texter matchar.</p> : null}
  </div>;
}
