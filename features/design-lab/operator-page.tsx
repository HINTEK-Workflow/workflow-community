"use client";

import { useState } from "react";
import { Factory, LogIn, LogOut, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/features/kfid/ui";
import { cn } from "@/lib/utils";
import { INITIAL_PARTS } from "./maintenance-data";
import { OperatorView } from "./maintenance-operator";
import { OPERATOR_ACCOUNTS, PASSWORD_MIN, passwordProblem, type OperatorAccount } from "./operator-accounts";
import { ProposalToast } from "./work-order-holder";
import { LevelSwitch, ProposalLevelContext, useLevelState, useProposalLevel } from "./proposal-level";
import { Panel } from "@/features/kfid/ui";

/**
 * Operatörssidan (2026-10-30): a page of its own, without the side menu – a top banner with the company, who is
 * signed in and Logga ut. Phone first, also for a tablet mounted at a machine. Sign-in mock: Microsoft (the company's
 * directory, a new decision) or an operator account the admin made. Example data only; nothing is stored.
 */

const COMPANY = "Exempelfabriken AB";
const MAX_ATTEMPTS = 5;

export function OperatorPage({ initialLevel = null }: { initialLevel?: string | null }) {
  const [account, setAccount] = useState<OperatorAccount | null>(null);
  const { level, choose } = useLevelState(initialLevel);
  const width = level === 1 ? "max-w-[560px]" : "max-w-6xl";
  return <ProposalLevelContext.Provider value={level}><div className="flex min-h-dvh flex-col bg-background" data-testid="operator-page">
    <div className="border-b bg-muted/40"><div className={cn("mx-auto flex flex-wrap items-center justify-between gap-2 px-4 py-1.5 text-xs text-muted-foreground", width)}><span>Förslag · exempeldata, sparas inte</span><LevelSwitch level={level} onChoose={choose} /></div></div>
    <header className="sticky top-0 z-20 border-b bg-card">
      <div className={cn("mx-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5", width)}>
        <span className="flex min-w-0 items-center gap-2 font-semibold"><Factory className="size-5 shrink-0 text-primary" aria-hidden="true" /><span className="truncate">{COMPANY}</span></span>
        {account ? <span className="flex min-w-0 items-center gap-2 text-sm">
          <span className="min-w-0 truncate text-muted-foreground" data-testid="operator-signed-in">{account.name}{account.kind === "Terminal" ? " (terminal)" : ""}</span>
          <Button type="button" variant="outline" size={level === 1 ? "default" : "sm"} className={level === 1 ? "h-11" : undefined} onClick={() => setAccount(null)} data-testid="operator-sign-out"><LogOut />Logga ut</Button>
        </span> : <span className="text-sm text-muted-foreground">Felanmälan</span>}
      </div>
    </header>
    <main className={cn("mx-auto w-full flex-1 px-4 py-5", width)}>
      {account ? <>
        <h1 className="mb-1 text-xl font-semibold">Felanmälan</h1>
        <p className="mb-4 text-xs text-muted-foreground">Du ser {account.scopeLabel}. Loggas ut efter 15 minuter utan aktivitet.</p>
        <OperatorView key={account.id} parts={INITIAL_PARTS.filter((part) => account.parts.includes(part.id))} terminal={account.kind === "Terminal"} />
      </> : <SignIn onSignIn={setAccount} />}
    </main>
    <ProposalToast />
  </div></ProposalLevelContext.Provider>;
}

function SignIn({ onSignIn }: { onSignIn: (account: OperatorAccount) => void }) {
  const [name, setName] = useState("Press 4");
  const [password, setPassword] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [error, setError] = useState("");
  const locked = attempts >= MAX_ATTEMPTS;
  const signIn = () => {
    if (locked) return;
    const found = OPERATOR_ACCOUNTS.find((item) => item.name.toLowerCase() === name.trim().toLowerCase() && item.kind !== "Microsoft");
    // Example: any password that meets the rule signs an active example account in.
    if (!found || found.status === "Spärrad" || passwordProblem(password)) {
      const next = attempts + 1;
      setAttempts(next);
      setError(next >= MAX_ATTEMPTS ? "För många försök. Försök igen om 15 minuter." : found?.status === "Spärrad" ? "Kontot är spärrat. Kontakta din administratör." : "Fel användarnamn eller lösenord.");
      return;
    }
    onSignIn(found);
  };
  const level = useProposalLevel();
  const body = <div className="mx-auto max-w-sm space-y-5 pt-4" data-testid="operator-sign-in">
    <div>
      <h1 className="text-xl font-semibold">Logga in</h1>
      <p className="mt-1 text-sm text-muted-foreground">För att felanmäla maskiner.</p>
    </div>
    <div className="space-y-2">
      <Button type="button" variant="outline" className="h-12 w-full text-base" onClick={() => onSignIn(OPERATOR_ACCOUNTS.find((item) => item.kind === "Microsoft")!)} data-testid="operator-microsoft">
        <svg viewBox="0 0 21 21" className="size-4" aria-hidden="true"><path fill="#f25022" d="M1 1h9v9H1z" /><path fill="#7fba00" d="M11 1h9v9h-9z" /><path fill="#00a4ef" d="M1 11h9v9H1z" /><path fill="#ffb900" d="M11 11h9v9h-9z" /></svg>
        Logga in med Microsoft
      </Button>
      <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground"><strong className="text-foreground">Nytt beslut behövs.</strong> I dag kopplar man Microsoft från en inloggad session, och kontot känns igen på katalog och person-id, aldrig på e-post. Förslaget: admin kopplar företagets katalog och väljer vilken grupp som får logga in som operatörer.</p>
    </div>
    <div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />eller med operatörskonto<span className="h-px flex-1 bg-border" /></div>
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); signIn(); }}>
      <Field id="operator-user" label="Användarnamn" value={name} onChange={setName} autoComplete="username" help="E-post eller ett namn, till exempel Press 4." />
      <Field id="operator-password" label="Lösenord" type="password" value={password} onChange={setPassword} autoComplete="current-password" help={`Minst ${PASSWORD_MIN} tecken.`} />
      <p className={cn("min-h-5 text-sm", error ? "text-destructive" : "text-muted-foreground")} role={error ? "alert" : undefined} data-testid="operator-sign-in-error">{error}</p>
      <Button type="submit" className="h-12 w-full text-base" disabled={locked} data-testid="operator-sign-in-submit">Logga in</Button>
    </form>
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />Bara rollen Operatör: felanmäla och se sina maskiner och anmälningar. Inget annat.</p>
  </div>;
  // Levels 2–3: the same form in a card in the middle of the page.
  return level === 1 ? body : <div className="mx-auto max-w-md pt-6"><Panel icon={LogIn} title="Felanmälan">{body}</Panel></div>;
}
