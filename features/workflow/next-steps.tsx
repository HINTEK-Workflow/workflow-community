"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Clock3, FolderKanban, ListChecks, Undo2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/features/kfid/api";
import { Panel } from "@/features/kfid/ui";

export type LinkedTask = { id: string; title: string; status: string; kind: string; dueDate: string };
type Minimal = { id: string; title: string; status: string; kind: string; dueDate: string; projectId: string | null };

export const taskHref = (task: { id: string; kind: string }) => `/?view=workflow_task&taskId=${encodeURIComponent(task.id)}&taskType=${task.kind}`;

/** The open task of a project that is due first; tasks without a date come after the dated ones. */
export function nextProjectTask<T extends Minimal>(tasks: T[], projectId: string, exclude: string) {
  const open = tasks.filter((item) => item.projectId === projectId && item.id !== exclude && item.status !== "COMPLETED");
  return { next: [...open].sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"))[0] ?? null, open: open.length };
}

/**
 * Nästa steg (Daniel 2026-09-30, the guided flow): when a task is completed the person is not left to search – the
 * card offers the project's next open task, the way back to the project or to the protocol a work order came from,
 * a follow-up work order for what the task found, and the reported time. Rule-based and read within the person's permissions;
 * Local reads its own file.
 */
export function NextSteps({ task, projectName, source, localTasks, onCreateWorkOrder }: {
  task: { id: string; kind: string; projectId: string | null };
  projectName?: string;
  /** The task a work order was made from. */
  source?: { taskId: string; title: string } | null;
  localTasks?: Minimal[];
  /** A follow-up work order with the task's project, customer and facility (not offered on a work order itself). */
  onCreateWorkOrder?: () => void;
}) {
  // Local reads its own file; Cloud asks the server, and a reply only counts for the task it was asked for.
  const nextKey = !localTasks && task.projectId ? `${task.projectId}:${task.id}` : "";
  const originKey = !localTasks && source?.taskId ? source.taskId : "";
  const [remoteNext, setRemoteNext] = useState<{ key: string; value: { next: LinkedTask | null; open: number } } | null>(null);
  const [remoteOrigin, setRemoteOrigin] = useState<{ key: string; value: LinkedTask | null } | null>(null);
  useEffect(() => {
    if (!nextKey || !task.projectId) return;
    let active = true;
    api<{ next: LinkedTask | null; open: number }>(`/api/workflow-tasks?projectNext=${encodeURIComponent(task.projectId)}&exclude=${encodeURIComponent(task.id)}`)
      .then((result) => { if (active) setRemoteNext({ key: nextKey, value: result }); }).catch(() => undefined);
    return () => { active = false; };
  }, [nextKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!originKey) return;
    let active = true;
    api<{ links: LinkedTask[] }>(`/api/workflow-tasks?links=${encodeURIComponent(originKey)}`)
      .then((result) => { if (active) setRemoteOrigin({ key: originKey, value: result.links[0] ?? null }); }).catch(() => undefined);
    return () => { active = false; };
  }, [originKey]);
  const localNext = useMemo(() => localTasks && task.projectId ? nextProjectTask(localTasks, task.projectId, task.id) : null, [localTasks, task.projectId, task.id]);
  const next = localTasks ? localNext : remoteNext?.key === nextKey ? remoteNext.value : null;
  const origin = localTasks ? (source?.taskId ? localTasks.find((item) => item.id === source.taskId) ?? null : null) : remoteOrigin?.key === originKey ? remoteOrigin.value : null;
  const projectHref = task.projectId ? `/?view=project&projectId=${encodeURIComponent(task.projectId)}` : "";
  const done = task.kind === "COMMISSIONING_CONTROL" ? "Kontrollen är färdigställd." : "Uppgiften är slutförd.";
  return <Panel title="Nästa steg" description={`${done} Här fortsätter arbetet.`} className="next-steps-panel">
    <div className="flex flex-wrap gap-2" data-testid="next-steps">
      {next?.next ? <Button asChild><Link href={taskHref(next.next)} data-testid="next-step-task"><ArrowRight />Nästa uppgift: {next.next.title}</Link></Button> : null}
      {origin ? <Button asChild variant={next?.next ? "outline" : "default"}><Link href={taskHref(origin)} data-testid="next-step-source"><Undo2 />Tillbaka till {origin.title}</Link></Button> : null}
      {onCreateWorkOrder ? <Button type="button" variant="outline" onClick={onCreateWorkOrder} data-testid="next-step-work-order"><Wrench />Skapa uppföljande arbetsorder</Button> : null}
      {projectHref ? <Button asChild variant="outline"><Link href={projectHref} data-testid="next-step-project"><FolderKanban />Till projektet{projectName ? ` ${projectName}` : ""}</Link></Button>
        : <Button asChild variant="outline"><Link href="/?view=tasks"><ListChecks />Mina uppgifter</Link></Button>}
      <Button asChild variant="outline"><Link href={`/?view=time&timeTaskId=${encodeURIComponent(task.id)}`}><Clock3 />Se tiden</Link></Button>
    </div>
    {task.projectId && next && !next.next ? <p className="mt-3 text-sm text-muted-foreground" data-testid="next-step-project-done">Alla uppgifter i projektet är slutförda. Projektet kan avslutas från projektsidan.</p> : null}
  </Panel>;
}
