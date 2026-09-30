"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Dialog } from "radix-ui";
import {
  LoaderCircle,
  Maximize2,
  MessageSquareText,
  Minimize2,
  Pencil,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AssistantStatus = {
  lifecycle: "EXECUTION_LOCKED" | "READY";
  available: boolean;
  chatAvailable: boolean;
  role: "SUPERADMIN" | "OWNER" | "ADMIN" | "MEMBER";
  conditions: {
    provider: { ready: boolean; configured: boolean; evaluationApproved: boolean };
    sharingPolicy: { ready: boolean };
    creditLedger: {
      healthy: boolean;
      walletBalanceMatchesLots: boolean;
      purchasedBalanceMatchesLots: boolean;
      walletBalanceMatchesLedger: boolean;
    };
    availableCredits: { available: boolean; balance: number };
  };
  sharingPolicy: {
    enabled: boolean;
    shareChatContent: boolean;
    shareCustomers: boolean;
    shareControls: boolean;
    shareDocuments: boolean;
    shareConversationHistory: boolean;
    allowedModules: "KFID"[];
  };
  historyLocation: "WORKFLOW";
};

type ConversationSummary = {
  id: string;
  title: string;
  lastMessageAt: string | null;
  _count: { messages: number; proposals: number };
};

type ConversationMessage = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  model: string | null;
  citations: WorkflowSearchResult[];
  createdAt: string;
};

type WorkflowSearchResult = {
  resourceType: string;
  resourceId: string;
  title: string;
  description: string;
  href: string;
  citationLabel: string;
};

export function AssistantPanel({
  open,
  expanded,
  onOpenChange,
  onExpandedChange,
}: {
  open: boolean;
  expanded: boolean;
  onOpenChange: (open: boolean) => void;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [error, setError] = useState(false);
  const [compact, setCompact] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [chatNotice, setChatNotice] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const load = useCallback(async () => {
    setError(false);
    try {
      const [statusResponse, conversationsResponse] = await Promise.all([
        fetch("/api/ai/status", { cache: "no-store" }),
        fetch("/api/ai/conversations", { cache: "no-store" }),
      ]);
      if (!statusResponse.ok || !conversationsResponse.ok) throw new Error("status");
      setStatus(await statusResponse.json() as AssistantStatus);
      const conversationData = await conversationsResponse.json() as {
        conversations: ConversationSummary[];
      };
      setConversations(conversationData.conversations);
    } catch {
      setError(true);
    }
  }, []);

  const openConversation = useCallback(async (conversationId: string) => {
    setError(false);
    try {
      const response = await fetch(
        `/api/ai/conversations?conversationId=${encodeURIComponent(conversationId)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("conversation");
      const data = await response.json() as {
        conversation: { id: string; messages: ConversationMessage[] };
      };
      setActiveConversationId(data.conversation.id);
      setMessages(data.conversation.messages);
      setChatNotice("");
    } catch {
      setError(true);
    }
  }, []);

  const mutateConversation = useCallback(async (input: { action: "rename"; conversationId: string; title: string } | { action: "archive"; conversationId: string }) => {
    setSaving(true);
    setError(false);
    try {
      const response = await fetch("/api/ai/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error("conversation");
      const listResponse = await fetch("/api/ai/conversations", { cache: "no-store" });
      if (!listResponse.ok) throw new Error("list");
      const next = ((await listResponse.json()) as { conversations: ConversationSummary[] }).conversations;
      setConversations(next);
      if (input.action === "archive" && activeConversationId === input.conversationId) {
        setActiveConversationId(null);
        setMessages([]);
        if (next[0]) void openConversation(next[0].id);
      }
      setRenamingId(null);
      setDeleteTarget(null);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }, [activeConversationId, openConversation]);

  const sendDraft = useCallback(async () => {
    const content = draft.trim();
    if (!content || saving || sending || !status?.chatAvailable) return;
    setSending(true);
    setChatNotice("");
    try {
      const response = await fetch("/api/ai/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "save_message",
          conversationId: activeConversationId ?? undefined,
          content,
        }),
      });
      const saved = await response.json() as { error?: string; conversation: { id: string }; message: { id: string } };
      if (!response.ok) throw new Error(saved.error || "Frågan kunde inte sparas.");
      setDraft("");
      setActiveConversationId(saved.conversation.id);
      const [listResponse, detailResponse] = await Promise.all([
        fetch("/api/ai/conversations", { cache: "no-store" }),
        fetch(`/api/ai/conversations?conversationId=${encodeURIComponent(saved.conversation.id)}`, { cache: "no-store" }),
      ]);
      if (!listResponse.ok || !detailResponse.ok) throw new Error("Konversationen kunde inte läsas in.");
      setConversations(((await listResponse.json()) as { conversations: ConversationSummary[] }).conversations);
      setMessages(((await detailResponse.json()) as { conversation: { messages: ConversationMessage[] } }).conversation.messages);
      // Rule-first: the server answers directly from Workflow when it can and only uses (and charges) AI when needed.
      const chatResponse = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId: saved.message.id }),
      });
      const result = await chatResponse.json() as { error?: string; chargedCredits?: number; mode?: "RULES" | "AI" };
      if (!chatResponse.ok) throw new Error(result.error || "Svaret kunde inte hämtas.");
      await openConversation(saved.conversation.id);
      setChatNotice(result.mode === "AI" ? `Svaret är klart och kostade ${result.chargedCredits ?? 0} krediter.` : "Svarat direkt från Workflow – inga krediter användes.");
    } catch (sendError) {
      setChatNotice(sendError instanceof Error ? sendError.message : "AI-svaret kunde inte hämtas.");
    } finally {
      setSending(false);
    }
  }, [activeConversationId, draft, openConversation, saving, sending, status?.chatAvailable]);

  useEffect(() => {
    if (open && !status && !error) void load();
  }, [error, load, open, status]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1279px)");
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, sending]);

  const content = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-16 shrink-0 items-center gap-3 border-b px-4">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Sparkles className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">HINTEK AI</p>
          <p className="truncate text-xs text-muted-foreground">Gemensam Workflow-assistent</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="hidden xl:inline-flex"
          onClick={() => onExpandedChange(!expanded)}
          aria-label={expanded ? "Återställ AI-panelens storlek" : "Förstora AI-panelen"}
        >
          {expanded ? <Minimize2 /> : <Maximize2 />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onOpenChange(false)}
          aria-label="Stäng AI-assistenten"
        >
          <X />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {status && !status.available ? <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5" data-testid="assistant-rules-notice">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            <div>
              <p className="text-sm font-medium">{status.chatAvailable ? "Direkta svar från Workflow" : "Assistenten kräver HINTEK Cloud"}</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                {!status.chatAvailable ? "I Local finns dina data i den egna filen, så assistenten kan inte läsa dem."
                  : status.conditions.sharingPolicy.ready
                  ? "Vanliga frågor besvaras direkt ur Workflow utan krediter. Tolkning och sammanfattningar med AI-modellen slås på av HINTEK."
                  : "Vanliga frågor besvaras direkt ur Workflow utan krediter och utan att något skickas vidare. För tolkning och sammanfattningar behöver företagsadmin slå på delning med HINTEK AI."}
              </p>
            </div>
          </div>
        </div> : null}

        {status ? <section className="mt-3 rounded-lg border p-3" aria-label="AI-villkor">
          <p className="text-xs font-medium">AI-villkor</p>
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-muted-foreground">Provider</dt><dd>{status.conditions.provider.ready ? "Klar" : "Spärrad"}</dd>
            <dt className="text-muted-foreground">Delningspolicy</dt><dd>{status.conditions.sharingPolicy.ready ? "Klar" : "Ej godkänd"}</dd>
            <dt className="text-muted-foreground">Kreditledger</dt><dd>{status.conditions.creditLedger.healthy ? "Stämd" : "Avvikelse"}</dd>
            <dt className="text-muted-foreground">Tillgängliga krediter</dt><dd>{status.conditions.availableCredits.available ? `${status.conditions.availableCredits.balance} kvar` : "Saknas"}</dd>
          </dl>
        </section> : null}

        {status?.chatAvailable ? <AssistantMemory /> : null}

        {!status && !error ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status">
            <LoaderCircle className="size-4 animate-spin" /> Kontrollerar AI-beredskap…
          </div>
        ) : error ? (
          <div className="py-6 text-sm text-destructive" role="alert">
            AI-status kunde inte hämtas. Assistenten förblir avstängd.
          </div>
        ) : status ? (
          <div className="mt-5 space-y-5">
            <section aria-labelledby="ai-history-heading">
              <div className="flex items-center justify-between gap-3">
                <h2 id="ai-history-heading" className="text-sm font-medium">Mina konversationer</h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setActiveConversationId(null);
                    setMessages([]);
                    setDraft("");
                    setChatNotice("");
                  }}
                >
                  <Plus /> Ny fråga
                </Button>
              </div>
              {conversations.length ? (
                <div className="mt-2 max-h-44 space-y-2 overflow-y-auto pr-1" aria-label="Konversationshistorik">
                  {conversations.map((conversation) => (
                    <div key={conversation.id} className={cn(
                        "flex items-center gap-1 rounded-lg border p-1 text-xs",
                        activeConversationId === conversation.id
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted",
                      )}>
                      {renamingId === conversation.id ? <form className="flex min-w-0 flex-1 gap-1" onSubmit={(event) => { event.preventDefault(); if (renameTitle.trim()) void mutateConversation({ action: "rename", conversationId: conversation.id, title: renameTitle.trim() }); }}>
                        <label className="sr-only" htmlFor={`rename-${conversation.id}`}>Nytt namn</label>
                        <input id={`rename-${conversation.id}`} autoFocus maxLength={100} value={renameTitle} onChange={(event) => setRenameTitle(event.target.value)} className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2" />
                        <Button size="sm" type="submit" disabled={saving || !renameTitle.trim()}>Spara</Button>
                      </form> : <button type="button" aria-pressed={activeConversationId === conversation.id} onClick={() => void openConversation(conversation.id)} className="min-w-0 flex-1 px-2 py-1 text-left">
                        <span className="block truncate font-medium">{conversation.title}</span>
                        <span className="mt-0.5 block text-muted-foreground">{conversation._count.messages} meddelanden</span>
                      </button>}
                      {renamingId !== conversation.id ? <>
                        <Button type="button" variant="ghost" size="icon" aria-label={`Byt namn på ${conversation.title}`} onClick={() => { setRenamingId(conversation.id); setRenameTitle(conversation.title); }}><Pencil /></Button>
                        <Button type="button" variant="ghost" size="icon" aria-label={`Radera ${conversation.title}`} onClick={() => setDeleteTarget(conversation)}><Trash2 /></Button>
                      </> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 flex items-center gap-2 rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
                  <MessageSquareText className="size-4" /> Ingen konversation är sparad ännu.
                </div>
              )}
              {!messages.length ? (
                <div className="flex min-h-64 flex-col items-center justify-center px-4 py-8 text-center">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Sparkles className="size-6" /></span>
                  <h3 className="mt-4 text-base font-semibold">Vad vill du ha hjälp med?</h3>
                  <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Fråga om ditt arbete i Workflow. Svaren bygger bara på det du själv får se. Vanliga frågor besvaras direkt utan krediter.</p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {["Mina uppgifter", "Vad är försenat?", "Min tid den här veckan", "Planering i morgon"].map((suggestion) => (
                      <button key={suggestion} type="button" disabled={!status?.chatAvailable} onClick={() => setDraft(suggestion)} className="rounded-full border bg-background px-3 py-2 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">{suggestion}</button>
                    ))}
                  </div>
                </div>
              ) : null}
              {messages.length ? (
                <>
                  <div className="mt-3 space-y-2" aria-label="Sparade meddelanden">
                    {messages.map((message) => (
                      <div
                        key={message.id}
                        className={cn(
                          "rounded-xl px-3 py-2 text-sm",
                          message.role === "USER" ? "ml-6 bg-primary/10" : "mr-6 border bg-muted/40",
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words">{message.content}</p>
                        <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                          {message.role === "USER" ? "Du" : message.model}
                        </p>
                        {message.role === "ASSISTANT" && message.citations?.length ? (
                          <div className="mt-2 flex flex-wrap gap-1.5" aria-label="AI-svarets källor">
                            {message.citations.map((citation) => (
                              <Link
                                key={`${citation.resourceType}:${citation.resourceId}`}
                                href={citation.href}
                                onClick={() => onOpenChange(false)}
                                className="rounded-md border bg-background px-2 py-1 text-[0.6875rem] text-primary hover:bg-muted"
                              >
                                {citation.citationLabel}
                              </Link>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                    {sending ? (
                      <div className="mr-6 flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-3 text-sm text-muted-foreground" role="status">
                        <LoaderCircle className="size-4 animate-spin" /> HINTEK AI tänker…
                      </div>
                    ) : null}
                    <div ref={threadEndRef} />
                  </div>
                </>
              ) : null}
            </section>
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t p-4">
        {chatNotice ? <p className="mb-3 text-xs" role="status">{chatNotice}</p> : null}
        <label htmlFor="ai-message-draft" className="sr-only">Meddelande till HINTEK AI</label>
        <form className="flex items-end gap-2 rounded-xl border bg-muted/30 p-2" onSubmit={(event) => { event.preventDefault(); void sendDraft(); }}>
          <textarea
            id="ai-message-draft"
            rows={2}
            value={draft}
            maxLength={8_000}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendDraft();
              }
            }}
            disabled={!status?.chatAvailable || sending}
            placeholder={status?.chatAvailable ? "Fråga något, t.ex. ”mina uppgifter”…" : "Assistenten kräver HINTEK Cloud"}
            className="min-h-14 flex-1 resize-none bg-transparent px-2 py-1 text-sm outline-none"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!draft.trim() || saving || sending || !status?.chatAvailable}
            aria-label="Skicka meddelande"
          >
            {sending ? <LoaderCircle className="animate-spin" /> : <Send />}
          </Button>
        </form>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Enter skickar och Skift + Enter skapar en ny rad. AI-svar använder krediter; kostnaden beräknas automatiskt och visas när svaret är klart. <Link href="/?view=credits" onClick={() => onOpenChange(false)} className="underline">Se AI-krediter</Link>.
        </p>
      </div>
    </div>
  );

  return (
    <>
      {open ? (
        <aside
          aria-label="HINTEK AI-assistent"
          className={cn(
            "fixed inset-y-0 right-0 z-30 hidden border-l bg-card shadow-xl xl:block",
            expanded ? "w-[min(64rem,calc(100vw-16rem))]" : "w-[28rem]",
          )}
        >
          {content}
        </aside>
      ) : null}
      <Dialog.Root open={open && compact} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45 xl:hidden" />
          <Dialog.Content className="fixed inset-0 z-50 bg-card xl:hidden">
            <Dialog.Title className="sr-only">HINTEK AI-assistent</Dialog.Title>
            <Dialog.Description className="sr-only">
              Gemensam AI-assistent för HINTEK Workflow.
            </Dialog.Description>
            {content}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={Boolean(deleteTarget)} onOpenChange={(next) => { if (!next) setDeleteTarget(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/45" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[70] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-5 shadow-xl">
            <Dialog.Title className="text-base font-semibold">Radera konversation?</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">
              Konversationen ”{deleteTarget?.title}” tas bort från din aktiva historik. Åtgärden påverkar ingen annan användare.
            </Dialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close asChild><Button type="button" variant="outline">Avbryt</Button></Dialog.Close>
              <Button type="button" variant="destructive" disabled={saving || !deleteTarget} onClick={() => { if (deleteTarget) void mutateConversation({ action: "archive", conversationId: deleteTarget.id }); }}>
                <Trash2 /> Radera
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

/**
 * HINTEK AI's memory (Daniel 2026-09-30): the person's own (pseudonymised – stored without name or e-mail) and the
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
    fetch("/api/ai/memory", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((data) => {
      if (!active || !data) return;
      setMemory(data); setUser(data.user); setCompany(data.company);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const save = async (scope: "USER" | "COMPANY", content: string) => {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/ai/memory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope, content }) });
      const result = await response.json() as { error?: string; content?: string };
      if (!response.ok) throw new Error(result.error || "Minnet kunde inte sparas.");
      setMemory((current) => current ? { ...current, [scope === "USER" ? "user" : "company"]: result.content ?? "" } : current);
      setNotice(result.content ? "Minnet är sparat." : "Minnet är tömt.");
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Minnet kunde inte sparas."); } finally { setBusy(false); }
  };
  if (!memory) return null;
  return <details className="mt-3 rounded-lg border p-3" data-testid="assistant-memory">
    <summary className="cursor-pointer text-xs font-medium">Minne – hur du vill ha svar</summary>
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
