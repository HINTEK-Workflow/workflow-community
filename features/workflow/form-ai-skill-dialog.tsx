"use client";

import { Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DownloadButton } from "@/components/ui/download-button";
import { Modal } from "@/features/kfid/ui";
import { openFormAiChat, useFormAiAvailable } from "@/features/ai/form-ai-store";

/** Where the skill package is downloaded (app/api/forms/admin/ai-skill/route.ts). */
export const FORM_AI_SKILL_URL = "/api/forms/admin/ai-skill";

const STEPS = [
  ["Ladda ner paketet", "Det innehåller instruktioner, en mall och exempel för AI:n."],
  ["Ge filerna till din AI", "Lägg till din beskrivning eller ditt dokument, till exempel en PDF, ett Word-dokument eller en Excel-fil."],
  ["Importera resultatet", "Spara filen som AI:n skapar och importera den här. Formuläret blir ett utkast som du granskar och publicerar."],
] as const;

/**
 * "Skapa formulär med extern AI" (2026-11-24): a small dialog beside the form import, with the three steps, the download
 * of the skill package and the import of what the AI wrote. Works with any AI that reads files (ChatGPT, Claude, Gemini,
 * Copilot …); the package holds nothing of the company.
 *
 * Formulär med Workflow AI (2026-11-25): when the company uses Workflow AI and the person may build forms with it, the dialog
 * first offers "Skapa med Workflow AI", which opens the chat in form mode; the external way stays below for those who want it.
 */
export function FormAiSkillDialog({ open, onOpenChange, onImport, busy }: { open: boolean; onOpenChange: (open: boolean) => void; onImport: () => void; busy?: boolean }) {
  const hintekAi = useFormAiAvailable(open);
  const steps = <>
    <ol className="space-y-3">
      {STEPS.map(([title, text], index) => <li key={title} className="flex gap-3 text-sm">
        <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-primary">{index + 1}</span>
        <span className="min-w-0"><span className="block font-medium">{title}</span><span className="block text-muted-foreground">{text}</span></span>
      </li>)}
    </ol>
    <p className="text-xs text-muted-foreground">Paketet innehåller inga uppgifter om ert företag. Dela inte personuppgifter med AI:n, och granska formuläret innan du publicerar det.</p>
    <div className="flex flex-wrap justify-end gap-2">
      <DownloadButton href={FORM_AI_SKILL_URL} download data-testid="form-ai-skill-download">Ladda ner paketet</DownloadButton>
      <Button type="button" onClick={onImport} busy={busy} busyLabel="Importerar…" data-testid="form-ai-skill-import"><Upload />Importera resultatet</Button>
    </div>
  </>;
  return <Modal open={open} onOpenChange={onOpenChange} title={hintekAi ? "Skapa formulär med AI" : "Skapa formulär med extern AI"} size="compact">
    <div className="space-y-4" data-testid="form-ai-skill-dialog">
      {hintekAi ? <>
        <section className="space-y-3 rounded-lg border p-3" aria-labelledby="form-ai-hintek-title" data-testid="form-ai-hintek">
          <div className="min-w-0">
            <h3 id="form-ai-hintek-title" className="text-sm font-semibold">Med Workflow AI</h3>
            <p className="mt-1 text-sm text-muted-foreground">Beskriv protokollet i chatten, eller bifoga en bild av ert eget protokoll. Du får ett förslag och sparar det som utkast.</p>
          </div>
          <div className="flex justify-end">
            <Button type="button" onClick={() => { onOpenChange(false); openFormAiChat(); }} data-testid="form-ai-hintek-open"><Sparkles />Skapa med Workflow AI</Button>
          </div>
        </section>
        <section className="space-y-4" aria-labelledby="form-ai-external-title">
          <div className="min-w-0">
            <h3 id="form-ai-external-title" className="text-sm font-semibold">Med extern AI</h3>
            <p className="mt-1 text-sm text-muted-foreground">Låt en AI som ChatGPT, Claude, Gemini eller Copilot skapa formuläret, och importera det sedan här.</p>
          </div>
          {steps}
        </section>
      </> : <>
        <p className="text-sm text-muted-foreground">Låt en AI som ChatGPT, Claude, Gemini eller Copilot skapa ett formulär åt dig, och importera det sedan i Workflow.</p>
        {steps}
      </>}
    </div>
  </Modal>;
}
