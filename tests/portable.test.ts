import { test } from "node:test";
import assert from "node:assert/strict";
import { blankControl, RULE_VERSION } from "../lib/kfid/model";
import {
  createPortableControlExport,
  MAX_PORTABLE_JSON_BYTES,
  parsePortableControl,
  parsePortableControlJson,
  PORTABLE_FORMAT,
  PORTABLE_SCHEMA_VERSION,
} from "../lib/kfid/portable";

test("portable V3 export carries explicit schema/rule versions without tenant links", () => {
  const data = blankControl();
  data.meta.proj = "Portabel kontroll";
  const exported = createPortableControlExport(
    data,
    new Date("2026-09-12T12:00:00.000Z"),
  );
  assert.equal(exported.format, PORTABLE_FORMAT);
  assert.equal(exported.schemaVersion, PORTABLE_SCHEMA_VERSION);
  assert.equal(exported.ruleVersion, RULE_VERSION);
  assert.equal(exported.exportedAt, "2026-09-12T12:00:00.000Z");
  assert.equal(exported.data.meta.proj, "Portabel kontroll");
  assert.equal("organizationId" in exported, false);
  assert.equal("customerId" in exported, false);
  assert.equal("attachments" in exported, false);
});

test("portable import previews current V3 and recalculates a different rule profile", () => {
  const data = blankControl();
  data.meta.proj = "Ny V3-fil";
  const exported = {
    ...createPortableControlExport(data),
    ruleVersion: "KFID-OLDER-RULE",
  };
  const preview = parsePortableControl(exported);
  assert.equal(preview.source, "KFID V3");
  assert.equal(preview.schemaVersion, 1);
  assert.equal(preview.project, "Ny V3-fil");
  assert.ok(preview.warnings.some((item) => item.includes("räknas om")));
});

test("legacy/V1 import remains compatible and reports ignored customer, tenant and attachments", () => {
  const data = blankControl() as unknown as Record<string, unknown>;
  (data.meta as Record<string, unknown>).customer_id = 42;
  (data.vis as Record<string, unknown>).images = ["unsafe-path.jpg"];
  const preview = parsePortableControl({
    data,
    customerId: "foreign-customer",
    organizationId: "foreign-tenant",
    attachments: [{ storagePath: "/private/file" }],
  });
  assert.equal(preview.source, "Äldre/V1-format");
  assert.equal(preview.schemaVersion, null);
  assert.ok(preview.ignored.some((item) => item.includes("Kundkoppling")));
  assert.ok(preview.ignored.some((item) => item.includes("Företagskoppling")));
  assert.ok(preview.ignored.some((item) => item.includes("Bilagereferenser")));
  assert.ok(preview.warnings.some((item) => item.includes("Välj kund")));
  assert.equal("customer_id" in preview.data.meta, false);
  assert.equal("images" in preview.data.vis, false);
});

test("portable import rejects future/unknown schemas, malformed JSON and oversized files", () => {
  const data = blankControl();
  assert.throws(
    () =>
      parsePortableControl({
        format: PORTABLE_FORMAT,
        schemaVersion: PORTABLE_SCHEMA_VERSION + 1,
        ruleVersion: RULE_VERSION,
        data,
      }),
    /stöder högst schema/,
  );
  assert.throws(
    () =>
      parsePortableControl({
        format: "OTHER_FORMAT",
        schemaVersion: 1,
        ruleVersion: RULE_VERSION,
        data,
      }),
    /giltigt KFID-exporthuvud/,
  );
  assert.throws(() => parsePortableControlJson("{"), /giltig JSON/);
  assert.throws(
    () => parsePortableControlJson(" ".repeat(MAX_PORTABLE_JSON_BYTES + 1)),
    /Maximal storlek är 2 MB/,
  );
});
