"use client";

import "driver.js/dist/driver.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { driver, type Driver, type DriveStep } from "driver.js";
import { Compass, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The guided tour of the form builder (2026-09-28, docs/guide-bibliotek.md): driver.js points at the builder's real
 * components through their `data-tour` attributes, dims the rest of the page and scrolls to each one. A step can
 * prepare the page first – switch to the preview, select a block so its settings show, open Grunduppgifter – so the
 * person never has to find a panel by themselves. Offered the first time the builder is opened; "Guide" restarts it.
 */
export type TourControls = {
  /** Show the build or the preview mode. */
  setMode: (mode: "build" | "preview") => void;
  /** Select a block whose settings show measurement, unit, formula and assessment; false when the form has none. */
  selectMeasured: () => boolean;
  clearSelection: () => void;
  /** Open Grunduppgifter (the form's details, report settings and limits). */
  openMeta: () => void;
};

type Step = { target: string[]; title: string; text: string; before?: (controls: TourControls) => void };

const STEPS: Step[] = [
  { target: ["builder-start"], title: "1. Nytt formulär eller en mall", text: "Börja med Nytt formulär, eller utgå från ett original eller ett formulär i Mina formulär." },
  { target: ["builder-meta"], title: "Grunduppgifter", text: "Namn, kategori, ikon, rapportens rubrik och gränsvärden.", before: (controls) => controls.openMeta() },
  { target: ["builder-blocks", "builder-sheet"], title: "2. Lägg till fält och kontrollpunkter", text: "Dra en byggsten till arket eller klicka på den. Avsnitt grupperar, Checklista ger kontrollpunkter och Tabell ger mätrader eller objektkort.", before: (controls) => { controls.setMode("build"); controls.clearSelection(); } },
  { target: ["builder-sheet"], title: "Organisera formuläret", text: "Dra block för att flytta dem. Ändra bredden i högerkanten." },
  { target: ["builder-properties", "builder-sheet"], title: "3. Mätvärden, enheter och bedömning", text: "Markera ett block för att ställa in enhet, decimaler, intervall, formler, godkänd-villkor och när det visas.", before: (controls) => { controls.setMode("build"); controls.selectMeasured(); } },
  { target: ["form-limit-settings", "builder-meta"], title: "Gränsvärden och larmnivåer", text: "Formuläret säger vad som mäts. Gränsvärdena anges per anläggning i protokollet.", before: (controls) => { controls.clearSelection(); controls.openMeta(); } },
  { target: ["block-attachment", "builder-blocks"], title: "4. Kamera, bilder och bilagor", text: "Foto/bilaga tar bilder eller filer i formuläret. Checklistor och mätrader kan få kamera på varje punkt.", before: (controls) => { controls.setMode("build"); controls.clearSelection(); } },
  { target: ["block-checklist", "builder-blocks"], title: "5. Kommentarer och avvikelser", text: "Ej OK, ett värde utanför gränsen eller ett markerat fält blir en avvikelse som kräver en kommentar.", before: (controls) => controls.setMode("build") },
  { target: ["builder-preview", "builder-mode"], title: "6. Förhandsgranska", text: "Så ser uppgiften ut, med exempeldata. Inget sparas.", before: (controls) => controls.setMode("preview") },
  { target: ["builder-pdf"], title: "PDF-rapporten", text: "PDF öppnar rapporten med exempeldata i en ny flik.", before: (controls) => controls.setMode("preview") },
  { target: ["builder-publish-group", "builder-bar"], title: "7. Spara, publicera och återanvänd", text: "Utkastet sparas automatiskt. Publicera gör formuläret till en uppgiftstyp under Ny uppgift.", before: (controls) => controls.setMode("build") },
];

const findTarget = (targets: string[]) => {
  for (const name of targets) {
    const element = document.querySelector<HTMLElement>(`[data-tour="${name}"]`);
    if (element && element.getClientRects().length) return element;
  }
  return undefined;
};

export function useBuilderTour({ seen, markSeen, controls }: { seen: boolean | null; markSeen: () => void; controls: TourControls }) {
  const tour = useRef<Driver | null>(null);
  const latest = useRef(controls);
  useEffect(() => { latest.current = controls; });
  // Offered once, the first time: until the person starts the tour or says not now.
  const [answered, setAnswered] = useState(false);
  const offer = seen === false && !answered;
  useEffect(() => () => tour.current?.destroy(), []);

  const start = useCallback(() => {
    setAnswered(true);
    tour.current?.destroy();
    // Each step is resolved when it is shown, after its preparation, so a panel opened by the step can be pointed at.
    const go = (index: number) => {
      const step = STEPS[index];
      step.before?.(latest.current);
      window.setTimeout(() => instance.moveTo(index), step.before ? 160 : 0);
    };
    // Every way out – Avsluta, Hoppa över, the close button, Esc or a click outside – ends here, once: back to the
    // build mode and marked as seen. (driver.js skips its onDestroyed hook when destroy() is called by hand.)
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      instance.destroy();
      latest.current.setMode("build");
      markSeen();
    };
    const steps: DriveStep[] = STEPS.map((step) => ({
      element: () => findTarget(step.target) ?? document.body,
      popover: { title: step.title, description: step.text },
    }));
    const instance = driver({
      steps, animate: true, smoothScroll: true, allowClose: true, overlayOpacity: 0.55, stagePadding: 6, stageRadius: 12, popoverClass: "workflow-tour",
      showProgress: true, progressText: "{{current}} av {{total}}", showButtons: ["next", "previous", "close"],
      nextBtnText: "Nästa", prevBtnText: "Föregående", doneBtnText: "Avsluta",
      onNextClick: () => { const index = instance.getActiveIndex() ?? 0; if (index >= STEPS.length - 1) { finish(); return; } go(index + 1); },
      onPrevClick: () => { const index = instance.getActiveIndex() ?? 0; if (index > 0) go(index - 1); },
      onPopoverRender: (popover) => {
        popover.wrapper.setAttribute("data-testid", "tour-popover");
        popover.wrapper.setAttribute("aria-live", "polite");
        popover.closeButton.setAttribute("aria-label", "Stäng guiden");
        // "Hoppa över": leave the tour at once from any step.
        const skip = document.createElement("button");
        skip.type = "button";
        skip.textContent = "Hoppa över";
        skip.className = "workflow-tour-skip";
        skip.addEventListener("click", finish);
        popover.footer.prepend(skip);
      },
      onDestroyStarted: finish,
    });
    tour.current = instance;
    STEPS[0].before?.(latest.current);
    instance.drive(0);
  }, [markSeen]);

  const dismiss = useCallback(() => { setAnswered(true); markSeen(); }, [markSeen]);
  const offerCard = offer ? <div role="region" aria-label="Guide till formulärbyggaren" className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-secondary px-4 py-3" data-testid="tour-offer">
    <span className="area-icon panel-icon" data-tone="solid" aria-hidden="true"><Compass className="size-4" /></span>
    {/* On a phone the text takes the row and the buttons go below it (F13, 2026-09-29). */}
    <p className="min-w-0 flex-1 basis-[14rem] text-sm"><strong className="font-semibold">Ny i formulärbyggaren?</strong> Ta en kort rundtur – guiden visar var allt finns på den här sidan.</p>
    <div className="flex w-full justify-end gap-2 sm:w-auto">
      <Button type="button" size="sm" onClick={start} data-testid="tour-start">Starta guiden</Button>
      <Button type="button" size="sm" variant="ghost" onClick={dismiss}><X />Inte nu</Button>
    </div>
  </div> : null;
  const helpButton = <Button type="button" variant="outline" onClick={start} data-testid="tour-help" data-tour="builder-help" title="Visa guiden till formulärbyggaren"><Compass />Guide</Button>;
  return { start, offerCard, helpButton };
}

/**
 * Whether the person has seen the tour: stored in the person's preferences on the server (the same in Cloud and
 * Local, where the file's owner is signed in too), with the browser's own storage when no server is at hand
 * (a future Community installation).
 */
export function useTourSeen(initial: boolean | undefined, save?: () => Promise<void>) {
  const key = "workflow.tour.formBuilder";
  const [local, setLocal] = useState(() => { try { return window.localStorage.getItem(key) === "seen"; } catch { return false; } });
  const seen = initial === undefined ? local : initial || local;
  const markSeen = useCallback(() => {
    setLocal(true);
    try { window.localStorage.setItem(key, "seen"); } catch { /* the browser's storage may be off; the server keeps it */ }
    void save?.().catch(() => undefined);
  }, [save]);
  return { seen, markSeen };
}
