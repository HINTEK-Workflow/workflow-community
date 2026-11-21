"use client";

import { useLinkStatus } from "next/link";

/**
 * Svar direkt på klicket (stabil sidladdning steg 8a, 2026-10-22/23): inside a menu row's or a tab's `<Link>`, a thin
 * line in the primary colour while the page it opens is on its way, so a click is seen at once even when the server takes
 * a while (P6). No spinner, no full-screen layer and nothing that moves: the line takes no room (absolutely placed in the
 * link, which is `relative`) and simply shows or not (app/globals.css, `.link-pending`). Screen readers are told by the
 * page itself once it has opened.
 */
export function LinkPending({ edge = "bottom" }: { edge?: "bottom" | "left" | "top" }) {
  const { pending } = useLinkStatus();
  return <span aria-hidden="true" className="link-pending" data-edge={edge} data-pending={pending ? "" : undefined} />;
}
