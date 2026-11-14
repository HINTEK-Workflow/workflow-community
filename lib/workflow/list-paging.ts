// Bounded list reads (quality check 2026-10-05): every list endpoint reads one page, never the whole organization.
// `limit` falls back to the default and is capped at the maximum; `page` is 1-based and capped so that a request can
// never skip an unbounded number of rows.

export type ListPaging = { page: number; limit: number };

export function listPaging(params: URLSearchParams, options: { defaultLimit: number; maxLimit: number; maxPage?: number }): ListPaging {
  const whole = (raw: string | null) => {
    const value = Number(raw);
    return raw !== null && raw.trim() !== "" && Number.isInteger(value) && value > 0 ? value : null;
  };
  const limit = Math.min(options.maxLimit, whole(params.get("limit")) ?? options.defaultLimit);
  const page = Math.min(options.maxPage ?? 1000, whole(params.get("page")) ?? 1);
  return { page, limit };
}

export const TASK_LIST_DEFAULT_LIMIT = 25;
export const TASK_LIST_MAX_LIMIT = 100;

/** The page of `GET /api/workflow-tasks` without an id. */
export const taskListPaging = (params: URLSearchParams) => listPaging(params, { defaultLimit: TASK_LIST_DEFAULT_LIMIT, maxLimit: TASK_LIST_MAX_LIMIT });
