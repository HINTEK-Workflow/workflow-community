import { NextResponse } from "next/server";
import { context, failure, requireCloudStorage, type Context } from "@/lib/kfid/server";
import { ApiError } from "@/lib/kfid/errors";
import { loadMePlan, loadMeTab } from "@/lib/overview/me-server";
import { loadTeamTab } from "@/lib/overview/team-server";
import { loadEconomyTab } from "@/lib/overview/economy-server";
import { loadCustomersTab } from "@/lib/overview/customers-server";
import { isLoadedOverviewTab, narrowedTabs, overviewChip, overviewTabs, type LoadedOverviewTab, type OverviewAnswer } from "@/lib/overview/tabs";
import { viewAsFromRequest, viewAsViewer } from "@/lib/workflow/view-as";

export const dynamic = "force-dynamic";

const LOADERS: Record<LoadedOverviewTab, (ctx: Context, now: Date, request: URL) => Promise<unknown>> = {
  // Jag; `part=plan` reads only Min plan for another month (a step in the calendar reads nothing else again).
  me: (ctx, now, url) => url.searchParams.get("part") === "plan" ? loadMePlan(ctx, now, url.searchParams.get("month")).then((plan) => ({ plan })) : loadMeTab(ctx, now, { month: url.searchParams.get("month") }),
  team: (ctx, now) => loadTeamTab(ctx, now),
  economy: (ctx, now) => loadEconomyTab(ctx, now),
  customers: (ctx, now) => loadCustomersTab(ctx, now),
};

/**
 * Översikten (dashboard etapp 6–7, 2026-10-28): `GET /api/overview?tab=me|team|economy|customers` – one read per
 * shown tab. The session, membership, company and legal gate come from context(); Cloud only (Local and the demo keep the
 * old Översikt). The permission matrix (lib/overview/tabs.ts) is checked here, and each tab's loader checks its own right
 * again and throws 403 itself. Read only, so no Origin; never cached by the browser or a proxy (private, no-store) – the
 * page keeps the latest answer per tab in its own memory (features/kfid/use-workspace-data.ts).
 */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const url = new URL(request.url);
    const tab = url.searchParams.get("tab") ?? "me";
    if (!isLoadedOverviewTab(tab)) return NextResponse.json({ error: "Okänd flik." }, { status: 400 });
    // Visa som (2026-11-06): the preview shows the tabs of the role it previews. Only ever fewer than the real ones.
    const preview = ctx.user.role === "SUPERADMIN" && !ctx.integration ? viewAsFromRequest(request) : null;
    const tabs = preview ? narrowedTabs(overviewTabs(ctx), overviewTabs({ ...viewAsViewer(preview), organization: ctx.organization })) : overviewTabs(ctx);
    if (!tabs[tab]) throw new ApiError(403, "Du saknar behörighet till fliken.");
    const data = await LOADERS[tab](ctx, new Date(), url);
    const chip = overviewChip(data);
    const answer: OverviewAnswer = { tab, tabs, chips: chip === null ? {} : { [tab]: chip }, data };
    return NextResponse.json(answer, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}
