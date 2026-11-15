import assert from "node:assert/strict";
import test from "node:test";
import { nowPeople } from "../lib/overview/team-model";
import { teamFigures, teamGroupCounts, teamSentence } from "../lib/overview/team-headline";
import type { TeamTabData } from "../lib/overview/team-server";

const NOW = new Date("2026-10-29T13:00:00.000Z");
const base = (): TeamTabData => ({
  today: "2026-10-29",
  now: { people: [
    { id: "a", name: "Anna", todayMinutes: 120, running: { title: "Laddboxar", href: "/a", since: "2026-10-29T11:00:00.000Z", project: false } },
    { id: "b", name: "Bo", todayMinutes: 0, running: null },
  ] },
  needsAction: { total: 1, rows: [] },
  overdueJobs: { total: 2, rows: [], href: "" },
  lateStarts: { total: 3, rows: [], href: "" },
  load: { weeks: [{ key: "this", week: 44, startsOn: "2026-10-26", endsOn: "2026-11-01" }], href: "", people: [
    { id: "a", name: "Anna", weeks: [{ plannedMinutes: 2700, capacityMinutes: 2400 }] },
    { id: "b", name: "Bo", weeks: [{ plannedMinutes: 600, capacityMinutes: 2400 }] },
  ] },
  riskBeforeStart: { total: 1, coming: 1, rows: [] },
  deviations: { scope: "company", counts: { open: 2, overdue: 1, withoutResponsible: 0, systematic: 0 }, rows: [], links: { open: "", overdue: "" } },
  acceptedQuotes: { total: 0, rows: [], prices: true, href: "" },
  projects: { ongoing: 4, overdue: 1, overBudget: 0, readyToClose: 0, needsActionJobs: 1, links: { ongoing: "", overdue: "", overBudget: "", readyToClose: "", needsAction: "" } },
  rounds: null, safety: null,
});

test("Läget i teamet: the figures and the sentence come from the tab's own answer", () => {
  // Beslut 15 (2026-11-01): no total, each group its own figure.
  const groups = { conflicts: 0, obstacles: 1, approvals: 0, overdue: 3, notStarted: 4 };
  assert.deepEqual(teamGroupCounts(base()), groups, "Hinder: Behöver åtgärdas; Förfallet: jobs + a deviation; Ej startat: Försenad start + a risk step");
  // Anmälningspliktig (användartest 2026-10-31, fel 3): one still to be reported is listed under Hinder before it is late.
  assert.equal(teamGroupCounts({ ...base(), deviations: { ...base().deviations, counts: { ...base().deviations.counts, reportable: 2, reportableOnTime: 1 } } }).obstacles, 2);
  const withQuotes = { ...base(), acceptedQuotes: { total: 75, rows: [], prices: true, href: "" } };
  assert.equal(teamGroupCounts(withQuotes).notStarted, groups.notStarted, "won quotes are never in a figure (K4): the figures are the same for everyone");
  assert.equal(teamGroupCounts({ ...base(), rounds: { notDone: 0, late: 2, href: "" } }).overdue, 5, "late round occurrences are Förfallet");
  assert.deepEqual(teamFigures(base()), { working: 1, people: 2, groups, overbooked: 1, lateProjects: 1, absent: 0, missingTime: 0, expiring: 0 });
  // Frånvaro (2026-10-29): who is away is said, and the work it touches is a krock.
  const away = { ...base(), absence: { canRegister: true, today: [{ userId: "b", name: "Bo Ek", label: "Sjuk", to: "2026-10-29" }], affected: [{ key: "k", absenceId: "x", userId: "b", kind: "booking" as const, id: "b1", title: "Jordfel", day: "2026-10-29", href: "/", backOn: "2026-10-30", personName: "Bo Ek", label: "Sjuk", suggestions: [] }] } };
  assert.equal(teamGroupCounts(away).conflicts, 1);
  assert.match(teamSentence(away), /^En av två arbetar just nu\. Bo är frånvarande i dag\. En krock och ett hinder – börja där\./);
  assert.equal(teamSentence(base()), "En av två arbetar just nu. Ett hinder – börja där. Ett projekt är förfallet. En person är överbokad den här veckan.");
  const calm = { ...base(), now: { people: [{ id: "b", name: "Bo", todayMinutes: 0, running: null }] }, needsAction: { total: 0, rows: [] }, overdueJobs: null, lateStarts: null, riskBeforeStart: { total: 0, rows: [] },
    deviations: { ...base().deviations, counts: { open: 0, overdue: 0, withoutResponsible: 0, systematic: 0 } }, projects: { ...base().projects!, overdue: 0 }, load: { ...base().load, people: [] } };
  assert.equal(teamSentence(calm), "Ingen har tid igång just nu. Inget att följa upp.");
});

test("Just nu: those working first (longest running on top), today's time includes a running entry", () => {
  const people = nowPeople([{ id: "a", name: "Anna" }, { id: "b", name: "Bo" }, { id: "c", name: "Cia" }],
    [{ userId: "c", startedAt: "2026-10-29T12:00:00.000Z", title: "Mätning", href: null, project: false }, { userId: "b", startedAt: "2026-10-29T11:00:00.000Z", title: "Laddbox", href: "/b", project: false }],
    [{ userId: "b", startedAt: "2026-10-29T07:00:00.000Z", endedAt: "2026-10-29T09:00:00.000Z", durationSec: 7200 }, { userId: "b", startedAt: "2026-10-29T11:00:00.000Z", endedAt: null, durationSec: 0 }], NOW);
  assert.deepEqual(people.map((person) => person.id), ["b", "c", "a"]);
  assert.equal(people[0].todayMinutes, 240, "2 h done + 2 h running");
  assert.equal(people[2].running, null);
});
