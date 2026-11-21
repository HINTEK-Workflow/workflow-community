import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-shell";
import { NoPermission } from "@/features/kfid/ui";
import { PlcSimulator } from "@/features/plc-simulator/plc-simulator";
import { publishedDeviceDesigns } from "@/lib/machine/simulator/device-designs-server";
import { DEMO_COOKIE, DEMO_SIMULATOR_EXAMPLE } from "@/lib/demo";
import { preferencesSchema } from "@/lib/kfid/preferences";
import { PAUSED_COMPANY_TEXT } from "@/lib/kfid/paused-company";
import { ApiError, context } from "@/lib/kfid/server";
import { preferenceObject, preferencesOnce } from "@/lib/workflow/first-frame-server";
import { organizationModuleOn } from "@/lib/workflow/modules";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "PLC-simulator", robots: { index: false, follow: false } };

function Refusal({ children }: { children: ReactNode }) {
  return <main className="mx-auto w-full max-w-4xl space-y-5 px-4 py-8 sm:px-8">
    <PageHeader title="PLC-simulator" />
    {children}
  </main>;
}

/**
 * PLC-simulatorn (2026-11-02): a page of its own, without the workspace menu, opened in a new window from Maskiner. Same
 * check as the machine sources (lib/api-handlers/machine-sources.ts), so the page gets the answer that page gets. It reads the
 * session this once, for access and the look; everything the simulator then does goes through the machine intake with the
 * source's key, as an outside device does.
 */
export default async function PlcSimulatorPage({ searchParams }: { searchParams: Promise<{ exempel?: string | string[]; wf?: string | string[] }> }) {
  // The public demo (2026-11-04): the simulator runs in the browser, so it needs no session. The cookie grants nothing: no data is read here, and Maskinkoppling is the demo's own Demokoppling to its Workflow window, in the browser. The address's two words are read only here, in the demo's branch.
  if ((await cookies()).get(DEMO_COOKIE)?.value === "1") {
    const look = preferencesSchema.parse({});
    const { exempel, wf } = await searchParams;
    return <PlcSimulator demo demoExample={exempel === DEMO_SIMULATOR_EXAMPLE} demoWindow={typeof wf === "string" && /^wf-[a-z0-9]{1,32}$/.test(wf) ? wf : null} upkeepOn theme={look.theme} textScale={Number(look.textScale)} designs={await publishedDeviceDesigns()} />;
  }
  const ctx = await context().catch((error: unknown) => {
    if (error instanceof ApiError) return error;
    throw error;
  });
  if (ctx instanceof ApiError) {
    if (ctx.status === 401) redirect(`/login?returnTo=${encodeURIComponent("/plc-simulator")}`);
    return <Refusal><p className="notice" role="status" data-testid="plc-refusal">{ctx.message} <Link href="/" className="underline">Till Workflow</Link></p></Refusal>;
  }
  // A demo function (2026-11-20): outside the demo only the product owner opens it.
  if (!ctx.admin || ctx.user.role !== "SUPERADMIN") return <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8"><NoPermission page /></main>;
  if (ctx.organization.storageMode !== "HINTEK_CLOUD") return <Refusal><p className="notice" role="status" data-testid="view-requirement">Det här kräver serverlagring.</p></Refusal>;
  if (ctx.organization.isActive === false) return <Refusal><p className="notice" role="status" data-testid="plc-refusal">{PAUSED_COMPANY_TEXT}</p></Refusal>;
  const preferences = preferencesSchema.parse(preferenceObject(await preferencesOnce(ctx.user.id)) ?? {});
  return <PlcSimulator upkeepOn={organizationModuleOn(ctx.organization, "upkeep")} theme={preferences.theme} textScale={Number(preferences.textScale)} designs={await publishedDeviceDesigns()} />;
}
