"use client";

import { Bot, KeyRound, ShieldCheck } from "lucide-react";
import { Panel } from "@/features/kfid/ui";
import { StepRow } from "@/features/workflow/workflow-guide";
import { OWN_AI_APPS, OWN_AI_INTRO, OWN_AI_NOTE, OWN_AI_STEPS, OWN_AI_WAYS } from "@/lib/help/own-ai-guide";

/**
 * Hjälp → Din egen AI-app (2026-11-27): how ChatGPT, Claude, Copilot or another app is connected to Workflow over MCP – the
 * steps, OAuth or an MCP key, and a short note per app. The words are lib/help/own-ai-guide.ts, also read by the help search.
 */
export function OwnAiHelp() {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return <div className="space-y-6" id="hjalp-egen-ai" data-testid="help-own-ai">
    <Panel icon={Bot} title="Din egen AI-app" description={OWN_AI_INTRO}>
      <ol className="space-y-4 text-sm leading-6">{OWN_AI_STEPS.map((step) => <StepRow key={step.name} step={step} />)}</ol>
      {origin ? <p className="mt-4 text-sm">MCP-adressen för den här installationen: <code className="break-all rounded bg-muted px-1 py-0.5 font-mono text-xs" data-testid="help-own-ai-address">{origin}/api/mcp</code></p> : null}
    </Panel>
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel icon={KeyRound} title="Inloggning eller MCP-nyckel">
        <ul className="space-y-3 text-sm leading-6" data-testid="help-own-ai-ways">
          {OWN_AI_WAYS.map((way) => <li key={way.title}><p className="font-semibold">{way.title}</p><p className="mt-1">{way.text}</p></li>)}
        </ul>
      </Panel>
      <Panel icon={Bot} title="Appar">
        <ul className="space-y-3 text-sm leading-6" data-testid="help-own-ai-apps">
          {OWN_AI_APPS.map((app) => <li key={app.name}><p className="font-semibold">{app.name}</p><p className="mt-1">{app.text}</p></li>)}
        </ul>
      </Panel>
    </div>
    <p className="notice flex gap-3 text-sm"><ShieldCheck className="mt-0.5 size-5 shrink-0" /><span>{OWN_AI_NOTE}</span></p>
  </div>;
}
