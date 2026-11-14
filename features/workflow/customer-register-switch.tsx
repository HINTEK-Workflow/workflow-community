"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Boxes, Users } from "lucide-react";
import { PageHeader } from "@/components/page-shell";
import { useNativeMode } from "./use-detail-level";
import { RegisterTabsContext } from "@/features/kfid/customer-register-layout";
import { cn } from "@/lib/utils";
import { ObjectRegister, type RegisterPlace } from "./place-register";

/**
 * Kundregister with the company-wide Alla objekt (2026-10-06, decision B5): two tabs, shown only when the company
 * uses the maintenance module. ?show=objects opens the places of every customer as cards.
 * Lika är rätt (2026-11-13): on a computer and a tablet the tabs are the shell's tab row under the heading
 * (features/workflow/section-tabs.tsx `customerRegisterTabs`), and Alla objekt is drawn by the register's own list page
 * (`CustomerListPage`), so it has Kunder's header buttons, Papperskorg and Ny kund, in the same places. The phone's level 1
 * keeps its segmented tabs first and the places under them, as before.
 */
export function CustomerRegisterSwitch({ maintenance, local, personId, children }: { maintenance: boolean; personId?: string; local?: { places: RegisterPlace[]; customerName: (id: string) => string; openWorkOrders: (id: string) => number }; children: ReactNode }) {
  const params = useSearchParams();
  const router = useRouter();
  const native = useNativeMode();
  const objects = params.get("show") === "objects";
  const register = useMemo(() => <ObjectRegister maintenance local={local} personId={personId} />, [local, personId]);
  const value = useMemo(() => objects ? { objects: { register, leave: () => router.push("/?view=customers") } } : { objects: null }, [objects, register, router]);
  if (!maintenance) return <>{children}</>;
  if (native) {
    const tab = (active: boolean) => cn("inline-flex h-[calc(var(--control-h)-.25rem)] items-center gap-1.5 rounded-[4px] px-2.5 text-[0.8125rem] font-medium transition-colors max-lg:h-11 [&_svg]:size-4", active ? "bg-secondary text-secondary-foreground shadow-xs" : "text-muted-foreground hover:bg-secondary/60 hover:text-primary");
    const tabs = <nav aria-label="Kundregister" className="touch-segments flex w-fit max-w-full flex-wrap gap-1 rounded-md border bg-card p-0.5" data-testid="customer-register-switch">
      <Link href="/?view=customers" aria-current={objects ? undefined : "page"} className={tab(!objects)}><Users aria-hidden="true" />Kunder</Link>
      <Link href="/?view=customers&show=objects" aria-current={objects ? "page" : undefined} className={tab(objects)} data-testid="customer-register-objects"><Boxes aria-hidden="true" />Alla objekt</Link>
    </nav>;
    if (objects) return <div>
      <PageHeader title="Alla objekt" description="Kundernas anläggningar och objekt, med öppna arbetsordrar." />
      <div className="mb-5">{tabs}</div>
      {register}
    </div>;
    return <><div className="mb-5">{tabs}</div>{children}</>;
  }
  return <RegisterTabsContext.Provider value={value}>{children}</RegisterTabsContext.Provider>;
}
