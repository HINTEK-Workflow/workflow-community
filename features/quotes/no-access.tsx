"use client";

import { NoPermission } from "@/features/kfid/ui";

/**
 * Medarbetare utan rättighet (2026-10-18, decision 6): one rule – the same box with the heading "Du har inte
 * behörighet till den här sidan" and the button "Till Översikt"; no filters, no export, no buttons for what may not be done, no
 * silent redirect and no empty box without a heading. The API refuses as before. The shared component lives in features/kfid/ui.tsx (NoPermission).
 */
export function NoAccess() {
  return <div data-testid="no-access"><NoPermission /></div>;
}

/** An error from `api()` that means "not allowed" (403). */
export const isDenied = (cause: unknown) => (cause as { status?: number } | null)?.status === 403;
