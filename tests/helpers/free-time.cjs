/* eslint-disable @typescript-eslint/no-require-imports -- A free time slot for a test's own time entry in the local test database. */
// Time entries may not overlap for one person (the API refuses with "Tiden överlappar en annan tidpost för dig"). A test that
// writes yesterday 08:00–09:30 collided with whatever else the shared QA account had that day – time left by a walk-through on
// the QA instance, or a run that crossed midnight so that "yesterday" became the day of another test's time (N3 2026-11-18).
// freeSlot picks the first half hour from 08:00 (then 06:00–20:00) on the given Swedish day where `minutes` fit beside the
// person's own entries; a running entry counts until now. Reads only; kfid_v3_test on loopback.
const { execFileSync } = require("node:child_process");

const sql = (statement) => execFileSync("docker", ["exec", "hintek-workflow-postgres", "sh", "-lc",
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d kfid_v3_test -Atc "$1"', "--", statement], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** Yesterday's date in Swedish time (YYYY-MM-DD). */
function swedishYesterday() {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
  return new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/**
 * { start: "HH:MM", end: "HH:MM" } in Swedish time and { startIso, endIso } in UTC for a free slot of `minutes` on `day`
 * (YYYY-MM-DD, Swedish) for the person with `email`.
 */
function freeSlot({ email, day, minutes }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^[\w.+-]+@[\w.-]+$/.test(email) || !Number.isInteger(minutes)) throw new Error("freeSlot: bad input");
  const local = (expression) => `((${expression}) AT TIME ZONE 'Europe/Stockholm') AT TIME ZONE 'UTC'`;
  const iso = (expression) => `to_char(${local(expression)}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
  const row = sql(`SELECT to_char(s, 'HH24:MI') || '|' || to_char(s + interval '${minutes} minutes', 'HH24:MI') || '|' || ${iso("s")} || '|' || ${iso(`s + interval '${minutes} minutes'`)}
    FROM generate_series(timestamp '${day} 06:00', timestamp '${day} 20:00', interval '30 minutes') s
    WHERE NOT EXISTS (SELECT 1 FROM "WorkflowTimeEntry" e JOIN "User" u ON u.id = e."userId" WHERE u.email = '${email}'
      AND e."startedAt" < ${local(`s + interval '${minutes} minutes'`)} AND COALESCE(e."endedAt", now() AT TIME ZONE 'UTC') > ${local("s")})
    ORDER BY s < timestamp '${day} 08:00', s LIMIT 1`);
  if (!row) throw new Error(`freeSlot: no free ${minutes} minutes on ${day} for ${email}`);
  const [start, end, startIso, endIso] = row.split("|");
  return { start, end, startIso, endIso };
}

const QA_OWNER_EMAIL = "qa-owner@role-test.invalid";

module.exports = { freeSlot, swedishYesterday, QA_OWNER_EMAIL };
