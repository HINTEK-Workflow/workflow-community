"use client";

import { useEffect, useRef, useState } from "react";
import { Popover } from "radix-ui";
import { LoaderCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAdvisorAutofill } from "@/features/workflow/flow-guide";
import { announce } from "@/lib/workflow/toast";
import { proposalOutcome, proposalRequest, useAiAvailable } from "@/features/ai/proposal-client";

/**
 * "Skriv med AI" beside Sammanställ resultat (2026-10-01: "Sammanställ resultat ska också vara regel- och
 * AI-styrt"). The rules' summary is the material; Workflow AI words it as a finished summary. Since 2026-10-02 the text
 * is a proposal: it is shown in a small window by the button and put in the field when the person chooses Använd –
 * or directly, when the field is empty and the person has chosen that in Inställningar. Either way it can be undone,
 * and nothing is saved until the person saves. What happened is told in a toast, never beside the button, so the
 * button does not move; the credits are not shown here. Shown only where the company's AI is on.
 */
export function SummaryAssist({ draft, label, onText, disabled, current = "", sourceId }: { draft: string; label: string; onText: (text: string) => void; disabled?: boolean; current?: string; sourceId?: string }) {
  const available = useAiAvailable();
  const autofill = useAdvisorAutofill();
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<{ id: string; text: string } | null>(null);
  // The page's newest writer and text: a proposal is used, or undone, after the person may have typed elsewhere.
  const write = useRef(onText);
  const text = useRef(current);
  useEffect(() => { write.current = onText; text.current = current; });
  if (!available) return null;
  // Nothing to write from yet: no credits are spent on an empty protocol.
  const empty = /Inga kontroll(punkter är registrerade|moment är valda) ännu/.test(draft);

  function accept(item: { id: string; text: string }) {
    const before = text.current;
    write.current(item.text);
    void proposalOutcome("apply", item.id);
    announce("Workflow AI har skrivit sammanfattningen. Granska och ändra vid behov.", false, [{ label: "Ångra", run: () => { write.current(before); void proposalOutcome("undo", item.id); } }]);
  }
  async function ask() {
    setBusy(true);
    try {
      const answer = await proposalRequest<{ text: string }>({ action: "create", kind: "SUMMARY", label, draft: draft.slice(0, 4000), ...(sourceId ? { sourceId } : {}) });
      if (!answer.proposal) { announce(answer.reason || "AI-modellen kunde inte användas nu; regelsammanställningen står kvar.", true); return; }
      const item = { id: answer.proposal.id, text: answer.proposal.payload.text };
      if (autofill && !text.current.trim()) accept(item);
      else setProposal(item);
    } catch (issue) { announce(issue instanceof Error ? issue.message : "AI kunde inte skriva sammanfattningen.", true); } finally { setBusy(false); }
  }
  return <Popover.Root open={Boolean(proposal)} onOpenChange={(open) => { if (!open && proposal) { void proposalOutcome("dismiss", proposal.id); setProposal(null); } }}>
    <Popover.Anchor asChild>
      <Button type="button" variant="outline" disabled={disabled || busy || !draft.trim() || empty} onClick={() => void ask()} title={empty ? "Registrera resultat först – AI skriver utifrån det som är ifyllt." : "Workflow AI föreslår en sammanfattning av resultatet. Namn och platser skickas som alias. Kostar krediter."} data-testid="summary-ai">
        {busy ? <LoaderCircle className="animate-spin" /> : <Sparkles />}Skriv med AI
      </Button>
    </Popover.Anchor>
    <Popover.Portal>
      <Popover.Content align="end" sideOffset={8} className="z-50 w-[min(32rem,calc(100vw-2rem))] rounded-xl border bg-popover p-4 shadow-lg" data-testid="summary-ai-proposal">
        <p className="text-xs font-semibold">Förslag från Workflow AI</p>
        <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-sm leading-6">{proposal?.text}</p>
        <p className="mt-2 text-xs text-muted-foreground">{current.trim() ? "Använd ersätter texten i fältet. Du kan ångra och ändra efteråt." : "Använd lägger texten i fältet. Du kan ändra den efteråt."}</p>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => { if (proposal) void proposalOutcome("dismiss", proposal.id); setProposal(null); }}>Avfärda</Button>
          <Button type="button" size="sm" data-testid="summary-ai-use" onClick={() => { if (proposal) accept(proposal); setProposal(null); }}>Använd</Button>
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
