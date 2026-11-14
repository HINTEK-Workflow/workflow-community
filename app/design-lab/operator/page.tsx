import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { DEMO_COOKIE } from "@/lib/demo";
import { OperatorPage } from "@/features/design-lab/operator-page";

export const dynamic = "force-dynamic";

/**
 * Förslag: operatörssidan (2026-10-30) – a page of its own without the side menu, with a mock sign-in. Example data
 * in memory only, not in the menu, never indexed. Same guard as the design lab: signed in, or a visitor in the public demo.
 */
export const metadata: Metadata = {
  title: "Förslag: operatörssidan",
  robots: { index: false, follow: false },
};

export default async function OperatorProposalPage({ searchParams }: { searchParams: Promise<{ niva?: string }> }) {
  const params = await searchParams;
  const demo = (await cookies()).get(DEMO_COOKIE)?.value === "1";
  if (!demo && !(await getCurrentUser())) redirect(`/login?returnTo=${encodeURIComponent("/design-lab/operator")}`);
  return <OperatorPage initialLevel={params.niva ?? null} />;
}
