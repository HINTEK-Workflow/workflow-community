"use client";

import { useCallback, useState } from "react";
import { AppWindow, Link2, Monitor, Users } from "lucide-react";
import { DialogActions, Modal, RowsSkeleton } from "@/features/kfid/ui";
import { cardDefinition, cardHeading } from "@/lib/boards/model";
import { PEOPLE_CHOICE_LABEL, PEOPLE_CHOICES, type PeopleChoice, type Visibility } from "@/lib/boards/privacy";
import { useLoadEffect } from "@/lib/use-load-effect";
import { announce } from "@/lib/workflow/toast";
import { boardsGet, type PublishPreview } from "./boards-api";

/**
 * "Det här syns" (Tavlor etapp 1, 2026-11-18; fråga 6): before a board is published the publisher sees which cards it has, which of
 * them show names, and who receives it – the app, the connected screens and the shared links. Names are hidden outside the app
 * unless the publisher chooses initials or names per card here; a link without a code and an end date hides them anyway. The
 * figures on screens and links are counted with the publisher's own rights.
 */
export function PublishDialog({ boardId, labels, open, onClose, onPublish }: {
  boardId: string;
  labels: Record<string, string>;
  open: boolean;
  onClose: () => void;
  onPublish: (visibility: Visibility) => Promise<boolean>;
}) {
  const [preview, setPreview] = useState<PublishPreview | null>(null);
  const [choices, setChoices] = useState<Visibility>({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!open) return;
    setPreview(null);
    try {
      const answer = await boardsGet<PublishPreview>(`part=publish&id=${encodeURIComponent(boardId)}`);
      setPreview(answer);
      setChoices(Object.fromEntries(answer.cards.filter((card) => card.personal).map((card) => [card.id, card.people])));
    } catch (error) { announce(error instanceof Error ? error.message : "Det gick inte att läsa tavlan.", true); onClose(); }
  }, [open, boardId, onClose]);
  useLoadEffect(load);
  const cards = preview?.layout.cards ?? [];
  const personal = new Set(preview?.cards.filter((card) => card.personal).map((card) => card.id));
  const outside = (preview?.receivers.screens.length ?? 0) + (preview?.receivers.links.length ?? 0);
  return <Modal open={open} onOpenChange={(next) => { if (!next) onClose(); }} title="Det här syns" size="form">
    {!preview ? <RowsSkeleton rows={4} /> : <div className="space-y-5" data-testid="publish-dialog">
      <p className="text-sm text-muted-foreground">När du publicerar visas den här versionen överallt där tavlan visas. Siffrorna på skärmar och länkar räknas utifrån det du har rätt att se.</p>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Mottagare</h3>
        <ul className="space-y-1.5 text-sm">
          <li className="flex items-center gap-2"><AppWindow className="size-4 text-primary" aria-hidden="true" />Inne i appen: alla i företaget med rätten att se tavlor.</li>
          <li className="flex items-center gap-2"><Monitor className="size-4 text-primary" aria-hidden="true" />{preview.receivers.screens.length ? `Fasta skärmar: ${preview.receivers.screens.join(", ")}` : "Inga fasta skärmar visar tavlan."}</li>
          <li className="flex items-center gap-2"><Link2 className="size-4 text-primary" aria-hidden="true" />{preview.receivers.links.length ? `Delade länkar: ${preview.receivers.links.join(", ")}` : "Inga delade länkar visar tavlan."}</li>
        </ul>
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Kort ({cards.length})</h3>
        {cards.length ? <ul className="divide-y rounded-lg border">
          {cards.map((card) => <li key={card.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{cardHeading(card, labels[card.id]) || cardDefinition(card.type).label}</span>
              <span className="block text-xs text-muted-foreground">{cardDefinition(card.type).label}{personal.has(card.id) ? " · innehåller namn" : ""}</span></span>
            {personal.has(card.id) ? <label className="flex items-center gap-2 text-xs"><Users className="size-3.5 text-muted-foreground" aria-hidden="true" />Utanför appen
              <select className="form-select h-8 w-auto py-0" value={choices[card.id] ?? "hidden"} onChange={(event) => setChoices((current) => ({ ...current, [card.id]: event.target.value as PeopleChoice }))} data-testid="publish-people">
                {PEOPLE_CHOICES.map((choice) => <option key={choice} value={choice}>{PEOPLE_CHOICE_LABEL[choice]}</option>)}
              </select>
            </label> : null}
          </li>)}
        </ul> : <p className="text-sm text-muted-foreground">Tavlan har inga kort ännu.</p>}
        {preview.personal ? <p className="text-xs text-muted-foreground">Namn är dolda utanför appen om du inte väljer något annat. En länk utan kod och slutdatum visar aldrig namn. Orsak till frånvaro visas aldrig.</p> : null}
        {outside ? null : <p className="text-xs text-muted-foreground">Tavlan syns bara inne i appen tills du kopplar en skärm eller delar en länk.</p>}
      </section>
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Publicera", busy, busyLabel: "Publicerar…", testId: "publish-confirm", onClick: async () => {
        setBusy(true);
        try { if (await onPublish(choices)) onClose(); } finally { setBusy(false); }
      } }} />
    </div>}
  </Modal>;
}
