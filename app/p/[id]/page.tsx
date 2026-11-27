import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * The address on a place's QR label (2026-10-04). Scanned with the phone's camera: a signed-out person is sent to
 * the login and then back here; a signed-in person goes to the place (`scan=1`). The label leads only to a job made
 * beforehand (2026-10-22): the place page opens the round protocol that is open there at the scanned point (a short
 * choice when there are several, "Inget planerat jobb här" when there is none) and never creates a job by itself
 * (lib/workflow/place-scan.ts). A round there with nothing started asks "Starta ronden?" first (svar 10, 2026-10-24):
 * only the person's Starta creates the protocol. The place page itself checks that the place belongs to the person's company.
 */
export default async function PlaceLabel({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const safe = /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : "";
  if (!safe) redirect("/");
  const user = await getCurrentUser();
  if (!user) redirect(`/login?returnTo=${encodeURIComponent(`/p/${safe}`)}`);
  redirect(`/?view=place&placeId=${encodeURIComponent(safe)}&scan=1`);
}
