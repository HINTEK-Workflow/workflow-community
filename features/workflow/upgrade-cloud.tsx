import { Bot, Cloud, KeyRound, Sparkles, Users } from "lucide-react";
import { Panel } from "@/features/kfid/ui";

/**
 * Uppgradera till Cloud (2026-10-03): a free company in Local meets what Cloud adds instead of a credit balance
 * it cannot use – AI, and therefore credits, only works in Cloud. Buying happens below for the company's admin.
 */
export function UpgradeToCloud({ admin }: { admin: boolean }) {
  const points = [
    { icon: Sparkles, title: "HINTEK AI", text: "Chatt, förslag, granskning och import med AI. AI-krediter köps när företaget har Cloud." },
    { icon: Users, title: "Hela teamet", text: "Medarbetare arbetar i samma projekt och uppgifter, från dator, surfplatta och telefon." },
    { icon: Cloud, title: "Lagring och backup hos HINTEK", text: "Ingen egen fil att hålla reda på. Det du har i Local kan läsas in i Cloud." },
    { icon: KeyRound, title: "API och MCP", text: "Koppla ChatGPT, Claude eller egna system till företagets data." },
  ];
  return <Panel title="Uppgradera till HINTEK Cloud" description="Gratis i Local: hela Workflow i den egna filen. Cloud lägger till det som kräver att datan finns hos HINTEK."
    leadingActions={<span className="panel-icon" aria-hidden="true"><Bot className="size-4" /></span>}>
    <ul className="grid gap-3 sm:grid-cols-2" data-testid="upgrade-cloud">
      {points.map((point) => <li key={point.title} className="flex gap-3 rounded-lg border p-3">
        <point.icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <span><span className="block text-sm font-medium">{point.title}</span><span className="block text-xs text-muted-foreground">{point.text}</span></span>
      </li>)}
    </ul>
    <p className="mt-4 text-sm text-muted-foreground">{admin ? "Beställ Cloud nedan. Krediter för AI kan köpas när Cloud är aktivt." : "Prata med företagets administratör om ni vill uppgradera."}</p>
  </Panel>;
}
