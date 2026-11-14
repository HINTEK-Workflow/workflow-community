"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Building2, CheckCircle2, LoaderCircle, Mail } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizePartyNumber } from "@/lib/kfid/org-number";
import { blankCompanyDetails, CompanyDetailsFields, type CompanyDetailsValue } from "@/features/kfid/company-details-form";
import { ConsentGate } from "@/components/consent-gate";
import { clientExtensions } from "@ee/client";

const { FunnelBeacon } = clientExtensions;

type Document = { id: string; title: string; version: string; contentHash: string; href: string };

/**
 * Skapa konto (2026-10-03): a low threshold – the organisation number, the company's name, the person and one
 * "jag har läst" checkbox. With e-mail and password, or with Google. The account starts free.
 *
 * The company's fields are the shared ones (company-details-form.tsx, 2026-11-04). Required here: a valid number and a
 * name. An address (SCB fills it in, or the person adds it) and a telephone number are optional; the rest a document needs
 * (säte, bankgiro, VAT number, F-skatt) is asked in Kom igång, so signing up stays short. Nobody is signed in, so the street is
 * a plain field here and the SCB lookup is the sign-up's own (open only while registration is open, limited per address).
 */
export function RegisterForm({ googleEnabled, initialError, localStart = false }: { googleEnabled: boolean; initialError?: string; localStart?: boolean }) {
  const [documents, setDocuments] = useState<Document[] | null>(null);
  const [details, setDetails] = useState<CompanyDetailsValue>(blankCompanyDetails);
  const [addressOpen, setAddressOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [newsletter, setNewsletter] = useState(false);
  const [busy, setBusy] = useState<"email" | "google" | null>(null);
  const [error, setError] = useState(initialError ?? "");
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => { void fetch("/api/register", { cache: "no-store" }).then((response) => response.json()).then((data: { documents: Document[] }) => setDocuments(data.documents)).catch(() => setDocuments([])); }, []);

  const orgNumber = details.organizationNumber;
  const companyName = details.name;
  const soleTrader = details.companyType === "soleTrader";
  const numberOk = normalizePartyNumber(orgNumber, details.companyType) !== null;
  const showAddress = addressOpen || Boolean(details.address || details.postalCode || details.city);
  const company = () => ({ companyType: details.companyType, organizationNumber: orgNumber, companyName, address: details.address, postalCode: details.postalCode, city: details.city, phone, accepted: (documents ?? []).map(({ id, contentHash }) => ({ id, contentHash })), newsletter });
  const post = async (payload: Record<string, unknown>) => {
    const response = await fetch("/api/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error((data as { error?: string }).error || "Kontot kunde inte skapas.");
    return data as { email?: string };
  };
  const companyReady = numberOk && companyName.trim().length >= 2 && accepted;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("email"); setError("");
    try { const result = await post({ mode: "email", ...company(), name, email, password }); setDone(result.email ?? email); }
    catch (cause) { setError((cause as Error).message); } finally { setBusy(null); }
  };
  const withGoogle = async () => {
    setBusy("google"); setError("");
    try { await post({ mode: "google", ...company() }); await signIn("google", { callbackUrl: "/?view=setup" }); }
    catch (cause) { setError((cause as Error).message); setBusy(null); }
  };

  if (done) return <Alert className="border-emerald-200 bg-emerald-50/80 text-emerald-950" data-testid="register-done">
    <CheckCircle2 className="size-4" />
    <AlertTitle>Kontot är skapat</AlertTitle>
    <AlertDescription className="space-y-2">
      <p>Vi har skickat en länk till {done}. Öppna den för att bekräfta adressen, och logga sedan in.</p>
      <Link href="/login" className="font-medium underline underline-offset-4">Till inloggningen</Link>
    </AlertDescription>
  </Alert>;

  // method="post": a submit before the script runs keeps the password out of the address (granskningen 2026-10-20, S1).
  return <form method="post" onSubmit={(event) => void submit(event)} className="space-y-5" data-testid="register-form">
    {/* Trattmätning (2026-10-07): the cookie box waits for an answer here; counted as "Skapa konto" only after "Tillåt statistik". */}
    <ConsentGate />
    {FunnelBeacon ? <FunnelBeacon step="register" /> : null}
    {error ? <Alert variant="destructive"><AlertTitle>Kontot kunde inte skapas</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
    <fieldset className="space-y-3">
      <legend className="flex items-center gap-2 text-sm font-semibold"><Building2 className="size-4 text-primary" />Företaget</legend>
      <CompanyDetailsFields idPrefix="register-company" groups={showAddress ? ["company", "address"] : ["company"]} value={details} onChange={setDetails} lookupEndpoint="/api/register/lookup" autoLookup={!soleTrader} addressSearch={false} className="sm:grid-cols-1" />
      {showAddress ? null : <button type="button" className="text-xs font-medium text-primary underline underline-offset-4" onClick={() => setAddressOpen(true)} data-testid="register-add-address">Lägg till adress (valfritt)</button>}
    </fieldset>

    <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm" data-testid="register-accept">
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
      <span>Jag har läst och godkänner {documents === null ? "villkoren" : documents.length ? documents.map((document, index) => <span key={document.id}>{index ? (index === documents.length - 1 ? " och " : ", ") : ""}<a href={document.href} target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-4">{document.title.toLowerCase()}</a></span>) : "villkoren"}{documents?.length ? <span className="text-muted-foreground" data-testid="register-terms-new-tab"> (öppnas i ny flik)</span> : null}.</span>
    </label>
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" checked={newsletter} onChange={(event) => setNewsletter(event.target.checked)} />
      <span><span className="block">Ja, mejla mig om nyheter i Workflow</span><span className="block text-xs text-muted-foreground">Ändringar och förbättringar. Går att ändra under Mina inställningar.</span></span>
    </label>

    {googleEnabled ? <>
      <Button type="button" variant="outline" className="w-full" disabled={!companyReady || Boolean(busy)} onClick={() => void withGoogle()} data-testid="register-google">
        {busy === "google" ? <LoaderCircle className="animate-spin" /> : null}Skapa konto med Google
      </Button>
      <p className="text-center text-xs text-muted-foreground">eller med e-post och lösenord</p>
    </> : null}

    <fieldset className="space-y-3">
      <legend className="flex items-center gap-2 text-sm font-semibold"><Mail className="size-4 text-primary" />Du</legend>
      <div className="space-y-2"><Label htmlFor="register-name">Ditt namn</Label><Input id="register-name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required /></div>
      <div className="space-y-2"><Label htmlFor="register-email">E-post</Label><Input id="register-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
      <div className="space-y-2"><Label htmlFor="register-phone">Telefon (valfritt)</Label><Input id="register-phone" type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="register-password">Lösenord</Label><Input id="register-password" type="password" autoComplete="new-password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} required /><p className="text-xs text-muted-foreground">Minst 12 tecken.</p></div>
    </fieldset>
    <Button type="submit" className="w-full" disabled={!companyReady || Boolean(busy)} data-testid="register-submit">{busy === "email" ? <LoaderCircle className="animate-spin" /> : null}Skapa konto</Button>
    {/* What the free start is (2026-11-01): Skapa konto starts in Local where the installation sells Cloud; said before, not after. */}
    {localStart ? <p className="text-center text-xs leading-5 text-muted-foreground" data-testid="register-local-note">Du börjar gratis i Local: en fil på din dator, för en person. Kollegor, offerter och AI kräver Cloud, som du beställer inne i Workflow.</p> : null}
    <p className="text-center text-xs text-muted-foreground">Kontot är gratis. Har du redan ett konto? <Link href="/login" className="font-medium text-primary underline underline-offset-4">Logga in</Link></p>
  </form>;
}
