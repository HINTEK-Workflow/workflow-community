"use client";

import { Info } from "lucide-react";

/** The (i) beside a choice that opens a short explanation – the control's moment help, shared by the forms. */
export function ContextHelp({ label, text, align = "right" }: { label: string; text: string; align?: "left" | "right" }) {
  return (
    <details className="context-help group relative shrink-0">
      <summary
        className="flex size-7 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
        aria-label={`Läs mer om ${label}`}
        title={`Läs mer om ${label}`}
      >
        <Info className="size-4" />
      </summary>
      <div className={`absolute top-8 z-20 w-72 rounded-lg border bg-popover p-3 text-xs leading-5 text-popover-foreground shadow-lg ${align === "left" ? "right-0 sm:left-0 sm:right-auto" : "right-0"}`}>
        {text}
      </div>
    </details>
  );
}
