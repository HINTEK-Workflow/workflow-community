import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { failure } from "../lib/kfid/server";
import { issueText, MISSING } from "../lib/validation/zod-swedish";

// A1 (review 2026-10-20): a refused input is told in Swedish – zod's English defaults never reach a person or an API
// client – the common fields are named, and a message the schema wrote itself is kept.
const ENGLISH = /\b(Invalid|expected|received|Too (big|small)|Required|characters|discriminator|option|string|undefined)\b/;

async function refused(schema: z.ZodType, value: unknown) {
  const parsed = schema.safeParse(value);
  assert.equal(parsed.success, false);
  const response = failure(parsed.error);
  assert.equal(response.status, 400);
  return ((await response.json()) as { error: string }).error;
}

test("zod's defaults are Swedish, with the field's name when it is a common one", async () => {
  const schema = z.object({ title: z.string().min(1).max(200), executionNotes: z.string().max(10_000).optional(), email: z.email().optional(), quantity: z.number().min(0).optional() });
  assert.equal(await refused(schema, {}), "Fyll i rubrik.");
  assert.equal(await refused(schema, { title: "" }), "Fyll i rubrik.");
  assert.equal(await refused(schema, { title: 5 }), "Rubrik ska vara text.");
  assert.equal(await refused(schema, { title: "x".repeat(201) }), "Rubrik får vara högst 200 tecken.");
  assert.equal(await refused(schema, { title: "a", executionNotes: "x".repeat(10_001) }), "Utfört arbete får vara högst 10 000 tecken.");
  assert.equal(await refused(schema, { title: "a", email: "nej" }), "Ange en giltig e-postadress.");
  assert.equal(await refused(schema, { title: "a", quantity: -1 }), "Antal ska vara minst 0.");
});

test("an unknown field gets a Swedish text without its internal name; a union never lists its options", async () => {
  assert.equal(await refused(z.object({ fooBar: z.string() }), {}), MISSING);
  assert.equal(await refused(z.object({ fooBar: z.string().max(3) }), { fooBar: "abcd" }), "Texten får vara högst 3 tecken.");
  assert.equal(await refused(z.object({ kind: z.enum(["a", "b"]) }), { kind: "c" }), "Värdet tillåts inte.");
  const union = z.discriminatedUnion("action", [z.object({ action: z.literal("create") }), z.object({ action: z.literal("delete") })]);
  for (const value of [{}, { action: "zzz" }, null]) {
    const text = await refused(union, value);
    assert.doesNotMatch(text, ENGLISH, text);
    assert.doesNotMatch(text, /create|delete/, text);
  }
  for (const [schema, value] of [[z.array(z.string()).min(1), []], [z.number().int(), 1.5], [z.iso.date(), "x"], [z.uuid(), "x"], [z.object({}).strict(), { a: 1 }], [z.number().positive(), 0]] as const)
    assert.doesNotMatch(await refused(schema, value), ENGLISH);
});

test("a message the schema wrote itself is kept as it is", async () => {
  assert.equal(await refused(z.object({ title: z.string().min(1, "Skriv en rubrik.") }), { title: "" }), "Skriv en rubrik.");
  assert.equal(issueText(undefined), "Ogiltiga uppgifter.");
});
