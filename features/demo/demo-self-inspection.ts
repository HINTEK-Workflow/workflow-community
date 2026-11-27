import { applySelfInspectionAction } from "@/lib/self-inspection/document";
import { arrangeCards } from "@/lib/self-inspection/structure";
import { cardHistory, documentLevels, documentReminders, emptySelfInspectionDocument, selfInspectionView, type SelfInspectionAction, type SelfInspectionDocument } from "@/lib/self-inspection/model";
import { addSwedishDays, swedishDayKey } from "@/lib/swedish-time";
import { localTaskSubject, workContext } from "@/lib/self-inspection/work";
import { checkLevel, effectiveRiskClass, levelsView, type LevelAction, type RiskSubject } from "@/lib/self-inspection/levels";
import { savedTaskRefusal } from "@/lib/self-inspection/task-work";
import { planningScope } from "@/lib/self-inspection/planning-scope";
import { PLANNING_FORM_ID } from "@/lib/workflow/builtin-planning-form";
import { hasWorkflowPermission } from "@/lib/workflow/permissions";
import { DEMO_ADMIN_ID, DEMO_COMPANY, type DemoDatabase, type DemoUser } from "./demo-data";
import { SelfInspectionError } from "@/lib/self-inspection/model";
import { DEVIATION_PHOTO_LIMIT, mayHandleDeviation, type DeviationPhotoPhase } from "@/lib/self-inspection/incidents";
import {
  createOrderRefusal, deviationOrderAssignee, deviationWorkOrderActionSchema, documentAfterOrderSave, documentOrders, documentWithEntryOrder, documentWithoutOrder, mayReadDeviation, orderForRow, storedOrderFacts,
  withDeviationOrders, workOrderFromDeviation, type StoredOrder,
} from "@/lib/self-inspection/deviation-link";

/**
 * Egenkontroll in the demo (2026-10-06): an invented, approved programme for the invented company, kept in memory
 * with the same rules as Cloud and Local. Nothing is stored; a reload starts over.
 */
let doc: SelfInspectionDocument | null = null;
let seeding: Promise<void> | null = null;

export function ensureDemoSelfInspection(db: DemoDatabase) {
  return (seeding ??= seed(db));
}

async function seed(db: DemoDatabase) {
  const admin = db.users.find((user) => user.id === DEMO_ADMIN_ID)!;
  const actor = { id: admin.id, name: admin.name, admin: true };
  const people = db.users.map((user) => ({ id: user.id, name: user.name }));
  // Approved 340 days ago, so the yearly review is due within the month and shows in the bell.
  const now = addSwedishDays(new Date(), -340);
  let next = await applySelfInspectionAction(emptySelfInspectionDocument(), { action: "create_program" }, actor, { now });
  const program = next.program!;
  const role = (key: string) => program.roles.find((item) => item.key === key)!.id;
  const step = async (action: SelfInspectionAction) => { next = await applySelfInspectionAction(next, action, actor, { now, people }); };
  await step({ action: "save_program", revision: next.program!.revision, title: "Egenkontrollprogram", activityTypes: ["LV_HOMES", "LV_PUBLIC", "LV_OTHER_USE"], worksOnOthersInstallations: true,
    registrationCheckedAt: swedishDayKey(now), sections: next.program!.sections.map(({ id, key, title, body, legalRef }) => ({ id, title, body: withDemoMarkers(key, demoSectionBody(body)), legalRef })) });
  for (const [key, personId, level] of [["manager", "demo-elna", ""], ["ere", "demo-elna", "AL"], ["program_admin", "demo-elna", ""], ["planner", "demo-elin", ""], ["installer", "demo-elis", ""], ["inspector", "demo-elon", ""]] as const)
    await step({ action: "assign_role", revision: next.program!.revision, roleId: role(key), personId, authorizationLevel: level, registered: key === "ere" });
  // Invented competence for the invented people (2026-10-06), so the document shows who may do what.
  for (const [personId, workTypes, scope, assessment, limitations, supervised] of [
    ["demo-elna", ["LV_HOMES", "LV_PUBLIC", "LV_OTHER_USE"], "Alla arbeten i företagets verksamhetstyper.", "Påhittad bedömning i demon: lång erfarenhet av installationer och kontroller.", "", false],
    ["demo-elin", ["LV_HOMES", "LV_PUBLIC"], "Planering och kravbestämning, service och mindre ändringar.", "Påhittad bedömning i demon: utbildning och flera års arbete med planering.", "", false],
    ["demo-elis", ["LV_HOMES"], "Installationer och service i bostäder.", "Påhittad bedömning i demon: grundutbildning och två års erfarenhet.", "Inga arbeten nära spänning. Arbete i ställverk bara under handledning.", true],
    ["demo-elon", ["LV_HOMES", "LV_OTHER_USE"], "Installationer och kontroll före idrifttagning.", "Påhittad bedömning i demon: erfaren montör med kontrolluppgift.", "", false],
  ] as const)
    await step({ action: "save_competence", revision: next.program!.revision, competence: { personId, workTypes: [...workTypes], scope, assessment, assessedAt: swedishDayKey(now), limitations, supervised } });
  // Ny struktur (2026-11-24: "I demo skall det ju vara ritat eftersom organisationen finns"): the roles' duties and the
  // text they share, the hired staff and the organisation drawn as cards – all invented, in the demo's own words.
  for (const [key, responsibility, groups] of DEMO_ROLE_DUTIES) {
    const current = next.program!.roles.find((item) => item.key === key);
    if (!current) continue;
    await step({ action: "save_role", revision: next.program!.revision, role: { id: current.id, name: current.name, description: current.description, duties: "", isEre: current.isEre,
      capabilities: [...current.capabilities], level: current.level, responsibility, dutyGroups: groups.map(([title, text]) => ({ title, text })) } });
  }
  await step({ action: "save_role_settings", revision: next.program!.revision, levelYears: [2, 5],
    commonDuties: "Alla på Kopplingsbyrån följer egenkontrollprogrammet, säger till när något inte stämmer och rapporterar avvikelser och tillbud samma dag. Var och en läser den gällande versionen och bekräftar att den är läst." });
  await step({ action: "save_external_person", person: { name: "Kerstin Säkringsdal", companyName: "Påhittade Bemanningen El AB (demo)", companyOrgNumber: "999999-9998", roleId: role("hired"), level: 2,
    competence: "Påhittad i demon: montör med sex års erfarenhet av bostäder och laddplatser.", periodFrom: swedishDayKey(addSwedishDays(new Date(), -400)), periodTo: swedishDayKey(addSwedishDays(new Date(), 60)), included: true } });
  // (A long assignment, so she is in the programme both when it was approved and today.)
  await step({ action: "save_external_person", person: { name: "Ture Kabelvik", companyName: "Påhittade Bemanningen El AB (demo)", companyOrgNumber: "999999-9998", roleId: role("hired"), level: 1,
    competence: "Påhittad i demon: förfrågan om hjälp med ett lagerbygge i vår. Ingår inte i programmet ännu.", periodFrom: swedishDayKey(addSwedishDays(new Date(), 90)), periodTo: swedishDayKey(addSwedishDays(new Date(), 150)), included: false } });
  // The chart: VD at the top, the ERE and the administrator under, the ones who do the work under the ERE. Under utbildning has
  // nobody in the demo company and is left off the chart.
  // Laid out by the same function as Ordna korten and Börja från förslag; the places in DEMO_CHART only give the siblings' order.
  const tidy = arrangeCards(next.program!.roles.map((item) => { const place = DEMO_CHART[item.key];
    return { roleId: item.id, x: place ? place.x : null, y: place ? place.y : null, parentId: place?.parent ? role(place.parent) : null }; }));
  await step({ action: "save_org_tree", revision: next.program!.revision, nodes: next.program!.roles.map((item, order) => {
    const card = tidy.find((one) => one.roleId === item.id)!;
    return { roleId: item.id, parentId: card.parentId, order, responsibility: DEMO_CHART[item.key]?.responsibility ?? "", x: card.x, y: card.y };
  }) });
  // Reported some days ago, not when the programme was approved (Teamet showed "340 dagar", 2026-10-29).
  const reportedAt = async (daysAgo: number, action: SelfInspectionAction) => { next = await applySelfInspectionAction(next, action, actor, { now: addSwedishDays(new Date(), -daysAgo), people }); };
  await reportedAt(12, { action: "save_deviation", deviation: { kind: "DEVIATION", title: "Märkning saknades i elcentral efter byte av jordfelsbrytare", description: "Upptäckt vid kontroll före idrifttagning.", category: "ROUTINE", severity: "LOW",
    systematic: true, status: "IN_PROGRESS", action: "Lägg till märkning i kontrollpunkterna för centralbyten.", responsibleId: "demo-elin", dueDate: swedishDayKey(addSwedishDays(new Date(), 10)), followUp: "" } });
  // Översiktens lyft (2026-10-29): Elna, the demo's first person, has a deviation of her own that is past its day, so Jag's
  // Mina avvikelser and Gör detta nu show what the tab does.
  await reportedAt(2, { action: "save_deviation", deviation: { kind: "DEVIATION", title: "Kabelstege saknar skyddsjordning i garaget", description: "Upptäckt vid skyddsrond i garaget. Påhittad avvikelse i demon.", category: "ROUTINE", severity: "ACUTE",
    systematic: false, status: "OPEN", action: "Montera skyddsjordning och dokumentera i egenkontrollen.", responsibleId: "demo-elna", dueDate: swedishDayKey(addSwedishDays(new Date(), -2)), followUp: "" } });
  // Översikten, Kunder (2026-10-29): the garage entry is fixed in the garage's work order at Nollpunkten Fastigheter AB, so Kunder's
  // Kräver åtgärd shows a late deviation tied to a customer (the same link rule as Cloud, lib/self-inspection/deviation-link.ts).
  const garageEntry = next.deviations.find((item) => item.title.startsWith("Kabelstege saknar skyddsjordning"));
  if (garageEntry) next = documentWithEntryOrder(next, garageEntry.id, "demo-task-garage-laddboxar", new Date().toISOString());
  // Tillbud i avvikelseloggen (2026-10-30): an invented near miss without photos, investigated and still open.
  await reportedAt(4, { action: "save_deviation", deviation: { type: "NEAR_MISS", kind: "DEVIATION", title: "Stege gled på vått golv i teknikrummet", description: "Påhittat tillbud i demon. Ingen skadades.", category: "IMMEDIATE", severity: "HIGH",
    systematic: false, status: "IN_PROGRESS", action: "Halkskydd på stegen och torka golvet innan arbetet börjar.", responsibleId: "demo-elna", dueDate: swedishDayKey(addSwedishDays(new Date(), 5)), followUp: "",
    occurredAt: addSwedishDays(new Date(), -4).toISOString(), whatHappened: "Stegen gled undan när montören klev upp. Han höll sig kvar och föll inte.", cause: "Golvet var vått efter städning och stegen saknade halkskydd.",
    serious: false, personalInjury: false, electrical: false } });
  // Every look of the log (2026-10-30): each type and each Allvarlighetsgrad, Öppen, Pågår and Åtgärdad, one late and
  // a Förbättring – invented texts, nobody real, no authority text and never a diagnosis (Personskada only as a mark). Added
  // after the three above, so their numbers (1–3) stay what the screen tests read.
  const ago = (days: number) => addSwedishDays(new Date(), -days).toISOString();
  const dayKey = (days: number) => swedishDayKey(addSwedishDays(new Date(), days));
  const base = { kind: "DEVIATION" as const, category: "ROUTINE" as const, systematic: false, followUp: "" };
  await reportedAt(20, { action: "save_deviation", deviation: { ...base, type: "RISK_OBSERVATION", severity: "LOW", title: "Lös kabelränna vid lastkajen", description: "Påhittad riskobservation i demon. Rännan sitter löst i ena fästet.",
    status: "DONE", action: "Fästet är åtdraget och kontrollerat.", responsibleId: "demo-elon", dueDate: dayKey(-14) } });
  await reportedAt(9, { action: "save_deviation", deviation: { ...base, type: "RISK_OBSERVATION", severity: "NORMAL", title: "Skymd nödutgång i källarförrådet", description: "Påhittad riskobservation i demon. Pallar står framför dörren.",
    status: "OPEN", action: "", responsibleId: "demo-elin", dueDate: dayKey(6) } });
  await reportedAt(16, { action: "save_deviation", deviation: { ...base, type: "SELF_INSPECTION", severity: "NORMAL", title: "Kopplingsschema saknades i fördelningscentral", description: "Påhittad avvikelse i demon, upptäckt vid service.",
    status: "DONE", action: "Schemat är uppdaterat och sitter i centralen.", responsibleId: "demo-elis", dueDate: dayKey(-8) } });
  await reportedAt(14, { action: "save_deviation", deviation: { ...base, type: "NEAR_MISS", severity: "HIGH", title: "Verktygsväska föll från ställning", description: "Påhittat tillbud i demon. Väskan landade en meter från en kollega.",
    status: "OPEN", action: "", responsibleId: null, dueDate: dayKey(-3), occurredAt: ago(14), whatHappened: "Väskan stod på ställningens kant sex meter upp och föll ned när plankan rörde sig.", cause: "",
    serious: true, personalInjury: false, electrical: false } });
  await reportedAt(6, { action: "save_deviation", deviation: { ...base, type: "ACCIDENT", category: "IMMEDIATE", severity: "NORMAL", title: "Skärskada vid avskalning av kabel", description: "Påhittat olycksfall i demon.",
    status: "IN_PROGRESS", action: "Gå igenom rutinen för avskalning och byt till avskalningsverktyg med skydd.", responsibleId: null, dueDate: dayKey(4), occurredAt: ago(6),
    whatHappened: "Kniven slant vid avskalning och montören skar sig i handen.", cause: "Fel verktyg för kabeltypen och dålig belysning på platsen.", serious: false, personalInjury: true, electrical: false } });
  await reportedAt(25, { action: "save_deviation", deviation: { ...base, type: "ACCIDENT", severity: "HIGH", title: "Snubblade över skarvsladd i korridor", description: "Påhittat olycksfall i demon.",
    status: "DONE", action: "Sladdar dras längs väggen och tejpas vid passager.", responsibleId: null, dueDate: dayKey(-18), occurredAt: ago(25),
    whatHappened: "Montören snubblade över en skarvsladd och tog emot sig med händerna.", cause: "Sladden låg tvärs över gångvägen utan skydd.", serious: false, personalInjury: true, electrical: false } });
  await reportedAt(3, { action: "save_deviation", deviation: { ...base, kind: "IMPROVEMENT", title: "Checklista för uppstart på ny arbetsplats", description: "Påhittad förbättring i demon: en kort lista att gå igenom första dagen.",
    status: "OPEN", action: "", responsibleId: "demo-elin", dueDate: dayKey(21) } });
  // Etapp 3 (2026-10-06): an invented instrument and a training on a competence card, which runs out within the month.
  const day = (days: number) => swedishDayKey(addSwedishDays(new Date(), days));
  // The installation tester the demo's Kontroll före idrifttagning names, and one whose calibration runs out soon.
  await step({ action: "save_instrument", instrument: { name: "Installationstestare IT-200", serialNumber: "DEMO-200-01", calibratedAt: day(-120), nextCalibrationAt: day(245), note: "Påhittat instrument i demon." } });
  await step({ action: "save_instrument", instrument: { name: "Isolationsprovare IP-5", serialNumber: "DEMO-0005", calibratedAt: day(-353), nextCalibrationAt: day(12), note: "Påhittat instrument i demon. Kalibreringen förfaller snart." } });
  // Riskklasser (2026-10-07): two set by the company, the rest Workflow's marked proposals. Elis works under supervision
  // (above), so he may do a Kontroll före idrifttagning (class 3) when a level 3 person is responsible.
  await step({ action: "set_risk_class", key: "form:hintek-kontroll-fore-idrifttagning", riskClass: 3 });
  await step({ action: "set_risk_class", key: "form:hintek-skyddsrond", riskClass: 1 });
  await step({ action: "save_credential", credential: { personId: "demo-elon", title: "Elsäkerhetsutbildning", provider: "Påhittade Elskolan (demo)", issuedAt: day(-1075), validUntil: day(20), note: "Påhittad utbildning i demon." } });
  // Kompetenskort v2 (2026-10-08): the invented company's own groups, and cards with trainings, driving licence and languages
  // for the invented people – saved a few times, so each card has a history. Every provider and person is made up.
  for (const [name, description] of [["Servicemontörer", "Service och mindre ändringar hos kund."], ["Kontrollanter", "Gör kontroll före idrifttagning."], ["Laddplatser", "Installerar laddplatser."]] as const)
    await step({ action: "save_competence_group", group: { name, description } });
  const group = (name: string) => next.competenceGroups.find((item) => item.name === name)!.id;
  const earlier = addSwedishDays(new Date(), -200);
  const stepAt = async (when: Date, action: SelfInspectionAction) => { next = await applySelfInspectionAction(next, action, actor, { now: when, people }); };
  await stepAt(earlier, { action: "save_credential", credential: { personId: "demo-elis", title: "Arbete på eller nära elektrisk anläggning", provider: "Påhittade Elskolan (demo)", issuedAt: day(-210), validUntil: day(-210 + 3 * 365), note: "Påhittad utbildning i demon." } });
  await stepAt(earlier, { action: "save_competence_card", card: { personId: "demo-elis", groupIds: [group("Servicemontörer")], licenceClasses: ["B"], licenceValidUntil: day(15), languages: [{ language: "Svenska", level: "NATIVE" }] } });
  await step({ action: "save_credential", credential: { personId: "demo-elis", title: "Installation av laddplatser", provider: "Påhittade Laddakademin (demo)", issuedAt: day(-30), validUntil: null, note: "" } });
  // Erfarenhet och nivå (2026-11-24): the levels come from the years. Elis's card was saved when he had under 5 years, so his
  // level 3 now waits for the admin to confirm it; Elin's level is adjusted up with a reason.
  await step({ action: "add_starter_lists", lists: ["areas"] });
  const areas = (next.experienceAreas ?? []).map((area) => area.id);
  await step({ action: "save_competence_card", card: { personId: "demo-elis", groupIds: [group("Servicemontörer"), group("Laddplatser")], licenceClasses: ["B"], licenceValidUntil: day(15),
    languages: [{ language: "Svenska", level: "NATIVE" }, { language: "Engelska", level: "WORK" }],
    employedAt: day(-5 * 365), employmentForm: "Tillsvidare", experienceSince: day(-Math.round(5.5 * 365)), practicalExperience: "Påhittat i demon: bostäder, laddplatser och service i flerbostadshus.", areaIds: areas.slice(0, 2) } });
  await step({ action: "save_competence_card", card: { personId: "demo-elon", groupIds: [group("Kontrollanter")], licenceClasses: ["B", "BE"], licenceValidUntil: day(900),
    languages: [{ language: "Svenska", level: "NATIVE" }, { language: "Finska", level: "FLUENT" }],
    employedAt: day(-7 * 365), employmentForm: "Tillsvidare, 80 procent", experienceSince: day(-9 * 365), practicalExperience: "Påhittat i demon: kontroll före idrifttagning och installationer i verkstäder.", areaIds: areas.slice(1, 4) } });
  await step({ action: "save_competence_card", card: { personId: "demo-elna", groupIds: [group("Kontrollanter"), group("Servicemontörer")], licenceClasses: ["B", "C1"], licenceValidUntil: day(1400),
    languages: [{ language: "Svenska", level: "NATIVE" }, { language: "Engelska", level: "FLUENT" }],
    employedAt: day(-12 * 365), employmentForm: "Tillsvidare", experienceYears: 18, experienceYearsAt: day(-340), practicalExperience: "Påhittat i demon: driver företaget och har lång erfarenhet av installationer och kontroller.", areaIds: areas.slice(0, 4) } });
  await step({ action: "save_competence_card", card: { personId: "demo-elin", groupIds: [], languages: [{ language: "Svenska", level: "NATIVE" }],
    employedAt: day(-3 * 365), employmentForm: "Tillsvidare", experienceSince: day(-4 * 365), practicalExperience: "Påhittat i demon: planering och arbetsledning i större projekt hos en tidigare arbetsgivare.", areaIds: areas.slice(0, 1) } });
  await step({ action: "set_competence_level", personId: "demo-elin", level: 3, reason: "Påhittat i demon: lång erfarenhet av planering och kravbestämning före anställningen." });
  // Fastställd sist, så att versionen bär rollerna, schemat, personalen och de inhyrda (approved 340 days ago, see above).
  await step({ action: "approve", revision: next.program!.revision, changeReason: "Första versionen av programmet." });
  next = { ...next, confirmations: [...next.confirmations, { versionId: next.versions[0].id, personId: admin.id, name: admin.name, confirmedAt: now.toISOString() }] };
  // Elis suggests a change of his own card (a member suggests, the admin edits); the admin's bell shows it.
  next = await applySelfInspectionAction(next, { action: "suggest_competence_change", text: "Jag har gått en påhittad kurs i heta arbeten i demon – kan den läggas till?" }, { id: "demo-elis", name: "Elis Hammarström", admin: false }, { people });
  // A person who left the company (2026-10-07): the card is kept three months, so it says "Sparas till …" and can be deleted
  // earlier. An invented person, who is no member of the demo company.
  const left = addSwedishDays(new Date(), -40);
  next = { ...next, credentials: [...next.credentials, { id: "demo-credential-gone", personId: "demo-gone", name: "Gunnar Gått", title: "Elsäkerhetsutbildning", provider: "", issuedAt: day(-1500), validUntil: day(-420),
    note: "Påhittad utbildning i demon. Personen har lämnat det påhittade företaget.", leftAt: left.toISOString(), files: [], createdAt: left.toISOString(), updatedAt: left.toISOString() }] };
  doc = next;
}

/**
 * The template's [placeholders] filled with the invented company's facts (2026-10-08: a realistic example with
 * clearly fictitious people and contact details – .invalid addresses, numbers in PTS:s series for books and films
 * (070-174 06 05 – 99, 2026-11-18), an organisation number that no company can have). The programme's people are the demo's users, who hold the roles below.
 */
const DEMO_CONTACT = (name: string, role: string, mail: string, phone: string) => `| ${name} | ${role} | E-post: ${mail}, tel: ${phone} |`;
const DEMO_FACTS: [RegExp, string][] = [
  [/\| \[Namn\] \| VD \|[^\n]*/, DEMO_CONTACT("Elna Strömtång", "VD", "elna.stromtang@exempelel.invalid", "070-174 06 35")],
  [/\| \[Namn\] \| Elinstallatör för regelefterlevnad \|[^\n]*/, DEMO_CONTACT("Elna Strömtång", "Elinstallatör för regelefterlevnad", "elna.stromtang@exempelel.invalid", "070-174 06 35")],
  [/\| \[Namn\] \| Administratör för egenkontrollprogrammet \|[^\n]*/, DEMO_CONTACT("Elna Strömtång", "Administratör för egenkontrollprogrammet", "elna.stromtang@exempelel.invalid", "070-174 06 35")],
  [/\[[Ff]öretagets namn\]/g, DEMO_COMPANY],
  [/\[organisationsnummer\]/g, "999999-9999"],
  [/\[Beskriv kort företagets verksamhet[^\]]*\]/, "Företaget utför elinstallationer och service i fastigheter, verkstäder och industrier – laddplatser, elcentraler, belysning och ställverksarbete åt fastighetsägare och företag – och därmed förenlig verksamhet. (Påhittad verksamhet i demon.)"],
  [/\[Gatuadress\], \[postnummer och ort\]/, "Strömtångsvägen 7, 123 45 Exempelstad"],
  [/\[e-post\]/g, "info@exempelel.invalid"],
  [/\[telefon\]/g, "070-174 06 05"],
  [/ \[Anpassa rollerna efter företagets organisation\.\]/, ""],
  [/\[i samband med medarbetarsamtal\]/, "i samband med medarbetarsamtalen i januari"],
  // One ERE is appointed, so the paragraph about dividing the task between several goes.
  [/\n*Om flera elinstallatörer för regelefterlevnad[^\n]*\[[^\]]*\][^\n]*/, ""],
];
/** The demo's roles in its own words (Rollbeskrivningar): the responsibility and the duties in groups. */
const DEMO_ROLE_DUTIES: readonly [string, string, readonly (readonly [string, string])[]][] = [
  ["manager", "Leder företaget och ser till att egenkontrollen har tid och resurser.", [["Ledning", "Fastställer programmet och varje ny version\nSer till att rätt personer har rätt roller"]]],
  ["ere", "Verkar för att elinstallationsarbetet följer lag och föreskrifter.", [["Regelefterlevnad", "Följer upp att programmet används i varje uppdrag\nGår igenom avvikelser och tillbud varje månad"], ["Kompetens", "Bedömer vem som får utföra vilka arbeten"]]],
  ["program_admin", "Håller programmet aktuellt och ser till att alla har läst den gällande versionen.", [["Programmet", "Uppdaterar texterna när något ändras\nPåminner om den årliga översynen"]]],
  ["planner", "Planerar uppdragen och bestämmer kraven innan arbetet börjar.", [["Planering", "Kravbestämning tillsammans med kunden\nVäljer kontrollpunkter för uppdraget"]]],
  ["installer", "Utför installationerna enligt planeringen och dokumenterar det som görs.", [["Utförande", "Arbetar enligt planeringen och kontrollpunkterna\nRapporterar avvikelser samma dag"]]],
  ["inspector", "Utför installationer och gör kontroll före idrifttagning.", [["Kontroll", "Gör och dokumenterar kontroll före idrifttagning\nSäger till om något inte kan godkännas"]]],
  ["hired", "Arbetar under en period enligt företagets program och under ledning av ERE.", [["Utförande", "Går igenom programmet första dagen\nArbetar enligt planeringen"]]],
  ["trainee", "Lär sig yrket och arbetar alltid tillsammans med en handledare.", [["Lärande", "Arbetar under handledning\nFår nya uppgifter i takt med erfarenheten"]]],
];
/** The demo's chart (column of 24, a card is 4 wide; rows of 24 px) and each card's responsibility in the organisation. */
const DEMO_CHART: Record<string, { x: number; y: number; parent?: string; responsibility: string }> = {
  manager: { x: 10, y: 0, responsibility: "Ytterst ansvarig för verksamheten och för att programmet fastställs." },
  ere: { x: 6, y: 8, parent: "manager", responsibility: "Leder och följer upp elinstallationsarbetet." },
  program_admin: { x: 14, y: 8, parent: "manager", responsibility: "Sköter programmet, versionerna och läskvittona." },
  planner: { x: 0, y: 16, parent: "ere", responsibility: "Planerar och kravbestämmer uppdragen." },
  installer: { x: 5, y: 16, parent: "ere", responsibility: "Installerar och servar hos kunderna." },
  inspector: { x: 10, y: 16, parent: "ere", responsibility: "Installerar och gör kontroll före idrifttagning." },
  hired: { x: 15, y: 16, parent: "ere", responsibility: "Förstärker under perioder med mycket arbete." },
};
/** The markers on lines of their own, where Workflow fills in the demo's roles, chart, people and hired staff. */
const DEMO_MARKERS: Record<string, string[]> = { organization: ["{{organisation}}", "{{roller}}"], ere: ["{{ere}}"], competence: ["{{nivaregel}}", "{{personal}}", "{{inhyrda}}"] };
const withDemoMarkers = (key: string, body: string) => DEMO_MARKERS[key] ? `${body}\n\n${DEMO_MARKERS[key].join("\n")}` : body;

/** Teamet (2026-10-29, punkt 3): the trainings, competence cards and instruments as they are now; the caller applies the read rule. */
export async function demoCompetenceSources(db: DemoDatabase) {
  await ensureDemoSelfInspection(db);
  return { credentials: doc?.credentials ?? [], cards: doc?.competenceCards ?? [], instruments: doc?.instruments ?? [] };
}

/** Översikten i demon (2026-10-29): the deviation log's entries as they are now; the caller applies the log's read rule. */
/** The log's entries; with a reader, only those the reader may read (lib/self-inspection/incidents.ts, as Cloud's queries). */
export async function demoDeviationEntries(db: DemoDatabase, viewer?: { id: string; admin: boolean; team?: boolean }) {
  await ensureDemoSelfInspection(db);
  return (doc?.deviations ?? []).filter((entry) => !viewer || mayReadDeviation(viewer, entry));
}

export function demoSectionBody(body: string) {
  let text = body;
  for (const [pattern, replacement] of DEMO_FACTS) text = text.replace(pattern, replacement);
  return text.replace(/\[[^\]\n]+\]/g, "Påhittad text i demon.").trim();
}

const people = (db: DemoDatabase) => db.users.map((user) => ({ id: user.id, name: user.name }));

/**
 * Avvikelse ↔ arbetsorder in the demo (2026-10-10): the same rules as Cloud and Local (lib/self-inspection/deviation-link.ts).
 * `orders`: the reader's rights to work orders and, for Skapa arbetsorder, the demo's own work order save (every check of a new order).
 */
type DemoOrders = { read: boolean; create: boolean; createWorkOrder: (task: Record<string, unknown>) => { id: string } };
const finisher = (db: DemoDatabase) => (order: StoredOrder) => { const found = db.users.find((item) => item.id === order.updatedBy); return found ? { id: found.id, name: found.name } : null; };

export async function demoSelfInspection(db: DemoDatabase, user: DemoUser, admin: boolean, method: string, body: unknown, orders?: DemoOrders) {
  await ensureDemoSelfInspection(db);
  const me = { id: user.id, name: user.name };
  // The Teamet right: a near miss or an accident is seen by its reporter, admins and this (lib/self-inspection/incidents.ts).
  const team = admin || hasWorkflowPermission(user.permissions, "team", "read");
  const order = method !== "GET" ? deviationWorkOrderActionSchema.safeParse(body) : null;
  if (order?.success) {
    if (!orders?.create) throw new SelfInspectionError(403, "Du saknar behörighet att skapa arbetsordrar.");
    const entry = doc!.deviations.find((item) => item.id === order.data.deviationId);
    if (!entry || !mayReadDeviation({ id: me.id, admin, team }, entry)) throw new SelfInspectionError(404, "Avvikelsen hittades inte.");
    const refusal = createOrderRefusal(entry, true);
    if (refusal) throw new SelfInspectionError(409, refusal);
    const protocol = entry.source ? db.tasks.find((task) => task.id === entry.source!.taskId) : undefined;
    const project = protocol?.projectId ? db.projects.find((item) => item.id === protocol.projectId) : undefined;
    const customerId = protocol?.customerId ?? project?.customerId ?? null;
    // The entry's responsible person becomes Ansvarig when the person may work with work orders (the same rule as Cloud).
    const responsible = entry.responsibleId ? db.users.find((item) => item.id === entry.responsibleId) : undefined;
    const assignee = deviationOrderAssignee(responsible ? { id: responsible.id, name: responsible.name, active: true, admin: responsible.role === "ADMIN",
      readOrders: hasWorkflowPermission(responsible.permissions, "work-order", "read"), editOrders: hasWorkflowPermission(responsible.permissions, "work-order", "edit") } : null);
    const draft = workOrderFromDeviation(entry, protocol ? { kind: protocol.kind, projectId: project && !project.archivedAt && !project.closedAt ? project.id : null, customerId, facilityId: customerId ? protocol.facilityId ?? null : null } : null, assignee);
    let created: { id: string };
    try { created = orders.createWorkOrder({ ...draft, version: 0, dueDate: "" }); }
    catch (issue) {
      // The responsible person's level is too low for the order: it is made without Ansvarig rather than not at all.
      if (!draft.assignedToUserId) throw issue;
      created = orders.createWorkOrder({ ...draft, version: 0, assignedToUserId: null, assignedToName: "", dueDate: "" });
    }
    doc = documentWithEntryOrder(doc!, entry.id, created.id, new Date().toISOString());
  } else if (method !== "GET") {
    doc = await applySelfInspectionAction(doc!, body as SelfInspectionAction, { ...me, admin, team }, { people: people(db), memberRights: (personId) => demoRights(db, personId),
      orderForRow: (row) => storedOrderFacts(orderForRow(db.tasks, row), finisher(db)) });
  }
  const view = await selfInspectionView(doc!, { me, admin, team, company: DEMO_COMPANY, people: people(db), activePeople: people(db) });
  const withOrders = withDeviationOrders(view, documentOrders(doc!, db.tasks), { read: Boolean(orders?.read), create: Boolean(orders?.create) });
  // Ansvarig for a near miss or an accident: admins and Teamet only (the same rule as Cloud).
  // Bilder (2026-10-30): the demo keeps them in the browser's memory (demoDeviationPhotoAdd below).
  return admin ? { ...withOrders, photos: true, incidentResponsibleIds: db.users.filter((item) => demoRights(db, item.id)?.team).map((item) => item.id) } : { ...withOrders, photos: true };
}
function demoRights(db: DemoDatabase, personId: string) {
  const found = db.users.find((item) => item.id === personId);
  if (!found) return null;
  const admin = found.role === "ADMIN";
  return { admin, team: admin || hasWorkflowPermission(found.permissions, "team", "read") };
}

/** After the demo saves a task: a new work order from a row takes its log entries; a finished one closes them. */
export function demoWorkOrderSaved(db: DemoDatabase, input: { taskId: string; previousStatus: string | null; by: { id: string; name: string } }) {
  const order = db.tasks.find((task) => task.id === input.taskId);
  if (doc && order) doc = documentAfterOrderSave(doc, { order, previousStatus: input.previousStatus, by: input.by, now: new Date().toISOString() });
}
/** A deleted work order lets go of its log entries. */
export function demoWorkOrderDeleted(id: string) {
  if (doc) doc = documentWithoutOrder(doc, id);
}

/** A competence card's history in the demo (kompetenskort v2), with the same rule of who reads it as Cloud. */
export async function demoCardHistory(db: DemoDatabase, user: DemoUser, admin: boolean, personId: string) {
  await ensureDemoSelfInspection(db);
  return { versions: cardHistory(doc!, personId, { id: user.id, admin }, new Map(people(db).map((person) => [person.id, person.name]))) };
}

/**
 * A project or task's view of the programme (etapp 2–3): the customer's special requirements from the customer card, the
 * scope its project's planning protocol selects (2026-10-07), and the risk class and levels of the task, or of the form or
 * kind a new one starts from.
 */
export async function demoSelfInspectionWork(db: DemoDatabase, user: DemoUser, target: { taskId: string | null; projectId: string | null; customerId: string | null; formId?: string | null; kind?: string | null }) {
  await ensureDemoSelfInspection(db);
  const task = target.taskId ? db.tasks.find((item) => item.id === target.taskId) : undefined;
  const subject: (RiskSubject & { name?: string }) | null = task ? localTaskSubject(task) : target.formId ? { kind: "FORM", formId: target.formId, category: null, name: db.forms.find((form) => form.id === target.formId)?.name }
    : target.kind === "WORK_ORDER" || target.kind === "RISK_ASSESSMENT" ? { kind: target.kind } : null;
  const customer = target.customerId ? db.customers.find((item) => item.id === target.customerId) : undefined;
  const protocols = target.projectId ? db.tasks.flatMap((item) => item.projectId === target.projectId && item.data.kind === "FORM" && item.data.details.templateId === PLANNING_FORM_ID
    ? [{ id: item.id, title: item.title, updatedAt: item.updatedAt, document: item.data.details.document, values: item.data.details.values }] : []) : [];
  return workContext(doc!, { taskId: target.taskId, projectId: target.projectId, names: new Map(people(db).map((person) => [person.id, person.name])),
    customerRequirements: customer?.specialRequirements ?? "", planning: planningScope(protocols), me: { id: user.id }, admin: user.role === "ADMIN", team: hasWorkflowPermission(user.permissions, "team", "read"), subject });
}

/** The company's levels and risk classes for the cards under Ny uppgift. */
export async function demoSelfInspectionLevels(db: DemoDatabase, user: DemoUser) {
  await ensureDemoSelfInspection(db);
  return levelsView(documentLevels(doc!, new Map(people(db).map((person) => [person.id, person.name]))), user.id, doc!.riskClasses ?? {});
}

/**
 * The level rule for the demo's tasks, with the invented programme: the same answers as Cloud, synchronously once the
 * programme is ready (the first request starts it). Null means allowed.
 */
type DemoTaskLike = { kind: string; data: unknown; status: string; assignedToUserId: string | null; assignedToName: string };
const demoRisk = (task: Pick<DemoTaskLike, "kind" | "data">) => { const subject = localTaskSubject(task); return subject && doc ? effectiveRiskClass(subject, doc.riskClasses) : null; };
export function demoSavedRefusal(db: DemoDatabase, user: DemoUser, input: { task: DemoTaskLike; current: DemoTaskLike | null; documented: boolean }): string | null {
  if (!doc) return null;
  return savedTaskRefusal({ directory: documentLevels(doc, new Map(people(db).map((person) => [person.id, person.name]))), risk: demoRisk(input.task), actor: { id: user.id, name: user.name },
    task: input.task, current: input.current, documented: input.documented, names: new Map(people(db).map((person) => [person.id, person.name])) });
}
export function demoActionRefusal(db: DemoDatabase, user: DemoUser, task: DemoTaskLike, action: LevelAction): string | null {
  if (!doc) return null;
  const names = new Map<string, string>(people(db).map((person) => [person.id, person.name]));
  const decision = checkLevel({ directory: documentLevels(doc, names), subject: demoRisk(task), action, person: { id: user.id, name: user.name }, self: true,
    responsible: task.assignedToUserId ? { id: task.assignedToUserId, name: names.get(task.assignedToUserId) } : null });
  return decision.allowed ? null : decision.message;
}

/** The bell's reminders once the programme is ready (the first request starts it). */
export function demoSelfInspectionReminders(user: DemoUser, admin: boolean) {
  return doc ? documentReminders(doc, { me: { id: user.id, name: user.name }, admin, team: admin || hasWorkflowPermission(user.permissions, "team", "read") }) : [];
}

/**
 * Bilder på avvikelser in the demo (2026-10-30): the same rules as Cloud (lib/self-inspection/deviation-photos-server.ts),
 * the picture itself only as an object URL in this browser – nothing is sent anywhere and a reload starts over.
 */
const demoPhotoUrls = new Map<string, string>();
export const demoDeviationPhotoUrl = (photoId: string) => demoPhotoUrls.get(photoId) ?? "";

export async function demoDeviationPhotoAdd(db: DemoDatabase, user: DemoUser, admin: boolean, input: { deviationId: string; phase: DeviationPhotoPhase; file: File }) {
  await ensureDemoSelfInspection(db);
  const viewer = { id: user.id, admin, team: admin || hasWorkflowPermission(user.permissions, "team", "read") };
  const entry = doc!.deviations.find((item) => item.id === input.deviationId);
  if (!entry || !mayReadDeviation(viewer, entry)) throw new SelfInspectionError(404, "Avvikelsen hittades inte.");
  if (!(mayHandleDeviation(viewer, entry) || (input.phase === "BEFORE" && entry.reportedById === user.id))) throw new SelfInspectionError(403, "Du kan inte lägga till bilder på den här avvikelsen.");
  if ((entry.attachments?.length ?? 0) >= DEVIATION_PHOTO_LIMIT) throw new SelfInspectionError(400, `Högst ${DEVIATION_PHOTO_LIMIT} bilder per avvikelse.`);
  if (!["image/jpeg", "image/png", "image/webp"].includes(input.file.type)) throw new SelfInspectionError(400, "Välj en bild (JPG, PNG eller WebP).");
  const id = crypto.randomUUID();
  demoPhotoUrls.set(id, URL.createObjectURL(input.file));
  const photo = { id, phase: input.phase, filename: input.file.name.slice(0, 200) || "bild.jpg", mimeType: input.file.type, size: input.file.size, createdById: user.id, createdAt: new Date().toISOString() };
  doc = { ...doc!, deviations: doc!.deviations.map((item) => item.id === entry.id ? { ...item, attachments: [...(item.attachments ?? []), photo] } : item) };
  return { ok: true, id };
}

export async function demoDeviationPhotoRemove(db: DemoDatabase, user: DemoUser, admin: boolean, photoId: string) {
  await ensureDemoSelfInspection(db);
  const viewer = { id: user.id, admin, team: admin || hasWorkflowPermission(user.permissions, "team", "read") };
  const entry = doc!.deviations.find((item) => item.attachments?.some((photo) => photo.id === photoId) && mayReadDeviation(viewer, item));
  const photo = entry?.attachments?.find((item) => item.id === photoId);
  if (!entry || !photo) throw new SelfInspectionError(404, "Bilden hittades inte.");
  if (!mayHandleDeviation(viewer, entry) && photo.createdById !== user.id) throw new SelfInspectionError(403, "Du kan inte ta bort den här bilden.");
  const url = demoPhotoUrls.get(photoId);
  if (url) URL.revokeObjectURL(url);
  demoPhotoUrls.delete(photoId);
  doc = { ...doc!, deviations: doc!.deviations.map((item) => item.id === entry.id ? { ...item, attachments: (item.attachments ?? []).filter((one) => one.id !== photoId) } : item) };
  return { ok: true };
}
