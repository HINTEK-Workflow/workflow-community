import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../lib/kfid/errors";
import { acceptedDraft, draftProblems, SERIES_DRAFT_INSTRUCTIONS, seriesDraftInput } from "../lib/schedule/ai-draft";
import { combineOutcomes, outcomeOfError } from "../lib/schedule/channels";
import { runClaimed, runDueWith, type ScheduleRunDeps, type ScheduleStore } from "../lib/schedule/engine";
import { LOCK_MS, MAX_ATTEMPTS, nextAttempt, parseScheduleTime, postContentHash, settle, STOPPED_HALF_WAY, websiteContentHash, type RunOutcome, type ScheduleItem } from "../lib/schedule/model";
import { nextMonday, seriesEndDay, seriesPlanProblem, seriesSlots } from "../lib/schedule/series";
import { OPERATOR_SITE } from "../lib/operator-site";
import { proposeThemes, SERIES_THEMES, templateDraft, themeOf } from "../lib/schedule/themes";
import { swedishParts } from "../lib/swedish-time";

// Schemalägg och innehållsserier (2026-11-11).

// ---------- time ----------

test("a scheduled time is Swedish wall-clock time, in winter and in summer", () => {
  const now = new Date("2026-01-10T12:00:00Z");
  const winter = parseScheduleTime("2026-01-12T08:00", now);
  assert.ok("at" in winter);
  assert.equal(winter.at.toISOString(), "2026-01-12T07:00:00.000Z");
  const summer = parseScheduleTime("2026-06-12T08:00", now);
  assert.ok("at" in summer);
  assert.equal(summer.at.toISOString(), "2026-06-12T06:00:00.000Z");
});

test("the hour that does not exist when summer time starts is refused; the repeated October hour is read as winter time", () => {
  const now = new Date("2026-03-01T12:00:00Z");
  const spring = parseScheduleTime("2026-03-29T02:30", now);
  assert.ok("error" in spring && /ställs fram/.test(spring.error));
  const autumn = parseScheduleTime("2026-10-25T02:30", now);
  assert.ok("at" in autumn);
  assert.equal(autumn.at.toISOString(), "2026-10-25T01:30:00.000Z", "02:30 winter time (UTC+1), as fromSwedishDateTimeInput reads it");
  assert.equal(swedishParts(autumn.at).hour, 2);
});

test("a time that has passed, is malformed or is more than a year ahead is refused", () => {
  const now = new Date("2026-11-11T10:00:00Z");
  assert.ok("error" in parseScheduleTime("2026-11-11T10:00", now), "now (11:00 Swedish is 10:00 UTC) is not ahead");
  assert.ok("error" in parseScheduleTime("2026-11-11T09:00", now));
  assert.ok("error" in parseScheduleTime("2026-11-11 12:00", now));
  assert.ok("error" in parseScheduleTime("2028-01-01T08:00", now));
  assert.ok("at" in parseScheduleTime("2026-11-11T11:05", now));
});

// ---------- retry and outcome ----------

test("a retry waits 5, 15 and 45 minutes, then the item fails", () => {
  const now = new Date("2026-11-11T08:00:00Z");
  assert.equal(nextAttempt(1, now)?.toISOString(), "2026-11-11T08:05:00.000Z");
  assert.equal(nextAttempt(2, now)?.toISOString(), "2026-11-11T08:15:00.000Z");
  assert.equal(nextAttempt(3, now)?.toISOString(), "2026-11-11T08:45:00.000Z");
  assert.equal(nextAttempt(MAX_ATTEMPTS, now), null);
  assert.deepEqual(settle({ kind: "retry", message: "nät" }, MAX_ATTEMPTS, now), { status: "failed", nextAttemptAt: null, error: "nät", result: null });
  assert.equal(settle({ kind: "fail", message: "av" }, 1, now).status, "failed", "a refusal is never tried again");
  assert.equal(settle({ kind: "published", message: "ok" }, 1, now).status, "published");
  assert.equal(settle({ kind: "skip", message: "redan" }, 1, now).status, "cancelled");
});

test("the app's refusals fail, a rate limit or a server error is tried again", () => {
  assert.equal(outcomeOfError(new ApiError(403, "Publicering är avstängd.")).kind, "fail");
  assert.equal(outcomeOfError(new ApiError(409, "Välj sida.")).kind, "fail");
  assert.equal(outcomeOfError(new ApiError(429, "Vänta.")).kind, "retry");
  assert.equal(outcomeOfError(new ApiError(502, "WordPress svarade inte.")).kind, "retry");
  assert.equal(outcomeOfError(new Error("fetch failed")).kind, "retry");
  assert.equal(combineOutcomes([{ kind: "published", message: "a" }, { kind: "published", message: "b" }]).kind, "published");
  assert.equal(combineOutcomes([{ kind: "published", message: "a" }, { kind: "retry", message: "b" }]).kind, "retry");
  assert.equal(combineOutcomes([{ kind: "retry", message: "a" }, { kind: "fail", message: "b" }]).kind, "fail");
  assert.equal(combineOutcomes([]).kind, "fail");
});

// ---------- the approved content ----------

test("the post's hash changes with every field of its content and with the background, not with anything else", () => {
  const post = { heading: "Rubrik", body: "Text", caption: "Inlägg", link: null, template: "color", toFacebook: true, toInstagram: false, backgroundSource: null, background: null, status: "draft", updatedAt: new Date() };
  const base = postContentHash(post);
  assert.equal(postContentHash({ ...post, status: "failed", updatedAt: new Date(0) }), base);
  // Hashtaggar (2026-11-12): an empty field leaves the hash as it was; any hashtag asks for a new approval.
  assert.equal(postContentHash({ ...post, hashtags: "" }), base);
  for (const change of [{ heading: "Ny" }, { caption: "Ny" }, { hashtags: "#ny" }, { link: "https://example.se" }, { template: "light" }, { toInstagram: true }, { background: new Uint8Array([1, 2, 3]) }])
    assert.notEqual(postContentHash({ ...post, ...change }), base, JSON.stringify(Object.keys(change)));
  assert.notEqual(websiteContentHash({ pageId: 1, content: "<p>a</p>", baseModified: "x" }), websiteContentHash({ pageId: 1, content: "<p>b</p>", baseModified: "x" }));
});

// ---------- the engine: claim, idempotency, retry, cancel, stale ----------

function memoryStore(items: ScheduleItem[]) {
  const rows = new Map(items.map((item) => [item.id, { ...item, lockedUntil: null as Date | null }]));
  const store: ScheduleStore = {
    async stale(now) { return [...rows.values()].filter((row) => row.status === "running" && row.lockedUntil && row.lockedUntil < now); },
    async due(now, limit) { return [...rows.values()].filter((row) => row.status === "scheduled" && row.nextAttemptAt <= now).slice(0, limit); },
    async claim(id, now, lockedUntil) {
      const row = rows.get(id);
      if (!row || row.status !== "scheduled" || row.nextAttemptAt > now) return null;
      Object.assign(row, { status: "running", lockedUntil, attempts: row.attempts + 1 });
      return { ...row };
    },
    async finish(id, data, from) {
      const row = rows.get(id);
      if (!row || row.status !== from) return false;
      Object.assign(row, { ...data, nextAttemptAt: data.nextAttemptAt ?? row.nextAttemptAt });
      return true;
    },
    async mailed(id, now) { const row = rows.get(id); if (row) row.failureMailedAt = now; },
  };
  return { store, rows };
}

const itemAt = (id: string, at: Date, extra: Partial<ScheduleItem> = {}): ScheduleItem => ({
  id, organizationId: "org-a", kind: "post", targetId: `post-${id}`, title: "Rubrik", status: "scheduled", runAt: at, nextAttemptAt: at, attempts: 0,
  contentHash: "h", payload: {}, channels: ["facebook"], scheduledById: "admin-a", lastError: null, failureMailedAt: null, ...extra,
});

function deps(store: ScheduleStore, publish: (item: ScheduleItem, actorId: string) => Promise<RunOutcome>, authorize: ScheduleRunDeps["authorize"] = async () => null) {
  const mails: string[] = [];
  const audits: string[] = [];
  const published: string[] = [];
  return {
    mails, audits, published,
    deps: { store, authorize, notify: async (item, reason) => { mails.push(`${item.id}:${reason}`); }, audit: async (_item, detail) => { audits.push(detail); },
      publish: async (item, actorId) => { published.push(`${item.id}:${actorId}`); return publish(item, actorId); } } satisfies ScheduleRunDeps,
  };
}

test("only what is due is published, as the admin who scheduled it; a later item and a cancelled one are left", async () => {
  const now = new Date("2026-11-11T07:00:00Z");
  const { store, rows } = memoryStore([itemAt("due", new Date(now.getTime() - 1000)), itemAt("later", new Date(now.getTime() + 60_000)), itemAt("off", new Date(now.getTime() - 1000), { status: "cancelled" })]);
  const run = deps(store, async () => ({ kind: "published", message: "Publicerat." }));
  const result = await runDueWith(run.deps, now);
  assert.equal(result.published, 1);
  assert.deepEqual(run.published, ["due:admin-a"]);
  assert.equal(rows.get("due")!.status, "published");
  assert.equal(rows.get("later")!.status, "scheduled");
  assert.equal(rows.get("off")!.status, "cancelled");
  assert.equal(run.mails.length, 0);
});

test("two runs at the same moment publish an item once (the claim)", async () => {
  const now = new Date("2026-11-11T07:00:00Z");
  const { store } = memoryStore([itemAt("one", now)]);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const run = deps(store, async () => { await gate; return { kind: "published", message: "ok" }; });
  const first = runDueWith(run.deps, now);
  const second = runDueWith(run.deps, now);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(run.published.length, 1);
  assert.equal(a.published + b.published, 1);
  // A third run, and Publicera nu afterwards, find nothing to claim.
  assert.equal((await runDueWith(run.deps, now)).due, 0);
  assert.equal((await runClaimed(run.deps, "one", now, "admin-b")).claimed, false);
});

test("a failure that may pass is tried again with backoff; the last one fails and mails the admins once", async () => {
  let now = new Date("2026-11-11T07:00:00Z");
  const { store, rows } = memoryStore([itemAt("net", now)]);
  const run = deps(store, async () => ({ kind: "retry", message: "Facebook svarade inte." }));
  await runDueWith(run.deps, now);
  assert.equal(rows.get("net")!.status, "scheduled");
  assert.equal(rows.get("net")!.nextAttemptAt.toISOString(), "2026-11-11T07:05:00.000Z");
  assert.equal(run.mails.length, 0);
  for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt += 1) { now = rows.get("net")!.nextAttemptAt; await runDueWith(run.deps, now); }
  assert.equal(rows.get("net")!.status, "failed");
  assert.equal(rows.get("net")!.lastError, "Facebook svarade inte.");
  assert.equal(run.published.length, MAX_ATTEMPTS);
  assert.deepEqual(run.mails, ["net:Facebook svarade inte."]);
  await runDueWith(run.deps, new Date(now.getTime() + 86_400_000));
  assert.equal(run.mails.length, 1, "never mailed twice");
});

test("a refusal (publishing off, changed content) fails at once with its reason", async () => {
  const now = new Date("2026-11-11T07:00:00Z");
  const { store, rows } = memoryStore([itemAt("off", now)]);
  const run = deps(store, async () => ({ kind: "fail", message: "Publicering är avstängd." }));
  await runDueWith(run.deps, now);
  assert.equal(rows.get("off")!.status, "failed");
  assert.equal(rows.get("off")!.lastError, "Publicering är avstängd.");
  assert.equal(run.mails.length, 1);
});

test("an admin who left the company (or lost the role) publishes nothing", async () => {
  const now = new Date("2026-11-11T07:00:00Z");
  const { store, rows } = memoryStore([itemAt("left", now)]);
  const run = deps(store, async () => ({ kind: "published", message: "ok" }), async () => "Den som schemalade är inte längre administratör i företaget. Schemalägg igen.");
  await runDueWith(run.deps, now);
  assert.equal(run.published.length, 0);
  assert.equal(rows.get("left")!.status, "failed");
  assert.match(rows.get("left")!.lastError ?? "", /administratör/);
});

test("Publicera nu runs as the person who pressed it, through the same claim", async () => {
  const now = new Date("2026-11-11T07:00:00Z");
  const { store, rows } = memoryStore([itemAt("now", now)]);
  const run = deps(store, async () => ({ kind: "published", message: "ok" }), async () => "should not be asked");
  const result = await runClaimed(run.deps, "now", now, "admin-b");
  assert.equal(result.status, "published");
  assert.deepEqual(run.published, ["now:admin-b"]);
  assert.equal(rows.get("now")!.status, "published");
});

test("an item that stopped half-way fails and is never tried again by itself", async () => {
  const now = new Date("2026-11-11T07:00:00Z");
  const { store, rows } = memoryStore([itemAt("stuck", now, { status: "running" })]);
  rows.get("stuck")!.lockedUntil = new Date(now.getTime() - 1);
  const run = deps(store, async () => ({ kind: "published", message: "ok" }));
  const result = await runDueWith(run.deps, new Date(now.getTime() + LOCK_MS));
  assert.equal(result.stale, 1);
  assert.equal(run.published.length, 0);
  assert.equal(rows.get("stuck")!.status, "failed");
  assert.equal(rows.get("stuck")!.lastError, STOPPED_HALF_WAY);
  assert.equal(run.mails.length, 1);
});

test("a publisher that throws counts as a failure that may pass, and the rest of the run goes on", async () => {
  const now = new Date("2026-11-11T07:00:00Z");
  const { store, rows } = memoryStore([itemAt("a", now), itemAt("b", now)]);
  const run = deps(store, async (item) => { if (item.id === "a") throw new Error("socket hang up"); return { kind: "published", message: "ok" }; });
  await runDueWith(run.deps, now);
  assert.equal(rows.get("a")!.status, "scheduled");
  assert.equal(rows.get("b")!.status, "published");
});

// ---------- series ----------

test("a series' default: a month from the start day, Monday, Wednesday and Friday at 08:00", () => {
  assert.equal(seriesEndDay("2026-11-16", "1m"), "2026-12-15");
  assert.equal(seriesEndDay("2027-01-31", "1m"), "2027-02-27", "31 January + a month is the last of February");
  assert.equal(seriesEndDay("2026-11-16", "2w"), "2026-11-29");
  const slots = seriesSlots({ startDay: "2026-11-16", endDay: "2026-12-15", weekdays: [0, 2, 4], time: "08:00" }, new Date("2026-11-11T12:00:00Z"));
  assert.equal(slots.length, 13);
  assert.equal(slots[0].day, "2026-11-16");
  assert.equal(slots[0].at.toISOString(), "2026-11-16T07:00:00.000Z");
  assert.ok(slots.every((slot) => [0, 2, 4].includes(slot.weekday) && swedishParts(slot.at).hour === 8 && swedishParts(slot.at).minute === 0));
  assert.equal(slots.at(-1)!.day, "2026-12-14");
});

test("series slots keep 08:00 over the change to summer time and leave out the hour that does not exist", () => {
  const now = new Date("2027-03-01T00:00:00Z");
  const slots = seriesSlots({ startDay: "2027-03-22", endDay: "2027-04-04", weekdays: [0, 4], time: "08:00" }, now);
  assert.deepEqual(slots.map((slot) => slot.at.toISOString()), ["2027-03-22T07:00:00.000Z", "2027-03-26T07:00:00.000Z", "2027-03-29T06:00:00.000Z", "2027-04-02T06:00:00.000Z"]);
  const night = seriesSlots({ startDay: "2027-03-28", endDay: "2027-03-28", weekdays: [6], time: "02:30" }, now);
  assert.equal(night.length, 0, "02:30 the night the clock is put forward");
});

test("past slots are left out, and a plan without weekdays or with a bad day is refused", () => {
  const slots = seriesSlots({ startDay: "2026-11-09", endDay: "2026-11-15", weekdays: [0, 2, 4], time: "08:00" }, new Date("2026-11-11T12:00:00Z"));
  assert.deepEqual(slots.map((slot) => slot.day), ["2026-11-13"]);
  assert.match(seriesPlanProblem({ startDay: "2026-11-16", endDay: "2026-12-15", weekdays: [], time: "08:00" }) ?? "", /veckodag/);
  assert.match(seriesPlanProblem({ startDay: "2026-02-30", endDay: "2026-03-15", weekdays: [0], time: "08:00" }) ?? "", /startdag/);
  assert.match(seriesPlanProblem({ startDay: "2026-11-16", endDay: "2026-12-15", weekdays: [0], time: "8" }) ?? "", /klockslag/);
  assert.equal(nextMonday(new Date("2026-11-11T12:00:00Z")), "2026-11-16");
  assert.equal(nextMonday(new Date("2026-11-16T12:00:00Z")), "2026-11-23", "on a Monday: the next one");
});

test("one theme per slot, the catalogue round again, never the same twice in a row; the operator's website only when asked", () => {
  const themes = proposeThemes(30);
  assert.equal(themes.length, 30);
  for (let index = 1; index < themes.length; index += 1) assert.notEqual(themes[index], themes[index - 1]);
  const siteThemes = SERIES_THEMES.filter((theme) => theme.operatorSite).map((theme) => theme.id);
  assert.deepEqual(siteThemes, (OPERATOR_SITE?.themes ?? []).map((theme) => theme.id), "the operator's website brings its own themes, the community edition none");
  for (const id of siteThemes) {
    assert.ok(!themes.includes(id), id);
    assert.ok(proposeThemes(30, { includeOperatorSite: true }).includes(id), id);
  }
  assert.ok(!proposeThemes(20, { exclude: ["ai"] }).includes("ai"));
  for (const theme of SERIES_THEMES) assert.ok(theme.facts.length >= 2 && theme.facts.every((fact) => fact.endsWith(".")), theme.id);
});

// ---------- the AI draft: facts only ----------

test("the model gets the theme's facts and the channels, and nothing about the company", () => {
  const theme = themeOf("machine-alarms")!;
  const input = JSON.parse(seriesDraftInput(theme, ["facebook", "instagram"]));
  assert.deepEqual(Object.keys(input).sort(), ["fakta", "funktion", "kanaler"]);
  assert.deepEqual(input.fakta, theme.facts);
  assert.deepEqual(input.kanaler, ["Facebook", "Instagram"]);
  assert.match(SERIES_DRAFT_INSTRUCTIONS, /Skriv bara det som står i fakta/);
  assert.match(SERIES_DRAFT_INSTRUCTIONS, /priser/);
});

test("an AI draft with an invented price, number, link or promise is replaced by the theme's own text", () => {
  const theme = themeOf("controls")!;
  const good = { heading: "Bygg egna kontroller", body: "Formulär utan kod.", caption: "Du skapar kontroller i formulärbyggaren. Gränsvärdena anger ni själva. #egenkontroll" };
  assert.deepEqual(draftProblems(good, theme), []);
  assert.equal(acceptedDraft(good, theme).source, "ai");
  for (const bad of [
    { ...good, caption: "Bara 149 kr per användare." },
    { ...good, caption: "Spara 30 % tid." },
    { ...good, body: "Läs mer på www.example.se" },
    { ...good, heading: "Gratis i en månad" },
    { ...good, caption: "Marknadens bästa kontroller." },
    { ...good, caption: "" },
  ]) {
    const accepted = acceptedDraft(bad, theme);
    assert.equal(accepted.source, "rules", JSON.stringify(bad));
    assert.deepEqual(accepted.text, templateDraft(theme));
  }
  // A number that is in the facts may be said.
  assert.deepEqual(draftProblems({ ...good, caption: "En PLC skickar larm via 4G-router." }, themeOf("machine-alarms")!), []);
});

test("the rules' own text is the theme's name and facts, within the post's limits", () => {
  for (const theme of SERIES_THEMES) {
    const draft = templateDraft(theme);
    assert.equal(draft.heading, theme.title);
    assert.ok(draft.body.length <= 220 && draft.caption.length <= 2200);
    assert.ok(draft.caption.startsWith(theme.facts[0]));
  }
});
