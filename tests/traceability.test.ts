// Spårbarhet K3.1–K3.3 (2026-11-27): the canonical text and hash of a log row, the chain check (whole, a changed row,
// a removed row, gaps, the checkpoint after retention, the tail), the change history's diff and its words, and the log
// retention's choices. The database side (the trigger, concurrent writers, tenant isolation) is tests/traceability.integration.ts.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  anchorHash, canonicalRow, canonicalTime, canonicalValue, chainHash, chainKeyOf, chainVerifier, genesisHash, verifyLinks,
  type ChainGap, type ChainLink,
} from "../lib/traceability/chain";
import {
  actorText, CHANGE_FIELDS, changeLines, diffRecord, idsToName, parseChanges, partSnapshot, personValue, planSnapshot, storedValue, taskSnapshot, valueText,
} from "../lib/traceability/record-changes";
import { DEFAULT_LOG_RETENTION_YEARS, isLogRetentionYears, LOG_RETENTION_YEARS, logRetentionCutoff, logRetentionLabel, logRetentionYears } from "../lib/traceability/log-retention";

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const at = new Date("2026-11-27T10:15:30.123Z");

// ---------- canonical text and hash ----------

test("a value is its UTF-8 length and text, null is a dash", () => {
  assert.equal(canonicalValue(null), "-");
  assert.equal(canonicalValue(undefined), "-");
  assert.equal(canonicalValue(""), "0:");
  assert.equal(canonicalValue("abc"), "3:abc");
  assert.equal(canonicalValue("åäö"), "6:åäö", "bytes, not characters (the trigger's octet_length)");
  assert.equal(canonicalValue("a\nb=c"), "5:a\nb=c", "a text cannot pass for another column: its length comes first");
  assert.equal(canonicalTime(at), "2026-11-27T10:15:30.123Z");
});

test("the canonical row: the trigger's columns in its order", () => {
  assert.equal(canonicalRow({ log: "admin", row: { id: "a1", organizationId: "org", actorId: "u1", action: "member_save", detail: "Anna är admin", createdAt: at } }),
    "v1|admin\nid=2:a1\norganizationId=3:org\nactorId=2:u1\naction=11:member_save\ndetail=14:Anna är admin\ncreatedAt=24:2026-11-27T10:15:30.123Z");
  assert.equal(canonicalRow({ log: "security", row: { id: "s1", type: "login_ok", userId: "u1", actorId: null, organizationId: null, platform: false, client: "Chrome på Mac", ipHash: null, detail: "password", createdAt: at } }),
    "v1|security\nid=2:s1\ntype=8:login_ok\nuserId=2:u1\nactorId=-\norganizationId=-\nplatform=5:false\nclient=14:Chrome på Mac\nipHash=-\ndetail=8:password\ncreatedAt=24:2026-11-27T10:15:30.123Z");
  assert.equal(canonicalRow({ log: "change", row: { id: "c1", organizationId: "org", entityType: "TASK", entityId: "t1", action: "UPDATED", actorId: "u1", changes: "[]", createdAt: at } }),
    "v1|change\nid=2:c1\norganizationId=3:org\nentityType=4:TASK\nentityId=2:t1\naction=7:UPDATED\nactorId=2:u1\nchanges=2:[]\ncreatedAt=24:2026-11-27T10:15:30.123Z");
});

test("the migration's SQL builds the same text: the same columns in the same order, the same hash input", () => {
  const sql = readFileSync("prisma/migrations/20261128210000_traceability/migration.sql", "utf8");
  const columns = (fn: string) => {
    const body = sql.slice(sql.indexOf(`FUNCTION ${fn}(`), sql.indexOf("$$;", sql.indexOf(`FUNCTION ${fn}(`)));
    return [...body.matchAll(/E'\\n(\w+)='/g)].map((match) => match[1]);
  };
  const ts = (row: Parameters<typeof canonicalRow>[0]) => canonicalRow(row).split("\n").slice(1).map((line) => line.split("=")[0]);
  assert.deepEqual(columns("audit_chain_canonical_admin"), ts({ log: "admin", row: { id: "", organizationId: "", actorId: "", action: "", detail: "", createdAt: at } }));
  assert.deepEqual(columns("audit_chain_canonical_security"), ts({ log: "security", row: { id: "", type: "", userId: null, actorId: null, organizationId: null, platform: true, client: "", ipHash: null, detail: "", createdAt: at } }));
  assert.deepEqual(columns("audit_chain_canonical_change"), ts({ log: "change", row: { id: "", organizationId: "", entityType: "", entityId: "", action: "", actorId: null, changes: "", createdAt: at } }));
  for (const log of ["admin", "security", "change"]) assert.match(sql, new RegExp(`SELECT 'v1\\|${log}'`), `${log}: the first line`);
  // The link: hex(sha256(previous \n number \n text)), and the genesis and anchor texts.
  assert.match(sql, /encode\(sha256\(convert_to\(o_prev \|\| E'\\n' \|\| o_seq::text \|\| E'\\n' \|\| p_canonical, 'UTF8'\)\), 'hex'\)/);
  assert.match(sql, /'hintek-workflow-audit-chain-v1' \|\| E'\\n' \|\| p_log \|\| E'\\n' \|\| p_key/);
  assert.match(sql, /'hintek-workflow-audit-anchor-v1' \|\| E'\\nadmin\\n' \|\| chain_key \|\| E'\\n' \|\| n::text \|\| E'\\n' \|\| digests/);
  assert.match(sql, /'platform'/);
  // Additive only, and appends are serialised on the head's row.
  assert.doesNotMatch(sql, /^\s*(DELETE|UPDATE "(AdministrationEvent|SecurityEvent)"|TRUNCATE|DROP)\b/im);
  assert.match(sql, /FROM "AuditChainHead" WHERE "log" = p_log AND "chainKey" = v_key FOR UPDATE/);
  for (const trigger of ["AdministrationEvent_audit_chain", "SecurityEvent_audit_chain", "RecordChange_audit_chain"]) assert.match(sql, new RegExp(`CREATE TRIGGER "${trigger}" BEFORE INSERT`));
});

test("the hash: previous hash, number and text; genesis and anchor are fixed formulas", () => {
  assert.equal(chainHash("p", 7, "text"), sha("p\n7\ntext"));
  assert.equal(genesisHash("admin", "org"), sha("hintek-workflow-audit-chain-v1\nadmin\norg"));
  assert.notEqual(genesisHash("admin", "org"), genesisHash("change", "org"), "each log has its own start");
  assert.equal(anchorHash("security", "platform", ["a", "b"]), sha(`hintek-workflow-audit-anchor-v1\nsecurity\nplatform\n2\n${sha("a")}\n${sha("b")}`));
  assert.equal(chainKeyOf(null), "platform");
  assert.equal(chainKeyOf("org-1"), "org-1");
});

// ---------- the chain check ----------

function chain(count: number, start = { seq: 0, hash: genesisHash("admin", "org") }) {
  const rows: ChainLink[] = [];
  let previous = start.hash;
  for (let seq = start.seq + 1; seq <= start.seq + count; seq++) {
    const canonical = canonicalRow({ log: "admin", row: { id: `a${seq}`, organizationId: "org", actorId: "u", action: "x", detail: `rad ${seq}`, createdAt: at } });
    const rowHash = chainHash(previous, seq, canonical);
    rows.push({ seq, prevHash: previous, rowHash, canonical });
    previous = rowHash;
  }
  return { start, rows, head: { lastSeq: start.seq + count, lastHash: previous } };
}
const check = (start: { seq: number; hash: string } | null, rows: ChainLink[], gaps: ChainGap[], head: { lastSeq: number; lastHash: string }) => {
  const verifier = chainVerifier(start);
  verifyLinks(verifier, rows, gaps, head.lastSeq);
  return verifier.finish(head);
};
const gapOf = (row: ChainLink, kind = "erased"): ChainGap => ({ seq: row.seq, prevHash: row.prevHash!, rowHash: row.rowHash!, kind });

test("an intact chain checks whole, also from the anchor of older rows", () => {
  const whole = chain(5);
  assert.deepEqual(check(whole.start, whole.rows, [], whole.head), { ok: true, checked: 5, lastSeq: 5 });
  const anchored = chain(3, { seq: 0, hash: anchorHash("admin", "org", ["old row"]) });
  assert.equal(check(anchored.start, anchored.rows, [], anchored.head).ok, true);
  const empty = chain(0);
  assert.deepEqual(check(empty.start, [], [], empty.head), { ok: true, checked: 0, lastSeq: 0 });
});

test("a changed row breaks the chain where it was changed", () => {
  const { start, rows, head } = chain(5);
  const changed = rows.map((row) => row.seq === 3 ? { ...row, canonical: row.canonical.replace("rad 3", "rad X") } : row);
  assert.deepEqual(check(start, changed, [], head), { ok: false, checked: 2, break: { seq: 3, reason: "changed" } });
  // A row whose hash was recomputed to fit its new text no longer fits the next row's link.
  const recomputed = rows.map((row) => row.seq === 3 ? { ...row, canonical: "forged", rowHash: chainHash(row.prevHash!, 3, "forged") } : row);
  assert.deepEqual(check(start, recomputed, [], head), { ok: false, checked: 3, break: { seq: 4, reason: "link" } });
});

test("a removed row is found; one removed with its links kept is not a break", () => {
  const { start, rows, head } = chain(5);
  const without = rows.filter((row) => row.seq !== 2);
  assert.deepEqual(check(start, without, [], head), { ok: false, checked: 1, break: { seq: 2, reason: "missing" } });
  assert.equal(check(start, without, [gapOf(rows[1])], head).ok, true, "an erasure kept the row's hashes");
  // A gap that does not fit its place is a break too.
  assert.deepEqual(check(start, without, [{ ...gapOf(rows[1]), prevHash: "0".repeat(64) }], head), { ok: false, checked: 1, break: { seq: 2, reason: "link" } });
  // A redacted row's own text changed on purpose; its stored hash still binds it.
  const redacted = rows.map((row) => row.seq === 4 ? { ...row, canonical: row.canonical.replace("rad 4", "[borttagen]") } : row);
  assert.equal(check(start, redacted, [gapOf(rows[3], "redacted")], head).ok, true);
  assert.equal(check(start, redacted.map((row) => row.seq === 4 ? { ...row, rowHash: "f".repeat(64) } : row), [gapOf(rows[3], "redacted")], head).ok, false, "but not a changed hash");
});

test("rows removed at the end, or a head that does not fit, break the chain", () => {
  const { start, rows, head } = chain(5);
  assert.deepEqual(check(start, rows.slice(0, 3), [], head), { ok: false, checked: 3, break: { seq: 4, reason: "missing" } });
  assert.deepEqual(check(start, rows, [], { lastSeq: 6, lastHash: head.lastHash }).ok, false);
  assert.deepEqual(check(start, rows, [], { lastSeq: 5, lastHash: "0".repeat(64) }), { ok: false, checked: 5, break: { seq: 6, reason: "link" } });
  assert.deepEqual(check(null, rows, [], head), { ok: false, checked: 0, break: { seq: 1, reason: "start" } }, "no starting point");
});

test("after the retention the chain is checked from its checkpoint", () => {
  const { rows, head } = chain(6);
  // Rows 1–3 removed by the retention: the checkpoint is the last removed row's hash.
  const checkpoint = { seq: 3, hash: rows[2].rowHash! };
  assert.deepEqual(check(checkpoint, rows.slice(3), [], head), { ok: true, checked: 3, lastSeq: 6 });
  // A row before the checkpoint does not matter any more; a row after it that is missing does.
  assert.deepEqual(check(checkpoint, rows.slice(4), [], head), { ok: false, checked: 0, break: { seq: 4, reason: "missing" } });
  // A wrong checkpoint does not fit the first row left.
  assert.deepEqual(check({ seq: 3, hash: "0".repeat(64) }, rows.slice(3), [], head), { ok: false, checked: 0, break: { seq: 4, reason: "link" } });
  // Rows older than the time but not at the start (a later row's time set back): kept as retention gaps.
  assert.equal(check(checkpoint, rows.slice(3).filter((row) => row.seq !== 5), [gapOf(rows[4], "retention")], head).ok, true);
});

test("the check is fed page by page", () => {
  const { start, rows, head } = chain(9);
  const verifier = chainVerifier(start);
  for (let from = 1; from <= 9; from += 4) verifyLinks(verifier, rows.filter((row) => row.seq >= from && row.seq < from + 4), [], Math.min(from + 3, 9));
  assert.deepEqual(verifier.finish(head), { ok: true, checked: 9, lastSeq: 9 });
});

// ---------- the change history ----------

const task = {
  title: "Byt pump", description: "", status: "PLANNED", assignedToUserId: "u1", assignedToName: "Anna", plannedStartDate: "2026-11-28", dueDate: "", estimatedMinutes: 90,
  stage: "", customerId: "c1", facilityId: null, projectId: null, workOrderId: null, machinePartId: null, cancelReason: "", data: { kind: "WORK_ORDER", details: { executionNotes: "" } },
};

test("the diff keeps only what changed, from what to what", () => {
  const before = taskSnapshot(task);
  assert.deepEqual(diffRecord("TASK", before, taskSnapshot({ ...task })), [], "nothing changed");
  assert.deepEqual(diffRecord("TASK", before, taskSnapshot({ ...task, status: "IN_PROGRESS", dueDate: "2026-12-01", assignedToUserId: "u2", estimatedMinutes: null })), [
    { field: "status", from: "PLANNED", to: "IN_PROGRESS" },
    { field: "assignee", from: "u:u1", to: "u:u2" },
    { field: "dueDate", from: null, to: "2026-12-01" },
    { field: "estimatedMinutes", from: "90", to: null },
  ]);
  // The content is only marked as changed – its text is in the version history, and prices never leave this way.
  assert.deepEqual(diffRecord("TASK", before, taskSnapshot({ ...task, data: { kind: "WORK_ORDER", details: { executionNotes: "Bytt", price: 1200 } } })), [{ field: "content" }]);
  // Key order and empty texts do not count as changes.
  assert.deepEqual(diffRecord("TASK", taskSnapshot({ ...task, data: { a: 1, b: 2 } }), taskSnapshot({ ...task, data: { b: 2, a: 1 } })), []);
  assert.deepEqual(diffRecord("TASK", taskSnapshot({ ...task, description: "" }), taskSnapshot({ ...task, description: "   " })), []);
  assert.deepEqual(diffRecord("TASK", null, before), [], "a new record has no field list");
});

test("a typed name and a member are told apart; long texts are cut", () => {
  assert.equal(personValue("u1", "Anna"), "u:u1");
  assert.equal(personValue(null, " Extern Elektriker "), "t:Extern Elektriker");
  assert.equal(personValue(null, ""), null);
  assert.equal(storedValue("text", "x".repeat(400))!.length, 300);
  assert.ok(storedValue("text", "x".repeat(400))!.endsWith("…"));
  assert.equal(storedValue("list", ["Kontrollera oljan", " ", "Byt filter"]), "Kontrollera oljan\nByt filter");
  assert.equal(storedValue("bool", false), "false");
  assert.equal(storedValue("date", new Date("2026-11-27T00:00:00Z")), "2026-11-27T00:00:00.000Z");
});

test("a deviation's sensitive texts are recorded as changed, never with the text", () => {
  for (const field of ["title", "description", "action", "followUp", "investigation", "doneNote"]) assert.equal(CHANGE_FIELDS.DEVIATION[field].kind, "hidden", field);
  const changes = diffRecord("DEVIATION",
    { status: "OPEN", title: "Anna föll", investigation: { whatHappened: "" }, reportedToAuthority: false },
    { status: "DONE", title: "Anna föll i trappan", investigation: { whatHappened: "Halkade" }, reportedToAuthority: true });
  assert.deepEqual(changes, [{ field: "status", from: "OPEN", to: "DONE" }, { field: "reportedToAuthority", from: "false", to: "true" }, { field: "title" }, { field: "investigation" }]);
  assert.ok(!JSON.stringify(changes).includes("Anna"), "no personal text in the stored change");
});

test("plans and machines compare their own fields", () => {
  const plan = { name: "Smörjning", description: "", unit: "WEEK", every: 2, intervalMode: "FROM_DONE", startDate: "2026-12-01", nextRunHours: null, assignedToUserId: null, assignedToName: "", estimatedMinutes: 30, checklist: ["Olja"], roundScheduleId: null, isActive: true };
  assert.deepEqual(diffRecord("MAINTENANCE_PLAN", planSnapshot(plan), planSnapshot({ ...plan, every: 4, isActive: false, checklist: ["Olja", "Fett"] })), [
    { field: "every", from: "2", to: "4" }, { field: "checklist", from: "Olja", to: "Olja\nFett" }, { field: "isActive", from: "true", to: "false" },
  ]);
  // Drifttimmar: the calendar's start and interval mode do not apply.
  assert.equal(planSnapshot({ ...plan, unit: "RUN_HOURS" }).startDate, null);
  const part = { name: "Pump P4", partType: "Pump", marking: "", status: "IN_SERVICE", notes: "", runHours: 100, parentId: null, placeId: "p1", customerId: null, isActive: true };
  assert.deepEqual(diffRecord("MACHINE", partSnapshot(part), partSnapshot({ ...part, status: "OUT_OF_SERVICE", runHours: 120.5 })), [
    { field: "status", from: "IN_SERVICE", to: "OUT_OF_SERVICE" }, { field: "runHours", from: "100", to: "120.5" },
  ]);
});

test("the page's words: labels, choices, names, removed records and nothing", () => {
  const names = { user: { u1: "Anna Andersson" }, customer: { c1: "Bolaget AB" } };
  const lines = changeLines("TASK", [
    { field: "status", from: "PLANNED", to: "COMPLETED" }, { field: "assignee", from: "u:u1", to: "u:gone" }, { field: "assignee", from: "t:Extern", to: null },
    { field: "customerId", from: "c1", to: "c2" }, { field: "estimatedMinutes", from: "90", to: "45" }, { field: "content" }, { field: "unknownField", from: "a", to: "b" },
  ], names);
  assert.deepEqual(lines.map((line) => [line.label, line.from, line.to, line.hidden]), [
    ["Status", "Planerad", "Färdigställd", false], ["Ansvarig", "Anna Andersson", "Borttagen användare", false], ["Ansvarig", "Extern", null, false],
    ["Kund", "Bolaget AB", "Borttagen kund", false], ["Uppskattad tid", "1 h 30 min", "45 min", false], ["Innehållet", null, null, true],
  ], "a field the list no longer knows is left out");
  assert.equal(valueText(CHANGE_FIELDS.MAINTENANCE_PLAN.isActive, "false", {}), "Pausad");
  assert.equal(valueText(CHANGE_FIELDS.DEVIATION.reportedToAuthority, "true", {}), "Ja");
  assert.equal(actorText("system:history-retention", names), "Systemet");
  assert.equal(actorText("u1", names), "Anna Andersson");
  assert.equal(actorText("u9", names), "Borttagen användare");
  assert.deepEqual([...idsToName("TASK", [{ field: "assignee", from: "u:u1", to: "t:Extern" }, { field: "customerId", from: null, to: "c1" }]).user], ["u1"]);
  assert.deepEqual(parseChanges("not json"), []);
  assert.deepEqual(parseChanges('[{"field":"status","from":"A","to":"B"},{"x":1}]'), [{ field: "status", from: "A", to: "B" }]);
});

// ---------- log retention ----------

test("log retention: 1, 2, 5 or 10 years, 2 as standard, the same day back", () => {
  assert.deepEqual([...LOG_RETENTION_YEARS], [1, 2, 5, 10]);
  assert.equal(DEFAULT_LOG_RETENTION_YEARS, 2);
  assert.equal(isLogRetentionYears(3), false);
  assert.equal(logRetentionYears(null), 2);
  assert.equal(logRetentionYears(10), 10);
  assert.equal(logRetentionLabel(1), "1 år");
  assert.equal(logRetentionLabel(5), "5 år");
  assert.equal(logRetentionCutoff(2, new Date("2026-11-27T03:30:00Z")).toISOString(), "2024-11-27T03:30:00.000Z");
  assert.equal(logRetentionCutoff(1, new Date("2028-02-29T03:30:00Z")).toISOString(), "2027-02-28T03:30:00.000Z", "29 February to the 28th");
});
