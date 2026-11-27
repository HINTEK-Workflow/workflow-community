import { z } from "zod";
import { BODY_MAX, CAPTION_STORE_MAX, HASHTAG_STORE_MAX, HEADING_MAX, INSTAGRAM_TEXT_MAX, LINK_MAX } from "@/lib/meta/text";
import { assignmentInstructionShape } from "@/lib/content-assignments/model";

// Inlägg, versionsnyheter och besöksstatistik för externa system (2026-11-25): generella läsverktyg och ett verktyg som skapar ett
// utkast till inlägg, i samma form som lib/tools/catalog.ts och utspridda i TOOL_CATALOG där. Varje verktyg har ett eget scope, så
// att en befintlig nyckel aldrig börjar läsa eller skriva inlägg av sig själv. Inget verktyg publicerar, schemalägger eller godkänner:
// det gör en admin i Workflow, med företagets egen spärr för publicering. Körs av lib/tools/registry-marketing.ts.

const id = z.string().min(1).max(100);
const day = z.iso.date();
// Checked with refine, never a regex pattern: the clients' schema shows no patterns (tests/tool-field-help.test.ts).
const version = z.string().trim().max(14).refine((value) => /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value), "Ange en version som 0.85.0.").describe("Versionsnummer, till exempel 0.85.0.");
const reference = z.string().trim().min(1).max(120).refine((value) => /^[A-Za-z0-9._:-]+$/.test(value), "Referensen får bara ha bokstäver, siffror och . _ : -");
/** The MCP scope of the posts and the visitor statistics: its own, off until chosen on an MCP key. */
export const MCP_MARKETING_SCOPE = "mcp:marketing";

export const MARKETING_TOOL_CATALOG = {
  // ---------- Versionsnyheter (samma texter som Nytt i Workflow) ----------
  list_release_notes: { title: "Versionsnyheter", effect: "read", apiScope: "releases:read",
    description: "Lista Workflows versionsnyheter, nyaste först: version, datum, sammanfattning, punkterna och de korta raderna för startsidan (highlights). Samma texter som sidan Nytt i Workflow och nyhetsbrevet. since ger bara versionerna efter den angivna; current är installationens version. Ingen data om företaget.",
    input: z.object({ since: version.optional(), limit: z.number().int().min(1).max(50).optional().describe("Högst så många versioner, 1–50 (förval 10).") }) },

  // ---------- Inlägg och publiceringar ----------
  list_social_posts: { title: "Inlägg och publiceringar", effect: "read", apiScope: "posts:read", mcpScope: MCP_MARKETING_SCOPE,
    description: "Lista företagets inlägg (högst 100, nyaste först) med status (draft utkast, publishing publiceras, published publicerat, partial delvis, failed misslyckades), kanalerna, publiceringstid, kampanjlänkar, AI-markering, vilka kanaler som fick ett inlägg-id och den schemalagda publiceringen (status, tid). source säger varifrån utkastet kom (manual, website, release, api) och externalRef den referens ett externt system gav. Statistik från plattformarna (räckvidd, visningar) ingår inte. Kräver att nyckelns användare är admin. Finns bara med serverlagring.",
    input: z.object({
      status: z.enum(["draft", "publishing", "published", "partial", "failed"]).optional().describe("Bara inlägg med den statusen."),
      since: day.optional().describe("Bara inlägg skapade eller publicerade från och med dagen, ÅÅÅÅ-MM-DD."),
      externalRef: reference.optional().describe("Bara utkastet som skapades med den referensen (create_social_post_draft)."),
      limit: z.number().int().min(1).max(100).optional().describe("Högst så många inlägg, 1–100 (förval 50)."),
    }) },
  get_social_post: { title: "Hämta inlägg", effect: "read", apiScope: "posts:read", mcpScope: MCP_MARKETING_SCOPE,
    description: "Hämta ett inlägg med id: texterna, kanalerna, status, publiceringstid, fel, AI-markering och den schemalagda publiceringen. Kräver att nyckelns användare är admin.",
    input: z.object({ postId: id.describe("Inläggets id.") }) },
  create_social_post_draft: { title: "Skapa utkast till inlägg", effect: "create", apiScope: "posts:write", mcpScope: MCP_MARKETING_SCOPE,
    description: "Skapa ett utkast till inlägg under Webb och inlägg → Inlägg, till exempel från en rekommendation eller ett innehållsuppdrag. heading och body är texten i bilden, caption inläggets text, instagramText en egen text för Instagram. Utkastet publiceras aldrig av verktyget: en admin granskar, redigerar, schemalägger och publicerar i Workflow, och företagets spärr för publicering gäller. Med externalRef blir anropet idempotent: samma referens igen ger det befintliga utkastet (existing: true) i stället för ett nytt. Kräver att nyckelns användare är admin och att Webb och inlägg är påslaget. Finns bara med serverlagring.",
    input: z.object({
      externalRef: reference.optional().describe("Det externa systemets egen referens (bokstäver, siffror, . _ : -). Samma referens ger samma utkast."),
      heading: z.string().trim().max(HEADING_MAX).optional().describe(`Rubriken i bilden, högst ${HEADING_MAX} tecken.`),
      body: z.string().trim().max(BODY_MAX).optional().describe(`Den korta texten i bilden, högst ${BODY_MAX} tecken.`),
      caption: z.string().trim().max(CAPTION_STORE_MAX).optional().describe("Inläggets text."),
      instagramText: z.string().trim().max(INSTAGRAM_TEXT_MAX).optional().describe(`En egen text för Instagram, högst ${INSTAGRAM_TEXT_MAX} tecken.`),
      hashtags: z.string().trim().max(HASHTAG_STORE_MAX).optional().describe("Hashtaggar, \"#ord #ord\"."),
      link: z.string().trim().max(LINK_MAX).nullable().optional().describe("En länk som börjar med https://."),
      toFacebook: z.boolean().optional().describe("Till Facebook."),
      toInstagram: z.boolean().optional().describe("Till Instagram."),
      toLinkedIn: z.boolean().optional().describe("Till LinkedIn."),
      campaignLinks: z.boolean().optional().describe("Kampanjlänkar: länkar till Workflows egna adresser får ?via=kanal."),
      aiGenerated: z.boolean().optional().describe("Texten är skapad med AI (visas som AI-markering i Workflow)."),
    }) },

  create_content_brief: { title: "Skapa innehållsuppdrag", effect: "create", apiScope: "posts:assign", mcpScope: MCP_MARKETING_SCOPE,
    description: "Ge ett innehållsuppdrag (plattform, målgrupp, ämne, syfte, format, budskap, ton, tid, instruktioner för text och bild, fakta, hashtaggar, länk, motivering). Workflow AI skriver ett utkast under Webb och inlägg → Inlägg på samma sätt som innehållsseriernas AI-utkast, och uppdraget visas på utkastet. Utan Workflow AI (avstängt, agenten Utkast till inläggsserier av, inga krediter) eller om texten bryter reglerna blir uppdraget självt ett tydligt märkt utkast; assignment.textSource säger vilket (ai eller brief) och reason varför. Med publishAt läggs utkastet i Schemalagt på den tiden och väntar på Godkänn; Workflows schemaläggare publicerar först när en admin har godkänt (eller när företagets egen regel för automatiskt godkännande tillåter det, se autoPublish). filmSlug (ur list_films) ger inlägget filmens bild och en länk till filmens sida. Med externalRef är anropet idempotent (samma referens ger samma utkast, existing: true). Status läses med get_social_post eller list_social_posts. Kostar Workflow AI-krediter som innehållsserierna. Kräver att nyckelns användare är admin och att Webb och inlägg är påslaget. Finns bara med serverlagring.",
    input: z.object({
      externalRef: reference.optional().describe("Det externa systemets egen referens (bokstäver, siffror, . _ : -). Samma referens ger samma utkast."),
      ...assignmentInstructionShape,
      autoPublish: z.boolean().optional().describe("Be om automatiskt godkännande. Gäller bara om företagets regel under Inlägg tillåter nyckeln, kanalen och taket, och nyckeln har posts:autopublish; annars väntar utkastet på Godkänn."),
    }) },

  // ---------- Filmerna på filmsidan ----------
  list_films: { title: "Filmer", effect: "read", apiScope: "films:read",
    description: "Lista filmerna som besökare ser på filmsidan, i seriens ordning: slug (filmens adress), namn, en rad om filmen, filmens egen sida (url) och omslagsbild (poster). slug används som filmSlug i create_content_brief. Tom lista när filmsidan inte är öppen eller installationen saknar landningssida.",
    input: z.object({}) },

  // ---------- Besöksstatistik (installationens egen webbplats, demo och tratt) ----------
  get_site_analytics: { title: "Besöksstatistik", effect: "read", apiScope: "analytics:read", mcpScope: MCP_MARKETING_SCOPE,
    description: "Den anonyma besöksstatistiken som på Beteendeanalys: webbplatsens sidvisningar, klick, hänvisande webbplatser och skärmar, demots starter per källa (bland annat facebook, instagram, linkedin via kampanjlänkar) och per dag, tiden i demot, trattens steg (landning, priser, Skapa konto, betalning) för besökare som tillåtit statistik och samma siffror för perioden före. Räknarna har ingen person, inget företag och ingen adress. Bara för installationens eget företag och när nyckelns användare är installationens administratör. Högst 400 dagar; utan datum de senaste 30 dagarna.",
    input: z.object({ from: day.optional().describe("Första dagen, ÅÅÅÅ-MM-DD."), to: day.optional().describe("Sista dagen, ÅÅÅÅ-MM-DD (högst i dag).") }) },
} as const;
