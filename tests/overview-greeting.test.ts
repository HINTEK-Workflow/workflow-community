import assert from "node:assert/strict";
import test from "node:test";
import { firstName, greetingFigures, greetingSentence, greetingWord } from "../lib/overview/me-greeting";
import type { MeTabData, PlanItem } from "../lib/overview/me";

const TODAY = "2026-10-29";
const item = (id: string, date: string, start?: string, kind: PlanItem["kind"] = "work-order", state: PlanItem["state"] = "planned"): PlanItem => ({ id, date, kind, title: id, href: "/", state, ...(start ? { start } : {}) });
const data = (over: Partial<MeTabData> = {}) => ({
  today: TODAY,
  overdue: { count: 2, tasks: 1, rounds: 1, rows: [], href: "", tasksHref: "", roundsHref: "" },
  deviations: { count: 3, overdue: 1, rows: [], href: "", mineHref: "" },
  next: { rows: [
    { id: "r", title: "Skyddsrond", href: "/", reason: "round_late" as const, chip: "", pressing: true },
    { id: "a", title: "Laddplatserna i garaget", href: "/", reason: "booked_today" as const, chip: "", pressing: false },
  ] },
  plan: { month: "2026-10", from: "2026-10-01", to: "2026-10-31", items: [item("m", TODAY, "07:00", "activity"), item("x", TODAY, "13:00"), item("y", TODAY, "14:00"), item("z", TODAY, "15:00", "activity", "done"), item("w", "2026-10-30"), item("v", "2026-11-01"), item("old", "2026-10-28")] },
  week: { from: "2026-10-26", reportedMinutes: 0, ordinaryMinutes: 2400, days: ["26", "27", "28", "29", "30", "31"].map((d) => ({ date: `2026-10-${d}`, minutes: 0 })).concat([{ date: "2026-11-01", minutes: 0 }]), href: "" },
  ...over,
}) as MeTabData;

test("Hälsningen: the greeting by the hour and the first name", () => {
  assert.equal(greetingWord(7), "God morgon");
  assert.equal(greetingWord(11), "God förmiddag");
  assert.equal(greetingWord(15), "God eftermiddag");
  assert.equal(greetingWord(20), "God kväll");
  assert.equal(firstName("Elna Strömtång"), "Elna");
  assert.equal(firstName("anna@exempel.se"), "Anna");
});

test("Hälsningen: one sentence from the tab's own figures – late first, then the first thing to do and the afternoon", () => {
  assert.equal(greetingSentence(data()), "Två saker är förfallna – börja där. Nästa: Laddplatserna i garaget, och två poster efter lunch.");
  assert.equal(greetingSentence(data({ overdue: null })), "Börja med Laddplatserna i garaget och två poster efter lunch.");
  // A machine alarm goes before what is late (2026-11-06).
  const alarmRow = { id: "l", title: "Larm: Motor 2 överström", href: "/", reason: "alarm" as const, chip: "", pressing: true };
  assert.equal(greetingSentence(data({ next: { rows: [alarmRow, ...data().next!.rows] } })), "Börja med Larm: Motor 2 överström. Sedan är två saker förfallna. Du har två poster efter lunch.");
  assert.equal(greetingSentence(data({ overdue: null, next: { rows: [] }, plan: { ...data().plan, items: [] } })), "Inget är förfallet. Du har tre öppna avvikelser.");
  assert.equal(greetingSentence(data({ overdue: null, deviations: null, next: { rows: [] }, plan: { ...data().plan, items: [] } })), "Inget är förfallet och inget väntar just nu.");
  assert.deepEqual(greetingFigures(data()), { overdue: 2, today: 4, deviations: 3, laterThisWeek: 2 });
});
