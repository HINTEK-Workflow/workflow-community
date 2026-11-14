import type { MeTabData } from "./me";

/**
 * Hälsningen överst på Jag (2026-10-29: "lägg även till denna som är trevlig för användaren"): the day and the week,
 * a greeting by the Swedish hour and the person's first name, one sentence about the day and four figures – all from the tab's
 * own answer (Förfallet, Gör detta nu, Mina avvikelser, Min plan). Pure, so the page and the tests read the same words. No
 * guessing: a sentence part is left out when its source has nothing.
 */
const NUMBER_WORDS = ["Noll", "En", "Två", "Tre", "Fyra", "Fem", "Sex", "Sju", "Åtta", "Nio", "Tio"];
const word = (count: number, capital = true) => { const text = count <= 10 ? NUMBER_WORDS[count] : String(count); return capital ? text : text.toLowerCase(); };

/** God morgon until ten, God förmiddag until one, God eftermiddag until six, then God kväll (the Swedish clock's hour). */
export function greetingWord(hour: number): string {
  return hour < 10 ? "God morgon" : hour < 13 ? "God förmiddag" : hour < 18 ? "God eftermiddag" : "God kväll";
}

/** The first name of "Elin Bergström"; an e-mail address gives its part before @. */
export const firstName = (name: string) => (name.split("@")[0].trim().split(/\s+/)[0] ?? "").replace(/^./, (letter) => letter.toUpperCase());

export type GreetingFigures = { overdue: number; today: number; deviations: number; laterThisWeek: number };

/** The four figures: late work (Förfallet), today's posts in Min plan, my open deviations, and the plan's posts later this week. */
export function greetingFigures(data: Pick<MeTabData, "today" | "overdue" | "deviations" | "plan" | "week">): GreetingFigures {
  const weekEnd = data.week.days[data.week.days.length - 1]?.date ?? data.today;
  return {
    overdue: data.overdue?.count ?? 0,
    today: data.plan.items.filter((item) => item.date === data.today).length,
    deviations: data.deviations?.count ?? 0,
    laterThisWeek: data.plan.items.filter((item) => item.date > data.today && item.date <= weekEnd).length,
  };
}

/**
 * The day in one or two sentences: what is late ("börja där"), then the first thing to do that is not late, and how many jobs
 * lie after lunch today. A calm line when there is nothing.
 */
export function greetingSentence(data: Pick<MeTabData, "today" | "overdue" | "next" | "plan"> & Partial<Pick<MeTabData, "deviations">>): string {
  const parts: string[] = [];
  const late = data.overdue?.count ?? 0;
  // A machine alarm goes before what is late (2026-11-06: an alarm is something that needs action now).
  const alarm = data.next?.rows.find((row) => row.reason === "alarm");
  if (alarm) parts.push(`Börja med ${alarm.title}.`);
  if (late) parts.push(alarm ? (late === 1 ? "Sedan är en sak förfallen." : `Sedan är ${word(late, false)} saker förfallna.`) : late === 1 ? "En sak är förfallen – börja där." : `${word(late)} saker är förfallna – börja där.`);
  const first = alarm ? undefined : data.next?.rows.find((row) => row.reason !== "overdue" && row.reason !== "round_late");
  const afternoon = data.plan.items.filter((item) => item.date === data.today && item.start && item.start >= "12:00" && item.state !== "done" && (item.kind === "work-order" || item.kind === "activity" || item.kind === "round")).length;
  const after = afternoon ? `${word(afternoon, false)} ${afternoon === 1 ? "post" : "poster"} efter lunch` : "";
  // After what is late: "Nästa: …" (kundresa 2026-11-07, L59: "Sedan QA andra pumprond 1792002968068." read as half a sentence).
  if (first) parts.push(late ? `Nästa: ${first.title}${after ? `, och ${after}` : ""}.` : `Börja med ${first.title}${after ? ` och ${after}` : ""}.`);
  else if (after) parts.push(`Du har ${after}.`);
  // Open deviations of mine are something waiting too (resa 4, 2026-11-06: the calm line stood beside "3 avvikelser").
  const deviations = data.deviations?.count ?? 0;
  if (!parts.length) return deviations ? `Inget är förfallet. Du har ${word(deviations, false)} ${deviations === 1 ? "öppen avvikelse" : "öppna avvikelser"}.` : "Inget är förfallet och inget väntar just nu.";
  return parts.join(" ");
}
