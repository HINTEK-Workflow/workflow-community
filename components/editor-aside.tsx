import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Högerställd sammanfattning (2026-10-16, the design lab's Inköp and Arbetsorder): an editor's panels in one column
 * with a narrow summary column beside them – the sums of a quote or a purchase, the facts of a work order – that stays in
 * view while the person scrolls. Only on a wide editor at display level 3 – the layout's own width at least 68.5 rem, or
 * 72 rem with `fit="table"` so a quote's and a purchase's line table keeps its table form beside the column (a window of
 * about 1 500 px with the menu); everywhere else the summary stands where it is in the order of the panels, so nothing
 * moves on a phone, a tablet or at level 1–2.
 *
 * Use: put the editor's panels in `EditorAsideLayout` and the summary, at its place in the reading order, in
 * `EditorAside`. The look and the breakpoint are in app/globals.css (`.editor-aside-*`); no page builds its own.
 */
export function EditorAsideLayout({ children, className, testId, fit = "plain" }: { children: ReactNode; className?: string; testId?: string; fit?: "plain" | "table" }) {
  return <div className="editor-aside-box" data-fit={fit}>
    <div className={cn("editor-aside-layout", className)} data-testid={testId}>{children}</div>
  </div>;
}

/** The summary column; on a narrow screen it is an ordinary block between the panels. */
export function EditorAside({ children, label = "Sammanfattning", testId = "editor-aside" }: { children: ReactNode; label?: string; testId?: string }) {
  return <aside aria-label={label} className="editor-aside" data-testid={testId}>{children}</aside>;
}
