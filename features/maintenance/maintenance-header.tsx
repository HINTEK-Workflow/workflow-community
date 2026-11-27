"use client";

import type { ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Factory, Warehouse } from "lucide-react";
import { PageHeader } from "@/components/page-shell";
import { NativeLargeTitle, NativeSegmented } from "@/components/native/list";
import { useNativeMode } from "@/features/workflow/use-detail-level";

/**
 * Underhålls sidhuvud (2026-10-31; one template for every page top, 2026-11-02): the heading Underhåll and a line of text,
 * the view's own Ny … top right, and the views Anläggning and Förråd as the shared tab row under the heading (`SectionTabs`, given by
 * the workspace as Planering's and Tid's), not as buttons in the head. Each view keeps its address, and a change of view is a step of
 * its own (Tillbaka goes to the view before). On a phone's level 1 the top bar has the title and the views are the app's segmented control.
 */
export const MAINTENANCE_VIEWS = [["machines", "Anläggning", Factory], ["store", "Förråd", Warehouse]] as const;
export type MaintenanceView = (typeof MAINTENANCE_VIEWS)[number][0];
/** The view's own button in the header. */
export const NEW_BUTTON_WIDTH = "min-w-36";

/** A view's address: the chosen part stays; a view's filter and article do not follow to the other view. */
export function maintenanceViewHref(next: string, search: { toString(): string }): string {
  const params = new URLSearchParams(search.toString());
  params.set("view", "maintenance");
  params.delete("filter");
  params.delete("article");
  if (next === "store") params.set("tab", "store"); else params.delete("tab");
  return `/?${params}`;
}
export const maintenanceViewOf = (tab: string | null): MaintenanceView => (tab === "store" ? "store" : "machines");

export function MaintenanceHeader({ view, action }: { view: MaintenanceView; action: ReactNode }) {
  const native = useNativeMode();
  const router = useRouter();
  const search = useSearchParams();
  if (native) return <>
    <NativeLargeTitle inBar>Underhåll</NativeLargeTitle>
    <NativeSegmented label="Underhåll" value={view} onChange={(next) => router.push(maintenanceViewHref(next, search), { scroll: false })} testId="maintenance-views"
      options={MAINTENANCE_VIEWS.map(([key, label]) => [key, label] as const)} />
  </>;
  return <PageHeader title="Underhåll" description={view === "store" ? "Förvaring, artiklar och saldo per plats." : "Platser, maskiner och deras underhåll."} actions={action} />;
}
