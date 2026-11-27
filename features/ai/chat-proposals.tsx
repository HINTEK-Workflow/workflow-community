"use client";

import { plural } from "@/lib/plural";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, RotateCcw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { proposalRequest } from "@/features/ai/proposal-client";
import { showFormAiDraft } from "@/features/ai/form-ai-store";
import { FORM_AI_KIND } from "@/lib/ai/form-ai-text";
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
  QUOTE: "Offertutkast", RISK_HAZARDS: "Faror och skyddsåtgärder", PLACE_NAMEPLATE: "Märkskylt till objektet", POST_DRAFT: "Utkast till inlägg", AGENT_MISSION: "Agentuppdrag", ACTION: "Ändring i Workflow", FORM_DRAFT: "Nytt formulär",
};
const APPLIED_TEXT: Record<string, string> = {
  WORK_ORDER: "Arbetsordern är sparad som Planerad, utan ansvarig.", WORK_ORDER_FILL: "Arbetsordern är ifylld.", TIME_ENTRY: "Tiden är registrerad.", PROJECT_PLANNING: "Planeringen är skapad.",
  QUOTE: "Offertutkastet är skapat. Du skickar det själv från Offerter.", RISK_HAZARDS: "Farorna är inlagda. Bedöm sannolikhet, konsekvens och kvarvarande risk själv.",
  PLACE_NAMEPLATE: "Uppgifterna är inlagda på objektet.",
  POST_DRAFT: "Utkastet är sparat under Inlägg. Inget publiceras förrän du gör det själv.", AGENT_MISSION: "Uppdraget ligger under Agenter.",
  FORM_DRAFT: "Utkastet är sparat. Granska det i formulärbyggaren och publicera när du är klar.",
};
/** The link after Använd or Auto, in the words of what was made (2026-11-21). */
const OPEN_TEXT: Record<string, string> = {
  WORK_ORDER: "Öppna arbetsordern", WORK_ORDER_FILL: "Öppna arbetsordern", TIME_ENTRY: "Öppna Tid", PROJECT_PLANNING: "Öppna planeringen", QUOTE: "Öppna offerten",
  RISK_HAZARDS: "Öppna riskbedömningen", PLACE_NAMEPLATE: "Öppna platsen", POST_DRAFT: "Öppna utkast", AGENT_MISSION: "Öppna uppdraget", ACTION: "Öppna", FORM_DRAFT: "Öppna utkastet",
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
  if (kind === "PLACE_NAMEPLATE") return [
    String(payload.placeName ?? ""),
    ...(payload.manufacturer ? [`Fabrikat: ${String(payload.manufacturer)}`] : []),
    ...(payload.model ? [`Modell: ${String(payload.model)}`] : []),
    ...(payload.serialNumber ? [`Serienummer: ${String(payload.serialNumber)}`] : []),
    ...((payload.ratings as Row[] | undefined) ?? []).slice(0, 8).map((item) => `• ${String(item.label)}: ${String(item.value)}`),
    "Kontrollera mot skylten innan du klickar på Använd.",
  ];
  if (kind === "POST_DRAFT") return [String(payload.heading ?? ""), String(payload.body ?? ""), String(payload.caption ?? "")];
  if (kind === "ACTION") return [String(payload.title ?? ""), ...Object.entries((payload.input as Row | undefined) ?? {}).filter(([key]) => !/Id$/.test(key)).slice(0, 8).map(([key, value]) => `• ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`.slice(0, 160))];
  if (kind === "FORM_DRAFT") {
    // Formulär med Workflow AI (2026-11-25): the name, the sections with their fields, and what to check before publishing.
    const summary = (payload.summary as Row | undefined) ?? {};
    const sections = (summary.sections as Row[] | undefined) ?? [];
    const count = sections.length + Number(summary.moreSections ?? 0);
    const issues = Number(summary.issues ?? 0);
    return [
      String(summary.name ?? ""),
      `${plural(count, "avsnitt", "avsnitt")}, ${plural(Number(summary.fields ?? 0), "fält", "fält")}`,
      ...sections.map((section) => `• ${String(section.title)} – ${plural(Number(section.fields ?? 0), "fält", "fält")}`),
      ...(Number(summary.moreSections ?? 0) ? [`• och ${plural(Number(summary.moreSections), "avsnitt", "avsnitt")} till`] : []),
      ...(payload.note ? [String(payload.note)] : []),
      ...(issues ? [`${plural(issues, "sak", "saker")} att rätta i formulärbyggaren innan du publicerar.`] : []),
      ...(Number(summary.limitValues ?? 0) ? ["Formuläret har gränsvärden. Kontrollera att de är era egna."] : []),
    ];
  }
  if (kind === "AGENT_MISSION") {
    const draft = (payload.draft as Row | undefined) ?? {};
    return [String(draft.name ?? ""), ...((payload.summary as string[] | undefined) ?? []).slice(0, 5), ...((payload.cautions as string[] | undefined) ?? [])];
  }
  return [];
}

export function ChatProposalCards({ proposals, onNavigate }: { proposals: ChatProposal[]; onNavigate?: () => void }) {
  return <div className="mt-2 space-y-2" data-testid="chat-proposals">{proposals.map((item) => <ProposalCard key={item.id} proposal={item} onNavigate={onNavigate} />)}</div>;
}

function ProposalCard({ proposal, onNavigate }: { proposal: ChatProposal; onNavigate?: () => void }) {
  const [state, setState] = useState({ status: proposal.status, result: (proposal.result ?? {}) as Row });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  const payload = (proposal.payload ?? {}) as Row;
  // A form proposal (2026-11-25) is saved as a draft with its own words; the chat stays open beside the builder for the next change.
  const form = proposal.kind === FORM_AI_KIND;
  const change = form && Boolean(payload.templateId);
  const applyLabel = form ? (change ? "Ändra utkastet" : "Skapa utkast") : "Använd";
  const run = async (action: "apply" | "dismiss" | "undo") => {
    setBusy(true); setMessage("");
    try {
      const answer = await proposalRequest<unknown>({ action, id: proposal.id });
      const next = answer.proposal as unknown as { status: string; result?: Row } | null;
      setState({ status: next?.status ?? state.status, result: next?.result ?? state.result });
      setMessage(action === "apply" ? APPLIED_TEXT[proposal.kind] ?? "Förslaget är använt." : action === "undo" ? "Ångrat." : "");
      const made = next?.result ?? {};
      if (form && action === "apply" && typeof made.templateId === "string" && typeof made.url === "string") showFormAiDraft(made.templateId, made.url, (url) => router.push(url));
    } catch (issue) {
      setMessage(issue instanceof Error ? issue.message : "Det gick inte just nu.");
    } finally { setBusy(false); }
  };
  const url = typeof state.result.url === "string" ? state.result.url : "";
  const pending = state.status === "PENDING";
  // Auto saved it at once (2026-11-21): the card says what was made, with its link and Ångra.
  const auto = state.result.auto === true;
  const savedText = typeof state.result.message === "string" && state.result.message ? state.result.message : APPLIED_TEXT[proposal.kind];
  return <div className={cn("rounded-xl border bg-background p-3 text-sm", !pending && state.status !== "APPLIED" && "opacity-70")} data-testid="chat-proposal" data-kind={proposal.kind}>
    <p className="flex items-center gap-1.5 text-xs font-semibold text-primary"><Sparkles className="size-3.5" />{auto && state.status === "APPLIED" ? "Sparat" : "Förslag"}: {change ? "Ändring av formuläret" : TITLES[proposal.kind] ?? "Ändring"}</p>
    {auto && state.status === "APPLIED" && savedText ? <p className="mt-1 text-[0.8125rem]" data-testid="chat-proposal-saved">{savedText}</p> : null}
    <ul className="mt-1.5 space-y-1 break-words text-[0.8125rem] leading-5">{lines(proposal.kind, payload).filter(Boolean).map((line, index) => <li key={index} className={index === 0 && !line.startsWith("•") ? "font-medium" : "text-muted-foreground"}>{line}</li>)}</ul>
    {pending && typeof state.result.autoError === "string" ? <p className="mt-1.5 text-[0.6875rem] text-destructive" data-testid="chat-proposal-auto-error">Auto kunde inte spara det direkt: {state.result.autoError}</p> : null}
    {pending ? <p className="mt-1.5 text-[0.6875rem] text-muted-foreground">{form ? `Inget sparas förrän du klickar på ${applyLabel}. Workflow AI publicerar aldrig formuläret.` : "Inget sparas förrän du klickar på Använd."}</p> : null}
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {pending ? <>
        <Button type="button" size="sm" disabled={busy} onClick={() => void run("apply")} data-testid="chat-proposal-apply"><Check className={busy ? "animate-pulse" : undefined} />{applyLabel}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run("dismiss")} data-testid="chat-proposal-dismiss"><X />Avfärda</Button>
      </> : state.status === "APPLIED" ? <>
        {url && form && typeof state.result.templateId === "string" ? <Button type="button" size="sm" variant="outline" onClick={() => showFormAiDraft(String(state.result.templateId), url, (to) => router.push(to))} data-testid="chat-proposal-open">{OPEN_TEXT[proposal.kind]}</Button>
          : url ? <Button asChild size="sm" variant="outline"><Link href={url} onClick={onNavigate} data-testid="chat-proposal-open">{OPEN_TEXT[proposal.kind] ?? "Öppna"}</Link></Button> : null}
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run("undo")} data-testid="chat-proposal-undo"><RotateCcw className={busy ? "animate-pulse" : undefined} />Ångra</Button>
      </> : <span className="text-xs text-muted-foreground">{state.status === "UNDONE" ? "Ångrat" : state.status === "REJECTED" ? "Avfärdat" : "Inte längre aktuellt"}</span>}
      {message ? <span role="status" className="text-xs">{message}</span> : null}
    </div>
  </div>;
}
