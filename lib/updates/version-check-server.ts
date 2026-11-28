import "server-only";
import { EE_PRESENT } from "@ee/present";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentAppVersion } from "@/lib/release-notes";
import {
  CHECK_TIMEOUT_MS, newerRelease, parseReleases, resolveUpdateCheckSetting, shouldFetch, updateCheckAvailable, versionAge,
  type PublishedRelease, type UpdateCheckSetting, type VersionAge,
} from "./version-check";

/**
 * Kontrollera nya versioner (K4.8, 2026-11-28), the server's half: the switch and the check itself. The list is read by the
 * server only (the browser never calls GitHub), with a short time limit, at most once a day per running server, and without
 * any header or parameter about the installation. Cloud (with ee/) never calls it, whatever is stored.
 *
 * The switch is kept in SystemSettings.suggestions under "updateCheck" (a JSON column of the installation's row that has no
 * other use), so no schema change is needed; anything but { enabled: true } reads as off.
 */
const RELEASES_URL = "https://api.github.com/repos/Workflow-Workflow/workflow-community/releases?per_page=20";
const SETTING_KEY = "updateCheck";

type Cached = { at: number; releases: PublishedRelease[] | null; failed: boolean };
let cached: Cached | null = null;

export type UpdateCheckState = {
  /** The Community edition offers the check; Cloud never does. */
  available: boolean;
  enabled: boolean;
  version: string;
  age: VersionAge | null;
  /** A newer published version, when the check is on and found one. */
  newer: PublishedRelease | null;
  /** When the list was last read (ISO), or null. */
  checkedAt: string | null;
  /** The list could not be read the last time (it is tried again after a day). */
  failed: boolean;
};

const asObject = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

export async function getUpdateCheckSetting(): Promise<UpdateCheckSetting> {
  if (!updateCheckAvailable(EE_PRESENT)) return { enabled: false };
  try {
    const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { suggestions: true } });
    return resolveUpdateCheckSetting(asObject(row?.suggestions)[SETTING_KEY]);
  } catch {
    return { enabled: false };
  }
}

export async function saveUpdateCheckSetting(enabled: boolean): Promise<UpdateCheckSetting> {
  if (!updateCheckAvailable(EE_PRESENT)) throw new Error("Kontrollera nya versioner finns bara i Community.");
  const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { suggestions: true } });
  const next = { ...asObject(row?.suggestions), [SETTING_KEY]: { enabled } } as Prisma.InputJsonObject;
  await prisma.systemSettings.upsert({ where: { id: "global" }, update: { suggestions: next }, create: { id: "global", suggestions: next } });
  if (!enabled) cached = null;
  return { enabled };
}

async function readReleases(fetcher: typeof fetch): Promise<PublishedRelease[] | null> {
  try {
    const response = await fetcher(RELEASES_URL, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "workflow-community-update-check" },
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const text = await response.text();
    if (text.length > 2_000_000) return null;
    return parseReleases(JSON.parse(text));
  } catch {
    return null;
  }
}

/** The version, its age and, when the switch is on, a newer release. Never throws; a failed read is said, not shown as news. */
export async function updateCheckState({ now = new Date(), fetcher = fetch }: { now?: Date; fetcher?: typeof fetch } = {}): Promise<UpdateCheckState> {
  const available = updateCheckAvailable(EE_PRESENT);
  const version = currentAppVersion();
  const { enabled } = await getUpdateCheckSetting();
  if (shouldFetch({ available, enabled, lastCheckedAt: cached?.at ?? null, now })) {
    const releases = await readReleases(fetcher);
    cached = { at: now.getTime(), releases, failed: releases === null };
  }
  const usable = available && enabled ? cached : null;
  return {
    available, enabled: available && enabled, version, age: versionAge(version, now),
    newer: usable?.releases ? newerRelease(version, usable.releases) : null,
    checkedAt: usable ? new Date(usable.at).toISOString() : null,
    failed: Boolean(usable?.failed),
  };
}
