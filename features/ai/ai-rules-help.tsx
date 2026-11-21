import { Ban, Check, ShieldCheck, UserRoundX } from "lucide-react";
import { Panel } from "@/features/kfid/ui";
import { cn } from "@/lib/utils";

/**
 * Hjälp → Workflow AI (UX-granskningen C4, 2026-10-22): what AI does and never does, and how names are replaced by
 * aliases. These were two information panels under Arbetssätt; they are no settings, so they live in Hjälp, and
 * Arbetssätt links here (`/?view=help&step=ai#hjalp-ai`). The rules hold in every company and cannot be changed.
 */
export function AiRulesHelp() {
  return <div className="space-y-6" id="hjalp-ai" data-testid="help-ai">
    <Panel icon={ShieldCheck} title="Vad Workflow AI gör – och aldrig gör" description="Det här gäller alltid och kan inte ändras.">
      <div className="grid gap-4 md:grid-cols-2">
        <ul className="space-y-2 text-sm">
          <Rule ok text="Svarar på frågor i Workflow AI-chatten." />
          <Rule ok text="Analyserar en fil på sidan Import, när personen själv bockar i AI-analys." />
          <Rule ok text="Resonerar kring nästa steg när någon trycker på Fråga Workflow AI vid ett tips i arbetsflödet." />
          <Rule ok text="Föreslår arbetsordrar, materialrader, tid, planering, offerter, skyddsåtgärder och sammanfattningar när någon ber om det – även i chatten. Inget skapas förrän personen har bekräftat, och det går att ångra." />
          <Rule ok text="Granskar ett sparat protokoll när någon trycker på Granska med AI, och pekar på det som bör kontrolleras." />
          <Rule ok text="Tipsen under progressionslinjen bygger på regler i Workflow och använder ingen AI." />
        </ul>
        <ul className="space-y-2 text-sm">
          <Rule text="Skapar, ändrar, slutför eller signerar aldrig något på egen hand – det gör alltid en person." />
          <Rule text="Avgör aldrig om något är säkert, godkänt eller klart att ta i drift – det gör en behörig person." />
          <Rule text="Arbetar aldrig i bakgrunden, utom dagsammanställningen om företaget har valt den." />
          <Rule text="Ser aldrig hela sidan, bara det servern hämtar inom personens behörighet." />
          <Rule text="Får aldrig ett annat företags uppgifter." />
          <Rule text="Workflow ber leverantören att inte spara svaren. Leverantören kan ändå spara dem en begränsad tid för att upptäcka missbruk." />
        </ul>
      </div>
    </Panel>
    <Panel icon={UserRoundX} title="Namn ersätts med alias" description="Namn ur registren, adresser, e-post och nummer byts mot platshållare. Namn du skriver i fri text kan följa med.">
      <p className="text-sm leading-6">Innan något lämnar Workflow byts namn på projekt, kunder, personer och anläggningar, adresser, postnummer, e-post, telefon- och personnummer mot platshållare. Svaret byts tillbaka innan det visas, så du läser de riktiga namnen.</p>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3" aria-label="Exempel">
        {[["Strömgatan 5, 352 30 Växjö", "[Adress 1], [Postnummer 1]"], ["Elkraft i Småland AB", "[Kund 1]"], ["anna@exempel.invalid · 070-174 06 41", "[E-post 1] · [Telefon 1]"]].map(([real, alias]) => <div key={real} className="rounded-lg border bg-muted/30 p-2.5"><dt className="text-muted-foreground">{real}</dt><dd className="mt-1 font-mono text-[11px] font-medium">→ {alias}</dd></div>)}
      </dl>
    </Panel>
  </div>;
}

function Rule({ ok = false, text }: { ok?: boolean; text: string }) {
  return <li className="flex items-start gap-2"><span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", ok ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300")}>{ok ? <Check className="size-3" /> : <Ban className="size-3" />}</span>{text}</li>;
}
