import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { DEMO_COOKIE } from "@/lib/demo";
import { WorkOrderHolderProposal } from "@/features/design-lab/work-order-holder";

export const dynamic = "force-dynamic";

/**
 * Förslag: arbetsordern som hållare (2026-10-30). A proposal to click through, next to the design lab: example
 * data in memory only, not in the menu, never indexed. Signed-in people only – or a visitor in the public demo.
 */
export const metadata: Metadata = {
  title: "Förslag: arbetsordern som hållare",
  robots: { index: false, follow: false },
};

export default async function WorkOrderHolderPage({ searchParams }: { searchParams: Promise<{ vy?: string; niva?: string }> }) {
  const params = await searchParams;
  const demo = (await cookies()).get(DEMO_COOKIE)?.value === "1";
  if (!demo && !(await getCurrentUser())) redirect(`/login?returnTo=${encodeURIComponent("/design-lab/arbetsorder-hallare")}`);
  return <WorkOrderHolderProposal initialView={params.vy ?? null} initialLevel={params.niva ?? null} />;
}
