"use client";

import { Lightbulb, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatOffer } from "./chat-offers";

/**
 * What the open page's agents have to say, first in the chat (2026-11-21): a tip with its own button, or a proposal the agent
 * can make here, drawn by the same component as before (it asks the server and shows Använd and Avfärda). Grey-header cards like
 * the proposals; nothing says whether rules or the model are behind it – one chat.
 */
export function ChatOfferCards({ offers, onAction }: { offers: readonly ChatOffer[]; onAction?: () => void }) {
  if (!offers.length) return null;
  return <section aria-label="På den här sidan" className="mx-auto mb-2 w-full max-w-3xl space-y-2" data-testid="chat-offers">
    {offers.map((offer) => <div key={offer.id} className={cn("overflow-hidden rounded-xl border bg-card text-sm shadow-xs", offer.priority === 3 && "border-red-200 dark:border-red-900")} data-testid="chat-offer" data-agent={offer.agentId} data-offer-id={offer.id}>
      <div className="flex items-center gap-2 border-b bg-muted/60 px-3 py-2">
        {offer.node ? <Sparkles className="size-3.5 shrink-0 text-primary" aria-hidden="true" /> : <Lightbulb className={cn("size-3.5 shrink-0", offer.priority === 3 ? "text-red-700 dark:text-red-300" : "text-primary")} aria-hidden="true" />}
        <p className="min-w-0 flex-1 truncate text-xs font-semibold">{offer.title}</p>
        {offer.onDismiss ? <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Inte nu" onClick={offer.onDismiss} data-testid="chat-offer-dismiss"><X className="size-3.5" /></button> : null}
      </div>
      <div className="space-y-2 px-3 py-2.5">
        {offer.text ? <p className="text-xs leading-5 text-muted-foreground">{offer.text}</p> : null}
        {offer.node ? <div data-testid="chat-offer-node">{offer.node}</div> : null}
        {offer.actions?.length || offer.onMute ? <div className="flex flex-wrap items-center gap-2">
          {offer.actions?.map((item) => <Button key={item.label} type="button" size="sm" onClick={() => { item.run(); onAction?.(); }} data-testid={item.testId ?? "chat-offer-action"}>{item.label}</Button>)}
          {offer.onDismiss ? <Button type="button" size="sm" variant="ghost" onClick={offer.onDismiss}>Inte nu</Button> : null}
          {offer.onMute ? <Button type="button" size="sm" variant="ghost" className="text-muted-foreground" onClick={offer.onMute} data-testid="chat-offer-mute">Visa inte sådana tips</Button> : null}
        </div> : null}
      </div>
    </div>)}
  </section>;
}
