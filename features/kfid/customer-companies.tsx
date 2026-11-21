"use client";

import { useEffect, useState } from "react";
import { RowChevron } from "@/components/row-chevron";
import { formatSwedish } from "@/lib/swedish-time";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, ClipboardList, Coins, CreditCard, History, Pause, Pencil, Play, Plus, ScrollText, ShieldCheck, Users, UserX } from "lucide-react";
import { AreaIcon } from "@/components/area-icon";
import { AiUsagePanel } from "@/features/ai/ai-usage-panel";
import { useEntryState } from "@/components/history-nav";
import { ListCard, ListCardGrid, ListFilterBar, useListPrefs } from "@/components/list-filter-bar";
import { ListGroup, ListRow } from "@/components/native/list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAddressEntryState } from "@/components/use-address-filter";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { COMPANY_FILTER_LABEL, COMPANY_FILTERS, COMPANY_PAYMENT_LABEL, COMPANY_PAYMENT_TONE, COMPANY_SORTS, listCustomerCompanies, paymentSumText, type CompanyFilter } from "@/lib/kfid/customer-company-list";
import type { CompanyPayment } from "@/lib/extensions/types";
import { listSortOptions } from "@/lib/list-filter";
import { allowedFilter } from "@/lib/url-filters";
import { Input } from "@/components/ui/input";
import { Panel, Empty, Modal, ShowMore, useOpenWhenReady, Field, DialogActions } from "./ui";
import { DialogPage } from "./dialog-page";
import { CompanyDetailsFields, CompanyGapsNote, blankCompanyDetails, type CompanyDetailsValue } from "./company-details-form";
import { CustomerCompanyInlineEdit } from "./customer-company-edit";
import { api } from "./api";
import { clientExtensions } from "@ee/client";
import { useConfirm } from "./confirm";
import { StaffRegisterDisclosure } from "./staff-register-disclosure";
import { CompanyClosurePanel } from "./company-closure-panel";
import { AdvancedFold } from "@/features/workflow/section-tabs";
import { PageActionsSlotProvider, PageHeader, usePageTrail } from "@/components/page-shell";
import { useInstance } from "@/components/instance-provider";
// Workflow's commercial views live in ee/ (Fas 2); without it they are null.
const { BillingRead, CustomerInvoiceDisclosure } = clientExtensions;

type CustomerCompany = {
  id: string;
  name: string;
  isActive: boolean;
  storageMode: "LOCAL" | "HINTEK_CLOUD";
  /** A sole trader's number comes masked (ÅÅMMDD-••••) from the server. */
  organizationNumber: string;
  companyType?: "company" | "soleTrader";
  contactName: string;
  contactEmail: string;
  billingEmail: string;
  city: string;
  /** Company details for documents (2026-11-04); company metadata only. */
  vatNumber?: string; fSkatt?: boolean; address?: string; postalCode?: string; phone?: string; registeredOffice?: string; bankgiro?: string; plusgiro?: string;
  documentGaps?: { key: string; label: string }[];
  owner: { name: string | null; email: string } | null;
  createdAt?: string;
  updatedAt?: string;
  registration?: { at: string; detail: string } | null;
  acceptances?: { title: string; version: string; acceptedAt: string; by: string }[];
  administrators: { name: string | null; email: string }[];
  preparedOwnerEmail: string | null;
  preparedOwnerName: string | null;
  ownerInvitationStatus: "PREPARED" | "PENDING" | null;
  ownerInvitationSentAt?: string | null;
  memberCount: number;
  invitationCount: number;
  customerCount: number;
  controlCount: number;
  /** From ee/; null without payment in the installation. */
  payment?: CompanyPayment | null;
  creditBalance: number;
  purchasedCreditBalance: number;
  creditExpiryEnabled: boolean;
  creditExpiryOverrideAt: string | null;
  /** Maskinlarm: automatiska arbetsordrar per dygn (20 som förval). */
  machineDailyOrderCap?: number;
};

type CustomerAuditEvent = { id: string; label: string; createdAt: string };

const SORT_OPTIONS = listSortOptions(COMPANY_SORTS);

/** Aktivt or Pausat, the same pill in the rows, the cards and on the company's page. */
function CompanyStatus({ active }: { active: boolean }) {
  return <Badge variant="outline" className={indicatorBadge(active ? "success" : "neutral")} data-testid="company-status">{active ? "Aktivt" : "Pausat"}</Badge>;
}

function PaymentStatus({ payment }: { payment?: CompanyPayment | null }) {
  if (!payment) return null;
  return <Badge variant="outline" className={indicatorBadge(COMPANY_PAYMENT_TONE[payment.status])} data-testid="company-payment">{COMPANY_PAYMENT_LABEL[payment.status]}</Badge>;
}

/** Företagets betalning (beslut 11): the status and its dates, from the stored Stripe data. Only ee/ gives a company a `payment`, so without billing this panel is never drawn. */
function PaymentPanel({ payment }: { payment: CompanyPayment }) {
  const day = (iso: string | null) => iso ? formatSwedish(iso, { dateStyle: "medium" }) : "Saknas";
  return <Panel icon={CreditCard} title="Betalning" description="Från Stripe.">
    <dl className="grid gap-3 text-sm" data-testid="company-payment-panel">
      <div><dt className="text-xs text-muted-foreground">Status</dt><dd><PaymentStatus payment={payment} /></dd></div>
      {payment.problemOre > 0 ? <div><dt className="text-xs text-muted-foreground">Obetalt</dt><dd>{paymentSumText(payment.problemOre)}{payment.problemSince ? ` · sedan ${day(payment.problemSince)}` : ""}</dd></div> : null}
      <div><dt className="text-xs text-muted-foreground">Nästa faktura</dt><dd>{day(payment.nextInvoiceAt)}{payment.nextInvoiceOre !== null ? ` · ${paymentSumText(payment.nextInvoiceOre)}` : ""}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Senaste betalning</dt><dd>{day(payment.lastPaymentAt)}{payment.lastPaymentOre !== null ? ` · ${paymentSumText(payment.lastPaymentOre)}` : ""}</dd></div>
    </dl>
  </Panel>;
}

/** Kundföretag shown at a time on the list. */
const COMPANY_PAGE = 20;

/**
 * Händelser on a company's page: a card that folds with the arrow (2026-11-02), read when it is opened and shown once it is here
 * (useOpenWhenReady), as Statistik. `revision` moves when the page has changed something: an open card reads again, with the old rows meanwhile.
 * Administrative metadata only; the server decides who may read it.
 */
function CompanyEvents({ companyId, revision }: { companyId: string; revision: number }) {
  const [events, setEvents] = useState<CustomerAuditEvent[] | null>(null);
  const [error, setError] = useState("");
  const fold = useOpenWhenReady(Boolean(events || error), "company-events");
  const { asked } = fold;
  useEffect(() => {
    if (!asked) return;
    let active = true;
    api<{ events: CustomerAuditEvent[] }>(`/api/superadmin/customer-companies?historyFor=${encodeURIComponent(companyId)}`)
      .then((response) => { if (active) { setEvents(response.events); setError(""); } })
      .catch((cause) => { if (active) setError((cause as Error).message); });
    return () => { active = false; };
  }, [asked, revision, companyId]);
  return <Panel icon={History} title="Händelser" description="Företagets administrativa händelser." collapsible collapsed={fold.collapsed} onCollapsedChange={fold.onCollapsedChange} opening={fold.opening}>
    <div className="text-sm" data-testid="company-events">
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      {events?.length === 0 ? <p className="text-muted-foreground">Inga administrativa händelser ännu.</p> : null}
      {events?.length ? <ol className="space-y-2">
        {events.map((event) => <li key={event.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 rounded-lg bg-muted/50 px-3 py-2">
          <span>{event.label}</span><time dateTime={event.createdAt} className="text-xs text-muted-foreground">{formatSwedish(event.createdAt, { dateStyle: "medium", timeStyle: "short" })}</time>
        </li>)}
      </ol> : null}
    </div>
  </Panel>;
}

export function CustomerCompanies() {
  const [items, setItems] = useState<CustomerCompany[] | null>(null);
  const { features, operator } = useInstance();
  // Off until the server says it is on: the button never promises a mail that cannot go out.
  const [invitationDelivery, setInvitationDelivery] = useState(false);
  const [error, setError] = useState("");
  // The shared toppvisning (2026-10-31): the chip and the search follow the history entry, so Bakåt from a company shows
  // what was chosen; a company is its own page in the address (the plan's SA12), read from the same list.
  const router = useRouter();
  const companyId = useSearchParams().get("companyId");
  const native = useNativeMode();
  const prefs = useListPrefs("customer-companies", "", { sorts: COMPANY_SORTS });
  const [statusFilter, setStatusFilter] = useAddressEntryState<CompanyFilter>("customer-companies.filter", "filter", (raw) => allowedFilter(raw, COMPANY_FILTERS), "all");
  const [query, setQuery] = useEntryState("customer-companies.q", "");
  // A few at a time with Visa fler (the fold rule, 2026-11-02); the search finds the rest, and a new choice starts from the top.
  const [rows, setRows] = useState(COMPANY_PAGE);
  const listChoice = `${statusFilter}|${query}|${prefs.sort}`;
  const [seenChoice, setSeenChoice] = useState(listChoice);
  if (seenChoice !== listChoice) { setSeenChoice(listChoice); setRows(COMPANY_PAGE); }
  const [revision, setRevision] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  // Redigera on the company's page: the Företagsuppgifter card folds out into the form, Avbryt and Spara in the header (as Redigera kund).
  const [editing, setEditing] = useState(false);
  const [editActions, setEditActions] = useState<HTMLElement | null>(null);
  const [seenCompany, setSeenCompany] = useState(companyId);
  if (seenCompany !== companyId) { setSeenCompany(companyId); setEditing(false); }
  const [creditCompany, setCreditCompany] = useState<CustomerCompany | null>(null);
  const [creditForm, setCreditForm] = useState({ expiryEnabled: true, expiryDate: "" });
  const [grantCompany, setGrantCompany] = useState<{ id: string; name: string } | null>(null);
  const [grantForm, setGrantForm] = useState({ credits: "100", reason: "" });
  const [eraseTarget, setEraseTarget] = useState<{ id: string; name: string } | null>(null);
  const [eraseName, setEraseName] = useState("");
  const [ownerCompany, setOwnerCompany] = useState<CustomerCompany | null>(null);
  const [ownerForm, setOwnerForm] = useState({ name: "", email: "" });
  const [form, setForm] = useState<{ details: CompanyDetailsValue; ownerName: string; ownerEmail: string }>({ details: blankCompanyDetails, ownerName: "", ownerEmail: "" });
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmCard, confirmElement] = useConfirm();
  const companyName = companyId ? items?.find((company) => company.id === companyId)?.name : undefined;
  const [notice, setNotice] = useState("");
  usePageTrail(companyName ? { company: companyName } : {}, companyId ? { companyId } : {});
  useEffect(() => {
    let active = true;
    void api<{ organizations: CustomerCompany[]; invitationDelivery?: boolean }>(
      "/api/superadmin/customer-companies",
    ).then(
      (response) => { if (active) { setItems(response.organizations); setInvitationDelivery(Boolean(response.invitationDelivery)); } },
      (cause: unknown) => { if (active) setError((cause as Error).message); },
    );
    return () => { active = false; };
  }, [revision]);

  const listed = items ? listCustomerCompanies(items, { filter: statusFilter, sort: prefs.sort, q: query }) : null;
  const item = companyId ? items?.find((company) => company.id === companyId) ?? null : null;
  const openHref = (id: string) => `/?view=customer_companies&companyId=${encodeURIComponent(id)}`;
  const setCompanyActive = async (company: CustomerCompany, isActive: boolean) => {
    if (!isActive && !(await confirmCard({ title: "Pausa företaget?", message: `${company.name} kan läsa och exportera men inte ändra något. API-nycklar och maskinkopplingar stoppas.`, confirmLabel: "Pausa" }))) return;
    setBusy(true); setError("");
    try {
      await api("/api/superadmin/customer-companies", { method: "PATCH", body: JSON.stringify({ action: "set_active", organizationId: company.id, isActive }) });
      setNotice(isActive ? `${company.name} är återaktiverat.` : `${company.name} är pausat.`);
      setRevision((value) => value + 1);
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  };
  const usersText = (company: CustomerCompany) => `${company.memberCount} användare${company.invitationCount ? ` · ${company.invitationCount} inbjudna` : ""}`;
  /** Återkalla: a sent invitation's link stops working at once, and a new one can then be prepared with the right address. */
  async function revokeOwnerInvitation(company: CustomerCompany, sent: boolean) {
    if (!(await confirmCard({ title: "Återkalla admininbjudan?", message: sent ? `Länken i e-postmeddelandet till ${company.preparedOwnerEmail ?? ""} slutar gälla direkt. Sedan kan du förbereda en ny inbjudan.` : `Den förberedda admininbjudan för ${company.name} återkallas. Ingen e-post skickas.`, confirmLabel: "Återkalla", tone: "danger" }))) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/superadmin/customer-companies", { method: "PATCH", body: JSON.stringify({ action: "revoke_owner", organizationId: company.id }) });
      setNotice(sent ? "Inbjudan är återkallad. Länken i e-postmeddelandet gäller inte längre." : "Den vilande admininbjudan har återkallats. Ingen e-post skickades.");
      setRevision((value) => value + 1);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  /** Skicka admininbjudan: the server decides again whether it may go out, inside the invitation's row lock. */
  async function sendOwnerInvitation(company: CustomerCompany, resend: boolean) {
    const email = company.preparedOwnerEmail ?? "";
    if (!(await confirmCard({ title: resend ? "Skicka inbjudan igen?" : "Skicka inbjudan?", message: resend ? `En ny inbjudan skickas till ${email}. Den tidigare länken slutar gälla.` : `En inbjudan skickas till ${email} med en länk för att bli administratör i ${company.name}.`, confirmLabel: resend ? "Skicka igen" : "Skicka" }))) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/superadmin/customer-companies", { method: "PATCH", body: JSON.stringify({ action: "send_owner", organizationId: company.id, resend }) });
      setNotice(`Inbjudan är skickad till ${email}.`);
      setRevision((value) => value + 1);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  const subline = (company: CustomerCompany) => `${company.organizationNumber || (company.companyType === "soleTrader" ? "Personnr saknas" : "Org.nr saknas")} · ${company.storageMode === "LOCAL" ? "Lokal" : features.billing ? "Cloud" : "Server"}`;

  return (
    <div className="space-y-6">
      {confirmElement}
      {companyId ? <PageHeader title={item?.name ?? "Kundföretag"} description={item ? subline(item) : undefined} actionsSlotRef={editing ? setEditActions : undefined} actions={item && !editing ? <>
                <Button type="button" variant="outline" aria-expanded={false} data-testid="company-edit-button" onClick={() => { setEditing(true); setFormError(""); }}><Pencil />Redigera</Button>
                {features.credits ? <><Button type="button" variant="outline" onClick={() => {
                  setCreditCompany(item);
                  setCreditForm({ expiryEnabled: item.creditExpiryEnabled, expiryDate: item.creditExpiryOverrideAt?.slice(0, 10) ?? "" });
                  setFormError("");
                }}>Kreditregel</Button>
                <Button type="button" variant="outline" onClick={() => { setGrantCompany({ id: item.id, name: item.name }); setGrantForm({ credits: "100", reason: "" }); setFormError(""); }}><Coins />Ge krediter</Button></> : null}
                <Button type="button" variant="outline" disabled={busy} data-testid="company-pause" onClick={() => void setCompanyActive(item, !item.isActive)}>{item.isActive ? <><Pause />Pausa</> : <><Play />Återaktivera</>}</Button>
        </> : undefined}>
        {item ? <div className="mt-3"><CompanyStatus active={item.isActive} /></div> : null}
      </PageHeader> : <PageHeader title="Kundföretag" description={features.billing ? "Kundföretag, abonnemang och krediter." : "Företagen i installationen."} actions={<>
          {features.credits ? <Button type="button" variant="outline" onClick={() => { setGrantCompany({ id: "self", name: "ditt eget företag" }); setGrantForm({ credits: "100", reason: "" }); setFormError(""); }}><Coins /> Ge krediter till det egna företaget</Button> : null}
          <Button onClick={() => setCreateOpen(true)}><Plus /> Förbered företag</Button>
        </>} />}
      {notice ? <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p> : null}
      {error ? <p role="alert" className="notice text-destructive">{error}</p> : null}
      {!items && !error ? <p className="page-description">Hämtar kundföretag…</p> : null}
      {companyId && items && !item ? <Empty title="Företaget finns inte" description="Det kan vara raderat. Gå tillbaka till listan." /> : null}
      {/* The company's own page (the plan's SA12): administrative cards, never its work; Radera last, in its danger zone. */}
      {item ? <>
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2 [&>*]:min-w-0" data-testid="company-page">
          <Panel icon={Building2} title="Företagsuppgifter" description="Administrativa uppgifter och antal, inte verksamhetsinnehåll." className="lg:col-span-2">
            {editing ? <PageActionsSlotProvider slot={editActions}><CustomerCompanyInlineEdit key={item.id} company={item} billing={features.billing} onClose={() => setEditing(false)} onSaved={() => { setNotice("Kundföretagets uppgifter är sparade."); setRevision((value) => value + 1); }} /></PageActionsSlotProvider> : <>
            <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3" data-testid="company-details-read">
                <div><dt className="text-xs text-muted-foreground">{item.companyType === "soleTrader" ? "Personnummer" : "Organisationsnummer"}</dt><dd>{item.organizationNumber || "Saknas"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Momsregistreringsnummer</dt><dd>{item.vatNumber || "Saknas"}{item.fSkatt ? " · F-skatt" : ""}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Adress</dt><dd className="break-words">{[item.address, [item.postalCode, item.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "Saknas"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Säte</dt><dd>{item.registeredOffice || "Saknas"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Bankgiro / plusgiro</dt><dd>{[item.bankgiro, item.plusgiro].filter(Boolean).join(" / ") || "Saknas"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Kontakt</dt><dd className="break-all">{[item.contactName, item.contactEmail, item.phone].filter(Boolean).join(" · ") || "Saknas"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Företagsadmin</dt><dd className="break-all">{item.administrators.length ? item.administrators.map((admin) => admin.name || admin.email).join(", ") : (item.preparedOwnerEmail ? (item.ownerInvitationStatus === "PENDING" ? "Inbjudan skickad" : "Inbjudan förberedd") + ": " + item.preparedOwnerEmail : "Saknas")}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Användare / inbjudningar</dt><dd>{item.memberCount} / {item.invitationCount}</dd></div>
                {features.credits ? <div><dt className="text-xs text-muted-foreground">Kreditsaldo</dt><dd>{item.creditBalance} totalt · {item.purchasedCreditBalance} köpta</dd></div> : null}
                <div><dt className="text-xs text-muted-foreground">Kunder / uppgifter</dt><dd>{item.storageMode === "LOCAL" ? "I den egna filen" : item.customerCount + " / " + item.controlCount}</dd></div>
                {features.billing ? <div><dt className="text-xs text-muted-foreground">Faktura-e-post</dt><dd className="break-all">{item.billingEmail || "Saknas"}</dd></div> : null}
                <div><dt className="text-xs text-muted-foreground">Lagring</dt><dd>{item.storageMode === "LOCAL" ? "Lokal lagring" : features.billing ? "serverlagring" : "Lagring på servern"}</dd></div>
              </dl>
              <CompanyGapsNote gaps={item.documentGaps ?? []} testId="company-gaps" className="mt-4" />
            </>}
          </Panel>
          {item.payment ? <PaymentPanel payment={item.payment} /> : null}
          {/* Workflow AI per företag (2026-11-21): the weekly quota, this week's use and the last weeks, as metadata. */}
          {features.credits && item.storageMode !== "LOCAL" ? <AiUsagePanel key={`ai-${item.id}`} mode="superadmin" organizationId={item.id} notify={(text) => setNotice(text)} /> : null}
          <Panel icon={ScrollText} title="Registrering och villkor">
            <div className="grid gap-3 text-sm" data-testid="company-registration">
                <div><p className="text-xs text-muted-foreground">Skapades</p><p>{formatSwedish(item.registration?.at ?? item.createdAt ?? new Date().toISOString(), { dateStyle: "medium", timeStyle: "short" })} · {item.registration ? "av kunden själv" : `av ${operator}`}</p>{item.registration ? <p className="mt-1 text-xs text-muted-foreground">{item.registration.detail}</p> : null}</div>
                <div><p className="text-xs text-muted-foreground">Godkända villkor</p>{item.acceptances?.length ? <ul className="mt-1 space-y-0.5 text-xs">{item.acceptances.map((acceptance) => <li key={`${acceptance.title}-${acceptance.version}-${acceptance.by}`}>{acceptance.title} version {acceptance.version} – {acceptance.by}, {formatSwedish(acceptance.acceptedAt, { dateStyle: "short", timeStyle: "short" })}</li>)}</ul> : <p className="text-xs text-muted-foreground">Inga godkännanden ännu.</p>}</div>
              </div>
          </Panel>
          <CompanyEvents key={item.id} companyId={item.id} revision={revision} />
          {!item.owner && item.ownerInvitationStatus === "PENDING" ? <Panel icon={ShieldCheck} title="Admininbjudan" description={`Skickad till ${item.preparedOwnerEmail ?? ""}${item.ownerInvitationSentAt ? `, ${formatSwedish(item.ownerInvitationSentAt, { dateStyle: "medium", timeStyle: "short" })}` : ""}.`}>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={busy || !invitationDelivery} data-testid="company-owner-resend" onClick={() => void sendOwnerInvitation(item, true)}>Skicka igen</Button>
              <Button type="button" variant="destructive" className="w-full sm:w-auto" disabled={busy} data-testid="company-owner-revoke" onClick={() => void revokeOwnerInvitation(item, true)}>Återkalla inbjudan</Button>
            </div>
            {invitationDelivery ? null : <p className="mt-2 text-xs text-muted-foreground" data-testid="company-owner-delivery-off">Inbjudningar via e-post slås på under Installation → Drift och säkerhet.</p>}
          </Panel> : null}
          {!item.owner && item.ownerInvitationStatus !== "PENDING" ? <Panel icon={ShieldCheck} title="Admininbjudan" description={item.preparedOwnerEmail ? "Förberedd. Ingen e-post har skickats." : "Sparas utan att skickas."}><div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {item.preparedOwnerEmail ? <Button type="button" className="w-full sm:w-auto" disabled={busy || !invitationDelivery} data-testid="company-owner-send" onClick={() => void sendOwnerInvitation(item, false)}>Skicka inbjudan</Button> : null}
                <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => {
                  setOwnerCompany(item);
                  setOwnerForm({ name: item.preparedOwnerName || item.contactName, email: item.preparedOwnerEmail || item.contactEmail });
                  setFormError("");
                  setOwnerOpen(true);
                }}>{item.preparedOwnerEmail ? "Ändra admininbjudan" : "Förbered admininbjudan"}</Button>
                {item.preparedOwnerEmail ? <Button type="button" variant="destructive" className="w-full sm:w-auto" disabled={busy} onClick={() => void revokeOwnerInvitation(item, false)}>Återkalla inbjudan</Button> : null}
          </div>{item.preparedOwnerEmail && !invitationDelivery ? <p className="mt-2 text-xs text-muted-foreground" data-testid="company-owner-delivery-off">Inbjudningar via e-post slås på under Installation → Drift och säkerhet.</p> : null}</Panel> : null}
        </div>
        <div className="rounded-lg border border-destructive/40 p-3" data-testid="company-danger-zone">
                <p className="text-xs font-semibold uppercase tracking-wide text-destructive">Farozon</p>
                <p className="mt-1 text-xs text-muted-foreground">Raderar företaget och dess data för gott. Du får skriva företagets namn för att bekräfta.</p>
                <Button type="button" variant="outline" className="mt-2 w-full text-destructive sm:w-auto" onClick={() => { setEraseTarget({ id: item.id, name: item.name }); setEraseName(""); setFormError(""); }}><UserX />Radera företaget</Button>
              </div>
      </> : null}
      {!companyId ? <>
        <div className="notice flex gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0" />
          <p>Förbered ett företag och dess första administratör. Inbjudan skickas först när du väljer det.</p>
        </div>
        <ListFilterBar testId="customer-companies" label="Sök och filtrera kundföretag"
          chips={{ label: "Status", chips: COMPANY_FILTERS.map((value) => ({ value, label: COMPANY_FILTER_LABEL[value], count: listed?.counts[value] ?? null })), value: statusFilter, onChange: setStatusFilter, testId: "customer-companies-filter" }}
          search={{ label: "Sök kundföretag", placeholder: "Namn, org.nr eller kontakt", value: query, onChange: setQuery, testId: "customer-companies-search" }}
          sort={native ? undefined : { value: prefs.sort, options: SORT_OPTIONS, onChange: prefs.setSort }}
          view={native ? undefined : { value: prefs.view, onChange: prefs.setView }} />
        {listed && !listed.items.length ? <Empty title="Inga kundföretag" description={query || statusFilter !== "all" ? "Inga företag matchar urvalet." : "Inga företag ännu."} /> : null}
        {listed?.items.length ? native
          ? <ListGroup testId="customer-companies-list">{listed.items.slice(0, rows).map((company) => <ListRow key={company.id} type="neutral" icon={Building2} title={company.name} twoLines href={openHref(company.id)} testId="customer-company-row"
            subtitle={[subline(company), usersText(company), ...(company.payment ? [COMPANY_PAYMENT_LABEL[company.payment.status]] : [])].join(" · ")} pill={{ label: company.isActive ? "Aktivt" : "Pausat", tone: company.isActive ? "success" : "neutral" }} />)}</ListGroup>
          : prefs.view === "cards"
            ? <ListCardGrid testId="customer-companies-list">{listed.items.slice(0, rows).map((company) => <ListCard key={company.id} testId="customer-company-row" href={openHref(company.id)}
              icon={<AreaIcon area="admin" icon={Building2} />} title={company.name} subtitle={subline(company)} badges={<><CompanyStatus active={company.isActive} /><PaymentStatus payment={company.payment} /></>}
              facts={[
                { icon: Users, label: "Användare", value: usersText(company) },
                features.credits ? { icon: Coins, label: "Krediter", value: `${company.creditBalance} krediter` } : null,
                company.storageMode === "LOCAL" ? null : { icon: ClipboardList, label: "Kunder och uppgifter", value: `${company.customerCount} kunder · ${company.controlCount} uppgifter` },
              ]} />)}</ListCardGrid>
            : <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs" data-testid="customer-companies-list">{listed.items.slice(0, rows).map((company) => <li key={company.id} data-testid="customer-company-row"><Link href={openHref(company.id)} className="tap-card flex min-h-14 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 outline-none hover:bg-secondary/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              <AreaIcon area="admin" icon={Building2} />
              <span className="min-w-0 flex-1 basis-48"><span className="block truncate text-sm font-semibold">{company.name}</span><span className="block truncate text-xs text-muted-foreground">{subline(company)}</span></span>
              <CompanyStatus active={company.isActive} />
              {company.payment ? <span className="w-24 shrink-0 max-md:w-auto"><PaymentStatus payment={company.payment} /></span> : null}
              <span className="w-32 shrink-0 text-xs tabular-nums text-muted-foreground max-md:w-auto">{usersText(company)}</span>
              {features.credits ? <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground max-md:w-auto">{company.creditBalance} krediter</span> : null}
              <RowChevron />
            </Link></li>)}</ul> : null}
      {listed ? <ShowMore shown={Math.min(rows, listed.items.length)} total={listed.items.length} onMore={() => setRows((value) => value + COMPANY_PAGE)} testId="customer-companies-more" /> : null}
      {/* C6 (2026-10-21): the rarely used parts under Avancerat at the foot of the page. */}
      <AdvancedFold summary="Radering efter avslut och personalliggare på begäran." testId="customer-companies-advanced">
        <CompanyClosurePanel />
        <StaffRegisterDisclosure />
        {CustomerInvoiceDisclosure ? <CustomerInvoiceDisclosure /> : null}
      </AdvancedFold>
      </> : null}

      <Modal open={Boolean(creditCompany)} onOpenChange={(open) => { if (!open) setCreditCompany(null); }} title="Kundföretagets kreditregel" size="form">
        <p className="mb-5 text-sm text-muted-foreground">Ett eget förfallodatum för köpta krediter. Normalt gäller de ett år från senaste köp.</p>
        <form className="space-y-4" onSubmit={async (event) => {
          event.preventDefault();
          if (!creditCompany) return;
          setBusy(true);
          setFormError("");
          try {
            await api("/api/superadmin/customer-companies", { method: "PATCH", body: JSON.stringify({
              action: "update_credit_policy", organizationId: creditCompany.id,
              expiryEnabled: creditForm.expiryEnabled,
              expiryOverrideAt: creditForm.expiryDate ? `${creditForm.expiryDate}T23:59:59.999Z` : null,
            }) });
            setCreditCompany(null);
            setNotice("Kreditregeln är sparad och loggad. Köpflödet är fortsatt avstängt.");
            setRevision((value) => value + 1);
          } catch (cause) { setFormError((cause as Error).message); }
          finally { setBusy(false); }
        }}>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={creditForm.expiryEnabled} onChange={(event) => setCreditForm({ ...creditForm, expiryEnabled: event.target.checked })} /> Köpta krediter får gå ut</label>
          <div><label htmlFor="credit-expiry-override" className="mb-2 block text-xs font-medium">Individuellt slutdatum (valfritt)</label><Input id="credit-expiry-override" type="date" value={creditForm.expiryDate} onChange={(event) => setCreditForm({ ...creditForm, expiryDate: event.target.value })} /><p className="mt-1 text-xs text-muted-foreground">Datumet ligger kvar tills du ändrar eller tar bort det.</p></div>
          {formError ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}
          <Button busy={busy} busyLabel="Sparar…">Spara kreditregel</Button>
        </form>
      </Modal>
      <Modal open={Boolean(grantCompany)} onOpenChange={(open) => { if (!open) setGrantCompany(null); }} title="Ge krediter" size="form">
        <p className="mb-5 text-sm text-muted-foreground">Kompensationskrediter till {grantCompany?.name}, utan köp. De gäller ett år, används före köpta krediter och loggas med orsak. AI kräver att företaget har Cloud.</p>
        <form className="space-y-4" onSubmit={async (event) => {
          event.preventDefault();
          if (!grantCompany) return;
          setBusy(true);
          setFormError("");
          try {
            const result = await api<{ cloud: boolean }>("/api/superadmin/customer-companies", { method: "PATCH", body: JSON.stringify({
              action: "grant_credits", organizationId: grantCompany.id, credits: Number(grantForm.credits), reason: grantForm.reason, requestKey: crypto.randomUUID(),
            }) });
            setNotice(`${grantForm.credits} krediter är tilldelade ${grantCompany.name}.${result.cloud ? "" : " Företaget är i Local – krediterna kan användas när det har Cloud."}`);
            setGrantCompany(null);
            setRevision((value) => value + 1);
          } catch (cause) { setFormError((cause as Error).message); }
          finally { setBusy(false); }
        }}>
          <div><label htmlFor="grant-credits" className="mb-2 block text-xs font-medium">Antal krediter</label><Input id="grant-credits" type="number" min={1} max={10000} required value={grantForm.credits} onChange={(event) => setGrantForm({ ...grantForm, credits: event.target.value })} /></div>
          <div><label htmlFor="grant-reason" className="mb-2 block text-xs font-medium">Orsak</label><Input id="grant-reason" required minLength={3} maxLength={300} placeholder="Till exempel Prov av Workflow AI" value={grantForm.reason} onChange={(event) => setGrantForm({ ...grantForm, reason: event.target.value })} /></div>
          {formError ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}
          <Button busy={busy} busyLabel="Ger krediter…"><Coins />Ge krediter</Button>
        </form>
      </Modal>
      <Modal open={Boolean(eraseTarget)} onOpenChange={(open) => { if (!open && !busy) setEraseTarget(null); }} title="Radera företaget?" size="compact">
        {/* Radera ett helt kundföretag (2026-10-03, GDPR): work data, files and personal data go; accounting stays. */}
        <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Kunder, projekt, uppgifter, kontroller, filer, formulär, AI-konversationer, inställningar och historik raderas.</li>
          <li>Medlemmar som inte finns i något annat företag anonymiseras. Övriga förlorar bara medlemskapet.</li>
          <li>{features.billing ? "Fakturor, betalningar, krediter och AI-användning sparas som bokföringsunderlag så länge lagen kräver." : "Uppgifter om AI-användning och godkända villkor sparas."}</li>
          <li>Backuper på servern innehåller företaget tills de har roterats bort.</li>
        </ul>
        <form className="space-y-4" onSubmit={async (event) => {
          event.preventDefault();
          if (!eraseTarget) return;
          setBusy(true); setFormError("");
          try {
            const result = await api<{ records: number; people: number; files: number }>("/api/erasure", { method: "POST", body: JSON.stringify({ action: "company", organizationId: eraseTarget.id, confirmName: eraseName }) });
            setNotice(`${eraseTarget.name} är raderat: ${result.records} poster, ${result.files} filer och ${result.people} personer.`);
            setEraseTarget(null); router.replace("/?view=customer_companies", { scroll: false }); setRevision((value) => value + 1);
          } catch (cause) { setFormError((cause as Error).message); } finally { setBusy(false); }
        }}>
          <div><label htmlFor="erase-company-name" className="mb-2 block text-xs font-medium">Skriv företagets namn: {eraseTarget?.name}</label><Input id="erase-company-name" value={eraseName} onChange={(event) => setEraseName(event.target.value)} autoComplete="off" /></div>
          {formError ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}
          <Button variant="destructive" disabled={busy || eraseName !== eraseTarget?.name} busy={busy} busyLabel="Raderar…"><UserX />Radera företaget</Button>
        </form>
      </Modal>
      {/* A page like Ny kund (the form's size decides: a popup on a computer, a page on a tablet, a screen on a phone). 2026-11-04. */}
      <DialogPage open={createOpen} onOpenChange={setCreateOpen} pageKey="nytt-kundforetag" title="Förbered kundföretag" panelTitle="Kundföretag" size="form"
        description={`Företaget får ${features.billing ? "lokal lagring" : "lagring på servern"} från start. Inbjudan sparas utan att skickas. Du blir inte medlem i företaget.`}>
        <form className="space-y-4" noValidate onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setFormError("");
          try {
            const { details } = form;
            await api("/api/superadmin/customer-companies", { method: "POST", body: JSON.stringify({ name: details.name, organizationNumber: details.organizationNumber, ownerName: form.ownerName, ownerEmail: form.ownerEmail,
              ...(details.address.trim() ? { address: details.address } : {}), ...(details.postalCode.trim() ? { postalCode: details.postalCode } : {}), ...(details.city.trim() ? { city: details.city } : {}) }) });
            setCreateOpen(false);
            setForm({ details: blankCompanyDetails, ownerName: "", ownerEmail: "" });
            setNotice("Kundföretaget och admininbjudan är förberedda. Ingen e-post har skickats.");
            setRevision((value) => value + 1);
          } catch (cause) {
            setFormError((cause as Error).message);
          } finally {
            setBusy(false);
          }
        }}>
          {/* The number first: SCB fills in the name and the address (2026-10-07); säte, bankgiro and the rest the company adds in Kom igång. */}
          <CompanyDetailsFields idPrefix="prepared-company" typeChoice={false} groups={["company", "address"]} value={form.details} onChange={(details) => setForm((current) => ({ ...current, details }))} className="sm:grid-cols-1" />
          <Field id="prepared-owner-name" label="Administratörens namn" value={form.ownerName} onChange={(ownerName) => setForm((current) => ({ ...current, ownerName }))} required />
          <Field id="prepared-owner-email" label="Administratörens e-post" type="email" value={form.ownerEmail} onChange={(ownerEmail) => setForm((current) => ({ ...current, ownerEmail }))} required />
          {formError ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}
          <DialogActions cancel={{ onClick: () => setCreateOpen(false) }} primary={{ label: "Förbered utan utskick", type: "submit", busy, busyLabel: "Förbereder…" }} />
        </form>
      </DialogPage>
      <Modal open={ownerOpen} onOpenChange={setOwnerOpen} title="Förbered admininbjudan" size="form">
        <p className="mb-5 text-sm text-muted-foreground">{ownerCompany?.name}. Inbjudan sparas utan att skickas och kan ändras eller återkallas. Du skickar den från företagets sida.</p>
        <form className="space-y-4" onSubmit={async (event) => {
          event.preventDefault();
          if (!ownerCompany) return;
          setBusy(true);
          setFormError("");
          try {
            await api("/api/superadmin/customer-companies", { method: "PATCH", body: JSON.stringify({ action: "prepare_owner", organizationId: ownerCompany.id, ...ownerForm }) });
            setOwnerOpen(false);
            setNotice("Admininbjudan är förberedd. Ingen e-post har skickats.");
            setRevision((value) => value + 1);
          } catch (cause) { setFormError((cause as Error).message); }
          finally { setBusy(false); }
        }}>
          <div><label htmlFor="owner-invitation-name" className="mb-2 block text-xs font-medium">Administratörens namn</label><Input id="owner-invitation-name" value={ownerForm.name} onChange={(event) => setOwnerForm({ ...ownerForm, name: event.target.value })} required minLength={2} /></div>
          <div><label htmlFor="owner-invitation-email" className="mb-2 block text-xs font-medium">Administratörens e-post</label><Input id="owner-invitation-email" type="email" value={ownerForm.email} onChange={(event) => setOwnerForm({ ...ownerForm, email: event.target.value })} required /></div>
          {formError ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}
          <Button className="w-full sm:w-auto" busy={busy} busyLabel="Sparar…">Spara utan utskick</Button>
        </form>
      </Modal>
    </div>
  );
}

/**
 * Testa betalningsflöde i sandbox (moved from Kundföretag to Installation → Tjänster och verktyg,
 * 2026-10-09 natt; beside the Stripe key under Tjänster och nycklar since 2026-10-15): the billing page of the isolated synthetic test company, read-only, in Stripe's sandbox. The view
 * opens no customer's work; the server decides who may read it.
 */
export function SandboxBillingPanel({ bare = false }: { bare?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  if (!BillingRead) return null;
  // bare: under Mer on Stripe's card (2026-11-01), a rare test and not a card of its own.
  const frame = (content: React.ReactNode) => bare ? <>{content}</> : <Panel title="Test av betalningar" description="Stripes sandbox med ett syntetiskt testföretag. Inga riktiga pengar." icon={ShieldCheck}>{content}</Panel>;
  return frame(<>
    <Button type="button" variant="outline" onClick={() => setOpen(true)} data-testid="sandbox-billing-open"><ShieldCheck /> Testa betalningsflöde i sandbox</Button>
    <DialogPage pageKey="stripe-sandbox" size="page" width="wide" panelTitle={false} open={open} onOpenChange={setOpen} title="Stripe sandbox – syntetiskt testföretag">
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="status">
        <strong>STRIPE SANDBOX – inga riktiga pengar.</strong> Vyn använder endast ett isolerat testföretag i kfid_v3_test och öppnar inga kundkontroller eller bilagor.
      </div>
      {open ? <BillingRead endpoint="/api/billing?mode=sandbox-qa" sandboxQa /> : null}
    </DialogPage>
  </>);
}
