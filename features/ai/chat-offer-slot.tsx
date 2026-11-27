"use client";

import { useEffect } from "react";
import { publishChatOffer, withdrawChatOffer, type ChatOffer } from "./chat-offers";

/**
 * Where a page used to draw a fixed AI button (Föreslå arbetsorder, Granska med AI, Föreslå åtgärder, Föreslå planering, Skriv med
 * AI), it now puts this: nothing on the page, and the same component in the chat as an offer from its built-in agent (
 * 2026-11-21). The offer is kept fresh on every render, so its buttons always act on the page as it is now, and withdrawn when the
 * page goes.
 */
export function ChatOfferSlot({ offer }: { offer: ChatOffer | null }) {
  useEffect(() => { if (offer) publishChatOffer(offer); });
  const id = offer?.id ?? null;
  useEffect(() => () => { if (id) withdrawChatOffer(id); }, [id]);
  return null;
}
