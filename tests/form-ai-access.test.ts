import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Formulär med Workflow AI för alla som får redigera formulär (2026-11-26): the AI follows the forms route's own rule
// (mayBuildForms in lib/kfid/form-server.ts) everywhere – the status the builder and the chat read, the chat's form mode, the
// proposal tool and Skapa utkast / Ångra – and has no admin check of its own.

const read = (file: string) => readFileSync(file, "utf8");

test("the forms route and the form AI share one rule: mayBuildForms", () => {
  const server = read("lib/kfid/form-server.ts");
  assert.match(server, /export const mayBuildForms = /);
  const require = server.slice(server.indexOf("export function requireFormAdmin"), server.indexOf("export function hintekFormsAllowed"));
  assert.match(require, /if \(mayBuildForms\(ctx\)\)/, "requireFormAdmin is mayBuildForms");
  for (const route of ["app/api/forms/admin/route.ts", "app/api/forms/admin/preview/route.ts"]) assert.match(read(route), /requireFormAdmin\(ctx\)/, route);
});

test("ai/status offers the form AI by the forms rule, not by an admin check of its own", () => {
  const status = read("lib/api-handlers/ai-status.ts");
  const line = status.split("\n").find((row) => row.trim().startsWith("formAi:")) ?? "";
  assert.match(line, /mayBuildForms\(ctx\)/);
  assert.doesNotMatch(line, /ctx\.admin|storageMode/, "no rule of its own beside the forms route's");
});

test("the server checks the forms rule again in the chat, the proposal tool, Skapa utkast and Ångra", () => {
  const chat = read("lib/api-handlers/ai-chat.ts");
  const start = chat.indexOf("const form = !(\"messageId\" in input)");
  const formMode = chat.slice(start, chat.indexOf("// Bilder (2026-11-21)", start));
  assert.ok(formMode.length > 50, "the chat's form-mode check is found");
  assert.match(formMode, /requireFormAdmin\(ctx\)/, "the chat's form mode");
  assert.doesNotMatch(formMode, /ctx\.admin/);
  const ai = read("lib/ai/form-ai-server.ts");
  for (const name of ["function createFormProposer", "export async function applyFormDraft", "export async function undoFormDraft"]) {
    const body = ai.slice(ai.indexOf(name), ai.indexOf("\n}\n", ai.indexOf(name)));
    assert.match(body, /requireFormAdmin\(ctx\)/, name);
    assert.doesNotMatch(body, /ctx\.admin/, name);
  }
});

test("the builder's menu item and the form AI's status use the same rule", () => {
  // Skapa formulär in the menu (app/page.tsx): an owner or admin, or an employee with Bygga formulär (2026-11-26), in Workflow
  // Cloud – the same function as mayBuildForms (ctx.admin is OWNER or ADMIN, lib/kfid/server.ts).
  assert.match(read("app/page.tsx"), /canBuildForms: mayBuildFormsWith\(\{ admin: activeMemberRole === "OWNER" \|\| activeMemberRole === "ADMIN", workflowPermissions: normalizeWorkflowPermissionProfile\(activeMembership\?\.workflowPermissions\), cloud: user\.activeOrganization\?\.storageMode === "HINTEK_CLOUD" \}\)/);
  assert.match(read("lib/kfid/server.ts"), /admin: membership\.role === "OWNER" \|\| membership\.role === "ADMIN"/);
  assert.match(read("lib/kfid/form-server.ts"), /mayBuildFormsWith\(\{ admin: ctx\.admin, workflowPermissions: ctx\.workflowPermissions, cloud: ctx\.organization\.storageMode === "HINTEK_CLOUD" \}\)/);
});
