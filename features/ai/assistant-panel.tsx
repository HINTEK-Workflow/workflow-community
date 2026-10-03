"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Dialog, Popover } from "radix-ui";
import { Check, History, LoaderCircle, Maximize2, Minimize2, Pencil, Plus, RotateCcw, Send, Settings2, ShieldCheck, Sparkles, Trash2, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatSwedish } from "@/lib/swedish-time";
import type { AssistantAsk } from "@/lib/extensions/types";
import { currentPageContext } from "@/features/workflow/flow-hint-store";

type AssistantStatus = {
  lifecycle: "EXECUTION_LOCKED" | "READY";
  available: boolean;
  chatAvailable: boolean;
  role: "SUPERADMIN" | "OWNER" | "ADMIN" | "MEMBER";
  conditions: {
    provider: { ready: boolean; configured: boolean; evaluationApproved: boolean };
    sharingPolicy: { ready: boolean };
    creditLedger: { healthy: boolean };
    availableCredits: { available: boolean; balance: number };
  };
  sharingPolicy: { enabled: boolean; shareChatContent: boolean };
};

type ConversationSummary = { id: string; title: string; lastMessageAt: string | null; _count: { messages: number; proposals: number } };
type Citation = { resourceType: string; resourceId: string; title: string; description: string; href: string; citationLabel: string };
type ConversationMessage = { id: string; role: "USER" | "ASSISTANT"; content: string; model: string | null; citations: Citation[]; createdAt: string;
  /** Only in the panel: the question is on its way, or its answer failed and can be sent again. */
  pending?: boolean; failed?: string };
type ChatResult = { error?: string; conversation: { id: string; title: string }; userMessage: ConversationMessage; message: ConversationMessage; chargedCredits?: number; balance?: number | null; mode?: "RULES" | "AI" };

const RULES_MODEL = "Workflow – direkt svar";
const SUGGESTIONS = ["Mina uppgifter", "Vad är försenat?", "Min tid den här veckan", "Planering i morgon", "Pågående projekt"];

/**
 * Workflow AI's window (rebuilt, 2026-10-01: "bygg ett bättre chattfönster, sparade konversationer tar mycket
 * plats"): the conversation fills the panel, the saved conversations live behind Historik (and as a column when the
 * panel is enlarged), the AI status and the memory behind Inställningar. A question is shown at once and answered in
 * one request; direct answers from Workflow are marked, AI answers show their cost and sources.
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
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary | null>(null);
  /** The answer that just arrived; only it is revealed word by word. */
  const [freshId, setFreshId] = useState<string | null>(null);
  const threadEnd = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);

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
    setActiveId(null); setMessages([]); setDraft(""); setNotice(""); setHistoryOpen(false);
    window.setTimeout(() => input.current?.focus(), 50);
  }, []);

  const send = useCallback(async (text: string, retryId?: string, page?: unknown) => {
    const content = text.trim();
    if (!content || sending || !status?.chatAvailable) return;
    setSending(true);
    setNotice("");
    const pendingId = retryId ?? `pending-${Date.now()}`;
    // The question is shown at once; the server saves it and answers in the same request.
    setMessages((current) => [...current.filter((message) => message.id !== pendingId), { id: pendingId, role: "USER", content, model: null, citations: [], createdAt: new Date().toISOString(), pending: true }]);
    setDraft("");
    try {
      const response = await fetch("/api/ai/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content, conversationId: activeId ?? undefined, ...(page ?? currentPageContext() ? { page: page ?? { ...(currentPageContext() as object), source: "page" } } : {}) }) });
      const result = (await response.json()) as ChatResult;
      if (!response.ok) throw new Error(result.error || "Svaret kunde inte hämtas.");
      setActiveId(result.conversation.id);
      setFreshId(result.message.id);
      setMessages((current) => [...current.filter((message) => message.id !== pendingId), result.userMessage, result.message]);
      setNotice(result.mode === "AI" ? `AI-svaret använde ${result.chargedCredits ?? 0} krediter${typeof result.balance === "number" ? ` · ${result.balance} kvar` : ""}.` : "Svarat direkt ur Workflow – gratis.");
      if (result.mode === "AI" && typeof result.balance === "number") { const balance = result.balance; setStatus((current) => current ? { ...current, conditions: { ...current.conditions, availableCredits: { available: balance > 0, balance } } } : current); }
      void listConversations().catch(() => undefined);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : "Svaret kunde inte hämtas.";
      setMessages((current) => current.map((message) => (message.id === pendingId ? { ...message, pending: false, failed: text } : message)));
    } finally {
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

  useEffect(() => { if (open && !status && !error) void load(); }, [error, load, open, status]);
  // A tip's question is sent once, as soon as the panel knows the assistant is available.
  const handledAsk = useRef<number | null>(null);
  useEffect(() => {
    if (!ask || handledAsk.current === ask.id || !status?.chatAvailable || sending) return;
    handledAsk.current = ask.id;
    void send(ask.question, undefined, ask.page);
  }, [ask, send, sending, status?.chatAvailable]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1279px)");
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => { threadEnd.current?.scrollIntoView({ block: "nearest" }); }, [messages, sending]);
  useEffect(() => { if (open) window.setTimeout(() => input.current?.focus(), 80); }, [open]);

  const directOnly = Boolean(status && status.chatAvailable && !status.available);
  const history = (
    <ConversationList conversations={conversations} activeId={activeId} onOpen={(id) => { setHistoryOpen(false); void openConversation(id); }} onRename={(id, title) => void mutateConversation({ action: "rename", conversationId: id, title })} onDelete={setDeleteTarget} />
  );

  const content = (
    <div className="flex h-full min-h-0 flex-col" data-testid="assistant-panel">
      <div className="flex h-16 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Sparkles className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-tight">Workflow AI</p>
          {status ? <p className="truncate text-xs text-muted-foreground" data-testid="assistant-rules-notice">
            {!status.chatAvailable ? "Kräver serverlagring" : directOnly ? "Direkta svar · AI-modellen av" : `AI-modellen på · ${status.conditions.availableCredits.balance} krediter kvar`}
          </p> : <p className="truncate text-xs text-muted-foreground">Gemensam Workflow-assistent</p>}
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={startNew} aria-label="Ny konversation" title="Ny konversation"><Plus /></Button>
        {!expanded || compact ? <Popover.Root open={historyOpen} onOpenChange={setHistoryOpen}>
          <Popover.Trigger asChild><Button type="button" variant="ghost" size="icon" aria-label="Konversationer" title="Konversationer" data-testid="assistant-history"><History /></Button></Popover.Trigger>
          <Popover.Portal><Popover.Content align="end" sideOffset={6} className="z-[70] w-80 rounded-xl border bg-popover p-2 shadow-lg">
            <p className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Konversationer</p>
            <div className="max-h-80 overflow-y-auto">{history}</div>
          </Popover.Content></Popover.Portal>
        </Popover.Root> : null}
        <Popover.Root>
          <Popover.Trigger asChild><Button type="button" variant="ghost" size="icon" aria-label="AI-status och minne" title="AI-status och minne" data-testid="assistant-settings"><Settings2 /></Button></Popover.Trigger>
          <Popover.Portal><Popover.Content align="end" sideOffset={6} className="z-[70] w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border bg-popover p-3 shadow-lg">
            {status ? <StatusCard status={status} /> : null}
            {status?.chatAvailable ? <AssistantMemory /> : null}
            <Link href="/?view=ai_settings" onClick={() => onOpenChange(false)} className="mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium text-primary hover:bg-secondary" data-testid="assistant-permissions-link"><ShieldCheck className="size-4" />Vad Workflow AI får göra och läsa</Link>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">AI-svar använder krediter; kostnaden beräknas automatiskt och visas när svaret är klart. <Link href="/?view=credits" onClick={() => onOpenChange(false)} className="underline">Se AI-krediter</Link>.</p>
          </Popover.Content></Popover.Portal>
        </Popover.Root>
        <Button type="button" variant="ghost" size="icon" className="hidden xl:inline-flex" onClick={() => onExpandedChange(!expanded)} aria-label={expanded ? "Återställ AI-panelens storlek" : "Förstora AI-panelen"}>{expanded ? <Minimize2 /> : <Maximize2 />}</Button>
        <Button type="button" variant="ghost" size="icon" onClick={() => onOpenChange(false)} aria-label="Stäng AI-assistenten"><X /></Button>
      </div>

      <div className={cn("flex min-h-0 flex-1 flex-col", expanded && !compact && "grid grid-cols-[16rem_minmax(0,1fr)] grid-rows-[minmax(0,1fr)]")}>
        {expanded && !compact ? <aside aria-label="Konversationer" className="min-h-0 overflow-y-auto border-r p-2">
          <div className="flex items-center justify-between px-2 pb-1 pt-1"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Konversationer</p><Button type="button" variant="ghost" size="sm" onClick={startNew}><Plus />Ny</Button></div>
          {history}
        </aside> : null}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
            {!status && !error ? <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-4 animate-spin" /> Kontrollerar AI-beredskap…</div>
              : error ? <div className="py-6 text-sm text-destructive" role="alert">AI-status kunde inte hämtas. <Button type="button" variant="outline" size="sm" className="ml-2" onClick={() => void load()}>Försök igen</Button></div>
              : loadingThread ? <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-4 animate-spin" /> Läser in konversationen…</div>
              : !messages.length ? <Welcome status={status!} onPick={(text) => void send(text)} />
              : <div className="mx-auto max-w-3xl space-y-3" aria-label="Meddelanden">
                {messages.map((message) => <MessageBubble key={message.id} message={message} fresh={message.id === freshId} onCitation={() => onOpenChange(false)} onRetry={() => void send(message.content, message.id)} />)}
                {sending ? <WaitingLine /> : null}
                <div ref={threadEnd} />
              </div>}
          </div>
          <div className="shrink-0 border-t px-4 py-3">
            {notice ? <p className="mb-2 text-xs text-muted-foreground" role="status">{notice}</p> : null}
            <label htmlFor="ai-message-draft" className="sr-only">Meddelande till Workflow AI</label>
            <form className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border bg-card p-1.5 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15" onSubmit={(event) => { event.preventDefault(); void send(draft); }}>
              <textarea ref={input} id="ai-message-draft" rows={1} value={draft} maxLength={8_000} onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(draft); } }}
                disabled={!status?.chatAvailable || sending}
                placeholder={status?.chatAvailable ? "Fråga något, t.ex. ”mina uppgifter” eller ”status på <projekt>”" : "Assistenten kräver serverlagring"}
                className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none" style={{ fieldSizing: "content" } as React.CSSProperties} />
              <Button type="submit" size="icon" disabled={!draft.trim() || sending || !status?.chatAvailable} aria-label="Skicka meddelande">{sending ? <LoaderCircle className="animate-spin" /> : <Send />}</Button>
            </form>
            <p className="mx-auto mt-1.5 max-w-3xl text-[11px] leading-4 text-muted-foreground">Enter skickar, Skift + Enter ger ny rad. Svaren bygger bara på det du själv får se.</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {open ? <aside aria-label="Workflow AI-assistent" className={cn("fixed inset-y-0 right-0 z-30 hidden border-l bg-card shadow-xl xl:block", expanded ? "w-[min(72rem,calc(100vw-16rem))]" : "w-[30rem]")}>{content}</aside> : null}
      <Dialog.Root open={open && compact} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45 xl:hidden" />
          <Dialog.Content className="fixed inset-0 z-50 bg-card xl:hidden">
            <Dialog.Title className="sr-only">Workflow AI-assistent</Dialog.Title>
            <Dialog.Description className="sr-only">Gemensam AI-assistent för HINTEK Workflow.</Dialog.Description>
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

/** The empty window: what to ask, with questions that are sent at once. */
function Welcome({ status, onPick }: { status: AssistantStatus; onPick: (text: string) => void }) {
  return <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center px-2 py-6 text-center">
    <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Sparkles className="size-6" /></span>
    <h2 className="mt-4 text-base font-semibold">Vad vill du veta?</h2>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">
      {!status.chatAvailable ? "I Local finns dina data i den egna filen, så assistenten kan inte läsa dem."
        : "Fråga om ditt arbete i Workflow. Vanliga frågor besvaras direkt ur Workflow, utan krediter och utan att något lämnar systemet."}
    </p>
    {status.chatAvailable ? <div className="mt-4 flex flex-wrap justify-center gap-2">
      {SUGGESTIONS.map((suggestion) => <button key={suggestion} type="button" onClick={() => onPick(suggestion)} className="rounded-full border bg-card px-3 py-1.5 text-xs font-medium hover:border-primary/40 hover:bg-secondary hover:text-primary">{suggestion}</button>)}
    </div> : null}
    {status.chatAvailable && !status.available ? <p className="mt-4 flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-left text-xs leading-5 text-muted-foreground">
      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
      <span>{status.conditions.sharingPolicy.ready ? "Tolkning och sammanfattningar med AI-modellen slås på av HINTEK." : <>För tolkning och sammanfattningar med AI-modellen behöver företagsadmin slå på Workflow AI under <Link href="/?view=ai_settings" className="font-medium text-primary underline">Mitt företag → Workflow AI</Link>.</>}</span>
    </p> : null}
  </div>;
}

/** One message: the person's to the right, the assistant's with its mark (direct answer or model), sources and time. */
function MessageBubble({ message, fresh, onCitation, onRetry }: { message: ConversationMessage; fresh: boolean; onCitation: () => void; onRetry: () => void }) {
  const mine = message.role === "USER";
  const direct = message.model === RULES_MODEL;
  const text = useReveal(message.content, fresh && !mine);
  return <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
    <div className={cn("max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm", mine ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md border bg-card", message.pending && "opacity-70")} data-testid={mine ? "assistant-user-message" : "assistant-answer"}>
      {mine ? <p className="whitespace-pre-wrap break-words">{message.content}</p> : <AnswerBody text={text} />}
      {message.failed ? <p className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span className="opacity-90">{message.failed}</span><button type="button" onClick={onRetry} className="inline-flex items-center gap-1 rounded-md bg-primary-foreground/15 px-2 py-0.5 font-medium hover:bg-primary-foreground/25"><RotateCcw className="size-3" />Försök igen</button></p> : null}
      {!mine && message.citations?.length ? <div className="mt-2 flex flex-wrap gap-1.5" aria-label="AI-svarets källor">
        {message.citations.map((citation) => <Link key={`${citation.resourceType}:${citation.resourceId}:${citation.href}`} href={citation.href} onClick={onCitation} className="rounded-md border bg-background px-2 py-1 text-[0.6875rem] text-primary hover:bg-secondary">{citation.citationLabel}</Link>)}
      </div> : null}
      <p className={cn("mt-1.5 flex items-center gap-1.5 text-[0.6875rem]", mine ? "justify-end text-primary-foreground/70" : "text-muted-foreground")}>
        {!mine ? (direct ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"><Zap className="size-3" />{RULES_MODEL}</span> : <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-1.5 py-0.5 font-medium text-secondary-foreground"><Sparkles className="size-3" />{message.model ?? "AI"}</span>) : null}
        <span>{message.pending ? "Skickar…" : formatSwedish(message.createdAt, { timeStyle: "short" })}</span>
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

/** What the window says while it waits: quiet, changing text instead of only a spinner (2026-10-02). */
const WAITING_STEPS = ["Läser frågan", "Letar i Workflow", "Tänker", "Skriver svaret"] as const;
function WaitingLine() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timers = [900, 2_600, 6_000].map((delay, index) => window.setTimeout(() => setStep(index + 1), delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);
  return <div className="flex items-center gap-2 px-1 py-1.5 text-sm" role="status" data-testid="assistant-waiting">
    <Sparkles className="size-3.5 shrink-0 animate-pulse text-primary/70" />
    <span key={step} className="ai-shimmer-text animate-in fade-in duration-300">{WAITING_STEPS[step]}…</span>
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
        <input id={`rename-${conversation.id}`} autoFocus maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setRenamingId(null); }} className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm" />
        <Button size="icon" type="submit" variant="ghost" aria-label="Spara namnet" disabled={!title.trim()}><Check /></Button>
      </form> : <Fragment>
        <button type="button" aria-pressed={activeId === conversation.id} onClick={() => onOpen(conversation.id)} className="min-w-0 flex-1 px-2 py-1.5 text-left">
          <span className="block truncate font-medium">{conversation.title}</span>
          <span className="block text-[11px] text-muted-foreground">{conversation._count.messages} meddelanden{conversation.lastMessageAt ? ` · ${formatSwedish(conversation.lastMessageAt, { dateStyle: "short" })}` : ""}</span>
        </button>
        <span className="flex shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
          <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Byt namn på ${conversation.title}`} onClick={() => { setRenamingId(conversation.id); setTitle(conversation.title); }}><Pencil /></Button>
          <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Radera ${conversation.title}`} onClick={() => onDelete(conversation)}><Trash2 /></Button>
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
      {row("Delningspolicy", status.conditions.sharingPolicy.ready, status.conditions.sharingPolicy.ready ? "Klar" : "Ej godkänd")}
      {row("Kreditledger", status.conditions.creditLedger.healthy, status.conditions.creditLedger.healthy ? "Stämd" : "Avvikelse")}
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
    <p className="mt-2 text-xs leading-5 text-muted-foreground">Korta anteckningar om hur du och företaget arbetar och vill få information presenterad. De skickas bara till AI-modellen när företaget har slagit på det, aldrig med ditt namn. Töm rutan och spara för att radera.</p>
    <label className="mt-3 grid gap-1 text-xs font-medium">Mitt minne
      <textarea className="form-textarea min-h-20 text-sm" maxLength={memory.max} value={user} onChange={(event) => setUser(event.target.value)} placeholder="T.ex. Jag vill ha korta punktlistor och datum först." data-testid="memory-user" />
    </label>
    <Button type="button" size="sm" variant="outline" className="mt-2" disabled={busy || user === memory.user} onClick={() => void save("USER", user)}>Spara mitt minne</Button>
    {memory.canEditCompany ? <>
      <label className="mt-3 grid gap-1 text-xs font-medium">Företagets minne
        <textarea className="form-textarea min-h-20 text-sm" maxLength={memory.max} value={company} onChange={(event) => setCompany(event.target.value)} placeholder="T.ex. Vi arbetar med elinstallationer i Småland; projekt namnges efter gatuadress." data-testid="memory-company" />
      </label>
      <Button type="button" size="sm" variant="outline" className="mt-2" disabled={busy || company === memory.company} onClick={() => void save("COMPANY", company)}>Spara företagets minne</Button>
    </> : memory.company ? <p className="mt-3 text-xs text-muted-foreground"><span className="font-medium text-foreground">Företagets minne:</span> {memory.company}</p> : null}
    {notice ? <p className="mt-2 text-xs text-muted-foreground" role="status">{notice}</p> : null}
  </details>;
}
