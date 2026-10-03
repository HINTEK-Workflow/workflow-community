"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Building2, CheckCircle2, LoaderCircle, Mail } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeOrgNumber } from "@/lib/kfid/org-number";

type Document = { id: string; title: string; version: string; contentHash: string; href: string };

/**
 * Skapa konto (2026-10-03): a low threshold – the organisation number, the company's name, the person and one
 * "jag har läst" checkbox. With e-mail and password, or with Google. The account starts free.
 */
export function RegisterForm({ googleEnabled, initialError }: { googleEnabled: boolean; initialError?: string }) {
  const [documents, setDocuments] = useState<Document[] | null>(null);
  const [orgNumber, setOrgNumber] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [newsletter, setNewsletter] = useState(false);
  const [busy, setBusy] = useState<"email" | "google" | null>(null);
  const [error, setError] = useState(initialError ?? "");
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => { void fetch("/api/register", { cache: "no-store" }).then((response) => response.json()).then((data: { documents: Document[] }) => setDocuments(data.documents)).catch(() => setDocuments([])); }, []);

  const numberOk = normalizeOrgNumber(orgNumber) !== null;
  const [found, setFound] = useState<{ address: string; postalCode: string; city: string } | null>(null);
  const [lookedUp, setLookedUp] = useState("");
  useEffect(() => {
    const digits = normalizeOrgNumber(orgNumber);
    if (!digits || digits === lookedUp) return;
    setLookedUp(digits);
    // Företagsuppslag (SCB): fills in what it finds; without a key or an answer the person simply types the name.
    void fetch(`/api/register/lookup?number=${digits}`, { cache: "no-store" }).then((response) => (response.ok ? response.json() : null)).then((data: { found?: boolean; name?: string; address?: string; postalCode?: string; city?: string } | null) => {
      if (!data?.found || !data.name) { setFound(null); return; }
      setCompanyName(data.name);
      setFound({ address: data.address ?? "", postalCode: data.postalCode ?? "", city: data.city ?? "" });
    }).catch(() => setFound(null));
  }, [orgNumber, lookedUp]);
  const company = () => ({ organizationNumber: orgNumber, companyName, accepted: (documents ?? []).map(({ id, contentHash }) => ({ id, contentHash })), newsletter, ...(found ?? {}) });
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

  return <form onSubmit={(event) => void submit(event)} className="space-y-5" data-testid="register-form">
    {error ? <Alert variant="destructive"><AlertTitle>Kontot kunde inte skapas</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
    <fieldset className="space-y-3">
      <legend className="flex items-center gap-2 text-sm font-semibold"><Building2 className="size-4 text-primary" />Företaget</legend>
      <div className="space-y-2">
        <Label htmlFor="register-org">Organisationsnummer</Label>
        <Input id="register-org" inputMode="numeric" autoComplete="off" placeholder="NNNNNN-NNNN" value={orgNumber} onChange={(event) => setOrgNumber(event.target.value)} required />
        {orgNumber.replace(/\D/g, "").length >= 10 && !numberOk ? <p className="text-xs text-destructive">Numret stämmer inte. Kontrollera siffrorna.</p> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="register-company">Företagets namn</Label>
        <Input id="register-company" autoComplete="organization" value={companyName} onChange={(event) => setCompanyName(event.target.value)} required />
        {found ? <p className="text-xs text-muted-foreground" data-testid="register-found">Hämtat från företagsregistret{found.city ? `: ${[found.address, `${found.postalCode} ${found.city}`.trim()].filter(Boolean).join(", ")}` : ""}.</p> : null}
      </div>
    </fieldset>

    <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm" data-testid="register-accept">
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
      <span>Jag har läst och godkänner {documents === null ? "villkoren" : documents.length ? documents.map((document, index) => <span key={document.id}>{index ? (index === documents.length - 1 ? " och " : ", ") : ""}<a href={document.href} target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-4">{document.title.toLowerCase()}</a></span>) : "villkoren"}.</span>
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
      <div className="space-y-2"><Label htmlFor="register-password">Lösenord</Label><Input id="register-password" type="password" autoComplete="new-password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} required /><p className="text-xs text-muted-foreground">Minst 12 tecken.</p></div>
    </fieldset>
    <Button type="submit" className="w-full" disabled={!companyReady || Boolean(busy)} data-testid="register-submit">{busy === "email" ? <LoaderCircle className="animate-spin" /> : null}Skapa konto</Button>
    <p className="text-center text-xs text-muted-foreground">Kontot är gratis. Har du redan ett konto? <Link href="/login" className="font-medium text-primary underline underline-offset-4">Logga in</Link></p>
  </form>;
}
