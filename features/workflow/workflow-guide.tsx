"use client";

import { Route, Clock3, Repeat, SlidersHorizontal, Lightbulb, Bell, Archive } from "lucide-react";
import { Panel } from "@/features/kfid/ui";
import { NativeScreen } from "@/components/native/screen";
import { useInstance } from "@/components/instance-provider";
import { GUIDE_SECTIONS, GUIDE_WORK_ORDER, type GuideStep as Step } from "@/lib/help/guide-steps";

/**
 * Så fungerar arbetsflödet (2026-10-01: "jag förstår inte själv flödet – beskriv vad som händer vid varje steg,
 * vilka val användaren har och vad som blir resultatet"). The same text as docs/ARBETSFLODE.md, shown under Hjälp.
 * The steps are the ones on the progress line in every task.
 */
// The steps live in lib/help/guide-steps.ts (2026-11-21), so the help search reads the same words.
const WORK_ORDER = GUIDE_WORK_ORDER;
const SECTIONS = GUIDE_SECTIONS;


export function WorkflowGuide() {
  // Credits exist in Cloud only (2026-11-20): elsewhere the tips are simply free of AI.
  const credits = useInstance().features.credits;
  return <div className="space-y-6" data-testid="workflow-guide">
    <NativeScreen show={["arbetsflode"]} lead><Panel icon={Route} title="Så fungerar arbetsflödet" description="Varje uppgift har en progressionslinje under rubriken. Den visar stegen, var du är (Nu: …) och vad du ska göra. Klicka på ett steg för att komma dit.">
      <ol className="space-y-4 text-sm leading-6">
        {WORK_ORDER.map((step) => <StepRow key={step.name} step={step} />)}
      </ol>
      <p className="notice mt-5">Arbetsorder används som exempel. Alla uppgifter har samma sidhuvud, samma Starta tid, samma Exportera och samma fråga om tid när de färdigställs.</p>
    </Panel></NativeScreen>
    <div className="grid gap-6 lg:grid-cols-2">
      {SECTIONS.map((section) => <NativeScreen key={section.title} show={[section.key]} lead><Panel title={section.title}>
        <ol className="space-y-4 text-sm leading-6">{section.steps.map((step) => <StepRow key={step.name} step={step} />)}</ol>
      </Panel></NativeScreen>)}
      <NativeScreen show={["tid"]} lead><Panel icon={Clock3} title="Tid" description="Var och en har en tidtagning igång åt gången.">
        <ul className="list-disc space-y-2 pl-5 text-sm leading-6">
          <li><strong>Starta tid</strong> sparar uppgiften först om den är ny, och sätter den som Pågår.</li>
          <li>Startar du tid på en annan uppgift pausas den förra automatiskt. Kollegors tid påverkas aldrig.</li>
          <li>Tiden syns i toppraden med en pausknapp, på alla sidor. En tidtagning som stoppas inom första minuten sparas inte.</li>
          <li>Glömde du starta? Skriv tiden när du färdigställer, eller i Tidrapport. En färdigställd uppgift tar inte emot ny tid (en administratör kan rätta den med en kommentar).</li>
        </ul>
      </Panel></NativeScreen>
      <NativeScreen show={["ronder"]} lead><Panel icon={Repeat} title="Driftronder och Kalender" description="Kalendern är bara en planering.">
        <ul className="list-disc space-y-2 pl-5 text-sm leading-6">
          <li>I kalendern under Planering visas rondernas tillfällen bland aktiviteterna, uträknade ur rondens schema. De är inga planerade aktiviteter och ändras bara under Driftronder.</li>
          <li><strong>Starta nu</strong> på en rond skapar protokollet av rondens formulär i arbetsordern som håller ronden. Protokollet får arbetsorderns kund och plats och rondens ansvarig, och kopplas till tillfället. Det går alla dagar – också före dagen, och för ett missat tillfälle.</li>
          <li>Ett tillfälle som har ett protokoll räknas som påbörjat eller utfört. Nästa tillfälle är då nästa som ännu inte är gjort, så att en rond som startats i förväg inte visas som kommande igen.</li>
        </ul>
      </Panel></NativeScreen>
      <NativeScreen show={["funktioner"]} lead><Panel icon={SlidersHorizontal} title="Funktioner att slå på" description="Företagets administratör ställer in det under Inställningar › Arbetssätt.">
        <ul className="list-disc space-y-2 pl-5 text-sm leading-6">
          <li><strong>Objektdata på platser</strong>: driftstatus och typskylt på kundernas platser, och vyn Alla objekt under Kunder. Det som skrivits finns kvar om valet stängs av.</li>
          <li><strong>Workflow AI</strong> slås på och ställs in under Workflow AI. Raden i Funktioner leder dit.</li>
          <li><strong>Webb och inlägg</strong> är av från början. Slå på modulen så finns Inlägg och Min webbsida under Mer › Webb och inlägg. Kontona kopplas under Inställningar → Kopplingar.</li>
        </ul>
      </Panel></NativeScreen>
      <NativeScreen show={["tips"]} lead><Panel icon={Lightbulb} title="Tips i arbetsflödet" description="Tips som hjälper dig att välja nästa steg i arbetet.">
        <ul className="list-disc space-y-2 pl-5 text-sm leading-6">
          <li>Under progressionslinjen visas ibland ett tips: tiden går på en annan uppgift, ingen tid är registrerad, datumet har passerat, allt är klart att färdigställa.</li>
          <li>Tipsen bygger på regler i Workflow{credits ? " och kostar inga krediter" : " och använder ingen AI"}. Fråga Workflow AI på ett tips använder AI-modellen om företaget har slagit på den.</li>
          <li><strong>Inte nu</strong> döljer tipset på den uppgiften, <strong>Visa inte sådana tips</strong> stänger av det helt. Hur ofta tips visas – Ofta, Normalt, Sällan eller Av – väljer du under Inställningar.</li>
        </ul>
      </Panel></NativeScreen>
      {/* Notiser per e-post och push, Rapportarkiv (2026-10-07). */}
      <NativeScreen show={["notiser"]} lead><Panel icon={Bell} title="Notiser" description="Allt samlat i en lista. Det som kräver åtgärd kommer också som e-post och push.">
        <ul className="list-disc space-y-2 pl-5 text-sm leading-6" data-testid="help-notices">
          <li>Klockan i toppraden räknar det som är nytt för dig. Listan har flikarna Till mig och Teamet, Oläst och Läst, och Läs alla. Teamet ser bara den som har rätten Teamet.</li>
          <li>Kräver åtgärd står överst: hinder, anmälningspliktigt, avvikelse med hög grad, felanmälan och frånvarokrock. Det kommer också som e-post och push från början. Du kan stänga av det.</li>
          <li>Under <strong>Mina inställningar → Notiser</strong> väljer du själv om samma påminnelser också ska komma som e-post eller som push på din enhet, och vilka sorter du vill ha. Övriga sorter är avstängda från början.</li>
          <li>E-posten kommer som ett samlat meddelande med nyheter. Push är en kort notis på enheten, även när Workflow är stängt. Samma notis skickas aldrig två gånger och aldrig på natten.</li>
          <li>Push kräver att systemadministratören slagit på webbpush och att webbläsaren tillåter notiser. På iPhone och iPad måste Workflow vara installerat på hemskärmen.</li>
        </ul>
      </Panel></NativeScreen>
      <NativeScreen show={["rapportarkiv"]} lead><Panel icon={Archive} title="Rapportarkiv" description="PDF- och Excel-rapporter som du har sparat.">
        <ul className="list-disc space-y-2 pl-5 text-sm leading-6" data-testid="help-report-archive">
          <li>När du exporterar en rapport kan du välja <strong>Spara i rapportarkivet</strong>. Då sparas en kopia som du hittar under Rapportarkiv i menyn och kan hämta igen. Förhandsgranska och tomma mallar sparas inte.</li>
          <li><strong>Mina</strong> visar det du själv har sparat, <strong>Alla</strong> det du får se. Du ser bara rapporter över sådant du har behörighet att läsa.</li>
          <li>Rapporterna sparas lika länge som företagets historik (Inställningar → Företag → Historik och lagring). Du kan ta bort dina egna rapporter, en administratör alla.</li>
          <li>Rapportarkivet finns för företag som sparar sina uppgifter med serverlagring.</li>
        </ul>
      </Panel></NativeScreen>
    </div>
  </div>;
}

/** One step of a guide under Hjälp (Gör, Val, Resultat); also the chapter Din egen AI-app (features/ai/own-ai-help.tsx). */
export function StepRow({ step }: { step: Step }) {
  return <li className="rounded-lg border p-3">
    <p className="font-semibold">{step.name}</p>
    <p className="mt-1"><span className="text-muted-foreground">Gör: </span>{step.what}</p>
    {step.choices ? <p className="mt-1"><span className="text-muted-foreground">Val: </span>{step.choices}</p> : null}
    <p className="mt-1"><span className="text-muted-foreground">Resultat: </span>{step.result}</p>
  </li>;
}
