/* eslint-disable @next/next/no-img-element -- Private authenticated images must bypass the image optimizer. */
"use client";
import { WorkOrderList } from "@/features/workflow/work-order-list";
import { FormRounds } from "@/features/workflow/form-rounds";
import { hasWorkflowPermission, normalizeWorkflowPermissionProfile } from "@/lib/workflow/permissions";
import { CustomerCard } from "./customer-card";
import { invalidateCustomerOptions, useCustomerOptions } from "./customer-options";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatSwedish } from "@/lib/swedish-time";
import {
  Plus,
  CreditCard,
  Save,
  AlertCircle,
  X,
  Upload,
  Palette,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { api, action } from "./api";
import { Panel, Field, Empty, Modal } from "./ui";
import { Administration, LegalPanel } from "./administration";
import { CustomerCompanies } from "./customer-companies";
import { IntegrationKeys } from "./integration-keys";
import { HistoryRetention } from "@/features/workflow/history-retention";
import { clientExtensions } from "@ee/client";
import { Profile } from "./profile";
import { SuggestionsEditor } from "./suggestions";
import { quickActionLabels, type QuickAction } from "@/lib/kfid/preferences";
import { MENU_ITEM_GROUPS, MENU_VISIBILITY_EVENT } from "@/lib/workflow/menu-items";
import { CreditHistory } from "./credit-history";
import { RecordArchive } from "./record-archive";
import { Analytics } from "./analytics";
import { Calculator } from "./calculator";
import { Editor } from "./editor";
import { LocalWorkspace } from "./local-workspace";
import { WorkflowProjects } from "./workflow-projects";
import dynamic from "next/dynamic";
// The form builder is only for the superadmin; its code (and drag and drop) loads only when the view opens.
const FormBuilder = dynamic(() => import("@/features/workflow/form-builder").then((module) => module.FormBuilder), { ssr: false, loading: () => <p role="status" className="text-sm text-muted-foreground">Öppnar formulärbyggaren…</p> });
import { TaskTypePicker } from "@/features/workflow/task-type-picker";
import { WorkflowTaskEditor } from "@/features/workflow/workflow-task-editor";
import { TimeReport } from "@/features/workflow/time-report";
import { TaskNotifications, useTaskNotificationFeed } from "@/features/workflow/task-notifications";
import { useCloudRunningTimers } from "@/features/workflow/running-timer";
import type { WorkflowTaskKind } from "@/lib/workflow/task-model";
import { OrganizationStructure } from "./organization-structure";
import {
  defaultPreferences,
  type Preferences,
  type Overview,
  type CustomerItem,
} from "./types";
import type { View, ShellUser } from "@/components/app-shell";
import {
  DEFAULT_REPORT_BRANDING,
  type ReportBranding,
} from "@/lib/kfid/report-branding";
import { applyTheme } from "@/lib/theme";
import {
  isHintekOrganization,
  shellBranding,
  WORKFLOW_BRANDING_EVENT,
} from "@/lib/branding";
import { useInstance } from "@/components/instance-provider";
// HINTEK's commercial views live in ee/ (Fas 2); without it they are null.
const { BillingRead, LandingEditor } = clientExtensions;

const blankCustomer = {
  name: "",
  company: "",
  address: "",
  postalCode: "",
  city: "",
  email: "",
  phone: "",
  mobile: "",
  lat: "",
  lng: "",
  notes: "",
};
export function Workspace({
  user,
  view,
  controlId,
  customerId,
  projectId,
  taskId,
  taskType,
  timeTaskId,
}: {
  user: ShellUser;
  view: View;
  controlId?: string;
  customerId?: string;
  projectId?: string;
  taskId?: string;
  taskType?: string;
  timeTaskId?: string;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const instance = useInstance();
  const notificationFeed = useTaskNotificationFeed({ enabled: Boolean(user && overview && overview.organization.storageMode !== "LOCAL"), resetKey: overview?.organization.id });
  useCloudRunningTimers(Boolean(user && overview && overview.organization.storageMode !== "LOCAL"));
  const [loading, setLoading] = useState(Boolean(user));
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [preferences, setPreferences] =
    useState<Preferences>(defaultPreferences);
  const [busy, setBusy] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customer, setCustomer] = useState(blankCustomer);
  const [editing, setEditing] = useState<CustomerItem | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [reportBranding, setReportBranding] = useState<ReportBranding>({
    ...DEFAULT_REPORT_BRANDING,
  });
  const [suggestions, setSuggestions] = useState("");
  const logoInput = useRef<HTMLInputElement>(null);
  const customerThemePrimary =
    overview && !isHintekOrganization(overview.organization, instance)
      ? overview.settings?.themePrimary
      : null;
  const notify = useCallback(
    (text: string, isError = false) => setToast({ text, error: isError }),
    [],
  );
  const [refreshCount, setRefreshCount] = useState(0);
  // Customers are read only for the views whose forms list them (Daniel 2026-09-26: fetch only what is shown).
  const customerOptions = useCustomerOptions(Boolean(overview) && overview?.organization.storageMode !== "LOCAL" && ["workflow_task", "new_project", "project"].includes(view));
  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api<Overview>("/api/workspace");
      invalidateCustomerOptions();
      setRefreshCount((count) => count + 1);
      setOverview(data);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [user]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (overview) {
      setPreferences({ ...defaultPreferences, ...overview.preferences });
      setCompanyName(
        overview.settings?.companyName || overview.organization.name,
      );
      setCompanyEmail(overview.settings?.contactEmail || "");
      setReportBranding({
        primary:
          overview.settings?.reportPrimary ?? DEFAULT_REPORT_BRANDING.primary,
        accent:
          overview.settings?.reportAccent ?? DEFAULT_REPORT_BRANDING.accent,
        soft: overview.settings?.reportSoft ?? DEFAULT_REPORT_BRANDING.soft,
      });
      setSuggestions(
        (overview.settings?.suggestions?.general ?? []).join("\n"),
      );
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
    try {
      if (user && overview && !overview.legalRequired)
        localStorage.setItem(
          "kfid.offline.owner",
          JSON.stringify({
            email: user.email,
            name: user.name,
            organizationId: overview.organization.id,
          }),
        );
      else localStorage.removeItem("kfid.offline.owner");
    } catch {}
  }, [user, overview]);
  useEffect(() => {
    document.documentElement.style.fontSize = `${(Number(preferences.textScale) / 100) * 16}px`;
    applyTheme(
      document.documentElement,
      preferences.theme,
      customerThemePrimary,
    );
    document.documentElement.dataset.density = preferences.compact
      ? "compact"
      : "comfortable";
  }, [
    preferences.theme,
    preferences.compact,
    preferences.textScale,
    customerThemePrimary,
  ]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(t);
  }, [toast]);
  const perform = async (input: unknown, message: string) => {
    setBusy(true);
    try {
      await action(input);
      notify(message);
      await refresh();
      return true;
    } catch (e) {
      notify((e as Error).message, true);
      return false;
    } finally {
      setBusy(false);
    }
  };
  function customerModal(c?: CustomerItem) {
    setEditing(c ?? null);
    setCustomer(
      c
        ? {
            name: c.name,
            company: c.company,
            address: c.address,
            postalCode: c.postalCode,
            city: c.city,
            email: c.email,
            phone: c.phone,
            mobile: c.mobile,
            lat: c.lat == null ? "" : String(c.lat),
            lng: c.lng == null ? "" : String(c.lng),
            notes: c.notes,
          }
        : blankCustomer,
    );
    setCustomerOpen(true);
  }
  const heading = (
    title: string,
    description: string,
    actions?: React.ReactNode,
  ) => (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="page-title">{title}</h1>
        <p className="page-description mt-2">{description}</p>
      </div>
      {actions}
    </div>
  );
  let content: React.ReactNode;
  if (loading)
    content = (
      <Panel title="Hämtar din arbetsyta">
        <p className="page-description" role="status">
          Läser kontroller, kunder och kreditsaldo…
        </p>
      </Panel>
    );
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
  else if (overview?.legalRequired)
    content = <LegalPanel notify={notify} gate onAccepted={refresh} />;
  else if (view === "administration")
    content = <Administration notify={notify} />;
  else if (view === "integrations")
    content = <IntegrationKeys notify={notify} />;
  else if (view === "history_retention")
    content = <HistoryRetention notify={notify} />;
  else if (view === "customer_companies")
    content = <CustomerCompanies />;
  else if (view === "landing_editor")
    // The landing editor lives in ee/ (Fas 2); without it page.tsx never opens this view.
    content = user?.role === "SUPERADMIN" && LandingEditor ? <LandingEditor /> : <Panel title="Endast för HINTEK"><p className="text-sm text-muted-foreground">Landningssidan redigeras av HINTEK:s superadmin.</p></Panel>;
  else if (view === "forms")
    // HINTEK's superadmin builds HINTEK's forms; a company admin in Cloud builds the company's own (Daniel 2026-09-27).
    content = user?.role === "SUPERADMIN" || (overview?.admin && overview.organization.storageMode !== "LOCAL") ? <FormBuilder userName={user?.name || undefined} tourSeen={overview ? Boolean(preferences.tours?.formBuilder) : undefined}
      onTourSeen={async () => { await action({ action: "tour", tour: "formBuilder" }); setPreferences((current) => ({ ...current, tours: { ...current.tours, formBuilder: new Date().toISOString() } })); }} /> : <Panel title="Endast för administratörer"><p className="text-sm text-muted-foreground">Formulär skapas och publiceras av HINTEK och av företagets administratör.</p></Panel>;
  else if (view === "facilities")
    content = <><div className="mb-6"><h1 className="page-title">Platser</h1><p className="page-description mt-2">Företagets egna platser och avdelningar som kan kopplas till arbetet. Kundens anläggningar finns på kundkortet.</p></div><OrganizationStructure notify={notify} editable={Boolean(overview?.admin)} /></>;
  else if (view === "new_task")
    content = <TaskTypePicker projectId={projectId} customerId={customerId} permissions={user?.workflowPermissions} admin={Boolean(overview?.admin)} superadmin={user?.role === "SUPERADMIN"}
      canBuildForms={user?.role === "SUPERADMIN" || Boolean(overview?.admin && overview.organization.storageMode !== "LOCAL")}
      layout={preferences.taskCardLayout}
      onLayoutChange={user ? async (taskCardLayout) => {
        // Saved with the person's other preferences, so the order follows them to every device.
        const next = { ...preferences, taskCardLayout };
        await action({ action: "preferences", data: next });
        setPreferences(next);
      } : undefined} />;
  // A new work order or risk assessment without the right to create it gets the same clear message as Ny uppgift, not
  // an editor that cannot be saved (totalkontrollen F8, 2026-09-29). The server refuses the save either way.
  else if (view === "workflow_task" && overview?.organization.storageMode !== "LOCAL" && overview && !taskId && taskType !== "FORM"
    && !overview.admin && !hasWorkflowPermission(normalizeWorkflowPermissionProfile(user?.workflowPermissions), taskType === "RISK_ASSESSMENT" ? "risk-assessment" : "work-order", "create"))
    content = <div className="space-y-4">
      <h1 className="page-title">{taskType === "RISK_ASSESSMENT" ? "Ny riskbedömning" : "Ny arbetsorder"}</h1>
      <p className="notice" role="status">Du saknar behörighet att skapa {taskType === "RISK_ASSESSMENT" ? "riskbedömningar" : "arbetsorder"}. En företagsadministratör kan ändra dina modulrättigheter.</p>
    </div>;
  else if (view === "workflow_task" && overview?.organization.storageMode !== "LOCAL" && overview)
    content = <WorkflowTaskEditor
      kind={(taskType === "RISK_ASSESSMENT" || taskType === "FORM" ? taskType : "WORK_ORDER") as WorkflowTaskKind}
      taskId={taskId}
      projectId={projectId}
      customerId={customerId}
      customers={customerOptions}
      projects={overview.projects}
      rowOptions={{ rowsOnTop: preferences.rowsOnTop, showExamples: preferences.showExamples }}
      userName={user?.name || undefined}
    />;
  else if (
    overview?.organization.storageMode === "LOCAL" &&
    ["stats", "notifications", "new", "controls", "customers", "new_project", "projects", "planning", "rounds", "project", "tasks", "work_orders", "time", "workflow_task", "facilities"].includes(view)
  )
    content = null; // The local workspace remains mounted across menu navigation below.
  else if (view === "new")
    content = (
      <Editor
        user={user}
        controlId={controlId}
        initialCustomerId={customerId}
        initialProjectId={projectId}
        overview={overview}
        preferences={preferences}
        refresh={refresh}
        notify={notify}
      />
    );
  else if (["new_project", "projects", "planning", "project", "tasks"].includes(view) && overview)
    content = <WorkflowProjects
      view={view as "new_project" | "projects" | "planning" | "project" | "tasks"}
      projectId={projectId}
      customers={customerOptions}
      permissions={user?.workflowPermissions}
      admin={Boolean(overview.admin)}
    />;
  else if (view === "time" && overview)
    content = <TimeReport focusTaskId={timeTaskId} />;
  // Mina arbetsordrar (Daniel 2026-09-26): its own menu group; the server checks the module permission.
  else if (view === "work_orders" && overview)
    content = <WorkOrderList canCreate={Boolean(overview.admin) || hasWorkflowPermission(normalizeWorkflowPermissionProfile(user?.workflowPermissions), "work-order", "create")} />;
  // Driftronder (2026-09-28): recurring rounds; the server filters by the forms the member may read.
  else if (view === "rounds" && overview)
    content = <FormRounds />;
  else if (view === "notifications" && overview)
    content = <TaskNotifications key={overview.organization.id} feed={notificationFeed} />;
  // The customer card (decision 12B): the register with a customerId opens that customer's card.
  else if (view === "customers" && customerId && overview && user)
    content = <CustomerCard key={`${customerId}-${refreshCount}`} customerId={customerId} onEdit={customerModal} />;
  else if ((view === "controls" || view === "customers") && overview && user)
    content = (
      <RecordArchive
        key={view}
        kind={view}
        scope={`${user.email}:${overview.organization.id}`}
        admin={
          view === "controls" ? overview.canDeleteControls : overview.admin
        }
        customerId={customerId}
        onEdit={customerModal}
        notify={notify}
        refresh={refresh}
        reloadToken={refreshCount}
      />
    );
  else if (view === "credits")
    content = (
      <>
        {heading(
          "Krediter",
          overview?.admin
            ? "Ett saldo för arbetsytan. Priser och riktiga köp bestäms i sista steget."
            : "Här ser du arbetsytans saldo och dina tillgängliga rapporter.",
        )}
        <div className="grid gap-5 lg:grid-cols-3">
          <section className={`rounded-xl bg-primary p-6 text-white shadow-sm ${overview?.admin ? "" : "lg:col-span-3"}`}>
            <div className="mb-6 flex items-center justify-between">
              <CreditCard className="size-6" />
              <span className="rounded-full bg-white/15 px-3 py-1 text-xs">
                {overview?.wallet.testMode ? "Testsaldo" : "Saldo"}
              </span>
            </div>
            <p className="text-4xl font-semibold tracking-tight">
              {overview?.wallet.balance ?? 0}
            </p>
            <p className="mt-2 text-sm text-white/80">tillgängliga krediter</p>
            <p className="mt-6 text-xs leading-5 text-white/80">
              Krediter används endast för aktiverade AI-funktioner.
              Grundfunktioner, rapporter, PDF, utskrifter och export kräver
              inga krediter.
            </p>
            {overview?.testAdmin && overview.wallet.testMode && (
                <Button
                  variant="secondary"
                  className="mt-5 w-full"
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
          </section>
          {overview?.admin && <div className="lg:col-span-2">
            <Panel
              title="Köp krediter"
              description="Betalningsanslutning och paketpriser kommer i sista steget."
            >
              <Empty
                title="Inga riktiga köp ännu"
                description="Du kan prova funktionerna med testkrediter. Inga betalningar eller kortuppgifter hanteras i den här versionen."
              />
            </Panel>
          </div>}
        </div>
        <div className="mt-6">
          <div className="mb-6">
            <Panel
              title="Skapade rapporter"
              description="Öppna eller ladda ned en tidigare rapport utan ny debitering, även när saldot är slut."
            >
              {overview?.reports?.length ? (
                <div className="divide-y">
                  {overview.reports.map((r) => (
                    <div
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      <div>
                        <p className="text-sm font-medium">{`Kontroll före idrifttagning · ${r.kind.toUpperCase()} · ${r.controlId.slice(0, 8)}`}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatSwedish(r.createdAt, { dateStyle: "short", timeStyle: "short" })}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {r.kind.startsWith("pdf") && (
                          <Button asChild variant="outline" size="sm">
                            <a
                              href={`/api/reports/${r.id}?inline=true`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Visa / skriv ut
                            </a>
                          </Button>
                        )}
                        <Button asChild variant="ghost" size="sm">
                          <a href={`/api/reports/${r.id}`} download>
                            Ladda ned
                          </a>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Inga rapporter skapade ännu.
                </p>
              )}
            </Panel>
          </div>
          {overview?.admin && <CreditHistory key={overview.entries[0]?.id ?? "empty"} entries={overview.entries} total={overview.entryCount ?? overview.entries.length} />}
        </div>
        {overview?.admin ? (BillingRead ? <BillingRead /> : null) : <Panel title="Fakturering och köp" description="Företagets betalningar hanteras av en företagsadministratör.">
          <div className="space-y-3">
            {overview?.paymentSandbox ? <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100" role="status">
              Stripe sandbox – inga riktiga pengar
            </p> : null}
            <p className="text-sm text-muted-foreground">Du kan använda tilldelade krediter och se ditt tillgängliga saldo, men bara företagets admin kan starta Cloud-, kredit- eller portalflöden.</p>
          </div>
        </Panel>}
      </>
    );
  else if (view === "stats")
    content = <Analytics admin={Boolean(overview?.admin)} projectCount={overview?.projects.length ?? 0} />;
  else if (view === "settings")
    content = (
      <>
        {heading(
          "Inställningar",
          "Anpassa arbetsytan och företagets rapportuppgifter.",
        )}
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Din arbetsyta" description={user?.email}>
            <form
              className="space-y-5"
              onSubmit={async (e) => {
                e.preventDefault();
                const saved = await perform(
                  { action: "preferences", data: preferences },
                  "Inställningarna är sparade.",
                );
                // The menu follows at once, without reloading the page.
                if (saved) window.dispatchEvent(new CustomEvent(MENU_VISIBILITY_EVENT, { detail: preferences.hiddenMenuItems }));
              }}
            >
              {[
                { key: "autoSave", label: "Autospara utkast" },
                { key: "rowsOnTop", label: "Lägg nya mätningar överst" },
                { key: "compact", label: "Kompakt tabellvisning" },
                { key: "autoSuggestEnabled", label: "Visa autoförslag" },
                {
                  key: "showExamples",
                  label: "Visa knappar för test- och exempelrader",
                },
              ].map((f) => (
                <label key={f.key} className="flex items-center gap-3 text-sm">
                  <Checkbox
                    checked={preferences[f.key as keyof Preferences] === true}
                    onCheckedChange={(v) =>
                      setPreferences((p) => ({ ...p, [f.key]: v === true }))
                    }
                  />
                  {f.label}
                </label>
              ))}
              <div>
                <label
                  htmlFor="quick-action"
                  className="mb-2 block text-xs font-medium text-muted-foreground"
                >
                  Startsida efter inloggning
                </label>
                <select
                  id="quick-action"
                  className="form-select"
                  value={preferences.quickAction}
                  onChange={(e) =>
                    setPreferences((p) => ({
                      ...p,
                      quickAction: e.target.value as Preferences["quickAction"],
                    }))
                  }
                >
                  <option value="new">Ny uppgift</option>
                  <option value="stats">Översikt</option>
                  <option value="controls">Mina uppgifter</option>
                  <option value="customers">Kundregister</option>
                </select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {[0, 1].map((slot) => (
                  <label
                    key={slot}
                    className="space-y-1 text-xs text-muted-foreground"
                  >
                    Snabbåtgärd {slot + 1}
                    <select
                      className="form-select"
                      aria-label={`Snabbåtgärd ${slot + 1}`}
                      value={preferences.quickActions[slot]}
                      onChange={(e) =>
                        setPreferences((p) => {
                          const quickActions = [
                            ...p.quickActions,
                          ] as Preferences["quickActions"];
                          quickActions[slot] = e.target.value as QuickAction;
                          return { ...p, quickActions };
                        })
                      }
                    >
                      {Object.entries(quickActionLabels).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <label className="block space-y-1 text-xs text-muted-foreground">
                Textstorlek
                <select
                  aria-label="Textstorlek"
                  className="form-select"
                  value={preferences.textScale}
                  onChange={(e) =>
                    setPreferences((p) => ({
                      ...p,
                      textScale: e.target.value as Preferences["textScale"],
                    }))
                  }
                >
                  <option value="100">Standard (100 %)</option>
                  <option value="110">Större (110 %)</option>
                  <option value="125">Störst (125 %)</option>
                </select>
              </label>
              <Field
                label="Tema"
                id="theme"
                options={["light", "dark", "blue", "customer"]}
                optionLabels={{
                  light: "Light",
                  dark: "Dark",
                  blue: "Blue – HINTEK",
                  customer: "Customer – från logotyp",
                }}
                value={preferences.theme}
                onChange={(v) =>
                  setPreferences((p) => ({
                    ...p,
                    theme: v as Preferences["theme"],
                  }))
                }
              />
              {preferences.theme === "customer" && (
                <p className="-mt-2 text-xs leading-5 text-muted-foreground">
                  {overview?.settings?.themePrimary
                    ? "Profilfärgen hämtas automatiskt från företagets logotyp."
                    : "Ladda upp en företagslogotyp för en egen profilfärg. HINTEK Blue används tills dess."}
                </p>
              )}
              <div>
                <label
                  className="mb-2 block text-xs font-medium text-muted-foreground"
                  htmlFor="suggestions-personal"
                >
                  Personliga autoförslag (ett per rad)
                </label>
                <textarea
                  id="suggestions-personal"
                  className="form-textarea"
                  value={preferences.suggestions}
                  onChange={(e) =>
                    setPreferences((p) => ({
                      ...p,
                      suggestions: e.target.value,
                    }))
                  }
                />
              </div>
              {/* Which menu buttons are shown (Daniel 2026-09-30): each person chooses; display only, never access. */}
              <fieldset className="space-y-3 rounded-lg border p-4" data-testid="menu-visibility">
                <legend className="px-1 text-xs font-semibold">Visa i menyn</legend>
                <p className="text-xs text-muted-foreground">Välj vilka knappar du vill se. Det du döljer finns kvar och kan väljas igen; Översikt, Hjälp och Inställningar visas alltid.</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  {MENU_ITEM_GROUPS.map((group) => <div key={group.title} className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">{group.title}</p>
                    {group.items.map((item) => <label key={item.key} className="flex items-center gap-3 text-sm">
                      <Checkbox checked={!preferences.hiddenMenuItems.includes(item.key)} onCheckedChange={(v) => setPreferences((p) => ({ ...p, hiddenMenuItems: v === true ? p.hiddenMenuItems.filter((key) => key !== item.key) : [...p.hiddenMenuItems, item.key] }))} />
                      {item.label}
                    </label>)}
                  </div>)}
                </div>
              </fieldset>
              <Button type="submit" className="mobile-form-action" disabled={busy}>
                <Save />
                Spara inställningar
              </Button>
            </form>
          </Panel>
          {overview?.admin ? <Panel title="Företag och rapporter">
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                await perform(
                  {
                    action: "settings",
                    data: {
                      companyName,
                      contactEmail: companyEmail,
                      reportBranding,
                      suggestions: {
                        general: suggestions
                          .split("\n")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      },
                    },
                  },
                  "Företagsuppgifterna är sparade.",
                );
              }}
            >
              <Field
                label="Företagsnamn"
                id="company-name"
                value={companyName}
                onChange={setCompanyName}
                required
                disabled={!overview?.admin}
              />
              <Field
                label="Kontakt / installatörens e-post"
                id="company-email"
                type="email"
                value={companyEmail}
                onChange={setCompanyEmail}
                disabled={!overview?.admin}
              />
              <div>
                <label
                  htmlFor="company-suggestions"
                  className="mb-2 block text-xs font-medium text-muted-foreground"
                >
                  Gemensamma autoförslag (ett per rad)
                </label>
                <textarea
                  id="company-suggestions"
                  className="form-textarea"
                  value={suggestions}
                  onChange={(e) => setSuggestions(e.target.value)}
                  disabled={!overview?.admin}
                />
              </div>
              <Button className="mobile-form-action" disabled={busy || !overview?.admin}>
                <Save />
                Spara företagsuppgifter
              </Button>
            </form>
            <div className="mt-5 border-t pt-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Palette className="size-4 text-primary" />
                    Dokumentprofil
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Används i PDF och Excel, inte i programmets gränssnitt.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={!overview?.admin}
                  onClick={() =>
                    setReportBranding({ ...DEFAULT_REPORT_BRANDING })
                  }
                >
                  <RotateCcw />
                  HINTEK-standard
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
                    onChange={(value) =>
                      setReportBranding((current) => ({
                        ...current,
                        [key]: value.toUpperCase(),
                      }))
                    }
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
                HINTEK-blå används tills företaget väljer en egen profil.
              </p>
              <Button
                type="button"
                className="mobile-form-action mt-4"
                disabled={busy || !overview?.admin}
                onClick={() =>
                  void perform(
                    {
                      action: "settings",
                      data: {
                        companyName,
                        contactEmail: companyEmail,
                        reportBranding,
                        suggestions: {
                          general: suggestions
                            .split("\n")
                            .map((item) => item.trim())
                            .filter(Boolean),
                        },
                      },
                    },
                    "Dokumentprofilen är sparad.",
                  )
                }
              >
                <Save />
                Spara dokumentprofil
              </Button>
            </div>
            <div className="mt-5 border-t pt-5">
              {overview?.settings?.logoPath && (
                <img
                  src="/api/files/logo"
                  alt="Företagslogotyp"
                  className="mb-3 h-14 max-w-full object-contain"
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
                    await refresh();
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
                PNG, JPEG eller WebP. Logotypen visas i rapporter, inte i appens meny. Customer-temat hämtar automatiskt en läsbar profilfärg från bilden.
              </p>
            </div>
          </Panel> : null}
        </div>
        <div className="mt-6">
          <Profile notify={notify} />
        </div>
        <div className="mt-6">
          <SuggestionsEditor notify={notify} refresh={refresh} />
        </div>
      </>
    );
  else
    content = (
      <>
        {heading(
          "Hjälp och verktyg",
          "Så arbetar du med kontroll före idrifttagning.",
        )}
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Arbetsflödet">
            <ol className="list-decimal space-y-4 pl-5 text-sm leading-6">
              <li>Skapa en kund eller börja direkt med Ny kontroll.</li>
              <li>Fyll i projekt, instrument och relevanta mätmoment.</li>
              <li>Spara kontrollen och komplettera med bilder och dokument.</li>
              <li>
                Granska resultat och sammanfattning. Skapa PDF eller Excel.
              </li>
              <li>
                Färdigställ när du är klar. Ändringar görs sedan i en kopia.
              </li>
            </ol>
            <p className="notice mt-5">
              Autobedömning återger V1:s regler. Jordfelsbrytarens profil
              använder tider och testknapp; granska även de övriga provvärdena.
            </p>
          </Panel>
          <Calculator />
        </div>
      </>
    );
  return (
    <>
      {toast && (
        <div
          role={toast.error ? "alert" : "status"}
          className={`workspace-toast fixed bottom-5 right-5 z-50 flex max-w-[calc(100%-2.5rem)] items-start gap-3 rounded-xl border bg-card p-4 shadow-lg ${toast.error ? "border-red-200" : "border-emerald-200"}`}
        >
          <AlertCircle
            className={`mt-0.5 size-4 shrink-0 ${toast.error ? "text-red-600" : "text-emerald-600"}`}
          />
          <p className="max-w-md text-sm leading-6">{toast.text}</p>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Stäng meddelande"
            onClick={() => setToast(null)}
          >
            <X />
          </Button>
        </div>
      )}
      {content}
      {overview?.organization.storageMode === "LOCAL" && !overview.legalRequired && (
        <div hidden={loading || Boolean(error) || !["stats", "notifications", "new", "controls", "customers", "new_project", "projects", "planning", "rounds", "project", "tasks", "work_orders", "time", "workflow_task"].includes(view)}>
          <LocalWorkspace
            key={overview.organization.id}
            organization={overview.organization}
            user={user}
            view={view}
            controlId={controlId}
            customerId={customerId}
            projectId={projectId}
            taskId={taskId}
            taskType={taskType}
            timeTaskId={timeTaskId}
            overview={overview}
            preferences={preferences}
            notify={notify}
            refreshAccount={refresh}
          />
        </div>
      )}
      <Modal
        open={customerOpen}
        onOpenChange={setCustomerOpen}
        title={editing ? "Redigera kund" : "Ny kund"}
      >
        <form
          className="space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await perform(
                {
                  action: "customer_save",
                  id: editing?.id,
                  version: editing?.version,
                  data: customer,
                },
                editing ? "Kunden uppdaterad." : "Kunden skapad.",
              )
            )
              setCustomerOpen(false);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              { key: "name", label: "Namn / kontaktperson" },
              { key: "company", label: "Företag" },
              { key: "email", label: "E-post" },
              { key: "phone", label: "Telefon" },
              { key: "mobile", label: "Mobil" },
              { key: "address", label: "Adress" },
              { key: "postalCode", label: "Postnummer" },
              { key: "city", label: "Ort" },
              { key: "lat", label: "Latitud" },
              { key: "lng", label: "Longitud" },
            ].map((f) => (
              <Field
                key={f.key}
                id={`customer-${f.key}`}
                label={f.label}
                required={f.key === "name"}
                type={
                  f.key === "email"
                    ? "email"
                    : ["lat", "lng"].includes(f.key)
                      ? "number"
                      : "text"
                }
                value={customer[f.key as keyof typeof customer]}
                onChange={(v) => setCustomer((c) => ({ ...c, [f.key]: v }))}
              />
            ))}
          </div>
          <div>
            <label
              htmlFor="customer-notes"
              className="mb-2 block text-xs font-medium text-muted-foreground"
            >
              Anteckningar
            </label>
            <textarea
              id="customer-notes"
              className="form-textarea"
              value={customer.notes}
              onChange={(e) =>
                setCustomer((c) => ({ ...c, notes: e.target.value }))
              }
            />
          </div>
          <Button type="submit" disabled={busy}>
            <Save />
            Spara kund
          </Button>
        </form>
      </Modal>
    </>
  );
}
