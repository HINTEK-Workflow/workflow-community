import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { toolDescription, toolFieldNames, toolInputSchema, TOOL_CATALOG, TOOL_NAMES } from "../lib/tools/catalog";
import { unknownFields, unknownFieldWarnings } from "../lib/tools/field-help";

type Node = { description?: string; pattern?: string; properties?: Record<string, Node>; items?: Node; anyOf?: Node[] };
const missing = (node: Node, path: string): string[] => Object.entries(node.properties ?? {}).flatMap(([field, property]) =>
  [...(property.description ? [] : [`${path}.${field}`]), ...missing(property, `${path}.${field}`), ...(property.items ? missing(property.items, `${path}.${field}[]`) : [])]);
const patterns = (node: Node): number => (node.pattern ? 1 : 0) + Object.values(node.properties ?? {}).reduce((sum, item) => sum + patterns(item), 0) + (node.items ? patterns(node.items) : 0) + (node.anyOf ?? []).reduce((sum, item) => sum + patterns(item), 0);

test("every input field of every tool has a short Swedish description, and no date regex is shown", () => {
  for (const name of TOOL_NAMES) {
    const schema = toolInputSchema(name) as Node;
    assert.deepEqual(missing(schema, name), [], `${name} saknar fältbeskrivning`);
    assert.equal(patterns(schema), 0, `${name} visar ett regex-pattern`);
  }
  const project = toolInputSchema("create_project") as Node;
  assert.equal(project.properties?.startDate?.description, "Datum, ÅÅÅÅ-MM-DD.");
  assert.equal((toolInputSchema("report_time") as Node).properties?.startedAt?.description, "Tidpunkt, ÅÅÅÅ-MM-DDTHH:MM:SSZ.");
});

test("validation is unchanged: the date format is still required by the input", () => {
  assert.equal(TOOL_CATALOG.create_project.input.safeParse({ name: "A", startDate: "inte-ett-datum", dueDate: "2026-01-01" }).success, false);
  assert.equal(TOOL_CATALOG.create_project.input.safeParse({ name: "A", startDate: "2026-01-01", dueDate: "2026-01-02" }).success, true);
});

test("unknown fields are found for a warning, known ones are not, and the call input still parses", () => {
  const known = toolFieldNames("create_customer");
  assert.deepEqual(unknownFields(known, { name: "Anna", bogus: 1 }), ["bogus"]);
  assert.deepEqual(unknownFields(known, { name: "Anna" }), []);
  assert.deepEqual(unknownFields(known, null), []);
  assert.deepEqual(unknownFieldWarnings(["bogus"]), ["Okänt fält ”bogus” ignorerades."]);
  assert.equal(TOOL_CATALOG.create_customer.input.safeParse({ name: "Anna", bogus: 1 }).success, true);
});

test("dispatch adds only a warnings field to the answer, for API v1 and MCP alike", () => {
  const dispatch = readFileSync("lib/tools/dispatch.ts", "utf8");
  assert.match(dispatch, /\{ \.\.\.result, warnings \}/);
  assert.match(dispatch, /if \(!warnings\.length\) return result;/);
});

test("tools that create say that a repeated call creates a second post; others are unchanged", () => {
  for (const name of TOOL_NAMES) {
    if (TOOL_CATALOG[name].effect === "create") assert.match(toolDescription(name), /Inte idempotent/);
    else assert.equal(toolDescription(name), TOOL_CATALOG[name].description);
  }
  if (existsSync("docs/drift/MCP_OAUTH.md")) assert.match(readFileSync("docs/drift/MCP_OAUTH.md", "utf8"), /inte idempotenta/);
});
