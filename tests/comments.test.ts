import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { COMMENT_BODY_MAX, COMMENT_NOTICE_MAX_RECIPIENTS, commentActionSchema, commentFollowKey, commentNoticeKey, commentNotifications, commentParentHref, commentParentOf, commentParentWhere, commentRecipients, commentToastText, mentionedPeople, parseCommentNoticeKey } from "../lib/comments/model";
import { commentsToRestore } from "../lib/comments/model";
import { createLocalWorkspace, parseLocalWorkspace } from "../features/kfid/local-workspace-store";
import { createWorkflowPdfReport, defaultWorkflowReportOptions, type WorkflowReportTask } from "../lib/workflow/report";
import { pdfText } from "../lib/import/pdf-text";

// Kommentarer (beslut 14, 2026-11-01): one thread per work order, project and deviation; internal unless chosen for the customer's
// report; @namn gives a notice; a person can follow. Database and tenant checks: tests/comments.integration.ts.
const people = [{ id: "a", name: "Anna Andersson" }, { id: "b", name: "Bo" }, { id: "c", name: "Bo Ek" }, { id: "x", name: "" }];

test("@namn: the whole name, any case, not part of a longer word", () => {
  const ids = (body: string) => mentionedPeople(body, people).map((person) => person.id);
  assert.deepEqual(ids("Kan @Anna Andersson titta?"), ["a"]);
  assert.deepEqual(ids("@anna andersson, ring"), ["a"]);
  assert.deepEqual(ids("@Anna"), [], "half a name is nobody");
  assert.deepEqual(ids("Skriv till anna andersson"), [], "without @ nobody is told");
  assert.deepEqual(ids("@Bosse"), [], "another word");
  assert.deepEqual(ids("@Bo och @Bo Ek"), ["b", "c"]);
  assert.deepEqual(ids("@"), []);
});

test("who is told: mentioned and followers, each once, never the author, bounded", () => {
  assert.deepEqual(commentRecipients({ authorId: "me", mentioned: ["a", "me"], followers: ["a", "b", "me", "b"] }), [{ userId: "a", reason: "MENTION" }, { userId: "b", reason: "FOLLOW" }]);
  assert.equal(commentRecipients({ authorId: "me", mentioned: [], followers: Array.from({ length: COMMENT_NOTICE_MAX_RECIPIENTS + 5 }, (_, index) => `u${index}`) }).length, COMMENT_NOTICE_MAX_RECIPIENTS);
});

test("input: a comment needs text within the limit, internal unless chosen, only the three parents", () => {
  const add = { action: "add", parentType: "WORK_ORDER", parentId: "t1", body: " Hej " };
  assert.deepEqual(commentActionSchema.parse(add), { ...add, body: "Hej", inCustomerReport: false });
  assert.equal(commentActionSchema.safeParse({ ...add, body: "   " }).success, false);
  assert.equal(commentActionSchema.safeParse({ ...add, body: "x".repeat(COMMENT_BODY_MAX + 1) }).success, false);
  assert.equal(commentActionSchema.safeParse({ ...add, parentType: "FORM" }).success, false);
  assert.equal(commentActionSchema.safeParse({ action: "add", parentType: "PROJECT", parentId: "", body: "x" }).success, false);
  assert.equal(commentActionSchema.safeParse({ action: "delete_all" }).success, false);
});

test("the re-import: only a thread whose parent had to be created comes back, within the rows just created", () => {
  const row = { authorName: "Anna", body: "Hej", inCustomerReport: true, createdAt: "2026-11-01T08:00:00.000Z" };
  const created = { workOrders: new Map([["file-order", "cloud-order"]]), projects: new Map([["file-project", "cloud-project"]]), deviations: new Map([["file-deviation", "cloud-deviation"]]) };
  const rows = commentsToRestore([
    { ...row, parentType: "WORK_ORDER", parentId: "file-order" },
    { ...row, parentType: "PROJECT", parentId: "file-project" },
    { ...row, parentType: "DEVIATION", parentId: "file-deviation" },
    { ...row, parentType: "WORK_ORDER", parentId: "still-in-cloud" },
    { ...row, parentType: "WORK_ORDER", parentId: "file-project" },
  ], created);
  assert.deepEqual(rows.map((item) => [("workflowTaskId" in item && item.workflowTaskId) || ("projectId" in item && item.projectId) || ("deviationId" in item && item.deviationId)]), [["cloud-order"], ["cloud-project"], ["cloud-deviation"]]);
  assert.equal(rows.every((item) => item.authorUserId === null && item.authorName === "Anna" && item.inCustomerReport), true, "the author stays as a name");
  assert.equal(rows[0].createdAt.toISOString(), row.createdAt);
});

test("an older file opens without threads, and Local keeps the threads of a file it opens", () => {
  const empty = createLocalWorkspace({ id: "org-1", name: "Bolaget" });
  assert.deepEqual(empty.comments, []);
  const { comments: _none, ...older } = empty;
  void _none;
  assert.deepEqual(parseLocalWorkspace(older, "org-1").comments, []);
  const thread = [{ id: "c1", parentType: "PROJECT" as const, parentId: "p1", authorName: "Anna", body: "Klart", inCustomerReport: false, createdAt: "2026-11-01T08:00:00.000Z" }];
  assert.deepEqual(parseLocalWorkspace({ ...empty, comments: thread }, "org-1").comments, thread);
});

test("an archived project is read-only for a thread on the server too: add, the customer choice and remove; following and seen are the person's own", () => {
  const source = readFileSync("lib/comments/server.ts", "utf8");
  assert.equal(source.match(/assertNotArchived\(parent\);/g)?.length, 3);
  assert.match(source, /project: \{ select: \{ archivedAt: true \} \}/, "a work order follows its project");
  assert.match(readFileSync("features/workflow/workflow-task-editor.tsx", "utf8"), /<CommentThread parentType="WORK_ORDER" parentId=\{task\.id\} disabled=\{Boolean\(selectedProject\?\.archivedAt\)\} \/>/);
});

test("keys and parents", () => {
  assert.deepEqual(parseCommentNoticeKey(commentNoticeKey("c1", "MENTION")), { commentId: "c1", reason: "MENTION" });
  assert.equal(parseCommentNoticeKey("COMMENT:c1|OTHER"), null);
  assert.equal(parseCommentNoticeKey("COMMENT:c1|FOLLOW|x"), null);
  assert.equal(parseCommentNoticeKey("TEAM:x"), null);
  assert.equal(commentFollowKey({ type: "PROJECT", id: "p1" }), "FOLLOW:PROJECT:p1");
  assert.deepEqual(commentParentWhere({ type: "DEVIATION", id: "d1" }), { deviationId: "d1" });
  assert.deepEqual(commentParentOf({ workflowTaskId: null, projectId: "p1", deviationId: null }), { type: "PROJECT", id: "p1" });
  assert.equal(commentParentOf({ workflowTaskId: null, projectId: null, deviationId: null }), null);
  assert.equal(commentParentHref({ type: "WORK_ORDER", id: "t 1" }), "/?view=workflow_task&taskId=t%201&taskType=WORK_ORDER");
  assert.equal(commentParentHref({ type: "DEVIATION", id: "d1" }), "/?view=deviations&deviation=d1");
});

test("the bell's items: a comment that is gone is not shown; a mention says so; newest first", () => {
  const comment = (id: string, at: string) => ({ id, body: "Se\növer  kabeln", authorName: "Anna (kontor)", createdAt: new Date(at), parent: { type: "WORK_ORDER" as const, id: "t1" }, parentTitle: "Byt central" });
  const items = commentNotifications([
    { key: commentNoticeKey("c1", "FOLLOW"), read: false, comment: comment("c1", "2026-11-01T08:00:00.000Z") },
    { key: commentNoticeKey("c2", "MENTION"), read: true, comment: comment("c2", "2026-11-01T09:00:00.000Z") },
    { key: commentNoticeKey("c3", "MENTION"), read: false, comment: null },
    { key: commentNoticeKey("c4", "MENTION"), read: false, comment: comment("other", "2026-11-01T09:00:00.000Z") },
  ]);
  assert.deepEqual(items.map((item) => item.id), ["COMMENT:c2", "COMMENT:c1"]);
  assert.equal(items[0].label, "Nämnde dig");
  assert.equal(items[0].read, true);
  assert.equal(items[1].label, "Ny kommentar");
  assert.equal(items[1].read, undefined);
  assert.equal(items[1].detail, "Anna kontor: Se över kabeln");
  assert.equal(items[1].href, "/?view=workflow_task&taskId=t1&taskType=WORK_ORDER");
  assert.match(commentToastText(items[0]), /nämnde dig på Byt central/);
});

const order = (extra: Partial<WorkflowReportTask> = {}): WorkflowReportTask => ({
  id: "t1", kind: "WORK_ORDER", version: 1, title: "Byt central", description: "", status: "COMPLETED", dueDate: "", projectName: "", customerName: "", assignedToName: "", totalDurationSec: 0, updatedAt: "2026-11-01T08:00:00.000Z", attachments: [],
  data: { kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" } }, ...extra,
} as unknown as WorkflowReportTask);

test("the shared report kit prints the comments it is given, and a report without any is unchanged", async () => {
  const fontBytes = new Uint8Array(readFileSync("public/fonts/DejaVuSans.ttf"));
  const text = async (task: WorkflowReportTask, projectComments?: { authorName: string; body: string; createdAt: string }[]) =>
    (pdfText(Buffer.from(await createWorkflowPdfReport({ company: "QA", fontBytes, options: defaultWorkflowReportOptions, tasks: [task], ...(projectComments ? { projectName: "Projekt A", projectComments } : {}) }))) ?? "").replace(/\s+/g, " ");
  const chosen = await text(order({ customerComments: [{ authorName: "Anna Andersson", body: "Kunden har fått nycklarna tillbaka.", createdAt: "2026-11-01T08:00:00.000Z" }] }));
  assert.match(chosen, /Kommentarer/);
  assert.match(chosen, /Kunden har fått nycklarna tillbaka\./);
  assert.match(chosen, /Anna Andersson/);
  assert.doesNotMatch(await text(order()), /Kommentarer/);
  assert.match(await text(order(), [{ authorName: "Bo", body: "Projektets slutsyn klar.", createdAt: "2026-11-01T08:00:00.000Z" }]), /Projektets slutsyn klar\./);
});

test("only comments chosen for the customer reach a report: every way out reads through one function", () => {
  const server = readFileSync("lib/comments/server.ts", "utf8");
  const reader = server.slice(server.indexOf("export async function customerComments"));
  assert.match(reader, /organizationId, \.\.\.commentParentWhere\(ref\), inCustomerReport: true/);
  for (const file of ["lib/workflow/report-server.ts", "app/api/projects/[id]/report/route.ts", "lib/self-inspection/deviation-export-server.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /customerComments\(/, file);
    assert.doesNotMatch(source, /prisma\.comment\./, `${file} must not read comments on its own`);
  }
});

test("the route: session, company, Cloud and Origin on every write; the parent's read right on every path", () => {
  const route = readFileSync("app/api/comments/route.ts", "utf8");
  const post = route.slice(route.indexOf("export async function POST"));
  assert.ok(post.indexOf("checkOrigin(request)") >= 0 && post.indexOf("checkOrigin(request)") < post.indexOf("context()"));
  assert.match(post, /requireCloudStorage\(ctx\)/);
  assert.match(post, /requireCloudWriteAccess\(ctx\)/);
  assert.match(route.slice(0, route.indexOf("export async function POST")), /requireCloudStorage\(ctx\)/);
  const server = readFileSync("lib/comments/server.ts", "utf8");
  // Every read or write of a thread goes through resolveParent first.
  const thread = server.slice(server.indexOf("export async function loadThread"), server.indexOf("async function loadCommentAndParent"));
  assert.ok(thread.indexOf("resolveParent(ctx, ref)") < thread.indexOf("prisma.comment.findMany"));
  const actions = server.slice(server.indexOf("export async function applyCommentAction"), server.indexOf("export async function loadCommentNotifications"));
  assert.match(actions, /await resolveParent\(ctx, ref\);\n {2}if \(input\.action === "follow"\)/);
  assert.equal((actions.match(/loadCommentAndParent\(ctx, input\.id\)/g) ?? []).length, 2, "set_customer and remove");
  // No id or company from the request ever chooses the author or the company.
  assert.doesNotMatch(server, /input\.organizationId|input\.authorUserId|input\.userId/);
});

test("Local has no thread and Community needs nothing of its own: the page leaves it out, and it lives outside ee/", () => {
  assert.match(readFileSync("features/workflow/workflow-task-editor.tsx", "utf8"), /task\.kind === "WORK_ORDER" && !local && !preview \? <CommentThread/);
  assert.match(readFileSync("features/kfid/workflow-projects.tsx", "utf8"), /!local \? <CommentThread/);
  assert.match(readFileSync("features/self-inspection/deviations.tsx", "utf8"), /comments \? <div[^>]*><CommentThread/);
  assert.match(readFileSync("features/self-inspection/self-inspection-page.tsx", "utf8"), /comments: true/);
  for (const file of ["lib/comments/model.ts", "lib/comments/server.ts", "app/api/comments/route.ts", "features/workflow/comment-thread.tsx"]) assert.doesNotMatch(readFileSync(file, "utf8"), /from "@\/ee\//, file);
});
