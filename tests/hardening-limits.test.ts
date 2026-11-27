// Granskningen 2026-11-24, P7: the MCP batch ceiling (G-23), the Excel zip-bomb guard (G-23) and the fixed retention time
// for agent runs and AI proposals (G-27).
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { MCP_MAX_BATCH, batchProblem } from "../lib/mcp/batch";
import { XLSX_MAX_UNPACKED_BYTES, xlsxUnpackProblem } from "../lib/catalogue/file/xlsx";
import { readFileSync } from "node:fs";
import { IDEMPOTENCY_TTL_HOURS, idempotencyCutoff, readIdempotencyKey, replayDecision, requestHash } from "../lib/security/idempotency";
import { AGENT_RUN_RETENTION_DAYS, AI_PROPOSAL_RETENTION_DAYS, agentRetentionDetail, daysCutoff } from "../lib/agents/retention";

test("an MCP batch over the ceiling is refused, an ordinary one is taken", () => {
  assert.equal(batchProblem([])?.status, 400);
  assert.equal(batchProblem(Array.from({ length: MCP_MAX_BATCH }, () => ({ jsonrpc: "2.0", method: "ping", id: 1 }))), null);
  const many = batchProblem(Array.from({ length: 5_000 }, (_, id) => ({ jsonrpc: "2.0", method: "ping", id })));
  assert.equal(many?.status, 400);
  assert.match(many!.message, /högst 20/);
});

/** A zip with one deflated part; `claimed` is the size the zip says the part has (a crafted zip may lie). */
function zipWith(name: string, content: Buffer, claimed = content.length) {
  const data = deflateRawSync(content);
  const nameBytes = Buffer.from(name, "utf8");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(claimed, 22); local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(claimed, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(0, 42);
  const centralOffset = local.length + nameBytes.length + data.length;
  const centralSize = central.length + nameBytes.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, nameBytes, data, central, nameBytes, end]);
}

test("a workbook that unpacks past the ceiling is refused quickly, also when the zip claims a small size", async () => {
  const content = Buffer.alloc(5_000_000, 0x41);
  const limits = { maxBytes: 1_000_000 };
  assert.match((await xlsxUnpackProblem(zipWith("xl/sharedStrings.xml", content), limits)) ?? "", /uppackad/);
  const started = Date.now();
  assert.match((await xlsxUnpackProblem(zipWith("xl/sharedStrings.xml", content, 10), limits)) ?? "", /uppackad/, "the inflated bytes count, not the claim");
  assert.ok(Date.now() - started < 2_000, "refused within two seconds");
  assert.equal(await xlsxUnpackProblem(zipWith("xl/sharedStrings.xml", Buffer.alloc(100_000, 0x41)), limits), null);
  assert.equal(await xlsxUnpackProblem(Buffer.from("not a zip")), null, "not a zip is left to the reader");
});

test("an ordinary workbook passes the zip-bomb guard", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Kontrollpunkter");
  for (let row = 0; row < 200; row++) sheet.addRow([`Punkt ${row}`, "bedomning", row]);
  const buffer = Buffer.from(await book.xlsx.writeBuffer());
  assert.equal(await xlsxUnpackProblem(buffer), null);
  assert.ok(XLSX_MAX_UNPACKED_BYTES >= 100_000_000);
});

test("Idempotency-Key: read from the header, the same request is replayed, other content or another person is refused", () => {
  const headers = (value?: string) => new Headers(value === undefined ? {} : { "Idempotency-Key": value });
  assert.deepEqual(readIdempotencyKey(headers()), { ok: true, key: null });
  assert.deepEqual(readIdempotencyKey(headers(" 0f8fad5b-d9cb-469f-a165-70867728950e ")), { ok: true, key: "0f8fad5b-d9cb-469f-a165-70867728950e" });
  for (const bad of ["short", "has space in it", "x".repeat(101), "åäö-åäö-åäö"]) assert.equal(readIdempotencyKey(headers(bad)).ok, false, bad);
  const hash = requestHash({ task: { title: "Byte av armatur" }, maintenance: null });
  assert.equal(hash, requestHash({ task: { title: "Byte av armatur" }, maintenance: null }), "the same content gives the same hash");
  assert.notEqual(hash, requestHash({ task: { title: "Byte av armatur 2" }, maintenance: null }));
  const request = { userId: "u1", requestHash: hash };
  assert.deepEqual(replayDecision(null, request), { kind: "none" });
  assert.deepEqual(replayDecision({ userId: "u1", requestHash: hash, response: { id: "t1", version: 1 } }, request), { kind: "replay", response: { id: "t1", version: 1 } });
  assert.equal(replayDecision({ userId: "u1", requestHash: "other", response: { id: "t1" } }, request).kind, "refuse");
  assert.equal(replayDecision({ userId: "u2", requestHash: hash, response: { id: "t1" } }, request).kind, "refuse");
  assert.equal(replayDecision({ userId: "u1", requestHash: hash, response: null }, request).kind, "busy");
  assert.equal(IDEMPOTENCY_TTL_HOURS, 24);
  assert.equal(idempotencyCutoff(new Date("2026-11-25T12:00:00Z")).toISOString(), "2026-11-24T12:00:00.000Z");
});

test("the create routes claim the key inside the same transaction as the new record", () => {
  for (const [file, scope] of [["app/api/workflow-tasks/route.ts", "workflow-task:create"], ["app/api/workspace/route.ts", "customer:create"]] as const) {
    const source = readFileSync(file, "utf8");
    assert.ok(source.includes(`"${scope}"`), `${file} uses ${scope}`);
    const claim = source.indexOf("await claimIdempotencyKey(tx, idempotency)");
    const store = source.indexOf("await storeIdempotentAnswer(tx, idempotency", claim);
    assert.ok(claim > 0 && store > claim, `${file}: claim, create and store in one transaction`);
    assert.ok(source.includes("instanceof IdempotencyTaken"), `${file} answers a taken key with the first answer`);
  }
  assert.match(readFileSync("prisma/schema.prisma", "utf8"), /model IdempotencyKey \{[\s\S]*?@@unique\(\[organizationId, scope, key\]\)/);
  assert.match(readFileSync("lib/workflow/system-cleanup.ts", "utf8"), /DELETE FROM "IdempotencyKey" WHERE "createdAt" </);
});

test("agent runs and AI proposals are kept a fixed number of days", () => {
  assert.equal(AGENT_RUN_RETENTION_DAYS, 180);
  assert.equal(AI_PROPOSAL_RETENTION_DAYS, 180);
  const now = new Date("2026-11-25T12:00:00Z");
  assert.equal(daysCutoff(180, now).toISOString(), "2026-05-29T12:00:00.000Z");
  assert.throws(() => daysCutoff(0, now));
  assert.equal(agentRetentionDetail({ runs: 1, proposals: 0 }), "Raderat enligt lagringstiden: 1 agentkörning äldre än 180 dagar.");
  assert.equal(agentRetentionDetail({ runs: 3, proposals: 2 }), "Raderat enligt lagringstiden: 3 agentkörningar äldre än 180 dagar och 2 AI-förslag äldre än 180 dagar.");
});
