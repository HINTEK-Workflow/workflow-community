"use client";

import { plural } from "@/lib/plural";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dialog, Popover } from "radix-ui";
import { Bot, Check, ChevronLeft, Gauge, History, Info, Maximize2, Minimize2, MoreHorizontal, Pencil, Plus, RotateCcw, Send, Settings2, ShieldCheck, Sparkles, Square, SquarePen, Trash2, X } from "lucide-react";
import { useScrollLock } from "@/components/scroll-lock";
import { ChatModePicker, type ChatPick } from "@/features/ai/chat-mode-picker";
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
import { AnswerBody, CHAT_ANSWER, CHAT_FIELD, CHAT_USER_BUBBLE, ChatChip, ChatSendButton, ThinkingBubble } from "@/features/ai/chat-parts";
import { RemoveButton } from "@/components/ui/remove-button";
import { useInstance } from "@/components/instance-provider";
import { ChatImageChip, ChatMediaBar, chatRequestInit, IMAGE_ONLY_QUESTION, type ChatAttachedImage, type ChatMedia } from "@/features/ai/chat-media";
import { imageMessageNote } from "@/lib/ai/chat-media";
import { markChatOffersSeen, useChatOffers } from "@/features/ai/chat-offers";
import { ChatOfferCards } from "@/features/ai/chat-offer-cards";
import type { ChatMode } from "@/lib/ai/chat-proposals";
import { currentFormBuilder, useFormAiRequest, useFormBuilderOpen } from "@/features/ai/form-ai-store";
import { FORM_AI_OWN_PROTOCOL_LABEL } from "@/lib/ai/form-ai-text";

type AssistantStatus = {
  lifecycle: "EXECUTION_LOCKED" | "READY";
  available: boolean;
  chatAvailable: boolean;
  /**
   * The public demo: the chat answers with ready examples from the invented company (2026-11-22, features/demo/demo-ai.ts); the
   * header says so. Without chatAvailable (2026-10-10) it says the assistant cannot be tried here instead of "Kräver serverlagring".
   */
  demo?: boolean;
  /** The questions offered in the empty window when the status names its own (the demo's examples); otherwise SUGGESTIONS. */
  suggestions?: string[];
  role: "SUPERADMIN" | "OWNER" | "ADMIN" | "MEMBER";
  conditions: {
    provider: { ready: boolean; configured: boolean; evaluationApproved: boolean };
    sharingPolicy: { ready: boolean };
    creditLedger: { healthy: boolean };
    availableCredits: { available: boolean; balance: number };
  };
  /** Veckokvot (2026-11-21): the share only, one line in the header. */
  weeklyQuota?: { quota: boolean; usedPercent: number; warn: boolean; full: boolean; opensAt: string; paused: boolean; onCredits: boolean };
  /** Bilder och röst (2026-11-21): whether the field's image and microphone buttons work, with a plain reason when not. */
  media?: ChatMedia;
  /** Formulär med Workflow AI (2026-11-25): the chat can make forms for this person (lib/api-handlers/ai-status.ts). */
  formAi?: boolean;
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

/** Användning under Inställningar → Arbetssätt → Workflow AI (2026-11-21), where the quota line leads. */
const USAGE_HREF = "/?view=company_features&section=ai#ai-usage";
const MODE_KEY = "hwf-chat-mode";
const AGENTS_HREF = "/?view=agents";
/** Agent i fältet (2026-11-22): the words go to Nytt uppdrag med egna ord, the same reading as on the Agenter page. */
const agentFromWords = (words: string) => `${AGENTS_HREF}&mission=new&words=${encodeURIComponent(words.trim().slice(0, 1_000))}`;
/** A short, natural pause before an answer that came at once, so every answer feels the same (one chat). */
const ANSWER_PAUSE_MS = 700;
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
 * status and the memory are in the header's ⋯. A question is shown at once and answered in one request.
 * Ett lugnare fönster (2026-11-22: "påminner om gamla supportchattar"): the assistant's answers are plain text on the
 * window's white, only the person's own messages are bubbles; the header is the title, ⋯ and × on every form of the window (Ny
 * konversation beside them once there is a conversation), and its status line only says something when it matters and gives way
 * while the person reads back or types; the mode is a small picker left of the microphone. On a phone the page behind never
 * scrolls while the chat is open (useScrollLock). One chat (
 * 2026-11-21): every answer has the same mark (Workflow AI), sources and pause before it, whether Workflow's rules or the model wrote
 * it, and no answer shows a cost; the week's quota is one line in the header, linked to Användning.
 */
export function AssistantPanel({ open, expanded, onOpenChange, onExpandedChange, ask }: {
  open: boolean; expanded: boolean; onOpenChange: (open: boolean) => void; onExpandedChange: (expanded: boolean) => void;
  /** A question from a tip's "Fråga Workflow AI", with the page's step (2026-10-01). */
  ask?: AssistantAsk | null;
}) {
  // Credits and the way to Cloud belong to an installation that sells them (2026-11-20): Community says neither, and
  // never links to a billing section it does not have.
  const { features: { credits: creditsCharged, billing } } = useInstance();
  const cloudLink = creditsCharged || billing;
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [error, setError] = useState(false);
  const [compact, setCompact] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState("");
  /** A photo for the next question (2026-11-21); kept until the answer has come, so a failed question can be sent again with it. */
  const [image, setImage] = useState<ChatAttachedImage | null>(null);
  useEffect(() => () => { if (image?.kind === "file") URL.revokeObjectURL(image.previewUrl); }, [image]);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  /** The person has rolled up to read earlier messages: the header gives the thread its status line's room. */
  const [readingBack, setReadingBack] = useState(false);
  /** The header's ⋯: its rows, or one of the two views behind them. */
  const [menuView, setMenuView] = useState<"menu" | "history" | "settings" | null>(null);
  const [wide, setWide] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary | null>(null);
  /** The answer that just arrived; only it is revealed word by word. */
  const [freshId, setFreshId] = useState<string | null>(null);
  /**
   * Manuellt | Auto (2026-11-21): Manuellt answers and proposes (Använd); Auto does the task at once and gives the link and Ångra.
   * The person's choice is remembered in this browser.
   */
  const [mode, setModeState] = useState<ChatMode>(() => { try { return window.localStorage.getItem(MODE_KEY) === "auto" ? "auto" : "manual"; } catch { return "manual"; } });
  const setMode = (next: ChatMode) => { setModeState(next); try { window.localStorage.setItem(MODE_KEY, next); } catch { /* storage is optional */ } };
  /** Agent (2026-11-22): the next message describes a mission. Never remembered – the chat opens in its own mode again. */
  const [agentPick, setAgentPick] = useState(false);
  const pick: ChatPick = agentPick ? "agent" : mode;
  /**
   * Formulär med Workflow AI (2026-11-25): the next messages are about a form for Skapa formulär. Entered from the builder's
   * suggestion or the dialog's "Skapa med Workflow AI"; a photo goes only with "Det här är vårt eget protokoll" ticked.
   */
  const [formPick, setFormPick] = useState(false);
  const [ownProtocol, setOwnProtocol] = useState(false);
  const formRequest = useFormAiRequest();
  const handledFormRequest = useRef(0);
  const builderOpen = useFormBuilderOpen();
  const router = useRouter();
  // What the open page's agents have to say waits first in the chat; opening it marks it seen (the button's dot goes).
  const offers = useChatOffers();
  useEffect(() => { if (open) markChatOffersSeen(); }, [open, offers.length]);
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
  // The chat is a screen of its own on a phone: the page behind it stands still (2026-11-22). The full-screen dialog (compact) is
  // Radix's, which locks the page itself.
  useScrollLock(native && open);
  // The chat has the whole screen on a phone (2026-11-23): the tab bar steps aside while it is open (app/globals.css).
  useEffect(() => {
    if (!native || !open) return;
    document.documentElement.setAttribute("data-assistant-open", "");
    return () => document.documentElement.removeAttribute("data-assistant-open");
  }, [native, open]);
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
    setActiveId(null); setMessages([]); setDraft(""); setNotice(""); setMenuView(null); setReadingBack(false);
    window.setTimeout(() => input.current?.focus(), 50);
  }, []);

  const send = useCallback(async (text: string, retryId?: string, page?: unknown) => {
    // With a photo the shown note ("[Bild: …]") is the server's to add, also when a failed question is sent again.
    const content = (image ? text.trim().replace(/\n?\[Bild: [^\]\n]*\]$/, "").trim() : text.trim()) || (image ? IMAGE_ONLY_QUESTION : "");
    if (!content || sending || !status?.chatAvailable) return;
    setSending(true);
    setNotice("");
    stick.current = true;
    const pendingId = retryId ?? `pending-${Date.now()}`;
    // The question is shown at once; the server saves it and answers in the same request.
    setMessages((current) => [...current.filter((message) => message.id !== pendingId), { id: pendingId, role: "USER", content: image ? `${content}\n${imageMessageNote(image.name)}` : content, model: null, citations: [], createdAt: new Date().toISOString(), pending: true }]);
    setDraft("");
    const startedAt = Date.now();
    try {
      // Strömning (2026-10-24): the answer arrives as it is written – lines of JSON, the last one the same answer as before.
      const controller = new AbortController();
      stopper.current = controller;
      const streamId = `stream-${pendingId}`;
      let streamed = false;
      // Form mode sends the builder's open draft and the person's word that a photo is the company's own protocol, never the page's step.
      const formMode = formPick ? { form: { templateId: currentFormBuilder()?.templateId ?? null, ...(image ? { ownProtocol } : {}) } } : null;
      const response = await fetch("/api/ai/chat?stream=1", { method: "POST", signal: controller.signal, ...chatRequestInit({ content, conversationId: activeId ?? undefined, mode, ...(formMode ?? (page ?? currentPageContext() ? { page: page ?? { ...(currentPageContext() as object), source: "page" } } : {})) }, image) });
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
      // One chat (2026-11-21): an answer straight from Workflow waits a moment like any other, so no answer feels different.
      const elapsed = Date.now() - startedAt;
      if (!streamed && elapsed < ANSWER_PAUSE_MS) await new Promise((resolve) => window.setTimeout(resolve, ANSWER_PAUSE_MS - elapsed));
      setActiveId(result.conversation.id);
      // A streamed answer has already been read as it came; only an answer that arrived whole is revealed word by word.
      setFreshId(streamed ? null : result.message.id);
      setMessages((current) => [...current.filter((message) => message.id !== pendingId && message.id !== streamId), result.userMessage, result.message]);
      setImage(null);
      setOwnProtocol(false);
      // No line per answer about where it came from or what it cost (2026-11-21); the week's quota is in the header.
      if (typeof result.balance === "number") { const balance = result.balance; setStatus((current) => current ? { ...current, conditions: { ...current.conditions, availableCredits: { available: balance > 0, balance } } } : current); }
      void listConversations().catch(() => undefined);
    } catch (cause) {
      const stopped = cause instanceof DOMException && cause.name === "AbortError";
      const text = stopped ? "Svaret stoppades." : cause instanceof Error ? cause.message : "Svaret kunde inte hämtas.";
      setMessages((current) => current.filter((message) => !message.streaming).map((message) => (message.id === pendingId ? { ...message, pending: false, failed: text } : message)));
    } finally {
      stopper.current = null;
      setSending(false);
    }
  }, [activeId, image, listConversations, sending, status?.chatAvailable, mode, formPick, ownProtocol]);

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
  // "Skapa med Workflow AI" (2026-11-25): a new conversation in form mode, once per request. Set one microtask after the effect.
  useEffect(() => {
    if (!formRequest || handledFormRequest.current === formRequest) return;
    handledFormRequest.current = formRequest;
    queueMicrotask(() => { startNew(); setAgentPick(false); setOwnProtocol(false); setFormPick(true); });
  }, [formRequest, startNew]);
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

  // The header's one line (2026-11-21): the week's quota when it matters, never where an answer came from or what it cost.
  const quota = status?.weeklyQuota?.quota ? status.weeklyQuota : null;
  const quotaLine = !quota ? "" : quota.paused ? "Veckans kvot är slut. Workflow AI öppnar igen måndag 00:00." : quota.onCredits ? `Veckans kvot är slut · ${status!.conditions.availableCredits.balance} krediter kvar` : quota.warn ? `Veckans kvot: ${quota.usedPercent} % använd` : "";
  // Short, and only when there is something to say (2026-11-22: the long line was cut off on a phone); the empty window explains more.
  const statusText = !status ? "" : status.demo ? (status.chatAvailable ? "Exempelsvar i demon" : "Går inte att prova i demon") : !status.chatAvailable ? "Kräver serverlagring" : quotaLine || (status.available ? "" : !status.conditions.sharingPolicy.ready ? "Workflow AI är av för företaget" : "Bara enkla frågor just nu");
  const statusLine = quotaLine ? <Link href={USAGE_HREF} onClick={() => onOpenChange(false)} className="underline-offset-2 hover:underline" data-testid="assistant-quota-line">{statusText}</Link> : statusText;
  // A member has no Workflow AI or Abonnemang och krediter tab since 2026-10-07: this line is what they see of the
  // company's choice and the credits; the links to those pages are the admin's.
  const manages = status ? status.role !== "MEMBER" : false;
  const history = (
    <ConversationList conversations={conversations} activeId={activeId} onOpen={(id) => { setMenuView(null); void openConversation(id); }} onRename={(id, title) => void mutateConversation({ action: "rename", conversationId: id, title })} onDelete={setDeleteTarget} />
  );

  // The message field (2026-11-02, as in a messenger; replaces the big field in an empty conversation of 2026-10-09):
  // always at the bottom, a round field that grows with the text, a round Skicka inside the field at its lower right corner (
  // 2026-11-06: in the field, not beside it at the window's edge), 16 px text on a phone. Three lines from the start in every form of
  // the window (2026-11-02; the min height counts the field's own lines, since field-sizing ignores rows). One can write on
  // while an answer is on its way; Enter sends when it has come.
  // Bilder och röst (2026-11-21): Bild and Mikrofon at the field's lower left (features/ai/chat-media.tsx); the field keeps a row for them.
  const chatOn = Boolean(status?.chatAvailable);
  // Agent is offered where Agenter is: Workflow AI's chat in Cloud, never in the demo (Agenter cannot run there).
  const agentsOn = chatOn && !status?.demo;
  // Agent hands the words over to Nytt uppdrag; the chat closes and the mode goes back to what it was.
  const submit = (text: string) => {
    if (!agentPick) { void send(text); return; }
    if (!text.trim()) return;
    setDraft(""); setAgentPick(false); onOpenChange(false);
    router.push(agentFromWords(text));
  };
  const choose = (next: ChatPick) => {
    if (next === "agent") { setAgentPick(true); setFormPick(false); }
    else { setAgentPick(false); setMode(next); }
    window.setTimeout(() => input.current?.focus(), 0);
  };
  /** A request's start in the field, the cursor after it. */
  const putInField = (text: string) => { setDraft(text); window.setTimeout(() => { const field = input.current; if (field) { field.focus(); field.setSelectionRange(text.length, text.length); } }, 0); };
  // In form mode a photo waits for "Det här är vårt eget protokoll" (the server refuses it without).
  const photoWaits = formPick && !agentPick && Boolean(image) && !ownProtocol;
  const modePicker = chatOn ? <ChatModePicker pick={pick} onPick={choose} agents={agentsOn} usageHref={USAGE_HREF} onUsage={() => onOpenChange(false)} /> : null;
  const composer = <>
    <label htmlFor="ai-message-draft" className="sr-only">{agentPick ? "Vad ska agenten göra?" : "Meddelande till Workflow AI"}</label>
    {agentPick ? <p className="mx-auto mb-1.5 w-full max-w-3xl px-1 text-xs leading-5 text-muted-foreground" data-testid="assistant-agent-hint">Beskriv vad agenten ska göra, när och hur du vill få resultatet. Du kontrollerar uppdraget under Agenter innan det sparas.</p> : null}
    {formPick && !agentPick ? <div className="mx-auto mb-1.5 flex w-full max-w-3xl items-start gap-1 px-1" data-testid="assistant-form-hint">
      <p className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground"><span className="font-medium text-foreground">Formulär:</span> beskriv vad protokollet ska innehålla, eller bifoga en bild av ert eget protokoll. Du får ett förslag som du sparar som utkast.</p>
      <IconButton label="Stäng formulärläget" className="size-7 shrink-0" onClick={() => { setFormPick(false); setOwnProtocol(false); }} data-testid="assistant-form-leave"><X /></IconButton>
    </div> : null}
    {image && !agentPick ? <ChatImageChip image={image} onRemove={() => { setImage(null); setOwnProtocol(false); }} /> : null}
    {image && formPick && !agentPick ? <label className="mx-auto mb-1.5 flex w-full max-w-3xl cursor-pointer items-center gap-2 px-1 text-xs font-medium" data-testid="assistant-form-own">
      <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={ownProtocol} onChange={(event) => setOwnProtocol(event.target.checked)} data-testid="assistant-form-own-check" />
      {FORM_AI_OWN_PROTOCOL_LABEL}
    </label> : null}
    <form className="relative mx-auto w-full max-w-3xl text-left" onSubmit={(event) => { event.preventDefault(); submit(draft); }}>
      <textarea ref={input} id="ai-message-draft" rows={3} value={draft} maxLength={8_000} onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (!photoWaits) submit(draft); } }}
        disabled={!chatOn}
        placeholder={agentPick ? "Till exempel: Varje måndag kl. 7, lista arbetsordrar utan ansvarig" : formPick && chatOn ? "Till exempel: Egenkontroll för badrum med fuktmätning, foton och signatur" : chatOn ? "Fråga något…" : status?.demo ? "Workflow AI går inte att prova i demon" : "Assistenten kräver serverlagring"}
        className={cn(CHAT_FIELD, chatOn && "max-h-44 min-h-[calc(3lh+3.75rem)] pb-12")} style={{ fieldSizing: "content" } as React.CSSProperties} />
      {chatOn ? <ChatMediaBar media={status?.media} className="absolute bottom-1.5 left-1.5" disabled={sending} beforeMic={modePicker} onPickImage={(next) => { setImage(next); setNotice(""); input.current?.focus(); }}
        onTranscript={(text) => { setDraft((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text)); setNotice(""); input.current?.focus(); }} onNotice={setNotice} /> : null}
      {sending ? <IconButton label="Stoppa svaret" variant="outline" className="absolute bottom-1.5 right-1.5 size-10 rounded-full" onClick={() => stopper.current?.abort()} data-testid="assistant-stop"><Square className="size-4" /></IconButton>
        : <ChatSendButton label={agentPick ? "Skapa uppdraget under Agenter" : "Skicka meddelande"} type="submit" disabled={(!draft.trim() && (!image || agentPick)) || !chatOn || photoWaits} data-testid="assistant-send">{agentPick ? <Bot /> : <Send />}</ChatSendButton>}
    </form>
  </>;

  const settingsBody = <>
      {status ? <StatusCard status={status} credits={creditsCharged} /> : null}
      {status?.chatAvailable ? <AssistantMemory /> : null}
      {manages ? <Link href="/?view=company_features&section=ai" onClick={() => onOpenChange(false)} className="mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium text-primary hover:bg-secondary" data-testid="assistant-permissions-link"><ShieldCheck className="size-4" />Vad Workflow AI får göra och läsa</Link> : null}
      {creditsCharged ? <Link href={USAGE_HREF} onClick={() => onOpenChange(false)} className="mt-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium text-primary hover:bg-secondary" data-testid="assistant-usage-link"><Gauge className="size-4" />Användning</Link> : null}
  </>;
  // The header's ⋯ (2026-11-02; on the phone too since 2026-11-22, which had Konversationer and AI-status as their own icons):
  // what is rarely used, one small menu instead of a row of icons; the views open in its place.
  const canEnlarge = wide && !compact;
  const hasConversation = messages.length > 0 || activeId !== null;
  const menuRow = "flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground";
  const menuBack = (title: string) => <button type="button" onClick={() => setMenuView("menu")} className={cn(menuRow, "mb-1 font-medium")} data-testid="assistant-menu-back"><ChevronLeft />{title}</button>;
  const headerMenu = <Popover.Root open={menuView !== null} onOpenChange={(next) => setMenuView(next ? "menu" : null)}>
    <Popover.Trigger asChild><IconButton label="Mer om Workflow AI" className={native ? "size-11" : undefined} data-testid="assistant-menu"><MoreHorizontal /></IconButton></Popover.Trigger>
    <Popover.Portal><Popover.Content align="end" sideOffset={6} collisionPadding={8} className="z-[70] max-h-[min(32rem,70dvh)] w-80 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-xl border bg-popover p-2 shadow-lg" data-testid="assistant-menu-content">
      {menuView === "history" ? <>{menuBack("Konversationer")}{history}</>
        : menuView === "settings" ? <>{menuBack("AI-status och minne")}<div className="px-1 pb-1">{settingsBody}</div></>
          : <>
            <button type="button" onClick={startNew} className={menuRow} data-testid="assistant-menu-new"><SquarePen />Ny konversation</button>
            {expanded && canEnlarge ? null : <button type="button" onClick={() => setMenuView("history")} className={menuRow} data-testid="assistant-history"><History />Konversationer</button>}
            <button type="button" onClick={() => setMenuView("settings")} className={menuRow} data-testid="assistant-settings"><Settings2 />AI-status och minne</button>
            <Link href={AGENTS_HREF} onClick={() => { setMenuView(null); onOpenChange(false); }} className={menuRow} data-testid="assistant-agents-link"><Bot />Agenter</Link>
            {canEnlarge ? <button type="button" onClick={() => { onExpandedChange(!expanded); setMenuView(null); }} className={menuRow} data-testid="assistant-enlarge">{expanded ? <><Minimize2 />Mindre fönster</> : <><Maximize2 />Större fönster</>}</button> : null}
          </>}
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
  // The header gives way (2026-11-22): while the person reads back or the keyboard is up, the status line folds away and the bar is lower.
  const headCompact = readingBack || Boolean(phoneArea?.keyboard);
  // Ny konversation stands in the header only when there is a conversation to leave; it is always first in ⋯ as well.
  const newButton = hasConversation ? <IconButton label="Ny konversation" className={native ? "size-11" : undefined} onClick={startNew} data-testid="assistant-new"><SquarePen /></IconButton> : null;
  const statusRow = status && statusText ? <p className={cn(native ? "native-top-bar-status" : "truncate text-xs text-muted-foreground", "assistant-head-status")} data-testid="assistant-rules-notice">{statusLine}</p> : null;
  // Level 1: the app's top bar – Ny konversation to the left when there is one, Workflow AI in the middle, ⋯ and the round × to the
  // right like the Ny and Mer sheets.
  const nativeBar = <div className="native-top-bar assistant-head shrink-0 border-b px-2" data-compact={headCompact || undefined} data-testid="native-assistant-bar">
    <div className="flex items-center">{newButton}</div>
    <div className="native-top-bar-heading">
      <h2 className="native-top-bar-title" data-testid="native-assistant-title">Workflow AI</h2>
      {statusRow}
    </div>
    <div className="flex items-center justify-end gap-0.5">
      {headerMenu}
      <button type="button" className="native-sheet-close" aria-label="Stäng Workflow AI" onClick={close} data-testid="native-assistant-close"><X aria-hidden="true" /></button>
    </div>
  </div>;

  const content = (
    <div className="flex h-full min-h-0 flex-col bg-card" data-testid="assistant-panel">
      {native ? nativeBar : <div className="assistant-head flex h-14 shrink-0 items-center gap-1 border-b pl-3 pr-2" data-compact={headCompact || undefined} data-testid="assistant-header">
        <span className="assistant-head-mark mr-1.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Sparkles className="size-4" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight">Workflow AI</p>
          {statusRow}
        </div>
        {newButton}
        {headerMenu}
        <IconButton label="Stäng Workflow AI" onClick={close} data-testid="assistant-close"><X /></IconButton>
      </div>}

      <div className={cn("flex min-h-0 flex-1 flex-col", expanded && canEnlarge && !native && "grid grid-cols-[16rem_minmax(0,1fr)] grid-rows-[minmax(0,1fr)]")}>
        {expanded && canEnlarge && !native ? <aside aria-label="Konversationer" className="min-h-0 overflow-y-auto border-r p-2">
          <div className="flex items-center justify-between px-2 pb-1 pt-1"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Konversationer</p><Button type="button" variant="ghost" size="sm" onClick={startNew}><Plus />Ny</Button></div>
          {history}
        </aside> : null}
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Gummibandet (2026-11-23: "lite gummiband känsla på scrollen … inte bara när man måste scrolla"): what the thread shows is
              always a pixel taller than the thread (min-h-[calc(100%+1px)]), so it is always a scroll area and the phone's own elastic
              edge works with one short answer too; overscroll-contain keeps the bounce in the thread. */}
          <div ref={thread} onScroll={(event) => {
            const box = event.currentTarget;
            stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < 64;
            const back = !stick.current && box.scrollHeight > box.clientHeight + 64;
            if (back !== readingBack) setReadingBack(back);
          }} className="assistant-thread min-h-0 flex-1 overflow-y-auto overscroll-contain bg-card px-4 py-3" aria-live="polite" data-testid="assistant-thread">
            {!status && !error ? <div className="flex min-h-[calc(100%+1px)] flex-col justify-end"><ThinkingBubble label="Kontrollerar AI-beredskap" /></div>
              : error ? <div className="min-h-[calc(100%+1px)] py-6 text-sm text-destructive" role="alert">AI-status kunde inte hämtas. <Button type="button" variant="outline" size="sm" className="ml-2" onClick={() => void load()}>Försök igen</Button></div>
              : loadingThread ? <div className="flex min-h-[calc(100%+1px)] flex-col justify-end"><ThinkingBubble label="Läser in konversationen" /></div>
              : !messages.length && offers.length ? <div className="flex min-h-[calc(100%+1px)] flex-col justify-end"><ChatOfferCards offers={offers} /></div>
              : !messages.length ? <Welcome status={status!} hint={!native} cloudLink={cloudLink} form={formPick && !agentPick} />
              : <div className="mx-auto flex min-h-[calc(100%+1px)] max-w-3xl flex-col justify-end gap-4" aria-label="Meddelanden">
                {messages.map((message, index) => {
                  const day = chatDayLabel(message.createdAt);
                  return <Fragment key={message.id}>
                    {index === 0 || chatDayLabel(messages[index - 1]!.createdAt) !== day ? <p className="self-center rounded-full bg-muted px-2.5 py-0.5 text-[0.6875rem] text-muted-foreground" data-testid="assistant-day">{day}</p> : null}
                    <MessageBubble message={message} fresh={message.id === freshId} onCitation={() => onOpenChange(false)} onRetry={() => void send(message.content, message.id)} />
                  </Fragment>;
                })}
                {sending && !messages.some((message) => message.streaming) ? <ThinkingBubble /> : null}
                {/* The open page's proposals and tips stand last, closest to the field, so they are seen first when the chat opens. */}
                <ChatOfferCards offers={offers} />
              </div>}
          </div>
          <div className={cn("shrink-0 bg-card px-3 pb-2 pt-1", native && "native-assistant-composer")}>
            {notice ? <p className="mb-1.5 text-center text-[0.6875rem] leading-4 text-muted-foreground" role="status">{notice}</p> : null}
            {status?.chatAvailable && !messages.length && !offers.length && !loadingThread && !draft && !agentPick && !formPick ? <SuggestionRow status={status} onPick={(text) => void send(text)} onDraft={putInField}
              onForm={builderOpen && status.formAi ?() => { setFormPick(true); setOwnProtocol(false); window.setTimeout(() => input.current?.focus(), 0); } : undefined} /> : null}
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

/** Level 1: the chat fills what is visible – the whole screen (the tab bar steps aside, 2026-11-23), or above the keyboard while it is up. */
function nativeAssistantStyle(area: ReturnType<typeof useVisibleArea>): React.CSSProperties | undefined {
  if (!area) return undefined;
  return { top: `${area.top}px`, height: `${Math.max(200, area.height)}px` };
}

/**
 * Förslag (2026-11-23, produktägaren: "Ta bort alternativen som står på skärmen … eller lägg det på något annat sätt"): no
 * longer a wall of buttons in the empty window, but one quiet row just above the field that is swiped sideways, as in the
 * phone's own messengers. Only in an empty conversation and while the field is empty; a tap on a question sends it, a tap on a
 * request puts its start in the field.
 */
function SuggestionRow({ status, onPick, onDraft, onForm }: { status: AssistantStatus; onPick: (text: string) => void; onDraft: (text: string) => void;
  /** In the form builder (2026-11-25): the first chip asks whether to make a form, and puts the chat in form mode. */
  onForm?: () => void }) {
  const questions = (status.suggestions?.length ? status.suggestions : SUGGESTIONS).map((text) => ({ label: text, text, send: true }));
  const items = [...questions, ...(proposalsOn(status) ? WORK_SUGGESTIONS : [])];
  return <div className="mx-auto mb-1.5 flex w-full max-w-3xl snap-x gap-2 overflow-x-auto overscroll-x-contain pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Förslag på frågor" data-testid="assistant-suggestions">
    {onForm ? <ChatChip onClick={onForm} data-testid="assistant-form-suggestion">Vill du skapa ett formulär?</ChatChip> : null}
    {items.map((item) => <ChatChip key={item.label} onClick={() => item.send ? onPick(item.text) : onDraft(item.text)}
      data-testid={item.send && questions.some((question) => question.label === item.label) ? "assistant-suggestion" : "assistant-work-suggestion"}>{item.label}</ChatChip>)}
  </div>;
}

/**
 * The empty window: a calm start – the mark and one sentence (2026-11-23: the wall of question buttons and "Vad vill du veta?" are
 * gone; the questions are one row above the field, SuggestionRow).
 */
function Welcome({ status, hint, cloudLink, form }: { status: AssistantStatus; hint: boolean; cloudLink: boolean; /** Formulärläget (2026-11-25). */ form?: boolean }) {
  const proposals = status.chatAvailable && proposalsOn(status);
  // One chat (2026-11-21): nothing here says which questions cost what.
  return <div className="mx-auto flex min-h-[calc(100%+1px)] max-w-xl flex-col items-center justify-center px-1 pb-6 pt-3 text-center">
    <span className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground"><Sparkles className="size-5" aria-hidden="true" /></span>
    <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">
      {!status.chatAvailable ? (status.demo ? "Workflow AI går inte att prova i demon." : <>I Local ligger dina data i den egna filen, så assistenten kan inte läsa dem.{cloudLink ? <> <Link href="/?view=company&section=billing" className="font-medium text-primary underline">Se vad Cloud ger</Link>.</> : null}</>)
        : status.demo ? "Skriv en fråga eller välj ett förslag nedanför. Svaren är exempel från demoföretaget, och ingen AI anropas."
        : form ? "Vilket formulär vill du skapa?"
        : proposals ? "Fråga om ditt arbete, eller be om ett förslag som du godkänner med Använd."
          : "Fråga om ditt arbete."}
    </p>
    {status.chatAvailable && !status.available && !status.demo ? <p className="mt-4 flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-left text-xs leading-5 text-muted-foreground">
      <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span data-testid="assistant-ai-off-notice">{!status.conditions.provider.ready ? "Enkla frågor om ditt arbete fungerar. Workflow AI är inte helt påslaget än." : status.role === "MEMBER" ? "Workflow AI är av för företaget. Administratören kan slå på den." : <>Workflow AI är av för företaget. Slå på den under <Link href="/?view=company_features&section=ai" className="font-medium text-primary underline">Inställningar → Arbetssätt → Workflow AI</Link>.</>}</span>
    </p> : null}
    {hint && status.chatAvailable ? <p className="mt-4 text-[11px] leading-4 text-muted-foreground">Enter skickar, Skift + Enter ger ny rad. Svaren bygger bara på det du själv får se.</p> : null}
  </div>;
}

/**
 * One message: the person's to the right, Workflow AI's to the left with the same mark, sources and time for every answer (
 * 2026-11-21: "det ska kännas som 'en' chatt" – no model name, no sign of a direct answer).
 */
function MessageBubble({ message, fresh, onCitation, onRetry }: { message: ConversationMessage; fresh: boolean; onCitation: () => void; onRetry: () => void }) {
  const mine = message.role === "USER";
  const AI_NAME = `${useInstance().operator} AI`;
  const text = useReveal(message.content, fresh && !mine);
  // A new answer takes its final height at once (the whole text, unseen, under the words coming), so the bubble never grows.
  const revealing = !mine && text !== message.content;
  // Only the person's own message is a bubble (2026-11-22); Workflow AI's answer is plain text on the window, the full width.
  return <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
    <div className={cn(mine ? CHAT_USER_BUBBLE : CHAT_ANSWER, message.pending && "opacity-70")} data-testid={mine ? "assistant-user-message" : "assistant-answer"}>
      {mine ? <p className="whitespace-pre-wrap break-words">{message.content}</p>
        : revealing ? <div className="grid"><div className="invisible col-start-1 row-start-1"><AnswerBody text={message.content} /></div><div className="col-start-1 row-start-1"><AnswerBody text={text} /></div></div>
          : <AnswerBody text={text} />}
      {message.failed ? <p className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span className="opacity-90">{message.failed}</span><button type="button" onClick={onRetry} className="inline-flex items-center gap-1 rounded-md bg-primary-foreground/15 px-2 py-0.5 font-medium hover:bg-primary-foreground/25"><RotateCcw className="size-3" />Försök igen</button></p> : null}
      {!mine && message.citations?.length ? <div className="mt-2 flex flex-wrap gap-1.5" aria-label="AI-svarets källor">
        {message.citations.map((citation) => <Link key={`${citation.resourceType}:${citation.resourceId}:${citation.href}`} href={citation.href} onClick={onCitation} className="rounded-md border bg-background px-2 py-1 text-[0.6875rem] text-primary hover:bg-secondary">{citation.citationLabel}</Link>)}
      </div> : null}
      {!mine && message.proposals?.length ? <ChatProposalCards proposals={message.proposals} onNavigate={onCitation} /> : null}
      <p className={cn("mt-1 flex items-center gap-2 text-[0.6875rem] leading-4", mine ? "justify-end text-primary-foreground/70" : "mt-1.5 text-muted-foreground")}>
        {!mine ? <span className="inline-flex min-w-0 items-center gap-1" data-testid="assistant-answer-mark"><span className="shrink-0"><Sparkles className="size-3" aria-hidden="true" /></span><span className="truncate">{AI_NAME}</span></span> : null}
        {!mine ? <span aria-hidden="true">·</span> : null}
        <span className="shrink-0">{message.pending ? "Skickar…" : message.streaming ? "Skriver…" : formatSwedish(message.createdAt, { timeStyle: "short" })}</span>
      </p>
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
function StatusCard({ status, credits }: { status: AssistantStatus; /** Credits exist here (Cloud); without them the two credit rows are left out. */ credits: boolean }) {
  const row = (label: string, ok: boolean, text: string) => <Fragment key={label}><dt className="text-muted-foreground">{label}</dt><dd className={cn("font-medium", ok ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300")}>{text}</dd></Fragment>;
  return <section aria-label="AI-villkor" className="rounded-lg border p-3">
    <p className="text-xs font-semibold">AI-villkor</p>
    <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
      {row("Chatten", status.chatAvailable, status.chatAvailable ? "Klar" : "Kräver Cloud")}
      {row("AI-modell", status.conditions.provider.ready, status.conditions.provider.ready ? "Klar" : "Av")}
      {row("Delningspolicy", status.conditions.sharingPolicy.ready, status.conditions.sharingPolicy.ready ? "Klar" : "Inte godkänd av företaget")}
      {status.weeklyQuota?.quota ? row("Veckans kvot", !status.weeklyQuota.full, status.weeklyQuota.full ? "Slut till måndag" : `${status.weeklyQuota.usedPercent} % använd`) : null}
      {credits ? row("Krediter", status.conditions.availableCredits.available, status.conditions.availableCredits.available ? `${status.conditions.availableCredits.balance} kvar` : "Inga") : null}
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

/** The answer's formatting lives with the chat's shared parts; kept here for the pages that import it from the window. */
export { AnswerBody };
