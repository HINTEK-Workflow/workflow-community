"use client";

import { useMemo, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Boxes, Users } from "lucide-react";
import { PageHeader } from "@/components/page-shell";
import { useNativeMode } from "./use-detail-level";
import { RegisterTabsContext } from "@/features/kfid/customer-register-layout";
import { NativeSegmentedLinks } from "@/components/native/list";
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
    // The app's segmented control, full width like Mina | Alla on Jobb (mobil 2026-11-17; before a narrow box of pills).
    const tabs = <NativeSegmentedLinks label="Kundregister" testId="customer-register-switch" options={[
      { href: "/?view=customers", label: "Kunder", icon: Users, current: !objects },
      { href: "/?view=customers&show=objects", label: "Alla objekt", icon: Boxes, current: objects, testId: "customer-register-objects" },
    ]} />;
    if (objects) return <div>
      <PageHeader title="Alla objekt" description="Kundernas anläggningar och objekt, med öppna arbetsordrar." />
      <div className="mb-3">{tabs}</div>
      {register}
    </div>;
    return <><div className="mb-3">{tabs}</div>{children}</>;
  }
  return <RegisterTabsContext.Provider value={value}>{children}</RegisterTabsContext.Provider>;
}
