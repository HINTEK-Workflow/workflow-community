/* eslint-disable @next/next/no-img-element -- Private authenticated images must bypass the image optimizer. */
"use client";
import { WorkOrderList } from "@/features/workflow/work-order-list";
import { hasWorkflowPermission, normalizeWorkflowPermissionProfile } from "@/lib/workflow/permissions";
import { canBookJob } from "@/lib/workflow/planned-activity-access";
import { NEW_TASK_SUBJECTS } from "@/lib/workflow/new-choices";
import { LogoVariantsField } from "./logo-variants";
import { invalidateCustomerOptions, useCustomerOptions } from "./customer-options";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  CreditCard,
  Upload,
  Palette,
  RotateCcw,
  Rocket,
  Scale,
  SlidersHorizontal,
  Lightbulb,
  Sparkles,
  MonitorSmartphone,
 Image, ClipboardCheck, Calculator, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { api, action } from "./api";
import { AdvisorLevelPicker, AdvisorSettingsProvider } from "@/features/workflow/flow-guide";
import { sentenceAlreadyShown, toastIsStale, WORKSPACE_TOAST_EVENT, type WorkspaceToast, type WorkspaceToastAction } from "@/lib/workflow/toast";
import { AdvancedFold, PLANNING_VIEWS, PRODUCT_VIEWS, SETTINGS_VIEWS, SectionTabs, SectionTabsReserve, SettingsGroup, SettingsPart, WORK_ORDER_VIEWS, planningTabs, productTabs, settingsTabs, timeTabs, maintenanceTabs, boardsTabs, webPostsTabs, WEB_POSTS_VIEWS, workOrderTabs, customerRegisterTabs, customerRegisterHref } from "@/features/workflow/section-tabs";
import { timeTabDenied, timeTabHref, timeTabOf, timeTabsFor, type TimeTab, type TimeTabRights } from "@/lib/workflow/time-tabs";
import { TimePayrollTab } from "@/features/payroll/time-payroll-tab";
import { WorkflowGuide } from "@/features/workflow/workflow-guide";
import { CoreModelGuide } from "@/features/workflow/core-model-guide";
import { DialogActions, Modal, Panel, PanelAreaProvider, PanelHeaderBand, Field, NoPermission, SwitchRow } from "./ui";
import { isAdminView, panelAreaOfView } from "@/lib/workflow/panel-area";
import { FeatureSettings, ModuleSettings } from "@/features/workflow/feature-settings";
import { moduleInList, normalizeDisabledModules, organizationModuleOn } from "@/lib/workflow/modules";
import { AiRulesHelp } from "@/features/ai/ai-rules-help";
import { featureSettingsOf } from "@/lib/workflow/feature-settings";
import { clientExtensions } from "@ee/client";
import { Profile } from "./profile";
import { SecuritySettings } from "@/features/security/security-settings";
import { KeyCardGrid } from "@/features/integrations/key-card";
import { PushSettings } from "@/features/workflow/push-settings";
import { AzureProviderPanel } from "@/features/ai/azure-provider-panel";
import { ReauthHost } from "@/features/security/reauth-host";
import { SessionExpiredHost } from "@/features/security/session-expired-host";
import { TWO_FACTOR_SETUP_REQUIRED } from "@/lib/auth/session-rules";
import { NoticeSettings } from "./notice-settings";
import { CalendarLinkSettings } from "./calendar-link-settings";
import { MENU_VISIBILITY_EVENT, calendarAllowed, menuItemAllowed } from "@/lib/workflow/menu-items";
import { InstallApp } from "@/features/workflow/install-app";
import { choiceName, DEVICE_LEVELS, DETAIL_LEVEL_EVENT, DETAIL_LEVEL_LABEL, DEVICE_LABEL, phoneShowsAll, type DetailLevel } from "@/lib/workflow/detail-level";
import { effectiveDetailLevels, WORK_VIEW_DESCRIPTION, WORK_VIEW_LABEL, workViewDefaults } from "@/lib/workflow/work-view";
import { useWorkProfile } from "@/features/workflow/use-work-view";
import { workProfileHint, WorkProfileOptions, WorkProfileTitleSearch } from "./work-profile-options";
import { effectiveMenuChoices, effectiveNativeLayout, effectiveWorkProfile, effectiveWorkView, NO_ADMIN_WORK_CHOICES, NO_WORK_PROFILE, normalizeWorkAreas, ownWorkProfileChoice, ownWorkProfileShown, profileNativeLayout, RESET_CHOICE_BASIS, WORK_PROFILE, type WorkProfile } from "@/lib/workflow/work-profile";
import { forgetWorkListScopes } from "@/features/workflow/work-list";
import { CreditHistory } from "./credit-history";
import { creditSummaryLines, EMPTY_CREDIT_SUMMARY } from "@/lib/credits/wallet-summary";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useLoadEffect } from "@/lib/use-load-effect";
// Laddtid på mobil (U1/T2, 2026-10-23): the heavy pages load when they open (features/kfid/workspace-views.tsx); the
// phone's Hem, Jobb, Tid and Mer stay in the first bundle.
import { ProductOverviewPage, CapacityPage, Administration, UsersAdministration, OperatorAccountsAdmin, OperatorProductSettings, PdfTemplatesPage, PlcDevicesPage, CompanyGoalsPanel, Analytics, OverviewPage, ArticlesPage, BehaviorAnalytics, CalculatorsPage, CloudCompanyValues, InstrumentsPage, InvoiceBasesList, SelfInspectionPage, CompanyLookupSettings, CompanySecurity, CustomerCard, CustomerCompanies, CustomerEditPage, CustomerRegisterSwitch, FormRounds, HistoryRetention, LantmaterietSettings, LocalWorkspace, LoginSettings, Mailings, MailSettings, MicrosoftSignInSettings, PlaceLabels, PlaceLabelsMoved, PlacePage, PlatformSecurity, PlatformSecurityLog, preloadLikely, preloadView, PriceSettingsPanel, ProjectPlanningPage, ProjectSummaryPage, ProviderKeyPanel, PurchaseEditorFromAddress, PurchasesList, QuoteEditorFromAddress, QuotesList, RecordArchive, ReportArchive, SandboxBillingPanel, ServerJobs, ServerUpdates, SetupGuide, SiteMap, TaskTypePicker, ToolsHub, ViewAsPanel, WorkflowProjects, WorkflowTaskEditor, MaintenancePage, BoardsPage } from "./workspace-views";
import { InstanceIconSettings } from "@/features/workflow/instance-icon-settings";
import { TasksPage } from "./tasks-page";
// The form builder is only for the superadmin; its code (and drag and drop) loads only when the view opens.
// Min webbsida (2026-11-10): the company's WordPress editor is wide and heavy; it loads when the tab is opened.
const PostsPage = dynamic(() => import("@/features/meta/posts-page").then((module) => module.PostsPage), { ssr: false, loading: () => <p role="status" className="text-sm text-muted-foreground">Öppnar Inlägg…</p> });
const VideosPage = dynamic(() => import("@/features/youtube/videos-page").then((module) => module.VideosPage), { ssr: false, loading: () => <p role="status" className="text-sm text-muted-foreground">Öppnar Filmer…</p> });
const WebsiteEditor = dynamic(() => import("@/features/website/website-editor").then((module) => module.WebsiteEditor), { ssr: false, loading: () => <p role="status" className="text-sm text-muted-foreground">Öppnar Min webbsida…</p> });
const FormBuilder = dynamic(() => import("@/features/workflow/form-builder").then((module) => module.FormBuilder), { ssr: false, loading: () => <p role="status" className="text-sm text-muted-foreground">Öppnar formulärbyggaren…</p> });
import { TimeReport } from "@/features/workflow/time-report";
import { TaskNotifications, useTaskNotificationFeed } from "@/features/workflow/task-notifications";
import { NativeHome } from "@/features/workflow/native-home";
import { useCurrentDevice, useDetailLevel, useNativeMode } from "@/features/workflow/use-detail-level";
import { overviewTabs } from "@/lib/overview/tabs";
import { nativeReduced, SHOW_MORE_EVENT } from "@/lib/workflow/show-more";
import { useCloudRunningTimers } from "@/features/workflow/running-timer";
import type { WorkflowTaskKind } from "@/lib/workflow/task-model";
import { applyPreferencesPatch, detailLevelPatch, type PreferencesPatch } from "@/lib/kfid/preferences";
import {
  defaultPreferences,
  type Preferences,
  type Overview,
  type CustomerItem,
} from "./types";
import type { View, ShellUser } from "@/components/app-shell";
import { UpgradeToCloud } from "@/features/workflow/upgrade-cloud";
import { ReleaseNotesPanel, ReleaseNotice, unseenReleaseVersion } from "@/features/workflow/release-notes";
import { currentAppVersion } from "@/lib/release-notes";
import { LegalLinks } from "@/components/legal-links";
import { EraseAccount } from "@/features/workflow/erase-account";
import {
  DEFAULT_REPORT_BRANDING,
  type ReportBranding,
} from "@/lib/kfid/report-branding";
import { applyTheme, resolveTheme, THEME_CHOICE_LABEL, themeChoices } from "@/lib/theme";
import { OPEN_MENU_CUSTOMIZE_EVENT, PREFERENCES_PATCH_EVENT, PREFERENCES_STATE_EVENT, type PreferencesState } from "@/lib/workflow/shell-events";
import {
  shellBranding,
  WORKFLOW_BRANDING_EVENT,
} from "@/lib/branding";
import { useInstance } from "@/components/instance-provider";
import { MAP_LICENSE, MAP_LICENSE_URL, MAP_SOURCE_NAME } from "@/lib/map/attribution";
import { useSearchParams } from "next/navigation";
import { PageHeader, PageSkeleton, SectionTabsPlacement } from "@/components/page-shell";
import { maintenanceViewHref, maintenanceViewOf } from "@/features/maintenance/maintenance-header";
import { boardsAccess } from "@/lib/boards/access";
import { boardsTabHref, boardsTabOf, boardsTabsFor } from "@/lib/boards/tabs";
import { WorkspaceDataScope } from "./use-workspace-data";
import { enterWorkspaceCacheScope, invalidateWorkspaceCache, takeWorkspaceChange, workspaceCacheScope } from "@/lib/workflow/workspace-cache";
import { NativeScreen, NativeScreenFrame } from "@/components/native/screen";
import { ListGroup, NativePickerRow } from "@/components/native/list";
import { NativeSettingsMenu, NativeUnwrap } from "./native-settings";
import { NativeHiddenPage } from "@/components/native/hidden-page";
import { NativeHelpMenu } from "@/features/workflow/native-help";
import { nativeHidesView } from "@/lib/workflow/native-mode";
import { VIEW_LABEL } from "@/lib/workflow/navigation";
import { nativeLayoutAllowed } from "@/lib/workflow/native-layout";
import { NATIVE_LAYOUT_EVENT } from "@/lib/workflow/shell-events";
import { ToastCard } from "@/features/workflow/toast-card";
import { ServerUpdatesNotice, useServerUpdatesNotice } from "@/features/workflow/server-updates-toast";

// The place and the label sheet read their address themselves: a QR label leads straight here.
function PlaceFromAddress() {
  const params = useSearchParams();
  const placeId = params.get("placeId") ?? "";
  return placeId ? <PlacePage key={placeId} placeId={placeId} scanned={params.get("scan") === "1"} /> : <div className="space-y-6"><PageHeader title="Plats" /><Panel title="Ingen plats vald"><p className="text-sm text-muted-foreground">Öppna en plats från kundkortet.</p></Panel></div>;
}
// QR hör till driftronden (2026-10-22): the sheet is a round's (`&roundId=`); an older address from the customer register
// (`&customerId=…&placeIds=…`) leads to the round or says where the labels are now.
function PlaceLabelsFromAddress() {
  const params = useSearchParams();
  const roundId = params.get("roundId") ?? "";
  const customerId = params.get("customerId") ?? "";
  const placeIds = (params.get("placeIds") ?? "").split(",").filter(Boolean);
  if (roundId) return <PlaceLabels key={roundId} roundId={roundId} />;
  return <PlaceLabelsMoved customerId={customerId} placeIds={placeIds} />;
}
/**
 * One answer for a page the person may not use here (2026-10-07: a member met an empty page, "Företagsadministratör
 * krävs." from an API or a jump to Översikt): a short sentence and the way back. The server decides either way.
 */
// Since 2026-10-07 also Företaget, Avancerat, Abonnemang och krediter and Workflow AI: a member has only Mina inställningar
// and Hjälp under Inställningar, and the AI panel tells them whether Workflow AI is on.
// Priser och offert (2026-10-09 natt) is the company's too: admins in Cloud.
export const COMPANY_ADMIN_VIEWS = ["company", "administration", "operator_accounts", "quote_settings", "company_features", "company_settings", "company_values", "credits", "ai_settings", "integrations", "history_retention", "advanced", "company_website", "company_posts", "company_videos", "forms"] as const;
/** Views that need the server's storage; a Local workspace keeps its data in its file. */
export const CLOUD_ONLY_VIEWS = ["operator_accounts", "integrations", "history_retention", "advanced", "quote_settings", "forms", "place", "place_labels", "project_planning", "capacity"] as const;
/** The visible text on the page (not the toast) that could already say what a message says. */
function sentenceShownOnPage(text: string) {
  const shown: string[] = [];
  for (const root of document.querySelectorAll(".workspace-main, [role=dialog]")) {
    for (const element of root.querySelectorAll("p, div, span, li, [role=alert], [role=status]")) {
      if (element.childElementCount > 0 || element.closest(".workspace-toast") || (element as HTMLElement).offsetParent === null) continue;
      shown.push(element.textContent ?? "");
    }
  }
  return sentenceAlreadyShown(text, shown);
}
/**
 * A page Local cannot have. `cloudLink`: the way to what Cloud gives, for whoever may order it (resa 2026-11-06: a dead end
 * without it) – shown only where the installation sells Cloud or credits, since the billing section exists only there (2026-11-20).
 */
export function ViewRequirement({ text, cloudLink = false }: { text: string; cloudLink?: boolean }) {
  const { features } = useInstance();
  return <div className="space-y-4" data-testid="view-requirement">
    <p className="notice" role="status">{text}</p>
    {cloudLink && (features.billing || features.credits) ? <Link href="/?view=company&section=billing" className="text-sm font-medium text-primary underline" data-testid="view-requirement-cloud">Se vad Cloud ger</Link> : null}
  </div>;
}
/** One rule for a member on an address that needs more rights (fix wave 2026-10-18): the same box everywhere. */
export const NoPermissionBox = NoPermission;
// Workflow's commercial views live in ee/ (Fas 2); without it they are null.
const { CustomerInvoices, CustomerInvoiceSettings } = clientExtensions;
const { AccountingExport, AiUsageAdministration, BillingRead, ImportPage, IntegrationKeys, IssueReportSettings, LandingEditor, PricingAdministration, ProviderAdministration, ServerKeysAdministration, SharingPolicyPanel } = clientExtensions;

/** The popups of Mina inställningar beside Anpassa menyn (2026-10-24). */
type SettingsPopup = "display" | "ai";

export function Workspace({
  user,
  view,
  customerId,
  projectId,
  taskId,
  taskType,
  timeTaskId,
  landingPublished = false,
  customerCompaniesTab = true,
  demo = false,
  underHeading,
}: {
  user: ShellUser;
  view: View;
  customerId?: string;
  projectId?: string;
  taskId?: string;
  taskType?: string;
  timeTaskId?: string;
  /** Whether the public landing page is published (read by app/page.tsx for the superadmin's Installation). */
  landingPublished?: boolean;
  /** Whether Kundföretag is a tab under Installation (Community: only with more than one company, read by app/page.tsx). */
  customerCompaniesTab?: boolean;
  /** The public demo (features/demo/demo-app.tsx), which has no Projektstatistik. */
  demo?: boolean;
  /** What the page around the workspace wants right under the page's heading (the demo's start card): fasta platser, it never moves the heading. */
  underHeading?: React.ReactNode;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const instance = useInstance();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Ställ in Workflow (2026-10-02): open while the agreements are missing and through the remaining steps after them.
  const [setupOpen, setSetupOpen] = useState(false);
  // Opened when the agreements turn out to be missing, while rendering (React's "adjust state when a value changes").
  const legalRequired = overview?.legalRequired;
  const [legalSeen, setLegalSeen] = useState(legalRequired);
  // Nivå 1 på mobil (2026-10-09): Hem draws its native tiles on a phone at level 1.
  const native = useNativeMode();
  // The device at hand (plan 1P): the display level it has, the one a "Byt visning" changes.
  const thisDevice = useCurrentDevice();
  // Visning per enhet and Workflow AI (2026-10-24): popups beside Anpassa menyn on Mina inställningar. The parts'
  // old addresses open them too (?step=display; ?step=advisor, ai, apps), adjusted while rendering when the address
  // changes. In the app look they stay the settings' own screens.
  const settingsStep = searchParams.get("step") ?? "";
  // Anslutna appar stands on the page, not in the popup Workflow AI (2026-11-21: MCP is the company's own AI, not Workflow AI).
  const stepPopup: SettingsPopup | null = view !== "settings" ? null : settingsStep === "display" ? "display" : ["advisor", "ai"].includes(settingsStep) ? "ai" : null;
  const [settingsPopup, setSettingsPopup] = useState<SettingsPopup | null>(stepPopup);
  const [stepPopupSeen, setStepPopupSeen] = useState(stepPopup);
  if (stepPopup !== stepPopupSeen) {
    setStepPopupSeen(stepPopup);
    if (stepPopup) setSettingsPopup(stepPopup);
  }
  // Leaving Mina inställningar closes them, so coming back does not find one still open.
  if (view !== "settings" && settingsPopup) setSettingsPopup(null);
  const closeSettingsPopup = () => {
    setSettingsPopup(null);
    if (stepPopup) router.replace("/?view=settings", { scroll: false });
  };
  // The content level (A2): on a phone 3 with Visa mer or Visa allt, while the layout stays the app.
  const contentLevel = useDetailLevel();
  // U1/T2: the page's code is fetched at once, beside the workspace's own read; the job editor when the browser is idle.
  useEffect(() => { preloadView(view, { native }); }, [view, native]);
  const signedIn = Boolean(user);
  useEffect(() => { if (signedIn) preloadLikely(); }, [signedIn]);
  if (legalSeen !== legalRequired) { setLegalSeen(legalRequired); if (legalRequired) setSetupOpen(true); }
  const notificationFeed = useTaskNotificationFeed({ enabled: Boolean(user && overview && overview.organization.storageMode !== "LOCAL"), resetKey: overview?.organization.id });
  useCloudRunningTimers(Boolean(user && overview && overview.organization.storageMode !== "LOCAL"));
  const [loading, setLoading] = useState(Boolean(user));
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ text: string; error: boolean; warning?: boolean; actions?: WorkspaceToastAction[]; durationMs?: number; at?: number } | null>(
    null,
  );
  const [preferences, setPreferences] =
    useState<Preferences>(defaultPreferences);
  // The latest preferences for a save made right after another one, before the page has drawn again.
  const preferencesRef = useRef<Preferences>(defaultPreferences);
  useEffect(() => { preferencesRef.current = preferences; }, [preferences]);
  const [busy, setBusy] = useState(false);
  const [reportBranding, setReportBranding] = useState<ReportBranding>({
    ...DEFAULT_REPORT_BRANDING,
  });
  // The document profile saves itself like the rest of the page (D9, UX punkt 8): a colour is saved a moment after the last
  // change (a colour picker sends a change for every step of the drag), without a button of its own.
  const brandingTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(brandingTimer.current), []);
  const logoInput = useRef<HTMLInputElement>(null);
  // Every message carries its time (`at`): without it a message counted as old at once, and a page that cleans its own
  // address right after a message (Google-kopplingens besked, ?googleLink=) lost it in the same moment.
  const notify = useCallback(
    (text: string, isError = false) => setToast({ text, error: isError, at: Date.now() }),
    [],
  );
  const [refreshCount, setRefreshCount] = useState(0);
  // Beslutsstöd (2026-10-01): the person's tip setting is saved at once, merged on the server.
  const saveAdvisor = useCallback(async (advisor: Preferences["advisor"]) => {
    setPreferences((current) => ({ ...current, advisor }));
    try { await action({ action: "advisor", advisor }); } catch (issue) { setToast({ text: (issue as Error).message, error: true, at: Date.now() }); }
  }, []);
  // Mina inställningar (2026-10-07): every choice is saved the moment it is made; the menu and the display
  // level follow at once, without reloading the page.
  // Arbetsvy (2026-10-08): the levels in force are the person's own only while they were chosen under the admin's
  // current view; otherwise the view's (lib/workflow/work-view.ts).
  // Yrkesprofil (2026-11-01, lib/workflow/work-profile.ts): the admin's choice from the shell and the person's own from the
  // preferences, read here so a change counts at once. Under "Visa som" there is none, and Local and the demo have no work views:
  // the demo's people have a profile for the menu, Ny and Hem (2026-11-04), but the shell draws the demo at the levels of no view, so the settings must say the same.
  const shellProfile = useWorkProfile();
  const adminWork = shellProfile?.admin ?? NO_ADMIN_WORK_CHOICES;
  const profileOff = Boolean(user?.viewAs);
  const viewsOff = profileOff || Boolean(user?.localStorageMode) || demo;
  const ownProfile = preferences.ownWorkProfile;
  const workView = useMemo(() => viewsOff ? null : effectiveWorkView(adminWork, ownProfile), [viewsOff, adminWork, ownProfile]);
  const profileInForce = profileOff ? NO_WORK_PROFILE : effectiveWorkProfile(adminWork, ownProfile);
  const layoutInForce = effectiveNativeLayout(profileInForce, preferences);
  // Only what changed is sent and the server merges it (simulation 0.6.3: a phone and a tablet open at once wrote back each
  // other's older levels, and the tablet jumped from 2 to 3).
  const savePreferences = useCallback(async (patch: PreferencesPatch, message: string) => {
    const next = applyPreferencesPatch(preferencesRef.current, patch);
    preferencesRef.current = next;
    setPreferences(next);
    try {
      await action({ action: "preferences", data: patch });
      const inForce = profileOff ? NO_WORK_PROFILE : effectiveWorkProfile(adminWork, next.ownWorkProfile);
      const menu = effectiveMenuChoices(inForce, next);
      window.dispatchEvent(new CustomEvent(MENU_VISIBILITY_EVENT, { detail: { hidden: menu.hiddenMenuItems, shortcuts: menu.menuShortcuts, phone: menu.phoneMenu ? { hidden: menu.phoneMenu.hiddenMenuItems, shortcuts: menu.phoneMenu.menuShortcuts } : null } }));
      window.dispatchEvent(new CustomEvent(DETAIL_LEVEL_EVENT, { detail: effectiveDetailLevels(viewsOff ? null : effectiveWorkView(adminWork, next.ownWorkProfile), next) }));
      if ("ownWorkProfile" in patch || "choiceBasis" in patch) window.dispatchEvent(new CustomEvent(NATIVE_LAYOUT_EVENT, { detail: effectiveNativeLayout(inForce, next) }));
      // The shell's work view, the menu's order and the overview's start tab come from the server's page.
      if ("ownWorkProfile" in patch) router.refresh();
      // Visning 1: an ordinary automatic save of the display choice is silent (audit 2026-10-12: the toast covered the bottom row's buttons).
      if (!(message.startsWith("Visning på") && document.documentElement.dataset.native === "1")) setToast({ text: message, error: false, at: Date.now() });
      return true;
    } catch (issue) {
      setToast({ text: (issue as Error).message, error: true, at: Date.now() });
      return false;
    }
  }, [adminWork, profileOff, viewsOff, router]);
  // Customers are read only for the views whose forms list them (2026-09-26: fetch only what is shown).
  const customerOptions = useCustomerOptions(Boolean(overview) && overview?.organization.storageMode !== "LOCAL" && ["workflow_task", "new_project", "project", "quote", "purchase"].includes(view));
  // A newly registered owner meets the guide at once, whatever page they land on (2026-10-03).
  const setupAdmin = user?.viewAs ? user.viewAs !== "member" : Boolean(overview?.admin);
  // A member invited without a yrkesprofil meets the guide too, once, to choose one (or skip it).
  const setupMember = !setupAdmin && !user?.viewAs && !profileInForce.profile;
  const setupDue = JSON.stringify([setupAdmin, setupMember, preferences.tours.setupPending, preferences.tours.setup]);
  const [setupDueSeen, setSetupDueSeen] = useState(setupDue);
  if (setupDueSeen !== setupDue) { setSetupDueSeen(setupDue); if ((setupAdmin || setupMember) && preferences.tours.setupPending && !preferences.tours.setup) setSetupOpen(true); }
  // Arbetsytans minnescache (stabil sidladdning steg 7): one scope per person, company, Visa som, role and permissions. A new
  // scope empties what was kept for the one before, before anything of the new one is drawn.
  const dataScope = workspaceCacheScope(user ? { id: user.id, organizationId: user.organizationId, viewAs: user.viewAs, role: user.role, memberRole: user.memberRole, workflowPermissions: user.workflowPermissions } : null);
  enterWorkspaceCacheScope(dataScope);
  // The overview is read again only when the person, the company, Visa som or the permissions change (P7, steg 8b): the
  // server sends a new `user` object with every page change, and the overview was read again on every one of them.
  const overviewFor = user ? dataScope ?? "signed-in" : null;
  const refresh = useCallback(async () => {
    if (!overviewFor) return;
    takeWorkspaceChange();
    try {
      const data = await api<Overview>("/api/workspace");
      invalidateCustomerOptions();
      setRefreshCount((count) => count + 1);
      setOverview(data);
      // The person's settings and the company's report colours start from what was read.
      setPreferences({ ...defaultPreferences, ...data.preferences });
      setReportBranding({
        primary: data.settings?.reportPrimary ?? DEFAULT_REPORT_BRANDING.primary,
        accent: data.settings?.reportAccent ?? DEFAULT_REPORT_BRANDING.accent,
        soft: data.settings?.reportSoft ?? DEFAULT_REPORT_BRANDING.soft,
      });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [overviewFor]);
  useLoadEffect(refresh);
  // A page change after a change somewhere (a save through api()) reads the overview once more, as every page change did
  // before; a page change without one reads nothing (steg 8b).
  const pageFor = `${view}|${searchParams.toString()}`;
  const overviewPage = useRef(pageFor);
  useEffect(() => {
    if (overviewPage.current === pageFor) return;
    overviewPage.current = pageFor;
    if (takeWorkspaceChange()) queueMicrotask(() => void refresh());
  }, [pageFor, refresh]);
  useEffect(() => {
    if (overview) {
      window.dispatchEvent(
        new CustomEvent(WORKFLOW_BRANDING_EVENT, {
          detail: shellBranding(
            overview.organization,
            overview.settings?.logoPath,
            instance,
          ),
        }),
      );
    }
  }, [overview, instance]);
  useEffect(() => {
    document.documentElement.style.fontSize = `${(Number(preferences.textScale) / 100) * 16}px`;
    // Som enheten (D5, 2026-10-21): the device's own light or dark mode, followed while the page is open.
    const device = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyTheme(document.documentElement, resolveTheme(preferences.theme, device.matches));
    apply();
    // Kompakt tabellvisning is gone as a choice (2026-10-09 natt): every table has the ordinary density.
    document.documentElement.dataset.density = "comfortable";
    if (preferences.theme !== "system") return;
    device.addEventListener("change", apply);
    return () => device.removeEventListener("change", apply);
  }, [preferences.theme, preferences.textScale]);
  // Profilmenyn and Anpassa menyn (C1, 2026-10-21) live in the shell: it is told the person's choices and sends its changes here.
  const menuInForce = JSON.stringify(effectiveMenuChoices(profileInForce, preferences));
  useEffect(() => {
    window.dispatchEvent(new CustomEvent<PreferencesState>(PREFERENCES_STATE_EVENT, { detail: { theme: preferences.theme, textScale: preferences.textScale, ...JSON.parse(menuInForce), profileStamp: profileInForce.stamp } }));
  }, [preferences.theme, preferences.textScale, menuInForce, profileInForce.stamp]);
  useEffect(() => {
    const onPatch = (event: Event) => { const { patch, message } = (event as CustomEvent<{ patch: PreferencesPatch; message: string }>).detail; void savePreferences(patch, message); };
    window.addEventListener(PREFERENCES_PATCH_EVENT, onPatch);
    return () => window.removeEventListener(PREFERENCES_PATCH_EVENT, onPatch);
  }, [savePreferences]);
  useEffect(() => {
    if (!toast) return;
    // An error stays a little longer, so it can be read after the page has moved to the field.
    // One with buttons (Ångra) stays long enough to be used.
    // Shorter on level 1 (2026-10-12): the toast sits over the flow's row and must not stay in the way.
    const t = setTimeout(() => setToast(null), toast.durationMs ?? (toast.actions?.length ? 15000 : toast.error ? 10000 : native ? 2500 : 6500));
    return () => clearTimeout(t);
  }, [toast, native]);
  // Level 1 (2026-10-12): the toast covered Föregående/Nästa; with a flow row on the page it is lifted above it, by the
  // row's own height. Measured when the toast appears (the row's height varies with its hint).
  const toastElement = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const element = toastElement.current;
    if (!element) return;
    const place = () => {
      const flow = native ? document.querySelector<HTMLElement>(".native-flow") : null;
      const lift = flow ? Math.ceil(flow.getBoundingClientRect().height) : 0;
      const bottom = lift ? `calc(5.125rem + ${lift}px + env(safe-area-inset-bottom))` : "";
      if (element.style.bottom !== bottom) element.style.bottom = bottom;
    };
    place();
    if (!native) return;
    // The page can change under a toast that is still shown (Spara closes the step for the job's menu): it follows the row
    // that is there now, so it does not hang in the middle of a page without one.
    const observer = new MutationObserver(place);
    observer.observe(document.querySelector(".workspace-main") ?? document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [toast, native]);
  // Messages from anywhere on the page (Slutför leading to a missing field) are shown as this toast.
  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceToast>).detail;
      if (detail?.clear) setToast(null);
      else if (detail?.withdraw) setToast((current) => current?.text === detail.text ? null : current);
      else if (detail?.text) {
        const text = detail.text;
        setToast({ text, error: Boolean(detail.error), warning: Boolean(detail.warning) && !detail.error, actions: detail.actions, durationMs: detail.durationMs, at: Date.now() });
        // En händelse = ett besked (beslut 12, 2026-10-18): says the page already the same thing in a row or a banner of its
        // own (the red line in a dialog, the notice under a button), the toast is not drawn on top of it.
        // The row or banner can come a little after the toast (a save that locks the page), so the page is looked at three times.
        if (!detail.actions?.length) for (const delay of [60, 400, 1200]) window.setTimeout(() => { if (sentenceShownOnPage(text)) setToast((current) => current?.text === text ? null : current); }, delay);
      }
    };
    window.addEventListener(WORKSPACE_TOAST_EVENT, show);
    return () => window.removeEventListener(WORKSPACE_TOAST_EVENT, show);
  }, []);
  // A message that belonged to the page the person has left, or to an action that is over, leaves with it (2026-10-18). A message
  // that was just given – the one the navigation itself came from, "Projektet är skapat" – stays; one with a button (Ångra) is
  // withdrawn by its own timer.
  const addressKey = `${view}|${searchParams.toString()}`;
  // The old address of the home-screen editor (Inställningar, step=home) opens the edit mode on Hem at level 1 (2026-10-21).
  useEffect(() => {
    if (native && view === "settings" && searchParams.get("step") === "home") router.replace("/?view=stats&edit=home");
    // En jobblista (B3, 2026-10-23): in the app look Mina arbetsordrar is the Jobb tab's list with Arbetsordrar chosen.
    if (native && view === "work_orders") router.replace("/?view=tasks&type=work_orders");
  }, [native, view, searchParams, router]);
  useEffect(() => {
    const timer = window.setTimeout(() => setToast((current) => current && toastIsStale(current) ? null : current), 0);
    return () => window.clearTimeout(timer);
  }, [addressKey]);
  const perform = async (input: unknown, message: string) => {
    setBusy(true);
    try {
      await action(input);
      notify(message);
      // What the views show may have changed with it: they read again (and keep showing the old rows meanwhile).
      invalidateWorkspaceCache();
      await refresh();
      return true;
    } catch (e) {
      notify((e as Error).message, true);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const changeBranding = (next: ReportBranding) => {
    setReportBranding(next);
    window.clearTimeout(brandingTimer.current);
    brandingTimer.current = window.setTimeout(() => void perform({ action: "settings", data: { reportBranding: next } }, "Dokumentprofilen är sparad."), 600);
  };
  // Kunduppgifter redigeras i kundregistret (2026-10-09). Plan 1Q (2026-10-11): on display 2 and 3 Redigera folds the form
  // out in the register and on the card, and Ny kund is a popup/page there; only display level 1 (and a trip with a way back,
  // returnTo) goes to the register's own form page.
  function customerModal(c?: CustomerItem) {
    router.push(c ? `/?view=customers&customerId=${encodeURIComponent(c.id)}&edit=1` : "/?view=customers&new=1");
  }
  const heading = (title: string, description: string, actions?: React.ReactNode) => <PageHeader title={title} description={description} actions={actions} />;
  // Serveruppdateringar väntar (2026-11-06): once per sign-in, the superadmin only and not while previewing; a line under the
  // page's heading since 2026-11-12 (as a toast at the top right it covered the head's buttons).
  const serverUpdates = useServerUpdatesNotice(user?.role === "SUPERADMIN" && !user.viewAs && !demo);
  // After an update (2026-10-06): a quiet line, once per person and version, until it is closed or opened.
  // A new account (Kom igång waiting or just done, no version seen yet) is not told about an update it never had (resa 2026-11-06).
  const releaseNotice = user && overview && !overview.legalRequired && !setupOpen && view !== "setup" && !(preferences.tours.setupPending && (!preferences.tours.setup || !preferences.tours.releaseNotes))
    ? unseenReleaseVersion(preferences.tours.releaseNotes) : null;
  const markReleaseSeen = () => {
    if (!releaseNotice) return;
    setPreferences((current) => ({ ...current, tours: { ...current.tours, releaseNotes: releaseNotice } }));
    void action({ action: "tour", tour: "releaseNotes" }).catch(() => undefined);
  };
  // Hem on a phone draws the notice itself, as the first row of its Notiser, so Hem still fits the screen (punkt 1).
  // Översikten on a phone (dashboard etapp 6–7, 2026-10-28): Hem stays the start page; ?tab= opens the new Översikt.
  const overviewTabAsked = view === "stats" && Boolean(searchParams.get("tab"));
  const nativeHomeShown = native && Boolean(overview) && view === "stats" && !overviewTabAsked;
  let content: React.ReactNode;
  // "Visa som" (2026-10-03): the superadmin's preview draws admin rights and the plan as for that role.
  const shownAdmin = user?.viewAs ? user.viewAs !== "member" : Boolean(overview?.admin);
  // Teamet (2026-10-28): admins or the team:read right; the project statistics also need the project right.
  const shownTeam = shownAdmin || hasWorkflowPermission(normalizeWorkflowPermissionProfile(user?.workflowPermissions), "team", "read");
  const localMode = user?.viewAs ? user.viewAs === "local" : overview?.organization.storageMode === "LOCAL";
  // Which of Tid's tabs the person has, by the same rights as the server checks on every call (lib/workflow/time-tabs.ts).
  const timeTabRights: TimeTabRights = { local: localMode, team: shownTeam, admin: shownAdmin };
  const timeTab: TimeTab = view === "time" ? timeTabOf(searchParams.get("tab"), timeTabRights) : "mine";
  // AI-krediter (2026-10-28): the usable balance and its validity; the raw wallet only until the summary is read.
  const creditTile = overview?.credits ?? { ...EMPTY_CREDIT_SUMMARY, balance: overview?.wallet.balance ?? 0, testMode: overview?.wallet.testMode ?? true };
  const creditLines = creditSummaryLines(creditTile);
  // The pages of Projekt besides the list (2026-10-23), by the rules that draw them below: Planering for whoever reads
  // projects outside Local, Projektstatistik for Teamet with the project right outside Local (the demo has no Projektstatistik).
  const readsProjects = shownAdmin || hasWorkflowPermission(normalizeWorkflowPermissionProfile(user?.workflowPermissions), "projects", "read");
  // Planering's Kalender (2026-10-30, the menu button Kalender's rule until then): every storage mode, by the menu's rule.
  // Företagets moduler (0.39.0): Tidplan needs Planering and Projekt, Projektstatistik needs Projekt.
  const projectPages = { planning: readsProjects && !localMode && moduleInList(user?.modules, "planning") && moduleInList(user?.modules, "projects"), summary: shownTeam && readsProjects && !localMode && !demo && moduleInList(user?.modules, "projects"),
    calendar: calendarAllowed({ memberRole: shownAdmin ? "ADMIN" : "MEMBER", workflowPermissions: normalizeWorkflowPermissionProfile(user?.workflowPermissions), modules: user?.modules }) };
  // Ställ in Workflow on Översikt: under the heading (see underHeadingNow below).
  const setupBanner = view === "stats" && !loading && !error && overview && !overview.legalRequired && !setupOpen && shownAdmin && !preferences.tours.setup ? <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border bg-secondary/40 p-4" data-testid="setup-banner">
    <span className="area-icon panel-icon" data-tone="solid" aria-hidden="true"><Rocket className="size-4" /></span>
    <div className="min-w-0 flex-1"><p className="font-medium">Ställ in Workflow</p><p className="text-xs text-muted-foreground">Några korta steg. Bara avtalet måste godkännas, resten kan du hoppa över.</p></div>
    <Button asChild className="mobile-form-action"><Link href="/?view=setup">Starta guiden</Link></Button>
    <Button type="button" variant="ghost" className="mobile-form-action" onClick={() => { setPreferences((current) => ({ ...current, tours: { ...current.tours, setup: new Date().toISOString() } })); void action({ action: "tour", tour: "setup" }).catch(() => undefined); }}>Inte nu</Button>
  </div> : null;
  if (loading)
    content = (
      // Sidskelett (steg 5): the page's own shape in grey instead of one line of text that a page several screens high replaces.
      <PageSkeleton label="Hämtar din arbetsyta…" testId="workspace-loading" />
    );
  // Tvåstegsverifiering krävs (2026-10-10): the work APIs refuse until it is on; the setup is shown instead of an error.
  else if (error === TWO_FACTOR_SETUP_REQUIRED)
    content = <div><SecuritySettings notify={notify} gate /></div>;
  else if (error)
    content = (
      <Panel title="Kunde inte hämta arbetsytan">
        <p className="text-destructive" role="alert">{error}</p>
        <Button
          onClick={() => {
            setLoading(true);
            void refresh();
          }}
          className="mt-4"
        >
          Försök igen
        </Button>
      </Panel>
    );
  else if (overview && (overview.legalRequired || ((setupOpen || view === "setup") && user?.viewAs !== "member")))
    content = <SetupGuide key="setup-guide" admin={overview.admin} gate={overview.legalRequired} cloudPath={instance.features.billing} credits={instance.features.credits}
      askProfile={overview.admin || Boolean(preferences.tours.setupPending && !preferences.tours.setup && !profileInForce.profile)} workProfile={profileInForce.profile} access={user}
      workAreas={normalizeWorkAreas(overview.settings?.profile?.workAreas)} onModulesSaved={() => router.refresh()} onSaveProfile={(profile: WorkProfile) => savePreferences({ ownWorkProfile: ownWorkProfileChoice(adminWork, profile, new Date()) }, "Yrkesprofilen är sparad.")} local={overview.organization.storageMode === "LOCAL"} aiAvailable={Boolean(SharingPolicyPanel) && instance.features.ai && overview.organization.storageMode !== "LOCAL"}
      display={{ device: thisDevice, level: effectiveDetailLevels(workView, preferences)[thisDevice], save: (level) => savePreferences(detailLevelPatch(workView, preferences, thisDevice, level), `Visning på ${DEVICE_LABEL[thisDevice].toLowerCase()} är sparad.`) }}
      companyName={overview.settings?.companyName || overview.organization.name} contactEmail={overview.settings?.contactEmail ?? ""} organizationNumber={overview.settings?.profile?.organizationNumber ?? ""} profile={overview.settings?.profile} notify={notify}
      onLegalAccepted={refresh}
      onClose={async (leaving) => {
        // A link on the last page: the guide gives way at once, or the page the link opened would stay hidden behind it.
        if (leaving) setSetupOpen(false);
        if (overview.admin || preferences.tours.setupPending) {
          await action({ action: "tour", tour: "setup" }).catch(() => undefined);
          setPreferences((current) => ({ ...current, tours: { ...current.tours, setup: new Date().toISOString() } }));
        }
        setSetupOpen(false);
        if (view === "setup" && !leaving) router.replace("/?view=stats");
        await refresh();
      }} />;
  // Level 1 is for field work (2026-10-09): a heavy desktop page opened there says it is in display level 2 and
  // switches this device on request (lib/workflow/native-mode.ts, nativeHiddenView). Display only; rights are unchanged.
  // On a phone (A2, 2026-10-22) Visa mer draws the page in the app instead (nativeHidesView).
  else if (overview && nativeHidesView(native, contentLevel, view, searchParams))
    content = thisDevice === "phone"
      ? <NativeHiddenPage phone title={VIEW_LABEL[view as keyof typeof VIEW_LABEL] ?? "Sidan"} onSwitch={() => window.dispatchEvent(new CustomEvent(SHOW_MORE_EVENT, { detail: true }))} />
      : <NativeHiddenPage title={VIEW_LABEL[view as keyof typeof VIEW_LABEL] ?? "Sidan"} onSwitch={() => void savePreferences(detailLevelPatch(workView, preferences, thisDevice, 2), "Visningen är bytt till 2 (Lagom).")} />;
  // Company admin pages for someone who is not one, and server pages in Local: the same short answer everywhere.
  else if (overview && (COMPANY_ADMIN_VIEWS as readonly string[]).includes(view) && !shownAdmin)
    content = <NoPermissionBox page />;
  else if (overview && (PRODUCT_VIEWS as readonly string[]).includes(view) && (user?.role !== "SUPERADMIN" || user.viewAs))
    content = <NoPermissionBox page />;
  else if (overview && localMode && (CLOUD_ONLY_VIEWS as readonly string[]).includes(view))
    content = <ViewRequirement text={view === "place" || view === "place_labels" ? "Platssidan och QR-etiketter finns bara med serverlagring." : "Det här finns bara med serverlagring."} cloudLink={shownAdmin} />;
  else if (view === "administration")
    // Användare (a tab of Inställningar, 2026-11-02; list and the person's own page, as Kunder 2026-10-31): members, invitations
    // and rights for the company you work in. Säkerhet (2026-10-10) and Administrationshistorik (folded; open when the address
    // asks for it, e.g. the older ?view=advanced&section=log) follow under the list; both Cloud companies only.
    content = <UsersAdministration notify={notify} personId={user?.id ?? ""}
      operatorAccounts={menuItemAllowed("operator_accounts", { memberRole: shownAdmin ? "ADMIN" : "MEMBER", workflowPermissions: normalizeWorkflowPermissionProfile(user?.workflowPermissions), localStorageMode: localMode, modules: user?.modules })}
      log={!localMode ? (searchParams?.get("section") === "log" ? "open" : "folded") : null} local={localMode}>
      {shownAdmin && !localMode ? <CompanySecurity notify={notify} /> : null}
    </UsersAdministration>;
  // Operatörskonton (a button on Användare, 2026-11-02): Cloud admins, and the demo's invented accounts.
  else if (view === "operator_accounts")
    content = <OperatorAccountsAdmin notify={notify} personId={user?.id ?? ""} msResult={searchParams?.get("ms") ?? ""} />;
  // Företaget (2026-10-07): the profile (Företagsuppgifter), the agreements, and the logo and document profile
  // for the reports. The company's name and contact e-mail are edited only in Företagsuppgifter; the report settings
  // below carry colours and the logo. company_settings (Rapporter och logotyp) opens this page (app/page.tsx).
  else if (view === "company" || view === "company_settings" || view === "credits")
    content = <Administration notify={notify}>
      {overview?.admin ? <Panel icon={Image} title="Logotyp och dokumentprofil" description="Färgerna och logotypen används i företagets PDF- och Excel-rapporter, inte i själva programmet.">
        <div>
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Palette className="size-4 text-primary" />
              Dokumentprofil
            </p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!overview?.admin}
              onClick={() => changeBranding({ ...DEFAULT_REPORT_BRANDING })}
            >
              <RotateCcw />
              Standard
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              ["primary", "Huvudfärg"],
              ["accent", "Accentfärg"],
              ["soft", "Ljus bakgrund"],
            ].map(([key, label]) => (
              <Field
                key={key}
                id={`report-${key}`}
                type="color"
                label={label}
                value={reportBranding[key as keyof typeof reportBranding]}
                disabled={!overview?.admin}
                onChange={(value) => changeBranding({ ...reportBranding, [key]: value.toUpperCase() })}
              />
            ))}
          </div>
          <div
            className="mt-4 h-12 overflow-hidden rounded-lg border"
            aria-label="Förhandsvisning av dokumentfärger"
          >
            <div
              className="h-2"
              style={{ backgroundColor: reportBranding.primary }}
            />
            <div
              className="flex h-10 items-center gap-2 px-3"
              style={{ backgroundColor: reportBranding.soft }}
            >
              <span
                className="h-5 w-16 rounded-sm"
                style={{ backgroundColor: reportBranding.accent }}
              />
              <span className="text-xs font-medium text-slate-900">
                Exempel på protokollprofil
              </span>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Workflow-blå används tills företaget väljer en egen profil.
          </p>
        </div>
        <div className="mt-5">
          {overview?.settings?.logoPath && (
            <img
              src="/api/files/logo"
              alt="Företagslogotyp"
              className="mb-3 h-14 max-w-full rounded border bg-white object-contain p-1"
            />
          )}
          {overview?.settings?.logoPath && overview.admin && (
            <Button
              variant="outline"
              className="mb-4"
              onClick={async () => {
                try {
                  await api("/api/files/logo", { method: "DELETE" });
                  await refresh();
                  notify("Logotypen är borttagen.");
                } catch (e) {
                  notify((e as Error).message, true);
                }
              }}
            >
              Ta bort logotyp
            </Button>
          )}
          <label
            className="block text-sm font-medium"
            htmlFor="company-logo"
          >
            Företagslogotyp för rapporter
          </label>
          <input
            ref={logoInput}
            type="file"
            id="company-logo"
            accept="image/png,image/jpeg,image/webp"
            disabled={!overview?.admin}
            className="sr-only"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              // A damaged picture is caught here, before any upload, so the browser logs no failed request (F21).
              // The server still checks the file itself.
              try {
                const bitmap = await createImageBitmap(file);
                bitmap.close();
              } catch {
                notify("Bilden kunde inte läsas. Välj JPG, PNG eller WebP.", true);
                e.target.value = "";
                return;
              }
              const form = new FormData();
              form.set("file", file);
              form.set("logo", "true");
              try {
                await api("/api/files", { method: "POST", body: form });
                notify("Logotypen är uppdaterad.");
                // The page stays where it is while the company is read again (kundresa 2026-11-07, M40: it jumped to the top).
                const y = window.scrollY;
                await refresh();
                window.requestAnimationFrame(() => window.scrollTo(0, y));
              } catch (err) {
                notify((err as Error).message, true);
              }
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="mt-2"
            disabled={!overview?.admin}
            onClick={() => logoInput.current?.click()}
          >
            <Upload />
            Välj bild
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            PNG, JPEG eller WebP. Logotypen visas i rapporter, inte i appens meny.
          </p>
          <LogoVariantsField settings={overview?.settings} admin={Boolean(overview?.admin)} onChanged={refresh} notify={notify} />
        </div>
      </Panel> : null}
      {/* Abonnemang och fakturor (UX-granskningen C2, 2026-10-22): part of Företag; ?view=credits lands here (Stripe's return,
          e-mails). Local shows what Cloud adds. Only when the installation sells or counts credits. */}
      {/* The public demo has no payment or credits (2026-11-04: its billing read answered 403 and showed a red line). */}
      {overview?.admin && !demo && (instance.features.billing || instance.features.credits) ? <SettingsGroup id="billing" title={localMode ? "Uppgradera till Cloud" : "Abonnemang och fakturor"}
        description={localMode ? "Det här ingår gratis i Local, och det här lägger Cloud till." : "Företagets Cloud-abonnemang och AI-krediter: saldo, köp och historik."}>
        {localMode ? <div className="space-y-6"><UpgradeToCloud admin={shownAdmin} />{shownAdmin && BillingRead ? <BillingRead /> : null}</div> : <div>
          {/* Saldot och Köp krediter är två vanliga kort i sidans rutnät (2026-11-12: inga kort i kort, ingen färgad ruta). */}
          <KeyCardGrid label="Krediter" testId="credit-grid">
            <li className="min-w-0"><Panel className="h-full" icon={Sparkles} title="Kreditsaldo" description="Krediter används bara för AI-funktioner som är påslagna.">
              {/* Verkligt saldo (2026-10-28): expired lots are left out at once, not only after the nightly sweep. */}
              <p className="text-4xl font-semibold tracking-tight" data-testid="credit-balance">
                {creditTile.balance}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">tillgängliga krediter</p>
              {creditLines.split ? <p className="mt-1 text-sm text-muted-foreground">{creditLines.split}</p> : null}
              {creditLines.validity ? <p className="mt-1 text-sm font-medium" data-testid="credit-validity">{creditLines.validity}</p> : null}
              {creditTile.testMode ? <p className="mt-1 text-xs text-muted-foreground">Testläge – inga köpta krediter.</p> : null}
              <p className="mt-4 text-xs leading-5 text-muted-foreground">
                Grundfunktioner, rapporter, PDF, utskrifter och export kräver inga krediter.
              </p>
              {overview?.testAdmin && overview.wallet.testMode && (
                  <Button
                    variant="outline"
                    className="mt-4"
                    disabled={busy}
                    onClick={() =>
                      void perform(
                        { action: "superadmin_test_credit", requestId: crypto.randomUUID() },
                        "100 kostnadsfria AI-testkrediter har lagts till. Inget köp har gjorts.",
                      )
                    }
                  >
                    <Plus />
                    Lägg till 100 gratis AI-krediter
                  </Button>
              )}
            </Panel></li>
            {/* The packages are bought under Köp och betalningar below; this used to promise payment "in the last step"
                (data check 2026-10-04). Admin only since 2026-10-07; a member sees the balance in the AI panel. */}
            <li className="min-w-0"><Panel className="h-full" icon={CreditCard} title="Köp krediter">
              <p className="text-sm text-muted-foreground">
                {BillingRead
                  ? "Välj ett kreditpaket under Köp och betalningar längre ned. Köpta krediter gäller ett kalenderår och används äldst först."
                  : "Krediter köps inte i den här installationen."}
              </p>
            </Panel></li>
          </KeyCardGrid>
          <div className="mt-6">
            {overview ? <CreditHistory key={overview.entries[0]?.id ?? "empty"} entries={overview.entries} total={overview.entryCount ?? overview.entries.length} /> : null}
          </div>
          {BillingRead ? <BillingRead /> : null}
          </div>}
      </SettingsGroup> : null}
      {/* Kom igång (C2): the guide is reopened from Företag (and the card on Översikt), no longer from Mina inställningar. */}
      {/* A card with one way on (hela kortet klickbart, 2026-10-24): the whole card opens the guide. */}
      {overview?.admin ? <Panel link icon={Rocket} title="Ställ in Workflow" description="Guiden går igenom avtalet, företaget, säkerheten, Workflow AI och de första stegen."><Button asChild variant="outline"><Link href="/?view=setup" className="stretched-link"><Rocket />Öppna guiden</Link></Button></Panel> : null}
      {/* Avancerat (C2): how long the history is kept, deletion by hand and the latest changes, folded at the foot; an address
          that lands on the history (?section=history, the older ?view=history_retention) opens it. */}
      {overview?.admin ? <AdvancedFold summary="Historik och lagring: hur länge historiken sparas, radering för hand och senaste ändringar"
        open={searchParams.get("section") === "history"} openKey={searchParams.get("section") ?? ""}>
        {/* Historik och lagring (2026-10-15: one page per tab): how long the company's history is kept and manual
            deletion, part of Företaget; Cloud only. The older ?view=history_retention lands here (app/page.tsx). */}
        {overview?.admin ? <SettingsGroup id="history" title="Historik och lagring" description="Välj hur länge historiken sparas, eller radera gammal historik för hand. Det aktuella innehållet påverkas aldrig.">
          {/* Local keeps its history in the company's own file: the same short answer as every server page there (QA 2026-10-15). */}
          {localMode ? <ViewRequirement text="Det här finns bara med serverlagring." cloudLink /> : <HistoryRetention notify={notify} embedded />}
        </SettingsGroup> : null}
      </AdvancedFold> : null}
    </Administration>;
  // Arbetssätt (2026-10-07, one page since 2026-10-15): the company's on/off choices, one place per choice, and
  // – Cloud with Workflow AI – what Workflow AI may read and do (formerly its own tab; ?view=ai_settings lands on it). The
  // server checks admin on every change.
  // Priser och offert (2026-10-09 natt; a part of Arbetssätt since UX-granskningen C2, 2026-10-22): the markup,
  // hourly rate, validity, terms and the accounts for the bookkeeping; ?view=quote_settings lands on it. Cloud.
  else if (view === "company_features" || (view === "ai_settings" && Boolean(SharingPolicyPanel) && !localMode) || (view === "quote_settings" && !localMode))
    content = overview && shownAdmin ? <div className="space-y-6">
      <FeatureSettings values={featureSettingsOf(overview.settings)} busy={busy} local={localMode}
        onChange={(action, on, message) => void perform({ action, data: { on } }, message)} />
      {/* Företagets moduler (0.39.0): the menu and Hem come from the server's page, so it is read again after a change. */}
      <ModuleSettings disabled={normalizeDisabledModules(overview.organization.disabledModules)} busy={busy} local={localMode} notify={notify}
        onChange={(changes, message) => perform({ action: "modules", data: changes }, message).then((saved) => { if (saved) router.refresh(); return saved; })} />
      {!localMode && overview.prices?.visible !== false ? <SettingsGroup id="prices" title="Priser och offert" description="Det som fylls i från början på nya prisrader, offerter och fakturaunderlag.">
        <PriceSettingsPanel accounting={false} />
      </SettingsGroup> : null}
      {!localMode && CustomerInvoiceSettings ? <SettingsGroup id="invoicing" title="Fakturering" description="Välj om Workflow ska skriva fakturor åt företaget. Det är påslaget från början.">
        <CustomerInvoiceSettings />
      </SettingsGroup> : null}
      {/* Mål (2026-10-28): the company's own goals replace the built-in level in Statistik; ?section=goals. Cloud. */}
      {!localMode ? <SettingsGroup id="goals" title="Mål" description="Företagets egna mål för statistik och ekonomi.">
        <CompanyGoalsPanel />
      </SettingsGroup> : null}
      {SharingPolicyPanel && instance.features.ai && !localMode ? <SettingsGroup id="ai" title="Workflow AI" description="Slå på eller av Workflow AI för företaget och välj vad AI får läsa och göra. AI kan aldrig mer än personen som använder den.">
        <SharingPolicyPanel embedded />
      </SettingsGroup> : null}
      {/* Gränsvärden, a row of its own (N5, 2026-11-01; "Värden och referenser" under the accounts until then): a plain card with
          the way to the register. ?section=values lands on it. */}
      <SettingsPart id="values"><Panel link icon={Scale} title="Gränsvärden" description="Företagets egna gränser för mätningarna i formulären, och var varje gräns kommer ifrån.">
        <Button asChild variant="outline"><Link href="/?view=company_values" className="stretched-link" data-testid="open-company-values"><Scale />Öppna registret</Link></Button>
      </Panel></SettingsPart>
      {/* The accounts for the bookkeeping stood under Avancerat here (C2/C4, 2026-10-22) until 2026-11-03: they are Kopplingar →
          Bokföring now, and the older address ?section=accounting is sent there (app/page.tsx). */}
    </div> : null;
  // Kopplingar (2026-10-31; Kopplingar och nycklar 2026-10-15, Avancerat 2026-10-07): the areas in a list and the open
  // area beside it (?section=<area>, features/integrations/connections.tsx) – Bokföring, Lön och export, Maskiner, API och MCP,
  // every key beside its connection (2026-11-03). Historik och lagring moved to Företaget and Administrationshistorik to
  // Användare; their and the removed areas' older addresses go on (app/page.tsx).
  else if (view === "advanced" || view === "integrations")
    content = IntegrationKeys && instance.features.integrations ? <IntegrationKeys notify={notify} area={searchParams.get("section")} simulator={demo || (user?.role === "SUPERADMIN" && !user.viewAs)} />
      : <ViewRequirement text="API och MCP finns inte i den här installationen." />;
  // Workflow AI in Local: the address keeps saying what Cloud adds (in Cloud it is a part of Arbetssätt, above).
  else if (view === "ai_settings")
    content = <UpgradeToCloud admin={shownAdmin} />;
  // Värden och referenser (2026-10-06): Cloud here; Local's values live in its file (LocalWorkspace below).
  else if (view === "company_values")
    content = !localMode ? <CloudCompanyValues notify={notify} /> : null;
  // Utskick (C6, 2026-10-21): the mailings to the users are a tool, not a setting – a page of Webbplats och utskick.
  else if (view === "mailings")
    content = user?.role === "SUPERADMIN" ? <div className="space-y-6">
      <Mailings notify={notify} embedded header={(actions) => heading("Utskick", "Nyhetsbrev och viktig information till användarna.", actions)} />
    </div> : null;
  // Drift och säkerhet (C6, 2026-10-21; Inloggning och säkerhet 2026-10-15): who may sign in and how, which mails
  // are sent and web push, the superadmin's two-step verification and Visa som – the product owner's preview of a
  // customer's menus and pages (2026-10-03; ?view=view_as lands on it); the installation's security log under
  // Avancerat, and the site map as a part of its own above it (2026-10-24; ?section=sitemap scrolls to it). The keys are under Tjänster och nycklar.
  else if (view === "login_settings" || view === "view_as")
    content = user?.role === "SUPERADMIN" ? <div className="space-y-6">
      {heading("Drift och säkerhet", "Vem som får logga in, automatisk e-post, webbpush, superadmins säkerhet, Visa som och servrarna.")}
      <LoginSettings notify={notify} />
      <SettingsPart id="mail"><MailSettings notify={notify} part="delivery" /></SettingsPart>
      <SettingsPart id="push"><PushSettings notify={notify} /></SettingsPart>
      {/* Appikonen (2026-11-10): the installation's own icon, where it may have one (Community); ?section=icon. */}
      {instance.features.ownIcon ? <SettingsPart id="icon"><InstanceIconSettings notify={notify} /></SettingsPart> : null}
      <PlatformSecurity notify={notify} />
      <SettingsPart id="view-as"><ViewAsPanel current={user.viewAs ?? null} notify={notify} /></SettingsPart>
      {/* Operatörssidan (2026-10-30): the product owner's switch for the prepared AI troubleshooting; ?section=operator. */}
      <SettingsPart id="operator"><OperatorProductSettings notify={notify} /></SettingsPart>
      {/* Webbplatskarta and the security log one step up, each by its own name (2026-10-24): the map is open on the
          page and fetched at once; the log is folded. */}
      {/* Servrar och uppdateringar (2026-10-25): each server's updates, restart and automatic updates; ?section=servers. */}
      <SettingsPart id="servers"><ServerUpdates /></SettingsPart>
      {/* Serverjobb (2026-11-14): every scheduled job, Pausa/Starta and Kör nu for the app's, the backups read-only; ?section=jobs. */}
      <SettingsPart id="jobs"><ServerJobs notify={notify} /></SettingsPart>
      <SettingsPart id="sitemap"><SiteMap autoLoad /></SettingsPart>
      <AdvancedFold summary="Installationens säkerhetslogg" open={searchParams.get("section") === "log"} openKey={searchParams.get("section") ?? ""}>
        <SettingsPart id="log"><PlatformSecurityLog notify={notify} /></SettingsPart>
      </AdvancedFold>
    </div> : null;
  // PDF-mallar (2026-11-03): the documents' texts, visibility and order; ?section=<document type>. The server checks the role on every call.
  // PLC-apparater (2026-11-06): the simulator's devices; the server checks the role on every call.
  else if (view === "plc_devices")
    content = user?.role === "SUPERADMIN" ? <PlcDevicesPage notify={notify} /> : null;
  else if (view === "pdf_templates")
    content = user?.role === "SUPERADMIN" ? <PdfTemplatesPage notify={notify} section={searchParams.get("section")} contentLinks={Boolean(overview)} /> : null;
  // Beteendeanalys (2026-10-07): anonymous counts; the server checks the role on every call.
  else if (view === "behavior_analytics")
    content = user?.role === "SUPERADMIN" ? <BehaviorAnalytics notify={notify} /> : null;
  // Tjänster och nycklar (2026-10-15: "tjänster, nycklar känns lite samma"): every outside service Workflow uses
  // and its key on one page – Översikt on top with each part's status and a jump link (2026-10-08), the server's keys
  // (Stripe, Google, OpenAI, e-mail, Solar …), SCB's company lookup, the map, the address lookup, Microsoft's sign-in and
  // the test of the payment flow in Stripe's sandbox. Each SettingsPart is only an anchor for ?section= (scb, map,
  // address, microsoft, payments). C6 (2026-10-21): the OpenAI key and Workflow AI's choices are in the OpenAI card,
  // the e-mail server's details in the e-mail card – nowhere else – and the EU provider and the AI status under AI. The
  // older ?view=services and ?view=mail_settings (on the e-mail card) open this page. The superadmin; the server checks
  // the role on every call.
  else if (view === "server_keys" || view === "services" || view === "mail_settings") {
    const parts = {
      scb: <SettingsPart id="scb"><CompanyLookupSettings notify={notify} /></SettingsPart>,
      microsoft: <SettingsPart id="microsoft"><MicrosoftSignInSettings notify={notify} /></SettingsPart>,
      // Workflow AI (Azure) is a key card under AI (2026-11-01); in Cloud the only one, since the OpenAI card is Community's (2026-11-21).
      ...(ProviderAdministration ? { azure: <SettingsPart id="ai-azure"><AzureProviderPanel notify={notify} /></SettingsPart> } : {}),
      // Lantmäteriet last on the page: map and address on one card with one sign-in (2026-10-18).
      map: <SettingsPart id="map"><SettingsPart id="address"><LantmaterietSettings notify={notify} /></SettingsPart></SettingsPart>,
      // Rapportera fel eller förslag (2026-11-13): the GitHub key, only with the commercial part.
      ...(IssueReportSettings ? { github: <SettingsPart id="github"><IssueReportSettings notify={notify} /></SettingsPart> } : {}),
    };
    const payments = BillingRead ? <SettingsPart id="payments"><SandboxBillingPanel bare /></SettingsPart> : null;
    const extras = {
      ...(ProviderAdministration ? { openai: (refresh: () => void, row: { serviceSwitch?: { on: boolean } }, bindCheck: (handler: (() => Promise<void>) | null) => void) => <ProviderKeyPanel bare enabled={row.serviceSwitch?.on} onChanged={refresh} bindCheck={bindCheck} /> } : {}),
      smtp: () => <MailSettings notify={notify} part="server" bare />,
    };
    const after = ProviderAdministration ? { ai: <SettingsPart id="ai"><ProviderAdministration part="service" /></SettingsPart> } : undefined;
    content = user?.role === "SUPERADMIN" ? <div className="space-y-6">
      {ServerKeysAdministration ? <ServerKeysAdministration notify={notify} parts={parts} payments={payments} extras={extras} after={after} />
        : <>{heading("Tjänster och nycklar", "Tjänster som Workflow använder och deras nycklar.")}{parts.scb}{parts.microsoft}{parts.map}<MailSettings notify={notify} part="server" /></>}
      {ServerKeysAdministration ? null : payments}
    </div> : null;
  }
  else if (view === "product_overview")
    content = <ProductOverviewPage />;
  // Kundföretag (one page since 2026-10-15): the customer companies; Visa som is on Drift och säkerhet.
  else if (view === "customer_companies")
    content = <div className="space-y-6">
      <CustomerCompanies />
      {/* Workflow's own books (2026-11-01: moved from Priser): not on one company's page. */}
      {AccountingExport && !searchParams.get("companyId") ? <AdvancedFold summary="Fakturor och bokföring: fakturor, orderrader och krediter som CSV till revisorn" open={searchParams.get("section") === "accounting-export"} openKey={searchParams.get("section") ?? ""}><AccountingExport /></AdvancedFold> : null}
    </div>;
  // Priser (C6, 2026-10-21; Priser och AI 2026-10-15): plans, prices, campaigns and discount codes; what an AI
  // answer costs and how AI is used under Avancerat (?view=ai_admin opens it). The provider and its keys are on Tjänster
  // och nycklar. Without ee/'s prices the page is AI-kostnad alone.
  else if (view === "pricing_admin" || view === "ai_admin") {
    const aiDescription = instance.features.credits ? "Kostnad per AI-svar och användningen – utan innehåll." : "Användningen – utan innehåll.";
    const ai = ProviderAdministration || AiUsageAdministration ? <>{ProviderAdministration ? <ProviderAdministration part="cost" /> : null}{AiUsageAdministration ? <AiUsageAdministration /> : null}</> : null;
    const aiOpen = view === "ai_admin" || searchParams.get("section") === "ai";
    content = user?.role !== "SUPERADMIN" ? null : PricingAdministration ? <div className="space-y-6">
      {heading("Priser", "Planer, priser, kampanjer och rabattkoder.")}
      <PricingAdministration notify={notify} />
      {ai ? <AdvancedFold summary="AI-kostnad och AI-användning." open={aiOpen} openKey={aiOpen ? "ai" : ""}><SettingsPart id="ai"><div className="space-y-6">{ai}</div></SettingsPart></AdvancedFold> : null}
    </div> : <>{heading("AI-kostnad", aiDescription)}<div className="space-y-6">{ai}</div></>;
  }
  else if (view === "landing_editor")
    // The landing editor lives in ee/ (Fas 2); without it page.tsx never opens this view.
    content = user?.role === "SUPERADMIN" && LandingEditor ? <LandingEditor /> : <Panel title="Bara för Workflow"><p className="text-sm text-muted-foreground">Landningssidan redigeras av installationens superadmin.</p></Panel>;
  else if (view === "company_website")
    // Min webbsida (2026-11-10; a tab of Mer › Webb och inlägg since 2026-11-20): every company's admin edits its own WordPress
    // pages; Cloud. The server checks the role and the module on every call.
    content = localMode ? <ViewRequirement text="Min webbsida finns bara med serverlagring." cloudLink={shownAdmin} /> : <WebsiteEditor />;
  else if (view === "company_posts")
    // Inlägg (2026-11-10): every company's admin makes posts for its own Facebook page and Instagram account; Cloud. The server checks the role.
    content = localMode ? <ViewRequirement text="Inlägg finns bara med serverlagring." cloudLink={shownAdmin} /> : <PostsPage post={searchParams.get("post")} series={searchParams.get("series")} queue={searchParams.get("queue")} />;
  else if (view === "company_videos")
    // Filmer (2026-11-20): every company's admin uploads finished films to its own YouTube channel; Cloud. The server checks the role and the module.
    content = localMode ? <ViewRequirement text="Filmer finns bara med serverlagring." cloudLink={shownAdmin} /> : <VideosPage video={searchParams.get("video")} />;
  else if (view === "forms")
    // Workflow's superadmin builds Workflow's forms; a company admin in Cloud builds the company's own (2026-09-27).
    content = overview ? <FormBuilder userName={user?.name || undefined} tourSeen={overview ? Boolean(preferences.tours?.formBuilder) : undefined}
      onTourSeen={async () => { await action({ action: "tour", tour: "formBuilder" }); setPreferences((current) => ({ ...current, tours: { ...current.tours, formBuilder: new Date().toISOString() } })); }} /> : null;
  else if (view === "import")
    // Import (2026-10-01) writes through the same tools as the API; a Local workspace keeps its data in the file.
    content = ImportPage && overview?.organization.storageMode !== "LOCAL" ? <ImportPage canBuildForms={Boolean(overview?.admin)}
      // Prisfilerna bara för den som får importera artiklar (2026-10-24); servern nekar de andra.
      canImportArticles={Boolean(overview?.admin) || hasWorkflowPermission(normalizeWorkflowPermissionProfile(user?.workflowPermissions), "catalogue", "edit")} />
      : <Panel icon={Upload} title="Import"><p className="text-sm text-muted-foreground">Import finns i serverlagring. I Local ligger dina data i den egna filen. Använd Lagring för att öppna eller läsa in en fil.</p></Panel>;
  // Platser etapp 3 (2026-10-04): a place with its history (what a QR label opens) and the label sheet; Cloud.
  else if (view === "place" && overview?.organization.storageMode !== "LOCAL")
    content = <PlaceFromAddress />;
  else if (view === "place_labels" && overview?.organization.storageMode !== "LOCAL")
    content = <PlaceLabelsFromAddress />;
  else if (view === "new_task")
    content = <TaskTypePicker projectId={projectId} customerId={customerId} permissions={user?.workflowPermissions} admin={Boolean(overview?.admin)} superadmin={user?.role === "SUPERADMIN"}
      canBuildForms={Boolean(overview?.admin && overview.organization.storageMode !== "LOCAL")} canEditValues={shownAdmin} riskLevels={overview?.organization.storageMode !== "LOCAL"}
      layout={preferences.taskCardLayout}
      onLayoutChange={user ? async (taskCardLayout) => {
        // Saved with the person's other preferences, so the order follows them to every device.
        await action({ action: "preferences", data: { taskCardLayout } });
        setPreferences((current) => ({ ...current, taskCardLayout }));
      } : undefined} />;
  // A new work order or risk assessment without the right to create it gets the same clear message as Ny uppgift, not
  // an editor that cannot be saved (totalkontrollen F8, 2026-09-29). The server refuses the save either way.
  else if (view === "workflow_task" && overview?.organization.storageMode !== "LOCAL" && overview && !taskId && taskType !== "FORM"
    && !overview.admin && !hasWorkflowPermission(normalizeWorkflowPermissionProfile(user?.workflowPermissions), taskType === "RISK_ASSESSMENT" ? "risk-assessment" : "work-order", "create"))
    content = <div className="space-y-4">
      <PageHeader title={taskType === "RISK_ASSESSMENT" ? "Ny riskbedömning" : "Ny arbetsorder"} />
      <p className="notice" role="status">Du saknar behörighet att skapa {taskType === "RISK_ASSESSMENT" ? "riskbedömningar" : "arbetsorder"}. En företagsadministratör kan ändra dina behörigheter.</p>
    </div>;
  else if (view === "workflow_task" && overview?.organization.storageMode !== "LOCAL" && overview)
    content = <WorkflowTaskEditor
      canRemove={Boolean(overview.canDeleteControls)}
      kind={(taskType === "RISK_ASSESSMENT" || taskType === "FORM" ? taskType : "WORK_ORDER") as WorkflowTaskKind}
      taskId={taskId}
      projectId={projectId}
      customerId={customerId}
      customers={customerOptions}
      projects={overview.projects}
      // "Lägg nya mätningar överst" is gone as a choice (2026-10-09 natt): a new row is always added last.
      rowOptions={{ rowsOnTop: false }}
      userName={user?.name || undefined}
      userId={user?.id}
      canCreatePlaces={Boolean(overview.admin) || hasWorkflowPermission(normalizeWorkflowPermissionProfile(user?.workflowPermissions), "customers", "create")}
      canCreateWorkOrders={Boolean(overview.admin) || hasWorkflowPermission(normalizeWorkflowPermissionProfile(user?.workflowPermissions), "work-order", "create")}
      canEditWorkOrders={Boolean(overview.admin) || hasWorkflowPermission(normalizeWorkflowPermissionProfile(user?.workflowPermissions), "work-order", "edit")}
      canBookJob={(jobProjectId) => canBookJob(normalizeWorkflowPermissionProfile(user?.workflowPermissions), Boolean(overview.admin), jobProjectId, organizationModuleOn(overview.organization, "projects"))}
      customerLinks={{
        canCreate: Boolean(overview.admin) || hasWorkflowPermission(normalizeWorkflowPermissionProfile(user?.workflowPermissions), "customers", "create"),
        canEdit: Boolean(overview.admin) || hasWorkflowPermission(normalizeWorkflowPermissionProfile(user?.workflowPermissions), "customers", "edit"),
      }}
      // Priser på materialraden (2026-10-09): the server says who may see prices; the demo has no such answer and follows the role.
      prices={overview.prices ?? { visible: Boolean(overview.admin), markupPercent: "" }}
      // Fakturaunderlag (QA 2026-10-10): only for admin or Offerter – läsa, like the project page; the server decides.
      invoiceBases={Boolean(overview.admin) || hasWorkflowPermission(normalizeWorkflowPermissionProfile(user?.workflowPermissions), "quotes", "read")}
    />;
  else if (
    overview?.organization.storageMode === "LOCAL" &&
    ["stats", "notifications", "customers", "new_project", "projects", "planning", "rounds", "project", "tasks", "work_orders", "time", "workflow_task", "facilities", "deviations", "self_inspection", "instruments"].includes(view)
  )
    content = null; // The local workspace remains mounted across menu navigation below.
  // Egenkontroll (2026-10-06): Cloud reads /api/self-inspection; Local keeps the programme in its file (above).
  else if (view === "self_inspection" && overview)
    content = <SelfInspectionPage key={overview.organization.id} />;
  // Avvikelser (2026-10-30): the company's deviation log as a page of its own, read through the same backend.
  else if (view === "deviations" && overview)
    content = <SelfInspectionPage key={`${overview.organization.id}-deviations`} mode="deviations" />;
  // Instrument (2026-10-07): the register has a page of its own under Kvalitet.
  else if (view === "instruments" && overview)
    content = <InstrumentsPage key={overview.organization.id} />;
  // Mina uppgifter / Jobb (U1/T2): the list alone, without the code of Projekt and Planering.
  else if (view === "tasks" && overview)
    content = <TasksPage personId={user?.id ?? ""} permissions={user?.workflowPermissions} admin={Boolean(overview.admin)} />;
  else if (["new_project", "projects", "planning", "project"].includes(view) && overview)
    content = <WorkflowProjects
      view={view as "new_project" | "projects" | "planning" | "project"}
      projectId={projectId}
      customers={customerOptions}
      permissions={user?.workflowPermissions}
      admin={Boolean(overview.admin)}
      personId={user?.id ?? ""}
      onProjectSaved={() => void refresh()}
      projectPages={projectPages}
    />;
  // Offerter (2026-10-09, steg B): the company's quotes, in Cloud; the server checks the right Offerter.
  else if ((view === "quotes" || view === "quote" || view === "invoice_bases" || view === "customer_invoices") && overview && localMode)
    content = <div className="space-y-4"><PageHeader title="Offerter" /><ViewRequirement text="Offerter finns med serverlagring. I en lokal arbetsyta finns priser på materialraderna men inga offerter." cloudLink={shownAdmin} /></div>;
  // Inköp (2026-10-16): Cloud only, like the article register it is built on.
  else if ((view === "purchases" || view === "purchase" || view === "articles") && overview && localMode)
    content = <ViewRequirement text="Inköp finns bara med serverlagring. Artiklar och priser kommer från era prisfiler med serverlagring." cloudLink={shownAdmin} />;
  else if (view === "purchases" && overview)
    content = <PurchasesList personId={user?.id ?? ""} />;
  // Underhåll (2026-10-30): Cloud only, like the machine connection; the server checks the right Underhåll.
  else if (view === "maintenance" && overview && localMode)
    content = <ViewRequirement text="Underhåll finns bara med serverlagring." cloudLink={shownAdmin} />;
  else if (view === "maintenance" && overview && !shownAdmin && !hasWorkflowPermission(normalizeWorkflowPermissionProfile(user?.workflowPermissions), "maintenance", "read"))
    content = <NoPermissionBox page />;
  else if (view === "maintenance" && overview)
    content = <MaintenancePage key={overview.organization.id} />;
  // Tavlor och skärmar (2026-11-18): the figures are counted on the server and screens need it, so not for a company that keeps
  // its data in its own file (fråga 3); the server checks every call.
  else if (view === "boards" && overview && localMode)
    content = <ViewRequirement text="Tavlor och skärmar behöver Workflows server och finns inte när företagets uppgifter sparas i en egen fil." cloudLink={shownAdmin} />;
  else if (view === "boards" && overview)
    content = <BoardsPage key={overview.organization.id} personId={user?.id ?? ""} />;
  else if (view === "purchase" && overview)
    content = <PurchaseEditorFromAddress projects={overview.projects} customers={customerOptions} />;
  else if (view === "articles" && overview)
    content = <ArticlesPage />;
  else if (view === "quotes" && overview)
    content = <QuotesList personId={user?.id ?? ""} canEditHint={Boolean(overview.admin) || hasWorkflowPermission(normalizeWorkflowPermissionProfile(user?.workflowPermissions), "quotes", "edit")} />;
  // Fakturaunderlag (2026-10-28): the company's list; the server checks Offerter – läsa and the job's or project's right.
  else if (view === "invoice_bases" && overview)
    content = <InvoiceBasesList personId={user?.id ?? ""} projects={overview.projects} />;
  // Fakturor (2026-11-04): the server refuses while the company's setting is off, and the page then says so; nothing links here.
  else if (view === "customer_invoices" && overview && CustomerInvoices)
    content = <CustomerInvoices personId={user?.id ?? ""} />;
  else if (view === "quote" && overview)
    content = <QuoteEditorFromAddress projectId={projectId} customerId={customerId} customers={customerOptions} projects={overview.projects} />;
  // Register och verktyg (2026-10-09): the hub of the supporting pages, by the menu's own rule.
  else if (view === "tools" && overview)
    content = <ToolsHub access={user ? { ...user, localStorageMode: localMode, ai: Boolean(clientExtensions.AssistantPanel), importPage: Boolean(ImportPage) } : null} />;
  // Kalkylator (2026-10-12): the calculators run in the browser, so every storage mode and the demo have them.
  else if (view === "calculators" && overview)
    content = <CalculatorsPage admin={shownAdmin} local={localMode} notify={notify} />;
  // Projektsammanställning (2026-10-09): statistics across projects under Projekt; in Cloud for Teamet with the
  // project right, as the server (2026-10-28).
  else if (view === "project_summary" && overview)
    content = shownTeam && readsProjects && !localMode ? <ProjectSummaryPage /> : localMode ? <ViewRequirement text="Projektstatistiken finns bara med serverlagring." cloudLink={shownAdmin} /> : <NoPermissionBox page />;
  // Planering (plan 1M, 2026-10-11): the project's parts on one page; Cloud and the demo, with the right to read projects.
  else if (view === "project_planning" && overview)
    content = shownAdmin || hasWorkflowPermission(normalizeWorkflowPermissionProfile(user?.workflowPermissions), "projects", "read")
      ? <ProjectPlanningPage personId={user?.id ?? ""} projectId={projectId} statistics={projectPages.summary} expectedProjects={overview.projects.filter((project) => project.status ? project.status.ongoing : !project.archivedAt && !project.closedAt).length} />
      : <ViewRequirement text="Du saknar behörighet att läsa projekt." />;
  // Kapacitet (2026-11-01): booked hours per person and week, Planering's third view; Cloud and the demo, by Kalender's rule.
  else if (view === "capacity" && overview)
    content = projectPages.calendar ? <CapacityPage /> : <ViewRequirement text="Du saknar behörighet att läsa planering." />;
  // Rapportarkiv (2026-10-07): the PDF and Excel reports a person chose to keep when exporting; in Cloud.
  else if (view === "report_archive" && overview)
    content = <ReportArchive notify={notify} cloud={!localMode} personId={user?.id ?? ""} />;
  // Tid has three tabs (2026-11-01, beslut 13), each its own address; Lön och export reads nothing of the time report.
  else if (view === "time" && overview)
    content = timeTabDenied(searchParams.get("tab"), timeTabRights) ? <NoPermissionBox page /> : timeTab === "payroll" ? <TimePayrollTab admin={shownAdmin} integrations={instance.features.integrations} /> : <TimeReport focusTaskId={timeTaskId} tab={timeTab} />;
  // In the app look the address is on its way to the Jobb tab (B3, the effect above): nothing of the old list is drawn first.
  else if (view === "work_orders" && native)
    content = null;
  // Mina arbetsordrar (2026-09-26): its own menu group; the server checks the module permission.
  else if (view === "work_orders" && overview)
    content = <WorkOrderList personId={user?.id ?? ""} canCreate={Boolean(overview.admin) || hasWorkflowPermission(normalizeWorkflowPermissionProfile(user?.workflowPermissions), "work-order", "create")}
      canReadArea={Boolean(overview.admin) || hasWorkflowPermission(normalizeWorkflowPermissionProfile(user?.workflowPermissions), "work-order", "read")} />;
  // Driftronder (2026-09-28): recurring rounds; the server filters by the forms the member may read.
  else if (view === "rounds" && overview)
    content = <FormRounds personId={user?.id ?? ""} />;
  else if (view === "notifications" && overview)
    content = <TaskNotifications key={overview.organization.id} feed={notificationFeed} />;
  // The register itself needs Kunder (2026-10-24): without it a member picks a customer in a job (the picker's
  // fields only, app/api/records), but the list on its address is the permission box – as the menu, which has no Kunder.
  else if (view === "customers" && !customerId && overview && user && !localMode && !shownAdmin && !hasWorkflowPermission(normalizeWorkflowPermissionProfile(user.workflowPermissions), "customers", "read"))
    content = <NoPermissionBox page />;
  // Ny kund / Redigera kund (2026-10-09): the form in the register's own page, with the way back to the work – at level 1,
  // and from a form that was left for it (returnTo). Otherwise it is folded out in the register or on the card (plan 1Q).
  else if (view === "customers" && overview && user && !localMode && (searchParams.get("edit") === "1" || searchParams.get("new") === "1") && (native || searchParams.get("returnTo")))
    content = <CustomerEditPage key={`${customerId ?? "new"}-${searchParams.get("returnTo") ?? ""}`} customerId={searchParams.get("new") === "1" ? null : customerId ?? null} returnTo={searchParams.get("returnTo")} />;
  // The customer's own page (decision 12B; 2026-10-14 for display 2 and 3): the register with a customerId opens
  // that customer's card – as screens at level 1, as a page in the normal width otherwise. The register is the list.
  else if (view === "customers" && customerId && overview && user)
    content = <CustomerCard key={`${customerId}-${refreshCount}`} customerId={customerId} onEdit={customerModal} canDelete={Boolean(overview.admin)} canEdit={Boolean(overview.admin) || hasWorkflowPermission(normalizeWorkflowPermissionProfile(user?.workflowPermissions), "customers", "edit")}
      canCreateProject={Boolean(overview.admin) || hasWorkflowPermission(normalizeWorkflowPermissionProfile(user?.workflowPermissions), "projects", "create")} />;
  else if (view === "customers" && overview && user)
    content = (
      // Alla objekt under Kundregister (Underhåll, 2026-10-06, B5) when the company uses the module.
      <CustomerRegisterSwitch maintenance={overview.settings?.maintenance === true} personId={user?.id ?? ""}><RecordArchive
        personId={user?.id ?? ""}
        scope={`${user.email}:${overview.organization.id}`}
        admin={overview.admin}
        onEdit={customerModal}
        notify={notify}
        refresh={refresh}
        reloadToken={refreshCount}
        canEditCustomers={Boolean(overview.admin) || hasWorkflowPermission(normalizeWorkflowPermissionProfile(user?.workflowPermissions), "customers", "edit")}
        canCreateProject={Boolean(overview.admin) || hasWorkflowPermission(normalizeWorkflowPermissionProfile(user?.workflowPermissions), "projects", "create")}
      /></CustomerRegisterSwitch>
    );
  else if (view === "stats")
    content = <>
      {/* Nivå 1 på mobil (2026-10-09): Hem with big tiles, the job to continue and the notifications. */}
      {nativeHomeShown && overview ? <NativeHome name={user?.name ?? ""} admin={Boolean(overview.admin)} permissions={normalizeWorkflowPermissionProfile(user?.workflowPermissions)}
        projects={overview.projects} notifications={notificationFeed.items} tiles={layoutInForce.home} ai={Boolean(clientExtensions.AssistantPanel)} local={localMode}
        release={releaseNotice ? { version: releaseNotice, onSeen: markReleaseSeen } : null}
        // Hem is edited in place (2026-10-21, UX-granskningen A1): the same stored choice as before, the same rule for what is offered.
        layout={layoutInForce} defaults={profileNativeLayout(profileInForce.profile)}
        allowed={nativeLayoutAllowed(user ? { ...user, localStorageMode: localMode, demo, ai: Boolean(clientExtensions.AssistantPanel), importPage: Boolean(clientExtensions.ImportPage) } : null)}
        onSaveLayout={(next) => savePreferences({ nativeLayout: next, ...(profileInForce.stamp ? { choiceBasis: { native: profileInForce.stamp } } : {}) }, "Hemskärmen är sparad.").then((saved) => {
          if (saved) window.dispatchEvent(new CustomEvent(NATIVE_LAYOUT_EVENT, { detail: next }));
          return saved;
        })} />
      /* Översikten (dashboard etapp 6–7, 2026-10-28): Jag | Teamet | Ekonomi | Kunder | Statistik in Cloud and the
         demo (whose own /api/overview answers the same, 2026-10-29) on display levels 2 and 3 (and on a phone with ?tab=,
         compact). Local keeps the old Översikt below: its data is the open file, which has no /api/overview. */
      : overview && !localMode ? <OverviewPage access={overviewTabs({ admin: shownAdmin, workflowPermissions: normalizeWorkflowPermissionProfile(user?.workflowPermissions), organization: overview.organization })}
        level={native || contentLevel !== 3 ? 2 : 3} notifications={notificationFeed.items ?? []} readsProjects={readsProjects}
        canCreateWorkOrder={shownAdmin || hasWorkflowPermission(normalizeWorkflowPermissionProfile(user?.workflowPermissions), "work-order", "create")} userName={user?.name ?? ""} />
      /* Nytt projekt and Ny uppgift only for whoever may create them (proposal 2026-10-08, step 4); the server decides anyway. */
      : <Analytics canViewTeam={shownTeam} canReadProjects={readsProjects} projectCount={overview?.projectCount ?? overview?.projects.length ?? 0}
        canCreateProject={moduleInList(user?.modules, "projects") && (Boolean(overview?.admin) || hasWorkflowPermission(normalizeWorkflowPermissionProfile(user?.workflowPermissions), "projects", "create"))}
        canCreateTask={Boolean(overview?.admin) || (NEW_TASK_SUBJECTS).some((subject) => hasWorkflowPermission(normalizeWorkflowPermissionProfile(user?.workflowPermissions), subject, "create"))} />}
    </>;
  else if (view === "settings") {
    // Mina inställningar in four groups (2026-10-09 natt): Visning · Mobil · Notiser och tips · Konto, the same
    // groups as the rows at level 1 on a phone (MY_SETTINGS_GROUPS). Tabeller och mätningar and Kompakt are gone as choices.
    const settingsGroup = (title: string, children: React.ReactNode) => <section className="space-y-4" aria-label={title} data-testid="settings-group">
      <NativeScreen show={[]}><h2 className="section-title">{title}</h2></NativeScreen>
      {children}
    </section>;
    const displaySettings = <div className="space-y-5" data-testid="detail-level-settings">
                <NativeScreen show={["display"]}><div className="space-y-3">
                {native ? <p className="px-1 text-[0.8125rem] leading-5 text-muted-foreground">{thisDevice === "phone" ? "Mobilen visar alltid appvyn. Visa mer längst ned på en sida visar resten. Valet ändrar aldrig vad du får göra." : "Enkel är appvyn för arbete ute. Lagom och Allt är sidorna för kontoret. Valet ändrar aldrig vad du får göra."}</p> : <p className="text-xs leading-5 text-muted-foreground">Enkel visar appvyn. Lagom och Allt visar samma sidor, men Lagom visar färre förklaringar och tips. På mobilen visas alltid appvyn. Fält och knappar döljs aldrig, och valet ändrar inte vad du får göra.</p>}
                {/* Yrkesprofil (2026-11-01): the person's own choice, display only; the server never reads it for what the person may do. */}
                {!user?.viewAs ? <div className="space-y-1" data-testid="work-profile-settings">
                  {(() => {
                    const adminProfile = adminWork.profile?.profile ?? null;
                    const own = ownWorkProfileShown(adminWork, ownProfile);
                    const none = adminProfile ? `Administratörens val: ${WORK_PROFILE[adminProfile].label}` : "Ingen";
                    const options = <WorkProfileOptions none={none} areas={normalizeWorkAreas(overview?.settings?.profile?.workAreas)} />;
                    const change = (value: string) => void savePreferences({ ownWorkProfile: value ? ownWorkProfileChoice(adminWork, value as WorkProfile, new Date()) : null }, "Yrkesprofilen är sparad.");
                    return native
                      ? <><WorkProfileTitleSearch native onPick={(profile) => change(profile)} /><ListGroup><NativePickerRow label="Yrkesprofil" display={own ? WORK_PROFILE[own].label : none} testId="native-work-profile"><select aria-label="Yrkesprofil" value={own ?? ""} onChange={(event) => change(event.target.value)}>{options}</select></NativePickerRow></ListGroup></>
                      : <><WorkProfileTitleSearch onPick={(profile) => change(profile)} /><label className="mt-2 block space-y-1 text-xs text-muted-foreground">Yrkesprofil<select className="form-select" data-testid="work-profile-select" value={own ?? ""} onChange={(event) => change(event.target.value)}>{options}</select></label></>;
                  })()}
                  <p className={native ? "px-1 text-[0.8125rem] leading-5 text-muted-foreground" : "text-xs leading-5 text-muted-foreground"}>{profileInForce.profile ? `${workProfileHint(profileInForce.profile)} ` : ""}Styr bara vad som visas först. Ändrar aldrig vad du får göra.</p>
                </div> : null}
                {/* Arbetsvy (2026-10-08): the admin's default view and the way back to it; not in Local (no members). At level 1 only when the administrator has chosen one (audit 2026-10-12: "ingen vald" was noise). */}
                {!localMode && !user?.viewAs && (!native || workView?.view) ? <div className="flex flex-wrap items-center justify-between gap-3" data-testid="work-view-settings">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Arbetsvy: {workView?.view ? WORK_VIEW_LABEL[workView.view] : "ingen vald"}</p>
                    <p className="text-xs leading-5 text-muted-foreground">{workView?.view ? `${profileInForce.own ? "Följer din yrkesprofil." : "Vald av administratören."} ${WORK_VIEW_DESCRIPTION[workView.view]} Du kan visa mer eller mindre här. Det ändrar aldrig vad du får göra.` : "Administratören har inte valt någon arbetsvy åt dig. Standard är appvyn på mobil, Lagom på surfplatta och Allt på dator."}</p>
                  </div>
                  <Button type="button" variant="outline" data-testid="work-view-reset" onClick={() => {
                    forgetWorkListScopes(user?.id ?? "");
                    void savePreferences({ detailLevel: workViewDefaults(workView).detailLevels, viewBasis: null, ...(profileInForce.profile ? { choiceBasis: RESET_CHOICE_BASIS } : {}) }, "Visningen är återställd till standard.");
                  }}><RotateCcw />Återställ till standard</Button>
                </div> : null}
                {/* M2: at level 1 the device in hand is one row (Mobil); the other devices' choices are in display level 2. A2 (2026-10-22): the
                    phone always shows the app, so its choice is one switch, Visa allt (3) or not (1); a saved 2 reads as on. */}
                <div className={native ? undefined : "grid gap-3 sm:grid-cols-2"}>
                  {(native ? [thisDevice] : ["phone", "tablet", "desktop"] as const).map((device) => { const label = DEVICE_LABEL[device]; const level = effectiveDetailLevels(workView, preferences)[device];
                    if (device === "phone") {
                      const row = <SwitchRow id="phone-show-all" testId="phone-show-all" title={device === thisDevice ? "Visa allt på den här enheten" : "Visa allt på mobilen"}
                        text="Alla fält och förklaringar på varje sida." checked={phoneShowsAll(level)}
                        onCheckedChange={(on) => { void savePreferences(detailLevelPatch(workView, preferences, device, on ? 3 : 1), `Visning på ${label.toLowerCase()} är sparad.`); }} />;
                      return native ? <ListGroup key={device}><div role="listitem" className="px-4">{row}</div></ListGroup>
                        : <div key={device} className="space-y-1 text-xs text-muted-foreground sm:col-span-2">{label}{device === thisDevice ? " (den här enheten)" : ""}{row}</div>;
                    }
                    return native ? <ListGroup key={device}><NativePickerRow label={label} display={`${level} · ${DETAIL_LEVEL_LABEL[level]}`} testId="native-display-device">
                    <select aria-label={`Visning på ${label.toLowerCase()}`} data-device={device} value={level}
                      onChange={(e) => { void savePreferences(detailLevelPatch(workView, preferences, device, Number(e.target.value) as DetailLevel), `Visning på ${label.toLowerCase()} är sparad.`); }}>
                      {DEVICE_LEVELS[device].map((option) => <option key={option} value={option}>{option} · {DETAIL_LEVEL_LABEL[option]}</option>)}
                    </select>
                  </NativePickerRow></ListGroup> : <label key={device} className="block space-y-1 text-xs text-muted-foreground">
                    {label}{device === thisDevice ? " (den här enheten)" : ""}
                    <select aria-label={`Visning på ${label.toLowerCase()}`} className="form-select" data-device={device} value={effectiveDetailLevels(workView, preferences)[device]}
                      onChange={(e) => {
                        const level = Number(e.target.value) as DetailLevel;
                        // The person's own choice, made under the admin's current view (its stamp); only this device is
                        // sent, so the other device's level – perhaps just changed there – is never written back.
                        void savePreferences(detailLevelPatch(workView, preferences, device, level), `Visning på ${label.toLowerCase()} är sparad.`);
                      }}>
                      {DEVICE_LEVELS[device].map((level) => <option key={level} value={level}>{level} · {DETAIL_LEVEL_LABEL[level]}</option>)}
                    </select>
                  </label>; })}
                </div></div></NativeScreen>
                {/* Hem's tiles and the tab bar are arranged on Hem itself since 2026-10-21 (UX-granskningen A1, avsnitt 3): hold
                    a tile there. Only the way there is left here; the old address (step=home) opens the edit mode on Hem. */}
                <NativeScreen show={["home"]}><div className="space-y-2 border-t pt-3" data-testid="native-layout-settings">
                  <p className="text-sm font-medium">Hemskärm och flikrad</p>
                  {native ? <Button asChild variant="outline"><Link href="/?view=stats&edit=home" data-testid="native-layout-open">Ordna hemskärmen</Link></Button>
                    : <p className="text-xs leading-5 text-muted-foreground" data-testid="native-layout-hint">Ordnas på telefonen i visning 1: håll in en ruta på Hem.</p>}
                </div></NativeScreen>
              </div>;
    // The person's own AI choices (2026-10-24): a popup Workflow AI beside Anpassa menyn when the installation has AI,
    // so every user reaches them; the company's AI rule stays under Arbetssätt and its keys under Kopplingar.
    const aiPopup = !native && !localMode && instance.features.ai;
    const tipsSettings = <NativeScreen show={["advisor", "ai"]}><NativeUnwrap wrap={(children) => <Panel icon={Lightbulb} title="Tips och förslag" description="Tips om nästa steg och förslag från Workflow AI.">{children}</Panel>}><div className="space-y-5">
                {/* Beslutsstöd (2026-10-01): how often tips appear under the progress line; saved at once. */}
                {/* No inner heading with a grey line (UX-punkt 6, 2026-10-22): the card says Tips och förslag already. */}
                <NativeScreen show={["advisor"]}><div className="space-y-3" role="group" aria-label="Tips i arbetsflödet" data-testid="advisor-settings">
                  <p className="text-xs text-muted-foreground">Under progressionslinjen visas ibland ett tips om nästa steg. Tipsen bygger på regler i Workflow{instance.features.credits ? " och kostar inga krediter" : ""}. Bara knappen Fråga Workflow AI använder AI.</p>
                  <AdvisorLevelPicker level={preferences.advisor.level} name="advisor-level-settings" onChange={(level) => void saveAdvisor({ ...preferences.advisor, level })} />
                  {preferences.advisor.muted.length ? <Button type="button" size="sm" variant="outline" onClick={() => void saveAdvisor({ ...preferences.advisor, muted: [] })}>Visa avstängda tips igen ({preferences.advisor.muted.length})</Button> : null}
                </div></NativeScreen>
                {/* Workflow AI's proposals (2026-10-02: "normalt bara förslag, men användaren ska kunna välja"); saved at once. Cloud only. */}
                {clientExtensions.SummaryAssist && !localMode ? <NativeScreen show={["ai"]}><div className="space-y-3" role="group" aria-label="Förslag från Workflow AI" data-testid="ai-autofill-settings">
                  <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                    <Checkbox className="mt-0.5" checked={preferences.advisor.autofill} onCheckedChange={(value) => void saveAdvisor({ ...preferences.advisor, autofill: value === true })} />
                    <span><span className="block font-medium">Workflow AI fyller i tomma fält direkt</span><span className="block text-xs text-muted-foreground">Av: AI visar ett förslag du väljer. På: ett förslag du bett om skrivs direkt i tomma fält, och du kan ångra. Att skapa eller ändra uppgifter kräver alltid bekräftelse.</span></span>
                  </label>
                </div></NativeScreen> : null}
              </div></NativeUnwrap></NativeScreen>;
    const appSettings = clientExtensions.MyAppConnections && !localMode ? <NativeScreen show={["apps"]} lead><clientExtensions.MyAppConnections notify={notify} /></NativeScreen> : null;
    const advancedSettings = <>
      <NativeScreen show={["start"]}><div data-testid="settings-start">
        <label htmlFor="quick-action" className="mb-2 block text-xs font-medium text-muted-foreground">Startsida efter inloggning</label>
        <select id="quick-action" className="form-select" value={preferences.quickAction}
          onChange={(e) => void savePreferences({ quickAction: e.target.value as Preferences["quickAction"] }, "Startsidan är sparad.")}>
          <option value="new">Ny uppgift</option>
          <option value="stats">Översikt</option>
          <option value="tasks">Uppgifter</option>
          <option value="customers">Kunder</option>
        </select>
      </div></NativeScreen>
              {/* Visning per enhet (2026-10-24): its own popup beside Anpassa menyn on the page; in the app look the
                  settings' own screen as before. */}
              {native ? <NativeScreen show={["display", "home"]}><NativeUnwrap wrap={(children) => <Panel icon={MonitorSmartphone} title="Visning per enhet" description="Du väljer för varje enhet för sig, och valet sparas direkt.">{children}</Panel>}>{displaySettings}</NativeUnwrap></NativeScreen> : null}
              {/* Tips och förslag and Anslutna appar: in the popup Workflow AI when the installation has AI (2026-10-24); in
                  the app look their own screens here. Without AI they stand open on the page, not under Avancerat. */}
              {native ? tipsSettings : null}
      {native ? appSettings : null}
      {/* Radera mitt konto (2026-10-03, GDPR): last, never for the superadmin of the installation. */}
      {user?.superadmin ? null : <NativeScreen show={["erase"]} lead><EraseAccount /></NativeScreen>}
    </>;
    content = (
      <NativeScreenFrame>
        {/* Nivå 1 på mobil (2026-10-09): grouped rows like the phone's Settings app; each part below is its own
            screen (`&step=`, NativeScreen) and the panels' frames fall away there (NativeUnwrap). Elsewhere unchanged. */}
        <NativeScreen show={[]}>{heading("Mina inställningar", "Varje val sparas direkt och gäller bara dig.")}</NativeScreen>
        <NativeSettingsMenu setupHref={shownAdmin ? "/?view=setup" : null} companyHref={shownAdmin ? "/?view=company" : null}
          has={{ home: !localMode, calendar: !localMode, ai: Boolean(clientExtensions.SummaryAssist) && !localMode, apps: Boolean(clientExtensions.MyAppConnections) && !localMode, erase: !user?.superadmin }}
          values={{
            start: { new: "Ny uppgift", stats: "Översikt", tasks: "Uppgifter", customers: "Kunder" }[preferences.quickAction],
            display: choiceName(thisDevice, effectiveDetailLevels(workView, preferences)[thisDevice]),
            theme: THEME_CHOICE_LABEL[preferences.theme],
          }} />
        {/* Mina inställningar bantad (2026-10-21, UX-granskningen C1; 2026-10-22): Utseende · Konto · Inloggningssätt ·
            Notiser on the page and the rest folded under Avancerat. Tema, Textstorlek and Anpassa menyn stay here, not in the
            profile menu or at the foot of the menu (2026-10-22); Anpassa menyn opens its choices in a popup. Hem is
            arranged on Hem. At level 1 on a phone the rows and screens are unchanged. */}
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            {settingsGroup("Utseende", <NativeUnwrap wrap={(children) => <Panel icon={Palette} title="Tema, text och meny" description="Det du väljer här gäller på alla dina enheter.">{children}</Panel>}>
              <div className="space-y-5">
                <NativeScreen show={["theme"]}><div className="grid gap-4 sm:grid-cols-2">
                  {/* Ljust, Mörkt or Som enheten (D5, 2026-10-21): still two themes; Som enheten follows the device. */}
                  <Field label="Tema" id="theme" options={[...themeChoices]} optionLabels={THEME_CHOICE_LABEL} value={preferences.theme}
                    onChange={(v) => void savePreferences({ theme: v as Preferences["theme"] }, "Temat är sparat.")} />
                  <label className="block space-y-1 text-xs text-muted-foreground">
                    Textstorlek
                    <select aria-label="Textstorlek" className="form-select" value={preferences.textScale}
                      onChange={(e) => void savePreferences({ textScale: e.target.value as Preferences["textScale"] }, "Textstorleken är sparad.")}>
                      <option value="100">Standard (100 %)</option>
                      <option value="110">Större (110 %)</option>
                      <option value="125">Störst (125 %)</option>
                    </select>
                  </label>
                </div></NativeScreen>
                {/* Which menu buttons are shown (2026-09-30): chosen in a popup (the shell's Anpassa menyn) since 2026-10-22. */}
                <NativeScreen show={["sidemenu"]}><div className="flex flex-wrap items-center justify-between gap-3" data-testid="settings-menu-link">
                  <div className="min-w-0"><p className="text-sm font-medium">{native ? "Menyn" : "Meny och visning"}</p><p className="text-xs text-muted-foreground">{native ? "Välj vilka knappar menyn visar." : aiPopup ? "Menyn, visningen per enhet och dina AI-val." : "Menyn och visningen per enhet."}</p></div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" data-testid="menu-customize" onClick={() => window.dispatchEvent(new Event(OPEN_MENU_CUSTOMIZE_EVENT))}><SlidersHorizontal />Anpassa menyn</Button>
                    {/* Visning per enhet (2026-10-24): a popup of its own; in the app look a row of Mina inställningar. */}
                    {native ? null : <Button type="button" variant="outline" data-testid="display-settings-open" onClick={() => setSettingsPopup("display")}><MonitorSmartphone />Visning per enhet</Button>}
                    {aiPopup ? <Button type="button" variant="outline" data-testid="ai-settings-open" onClick={() => setSettingsPopup("ai")}><Sparkles />Workflow AI</Button> : null}
                  </div>
                </div></NativeScreen>
                {/* The same choices as before under Avancerat, saved at once, so only Klart (as Anpassa menyn). */}
                {native ? null : <Modal open={settingsPopup === "display"} onOpenChange={(open) => { if (!open) closeSettingsPopup(); }} title="Visning per enhet" size="form" closeButton={false}>
                  {displaySettings}
                  <DialogActions primary={{ label: "Klart", onClick: closeSettingsPopup, testId: "display-settings-done" }} />
                </Modal>}
                {aiPopup ? <Modal open={settingsPopup === "ai"} onOpenChange={(open) => { if (!open) closeSettingsPopup(); }} title="Workflow AI" size="form" closeButton={false}>
                  <div className="space-y-4" data-testid="ai-settings">{tipsSettings}</div>
                  <DialogActions primary={{ label: "Klart", onClick: closeSettingsPopup, testId: "ai-settings-done" }} />
                </Modal> : null}
              </div>
            </NativeUnwrap>)}
            {settingsGroup("Konto", <>
              <NativeScreen show={["profile"]} lead><Profile notify={notify} /></NativeScreen>
              <NativeScreen show={["install"]} lead><InstallApp /></NativeScreen>
            </>)}
            {settingsGroup("Inloggningssätt", <>
              {/* Säkerhet (2026-10-10): the person's own sign-in, in every storage mode. */}
              <NativeScreen show={["security"]} lead><SecuritySettings notify={notify} /></NativeScreen>
            </>)}
          </div>
          <div className="space-y-6">
            {settingsGroup("Notiser", <>
              <NativeScreen show={["notices"]} lead><NoticeSettings notify={notify} cloud={!localMode} superadmin={user?.role === "SUPERADMIN"} /></NativeScreen>
            </>)}
            {/* Kalenderlänk (PL14, 2026-11-01): a server fetches the file, so never in Local. */}
            {!localMode ? settingsGroup("Kalender", <NativeScreen show={["calendar"]} lead><CalendarLinkSettings notify={notify} /></NativeScreen>) : null}
            {/* An address that names a part under Avancerat (?step=start, erase) opens it there; ?step=display opens Visning per
                enhet and ?step=advisor or ai the popup Workflow AI (without AI the card stands open below). */}
            {/* Without AI, Tips och förslag is the only one left of the AI choices: an open card, not folded (2026-10-24).
                Anslutna appar always stands open here: the apps are the person's own AI, never Workflow AI (2026-11-21). */}
            {!native && !aiPopup ? tipsSettings : null}
            {!native ? appSettings : null}
            {native ? advancedSettings : <AdvancedFold summary="Startsida och radera konto"
              open={["start", "erase"].includes(searchParams.get("step") ?? "")} openKey={searchParams.get("step") ?? ""}>{advancedSettings}</AdvancedFold>}
          </div>
        </div>
      </NativeScreenFrame>
    );
  }
  else {
    // The help's chapters, drawn where they are and handed to the phone's search as its index (svar 5, 2026-10-24:
    // the search reads the whole texts, not only the titles).
    const helpChapters = <>
      {/* Nytt i version … (2026-10-06): the running version's notes first. */}
      <NativeScreen show={["nytt"]} lead><div className="mb-6"><ReleaseNotesPanel /></div></NativeScreen>
      {/* Så hänger det ihop (2026-10-08, Fas 4B): the core model before the step-by-step guide. */}
      <NativeScreen show={["modell"]} lead><div className="mb-6"><CoreModelGuide /></div></NativeScreen>
      <WorkflowGuide />
      {/* The Räkneverktyg page is out of the interface for now (2026-10-08); the top bar's calculator took its place. */}
      <NativeScreen show={["kfid", "kalkylator"]}><div className="mt-6 grid gap-6 lg:grid-cols-2">
        <NativeScreen show={["kfid"]} lead><Panel icon={ClipboardCheck} title="Kontroll före idrifttagning">
          <p className="text-sm leading-6">
            Varje mätvärde bedöms mot gränsen på raden. Jordfelsbrytarens profil
            använder tider och testknapp; granska även de övriga provvärdena.
          </p>
        </Panel></NativeScreen>
        <NativeScreen show={["kalkylator"]} lead><Panel icon={Calculator} title="Kalkylator" description="Räkna ut trefaseffekt med kalkylatorn i toppraden.">
          <p className="text-sm leading-6">Kalkylatorknappen bredvid Sök räknar P = √3 × U × I × cos φ: fyll i två av P, U och I så beräknas det tredje.</p>
        </Panel></NativeScreen>
      </div></NativeScreen>
      {/* Workflow AI (C4, 2026-10-22): the rules that were information panels under Arbetssätt; Arbetssätt links here. */}
      {instance.features.ai && SharingPolicyPanel ? <NativeScreen show={["ai"]} lead><div className="mt-6"><AiRulesHelp /></div></NativeScreen> : null}
      {/* Om Workflow (2026-10-04): the sources the app uses, with the map's attribution as CC BY 4.0 asks. Since A5
          (2026-10-21) also the version and the installation's legal links, which left the menu and the footer. */}
      <NativeScreen show={["om"]} lead><div className="mt-6"><Panel icon={Info} title="Om Workflow" description="Version, juridiska dokument, källor och licenser.">
        <div className="mb-4 space-y-2 border-b pb-4 text-sm leading-6" data-testid="about-workflow">
          <p><span className="font-medium">{instance.name}</span> · <span data-testid="app-version">Version {currentAppVersion()}</span></p>
          {/* The same row of legal links as the public pages (components/legal-links.tsx), without Priser: no price link
              inside the app (2026-10-24, analysens fråga 5). */}
          <LegalLinks linkClassName="text-primary underline-offset-4 hover:underline" />
          {/* The Community edition's licence and source (2026-11-02); the link is the installation's own setting. */}
          {instance.community ? <p data-testid="about-licence">Workflow Community är fri programvara under <a className="underline" href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener noreferrer">GNU Affero General Public License v3.0</a> och levereras utan garanti. {instance.sourceUrl
            ? <>Källkoden finns på <a className="underline" href={instance.sourceUrl} target="_blank" rel="noopener noreferrer" data-testid="about-source">{instance.sourceUrl.replace(/^https?:\/\//i, "")}</a>.</>
            : "Fråga den som driver installationen var källkoden finns."}</p> : null}
        </div>
        <div className="space-y-2 text-sm leading-6" data-testid="about-sources">
          {instance.community
            ? <p>Workflow körs från den här installationen och hämtar inga skript, typsnitt eller bilder från andra webbplatser. Har installationen kopplat en grossist hämtas produktbilderna av installationens server, inte av din webbläsare.</p>
            : <p>Workflow körs helt från den här installationen och hämtar inga skript, typsnitt eller bilder från andra webbplatser. Produktbilder hämtas av vår server, inte av din webbläsare.</p>}
          {/* Beteendeanalys (2026-10-07): what is counted, said plainly. */}
          <p>Installationen kan räkna vilka sidor och funktioner som används, anonymt per dag: ingen person, inget företag, ingen IP-adress och ingen webbläsare kopplas till en räkning, och inga kakor sätts i appen. På publika sidor (startsidan, Skapa konto) mäts bara besökare som själva har valt Tillåt statistik i kakrutan, och valet ändras när som helst med kakknappen.</p>
          <p>Kartan (när installationen har den): {MAP_SOURCE_NAME}, ©Lantmäteriet. Licens <a className="underline" href={MAP_LICENSE_URL} target="_blank" rel="noopener noreferrer">{MAP_LICENSE}</a>. Kartbilderna hämtas och lagras av installationens server och visas oförändrade. Kartnålarna läggs till av Workflow. Kartvisaren är Leaflet (BSD-2).</p>
          {/* Copyright precaution (2026-10-06): every package's licence beside the map's credit. */}
          <p>Workflow bygger på programvara med öppen källkod. <a className="underline" href="/third-party-licenses.txt" target="_blank" rel="noopener noreferrer" data-testid="third-party-licenses">Tredjepartslicenser</a> listar paketen och typsnitten med licenser och licenstexter.</p>
        </div>
      </Panel></div></NativeScreen>
    </>;
    content = (
      // At level 1 the help screens read as the phone's grouped lists (.native-screen); elsewhere no wrapper.
      <NativeScreenFrame>
        {/* Nivå 1 på mobil (2026-10-10): Hjälp is a menu of rows and each panel a screen of its own (`&step=`). */}
        <NativeScreen show={[]}>{heading(
          "Hjälp",
          "Så hänger uppgifter, tid, slutförande och projekt ihop.",
        )}</NativeScreen>
        <NativeHelpMenu ai={instance.features.ai && Boolean(SharingPolicyPanel)} chapters={helpChapters} />
        {helpChapters}
      </NativeScreenFrame>
    );
  }
  // Mitt företag and Installation are one menu button each with tabs (2026-10-01, menystädning).
  // Level 1: Mina inställningar is a menu of rows and the company tabs are in display level 2, so no tab row there. On a
  // phone with Visa mer (A2) a company page or Installation has its tab row, so the next tab is in reach.
  const tabRow = !nativeReduced(native, contentLevel) && (!native || view !== "settings");
  const tabProfile = normalizeWorkflowPermissionProfile(user?.workflowPermissions);
  const workListTabs = { workOrders: shownAdmin || hasWorkflowPermission(tabProfile, "work-order", "read"),
    tasks: shownAdmin || (["kfid", "risk-assessment", "forms"] as const).some((subject) => hasWorkflowPermission(tabProfile, subject, "read") || hasWorkflowPermission(tabProfile, subject, "create")) };
  // Användare's own pages (a person, an invitation, Bjud in) stand without the tab row, like every sub-page.
  const usersSubPage = view === "administration" && Boolean(searchParams.get("person") || searchParams.get("invitation") || searchParams.get("page"));
  const releaseLine = releaseNotice && view === "stats" && !nativeHomeShown ? <ReleaseNotice version={releaseNotice} onSeen={markReleaseSeen} /> : null;
  const serverLine = serverUpdates ? <ServerUpdatesNotice notice={serverUpdates} /> : null;
  const underHeadingNow = underHeading || setupBanner || releaseLine || serverLine ? <>{serverLine}{underHeading}{setupBanner}{releaseLine}</> : null;
  const sectionTabs = usersSubPage ? null : view === "administration" && !overview && user && tabRow ? <SectionTabsReserve />
    : (SETTINGS_VIEWS as readonly string[]).includes(view) && !overview?.legalRequired && user && tabRow
    ? <SectionTabs label="Inställningar" current={view} tabs={settingsTabs({ admin: shownAdmin, credits: instance.features.billing || instance.features.credits, cloud: !localMode, ai: Boolean(SharingPolicyPanel) && instance.features.ai, integrations: Boolean(IntegrationKeys) && instance.features.integrations })} />
    : (PRODUCT_VIEWS as readonly string[]).includes(view) && user?.role === "SUPERADMIN" && tabRow
      // Beteendeanalys is a page of Webbplats only once the landing page is public (2026-10-09 natt; tab 2026-10-15).
      ? <SectionTabs label="Installation" current={view} tabs={productTabs({ landingEditor: Boolean(LandingEditor) && instance.features.landingEditor, pricing: Boolean(PricingAdministration), ai: Boolean(ProviderAdministration) || Boolean(AiUsageAdministration), serverKeys: Boolean(ServerKeysAdministration), landingPublished, companies: customerCompaniesTab })} />
      // Projekt has no tab row (2026-10-30): Planering and Projektstatistik are buttons in the head of the page Projekt.
      // Planering has its views as tabs (Kalender · Tidplan · Kapacitet, 2026-11-01), not over Kalender's Ny/Redigera planering.
      : (PLANNING_VIEWS as readonly string[]).includes(view) && user && overview && !overview.legalRequired && tabRow && !(view === "planning" && (searchParams.get("new") === "1" || searchParams.get("edit") === "1"))
        ? <SectionTabs label="Planering" current={view} keep={["projectId"]} tabs={planningTabs({ calendar: projectPages.calendar, timeline: projectPages.planning, capacity: projectPages.calendar && !localMode })} />
        // Arbetsordrar · Uppgifter (2026-11-01), by the rule of each list; on a phone both are the Jobb tab's one list (B3).
        : (WORK_ORDER_VIEWS as readonly string[]).includes(view) && user && overview && !overview.legalRequired && !native
          ? <SectionTabs label="Arbetsordrar" current={view} tabs={workOrderTabs(workListTabs)} />
          // Tid's tabs, not over a screen of its own on a phone (&step=). Fewer than two tabs: no row at all.
          : view === "time" && user && overview && !overview.legalRequired && tabRow && !searchParams.get("step")
            ? <SectionTabs label="Tid" current={timeTab} hrefOf={(key) => timeTabHref(key as TimeTab)} tabs={timeTabs(timeTabsFor(timeTabRights))} />
          // Underhåll · Förråd (2026-11-02): the shared tab row, not buttons in the head; not over an underhållspost's own page, and the
          // phone's level 1 has its segmented control.
          : view === "maintenance" && user && overview && !localMode && !native && !searchParams.get("item")
            ? <SectionTabs label="Underhåll" current={maintenanceViewOf(searchParams.get("tab"))} hrefOf={(key) => maintenanceViewHref(key, searchParams)} tabs={maintenanceTabs()} />
          // Tavlor · Tabeller · Skärmar · Länkar (2026-11-18): over the lists and, since 2026-11-19, a board's own page too (its
          // head is the list's: name, description, the tabs with Tavlor marked); not over the editor or a table's own page.
          : view === "boards" && user && overview && !localMode && !(searchParams.get("board") && searchParams.get("edit") === "1") && !searchParams.get("table")
            ? <SectionTabs label="Tavlor" current={boardsTabOf(searchParams.get("tab"))} hrefOf={boardsTabHref} tabs={boardsTabs(boardsTabsFor(boardsAccess({ admin: shownAdmin, workflowPermissions: tabProfile })))} />
          // Inlägg · Min webbsida (2026-11-20): Mer › Webb och inlägg, the company's admin in Cloud; each tab keeps its address.
          : (WEB_POSTS_VIEWS as readonly string[]).includes(view) && user && overview && shownAdmin && !localMode && !overview.legalRequired && tabRow
            ? <SectionTabs label="Webb och inlägg" current={view} tabs={webPostsTabs()} />
          // Kunder · Alla objekt (B5; Lika är rätt 2026-11-13): the same row, over the register's list pages and its papperskorg, not
          // over a customer's own page or the page of Ny/Redigera kund; the phone's level 1 has its segmented control.
          : view === "customers" && user && overview?.settings?.maintenance === true && !overview.legalRequired && !native && !customerId
            && !((searchParams.get("edit") === "1" || searchParams.get("new") === "1") && searchParams.get("returnTo"))
            && (localMode || shownAdmin || hasWorkflowPermission(tabProfile, "customers", "read"))
            ? <SectionTabs label="Kundregister" current={searchParams.get("show") === "objects" ? "objects" : "customers"} hrefOf={customerRegisterHref} tabs={customerRegisterTabs()} />
          : null;
  return (
    // Korten ser likadana ut (UX-punkt 6): every card on the page has its icon in the page area colour.
    <WorkspaceDataScope scope={dataScope}>
    <PanelAreaProvider area={panelAreaOfView(view, taskType)}>
    {/* Rubrikband (2026-11-21): the settings pages' cards have their title row on the grey band. */}
    <PanelHeaderBand on={isAdminView(view)}>
    <AdvisorSettingsProvider value={overview ? preferences.advisor : undefined} onSave={overview ? (next) => saveAdvisor({ ...next, autofill: Boolean(next.autofill) }) : undefined}>
      {toast && (
        <ToastCard ref={toastElement} error={Boolean(toast.error)} warning={toast.warning} onClose={() => setToast(null)} className="pointer-events-none [&_button]:pointer-events-auto">
          <div className="max-w-md">
            <p className="text-sm leading-6">{toast.text}</p>
            {toast.actions?.length ? <div className="mt-2 flex flex-wrap gap-2">
              {toast.actions.map((item) => <Button key={item.label} type="button" size="sm" variant="outline" data-testid="toast-action" onClick={() => { setToast(null); item.run(); }}>{item.label}</Button>)}
            </div> : null}
          </div>
        </ToastCard>
      )}
      {/* Fasta platser (2026-10-30): the tab row stands under the page's heading, so the heading is where it is on
          every other page (SectionTabsPlacement puts it after the first PageHeader). What Översikt has for the moment goes the
          same way, right under the heading: the setup banner, the demo's start card and, after an update (2026-10-06), a
          quiet line once per person and version, not over the setup guide. Only on Översikt, at every level
          (A5, 2026-10-21; before: every page but Hjälp, at level 1 only Hem). On a phone's Hem the notice is a row of Hem's own
          (features/workflow/native-home.tsx). */}
      <SectionTabsPlacement tabs={sectionTabs || underHeadingNow ? <>{sectionTabs}{underHeadingNow}</> : null}>
      {content}
      <ReauthHost />
      <SessionExpiredHost userId={user?.id} />
      {overview?.organization.storageMode === "LOCAL" && !overview.legalRequired && (
        <div hidden={loading || Boolean(error) || setupOpen || (view === "company_values" && !shownAdmin) || !["stats", "notifications", "customers", "new_project", "projects", "planning", "rounds", "project", "tasks", "work_orders", "time", "workflow_task", "self_inspection", "deviations", "instruments", "company_values"].includes(view)}>
          <LocalWorkspace
            key={overview.organization.id}
            organization={overview.organization}
            user={user}
            view={view}
            customerId={customerId}
            projectId={projectId}
            taskId={taskId}
            taskType={taskType}
            timeTaskId={timeTaskId}
            overview={overview}
            notify={notify}
          />
        </div>
      )}
      </SectionTabsPlacement>
    </AdvisorSettingsProvider>
    </PanelHeaderBand>
    </PanelAreaProvider>
    </WorkspaceDataScope>
  );
}
