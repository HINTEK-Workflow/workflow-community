import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// Importen (2026-11-25): a plain attachment is saved at once from the analysis, so the payment check of every other write must come
// before anything is stored – a paused or unpaid Cloud company saves no new private file. Community and Local are not touched:
// requireCloudWriteAccess only asks Cloud.
const source = readFileSync(path.join(__dirname, "..", "lib", "api-handlers", "import.ts"), "utf8");
const saveFile = source.slice(source.indexOf("async function saveFile("), source.indexOf("const TOOL_OF"));

test("saveFile checks Cloud write access before it counts, stores or creates anything", () => {
  const check = saveFile.indexOf("await requireCloudWriteAccess(ctx)");
  assert.ok(check > 0, "the payment check is in saveFile");
  for (const step of ["prisma.importedFile.count", "prepareAttachmentFile(file)", "await store(", "prisma.importedFile.create"])
    assert.ok(check < saveFile.indexOf(step), `the check comes before ${step}`);
  // A refusal becomes the file's own message; the analysis of the other files still answers.
  assert.match(saveFile, /catch \(error\) \{ if \(error instanceof ApiError\) return \{ saved: null, saveError: error\.message \}; throw error; \}/);
});

test("the analysis saves attachments only through saveFile, and attach keeps its own check", () => {
  const analyze = source.slice(source.indexOf("async function analyze("), source.indexOf("export async function GET"));
  assert.match(analyze, /await saveFile\(ctx, file\)/);
  assert.equal(/importedFile\.create|await store\(/.test(analyze), false, "nothing is stored past saveFile");
  const attach = source.slice(source.indexOf('if (input.action === "attach")'));
  assert.ok(attach.indexOf("await requireCloudWriteAccess(ctx)") < attach.indexOf("prisma.importedFile.findFirst"));
});

test("the check itself lets Community and Local through and only asks Cloud", () => {
  const server = readFileSync(path.join(__dirname, "..", "lib", "kfid", "server.ts"), "utf8");
  const fn = server.slice(server.indexOf("export async function requireCloudWriteAccess"), server.indexOf("export async function requireCloudWriteAccess") + 400);
  assert.match(fn, /if \(ctx\.organization\.storageMode !== "HINTEK_CLOUD"\) return;/);
});
