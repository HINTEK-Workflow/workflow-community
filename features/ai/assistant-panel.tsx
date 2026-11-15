"use client";

import { plural } from "@/lib/plural";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Dialog, Popover } from "radix-ui";
import { Check, ChevronLeft, History, Info, Maximize2, Minimize2, MoreHorizontal, Pencil, Plus, RotateCcw, Send, Settings2, ShieldCheck, Sparkles, Square, Trash2, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatSwedish } from "@/lib/swedish-time";
import type { AssistantAsk } from "@/lib/extensions/types";
import { currentPageContext } from "@/features/workflow/flow-hint-store";
import { useLoadEffect } from "@/lib/use-load-effect";
import { useVisibleArea } from "@/features/kfid/ui";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { useBackClosesFirst } from "@/components/history-nav";
import { SHOW_CHROME_EVENT } from "@/lib/workflow/shell-events";
import { ASSISTANT_FULL_SCREEN_QUERY } from "@/lib/workflow/floating-nav";
import { chatDayLabel } from "@/lib/ai/chat-day";
import { ChatProposalCards, type ChatProposal } from "@/features/ai/chat-proposals";
import { IconButton } from "@/components/ui/icon-button";
import { RemoveButton } from "@/components/ui/remove-button";

type AssistantStatus = {
  lifecycle: "EXECUTION_LOCKED" | "READY";
  available: boolean;
  chatAvailable: boolean;
  /** The public demo (2026-10-10): there is no assistant to try, and the panel says so instead of "Kräver serverlagring". */
  demo?: boolean;
  role: "SUPERADMIN" | "OWNER" | "ADMIN" | "MEMBER";
  conditions: {
    provider: { ready: boolean; configured: boolean; evaluationApproved: boolean };
    sharingPolicy: { ready: boolean };
    creditLedger: { healthy: boolean };
    availableCredits: { available: boolean; balance: number };
  };
  sharingPolicy: { enabled: boolean; shareChatContent: boolean; shareWork?: boolean; shareControls?: boolean; allowedModules?: string[];
    /** Vad Workflow AI får göra (2026-10-09): the admin's switches; a switch left out is on. */
    abilities?: Partial<Record<"chatProposals" | "moreToolCalls" | "teamOverview" | "riskTogether", boolean>> };
};

/**
 * Whether the chat may take part with proposals (AI-beslut 1): the AI model is usable, the company shares its work and
 * the admin's switch Förslag från chatten is on – the server's own test (chatProposalToolNames), read from the status.
 */
const proposalsOn = (status: AssistantStatus) => {
  const policy = status.sharingPolicy;
  const work = Boolean(policy.shareWork || (policy.shareControls && policy.allowedModules?.includes("KFID")));
  return status.available && work && policy.abilities?.chatProposals !== false;
};

type ConversationSummary = { id: string; title: string; lastMessageAt: string | null; _count: { messages: number; proposals: number } };
type Citation = { resourceType: string; resourceId: string; title: string; description: string; href: string; citationLabel: string };
type ConversationMessage = { id: string; role: "USER" | "ASSISTANT"; content: string; model: string | null; citations: Citation[]; createdAt: string;
  /** Only in the panel: the question is on its way, or its answer failed and can be sent again. */
  pending?: boolean; failed?: string;
  /** The answer as it streams from the provider (2026-10-24); replaced by the saved answer when it is done. */
  streaming?: boolean;
  /** Förslag från chatten (2026-10-09): what the answer proposed, applied only by the person's Använd. */
  proposals?: ChatProposal[] };
type ChatResult = { error?: string; conversation: { id: string; title: string }; userMessage: ConversationMessage; message: ConversationMessage; chargedCredits?: number; balance?: number | null; mode?: "RULES" | "AI" };

const RULES_MODEL = "Workflow – direkt svar";
const SUGGESTIONS = ["Mina uppgifter", "Vad är förfallet?", "Min tid den här veckan", "Planering i morgon", "Pågående projekt"];
/**
 * Examples of work Workflow AI takes part in (2026-10-09), shown when proposals are on. They start a sentence in the
 * field for the person to finish (nothing is sent until they press Skicka), except the question that stands on its own.
 */
const WORK_SUGGESTIONS: { label: string; text: string; send?: boolean }[] = [
  { label: "Fyll i arbetsordern …", text: "Fyll i arbetsordern: " },
  { label: "Gör en arbetsorder …", text: "Gör en arbetsorder: " },
  { label: "Skriv tid …", text: "Skriv tid " },
  { label: "Planera in projektet …", text: "Planera in resten av projektet " },
  { label: "Offert från material …", text: "Skapa offert från materialet i projektet " },
  { label: "Vad saknas för att färdigställa?", text: "Vad saknas för att färdigställa?", send: true },
];

/**
 * Workflow AI's window (2026-11-02: "en popupruta ... känsla som det är i en mobil eller whatsapp, mer känsla av
 * konversation"; docs/ui-system.md "Motiverade varianter"): a popup anchored by the round button in the floating navigation,
 * which does not block the page behind it; under 640 px wide or on a phone on its side the whole screen; in visning 1 the app's
 * own screen with the same conversation. Own messages to the right, the assistant's to the left, the field at the bottom.
 * While it waits the assistant's bubble stands at once with lines of a soft skeleton ("det ska kännas som att AI:n tänker"), never
 * a spinner, and the text comes in its place. The saved conversations (a column when the window is enlarged), the AI
 * status and the memory are in the header's ⋯. A question is shown at once and answered in one request; direct answers from
 * Workflow are marked, AI answers show their cost and sources.
 */
export function AssistantPanel({ open, expanded, onOpenChange, onExpandedChange, ask }: {
  open: boolean; expanded: boolean; onOpenChange: (open: boolean) => void; onExpandedChange: (expanded: boolean) => void;
  /** A question from a tip's "Fråga Workflow AI", with the page's step (2026-10-01). */
  ask?: AssistantAsk | null;
}) {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [error, setError] = useState(false);
  const [compact, setCompact] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  /** The header's ⋯: its rows, or one of the two views behind them. */
  const [menuView, setMenuView] = useState<"menu" | "history" | "settings" | null>(null);
  const [wide, setWide] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary | null>(null);
  /** The answer that just arrived; only it is revealed word by word. */
  const [freshId, setFreshId] = useState<string | null>(null);
  /** Stoppa: stops the streaming answer; the server returns the reservation. */
  const stopper = useRef<AbortController | null>(null);
  const thread = useRef<HTMLDivElement | null>(null);
  /** The newest message stays in sight unless the person has rolled up to read. */
  const stick = useRef(true);
  const input = useRef<HTMLTextAreaElement | null>(null);
  // On a phone or tablet the chat keeps to what the keyboard leaves visible, so the field stays above it (2026-10-09).
  const phoneArea = useVisibleArea(open);
  // Nivå 1 på mobil (2026-10-10): the chat is a screen of the app above the tab bar – the top bar with Workflow AI
  // and the round × like the Ny and Mer sheets, one scrolling list of messages, the field at the bottom above the
  // keyboard; Bakåt and a tap on a tab close it first. Level 2–3, the tablet and the computer are unchanged.
  const native = useNativeMode();
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  useBackClosesFirst((native || compact) && open ? close : null);
  // Esc closes the chat on every level (MOB-07, 2026-10-18); a popover or the rename field that takes the key first has
  // already handled it (defaultPrevented), so the chat then stays.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);
  useEffect(() => {
    if (!native || !open) return;
    window.dispatchEvent(new Event(SHOW_CHROME_EVENT));
    // A tab (or Ny / Mer) closes the chat; the tab then does what it does.
    const onTab = (event: MouseEvent) => { if (event.target instanceof Element && event.target.closest(".native-tab-bar")) close(); };
    document.addEventListener("click", onTab, true);
    return () => document.removeEventListener("click", onTab, true);
  }, [native, open, close]);

  const listConversations = useCallback(async () => {
    const response = await fetch("/api/ai/conversations", { cache: "no-store" });
    if (!response.ok) throw new Error("list");
    const next = ((await response.json()) as { conversations: ConversationSummary[] }).conversations;
    setConversations(next);
    return next;
  }, []);

  const load = useCallback(async () => {
    setError(false);
    try {
      const statusResponse = await fetch("/api/ai/status", { cache: "no-store" });
      if (!statusResponse.ok) throw new Error("status");
      setStatus((await statusResponse.json()) as AssistantStatus);
      await listConversations();
    } catch {
      setError(true);
    }
  }, [listConversations]);

  const openConversation = useCallback(async (id: string) => {
    setLoadingThread(true);
    setNotice("");
    stick.current = true;
    try {
      const response = await fetch(`/api/ai/conversations?conversationId=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("conversation");
      const data = (await response.json()) as { conversation: { id: string; messages: ConversationMessage[] } };
      setActiveId(data.conversation.id);
      setMessages(data.conversation.messages);
    } catch {
      setNotice("Konversationen kunde inte läsas in.");
    } finally {
      setLoadingThread(false);
    }
  }, []);

  const startNew = useCallback(() => {
    setActiveId(null); setMessages([]); setDraft(""); setNotice(""); setHistoryOpen(false); setMenuView(null);
    window.setTimeout(() => input.current?.focus(), 50);
  }, []);

  const send = useCallback(async (text: string, retryId?: string, page?: unknown) => {
    const content = text.trim();
    if (!content || sending || !status?.chatAvailable) return;
    setSending(true);
    setNotice("");
    stick.current = true;
    const pendingId = retryId ?? `pending-${Date.now()}`;
    // The question is shown at once; the server saves it and answers in the same request.
    setMessages((current) => [...current.filter((message) => message.id !== pendingId), { id: pendingId, role: "USER", content, model: null, citations: [], createdAt: new Date().toISOString(), pending: true }]);
    setDraft("");
    try {
      // Strömning (2026-10-24): the answer arrives as it is written – lines of JSON, the last one the same answer as before.
      const controller = new AbortController();
      stopper.current = controller;
      const streamId = `stream-${pendingId}`;
      let streamed = false;
      const response = await fetch("/api/ai/chat?stream=1", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ content, conversationId: activeId ?? undefined, ...(page ?? currentPageContext() ? { page: page ?? { ...(currentPageContext() as object), source: "page" } } : {}) }) });
      const show = (text: string | null) => setMessages((current) => {
        const rest = current.filter((message) => message.id !== streamId);
        return text === null ? rest : [...rest, { id: streamId, role: "ASSISTANT", content: text, model: null, citations: [], createdAt: new Date().toISOString(), streaming: true }];
      });
      let done: { status: number; body: ChatResult } | null = null;
      if ((response.headers.get("content-type") ?? "").includes("ndjson") && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let text = "";
        for (;;) {
          const { value, done: ended } = await reader.read();
          buffer += decoder.decode(value ?? new Uint8Array(), { stream: !ended });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as { type: "delta"; text: string } | { type: "reset" } | { type: "done"; status: number; body: ChatResult };
            if (event.type === "delta") { text += event.text; streamed = true; show(text); }
            else if (event.type === "reset") { text = ""; show(null); }
            else done = { status: event.status, body: event.body };
          }
          if (ended) break;
        }
      } else done = { status: response.status, body: (await response.json()) as ChatResult };
      show(null);
      if (!done) throw new Error("Svaret kunde inte hämtas.");
      const result = done.body;
      if (done.status >= 400) throw new Error(result.error || "Svaret kunde inte hämtas.");
      setActiveId(result.conversation.id);
      // A streamed answer has already been read as it came; only an answer that arrived whole is revealed word by word.
      setFreshId(streamed ? null : result.message.id);
      setMessages((current) => [...current.filter((message) => message.id !== pendingId && message.id !== streamId), result.userMessage, result.message]);
      setNotice(result.mode === "AI" ? `AI-svaret använde ${result.chargedCredits ?? 0} krediter${typeof result.balance === "number" ? ` · ${result.balance} kvar` : ""}.` : "Svarat direkt ur Workflow – gratis.");
      if (result.mode === "AI" && typeof result.balance === "number") { const balance = result.balance; setStatus((current) => current ? { ...current, conditions: { ...current.conditions, availableCredits: { available: balance > 0, balance } } } : current); }
      void listConversations().catch(() => undefined);
    } catch (cause) {
      const stopped = cause instanceof DOMException && cause.name === "AbortError";
      const text = stopped ? "Svaret stoppades. Inga krediter drogs." : cause instanceof Error ? cause.message : "Svaret kunde inte hämtas.";
      setMessages((current) => current.filter((message) => !message.streaming).map((message) => (message.id === pendingId ? { ...message, pending: false, failed: text } : message)));
    } finally {
      stopper.current = null;
      setSending(false);
    }
  }, [activeId, listConversations, sending, status?.chatAvailable]);

  const mutateConversation = useCallback(async (body: { action: "rename"; conversationId: string; title: string } | { action: "archive"; conversationId: string }) => {
    try {
      const response = await fetch("/api/ai/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error("conversation");
      const next = await listConversations();
      if (body.action === "archive" && activeId === body.conversationId) { setActiveId(null); setMessages([]); if (next[0]) void openConversation(next[0].id); }
      setDeleteTarget(null);
    } catch {
      setNotice("Ändringen kunde inte sparas.");
    }
  }, [activeId, listConversations, openConversation]);

  useLoadEffect(load, open && !status && !error);
  // A tip's question is sent once, as soon as the panel knows the assistant is available.
  const handledAsk = useRef<number | null>(null);
  useEffect(() => {
    if (!ask || handledAsk.current === ask.id || !status?.chatAvailable || sending) return;
    handledAsk.current = ask.id;
    void send(ask.question, undefined, ask.page);
  }, [ask, send, sending, status?.chatAvailable]);
  useEffect(() => {
    const media = window.matchMedia(ASSISTANT_FULL_SCREEN_QUERY);
    const large = window.matchMedia("(min-width: 1280px)");
    const update = () => { setCompact(media.matches); setWide(large.matches); };
    update();
    media.addEventListener("change", update);
    large.addEventListener("change", update);
    return () => { media.removeEventListener("change", update); large.removeEventListener("change", update); };
  }, []);
  useEffect(() => {
    if (!open || !stick.current) return;
    const toEnd = () => { if (thread.current) thread.current.scrollTop = thread.current.scrollHeight; };
    toEnd();
    const frame = window.requestAnimationFrame(toEnd);
    return () => window.cancelAnimationFrame(frame);
  }, [messages, sending, open, loadingThread]);
  useEffect(() => { if (open && !native) window.setTimeout(() => input.current?.focus(), 80); }, [open, native]);

  const directOnly = Boolean(status && status.chatAvailable && !status.available);
  // A member has no Workflow AI or Abonnemang och krediter tab since 2026-10-07: this line is what they see of the
  // company's choice and the credits; the links to those pages are the admin's.
  const manages = status ? status.role !== "MEMBER" : false;
  const history = (
    <ConversationList conversations={conversations} activeId={activeId} onOpen={(id) => { setHistoryOpen(false); setMenuView(null); void openConversation(id); }} onRename={(id, title) => void mutateConversation({ action: "rename", conversationId: id, title })} onDelete={setDeleteTarget} />
  );

  // The message field (2026-11-02, as in a messenger; replaces the big field in an empty conversation of 2026-10-09):
  // always at the bottom, a round field that grows with the text, a round Skicka inside the field at its lower right corner (
  // 2026-11-06: in the field, not beside it at the window's edge), 16 px text on a phone. Three lines from the start in every form of
  // the window (2026-11-02; the min height counts the field's own lines, since field-sizing ignores rows). One can write on
  // while an answer is on its way; Enter sends when it has come.
  const composer = <>
    <label htmlFor="ai-message-draft" className="sr-only">Meddelande till Workflow AI</label>
    <form className="relative mx-auto w-full max-w-3xl text-left" onSubmit={(event) => { event.preventDefault(); void send(draft); }}>
      <textarea ref={input} id="ai-message-draft" rows={3} value={draft} maxLength={8_000} onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(draft); } }}
        disabled={!status?.chatAvailable}
        placeholder={status?.chatAvailable ? "Fråga något…" : status?.demo ? "Workflow AI går inte att prova i demon" : "Assistenten kräver serverlagring"}
        className="block max-h-32 min-h-[calc(3lh+1.375rem)] w-full resize-none rounded-[1.375rem] border bg-card py-2.5 pl-4 pr-14 text-base outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15 disabled:opacity-60 sm:text-sm" style={{ fieldSizing: "content" } as React.CSSProperties} />
      {sending ? <IconButton label="Stoppa svaret" variant="outline" className="absolute bottom-1.5 right-1.5 size-10 rounded-full" onClick={() => stopper.current?.abort()} data-testid="assistant-stop"><Square className="size-4" /></IconButton>
        : <IconButton label="Skicka meddelande" variant="default" className="absolute bottom-1.5 right-1.5 size-10 rounded-full" type="submit" disabled={!draft.trim() || !status?.chatAvailable}><Send /></IconButton>}
    </form>
  </>;

  const historyPopover = <Popover.Root open={historyOpen} onOpenChange={setHistoryOpen}>
    <Popover.Trigger asChild><IconButton label="Konversationer" className={native ? "size-11" : undefined} data-testid="assistant-history"><History /></IconButton></Popover.Trigger>
    <Popover.Portal><Popover.Content align={native ? "start" : "end"} sideOffset={6} className="z-[70] w-80 max-w-[calc(100vw-2rem)] rounded-xl border bg-popover p-2 shadow-lg">
      <p className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Konversationer</p>
      <div className="max-h-80 overflow-y-auto">{history}</div>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
  const settingsBody = <>
      {status ? <StatusCard status={status} /> : null}
      {status?.chatAvailable ? <AssistantMemory /> : null}
      {manages ? <Link href="/?view=company_features&section=ai" onClick={() => onOpenChange(false)} className="mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium text-primary hover:bg-secondary" data-testid="assistant-permissions-link"><ShieldCheck className="size-4" />Vad Workflow AI får göra och läsa</Link> : null}
      <p className="mt-3 text-xs leading-5 text-muted-foreground">AI-svar använder krediter. Kostnaden visas när svaret är klart.{manages ? <> <Link href="/?view=company&section=billing" onClick={() => onOpenChange(false)} className="underline">Se abonnemang och krediter</Link>.</> : " Företagets administratör sköter krediterna."}</p>
  </>;
  const settingsPopover = <Popover.Root>
    <Popover.Trigger asChild><IconButton label="AI-status och minne" className={native ? "size-11" : undefined} data-testid="assistant-settings"><Settings2 /></IconButton></Popover.Trigger>
    <Popover.Portal><Popover.Content align={native ? "start" : "end"} sideOffset={6} className="z-[70] max-h-[70dvh] w-[22rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border bg-popover p-3 shadow-lg">{settingsBody}</Popover.Content></Popover.Portal>
  </Popover.Root>;
  // The popup's ⋯ (2026-11-02): what is rarely used, one small menu instead of a row of icons; the views open in its place.
  const canEnlarge = wide && !compact;
  const menuRow = "flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground";
  const menuBack = (title: string) => <button type="button" onClick={() => setMenuView("menu")} className={cn(menuRow, "mb-1 font-medium")} data-testid="assistant-menu-back"><ChevronLeft />{title}</button>;
  const headerMenu = <Popover.Root open={menuView !== null} onOpenChange={(next) => setMenuView(next ? "menu" : null)}>
    <Popover.Trigger asChild><IconButton label="Mer om Workflow AI" data-testid="assistant-menu"><MoreHorizontal /></IconButton></Popover.Trigger>
    <Popover.Portal><Popover.Content align="end" sideOffset={6} className="z-[70] max-h-[min(32rem,70dvh)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border bg-popover p-2 shadow-lg" data-testid="assistant-menu-content">
      {menuView === "history" ? <>{menuBack("Konversationer")}{history}</>
        : menuView === "settings" ? <>{menuBack("AI-status och minne")}<div className="px-1 pb-1">{settingsBody}</div></>
          : <>
            {expanded && canEnlarge ? null : <button type="button" onClick={() => setMenuView("history")} className={menuRow} data-testid="assistant-history"><History />Konversationer</button>}
            <button type="button" onClick={() => setMenuView("settings")} className={menuRow} data-testid="assistant-settings"><Settings2 />AI-status och minne</button>
            {canEnlarge ? <button type="button" onClick={() => { onExpandedChange(!expanded); setMenuView(null); }} className={menuRow} data-testid="assistant-enlarge">{expanded ? <><Minimize2 />Mindre fönster</> : <><Maximize2 />Större fönster</>}</button> : null}
          </>}
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
  // Level 1: the top bar of the app's screens – Konversationer and AI-status to the left, Workflow AI in the middle, Ny
  // konversation and the round × (Stäng) to the right, like the Ny and Mer sheets.
  const nativeBar = <div className="native-top-bar shrink-0 border-b px-2 py-1.5" data-testid="native-assistant-bar">
    <div className="flex items-center">{historyPopover}{settingsPopover}</div>
    <div className="min-w-0 text-center">
      <h2 className="native-top-bar-title" data-testid="native-assistant-title">Workflow AI</h2>
      {status ? <p className="max-w-[55vw] truncate text-[0.6875rem] leading-4 text-muted-foreground" data-testid="assistant-rules-notice">
        {!status.chatAvailable ? (status.demo ? "Går inte att prova i demon" : "Kräver serverlagring") : directOnly ? "Direkta svar · Workflow AI är av för företaget" : `Workflow AI är på · ${status.conditions.availableCredits.balance} krediter kvar`}
      </p> : <p className="max-w-[55vw] truncate text-[0.6875rem] leading-4 text-muted-foreground">Gemensam Workflow-assistent</p>}
    </div>
    <div className="flex items-center justify-end gap-1">
      <IconButton label="Ny konversation" className={native ? "size-11" : undefined} onClick={startNew}><Plus /></IconButton>
      <button type="button" className="native-sheet-close" aria-label="Stäng Workflow AI" onClick={close} data-testid="native-assistant-close"><X aria-hidden="true" /></button>
    </div>
  </div>;

  const content = (
    <div className="flex h-full min-h-0 flex-col" data-testid="assistant-panel">
      {native ? nativeBar : <div className="flex h-14 shrink-0 items-center gap-1 border-b pl-3 pr-2" data-testid="assistant-header">
        <span className="mr-1.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Sparkles className="size-5" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-tight">Workflow AI</p>
          {status ? <p className="truncate text-xs text-muted-foreground" data-testid="assistant-rules-notice">
            {!status.chatAvailable ? (status.demo ? "Går inte att prova i demon" : "Kräver serverlagring") : directOnly ? "Direkta svar · Workflow AI är av för företaget" : `Workflow AI är på · ${status.conditions.availableCredits.balance} krediter kvar`}
          </p> : <p className="truncate text-xs text-muted-foreground">Gemensam Workflow-assistent</p>}
        </div>
        <IconButton label="Ny konversation" onClick={startNew}><Plus /></IconButton>
        {headerMenu}
        <IconButton label="Stäng Workflow AI" onClick={close} data-testid="assistant-close"><X /></IconButton>
      </div>}

      <div className={cn("flex min-h-0 flex-1 flex-col", expanded && canEnlarge && !native && "grid grid-cols-[16rem_minmax(0,1fr)] grid-rows-[minmax(0,1fr)]")}>
        {expanded && canEnlarge && !native ? <aside aria-label="Konversationer" className="min-h-0 overflow-y-auto border-r p-2">
          <div className="flex items-center justify-between px-2 pb-1 pt-1"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Konversationer</p><Button type="button" variant="ghost" size="sm" onClick={startNew}><Plus />Ny</Button></div>
          {history}
        </aside> : null}
        <div className="flex min-h-0 flex-1 flex-col">
          <div ref={thread} onScroll={(event) => { const box = event.currentTarget; stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < 64; }} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-muted/40 px-3 py-3" aria-live="polite" data-testid="assistant-thread">
            {!status && !error ? <div className="flex min-h-full flex-col justify-end"><ThinkingBubble label="Kontrollerar AI-beredskap" /></div>
              : error ? <div className="py-6 text-sm text-destructive" role="alert">AI-status kunde inte hämtas. <Button type="button" variant="outline" size="sm" className="ml-2" onClick={() => void load()}>Försök igen</Button></div>
              : loadingThread ? <div className="flex min-h-full flex-col justify-end"><ThinkingBubble label="Läser in konversationen" /></div>
              : !messages.length ? <Welcome status={status!} hint={!native} onPick={(text) => void send(text)} onDraft={(text) => { setDraft(text); window.setTimeout(() => { const field = input.current; if (field) { field.focus(); field.setSelectionRange(text.length, text.length); } }, 0); }} />
              : <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-end gap-2" aria-label="Meddelanden">
                {messages.map((message, index) => {
                  const day = chatDayLabel(message.createdAt);
                  return <Fragment key={message.id}>
                    {index === 0 || chatDayLabel(messages[index - 1]!.createdAt) !== day ? <p className="my-1 self-center rounded-full bg-card px-2.5 py-0.5 text-[0.6875rem] text-muted-foreground shadow-xs" data-testid="assistant-day">{day}</p> : null}
                    <MessageBubble message={message} fresh={message.id === freshId} onCitation={() => onOpenChange(false)} onRetry={() => void send(message.content, message.id)} />
                  </Fragment>;
                })}
                {sending && !messages.some((message) => message.streaming) ? <ThinkingBubble /> : null}
              </div>}
          </div>
          <div className={cn("shrink-0 border-t bg-card px-3 py-2", native && "native-assistant-composer bg-background")}>
            {notice ? <p className="mb-1.5 text-center text-[0.6875rem] leading-4 text-muted-foreground" role="status">{notice}</p> : null}
            {composer}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Beside the page, not over it: no dimming and no focus trap, so the page behind can still be read and used. With the keyboard up on a tablet it keeps to what is visible. */}
      {open && !native && !compact ? <div role="dialog" aria-modal="false" aria-label="Workflow AI" className="assistant-popup" data-expanded={(expanded && canEnlarge) || undefined} data-testid="assistant-popup"
        style={phoneArea?.keyboard ? { top: `${phoneArea.top + 8}px`, bottom: "auto", height: `${phoneArea.height - 16}px` } : undefined}>{content}</div> : null}
      {native && open ? <div role="dialog" aria-modal="false" aria-label="Workflow AI" className="native-assistant" data-keyboard={phoneArea?.keyboard || undefined} style={nativeAssistantStyle(phoneArea)} data-testid="native-assistant">{content}</div> : null}
      <Dialog.Root open={open && compact && !native} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Content style={phoneArea ? { top: `${phoneArea.top}px`, bottom: "auto", height: `${phoneArea.height}px` } : undefined} className="fixed inset-0 z-50 bg-card" data-testid="assistant-full-screen">
            <Dialog.Title className="sr-only">Workflow AI-assistent</Dialog.Title>
            <Dialog.Description className="sr-only">Gemensam AI-assistent för Workflow.</Dialog.Description>
            {content}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={Boolean(deleteTarget)} onOpenChange={(next) => { if (!next) setDeleteTarget(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/45" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-5 shadow-xl">
            <Dialog.Title className="text-base font-semibold">Radera konversation?</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">Konversationen ”{deleteTarget?.title}” tas bort från din historik. Åtgärden påverkar ingen annan användare.</Dialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close asChild><Button type="button" variant="outline">Avbryt</Button></Dialog.Close>
              <Button type="button" variant="destructive" disabled={!deleteTarget} onClick={() => { if (deleteTarget) void mutateConversation({ action: "archive", conversationId: deleteTarget.id }); }}><Trash2 /> Radera</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

/** Level 1: the chat ends above the tab bar, or above the keyboard while it is up (the tab bar gives way to it). */
function nativeAssistantStyle(area: ReturnType<typeof useVisibleArea>): React.CSSProperties | undefined {
  if (!area || typeof document === "undefined") return undefined;
  const bar = area.keyboard ? 0 : document.querySelector(".native-tab-bar")?.getBoundingClientRect().height ?? 0;
  return { top: `${area.top}px`, height: `${Math.max(200, area.height - bar)}px` };
}

/** The empty window: what to ask, with questions that are sent at once. */
function Welcome({ status, hint, onPick, onDraft }: { status: AssistantStatus; hint: boolean; onPick: (text: string) => void; onDraft: (text: string) => void }) {
  const proposals = status.chatAvailable && proposalsOn(status);
  const chip = "rounded-full border bg-card px-3 py-1.5 text-xs font-medium hover:border-primary/40 hover:bg-secondary hover:text-primary";
  return <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-end px-1 pb-1 pt-3 text-center">
    <span className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground"><Sparkles className="size-6" aria-hidden="true" /></span>
    <h2 className="mt-4 text-base font-semibold">Vad vill du veta?</h2>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">
      {!status.chatAvailable ? (status.demo ? "Workflow AI går inte att prova i demon." : <>I Local ligger dina data i den egna filen, så assistenten kan inte läsa dem. <Link href="/?view=company&section=billing" className="font-medium text-primary underline">Se vad Cloud ger</Link>.</>)
        : proposals ? "Fråga om ditt arbete, eller be om ett förslag som du godkänner med Använd. Vanliga frågor kostar inga krediter."
          : "Fråga om ditt arbete. Vanliga frågor kostar inga krediter."}
    </p>
    {status.chatAvailable ? <div className="mt-4 flex flex-wrap justify-center gap-2">
      {SUGGESTIONS.map((suggestion) => <button key={suggestion} type="button" onClick={() => onPick(suggestion)} className={chip}>{suggestion}</button>)}
    </div> : null}
    {proposals ? <div className="mt-2 flex flex-wrap justify-center gap-2" aria-label="Förslag som Workflow AI kan ta fram" data-testid="assistant-work-suggestions">
      {WORK_SUGGESTIONS.map((suggestion) => <button key={suggestion.label} type="button" onClick={() => suggestion.send ? onPick(suggestion.text) : onDraft(suggestion.text)} className={chip}>{suggestion.label}</button>)}
    </div> : null}
    {status.chatAvailable && !status.available ? <p className="mt-4 flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-left text-xs leading-5 text-muted-foreground">
      <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span data-testid="assistant-ai-off-notice">{!status.conditions.provider.ready ? "Vanliga frågor fungerar. AI är inte påslaget på servern än." : status.role === "MEMBER" ? "Workflow AI är av för företaget. Administratören kan slå på den." : <>Workflow AI är av för företaget. Slå på den under <Link href="/?view=company_features&section=ai" className="font-medium text-primary underline">Inställningar → Arbetssätt → Workflow AI</Link>.</>}</span>
    </p> : null}
    {hint && status.chatAvailable ? <p className="mt-4 text-[11px] leading-4 text-muted-foreground">Enter skickar, Skift + Enter ger ny rad. Svaren bygger bara på det du själv får se.</p> : null}
  </div>;
}

/** One message: the person's to the right, the assistant's with its mark (direct answer or model), sources and time. */
function MessageBubble({ message, fresh, onCitation, onRetry }: { message: ConversationMessage; fresh: boolean; onCitation: () => void; onRetry: () => void }) {
  const mine = message.role === "USER";
  const direct = message.model === RULES_MODEL;
  const text = useReveal(message.content, fresh && !mine);
  // A new answer takes its final height at once (the whole text, unseen, under the words coming), so the bubble never grows.
  const revealing = !mine && text !== message.content;
  return <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
    <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-xs", mine ? "rounded-br-sm bg-primary text-primary-foreground" : "min-w-56 rounded-bl-sm border bg-card", message.pending && "opacity-70")} data-testid={mine ? "assistant-user-message" : "assistant-answer"}>
      {mine ? <p className="whitespace-pre-wrap break-words">{message.content}</p>
        : revealing ? <div className="grid"><div className="invisible col-start-1 row-start-1"><AnswerBody text={message.content} /></div><div className="col-start-1 row-start-1"><AnswerBody text={text} /></div></div>
          : <AnswerBody text={text} />}
      {message.failed ? <p className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span className="opacity-90">{message.failed}</span><button type="button" onClick={onRetry} className="inline-flex items-center gap-1 rounded-md bg-primary-foreground/15 px-2 py-0.5 font-medium hover:bg-primary-foreground/25"><RotateCcw className="size-3" />Försök igen</button></p> : null}
      {!mine && message.citations?.length ? <div className="mt-2 flex flex-wrap gap-1.5" aria-label="AI-svarets källor">
        {message.citations.map((citation) => <Link key={`${citation.resourceType}:${citation.resourceId}:${citation.href}`} href={citation.href} onClick={onCitation} className="rounded-md border bg-background px-2 py-1 text-[0.6875rem] text-primary hover:bg-secondary">{citation.citationLabel}</Link>)}
      </div> : null}
      {!mine && message.proposals?.length ? <ChatProposalCards proposals={message.proposals} onNavigate={onCitation} /> : null}
      <p className={cn("mt-1 flex items-center gap-2 text-[0.6875rem] leading-4", mine ? "justify-end text-primary-foreground/70" : "justify-between text-muted-foreground")}>
        {!mine ? <span className="inline-flex min-w-0 items-center gap-1"><span className="shrink-0">{direct ? <Zap className="size-3" aria-hidden="true" /> : <Sparkles className="size-3" aria-hidden="true" />}</span><span className="truncate">{direct ? RULES_MODEL : message.model ?? "AI"}</span></span> : null}
        <span className="shrink-0">{message.pending ? "Skickar…" : message.streaming ? "Skriver…" : formatSwedish(message.createdAt, { timeStyle: "short" })}</span>
      </p>
    </div>
  </div>;
}

/** **bold** and `code` inside a line (2026-10-02: the stars were shown as they were). */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).filter(Boolean).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={index} className="font-semibold">{part.slice(2, -2)}</strong>
      : part.startsWith("`") && part.endsWith("`") && part.length > 2 ? <code key={index} className="rounded bg-muted px-1 py-px text-[0.8125rem]">{part.slice(1, -1)}</code>
        : <Fragment key={index}>{part}</Fragment>);
}

/**
 * The assistant's text: bullet lines become a list, numbered lines a numbered list, a short line ending with a colon
 * (or a markdown heading) a heading, the rest paragraphs; **bold** and `code` are shown as such.
 */
export function AnswerBody({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((item, index) => <li key={index} className="break-words">{inline(item)}</li>);
    blocks.push(list.ordered ? <ol key={`l${blocks.length}`} className="my-1 list-decimal space-y-0.5 pl-5">{items}</ol> : <ul key={`l${blocks.length}`} className="my-1 list-disc space-y-0.5 pl-4">{items}</ul>);
    list = null;
  };
  for (const line of lines) {
    const bullet = /^\s*[•*\-–]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d{1,2}[.)]\s+(.*)$/.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      const ordered = !bullet;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push(item[1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (heading || (line.length <= 80 && /:$/.test(line.trim()))) blocks.push(<p key={`h${blocks.length}`} className="mt-1.5 font-semibold first:mt-0">{inline((heading ? heading[1] : line).trim().replace(/^\*\*(.*)\*\*$/, "$1"))}</p>);
    else blocks.push(<p key={`p${blocks.length}`} className="break-words [&:not(:first-child)]:mt-1">{inline(line)}</p>);
  }
  flush();
  return <div className="whitespace-pre-wrap">{blocks}</div>;
}

/**
 * The assistant is thinking (2026-11-02: "skeleton laddning eller liknande, inte rund cirkel, det ska kännas som att AI:n
 * tänker"): its bubble stands at once to the left with three soft shimmering lines and the quiet, changing words of 2026-10-02
 * where the time will be; the text comes in the same place. `label`: the window itself is being read. Reduced motion: still lines.
 */
const WAITING_STEPS = ["Läser frågan", "Letar i Workflow", "Tänker", "Skriver svaret"] as const;
function ThinkingBubble({ label }: { label?: string }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timers = [900, 2_600, 6_000].map((delay, index) => window.setTimeout(() => setStep(index + 1), delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);
  const words = label ?? WAITING_STEPS[step];
  return <div className="flex justify-start" role="status" data-testid="assistant-waiting">
    <div className="w-56 max-w-[85%] rounded-2xl rounded-bl-sm border bg-card px-3 py-2 shadow-xs" data-testid="assistant-thinking">
      <div aria-hidden="true" className="ai-thinking space-y-2 py-1"><span className="w-full" /><span className="w-4/5" /><span className="w-3/5" /></div>
      <p className="mt-1 text-[0.6875rem] leading-4"><span key={words} className="ai-shimmer-text animate-in fade-in duration-300">{words}…</span></p>
    </div>
  </div>;
}

/** A new answer appears word by word, quickly, like in other chats; earlier answers and reduced motion show at once. */
function useReveal(text: string, animate: boolean) {
  const [still] = useState(() => !animate || typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (still) return;
    // About a second at most, whatever the length.
    const step = Math.max(3, Math.ceil(text.length / 60));
    const timer = window.setInterval(() => setShown((current) => {
      if (current >= text.length) { window.clearInterval(timer); return current; }
      const next = text.indexOf(" ", current + step);
      return next === -1 ? text.length : next;
    }), 16);
    return () => window.clearInterval(timer);
  }, [still, text]);
  return still ? text : text.slice(0, shown);
}

/** The saved conversations: open, rename in place, delete. Compact rows, so the list never crowds the chat. */
function ConversationList({ conversations, activeId, onOpen, onRename, onDelete }: { conversations: ConversationSummary[]; activeId: string | null; onOpen: (id: string) => void; onRename: (id: string, title: string) => void; onDelete: (conversation: ConversationSummary) => void }) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  if (!conversations.length) return <p className="px-2 py-3 text-xs text-muted-foreground">Ingen konversation är sparad ännu.</p>;
  return <ul className="space-y-0.5" aria-label="Konversationshistorik">
    {conversations.map((conversation) => <li key={conversation.id} className={cn("group/row flex items-center gap-1 rounded-lg text-sm", activeId === conversation.id ? "bg-secondary" : "hover:bg-muted")}>
      {renamingId === conversation.id ? <form className="flex min-w-0 flex-1 items-center gap-1 p-1" onSubmit={(event) => { event.preventDefault(); if (title.trim()) { onRename(conversation.id, title.trim()); setRenamingId(null); } }}>
        <label className="sr-only" htmlFor={`rename-${conversation.id}`}>Nytt namn</label>
        <input id={`rename-${conversation.id}`} autoFocus maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setRenamingId(null); } }} className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm" />
        <IconButton label="Spara namnet" type="submit" disabled={!title.trim()}><Check /></IconButton>
      </form> : <Fragment>
        <button type="button" aria-pressed={activeId === conversation.id} onClick={() => onOpen(conversation.id)} className="min-w-0 flex-1 px-2 py-1.5 text-left">
          <span className="block truncate font-medium">{conversation.title}</span>
          <span className="block text-[11px] text-muted-foreground">{plural(conversation._count.messages, "meddelande", "meddelanden")}{conversation.lastMessageAt ? ` · ${formatSwedish(conversation.lastMessageAt, { dateStyle: "short" })}` : ""}</span>
        </button>
        <span className="flex shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
          <IconButton label={`Byt namn på ${conversation.title}`} onClick={() => { setRenamingId(conversation.id); setTitle(conversation.title); }}><Pencil /></IconButton>
          <RemoveButton label={`Radera ${conversation.title}`} onClick={() => onDelete(conversation)} />
        </span>
      </Fragment>}
    </li>)}
  </ul>;
}

/** The AI conditions, compact: what works now and what the AI model needs. */
function StatusCard({ status }: { status: AssistantStatus }) {
  const row = (label: string, ok: boolean, text: string) => <Fragment key={label}><dt className="text-muted-foreground">{label}</dt><dd className={cn("font-medium", ok ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300")}>{text}</dd></Fragment>;
  return <section aria-label="AI-villkor" className="rounded-lg border p-3">
    <p className="text-xs font-semibold">AI-villkor</p>
    <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
      {row("Direkta svar", status.chatAvailable, status.chatAvailable ? "Klara" : "Kräver Cloud")}
      {row("AI-modell", status.conditions.provider.ready, status.conditions.provider.ready ? "Klar" : "Av")}
      {row("Delningspolicy", status.conditions.sharingPolicy.ready, status.conditions.sharingPolicy.ready ? "Klar" : "Inte godkänd av företaget")}
      {row("Kreditledger", status.conditions.creditLedger.healthy, status.conditions.creditLedger.healthy ? "Stämmer" : "Avvikelse")}
      {row("Tillgängliga krediter", status.conditions.availableCredits.available, status.conditions.availableCredits.available ? `${status.conditions.availableCredits.balance} kvar` : "Saknas")}
    </dl>
  </section>;
}

/**
 * Workflow AI's memory (2026-09-30): the person's own (pseudonymised – stored without name or e-mail) and the
 * company's, which only a company admin changes. Short texts about how you work and want answers; only sent to the AI
 * model when the company allows it, never used by the direct answers.
 */
function AssistantMemory() {
  const [memory, setMemory] = useState<{ company: string; user: string; canEditCompany: boolean; max: number } | null>(null);
  const [user, setUser] = useState("");
  const [company, setCompany] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    fetch("/api/ai/memory", { cache: "no-store" }).then((response) => (response.ok ? response.json() : null)).then((data) => {
      if (!active || !data) return;
      setMemory(data); setUser(data.user); setCompany(data.company);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const save = async (scope: "USER" | "COMPANY", content: string) => {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/ai/memory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope, content }) });
      const result = (await response.json()) as { error?: string; content?: string };
      if (!response.ok) throw new Error(result.error || "Minnet kunde inte sparas.");
      setMemory((current) => (current ? { ...current, [scope === "USER" ? "user" : "company"]: result.content ?? "" } : current));
      setNotice(result.content ? "Minnet är sparat." : "Minnet är tömt.");
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Minnet kunde inte sparas."); } finally { setBusy(false); }
  };
  if (!memory) return null;
  return <details className="mt-3 rounded-lg border p-3" data-testid="assistant-memory">
    <summary className="cursor-pointer text-xs font-semibold">Minne – hur du vill ha svar</summary>
    <p className="mt-2 text-xs leading-5 text-muted-foreground">Korta anteckningar om hur du vill ha svar. Töm rutan och spara för att radera.</p>
    <label className="mt-3 grid gap-1 text-xs font-medium">Mitt minne
      <textarea className="form-textarea min-h-20 text-sm" maxLength={memory.max} value={user} onChange={(event) => setUser(event.target.value)} placeholder="Till exempel: Jag vill ha korta punktlistor och datum först." data-testid="memory-user" />
    </label>
    <Button type="button" size="sm" variant="outline" className="mt-2" disabled={busy || user === memory.user} onClick={() => void save("USER", user)}>Spara mitt minne</Button>
    {memory.canEditCompany ? <>
      <label className="mt-3 grid gap-1 text-xs font-medium">Företagets minne
        <textarea className="form-textarea min-h-20 text-sm" maxLength={memory.max} value={company} onChange={(event) => setCompany(event.target.value)} placeholder="Till exempel: Vi arbetar med elinstallationer i Småland. Projekten namnges efter gatuadress." data-testid="memory-company" />
      </label>
      <Button type="button" size="sm" variant="outline" className="mt-2" disabled={busy || company === memory.company} onClick={() => void save("COMPANY", company)}>Spara företagets minne</Button>
    </> : memory.company ? <p className="mt-3 text-xs text-muted-foreground"><span className="font-medium text-foreground">Företagets minne:</span> {memory.company}</p> : null}
    {notice ? <p className="mt-2 text-xs text-muted-foreground" role="status">{notice}</p> : null}
  </details>;
}
