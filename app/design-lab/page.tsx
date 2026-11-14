import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { DEMO_COOKIE } from "@/lib/demo";
import { DesignLab } from "@/features/design-lab/design-lab";
import { LAB_SECTIONS, type LabSection, type LabView } from "@/features/design-lab/data";

export const dynamic = "force-dynamic";

/**
 * Designlabbet (2026-10-16): an internal page for trying a new basic look before deciding whether it goes into
 * the whole of Workflow. Not in the menu, never indexed, example data in memory only. Signed-in people only – or a
 * visitor in the public demo (the demo cookie), so the page can be tried against the demo without a database.
 *
 * Since 2026-10-16 the look is the whole app's: the typefaces come from app/layout.tsx and the lab reads the global tokens.
 */

export const metadata: Metadata = {
  title: "Designlabb",
  robots: { index: false, follow: false },
};

export default async function DesignLabPage({ searchParams }: { searchParams: Promise<{ visning?: string; del?: string }> }) {
  const params = await searchParams;
  const demo = (await cookies()).get(DEMO_COOKIE)?.value === "1";
  if (!demo && !(await getCurrentUser())) redirect(`/login?returnTo=${encodeURIComponent("/design-lab")}`);
  const view = Number(params.visning);
  const initialView: LabView | null = view === 1 || view === 2 || view === 3 ? view : null;
  const initialSection: LabSection = LAB_SECTIONS.find((section) => section.id === params.del)?.id ?? "inkop";
  return <DesignLab initialView={initialView} initialSection={initialSection} />;
}
