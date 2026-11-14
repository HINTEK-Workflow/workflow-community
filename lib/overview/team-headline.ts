import type { TeamTabData } from "./team-server";

/**
 * Läget i teamet överst på Teamet (2026-10-29, the same idea as Jag's greeting; no total since beslut 15, 2026-11-01): the
 * figures and one sentence from the tab's own answer – who works now and the five groups of Att följa upp, each with its own
 * figure. Pure, so the page and the tests read the same words; nothing is guessed.
 */
const NUMBER_WORDS = ["Noll", "En", "Två", "Tre", "Fyra", "Fem", "Sex", "Sju", "Åtta", "Nio", "Tio"];
/** A count as a word up to ten ("Två", "två"), else digits; Ekonomi's sentence says its numbers the same way. */
export const word = (count: number, capital = true) => { const text = count <= 10 ? NUMBER_WORDS[count] : String(count); return capital ? text : text.toLowerCase(); };

/** Krockar och frånvaro · Hinder · Att godkänna · Förfallet · Ej startat, in that order (2026-11-01). */
export const TEAM_GROUPS = ["conflicts", "obstacles", "approvals", "overdue", "notStarted"] as const;
export type TeamGroup = (typeof TEAM_GROUPS)[number];
export const TEAM_GROUP_TITLE: Record<TeamGroup, string> = { conflicts: "Krockar och frånvaro", obstacles: "Hinder", approvals: "Att godkänna", overdue: "Förfallet", notStarted: "Ej startat" };

type GroupFacts = Pick<TeamTabData, "riskBeforeStart" | "needsAction" | "deviations" | "absence" | "unowned" | "pendingTime" | "overdueJobs" | "lateStarts" | "rounds">;

/**
 * Each group's figure: exactly the rows the group holds.
 * - Krockar och frånvaro: planned work an absence touches.
 * - Hinder: jobs with an obstacle or marked Behöver åtgärdas (the list's filter Hinder) and what must still be reported to the
 *   authority, in time.
 * - Att godkänna: months of time sent in.
 * - Förfallet: jobs and deviations whose end date has passed, and round occurrences not done.
 * - Ej startat: Försenad start (the list's filter), a risk step before a coming start, and work without an owner or a booking.
 * Won quotes without a work order are shown apart and never counted: only those with the quotes right see them, so the figures
 * are the same for everyone who sees the tab (användartest 2026-10-31, K4).
 */
export function teamGroupCounts(data: GroupFacts): Record<TeamGroup, number> {
  return {
    conflicts: data.absence?.affected.length ?? 0,
    obstacles: (data.needsAction?.total ?? 0) + (data.deviations.counts.reportableOnTime ?? 0),
    approvals: data.pendingTime?.total ?? 0,
    overdue: (data.overdueJobs?.total ?? 0) + data.deviations.counts.overdue + (data.rounds?.late ?? 0),
    notStarted: (data.lateStarts?.total ?? 0) + (data.riskBeforeStart?.coming ?? data.riskBeforeStart?.total ?? 0) + (data.unowned?.total ?? 0),
  };
}

export type TeamFigures = { working: number; people: number; groups: Record<TeamGroup, number>; overbooked: number; lateProjects: number; absent: number; missingTime: number; expiring: number };

export function teamFigures(data: TeamTabData): TeamFigures {
  const people = data.now?.people ?? [];
  return {
    working: people.filter((person) => person.running).length,
    people: people.length,
    groups: teamGroupCounts(data),
    overbooked: data.load.people.filter((person) => (person.weeks[0]?.plannedMinutes ?? 0) > (person.weeks[0]?.capacityMinutes ?? 0)).length,
    lateProjects: data.projects?.overdue ?? 0,
    absent: data.absence?.today.length ?? 0,
    missingTime: data.timeGaps?.rows.length ?? 0,
    expiring: data.expiring?.rows.length ?? 0,
  };
}

/** The first thing to take hold of, most pressing first: "Två krockar och ett hinder – börja där.", else the next group's. */
function startHere(groups: Record<TeamGroup, number>): string {
  const pressing = [
    groups.conflicts ? `${word(groups.conflicts)} ${groups.conflicts === 1 ? "krock" : "krockar"}` : "",
    groups.obstacles ? `${groups.obstacles === 1 ? (groups.conflicts ? "ett" : "Ett") : word(groups.obstacles, !groups.conflicts)} hinder` : "",
  ].filter(Boolean).join(" och ");
  if (pressing) return `${pressing} – börja där.`;
  if (groups.approvals) return `${word(groups.approvals)} att godkänna – börja där.`;
  if (groups.overdue) return `${word(groups.overdue)} ${groups.overdue === 1 ? "förfallen" : "förfallna"} – börja där.`;
  if (groups.notStarted) return `${word(groups.notStarted)} ej ${groups.notStarted === 1 ? "startad" : "startade"}.`;
  return "";
}

/** "Två av fyra arbetar just nu. Två krockar och ett hinder – börja där. Ett projekt är förfallet." */
export function teamSentence(data: TeamTabData): string {
  const figures = teamFigures(data);
  const parts: string[] = [];
  if (figures.people) parts.push(figures.working ? `${word(figures.working)} av ${word(figures.people, false)} arbetar just nu.` : "Ingen har tid igång just nu.");
  if (figures.absent) parts.push(figures.absent === 1 ? `${data.absence!.today[0].name.split(" ")[0]} är frånvarande idag.` : `${word(figures.absent)} är frånvarande idag.`);
  const first = startHere(figures.groups);
  if (first) parts.push(first);
  if (figures.missingTime) parts.push(figures.missingTime === 1 ? "En person saknar tidrapport." : `${word(figures.missingTime)} saknar tidrapport.`);
  if (figures.lateProjects) parts.push(figures.lateProjects === 1 ? "Ett projekt är förfallet." : `${word(figures.lateProjects)} projekt är förfallna.`);
  if (figures.overbooked) parts.push(figures.overbooked === 1 ? "En person är överbokad den här veckan." : `${word(figures.overbooked)} personer är överbokade den här veckan.`);
  if (!first && !figures.lateProjects && !figures.overbooked) parts.push("Inget att följa upp.");
  return parts.join(" ");
}
