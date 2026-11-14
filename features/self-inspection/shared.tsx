"use client";

import { formatSwedishDate } from "@/lib/swedish-time";
import { cn } from "@/lib/utils";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import type { SelfInspectionAction, SelfInspectionView } from "@/lib/self-inspection/model";
import { parseProgramText } from "@/lib/self-inspection/text";

/** One change; the answer is the new view, or null when it did not go through (the toast has said why). */
export type Run = (input: SelfInspectionAction, done?: string) => Promise<SelfInspectionView | null>;

/** Certificates and proofs attached to a line of a competence card (2026-10-07; Cloud only: the files live in the server's private storage). */
export type CredentialFilesApi = { upload: (credentialId: string, file: File) => Promise<void>; remove: (fileId: string) => Promise<void>; href: (fileId: string) => string };

export const siDate = (value: string | null | undefined) => value ? formatSwedishDate(value.length === 10 ? `${value}T12:00:00Z` : value, { dateStyle: "medium" }) : "";

/** The programme's running text as a document: headings, paragraphs, lists and tables (lib/self-inspection/text.ts). */
export function ProgramText({ text, className }: { text: string; className?: string }) {
  const blocks = parseProgramText(text);
  if (!blocks.length) return null;
  return <div className={cn("space-y-2.5 text-sm leading-6", className)}>{blocks.map((block, index) => {
    if (block.type === "heading") return <h4 key={index} className="pt-1 text-sm font-semibold text-foreground">{block.text}</h4>;
    if (block.type === "paragraph") return <p key={index}>{block.text}</p>;
    if (block.type === "list") {
      const List = block.ordered ? "ol" : "ul";
      return <List key={index} className={cn("space-y-1 pl-5", block.ordered ? "list-decimal" : "list-disc")}>{block.items.map((item, at) => <li key={at}>{item}</li>)}</List>;
    }
    return <div key={index} className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[20rem] text-left text-sm">
        <thead className="bg-muted/60 text-xs text-muted-foreground"><tr>{block.header.map((cell, at) => <th key={at} scope="col" className="px-3 py-2 font-medium">{cell}</th>)}</tr></thead>
        <tbody className="divide-y">{block.rows.map((row, at) => <tr key={at}>{row.map((cell, column) => <td key={column} className="px-3 py-2 align-top">{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>;
  })}</div>;
}

/** A small label in the document (ERE, "Under handledning", "Saknas"). */
export function Tag({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "warning" | "primary" }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium",
    tone === "warning" ? indicatorBadge("warning")
      : tone === "primary" ? "border-primary/30 bg-secondary text-secondary-foreground" : "border-border bg-muted text-muted-foreground")}>{children}</span>;
}

/**
 * Scrolls to a part of the document and gives it focus for keyboard and screen reader users. A part that is folded (the
 * document's parts are rows that open on a phone, 2026-10-17) opens first – also when the place is inside one.
 */
export function goTo(anchor: string) {
  const target = document.getElementById(anchor);
  if (!target) return;
  for (let fold = target.closest("details"); fold; fold = fold.parentElement?.closest("details") ?? null) fold.open = true;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
}
