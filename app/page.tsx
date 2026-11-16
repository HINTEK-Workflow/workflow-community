import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { adminWorkChoicesOf, currentUserOnce, preferenceObject, preferencesOnce, shellDetailLevels, workViewOf } from "@/lib/workflow/first-frame-server";
import { enabledModules, MODULE_KEYS } from "@/lib/workflow/modules";
import { effectiveMenuChoices, effectiveNativeLayout, effectiveWorkProfile, NO_ADMIN_WORK_CHOICES, NO_WORK_PROFILE } from "@/lib/workflow/work-profile";
import { cookies, headers } from "next/headers";
import { recordPageView } from "@/lib/analytics/record";
import { AppShell, type View } from "@/components/app-shell";
import { LazyDemoApp as DemoApp } from "@/features/demo/demo-app-lazy";
import { DEMO_COOKIE, DEMO_VIEWS } from "@/lib/demo";
import { isHintekOrganization, shellBranding } from "@/lib/branding";
import { publicInstance } from "@/lib/instance";

import { Workspace } from "@/features/kfid/workspace";
import { serverExtensions } from "@/lib/extensions/server";
import { WorkspaceActionsProvider } from "@/components/workspace-actions";
import { defaultWorkflowPermissionProfile, normalizeWorkflowPermissionProfile } from "@/lib/workflow/permissions";
import { VIEW_AS_COOKIE, parseViewAs, superadminSeesAll, viewAsViewer } from "@/lib/workflow/view-as";
import { oldFacilitiesTarget } from "@/lib/workflow/old-addresses";
import { KFID_FORM_ID, RISK_FORM_ID } from "@/lib/workflow/builtin-originals";
import { preferencesSchema } from "@/lib/kfid/preferences";
import { PRODUCT_VIEWS } from "@/lib/workflow/settings-tabs";
import { RETIRED_SECTION_TARGET } from "@/lib/integrations/connection-areas";
import { PAUSED_COMPANY_TEXT } from "@/lib/kfid/paused-company";
import { publicSite, publicStartTarget, siteOfHost } from "@/lib/public-site";
import type { Metadata } from "next";
import { publicStartMetadata } from "@/lib/site-metadata";
import { indexablePublicSite } from "@/lib/seo/server";

export const dynamic = "force-dynamic";

/**
 * Sökmotorer (2026-10-15): the whole installation asks search engines to stay away (app/layout.tsx), except the
 * public site's start page while the landing page is published – then example.com may be found. The app's own
 * address is never indexed.
 */
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ view?: string; operatorer?: string; ms?: string; id?: string; landing?: string }> }): Promise<Metadata> {
  const params = await searchParams;
  if (params.view || params.id || params.landing) return {};
  const open = await indexablePublicSite();
  // The link preview points at the public site itself (og:url, and the picture from there: PUBLIC_FILES in lib/public-site.ts);
  // title, description, picture and the Search Console code are the landing editor's (Sökmotorer, 2026-11-10).
  return open ? publicStartMetadata(publicInstance().name, open.site.siteOrigin, open.seo) : {};
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; operatorer?: string; ms?: string; id?: string; customerId?: string; projectId?: string; taskId?: string; taskType?: string; timeTaskId?: string; timeProjectId?: string; facilityId?: string; workOrderId?: string; checkout?: string; landing?: string; section?: string }>;
}) {
  const params = await searchParams;
  const validViews = [
    "stats",
    "setup",
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
    "report_archive",
    "tools",
    "project_summary",
    "project_planning",
    "capacity",
    "quotes",
    "quote",
    "purchases",
    "purchase",
    "articles",
    "invoice_bases",
    "customer_invoices",
    "facilities",
    "customers",
    "self_inspection",
    "deviations",
    "maintenance",
    "instruments",
    "calculators",
    "place",
    "place_labels",
    "credits",
    "help",
    "settings",
    "administration",
    "operator_accounts",
    "company",
    "advanced",
    "view_as",
    "integrations",
    "history_retention",
    "company_values",
    "mail_settings",
    "login_settings",
    "server_keys",
    "mailings",
    "behavior_analytics",
    "customer_companies",
    "product_overview",
    "pricing_admin",
    "ai_admin",
    "company_settings",
    "company_features",
    "quote_settings",
    "services",
    "landing_editor",
    "company_website",
    "company_posts",
    "pdf_templates",
    "plc_devices",
    "forms",
    "import",
    "ai_settings",
  ];
  // The separate public address (2026-10-15, lib/public-site.ts) never shows the app. Its start page is the landing page
  // when it is published; while it is hidden the visitor goes to the app's login, since sign-in, its cookies, passkeys
  // and Google only work on the app's own address. An app address (?view=…) is the app's and goes there.
  const site = publicSite();
  if (site && siteOfHost((await headers()).get("host"), site) !== "app") {
    if (params.view || params.id || params.landing) {
      const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
      redirect(`${site.appOrigin}/?${query}`);
    }
    const shown = publicInstance().features.landingEditor
      ? await serverExtensions.landing({ superadmin: false, preview: false })
      : { kind: "hidden" as const };
    // Dold landningssida: example.com slussar vidare till inloggningen; publicerad visas landningssidan (lib/public-site.ts, publicStartTarget).
    const start = publicStartTarget(shown.kind, site);
    if (start.kind === "redirect") redirect(start.location);
    return shown.kind === "render" ? shown.node : null;
  }
  // Operatörskonton was a panel under Användare until 2026-10-31; its older address (also in e-mails and notices) lands on its page.
  if (params.view === "administration" && params.operatorer === "1") redirect(`/?view=operator_accounts${params.ms ? `&ms=${encodeURIComponent(params.ms)}` : ""}`);
  // The public demo renders the workspace against an in-browser backend; it needs no session and reads no data here.
  if (params.view && (await cookies()).get(DEMO_COOKIE)?.value === "1") {
    const demoViews: readonly string[] = DEMO_VIEWS;
    // A page that is not in the demo keeps its address and says so (2026-10-10: it fell back to Översikt in silence);
    // an unknown address opens Översikt as before.
    // The older addresses the app redirects (Ny uppgift, Mina uppgifter, Företaget) open their page here too.
    const requested = ({ new: "new_task", controls: "tasks", company_settings: "company", facilities: "company" } as Record<string, string>)[params.view] ?? params.view;
    const unavailable = !demoViews.includes(requested) && validViews.includes(requested);
    return <DemoApp report={!publicInstance().community} view={(demoViews.includes(requested) || unavailable ? requested : "stats") as View} unavailable={unavailable} customerId={params.customerId} projectId={params.projectId} taskId={params.taskId} taskType={params.taskType} timeTaskId={params.timeTaskId ?? params.timeProjectId} />;
  }
  // The same read as the root layout's first frame (lib/workflow/first-frame-server.ts): one per request.
  const user = await currentUserOnce();
  // With a separate public site the app's address is only the app: a signed-out visitor meets the login here (also in
  // the mobile app, which opens this address). The superadmin's preview (?landing=1) stays here.
  if (site && !user && !params.view && !params.id) redirect("/login");
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
  const preferences = user ? await preferencesOnce(user.id) : null;
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
  // The saved start page "new" is labelled "Ny uppgift" and therefore opens the task type picker.
  // the public website under Installation became Min webbsida under Inställningar (2026-11-10).
  if (params.view === "website_editor") redirect("/?view=company_website");
  const requested = params.view ?? (user && preferred === "new" ? "new_task" : preferred);
  const view = (validViews.includes(requested) ? requested : user ? "stats" : "new") as View;
  const activeMembership = user?.organizationMemberships.find(
    (member) => member.organization.id === user.activeOrganizationId,
  );
  const activeMemberRole = activeMembership?.role ?? null;
  // Signed-out visitors never see the app shell with locked menu buttons; they meet the login (2026-09-30).
  if (!user) redirect(`/login?returnTo=${encodeURIComponent(`/?view=${view}`)}`);
  // "Visa som" (2026-10-03): the superadmin previews a customer's menus and pages; display only.
  const viewAs = user.role === "SUPERADMIN" ? parseViewAs((await cookies()).get(VIEW_AS_COOKIE)?.value) : null;
  // Superadmin (2026-11-05): nothing hides a page in the company the person is signed in to. The rights stay the person's own.
  const seesAll = superadminSeesAll({ role: user.role, memberRole: activeMemberRole, viewAs });
  // The Platser tab under Inställningar is gone (2026-10-04), and the offices and departments it held were removed
  // (2026-10-24): an old address lands on Företaget for its admin, and on Översikt for anyone else, who would only
  // meet the permission box on Företaget (webbplatskartan 2026-10-24).
  if (view === "facilities") redirect(oldFacilitiesTarget(activeMemberRole, viewAs));
  // Produktöversikten (beslut 11, 2026-11-01): where the superadmin lands, unless a start page of their own was chosen.
  if (user.role === "SUPERADMIN" && !viewAs && !params.view && !params.id && preferred === "stats") redirect("/?view=product_overview");
  // The older controls' archive is gone with its editor (2026-10-06): every control is a task in Mina uppgifter.
  if (view === "controls") redirect("/?view=tasks");
  // Slimmer settings (2026-10-07): Rapporter och logotyp became part of Företaget. One page per tab (
  // 2026-10-15, lib/workflow/settings-tabs.ts): Kopplingar och historik became Kopplingar och nycklar (API och MCP), and
  // its other two parts moved to the tab they belong to – Historik och lagring to Företaget, Administrationshistorik to
  // Användare. Every older address, also in e-mails, lands on its part (?section= rolls the page there).
  const { features } = publicInstance();
  if (view === "company_settings") redirect("/?view=company");
  if (view === "history_retention" || (view === "advanced" && params.section === "history")) redirect("/?view=company&section=history");
  if (view === "advanced" && params.section === "log") redirect("/?view=administration&section=log");
  if (view === "integrations" || (view === "advanced" && params.section === "integrations")) redirect("/?view=advanced");
  // Lön och export opens under Kopplingar again (2026-11-02), with the same content as Tid's tab: ?section=payroll is the area.
  // Every key beside its connection (2026-11-03): the rows Andra tjänsters nycklar, Grossister och prisfiler and Import och
  // export are gone from Kopplingar, and the accounts for the bookkeeping moved there from Arbetssätt → Avancerat.
  if (view === "advanced" && params.section && RETIRED_SECTION_TARGET[params.section]) redirect(RETIRED_SECTION_TARGET[params.section]);
  if (view === "company_features" && params.section === "accounting" && features.integrations) redirect("/?view=advanced&section=accounting");
  // Without API och MCP in the installation there is no Kopplingar och nycklar; its older address opens the history.
  if (view === "advanced" && !features.integrations) redirect("/?view=company&section=history");
  // The company admin pages (administration, Funktioner, Skapa formulär …) answer a person who is not one with one short
  // sentence and the way back, drawn by the workspace (2026-10-07), instead of a jump to Översikt; the APIs check anyway.
  // The Import page lives in ee/ like the API and MCP (2026-10-01); the community edition has no such view.
  // Workflow AI's permissions page lives in ee/ (2026-10-01); every signed-in member may read it, only admins change it.
  if (view === "ai_settings" && !features.ai) redirect("/?view=stats");
  if ((view === "landing_editor" && !features.landingEditor) || (view === "credits" && !features.billing && !features.credits) || (view === "import" && !features.integrations))
    redirect("/?view=stats");
  // A member on a product address gets the shared "no permission" box from the workspace (2026-10-18), not a jump.
  if ((PRODUCT_VIEWS as readonly string[]).includes(view) && !user)
    redirect("/?view=stats");
  // Beteendeanalys is shown under Installation → Webbplats only once the landing page is public (
  // 2026-10-09 natt; the tab since 2026-10-15); the superadmin's tabs need to know. Read only for those pages.
  const landingPublished = seesAll && features.landingEditor ? true : (PRODUCT_VIEWS as readonly string[]).includes(view) && user?.role === "SUPERADMIN" && !viewAs && features.landingEditor
    ? (await serverExtensions.landing({ superadmin: false, preview: false })).kind !== "hidden"
    : false;
  // Kundföretag (2026-11-10): in Community a tab only once the installation has a company besides its own.
  const customerCompaniesTab = !publicInstance().community || user?.role !== "SUPERADMIN" || !(PRODUCT_VIEWS as readonly string[]).includes(view) || viewAs
    ? true : (await prisma.organization.count({ where: { id: { not: user.activeOrganizationId ?? "" } } })) > 0;
  // The switch-over (2026-09-27, decision B; 2026-09-28: no drafts, all originals; 2026-10-06: the older control
  // editor is gone): a control or risk assessment is made with Workflow's original of the form – or the company's own
  // version of it – when it is published. "Ny kontroll" (view=new) always starts that protocol. Without a published
  // original there is no card: the original waits as a draft under Skapa formulär, so "Ny kontroll" leads to Ny uppgift.
  const original = user && view === "new" ? KFID_FORM_ID : user && view === "workflow_task" && params.taskType === "RISK_ASSESSMENT" && !params.taskId ? RISK_FORM_ID : null;
  if (original && user) {
    const context = `${params.projectId ? `&projectId=${encodeURIComponent(params.projectId)}` : ""}${params.customerId ? `&customerId=${encodeURIComponent(params.customerId)}` : ""}${params.facilityId ? `&facilityId=${encodeURIComponent(params.facilityId)}` : ""}${params.workOrderId ? `&workOrderId=${encodeURIComponent(params.workOrderId)}` : ""}`;
    const candidates = await prisma.formTemplate.findMany({ where: { status: "PUBLISHED", publishedVersion: { not: null }, OR: [{ id: original, organizationId: null }, { baseTemplateId: original, organizationId: user.activeOrganizationId }] }, select: { id: true, baseTemplateId: true } });
    // The company's own version takes precedence over Workflow's original.
    const published = candidates.find((item) => item.baseTemplateId) ?? candidates[0];
    redirect(published ? `/?view=workflow_task&taskType=FORM&formId=${encodeURIComponent(published.id)}${context}` : `/?view=new_task${context}`);
  }
  // Beteendeanalys (2026-10-07): the page is counted for the day, anonymously (no person, company or address);
  // a prefetch is not a visit. The installation's own people and a browser the owner switched off are not counted (2026-11-16).
  const requestHeaders = await headers();
  if (!requestHeaders.get("next-router-prefetch"))
    recordPageView(view, params.taskType, { cookie: requestHeaders.get("cookie"), superadmin: user.role === "SUPERADMIN", ownCompany: activeMembership ? isHintekOrganization(activeMembership.organization) : false });
  // Arbetsvy (2026-10-08): the admin's default view for this member; never in Local (no members). Display only.
  const workView = user && !seesAll ? workViewOf(user, preferences ?? null) : null;
  const preferenceData = preferenceObject(preferences ?? null);
  // Yrkesprofil (2026-11-01): the menu, Mer and the tab bar in force – the person's saved choices while they count, otherwise the profile's.
  const storedChoices = preferencesSchema.parse(preferenceData ?? {});
  const adminWork = user ? adminWorkChoicesOf(user) : NO_ADMIN_WORK_CHOICES;
  const profileInForce = viewAs || seesAll ? NO_WORK_PROFILE : effectiveWorkProfile(adminWork, storedChoices.ownWorkProfile);
  const menuInForce = effectiveMenuChoices(profileInForce, storedChoices);
  const shellUser = user ? {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    memberRole: activeMemberRole,
    workflowPermissions: user.activeOrganization?.storageMode === "LOCAL"
      ? defaultWorkflowPermissionProfile()
      : normalizeWorkflowPermissionProfile(activeMembership?.workflowPermissions),
    organizationName: user.activeOrganization?.name ?? null,
    organizationId: user.activeOrganizationId ?? null,
    localStorageMode: user.activeOrganization?.storageMode === "LOCAL",
    // Företagets moduler (0.39.0): what is on in the company. Display here; the server refuses by itself.
    modules: seesAll ? [...MODULE_KEYS] : enabledModules(user.activeOrganization?.disabledModules),
    // Fakturor (2026-11-04): the menu item stands only while the company has invoicing on. Display; the server refuses by itself.
    invoicingOn: user.activeOrganizationId && user.activeOrganization?.storageMode !== "LOCAL" ? seesAll || await (await import("@/lib/customer-invoice/server")).customerInvoicesOn(user.activeOrganizationId) : false,
    // The menu buttons the person has hidden under Inställningar (2026-09-30).
    hiddenMenu: seesAll ? [] : menuInForce.hiddenMenuItems,
    // Sub-pages shown as shortcuts directly in the menu (2026-10-09); display only.
    menuShortcuts: menuInForce.menuShortcuts,
    // Mer on the phone has its own choice (2026-10-24); null = Mer follows the menu above.
    phoneMenu: seesAll ? null : menuInForce.phoneMenu,
    // The tab bar at level 1 on a phone (2026-10-09 evening); display only.
    nativeTabs: effectiveNativeLayout(profileInForce, storedChoices).tabs,
    // How much is shown on a phone and on a tablet (2026-10-02); the shell applies it to the device at hand.
    // The person's own levels while they count, otherwise the admin's work view's (lib/workflow/work-view.ts).
    detailLevel: shellDetailLevels(user, preferences),
    workView,
    workProfile: { admin: adminWork, effective: profileInForce },
    // The same rule as the server (2026-10-06): superadmin builds forms as an administrator of Workflow's own Cloud company.
    canBuildForms: (activeMemberRole === "OWNER" || activeMemberRole === "ADMIN") && user.activeOrganization?.storageMode === "HINTEK_CLOUD",
    superadmin: user.role === "SUPERADMIN",
    viewAs,
  } : null;
  // Under "Visa som" the menus and pages are drawn as for that role and plan; the server's checks are unchanged.
  const shownUser = shellUser && viewAs ? {
    ...shellUser,
    role: "USER",
    memberRole: viewAs === "member" ? "MEMBER" as const : "OWNER" as const,
    workflowPermissions: viewAsViewer(viewAs).workflowPermissions,
    localStorageMode: viewAs === "local",
    canBuildForms: viewAs === "owner",
    workView: null,
    workProfile: null,
  } : shellUser;
  return (
    <WorkspaceActionsProvider>
    <AppShell
      user={shownUser}
      view={view}
      branding={shellBranding(user?.activeOrganization, workspaceSettings?.logoPath)}
    >
      {user.activeOrganization?.isActive === false && !viewAs ? <div className="notice mb-4" role="status" data-testid="company-paused-notice">{PAUSED_COMPANY_TEXT}</div> : null}
      {features.billing && params.checkout === "canceled" ? <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="status">
        Betalningen avbröts. Inga pengar drogs och ingen tjänst aktiverades.
      </div> : null}
      {features.billing && params.checkout === "success" ? <div className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950" role="status">
        Stripe har tagit emot betalningen. Abonnemang och krediter aktiveras så snart Stripe har bekräftat den.
      </div> : null}
      <Workspace
        user={shownUser}
        view={view}
        customerId={params.customerId}
        projectId={params.projectId}
        taskId={params.taskId}
        taskType={params.taskType}
        // Tid opened for a project's own time (Projekttid, 2026-10-26) focuses the project like a work order.
        timeTaskId={params.timeTaskId ?? params.timeProjectId}
        landingPublished={landingPublished}
        customerCompaniesTab={customerCompaniesTab}
      />
    </AppShell>
    </WorkspaceActionsProvider>
  );
}
