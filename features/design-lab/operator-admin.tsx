"use client";

import Link from "next/link";
import { useState } from "react";
import { ExternalLink, HardHat, KeyRound, Plus, Users } from "lucide-react";
import { ListGroup, ListRow, NativeActions } from "@/components/native/list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckField, DialogActions, Field, Modal, Panel } from "@/features/kfid/ui";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { announce } from "@/lib/workflow/toast";
import { OPERATOR_ACCOUNTS, PASSWORD_MIN, passwordProblem, SCOPES, type OperatorAccount } from "./operator-accounts";
import { useProposalLevel } from "./proposal-level";

/**
 * The module's Operatör view (2026-10-30): a short description and the way to the operator page, and a mock of
 * Administration › Operatörskonton – the accounts the admin adds, what each sees, and the Microsoft group (a new decision).
 * Level 1 draws the same as the phone's grouped rows; levels 2–3 as panels.
 */

const RULES = [
  `Minst ${PASSWORD_MIN} tecken (vanliga konton: minst 12).`,
  "Kontrolleras mot vanliga och läckta lösenord.",
  "Begränsat antal försök, sedan spärrat en stund.",
  "Ingen tvåstegsverifiering.",
  "Bara rollen Operatör: felanmäla och se sina maskiner och anmälningar.",
  "Inloggningen gäller enheten och loggas ut efter en tid utan aktivitet.",
];
const MICROSOFT_DECISION = "Nytt beslut behövs. I dag kopplas Microsoft av personen själv från en inloggad session och känns igen på katalog och person-id, aldrig på e-post.";

export function OperatorAdmin() {
  const level = useProposalLevel();
  const [accounts, setAccounts] = useState(OPERATOR_ACCOUNTS);
  const [draft, setDraft] = useState<{ name: string; scope: string; password: string; active: boolean } | null>(null);
  const problem = draft ? (!draft.name.trim() ? "Skriv ett användarnamn." : passwordProblem(draft.password)) : "";
  const save = () => {
    if (!draft || problem) return;
    const scope = SCOPES.find((item) => item.id === draft.scope) ?? SCOPES[0];
    setAccounts((list) => [...list, { id: `o-${Date.now()}`, name: draft.name.trim(), kind: draft.name.includes("@") ? "E-post" : "Terminal", scope: scope.id, scopeLabel: scope.label, parts: scope.parts, status: draft.active ? "Aktiv" : "Spärrad" }]);
    announce(`Operatörskontot ${draft.name.trim()} är skapat`);
    setDraft(null);
  };
  const toggle = (account: OperatorAccount) => setAccounts((list) => list.map((item) => item.id === account.id ? { ...item, status: item.status === "Aktiv" ? "Spärrad" : "Aktiv" } : item));
  const startNew = () => setDraft({ name: "", scope: "p4", password: "", active: true });
  const operatorHref = `/design-lab/operator?niva=${level}`;

  const modal = <Modal open={Boolean(draft)} onOpenChange={(value) => { if (!value) setDraft(null); }} title="Nytt operatörskonto" size="form">
    {draft ? <div className="grid gap-4" data-testid="mm-operator-form">
      <Field id="op-new-name" label="Användarnamn" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} help="E-post, eller ett namn som Press 4, Linje 2 eller Avdelning Montering." />
      <Field id="op-new-scope" label="Ser maskiner" value={draft.scope} options={SCOPES.map((item) => item.id)} optionLabels={Object.fromEntries(SCOPES.map((item) => [item.id, item.label]))} onChange={(scope) => setDraft({ ...draft, scope })} help="En del av underhållets maskinträd." />
      <Field id="op-new-password" label="Lösenord" type="password" value={draft.password} onChange={(password) => setDraft({ ...draft, password })} help={draft.password ? passwordProblem(draft.password) || "Lösenordet duger." : `Minst ${PASSWORD_MIN} tecken, inte ett vanligt lösenord.`} />
      <CheckField id="op-new-active" label="Aktivt" checked={draft.active} onChange={(active) => setDraft({ ...draft, active })} />
      <DialogActions cancel={{ onClick: () => setDraft(null) }} primary={{ label: "Skapa", onClick: save, disabledReason: problem || null, testId: "op-new-save" }} />
    </div> : null}
  </Modal>;

  if (level === 1) return <div className="space-y-1" data-testid="mm-operator-admin">
    <NativeActions title="Operatörssidan" footer="En egen sida utan sidomeny, för telefon eller surfplatta vid maskinen.">
      <Button asChild variant="ghost"><Link href={operatorHref} data-testid="mm-open-operator"><ExternalLink />Öppna operatörssidan</Link></Button>
    </NativeActions>
    <ListGroup title="Operatörskonton" footer="Tryck på ett konto för att spärra eller aktivera det." testId="mm-operator-accounts">
      {accounts.map((account) => <ListRow key={account.id} type="tools" icon={HardHat} title={account.name} subtitle={`${account.kind} · ser ${account.scopeLabel}`}
        pill={{ label: account.status, tone: account.status === "Aktiv" ? "success" : "neutral" }} chevron={false} onClick={account.kind === "Microsoft" ? undefined : () => toggle(account)} />)}
    </ListGroup>
    <NativeActions><Button type="button" variant="ghost" onClick={startNew} data-testid="mm-operator-new"><Plus />Nytt operatörskonto</Button></NativeActions>
    <ListGroup title="Lösenord och inloggning" testId="mm-operator-rules">{RULES.map((rule) => <ListRow key={rule} title={rule} wrap chevron={false} />)}</ListGroup>
    <ListGroup title="Microsoft" footer={MICROSOFT_DECISION}><ListRow type="neutral" icon={Users} title="Koppla företagets katalog" subtitle="Grupp: Operatörer Fabriken" chevron={false} /></ListGroup>
    {modal}
  </div>;

  return <div className="space-y-6" data-testid="mm-operator-admin">
    <Panel icon={HardHat} title="Operatörssidan" actions={<Button asChild><Link href={operatorHref} data-testid="mm-open-operator"><ExternalLink />Öppna operatörssidan</Link></Button>}>
      <p className="text-sm">En egen sida utan sidomeny, för telefon eller en surfplatta vid maskinen. Operatören väljer maskin i underhållets maskinträd, orsak, skriver vad som hänt och hur allvarligt det är. Det blir en underhållspost i en ny arbetsorder.</p>
    </Panel>

    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem] [&>*]:min-w-0">
      <Panel icon={Users} title="Administration › Operatörskonton" actions={<Button type="button" variant="outline" onClick={startNew} data-testid="mm-operator-new"><Plus />Nytt operatörskonto</Button>}>
        <ul className="-mx-4 divide-y border-y text-sm" data-testid="mm-operator-accounts">{accounts.map((account) => <li key={account.id} className="grid gap-1 px-5 py-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-center">
          <span className="min-w-0"><span className="block truncate font-semibold">{account.name}</span><span className="block truncate text-xs text-muted-foreground">{account.kind} · ser {account.scopeLabel}</span></span>
          <span><Badge variant="outline" className={indicatorBadge(account.status === "Aktiv" ? "success" : "neutral")}>{account.status}</Badge></span>
          <span>{account.kind === "Microsoft" ? <span className="text-xs text-muted-foreground">Via gruppen</span> : <Button type="button" size="sm" variant="outline" onClick={() => toggle(account)}>{account.status === "Aktiv" ? "Spärra" : "Aktivera"}</Button>}</span>
        </li>)}</ul>
        <p className="mt-3 text-xs text-muted-foreground">Ett delat konto (”Press 4”) frågar efter ”Ditt namn” vid varje anmälan. Loggen visar kontot.</p>
      </Panel>

      <div className="space-y-6">
        <Panel icon={KeyRound} title="Lösenord och inloggning">
          <ul className="list-disc space-y-1 pl-5 text-sm" data-testid="mm-operator-rules">{RULES.map((rule) => <li key={rule}>{rule}</li>)}</ul>
        </Panel>
        <Panel icon={Users} title="Microsoft">
          <p className="text-sm">Koppla företagets katalog och välj gruppen som får logga in som operatörer, till exempel <strong>Operatörer Fabriken</strong>.</p>
          <p className="mt-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">{MICROSOFT_DECISION}</p>
        </Panel>
      </div>
    </div>
    {modal}
  </div>;
}
