"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Dialog, DropdownMenu } from "radix-ui";
import { signOut } from "next-auth/react";
import {
  Building2,
  KeyRound,
  Mail,
  Bell,
  CalendarClock,
  Repeat,
  CheckCircle2,
  LayoutDashboard,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  ClipboardPlus,
  Copy,
  CreditCard,
  Download,
  FileText,
  FolderKanban,
  ListTodo,
  Factory,
  HelpCircle,
  Home,
  History,
  HardDrive,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  LogOut,
  Menu,
  Plus,
  PanelsTopLeft,
  Save,
  Search,
  Send,
  Settings2,
  Sparkles,
  FileSpreadsheet,
  Users,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlobalSearch } from "@/features/kfid/global-search";
import { useConfirm } from "@/features/kfid/confirm";
import { cn } from "@/lib/utils";
import { WorkflowBrand } from "@/components/workflow-brand";
import { useInstance } from "@/components/instance-provider";
import {
  useWorkspaceActions,
  useLocalStorageActions,
  useNotificationCount,
  unsavedWorkReason,
  type WorkspaceControlActionId,
} from "@/components/workspace-actions";
import {
  WORKFLOW_BRANDING_EVENT,
  type ShellBranding,
} from "@/lib/branding";
import { clientExtensions } from "@ee/client";
import { LEGAL_LINKS } from "@ee/present";
import { LongTimerWarning, RunningTimerIndicator } from "@/features/workflow/running-timer";
import { MENU_VISIBILITY_EVENT } from "@/lib/workflow/menu-items";
import { hasWorkflowPermission, type WorkflowPermissionProfile } from "@/lib/workflow/permissions";
// HINTEK AI lives in ee/ (not in the community edition, 2026-09-30); without it this is null.
const { AssistantPanel } = clientExtensions;

export type ShellUser = {
  name: string | null;
  email: string;
  role: string;
  memberRole: "OWNER" | "ADMIN" | "MEMBER" | null;
  workflowPermissions: WorkflowPermissionProfile;
  organizationName: string | null;
  /** HINTEK's superadmin, or a company admin in HINTEK Cloud (2026-09-27): may open Skapa formulär. */
  canBuildForms?: boolean;
  /** The company keeps its data in a local .hwf workspace; search then only reads the open file. */
  localStorageMode?: boolean;
  /** Menu buttons the person has hidden under Inställningar (2026-09-30). */
  hiddenMenu?: string[];
} | null;

type ExpandableGroup = "tasks" | "workOrders" | "projects" | "product";

function controlActionIcon(id: WorkspaceControlActionId) {
  if (id === "save") return <Save className="size-4" />;
  if (id === "new") return <Plus className="size-4" />;
  if (id === "copy") return <Copy className="size-4" />;
  if (id === "notify") return <Send className="size-4" />;
  if (["preview", "pdf", "pdf_template"].includes(id)) return <FileText className="size-4" />;
  if (["xlsx", "json", "xlsx_template"].includes(id)) return <Download className="size-4" />;
  if (id === "import") return <Upload className="size-4" />;
  if (id === "history") return <History className="size-4" />;
  if (id === "complete") return <CheckCircle2 className="size-4" />;
  if (id === "controls") return <ClipboardCheck className="size-4" />;
  return <Users className="size-4" />;
}
export const views = {
  notifications: {
    label: "Notiser",
    icon: Bell,
    tone: "text-primary",
    surface: "bg-secondary",
  },
  stats: {
    label: "Översikt",
    icon: LayoutDashboard,
    tone: "text-primary",
    surface: "bg-secondary",
  },
  new: {
    label: "Kontroll före idrifttagning",
    icon: ClipboardCheck,
    tone: "text-feature-control",
    surface: "bg-feature-control-soft",
  },
  new_task: {
    label: "Ny uppgift",
    icon: Plus,
    tone: "text-primary",
    surface: "bg-secondary",
  },
  workflow_task: {
    label: "Uppgift",
    icon: ListTodo,
    tone: "text-feature-control",
    surface: "bg-feature-control-soft",
  },
  controls: {
    label: "Mina uppgifter",
    icon: ClipboardCheck,
    tone: "text-feature-control",
    surface: "bg-feature-control-soft",
  },
  // Arbetsorder (2026-09-26): its own menu group between Mina uppgifter and Nytt projekt.
  work_orders: {
    label: "Mina arbetsordrar",
    icon: ClipboardList,
    tone: "text-feature-control",
    surface: "bg-feature-control-soft",
  },
  new_project: {
    label: "Nytt projekt",
    icon: FolderKanban,
    tone: "text-primary",
    surface: "bg-secondary",
  },
  projects: {
    label: "Mina projekt",
    icon: FolderKanban,
    tone: "text-primary",
    surface: "bg-secondary",
  },
  // Driftronder (2026-09-28): recurring rounds of any form, next to Planering.
  rounds: {
    label: "Driftronder",
    icon: Repeat,
    tone: "text-primary",
    surface: "bg-secondary",
  },
  planning: {
    label: "Planering",
    icon: CalendarClock,
    tone: "text-primary",
    surface: "bg-secondary",
  },
  project: {
    label: "Projekt",
    icon: FolderKanban,
    tone: "text-primary",
    surface: "bg-secondary",
  },
  tasks: {
    label: "Mina uppgifter",
    icon: ListTodo,
    tone: "text-feature-control",
    surface: "bg-feature-control-soft",
  },
  time: {
    label: "Tidrapport",
    icon: CalendarClock,
    tone: "text-primary",
    surface: "bg-secondary",
  },
  facilities: {
    label: "Platser",
    icon: Factory,
    tone: "text-feature-customer",
    surface: "bg-feature-customer-soft",
  },
  customers: {
    label: "Kundregister",
    icon: Users,
    tone: "text-feature-customer",
    surface: "bg-feature-customer-soft",
  },
  credits: {
    label: "Krediter",
    icon: CreditCard,
    tone: "text-feature-credit",
    surface: "bg-feature-credit-soft",
  },
  help: {
    label: "Hjälp",
    icon: HelpCircle,
    tone: "text-muted-foreground",
    surface: "bg-muted",
  },
  administration: {
    label: "Mitt företag",
    icon: Building2,
    tone: "text-feature-customer",
    surface: "bg-feature-customer-soft",
  },
  // All keys for API, MCP and external services in one place (2026-09-29): company admins in Cloud.
  integrations: {
    label: "API och MCP",
    icon: KeyRound,
    tone: "text-feature-customer",
    surface: "bg-feature-customer-soft",
  },
  // How long the company's history is kept, and manual deletion (2026-09-30): company admins in Cloud.
  history_retention: {
    label: "Historik och lagring",
    icon: History,
    tone: "text-feature-customer",
    surface: "bg-feature-customer-soft",
  },
  // The installation's e-mail: SMTP, sender and which mail is sent (2026-09-30): the superadmin.
  mail_settings: {
    label: "E-post",
    icon: Mail,
    tone: "text-feature-customer",
    surface: "bg-feature-customer-soft",
  },
  // "Skapa formulär" (2026-09-26): HINTEK's superadmin and, since 2026-09-27, company admins in Cloud; next to HINTEK AI.
  forms: {
    label: "Skapa formulär",
    icon: FileSpreadsheet,
    tone: "text-feature-control",
    surface: "bg-feature-control-soft",
  },
  // The landing page, edited in place like Skapa formulär (2026-09-30): HINTEK's superadmin only.
  landing_editor: {
    label: "Landningssidan",
    icon: PanelsTopLeft,
    tone: "text-primary",
    surface: "bg-secondary",
  },
  customer_companies: {
    label: "Produktadministration",
    icon: Building2,
    tone: "text-feature-customer",
    surface: "bg-feature-customer-soft",
  },
  settings: {
    label: "Inställningar",
    icon: Settings2,
    tone: "text-muted-foreground",
    surface: "bg-muted",
  },
};
export type View = keyof typeof views;

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
      const { scrollTop, scrollHeight, clientHeight } = element;
      if (scrollHeight <= clientHeight + 1) { setLine(null); return; }
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
  const instance = useInstance();
  // Fas 1: an installation without billing and credits has no Krediter page; without the landing page no editor.
  const commercial = instance.features.billing || instance.features.credits;
  const asideRef = useRef<HTMLElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const [confirmCard, confirmElement] = useConfirm();
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantExpanded, setAssistantExpanded] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [chromeHidden, setChromeHidden] = useState(false);
  const lastScrollY = useRef(0);
  const actions = useWorkspaceActions();
  const localStorageActions = useLocalStorageActions();
  const notificationCount = useNotificationCount();
  const searchParams = useSearchParams();
  // "Ny" creates the same type inside an open editor; everywhere else it opens the task type picker.
  const openTaskType = view === "workflow_task" && searchParams.get("taskType") !== "FORM" ? (searchParams.get("taskType") === "RISK_ASSESSMENT" ? "RISK_ASSESSMENT" : "WORK_ORDER") : null;
  const [branding, setBranding] = useState(initialBranding);
  useEffect(() => {
    const update = (event: Event) =>
      setBranding((event as CustomEvent<ShellBranding>).detail);
    window.addEventListener(WORKFLOW_BRANDING_EVENT, update);
    return () => window.removeEventListener(WORKFLOW_BRANDING_EVENT, update);
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    const updateKeyboard = () => {
      const editing = document.activeElement?.matches("input, textarea, [contenteditable=true]");
      setKeyboardOpen(Boolean(editing && viewport && window.innerHeight - viewport.height > 150));
    };
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
    const compact = window.matchMedia("(max-width: 1023px)");
    let downTravel = 0;
    let upTravel = 0;
    let frame = 0;
    const update = () => {
      frame = 0;
      const current = Math.max(0, window.scrollY);
      const delta = current - lastScrollY.current;
      lastScrollY.current = current;
      if (!compact.matches || mobileOpen || keyboardOpen || current < 32) {
        downTravel = 0;
        upTravel = 0;
        setChromeHidden(false);
        return;
      }
      if (delta > 0) {
        downTravel += delta;
        upTravel = 0;
        if (current > 96 && downTravel > 24) setChromeHidden(true);
      } else if (delta < 0) {
        upTravel -= delta;
        downTravel = 0;
        if (upTravel > 16) setChromeHidden(false);
      }
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const reset = () => {
      if (!compact.matches) setChromeHidden(false);
      lastScrollY.current = Math.max(0, window.scrollY);
      downTravel = 0;
      upTravel = 0;
    };
    lastScrollY.current = Math.max(0, window.scrollY);
    window.addEventListener("scroll", schedule, { passive: true });
    compact.addEventListener("change", reset);
    return () => {
      window.removeEventListener("scroll", schedule);
      compact.removeEventListener("change", reset);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [keyboardOpen, mobileOpen]);
  async function logout() {
    if (demo) return demo.onExit();
    const unsaved = actions?.dirty ? "Ändringar som inte har sparats går förlorade." : unsavedWorkReason();
    if (unsaved && !(await confirmCard({ title: "Logga ut med osparade ändringar?", message: unsaved, confirmLabel: "Logga ut", tone: "danger" }))) return;
    window.localStorage.removeItem("kfid.offline.owner");
    void signOut({ callbackUrl: "/" });
  }
  const route = (key: View) => key === "new" || key === "new_task" || user
    ? `/?view=${key}`
    : `/login?returnTo=${encodeURIComponent(`/?view=${key}`)}`;
  const editingWorkOrder = view === "workflow_task" && searchParams.get("taskType") === "WORK_ORDER";
  const newWorkOrderActive = editingWorkOrder && !searchParams.get("taskId");
  const workOrdersActive = view === "work_orders" || (editingWorkOrder && Boolean(searchParams.get("taskId")));
  const projectsActive = view === "projects" || view === "project";
  // Ny uppgift, Ny arbetsorder, Nytt projekt and Produktadministration are always visible; the round plus to their right
  // shows or hides Mina uppgifter, Mina arbetsordrar, Mina projekt and the product owner's pages (2026-09-27/30).
  // Every group starts folded (2026-09-30: "normalt utgångsläge är att alla knappar är ihopfällda"); the group of
  // the open page is always shown.
  const [expanded, setExpanded] = useState<Record<ExpandableGroup, boolean>>({ tasks: false, workOrders: false, projects: false, product: false });
  // Menu buttons hidden under Inställningar (2026-09-30): display only; an open page stays visible.
  const [hiddenMenu, setHiddenMenu] = useState<string[]>(user?.hiddenMenu ?? []);
  useEffect(() => {
    const onChange = (event: Event) => setHiddenMenu(((event as CustomEvent<string[]>).detail) ?? []);
    window.addEventListener(MENU_VISIBILITY_EVENT, onChange);
    return () => window.removeEventListener(MENU_VISIBILITY_EVENT, onChange);
  }, []);
  const shown = (key: string, open = false) => open || !hiddenMenu.includes(key);
  const toggleExpanded = (key: ExpandableGroup) => setExpanded((current) => ({ ...current, [key]: !current[key] }));
  function navItem(key: View, active = view === key) {
    const item = views[key];
    const className = cn(
          "workspace-menu-item flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition-colors hover:bg-muted",
          active
            ? "workspace-menu-item-active bg-secondary font-medium text-secondary-foreground ring-1 ring-primary/15"
            : "text-muted-foreground",
        );
    const content = <>
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg",
            item.surface,
            item.tone,
          )}
        >
          <item.icon className="size-4" />
        </span>
        <span>{item.label}</span>
        {!user &&
          ["new_project", "projects", "project", "tasks", "work_orders", "time", "controls", "customers", "facilities", "credits", "settings"].includes(key) && (
            <LockKeyhole
              aria-label="Inloggning krävs"
              className="ml-auto size-3.5 text-muted-foreground"
            />
          )}
      </>;
    return key === "new" && actions ? (
      <button key={key} type="button" className={className}
        disabled={!actions.canCreate || actions.busy}
        onClick={() => { actions.newControl(); setMobileOpen(false); }}>
        {content}
      </button>
    ) : (
      <Link key={key} href={route(key)} onClick={() => setMobileOpen(false)}
        aria-current={active ? "page" : undefined} className={className}>
        {content}
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
      <span className="relative flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
        <HardDrive className="size-4" />
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
  const mobileControlActions = actions?.controlActions.length ? (
    <div className="border-t pt-3 lg:hidden">
      <p className="mb-2 px-3 text-xs font-medium text-muted-foreground">
        Öppen kontroll
      </p>
      {(
        [
          ["control", "Kontroll"],
          ["report", "Rapport och export"],
          ["status", "Historik och status"],
        ] as const
      ).map(([group, label]) => {
        const items = actions.controlActions.filter(
          (item) =>
            item.group === group &&
            !["save", "new", "notify"].includes(item.id),
        );
        if (!items.length) return null;
        return (
          <div key={group} className="mb-3 last:mb-0">
            <p className="mb-1 px-3 text-[0.6875rem] font-medium text-muted-foreground">
              {label}
            </p>
            <div className="space-y-1">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={item.disabled}
                  title={item.title}
                  onClick={() => {
                    actions.runControlAction(item.id);
                    setMobileOpen(false);
                  }}
                  className="workspace-menu-item flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    {controlActionIcon(item.id)}
                  </span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  ) : null;
  const workflowAdmin = user?.memberRole === "OWNER" || user?.memberRole === "ADMIN";
  const canWorkflow = (subject: "projects" | "kfid" | "work-order" | "risk-assessment" | "forms", action: "read" | "create") => Boolean(user && (workflowAdmin || hasWorkflowPermission(user.workflowPermissions, subject, action)));
  const taskSubjects = ["kfid", "work-order", "risk-assessment", "forms"] as const;
  // Work orders have their own group (2026-09-26), so Ny uppgift is shown for the other task types.
  const newTaskSubjects = ["kfid", "risk-assessment", "forms"] as const;
  const canCreateWorkOrder = canWorkflow("work-order", "create");
  const canReadWorkOrders = canWorkflow("work-order", "read");
  // 2026-09-25/26: tasks | work orders | projects | planning and time | registers, separated by dividers.
  // Notifications live in the top bar.
  const canCreateTask = newTaskSubjects.some((subject) => canWorkflow(subject, "create"));
  const canReadTasks = taskSubjects.some((subject) => canWorkflow(subject, "read"));
  const tasksOpen = view === "tasks" || view === "new_task" || (view === "workflow_task" && !editingWorkOrder);
  const workflowNavigation: (View | "task_group" | "work_order_group" | "project_group")[][] = [
    [
      "stats" as View,
      ...((canCreateTask || canReadTasks) && shown("tasks", tasksOpen) ? ["task_group" as const] : []),
    ],
    ...((canCreateWorkOrder || canReadWorkOrders) && shown("work_orders", workOrdersActive || newWorkOrderActive) ? [["work_order_group" as const]] : []),
    ...((canWorkflow("projects", "create") || canWorkflow("projects", "read")) && shown("projects", projectsActive || view === "new_project") ? [["project_group" as const]] : []),
    [
      ...(canWorkflow("projects", "read") && shown("planning", view === "planning") ? ["planning" as View] : []),
      ...(taskSubjects.some((subject) => canWorkflow(subject, "read")) && shown("rounds", view === "rounds") ? ["rounds" as View] : []),
      ...((["work-order", "risk-assessment"] as const).some((subject) => canWorkflow(subject, "read")) && shown("time", view === "time") ? ["time" as View] : []),
    ],
    [...(shown("customers", view === "customers") ? ["customers" as View] : []), ...(shown("facilities", view === "facilities") ? ["facilities" as View] : [])],
  ].filter((group) => group.length > 0);
  /** A "new" item that is always visible, with a round plus to its right that shows or hides its list ("Mina …"). */
  function expandableItem({ id, testId, childLabel, canCreate, canRead, childActive, primary, child }: {
    id: ExpandableGroup; testId: string; childLabel: string; canCreate: boolean; canRead: boolean; childActive: boolean; primary: React.ReactNode; child: React.ReactNode;
  }) {
    if (!canCreate) return <div key={id} data-testid={testId}>{child}</div>;
    if (!canRead) return <div key={id} data-testid={testId}>{primary}</div>;
    const open = expanded[id] || childActive;
    return <div key={id} data-testid={testId} className="space-y-1">
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">{primary}</div>
        <button type="button" onClick={() => toggleExpanded(id)} aria-expanded={open} aria-controls={`${testId}-items`} disabled={childActive}
          aria-label={`${open ? "Dölj" : "Visa"} ${childLabel}`} title={`${open ? "Dölj" : "Visa"} ${childLabel}`}
          className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:border-primary hover:bg-secondary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60">
          <Plus className={cn("size-3.5 transition-transform", open && "rotate-45")} />
        </button>
      </div>
      <div id={`${testId}-items`} hidden={!open}>{child}</div>
    </div>;
  }
  const productActive = view === "customer_companies" || view === "landing_editor" || view === "integrations" || view === "history_retention" || view === "mail_settings";
  const productOpen = expanded.product || productActive;
  const notificationLabel = notificationCount ? `Notiser, ${notificationCount} aktuella` : "Notiser";
  const sidebar = (
    <div className="workspace-sidebar flex min-h-full flex-col bg-card">
      <div className="workspace-sidebar-brand flex h-16 shrink-0 items-center border-b px-5">
        <WorkflowBrand branding={branding} />
      </div>
      <nav aria-label="Huvudmeny" className="flex flex-1 flex-col px-3 py-6">
        <p className="mb-3 px-3 text-xs font-medium text-muted-foreground">
          {user?.organizationName ? `Arbetsyta · ${user.organizationName}` : "Arbetsyta"}
        </p>
        {workflowNavigation.map((group, index) => (
          <div key={group[0]} className={cn("space-y-1", index > 0 && "workspace-menu-group mt-2 border-t pt-2")}>
            {group.map((key) => key === "task_group" ? expandableItem({
              id: "tasks", testId: "task-menu", childLabel: "Mina uppgifter", canCreate: canCreateTask, canRead: canReadTasks, childActive: view === "tasks",
              primary: navItem("new_task"), child: navItem("tasks"),
            }) : key === "work_order_group" ? expandableItem({
              id: "workOrders", testId: "work-order-menu", childLabel: "Mina arbetsordrar", canCreate: canCreateWorkOrder, canRead: canReadWorkOrders, childActive: workOrdersActive,
              primary: <Link href={user ? "/?view=workflow_task&taskType=WORK_ORDER" : route("work_orders")} onClick={() => setMobileOpen(false)}
                aria-current={newWorkOrderActive ? "page" : undefined}
                className={cn("workspace-menu-item flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition-colors hover:bg-muted",
                  newWorkOrderActive ? "workspace-menu-item-active bg-secondary font-medium text-secondary-foreground ring-1 ring-primary/15" : "text-muted-foreground")}>
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-feature-control-soft text-feature-control"><ClipboardPlus className="size-4" /></span>
                <span>Ny arbetsorder</span>
              </Link>,
              child: navItem("work_orders", workOrdersActive),
            }) : key === "project_group" ? expandableItem({
              id: "projects", testId: "project-menu", childLabel: "Mina projekt", canCreate: canWorkflow("projects", "create"), canRead: canWorkflow("projects", "read"), childActive: projectsActive,
              primary: navItem("new_project"), child: navItem("projects", projectsActive),
            }) : navItem(key))}
          </div>
        ))}
        {localStorageItem && (
          <div className="mt-3 border-t pt-3">{localStorageItem}</div>
        )}
        {mobileControlActions && (
          <div className="mt-3">{mobileControlActions}</div>
        )}
        {user && ((Boolean(AssistantPanel) && shown("ai")) || (user.canBuildForms && shown("forms", view === "forms"))) ? (
          <div className="mt-3 border-t pt-3">
            {(Boolean(AssistantPanel) && shown("ai")) ? <button
              type="button"
              className="workspace-menu-item flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted"
              aria-haspopup="dialog"
              aria-expanded={assistantOpen}
              onClick={() => {
                setAssistantOpen(true);
                setMobileOpen(false);
              }}
            >
              <span className="flex size-7 items-center justify-center rounded-lg bg-secondary text-primary">
                <Sparkles className="size-4" />
              </span>
              <span>HINTEK AI</span>
              <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[0.625rem] font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                Beta
              </span>
            </button> : null}
            {user.canBuildForms && shown("forms", view === "forms") ? navItem("forms") : null}
          </div>
        ) : null}
        <div className="my-5 border-t" />
        {commercial && shown("credits", view === "credits") ? navItem("credits") : null}
        {user && ["OWNER", "ADMIN"].includes(user.memberRole ?? "") && navItem("administration")}
        {user && user.role !== "SUPERADMIN" && ["OWNER", "ADMIN"].includes(user.memberRole ?? "") && !user.localStorageMode && !demo && instance.features.integrations && navItem("integrations")}
        {user && user.role !== "SUPERADMIN" && ["OWNER", "ADMIN"].includes(user.memberRole ?? "") && !user.localStorageMode && !demo && navItem("history_retention")}
        {user?.role === "SUPERADMIN" && <div className="mt-4 border-t pt-4" data-testid="product-menu">
          {/* The round plus sits on the heading and folds the whole section (2026-09-30): Produktadministration,
              Landningssidan and API och MCP are separate pages, not "Ny X → Mina X". Folded from the start, always open
              while one of its pages is open. */}
          <div className="mb-2 flex items-center gap-2 pl-3 pr-1">
            <p className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">{instance.operator} · produktägare</p>
            <button type="button" onClick={() => toggleExpanded("product")} aria-expanded={productOpen} aria-controls="product-menu-items" disabled={productActive}
              aria-label={`${productOpen ? "Dölj" : "Visa"} ${instance.operator} · produktägare`} title={`${productOpen ? "Dölj" : "Visa"} ${instance.operator} · produktägare`}
              className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:border-primary hover:bg-secondary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60">
              <Plus className={cn("size-3.5 transition-transform", productOpen && "rotate-45")} />
            </button>
          </div>
          <div id="product-menu-items" hidden={!productOpen} className="space-y-1">
            {navItem("customer_companies")}
            {instance.features.landingEditor ? navItem("landing_editor") : null}
            {["OWNER", "ADMIN"].includes(user.memberRole ?? "") && !user.localStorageMode && instance.features.integrations ? navItem("integrations") : null}
            {["OWNER", "ADMIN"].includes(user.memberRole ?? "") && !user.localStorageMode ? navItem("history_retention") : null}
            {navItem("mail_settings")}
          </div>
        </div>}
        <div className="mt-auto space-y-1 pt-6">
          {navItem("help")}
          {navItem("settings")}
        </div>
        {!user && <div className="mt-4 border-t pt-4 lg:hidden">
          <Link href="/login" onClick={() => setMobileOpen(false)} className="workspace-menu-item flex items-center gap-3 rounded-md px-3 text-sm hover:bg-muted">
            <LogIn className="size-5" />Logga in
          </Link>
        </div>}
      </nav>
      <div className="workspace-sidebar-note mx-4 mb-4 rounded-lg border border-primary/15 bg-secondary p-3">
        <div className="flex items-center gap-2 text-xs font-medium">
          <span className="size-1.5 rounded-full bg-amber-500" />
          {demo ? "Demo" : "Förhandsversion"}
        </div>
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
          {demo ? "Påhittat företag och påhittade användare. Inget sparas och allt nollställs när sidan laddas om." : "Privat test av Kontroll före idrifttagning. Köp och AI aktiveras i sista steget."}
        </p>
      </div>
    </div>
  );
  return (
    <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
    {confirmElement}
    <div
      className="workspace-shell min-h-dvh"
      data-keyboard-open={keyboardOpen || undefined}
      data-chrome-hidden={chromeHidden || undefined}
    >
      <a
        href="#main-content"
        className="sr-only fixed left-4 top-4 z-50 rounded bg-primary p-3 text-primary-foreground focus:not-sr-only"
      >
        Hoppa till innehåll
      </a>
      <aside ref={asideRef} className="workspace-aside fixed inset-y-0 left-0 z-30 hidden w-64 overflow-y-auto border-r lg:block">
        {sidebar}
        <MenuScrollLine target={asideRef} />
      </aside>
      <div className="lg:pl-64">
        <header
          className="workspace-header sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b bg-card px-4 sm:px-8"
          aria-hidden={chromeHidden || undefined}
          inert={chromeHidden || undefined}
        >
          <div className="flex min-w-0 items-center gap-3">
            <WorkflowBrand branding={branding} className="lg:hidden" />
            <span className="hidden text-muted-foreground lg:inline">
              Arbetsyta
            </span>
            <span className="hidden text-border lg:inline">/</span>
            <span className="hidden truncate font-medium lg:inline">{views[view].label}</span>
          </div>
          {user && <div className="hidden lg:block"><GlobalSearch localMode={Boolean(user.localStorageMode)} /></div>}
          {user ? (
            <div className="flex shrink-0 items-center gap-1">
            <RunningTimerIndicator />
            <LongTimerWarning />
            <Button asChild variant="ghost" size="icon" className="workspace-notifications relative size-10">
              <Link href={route("notifications")} aria-label={notificationLabel} aria-current={view === "notifications" ? "page" : undefined}>
                <Bell className="size-5" />
                {notificationCount ? <span data-testid="notification-count" aria-hidden="true" className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-primary px-1.5 text-center text-[0.6875rem] font-semibold leading-5 tabular-nums text-primary-foreground ring-2 ring-card">
                  {notificationCount > 99 ? "99+" : notificationCount}
                </span> : null}
              </Link>
            </Button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button
                  variant="ghost"
                  className="workspace-profile h-10 gap-2"
                  style={{ color: "var(--foreground)" }}
                  aria-label="Öppna profilmeny"
                >
                  <span className="flex size-7 items-center justify-center rounded-full bg-secondary text-xs font-medium text-primary">
                    {(user.name || user.email)
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((n) => n[0])
                      .join("")
                      .toUpperCase()}
                  </span>
                  <span className="hidden max-w-48 truncate lg:inline">
                    {user.name || user.email}
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
                  <DropdownMenu.Item
                    onSelect={logout}
                    className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 outline-none focus:bg-muted"
                  >
                    <LogOut className="size-4" />
                    {demo ? "Avsluta demon" : "Logga ut"}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
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
                <Button
                  variant="outline"
                  size="icon"
                  className="lg:hidden"
                  aria-label="Öppna meny"
                >
                  <Menu />
                </Button>
              </Dialog.Trigger>
            </div>
          )}
        </header>
        <main
          id="main-content"
          // Only the form builder is wider (2026-09-28, a deliberate exception): a tool panel, the sheet and the
          // settings side by side on a large screen. Every other page keeps the shared width.
          className={cn("workspace-main mx-auto px-4 py-7 sm:px-8 sm:py-10", view === "forms" || view === "landing_editor" ? "max-w-[120rem]" : "max-w-7xl")}
          data-width={view === "forms" ? "wide" : "standard"}
        >
          {children}
        </main>
        <footer className="workspace-footer mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 pb-6 text-xs text-muted-foreground sm:px-8">
          <span>{instance.name} · Kontroll före idrifttagning</span>
          {/* The installation's legal documents (LEGAL_LINKS: HINTEK's four, the community edition's three). */}
          <span className="flex flex-wrap gap-3">
            {instance.features.landingEditor ? <Link href="/#priser">Priser</Link> : null}
            {LEGAL_LINKS.map((link) => <Link key={link.key} href={`/legal/${link.key}`}>{link.label}</Link>)}
          </span>
        </footer>
      </div>
      <nav
        aria-label="Mobilnavigation"
        className="workspace-bottom-nav lg:hidden"
        aria-hidden={chromeHidden || undefined}
        inert={chromeHidden || undefined}
      >
        <Link href={route("stats")} aria-label="Hem – översikt" aria-current={view === "stats" ? "page" : undefined}>
          <span className="nav-icon"><Home /></span><span>Hem</span>
        </Link>
        <Link href={route("tasks")} aria-label="Visa uppgifter" aria-current={view === "tasks" ? "page" : undefined}>
          <span className="nav-icon"><Search /></span><span>Sök</span>
        </Link>
        {actions ? <button type="button" className="nav-create" aria-label="Ny kontroll" disabled={!actions.canCreate || actions.busy} onClick={actions.newControl}>
          <span className="nav-icon"><Plus /></span><span>Ny</span>
        </button> : openTaskType && canWorkflow(openTaskType === "RISK_ASSESSMENT" ? "risk-assessment" : "work-order", "create") ? <Link href={`/?view=workflow_task&taskType=${openTaskType}`} className="nav-create" aria-label={openTaskType === "RISK_ASSESSMENT" ? "Ny riskbedömning" : "Ny arbetsorder"}>
          <span className="nav-icon"><Plus /></span><span>Ny</span>
        </Link> : <Link href={route("new_task")} className="nav-create" aria-label="Ny uppgift">
          <span className="nav-icon"><Plus /></span><span>Ny</span>
        </Link>}
        <button type="button" disabled={!actions?.canSave || actions.busy} onClick={actions?.save}
          aria-label={actions?.busy ? "Arbetar med kontrollen" : actions?.dirty ? "Spara ändringar" : "Spara kontroll"}
          title={actions?.canSave ? "Spara den öppna kontrollen" : "Öppna en redigerbar kontroll för att spara"}>
          <span className="nav-icon">
            {actions?.busy ? <LoaderCircle className="animate-spin" /> : <Save />}
            {actions?.dirty && <span className="nav-dirty" />}
          </span><span>{actions?.busy ? "Arbetar…" : "Spara"}</span>
        </button>
        <Dialog.Trigger asChild>
          <button type="button" aria-label="Öppna meny" data-active={!["stats", "new", "controls", "tasks", "notifications"].includes(view) || undefined}>
            <span className="nav-icon"><Menu /></span><span>Meny</span>
          </button>
        </Dialog.Trigger>
      </nav>
      {user && AssistantPanel ? (
        <AssistantPanel
          open={assistantOpen}
          expanded={assistantExpanded}
          onOpenChange={setAssistantOpen}
          onExpandedChange={setAssistantExpanded}
        />
      ) : null}
    </div>
    <Dialog.Portal>
      <Dialog.Overlay className="workspace-menu-overlay fixed inset-0 z-40" />
      <Dialog.Content ref={drawerRef} className="workspace-drawer fixed inset-y-0 left-0 z-50 w-80 max-w-[92vw] overflow-y-auto overscroll-contain border-r bg-card shadow-xl">
        <Dialog.Title className="sr-only">Huvudmeny</Dialog.Title>
        <Dialog.Description className="sr-only">Navigera mellan sidor i HINTEK Workflow, modul Kontroll före idrifttagning.</Dialog.Description>
        {sidebar}
        <Dialog.Close asChild>
          <Button variant="ghost" size="icon" className="workspace-menu-close absolute right-3 top-3" aria-label="Stäng meny"><X className="size-5" /></Button>
        </Dialog.Close>
        <MenuScrollLine target={drawerRef} />
        </Dialog.Content>
    </Dialog.Portal>
    </Dialog.Root>
  );
}
