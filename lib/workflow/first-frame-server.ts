import { cache } from "react";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { DEMO_COOKIE } from "@/lib/demo";
import { defaultDetailLevels, type DetailLevels } from "@/lib/workflow/detail-level";
import { effectiveDetailLevels, readWorkView } from "@/lib/workflow/work-view";
import { effectiveWorkView, NO_ADMIN_WORK_CHOICES, readWorkProfile, type AdminWorkChoices } from "@/lib/workflow/work-profile";
import { preferencesSchema } from "@/lib/kfid/preferences";
import { ADDRESS_HEADER, NO_FIRST_FRAME, firstFrameFor, shellRouteOf, type FirstFrame } from "@/lib/workflow/first-frame";

// Telefonens första bild (stabil sidladdning steg 4): the root layout and the app's page read the same person and
// preferences in one request; React's cache makes it one database read for both.
export const currentUserOnce = cache(getCurrentUser);
export const preferencesOnce = cache((userId: string) => prisma.userPreferences.findUnique({ where: { userId } }));

type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
type Preferences = Awaited<ReturnType<typeof preferencesOnce>>;

/** The stored preferences as the shell reads them (a JSON object, or nothing). */
export function preferenceObject(preferences: Preferences) {
  const data = preferences?.data;
  return data && typeof data === "object" && !Array.isArray(data)
    ? data as { detailLevel?: { phone?: number; tablet?: number; desktop?: number }; viewBasis?: string | null; ownWorkProfile?: unknown }
    : null;
}

/** What the admin has chosen for the person in the active company; nothing in Local (no members). Display only. */
export function adminWorkChoicesOf(user: CurrentUser): AdminWorkChoices {
  if (user.activeOrganization?.storageMode === "LOCAL") return NO_ADMIN_WORK_CHOICES;
  const membership = user.organizationMemberships.find((member) => member.organization.id === user.activeOrganizationId);
  return { view: readWorkView(membership?.workflowPermissions), profile: readWorkProfile(membership?.workflowPermissions) };
}

/** The work view in force for the person: the admin's, or the yrkesprofil's; never in Local. Display only. */
export function workViewOf(user: CurrentUser, preferences: Preferences) {
  if (user.activeOrganization?.storageMode === "LOCAL") return null;
  return effectiveWorkView(adminWorkChoicesOf(user), preferencesSchema.shape.ownWorkProfile.parse(preferenceObject(preferences)?.ownWorkProfile));
}

/** The display levels the shell is given (app/page.tsx), so the first frame uses exactly the same. */
export function shellDetailLevels(user: CurrentUser, preferences: Preferences): DetailLevels {
  return effectiveDetailLevels(workViewOf(user, preferences), preferenceObject(preferences));
}

/**
 * The first frame for this request (lib/workflow/first-frame.ts), for the root layout's `<html>`. Only the app's own
 * page reads the session here; a failure draws the page as before (the shell's apply() decides after it has loaded).
 */
export async function requestFirstFrame(): Promise<FirstFrame> {
  try {
    const request = await headers();
    const route = shellRouteOf(request.get(ADDRESS_HEADER), (await cookies()).get(DEMO_COOKIE)?.value === "1");
    if (!route) return NO_FIRST_FRAME;
    const hints = {
      userAgent: request.get("user-agent"),
      mobile: request.get("sec-ch-ua-mobile"),
      viewportWidth: request.get("sec-ch-viewport-width"),
      viewportHeight: request.get("sec-ch-viewport-height"),
      fetchDest: request.get("sec-fetch-dest"),
      fetchSite: request.get("sec-fetch-site"),
    };
    // The demo's made-up person has the default levels and no session.
    if (route === "demo") return firstFrameFor({ hints, levels: defaultDetailLevels, signedIn: true });
    const user = await currentUserOnce();
    if (!user) return NO_FIRST_FRAME;
    return firstFrameFor({ hints, levels: shellDetailLevels(user, await preferencesOnce(user.id)), signedIn: true });
  } catch {
    return NO_FIRST_FRAME;
  }
}
