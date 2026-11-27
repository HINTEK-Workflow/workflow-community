import { swedishDayKey } from "@/lib/swedish-time";
import { WHOLESALER_LABELS } from "@/lib/wholesale/model";

/**
 * Gäller till (2026-11-14: "Lägg till utgångdatum … så att det larmar på mailen och att jag ser det på kortet. Vissa
 * nycklar har utgångdatum och vissa vilka vet jag inte"): an optional last day per key card on Tjänster och nycklar. Not a
 * secret: kept beside the central keys (SystemSettings.centralSecrets, the part `keyExpiry`, lib/secrets/central-store.ts),
 * one date per card – a card with several fields (Google, Lantmäteriet) has one date, the day the first of them stops working.
 *
 * Rules (pure, no clock of its own):
 * - the date is the key's LAST valid day, written ÅÅÅÅ-MM-DD and counted in Swedish time; a past date may be saved (the key
 *   is then shown as expired – it may be what the service says), an empty value removes the date;
 * - on the card: neutral while more than 30 days are left, a warning at 30 days or fewer, danger once the day has passed;
 * - the e-mail alarm (scripts/secrets/run-sync.ts): 30, 14, 7 and 1 day(s) before, each stage once, then once a week while
 *   it is expired. The mark holds the date, so a new date starts over.
 */
export const KEY_EXPIRY_IDS = [
  "stripe_secret", "stripe_webhook", "openai", "google", "solar", "ahlsell", "rexel", "sonepar", "smtp", "integration_keys", "auth",
  "scb", "microsoft", "azure", "map", "github",
] as const;
export type KeyExpiryId = (typeof KEY_EXPIRY_IDS)[number];
export const isKeyExpiryId = (value: string): value is KeyExpiryId => (KEY_EXPIRY_IDS as readonly string[]).includes(value);

/** The card's name, as the alarm and the history say it. */
export const KEY_EXPIRY_LABELS: Record<KeyExpiryId, string> = {
  stripe_secret: "Stripe – hemlig nyckel", stripe_webhook: "Stripe – webhookhemlighet", openai: "OpenAI – API-nyckel (Community)", google: "Google-inloggning",
  solar: `${WHOLESALER_LABELS.solar} – API`, ahlsell: `${WHOLESALER_LABELS.ahlsell} – API`, rexel: `${WHOLESALER_LABELS.rexel} – API`, sonepar: `${WHOLESALER_LABELS.sonepar} – API`,
  smtp: "E-post (SMTP)", integration_keys: "Kryptering av externa nycklar", auth: "Inloggningshemlighet",
  scb: "Företagsuppslag (SCB)", microsoft: "Inloggning med Microsoft", azure: "Microsoft Azure (Workflow AI)", map: "Lantmäteriet", github: "GitHub-ärenden",
};
/** The cards Cloud does not have (2026-11-21, F11: Workflow AI runs only on Azure, so no OpenAI key card). */
export const COMMUNITY_ONLY_EXPIRY_IDS: readonly KeyExpiryId[] = ["openai"];
/**
 * Cards that already know their last day in their own way, so they are never asked twice: SCB's key has its own Giltig till
 * on its card (SystemSettings.companyLookup.validUntil, 2026-10-03). The alarm and the page's count treat it as any date.
 */
export const OWN_EXPIRY_IDS: readonly KeyExpiryId[] = ["scb"];
/** The cards only an installation with billing (the commercial part) has. */
export const BILLING_EXPIRY_IDS: readonly KeyExpiryId[] = ["stripe_secret", "stripe_webhook", "github"];

export const WARN_DAYS = 30;
const DAY_MS = 86_400_000;

/** Why a typed date cannot be saved, or null. "" is allowed (no date). */
export function expiryDateProblem(value: string): string | null {
  if (value === "") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "Skriv datumet som ÅÅÅÅ-MM-DD.";
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "Datumet finns inte.";
  if (year < 2000 || year > 2100) return "Välj ett datum mellan år 2000 och 2100.";
  return null;
}

/** Whole days from today (Swedish time) to the last day: 0 = the last day is today, negative = expired. */
export function expiryDaysLeft(day: string, now = new Date()): number {
  const today = Date.parse(`${swedishDayKey(now)}T00:00:00Z`);
  return Math.round((Date.parse(`${day}T00:00:00Z`) - today) / DAY_MS);
}

/** The indicator tone (features/workflow/indicator-tone.ts) the card shows the date in. */
export type ExpiryTone = "neutral" | "warning" | "danger";
export type ExpiryView = { on: string; daysLeft: number; tone: ExpiryTone; text: string; expired: boolean; soon: boolean };

/** What the card says: "Gäller till 2027-11-14 (365 dagar kvar)". */
export function expiryView(on: string, now = new Date()): ExpiryView {
  const daysLeft = expiryDaysLeft(on, now);
  const expired = daysLeft < 0;
  const soon = !expired && daysLeft <= WARN_DAYS;
  const left = expired ? `gick ut för ${-daysLeft} ${-daysLeft === 1 ? "dag" : "dagar"} sedan`
    : daysLeft === 0 ? "sista dagen i dag" : `${daysLeft} ${daysLeft === 1 ? "dag" : "dagar"} kvar`;
  return { on, daysLeft, expired, soon, tone: expired ? "danger" : soon ? "warning" : "neutral", text: `Gäller till ${on} (${left})` };
}

/** The alarm a date is due for now: "30", "14", "7", "1" days before, or "ute" (expired); null when none. */
export type ExpiryStage = "30" | "14" | "7" | "1" | "ute";
export function expiryStage(daysLeft: number): ExpiryStage | null {
  if (daysLeft < 0) return "ute";
  if (daysLeft <= 1) return "1";
  if (daysLeft <= 7) return "7";
  if (daysLeft <= 14) return "14";
  if (daysLeft <= WARN_DAYS) return "30";
  return null;
}

/**
 * The mark of the alarm due now, or null: the date and the stage, and while expired the week since the last day (so it is
 * sent once a week). An alarm is sent when the mark differs from the one stored after the last alarm.
 */
export function expiryAlarmMark(on: string, now = new Date()): string | null {
  const daysLeft = expiryDaysLeft(on, now);
  const stage = expiryStage(daysLeft);
  if (!stage) return null;
  return `${on}:${stage}${stage === "ute" ? Math.floor((-daysLeft - 1) / 7) : ""}`;
}

export type ExpiryAlarm = { id: string; label: string; on: string; mark: string; view: ExpiryView };

/** The alarms due now: one per key whose mark differs from the one stored (`alarmed`). */
export function dueExpiryAlarms(items: { id: string; label: string; on: string }[], alarmed: Record<string, string | undefined>, now = new Date()): ExpiryAlarm[] {
  return items.flatMap((item) => {
    const mark = expiryAlarmMark(item.on, now);
    return mark && alarmed[item.id] !== mark ? [{ ...item, mark, view: expiryView(item.on, now) }] : [];
  });
}

/** The alarm's subject and text for one or more keys. */
export function expiryAlarmText(alarms: ExpiryAlarm[]): { subject: string; text: string } {
  const expired = alarms.some((alarm) => alarm.view.expired);
  const subject = alarms.length === 1
    ? `${alarms[0].label}: ${alarms[0].view.expired ? "nyckeln har gått ut" : "nyckeln går snart ut"}`
    : expired ? "Nycklar har gått ut eller går snart ut" : "Nycklar går snart ut";
  const lines = alarms.map((alarm) => `${alarm.label}: ${alarm.view.text.replace(/^Gäller/, "gäller")}.`);
  return { subject, text: `${lines.join("\n")}\n\nByt nyckeln hos tjänsten, lägg in den nya under Tjänster och nycklar och ändra Gäller till på kortet. En utgången nyckel påminns om en gång i veckan.` };
}

/** How many dated keys have expired and how many expire within 30 days (the page's overview). */
export function expiryCounts(dates: (string | null | undefined)[], now = new Date()) {
  let expired = 0, soon = 0;
  for (const on of dates) {
    if (!on) continue;
    const view = expiryView(on, now);
    if (view.expired) expired += 1; else if (view.soon) soon += 1;
  }
  return { expired, soon };
}
