"use client";

import { AdvancedFold } from "@/features/workflow/section-tabs";

/**
 * Fast skärm eller delad länk? (2026-11-20: the difference, also in security, was not clear – "man kan ju dela koden"). The same
 * folded section on both tabs, open until closed; the device remembers it (one key, so closing it on one tab closes it on both).
 */
export function WaysOutHelp() {
  return <AdvancedFold title="Fast skärm eller delad länk?" summary="Vad skillnaden är och hur de skyddas" remember="boards-ways-out" testId="boards-ways-help">
    <div className="grid gap-5 text-sm sm:grid-cols-2">
      <section className="space-y-1.5">
        <h3 className="font-semibold">Fast skärm</h3>
        <p className="text-muted-foreground">Er egen skärm, till exempel tv:n i hallen. Den godkänns en gång med en kod.</p>
        <p className="text-muted-foreground">Koden gäller i tio minuter, bara en gång och bara i webbläsaren som visar den. Den går alltså inte att dela.</p>
        <p className="text-muted-foreground">Efter godkännandet får skärmen en egen nyckel som stannar i dess webbläsare. Här ser du skärmen: online eller offline, när den hördes av senast och vilken tavla den visar. Du kan byta tavla härifrån och spärra skärmen.</p>
        <p className="text-muted-foreground">En skärm som inte har hörts av på 30 dagar kopplas bort av sig själv.</p>
      </section>
      <section className="space-y-1.5">
        <h3 className="font-semibold">Delad länk</h3>
        <p className="text-muted-foreground">En adress du ger en person, till exempel en kund eller en chef, som ska titta i sin egen webbläsare eller telefon.</p>
        <p className="text-muted-foreground">Allt som behövs finns i länken. Alla som har den kan titta och kan skicka den vidare, och du ser inte vem som tittar.</p>
        <p className="text-muted-foreground">Så skyddar du den: kräv en kod, ge länken en ny adress (då slutar den gamla fungera direkt, också där den redan är öppen) eller spärra den.</p>
      </section>
    </div>
    <div className="space-y-1.5 text-sm">
      <p><span className="font-semibold">Tumregel:</span> en skärm på väggen blir en fast skärm. En person som ska titta får en delad länk.</p>
      <p className="text-muted-foreground">Gemensamt: ingen inloggning på skärmen, tavlan går bara att titta på, och båda kan spärras när som helst.</p>
    </div>
  </AdvancedFold>;
}
