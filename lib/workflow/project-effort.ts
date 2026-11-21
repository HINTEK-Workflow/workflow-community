import { projectCompletion } from "./project-progress";
import { tasksForProgress } from "./task-cancel";

/**
 * Projektets tre tal (projektförslaget 2026-10-09, 6.2 och steg 2): Uppskattat (the jobs' Uppskattad tid), Bokat (the
 * staff's bookings on the jobs) and Rapporterat (reported time) – three times that are never mixed – with the weighted
 * completion and "x av y jobb färdigställda". Pure, shared by Cloud, Local and the demo; Utgått jobs are left out.
 */
export type EffortJob = { id: string; status: string; progress?: number; estimatedMinutes?: number | null; totalDurationSec?: number };

export type ProjectEffort = {
  estimatedMinutes: number;
  bookedMinutes: number;
  reportedMinutes: number;
  /** Of Rapporterat, the project's own time without a work order (Projekttid, 2026-10-26). */
  projectReportedMinutes: number;
  /** Uppskattat that no booking covers yet ("8 h är inte bokade"); 0 when booked covers it or nothing is estimated. */
  unbookedMinutes: number;
  /** Jobs with an estimate, of the counted jobs. */
  estimatedJobs: number;
  jobs: number;
  completedJobs: number;
  /** The project's completion, weighted by Uppskattad tid when at least one job has it (projectCompletion). */
  completion: number;
  weighted: boolean;
};

/** `projectSeconds`: the project's own time (Projekttid), summed into Rapporterat beside its work orders' time. */
export function projectEffort(all: readonly EffortJob[], bookedMinutesByTask: ReadonlyMap<string, number>, { projectSeconds = 0 }: { projectSeconds?: number } = {}): ProjectEffort {
  const jobs = tasksForProgress(all);
  const estimatedJobs = jobs.filter((job) => typeof job.estimatedMinutes === "number");
  const estimatedMinutes = estimatedJobs.reduce((sum, job) => sum + (job.estimatedMinutes ?? 0), 0);
  const bookedMinutes = jobs.reduce((sum, job) => sum + (bookedMinutesByTask.get(job.id) ?? 0), 0);
  const ownSeconds = Math.max(0, projectSeconds);
  const reportedMinutes = Math.round((jobs.reduce((sum, job) => sum + (job.totalDurationSec ?? 0), 0) + ownSeconds) / 60);
  return {
    estimatedMinutes, bookedMinutes, reportedMinutes, projectReportedMinutes: Math.round(ownSeconds / 60),
    unbookedMinutes: Math.max(0, estimatedMinutes - bookedMinutes),
    estimatedJobs: estimatedJobs.length,
    jobs: jobs.length,
    completedJobs: jobs.filter((job) => job.status === "COMPLETED").length,
    completion: projectCompletion(jobs.map((job) => ({ status: job.status, progress: job.progress ?? 0, estimatedMinutes: job.estimatedMinutes }))),
    weighted: jobs.some((job) => typeof job.estimatedMinutes === "number" && job.estimatedMinutes > 0),
  };
}

/** Hours as the project page writes them: "16 h", "1,5 h", "0 h". */
export const effortHours = (minutes: number) => `${String(Math.round((minutes / 60) * 10) / 10).replace(".", ",")} h`;

/** The project's row: "Uppskattat 16 h · Bokat 16 h · Rapporterat 5 h" ("Uppskattat –" without estimates). */
export function effortLine(effort: Pick<ProjectEffort, "estimatedMinutes" | "bookedMinutes" | "reportedMinutes" | "estimatedJobs">) {
  return `Uppskattat ${effort.estimatedJobs ? effortHours(effort.estimatedMinutes) : "–"} · Bokat ${effortHours(effort.bookedMinutes)} · Rapporterat ${effortHours(effort.reportedMinutes)}`;
}

/** The soft warning when less is booked than estimated: "8 h är inte bokade"; "" otherwise. */
export const unbookedText = (effort: Pick<ProjectEffort, "unbookedMinutes">) => effort.unbookedMinutes > 0 ? `${effortHours(effort.unbookedMinutes)} är inte bokade` : "";
