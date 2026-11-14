"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

/**
 * A code field (Min webbsida, 2026-11-10): monospace, line numbers, no wrapping, Tab indents (two spaces; Skift+Tab takes them
 * away, also over several lines). Esc and then Tab leaves the field, so the keyboard is never caught. Typing goes through the
 * browser's own editing, so Ctrl+Z inside the field works as usual. No library: a textarea with a number column.
 */
export function CodeEditor({ id, value, onChange, label, className, testId, invalid }: {
  id: string; value: string; onChange: (value: string) => void; label: string; className?: string; testId?: string; invalid?: boolean;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [scroll, setScroll] = useState(0);
  const released = useRef(false);
  const selection = useRef<[number, number] | null>(null);
  useLayoutEffect(() => {
    if (!selection.current || !field.current) return;
    field.current.setSelectionRange(...selection.current);
    selection.current = null;
  });
  const lines = value.split("\n").length;

  /** Replaces [start, end) through the browser (keeps Ctrl+Z); by hand when the browser cannot. */
  const replace = (element: HTMLTextAreaElement, start: number, end: number, text: string, select: [number, number]) => {
    element.setSelectionRange(start, end);
    if (!document.execCommand("insertText", false, text)) onChange(element.value.slice(0, start) + text + element.value.slice(end));
    selection.current = select;
    element.setSelectionRange(...select);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") { released.current = true; return; }
    if (event.key !== "Tab") { released.current = false; return; }
    if (released.current || event.ctrlKey || event.altKey || event.metaKey) return;
    event.preventDefault();
    const element = event.currentTarget;
    const { selectionStart: start, selectionEnd: end, value: text } = element;
    if (start === end && !event.shiftKey) { replace(element, start, end, "  ", [start + 2, start + 2]); return; }
    const from = text.lastIndexOf("\n", start - 1) + 1;
    const to = end > start && text[end - 1] === "\n" ? end - 1 : end;
    const rows = text.slice(from, to).split("\n");
    const changed = rows.map((row) => event.shiftKey ? row.replace(/^( {1,2}|\t)/, "") : `  ${row}`);
    const result = changed.join("\n");
    const firstShift = changed[0].length - rows[0].length;
    replace(element, from, to, result, [Math.max(from, start + firstShift), to + (result.length - (to - from))]);
  };

  return <div className={cn("relative flex min-h-0 overflow-hidden rounded-md border bg-background font-mono text-xs leading-5", invalid && "border-destructive", className)}>
    <div aria-hidden="true" className="w-11 shrink-0 select-none overflow-hidden border-r bg-muted/60 py-2 pr-2 text-right text-muted-foreground">
      <pre className="m-0 font-mono text-xs leading-5" style={{ transform: `translateY(${-scroll}px)` }}>{Array.from({ length: lines }, (_, index) => index + 1).join("\n")}</pre>
    </div>
    <textarea ref={field} id={id} aria-label={label} aria-invalid={invalid || undefined} spellCheck={false} autoCapitalize="off" autoComplete="off" autoCorrect="off" wrap="off"
      className="min-w-0 flex-1 resize-none overflow-auto whitespace-pre bg-transparent p-2 font-mono text-xs leading-5 outline-none [tab-size:2] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={onKeyDown} onScroll={(event) => setScroll(event.currentTarget.scrollTop)} data-testid={testId} />
  </div>;
}
