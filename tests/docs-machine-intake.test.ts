import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { MAX_AGE_MS, MAX_BODY_BYTES, MAX_EVENT_ID_LENGTH, MAX_EVENTS_PER_CALL, MAX_FUTURE_MS, MAX_TEXT_LENGTH, MAX_VALUE_NAME_LENGTH, MAX_VALUE_TEXT_LENGTH, MAX_VALUES } from "../lib/machine/intake";
import { DAILY_ALARM_ORDER_CAP } from "../lib/machine/alarm-rules";

// Granskning 2026-10-20: docs/drift/MASKININTAG.md is what a machine owner programs against. Every number it promises is
// read here from the code (or the source text, where importing would need the database) and must be the same.
// docs/ is not in the Community export; there these tests have nothing to read.
const hasDoc = existsSync("docs/drift/MASKININTAG.md");
const noDoc = !hasDoc && "needs docs/ (not in the Community export)";
const doc = (hasDoc ? readFileSync("docs/drift/MASKININTAG.md", "utf8") : "").replace(/ /g, " ");
const source = (path: string) => readFileSync(path, "utf8");
const has = (pattern: RegExp, what: string) => assert.match(doc, pattern, `MASKININTAG.md must say: ${what}`);

test("the intake limits in MASKININTAG.md are the code's", { skip: noDoc }, () => {
  has(new RegExp(`1–${MAX_EVENTS_PER_CALL} händelser per anrop, högst ${MAX_BODY_BYTES / 1024} kB`), "events per call and body size");
  has(new RegExp(`1–${MAX_EVENT_ID_LENGTH} synliga tecken`), "eventId length");
  assert.equal(MAX_AGE_MS, 7 * 24 * 3_600_000); has(/Högst en vecka gammal/, "a week old at most");
  assert.equal(MAX_FUTURE_MS, 5 * 60_000); has(/högst fem minuter fram/, "five minutes ahead at most");
  has(new RegExp(`\`text\` \\| Valfri, högst ${MAX_TEXT_LENGTH} tecken`), "text length");
  has(new RegExp(`högst ${MAX_VALUES} namn .*högst ${MAX_VALUE_TEXT_LENGTH} tecken.*högst ${MAX_VALUE_NAME_LENGTH} tecken`), "values");
});

test("the rate limits, retention and alarm limits in MASKININTAG.md are the code's", { skip: noDoc }, () => {
  const rules = source("lib/security/rate-limit.ts");
  const call = /ingestCall: \{ name: "ingest-call", limit: (\d+), windowSeconds: (\d+) \}/.exec(rules);
  const refused = /ingestRefused: \{ name: "ingest-refused-ip", limit: (\d+), windowSeconds: (\d+) \* 60 \}/.exec(rules);
  assert.ok(call && refused, "the ingest rules are found in rate-limit.ts");
  assert.equal(call[2], "60");
  has(new RegExp(`${call[1]} anrop i minuten per källa`), "calls per minute");
  has(new RegExp(`\\(${refused[1]} på ${refused[2] === "10" ? "tio" : refused[2]} minuter\\)`), "guessed keys per address");
  const days = /machineEventsDays: (\d+)/.exec(source("lib/workflow/system-cleanup.ts"))?.[1];
  has(new RegExp(`Händelser sparas ${days} dagar`), "retention");
  const cooldown = /cooldownMinutes\s+Int\s+@default\((\d+)\)/.exec(source("prisma/schema.prisma"))?.[1];
  has(new RegExp(`${cooldown} minuters vila`), "cooldown");
  has(new RegExp(`högst ${DAILY_ALARM_ORDER_CAP} förslag per företag de senaste 24 timmarna`), "daily cap (rolling 24 hours)");
});
