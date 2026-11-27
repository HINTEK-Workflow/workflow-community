// Uppdraget som ett samtal (2026-11-23): a follow-up changes the CURRENT mission – when, to whom, how, the name, or more of what the
// agent does – with Workflow's own rules; what no agent does is refused; and Workflow's answer says it in plain words, asks one thing
// with ready answers, or says that all is right.
import assert from "node:assert/strict";
import { test } from "node:test";
import { changedCards, chatAnswer, chatQuestion, choiceChanged, EXAMPLE_PROMPTS, missionChoices, missionSentence, scheduleWords, understoodWords } from "../lib/agents/chat";
import { checkMission, type MissionFacts } from "../lib/agents/check";
import { aboutWhen, aboutWho, interpretMission, refineMission } from "../lib/agents/interpret";
import type { MissionDraft } from "../lib/agents/model";

const friday = new Date("2026-11-20T09:00:00Z");
const custom = (patch: Partial<MissionDraft> = {}): MissionDraft => ({ name: "Veckans läge", instruction: "Sammanfatta veckans arbetsordrar", templateKey: "custom", scope: { projectIds: [], roundScheduleId: null, sources: ["work_orders"], period: "week" },
  schedule: { kind: "weekly", weekdays: [5], time: "14:00" }, target: { kind: "report", publish: "draft", channels: [] }, feedback: ["NOTICE"], ...patch });
const members = { u1: "Anna Berg", u2: "Lisa Holm", u3: "Lisa Ek" };
const refine = (text: string, current = custom()) => refineMission(current, text, { members, now: friday });

test("a follow-up changes when: the day, the time, every other week, an event – and only that", () => {
  const monday = refine("ta måndagar i stället");
  assert.deepEqual(monday.draft.schedule, { kind: "weekly", weekdays: [1], time: "14:00" }, "the time stays");
  assert.deepEqual(monday.changes, ["Agenten körs nu måndagar 14:00."]);
  assert.equal(monday.whatChanged, false);
  assert.equal(monday.draft.instruction, "Sammanfatta veckans arbetsordrar", "what the agent does is untouched");
  assert.deepEqual(refine("kl 8 och 15").draft.schedule, { kind: "weekly", weekdays: [5], time: "08:00", times: ["15:00"] }, "the days stay");
  assert.deepEqual(refine("kl. 7", custom({ schedule: { kind: "daily", time: "08:00", times: ["15:00"] } })).draft.schedule, { kind: "daily", time: "07:00" });
  assert.deepEqual(refine("varannan vecka").draft.schedule, { kind: "biweekly", weekdays: [5], from: "2026-11-20", time: "14:00" }, "the weekday it had");
  assert.equal(refine("sista dagen i månaden").draft.schedule.kind, "monthly_last");
  assert.deepEqual(refine("kör den när en avvikelse registreras i stället").draft.schedule, { kind: "event", event: "deviation_created", time: "07:00" });
});

test("a follow-up changes to whom: the owner's channels and more recipients, added, taken away or only", () => {
  assert.deepEqual(refine("skicka det som e-post också").draft.feedback, ["NOTICE", "EMAIL"]);
  assert.deepEqual(refine("bara e-post").draft.feedback, ["EMAIL"]);
  assert.deepEqual(refine("utan notis, jag vill ha mejl", custom({ feedback: ["NOTICE", "CHAT"] })).draft.feedback, ["CHAT", "EMAIL"]);
  const none = refine("ta bort notisen");
  assert.deepEqual(none.draft.feedback, []);
  assert.deepEqual(none.denied, [], "taking a channel away is no permanent delete");
  const admins = refine("skicka även till alla administratörer");
  assert.deepEqual(admins.draft.recipients, { userIds: [], roles: ["admins"] });
  assert.deepEqual(admins.draft.feedback, ["NOTICE"], "the owner's own channel is untouched");
  assert.match(admins.changes[0]!, /också som e-post till alla administratörer/);
  assert.deepEqual(refine("mejla Anna Berg också").draft.recipients, { userIds: ["u1"], roles: [] });
  assert.deepEqual(refine("skicka till anna").draft.recipients, { userIds: ["u1"], roles: [] }, "a first name that is one person's");
  assert.equal(refine("skicka till lisa").draft.recipients, undefined, "two Lisa: nobody is guessed");
  const all = custom({ recipients: { userIds: ["u1"], roles: ["admins", "everyone"] } });
  assert.deepEqual(refine("inte till administratörerna", all).draft.recipients, { userIds: ["u1"], roles: ["everyone"] });
  assert.equal(refine("bara till mig", all).draft.recipients, undefined);
});

test("an hour written as a word: klockan sju, kl. fjorton (2026-11-24)", () => {
  const read = interpretMission("Lista varje måndag klockan sju arbetsordrar som saknar ansvarig", { now: friday });
  assert.deepEqual(read.draft.schedule, { kind: "weekly", weekdays: [1], time: "07:00" });
  assert.ok(!read.questions.some((item) => item.field === "schedule"), "no question about the time");
  assert.deepEqual(refine("kör på fredagar klockan fjorton i stället", custom({ schedule: { kind: "weekly", weekdays: [1], time: "07:00" } })).draft.schedule, { kind: "weekly", weekdays: [5], time: "14:00" });
  assert.deepEqual(refine("klockan åtta och klockan sexton").draft.schedule, { kind: "weekly", weekdays: [5], time: "08:00", times: ["16:00"] });
});

test("an answer the mission already follows changes nothing and is never added to what the agent does (2026-11-24)", () => {
  // The ready answer E-post to "Hur vill du få resultatet?" is sent as "bara E-post"; a template mission already had e-mail.
  const template: MissionDraft = { ...custom({ feedback: ["EMAIL"] }), templateKey: "weekly_work_orders", instruction: "", scope: { projectIds: [], roundScheduleId: null } };
  const cases: [string, MissionDraft, RegExp][] = [
    ["bara E-post", template, /^Du får resultatet som e-post\.$/i], ["bara notis", custom(), /^Du får resultatet som en notis./],
    ["kör på fredagar kl 14", custom(), /^Det gäller redan för uppdraget\.$/], ["skicka även till alla administratörer", custom({ recipients: { userIds: [], roles: ["admins"] } }), /^Det gäller redan för uppdraget\.$/],
  ];
  for (const [words, current, said] of cases) {
    const same = refine(words, current);
    assert.equal(same.whatChanged, false, words);
    assert.equal(same.draft.templateKey, current.templateKey, `${words}: the template stays`);
    assert.equal(same.draft.instruction, current.instruction, `${words}: what the agent does is untouched`);
    assert.equal(same.changes.length, 1, words);
    assert.match(same.changes[0]!, said, words);
  }
});

test("a follow-up about a post, the PDF and the name", () => {
  const post = custom({ target: { kind: "post", publish: "draft", channels: ["facebook"] } });
  assert.equal(refine("publicera automatiskt", post).draft.target.publish, "auto");
  assert.deepEqual(refine("lägg även upp det på linkedin", post).draft.target.channels, ["facebook", "linkedin"]);
  assert.equal(refine("bifoga en pdf").draft.target.attachPdf, true);
  assert.equal(refine("döp det till Fredagsläget").draft.name, "Fredagsläget");
});

test("words about what the agent does are added to its own words; a template mission then follows the owner's words", () => {
  const more = refine("ta också med vilka offerter som väntar på svar");
  assert.equal(more.whatChanged, true);
  assert.equal(more.draft.instruction, "Sammanfatta veckans arbetsordrar. ta också med vilka offerter som väntar på svar");
  assert.deepEqual(more.draft.scope.sources, ["work_orders", "quotes"]);
  assert.deepEqual(more.draft.schedule, custom().schedule, "when is untouched");
  const assign = refine("sätt ansvarig på dem som saknar det");
  assert.deepEqual([assign.draft.target.kind, assign.draft.target.tools], ["actions", ["update_task"]], "a change the owner approves in the check");
  const template: MissionDraft = { ...custom(), templateKey: "open_deviations", instruction: "", scope: { projectIds: [], roundScheduleId: null } };
  const own = refine("visa också vem som är ansvarig", template);
  assert.equal(own.draft.templateKey, "custom");
  assert.match(own.draft.instruction, /^Listar öppna avvikelser.*visa också vem som är ansvarig$/);
  assert.match(own.changes[0]!, /egna ord i stället för mallen/);
  assert.equal(refine("ta tisdagar", template).draft.templateKey, "open_deviations", "a change of when keeps the template and its rules");
});

test("what no agent ever does is refused with its reason and changes nothing", () => {
  const refused = refine("signera protokollen åt mig varje måndag");
  assert.match(refused.denied[0]!, /signerar aldrig/);
  assert.deepEqual(refused.draft, custom());
  assert.deepEqual(refused.changes, []);
  assert.match(refine("ta bort gamla arbetsordrar").denied[0]!, /aldrig bort/);
});

const facts = (patch: Partial<MissionFacts> = {}): MissionFacts => ({
  now: friday, server: true, ownerActive: true, admin: true, modulesOn: ["planning", "time", "quotes", "invoicing", "web_posts"], rights: [], missionCount: 0,
  ai: { ready: true, reason: null }, credits: { system: true, balance: 10 }, connections: { facebook: { connected: true, publishing: true, name: "Sidan" }, instagram: { connected: false, publishing: false, name: null }, linkedin: { connected: false, publishing: false, name: null } },
  news: false, projects: {}, rounds: {}, ...patch,
});
const answer = (draft: MissionDraft, extra: Partial<Parameters<typeof chatAnswer>[0]> = {}) => chatAnswer({ draft, check: checkMission(draft, facts(), { creating: true }), ...extra });

test("Workflow's answer: what changed, one question with ready answers, what to fix, or that all is right", () => {
  const right = answer(custom(), { changes: ["Agenten körs nu måndagar 14:00."] });
  assert.equal(right.ok, true);
  assert.equal(right.text, "Agenten körs nu måndagar 14:00.\n\nAllt stämmer. Du kan spara.");
  const whole = answer(custom(), { whole: true });
  assert.equal(whole.text, "Jag har fyllt i korten.\n\nAllt stämmer. Du kan spara.", "short: the cards show what holds");
  const noChannel = answer(custom({ feedback: [] }), { changes: ["Nu är inget sätt att få resultatet valt."] });
  assert.equal(noChannel.ok, false);
  assert.deepEqual([noChannel.question?.field, noChannel.question?.replies], ["feedback", ["E-post", "Notis", "Chatten"]]);
  assert.match(noChannel.text, /Hur vill du få resultatet\?$/);
  assert.doesNotMatch(noChannel.text, /behöver rättas/, "what the question asks is not said twice as a problem");
  const read = interpretMission("Skriv ett inlägg om veckans arbeten", { now: friday });
  const asked = answer(read.draft, { asked: read.questions.map((item) => item.field), whole: true });
  assert.equal(asked.question?.field, "schedule", "one question at a time, when first");
  assert.ok(asked.question!.replies.includes("Varje måndag kl. 7"));
  const broken = answer(custom({ name: "" }), { changes: ["x"] });
  assert.match(broken.text, /Det här behöver rättas först: Ge uppdraget ett namn\./);
  assert.equal(broken.ok, false);
  const refused = answer(custom(), { denied: ["Agenter signerar aldrig. Det gör en person i jobbet."] });
  assert.match(refused.text, /^Det gör agenten inte\. Agenter signerar aldrig\./);
  assert.equal(refused.ok, false, "a refusal is never followed by Du kan spara");
  assert.equal(chatQuestion(custom({ instruction: "" }), { problems: [] })?.field, "instruction");
  const aiOff = chatAnswer({ draft: custom(), check: checkMission(custom(), facts({ ai: { ready: false, reason: "Av." } }), { creating: true }), whole: true });
  assert.match(aiOff.text, /Utan Workflow AI blir det bara en lista/);
  assert.equal(aiOff.ok, true);
});

test("the choices as they stand, and a choice changed with its chip", () => {
  const draft = custom({ feedback: ["EMAIL"], recipients: { userIds: ["u1"], roles: ["admins"] } });
  assert.deepEqual(missionChoices(draft, members).map((item) => `${item.label}: ${item.value}`), [
    "När: Fredagar 14:00", "Till vem: E-post till mig, e-post till alla administratörer och Anna Berg", "Resultat: Bara en rapport", "Underlag: Arbetsordrar"]);
  assert.match(missionSentence(draft, members), /och alla administratörer och Anna Berg får det som e-post\.$/);
  assert.equal(choiceChanged("when", custom({ schedule: { kind: "daily", time: "07:00" } })), "När är nu: Varje vardag 07:00.");
  assert.equal(EXAMPLE_PROMPTS.length, 4);
  for (const prompt of EXAMPLE_PROMPTS) assert.deepEqual(interpretMission(prompt, { now: friday }).questions.filter((item) => item.field === "schedule"), [], prompt);
});

test("fewer false hits: a day or a time changes when only in words about when the agent runs", () => {
  for (const words of ["ta måndagar i stället", "kör den på tisdagar", "varje fredag", "kl 8 och 15", "måndagar och torsdagar", "14:00", "byt till onsdag", "varannan vecka", "sista dagen i månaden", "den 5 december kl 9", "på fredagar"]) assert.equal(aboutWhen(words), true, words);
  for (const words of ["ta med arbetsordrar som ska vara klara på fredag", "lista det som förfaller på måndag", "visa vad som bokades i tisdags", "ta också med vilka offerter som väntar"]) assert.equal(aboutWhen(words), false, words);
  const described = refine("ta också med arbetsordrar som ska vara klara på fredag");
  assert.deepEqual(described.draft.schedule, custom().schedule, "the day is part of what the agent does");
  assert.equal(described.whatChanged, true);
  assert.match(described.draft.instruction, /klara på fredag$/);
  assert.deepEqual(refine("visa även det som blev klart 14:00 i går").draft.schedule, custom().schedule, "a time inside a description");
});

test("fewer false hits: a colleague's name or a role adds a recipient only in words about who gets it", () => {
  assert.equal(aboutWho("skicka till anna"), true);
  assert.equal(aboutWho("visa annas arbetsordrar först"), false);
  const about = refine("visa vilka arbetsordrar Anna Berg har");
  assert.equal(about.draft.recipients, undefined, "a name in a description is nobody's e-mail");
  assert.equal(about.whatChanged, true);
  assert.equal(refine("lista vad administratörerna har ändrat").draft.recipients, undefined);
  assert.deepEqual(refine("mejla Anna Berg").draft.recipients, { userIds: ["u1"], roles: [] });
  assert.deepEqual(refine("även alla administratörer").draft.recipients, { userIds: [], roles: ["admins"] });
});

test("the cards a message filled in, and the key words Workflow understood", () => {
  const before = custom();
  const when = refine("varannan måndag kl 8 och 15").draft;
  assert.deepEqual(changedCards(before, when), ["when"]);
  assert.deepEqual(understoodWords(before, when), ["Måndag", "08:00", "15:00", "Varannan vecka"]);
  assert.deepEqual(scheduleWords({ kind: "weekly", weekdays: [5], time: "14:00" }), ["Fredag", "14:00", "Varje vecka"]);
  const who = refine("skicka som e-post även till Anna Berg och alla administratörer, till mig också").draft;
  assert.deepEqual(changedCards(before, who), ["who"]);
  assert.deepEqual(understoodWords(before, who, members), ["Notis i Workflow", "E-post", "Alla administratörer", "Anna Berg"]);
  const what = refine("sätt ansvarig på dem som saknar det").draft;
  assert.deepEqual(changedCards(before, what), ["what", "result"]);
  assert.deepEqual(understoodWords(before, what), ["Ändringar i Workflow"]);
  assert.deepEqual(changedCards(before, before), []);
  assert.deepEqual(understoodWords(before, before), [], "nothing for a card the words did not touch");
});
