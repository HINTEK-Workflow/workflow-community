"use client";
// Mina uppgifter / the Jobb tab (U1/T2, 2026-10-23): the list on its own, so the phone's Jobb tab draws without the code of
// Projekt and Planering (features/kfid/workflow-projects.tsx, loaded when one of those pages opens). The same list and the
// same rules as before; WorkflowProjects draws it too, for a Local file.
import Link from "next/link";
import { WorkProfileNextSteps } from "@/features/workflow/work-profile-hints";
import { ClipboardList, FolderKanban, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskWorkList } from "@/features/workflow/task-work-list";
import { workItemTypesOffered } from "@/lib/workflow/work-items";
import { defaultWorkflowPermissionProfile, hasWorkflowPermission, type WorkflowPermissionAction, type WorkflowPermissionProfile, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";

type LocalTasks = Parameters<typeof TaskWorkList>[0]["local"];

export function TasksPage({ personId = "", permissions, admin = false, local }: {
  personId?: string;
  permissions?: WorkflowPermissionProfile;
  admin?: boolean;
  /** Local: the open file's tasks; everything in a Local file is the owner's, and every right is the owner's. */
  local?: LocalTasks;
}) {
  const profile = permissions ?? defaultWorkflowPermissionProfile();
  const can = (subject: WorkflowPermissionSubject, action: WorkflowPermissionAction) => Boolean(local || admin || hasWorkflowPermission(profile, subject, action));
  const canCreateTask = (["kfid", "work-order", "risk-assessment"] as const).some((subject) => can(subject, "create"));
  const canReadTasks = (["kfid", "work-order", "risk-assessment", "forms"] as const).some((subject) => can(subject, "read"));
  // B3: the Jobb tab's Typ filter, for someone who may read work orders and some other kind.
  const types = workItemTypesOffered({ canReadWorkOrders: can("work-order", "read"), canReadOtherTasks: (["kfid", "risk-assessment", "forms"] as const).some((subject) => can(subject, "read")) });
  return <TaskWorkList list="tasks" personId={personId} canCreate={canCreateTask} canReadArea={canReadTasks} types={types} empty={<WorkspaceEmptyState kind="tasks" />} local={local} />;
}

export function WorkspaceEmptyState({ kind }: { kind: "projects" | "tasks" }) {
  const projects = kind === "projects";
  const steps = projects
    ? ["Skapa projektets grunduppgifter", "Lägg till nya eller befintliga uppgifter", "Följ status och progression"]
    : ["Välj arbetsorder, eller skapa en ny", "Välj uppgiftstyp", "Tiden räknas på arbetsordern"];
  return <section className="overflow-hidden rounded-2xl border bg-card shadow-xs">
    <div className="grid min-h-80 lg:grid-cols-[1.15fr_.85fr]">
      <div className="flex flex-col justify-center p-7 sm:p-10">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-secondary text-primary">{projects ? <FolderKanban className="size-6" /> : <ClipboardList className="size-6" />}</span>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[.16em] text-primary">Kom igång</p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight">{projects ? "Skapa ditt första projekt" : "Skapa din första uppgift"}</h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{projects ? "Ett projekt samlar arbetsordrar och projekttid. Arbetsordrar utan projekt går också bra." : "Skapa en uppgift och koppla den till en arbetsorder innan arbetet börjar."}</p>
        <div className="mt-6 flex flex-wrap gap-2"><Button asChild><Link href={projects ? "/?view=new_project" : "/?view=new_task"}><Plus />{projects ? "Skapa projekt" : "Skapa uppgift"}</Link></Button><Button asChild variant="outline"><Link href={projects ? "/?view=new_task" : "/?view=projects"}>{projects ? "Skapa uppgift" : "Visa projekt"}</Link></Button></div>
        <WorkProfileNextSteps here={projects ? "projects" : "work_orders"} className="mt-6" />
      </div>
      <div className="border-t bg-muted/35 p-7 sm:p-10 lg:border-l lg:border-t-0">
        <p className="text-sm font-semibold">Så fungerar det</p>
        <ol className="mt-5 space-y-4">{steps.map((step, index) => <li key={step} className="flex items-start gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-card text-xs font-semibold text-primary shadow-xs ring-1 ring-border">{index + 1}</span><span className="pt-1 text-sm leading-5 text-muted-foreground">{step}</span></li>)}</ol>
      </div>
    </div>
  </section>;
}
