import { Panel } from "@/features/kfid/ui";

/**
 * Så fungerar arbetsflödet (2026-10-01: "jag förstår inte själv flödet – beskriv vad som händer vid varje steg,
 * vilka val användaren har och vad som blir resultatet"). The same text as docs/ARBETSFLODE.md, shown under Hjälp.
 * The steps are the ones on the progress line in every task.
 */
type Step = { name: string; what: string; choices?: string; result: string };

const WORK_ORDER: Step[] = [
  { name: "1. Beställning", what: "Skriv en rubrik och vad som ska göras. Spara.", choices: "Koppla till ett projekt (då följer kunden och projektets datum med) eller låt den stå fristående. Välj kund och anläggning.", result: "Arbetsordern finns och syns under Mina arbetsordrar. Status: Planerad." },
  { name: "2. Planering (valfri)", what: "Välj ansvarig och Klart senast.", choices: "Hoppa över om arbetet görs direkt.", result: "Den ansvarige ser arbetsordern under Mina uppgifter och får påminnelse när datumet närmar sig eller passeras." },
  { name: "3. Utförande", what: "Tryck Starta tid när du börjar. Skriv vad som gjorts under Utfört arbete, lägg till material, avvikelser och bilder.", choices: "Pausa tid när du gör uppehåll. Starta tid igen när du fortsätter. Startar du tid på en annan uppgift pausas den här automatiskt.", result: "Status blir Pågår när tiden går och Pausad när du pausar. Tiden syns i toppraden, i Tidrapport och på projektet." },
  { name: "4. Signering", what: "Skriv namnet på den som signerar och bocka i att dokumentationen är granskad.", result: "Arbetsordern är klar att slutföra; progressionslinjen visar Slutförd som nästa steg." },
  { name: "5. Slutförd", what: "Tryck Slutför uppgift längst ned.", choices: "En ruta frågar Vill du skriva tid? – Ja, skriv tid (datum, från, till och anteckning) eller Nej, slutför utan ny tid. Saknas något visas det i stället, med länk till fältet.", result: "Tidtagningen stoppas, arbetsordern låses och blir 100 % och Slutförd. Nästa steg visas: projektets nästa uppgift, tillbaka till protokollet den kom från, projektet och tiden. Den kan återöppnas; då krävs ny signering." },
];

const SECTIONS: { title: string; steps: Step[] }[] = [
  { title: "Riskbedömning", steps: [
    { name: "Grunduppgifter → Risker → Godkännande → Slutförd", what: "Lägg till varje fara som en egen risk med skyddsåtgärd och bedömning före och efter. Den som granskat anger namn och bekräftar.", result: "Hög kvarvarande risk markeras rött och ger ett tips om att arbetet inte bör starta. Slutför fungerar som för arbetsordern, med frågan om tid." },
  ] },
  { title: "Kontroll före idrifttagning och protokoll", steps: [
    { name: "Grunduppgifter → Kontrollmoment / Ifyllnad → Mätningar → Sammanfattning → Färdigställd", what: "Fyll i projekt eller anläggning, välj moment och registrera mätvärden. Avvikelser beskrivs i sammanfattningen.", choices: "En avvikande rad i ett protokoll kan bli en arbetsorder direkt på raden.", result: "Färdigställ frågar om tid som en uppgift, låser protokollet och gör rapporten klar. Ändringar görs sedan med Spara som (en kopia), aldrig i originalet." },
  ] },
  { title: "Projekt", steps: [
    { name: "Skapat → Uppgifter → Utförande → Uppgifterna klara → Avslutat", what: "Ett projekt är ramen: kund, tidsram och ansvarig. Arbetet görs i uppgifterna som skapas i eller kopplas till projektet.", result: "Progressionen räknas bara från uppgifterna. När alla är slutförda står projektet som Klar att avsluta, och projektansvarig eller admin trycker Avsluta projekt." },
  ] },
];

export function WorkflowGuide() {
  return <div className="space-y-6" data-testid="workflow-guide">
    <Panel title="Så fungerar arbetsflödet" description="Varje uppgift har en progressionslinje under rubriken. Den visar stegen, var du är (Nu: …) och vad du ska göra. Klicka på ett steg för att komma dit.">
      <ol className="space-y-4 text-sm leading-6">
        {WORK_ORDER.map((step) => <StepRow key={step.name} step={step} />)}
      </ol>
      <p className="notice mt-5">Arbetsorder används som exempel. Alla uppgifter har samma sidhuvud, samma Starta tid, samma Exportera och samma fråga om tid när de slutförs.</p>
    </Panel>
    <div className="grid gap-6 lg:grid-cols-2">
      {SECTIONS.map((section) => <Panel key={section.title} title={section.title}>
        <ol className="space-y-4 text-sm leading-6">{section.steps.map((step) => <StepRow key={step.name} step={step} />)}</ol>
      </Panel>)}
      <Panel title="Tid" description="En tidtagning per person.">
        <ul className="list-disc space-y-2 pl-5 text-sm leading-6">
          <li><strong>Starta tid</strong> sparar uppgiften först om den är ny, och sätter den som Pågår.</li>
          <li>Startar du tid på en annan uppgift pausas den förra automatiskt. Kollegors tid påverkas aldrig.</li>
          <li>Tiden syns i toppraden med en pausknapp, på alla sidor. En tidtagning som stoppas inom första minuten sparas inte.</li>
          <li>Glömde du starta? Skriv tiden när du slutför, eller i Tidrapport. En slutförd uppgift tar inte emot ny tid (admin kan rätta med kommentar).</li>
        </ul>
      </Panel>
      <Panel title="Tips i arbetsflödet" description="Beslutsstöd som följer progressionen.">
        <ul className="list-disc space-y-2 pl-5 text-sm leading-6">
          <li>Under progressionslinjen visas ibland ett tips: tiden går på en annan uppgift, ingen tid är registrerad, datumet har passerat, allt är klart att slutföra.</li>
          <li>Tipsen bygger på regler i Workflow och kostar inga krediter. Fråga Workflow AI på ett tips använder AI-modellen om företaget har slagit på den.</li>
          <li><strong>Inte nu</strong> döljer tipset på den uppgiften, <strong>Visa inte sådana tips</strong> stänger av det helt. Hur ofta tips visas – Ofta, Normalt, Sällan eller Av – väljer du under Inställningar.</li>
        </ul>
      </Panel>
    </div>
  </div>;
}

function StepRow({ step }: { step: Step }) {
  return <li className="rounded-lg border p-3">
    <p className="font-semibold">{step.name}</p>
    <p className="mt-1"><span className="text-muted-foreground">Gör: </span>{step.what}</p>
    {step.choices ? <p className="mt-1"><span className="text-muted-foreground">Val: </span>{step.choices}</p> : null}
    <p className="mt-1"><span className="text-muted-foreground">Resultat: </span>{step.result}</p>
  </li>;
}
