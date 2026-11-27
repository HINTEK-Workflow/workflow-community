/**
 * The seam between Planering / the portfolio (plan 1M, part e) and the job level (part f). Now merged: the job
 * functions are re-exported from lib/workflow/obstacles.ts and lib/workflow/job-planning.ts, so the portfolio, the
 * multi-project Gantt and the project's Tidplan read the same obstacle and Start rules.
 */
export { jobObstacle, type Obstacle as JobObstacle } from "./obstacles";
export { effectiveStartDate } from "./job-planning";

/** What the server selects on a job besides its plain fields so that jobObstacle can answer (status is already selected). */
export const OBSTACLE_TASK_SELECT = { data: true, updatedAt: true } as const;
