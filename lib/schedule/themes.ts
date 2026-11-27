import { BODY_MAX, CAPTION_MAX, HEADING_MAX } from "@/lib/meta/text";
import { OPERATOR_SITE } from "@/lib/operator-site";

/**
 * Innehållsserie (2026-11-11): the themes Workflow proposes, one per slot – Workflow's own functions, each with the facts
 * that may be said about it. The facts are the product's own texts (the landing page's sections, which are checked against the
 * code; docs/beslut/betalning-och-landningssida.md) – nothing is added here that Workflow does not do. The AI draft is fed only
 * these facts, and the rules' own text is made from them alone. Pure, shared by the page, the server and the tests.
 *
 * A new function in Workflow gets a theme here when it is in the product (and on the landing page); never a coming one.
 */
export type SeriesTheme = {
  id: string;
  /** The theme's short name in the list (and the picture's heading in the rules' text). */
  title: string;
  /** What may be said: whole sentences, each true of Workflow today. */
  facts: readonly string[];
  /** A theme about the operator's own website (lib/operator-site.ts), not about Workflow. */
  operatorSite?: boolean;
};

export const SERIES_THEMES: readonly SeriesTheme[] = [
  { id: "controls", title: "Egna kontroller", facts: [
    "Du skapar kontroller och formulär i formulärbyggaren och använder dem i arbetsordrar och driftronder.",
    "Du lägger ihop rubriker, mätrader och val utan att skriva kod.",
    "Företaget anger gränsvärdena själv, och bedömningen räknas ut från dem.",
    "Ett ifyllt formulär kan tas fram som protokoll i PDF med företagets logotyp.",
  ] },
  { id: "machine-alarms", title: "Larm blir arbetsorder", facts: [
    "En PLC, en Raspberry Pi eller en 4G-router skickar larm och mätvärden till Workflow via API.",
    "Ett larm på nivån fel eller kritiskt kan bli en märkt arbetsorder med larmtexten, och samma larm ger ingen dubblett.",
    "Rätt person får en notis direkt och tar ärendet med ett tryck.",
    "Företaget sätter egna regler på mätvärdena, till exempel en gräns eller en tid, och regeln skapar larmet.",
    "Workflow är inget larm- eller säkerhetssystem.",
  ] },
  { id: "operator", title: "Felanmälan vid maskinen", facts: [
    "Operatörsterminalen är en enkel sida för den som står vid maskinen.",
    "Operatören väljer maskin och orsak och skriver vad som hände.",
    "Anmälan kan få ett foto, och den blir en arbetsorder.",
    "Jouren kontaktas vid akuta fel, och vid fel med hög allvarlighet utanför arbetstid.",
  ] },
  { id: "maintenance", title: "Underhåll", facts: [
    "Underhållet har ett eget träd med maskiner och delar.",
    "Varje maskin har bilder, drifttimmar och status.",
    "Det finns underhållsplaner per del och ett förråd med reservdelar och saldo.",
    "Kostnad och stillestånd per maskin räknas ut från arbetsordrarna.",
  ] },
  { id: "planning", title: "Planering och tid", facts: [
    "Du planerar i kalendern och startar tiden på jobbet.",
    "Du ser planerad tid mot rapporterad tid.",
    "Personalliggaren förs på de projekt som kräver det.",
  ] },
  { id: "quotes", title: "Offerter och fakturaunderlag", facts: [
    "Offerter har material och arbete, och offerten kan bli en arbetsorder.",
    "Inköp kan göras från flera leverantörer.",
    "Fakturaunderlaget görs av tid och material och är klart när jobbet är det.",
  ] },
  { id: "work-orders", title: "Arbetsorder och riskbedömning", facts: [
    "Arbetsordern samlar material, utfört arbete, tid och signering.",
    "Riskbedömningen görs före arbetet.",
    "När något är klart föreslår Workflow nästa steg.",
  ] },
  { id: "ai", title: "AI som hjälp", facts: [
    "AI och regler hjälper till, och en människa fattar besluten.",
    "Du ställer frågor om uppgifter, tid och planering och får svar direkt ur Workflow.",
    "Regler hittar larm som upprepas eller blir tätare och maskiner som har tystnat.",
    "Förslag från AI är förslag. En människa bestämmer, särskilt när det gäller säkerhet.",
  ] },
  { id: "self-inspection", title: "Egenkontrollprogram", facts: [
    "Egenkontrollprogrammet är ett dokument i Workflow med fastställda versioner.",
    "Rollerna i programmet styr vilka arbeten varje person får utföra.",
  ] },
  { id: "rounds", title: "Driftronder och notiser", facts: [
    "Driftronderna påminner när det är dags.",
    "Klockan i Workflow visar direkt när något nytt har hänt.",
  ] },
  { id: "customers", title: "Kunder och anläggningar", facts: [
    "Kundregistret har anläggningar och objekt i ett träd, på kartan och med historik.",
    "Kunden, platsen och kontaktuppgifterna finns på ett ställe.",
    "Nästa besök börjar där det förra slutade.",
  ] },
  { id: "modules", title: "Välj vad ni använder", facts: [
    "Guiden Kom igång tar företaget steg för steg genom villkor, yrkesprofil, visning, företag, säkerhet och AI.",
    "Det som företaget inte behöver stängs av, och inget raderas.",
    "Varje person väljer en yrkesprofil som styr vad som visas först, inte vad man får göra.",
  ] },
  // The operator's own website's themes, last (none in the community edition).
  ...(OPERATOR_SITE?.themes ?? []),
];

export const themeOf = (id: string) => SERIES_THEMES.find((theme) => theme.id === id) ?? null;
export const isThemeId = (id: string) => SERIES_THEMES.some((theme) => theme.id === id);

/**
 * One theme per slot, in the catalogue's order and round again – never the same theme twice in a row when there are two or more.
 * `exclude` leaves themes out (the person removed them from the series). A theme about the operator's website is only proposed when asked
 * for (any company can still choose it in the list).
 */
export function proposeThemes(count: number, options: { exclude?: readonly string[]; start?: number; includeOperatorSite?: boolean } = {}): string[] {
  const pool = SERIES_THEMES.filter((theme) => options.includeOperatorSite || !theme.operatorSite).map((theme) => theme.id).filter((id) => !(options.exclude ?? []).includes(id));
  if (!pool.length || count <= 0) return [];
  const start = ((options.start ?? 0) % pool.length + pool.length) % pool.length;
  return Array.from({ length: count }, (_, index) => pool[(start + index) % pool.length]);
}

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…`);

/** The rules' own text for a theme (when Workflow AI is off or refuses): the theme's name and its facts, nothing else. */
export function templateDraft(theme: SeriesTheme): { heading: string; body: string; caption: string } {
  const [first, ...rest] = theme.facts;
  return {
    heading: clip(theme.title, HEADING_MAX),
    body: clip(first ?? "", BODY_MAX),
    caption: clip([first, ...rest].filter(Boolean).join(" "), CAPTION_MAX),
  };
}
