import type { RoleCapability } from "./model";
import { SECTIONS_2026_10_08_1 } from "./template-2026-10-08";
import { SECTIONS_2026_10_11_1 } from "./template-2026-10-11";

/**
 * HINTEK's earlier editions of the self-inspection template (2026-10-06.1 to 2026-10-07.2), frozen word for word. They are
 * no longer offered anywhere: the only use is the equality check that tells an untouched copy of an older edition from a
 * programme the company has edited, so that the release migration and Local's file upgrade (./template-upgrade.ts) can
 * move the untouched copy to the current edition (2026-10-08). Never edit these texts.
 */
export type OldTemplateSection = { key: string; title: string; body: string; legalRef: string };
export type OldTemplateRole = { key: string; name: string; description: string; duties: string; isEre: boolean; level: number; capabilities: RoleCapability[] };

/** Every edition before the current one, oldest first (2026-10-08.1 is frozen in ./template-2026-10-08.ts, 2026-10-11.1 in ./template-2026-10-11.ts). */
export const OLD_TEMPLATE_VERSIONS = ["2026-10-06.1", "2026-10-06.2", "2026-10-07.1", "2026-10-07.2", "2026-10-08.1", "2026-10-11.1"] as const;
export type OldTemplateVersion = (typeof OLD_TEMPLATE_VERSIONS)[number];
export const isOldTemplateVersion = (version: string): version is OldTemplateVersion => (OLD_TEMPLATE_VERSIONS as readonly string[]).includes(version);

const SECTIONS_2026_10_07_2: readonly OldTemplateSection[] = [
  {
    key: "intro", title: "Inledning och syfte", legalRef: "Elsäkerhetslagen (2016:732) 24 §; ELSÄK-FS 2017:3 3 kap. 2 §",
    body: [
      "Det här programmet beskriver hur företaget planerar, utför och kontrollerar elinstallationsarbete så att arbetet blir elsäkert och uppfyller gällande lag och föreskrifter.",
      "Programmet gäller allt elinstallationsarbete som företaget utför, av egen och inhyrd personal. Alla som arbetar enligt programmet ska ha tagit del av den gällande versionen och bekräftar det i Workflow.",
      "Programmet är skrivet på svenska. Det hålls aktuellt, ses över minst en gång per år och varje fastställd version sparas.",
      "Programmet gäller hela företagets elinstallationsverksamhet. Om företaget delar upp verksamheten på flera program står här hur uppdelningen är gjord.",
      "Mallen från HINTEK är ett stöd. Företaget ansvarar för att innehållet stämmer med den egna verksamheten.",
    ].join("\n\n"),
  },
  {
    key: "business", title: "Elinstallationsverksamheten", legalRef: "ELSÄK-FS 2017:3 3 kap. 4 §, 5 kap. 2 §",
    body: [
      "[Beskriv kort vad företaget gör: vilka slags anläggningar, vilka arbeten och i vilken omfattning.]",
      "Vilka verksamhetstyper företaget är registrerat för står i programmets uppgifter nedan. Om företaget arbetar på anläggningar som andra äger är verksamheten registrerad hos Elsäkerhetsverket innan arbetet börjar.",
      "Registreringen ska ange organisationsnummer, verksamhetstyper, en kontaktperson och vilken elinstallatör för regelefterlevnad som är registrerad. Administratören för programmet kontrollerar att registreringen är aktuell minst en gång per år och när något av detta ändras.",
    ].join("\n\n"),
  },
  {
    key: "competence", title: "Kompetens", legalRef: "ELSÄK-FS 2017:3 3 kap. 5 §",
    body: [
      "Den som utför elinstallationsarbete ska ha den kunskap och erfarenhet som arbetet kräver. Vilka arbeten en person får utföra framgår av personens roll i programmet och av bilagan Personer och kompetens, där bedömningen och eventuella begränsningar står.",
      "- Inhyrd personal omfattas av samma krav som egen personal och tilldelas arbete först när kompetensen är känd.",
      "- Den som är under utbildning arbetar bara under handledning av någon som har rätt kompetens för arbetet.",
      "- Företaget bedömer kompetensen för ett visst slags arbete utifrån utbildning, erfarenhet och genomförda arbeten.",
      "Plan för att behålla och utveckla kompetensen: [ange hur ofta repetitionsutbildning i elsäkerhet sker, vilka utbildningar som krävs för olika arbeten och hur behoven följs upp, till exempel vid medarbetarsamtal].",
      "Uppgifter om en persons kompetens sparas så länge personen arbetar i företaget och därefter enligt företagets valda lagringstid.",
    ].join("\n"),
  },
  {
    key: "ere", title: "Elinstallatör för regelefterlevnad", legalRef: "Elsäkerhetslagen (2016:732) 23 §; ELSÄK-FS 2017:3 3 kap. 6 §",
    body: [
      "Företaget har utsett minst en auktoriserad elinstallatör för regelefterlevnad. Vem eller vilka som är utsedda, deras auktorisationsnivå och vem som står i registreringen framgår av rollerna i programmet.",
      "Elinstallatören för regelefterlevnad verkar för att elinstallationsarbetet följer lag och föreskrifter, deltar när programmet tas fram och ses över, och får information om fel och brister som kan bero på brister i programmet.",
      "Om flera är utsedda beskrivs här hur uppdraget fördelas mellan dem: [ange fördelningen, till exempel per verksamhetstyp eller per avdelning].",
    ].join("\n\n"),
  },
  {
    key: "organization", title: "Organisation och ansvar", legalRef: "ELSÄK-FS 2017:3 3 kap. 7 §",
    body: [
      "Organisationsschemat nedan visar rollerna i programmet och vilka personer som har dem. Varje roll har en beskrivning och de uppgifter rollen har i programmet, se bilagan Roller och ansvar. Samma rollnamn används i hela programmet och i arbetsordrar, planer och protokoll.",
      "Vem som planerar, utför och kontrollerar ett visst arbete framgår av uppgiften i Workflow: den ansvariga och hens roller.",
    ].join("\n\n"),
  },
  {
    key: "planning", title: "Planering och anläggningskännedom", legalRef: "ELSÄK-FS 2017:3 3 kap. 8 §",
    body: [
      "Varje uppdrag planeras innan arbetet börjar. Mindre arbeten och service planeras i en arbetsorder; större arbeten i en plan för uppdraget eller ett projekt i Workflow.",
      "Inför varje arbete tar den som planerar reda på:",
      "- vilka arbeten som ska utföras och var,",
      "- hur den berörda delen av anläggningen är utförd innan arbetet,",
      "- om ändringen påverkar andra delar av anläggningen eller kräver andra utförandekrav än de som gäller i dag,",
      "- vilka krav på dokumentation och märkning kunden har.",
      "Arbetet planeras så att det i första hand utförs utan spänning. Arbete med eller nära spänning planeras särskilt, med en bedömning av riskerna.",
      "När fler än en montör arbetar i samma uppdrag utses en montör med kontrolluppgift för uppdraget.",
    ].join("\n"),
  },
  {
    key: "requirements", title: "Kravbestämning", legalRef: "ELSÄK-FS 2017:3 3 kap. 8 §; ELSÄK-FS 2022:1 2 kap. 1 §",
    body: [
      "Inför varje arbete bestäms vilka krav anläggningen ska uppfylla när arbetet är klart: vilka föreskrifter och standarder som gäller, med utgåva, och tillverkarens anvisningar för det som installeras.",
      "- Nya anläggningar och nya delar utförs enligt de krav som gäller när arbetet görs.",
      "- Vid underhåll och reparation kan kraven från när anläggningen byggdes gälla, om inte ändringen kräver annat.",
      "- Avviker utförandet från en standard dokumenteras bedömningen som visar att säkerheten ändå blir lika god.",
      "Ändras förutsättningarna under arbetet – till exempel att anläggningen visar sig vara utförd på annat sätt än väntat eller att omfattningen ändras – görs kravbestämningen om innan arbetet fortsätter, och det nya underlaget sparas med uppdraget.",
    ].join("\n"),
  },
  {
    key: "authorization", title: "Kontroll av behörighet före tilldelning", legalRef: "Elsäkerhetslagen (2016:732) 27 §; ELSÄK-FS 2017:3 3 kap. 9 §",
    body: [
      "Elinstallationsarbete utförs bara av en auktoriserad elinstallatör eller av någon som omfattas av det här programmet.",
      "Innan en person tilldelas ett uppdrag kontrollerar den som planerar att personen:",
      "- är auktoriserad eller omfattas av programmet (har en roll i programmet och har bekräftat den gällande versionen),",
      "- har den kompetens som arbetet kräver enligt avsnittet Kompetens,",
      "- för inhyrd personal: att uppgifter om kompetensen finns innan arbetet börjar.",
      "Saknas något tilldelas arbetet någon annan, eller så utförs det under handledning av någon med rätt behörighet.",
    ].join("\n"),
  },
  {
    key: "inspection", title: "Kontroll av utfört arbete", legalRef: "ELSÄK-FS 2017:3 3 kap. 10–11 §§; ELSÄK-FS 2022:1 2 kap. 2 §",
    body: [
      "Kontrollens omfattning bestäms inför varje arbete, tillsammans med planeringen: vilka kontrollpunkter som ska göras, av vem och när.",
      "- Var och en kontrollerar sitt eget arbete innan det lämnas.",
      "- En ny, ändrad eller utvidgad anläggning kontrolleras före idrifttagning, även före en tillfällig spänningssättning.",
      "- Kontrollpunkter dokumenteras alltid, i protokoll i Workflow. Mätinstrumentens egna rapporter kan bifogas.",
      "- Den som har kontrolluppgift i uppdraget signerar att kontrollen är gjord.",
      "Kunden får dokumentation för drift och underhåll för den del av anläggningen som arbetet omfattar.",
    ].join("\n"),
  },
  {
    key: "deviations", title: "Fel, brister och avvikelser", legalRef: "ELSÄK-FS 2017:3 3 kap. 11 §",
    body: [
      "Fel och brister som hittas vid kontrollen åtgärdas innan anläggningen tas i drift. Fel som innebär omedelbar fara åtgärdas direkt eller så görs anläggningsdelen spänningslös.",
      "Den som upptäcker ett fel eller en brist i arbetet eller i programmet rapporterar det i avvikelseloggen i Workflow. Varje avvikelse klassas som omedelbar åtgärd eller rutinöversyn.",
      "Den som planerade arbetet bedömer om felet kan vara systematiskt, alltså bero på en rutin, en utbildning eller programmet självt. Ett systematiskt fel meddelas elinstallatören för regelefterlevnad och leder till en åtgärd i handlingsplanen.",
      "Åtgärder har en ansvarig och ett datum och följs upp tills de är klara.",
    ].join("\n\n"),
  },
  {
    key: "followup", title: "Uppföljning och årlig översyn", legalRef: "ELSÄK-FS 2017:3 3 kap. 12–13 §§",
    body: [
      "Företaget följer upp att rutinerna fungerar och att egenkontrollen räcker genom att gå igenom avvikelser, handlingsplanen och erfarenheter från uppdragen.",
      "Programmet uppdateras när något ändras som påverkar egenkontrollen, till exempel verksamhetstyper, organisation eller elinstallatör för regelefterlevnad.",
      "Minst en gång per år gör administratören för programmet tillsammans med elinstallatören för regelefterlevnad en översyn där man:",
      "- kontrollerar att registreringen hos Elsäkerhetsverket är aktuell,",
      "- går igenom avvikelser och handlingsplan,",
      "- kontrollerar att planen för kompetens följs,",
      "- beslutar om programmet kan stå kvar eller ska ändras.",
      "Översynen registreras i Workflow. En ändring fastställs som en ny version; tidigare versioner sparas.",
    ].join("\n"),
  },
];

export const OLD_TEMPLATE_ROLES: readonly OldTemplateRole[] = [
  {
    key: "ere", level: 3, name: "Elinstallatör för regelefterlevnad", isEre: true, capabilities: ["plan", "inspect", "approve", "deviations"],
    description: "Auktoriserad elinstallatör som företaget utsett att verka för att elinstallationsarbetet följer lag och föreskrifter.",
    duties: "- Deltar när programmet tas fram, ändras och ses över.\n- Följer att rutinerna i programmet används.\n- Tar emot information om systematiska fel och föreslår åtgärder.\n- Är företagets kontakt i frågor om regelefterlevnad.",
  },
  {
    key: "program_admin", level: 1, name: "Administratör för egenkontrollprogrammet", isEre: false, capabilities: ["approve", "deviations"],
    description: "Håller programmet aktuellt och ser till att översynen blir gjord.",
    duties: "- Kontrollerar minst en gång per år att registreringen hos Elsäkerhetsverket är aktuell.\n- Kallar till och registrerar den årliga översynen.\n- För avvikelseloggen och handlingsplanen.\n- Ser till att alla som omfattas har tagit del av den gällande versionen.",
  },
  {
    key: "manager", level: 1, name: "Verksamhetsansvarig", isEre: false, capabilities: ["approve"],
    description: "Har det övergripande ansvaret för verksamheten och för att programmet har de resurser som behövs.",
    duties: "- Fastställer programmet.\n- Beslutar om åtgärder och resurser som översynen visar behov av.\n- Ser till att roller i programmet är tillsatta.",
  },
  {
    key: "planner", level: 2, name: "Planerare", isEre: false, capabilities: ["plan", "deviations"],
    description: "Planerar uppdrag: anläggningskännedom, kravbestämning, kontrollens omfattning och vem som utför arbetet.",
    duties: "- Tar fram underlag om anläggningen och gör kravbestämningen inför varje arbete.\n- Bestämmer kontrollens omfattning.\n- Kontrollerar behörighet och kompetens innan arbete tilldelas.\n- Bedömer om rapporterade fel kan vara systematiska.",
  },
  {
    key: "installer", level: 2, name: "Montör", isEre: false, capabilities: ["perform"],
    description: "Utför elinstallationsarbete enligt planeringen och kontrollerar sitt eget arbete.",
    duties: "- Arbetar enligt arbetsorder eller plan och företagets arbetsmetod för elsäkerhet.\n- Kontrollerar och dokumenterar sitt eget arbete.\n- Meddelar planeraren om förutsättningarna ändras under arbetet.\n- Rapporterar fel och brister i avvikelseloggen.",
  },
  {
    key: "inspector", level: 3, name: "Montör med kontrolluppgift", isEre: false, capabilities: ["perform", "inspect"],
    description: "Montör som i ett uppdrag har ansvar för att kontrollen görs enligt den bestämda omfattningen.",
    duties: "- Ser till att kontrollpunkterna i uppdraget görs och dokumenteras.\n- Genomför eller leder kontrollen före idrifttagning och signerar protokollet.\n- Rapporterar fel och brister och följer upp att de åtgärdas.",
  },
  {
    key: "hired", level: 1, name: "Inhyrd personal", isEre: false, capabilities: ["perform"],
    description: "Personal från ett annat företag som arbetar i företagets uppdrag och omfattas av programmet under uppdraget.",
    duties: "- Arbetar enligt programmet på samma villkor som egen personal.\n- Lämnar uppgifter om sin kompetens innan arbetet börjar.\n- Rapporterar fel och brister i avvikelseloggen.",
  },
  {
    key: "trainee", level: 1, name: "Under utbildning", isEre: false, capabilities: ["perform"],
    description: "Elev, lärling eller nyanställd som ännu inte har full kompetens för arbetet.",
    duties: "- Arbetar bara under handledning av någon med rätt kompetens.\n- Utför inte kontroll före idrifttagning på egen hand.",
  },
];


/** The earlier editions differed from 2026-10-07.2 in four sections only; every other text was the same. */
const paragraphs = (key: string, replace: (lines: string[]) => string[], separator = "\n\n") => {
  const section = SECTIONS_2026_10_07_2.find((item) => item.key === key)!;
  return { ...section, body: replace(section.body.split(separator)).join(separator) };
};
const ORGANIZATION_SECOND = "Roller som gäller ett visst uppdrag, till exempel vem som planerar och vem som har kontrolluppgift, anges i uppdragets arbetsorder eller plan.";
const SECTIONS_2026_10_07_1 = SECTIONS_2026_10_07_2.map((section) => section.key === "organization"
  ? paragraphs("organization", (lines) => [lines[0].replace("arbetsordrar, planer", "arbetsorder, planer"), ORGANIZATION_SECOND]) : section);
const SECTIONS_2026_10_06_2 = SECTIONS_2026_10_07_1;
const SECTIONS_2026_10_06_1 = SECTIONS_2026_10_06_2.map((section) => {
  if (section.key === "intro") return paragraphs("intro", (lines) => lines.filter((line) => !line.startsWith("Programmet gäller hela företagets")));
  if (section.key === "business") return paragraphs("business", (lines) => lines.map((line) => line.replace("programmets uppgifter nedan", "programmets uppgifter ovan")));
  if (section.key === "competence") return paragraphs("competence", (lines) => lines.map((line) => line.startsWith("Den som utför elinstallationsarbete")
    ? "Den som utför elinstallationsarbete ska ha den kunskap och erfarenhet som arbetet kräver. Vilka arbeten en person får utföra framgår av personens roll i programmet och av den kompetens som är dokumenterad för personen." : line), "\n");
  if (section.key === "organization") return { ...section, body: [
    "Rollerna i programmet och vilka personer som har dem står under Roller och behörighet. Varje roll har en beskrivning och de uppgifter rollen har i programmet. Samma rollnamn används i hela programmet och i arbetsorder, planer och protokoll.",
    ORGANIZATION_SECOND,
  ].join("\n\n") };
  return section;
});

/** The sections of one earlier edition, in their order. */
export function oldTemplateSections(version: OldTemplateVersion): readonly OldTemplateSection[] {
  switch (version) {
    case "2026-10-06.1": return SECTIONS_2026_10_06_1;
    case "2026-10-06.2": return SECTIONS_2026_10_06_2;
    case "2026-10-07.1": return SECTIONS_2026_10_07_1;
    case "2026-10-07.2": return SECTIONS_2026_10_07_2;
    case "2026-10-08.1": return SECTIONS_2026_10_08_1;
    case "2026-10-11.1": return SECTIONS_2026_10_11_1;
  }
}
