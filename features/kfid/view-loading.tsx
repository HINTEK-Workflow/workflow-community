"use client";
// The grey shape of a page or a part whose code is on its way (U1/T2, 2026-10-23; features/kfid/workspace-views.tsx).
// One shared skeleton (stabil sidladdning steg 5): a page uses the page template's `PageSkeleton` (the app's list rows
// at level 1), a part the same grey `RowsSkeleton`; both wait ~150 ms (`DelayedSkeleton`) so quick code never blinks.
// No spinner.
import { PageSkeleton } from "@/components/page-shell";
import { DelayedSkeleton, RowsSkeleton } from "@/components/skeleton";

/** A page on its way: the page's title row and one panel of rows, in the real sizes; the app's list rows at level 1. */
export function ViewLoading() {
  return <PageSkeleton label="Öppnar sidan…" rows={4} testId="view-loading" />;
}

/** A part of a page (a settings card) on its way: one panel of rows. */
export function PartLoading() {
  return <DelayedSkeleton className="app-panel rounded-lg border bg-card px-4 pb-4 pt-3.5" testId="part-loading"><RowsSkeleton rows={2} label="Hämtar…" /></DelayedSkeleton>;
}
