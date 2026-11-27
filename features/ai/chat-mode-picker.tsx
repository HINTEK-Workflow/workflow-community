"use client";

import Link from "next/link";
import { DropdownMenu } from "radix-ui";
import { Bot, Check, ChevronDown, MessageCircle, Zap, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMode } from "@/lib/ai/chat-proposals";

/** What the chat's field does with the next message: the two chat modes, or Agent (a mission handed to Agenter). */
export type ChatPick = ChatMode | "agent";

const PICKS: { key: ChatPick; label: string; icon: LucideIcon; text: string }[] = [
  { key: "manual", label: "Manuellt", icon: MessageCircle, text: "Svarar och föreslår. Inget sparas förrän du väljer Använd." },
  { key: "auto", label: "Auto", icon: Zap, text: "Gör uppgiften direkt och ger dig en länk och Ångra." },
  { key: "agent", label: "Agent", icon: Bot, text: "Beskriv ett uppdrag som görs på schema. Du kontrollerar det under Agenter innan det sparas." },
];

export const chatPickLabel = (pick: ChatPick) => PICKS.find((item) => item.key === pick)!.label;

/**
 * Läget i fältet (2026-11-22, replaces the big Manuellt | Auto row above the field): one small button left of the
 * microphone with the mode's symbol and name, and a small menu above it with Manuellt, Auto and Agent, each with one line on what it
 * does. Manuellt is the start and Auto is always a choice the person makes (the menu never picks it); Auto shows in the primary
 * colour so it is never forgotten. Agent hands the words to Nytt uppdrag under Agenter, where the mission is checked before saving.
 */
export function ChatModePicker({ pick, onPick, agents, usageHref, onUsage, disabled }: {
  pick: ChatPick; onPick: (pick: ChatPick) => void;
  /** Agent is offered only where Agenter is (Workflow AI on, not Local, not the demo). */
  agents: boolean;
  /** Användning: where the modes and the week's quota are explained. */
  usageHref: string; onUsage: () => void; disabled?: boolean;
}) {
  const current = PICKS.find((item) => item.key === pick) ?? PICKS[0]!;
  const Icon = current.icon;
  return <DropdownMenu.Root modal={false}>
    <DropdownMenu.Trigger asChild disabled={disabled}>
      <button type="button" aria-label={`Läge: ${current.label}. Byt läge`} data-testid="assistant-mode" data-pick={pick}
        className={cn("inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[0.8125rem] font-semibold outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 [&>svg]:size-4 [&>svg]:shrink-0",
          pick === "manual" ? "text-muted-foreground" : "bg-secondary text-primary")}>
        <Icon aria-hidden="true" /><span>{current.label}</span><ChevronDown aria-hidden="true" className="!size-3.5 opacity-70" />
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content side="top" align="start" sideOffset={8} collisionPadding={8} className="z-[70] w-72 max-w-[calc(100vw-1rem)] rounded-xl border bg-popover p-1.5 shadow-lg" data-testid="assistant-mode-menu">
        <DropdownMenu.RadioGroup value={pick} onValueChange={(value) => onPick(value as ChatPick)}>
          {PICKS.filter((item) => item.key !== "agent" || agents).map((item) => <DropdownMenu.RadioItem key={item.key} value={item.key} data-testid={`assistant-mode-${item.key}`}
            className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 outline-none data-[highlighted]:bg-muted">
            <item.icon className={cn("mt-0.5 size-4 shrink-0", item.key === pick ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{item.label}</span><span className="block text-xs leading-5 text-muted-foreground">{item.text}</span></span>
            <DropdownMenu.ItemIndicator className="mt-0.5 shrink-0 text-primary"><Check className="size-4" aria-hidden="true" /></DropdownMenu.ItemIndicator>
          </DropdownMenu.RadioItem>)}
        </DropdownMenu.RadioGroup>
        <DropdownMenu.Separator className="my-1 h-px bg-border" />
        <DropdownMenu.Item asChild className="flex cursor-pointer items-center rounded-lg px-2.5 py-2 text-xs font-medium text-primary outline-none data-[highlighted]:bg-muted">
          <Link href={usageHref} onClick={onUsage} data-testid="assistant-mode-usage">Användning och lägena</Link>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
