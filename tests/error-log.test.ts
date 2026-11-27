import assert from "node:assert/strict";
import test from "node:test";
import { errorLogRecord, safeErrorLine } from "../lib/kfid/error-log";

test("error log: Prisma's cause line is kept, its invocation header and values are not", () => {
  const prisma = Object.assign(new Error("\nInvalid `prisma.control.deleteMany()` invocation:\n\n\nForeign key constraint violated on the constraint: `PlannedActivity_controlId_organizationId_fkey`"), { name: "PrismaClientKnownRequestError", code: "P2003" });
  const record = errorLogRecord(prisma, "abcd1234");
  assert.deepEqual(record, { ref: "abcd1234", name: "PrismaClientKnownRequestError", code: "P2003", message: "Foreign key constraint violated on the constraint: `PlannedActivity_controlId_organizationId_fkey`" });
});

test("error log: no e-mail addresses, keys, long numbers or quoted values", () => {
  const line = safeErrorLine("User anna.svensson@example.invalid failed with Bearer abc.def and key tok0123456789abcdefghijklmnopqrstuv, pnr 198001011234, value \"hemligt\" 'också'");
  assert.ok(!line.includes("anna.svensson"));
  assert.ok(!line.includes("abc.def"));
  assert.ok(!line.includes("tok0123"));
  assert.ok(!line.includes("198001011234"));
  assert.ok(!line.includes("hemligt") && !line.includes("också"));
  assert.ok(safeErrorLine("x".repeat(500)).length <= 200);
  assert.equal(errorLogRecord("not an error", "r").message, "");
});
