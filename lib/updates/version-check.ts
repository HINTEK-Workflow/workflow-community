import { compareVersions, RELEASE_NOTES, type ReleaseNote } from "@/lib/release-notes";

/**
 * Besked om uppdateringar i Community (kvalitetsmålen K4.8, 2026-11-28): the app shows its version and how old it is, and an
 * optional setting, "Kontrollera nya versioner", lets the server read the public list of releases of the Community edition.
 * It is off from the start and sends nothing about the installation (no telemetry): one anonymous GET of a public list, from
 * the server only, at most once a day. Cloud (the build with ee/) never asks.
 *
 * Pure: no database, no network (lib/updates/version-check-server.ts does those).
 */

/** A release page must be under the Community repository's own address on GitHub (the list itself: version-check-server.ts). */
const RELEASE_PAGE = /^https:\/\/github\.com\/Workflow-Workflow\/workflow-community\/releases\/tag\/[\w.-]+$/;
export const CHECK_TIMEOUT_MS = 5_000;
export const CHECK_CACHE_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type VersionAge = { version: string; releasedOn: string; days: number };

/** The running version's own day (its note in lib/release-notes.ts) and its age in whole days; null when the note is missing. */
export function versionAge(version: string, now: Date = new Date(), notes: readonly ReleaseNote[] = RELEASE_NOTES): VersionAge | null {
  const note = notes.find((item) => item.version === version);
  if (!note || !/^\d{4}-\d{2}-\d{2}$/.test(note.date)) return null;
  const released = Date.UTC(Number(note.date.slice(0, 4)), Number(note.date.slice(5, 7)) - 1, Number(note.date.slice(8, 10)));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { version, releasedOn: note.date, days: Math.max(0, Math.round((today - released) / DAY_MS)) };
}

/** The age in plain Swedish: "från i dag", "1 dag gammal", "12 dagar gammal", "3 månader gammal", "2 år gammal". */
export function describeAge(days: number) {
  if (days <= 0) return "från i dag";
  if (days < 60) return `${days} ${days === 1 ? "dag" : "dagar"} gammal`;
  if (days < 730) return `${Math.floor(days / 30)} månader gammal`;
  return `${Math.floor(days / 365)} år gammal`;
}

export type PublishedRelease = { version: string; url: string; publishedAt: string | null };

/**
 * The GitHub answer (an array of releases) → the published versions, newest first. Drafts, pre-releases, tags that are not
 * vX.Y.Z and links outside the repository's own release pages are left out; anything else than an array gives [].
 */
export function parseReleases(payload: unknown): PublishedRelease[] {
  if (!Array.isArray(payload)) return [];
  const found = new Map<string, PublishedRelease>();
  for (const item of payload.slice(0, 100)) {
    if (!item || typeof item !== "object") continue;
    const release = item as Record<string, unknown>;
    if (release.draft === true || release.prerelease === true) continue;
    const tag = typeof release.tag_name === "string" ? release.tag_name.trim() : "";
    const match = /^v(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(tag);
    const url = typeof release.html_url === "string" ? release.html_url : "";
    if (!match || !RELEASE_PAGE.test(url)) continue;
    const version = `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
    const publishedAt = typeof release.published_at === "string" && !Number.isNaN(Date.parse(release.published_at)) ? new Date(release.published_at).toISOString() : null;
    if (!found.has(version)) found.set(version, { version, url, publishedAt });
  }
  return [...found.values()].sort((left, right) => compareVersions(right.version, left.version));
}

/** The newest release that is newer than the running version, or null. */
export function newerRelease(current: string, releases: readonly PublishedRelease[]): PublishedRelease | null {
  const newest = releases[0] ?? null;
  return newest && compareVersions(newest.version, current) > 0 ? newest : null;
}

export type UpdateCheckSetting = { enabled: boolean };

/** The stored switch; anything but an explicit true is off (off from the start, 2026-11-27: no telemetry). */
export function resolveUpdateCheckSetting(stored: unknown): UpdateCheckSetting {
  const value = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  return { enabled: value.enabled === true };
}

/** Only the Community edition (no ee/) may offer or run the check; Cloud never calls GitHub for it. */
export const updateCheckAvailable = (eePresent: boolean) => !eePresent;

/** Whether the server should ask now: available, switched on, and nothing asked within a day (a failure waits as long). */
export function shouldFetch({ available, enabled, lastCheckedAt, now = new Date() }: { available: boolean; enabled: boolean; lastCheckedAt: number | null; now?: Date }) {
  if (!available || !enabled) return false;
  return lastCheckedAt === null || now.getTime() - lastCheckedAt >= CHECK_CACHE_MS;
}
