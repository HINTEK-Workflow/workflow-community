import { ArrowDown, ArrowRight, CalendarClock, ClipboardCheck, Clock3, FolderKanban, GanttChart, Link2, ShieldCheck, OctagonAlert, ClipboardList, Network } from "lucide-react";
import { Panel } from "@/features/kfid/ui";

/**
 * Så hänger det ihop (2026-10-08, Fas 4B; rewritten 2026-10-26, Arbetsordern styr): the core model in plain Swedish
 * under Hjälp – project (optional) → work order → tasks, time on the work order or the project, the risk step on the work
 * order, rounds as one work order per occurrence, deviation → follow-up. The
 * picture is plain HTML with the theme's tokens, so it reads in light and dark and stacks at phone width.
 */
const STEPS = ["Beställning", "Riskbedömning", "Utförande", "Signering", "Färdigställd"] as const;

export function CoreModelGuide() {
  return <section id="sa-hanger-det-ihop" data-testid="help-core-model" className="scroll-mt-24">
    <Panel icon={Network} title="Så hänger det ihop" description="Projekt, arbetsordrar, steg, tid och riskbedömning – på en minut.">
      <div className="space-y-5 text-sm leading-6">
        <figure aria-labelledby="core-model-caption" className="rounded-xl border bg-muted/30 p-3 sm:p-4">
          <figcaption id="core-model-caption" className="sr-only">Ett projekt är valfritt och samlar arbetsordrar. Arbetsordern styr arbetet och går genom stegen Beställning, Riskbedömning, Utförande, Signering och Färdigställd. I arbetsordern ligger en eller flera uppgifter. Tiden rapporteras på arbetsordern eller på projektet, och en avvikelse blir en uppföljande arbetsorder.</figcaption>
          <div aria-hidden="true" className="flex flex-col items-stretch gap-2">
            <ModelBox icon={<FolderKanban />} title="Projekt" note="valfritt – kund, plats, tidsram, budget" dashed />
            <ArrowDown className="mx-auto size-4 text-muted-foreground" />
            <div className="rounded-xl border-2 border-primary/40 bg-card p-3">
              <p className="flex items-center gap-2 font-semibold"><ClipboardList className="size-4 text-primary" />Arbetsorder</p>
              <div className="mt-2 grid gap-2">
                <span className="rounded-lg border bg-secondary/60 px-3 py-2 text-xs"><strong className="block text-sm">Uppgifter</strong>protokoll, kontroller och riskbedömningar – en eller flera i varje arbetsorder</span>
              </div>
              <ol className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                {STEPS.map((step, index) => <li key={step} className="flex items-center gap-1.5">
                  <span className="rounded-full border bg-card px-2.5 py-1 font-medium">{index + 1}. {step}</span>
                  {index < STEPS.length - 1 ? <ArrowRight className="size-3.5 text-muted-foreground" /> : null}
                </li>)}
              </ol>
            </div>
            <ArrowDown className="mx-auto size-4 text-muted-foreground" />
            <div className="grid gap-2 sm:grid-cols-3">
              <ModelBox icon={<Link2 />} title="Uppgifter" note="ärver arbetsorderns kund och projekt" />
              <ModelBox icon={<Clock3 />} title="Tid" note="på arbetsordern eller projektet" />
              <ModelBox icon={<OctagonAlert />} title="Avvikelse" note="blir en uppföljande arbetsorder" />
            </div>
          </div>
        </figure>
        <dl className="grid gap-4 md:grid-cols-2">
          <Fact icon={<FolderKanban />} term="Projekt är valfritt">Ett projekt samlar arbetsordrar och projekttid med kund, plats, tidsram och budget. En liten arbetsorder behöver inget projekt.</Fact>
          <Fact icon={<ClipboardList />} term="Arbetsordern styr">Allt arbete görs i en <strong>arbetsorder</strong>. En uppgift (ett protokoll, en kontroll eller en riskbedömning) kan skapas först och sparas som utkast, men kopplas med <strong>Koppla till arbetsorder</strong> innan arbetet börjar. Ett utkast märks <strong>Saknar arbetsorder</strong>.</Fact>
          <Fact icon={<ClipboardCheck />} term="Stegen">Arbetsordern går genom Beställning, Riskbedömning, Utförande, Signering och Färdigställd. Tryck <strong>Varför kan jag inte gå vidare?</strong> för att se vad som saknas.</Fact>
          <Fact icon={<Link2 />} term="Uppgifterna">Arbetsordern visar sina uppgifter under <strong>Uppgifter</strong>, med <strong>Lägg till uppgift</strong>. En uppgift har egen rubrik, ansvarig, klart senast och plats. Kund och projekt följer arbetsordern.</Fact>
          <Fact icon={<Clock3 />} term="Tiden">Tid rapporteras på en <strong>arbetsorder</strong> eller på ett <strong>projekt</strong> (projekttid, till exempel projektledning och möten), med timer eller i Tid. Startar du tid i en uppgift räknas den på arbetsordern. Du har en timer i taget.</Fact>
          <Fact icon={<ShieldCheck />} term="Riskbedömningen">Riskbedömningen görs på arbetsordern och gäller alla uppgifter i den. Som standard är den förenklad: du svarar på några frågor och bekräftar. <strong>Utökad</strong> krävs när ett svar är Nej eller Osäker, eller om du väljer det. Tiden kan startas först när steget är klart.</Fact>
          <Fact icon={<CalendarClock />} term="Driftronder">En rond har ett formulär, hur ofta den ska göras och en ansvarig. En arbetsorder samlar ronden under en period, till exempel ett år, och har kund och plats. Varje gång ronden startas registreras ett nytt tillfälle i den, efter en kort säkerhetsavstämning. Ingen arbetsorder skapas av sig själv. En missad rond syns som förfallen.</Fact>
          <Fact icon={<GanttChart />} term="Planering"><strong>Planering</strong> i menyn har vyerna Kalender, Tidplan och Kapacitet. Tidplan samlar ett projekts tidplan, bokningar, hinder och timmar. Med Alla projekt ser du alla projekt på en tidsaxel.</Fact>
          <Fact icon={<CalendarClock />} term="Kalender"><strong>Kalender</strong>, under Planering, är teamets kalender: bokningar per person och dag, aktiviteter och driftronder.</Fact>
          <Fact icon={<OctagonAlert />} term="Avvikelser">En avvikelse i ett protokoll blir en <strong>uppföljande arbetsorder</strong> direkt på raden. Den länkar tillbaka till protokollet, och raden visar hur det går.</Fact>
        </dl>
      </div>
    </Panel>
  </section>;
}

function ModelBox({ icon, title, note, dashed = false }: { icon: React.ReactNode; title: string; note: string; dashed?: boolean }) {
  return <div className={`rounded-xl border bg-card px-3 py-2 ${dashed ? "border-dashed" : ""}`}>
    <p className="flex items-center gap-2 font-semibold [&_svg]:size-4 [&_svg]:text-primary">{icon}{title}</p>
    <p className="text-xs text-muted-foreground">{note}</p>
  </div>;
}

function Fact({ icon, term, children }: { icon: React.ReactNode; term: string; children: React.ReactNode }) {
  return <div className="rounded-lg border p-3">
    <dt className="flex items-center gap-2 font-semibold [&_svg]:size-4 [&_svg]:text-primary">{icon}{term}</dt>
    <dd className="mt-1 text-muted-foreground">{children}</dd>
  </div>;
}
