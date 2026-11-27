"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Send } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";

/**
 * Chattens delar (2026-11-23): the parts of Workflow AI's window (features/ai/assistant-panel.tsx) that another page may speak with
 * too – the person's bubble and the answer's plain text, the answer's formatting, the thinking lines, the field with the round send
 * button in its corner, and the chips for a ready question or a choice. Agenter's mission page is a conversation built from the same
 * parts (features/agents/agents-page.tsx), so the two look and behave alike. A new need is added here, never copied.
 */
/** The person's own message: a bubble to the right. Workflow AI's and Workflow's answers are plain text on the window, the full width. */
export const CHAT_USER_BUBBLE = "max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm leading-6 text-primary-foreground";
export const CHAT_ANSWER = "w-full min-w-0 text-sm leading-6 text-foreground";
/** The message field: three lines, growing with the text, the send button's place in its right corner. */
export const CHAT_FIELD = "block max-h-32 min-h-[calc(3lh+1.375rem)] w-full resize-none rounded-[1.375rem] border bg-card py-2.5 pl-4 pr-14 text-base outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15 disabled:opacity-60 sm:text-sm";

/** A ready question, a quick reply or a choice: the chip of the chat's suggestion row. `active`: the choice that is open. */
export function ChatChip({ className, active = false, ...props }: React.ComponentProps<"button"> & { active?: boolean }) {
  return <button type="button" {...props} aria-pressed={active || undefined}
    className={cn("min-h-9 shrink-0 snap-start whitespace-nowrap rounded-full border bg-card px-3.5 text-sm text-foreground hover:border-primary/40 hover:bg-secondary hover:text-primary disabled:opacity-60", active && "border-primary/50 bg-secondary text-primary", className)} />;
}

/** The round send button in the field's corner. */
export function ChatSendButton({ label, children, className, ...props }: Omit<React.ComponentProps<typeof IconButton>, "variant">) {
  return <IconButton label={label} variant="default" className={cn("absolute bottom-1.5 right-1.5 size-10 rounded-full", className)} {...props}>{children ?? <Send />}</IconButton>;
}

/** The field and its send button, for a page that needs nothing more: Enter sends, Skift + Enter gives a new line. */
export function ChatComposer({ id, label, value, onChange, onSend, placeholder, disabled = false, sendLabel = "Skicka", maxLength = 1_000, testId }: {
  id: string; label: string; value: string; onChange: (value: string) => void; onSend: () => void; placeholder?: string; disabled?: boolean; sendLabel?: string; maxLength?: number; testId?: string;
}) {
  return <form className="relative mx-auto w-full max-w-3xl text-left" onSubmit={(event) => { event.preventDefault(); onSend(); }}>
    <label htmlFor={id} className="sr-only">{label}</label>
    <textarea id={id} rows={3} value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} placeholder={placeholder}
      onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSend(); } }}
      className={CHAT_FIELD} style={{ fieldSizing: "content" } as React.CSSProperties} data-testid={testId} />
    <ChatSendButton label={sendLabel} type="submit" disabled={disabled || !value.trim()} data-testid={testId ? `${testId}-send` : undefined} />
  </form>;
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
export function ThinkingBubble({ label }: { label?: string }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timers = [900, 2_600, 6_000].map((delay, index) => window.setTimeout(() => setStep(index + 1), delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);
  const words = label ?? WAITING_STEPS[step];
  return <div className="flex justify-start" role="status" data-testid="assistant-waiting">
    <div className="w-56 max-w-[85%] py-1" data-testid="assistant-thinking">
      <div aria-hidden="true" className="ai-thinking space-y-2 py-1"><span className="w-full" /><span className="w-4/5" /><span className="w-3/5" /></div>
      <p className="mt-1 text-[0.6875rem] leading-4"><span key={words} className="ai-shimmer-text animate-in fade-in duration-300">{words}…</span></p>
    </div>
  </div>;
}
