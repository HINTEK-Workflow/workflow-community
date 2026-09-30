"use client";
import Link from "next/link";
import { formatSwedish } from "@/lib/swedish-time";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Building2,
  Save,
  Users,
  ArrowUpRight,
  Trash2,
  ShieldCheck,
  MailPlus,
  RotateCw,
  FileText,
  CheckCircle2,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Panel, Field, Modal, Empty, ShowMore } from "./ui";
import { api } from "./api";
import { useConfirm } from "./confirm";
import { blankCompanyProfile as blankProfile } from "@/lib/kfid/company";
import { LegalDocumentContent } from "@/components/legal-document";
import { OrganizationStructure } from "./organization-structure";
import { clientExtensions } from "@ee/client";
import { applyWorkflowPermissionToggle, noWorkflowPermissionProfile, normalizeWorkflowPermissionProfile, workflowPermissionMatrix, workflowPermissionPresets, type WorkflowPermissionGrant, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
// HINTEK AI lives in ee/ (not in the community edition, 2026-09-30); without it this is null.
const { SharingPolicyPanel } = clientExtensions;
type Company = {
  id: string;
  name: string;
  isActive: boolean;
  storageMode: "LOCAL" | "HINTEK_CLOUD";
  profile: Partial<typeof blankProfile>;
  wallet: { balance: number } | null;
  _count: { customers: number; controls: number };
  members: {
    id: string;
    role: string;
    canDeleteControls: boolean;
    workflowPermissions: unknown;
    isActive: boolean;
    user: { id: string; name: string | null; email: string; isActive: boolean };
  }[];
  invitations: {
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
  }[];
};
type Data = {
  organizations: Company[];
  activeOrganizationId: string | null;
  superadmin: boolean;
  invitationDeliveryEnabled: boolean;
  events: { id: string; action: string; detail: string; createdAt: string }[];
  eventCount?: number;
};
type LegalDocument = {
  id: string;
  type: "TERMS" | "PRIVACY" | "DPA" | "CREDIT_TERMS";
  scope: "INDIVIDUAL" | "ORGANIZATION";
  version: string;
  title: string;
  content: string;
  contentHash: string;
  validFrom: string | null;
  acceptedAt: string | null;
  canAccept: boolean;
  acceptHelp: string | null;
  required: boolean;
};

const roleLabel = (role: string) =>
  ({ OWNER: "Företagsadmin", ADMIN: "Företagsadmin", MEMBER: "Medarbetare" })[role] ?? role;

function CompactAdministrationList<T extends { id: string }>({
  items,
  testId,
  summary,
  details,
}: {
  items: T[];
  testId: string;
  summary: (item: T) => ReactNode;
  details: (item: T) => ReactNode;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return (
    <div
      className="overflow-hidden rounded-xl border lg:hidden"
      data-testid={testId}
    >
      {items.map((item, index) => {
        const expanded = expandedId === item.id;
        const detailsId = `${testId}-${item.id}`;
        return (
          <section key={item.id} className={index ? "border-t" : undefined} data-compact-row={item.id}>
            <button
              type="button"
              className="flex min-h-16 w-full min-w-0 items-center gap-3 px-4 py-3 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              aria-expanded={expanded}
              aria-controls={detailsId}
              onClick={() => setExpandedId(expanded ? null : item.id)}
            >
              <span className="min-w-0 flex-1">{summary(item)}</span>
              <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>
            {expanded && (
              <div id={detailsId} className="border-t bg-muted/20 px-4 py-4" data-testid={`${testId}-details`}>
                {details(item)}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function LegalPanel({
  notify,
  gate = false,
  onAccepted,
}: {
  notify: (text: string, error?: boolean) => void;
  gate?: boolean;
  onAccepted?: () => Promise<void> | void;
}) {
  const [documents, setDocuments] = useState<LegalDocument[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const result = await api<{ documents: LegalDocument[] }>("/api/legal");
      setDocuments(result.documents);
    } catch (error) {
      notify((error as Error).message, true);
      setDocuments([]);
    }
  }, [notify]);
  useEffect(() => {
    void load();
  }, [load]);
  const visibleDocuments = gate
    ? documents?.filter((document) => document.required)
    : documents;
  const pendingDocuments =
    visibleDocuments?.filter((document) => !document.acceptedAt) ?? [];

  async function acceptDocuments(items: LegalDocument[]) {
    setBusyId(items.length > 1 ? "ALL" : items[0]?.id ?? null);
    try {
      for (const document of items) {
        await api("/api/legal", {
          method: "POST",
          body: JSON.stringify({
            action: "accept",
            documentId: document.id,
            contentHash: document.contentHash,
          }),
        });
      }
      notify(
        items.some((document) => document.type === "PRIVACY")
          ? "Godkännanden och bekräftelser har sparats."
          : "Dokumentversionen är godkänd.",
      );
      await load();
      await onAccepted?.();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusyId(null);
    }
  }

  return (
    // Compact list (2026-09-26): reading is the user's choice, so documents stay folded behind a small link.
    // Outside the gate the panel itself is folded once everything is accepted.
    <Panel
      title={gate ? "Godkänn juridiska dokument" : "Juridiska dokument"}
      description={!gate && visibleDocuments?.length ? `${visibleDocuments.filter((document) => document.acceptedAt).length} av ${visibleDocuments.length} godkända` : undefined}
      collapsible={!gate}
      defaultCollapsed={!gate && Boolean(visibleDocuments?.length) && pendingDocuments.length === 0}
      key={!gate && documents ? "loaded" : "loading"}
    >
      <p className="page-description mb-3 text-xs">
        {gate
          ? "Företagets Owner godkänner tjänstevillkoren. Varje användare bekräftar att integritetspolicyn har lästs. HINTEK Cloud kräver dessutom företagets DPA. Allt kan bekräftas med en knapp och sparas mot exakt dokumentversion."
          : "Tjänstevillkor godkänns för företaget och integritetspolicyn bekräftas personligen. DPA krävs bara för företag med HINTEK Cloud. Varje registrering knyts till exakt dokumentinnehåll."}
      </p>
      {documents === null ? (
        <p className="text-sm text-muted-foreground">Hämtar dokument…</p>
      ) : visibleDocuments?.length === 0 ? (
        <Empty
          title="Inga publicerade dokument"
          description="Den versionsatta grunden är klar, men inga villkor, integritetsdokument eller personuppgiftsbiträdesavtal har publicerats."
        />
      ) : (
        <div className="divide-y rounded-xl border">
          {visibleDocuments?.map((document) => (
            <article key={document.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={document.acceptedAt ? "text-emerald-600" : "text-primary"}>
                    {document.acceptedAt ? (
                      <CheckCircle2 className="size-4" />
                    ) : (
                      <FileText className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold">{document.title}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Version {document.version} ·{" "}
                      {document.type === "PRIVACY"
                        ? "Personlig bekräftelse"
                        : document.scope === "INDIVIDUAL"
                          ? "Personligt godkännande"
                        : "Godkännande för företaget"}
                      {document.required ? " · Krävs för tjänsten" : ""}
                    </p>
                  </div>
                </div>
                {document.acceptedAt ? (
                  <span className="text-xs text-emerald-700 dark:text-emerald-300">
                    {document.type === "PRIVACY" ? "Tagit del " : "Godkänt "}
                    {formatSwedish(document.acceptedAt, { dateStyle: "short", timeStyle: "short" })}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    className="w-full sm:w-auto"
                    disabled={!document.canAccept || busyId === document.id}
                    onClick={() => void acceptDocuments([document])}
                  >
                    {document.type === "PRIVACY"
                      ? "Bekräfta att jag tagit del"
                      : document.scope === "ORGANIZATION"
                        ? "Godkänn för företaget"
                        : "Godkänn versionen"}
                  </Button>
                )}
              </div>
              <details className="group mt-1.5 pl-7">
                <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1 rounded text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                  <span className="group-open:hidden">Visa dokumentet</span>
                  <span className="hidden group-open:inline">Dölj dokumentet</span>
                  <ChevronDown
                    aria-hidden="true"
                    className="size-4 shrink-0 transition-transform group-open:rotate-180"
                  />
                </summary>
                <div className="mt-2 max-h-96 overflow-y-auto rounded-lg border bg-muted/30 px-4 py-4">
                  <LegalDocumentContent content={document.content} />
                </div>
              </details>
              {document.acceptHelp && !document.acceptedAt ? (
                <p className="mt-1 pl-7 text-xs text-muted-foreground">
                  {document.acceptHelp}
                </p>
              ) : null}
            </article>
          ))}
          {gate && pendingDocuments.length > 1 ? (
            <div className="flex justify-end px-4 py-3">
              <Button
                disabled={
                  busyId !== null ||
                  pendingDocuments.some((document) => !document.canAccept)
                }
                onClick={() => void acceptDocuments(pendingDocuments)}
              >
                Bekräfta alla och fortsätt
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
type AdministrationEventRow = Data["events"][number];
// Reference log (2026-09-26): folded, newest 25 first, older pages on request; never the whole table.
function AdministrationHistory({ events, total }: { events: AdministrationEventRow[]; total: number }) {
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
    <Panel title="Administrationshistorik" description={total ? `${total} händelser, senaste först.` : undefined} collapsible defaultCollapsed>
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
export function Administration({
  notify,
}: {
  notify: (text: string, error?: boolean) => void;
}) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState("");
  const [confirmCard, confirmElement] = useConfirm();
  const [companyOpen, setCompanyOpen] = useState(false),
    [company, setCompany] = useState<Company | null>(null),
    [name, setName] = useState(""),
    [isActive, setActive] = useState(true),
    [storageMode, setStorageMode] = useState<"LOCAL" | "HINTEK_CLOUD">("LOCAL"),
    [profile, setProfile] = useState(blankProfile);
  const [members, setMembers] = useState<Company | null>(null),
    [editingMember, setEditingMember] = useState(false),
    [member, setMember] = useState({
      name: "",
      email: "",
      role: "MEMBER",
      canDeleteControls: false,
      workflowPermissions: noWorkflowPermissionProfile(),
    });
  const load = useCallback(async () => {
    try {
      const next = await api<Data>("/api/administration");
      setData(next);
      setMembers((old) =>
        old ? (next.organizations.find((o) => o.id === old.id) ?? null) : null,
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function perform(input: unknown, message: string) {
    setBusy(true);
    try {
      await api("/api/administration", {
        method: "POST",
        body: JSON.stringify(input),
      });
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
  function edit(c?: Company) {
    setCompany(c ?? null);
    setName(c?.name ?? "");
    setActive(c?.isActive ?? true);
    setStorageMode(c?.storageMode ?? "LOCAL");
    setProfile({ ...blankProfile, ...c?.profile });
    setCompanyOpen(true);
  }
  function openMembers(c: Company) {
    setMembers(c);
    setEditingMember(false);
    setMember({
      name: "",
      email: "",
      role: "MEMBER",
      canDeleteControls: false,
      workflowPermissions: noWorkflowPermissionProfile(),
    });
  }
  function editMembership(m: Company["members"][number]) {
    setEditingMember(true);
    setMember({
      name: m.user.name || "",
      email: m.user.email,
      role: m.role === "OWNER" ? "ADMIN" : m.role,
      canDeleteControls: m.canDeleteControls,
      workflowPermissions: normalizeWorkflowPermissionProfile(m.workflowPermissions),
    });
  }
  function editInvitation(invitation: Company["invitations"][number]) {
    setEditingMember(false);
    setMember({
      name: invitation.name,
      email: invitation.email,
      role: invitation.role === "OWNER" ? "ADMIN" : invitation.role,
      canDeleteControls: invitation.canDeleteControls,
      workflowPermissions: normalizeWorkflowPermissionProfile(invitation.workflowPermissions),
    });
  }
  if (error)
    return (
      <Panel title="Företagsadministration">
        <p role="alert">{error}</p>
        <Button className="mt-4" onClick={() => void load()}>
          Försök igen
        </Button>
      </Panel>
    );
  if (!data)
    return (
      <Panel title="Hämtar företag…">
        <p className="page-description" role="status">
          Läser företagsuppgifter och medlemskap.
        </p>
      </Panel>
    );
  const filteredOrganizations = data.organizations.filter((c) =>
    [c.name, c.profile.organizationNumber, c.profile.email].some((v) =>
      v?.toLowerCase().includes(search.toLowerCase()),
    ),
  );
  return (
    <div className="space-y-6">
      {confirmElement}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Mitt företag och användare</h1>
          <p className="page-description mt-2">
            Administrera endast de företag där du är företagsadministratör.
          </p>
        </div>
        {data.superadmin && (
          <Button asChild variant="outline">
            <Link href="/?view=customer_companies"><Building2 /> Hantera kundföretag</Link>
          </Button>
        )}
      </div>
      <div className="notice flex gap-3">
        <ShieldCheck className="mt-0.5 size-5 shrink-0" />
        <p>
          Företagsmedlemmar och inbjudningar är avgränsade till ditt eget företag.
          Inbjudningsutskick är avstängt under det privata testet.
        </p>
      </div>
      <LegalPanel notify={notify} />
      {SharingPolicyPanel ? <SharingPolicyPanel /> : null}
      <Panel title="Företag">
        <Input
          aria-label="Sök företag"
          placeholder="Sök namn, organisationsnummer eller kontakt…"
          className="mb-5"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <CompactAdministrationList
          items={filteredOrganizations}
          testId="company-accordion-list"
          summary={(c) => (
            <>
              <span className="block break-words text-sm font-medium">{c.name}</span>
              <span className="mt-1 block break-words text-xs text-muted-foreground">
                {c.profile.organizationNumber || "Org.nr saknas"} · {c.members.length} användare
                {c.id === data.activeOrganizationId ? " · Din arbetsyta" : ""}
              </span>
            </>
          )}
          details={(c) => (
            <>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-muted-foreground">Status och lagring</dt><dd className="mt-1">{c.isActive ? "Aktivt" : "Pausat"} · {c.storageMode === "LOCAL" ? "Lokal lagring" : "HINTEK Cloud"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Kontakt</dt><dd className="mt-1 break-all">{c.profile.email || "—"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Innehåll</dt><dd className="mt-1">{c._count.customers} kunder · {c._count.controls} kontroller</dd></div>
                <div><dt className="text-xs text-muted-foreground">Konto</dt><dd className="mt-1">{c.wallet?.balance ?? 0} krediter{c.invitations.length ? ` · ${c.invitations.length} väntande` : ""}</dd></div>
              </dl>
              <div className={`mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 ${c.isActive && c.id !== data.activeOrganizationId ? "md:grid-cols-3" : ""}`}>
                <Button variant="outline" onClick={() => edit(c)}>Företagsuppgifter</Button>
                <Button variant="outline" onClick={() => openMembers(c)}><Users />Användare</Button>
                {c.isActive && c.id !== data.activeOrganizationId && (
                  <Button disabled={busy} onClick={async () => {
                    if (await perform({ action: "switch", organizationId: c.id }, "Arbetsytan byts."))
                      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Reset all tenant-scoped client state when switching companies.
                      window.location.assign("/?view=stats");
                  }}><ArrowUpRight />Öppna arbetsyta</Button>
                )}
              </div>
            </>
          )}
        />
        <div className="hidden gap-4 lg:grid lg:grid-cols-2" data-testid="company-desktop-grid">
          {filteredOrganizations.map((c) => (
              <article key={c.id} className="rounded-xl border p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="rounded-lg bg-secondary p-3 text-primary">
                      <Building2 className="size-5" />
                    </span>
                    <div>
                      <h2 className="section-title">{c.name}</h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {c.profile.organizationNumber || "Org.nr saknas"} ·{" "}
                        {c.isActive ? "Aktivt" : "Pausat"}
                        {c.storageMode === "LOCAL"
                          ? " · Lokal lagring"
                          : " · HINTEK Cloud"}
                        {c.id === data.activeOrganizationId
                          ? " · Din arbetsyta"
                          : ""}
                      </p>
                    </div>
                  </div>
                </div>
                <p className="mt-4 text-sm text-muted-foreground">
                  {c.members.length} användare
                  {c.invitations.length
                    ? ` · ${c.invitations.length} väntande`
                    : ""}{" "}
                  · {c._count.customers} kunder · {c._count.controls} kontroller
                  · {c.wallet?.balance ?? 0} krediter
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => edit(c)}>
                    Företagsuppgifter
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openMembers(c)}
                  >
                    <Users />
                    Användare
                  </Button>
                  {c.isActive && c.id !== data.activeOrganizationId && (
                    <Button
                      size="sm"
                      onClick={async () => {
                        if (
                          await perform(
                            { action: "switch", organizationId: c.id },
                            "Arbetsytan byts.",
                          )
                        )
                          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Reset all tenant-scoped client state when switching companies.
                          window.location.assign("/?view=stats");
                      }}
                      disabled={busy}
                    >
                      <ArrowUpRight />
                      Öppna arbetsyta
                    </Button>
                  )}
                </div>
              </article>
            ))}
        </div>
        {!filteredOrganizations.length && (
          <Empty
            title="Inga företag att administrera"
            description="Företagsadministratörer kan hantera sitt företag här."
          />
        )}
      </Panel>
      <OrganizationStructure notify={notify} />
      <AdministrationHistory key={data.events[0]?.id ?? "empty"} events={data.events} total={data.eventCount ?? data.events.length} />
      <Modal
        open={companyOpen}
        onOpenChange={setCompanyOpen}
        title={company ? "Företagsuppgifter" : "Nytt företag"}
      >
        <form
          className="space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await perform(
                {
                  action: "company_save",
                  organizationId: company?.id,
                  name,
                  isActive,
                  storageMode,
                  profile,
                },
                "Företagsuppgifterna är sparade.",
              )
            )
              setCompanyOpen(false);
          }}
        >
          <Field
            id="tenant-name"
            label="Företagsnamn"
            value={name}
            onChange={setName}
            required
          />
          <div className="rounded-xl border bg-muted/30 p-4">
            <Field
              id="tenant-storage-mode"
              label="Lagring av kunder, kontroller och bilder"
              options={["LOCAL", "HINTEK_CLOUD"]}
              optionLabels={{
                LOCAL: "Lokalt på kundens dator",
                HINTEK_CLOUD: "HINTEK Cloud",
              }}
              value={storageMode}
              onChange={(value) =>
                setStorageMode(value as "LOCAL" | "HINTEK_CLOUD")
              }
              disabled={!data.superadmin}
            />
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              {storageMode === "LOCAL"
                ? "Arbetsdata stannar i vald lokal mapp. Ingen central autosparning, backup eller synkning ingår."
                : "Arbetsdata lagras hos HINTEK med autosparning, backup, återställning och åtkomst från flera datorer. DPA ska godkännas innan kommersiell användning."}
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Aktuellt pris visas på prissidan och i kassan före beställning.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              { key: "organizationNumber", label: "Organisationsnummer" },
              { key: "vatNumber", label: "Momsregistreringsnummer" },
              { key: "contactName", label: "Kontaktperson" },
              { key: "email", label: "E-post" },
              { key: "phone", label: "Telefon" },
              { key: "installerEmail", label: "Installatörens e-post" },
              { key: "billingEmail", label: "Faktura-e-post" },
              { key: "website", label: "Webbadress" },
              { key: "address", label: "Faktureringsadress" },
              { key: "postalCode", label: "Postnummer" },
              { key: "city", label: "Ort" },
            ].map((f) => (
              <Field
                key={f.key}
                id={`tenant-${f.key}`}
                label={f.label}
                value={profile[f.key as keyof typeof profile]}
                type={
                  f.key.toLowerCase().includes("email")
                    ? "email"
                    : f.key === "website"
                      ? "url"
                      : "text"
                }
                onChange={(v) => setProfile((p) => ({ ...p, [f.key]: v }))}
              />
            ))}
          </div>
          <div>
            <label
              htmlFor="tenant-notes"
              className="mb-2 block text-xs font-medium"
            >
              Interna anteckningar
            </label>
            <textarea
              id="tenant-notes"
              className="form-textarea"
              value={profile.notes}
              onChange={(e) =>
                setProfile((p) => ({ ...p, notes: e.target.value }))
              }
            />
          </div>
          {data.superadmin && (
            <label className="flex items-center gap-3 text-sm">
              <Checkbox
                checked={isActive}
                onCheckedChange={(v) => setActive(v === true)}
              />
              Aktivt företag
            </label>
          )}
          <Button disabled={busy}>
            <Save />
            Spara företag
          </Button>
        </form>
      </Modal>
      <Modal
        open={Boolean(members)}
        onOpenChange={(v) => {
          if (!v) setMembers(null);
        }}
        title={`Användare · ${members?.name ?? ""}`}
      >
        <CompactAdministrationList
          items={members?.members ?? []}
          testId="member-accordion-list"
          summary={(m) => (
            <>
              <span className="block break-words text-sm font-medium">{m.user.name || m.user.email}</span>
              <span className="mt-1 block break-all text-xs text-muted-foreground">
                {m.user.email} · {roleLabel(m.role)}
              </span>
            </>
          )}
          details={(m) => (
            <>
              <dl className="grid gap-3 text-sm">
                <div><dt className="text-xs text-muted-foreground">Status</dt><dd className="mt-1">{!m.user.isActive ? "Konto inaktivt" : !m.isActive ? "Medlemskap pausat" : "Aktivt medlemskap"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Behörighet</dt><dd className="mt-1">{m.canDeleteControls ? "Kan ta bort kontroller" : "Kan inte ta bort kontroller"}</dd></div>
              </dl>
              <div className="mt-4 grid grid-cols-1 gap-2">
                <Button variant="outline" disabled={busy} onClick={() => void perform({ action: "member_status", organizationId: members!.id, email: m.user.email, isActive: !m.isActive }, m.isActive ? "Medlemskapet pausat." : "Medlemskapet aktiverat. Inloggning är fortfarande begränsad till testadressen.")}>{m.isActive ? "Pausa" : "Aktivera"}</Button>
                <Button variant="outline" onClick={() => editMembership(m)}>Ändra roll</Button>
                <Button variant="outline" disabled={busy} onClick={async () => {
                  if (await confirmCard({ title: "Ta bort medlemskapet?", message: "Personen förlorar åtkomsten till företaget. Kontroller och kunder behålls i företaget.", confirmLabel: "Ta bort medlem", tone: "danger" }))
                    void perform({ action: "member_remove", organizationId: members!.id, email: m.user.email }, "Medlemskapet är borttaget.");
                }}><Trash2 />Ta bort medlem</Button>
              </div>
            </>
          )}
        />
        <div className="hidden space-y-3 lg:block" data-testid="member-desktop-list">
          {members?.members.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between gap-3 border-b pb-3"
            >
              <div>
                <p className="text-sm font-medium">
                  {m.user.name || m.user.email}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {m.user.email} ·{" "}
                  {
                    {
                      OWNER: "Företagsadmin",
                      ADMIN: "Företagsadmin",
                      MEMBER: "Medarbetare",
                    }[m.role]
                  }
                  {!m.user.isActive
                    ? " · Konto inaktivt"
                    : !m.isActive
                      ? " · Medlemskap pausat"
                      : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void perform(
                      {
                        action: "member_status",
                        organizationId: members.id,
                        email: m.user.email,
                        isActive: !m.isActive,
                      },
                      m.isActive
                        ? "Medlemskapet pausat."
                        : "Medlemskapet aktiverat. Inloggning är fortfarande begränsad till testadressen.",
                    )
                  }
                >
                  {m.isActive ? "Pausa" : "Aktivera"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => editMembership(m)}
                >
                  Ändra roll
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Ta bort medlem ${m.user.email}`}
                  disabled={busy}
                  onClick={async () => {
                    if (await confirmCard({ title: "Ta bort medlemskapet?", message: "Personen förlorar åtkomsten till företaget. Kontroller och kunder behålls i företaget.", confirmLabel: "Ta bort medlem", tone: "danger" }))
                      void perform(
                        {
                          action: "member_remove",
                          organizationId: members.id,
                          email: m.user.email,
                        },
                        "Medlemskapet är borttaget.",
                      );
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
        </div>
        {members?.invitations.length ? (
          <div className="mt-6 space-y-3 border-t pt-5">
            <h3 className="section-title">Väntande inbjudningar</h3>
            <CompactAdministrationList
              items={members.invitations}
              testId="invitation-accordion-list"
              summary={(invitation) => (
                <>
                  <span className="block break-words text-sm font-medium">{invitation.name}</span>
                  <span className="mt-1 block break-all text-xs text-muted-foreground">{invitation.email} · {invitation.status === "PENDING" ? "Skickad" : "Förberedd"}</span>
                </>
              )}
              details={(invitation) => (
                <>
                  <p className="text-sm text-muted-foreground">
                    {invitation.status === "PENDING" ? `Giltig till ${formatSwedish(invitation.expiresAt!, { dateStyle: "short", timeStyle: "short" })}` : "Utskick låst under privat test"}
                  </p>
                  <div className="mt-4 grid grid-cols-1 gap-2">
                    <Button variant="outline" disabled={busy} onClick={() => editInvitation(invitation)}>Ändra</Button>
                    {data.invitationDeliveryEnabled && (
                      <Button variant="outline" disabled={busy} onClick={() => void perform({ action: "invitation_send", organizationId: members.id, invitationId: invitation.id }, invitation.status === "PENDING" ? "En ny inbjudningslänk har skickats." : "Inbjudan har skickats.")}><RotateCw />{invitation.status === "PENDING" ? "Skicka igen" : "Skicka"}</Button>
                    )}
                    <Button variant="outline" disabled={busy} onClick={async () => {
                      if (await confirmCard({ title: "Återkalla inbjudan?", message: "En skickad inbjudningslänk slutar fungera.", confirmLabel: "Återkalla inbjudan", tone: "danger" }))
                        void perform({ action: "invitation_revoke", organizationId: members.id, invitationId: invitation.id }, "Inbjudan är återkallad.");
                    }}><Trash2 />Återkalla inbjudan</Button>
                  </div>
                </>
              )}
            />
            <div className="hidden space-y-3 lg:block">
            {members.invitations.map((invitation) => (
              <div
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div>
                  <p className="text-sm font-medium">
                    {invitation.name} · {invitation.email}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {invitation.status === "PENDING"
                      ? `Skickad · giltig till ${formatSwedish(invitation.expiresAt!, { dateStyle: "short", timeStyle: "short" })}`
                      : "Förberedd · utskick låst under privat test"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => editInvitation(invitation)}
                  >
                    Ändra
                  </Button>
                  {data.invitationDeliveryEnabled && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void perform(
                          {
                            action: "invitation_send",
                            organizationId: members.id,
                            invitationId: invitation.id,
                          },
                          invitation.status === "PENDING"
                            ? "En ny inbjudningslänk har skickats."
                            : "Inbjudan har skickats.",
                        )
                      }
                    >
                      <RotateCw />
                      {invitation.status === "PENDING"
                        ? "Skicka igen"
                        : "Skicka"}
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Återkalla inbjudan för ${invitation.email}`}
                    disabled={busy}
                    onClick={async () => {
                      if (await confirmCard({ title: "Återkalla inbjudan?", message: "En skickad inbjudningslänk slutar fungera.", confirmLabel: "Återkalla inbjudan", tone: "danger" }))
                        void perform(
                          {
                            action: "invitation_revoke",
                            organizationId: members.id,
                            invitationId: invitation.id,
                          },
                          "Inbjudan är återkallad.",
                        );
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
            </div>
          </div>
        ) : null}
        <form
          className="mt-6 space-y-4"
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
                    : "Inbjudan är säkert förberedd. Inget mejl har skickats under privat test.",
              )
            ) {
              setEditingMember(false);
              setMember({
                name: "",
                email: "",
                role: "MEMBER",
                canDeleteControls: false,
                workflowPermissions: noWorkflowPermissionProfile(),
              });
            }
          }}
        >
          <h3 className="section-title">
            {editingMember ? "Ändra medlemsroll" : "Förbered ny inbjudan"}
          </h3>
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
          {member.role === "MEMBER" ? <div className="rounded-xl border bg-muted/25 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold">Rättigheter i Workflow</p><p className="mt-1 text-xs leading-5 text-muted-foreground">En anställd får bara det du kryssar i; en ny inbjudan börjar utan åtkomst. Välj till exempel Utföra arbete. Styr arbetsmoment per modul. Lagringssätt, abonnemang och krediter hanteras separat.</p></div><Button type="button" size="sm" variant="outline" onClick={() => setMember((current) => ({ ...current, workflowPermissions: noWorkflowPermissionProfile() }))}>Rensa alla</Button></div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="Rättighetspresets">{workflowPermissionPresets.map((preset) => {
              const selected = preset.profile.grants.length === member.workflowPermissions.grants.length && preset.profile.grants.every((grant) => member.workflowPermissions.grants.includes(grant));
              return <button key={preset.id} type="button" aria-pressed={selected} className={`rounded-lg border p-3 text-left transition-colors ${selected ? "border-primary bg-primary/10" : "bg-card hover:bg-muted"}`} onClick={() => setMember((current) => ({ ...current, workflowPermissions: { version: 1, grants: [...preset.profile.grants] } }))}><span className="block text-xs font-semibold">{preset.label}</span><span className="mt-1 block text-[11px] leading-4 text-muted-foreground">{preset.description}</span></button>;
            })}</div>
            <p className="mt-3 text-[11px] leading-4 text-muted-foreground">Beroenden hanteras automatiskt: skapa, redigera och rapportera kräver läsrättighet; slutföra och återöppna kräver även redigering.</p>
            <div className="mt-4 space-y-3">{(Object.entries(workflowPermissionMatrix) as [WorkflowPermissionSubject, readonly ("read" | "create" | "edit" | "complete" | "reopen" | "report" | "archive")[]][]).map(([subject, actions]) => {
              const subjectLabel = subject === "projects" ? "Projekt" : subject === "kfid" ? "Kontroll före idrifttagning" : subject === "work-order" ? "Arbetsorder" : subject === "forms" ? "Formulär" : "Riskbedömning";
              return <fieldset key={subject} className="rounded-lg border bg-card p-3"><legend className="px-1 text-xs font-semibold">{subjectLabel}</legend><div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">{actions.map((action) => {
                const grant = `${subject}:${action}` as WorkflowPermissionGrant;
                const checked = member.workflowPermissions.grants.includes(grant);
                const actionLabel = action === "read" ? "Läsa" : action === "create" ? "Skapa" : action === "edit" ? "Redigera" : action === "complete" ? "Slutföra" : action === "reopen" ? "Återöppna" : action === "report" ? "Rapportera" : "Arkivera";
                return <label key={action} className="flex items-center gap-2 text-xs"><Checkbox checked={checked} onCheckedChange={(value) => setMember((current) => ({ ...current, workflowPermissions: applyWorkflowPermissionToggle(current.workflowPermissions, subject, action, value === true) }))} />{actionLabel}</label>;
              })}</div></fieldset>;
            })}</div>
          </div> : <div className="notice">Företagsadmin har full Workflow-behörighet. Modulrättigheter används när rollen är Medarbetare.</div>}
          <label className="flex items-center gap-3 text-sm">
            <Checkbox
              checked={member.canDeleteControls}
              onCheckedChange={(v) =>
                setMember((m) => ({ ...m, canDeleteControls: v === true }))
              }
            />
            Tillåt medlemmen att radera kontroller
          </label>
          <Button disabled={busy}>
            {editingMember ? <Save /> : <MailPlus />}
            {editingMember
              ? "Spara medlemsroll"
              : data.invitationDeliveryEnabled
                ? "Skicka inbjudan"
                : "Förbered inbjudan"}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
