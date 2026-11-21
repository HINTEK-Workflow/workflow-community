"use client";
import { plural } from "@/lib/plural";
import Link from "next/link";
import { sealWorkspaceCache } from "@/lib/workflow/workspace-cache";
import { formatSwedish } from "@/lib/swedish-time";
import { legalVersionLabel } from "@/lib/legal-version";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Building2, Save, UserCog, FileText, CheckCircle2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Panel, Field, Empty, DialogActions } from "./ui";
import { DialogPage } from "./dialog-page";
import { CompanyDetailsFields, CompanyGapsNote } from "./company-details-form";
import { api } from "./api";
import { blankCompanyProfile as blankProfile, blankCompanyPlace, companyDocumentGaps, type CompanyPlace } from "@/lib/kfid/company";
import { usePlaceLocationFields } from "@/features/workflow/place-location-fields";
import { LegalDocumentContent } from "@/components/legal-document";
import { useInstance } from "@/components/instance-provider";
import { useLoadEffect } from "@/lib/use-load-effect";
import { PageHeader } from "@/components/page-shell";
import { OwnCompanyPlacesButton } from "./own-company-places";
// Workflow AI lives in ee/ (not in the community edition, 2026-09-30); without it this is null.
type Company = {
  id: string;
  name: string;
  isActive: boolean;
  storageMode: "LOCAL" | "HINTEK_CLOUD";
  profile: Partial<typeof blankProfile>;
  wallet: { balance: number } | null;
  _count: { customers: number; workflowTasks: number };
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
      className="space-y-1 lg:hidden"
      data-testid={testId}
    >
      {items.map((item) => {
        const expanded = expandedId === item.id;
        const detailsId = `${testId}-${item.id}`;
        return (
          <section key={item.id} data-compact-row={item.id}>
            <button
              type="button"
              className="flex min-h-16 w-full min-w-0 items-center gap-3 rounded-md py-3 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              aria-expanded={expanded}
              aria-controls={detailsId}
              onClick={() => setExpandedId(expanded ? null : item.id)}
            >
              <span className="min-w-0 flex-1">{summary(item)}</span>
              <ChevronDown className={`size-4 shrink-0 text-muted-foreground ${expanded ? "" : "-rotate-90"}`} aria-hidden="true" />
            </button>
            {expanded && (
              <div id={detailsId} className="pb-4 pt-1" data-testid={`${testId}-details`}>
                {details(item)}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

// What the company holds on the server. Local keeps its customers and tasks in the company's own file, so the server's
// zero would be wrong there (data check 2026-10-04); tasks count every kind.
function contentCounts(c: { storageMode: string; _count: { customers: number; workflowTasks: number } }) {
  if (c.storageMode === "LOCAL") return "kunder och uppgifter i den egna filen";
  return `${plural(c._count.customers, "kund", "kunder")} · ${plural(c._count.workflowTasks, "uppgift", "uppgifter")}`;
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
  useLoadEffect(load);
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
          ? "Företagets admin godkänner tjänstevillkoren och varje användare bekräftar integritetspolicyn. serverlagring kräver även företagets DPA. Godkännandet sparas mot exakt dokumentversion."
          : "Tjänstevillkoren godkänns för företaget och integritetspolicyn bekräftas av var och en. DPA krävs bara med serverlagring."}
      </p>
      {documents === null ? (
        <p className="text-sm text-muted-foreground">Hämtar dokument…</p>
      ) : visibleDocuments?.length === 0 ? (
        <Empty
          title="Inga publicerade dokument"
          description="Inga villkor, integritetsdokument eller personuppgiftsbiträdesavtal har publicerats ännu."
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
                    <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
                      {document.title}
                      {document.required ? <span className="rounded-full border px-2 py-px text-[11px] font-medium text-muted-foreground">Krävs</span> : null}
                    </h3>
                    {/* "Gäller från <datum> · version N" (2026-10-07), never the raw version string. */}
                    <p className="mt-1 text-xs text-muted-foreground" data-testid="legal-version">{legalVersionLabel(document)}</p>
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
                      ? "Bekräfta att jag har tagit del"
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
/**
 * Företagets plats in Företagsuppgifter (2026-10-24: "bara en kartnål och adressen"): the company's own address and
 * pin with the same address field and map as a customer's place (usePlaceLocationFields) – no objects, no tree. Saved in
 * the profile with the rest of Företagsuppgifter (company_save), so the same rights apply.
 */
function CompanyPlaceFields({ value, onChange, name, onErrorChange }: { value: CompanyPlace; onChange: (value: CompanyPlace) => void; name: string; onErrorChange: (error: boolean) => void }) {
  const { addressFields, positionFieldset, positionError } = usePlaceLocationFields({ value, onChange, name, pinLabel: name || "Företaget", mapLabel: "Karta för företagets plats", testIdPrefix: "company-place" });
  useEffect(() => { onErrorChange(Boolean(positionError)); }, [positionError, onErrorChange]);
  return <fieldset className="field-group space-y-4 rounded-xl border p-4" data-testid="company-place">
    <legend className="px-1 text-sm font-medium">Företagets plats</legend>
    {addressFields}
    {positionFieldset}
  </fieldset>;
}
/**
 * Företag (2026-10-07): the agreements, the companies this person administers with Företagsuppgifter (name, contact
 * e-mail, organisation number, address) and whatever the caller adds below (logo and document profile, Historik och lagring).
 * Användare is a page of its own since 2026-11-01 (features/kfid/administration-users.tsx).
 */
export function Administration({
  notify,
  children,
}: {
  notify: (text: string, error?: boolean) => void;
  /** Shown after the panels: the logo and document profile. */
  children?: ReactNode;
}) {
  const { features, name: instanceName } = useInstance();
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState("");
  const [companyOpen, setCompanyOpen] = useState(false),
    [company, setCompany] = useState<Company | null>(null),
    [name, setName] = useState(""),
    [isActive, setActive] = useState(true),
    [storageMode, setStorageMode] = useState<"LOCAL" | "HINTEK_CLOUD">("LOCAL"),
    [profile, setProfile] = useState(blankProfile),
    // The place fields keep their own typed coordinates: a new key draws them afresh for every company opened.
    [placeKey, setPlaceKey] = useState(0),
    [placeError, setPlaceError] = useState(false);
  const load = useCallback(async () => {
    try {
      const next = await api<Data>("/api/administration");
      setData(next);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useLoadEffect(load);
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
    setProfile({ ...blankProfile, ...c?.profile, place: { ...blankCompanyPlace, ...c?.profile.place } });
    setPlaceKey((key) => key + 1);
    setPlaceError(false);
    setCompanyOpen(true);
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
      <Panel icon={Building2} title="Hämtar företag…">
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
        <PageHeader title="Företag" description="Här finns avtal, logotyp och rapporter, abonnemang och Ställ in Workflow. Namn och kontakt-e-post ändrar du under Företagsuppgifter." actions={data.superadmin && (
            <Button asChild variant="outline">
              <Link href="/?view=customer_companies"><Building2 /> Hantera kundföretag</Link>
            </Button>
          )} />
        <LegalPanel notify={notify} />
        <Panel icon={Building2} title="Företag" description="Här ändrar du företagsuppgifter, platser och användare.">
          {/* Only with more than one company to choose among (D9, UX punkt 8: an empty field with nothing to find). */}
          {data.organizations.length > 1 ? <Input
            aria-label="Sök företag"
            placeholder="Sök namn, organisationsnummer eller kontakt…"
            className="mb-5"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          /> : null}
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
                  <div><dt className="text-xs text-muted-foreground">Status och lagring</dt><dd className="mt-1">{c.isActive ? "Aktivt" : "Pausat"} · {c.storageMode === "LOCAL" ? "Lokal lagring" : "serverlagring"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Kontakt</dt><dd className="mt-1 break-all">{c.profile.email || "—"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Innehåll</dt><dd className="mt-1">{contentCounts(c)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Konto</dt><dd className="mt-1">{features.credits ? `${c.wallet?.balance ?? 0} krediter` : "—"}{c.invitations.length ? ` · ${c.invitations.length} väntande` : ""}</dd></div>
                </dl>
                <CompanyGapsNote gaps={companyDocumentGaps(c.profile)} testId="company-gaps" className="mt-3" />
                {/* Users are managed on Användare for the company you work in (2026-10-07); another company is opened first. */}
                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button variant="outline" onClick={() => edit(c)}>Företagsuppgifter</Button>
                  {/* Platser beside Företagsuppgifter (2026-10-24): the company's own places, Cloud, the company you work in. */}
                  {c.id === data.activeOrganizationId && c.storageMode !== "LOCAL" ? <OwnCompanyPlacesButton /> : null}
                  {c.id === data.activeOrganizationId && (
                    <Button asChild variant="outline"><Link href="/?view=administration"><UserCog />Användare</Link></Button>
                  )}
                  {c.isActive && c.id !== data.activeOrganizationId && (
                    <Button disabled={busy} onClick={async () => {
                      // Nothing read for this company is kept while the other one opens (stabil sidladdning steg 7).
                      sealWorkspaceCache();
                      if (await perform({ action: "switch", organizationId: c.id }, "Arbetsytan byts."))
                        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Reset all tenant-scoped client state when switching companies.
                        window.location.assign("/?view=stats");
                    }}>Öppna arbetsyta</Button>
                  )}
                </div>
              </>
            )}
          />
          {/* En vanlig lista i kortet (2026-11-12: inga kort i kort): one row per company, no frame round it. */}
          <div className="hidden gap-6 lg:grid" data-testid="company-desktop-grid">
            {filteredOrganizations.map((c) => (
                <article key={c.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="shrink-0 rounded-lg bg-secondary p-3 text-primary">
                        <Building2 className="size-5" />
                      </span>
                      <div className="min-w-0">
                        <h2 className="section-title truncate" title={c.name} data-card-title="">{c.name}</h2>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {c.profile.organizationNumber || "Org.nr saknas"} ·{" "}
                          {c.isActive ? "Aktivt" : "Pausat"}
                          {c.storageMode === "LOCAL"
                            ? " · Lokal lagring"
                            : " · serverlagring"}
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
                    · {contentCounts(c)}
                    {features.credits ? ` · ${c.wallet?.balance ?? 0} krediter` : ""}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => edit(c)}>
                      Företagsuppgifter
                    </Button>
                    {c.id === data.activeOrganizationId && c.storageMode !== "LOCAL" ? <OwnCompanyPlacesButton size="sm" /> : null}
                    {c.id === data.activeOrganizationId && (
                      <Button asChild variant="outline" size="sm">
                        <Link href="/?view=administration"><UserCog />Användare</Link>
                      </Button>
                    )}
                    {c.isActive && c.id !== data.activeOrganizationId && (
                      <Button
                        size="sm"
                        onClick={async () => {
                          sealWorkspaceCache();
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
        {children}
        <DialogPage
          pageKey="foretag"
          size="page"
          panelTitle="Företagsuppgifter"
          open={companyOpen}
          onOpenChange={setCompanyOpen}
          title={company ? "Företagsuppgifter" : "Nytt företag"}
        >
          <form
            className="space-y-5"
            onSubmit={async (e) => {
              e.preventDefault();
              if (placeError) return;
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
            <div className="rounded-xl border bg-muted/30 p-4">
              <Field
                id="tenant-storage-mode"
                label="Lagring av kunder, kontroller och bilder"
                options={["LOCAL", "HINTEK_CLOUD"]}
                optionLabels={{
                  LOCAL: "Lokalt på kundens dator",
                  HINTEK_CLOUD: "serverlagring",
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
                  : features.billing
                    ? "Arbetsdata lagras på servern med autosparning, backup, återställning och åtkomst från flera datorer. DPA ska godkännas innan kommersiell användning."
                    : `Arbetsdata lagras på servern för ${instanceName}, med åtkomst från flera datorer. Backup och återställning sköter den som driver installationen.`}
              </p>
              {features.billing ? <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Aktuellt pris visas på prissidan och i kassan före beställning.
              </p> : null}
            </div>
            {/* The shared fields (2026-11-04): the same as Skapa konto, Kom igång and the product administration's company page. */}
            <CompanyDetailsFields idPrefix="tenant" value={{ ...profile, name }} billingEmail={features.billing}
              onChange={(next) => { setName(next.name); setProfile((p) => ({ ...p, companyType: next.companyType, organizationNumber: next.organizationNumber, vatNumber: next.vatNumber, fSkatt: next.fSkatt, address: next.address, postalCode: next.postalCode, city: next.city, contactName: next.contactName, email: next.email, phone: next.phone, billingEmail: next.billingEmail, registeredOffice: next.registeredOffice, bankgiro: next.bankgiro, plusgiro: next.plusgiro })); }} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="tenant-installerEmail" label="Installatörens e-post" type="email" value={profile.installerEmail} onChange={(v) => setProfile((p) => ({ ...p, installerEmail: v }))} />
              <Field id="tenant-website" label="Webbadress" type="url" value={profile.website} onChange={(v) => setProfile((p) => ({ ...p, website: v }))} />
            </div>
            <CompanyGapsNote gaps={companyDocumentGaps(profile)} testId="tenant-gaps" />
            <CompanyPlaceFields key={placeKey} value={profile.place} onChange={(place) => setProfile((p) => ({ ...p, place }))} name={name} onErrorChange={setPlaceError} />
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
            <DialogActions cancel={{ onClick: () => setCompanyOpen(false) }} primary={{ label: "Spara företag", type: "submit", icon: <Save />, busy, disabled: placeError }} />
          </form>
        </DialogPage>
      </div>
    );
}
