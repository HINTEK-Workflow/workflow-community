"use client";

import { useState } from "react";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/features/kfid/api";

/** What the admin sees before an app may act as them (OAuth 2.1 for the MCP server, 2026-10-02). */
export function OAuthConsent({ params, app, redirectHost, company, person, scopes }: {
  params: Record<string, string>; app: string; redirectHost: string; company: string; person: string; scopes: { key: string; label: string }[];
}) {
  const [chosen, setChosen] = useState(() => scopes.map((scope) => scope.key).filter((key) => key !== "mcp:delete"));
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState("");
  const answer = async (decision: "approve" | "deny") => {
    setBusy(decision); setError("");
    try {
      const result = await api<{ redirect: string }>("/api/oauth/decide", { method: "POST", body: JSON.stringify({ params, decision, scopes: chosen }) });
      window.location.assign(result.redirect);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Det gick inte att svara."); setBusy(null); }
  };
  return <div className="space-y-5 text-sm" data-testid="oauth-consent">
    <dl className="grid gap-2 rounded-lg border bg-muted/20 p-3">
      <div><dt className="text-xs text-muted-foreground">App</dt><dd className="font-medium">{app}{redirectHost ? <span className="font-normal text-muted-foreground"> · {redirectHost}</span> : null}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Företag</dt><dd className="font-medium">{company}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Agerar som</dt><dd className="font-medium">{person}</dd></div>
    </dl>
    <fieldset className="space-y-2">
      <legend className="font-medium">Appen får</legend>
      {scopes.map((scope) => <label key={scope.key} className="flex items-center gap-2">
        <Checkbox checked={chosen.includes(scope.key)} disabled={scope.key === "mcp:read" || Boolean(busy)}
          onCheckedChange={(value) => setChosen((current) => value === true ? [...current, scope.key] : current.filter((item) => item !== scope.key))} />
        {scope.label}
      </label>)}
    </fieldset>
    <p className="flex gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4 shrink-0 text-primary" />Appen kan aldrig göra mer än du får göra i Workflow, och aldrig slutföra, signera eller radera för gott. Du kopplar från den under Inställningar → Mina inställningar → Anslutna appar.</p>
    {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-900">{error}</p> : null}
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={Boolean(busy)} onClick={() => void answer("approve")}>{busy === "approve" ? <LoaderCircle className="animate-spin" /> : null}Godkänn</Button>
      <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => void answer("deny")}>{busy === "deny" ? <LoaderCircle className="animate-spin" /> : null}Neka</Button>
    </div>
  </div>;
}
