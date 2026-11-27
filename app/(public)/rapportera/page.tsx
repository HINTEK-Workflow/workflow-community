import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { REPORT_PATH } from "@ee/present";
import { AuthShell } from "@/features/auth/components/auth-shell";
import { ReportPageForm } from "@/features/report/report-page-form";
import { publicInstance } from "@/lib/instance";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return { title: `Rapportera fel eller förslag | ${publicInstance().name}`, robots: { index: false, follow: false } };
}

/**
 * Rapportera fel eller förslag (2026-11-13): a public page with a plain form, linked from the landing page's footer, the
 * profile menu and the demo. Only with the commercial part; without it the page does not exist. ?fran=demo when the demo
 * opened it, ?sida= the page the person came from (the app's own link).
 */
export default async function ReportPage({ searchParams }: { searchParams: Promise<{ fran?: string; sida?: string }> }) {
  if (!REPORT_PATH) notFound();
  const { fran, sida } = await searchParams;
  return (
    <AuthShell title="Rapportera fel eller förslag" description="Berätta vad som inte fungerar eller vad som kan bli bättre.">
      <ReportPageForm source={fran === "demo" ? "demo" : undefined} page={typeof sida === "string" ? sida.slice(0, 300) : undefined} />
    </AuthShell>
  );
}
