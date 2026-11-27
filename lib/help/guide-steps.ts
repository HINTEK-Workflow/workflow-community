/**
 * Så fungerar arbetsflödet (Hjälp): the steps of a work order and the sections for the risk assessment, the protocol and the
 * project, as plain data. Shown by features/workflow/workflow-guide.tsx and searched by the help search (lib/help/help-search.ts),
 * so the page and Workflow AI read the same words. `key` is the chapter's step under Hjälp (`/?view=help&step=<key>`).
 */
export type GuideStep = { name: string; what: string; choices?: string; result: string };

export const GUIDE_WORK_ORDER_KEY = "arbetsflode";

export const GUIDE_WORK_ORDER: GuideStep[] = [
  { name: "1. Beställning", what: "Skriv en rubrik och vad som ska göras. Spara.", choices: "Koppla till ett projekt (då följer kunden och projektets datum med) eller låt den stå utan projekt. Välj kund och anläggning. Lägg till uppgifter (protokoll, kontroller, riskbedömningar) i arbetsordern.", result: "Arbetsordern finns och syns under Mina arbetsordrar. Status: Planerad." },
  { name: "2. Planering (valfri)", what: "Välj ansvarig och Klart senast.", choices: "Hoppa över om arbetet görs direkt.", result: "Den ansvarige ser arbetsordern under Arbetsordrar och får påminnelse när datumet närmar sig eller passeras." },
  { name: "3. Riskbedömning", what: "Svara på frågorna i Riskbedömning och bekräfta. Om ett svar visar en risk gör du en utökad riskbedömning med ett tryck.", choices: "Du kan alltid välja utökad. En uppgift som hör till en arbetsorder följer arbetsorderns riskbedömning.", result: "Steget är klart. Först nu går det att starta tiden och färdigställa." },
  { name: "4. Utförande", what: "Tryck Starta tid när du börjar. Skriv vad som gjorts under Utfört arbete, lägg till material, avvikelser och bilder.", choices: "Pausa tid när du gör uppehåll. Starta tid igen när du fortsätter. Startar du tid på en annan uppgift pausas den här automatiskt.", result: "Status blir Pågår när tiden går och Pausad när du pausar. Tiden syns i toppraden, i Tidrapport och på projektet." },
  { name: "5. Signering", what: "Skriv namnet på den som signerar och bocka i att dokumentationen är granskad.", result: "Arbetsordern är klar att färdigställa. Progressionslinjen visar Färdigställ som nästa steg." },
  { name: "6. Färdigställ", what: "Tryck Färdigställ längst ned.", choices: "En ruta frågar Vill du skriva tid? – Ja, skriv tid (datum, från, till och anteckning) eller Nej, färdigställ utan ny tid. Saknas något visas det i stället, med länk till fältet.", result: "Tidtagningen stoppas, arbetsordern låses och blir 100 % och Färdigställd. Nästa steg visas: projektets nästa uppgift, tillbaka till protokollet den kom från, projektet och tiden. Den kan återöppnas; då krävs ny signering." },
];

/** At level 1 on a phone each panel is a screen of its own under Hjälp (`&step=`, features/workflow/native-help.tsx). */
export const GUIDE_SECTIONS: { title: string; key: string; steps: GuideStep[] }[] = [
  { title: "Riskbedömning", key: "riskbedomning", steps: [
    { name: "Grunduppgifter → Risker → Godkännande → Färdigställ", what: "Lägg till varje fara som en egen risk med skyddsåtgärd och bedömning före och efter. Den som granskat anger namn och bekräftar.", result: "Hög kvarvarande risk markeras rött och ger ett tips om att arbetet inte bör starta. Färdigställ fungerar som för arbetsordern, med frågan om tid." },
  ] },
  { title: "Kontroll före idrifttagning och protokoll", key: "protokoll", steps: [
    { name: "Grunduppgifter → Kontrollmoment / Ifyllnad → Mätningar → Sammanfattning → Färdigställ", what: "Fyll i projekt eller anläggning, välj moment och registrera mätvärden. Avvikelser beskrivs i sammanfattningen.", choices: "En avvikande rad i ett protokoll kan bli en arbetsorder direkt på raden.", result: "Färdigställ frågar om tid som en uppgift, låser protokollet och gör rapporten klar. Ändringar görs sedan med Spara som (en kopia), aldrig i originalet." },
  ] },
  { title: "Projekt", key: "projekt", steps: [
    { name: "Skapat → Uppgifter → Utförande → Uppgifterna klara → Avslutat", what: "Ett projekt är ramen: kund, tidsram och ansvarig. Arbetet görs i uppgifterna som skapas i eller kopplas till projektet.", result: "Progressionen räknas bara från uppgifterna. När alla är färdigställda står projektet som Klar att avsluta, och projektansvarig eller admin trycker Avsluta projekt." },
    { name: "Planering", what: "Planering är ett eget menyval med tre vyer. Kalender är teamets kalender där personal bokas. Tidplan samlar ett projekts tidplan, bokningar, hinder och timmar – Budget, Offererat, Uppskattat, Bokat och Rapporterat – och med Alla projekt syns alla projekt som staplar och i en tabell. Kapacitet visar bokade timmar mot tillgänglig tid, utan helgdagar och frånvaro, per person och vecka, och veckans tidskrockar.", result: "Tidplan och Kapacitet visar bara. En bokning görs genom att klicka på en dag i Kalender eller med Boka (på arbetsordern, på Teamet och i listan Att boka), och en arbetsorders datum ändras i Tidplanen eller på arbetsordern." },
  ] },
];
