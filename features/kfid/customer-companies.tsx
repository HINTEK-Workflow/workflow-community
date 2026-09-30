"use client";

import { useEffect, useState } from "react";
import { formatSwedish } from "@/lib/swedish-time";
import { Building2, ChevronDown, Plus, Search, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, Empty, Modal } from "./ui";
import { api } from "./api";
import { clientExtensions } from "@ee/client";
import { useConfirm } from "./confirm";
// HINTEK's commercial views live in ee/ (Fas 2); without it they are null.
const { BillingRead, PricingAdministration, ProviderAdministration, AiUsageAdministration } = clientExtensions;

type CustomerCompany = {
  id: string;
  name: string;
  isActive: boolean;
  storageMode: "LOCAL" | "HINTEK_CLOUD";
  organizationNumber: string;
  contactName: string;
  contactEmail: string;
  billingEmail: string;
  city: string;
  owner: { name: string | null; email: string } | null;
  administrators: { name: string | null; email: string }[];
  preparedOwnerEmail: string | null;
  preparedOwnerName: string | null;
  ownerInvitationStatus: "PREPARED" | "PENDING" | null;
  memberCount: number;
  invitationCount: number;
  customerCount: number;
  controlCount: number;
  creditBalance: number;
  purchasedCreditBalance: number;
  creditExpiryEnabled: boolean;
  creditExpiryOverrideAt: string | null;
};

type CustomerAuditEvent = { id: string; label: string; createdAt: string };

export function CustomerCompanies() {
  const [items, setItems] = useState<CustomerCompany[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null);
  const [historyByCompany, setHistoryByCompany] = useState<Record<string, CustomerAuditEvent[]>>({});
  const [historyLoadingId, setHistoryLoadingId] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [revision, setRevision] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [sandboxBillingOpen, setSandboxBillingOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [settingsCompany, setSettingsCompany] = useState<CustomerCompany | null>(null);
  const [creditCompany, setCreditCompany] = useState<CustomerCompany | null>(null);
  const [creditForm, setCreditForm] = useState({ expiryEnabled: true, expiryDate: "" });
  const [settingsForm, setSettingsForm] = useState({ name: "", isActive: true, storageMode: "LOCAL" as "LOCAL" | "HINTEK_CLOUD", contactEmail: "", billingEmail: "" });
  const [ownerCompany, setOwnerCompany] = useState<CustomerCompany | null>(null);
  const [ownerForm, setOwnerForm] = useState({ name: "", email: "" });
  const [form, setForm] = useState({ name: "", organizationNumber: "", ownerName: "", ownerEmail: "" });
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmCard, confirmElement] = useConfirm();
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    void api<{ organizations: CustomerCompany[] }>(
      "/api/superadmin/customer-companies",
    ).then(
      (response) => { if (active) setItems(response.organizations); },
      (cause: unknown) => { if (active) setError((cause as Error).message); },
    );
    return () => { active = false; };
  }, [revision]);

  const filtered = items?.filter((item) =>
    [item.name, item.organizationNumber, item.contactName, item.contactEmail]
      .some((value) => value.toLocaleLowerCase("sv-SE").includes(query.toLocaleLowerCase("sv-SE"))),
  );

  return (
    <div className="space-y-6">
      {confirmElement}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Superadmin</p>
          <h1 className="page-title mt-2">Produktadministration</h1>
          <p className="page-description mt-2">Kundföretag och centrala priser. Dina egna kontroller hanteras i din HINTEK-arbetsyta; kundföretagens kontrollinnehåll visas inte här.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setSandboxBillingOpen(true)}><ShieldCheck /> Testa betalningsflöde i sandbox</Button>
          <Button onClick={() => setCreateOpen(true)}><Plus /> Förbered företag</Button>
        </div>
      </div>
      <div className="notice flex gap-3">
        <ShieldCheck className="mt-0.5 size-5 shrink-0" />
        <p>Den här vyn är endast tillgänglig för produktadministratör. Du kan förbereda ett företag och dess första företagsadmin utan att bli medlem i kundföretaget. Inbjudningsmejl är avstängda.</p>
      </div>
      {PricingAdministration ? <PricingAdministration notify={(message, isError) => { setNotice(isError ? `Fel: ${message}` : message); }} /> : null}
      {ProviderAdministration ? <ProviderAdministration /> : null}
      {AiUsageAdministration ? <AiUsageAdministration /> : null}
      {notice ? <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p> : null}
      <Panel title="Företagsöversikt" description="Administrativa uppgifter och antal, inte verksamhetsinnehåll.">
        <label htmlFor="customer-company-search" className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground"><Search className="size-4" /> Sök kundföretag</label>
        <Input id="customer-company-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Namn, org.nr eller kontakt" className="mb-5" />
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {!items && !error ? <p className="page-description">Hämtar kundföretag…</p> : null}
        {filtered?.length === 0 ? <Empty title="Inga kundföretag" description="Inga företag matchar sökningen." /> : null}
        <div className="space-y-3">
          {filtered?.map((item) => (
            <article key={item.id} className="rounded-xl border p-4">
              <button type="button" className="flex w-full items-start justify-between gap-3 text-left" aria-expanded={expandedId === item.id} aria-controls={`customer-company-${item.id}`} onClick={() => {
                setExpandedId((current) => current === item.id ? null : item.id);
                setHistoryOpenId(null);
              }}>
                <span className="min-w-0">
                  <span className="flex items-center gap-2"><Building2 className="size-4 shrink-0 text-primary" /><span className="break-words text-sm font-semibold">{item.name}</span></span>
                  <span className="mt-1 block text-xs text-muted-foreground">{item.organizationNumber || "Org.nr saknas"} · {item.isActive ? "Aktivt" : "Pausat"} · {item.storageMode === "LOCAL" ? "Lokal" : "Cloud"}</span>
                </span>
                <ChevronDown className={`mt-1 size-4 shrink-0 text-muted-foreground transition-transform ${expandedId === item.id ? "rotate-180" : ""}`} />
              </button>
              {expandedId === item.id ? <div id={`customer-company-${item.id}`} className="mt-4 border-t pt-4"><dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="text-xs text-muted-foreground">Företagsadmin</dt><dd className="break-all">{item.administrators.length ? item.administrators.map((admin) => admin.name || admin.email).join(", ") : (item.preparedOwnerEmail ? `${item.ownerInvitationStatus === "PENDING" ? "Inbjudan skickad" : "Inbjudan förberedd"}: ${item.preparedOwnerEmail}` : "Saknas")}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Kontakt</dt><dd className="break-all">{item.contactName || item.contactEmail || "Saknas"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Användare / inbjudningar</dt><dd>{item.memberCount} / {item.invitationCount}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Kreditsaldo</dt><dd>{item.creditBalance} totalt · {item.purchasedCreditBalance} köpta</dd></div>
                <div><dt className="text-xs text-muted-foreground">Kunder / kontroller</dt><dd>{item.customerCount} / {item.controlCount}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Faktura-e-post</dt><dd className="break-all">{item.billingEmail || "Saknas"}</dd></div>
              </dl>
              <div className="mt-4 border-t pt-4">
                <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => {
                  setSettingsCompany(item);
                  setSettingsForm({ name: item.name, isActive: item.isActive, storageMode: item.storageMode, contactEmail: item.contactEmail, billingEmail: item.billingEmail });
                  setFormError("");
                }}>Företagsinställningar</Button>
                <Button type="button" variant="outline" className="ml-2 w-full sm:w-auto" onClick={() => {
                  setCreditCompany(item);
                  setCreditForm({ expiryEnabled: item.creditExpiryEnabled, expiryDate: item.creditExpiryOverrideAt?.slice(0, 10) ?? "" });
                  setFormError("");
                }}>Kreditregel</Button>
              </div>
              {!item.owner && item.ownerInvitationStatus !== "PENDING" ? <div className="mt-4 flex flex-col gap-2 border-t pt-4 sm:flex-row">
                <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => {
                  setOwnerCompany(item);
                  setOwnerForm({ name: item.preparedOwnerName || item.contactName, email: item.preparedOwnerEmail || item.contactEmail });
                  setFormError("");
                  setOwnerOpen(true);
                }}>{item.preparedOwnerEmail ? "Ändra admininbjudan" : "Förbered admininbjudan"}</Button>
                {item.preparedOwnerEmail ? <Button type="button" variant="destructive" className="w-full sm:w-auto" disabled={busy} onClick={async () => {
                  if (!(await confirmCard({ title: "Återkalla admininbjudan?", message: `Den förberedda admininbjudan för ${item.name} återkallas. Inget mejl skickas.`, confirmLabel: "Återkalla", tone: "danger" }))) return;
                  setBusy(true);
                  try {
                    await api("/api/superadmin/customer-companies", { method: "PATCH", body: JSON.stringify({ action: "revoke_owner", organizationId: item.id }) });
                    setNotice("Den vilande admininbjudan har återkallats. Inget mejl skickades.");
                    setHistoryByCompany({});
                    setRevision((value) => value + 1);
                  } catch (cause) { setError((cause as Error).message); }
                  finally { setBusy(false); }
                }}>Återkalla inbjudan</Button> : null}
              </div> : null}
              <div className="mt-4 border-t pt-4">
                <Button type="button" variant="outline" className="w-full sm:w-auto" aria-expanded={historyOpenId === item.id} onClick={async () => {
                  if (historyOpenId === item.id) { setHistoryOpenId(null); return; }
                  setHistoryOpenId(item.id);
                  setHistoryError("");
                  if (historyByCompany[item.id]) return;
                  setHistoryLoadingId(item.id);
                  try {
                    const response = await api<{ events: CustomerAuditEvent[] }>(`/api/superadmin/customer-companies?historyFor=${encodeURIComponent(item.id)}`);
                    setHistoryByCompany((current) => ({ ...current, [item.id]: response.events }));
                  } catch (cause) { setHistoryError((cause as Error).message); }
                  finally { setHistoryLoadingId(null); }
                }}>{historyOpenId === item.id ? "Dölj händelser" : "Visa händelser"}</Button>
                {historyOpenId === item.id ? <div className="mt-3 text-sm">
                  {historyLoadingId === item.id ? <p className="text-muted-foreground">Hämtar händelser…</p> : null}
                  {historyError ? <p role="alert" className="text-destructive">{historyError}</p> : null}
                  {historyByCompany[item.id]?.length === 0 ? <p className="text-muted-foreground">Inga administrativa händelser ännu.</p> : null}
                  {historyByCompany[item.id]?.length ? <ol className="space-y-2">
                    {historyByCompany[item.id].map((event) => <li key={event.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 rounded-lg bg-muted/50 px-3 py-2">
                      <span>{event.label}</span><time dateTime={event.createdAt} className="text-xs text-muted-foreground">{formatSwedish(event.createdAt, { dateStyle: "medium", timeStyle: "short" })}</time>
                    </li>)}
                  </ol> : null}
                </div> : null}
              </div>
              </div> : null}
            </article>
          ))}
        </div>
      </Panel>
      <Modal open={sandboxBillingOpen} onOpenChange={setSandboxBillingOpen} title="Stripe sandbox – syntetiskt testföretag" className="max-w-6xl">
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="status">
          <strong>STRIPE SANDBOX – inga riktiga pengar.</strong> Vyn använder endast ett isolerat testföretag i kfid_v3_test och öppnar inga kundkontroller eller bilagor.
        </div>
        {sandboxBillingOpen && BillingRead ? <BillingRead endpoint="/api/billing?mode=sandbox-qa" sandboxQa /> : null}
      </Modal>
      <Modal open={Boolean(settingsCompany)} onOpenChange={(open) => { if (!open) setSettingsCompany(null); }} title="Kundföretagets inställningar">
        <p className="mb-5 text-sm text-muted-foreground">Endast företagsmetadata, kontakt och lagringsläge. Kundkontroller och bilagor öppnas inte.</p>
        <form className="space-y-4" onSubmit={async (event) => {
          event.preventDefault();
          if (!settingsCompany) return;
          setBusy(true);
          setFormError("");
          try {
            await api("/api/superadmin/customer-companies", { method: "PATCH", body: JSON.stringify({ action: "update_company", organizationId: settingsCompany.id, ...settingsForm }) });
            setSettingsCompany(null);
            setNotice("Kundföretagets inställningar är uppdaterade.");
            setHistoryByCompany({});
            setRevision((value) => value + 1);
          } catch (cause) { setFormError((cause as Error).message); }
          finally { setBusy(false); }
        }}>
          <div><label htmlFor="customer-settings-name" className="mb-2 block text-xs font-medium">Företagsnamn</label><Input id="customer-settings-name" value={settingsForm.name} onChange={(event) => setSettingsForm({ ...settingsForm, name: event.target.value })} required /></div>
          <div><label htmlFor="customer-settings-contact" className="mb-2 block text-xs font-medium">Kontakt-e-post</label><Input id="customer-settings-contact" type="email" value={settingsForm.contactEmail} onChange={(event) => setSettingsForm({ ...settingsForm, contactEmail: event.target.value })} /></div>
          <div><label htmlFor="customer-settings-billing" className="mb-2 block text-xs font-medium">Faktura-e-post</label><Input id="customer-settings-billing" type="email" value={settingsForm.billingEmail} onChange={(event) => setSettingsForm({ ...settingsForm, billingEmail: event.target.value })} /></div>
          <div><label htmlFor="customer-settings-storage" className="mb-2 block text-xs font-medium">Lagring</label><select id="customer-settings-storage" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={settingsForm.storageMode} onChange={(event) => setSettingsForm({ ...settingsForm, storageMode: event.target.value as "LOCAL" | "HINTEK_CLOUD" })}><option value="LOCAL">Lokal lagring</option><option value="HINTEK_CLOUD" disabled={settingsCompany?.storageMode === "LOCAL"}>HINTEK Cloud</option></select><p className="mt-1 text-xs text-muted-foreground">Cloud kan öppnas först efter verifierad betalning. Byte till lokal lagring kräver export och verifiering om molndata finns.</p></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settingsForm.isActive} onChange={(event) => setSettingsForm({ ...settingsForm, isActive: event.target.checked })} /> Företaget är aktivt</label>
          {formError ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}
          <Button disabled={busy} className="w-full sm:w-auto">{busy ? "Sparar…" : "Spara inställningar"}</Button>
        </form>
      </Modal>
      <Modal open={Boolean(creditCompany)} onOpenChange={(open) => { if (!open) setCreditCompany(null); }} title="Kundföretagets kreditregel">
        <p className="mb-5 text-sm text-muted-foreground">Förbereder ett individuellt undantag för köpta krediter. Inga köp eller automatiska förfall är aktiva ännu; dagens testsaldo påverkas inte. Normalregeln blir ett år från senaste köp.</p>
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
            setHistoryByCompany({});
            setRevision((value) => value + 1);
          } catch (cause) { setFormError((cause as Error).message); }
          finally { setBusy(false); }
        }}>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={creditForm.expiryEnabled} onChange={(event) => setCreditForm({ ...creditForm, expiryEnabled: event.target.checked })} /> Köpta krediter får gå ut</label>
          <div><label htmlFor="credit-expiry-override" className="mb-2 block text-xs font-medium">Individuellt slutdatum (valfritt)</label><Input id="credit-expiry-override" type="date" value={creditForm.expiryDate} onChange={(event) => setCreditForm({ ...creditForm, expiryDate: event.target.value })} /><p className="mt-1 text-xs text-muted-foreground">Ett manuellt datum ligger kvar även vid senare köp, tills du själv ändrar eller tar bort det.</p></div>
          {formError ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}
          <Button disabled={busy}>{busy ? "Sparar…" : "Spara kreditregel"}</Button>
        </form>
      </Modal>
      <Modal open={createOpen} onOpenChange={setCreateOpen} title="Förbered kundföretag">
        <p className="mb-5 text-sm text-muted-foreground">Företaget får lokal lagring från start. En inbjudan till första företagsadmin sparas utan token, mejl eller aktivt användarkonto. Du blir inte medlem i kundföretaget.</p>
        <form className="space-y-4" onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setFormError("");
          try {
            await api("/api/superadmin/customer-companies", { method: "POST", body: JSON.stringify(form) });
            setCreateOpen(false);
            setForm({ name: "", organizationNumber: "", ownerName: "", ownerEmail: "" });
            setNotice("Kundföretaget och admininbjudan är förberedda. Inget mejl har skickats.");
            setRevision((value) => value + 1);
          } catch (cause) {
            setFormError((cause as Error).message);
          } finally {
            setBusy(false);
          }
        }}>
          <div><label htmlFor="prepared-company-name" className="mb-2 block text-xs font-medium">Företagsnamn</label><Input id="prepared-company-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required minLength={2} maxLength={200} /></div>
          <div><label htmlFor="prepared-company-number" className="mb-2 block text-xs font-medium">Organisationsnummer</label><Input id="prepared-company-number" value={form.organizationNumber} onChange={(event) => setForm({ ...form, organizationNumber: event.target.value })} required minLength={4} maxLength={30} /></div>
          <div><label htmlFor="prepared-owner-name" className="mb-2 block text-xs font-medium">Administratörens namn</label><Input id="prepared-owner-name" value={form.ownerName} onChange={(event) => setForm({ ...form, ownerName: event.target.value })} required minLength={2} maxLength={200} /></div>
          <div><label htmlFor="prepared-owner-email" className="mb-2 block text-xs font-medium">Administratörens e-post</label><Input id="prepared-owner-email" type="email" value={form.ownerEmail} onChange={(event) => setForm({ ...form, ownerEmail: event.target.value })} required /></div>
          {formError ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}
          <Button disabled={busy} className="w-full sm:w-auto">{busy ? "Förbereder…" : "Förbered utan utskick"}</Button>
        </form>
      </Modal>
      <Modal open={ownerOpen} onOpenChange={setOwnerOpen} title="Förbered admininbjudan">
        <p className="mb-5 text-sm text-muted-foreground">{ownerCompany?.name}. Inbjudan sparas utan mejl eller token och kan ändras eller återkallas under privat test.</p>
        <form className="space-y-4" onSubmit={async (event) => {
          event.preventDefault();
          if (!ownerCompany) return;
          setBusy(true);
          setFormError("");
          try {
            await api("/api/superadmin/customer-companies", { method: "PATCH", body: JSON.stringify({ action: "prepare_owner", organizationId: ownerCompany.id, ...ownerForm }) });
            setOwnerOpen(false);
            setNotice("Admininbjudan är förberedd. Inget mejl har skickats.");
            setHistoryByCompany({});
            setRevision((value) => value + 1);
          } catch (cause) { setFormError((cause as Error).message); }
          finally { setBusy(false); }
        }}>
          <div><label htmlFor="owner-invitation-name" className="mb-2 block text-xs font-medium">Administratörens namn</label><Input id="owner-invitation-name" value={ownerForm.name} onChange={(event) => setOwnerForm({ ...ownerForm, name: event.target.value })} required minLength={2} /></div>
          <div><label htmlFor="owner-invitation-email" className="mb-2 block text-xs font-medium">Administratörens e-post</label><Input id="owner-invitation-email" type="email" value={ownerForm.email} onChange={(event) => setOwnerForm({ ...ownerForm, email: event.target.value })} required /></div>
          {formError ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}
          <Button disabled={busy} className="w-full sm:w-auto">{busy ? "Sparar…" : "Spara utan utskick"}</Button>
        </form>
      </Modal>
    </div>
  );
}
