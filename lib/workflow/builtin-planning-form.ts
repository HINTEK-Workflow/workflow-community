import { formDocumentSchema, type FormDocument } from "./form-document";
import { formMetaSchema } from "./form-publish";
import type { BuiltinForm } from "./builtin-forms";
import { ACTIVITY_TYPES } from "../self-inspection/model";

/**
 * Planering och kravbestämning (egenkontroll etapp 2, 2026-10-06): Workflow's own form for planning an
 * assignment before the work starts – knowledge of the installation, the requirements that apply, deviations with
 * their reason, the scope of the inspection and who performs and inspects. Written in our own words; it names no
 * standard, regulation or publisher and holds no text from them – the company writes which rules it applies. "Utförs
 * av" and "Kontrolleras av" start from the assignment's roles in the self-inspection programme.
 */
export const PLANNING_FORM_ID = "hintek-planering-kravbestamning";

/**
 * "Kontrollens omfattning" (2026-10-07): the points of the checklist `moment` and the moment of Kontroll före
 * idrifttagning (its section id) each one selects there. A new control in the same project starts with those moments on
 * (lib/self-inspection/planning-scope.ts). The form itself is unchanged by this: only the id and the text of a point are
 * used in it, so the form's stored versions stay as they are.
 */
export const PLANNING_SCOPE_KEY = "moment";
export const PLANNING_SCOPE_POINTS = [
  { id: "moment-1", text: "Okulär kontroll", moment: "kfid-vis" },
  { id: "moment-2", text: "Kontinuitet i skyddsledare", moment: "kfid-cont" },
  { id: "moment-3", text: "Isolationsresistans", moment: "kfid-iso" },
  { id: "moment-4", text: "Automatisk frånkoppling", moment: "kfid-zs" },
  { id: "moment-5", text: "Jordfelsbrytare", moment: "kfid-rcd" },
  { id: "moment-6", text: "Fasföljd", moment: "kfid-volt" },
  // The control's Visuell kontroll holds the points about function and polarity, so a function test selects it too.
  { id: "moment-7", text: "Funktionsprov", moment: "kfid-vis" },
] as const;

const id = (suffix: string) => `plan-${suffix}`;
const field = (key: string, label: string, input: string, extra: Record<string, unknown> = {}) => ({ id: id(`f-${key}`), type: "field", key, label, input, width: input === "textarea" ? "full" : "third", ...extra });

export const planningFormDocument: FormDocument = formDocumentSchema.parse({
  schema: 2,
  report: { title: "Planering och kravbestämning", code: "", taskFacts: true },
  task: { layout: "panel", titleKey: "", requiredMarks: false, newTitle: "Ny planering", tagline: "Underlag, krav och kontrollens omfattning innan arbetet börjar." },
  blocks: [
    { id: id("a-uppdrag"), type: "section", title: "Uppdraget", blocks: [
      field("uppdrag", "Uppdrag", "text", { required: true, prefill: "project" }),
      field("anlaggning", "Anläggning", "text", { prefill: "facility" }),
      field("datum", "Datum", "date", { required: true, prefill: "today" }),
      field("typ", "Typ av arbete", "choice", { required: true, options: ["Nyinstallation", "Ändring eller utökning", "Service eller reparation", "Annat"] }),
      field("verksamhetstyp", "Verksamhetstyp", "choice", { options: ACTIVITY_TYPES.map((type) => type.label), help: "Den typ av elinstallationsarbete uppdraget gäller, som i företagets egenkontrollprogram." }),
      field("planerare", "Planerat av", "text", { required: true, prefill: "user" }),
      field("beskrivning", "Vad arbetet omfattar", "textarea", { required: true }),
    ] },
    { id: id("a-kannedom"), type: "section", title: "Anläggningskännedom", description: "Det som behöver vara känt om anläggningen innan arbetet planeras.", blocks: [
      field("underlag", "Underlag om anläggningen", "textarea", { help: "Till exempel ritningar, tidigare protokoll, märkning och uppgifter från anläggningens innehavare." }),
      field("forutsattningar", "Förutsättningar på platsen", "textarea", { help: "Till exempel matning, nätsystem, skydd och annat som påverkar hur arbetet utförs." }),
      field("kontakt", "Kontakt hos anläggningens innehavare", "text", { prefill: "contact" }),
    ] },
    { id: id("a-krav"), type: "section", title: "Kravbestämning", description: "Vilka krav arbetet ska uppfylla. Företaget skriver själv vilka regler och vilken utgåva det tillämpar.", blocks: [
      field("krav", "Krav som gäller för arbetet", "textarea", { required: true, help: "Regler och dokument som företaget tillämpar, med utgåva, och krav från kunden." }),
      field("avsteg", "Avsteg och motivering", "textarea", { help: "Om arbetet görs på ett annat sätt än det som normalt tillämpas: vad som avviker och varför säkerheten ändå är tillgodosedd." }),
      field("dokumentation", "Kundens krav på dokumentation", "textarea"),
    ] },
    { id: id("a-kontroll"), type: "section", title: "Kontrollens omfattning", description: "Vad som ska kontrolleras innan anläggningen tas i drift, och av vem.", blocks: [
      { id: id("l-moment"), type: "checklist", key: PLANNING_SCOPE_KEY, label: "Kontroller som ska göras", mode: "check", items: PLANNING_SCOPE_POINTS.map(({ id: pointId, text }) => ({ id: pointId, text })) },
      field("ovrig_kontroll", "Övriga kontroller", "textarea"),
      field("utfors_av", "Utförs av", "text", { prefill: "assignee" }),
      field("kontrolleras_av", "Kontrolleras av", "text", { prefill: "inspector", help: "Fylls i med den ansvariga när hen har en kontrollerande roll i egenkontrollprogrammet." }),
    ] },
    { id: id("a-andrat"), type: "section", title: "Ändrade förutsättningar", description: "Ändras förutsättningarna under arbetet görs kravbestämningen om.", blocks: [
      field("andrat", "Ändringar och ny kravbestämning", "textarea", { help: "Vad som ändrats, när, och vad som gäller nu." }),
      { id: id("s-planerare"), type: "signature", key: "signatur", label: "Planerat av", required: true, width: "half" },
    ] },
  ],
});

export const planningForm: BuiltinForm = {
  id: PLANNING_FORM_ID, document: planningFormDocument, meta: formMetaSchema.parse({
    name: "Planering och kravbestämning", icon: "clipboard-check", color: "blue", category: "ELECTRICAL",
    description: "Planering inför ett elinstallationsarbete: anläggningskännedom, krav, avsteg och kontrollens omfattning.",
  }),
};
