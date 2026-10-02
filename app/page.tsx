import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { cookies } from "next/headers";
import { AppShell, type View } from "@/components/app-shell";
import { DemoApp } from "@/features/demo/demo-app";
import { DEMO_COOKIE } from "@/lib/demo";
import { shellBranding } from "@/lib/branding";
import { publicInstance } from "@/lib/instance";

import { Workspace } from "@/features/kfid/workspace";
import { serverExtensions } from "@/lib/extensions/server";
import { WorkspaceActionsProvider } from "@/components/workspace-actions";
import { defaultWorkflowPermissionProfile, normalizeWorkflowPermissionProfile } from "@/lib/workflow/permissions";
import { KFID_FORM_ID, RISK_FORM_ID } from "@/lib/workflow/builtin-originals";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; id?: string; customerId?: string; projectId?: string; taskId?: string; taskType?: string; timeTaskId?: string; checkout?: string; landing?: string; importControl?: string }>;
}) {
  const params = await searchParams;
  // The public demo renders the workspace against an in-browser backend; it needs no session and reads no data here.
  if (params.view && (await cookies()).get(DEMO_COOKIE)?.value === "1") {
    const demoViews = ["stats", "notifications", "new_task", "workflow_task", "new", "controls", "new_project", "projects", "planning", "rounds", "project", "tasks", "work_orders", "time", "facilities", "customers", "help", "settings", "administration"];
    return <DemoApp view={(demoViews.includes(params.view) ? params.view : "stats") as View} controlId={params.id} customerId={params.customerId} projectId={params.projectId} taskId={params.taskId} taskType={params.taskType} timeTaskId={params.timeTaskId} />;
  }
  const user = await getCurrentUser();
  // Signed-out visitors on the bare address get the public landing page; the app itself is unchanged.
  // ?landing=1 shows the public page also to a signed-in person (the editor's "Visa publik sida").
  if ((!user && !params.view && !params.id) || (params.landing === "1" && !params.view)) {
    // The landing page lives in ee/ (Fas 2) and can be switched off (2026-09-30); hidden, switched off by
    // LANDING_EDITOR_ENABLED=false (Fas 1) or absent, visitors see only the login and a superadmin the workspace.
    const landing = publicInstance().features.landingEditor
      ? await serverExtensions.landing({ superadmin: user?.role === "SUPERADMIN", preview: params.landing === "1" })
      : { kind: "hidden" as const };
    if (landing.kind === "hidden") redirect(user ? "/?view=stats" : "/login");
    return landing.node;
  }
  const validViews = [
    "stats",
    "notifications",
    "new_task",
    "workflow_task",
    "new",
    "controls",
    "new_project",
    "projects",
    "planning",
    "rounds",
    "project",
    "tasks",
    "work_orders",
    "time",
    "facilities",
    "customers",
    "credits",
    "help",
    "settings",
    "administration",
    "integrations",
    "history_retention",
    "mail_settings",
    "customer_companies",
    "pricing_admin",
    "ai_admin",
    "company_settings",
    "landing_editor",
    "forms",
    "import",
    "ai_settings",
  ];
  const preferences =
    user
      ? await prisma.userPreferences.findUnique({ where: { userId: user.id } })
      : null;
  const workspaceSettings = user?.activeOrganizationId
    ? await prisma.workspaceSettings.findUnique({
        where: { organizationId: user.activeOrganizationId },
        select: { logoPath: true },
      })
    : null;
  const preferred = user
    ? preferences?.data &&
      typeof preferences.data === "object" &&
      !Array.isArray(preferences.data)
      ? String(preferences.data.quickAction ?? "stats")
      : "stats"
    : "new";
  // The saved start page "new" is labelled "Ny uppgift" and therefore opens the task type picker, not the control editor.
  const requested = params.view ?? (user && preferred === "new" ? "new_task" : preferred);
  const view = (validViews.includes(requested) ? requested : "new") as View;
  const activeMembership = user?.organizationMemberships.find(
    (member) => member.organization.id === user.activeOrganizationId,
  );
  const activeMemberRole = activeMembership?.role ?? null;
  // Signed-out visitors never see the app shell with locked menu buttons; they meet the login (2026-09-30).
  if (!user) redirect(`/login?returnTo=${encodeURIComponent(`/?view=${view}`)}`);
  if (view === "administration" && activeMemberRole !== "OWNER" && activeMemberRole !== "ADMIN")
    redirect("/?view=stats");
  const { features } = publicInstance();
  // The Import page lives in ee/ like the API and MCP (2026-10-01); the community edition has no such view.
  // HINTEK AI's permissions page lives in ee/ (2026-10-01); every signed-in member may read it, only admins change it.
  if (view === "ai_settings" && !features.ai) redirect("/?view=stats");
  if ((view === "landing_editor" && !features.landingEditor) || (view === "credits" && !features.billing && !features.credits) || ((view === "integrations" || view === "import") && !features.integrations))
    redirect("/?view=stats");
  if ((view === "customer_companies" || view === "pricing_admin" || view === "ai_admin" || view === "landing_editor" || view === "mail_settings") && user?.role !== "SUPERADMIN")
    redirect("/?view=stats");
  // The switch-over (2026-09-27, decision B; 2026-09-28: no drafts, all originals): a new control or risk
  // assessment is made with HINTEK's original of the form – or the company's own version of it – when it is published.
  // Existing controls and risk assessments open as before. Without a published original there is no card and no old
  // editor: the original waits as a draft under Skapa formulär, so "Ny kontroll" leads to Ny uppgift.
  // A control's JSON file handed over from the Import page (2026-10-02) opens in the control's own editor, which reads that format.
  const original = user && view === "new" && !params.id && params.importControl !== "1" ? KFID_FORM_ID : user && view === "workflow_task" && params.taskType === "RISK_ASSESSMENT" && !params.taskId ? RISK_FORM_ID : null;
  if (original && user) {
    const context = `${params.projectId ? `&projectId=${encodeURIComponent(params.projectId)}` : ""}${params.customerId ? `&customerId=${encodeURIComponent(params.customerId)}` : ""}`;
    const candidates = await prisma.formTemplate.findMany({ where: { status: "PUBLISHED", publishedVersion: { not: null }, OR: [{ id: original, organizationId: null }, { baseTemplateId: original, organizationId: user.activeOrganizationId }] }, select: { id: true, baseTemplateId: true } });
    // The company's own version takes precedence over HINTEK's original.
    const published = candidates.find((item) => item.baseTemplateId) ?? candidates[0];
    redirect(published ? `/?view=workflow_task&taskType=FORM&formId=${encodeURIComponent(published.id)}${context}` : `/?view=new_task${context}`);
  }
  // Company admins build their company's forms (2026-09-27); /api/forms/admin enforces who builds what.
  if (view === "forms" && user?.role !== "SUPERADMIN" && activeMemberRole !== "OWNER" && activeMemberRole !== "ADMIN")
    redirect("/?view=stats");
  const shellUser = user ? {
    name: user.name,
    email: user.email,
    role: user.role,
    memberRole: activeMemberRole,
    workflowPermissions: user.activeOrganization?.storageMode === "LOCAL"
      ? defaultWorkflowPermissionProfile()
      : normalizeWorkflowPermissionProfile(activeMembership?.workflowPermissions),
    organizationName: user.activeOrganization?.name ?? null,
    localStorageMode: user.activeOrganization?.storageMode === "LOCAL",
    // The menu buttons the person has hidden under Inställningar (2026-09-30).
    hiddenMenu: preferences?.data && typeof preferences.data === "object" && !Array.isArray(preferences.data) && Array.isArray((preferences.data as { hiddenMenuItems?: unknown }).hiddenMenuItems)
      ? ((preferences.data as { hiddenMenuItems: unknown[] }).hiddenMenuItems.filter((item): item is string => typeof item === "string")) : [],
    // How much is shown on a phone and on a tablet (2026-10-02); the shell applies it to the device at hand.
    detailLevel: preferences?.data && typeof preferences.data === "object" && !Array.isArray(preferences.data) ? (preferences.data as { detailLevel?: { phone?: number; tablet?: number } }).detailLevel ?? null : null,
    canBuildForms: user.role === "SUPERADMIN" || ((activeMemberRole === "OWNER" || activeMemberRole === "ADMIN") && user.activeOrganization?.storageMode === "HINTEK_CLOUD"),
  } : null;
  return (
    <WorkspaceActionsProvider>
    <AppShell
      user={shellUser}
      view={view}
      branding={shellBranding(user?.activeOrganization, workspaceSettings?.logoPath)}
    >
      {params.checkout === "canceled" ? <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="status">
        Betalningen avbröts. Inga pengar drogs och ingen tjänst aktiverades.
      </div> : null}
      {params.checkout === "success" ? <div className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950" role="status">
        Stripe har tagit emot betalningen. Abonnemang och krediter aktiveras så snart Stripe har bekräftat den.
      </div> : null}
      <Workspace
        user={shellUser}
        view={view}
        controlId={params.id}
        customerId={params.customerId}
        projectId={params.projectId}
        taskId={params.taskId}
        taskType={params.taskType}
        timeTaskId={params.timeTaskId}
      />
    </AppShell>
    </WorkspaceActionsProvider>
  );
}
