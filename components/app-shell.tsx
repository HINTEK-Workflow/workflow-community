"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clearWorkspaceCache } from "@/lib/workflow/workspace-cache";
import { LinkPending } from "@/components/link-pending";
import { menuPrefetchHrefs } from "@/lib/workflow/menu-prefetch";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Dialog, DropdownMenu } from "radix-ui";
import { signOutAndForget } from "@/features/auth/sign-out";
import {
  Eye,
  ChevronDown,
  HelpCircle,
  HardDrive,
  LockKeyhole,
  LogIn,
  LogOut,
  MessageSquareWarning,
  Menu,
  X,
  Ellipsis,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { VIEW_ICON, type ViewKey } from "@/lib/workflow/view-icons";
import { Button } from "@/components/ui/button";
import { NotificationBadge, NotificationBell, useBellRing } from "@/components/notification-bell";
import { GlobalSearch } from "@/features/kfid/global-search";
import { onScreenKeyboardOpen } from "@/lib/workflow/keyboard";
import { HOLD_CHROME_EVENT, NATIVE_LAYOUT_EVENT, OPEN_ASSISTANT_EVENT, OPEN_CALCULATOR_EVENT, OPEN_MENU_CUSTOMIZE_EVENT, OPEN_SEARCH_EVENT, PREFERENCES_PATCH_EVENT, PREFERENCES_STATE_EVENT, SHOW_CHROME_EVENT, type PreferencesState } from "@/lib/workflow/shell-events";
import { DialogActions, Modal } from "@/features/kfid/ui";
import { MenuVisibilityChoices } from "@/features/kfid/menu-visibility";
import { menuChoicesFor, menuChoicesPatch, type MenuDevice } from "@/lib/kfid/preferences";
import { nativeLayoutAllowed, normalizeNativeLayout, type TabKey } from "@/lib/workflow/native-layout";
import { ThreePhaseCalculator } from "@/features/calculators/three-phase-calculator";
import { useConfirm } from "@/features/kfid/confirm";
import { cn } from "@/lib/utils";
import { AreaIcon } from "@/components/area-icon";
import { panelAreaOfView } from "@/lib/workflow/panel-area";
import { WorkflowBrand } from "@/components/workflow-brand";
import { CookieButton } from "@/components/cookie-notice";
import { VIEW_AS_LABELS, type ViewAs } from "@/lib/workflow/view-as";
import {
  useWorkspaceActions,
  useLocalStorageActions,
  useNotificationCount,
  unsavedWorkReason,
} from "@/components/workspace-actions";
import {
  WORKFLOW_BRANDING_EVENT,
  type ShellBranding,
} from "@/lib/branding";
import { clientExtensions } from "@ee/client";
import { REPORT_PATH } from "@ee/present";
import { LongTimerWarning, RunningTimerIndicator } from "@/features/workflow/running-timer";
import { MENU_LABEL, MENU_SUBTITLE, MENU_VISIBILITY_EVENT, SIDEBAR_TOOLS_LABEL, menuGroupLabel, menuButtonHref, assistantIconAllowed, joinsOverview, menuChoicesOf, menuKeyOfView, menuItemAllowed, menuItemLabel, phoneMenuChoicesOf, resolveMenu, sidebarMenu, type MenuChoices, type MenuEntry, type MenuHideable, type MenuRights } from "@/lib/workflow/menu-items";
import { menuViewOfPage, SUPPORT_VIEWS, VIEW_LABEL } from "@/lib/workflow/navigation";
import { COMPANY_VIEWS, PRODUCT_VIEWS } from "@/lib/workflow/settings-tabs";
import { resolveBottomBar, bottomBarMode } from "@/lib/workflow/bottom-bar";
import { NavigationProvider, ShellBreadcrumbs, useShellPageTrail } from "@/components/page-shell";
import { NativeTabBar, NativeTopBar, NativeTopBarProvider, ShowMoreButton } from "@/components/native";
import { parseShowMorePages, SHOW_MORE_EVENT, SHOW_MORE_STORAGE_KEY, showMorePage, withShowMorePage } from "@/lib/workflow/show-more";
import { appColumnFor, nativeModeFor, nativeMoreDemo, nativeMoreSections, nativeMoreTools } from "@/lib/workflow/native-mode";
import { AppColumnStage } from "@/components/native/app-column";
import { useDetailLevel, useFirstFrame, useNativeMode } from "@/features/workflow/use-detail-level";
import { VisitHistoryProvider } from "@/components/history-nav";
import { FloatingNav } from "@/components/floating-nav";
import { FoldOwnerProvider } from "@/features/workflow/use-fold-memory";
import { BOTTOM_BAR_ICON, BottomBarButton, BottomBarLinkContent } from "@/components/bottom-bar";
import { appColumnDevice, DETAIL_LEVEL_EVENT, deviceClass, displayLevelsFor, offersShowMore, type DetailLevels, type DeviceClass } from "@/lib/workflow/detail-level";
import { WORK_VIEW_LABEL, type WorkViewSetting } from "@/lib/workflow/work-view";
import { announce } from "@/lib/workflow/toast";
import { WorkProfileContext, WorkViewContext } from "@/features/workflow/use-work-view";
import { workProfileFirstSteps, workProfileMenuFirst, workProfileNewFirst, workProfileTucked, type ShellWorkProfile } from "@/lib/workflow/work-profile";
import { moduleInList, moduleOfPage, moduleOfView, moduleOffNotice } from "@/lib/workflow/modules";
import { ModulesContext } from "@/features/workflow/use-modules";
import { ASSISTANT_ASK_EVENT } from "@/lib/workflow/flow-advisor";
import type { AssistantAsk } from "@/lib/extensions/types";
import { hasWorkflowPermission, type WorkflowPermissionProfile } from "@/lib/workflow/permissions";
import { canPlanRounds } from "@/lib/workflow/round-planning";
import { mobileNewChoices, nativeNewChoices, NEW_TASK_SUBJECTS, orderNewChoices } from "@/lib/workflow/new-choices";
import { NewChoiceMenu } from "@/features/workflow/new-choice-menu";
import { IconButton } from "@/components/ui/icon-button";
// Workflow AI lives in ee/ (not in the community edition, 2026-09-30); without it this is null.
const { AssistantPanel, ImportPage } = clientExtensions;

export type ShellUser = {
  /** The person, for what is kept per person in the browser (task drafts) and to tell their own live changes apart. */
  id?: string;
  name: string | null;
  email: string;
  role: string;
  memberRole: "OWNER" | "ADMIN" | "MEMBER" | null;
  workflowPermissions: WorkflowPermissionProfile;
  organizationName: string | null;
  /** The active company, for what the tab keeps in memory per company and person (lib/workflow/workspace-cache.ts). */
  organizationId?: string | null;
  /** Workflow's superadmin, or a company admin in serverlagring (2026-09-27): may open Skapa formulär. */
  canBuildForms?: boolean;
  /** The company keeps its data in a local .hwf workspace; search then only reads the open file. */
  localStorageMode?: boolean;
  /** Menu buttons the person has hidden under Inställningar (2026-09-30). */
  hiddenMenu?: string[];
  /** Sub-pages shown as shortcuts directly in the menu (2026-10-09); display only. */
  menuShortcuts?: string[];
  /** Mer on the phone, chosen apart from the menu (2026-10-24); null or missing = Mer follows the menu. */
  phoneMenu?: { hiddenMenuItems: string[]; menuShortcuts: string[] } | null;
  /** The person's tab bar at level 1 on a phone (2026-10-09 evening); display only. */
  nativeTabs?: string[];
  /** Visningsnivå per device (2026-10-02, 2026-10-11): 1–3 for phone, tablet and computer. */
  detailLevel?: { phone?: number; tablet?: number; desktop?: number } | null;
  /** Arbetsvy (2026-10-08): the admin's default work view for this member; display only, never a permission. */
  workView?: WorkViewSetting | null;
  /** Yrkesprofil (2026-11-01): what the admin chose and what is in force; display only, never a permission. */
  workProfile?: ShellWorkProfile | null;
  /** Företagets moduler (0.39.0): what is on in the company; left out is everything (the demo). Display only: the server refuses by itself. */
  modules?: readonly string[] | null;
  /** The real role, also while "Visa som" draws the app as another role (2026-10-03). */
  superadmin?: boolean;
  viewAs?: ViewAs | null;
} | null;

/** The menu groups with a fold arrow: Verktyg alone since point 5 (2026-10-23). */


export const views = Object.fromEntries((Object.keys(VIEW_ICON) as ViewKey[]).map((key) => [key, { label: VIEW_LABEL[key], icon: VIEW_ICON[key] }])) as { [K in ViewKey]: { label: (typeof VIEW_LABEL)[K]; icon: LucideIcon } };
export type View = keyof typeof views;
/** The editors that use the whole width with the shared editor bar (components/editor-ribbon.tsx). */
const WIDE_VIEWS = new Set<string>(["forms", "landing_editor", "company_website", "self_inspection", "boards"]);

/**
 * The menu's thin line (2026-09-30): the menu scrolls without the browser's scrollbar, and while it is taller
 * than the screen a 3 px line at its right edge shows how much there is and where you are. Display only.
 */
function MenuScrollLine({ target }: { target: React.RefObject<HTMLElement | null> }) {
  const [line, setLine] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const update = () => {
      const { clientHeight } = element;
      // The menu's own height, not the scroller's: the line lies inside the scroller, and measured by scrollHeight a line
      // left low after a group folded kept the scroll area alive, so the menu scrolled past its own background (white
      // under the menu, logo gone; 2026-10-10).
      const scrollHeight = Array.from(element.children).reduce((most, child) => child instanceof HTMLElement && !child.classList.contains("menu-scroll-line") ? Math.max(most, child.offsetTop + child.offsetHeight) : most, 0);
      if (scrollHeight <= clientHeight + 1) { setLine(null); return; }
      const scrollTop = Math.min(element.scrollTop, scrollHeight - clientHeight);
      const height = Math.max(32, clientHeight * clientHeight / scrollHeight);
      // Absolute inside the scrolling menu, so the scrolled distance is added back.
      setLine({ top: scrollTop + (clientHeight - height) * scrollTop / (scrollHeight - clientHeight), height });
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of Array.from(element.children)) observer.observe(child);
    return () => { element.removeEventListener("scroll", update); observer.disconnect(); };
  }, [target]);
  return line ? <span aria-hidden="true" className="menu-scroll-line" style={{ top: line.top, height: line.height }} data-testid="menu-scroll-line" /> : null;
}

/** The <html> attributes the shell owns once it has loaded (the server writes the first frame's, lib/workflow/first-frame.ts). */
const SHELL_ATTRIBUTES = ["detail", "device", "native", "column", "shell"] as const;

/** Whether the device remembers Visa mer for this page (A2); off on the server and without storage. */
function storedShowMore(page: string): boolean {
  if (typeof window === "undefined") return false;
  try { return parseShowMorePages(window.localStorage.getItem(SHOW_MORE_STORAGE_KEY)).includes(page); } catch { return false; }
}
function rememberShowMore(page: string, on: boolean) {
  try {
    const pages = parseShowMorePages(window.localStorage.getItem(SHOW_MORE_STORAGE_KEY));
    window.localStorage.setItem(SHOW_MORE_STORAGE_KEY, JSON.stringify(withShowMorePage(pages, page, on)));
  } catch { /* no storage: the choice holds until the page changes */ }
}

export function AppShell({
  user,
  view,
  branding: initialBranding,
  children,
  demo,
}: {
  user: ShellUser;
  view: View;
  branding: ShellBranding;
  children: React.ReactNode;
  /** The public demo (2026-09-26): logout ends the demo and the preview note explains the invented data. */
  demo?: { onExit: () => void };
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const asideRef = useRef<HTMLElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const [confirmCard, confirmElement] = useConfirm();
  const menuAccess = user ? { ...user, ai: Boolean(AssistantPanel), importPage: Boolean(ImportPage), demo: Boolean(demo) } : null;
  // The yrkesprofil with its first steps as far as the person may use them, for the empty lists.
  const shellWorkProfile = useMemo(() => user?.workProfile ? { ...user.workProfile, firstSteps: workProfileFirstSteps(user.workProfile.effective.profile, { ...user, ai: Boolean(AssistantPanel), importPage: Boolean(ImportPage), demo: Boolean(demo) }) } : null, [user, demo]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantExpanded, setAssistantExpanded] = useState(false);
  // "Fråga Workflow AI" on a tip (2026-10-01): opens the panel and sends the question with the page's step.
  const [assistantAsk, setAssistantAsk] = useState<AssistantAsk | null>(null);
  useEffect(() => {
    const onAsk = (event: Event) => {
      const detail = (event as CustomEvent<{ question: string; page: unknown }>).detail;
      if (!detail?.question) return;
      setAssistantAsk({ id: Date.now(), question: detail.question, page: detail.page });
      setAssistantOpen(true);
    };
    // Hem's Workflow AI tile and the tab bar's AI (level 1 on a phone) open the panel without a question.
    const onOpen = () => setAssistantOpen(true);
    window.addEventListener(ASSISTANT_ASK_EVENT, onAsk);
    window.addEventListener(OPEN_ASSISTANT_EVENT, onOpen);
    return () => { window.removeEventListener(ASSISTANT_ASK_EVENT, onAsk); window.removeEventListener(OPEN_ASSISTANT_EVENT, onOpen); };
  }, []);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [chromeHidden, setChromeHidden] = useState(false);
  // Shows the top bar and the bottom bar again; set by the scroll effect below, called on every new page.
  const showChrome = useRef<() => void>(() => undefined);
  const lastScrollY = useRef(0);
  const chromeOffset = useRef(0);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const actions = useWorkspaceActions();
  const localStorageActions = useLocalStorageActions();
  const notificationCount = useNotificationCount();
  const bellRing = useBellRing(notificationCount);
  const searchParams = useSearchParams();
  // "Ny" creates the same type inside an open editor; everywhere else it opens the task type picker.
  const [branding, setBranding] = useState(initialBranding);
  useEffect(() => {
    const update = (event: Event) =>
      setBranding((event as CustomEvent<ShellBranding>).detail);
    window.addEventListener(WORKFLOW_BRANDING_EVENT, update);
    return () => window.removeEventListener(WORKFLOW_BRANDING_EVENT, update);
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    // The same measure as the dialogs, which also sees the Android keyboard (2026-10-13).
    const updateKeyboard = () => setKeyboardOpen(onScreenKeyboardOpen());
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (desktop.matches) setMobileOpen(false); };
    viewport?.addEventListener("resize", updateKeyboard);
    document.addEventListener("focusin", updateKeyboard);
    document.addEventListener("focusout", updateKeyboard);
    desktop.addEventListener("change", closeOnDesktop);
    return () => {
      viewport?.removeEventListener("resize", updateKeyboard);
      document.removeEventListener("focusin", updateKeyboard);
      document.removeEventListener("focusout", updateKeyboard);
      desktop.removeEventListener("change", closeOnDesktop);
    };
  }, []);
  useEffect(() => {
    // Only a touch screen hides the bars while scrolling (2026-10-04: the top bar vanished at the bottom of a long
    // page on a wide screen – a zoomed desktop window is narrower than 1024 CSS pixels and was treated as a phone).
    // The bars follow the finger pixel for pixel, as in V1 and the phone's own browser bars, instead of sliding away on
    // their own after a threshold, and settle fully shown or hidden when the scrolling stops (2026-10-05: "inte
    // floty"). The safe-area strip at the top stays, so content never scrolls under the status bar.
    const compact = window.matchMedia("(max-width: 1023px) and (pointer: coarse)");
    const shell = shellRef.current;
    // An open Ny or Mer sheet at level 1 scrolls in its own box; the bars follow that box while it is the one scrolling
    // (2026-10-09: they sometimes stayed while scrolling Mer).
    let source: HTMLElement | null = null;
    const metrics = () => source?.isConnected
      ? { y: source.scrollTop, view: source.clientHeight, height: source.scrollHeight }
      : { y: window.scrollY, view: window.innerHeight, height: document.documentElement.scrollHeight };
    let frame = 0;
    let settleTimer = 0;
    let holdUntil = 0;
    const range = () => {
      const header = shell?.querySelector<HTMLElement>(".workspace-header");
      if (header?.offsetHeight) return Math.max(1, header.offsetHeight - (parseFloat(getComputedStyle(header).paddingTop) || 0));
      // Visning 1 below Hem has no header (2026-10-15): the page's own top bar is what leaves with the finger.
      const bar = shell?.querySelector<HTMLElement>(".workspace-main > .native-top-bar");
      return bar?.offsetHeight ? bar.offsetHeight : 64;
    };
    const apply = (wanted: number, animate: boolean) => {
      const full = range();
      const next = Math.min(full, Math.max(0, wanted));
      if (shell) {
        if (animate) shell.setAttribute("data-chrome-snap", "");
        else shell.removeAttribute("data-chrome-snap");
        // Set on the bars themselves, not on the shell, so a scroll frame never restyles the whole page.
        // The level-1 flow row and calculator dock sit on the tab bar and follow it (2026-10-13: they left a gap below).
        shell.querySelectorAll<HTMLElement>(".workspace-header, .workspace-bottom-nav, .floating-nav, .native-flow, .native-calc-dock, [data-chrome-follow]").forEach((element) => {
          element.style.setProperty("--chrome-offset", `${next}px`);
          element.style.setProperty("--chrome-p", String(next / full));
        });
      }
      chromeOffset.current = next;
      setChromeHidden(next >= full);
    };
    const settle = () => {
      settleTimer = 0;
      const full = range();
      const offset = chromeOffset.current;
      if (offset > 0 && offset < full) apply(offset > full / 2 ? full : 0, true);
    };
    const update = () => {
      frame = 0;
      const { y, view: seen, height } = metrics();
      const current = Math.max(0, y);
      const delta = current - lastScrollY.current;
      lastScrollY.current = current;
      // At the very bottom there is no more scrolling down, so the bars come back instead of staying away.
      const atBottom = current + seen >= height - 8;
      // At the very top the bars are always shown (2026-10-09: after Bakåt they could stay away until the next scroll).
      if (!compact.matches || mobileOpen || keyboardOpen || atBottom || current <= 0) {
        if (chromeOffset.current !== 0) apply(0, compact.matches);
        else setChromeHidden(false);
        return;
      }
      // The app moving the page itself (Bakåt restoring its place, rulla till fältet) is not a finger: the bars stay (2026-10-13).
      if (performance.now() < holdUntil) return;
      // Near the top the bar is never further away than the page has scrolled, so it leaves with the content.
      apply(Math.min(chromeOffset.current + delta, current), false);
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(settle, 140);
    };
    const schedule = (event?: Event) => {
      const target = event?.target;
      const next = target instanceof HTMLElement && target.classList.contains("native-sheet") ? target : null;
      if (event && next !== source) { source = next; lastScrollY.current = Math.max(0, metrics().y); }
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const reset = () => {
      source = null;
      lastScrollY.current = Math.max(0, window.scrollY);
      apply(0, false);
    };
    const hold = (event: Event) => {
      holdUntil = performance.now() + ((event as CustomEvent<number>).detail || 900);
      if (chromeOffset.current !== 0) apply(0, compact.matches);
    };
    lastScrollY.current = Math.max(0, window.scrollY);
    showChrome.current = reset;
    window.addEventListener(HOLD_CHROME_EVENT, hold);
    if ((keyboardOpen || mobileOpen) && chromeOffset.current !== 0) apply(0, true);
    // Captured on the document: the page's own scrolling and that of a sheet (an element's scroll does not bubble).
    document.addEventListener("scroll", schedule, { capture: true, passive: true });
    compact.addEventListener("change", reset);
    return () => {
      document.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener(HOLD_CHROME_EVENT, hold);
      compact.removeEventListener("change", reset);
      if (frame) window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
    };
  }, [keyboardOpen, mobileOpen]);
  async function logout() {
    if (demo) return demo.onExit();
    const unsaved = actions?.dirty ? "Ändringar som inte har sparats går förlorade." : unsavedWorkReason();
    if (unsaved && !(await confirmCard({ title: "Logga ut med osparade ändringar?", message: unsaved, confirmLabel: "Logga ut", tone: "danger" }))) return;
    window.localStorage.removeItem("kfid.offline.owner");
    void signOutAndForget({ callbackUrl: "/" });
  }
  const route = (key: View) => key === "new" || key === "new_task" || user
    ? `/?view=${key}`
    : `/login?returnTo=${encodeURIComponent(`/?view=${key}`)}`;
  // A new page (also Bakåt/Framåt) starts with both bars shown, whatever the previous page was scrolled to.
  const pageKey = `${view}?${searchParams.toString()}`;
  useEffect(() => { showChrome.current(); }, [pageKey]);
  // A screen at level 1 (a dialog shown as a screen) ends above the tab bar: the bars come back when one opens.
  useEffect(() => { const show = () => showChrome.current(); window.addEventListener(SHOW_CHROME_EVENT, show); return () => window.removeEventListener(SHOW_CHROME_EVENT, show); }, []);
  // Tavlans redigerare (2026-11-18) is wide like the form builder; the list and a board's page keep the shell's width.
  const wideEditor = WIDE_VIEWS.has(view) && ((view !== "self_inspection" && view !== "boards") || searchParams.get("edit") === "1");
  // Menu buttons hidden, and pages under Verktyg shown as shortcuts (2026-09-30/2026-10-09): display only. Choices
  // saved for the menu before point 5 (B1/B2) are read with today's keys (menuChoicesOf).
  const [menuChoices, setMenuChoices] = useState<MenuChoices>(() => menuChoicesOf({ hidden: user?.hiddenMenu ?? [], shortcuts: user?.menuShortcuts ?? [] }));
  // Anpassa menyn per enhet (2026-10-24): Mer on the phone has its own choice; null = it follows the menu's.
  const [phoneChoices, setPhoneChoices] = useState<MenuChoices | null>(() => user?.phoneMenu ? menuChoicesOf({ hidden: user.phoneMenu.hiddenMenuItems, shortcuts: user.phoneMenu.menuShortcuts }) : null);
  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      setMenuChoices(menuChoicesOf(detail));
      setPhoneChoices(phoneMenuChoicesOf(detail));
    };
    window.addEventListener(MENU_VISIBILITY_EVENT, onChange);
    return () => window.removeEventListener(MENU_VISIBILITY_EVENT, onChange);
  }, []);
  // Anpassa menyn (2026-10-22): the menu's buttons are chosen in a popup opened from Mina inställningar; the
  // workspace saves them (PREFERENCES_PATCH_EVENT) and tells the shell what is chosen.
  const [chosen, setChosen] = useState<PreferencesState>({ theme: "light", textScale: "100", hiddenMenuItems: [...menuChoices.hidden], menuShortcuts: [...menuChoices.shortcuts],
    phoneMenu: phoneChoices ? { hiddenMenuItems: [...phoneChoices.hidden], menuShortcuts: [...phoneChoices.shortcuts] } : null, profileStamp: user?.workProfile?.effective.stamp ?? "" });
  useEffect(() => {
    const onState = (event: Event) => setChosen((event as CustomEvent<PreferencesState>).detail);
    window.addEventListener(PREFERENCES_STATE_EVENT, onState);
    return () => window.removeEventListener(PREFERENCES_STATE_EVENT, onState);
  }, []);
  // Which device's menu the popup shows: the phone's Mer or the computer's and the tablet's menu, first the device at hand.
  const [customizeDevice, setCustomizeDevice] = useState<MenuDevice>("desktop");
  const choose = (patch: Partial<PreferencesState>, message: string) => {
    setChosen((current) => ({ ...current, ...patch }));
    window.dispatchEvent(new CustomEvent(PREFERENCES_PATCH_EVENT, { detail: { patch, message } }));
  };
  const [customizeOpen, setCustomizeOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => {
      setMobileOpen(false);
      setCustomizeDevice(deviceClass(window.innerWidth, window.matchMedia("(pointer: coarse)").matches, window.innerHeight) === "phone" ? "phone" : "desktop");
      setCustomizeOpen(true);
    };
    window.addEventListener(OPEN_MENU_CUSTOMIZE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_MENU_CUSTOMIZE_EVENT, onOpen);
  }, []);
  // The tab bar at level 1 (2026-10-09 evening): the person's own buttons, following a save under Inställningar.
  const [nativeTabs, setNativeTabs] = useState<TabKey[]>(() => normalizeNativeLayout({ tabs: user?.nativeTabs }).tabs);
  useEffect(() => {
    const onChange = (event: Event) => setNativeTabs(normalizeNativeLayout((event as CustomEvent<unknown>).detail).tabs);
    window.addEventListener(NATIVE_LAYOUT_EVENT, onChange);
    return () => window.removeEventListener(NATIVE_LAYOUT_EVENT, onChange);
  }, []);
  // Visningsnivå (2026-10-02): the person's level for this device is set on <html>, where the style sheet
  // hides what the level leaves out. It follows the window's width and a change under Inställningar at once.
  // What the person saves on this page wins over what the page was loaded with, also when the shell is drawn again.
  const savedPhone = user?.detailLevel?.phone;
  const signedIn = Boolean(user);
  const savedTablet = user?.detailLevel?.tablet;
  const savedDesktop = user?.detailLevel?.desktop;
  const changedDetail = useRef<Partial<DetailLevels> | null>(null);
  // Visning 1 på alla enheter (plan 1P, 2026-10-11): only the chosen level decides, per device; the width merely
  // tells which device this is and whether the app look fills the window (under 640 px) or sits in the app column.
  // `columnDevice` is the device whose app column this window shows instead of the page (null = no column).
  // The server may already have drawn the column (Telefonens första bild: a tablet or a computer it knows, at level 1).
  // columnOn starts off all the same, so a wrong guess only draws the page instead – it never reloads.
  const firstFrame = useFirstFrame();
  const [columnDevice, setColumnDevice] = useState<DeviceClass | null>(firstFrame.column ? firstFrame.device : null);
  const columnOn = useRef(false);
  // Visa mer (UX-granskningen A2, lib/workflow/show-more.ts): on a phone the layout is always the app; the page's Visa mer
  // (remembered per page on the device) or Visa allt raises only the content level. `showMoreOffered`: the button is drawn.
  const showMoreKey = showMorePage(view);
  // The choice made on this page now, else the device's memory. Read only by effects and by the button, which is drawn after
  // the first render (in the app), so the server's "off" never differs from what is drawn.
  const [showMoreChoice, setShowMoreChoice] = useState<{ page: string; on: boolean } | null>(null);
  const showMoreOn = showMoreChoice?.page === showMoreKey ? showMoreChoice.on : storedShowMore(showMoreKey);
  const [showMoreOffered, setShowMoreOffered] = useState(false);
  const toggleShowMore = (on: boolean) => {
    setShowMoreChoice({ page: showMoreKey, on });
    rememberShowMore(showMoreKey, on);
  };
  // A page's own way to it (a page for a larger screen: "Visa sidan").
  useEffect(() => {
    const onRequest = (event: Event) => {
      const on = (event as CustomEvent<boolean>).detail !== false;
      setShowMoreChoice({ page: showMoreKey, on });
      rememberShowMore(showMoreKey, on);
    };
    window.addEventListener(SHOW_MORE_EVENT, onRequest);
    return () => window.removeEventListener(SHOW_MORE_EVENT, onRequest);
  }, [showMoreKey]);
  useEffect(() => {
    // Inside the app column's frame (a window named by the column): always the app look, and the frame reports to the
    // window around it. Elsewhere the level of the device at hand counts.
    const frameDevice = window.parent !== window ? appColumnDevice(window.name) : null;
    // What apply() last wrote. The server's guess on <html> (app/layout.tsx) is written again by React only if the root
    // layout is drawn again with other values (router.refresh after a change); the shell's decision is then put back.
    const written: Record<string, string | undefined> = {};
    const write = (name: (typeof SHELL_ATTRIBUTES)[number], value: string | undefined) => {
      written[name] = value;
      if (value === undefined) delete document.documentElement.dataset[name];
      else if (document.documentElement.dataset[name] !== value) document.documentElement.dataset[name] = value;
    };
    const apply = () => {
      const touch = window.matchMedia("(pointer: coarse)").matches;
      const phone = deviceClass(window.innerWidth, touch, window.innerHeight) === "phone";
      const levels = changedDetail.current ?? ({ phone: savedPhone, tablet: savedTablet, desktop: savedDesktop } as Partial<DetailLevels>);
      // The layout level decides the app look, the content level what is left out (displayLevelsFor, A2).
      const { layout, content } = frameDevice ? { layout: 1 as const, content: 1 as const }
        : displayLevelsFor(levels, window.innerWidth, touch, window.innerHeight, { signedIn, showMore: showMoreOn });
      write("detail", String(content));
      // A5 (2026-10-21): the device at hand, for what a phone never shows (the explaining sentence); in the
      // app column's frame the device the person sits at, not the frame's own phone width.
      write("device", frameDevice ?? deviceClass(window.innerWidth, touch, window.innerHeight));
      write("native", signedIn && nativeModeFor(layout, window.innerWidth, phone) ? "1" : undefined);
      // The shell has decided: the style sheet's stand-in for an unsure first frame (data-shell="auto") is done, and the
      // page is interactive ("ready", also a mark for the screen tests now that data-native is in the server's HTML).
      write("shell", "ready");
      setShowMoreOffered(!frameDevice && offersShowMore(levels, window.innerWidth, touch, window.innerHeight, signedIn));
      const column = !frameDevice && signedIn && appColumnFor(layout, window.innerWidth, phone);
      // Leaving the column (another level, a narrower window): draw the page again from the address the frame reached.
      if (columnOn.current && !column) { window.location.reload(); return; }
      columnOn.current = column;
      write("column", column ? "1" : undefined);
      setColumnDevice(column ? deviceClass(window.innerWidth, window.matchMedia("(pointer: coarse)").matches, window.innerHeight) : null);
    };
    const onChange = (event: Event) => {
      changedDetail.current = (event as CustomEvent<DetailLevels>).detail ?? null;
      if (frameDevice) window.parent.postMessage({ type: "hintek-app-column:detail", detail: changedDetail.current }, window.location.origin);
      apply();
    };
    apply();
    const keep = new MutationObserver(() => { for (const name of SHELL_ATTRIBUTES) if (name in written) write(name, written[name]); });
    keep.observe(document.documentElement, { attributes: true, attributeFilter: SHELL_ATTRIBUTES.map((name) => `data-${name}`) });
    window.addEventListener("resize", apply);
    window.addEventListener(DETAIL_LEVEL_EVENT, onChange);
    return () => { keep.disconnect(); window.removeEventListener("resize", apply); window.removeEventListener(DETAIL_LEVEL_EVENT, onChange); for (const name of SHELL_ATTRIBUTES) delete document.documentElement.dataset[name]; };
  }, [savedPhone, savedTablet, savedDesktop, signedIn, showMoreOn]);
  // The app column's frame tells the window around it where it is, and that it has left the signed-in app.
  const pathname = usePathname();
  // Rapportera fel eller förslag (2026-11-13, only with the commercial part): the page the person is on goes along (the
  // path and the app's view name, never an id); from the demo only that it was the demo – the demo itself sends nothing.
  const reportView = searchParams.get("view");
  const reportHref = REPORT_PATH ? (demo ? `${REPORT_PATH}?fran=demo` : `${REPORT_PATH}?sida=${encodeURIComponent(`${pathname}${reportView && /^[a-z_]{1,40}$/.test(reportView) ? `?view=${reportView}` : ""}`)}`) : null;
  const addressInFrame = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
  useEffect(() => {
    if (window.parent === window || !appColumnDevice(window.name)) return;
    window.parent.postMessage({ type: signedIn ? "hintek-app-column:url" : "hintek-app-column:leave", url: addressInFrame }, window.location.origin);
  }, [addressInFrame, signedIn]);
  const native = useNativeMode();
  // A page that fits the screen does not bounce when dragged; a longer page keeps the soft rubber band (2026-10-24,
  // after the test on an iPhone). <html data-fits> lets the style sheet stop the overscroll; the app only.
  useEffect(() => {
    const root = document.documentElement;
    const shell = shellRef.current;
    if (!native || !shell) { delete root.dataset.fits; return; }
    const update = () => { if (root.scrollHeight <= window.innerHeight + 1) root.dataset.fits = ""; else delete root.dataset.fits; };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(shell);
    window.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); delete root.dataset.fits; };
  }, [native]);
  // Förhämtning (stabil sidladdning steg 8c): once the menu is in view (the computer's side menu, the phone's tab bar or the
  // opened menu), a few common views are prefetched – once per person while the page is open, a moment after the page has
  // settled, never the whole menu (lib/workflow/menu-prefetch.ts).
  const prefetchRouter = useRouter();
  const prefetchedFor = useRef("");
  const prefetchHrefs = JSON.stringify(user?.id && !demo ? menuPrefetchHrefs({ view, modules: user.modules, hidden: (native && phoneChoices ? phoneChoices : menuChoices).hidden, admin: user.memberRole === "OWNER" || user.memberRole === "ADMIN", permissions: user.workflowPermissions ?? null, local: user.localStorageMode }) : []);
  useEffect(() => {
    const person = user?.id ?? "";
    if (!person || prefetchedFor.current === person) return;
    if (!mobileOpen && !native && !window.matchMedia("(min-width: 1024px)").matches) return;
    const timer = window.setTimeout(() => {
      prefetchedFor.current = person;
      for (const href of JSON.parse(prefetchHrefs) as string[]) prefetchRouter.prefetch(href);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [user?.id, mobileOpen, native, prefetchHrefs, prefetchRouter]);
  // The content level: on a phone with Visa mer or Visa allt (3) Mer keeps the pages for a larger screen (A2).
  const contentLevel = useDetailLevel();
  // Arbetsvy (2026-10-08): once per change by the admin, the person is told that the view changed (and so the own choices
  // for its defaults were set back). Remembered per person on the device.
  const workViewStamp = user?.workView?.setAt ?? "";
  const workViewName = user?.workView?.view ? WORK_VIEW_LABEL[user.workView.view] : "";
  const workViewOwn = Boolean(user?.workProfile?.effective.own);
  useEffect(() => {
    // The person's own yrkesprofil is no change by the admin.
    if (!workViewStamp || !user?.id || workViewOwn) return;
    const key = `hintek.work-view-seen.${user.id}`;
    try {
      if (window.localStorage.getItem(key) === workViewStamp) return;
      window.localStorage.setItem(key, workViewStamp);
    } catch { return; }
    announce(workViewName ? `Administratören har ändrat din arbetsvy: ${workViewName}. Du kan ändra den under Mina inställningar.` : "Din arbetsvy är ändrad av administratören.");
  }, [workViewStamp, workViewName, workViewOwn, user?.id]);
  // Verktyg's fold arrow (back 2026-10-23): one group open at a time, as before point 5 (2026-10-09 evening: the
  // menu was unclear with several groups open); the group of the open page stays open by its own rule. The Arbetsledare
  // view starts it open (2026-10-08); display only.
  const itemClass = (active: boolean) => cn(
    "workspace-menu-item flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition-colors hover:bg-muted",
    active ? "workspace-menu-item-active bg-secondary font-medium text-secondary-foreground ring-1 ring-primary/15" : "text-muted-foreground",
  );
  function navItem(key: View, active = view === key, options: { label?: string; testId?: string; indent?: boolean; href?: string; title?: string; className?: string; icon?: typeof Ellipsis } = {}) {
    const item = views[key];
    return (
      <Link key={key} href={options.href && user ? options.href : route(key)} onClick={() => setMobileOpen(false)} data-testid={options.testId} title={options.title}
        aria-current={active ? "page" : undefined} className={cn(itemClass(active), options.indent && "pl-5", options.className)}>
        {/* The icon standard (2026-10-24): the function's own colour, soft as in a list; in Light the navy menu shows it
            as a light tone on a small dark square of the colour (answer 13, the rule in app/globals.css). */}
        <AreaIcon area={panelAreaOfView(key)} icon={options.icon ?? item.icon} />
        <span>{options.label ?? item.label}</span>
        <LinkPending edge="left" />
        {!user &&
          ["new_project", "projects", "project", "tasks", "work_orders", "time", "controls", "customers", "facilities", "credits", "settings"].includes(key) && (
            <LockKeyhole
              aria-label="Inloggning krävs"
              className="ml-auto size-3.5 text-muted-foreground"
            />
          )}
      </Link>
    );
  }
  const localStorageItem = localStorageActions ? (
    <button
      type="button"
      className="workspace-menu-item flex min-h-14 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted"
      onClick={() => {
        setMobileOpen(false);
        localStorageActions.open();
      }}
    >
      <span className="relative shrink-0">
        <AreaIcon area="admin" icon={HardDrive} />
        {localStorageActions.attention && (
          <span
            className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-amber-500 ring-2 ring-card"
            aria-label="Åtgärd krävs"
          />
        )}
      </span>
      <span className="min-w-0">
        <span className="block font-medium text-foreground">{localStorageActions.label}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {localStorageActions.detail}
        </span>
      </span>
    </button>
  ) : null;
  const workflowAdmin = user?.memberRole === "OWNER" || user?.memberRole === "ADMIN";
  const canWorkflow = (subject: "projects" | "kfid" | "work-order" | "risk-assessment" | "forms" | "customers", action: "read" | "create") => Boolean(user && (workflowAdmin || hasWorkflowPermission(user.workflowPermissions, subject, action)));
  // Work orders have their own group (2026-09-26), so Ny uppgift is shown for the other task types.
  const newTaskSubjects = NEW_TASK_SUBJECTS;
  const canCreateWorkOrder = canWorkflow("work-order", "create");
  const canReadWorkOrders = canWorkflow("work-order", "read");
  const canCreateTask = newTaskSubjects.some((subject) => canWorkflow(subject, "create"));
  const canReadTasks = (["kfid", "work-order", "risk-assessment", "forms"] as const).some((subject) => canWorkflow(subject, "read"));
  const canQuotes = (action: "read" | "edit") => Boolean(user && (workflowAdmin || hasWorkflowPermission(user.workflowPermissions, "quotes", action)));
  // Ny (plan 1A, 2026-10-11): Kund and Offert beside the jobs; Offert only in Cloud and the demo, as in the menu.
  // A module the company has turned off is never a new choice (0.39.0).
  const moduleIsOn = (key: Parameters<typeof moduleInList>[1]) => moduleInList(user?.modules, key);
  const profileInForce = user?.workProfile?.effective.profile;
  const newFirst = workProfileNewFirst(profileInForce);
  const newChoices = orderNewChoices(mobileNewChoices({ workOrder: canCreateWorkOrder, task: canCreateTask, project: canWorkflow("projects", "create") && moduleIsOn("projects"), customer: canWorkflow("customers", "create") && moduleIsOn("customers"), quote: canQuotes("edit") && !user?.localStorageMode && moduleIsOn("quotes") }), newFirst);
  // Level 1's Ny sheet (decision 10, 2026-10-18): also Driftrond and Inköp, as in the menu.
  const nativeChoices = orderNewChoices(nativeNewChoices({ workOrder: canCreateWorkOrder, task: canCreateTask, project: canWorkflow("projects", "create") && moduleIsOn("projects"), customer: canWorkflow("customers", "create") && moduleIsOn("customers"), quote: canQuotes("edit") && !user?.localStorageMode && moduleIsOn("quotes"), deviation: Boolean(user), absence: Boolean(user) && !user?.localStorageMode && moduleIsOn("time"), round: moduleIsOn("rounds") && Boolean(user && canPlanRounds(workflowAdmin, user.workflowPermissions)), purchase: menuItemAllowed("purchases", user ? { ...user, ai: Boolean(AssistantPanel), importPage: Boolean(ImportPage), demo: Boolean(demo) } : null) }), newFirst);
  // The menu in the order of the work (B1/B2, 2026-10-21; lib/workflow/menu-items.ts decides, display only):
  // Översikt | Inköp, Offerter, Projekt | Arbetsordrar, Uppgifter, Driftronder | Tid | Kunder | Verktyg | Workflow AI
  // (Planering with Tidplan and Kalender, and Projektstatistik, are pages of Projekt). The server checks every call regardless.
  const invoicesButton = menuItemAllowed("customer_invoices", menuAccess);
  const navParams = useMemo(() => ({
    customerId: searchParams.get("customerId"), projectId: searchParams.get("projectId"), taskId: searchParams.get("taskId"), taskType: searchParams.get("taskType"),
    placeId: searchParams.get("placeId"), quoteId: searchParams.get("quoteId"), purchaseId: searchParams.get("purchaseId"), workOrderId: searchParams.get("workOrderId"), edit: searchParams.get("edit"), new: searchParams.get("new"),
    link: searchParams.get("link"), activityId: searchParams.get("activityId"), roundId: searchParams.get("roundId"), tool: searchParams.get("tool"),
    deviation: searchParams.get("deviation"), item: searchParams.get("item"), board: searchParams.get("board"), table: searchParams.get("table"),
    person: searchParams.get("person"), invitation: searchParams.get("invitation"), account: searchParams.get("account"),
    fromCustomer: searchParams.get("fromCustomer"),
    // Fakturaunderlag lies under Fakturor when that button exists (kundresa 2026-11-07, M39), else under Offerter.
    invoices: invoicesButton ? "1" : null,
  }), [searchParams, invoicesButton]);
  // The page's trail is kept here, so the menu follows the names the page gave it: Företagets platser (the customer page of
  // the company's own record) marks Inställningar and the phone's Mer, like its trail, not Kunder (2026-10-24).
  const shellTrail = useShellPageTrail(view, navParams);
  const menuView = menuViewOfPage(view, shellTrail.labels, navParams.fromCustomer);
  // A page of a module that is off, opened through a direct link or the archive (0.39.0): readable, and it says so. The company's own places count as the company's.
  // A customer's own card has no line: it may be the company's own places, known only when the card is read, and then nothing moves.
  const offModule = (() => { const key = view === "customers" && navParams.customerId ? null : moduleOfPage(view, searchParams.get("section")) ?? moduleOfView(menuView); return key && !moduleInList(user?.modules, key) ? key : null; })();
  // A yrkesprofil's buttons stand first (2026-11-01); display only.
  // The demo shows every button there is (2026-11-13: "i demo visa alla knappar som finns"): no yrkesprofil order or tucking in its menu.
  const menuFirst = demo ? [] : workProfileMenuFirst(profileInForce);
  const menuGroups = resolveMenu(user ? { ...user, ai: Boolean(AssistantPanel), importPage: Boolean(ImportPage), demo: Boolean(demo) } : null, menuChoices, menuKeyOfView(menuView, invoicesButton), menuFirst, demo ? [] : workProfileTucked(profileInForce, menuChoices.hidden));
  // The computer's and the tablet's menu (2026-11-02): without Workflow AI, Användare and Operatörskonton. Mer keeps `menuGroups`.
  const sidebarGroups = sidebarMenu(menuGroups);
  // The button of the open page (a work order's editor marks Arbetsordrar, a place marks Kunder, and so on).
  const openMenuKey = menuKeyOfView(menuView, invoicesButton);
  // A button leads to its list; whoever may only create is led to Ny …, and Arbetsordrar to its tab Uppgifter for whoever
  // may read only tasks (menuButtonHref).
  const menuCanRead: MenuRights = { quotes: canQuotes("read"), projects: canWorkflow("projects", "read"), work_orders: canReadWorkOrders, tasks: canReadTasks };
  const menuCanCreate: MenuRights = { work_orders: canCreateWorkOrder };
  // The wrappers keep the test ids the groups had before point 5.
  const MENU_WRAPPER_TEST_ID: Partial<Record<MenuHideable, string>> = { purchases: "purchase-menu", quotes: "quote-menu", projects: "project-menu", work_orders: "work-order-menu", rounds: "round-menu" };
  // Mer (2026-11-13): Verktyg's button, marked on the hub and on each of its pages; no fold arrow, the hub lists them.
  const toolsActive = view === "tools" || (SUPPORT_VIEWS as readonly string[]).includes(view);
  /** One menu button (a noun, B1): its list, marked while one of its pages (and tabs) is open; the smaller line is its tooltip (B4). */
  const menuButton = (key: MenuHideable) => navItem(key as View, openMenuKey === key, {
    label: menuItemLabel(key, user?.modules), href: menuButtonHref(key, menuCanRead, menuCanCreate, user?.modules), title: MENU_SUBTITLE[key], testId: `menu-item-${key}`,
  });
  // Under Verktyg and a little larger than the other buttons (2026-11-05: "en extra knapp under verktygsknappen som är lite större").
  const demoButton = demo ? navItem("demo", view === "demo", { testId: "menu-item-demo", className: "workspace-menu-item-large" }) : null;
  function menuEntry(entry: MenuEntry): React.ReactNode {
    // Fler (2026-11-04): what the yrkesprofil tucks away, one click away; its pages are drawn only when it is open.
    if (entry.type === "more") return <div key="more" data-testid="menu-more" className="space-y-1">
      <button type="button" onClick={() => setMoreOpen((current) => !current)} aria-expanded={moreOpen} data-testid="menu-item-more" className={cn(itemClass(false), "w-full")}>
        <span className="flex w-7 shrink-0 justify-center"><ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", !moreOpen && "-rotate-90")} /></span>
        <span>Fler</span>
      </button>
      {moreOpen ? <div className="ml-6 space-y-1 border-l-2 border-border/70 pl-1">
        {entry.children.map((key) => menuButton(key))}
        <button type="button" className={cn(itemClass(false), "w-full text-xs")} data-testid="menu-more-customize" onClick={() => window.dispatchEvent(new Event(OPEN_MENU_CUSTOMIZE_EVENT))}><span>Anpassa menyn</span></button>
      </div> : null}
    </div>;
    if (entry.type === "shortcut") return navItem(entry.key as View, view === entry.key, { label: MENU_LABEL[entry.key], testId: `menu-shortcut-${entry.key}` });
    // Mer (2026-11-13: "expandera pilen behövs inte"): one button to the hub, which lists Rapportarkiv, Egenkontroll and the rest.
    if (entry.type === "group") return <div key="tools" data-testid="tools-menu" className="space-y-1">
      {navItem("tools", toolsActive, { label: SIDEBAR_TOOLS_LABEL, icon: Ellipsis, testId: "menu-item-tools" })}
      {demoButton}
    </div>;
    const wrapper = MENU_WRAPPER_TEST_ID[entry.key];
    if (!wrapper) return menuButton(entry.key);
    return <div key={entry.key} data-testid={wrapper} className="space-y-1">{menuButton(entry.key)}</div>;
  }
  // Mer (Nivå 1 på mobil): the same menu as a grouped list, with the Local file's button first when there is one.
  // Mer follows the phone's own choice when there is one (2026-10-24), else the menu's.
  const moreGroups = phoneChoices ? resolveMenu(user ? { ...user, ai: Boolean(AssistantPanel), importPage: Boolean(ImportPage), demo: Boolean(demo) } : null, phoneChoices, openMenuKey, menuFirst, workProfileTucked(profileInForce, phoneChoices.hidden)) : menuGroups;
  const moreSections = native ? nativeMoreDemo(Boolean(demo), nativeMoreTools(nativeMoreSections(moreGroups, {
    canRead: menuCanRead, canCreate: menuCanCreate, modules: user?.modules,
    productAdmin: user?.role === "SUPERADMIN", logoutLabel: demo ? "Avsluta demon" : "Logga ut",
    team: Boolean(user) && !user?.localStorageMode && (workflowAdmin || hasWorkflowPermission(user!.workflowPermissions, "team", "read")),
  }), contentLevel)) : [];
  const allowedTabs = nativeLayoutAllowed(user ? { ...user, ai: Boolean(AssistantPanel), importPage: Boolean(ImportPage), demo: Boolean(demo) } : null).allowedTabs;
  const shownTabs = nativeTabs.filter((key) => allowedTabs.includes(key));
  if (native && localStorageActions) moreSections.unshift({ rows: [{ key: "local", label: localStorageActions.label, type: "neutral", action: "local", testId: "native-more-local" }] });
  // The tabs' pages (lib/workflow/settings-tabs.ts) mark their menu button.
  const productActive = (PRODUCT_VIEWS as readonly string[]).includes(view);
  const companyActive = view === "facilities" || (COMPANY_VIEWS as readonly string[]).includes(menuView);
  // Inställningar holds the person's own settings, the company's pages and Hjälp (2026-10-02).
  const settingsActive = view === "settings" || companyActive;
  // The badge's own figure in the name (V3: the name contains the visible text, also "99+").
  const notificationBadge = notificationCount ? (notificationCount > 99 ? "99+" : String(notificationCount)) : "";
  const notificationLabel = notificationCount ? `Notiser, ${notificationBadge} aktuella` : "Notiser";
  const profileName = user ? user.name || user.email : "";
  const profileInitials = profileName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const sidebar = (
    <div className="workspace-sidebar flex min-h-full flex-col bg-card">
      <div className="workspace-sidebar-brand flex h-16 shrink-0 items-center border-b px-5">
        <WorkflowBrand branding={branding} />
      </div>
      <nav aria-label="Huvudmeny" className="flex flex-1 flex-col px-3 pt-6">
        <p className="mb-3 px-3 text-xs font-medium text-muted-foreground">
          {user?.organizationName ? `Arbetsyta · ${user.organizationName}` : "Arbetsyta"}
        </p>
        <div className="space-y-1">{navItem("stats")}</div>
        {sidebarGroups.map((group, index) => (
          <div key={`group-${index}`} className={joinsOverview(sidebarGroups, index) ? "mt-1 space-y-1" : "workspace-menu-group mt-4 space-y-1"}>
            {/* A small label over the group instead of a divider (2026-11-13), in the menu's own muted colour. */}
            {!joinsOverview(sidebarGroups, index) && menuGroupLabel(group) ? <p className="workspace-menu-label" data-testid="menu-group-label">{menuGroupLabel(group)}</p> : null}
            {group.map((entry) => menuEntry(entry))}
          </div>
        ))}
        {/* Without a Verktyg group (a yrkesprofil or the person's own menu) the button keeps its place at the end of the groups. */}
        {demoButton && !menuGroups.some((group) => group.some((entry) => entry.type === "group")) ? <div className="workspace-menu-group mt-4">{demoButton}</div> : null}
        {localStorageItem && (
          <div className="mt-3 border-t pt-3">{localStorageItem}</div>
        )}
        {/* Menystädning (2026-10-01): Workflow AI, API och MCP and Historik och lagring are tabs under Mitt
            företag; Landningssidan and E-post tabs under Installation. One button each, the tabs on the page. */}
        {user?.role === "SUPERADMIN" && <div className="mt-4" data-testid="product-menu">
          <p className="workspace-menu-label">Admin</p>
          {navItem("customer_companies", productActive, { href: "/?view=product_overview" })}
        </div>}
        {!user && <div className="mt-4 border-t pt-4 lg:hidden">
          <Link href="/login" onClick={() => setMobileOpen(false)} className="workspace-menu-item flex items-center gap-3 rounded-md px-3 text-sm hover:bg-muted">
            <LogIn className="size-5" />Logga in
          </Link>
        </div>}
        <div aria-hidden="true" className="h-3 shrink-0" />
        {/* N15 (2026-11-01): Inställningar, Logga ut and the version always stay in sight; the menu above them scrolls on a low screen. */}
        <div className="workspace-sidebar-foot sticky bottom-0 mt-auto -mx-3 space-y-1 border-t bg-card px-3 pt-2 pb-2" data-testid="menu-foot">
          {navItem("settings", settingsActive)}
          {/* Logga ut is always within reach in the menu, also far down a long page (2026-10-03). */}
          {user ? <button type="button" onClick={() => void logout()} data-testid="menu-logout"
            className="workspace-menu-item flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><LogOut className="size-4" /></span>
            <span>{demo ? "Avsluta demon" : "Logga ut"}</span>
          </button> : null}
          {demo ? null : <div className="flex items-center justify-between gap-2 px-3">{/* Under Logga ut, for a quick look (2026-10-23); also under Hjälp → Om Workflow. */}<p className="workspace-sidebar-version text-xs text-muted-foreground" data-testid="menu-version">Version {process.env.NEXT_PUBLIC_APP_VERSION}</p><CookieButton className="size-8" /></div>}
        </div>
      </nav>
      {/* The demo explains its invented data. */}
      {demo ? <div className="workspace-sidebar-note mx-4 mb-4 rounded-lg border border-primary/15 bg-secondary p-3">
        <div className="flex items-center gap-2 text-xs font-medium"><span className="size-1.5 rounded-full bg-amber-500" />Demo</div>
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">Påhittat företag och påhittade användare. Inget sparas, och allt nollställs när sidan laddas om.</p>
      </div> : null}
    </div>
  );
  // Bottenraden (2026-10-09): one shared bar whose buttons follow the working mode (lib/workflow/bottom-bar.ts).
  // A temporary view draws the same bar itself (features/kfid/ui.tsx), so here it is the ordinary page or an editor.
  const barEditor = actions ? { canSave: actions.canSave, busy: actions.busy, dirty: actions.dirty } : null;
  const barSlots = resolveBottomBar({ editor: barEditor });
  const barMode = bottomBarMode({ editor: barEditor });
  // The app column (plan 1P): level 1 on a tablet or a computer draws nothing of the page here – the same app, as a phone
  // shows it, runs in the frame; the menu and the top bar of a computer are not drawn.
  if (columnDevice) return <AppColumnStage device={columnDevice} source={addressInFrame} onDetail={(detail) => window.dispatchEvent(new CustomEvent(DETAIL_LEVEL_EVENT, { detail }))} />;
  return (
    <NavigationProvider view={view} params={navParams} trail={shellTrail.trail}>
    <VisitHistoryProvider>
    <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
    {confirmElement}
    {/* Anpassa menyn (2026-10-22): the same choices as the old Visa i menyn, in a popup opened from Mina inställningar. */}
    {user ? <Modal open={customizeOpen} onOpenChange={setCustomizeOpen} title="Anpassa menyn" size="form" closeButton={false}>
      <MenuVisibilityChoices access={menuAccess} device={customizeDevice} onDevice={setCustomizeDevice} {...menuChoicesFor(chosen, customizeDevice)}
        onChange={(choices) => choose(menuChoicesPatch(customizeDevice, choices, chosen.profileStamp), "Menyn är sparad.")} />
      {/* Every choice is saved at once, so only Klart (as Artiklar's Klar), in the shared row. */}
      <DialogActions primary={{ label: "Klart", onClick: () => setCustomizeOpen(false), testId: "menu-customize-done" }} />
    </Modal> : null}
    <div
      ref={shellRef}
      className="workspace-shell min-h-svh"
      // Visning 1 (2026-10-15): Workflow, the timer and the bell only on Hem; below it the page's top bar
      // with its navigation is the top row, and it leaves and comes back with the finger like the tab bar.
      // Översikt's tabs (?tab=, Teamet from Hem's tile) are a page under Hem in the app, with their own bar (mobil 2026-11-18).
      data-native-bare={native && (view !== "stats" || searchParams.get("tab")) ? "" : undefined}
      // Hem, for the style sheet's stand-in while the first frame is unsure (data-shell="auto", app/globals.css).
      data-home={view === "stats" && !(native && searchParams.get("tab")) ? "" : undefined}
      data-keyboard-open={keyboardOpen || undefined}
      data-chrome-hidden={chromeHidden || undefined}
    >
      <a
        href="#main-content"
        className="sr-only fixed left-4 top-4 z-50 min-h-11 min-w-11 rounded bg-primary px-4 py-3 text-primary-foreground focus:not-sr-only"
      >
        Hoppa till innehåll
      </a>
      <aside ref={asideRef} className="workspace-aside fixed inset-y-0 left-0 z-30 hidden w-64 overflow-y-auto border-r lg:block">
        {sidebar}
        <MenuScrollLine target={asideRef} />
      </aside>
      <div className="lg:pl-64">
        <header
          className="workspace-header sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b bg-card px-4 tabular-nums sm:px-8"
          aria-hidden={chromeHidden || undefined}
          inert={chromeHidden || undefined}
        >
          {/* Stabil sidladdning steg 1 (2026-10-22): the breadcrumbs take the rest of the row and are shortened with …, so
              Sök, + Ny and the buttons to the right stand still whatever the trail says ("Kund" becoming the customer's name). */}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <WorkflowBrand branding={branding} className="lg:hidden" />
            {/* The demo says it is one on a phone too, where the side menu's demo note is not seen (kundresa 2026-11-07, L11). */}
            {demo ? <span className="shrink-0 rounded-full border border-white/40 px-2 py-0.5 text-xs font-semibold text-white lg:hidden" data-testid="demo-header-mark">Demo</span> : null}
            {/* Brödsmulor (2026-10-09): the pages above this one, each a link; the open page without a link. */}
            <ShellBreadcrumbs className="hidden lg:block" />
          </div>
          {/* Sök on every width (2026-10-05): icon only below 1024 px. */}
          {/* Kalkylatorn (2026-10-08) sits beside Sök on every width; the Räkneverktyg page is gone for now. */}
          {/* Level 1 on a phone (2026-10-09): a calm bar with the brand, the running timer and the bell, only on Hem
              (2026-10-15; the shell's data-native-bare hides it elsewhere); Sök and the calculator are under Mer (their
              windows stay here and open from there), the account is Mer → Konto. */}
          {/* The running timer (steg 2, 2026-10-22: only the clock and the time, with a fixed width) has a place left of
              Sök that is always there on a computer, empty while no time runs, so nothing moves when a time starts or stops.
              No global "+ Ny" here (2026-10-23: the menu already reaches every list, and each list has its own "+ Ny …";
              the phone keeps its Ny tab). At level 1 the timer stays beside the bell, as before. */}
          {user && <div className="workspace-header-center ml-auto flex shrink-0 items-center gap-3" hidden={native || undefined}>
            {native ? null : <div className="workspace-timer-slot flex items-center justify-end max-lg:empty:hidden lg:w-[6.5rem]" data-testid="running-timer-slot"><RunningTimerIndicator fixed /></div>}
            <div className="workspace-header-tools flex items-center gap-2">
              <GlobalSearch localMode={Boolean(user.localStorageMode)} user={user} importAvailable={Boolean(ImportPage) && !user.localStorageMode && !demo} />
              <ThreePhaseCalculator />
            </div>
          </div>}
          {user ? (
            <div className="flex shrink-0 items-center gap-1">
            {native ? <RunningTimerIndicator /> : null}
            <LongTimerWarning />
            <Button asChild variant="ghost" size="icon" className="workspace-notifications relative size-10">
              <Link href={route("notifications")} aria-label={notificationLabel} aria-current={view === "notifications" ? "page" : undefined}>
                <NotificationBell ring={bellRing} />
                {/* D2 (UX punkt 8): dark red with white 11 px bold figures, 6.5:1 on the navy bar and on white alike. */}
                {notificationCount ? <NotificationBadge ring={bellRing}>{notificationBadge}</NotificationBadge> : null}
              </Link>
            </Button>
            {native ? null : <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button
                  variant="ghost"
                  className="workspace-profile h-10 gap-2"
                  style={{ color: "var(--foreground)" }}
                  // The name begins with what the button shows (V3, WCAG 2.5.3 label in name): the initials, and the whole
                  // name where it is shown (xl), then what the button does.
                  aria-label={`${profileInitials} ${profileName} – Öppna profilmeny`}
                >
                  <span className="flex size-7 items-center justify-center rounded-full bg-secondary text-xs font-medium text-primary">
                    {profileInitials}
                  </span>
                  {/* A space between initials and name: the visible text reads "QF QA …" like the name, not "QFQA …"
                      (axe label-content-name-mismatch); a flex container does not draw it. */}
                  {" "}
                  <span className="hidden max-w-48 truncate xl:inline" title={profileName}>
                    {profileName}
                  </span>
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={8}
                  className="workspace-profile-menu z-50 min-w-64 rounded-lg border bg-popover p-1 shadow-md"
                >
                  <DropdownMenu.Label className="px-3 py-2">
                    <p className="text-sm font-medium">
                      {user.name || "Mitt konto"}
                    </p>
                    <p className="mt-1 text-xs font-normal text-muted-foreground">
                      {user.email}
                    </p>
                    <p className="mt-1 text-xs font-normal text-muted-foreground">
                      {user.role === "SUPERADMIN" ? "Produktadministratör" : user.memberRole === "OWNER" || user.memberRole === "ADMIN" ? "Företagsadministratör" : "Medarbetare"}
                      {user.organizationName ? ` · ${user.organizationName}` : ""}
                    </p>
                  </DropdownMenu.Label>
                  <DropdownMenu.Separator className="my-1 h-px bg-border" />
                  {/* Hjälp (UX-granskningen C2, 2026-10-22: "bra att ha sådan funktion i profilmenyn som en ikon"): it left
                      the tab row under Inställningar; no settings in this menu. */}
                  <DropdownMenu.Item asChild className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 outline-none focus:bg-muted">
                    <Link href="/?view=help" data-testid="profile-help"><HelpCircle className="size-4" />Hjälp</Link>
                  </DropdownMenu.Item>
                  {/* Opens in a new tab, so nothing the person is working on is left. */}
                  {reportHref ? <DropdownMenu.Item asChild className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 outline-none focus:bg-muted">
                    <a href={reportHref} target="_blank" rel="noopener" data-testid="profile-report"><MessageSquareWarning className="size-4" />Rapportera fel eller förslag</a>
                  </DropdownMenu.Item> : null}
                  <DropdownMenu.Item
                    onSelect={logout}
                    className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 outline-none focus:bg-muted"
                  >
                    <LogOut className="size-4" />
                    {demo ? "Avsluta demon" : "Logga ut"}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="hidden text-xs text-muted-foreground lg:inline">Gäst</span>
              <Button asChild className="hidden lg:inline-flex">
                <Link href="/login">
                  <LogIn className="size-4" />
                  Logga in
                </Link>
              </Button>
              <Dialog.Trigger asChild>
                <IconButton label="Öppna meny" variant="outline" className="lg:hidden">
                  <Menu />
                </IconButton>
              </Dialog.Trigger>
            </div>
          )}
        </header>
        <main
          id="main-content"
          // One width for every page since 2026-10-16 ("en bredare bredd på alla sidor … den bredden som det är när man
          // skapar formulär … bättre att bygga på bredden"): up to 120 rem, as Skapa formulär; the pages lay their content out in
          // more columns on a wide screen. data-width still says "wide" for the editors with a ribbon.
          className="workspace-main mx-auto max-w-[120rem] px-4 py-7 sm:px-8 sm:py-10"
          data-width={wideEditor ? "wide" : "standard"}
        >
          {/* On phone and tablet the breadcrumbs open the page (the top bar holds the brand there). */}
          {/* Nivå 1 på mobil: no breadcrumbs; the standard bar ("‹ page above", title) or a page's own (a job's steps) is drawn here. */}
          <NativeTopBarProvider render={(override) => native ? <NativeTopBar override={override} />
            : <ShellBreadcrumbs className="workspace-breadcrumbs -mt-2 mb-4 lg:hidden" reserve />}>
          {user?.viewAs ? <ViewAsBanner viewAs={user.viewAs} /> : null}
          {offModule ? <div className="notice mb-4" role="status" data-testid="module-off-notice">{moduleOffNotice(offModule)}</div> : null}
          <FoldOwnerProvider ownerId={user?.id}><ModulesContext.Provider value={user?.modules ?? null}><WorkViewContext.Provider value={user?.workView ?? null}><WorkProfileContext.Provider value={shellWorkProfile}>{children}</WorkProfileContext.Provider></WorkViewContext.Provider></ModulesContext.Provider></FoldOwnerProvider>
          {native ? <ShowMoreButton offered={showMoreOffered} on={showMoreOn} page={pageKey} onToggle={toggleShowMore} /> : null}
          </NativeTopBarProvider>
        </main>
        {/* No footer inside the app (A5, 2026-10-21): the installation's name and legal links are under Hjälp → Om
            Workflow; the public pages (landing page, login, legal documents) keep theirs. */}
      </div>
      {/* Flytande navigering (2026-10-27; replaces the floating Bakåt/Framåt of 2026-10-09): Tillbaka, Framåt, Avbryt
          and Spara where needed, beside the page's own buttons, and the round button Workflow AI (2026-11-02). Not in visning 1
          (its top bar and edge swipe), and out of the way of the keyboard, the menu and a chat that fills the screen. */}
      {user ? <FloatingNav hidden={keyboardOpen || mobileOpen} assistantOpen={assistantOpen} onAssistant={AssistantPanel && assistantIconAllowed(menuAccess, menuChoices) ? () => setAssistantOpen((current) => !current) : undefined} /> : null}
      {native ? <NativeTabBar view={view} menuView={menuView} tabs={shownTabs.length ? shownTabs : ["home"]} newChoices={nativeChoices} newFallbackHref={route("new_task")} moreSections={moreSections} hidden={chromeHidden} badge={notificationCount ?? 0}
        onAction={(action) => { if (action === "ai") setAssistantOpen(true); else if (action === "search") window.dispatchEvent(new Event(OPEN_SEARCH_EVENT)); else if (action === "calculator") window.dispatchEvent(new Event(OPEN_CALCULATOR_EVENT)); else if (action === "local") localStorageActions?.open(); else void logout(); }} /> : <nav
        aria-label="Mobilnavigation"
        className="workspace-bottom-nav lg:hidden"
        data-mode={barMode}
        aria-hidden={chromeHidden || undefined}
        inert={chromeHidden || undefined}
      >
        {barSlots.map((slot) => {
          switch (slot.key) {
            case "home": return <Link key="home" href={route("stats")} aria-label="Hem – översikt" aria-current={view === "stats" ? "page" : undefined} data-slot-key="home">
              <BottomBarLinkContent icon={BOTTOM_BAR_ICON.home} label={slot.label} /><LinkPending edge="top" />
            </Link>;
            case "search": return <BottomBarButton key="search" slot="search" icon={BOTTOM_BAR_ICON.search} label={slot.label} aria-label="Sök – öppna global sökning" onClick={() => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT))} />;
            // "Ny" always opens the same small chooser (Fas 4A, 2026-10-08) instead of changing target by page;
            // it offers only what the person may create. Without any of it, it opens Ny uppgift, which says why.
            case "new": return newChoices.length ? <NewChoiceMenu key="new" label="Ny" choices={newChoices} side="top" testId="mobile-new-choices"
              trigger={<BottomBarButton slot="new" icon={BOTTOM_BAR_ICON.new} label={slot.label} create aria-label="Ny – välj vad du vill skapa" />} />
              : <Link key="new" href={route("new_task")} className="nav-create" aria-label="Ny uppgift" data-slot-key="new"><BottomBarLinkContent icon={BOTTOM_BAR_ICON.new} label={slot.label} /></Link>;
            // Spara is active only for an open, editable task, so the bar does not gain or lose a button between pages.
            case "save": return <BottomBarButton key="save" slot="save" icon={BOTTOM_BAR_ICON.save} label={slot.label} busy={slot.busy} dirty={slot.dirty} disabled={slot.disabled}
              onClick={() => actions?.save()} aria-label={actions?.busy ? "Arbetar" : actions?.dirty ? "Spara ändringar" : "Spara"}
              title={actions?.canSave ? "Spara det som är öppet" : "Öppna en redigerbar uppgift för att spara"} />;
            case "menu": return <Dialog.Trigger key="menu" asChild>
              <BottomBarButton slot="menu" icon={BOTTOM_BAR_ICON.menu} label={slot.label} aria-label="Öppna meny" data-active={!["stats", "new", "controls", "tasks", "notifications"].includes(view) || undefined} />
            </Dialog.Trigger>;
            default: return null;
          }
        })}
      </nav>}
      {user && AssistantPanel ? (
        <AssistantPanel
          open={assistantOpen}
          expanded={assistantExpanded}
          onOpenChange={setAssistantOpen}
          onExpandedChange={setAssistantExpanded}
          ask={assistantAsk}
        />
      ) : null}
    </div>
    <Dialog.Portal>
      <Dialog.Overlay className="workspace-menu-overlay fixed inset-0 z-40" />
      <Dialog.Content ref={drawerRef} className="workspace-drawer fixed inset-y-0 left-0 z-50 w-80 max-w-[92vw] overflow-y-auto overscroll-contain border-r bg-card shadow-xl">
        <Dialog.Title className="sr-only">Huvudmeny</Dialog.Title>
        <Dialog.Description className="sr-only">Navigera mellan sidor i Workflow.</Dialog.Description>
        {sidebar}
        <Dialog.Close asChild>
          <IconButton label="Stäng meny" className="workspace-menu-close absolute right-3 top-3"><X className="size-5" /></IconButton>
        </Dialog.Close>
        <MenuScrollLine target={drawerRef} />
        </Dialog.Content>
    </Dialog.Portal>
    </Dialog.Root>
    </VisitHistoryProvider>
    </NavigationProvider>
  );
}

/** "Visa som" is on (2026-10-03): says which role and plan is shown, and ends the preview. */
function ViewAsBanner({ viewAs }: { viewAs: ViewAs }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return <div role="status" data-testid="view-as-banner" className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-secondary p-3 text-sm text-foreground">
    <Eye className="size-4 shrink-0 text-primary" aria-hidden="true" />
    <p className="min-w-0 flex-1"><span className="font-medium">Visar som {VIEW_AS_LABELS[viewAs].label}.</span> <span className="text-muted-foreground">Bara menyer och sidor ändras. Dina egna behörigheter och data är desamma.</span></p>
    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        await fetch("/api/view-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: null }) });
        clearWorkspaceCache();
        // Back to Visa som under Installation → Drift (2026-10-07).
        router.push("/?view=login_settings&section=view-as");
        router.refresh();
      } finally { setBusy(false); }
    }}>Avsluta</Button>
  </div>;
}
