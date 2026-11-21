"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowUp, CalendarClock, Code2, Columns2, Eye, Heading, Image as ImageIcon, LayoutPanelLeft, List, Minimize2, Minus, Monitor, MousePointerClick, MoveVertical,
  Plug, PanelTop, Pencil, Search, Send, Save, SquareDashed, Trash2, Type, Wrench, X,
} from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-shell";
import { TrueWidth } from "@/components/true-width";
import { EDITOR_BUTTON, EDITOR_SIDE_PANEL, EditorActions, EditorBar, EditorMoreMenu, EditorPanelEmpty, EditorRibbon, EditorRibbonSheet, EditorSegmented, EditorStatus, EditorUndoRedo, type EditorRibbonGroup } from "@/components/editor-ribbon";
import { Button } from "@/components/ui/button";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { SidePanel } from "@/features/workflow/form-builder/dialogs";
import { AdvancedFold } from "@/features/workflow/section-tabs";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { useLoadEffect } from "@/lib/use-load-effect";
import { cn } from "@/lib/utils";
import { clientExtensions } from "@ee/client";
import type { WebsiteAutoClient } from "@/lib/extensions/types";
import {
  allBlocks, append, appendInside, blockImage, blocksOf, canMove, childBlocks, findBlock, htmlCode, insertAfter, insertionPoint, isHtml, isLocked, moveBlock, newBlock, parentOf, parseBlocks, removeBlock,
  serializeBlocks, setBlockImage, setBlockText, setButtonLink, setHeadingLevel, setHtmlCode, setSpacerHeight, typeOf, updateBlock,
  type BlockDocument, type BlockNode, type NewBlockType,
} from "@/lib/website/blocks";
import { fullBlockName, NO_STYLES, siteOrigin, wordpressEditUrl, type ThemeStyles } from "@/lib/website/frame";
import { BackupList, BlockPanel, HtmlCodeField, type BlockPanelApi, type ConnectionState } from "./website-panels";
import { blockName, isExternalImage, WebsiteCanvas, type CanvasApi } from "./website-canvas";
import { siteLookCss, type SiteLookStyles } from "@/lib/website/site-look";
import { SiteFrame, type FrameEnv } from "./website-frame";
import { PublishShareDialog, type ShareChoice } from "./publish-share";
import { WebsiteSeoPanel } from "./seo-panel";
import { useWebsiteSchedule } from "@/features/schedule/website-schedule";
import type { SiteMedia } from "./media-picker";
import { sameSeo, type PageSeo } from "@/lib/website/seo";

/**
 * Min webbsida (2026-11-10; first one site 2026-11-09): the company's own WordPress pages edited like the landing page – the same bar (undo, Redigera/
 * Förhandsgranska, the status, Spara), the same settings column on the left and the page as the canvas. Spara (or Ctrl+S)
 * keeps a draft in Workflow; Publicera writes the page to WordPress after storing the page as it is there now; Återställ writes
 * a stored version back. The page select in the bar chooses the page (the front page first).
 *
 * 2026-11-10: html blocks and plugins' blocks are drawn in sandboxed frames (the calculators work there), a new html block can
 * be added, the code has a real code field with an Öppna stort mode beside its preview, and the status says Publicerad, Utkast
 * sparat or Ändrat i WordPress (the editor asks WordPress now and then whether the page was changed there).
 *
 * An extension may add automatic blocks to one company's site (ee/): the server says so (auto), and the editor then loads
 * their client part (clientExtensions.loadWebsiteAuto) – the Automatiskt group and the group's choice appear only then.
 */
type PageSummary = { id: number; title: string; status: string; modified: string; link: string; draftSavedAt: string | null };
type Overview = { connection: ConnectionState; pages: PageSummary[]; pagesError: string | null; auto: { sources: unknown } | null };
type Backup = { id: string; reason: string; modified: string; createdAt: string };
/** `seo`: Sökmotorer och delning (2026-11-11) – null when the site has no SEO meta (no panel, nothing sent). */
type Opened = { page: Omit<PageSummary, "draftSavedAt">; content: string; seo: PageSeo | null; seoMedia: SiteMedia[]; draft: { content: string; baseModified: string; revision: number; updatedAt: string; stale: boolean; seo: PageSeo | null; seoBase: PageSeo | null } | null; backups: Backup[] };
/** `wpSeo`: the SEO values in WordPress now; `seoBase`: WordPress's values when the draft (or this editing) began. */
type Loaded = { page: Opened["page"]; wpContent: string; baseModified: string; revision: number; stale: boolean; backups: Backup[]; hasDraft: boolean; error: string | null; wpSeo: PageSeo | null; seoBase: PageSeo | null };
type History = { states: BlockDocument[]; index: number; merge?: string };
type Message = { text: string; error?: boolean; link?: { href: string; label: string } };

const NEW_BLOCKS: { type: NewBlockType; label: string; icon: typeof Type }[] = [
  { type: "paragraph", label: "Text", icon: Type }, { type: "heading", label: "Rubrik", icon: Heading }, { type: "list", label: "Lista", icon: List },
  { type: "image", label: "Bild", icon: ImageIcon }, { type: "buttons", label: "Knapp", icon: MousePointerClick }, { type: "cover", label: "Omslag", icon: PanelTop },
  { type: "columns", label: "Kolumner", icon: Columns2 }, { type: "group", label: "Grupp", icon: SquareDashed }, { type: "media-text", label: "Media och text", icon: LayoutPanelLeft },
  { type: "separator", label: "Avdelare", icon: Minus }, { type: "spacer", label: "Mellanrum", icon: MoveVertical }, { type: "html", label: "HTML", icon: Code2 },
];
/** How often the editor asks WordPress whether the page was changed there (and when the tab comes back). */
const REMOTE_CHECK_MS = 2 * 60_000;
/** Where the site's connection (and Facebook och Instagram) is made: Kopplingar → Webb och sociala medier (2026-11-10). */
export const WEB_CONNECTIONS_HREF = "/?view=advanced&section=web";

function scrollToBlock(id: string) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const element = document.querySelector<HTMLElement>(`[data-site-block="${id}"]`);
    if (!element) return;
    const bar = document.querySelector("[data-editor-bar]")?.getBoundingClientRect().bottom ?? 64;
    window.scrollTo({ top: Math.max(0, element.getBoundingClientRect().top + window.scrollY - bar - 24), behavior: "smooth" });
  }));
}

export function WebsiteEditor() {
  const phone = useNativeMode();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [pageId, setPageId] = useState<number | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [history, setHistory] = useState<History>({ states: [], index: 0 });
  const [savedMarkup, setSavedMarkup] = useState("");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  // Som besökaren (2026-11-12, as the landing editor): the page laid out at the screen's width and scaled to the canvas.
  const [trueWidth, setTrueWidth] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [large, setLarge] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [remoteChanged, setRemoteChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [styles, setStyles] = useState<{ pageId: number; styles: ThemeStyles } | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const [autoClient, setAutoClient] = useState<WebsiteAutoClient | null>(null);
  // Dela även på Facebook och Instagram: offered when the company has connected them (Kopplingar).
  const [metaConnected, setMetaConnected] = useState(false);
  // Sajtens utseende (2026-11-10): the site's typography and copied fonts for the canvas (the frames get them with the styles).
  // Since 2026-11-12 the canvas uses the site's own css (the page's styles, below) and the typography only while that is missing.
  const [look, setLook] = useState<{ ok: boolean; fontCss: string; typeCss: string } | null>(null);
  const [copying, setCopying] = useState<string | null>(null);
  // Sökmotorer och delning (2026-11-11): the page's SEO values (outside the block history), what was last saved, the share pictures known.
  const [seo, setSeo] = useState<PageSeo | null>(null);
  const [savedSeo, setSavedSeo] = useState<PageSeo | null>(null);
  const [seoMedia, setSeoMedia] = useState<SiteMedia[]>([]);
  const [seoOpen, setSeoOpen] = useState(false);
  useEffect(() => {
    let active = true;
    void api<{ status: string; page: string | null }>("/api/meta?part=status", undefined, { change: false }).then((result) => { if (active) setMetaConnected(result.status !== "missing" && Boolean(result.page)); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const loadOverview = useCallback(async () => {
    try {
      const next = await api<Overview>("/api/website");
      setOverview(next);
      setLoadError("");
      setPageId((current) => current ?? next.pages[0]?.id ?? null);
    } catch (cause) { setLoadError((cause as Error).message); }
  }, []);
  useLoadEffect(loadOverview);
  // The extension's automatic blocks: their client part only when the server says this site has them.
  const wantsAuto = Boolean(overview?.auto) && Boolean(clientExtensions.loadWebsiteAuto);
  useEffect(() => {
    if (!wantsAuto || autoClient || !clientExtensions.loadWebsiteAuto) return;
    let stopped = false;
    void clientExtensions.loadWebsiteAuto().then((loaded) => { if (!stopped) setAutoClient(loaded); }).catch(() => undefined);
    return () => { stopped = true; };
  }, [wantsAuto, autoClient]);

  const openPage = useCallback(async (id: number) => {
    setBusy(true); setSelected(null); setConflict(false); setRemoteChanged(false); setStatus(null); setLarge(false);
    try {
      const opened = await api<Opened>(`/api/website?page=${id}`);
      const markup = opened.draft?.content ?? opened.content;
      let doc: BlockDocument | null = null;
      let error: string | null = null;
      try { doc = parseBlocks(markup); } catch (cause) { error = (cause as Error).message; }
      const startSeo = opened.seo ? opened.draft?.seo ?? opened.seo : null;
      setLoaded({ page: opened.page, wpContent: opened.content, baseModified: opened.draft?.baseModified ?? opened.page.modified, revision: opened.draft?.revision ?? 0, stale: Boolean(opened.draft?.stale), backups: opened.backups, hasDraft: Boolean(opened.draft), error,
        wpSeo: opened.seo, seoBase: opened.seo ? opened.draft?.seoBase ?? opened.seo : null });
      setSeo(startSeo); setSavedSeo(startSeo); setSeoMedia(opened.seoMedia ?? []);
      setHistory({ states: doc ? [doc] : [], index: 0 });
      setSavedMarkup(markup);
      // The site's look for the frames: asked once per page, after the page is shown (it is only a nicety).
      void api<ThemeStyles>(`/api/website?styles=${id}`, undefined, { change: false }).then((next) => setStyles({ pageId: id, styles: next })).catch(() => setStyles({ pageId: id, styles: NO_STYLES }));
    } catch (cause) {
      setLoaded(null);
      setStatus({ text: (cause as Error).message, error: true });
    } finally { setBusy(false); }
  }, []);
  const configured = Boolean(overview?.connection.configured);
  useEffect(() => {
    if (!configured) return;
    let active = true;
    void api<{ look: { ok: boolean; styles?: SiteLookStyles } | null; fontCss: string }>("/api/website?look=1", undefined, { change: false })
      .then((result) => { if (active) setLook({ ok: Boolean(result.look?.ok), fontCss: result.fontCss, typeCss: result.look?.ok && result.look.styles ? siteLookCss(result.look.styles, "[data-site-look]") : "" }); })
      .catch(() => { if (active) setLook({ ok: false, fontCss: "", typeCss: "" }); });
    return () => { active = false; };
  }, [configured]);
  const openSelected = useCallback(() => { if (pageId !== null) void openPage(pageId); }, [pageId, openPage]);
  useLoadEffect(openSelected, pageId !== null && configured);

  const current = history.states[history.index] ?? null;
  const markup = useMemo(() => current ? serializeBlocks(current) : "", [current]);
  const dirty = Boolean(current && (markup !== savedMarkup || !sameSeo(seo, savedSeo)));
  const unpublished = Boolean(loaded && current && (markup !== loaded.wpContent || !sameSeo(seo, loaded.wpSeo)));
  /** The SEO values for a save or a publish: only for a site that has them, with WordPress's values they started from. */
  const seoBody = () => (loaded?.wpSeo && seo ? { seo, seoBase: loaded.seoBase } : {});
  /** One step in the undo history; steps with the same `merge` (typing in one code field) become one. */
  const commit = useCallback((change: (doc: BlockDocument) => BlockDocument, merge?: string) => setHistory((state) => {
    const base = state.states[state.index];
    if (!base) return state;
    const next = change(base);
    if (next === base || serializeBlocks(next) === serializeBlocks(base)) return state;
    if (merge && state.merge === merge && state.index === state.states.length - 1 && state.index > 0) {
      const states = [...state.states.slice(0, state.index), next];
      return { states, index: states.length - 1, merge };
    }
    const states = [...state.states.slice(0, state.index + 1), next].slice(-100);
    return { states, index: states.length - 1, merge };
  }), []);
  const undo = useCallback(() => setHistory((state) => ({ states: state.states, index: Math.max(0, state.index - 1) })), []);
  const redo = useCallback(() => setHistory((state) => ({ states: state.states, index: Math.min(state.states.length - 1, state.index + 1) })), []);

  // ---------- saving, publishing, restoring ----------
  const failed = (cause: unknown) => {
    const error = cause as Error & { status?: number };
    if (error.status === 409) setConflict(true);
    setStatus({ text: error.message, error: true });
  };
  const save = async () => {
    if (!loaded || !current || pageId === null || busy || !dirty) return;
    setBusy(true); setStatus(null);
    try {
      const result = await api<{ revision: number; stale: boolean }>("/api/website", { method: "POST", body: JSON.stringify({ action: "save", pageId, content: markup, baseModified: loaded.baseModified, revision: loaded.revision, ...seoBody() }) });
      setLoaded({ ...loaded, revision: result.revision, stale: result.stale, hasDraft: true });
      setSavedMarkup(markup);
      setSavedSeo(seo);
      setMessage(null);
    } catch (cause) { failed(cause); } finally { setBusy(false); }
  };
  const publishWarning = () => {
    const external = externalImages().length;
    return external ? ` Obs: ${external === 1 ? "en bild ligger" : `${external} bilder ligger`} på en annan webbplats och kan försvinna därifrån. Kopiera till mediabiblioteket först (Mer → Kopiera alla externa bilder).` : "";
  };
  // With Facebook och Instagram connected, Publicera opens the checklist (publish-share.tsx); otherwise the ordinary question.
  const [shareOpen, setShareOpen] = useState(false);
  const publish = async () => {
    if (!loaded || !current || pageId === null) return;
    if (metaConnected) { setShareOpen(true); return; }
    if (!(await confirm({ title: "Publicera på webbplatsen?", message: `${loaded.page.title} skrivs till webbplatsen nu. Sidan som ligger där sparas först, så du kan återställa den.${publishWarning()}`, confirmLabel: "Publicera" }))) return;
    await publishNow(null);
  };
  const publishNow = async (share: ShareChoice | null) => {
    if (!loaded || !current || pageId === null) return;
    setBusy(true); setStatus(null);
    try {
      const result = await api<{ page: Opened["page"]; content: string; seo: PageSeo | null; unchanged: boolean; backups: Backup[]; post?: { id: string } | null }>("/api/website", { method: "POST", body: JSON.stringify({ action: "publish", pageId, content: markup, baseModified: loaded.baseModified, ...seoBody(), share: share ?? false }) });
      setLoaded({ ...loaded, page: result.page, wpContent: result.content, baseModified: result.page.modified, revision: 0, stale: false, backups: result.backups, hasDraft: false, wpSeo: result.seo, seoBase: result.seo });
      setSavedMarkup(result.content);
      setSeo(result.seo); setSavedSeo(result.seo);
      setRemoteChanged(false);
      const link = result.post ? { href: `/?view=company_posts&post=${encodeURIComponent(result.post.id)}`, label: "Öppna inlägget" }
        : /^https?:\/\//.test(result.page.link) ? { href: result.page.link, label: "Visa på webbplatsen" } : undefined;
      setMessage({ text: result.unchanged ? "Sidan på webbplatsen var redan likadan." : result.post ? "Sidan är publicerad. Ett utkast till inlägg väntar under Inlägg." : "Sidan är publicerad på webbplatsen.", link });
    } catch (cause) { failed(cause); } finally { setBusy(false); }
  };
  // Schemalägg (2026-11-11): the same page and checks as Publicera, at a chosen time (features/schedule/website-schedule.tsx).
  const schedule = useWebsiteSchedule({ pageId, title: loaded?.page.title ?? "",
    body: () => (loaded && current ? { content: markup, baseModified: loaded.baseModified, ...seoBody() } : null) });
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      // Ctrl+S everywhere in the editor, also in the code field: the draft (never the browser's Spara sidan).
      if (mod && event.key.toLowerCase() === "s" && !event.altKey) { event.preventDefault(); void saveRef.current(); return; }
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest("input, textarea, select")) return;
      if (mod && event.key.toLowerCase() === "z" && !event.shiftKey) { event.preventDefault(); undo(); }
      if (mod && (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey))) { event.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  // Changed in WordPress? Asked every other minute while the tab is shown, and when it is shown again.
  const knownModified = useRef<string | null>(null);
  useEffect(() => { knownModified.current = loaded?.page.modified ?? null; }, [loaded?.page.modified]);
  useEffect(() => {
    if (pageId === null || !loaded) return;
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const answer = await api<{ modified: string }>(`/api/website?modified=${pageId}`, undefined, { change: false });
        if (!stopped && knownModified.current && answer.modified !== knownModified.current) setRemoteChanged(true);
      } catch { /* asked again later */ }
    };
    const timer = window.setInterval(() => void check(), REMOTE_CHECK_MS);
    const onShown = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onShown);
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", onShown); };
  }, [pageId, loaded]);

  const auto = autoClient && overview?.auto ? { client: autoClient, sources: overview.auto.sources } : null;
  const selectedBlock = current && selected ? findBlock(current, selected) : null;
  const openPanelOnSmallScreens = () => { if (window.innerWidth < 1280) setPanelOpen(true); };
  const baseUrl = overview?.connection.baseUrl ?? "";
  const frameStyles = styles && styles.pageId === pageId ? styles.styles : NO_STYLES;
  // Förhandsvisning bara efter klick (Samtycke 2026-11-11): the page the person asked to preview; another page asks again.
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const previewAllowed = pageId !== null && previewPage === pageId;
  const frameEnv = useMemo<FrameEnv | null>(() => baseUrl ? { origin: siteOrigin(baseUrl), styles: frameStyles, allowed: previewAllowed, allow: () => setPreviewPage(pageId) } : null, [baseUrl, frameStyles, previewAllowed, pageId]);
  const wordpressUrl = pageId !== null && baseUrl ? wordpressEditUrl(baseUrl, pageId) : null;

  // A dynamic block as WordPress draws it: asked once per name and attributes while the page is open.
  const rendered = useRef(new Map<string, Promise<string | null>>());
  const render = useCallback((block: BlockNode) => {
    if (pageId === null) return Promise.resolve(null);
    const name = fullBlockName(block);
    const key = `${pageId}\u0000${name}\u0000${JSON.stringify(block.attrs)}`;
    let answer = rendered.current.get(key);
    if (!answer) {
      answer = api<{ html: string | null }>("/api/website", { method: "POST", body: JSON.stringify({ action: "render", pageId, name, attributes: block.attrs }) }, { change: false })
        .then((result) => result.html).catch(() => { rendered.current.delete(key); return null; });
      rendered.current.set(key, answer);
    }
    return answer;
  }, [pageId]);

  // ---------- changes ----------
  const changeBlock = (id: string, change: (block: BlockNode) => BlockNode, merge?: string) => commit((doc) => updateBlock(doc, id, change), merge);
  const insert = (block: BlockNode) => {
    if (!current) return;
    const type = typeOf(block);
    const after = insertionPoint(current, selected, type === "group" ? "group" : type);
    commit((doc) => after ? insertAfter(doc, after, block) : append(doc, block));
    setSelected(block.id); openPanelOnSmallScreens(); scrollToBlock(block.id);
  };
  const addNew = (type: NewBlockType) => insert(newBlock(type));
  const addAuto = (kind: string) => { if (auto) insert(childBlocks(blocksOf(auto.client.newGroup(kind, auto.sources)))[0]); };
  const removeSelected = async () => {
    if (!selectedBlock) return;
    const what = isHtml(selectedBlock) ? "HTML-blocket och dess kod tas bort" : isLocked(selectedBlock) ? `Blocket ${selectedBlock.name} tas bort. Det kan bara läggas tillbaka i WordPress eller med Ångra` : `${blockName(selectedBlock)} tas bort`;
    if (await confirm({ title: "Ta bort blocket?", message: `${what} från sidan. Du kan ångra tills du sparar.`, confirmLabel: "Ta bort", tone: "danger" })) {
      commit((doc) => removeBlock(doc, selectedBlock.id)); setSelected(null); setLarge(false);
    }
  };
  const addInside = () => {
    if (!selectedBlock) return;
    const child = { list: "list-item", buttons: "button", columns: "column" }[typeOf(selectedBlock)] as "list-item" | "button" | "column" | undefined;
    if (!child) return;
    const block = newBlock(child);
    commit((doc) => appendInside(doc, selectedBlock.id, block));
    setSelected(block.id); scrollToBlock(block.id);
  };
  const setAuto = (kind: string | null) => {
    if (!selectedBlock || !auto) return;
    changeBlock(selectedBlock.id, (block) => auto.client.bind(block, kind, auto.sources));
  };

  const autoLabelOf = (block: BlockNode) => { const kind = auto?.client.kindOf(block) ?? null; return kind ? auto?.client.kinds.find((item) => item.kind === kind)?.label ?? kind : null; };
  const canvasApi: CanvasApi = {
    editing: mode === "edit",
    selected,
    select: (id) => { setSelected(id); if (id) setSeoOpen(false); },
    setText: (id, html) => changeBlock(id, (block) => setBlockText(block, html)),
    frame: frameEnv,
    render,
    autoLabel: auto ? autoLabelOf : undefined,
    siteOrigin: baseUrl ? siteOrigin(baseUrl) : null,
    copyImage: (id) => void copyImages([id]),
    copying,
    fontCss: look?.fontCss || null,
    lookCss: look?.typeCss || null,
    // While a newly opened page's styles are read, the last page's css stays (it is the same site), so the canvas does not flash.
    look: styles?.styles.canvas ?? null,
    rendered: frameStyles.rendered,
  };
  const panelApi: BlockPanelApi | null = selectedBlock && current ? {
    canMoveUp: canMove(current, selectedBlock.id, -1), canMoveDown: canMove(current, selectedBlock.id, 1), hasParent: Boolean(parentOf(current, selectedBlock.id)), inAuto: false,
    move: (delta) => commit((doc) => moveBlock(doc, selectedBlock.id, delta)),
    remove: () => void removeSelected(),
    selectParent: () => { const parent = parentOf(current, selectedBlock.id); if (parent) setSelected(parent.id); },
    change: (next) => changeBlock(selectedBlock.id, next),
    setHeadingLevel: (level) => changeBlock(selectedBlock.id, (block) => setHeadingLevel(block, level)),
    setLink: (href) => changeBlock(selectedBlock.id, (block) => setButtonLink(block, href)),
    setImage: (image) => changeBlock(selectedBlock.id, (block) => setBlockImage(block, image)),
    setSpacer: (px) => changeBlock(selectedBlock.id, (block) => setSpacerHeight(block, px)),
    setCode: (code) => changeBlock(selectedBlock.id, (block) => setHtmlCode(block, code), `code:${selectedBlock.id}`),
    replace: (next) => { commit((doc) => updateBlock(doc, selectedBlock.id, () => next)); setSelected(next.id); },
    setAuto, addInside, auto, wordpressUrl,
    large, openLarge: () => { setLarge(true); setPanelOpen(false); window.scrollTo({ top: 0 }); },
  } : null;

  /** The blocks whose picture lies on another site than the connected one. */
  function externalImages() {
    if (!current) return [];
    const origin = baseUrl ? siteOrigin(baseUrl) : null;
    return [...allBlocks(current.parts)].filter((block) => isExternalImage(blockImage(block)?.url ?? "", origin)).map((block) => block.id);
  }
  /** Kopiera till mediabiblioteket: each picture on another site is copied by the server and the block points at the copy. */
  async function copyImages(ids: string[]) {
    if (!current || copying) return;
    let failed = 0;
    for (const id of ids) {
      const block = findBlock(current, id);
      const url = block ? blockImage(block)?.url ?? "" : "";
      if (!url) continue;
      setCopying(id);
      try {
        const media = await api<{ id: number; url: string }>("/api/website", { method: "POST", body: JSON.stringify({ action: "import-image", url }) });
        changeBlock(id, (next) => setBlockImage(next, { url: media.url, id: media.id }));
      } catch (cause) { failed += 1; setMessage({ text: (cause as Error).message, error: true }); }
    }
    setCopying(null);
    if (!failed && ids.length) setMessage({ text: ids.length === 1 ? "Bilden är kopierad till mediabiblioteket. Spara eller publicera sidan." : "Bilderna är kopierade till mediabiblioteket. Spara eller publicera sidan." });
  }
  const restore = async (backupId: string) => {
    if (!loaded || pageId === null) return;
    if (!(await confirm({ title: "Återställ den här versionen?", message: "Versionen skrivs till webbplatsen nu. Sidan som ligger där sparas först, och ett utkast i Workflow kastas.", confirmLabel: "Återställ", tone: "danger" }))) return;
    setBusy(true);
    try {
      await api("/api/website", { method: "POST", body: JSON.stringify({ action: "restore", backupId, baseModified: loaded.page.modified }) });
      await openPage(pageId);
      setMessage({ text: "Den tidigare versionen är återställd på webbplatsen." });
    } catch (cause) { failed(cause); } finally { setBusy(false); }
  };
  const discardDraft = async () => {
    if (pageId === null) return;
    if (!(await confirm({ title: "Kasta utkastet?", message: "Utkastet i Workflow tas bort och sidan öppnas som den är på webbplatsen.", confirmLabel: "Kasta utkastet", tone: "danger" }))) return;
    setBusy(true);
    try { await api("/api/website", { method: "POST", body: JSON.stringify({ action: "discard", pageId }) }); await openPage(pageId); setMessage({ text: "Utkastet är kastat." }); }
    catch (cause) { failed(cause); } finally { setBusy(false); }
  };
  const choosePage = async (id: number) => {
    if (id === pageId) return;
    if (dirty && !(await confirm({ title: "Byta sida?", message: "Ändringar som inte är sparade försvinner.", confirmLabel: "Byt sida", tone: "danger" }))) return;
    setMessage(null);
    setPageId(id);
  };
  const reload = () => { if (pageId !== null) { setMessage(null); void openPage(pageId); } };

  if (loadError) return <div className="notice text-destructive" role="alert">{loadError} <Button type="button" variant="outline" size="sm" className="ml-2" onClick={() => void loadOverview()}>Försök igen</Button></div>;
  if (!overview) return <p className="page-description">Hämtar webbplatsen…</p>;

  const messageLine = message ? <p className={cn("notice flex flex-wrap items-center gap-x-3 gap-y-1", message.error && "text-destructive")} role="status" data-testid="site-message">
    <span>{message.text}</span>
    {message.link?.href.startsWith("/") ? <Link href={message.link.href} className="font-medium text-primary underline underline-offset-2" data-testid="site-message-link">{message.link.label}</Link>
      : message.link ? <a href={message.link.href} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline underline-offset-2" data-testid="site-message-link">{message.link.label}</a> : null}
  </p> : null;

  // Without a connection the page says so and leads to Kopplingar, where the site's keys live (2026-11-10).
  if (!overview.connection.configured) return <div className="space-y-4" data-testid="website-editor">
    <PageHeader title="Webb och inlägg" description="Redigera företagets WordPress-sidor här. Koppla webbplatsen först." />
    {messageLine}
    <div className="notice flex flex-wrap items-center gap-3" data-testid="site-not-connected">
      <p className="min-w-0 flex-1">{overview.connection.passwordUnreadable ? "Lösenordet till webbplatsen kan inte läsas längre. Klistra in det igen under Kopplingar." : "Webbplatsen är inte kopplad. Koppla den under Kopplingar."}</p>
      <Button type="button" size="sm" asChild><Link href={WEB_CONNECTIONS_HREF} data-testid="site-connect-link"><Plug />Öppna Kopplingar</Link></Button>
    </div>
  </div>;

  const pageSelect = <select aria-label="Sida" className="form-select h-8 w-auto min-w-0 max-w-[14rem] max-lg:h-11" value={pageId ?? ""} disabled={busy} onChange={(event) => void choosePage(Number(event.target.value))} data-testid="site-page-select">
    {overview.pages.map((page) => <option key={page.id} value={page.id}>{page.title}{page.status !== "publish" ? " (ej publicerad)" : ""}{page.draftSavedAt ? " · utkast" : ""}</option>)}
  </select>;

  if (phone) return <div className="space-y-4" data-testid="website-editor-phone">
    <div className="notice flex items-start gap-3"><Monitor className="mt-0.5 size-5 shrink-0" aria-hidden="true" /><p><span className="font-semibold">Redigera på en dator.</span> Här visas sidan som den ser ut nu.</p></div>
    {pageSelect}
    {current ? <div className="landing-canvas min-w-0 overflow-hidden rounded-xl border bg-white"><TrueWidth testId="site-true-width"><WebsiteCanvas doc={current} api={{ ...canvasApi, editing: false }} /></TrueWidth></div> : null}
  </div>;

  const editable = Boolean(current) && mode === "edit";
  const selectedId = selectedBlock?.id ?? null;
  const inLarge = Boolean(large && mode === "edit" && selectedBlock && isHtml(selectedBlock) && panelApi);
  const remote = conflict || remoteChanged || Boolean(loaded?.stale);
  const ribbonGroups: EditorRibbonGroup[] = [
    { label: "Lägg till", items: NEW_BLOCKS.map((item) => ({ key: `add-${item.type}`, label: item.label, icon: item.icon, hint: item.type === "html" ? "Nytt HTML-block med egen kod, under det markerade" : `Nytt block: ${item.label.toLowerCase()}, under det markerade`, onSelect: () => addNew(item.type), disabled: !current })) },
    ...(auto ? [{ label: "Automatiskt", items: auto.client.kinds.map((item) => ({ key: `auto-${item.kind}`, label: item.short, icon: item.icon, hint: item.hint, onSelect: () => addAuto(item.kind), disabled: !current })) }] : []),
    // Sökmotorer och delning: only for a site with the SEO meta (the optional plugin); without it nothing changes here.
    ...(loaded?.wpSeo ? [{ label: "Sidan", items: [{ key: "seo", label: "Sökmotorer", icon: Search, hint: "Titel, beskrivning, sökmotorer och delningsbild för sidan", onSelect: () => { setSelected(null); setLarge(false); setSeoOpen(true); openPanelOnSmallScreens(); }, pressed: seoOpen, disabled: !current }] }] : []),
    { label: "Markerat", items: [
      { key: "up", label: "Flytta upp", icon: ArrowUp, hint: "Flytta det markerade blocket uppåt", onSelect: () => selectedId && commit((doc) => moveBlock(doc, selectedId, -1)), disabled: !selectedId || !current || !canMove(current, selectedId, -1) },
      { key: "down", label: "Flytta ned", icon: ArrowDown, hint: "Flytta det markerade blocket nedåt", onSelect: () => selectedId && commit((doc) => moveBlock(doc, selectedId, 1)), disabled: !selectedId || !current || !canMove(current, selectedId, 1) },
      { key: "remove", label: "Ta bort", icon: Trash2, tone: "danger", hint: "Ta bort det markerade blocket", onSelect: () => void removeSelected(), disabled: !selectedId },
      { key: "settings", label: "Inställningar", icon: Wrench, hint: "Det markerade blockets inställningar", onSelect: () => { if (window.innerWidth < 1280) setPanelOpen(true); else document.querySelector<HTMLElement>("[data-testid=site-properties]")?.focus(); }, disabled: !selectedId },
    ] },
  ];

  const seoSettings = seoOpen && !selectedBlock && loaded?.wpSeo && seo ? <WebsiteSeoPanel seo={seo} pageTitle={loaded.page.title} pageLink={loaded.page.link} media={seoMedia}
    onChange={setSeo} onMedia={(item) => setSeoMedia((known) => [item, ...known.filter((other) => other.id !== item.id)])} /> : null;
  const settings = seoSettings ?? (selectedBlock && panelApi ? <BlockPanel block={selectedBlock} panel={panelApi} /> : null);
  const autoName = selectedBlock ? autoLabelOf(selectedBlock) : null;
  const settingsTitle = seoSettings ? "Sökmotorer och delning" : selectedBlock ? (autoName ? `Grupp: ${autoName}` : isLocked(selectedBlock) ? `Tillägg: ${selectedBlock.name}` : blockName(selectedBlock)) : "";
  const pageStatus = loaded?.page.status === "publish" ? "Publicerad" : "Sparad i WordPress, ej publicerad";
  const statusText = busy ? "Arbetar…" : status?.error ? status.text : dirty ? "Ändringar som inte är sparade" : remote ? "Ändrat i WordPress" : loaded?.hasDraft ? "Utkast sparat" : pageStatus;
  const statusTone = status?.error ? "error" : (dirty || remote) && !busy ? "unsaved" : "saved";
  const publicLink = loaded?.page.link && /^https?:\/\//.test(loaded.page.link) ? loaded.page.link : null;

  return <div className="space-y-4" data-testid="website-editor">
    {confirmElement}
    <PageHeader title="Webb och inlägg" description="Klicka på en text och skriv. Spara behåller ett utkast, Publicera skriver sidan till webbplatsen." />
    {loaded && current ? <PublishShareDialog open={shareOpen} title={loaded.page.title} warning={shareOpen ? publishWarning() : ""} baseMarkup={loaded.wpContent} nextMarkup={markup}
      siteOrigin={baseUrl ? siteOrigin(baseUrl) : null} onCancel={() => setShareOpen(false)} onPublish={(share) => { setShareOpen(false); void publishNow(share); }} /> : null}

    <EditorBar testId="site-editor-bar" ribbon={<EditorRibbon label="Redigera sidan" groups={ribbonGroups} testId="site-ribbon" disabled={!editable} />}>
      <EditorUndoRedo canUndo={history.index > 0} canRedo={history.index < history.states.length - 1} onUndo={undo} onRedo={redo} />
      <EditorSegmented label="Läge" value={mode} onChange={(value) => { setMode(value); if (value === "preview") { setSelected(null); setLarge(false); } }} compactOnPhone
        options={[{ value: "edit", label: "Redigera", icon: Pencil }, { value: "preview", label: "Förhandsgranska", icon: Eye }]} />
      {pageSelect}
      {mode === "edit" ? <EditorSegmented label="Visning" value={trueWidth} onChange={setTrueWidth} testId="site-scale"
        options={[{ value: true, label: "Som besökaren" }, { value: false, label: "Större text" }]} /> : null}
      <EditorStatus tone={statusTone} testId="site-save-status">{statusText}</EditorStatus>
      <EditorActions>
        {publicLink ? <Button type="button" variant="ghost" className={cn(EDITOR_BUTTON, "max-md:hidden")} asChild><a href={publicLink} target="_blank" rel="noreferrer noopener">Visa på webbplatsen</a></Button> : null}
        <Button type="button" variant="outline" className={EDITOR_BUTTON} disabled={!dirty || busy || !current} onClick={() => void save()} data-testid="site-save" title="Spara utkastet (Ctrl+S)"><Save />Spara</Button>
        <Button type="button" variant="outline" className={cn(EDITOR_BUTTON, "max-md:hidden")} disabled={!unpublished || busy || !current || conflict || remoteChanged} onClick={schedule.start} data-testid="site-schedule"><CalendarClock />Schemalägg</Button>
        <Button type="button" className={EDITOR_BUTTON} disabled={!unpublished || busy || !current || conflict || remoteChanged} onClick={() => void publish()} data-testid="site-publish"><Send />Publicera</Button>
        <EditorMoreMenu testId="site-more" items={[
          ...(publicLink ? [{ label: "Visa på webbplatsen", onSelect: () => window.open(publicLink, "_blank", "noopener"), className: "md:hidden" }] : []),
          { label: "Schemalägg publicering", onSelect: schedule.start, className: "md:hidden", disabled: !unpublished || busy || !current || conflict || remoteChanged },
          ...(wordpressUrl ? [{ label: "Öppna i WordPress", onSelect: () => window.open(wordpressUrl, "_blank", "noopener") }] : []),
          { label: "Kasta osparade ändringar", onSelect: () => void (async () => { if (await confirm({ title: "Kasta ändringarna?", message: "Allt du ändrat sedan senaste sparning tas bort.", confirmLabel: "Kasta", tone: "danger" })) { try { setHistory({ states: [parseBlocks(savedMarkup)], index: 0 }); } catch { /* the saved markup was read before */ } setSeo(savedSeo); setStatus(null); setLarge(false); } })(), disabled: !dirty },
          { label: "Kasta utkastet", onSelect: () => void discardDraft(), disabled: !loaded?.hasDraft, danger: true },
          { label: "Kopiera alla externa bilder", onSelect: () => void copyImages(externalImages()), disabled: !externalImages().length || Boolean(copying) },
          { label: "Ladda om sidan", onSelect: reload },
        ]} />
      </EditorActions>
    </EditorBar>

    {messageLine}
    {schedule.dialog}
    {schedule.panel}
    {(conflict || remoteChanged) ? <div className="notice flex flex-wrap items-center gap-3" role="alert" data-testid="site-conflict">
      <p className="min-w-0 flex-1">Sidan har ändrats i WordPress sedan du öppnade den. Ladda om för att se den nya versionen. Ändringar som inte är sparade försvinner.</p>
      <Button type="button" variant="outline" size="sm" onClick={reload}>Ladda om</Button>
    </div> : null}
    {loaded?.stale && !conflict && !remoteChanged ? <div className="notice flex flex-wrap items-center gap-3" role="status" data-testid="site-stale">
      <p className="min-w-0 flex-1">Sidan har ändrats i WordPress efter att utkastet sparades. Utkastet kan inte publiceras. Kasta det för att börja från sidan som den är nu.</p>
      <Button type="button" variant="outline" size="sm" onClick={() => void discardDraft()}>Kasta utkastet</Button>
    </div> : null}
    {overview.pagesError ? <p className="notice text-destructive" role="alert">{overview.pagesError}</p> : null}
    {look && !look.ok ? <p className="text-xs text-muted-foreground" data-testid="site-look-missing">Webbplatsens typsnitt kunde inte läsas. Redigeraren visar ett liknande typsnitt.</p> : null}
    {loaded?.error ? <p className="notice text-destructive" role="alert" data-testid="site-unreadable">Sidan går inte att läsa som block och kan inte redigeras här: {loaded.error}</p> : null}

    {inLarge && selectedBlock && panelApi ? <div className="grid items-start gap-4 xl:grid-cols-2" data-testid="site-code-large">
      <section aria-label="HTML-kod" className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 xl:sticky xl:top-[calc(5rem+var(--editor-bar-h,7rem))] xl:h-[calc(100dvh-6rem-var(--editor-bar-h,7rem))]">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">HTML-kod</h2>
          <Button type="button" variant="outline" size="sm" onClick={() => setLarge(false)} data-testid="site-html-large-close"><Minimize2 />Stäng stort läge</Button>
        </div>
        <HtmlCodeField key={selectedBlock.id} block={selectedBlock} panel={panelApi} large />
      </section>
      <section aria-label="Förhandsvisning" className="landing-canvas min-w-0 overflow-hidden rounded-xl border bg-white p-4 shadow-sm">
        {frameEnv ? <SiteFrame html={htmlCode(selectedBlock)} env={frameEnv} title="Förhandsvisning av HTML-koden" testId="site-large-frame" /> : null}
      </section>
    </div> : <div className={cn("grid items-start gap-4", mode === "edit" && "xl:grid-cols-[22rem_minmax(0,1fr)]")} data-testid="site-layout">
      {mode === "edit" ? <aside aria-label="Inställningar" tabIndex={-1} className={cn(EDITOR_SIDE_PANEL, "hidden outline-none xl:block")} data-testid="site-properties">
        <div className="panel-header flex min-h-[3.25rem] items-center justify-between gap-2 border-b px-4 py-2.5">
          <h2 className="truncate text-sm font-semibold">{settings ? settingsTitle : "Inställningar"}</h2>
          {settings ? <Button type="button" size="icon" variant="ghost" className="size-8" aria-label="Stäng inställningarna" onClick={() => { setSelected(null); setSeoOpen(false); }}><X /></Button> : null}
        </div>
        {settings ? <div className="p-4">{settings}</div> : <>
          <EditorPanelEmpty>Klicka på ett block på sidan för att se och ändra dess inställningar här. Texter ändrar du direkt på sidan, HTML-kod i panelen.</EditorPanelEmpty>
          <p className="px-4 pb-2 pt-2 text-xs font-medium text-foreground">Tidigare versioner</p>
          <BackupList backups={loaded?.backups ?? []} busy={busy} onRestore={(id) => void restore(id)} />
        </>}
      </aside> : null}
      <div className={cn("landing-canvas min-w-0 overflow-hidden rounded-xl border bg-white shadow-sm", mode === "edit" && "landing-canvas-edit")} data-testid="site-canvas"
        onClickCapture={(event) => { const link = (event.target as HTMLElement).closest("a"); if (link) event.preventDefault(); }}
        onClick={(event) => { if (mode === "edit" && !(event.target as HTMLElement).closest("[data-site-block]")) setSelected(null); }}>
        {current ? <TrueWidth scaled={trueWidth || mode === "preview"} testId="site-true-width"><WebsiteCanvas doc={current} api={canvasApi} /></TrueWidth> : <p className="p-8 text-sm text-slate-500">{busy ? "Hämtar sidan…" : "Välj en sida."}</p>}
      </div>
    </div>}
    {mode === "edit" && !inLarge ? <EditorRibbonSheet groups={ribbonGroups} label="Verktyg" icon={Wrench} description="Lägg till block eller ändra det markerade." testId="site-tools-sheet" /> : null}
    <SidePanel side="start" open={panelOpen && Boolean(settings) && mode === "edit" && !inLarge} onOpenChange={setPanelOpen} title={settingsTitle || "Inställningar"}>{settings}</SidePanel>
    {mode === "edit" && !inLarge ? <div className="xl:hidden"><AdvancedFold summary="Tidigare versioner av sidan"><BackupList backups={loaded?.backups ?? []} busy={busy} onRestore={(id) => void restore(id)} /></AdvancedFold></div> : null}
    <p className="text-xs text-muted-foreground" data-testid="site-connection-link">Kopplingen till webbplatsen ändras under <Link href={WEB_CONNECTIONS_HREF} className="font-medium text-primary underline underline-offset-2">Kopplingar</Link>.</p>
  </div>;
}
