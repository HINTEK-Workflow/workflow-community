"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { DropdownMenu } from "radix-ui";
import { CalendarX2, ClipboardList, FileText, FolderKanban, Link2, OctagonAlert, Repeat, ShoppingCart, UserPlus, ClipboardCheck } from "lucide-react";
import type { NewChoice } from "@/lib/workflow/new-choices";

const ICONS = { "work-order": ClipboardList, task: ClipboardCheck, project: FolderKanban, customer: UserPlus, quote: FileText, purchase: ShoppingCart, round: Repeat, link: Link2, deviation: OctagonAlert, absence: CalendarX2 } as const;

/**
 * A small chooser for starting new work (Fas 4A): the mobile bar's "Ny" and the project page's "Nytt jobb". The
 * trigger is the caller's own button; each choice is a link, or an action when it opens something on the page.
 */
export function NewChoiceMenu({ trigger, choices, label, onChoose, align = "end", side, testId }: {
  trigger: ReactNode;
  choices: NewChoice[];
  /** Heading inside the chooser, for screen readers and as a short hint. */
  label: string;
  /** Choices without an address (Koppla befintlig uppgift) and every choice after it was made, e.g. to close the menu. */
  onChoose?: (choice: NewChoice) => void;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom";
  testId?: string;
}) {
  const itemClass = "flex min-h-11 cursor-pointer items-center gap-3 rounded px-3 py-2 text-sm outline-none focus:bg-muted";
  return <DropdownMenu.Root modal={false}>
    <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content align={align} side={side} sideOffset={8} data-testid={testId}
        className="z-50 min-w-56 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
        <DropdownMenu.Label className="px-3 py-2 text-xs font-medium text-muted-foreground">{label}</DropdownMenu.Label>
        {choices.map((choice) => {
          const Icon = ICONS[choice.key];
          const content = <><span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary"><Icon className="size-4" /></span>{choice.label}</>;
          return choice.href
            ? <DropdownMenu.Item key={choice.key} asChild onSelect={() => onChoose?.(choice)}><Link href={choice.href} className={itemClass}>{content}</Link></DropdownMenu.Item>
            : <DropdownMenu.Item key={choice.key} className={itemClass} onSelect={() => onChoose?.(choice)}>{content}</DropdownMenu.Item>;
        })}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
