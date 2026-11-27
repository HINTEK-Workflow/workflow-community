import assert from "node:assert/strict";
import { test } from "node:test";
import { helpCorpus, helpTerms, searchHelp, stem } from "../lib/help/search-help";
import { FILM_TEXTS } from "../lib/help/film-texts";
import type { SearchAccess } from "../lib/search/commands";
import { planAnswer } from "../lib/ai/assistant-rules";
import { formatKnowledgeAnswer, isHowToQuestion } from "../lib/ai/assistant-rules-knowledge";
import { helpToolAnswer } from "../lib/tools/registry-knowledge";
import { TOOL_CATALOG } from "../lib/tools/catalog";
import { KNOWLEDGE_TOOL_CATALOG } from "../lib/tools/catalog-knowledge";

// Hjälpsökningen search_help (2026-11-21): rule-based, free, over the app's own help, the knowledge package, the release notes and
// the film manuscripts; links to the right page and, where a published film covers it, Se filmen.

const now = new Date("2026-11-21T09:00:00Z");
const member: SearchAccess = {
  admin: false, superadmin: false, local: false, canBuildForms: false, can: (subject, action) => action === "read" && ["work-order", "projects", "customers"].includes(subject),
  features: { credits: true, billing: true, ai: true, integrations: true, landingEditor: true, import: true },
};
const films = "https://example.com/filmer";

test("the corpus: pages, the guide, the knowledge package, the newest release notes and the films", () => {
  const sources = new Set(helpCorpus().map((doc) => doc.source));
  for (const source of ["page", "guide", "knowledge", "release", "film"]) assert.ok(sources.has(source as never), source);
  assert.ok(FILM_TEXTS.filter((film) => film.recorded).length >= 12, "the recorded films");
  assert.ok(FILM_TEXTS.every((film) => film.page.startsWith("/?view=") && film.scenes.length > 0), "every film belongs to a page and has its voice");
});

test("the film texts: only the voice, no demo people or companies, no addresses, no notes", () => {
  const all = FILM_TEXTS.flatMap((film) => [film.title, film.subtitle, ...film.scenes.flat()]).join("\n");
  // The demo's invented people and companies, test companies and addresses never reach a real company's help answer.
  assert.doesNotMatch(all, /\b(Elna|Elon|Elis|Elin|Elvy)\b|Strömtång|Relässon|Hammarström|Kopparlund|Kopplingsbyr|Nollpunkten|Fas (&|och) Form|Reläback|Ledningslund|Exempel El AB/);
  assert.doesNotMatch(all, /hintekwork|hintek\.se|\.invalid|https?:\/\/|localhost/i);
  // Picture, click and pronunciation notes are not the voice.
  assert.doesNotMatch(all, /\bR: |\bN: |\bP: |Uttal|Bilden och klicken|\| /);
  // A film never says it is the last one, and the help never talks about the film itself.
  assert.doesNotMatch(all, /sista film|i den här filmen|nästa film/i);
});

test("words: question words go, endings are taken off so forms of one word meet", () => {
  assert.deepEqual(helpTerms("Hur gör jag ett fakturaunderlag?"), ["fakturaunderlag"]);
  assert.equal(stem("arbetsordrar"), stem("arbetsordern"));
  assert.equal(stem("exporterar"), "export");
  assert.deepEqual(helpTerms("var ställer jag in timpris"), [stem("timpris")]);
});

test("the common how-to questions are answered surely, with the right page", () => {
  const cases: [string, RegExp][] = [
    ["hur skapar jag en arbetsorder", /taskType=WORK_ORDER/],
    ["hur bjuder jag in en kollega", /view=administration/],
    ["var ställer jag in timpris", /section=prices|company_features/],
    ["hur gör jag ett fakturaunderlag", /view=invoice_bases/],
    ["hur kopplar jag en skärm", /view=boards/],
    ["hur rapporterar jag tid i efterhand", /view=(work_orders|time|stats)/],
    ["hur byter jag tema", /view=settings/],
    ["hur slår jag på mcp", /section=api/],
    ["hur fastställer jag egenkontrollprogrammet", /view=self_inspection/],
    ["hur godkänner jag tid", /tab=team/],
  ];
  for (const [question, href] of cases) {
    const answer = searchHelp(question, { filmsPage: films });
    assert.equal(answer.confident, true, question);
    assert.match(answer.hits[0].href, href, `${question} → ${answer.hits[0].href}`);
  }
});

test("a question the help does not cover is not sure, so the model (or nothing) answers it", () => {
  assert.equal(searchHelp("hur gör man en blorfmätning", { filmsPage: films }).confident, false);
  assert.equal(searchHelp("hur", {}).hits.length, 0);
});

test("Se filmen: a published film's link, only where the installation has a film page", () => {
  const withFilms = searchHelp("hur gör jag ett fakturaunderlag", { filmsPage: films });
  assert.ok(withFilms.hits.some((hit) => hit.film?.href === films && /faktura/i.test(hit.film.title)));
  const without = searchHelp("hur gör jag ett fakturaunderlag", { filmsPage: null });
  assert.ok(without.hits.every((hit) => hit.film === null), "Community: no film links");
  // A manuscript not recorded yet is help text, never a film link.
  // (Underhåll was the example until it was recorded 2026-11-23; Riskbedömning is still a manuscript.)
  const draft = searchHelp("hur gör jag en riskbedömning", { filmsPage: films });
  assert.ok(draft.hits.filter((hit) => hit.source === "film" && /^Riskbedömning/.test(hit.title)).every((hit) => hit.film === null));
});

test("only pages the person may open: Sök's own rules", () => {
  const superadminOnly = searchHelp("hur ändrar jag pdf-mallar", { access: member, filmsPage: films });
  assert.ok(superadminOnly.hits.every((hit) => !hit.href.includes("view=pdf_templates")), "a member is not led to the installation's PDF templates");
  const open = searchHelp("hur ändrar jag pdf-mallar", { access: { ...member, superadmin: true }, filmsPage: films });
  assert.ok(open.hits.some((hit) => hit.href.includes("view=pdf_templates")));
});

test("the tool's answer: the source in words, the page as url, the film when there is one", () => {
  const answer = helpToolAnswer(searchHelp("hur kopplar jag en skärm", { filmsPage: films }));
  assert.equal(answer.confident, true);
  assert.ok(answer.hits.every((hit) => typeof hit.url === "string" && hit.url.startsWith("/?view=") && typeof hit.source === "string"));
  assert.ok(answer.hits.some((hit) => "film" in hit));
  const reply = formatKnowledgeAnswer("search_help", "Så här gör du i Workflow", answer as never);
  assert.match(reply.answer, /^Så här gör du i Workflow:/);
  assert.match(reply.answer, /Se filmen/);
  assert.ok(reply.citations.some((item) => item.href === films && /^Se filmen/.test(item.citationLabel)));
  assert.ok(reply.citations.every((item) => item.resourceType === "VIEW"), "help links are views, never company data");
  const nothing = formatKnowledgeAnswer("search_help", "", { hits: [] });
  assert.match(nothing.answer, /hittar inget/);
});

test("the chat: how-to questions go to the help search first; measuring and safety stay with the model", () => {
  for (const question of ["Hur skapar jag en arbetsorder?", "hur bjuder jag in en kollega", "Var ställer jag in timpris?", "hur skriver jag tid i efterhand"]) {
    const plan = planAnswer(question, now);
    assert.equal(plan.kind === "tool" && plan.tool, "search_help", question);
  }
  for (const question of ["Hur mäter man Zs?", "hur gör man en följelinemätning?", "Hur meggrar man en grupp?", "Vad betyder avvikelse i ett protokoll?", "Hur går det i Kvarnen?", "Varför kan jag inte starta tiden?"])
    assert.equal(planAnswer(question, now).kind === "tool" && (planAnswer(question, now) as { tool: string }).tool === "search_help", false, question);
  assert.equal(isHowToQuestion("hur gör jag en isolationsmätning"), false);
});

test("the knowledge tools are all read tools, with field help and bounded input", () => {
  for (const name of Object.keys(KNOWLEDGE_TOOL_CATALOG) as (keyof typeof KNOWLEDGE_TOOL_CATALOG)[]) {
    assert.equal(TOOL_CATALOG[name].effect, "read", name);
    assert.ok(TOOL_CATALOG[name].description.length > 60, name);
  }
  assert.equal(TOOL_CATALOG.search_help.input.safeParse({ query: "x" }).success, false, "too short");
  assert.equal(TOOL_CATALOG.list_machine_alarms.input.safeParse({ days: 365 }).success, false, "at most 90 days");
  assert.equal(TOOL_CATALOG.list_company_invoice_bases.input.safeParse({ status: "SENT" }).success, false);
});
