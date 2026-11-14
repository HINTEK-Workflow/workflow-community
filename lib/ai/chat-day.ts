import { formatSwedish } from "@/lib/swedish-time";

/**
 * The day a message in Workflow AI's chat belongs to, as a messenger shows it between the bubbles (2026-11-02): Idag, Igår or
 * the date, in Swedish time. Pure, with the present as an argument for the tests.
 */
export function chatDayLabel(at: string | Date, now: Date = new Date()): string {
  const day = (value: Date) => formatSwedish(value, { dateStyle: "short" });
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  if (day(date) === day(now)) return "Idag";
  if (day(date) === day(new Date(now.getTime() - 86_400_000))) return "Igår";
  return day(date);
}
