"use client";

import { useSubPageHref } from "@/features/kfid/use-return-to";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Clock3, FolderKanban, Repeat, RotateCw, Undo2, ClipboardList, ArrowRightCircle, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/features/kfid/api";
import { Panel } from "@/features/kfid/ui";
import { NativeActions } from "@/components/native/list";
import { useNativeMode } from "@/features/workflow/use-detail-level";

export type LinkedTask = { id: string; title: string; status: string; kind: string; dueDate: string };
type Minimal = { id: string; title: string; status: string; kind: string; dueDate: string; projectId: string | null };

export const taskHref = (task: { id: string; kind: string }) => `/?view=workflow_task&taskId=${encodeURIComponent(task.id)}&taskType=${task.kind}`;

/** The open task of a project that is due first; tasks without a date come after the dated ones. */
export function nextProjectTask<T extends Minimal>(tasks: T[], projectId: string, exclude: string) {
  const open = tasks.filter((item) => item.projectId === projectId && item.id !== exclude && item.status !== "COMPLETED" && item.status !== "CANCELLED");
  return { next: [...open].sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"))[0] ?? null, open: open.length };
}

/**
 * Nästa steg (2026-09-30, the guided flow): when a task is completed the person is not left to search – the
 * card offers the project's next open task, the way back to the project or to the protocol a work order came from,
 * a follow-up work order for what the task found, and the reported time. Rule-based and read within the person's permissions;
 * Local reads its own file.
 */
export function NextSteps({ task, projectName, source, localTasks, onCreateWorkOrder, onRepeat, lead }: {
  task: { id: string; kind: string; projectId: string | null };
  projectName?: string;
  /** The task a work order was made from, and the row, point or field in it (2026-10-06: the finished order leads back there). */
  source?: { taskId: string; title: string; rowId?: string } | null;
  localTasks?: Minimal[];
  /** A follow-up work order with the task's project, customer and facility (not offered on a work order itself). */
  onCreateWorkOrder?: () => void;
  /** "Upprepa kontrollen" (2026-10-06): plan the same control again as a round; offered only to those who may plan rounds. */
  onRepeat?: () => void;
  /** The first step, given by the page: Fakturaunderlag on a finished work order for those who may make one (2026-11-06). */
  lead?: ReactNode;
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
  const done = "Uppgiften är färdigställd.";
  // A long task or project name is cut with an ellipsis inside the button, never wider than the screen (2026-10-07: the
  // page scrolled sideways on a phone).
  const fit = "min-w-0 max-w-full";
  const native = useNativeMode();
  // Se tiden comes back to the job (samband, 2026-10-26).
  const subPage = useSubPageHref();
  // A finished task has no current step left, so at display level 1–2 every panel would be folded; this one is where the
  // work continues and is never folded away.
  const buttons = <>
      {lead}
      {next?.next ? <Button asChild variant={lead ? "outline" : "default"} className={fit}><Link href={taskHref(next.next)} title={`Nästa uppgift: ${next.next.title}`} data-testid="next-step-task"><span className="truncate">Nästa uppgift: {next.next.title}</span></Link></Button> : null}
      {origin ? <Button asChild variant={next?.next ? "outline" : "default"} className={fit}><Link href={`${taskHref(origin)}${source?.rowId ? `&row=${encodeURIComponent(source.rowId)}` : ""}`} title={origin.title} data-testid="next-step-source">{source?.rowId ? <><RotateCw /><span className="truncate">Följ upp raden i {origin.title}</span></> : <><Undo2 /><span className="truncate">Tillbaka till {origin.title}</span></>}</Link></Button> : null}
      {onCreateWorkOrder ? <Button type="button" variant="outline" onClick={onCreateWorkOrder} data-testid="next-step-work-order"><ClipboardList />Skapa uppföljande arbetsorder</Button> : null}
      {onRepeat ? <Button type="button" variant="outline" onClick={onRepeat} data-testid="next-step-repeat"><Repeat />Upprepa kontrollen</Button> : null}
      {projectHref ? <Button asChild variant="outline" className={fit}><Link href={projectHref} title={projectName || undefined} data-testid="next-step-project"><FolderKanban /><span className="truncate">Till projektet{projectName ? ` ${projectName}` : ""}</span></Link></Button>
        : task.kind === "WORK_ORDER" ? <Button asChild variant="outline"><Link href="/?view=work_orders" data-testid="next-step-list"><ClipboardList />Arbetsordrar</Link></Button>
        : <Button asChild variant="outline"><Link href="/?view=tasks" data-testid="next-step-list"><ClipboardCheck />Uppgifter</Link></Button>}
      <Button asChild variant="outline"><Link href={subPage(`/?view=time&timeTaskId=${encodeURIComponent(task.id)}`)}><Clock3 />Se tiden</Link></Button>
  </>;
  const projectDone = task.projectId && next && !next.next ? "Alla uppgifter i projektet är färdigställda. Projektet kan avslutas från projektsidan." : "";
  // Nivå 1 på mobil (2026-10-10): the same buttons as rows of one group under the job's title, not a desktop card.
  if (native) return <NativeActions title="Nästa steg" testId="next-steps" footer={[done, projectDone].filter(Boolean).join(" ")}>{buttons}</NativeActions>;
  return <Panel icon={ArrowRightCircle} title="Nästa steg" description={`${done} Här fortsätter arbetet.`} className="next-steps-panel" keepOpen>
    <div className="flex flex-wrap gap-2" data-testid="next-steps">{buttons}</div>
    {projectDone ? <p className="mt-3 text-sm text-muted-foreground" data-testid="next-step-project-done">{projectDone}</p> : null}
  </Panel>;
}
