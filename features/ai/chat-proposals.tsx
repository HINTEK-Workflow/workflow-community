"use client";

import { plural } from "@/lib/plural";
import { useState } from "react";
import Link from "next/link";
import { Check, RotateCcw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { proposalRequest } from "@/features/ai/proposal-client";
import { cn } from "@/lib/utils";

/**
 * Förslag från chatten (2026-10-09, AI-beslut 1 och 4): Workflow AI's proposals under its answer. Nothing is
 * saved until the person clicks Använd; the server then carries it out with the ordinary tool in the person's own
 * session, and Ångra takes it back while nobody has changed it since. Avfärda records that it was not wanted.
 */
export type ChatProposal = { id: string; kind: string; status: string; payload: unknown; result?: unknown };
type Row = Record<string, unknown>;

const TITLES: Record<string, string> = {
  WORK_ORDER: "Ny arbetsorder", WORK_ORDER_FILL: "Fyll i arbetsordern", TIME_ENTRY: "Tidpost", PROJECT_PLANNING: "Planering",
  QUOTE: "Offertutkast", RISK_HAZARDS: "Faror och skyddsåtgärder",
};
const APPLIED_TEXT: Record<string, string> = {
  WORK_ORDER: "Arbetsordern är skapad.", WORK_ORDER_FILL: "Arbetsordern är ifylld.", TIME_ENTRY: "Tiden är registrerad.", PROJECT_PLANNING: "Planeringen är skapad.",
  QUOTE: "Offertutkastet är skapat. Du skickar det själv från Offerter.", RISK_HAZARDS: "Farorna är inlagda. Bedöm sannolikhet, konsekvens och kvarvarande risk själv.",
};
const dayTime = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const time = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" });
const when = (start: unknown, end: unknown) => { try { return `${dayTime.format(new Date(String(start)))}–${time.format(new Date(String(end)))}`; } catch { return ""; } };

/** What the proposal holds, as short lines the person can check before Använd. */
function lines(kind: string, payload: Row): string[] {
  if (kind === "WORK_ORDER") return [String(payload.title ?? ""), ...String(payload.description ?? "").split(/\r?\n/).filter(Boolean).slice(0, 6), ...(payload.dueDate ? [`Klart senast ${String(payload.dueDate)}`] : [])];
  if (kind === "WORK_ORDER_FILL") return [
    ...(payload.executionNotes ? [`Utfört: ${String(payload.executionNotes)}`] : []),
    ...(payload.deviations ? [`Avvikelser: ${String(payload.deviations)}`] : []),
    ...((payload.materials as Row[] | undefined) ?? []).slice(0, 12).map((row) => `• ${String(row.name)}${row.quantity ? ` – ${String(row.quantity)}${row.unit ? ` ${String(row.unit)}` : ""}` : ""}`),
  ];
  if (kind === "TIME_ENTRY") return [String(payload.title ?? ""), when(payload.startedAt, payload.endedAt), ...(payload.note ? [String(payload.note)] : [])];
  if (kind === "PROJECT_PLANNING") return ((payload.activities as Row[] | undefined) ?? []).slice(0, 10).map((item) => `• ${String(item.title)} – ${when(item.startsAt, item.endsAt)}`);
  if (kind === "QUOTE") {
    const quote = (payload.quote as Row | undefined) ?? {};
    const rows = (quote.lines as Row[] | undefined) ?? [];
    return [String(quote.title ?? ""), `${plural(rows.length, "rad", "rader")} ur projektets material${Number(payload.unpriced ?? 0) ? `, ${Number(payload.unpriced)} utan pris – sätt pris i offerten` : ""}.`];
  }
  if (kind === "RISK_HAZARDS") return ((payload.hazards as Row[] | undefined) ?? []).slice(0, 10).map((item) => `• ${String(item.hazard)} → ${String(item.measure)}`);
  return [];
}

export function ChatProposalCards({ proposals, onNavigate }: { proposals: ChatProposal[]; onNavigate?: () => void }) {
  return <div className="mt-2 space-y-2" data-testid="chat-proposals">{proposals.map((item) => <ProposalCard key={item.id} proposal={item} onNavigate={onNavigate} />)}</div>;
}

function ProposalCard({ proposal, onNavigate }: { proposal: ChatProposal; onNavigate?: () => void }) {
  const [state, setState] = useState({ status: proposal.status, result: (proposal.result ?? {}) as Row });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const payload = (proposal.payload ?? {}) as Row;
  const run = async (action: "apply" | "dismiss" | "undo") => {
    setBusy(true); setMessage("");
    try {
      const answer = await proposalRequest<unknown>({ action, id: proposal.id });
      const next = answer.proposal as unknown as { status: string; result?: Row } | null;
      setState({ status: next?.status ?? state.status, result: next?.result ?? state.result });
      setMessage(action === "apply" ? APPLIED_TEXT[proposal.kind] ?? "Förslaget är använt." : action === "undo" ? "Ångrat." : "");
    } catch (issue) {
      setMessage(issue instanceof Error ? issue.message : "Det gick inte just nu.");
    } finally { setBusy(false); }
  };
  const url = typeof state.result.url === "string" ? state.result.url : "";
  const pending = state.status === "PENDING";
  return <div className={cn("rounded-xl border bg-background p-3 text-sm", !pending && state.status !== "APPLIED" && "opacity-70")} data-testid="chat-proposal" data-kind={proposal.kind}>
    <p className="flex items-center gap-1.5 text-xs font-semibold text-primary"><Sparkles className="size-3.5" />Förslag: {TITLES[proposal.kind] ?? "Ändring"}</p>
    <ul className="mt-1.5 space-y-1 break-words text-[0.8125rem] leading-5">{lines(proposal.kind, payload).filter(Boolean).map((line, index) => <li key={index} className={index === 0 && !line.startsWith("•") ? "font-medium" : "text-muted-foreground"}>{line}</li>)}</ul>
    {pending ? <p className="mt-1.5 text-[0.6875rem] text-muted-foreground">Inget sparas förrän du klickar Använd.</p> : null}
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {pending ? <>
        <Button type="button" size="sm" disabled={busy} onClick={() => void run("apply")} data-testid="chat-proposal-apply"><Check className={busy ? "animate-pulse" : undefined} />Använd</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run("dismiss")} data-testid="chat-proposal-dismiss"><X />Avfärda</Button>
      </> : state.status === "APPLIED" ? <>
        {url ? <Button asChild size="sm" variant="outline"><Link href={url} onClick={onNavigate}>Öppna</Link></Button> : null}
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run("undo")} data-testid="chat-proposal-undo"><RotateCcw className={busy ? "animate-pulse" : undefined} />Ångra</Button>
      </> : <span className="text-xs text-muted-foreground">{state.status === "UNDONE" ? "Ångrat" : state.status === "REJECTED" ? "Avfärdat" : "Inte längre aktuellt"}</span>}
      {message ? <span role="status" className="text-xs">{message}</span> : null}
    </div>
  </div>;
}
