"use client";

import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskWorkList } from "./task-work-list";
import { WorkProfileNextSteps } from "./work-profile-hints";
import type { TaskListSource } from "./work-list-items";

/**
 * Mina arbetsordrar (2026-09-26): work orders as their own workflow. Since 2026-10-05 the same list as Mina
 * uppgifter and Mina projekt – rows or cards, Mina / Alla – limited to work orders.
 */
export function WorkOrderList({ canCreate, personId, canReadArea = true, local }: { canCreate: boolean; personId: string; canReadArea?: boolean; local?: { tasks: TaskListSource[] } }) {
  return <TaskWorkList list="work_orders" personId={personId} canCreate={canCreate} canReadArea={canReadArea} local={local}
    empty={<div className="rounded-xl border border-dashed bg-card/60 px-5 py-10 text-center">
      <ClipboardList className="mx-auto size-7 text-primary" aria-hidden="true" />
      <p className="mt-3 text-sm font-semibold">Inga arbetsordrar här ännu</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">Skapa en arbetsorder, med eller utan projekt. Sedan lägger du till uppgifterna i den.</p>
      {canCreate ? <Button asChild className="mt-4"><Link href="/?view=workflow_task&taskType=WORK_ORDER"><Plus />Ny arbetsorder</Link></Button> : null}
      <WorkProfileNextSteps here="work_orders" className="mt-5" center />
    </div>} />;
}
