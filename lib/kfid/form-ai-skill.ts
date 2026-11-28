import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { FORM_SCHEMA_PARTS } from "@/lib/workflow/form-document";
import { FORM_SHARE_FORMAT, formSharePackageSchema } from "./form-share";
import { ZipWriter } from "./zip-writer";

/**
 * "Skapa formulär med extern AI" (2026-11-24): a skill package that lets any AI system – one that reads Agent Skills
 * (SKILL.md with YAML front matter, references/, assets/) or one that is simply given the files – write a complete form
 * file that the ordinary form import reads. The package is the folder skills/hintek-workflow-form-builder; its schema
 * (references/schema.json, JSON Schema 2020-12) is generated here from the very zod schemas the import uses.
 *
 * Keeping it current: tests/form-ai-skill.test.ts regenerates the schema and fails when the committed file differs, when
 * the format's fingerprint below no longer matches (the import format changed), when an example no longer imports or
 * publishes, or when the instructions miss a block type or input. After a change of the format: update SKILL.md and the
 * references, raise FORM_AI_SKILL_VERSION (the major number is the file format's formatVersion), write the new
 * fingerprint here and run `npx tsx scripts/form-ai-skill/build-schema.ts`.
 */
export const FORM_AI_SKILL_NAME = "hintek-workflow-form-builder";
export const FORM_AI_SKILL_VERSION = "1.1.0";
/** The format version of the form file the package writes (formSharePackageSchema's formatVersion). */
export const FORM_AI_SKILL_FORMAT_VERSION = 1;
/** sha256 of the generated schema without its version fields: changes exactly when the import format changes. */
// 1.1.0 (2026-11-28): the form categories VA och värme, Tillsyn och besiktning and Miljö.
export const FORM_AI_SKILL_SCHEMA_SHA256 = "c47cd0df9d49983e8d3b6fbae0e6c7d636acaa8696ab9c6650e0479fb528f7e9";
export const FORM_AI_SKILL_DIR = path.join("skills", FORM_AI_SKILL_NAME);
/** Every file of the package, in the order they are zipped. Nothing else from the folder is ever sent. */
export const FORM_AI_SKILL_FILES = [
  "SKILL.md",
  "README.md",
  "LASMIG.md",
  "references/schema.json",
  "references/format-reference.md",
  "references/instruktioner-sv.md",
  "assets/mall.json",
  "assets/exempel-egenkontroll.json",
  "assets/exempel-matprotokoll.json",
  "assets/exempel-riskbedomning.json",
] as const;
export const FORM_AI_SKILL_ASSETS = FORM_AI_SKILL_FILES.filter((file) => file.startsWith("assets/"));
export const formAiSkillZipName = () => `${FORM_AI_SKILL_NAME}-${FORM_AI_SKILL_VERSION}.zip`;

/** Readable names for the parts of the format in the schema's $defs, with a short description each. */
const NAMED: [z.ZodType, string, string][] = [
  [FORM_SCHEMA_PARTS.sectionBlock, "Section", "A section (Avsnitt): a titled group of blocks. Put every block in a section; sections are the top level of document.blocks."],
  [FORM_SCHEMA_PARTS.leafBlock, "Block", "One block of a section, chosen by its type."],
  [FORM_SCHEMA_PARTS.columnsBlock, "ColumnsBlock", "Legacy side-by-side layout; the builder turns it into blocks with a width. Prefer width on each block."],
  [FORM_SCHEMA_PARTS.column, "TableColumn", "A column of a table block, chosen by its input."],
  [FORM_SCHEMA_PARTS.condition, "Condition", "Show the block only while a field's answer meets the condition (empty key = always shown)."],
  [FORM_SCHEMA_PARTS.limit, "Limit", "A configurable limit named by the form; leave the numbers null – the technician or the company's limit profile gives the values."],
  [FORM_SCHEMA_PARTS.band, "Band", "A level of a computed value from a number upwards, with a name and a tone."],
  [FORM_SCHEMA_PARTS.report, "Report", "The PDF's heading and code."],
  [FORM_SCHEMA_PARTS.moments, "Moments", "The heading over sections that can be switched on and off."],
  [FORM_SCHEMA_PARTS.task, "Task", "How the task's basic data is shown."],
];
for (const option of FORM_SCHEMA_PARTS.leafBlock.options) {
  const type = (option.shape.type as z.ZodLiteral<string>).value;
  NAMED.push([option, `Block_${type}`, `A block of type "${type}".`]);
}

type JsonSchema = Record<string, unknown>;

/** Objects in the import accept no other keys than their own (lib/kfid/form-import-guard.ts), so the schema says so. */
function closeObjects(node: unknown): void {
  if (Array.isArray(node)) { node.forEach(closeObjects); return; }
  if (!node || typeof node !== "object") return;
  const schema = node as JsonSchema;
  if (schema.type === "object" && schema.properties && schema.additionalProperties === undefined) schema.additionalProperties = false;
  for (const value of Object.values(schema)) closeObjects(value);
}

/** The structural schema: what the import accepts, nothing about this package's version. */
function structuralSchema(): JsonSchema {
  const registry = z.registry<{ id: string; description: string }>();
  for (const [schema, id, description] of NAMED) registry.add(schema, { id, description });
  const generated = z.toJSONSchema(formSharePackageSchema, { target: "draft-2020-12", io: "input", unrepresentable: "any", metadata: registry, cycles: "ref", reused: "inline" }) as JsonSchema;
  closeObjects(generated);
  return generated;
}

const fingerprintOf = (schema: JsonSchema) => createHash("sha256").update(JSON.stringify(schema)).digest("hex");
export const formAiSkillSchemaFingerprint = () => fingerprintOf(structuralSchema());

/** references/schema.json: the import format as JSON Schema 2020-12, with the package's name and version on top. */
export function formAiSkillSchema(): JsonSchema {
  const { $schema, ...rest } = structuralSchema();
  return {
    $schema,
    $id: `urn:${FORM_SHARE_FORMAT}:format-${FORM_AI_SKILL_FORMAT_VERSION}`,
    title: `Form file (${FORM_SHARE_FORMAT}, formatVersion ${FORM_AI_SKILL_FORMAT_VERSION})`,
    description: "A form file for the Workflow form import. Generated from the import's own validation; objects accept no other keys. Leave out \"signature\": only Workflow signs files.",
    "x-skill-version": FORM_AI_SKILL_VERSION,
    ...rest,
  };
}
export const formAiSkillSchemaText = () => `${JSON.stringify(formAiSkillSchema(), null, 2)}\n`;

/** The package as a zip with one folder named like the skill, as skill uploads expect. Reads only the listed files. */
export async function formAiSkillZip(root = process.cwd()): Promise<Uint8Array> {
  const zip = new ZipWriter();
  const parts: Uint8Array[] = [];
  for (const file of FORM_AI_SKILL_FILES) {
    const data = await readFile(path.join(root, FORM_AI_SKILL_DIR, ...file.split("/")));
    parts.push(...zip.file(`${FORM_AI_SKILL_NAME}/${file}`, new Uint8Array(data.buffer, data.byteOffset, data.byteLength), { compress: true }));
  }
  parts.push(zip.finish());
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { result.set(part, at); at += part.byteLength; }
  return result;
}
