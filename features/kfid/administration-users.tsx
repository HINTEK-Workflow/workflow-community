"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, type ReactNode } from "react";
import { Clock, HardHat, History, LayoutGrid, Mail, MailPlus, PauseCircle, Pencil, PlayCircle, RotateCw, Save, ShieldCheck, Trash2, UserCog, UserPlus, UserRound, UserX } from "lucide-react";
import { AreaIcon } from "@/components/area-icon";
import { useEntryState } from "@/components/history-nav";
import { ListCard, ListCardGrid, ListFilterBar, useListPrefs } from "@/components/list-filter-bar";
import { PageBackButton, PageHeader, usePageTrail } from "@/components/page-shell";
import { DelayedSkeleton, RowsSkeleton } from "@/components/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { indicatorBadge, type IndicatorTone } from "@/features/workflow/indicator-tone";
import { AdvancedFold, SettingsPart, useRollToPart } from "@/features/workflow/section-tabs";
import { OPERATOR_ADMIN_HREF } from "@/lib/operator/admin-notice";
import { useLoadEffect } from "@/lib/use-load-effect";
import { formatSwedish } from "@/lib/swedish-time";
import { clientExtensions } from "@ee/client";
import { applyWorkflowPermissionToggle, noWorkflowPermissionProfile, normalizeWorkflowPermissionProfile, workflowPermissionMatrix, workflowPermissionPresets, type WorkflowPermissionGrant, type WorkflowPermissionProfile, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { invitationStatus, memberStatus, shownUsers, USER_FILTER_LABEL, USER_FILTERS, USER_SORT_OPTIONS, USER_SORTS, USER_STATUS_LABEL, USERS_HREF, userFilterCounts, userListItems, userRoleLabel, type UserFilter, type UserListItem, type UserStatus } from "@/lib/workflow/users-list";
import { readWorkView, WORK_VIEW_DESCRIPTION, WORK_VIEW_LABEL, WORK_VIEWS, type WorkView } from "@/lib/workflow/work-view";
import { normalizeWorkAreas, profileRightsStep, readWorkProfile, suggestedRights, WORK_PROFILE, type WorkProfile } from "@/lib/workflow/work-profile";
import { workProfileHint, WorkProfileOptions, WorkProfileTitleSearch } from "./work-profile-options";
import { api } from "./api";
import { useConfirm } from "./confirm";
import { DialogPage } from "./dialog-page";
import { Columns } from "@/features/overview/viz";
import { DangerZone, DialogActions, Empty, Field, Panel, ShowMore } from "./ui";

/**
 * Användare (2026-10-31, som Kunder; a tab of Inställningar since 2026-11-02, with the button Operatörskonton). The list has the shared filter bar
 * (chips, search, sort, Rader | Kort) with the members and the invitations in one list; a row opens the person's or the
 * invitation's own page with cards (`&person=<userId>`, `&invitation=<id>`). Säkerhet and Administrationshistorik follow
 * under the list. The menu and these pages are presentation: /api/administration checks every call.
 */
type Member = {
  id: string;
  role: string;
  canDeleteControls: boolean;
  workflowPermissions: unknown;
  isActive: boolean;
  user: { id: string; name: string | null; email: string; isActive: boolean };
};
type Invitation = {
  id: string;
  email: string;
  name: string;
  role: string;
  canDeleteControls: boolean;
  workflowPermissions: unknown;
  status: "PREPARED" | "PENDING";
  expiresAt: string | null;
  sentAt: string | null;
  createdAt: string;
};
type Company = { id: string; name: string; members: Member[]; invitations: Invitation[]; profile?: { workAreas?: unknown } | null };
type Data = {
  organizations: Company[];
  activeOrganizationId: string | null;
  invitationDeliveryEnabled: boolean;
  events: { id: string; action: string; detail: string; createdAt: string }[];
  eventCount?: number;
};

const SUBJECT_LABEL: Partial<Record<WorkflowPermissionSubject, string>> = {
  projects: "Projekt", kfid: "Kontroll före idrifttagning", "work-order": "Arbetsorder", forms: "Formulär", "risk-assessment": "Riskbedömning",
  catalogue: "Artiklar och priser", "staff-register": "Personalliggare", quotes: "Offerter", team: "Teamet", economy: "Ekonomi", maintenance: "Underhåll", invoicing: "Fakturera",
};
const subjectLabel = (subject: WorkflowPermissionSubject) => SUBJECT_LABEL[subject] ?? "Kundregister";
const ACTION_LABEL: Record<string, string> = { read: "Läsa", create: "Skapa", edit: "Redigera", complete: "Slutföra", reopen: "Återöppna", report: "Rapportera", archive: "Arkivera" };
// Personalliggare: everyone who may read the project checks themselves in; these two are the extra rights.
// Teamet and Ekonomi (2026-10-28): one read right each; the label says what it opens.
const actionLabel = (subject: WorkflowPermissionSubject, action: string) =>
  subject === "invoicing" ? (action === "read" ? "Se fakturor" : "Utfärda, kreditera, skicka och markera betald")
    : subject === "team" ? "Belastning, tid, projektläge och statistik"
    : subject === "economy" ? "Ekonomisk sammanställning. Belopp visas bara med rätt att se priser."
    : subject === "staff-register" ? (action === "read" ? "Kontrollvy och export" : "Registrera och rätta andra")
    : ACTION_LABEL[action] ?? action;
const sameGrants = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((grant) => b.includes(grant));

const STATUS_TONE: Record<UserStatus, IndicatorTone> = { active: "success", paused: "neutral", inactive: "neutral", prepared: "neutral", sent: "info" };
const StatusBadge = ({ status }: { status: UserStatus }) => <Badge variant="outline" className={indicatorBadge(STATUS_TONE[status])} data-testid="user-status">{USER_STATUS_LABEL[status]}</Badge>;
const UserIcon = ({ kind }: { kind: UserListItem["kind"] }) => <AreaIcon area="admin" icon={kind === "invitation" ? Mail : UserRound} />;

/** One fact of a card: its name over the value. */
function Fact({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 break-words text-sm" data-testid={testId}>{children}</dd></div>;
}

type AdministrationEventRow = Data["events"][number];
// Reference log (2026-09-26): folded, newest 25 first, older pages on request; never the whole table.
function AdministrationHistory({ events, total, collapsed = true }: { events: AdministrationEventRow[]; total: number; collapsed?: boolean }) {
  const [older, setOlder] = useState<AdministrationEventRow[]>([]);
  const [busy, setBusy] = useState(false);
  const shown = [...events, ...older];
  const loadMore = async () => {
    setBusy(true);
    try {
      const oldest = shown[shown.length - 1]?.createdAt ?? "";
      const page = await api<{ events: AdministrationEventRow[] }>(`/api/administration?events=older&before=${encodeURIComponent(oldest)}`);
      setOlder((current) => [...current, ...page.events]);
    } finally { setBusy(false); }
  };
  return (
    <Panel icon={History} foldKey="administration-history" title="Administrationshistorik" description={total ? `${total} ${total === 1 ? "händelse" : "händelser"}, senaste först.` : undefined} collapsible={collapsed} defaultCollapsed={collapsed}>
      {shown.length > 0 ? <div>{shown.map((e) => (
        <div key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b py-2 last:border-0">
          <p className="min-w-0 break-words text-sm">
            {e.action === "stripe_sandbox_fixtures_reset"
              ? "Återställde Stripe sandbox till verifierat QA-grundläge."
              : e.detail}
          </p>
          <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatSwedish(e.createdAt, { dateStyle: "short", timeStyle: "short" })}
          </p>
        </div>
      ))}</div> : (
        <p className="page-description">Ändringar av företag och medlemskap visas här.</p>
      )}
      <ShowMore shown={shown.length} total={total} busy={busy} onMore={() => void loadMore()} />
    </Panel>
  );
}

export function UsersAdministration({ notify, personId, log = null, operatorAccounts = false, local = false, children }: {
  notify: (text: string, error?: boolean) => void;
  /** Whose list choices are remembered on this device. */
  personId: string;
  /** Administrationshistorik: folded, open (the address asked for it), or not shown (Local). */
  log?: "open" | "folded" | null;
  /** The button Operatörskonton (2026-11-02), by the rule the menu's row had: `menuItemAllowed("operator_accounts")`. */
  operatorAccounts?: boolean;
  /** A company in Local (one person, one file): Bjud in is grey with its reason, as the guide says (resa 2026-11-06). */
  local?: boolean;
  /** Shown after the list: the company's security. */
  children?: ReactNode;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const personParam = params.get("person");
  const invitationParam = params.get("invitation");
  const pageOpen = Boolean(personParam || invitationParam);
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [leaving, setLeaving] = useState(false);
  const [confirmCard, confirmElement] = useConfirm();
  const blankMember = () => ({
    name: "",
    email: "",
    role: "MEMBER",
    canDeleteControls: false,
    workflowPermissions: noWorkflowPermissionProfile() as WorkflowPermissionProfile,
    workProfile: null as WorkProfile | null,
    workView: null as WorkView | null,
    workViewReset: false,
  });
  const [editingMember, setEditingMember] = useState(false),
    [editingInvitation, setEditingInvitation] = useState(false),
    // Bjud in (UX-granskningen C3, 2026-10-22): the invitation and the change of a person are a page of their own.
    [inviteOpen, setInviteOpen] = useState(false),
    [member, setMember] = useState(blankMember);
  const [query, setQuery] = useEntryState("users.q", "");
  const [filter, setFilter] = useEntryState<UserFilter>("users.filter", "all");
  const [shown, setShown] = useState(50);
  const prefs = useListPrefs("users", personId, { sorts: USER_SORTS });
  const load = useCallback(async () => {
    try {
      setData(await api<Data>("/api/administration"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useLoadEffect(load);
  // Administrationshistorik from an address (?section=log): the page rolls there, as on the tabs' pages.
  useRollToPart(pageOpen ? null : params.get("section"), "administration");
  // Användare shows the company the person works in.
  const members = data?.organizations.find((o) => o.id === data.activeOrganizationId) ?? null;
  const openMember = personParam ? members?.members.find((m) => m.user.id === personParam) ?? null : null;
  const openInvitation = invitationParam ? members?.invitations.find((i) => i.id === invitationParam) ?? null : null;
  const openName = openMember ? openMember.user.name || openMember.user.email : openInvitation ? openInvitation.name || openInvitation.email : "";
  usePageTrail(openName ? { heading: openName } : {});

  async function perform(input: unknown, message: string) {
    setBusy(true);
    try {
      await api("/api/administration", { method: "POST", body: JSON.stringify(input) });
      notify(message);
      await load();
      return true;
    } catch (e) {
      notify((e as Error).message, true);
      return false;
    } finally {
      setBusy(false);
    }
  }
  /** An action that ends the open page: back to the list when it is done, and no "finns inte" on the way. */
  async function performAndLeave(input: unknown, message: string) {
    setLeaving(true);
    if (await perform(input, message)) router.replace(USERS_HREF);
    setLeaving(false);
  }
  // Radera personuppgifter (2026-10-03): the person is anonymised; protocols and history stay without the name.
  async function erasePerson(m: Member) {
    if (!members || !(await confirmCard({ title: "Radera personuppgifterna?", message: `${m.user.name || m.user.email}: namn och e-post ersätts med ”Borttagen användare”. Inloggning, kopplade Google-konton och appar och egna AI-konversationer raderas. Protokoll och historik behålls utan namnet. Fastställda versioner av egenkontrollprogrammet behåller namnet för spårbarheten. Kompetenskortet sparas i tre månader och raderas sedan. Du kan ta bort det tidigare under Egenkontroll. Har personen konto i ett annat företag tas hen bara bort härifrån. Det går inte att ångra.`, confirmLabel: "Radera personuppgifter", tone: "danger" }))) return;
    setLeaving(true);
    setBusy(true);
    try {
      const result = await api<{ anonymised: boolean }>("/api/erasure", { method: "POST", body: JSON.stringify({ action: "member", userId: m.user.id, organizationId: members.id }) });
      notify(result.anonymised ? "Personuppgifterna är raderade." : "Personen är borttagen ur företaget. Kontot finns kvar i ett annat företag.");
      await load();
      router.replace(USERS_HREF);
    } catch (cause) { notify((cause as Error).message, true); } finally { setBusy(false); setLeaving(false); }
  }
  function startInvite() {
    setEditingMember(false);
    setEditingInvitation(false);
    setMember(blankMember());
    setInviteOpen(true);
  }
  function editMembership(m: Member) {
    setEditingMember(true);
    setEditingInvitation(false);
    setInviteOpen(true);
    setMember({
      name: m.user.name || "",
      email: m.user.email,
      role: m.role === "OWNER" ? "ADMIN" : m.role,
      canDeleteControls: m.canDeleteControls,
      workflowPermissions: normalizeWorkflowPermissionProfile(m.workflowPermissions),
      workProfile: readWorkProfile(m.workflowPermissions)?.profile ?? null,
      workView: readWorkView(m.workflowPermissions)?.view ?? null,
      workViewReset: false,
    });
  }
  function editInvitation(invitation: Invitation) {
    setEditingMember(false);
    setEditingInvitation(true);
    setInviteOpen(true);
    setMember({
      name: invitation.name,
      email: invitation.email,
      role: invitation.role === "OWNER" ? "ADMIN" : invitation.role,
      canDeleteControls: invitation.canDeleteControls,
      workflowPermissions: normalizeWorkflowPermissionProfile(invitation.workflowPermissions),
      workProfile: readWorkProfile(invitation.workflowPermissions)?.profile ?? null,
      workView: readWorkView(invitation.workflowPermissions)?.view ?? null,
      workViewReset: false,
    });
  }

  /**
   * Yrkesprofil (2026-11-01): the choice fills in the work view. A new invitation gets the suggested rights while nothing else
   * is set; otherwise the admin is asked, so a later change of profile never changes what the person may do silently.
   */
  async function chooseProfile(next: WorkProfile | null) {
    const step = profileRightsStep({ isNew: !editingMember && !editingInvitation, role: member.role, current: member.workflowPermissions.grants, previous: member.workProfile, next });
    setMember((m) => ({ ...m, workProfile: next, ...(next ? { workView: WORK_PROFILE[next].workView } : {}), ...(step === "fill" ? { workflowPermissions: suggestedRights(next!) } : {}) }));
    if (step !== "ask") return;
    const yes = await confirmCard({ title: "Vill du använda de föreslagna behörigheterna?", message: `${WORK_PROFILE[next!].label} föreslår: ${WORK_PROFILE[next!].rights.join(", ")}. Behåller du de nuvarande ändras inte vad personen får göra.`, confirmLabel: "Sätt föreslagna", cancelLabel: "Behåll nuvarande" });
    if (yes) setMember((m) => ({ ...m, workflowPermissions: suggestedRights(next!) }));
  }

  if (error)
    return (
      <div className="min-w-0">
        <PageHeader title="Användare" />
        <Panel title="Kunde inte hämta användarna">
          <p role="alert">{error}</p>
          <Button className="mt-4" onClick={() => void load()}>Försök igen</Button>
        </Panel>
      </div>
    );

  const form = data ? <DialogPage pageKey="anvandare" size="page" open={inviteOpen} onOpenChange={setInviteOpen}
    title={editingMember ? "Redigera användare" : editingInvitation ? "Redigera inbjudan" : "Bjud in"} description={editingMember ? "Roll, yrkesprofil och behörigheter." : "Namn, e-post, roll, yrkesprofil och vad personen får göra."}>
      <form
        className="space-y-4"
        id="member-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await perform(
              {
                action: editingMember ? "member_save" : "invitation_create",
                organizationId: members?.id,
                ...member,
              },
              editingMember
                ? "Medlemsrollen är sparad."
                : data.invitationDeliveryEnabled
                  ? "Inbjudan är skickad."
                  : "Inbjudan är förberedd. Ingen e-post har skickats under det privata testet.",
            )
          ) {
            setEditingMember(false);
            setEditingInvitation(false);
            setMember(blankMember());
            setInviteOpen(false);
          }
        }}
      >
        <Field
          label="Namn"
          id="member-name"
          value={member.name}
          onChange={(v) => setMember((m) => ({ ...m, name: v }))}
          required
        />
        <Field
          label="E-post"
          id="member-email"
          type="email"
          value={member.email}
          onChange={(v) => setMember((m) => ({ ...m, email: v }))}
          disabled={editingMember}
          required
        />
        <div>
          <label
            htmlFor="member-role"
            className="mb-2 block text-xs font-medium"
          >
            Roll i företaget
          </label>
          <select
            id="member-role"
            className="form-select"
            value={member.role}
            onChange={(e) =>
              setMember((m) => ({ ...m, role: e.target.value }))
            }
          >
            <option value="MEMBER">Medarbetare – kundregister och kontroller</option>
            <option value="ADMIN">
              Företagsadmin – även företag och användare
            </option>
          </select>
        </div>
        {/* Yrkesprofil (2026-11-01): what is shown first; it never grants anything. The suggested rights stand in the box below. */}
        <div className="space-y-2" data-testid="member-work-profile-editor">
          <label htmlFor="member-work-profile" className="mb-2 block text-xs font-medium">Yrkesprofil</label>
          <WorkProfileTitleSearch onPick={(profile) => void chooseProfile(profile)} />
          <select id="member-work-profile" className="form-select" value={member.workProfile ?? ""} onChange={(e) => void chooseProfile((e.target.value || null) as WorkProfile | null)}>
            <WorkProfileOptions none="Ingen – personen kan välja själv" areas={normalizeWorkAreas(members?.profile?.workAreas)} />
          </select>
          <p className="text-xs leading-5 text-muted-foreground">{member.workProfile ? `${workProfileHint(member.workProfile)} ` : ""}Styr bara vad som visas först. Behörigheterna nedan avgör vad personen får göra.</p>
        </div>
        {/* Arbetsvy (2026-10-08): only what is shown first on the person's phone and tablet, never what they may do. Under Anpassa since 2026-11-01: the profile fills it in. */}
        <AdvancedFold title="Anpassa visning" summary="Arbetsvyn följer yrkesprofilen om du inte väljer en annan" testId="member-custom-view"
          open={Boolean(member.workView && member.workView !== (member.workProfile ? WORK_PROFILE[member.workProfile].workView : null))} openKey={inviteOpen ? member.email || "ny" : ""}>
        <div className="space-y-2" data-testid="member-work-view-editor">
          <label htmlFor="member-work-view" className="mb-2 block text-xs font-medium">Arbetsvy</label>
          <select id="member-work-view" className="form-select" value={member.workView ?? ""}
            onChange={(e) => setMember((m) => ({ ...m, workView: (e.target.value || null) as WorkView | null }))}>
            <option value="">Ingen – standardvisningen</option>
            {WORK_VIEWS.map((view) => <option key={view} value={view}>{WORK_VIEW_LABEL[view]}</option>)}
          </select>
          <p className="text-xs leading-5 text-muted-foreground">{member.workView ? WORK_VIEW_DESCRIPTION[member.workView] : "Lagom på mobil och surfplatta, Allt på dator."} Arbetsvyn styr bara vad som visas först. Behörigheterna nedan avgör vad personen får göra. Byter du vy återställs personens egna visningsval.</p>
          {editingMember ? <label className="flex items-center gap-3 text-sm">
            <Checkbox checked={member.workViewReset} onCheckedChange={(v) => setMember((m) => ({ ...m, workViewReset: v === true }))} />
            Återställ personens egna visningsval
          </label> : null}
        </div>
        </AdvancedFold>
        {member.role === "MEMBER" ? <div className="rounded-xl border bg-muted/25 p-4">
          {/* Rättigheter (UX-granskningen C3, 2026-10-22): one of the four presets first; the whole matrix only under Anpassa
              rättigheter, open from the start when the person's rights match no preset. */}
          <div><p className="text-sm font-semibold">Behörigheter i Workflow</p><p className="mt-1 text-xs leading-5 text-muted-foreground">En ny inbjudan börjar utan åtkomst. Välj det som passar, till exempel Utföra arbete.</p></div>
          {member.workProfile ? <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3" data-testid="member-suggested-rights">
            <p className="min-w-0 text-xs leading-5"><span className="font-medium">Föreslaget för {WORK_PROFILE[member.workProfile].label}:</span> {WORK_PROFILE[member.workProfile].rights.join(", ")}</p>
            {sameGrants(member.workflowPermissions.grants, suggestedRights(member.workProfile).grants) ? <span className="text-xs text-muted-foreground">Används</span>
              : <Button type="button" size="sm" variant="outline" onClick={() => setMember((current) => ({ ...current, workflowPermissions: suggestedRights(current.workProfile!) }))} data-testid="member-use-suggested">Använd förslaget</Button>}
          </div> : null}
          <div className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="Färdiga val">{workflowPermissionPresets.map((preset) => {
            const selected = preset.profile.grants.length === member.workflowPermissions.grants.length && preset.profile.grants.every((grant) => member.workflowPermissions.grants.includes(grant));
            return <button key={preset.id} type="button" aria-pressed={selected} className={`rounded-lg border p-3 text-left transition-colors ${selected ? "border-primary bg-primary/10" : "bg-card hover:bg-muted"}`} onClick={() => setMember((current) => ({ ...current, workflowPermissions: { version: 1, grants: [...preset.profile.grants] } }))}><span className="block text-xs font-semibold">{preset.label}</span><span className="mt-1 block text-[11px] leading-4 text-muted-foreground">{preset.description}</span></button>;
          })}</div>
          <div className="mt-4"><AdvancedFold title="Anpassa behörigheter" summary="Välj behörighet för behörighet i varje område" testId="member-custom-rights"
            open={member.workflowPermissions.grants.length > 0 && !workflowPermissionPresets.some((preset) => preset.profile.grants.length === member.workflowPermissions.grants.length && preset.profile.grants.every((grant) => member.workflowPermissions.grants.includes(grant)))}
            openKey={inviteOpen ? member.email || "ny" : ""}>
          <div className="flex flex-wrap items-start justify-between gap-3"><p className="text-[11px] leading-4 text-muted-foreground">Beroenden sköts automatiskt. Att skapa, redigera och rapportera kräver läsrätt. Att färdigställa och återöppna kräver även redigering.</p><Button type="button" size="sm" variant="outline" onClick={() => setMember((current) => ({ ...current, workflowPermissions: noWorkflowPermissionProfile() }))}>Rensa alla</Button></div>
          <div className="space-y-3">{(Object.entries(workflowPermissionMatrix).filter(([subject]) => subject !== "invoicing" || clientExtensions.CustomerInvoices) as [WorkflowPermissionSubject, readonly ("read" | "create" | "edit" | "complete" | "reopen" | "report" | "archive")[]][]).map(([subject, actions]) => {
            return <fieldset key={subject} className="field-group rounded-lg border p-3"><legend className="px-1 text-xs font-semibold">{subjectLabel(subject)}</legend><div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">{actions.map((action) => {
              const grant = `${subject}:${action}` as WorkflowPermissionGrant;
              const checked = member.workflowPermissions.grants.includes(grant);
              const label = actionLabel(subject, action);
              return <label key={action} className="flex items-center gap-2 text-xs"><Checkbox aria-label={`${subjectLabel(subject)}: ${label}`} checked={checked} onCheckedChange={(value) => setMember((current) => ({ ...current, workflowPermissions: applyWorkflowPermissionToggle(current.workflowPermissions, subject, action, value === true) }))} />{label}</label>;
            })}</div></fieldset>;
          })}</div>
          </AdvancedFold></div>
        </div> : <div className="notice">Företagsadmin har alla behörigheter. Behörigheterna per modul gäller rollen Medarbetare.</div>}
        <label className="flex items-center gap-3 text-sm">
          <Checkbox
            checked={member.canDeleteControls}
            onCheckedChange={(v) =>
              setMember((m) => ({ ...m, canDeleteControls: v === true }))
            }
          />
          Tillåt medlemmen att radera kontroller
        </label>
        <DialogActions cancel={{ onClick: () => setInviteOpen(false) }} primary={{ label: editingMember ? "Spara" : data.invitationDeliveryEnabled ? "Skicka inbjudan" : "Förbered inbjudan", type: "submit", icon: editingMember ? <Save /> : <MailPlus />, busy, testId: "member-save" }} />
      </form>
  </DialogPage> : null;

  // The person's or the invitation's own page. A name read in the list is there at once; a direct address shows the page's
  // shape until the company is read, so nothing moves when it comes.
  if (pageOpen) {
    const back = <PageBackButton href={USERS_HREF} testId="user-back" />;
    if (!data || leaving) return <div className="min-w-0" data-testid="user-page">
      {confirmElement}
      <PageHeader title={openName || "Användare"} actions={back} />
      <DelayedSkeleton testId="user-page-loading"><div className="rounded-xl border bg-card px-3.5 py-3"><RowsSkeleton rows={5} label="Hämtar personen…" /></div></DelayedSkeleton>
    </div>;
    if (openMember) return <div className="min-w-0" data-testid="user-page">
      {confirmElement}
      <PageHeader title={openName} description={openMember.user.email} actions={<>{back}
        <Button type="button" onClick={() => editMembership(openMember)} data-testid="user-edit"><Pencil />Redigera</Button></>}>
        <div className="mt-2 flex flex-wrap gap-2"><StatusBadge status={memberStatus(openMember)} /></div>
      </PageHeader>
      <Columns testId="user-columns"
        left={<>
        <Panel className="min-w-0" icon={UserCog} title="Uppgifter och roll">
          <dl className="grid gap-3">
            <Fact label="Namn">{openMember.user.name || "—"}</Fact>
            <Fact label="E-post"><span className="[overflow-wrap:anywhere]">{openMember.user.email}</span></Fact>
            <Fact label="Roll" testId="user-role">{userRoleLabel(openMember.role)}</Fact>
          </dl>
        </Panel>
        <Panel className="min-w-0" icon={LayoutGrid} title="Yrkesprofil och arbetsvy">
          <WorkProfileFact permissions={openMember.workflowPermissions} />
          <WorkViewFact permissions={openMember.workflowPermissions} />
        </Panel>
        </>}
        right={<>
        <Panel className="min-w-0" icon={Clock} title="Inbjudan och status">
          <dl className="grid gap-3">
            <Fact label="Status" testId="user-status-text">{!openMember.user.isActive ? "Kontot är inaktivt" : !openMember.isActive ? "Medlemskapet är pausat" : "Aktivt medlemskap"}</Fact>
          </dl>
          {!openMember.isActive ? <Button type="button" variant="outline" className="mt-4" disabled={busy} data-testid="user-activate"
            onClick={() => void perform({ action: "member_status", organizationId: members!.id, email: openMember.user.email, isActive: true }, "Medlemskapet är aktiverat. Inloggning är fortfarande begränsad till testadressen.")}><PlayCircle />Aktivera</Button> : null}
        </Panel>
        <Panel className="min-w-0" icon={ShieldCheck} title="Behörigheter" actions={<Button type="button" size="sm" variant="ghost" onClick={() => editMembership(openMember)} data-testid="user-edit-rights"><Pencil />Anpassa</Button>}>
          <RightsSummary role={openMember.role} permissions={openMember.workflowPermissions} canDeleteControls={openMember.canDeleteControls} />
        </Panel>
        </>} />
      <DangerZone className="mt-4" testId="user-danger-zone" description="Ett pausat medlemskap kan aktiveras igen. Det andra går inte att ångra.">
        {openMember.isActive ? <Button type="button" variant="outline" disabled={busy} data-testid="user-pause"
          onClick={() => void perform({ action: "member_status", organizationId: members!.id, email: openMember.user.email, isActive: false }, "Medlemskapet pausat.")}><PauseCircle />Pausa</Button> : null}
        <Button type="button" variant="outline" className="text-destructive" disabled={busy} data-testid="user-remove" onClick={() => void (async () => {
          if (await confirmCard({ title: "Ta bort medlemskapet?", message: "Personen förlorar åtkomsten till företaget. Kontroller och kunder behålls i företaget. Personens kompetenskort sparas i tre månader och raderas sedan. Du kan ta bort det tidigare under Egenkontroll.", confirmLabel: "Ta bort medlem", tone: "danger" }))
            await performAndLeave({ action: "member_remove", organizationId: members!.id, email: openMember.user.email }, "Medlemskapet är borttaget.");
        })()}><Trash2 />Ta bort medlem</Button>
        <Button type="button" variant="outline" className="text-destructive" disabled={busy} data-testid="user-erase" onClick={() => void erasePerson(openMember)}><UserX />Radera personuppgifter</Button>
      </DangerZone>
      {form}
    </div>;
    if (openInvitation) return <div className="min-w-0" data-testid="user-page">
      {confirmElement}
      <PageHeader title={openName} description={openInvitation.email} actions={<>{back}
        <Button type="button" disabled={busy} onClick={() => editInvitation(openInvitation)} data-testid="user-edit"><Pencil />Redigera</Button></>}>
        <div className="mt-2 flex flex-wrap gap-2"><StatusBadge status={invitationStatus(openInvitation)} /></div>
      </PageHeader>
      <Columns testId="user-columns"
        left={<>
        <Panel className="min-w-0" icon={UserCog} title="Uppgifter och roll">
          <dl className="grid gap-3">
            <Fact label="Namn">{openInvitation.name || "—"}</Fact>
            <Fact label="E-post"><span className="[overflow-wrap:anywhere]">{openInvitation.email}</span></Fact>
            <Fact label="Roll" testId="user-role">{userRoleLabel(openInvitation.role)}</Fact>
          </dl>
        </Panel>
        <Panel className="min-w-0" icon={LayoutGrid} title="Yrkesprofil och arbetsvy">
          <WorkProfileFact permissions={openInvitation.workflowPermissions} />
          <WorkViewFact permissions={openInvitation.workflowPermissions} />
        </Panel>
        </>}
        right={<>
        <Panel className="min-w-0" icon={Mail} title="Inbjudan och status">
          <dl className="grid gap-3">
            <Fact label="Status" testId="user-status-text">{openInvitation.status === "PENDING" ? `Skickad · giltig till ${formatSwedish(openInvitation.expiresAt!, { dateStyle: "short", timeStyle: "short" })}` : "Förberedd · utskick låst under privat test"}</Fact>
          </dl>
          {data.invitationDeliveryEnabled ? <Button type="button" variant="outline" className="mt-4" disabled={busy} data-testid="invitation-send"
            onClick={() => void perform({ action: "invitation_send", organizationId: members!.id, invitationId: openInvitation.id }, openInvitation.status === "PENDING" ? "En ny inbjudningslänk har skickats." : "Inbjudan har skickats.")}><RotateCw />{openInvitation.status === "PENDING" ? "Skicka igen" : "Skicka"}</Button> : null}
        </Panel>
        <Panel className="min-w-0" icon={ShieldCheck} title="Behörigheter" actions={<Button type="button" size="sm" variant="ghost" onClick={() => editInvitation(openInvitation)} data-testid="user-edit-rights"><Pencil />Anpassa</Button>}>
          <RightsSummary role={openInvitation.role} permissions={openInvitation.workflowPermissions} canDeleteControls={openInvitation.canDeleteControls} />
        </Panel>
        </>} />
      <DangerZone className="mt-4" testId="user-danger-zone" description="En skickad inbjudningslänk slutar fungera.">
        <Button type="button" variant="outline" className="text-destructive" disabled={busy} data-testid="invitation-revoke" onClick={() => void (async () => {
          if (await confirmCard({ title: "Återkalla inbjudan?", message: "En skickad inbjudningslänk slutar fungera.", confirmLabel: "Återkalla inbjudan", tone: "danger" }))
            await performAndLeave({ action: "invitation_revoke", organizationId: members!.id, invitationId: openInvitation.id }, "Inbjudan är återkallad.");
        })()}><Trash2 />Återkalla inbjudan</Button>
      </DangerZone>
      {form}
    </div>;
    return <div className="min-w-0" data-testid="user-page">
      <PageHeader title="Användare" actions={back} />
      <Empty title="Personen finns inte här" description="Personen kan ha tagits bort, eller hör till ett annat företag." />
    </div>;
  }

  // The list. The toolbar and the frame stand from the start; only the rows and the counts come when the company is read.
  const items = members ? userListItems(members.members, members.invitations) : [];
  const counts = data ? userFilterCounts(items) : null;
  const rows = shownUsers(items, filter, query, prefs.sort);
  const visible = rows.slice(0, shown);
  const empty = filter === "all" && !query.trim();
  return (
    <div className="min-w-0 space-y-6" data-testid="users-page">
      {confirmElement}
      <div>
        <PageHeader title="Användare" description={`Medarbetare, inbjudningar och behörigheter${members ? ` i ${members.name}` : ""}.`}
          actions={<>{operatorAccounts ? <Button asChild variant="outline"><Link href={OPERATOR_ADMIN_HREF} data-testid="users-operator-accounts"><HardHat />Operatörskonton</Link></Button> : null}
            {!data || members ? <Button type="button" disabled={!data} disabledReason={local ? "Kollegor kräver Cloud." : null} onClick={startInvite} data-testid="invite-open"><UserPlus />Bjud in</Button> : null}</>} />
        <ListFilterBar testId="users"
          chips={{ label: "Visa", chips: USER_FILTERS.map((value) => ({ value, label: USER_FILTER_LABEL[value], count: counts?.[value] ?? null })), value: filter, onChange: (value) => { setFilter(value); setShown(50); }, testId: "users-filter" }}
          search={{ label: "Sök användare", placeholder: "Namn, e-post eller roll…", value: query, onChange: (value) => { setQuery(value); setShown(50); }, testId: "users-search" }}
          sort={{ value: prefs.sort, options: USER_SORT_OPTIONS, onChange: prefs.setSort }}
          view={{ value: prefs.view, onChange: prefs.setView }} />
        <div className="mt-4" data-testid="users-list" data-view={prefs.view}>
          {!data ? <DelayedSkeleton testId="users-loading"><div className="rounded-xl border bg-card px-3.5 py-3"><RowsSkeleton rows={7} label="Hämtar användare…" /></div></DelayedSkeleton>
            : !members ? <Empty title="Inget företag att administrera" description="Användare hanteras av företagets administratör." />
            : !rows.length ? (empty ? <Empty title="Inga användare" description="Bjud in den första medarbetaren." /> : <div className="notice">Inget matchar urvalet. Ändra filter eller sökning.</div>)
            : prefs.view === "cards" ? <ListCardGrid>{visible.map((item) => <ListCard key={`${item.kind}-${item.id}`} testId="users-row" href={item.href} icon={<UserIcon kind={item.kind} />}
              title={item.name} subtitle={item.email !== item.name ? item.email : undefined} badges={<StatusBadge status={item.status} />}
              facts={[{ icon: ShieldCheck, label: "Roll", value: userRoleLabel(item.role) }]} />)}</ListCardGrid>
            : <section aria-label={`Användare, ${rows.length}`} className="overflow-hidden rounded-xl border bg-card shadow-xs">
              <ul className="divide-y">{visible.map((item) => <li key={`${item.kind}-${item.id}`}><Link href={item.href} className="tap-card flex min-h-14 min-w-0 items-center gap-3 px-4 py-2.5 outline-none hover:bg-secondary/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" data-testid="users-row">
                <UserIcon kind={item.kind} />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.name}</span>
                  <span className="block truncate text-xs text-muted-foreground" title={item.email}>{item.email !== item.name ? `${item.email} · ` : ""}{userRoleLabel(item.role)}</span></span>
                <span className="shrink-0"><StatusBadge status={item.status} /></span>
              </Link></li>)}</ul>
            </section>}
          <ShowMore shown={visible.length} total={rows.length} onMore={() => setShown((count) => count + 50)} />
        </div>
        {form}
      </div>
      {children}
      {/* Administrationshistorik (one page per tab, 2026-10-15): folded at the end, open when the address asks for it. */}
      {log && data ? <SettingsPart id="log">
        <AdministrationHistory key={`${log}-${data.events[0]?.id ?? "empty"}`} events={data.events} total={data.eventCount ?? data.events.length} collapsed={log !== "open"} />
      </SettingsPart> : null}
    </div>
  );
}

function WorkProfileFact({ permissions }: { permissions: unknown }) {
  const chosen = readWorkProfile(permissions)?.profile;
  return <p className="mb-3 text-sm font-medium" data-testid="member-work-profile">{chosen ? WORK_PROFILE[chosen].label : "Ingen yrkesprofil vald"}</p>;
}

function WorkViewFact({ permissions }: { permissions: unknown }) {
  const chosen = readWorkView(permissions)?.view;
  return <>
    <p className="text-sm font-medium" data-testid="member-work-view">{chosen ? WORK_VIEW_LABEL[chosen] : "Ingen vald"}</p>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">{chosen ? WORK_VIEW_DESCRIPTION[chosen] : "Lagom på mobil och surfplatta, Allt på dator."} Styr bara vad som visas först.</p>
  </>;
}

/** What the person may do, read from the same matrix as Anpassa rättigheter. */
function RightsSummary({ role, permissions, canDeleteControls }: { role: string; permissions: unknown; canDeleteControls: boolean }) {
  const deleting = <p className="mt-3 text-xs text-muted-foreground" data-testid="user-can-delete">{canDeleteControls ? "Får radera kontroller." : "Får inte radera kontroller."}</p>;
  if (role !== "MEMBER") return <><p className="text-sm">Företagsadmin har alla behörigheter.</p>{deleting}</>;
  const grants = normalizeWorkflowPermissionProfile(permissions).grants;
  const preset = workflowPermissionPresets.find((item) => sameGrants(item.profile.grants, grants));
  const lines = (Object.entries(workflowPermissionMatrix) as [WorkflowPermissionSubject, readonly string[]][]).flatMap(([subject, actions]) => {
    const held = actions.filter((action) => (grants as readonly string[]).includes(`${subject}:${action}`));
    return held.length ? [{ subject, text: held.map((action) => actionLabel(subject, action)).join(", ") }] : [];
  });
  return <>
    <p className="text-sm font-medium" data-testid="user-rights-preset">{preset?.label ?? (grants.length ? "Anpassade behörigheter" : "Ingen åtkomst")}</p>
    {lines.length ? <dl className="mt-3 grid gap-2" data-testid="user-rights">{lines.map((line) => <Fact key={line.subject} label={subjectLabel(line.subject)}>{line.text}</Fact>)}</dl> : null}
    {deleting}
  </>;
}
