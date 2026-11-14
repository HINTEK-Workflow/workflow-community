import assert from "node:assert/strict";
import test from "node:test";
import { listPaging, TASK_LIST_DEFAULT_LIMIT, TASK_LIST_MAX_LIMIT, taskListPaging } from "../lib/workflow/list-paging";
import { NOTIFICATION_MAX, NOTIFICATION_PAGE, notificationLimit } from "../lib/workflow/task-notifications";

// Quality check 2026-10-05, F3 and F4: list reads are bounded whatever the caller asks for.
test("task list paging: a default page, a cap on the size and a 1-based page", () => {
  assert.deepEqual(taskListPaging(new URLSearchParams()), { page: 1, limit: TASK_LIST_DEFAULT_LIMIT });
  assert.deepEqual(taskListPaging(new URLSearchParams({ limit: "100000", page: "3" })), { page: 3, limit: TASK_LIST_MAX_LIMIT });
  for (const bad of ["0", "-5", "2.5", "abc", " "]) assert.deepEqual(taskListPaging(new URLSearchParams({ limit: bad, page: bad })), { page: 1, limit: TASK_LIST_DEFAULT_LIMIT }, bad);
  assert.equal(listPaging(new URLSearchParams({ page: "999999" }), { defaultLimit: 10, maxLimit: 20, maxPage: 50 }).page, 50);
});

test("notification limit: the bell's page by default, never more than the maximum", () => {
  assert.equal(notificationLimit(null), NOTIFICATION_PAGE);
  assert.equal(notificationLimit("120"), 120);
  assert.equal(notificationLimit("99999"), NOTIFICATION_MAX);
  assert.equal(notificationLimit("-1"), NOTIFICATION_PAGE);
  assert.equal(notificationLimit("x"), NOTIFICATION_PAGE);
});
