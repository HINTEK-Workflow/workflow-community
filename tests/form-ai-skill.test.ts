import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { inflateRawSync } from "node:zlib";
import { z } from "zod";
import { FORM_AI_SKILL_ASSETS, FORM_AI_SKILL_DIR, FORM_AI_SKILL_FILES, FORM_AI_SKILL_FORMAT_VERSION, FORM_AI_SKILL_NAME, FORM_AI_SKILL_SCHEMA_SHA256, FORM_AI_SKILL_VERSION, formAiSkillSchemaFingerprint, formAiSkillSchemaText, formAiSkillZip, formAiSkillZipName } from "../lib/kfid/form-ai-skill";
import { FORM_SHARE_FORMAT, readFormPackage } from "../lib/kfid/form-share";
import { COLUMN_INPUTS, CONDITION_OPS, evaluateForm, FIELD_INPUTS, FIELD_PREFILLS, FORM_SCHEMA_PARTS, formLeafBlocks, TABLE_LAYOUTS, type FormDocument } from "../lib/workflow/form-document";
import { FORMULA_FUNCTIONS } from "../lib/workflow/form-formula";
import { FORM_CATEGORIES, FORM_COLORS, FORM_ICONS, formPublishChecks } from "../lib/workflow/form-publish";
import { sampleFormValues } from "../lib/workflow/form-sample";
// The Community export's own name rules live in community/, which the Community edition does not carry: loaded only when present.
const EXPORT_RULES = path.join(process.cwd(), "community", "export-rules.mjs");
type ExportRules = { LEAKS: { name: string; pattern: RegExp }[]; OTHER_NAMES: { name: string; pattern: RegExp }[]; organisationIn: (text: string) => boolean };
const exportRules = async (): Promise<ExportRules | null> => (existsSync(EXPORT_RULES) ? ((await import(pathToFileURL(EXPORT_RULES).href)) as ExportRules) : null);

// "Skapa formulär med extern AI" (2026-11-24): the skill package Workflow Form Builder must describe exactly the
// format the import reads. Every test here fails when the format changes and the package does not follow.
const root = path.join(process.cwd(), FORM_AI_SKILL_DIR);
const read = (file: string) => readFileSync(path.join(root, ...file.split("/")), "utf8").replace(/\r\n/g, "\n");
const json = (file: string) => JSON.parse(read(file));
const FIXTURE = path.join(process.cwd(), "tests", "fixtures", "form-ai-skill", "tvattstugerond.json");
const forms: [string, unknown][] = [...FORM_AI_SKILL_ASSETS.map((file) => [file, json(file)] as [string, unknown]), ["fixture: tvattstugerond", JSON.parse(readFileSync(FIXTURE, "utf8"))]];

function frontMatter(text: string) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(match, "SKILL.md starts with YAML front matter");
  const fields: Record<string, string> = {};
  let parent = "";
  for (const line of match[1].split("\n")) {
    const nested = /^ {2}([a-z-]+): "?(.*?)"?$/.exec(line);
    const top = /^([a-z-]+):\s?(.*)$/.exec(line);
    if (nested && parent) fields[`${parent}.${nested[1]}`] = nested[2];
    else if (top) { parent = top[2] ? "" : top[1]; if (top[2]) fields[top[1]] = top[2]; }
  }
  return { fields, body: text.slice(match[0].length) };
}

test("the committed schema is the one generated from the import's zod schemas", () => {
  assert.equal(read("references/schema.json"), formAiSkillSchemaText(), "Run: npx tsx scripts/form-ai-skill/build-schema.ts");
});

test("a change of the import format needs a new package version", () => {
  const fingerprint = formAiSkillSchemaFingerprint();
  assert.equal(fingerprint, FORM_AI_SKILL_SCHEMA_SHA256, `The import format changed. Update SKILL.md and the references, raise FORM_AI_SKILL_VERSION (now ${FORM_AI_SKILL_VERSION}) and set FORM_AI_SKILL_SCHEMA_SHA256 to ${fingerprint}.`);
  assert.match(FORM_AI_SKILL_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(Number(FORM_AI_SKILL_VERSION.split(".")[0]), FORM_AI_SKILL_FORMAT_VERSION, "the major version is the file format's version");
  for (const file of forms) assert.equal((file[1] as { formatVersion: number }).formatVersion, FORM_AI_SKILL_FORMAT_VERSION, file[0]);
});

test("SKILL.md follows the Agent Skills specification and carries the version", () => {
  const { fields, body } = frontMatter(read("SKILL.md"));
  assert.equal(fields.name, FORM_AI_SKILL_NAME);
  assert.equal(path.basename(root), fields.name, "the name is the folder's name");
  assert.match(fields.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(fields.name.length <= 64);
  assert.ok(fields.description && fields.description.length <= 1024, "description 1–1024 characters");
  assert.equal(fields["metadata.version"], FORM_AI_SKILL_VERSION);
  assert.equal(fields["metadata.format"], FORM_SHARE_FORMAT);
  assert.equal(fields["metadata.format-version"], String(FORM_AI_SKILL_FORMAT_VERSION));
  assert.ok(body.split("\n").length < 500, "SKILL.md under 500 lines");
  const title = fields["metadata.title"];
  assert.ok(title && body.startsWith(`\n# ${title}`), "the body opens with the package's title");
  for (const file of ["README.md", "LASMIG.md", "references/format-reference.md", "references/instruktioner-sv.md"]) {
    assert.ok(read(file).includes(FORM_AI_SKILL_VERSION), `${file} names version ${FORM_AI_SKILL_VERSION}`);
    assert.ok(read(file).includes(title) || file === "references/format-reference.md", `${file} names the package`);
  }
  assert.equal(json("references/schema.json")["x-skill-version"], FORM_AI_SKILL_VERSION);
  // Every file SKILL.md points at is in the package.
  for (const match of body.matchAll(/`((?:references|assets)\/[^`*]+)`/g)) assert.ok(FORM_AI_SKILL_FILES.includes(match[1] as never), match[1]);
});

test("the package holds exactly its listed files", () => {
  const found: string[] = [];
  const walk = (dir: string, prefix = "") => { for (const name of readdirSync(dir)) { const full = path.join(dir, name); if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`); else found.push(`${prefix}${name}`); } };
  walk(root);
  assert.deepEqual(found.sort(), [...FORM_AI_SKILL_FILES].sort());
});

test("the instructions and the reference cover every block type, input, setting and function", () => {
  const reference = read("references/format-reference.md");
  const skill = read("SKILL.md");
  const swedish = read("references/instruktioner-sv.md");
  const keys = (schema: z.ZodType): string[] => { const shape = (schema as unknown as { shape?: Record<string, unknown> }).shape; return shape ? Object.keys(shape) : []; };
  const parts = [FORM_SCHEMA_PARTS.sectionBlock, FORM_SCHEMA_PARTS.column, FORM_SCHEMA_PARTS.condition, FORM_SCHEMA_PARTS.limit, FORM_SCHEMA_PARTS.band, FORM_SCHEMA_PARTS.report, FORM_SCHEMA_PARTS.moments, FORM_SCHEMA_PARTS.task, FORM_SCHEMA_PARTS.columnsBlock, ...FORM_SCHEMA_PARTS.leafBlock.options];
  for (const part of parts) for (const key of keys(part)) assert.ok(reference.includes(`\`${key}\``), `the reference explains \`${key}\``);
  for (const option of FORM_SCHEMA_PARTS.leafBlock.options) { const type = String((option.shape.type as z.ZodLiteral<string>).value); assert.ok(reference.includes(`\`${type}\``), type); assert.ok(skill.includes(`\`${type}\``) || type === "columns", `SKILL.md names ${type}`); }
  for (const value of [...FIELD_INPUTS, ...COLUMN_INPUTS, ...TABLE_LAYOUTS, ...FIELD_PREFILLS, ...CONDITION_OPS, ...FORM_COLORS, ...FORM_ICONS, ...FORM_CATEGORIES.map(([value]) => value)])
    assert.ok(reference.includes(`\`${value}\``), `the reference lists \`${value}\``);
  for (const name of FORMULA_FUNCTIONS) for (const [file, text] of [["reference", reference], ["SKILL.md", skill], ["instruktioner-sv.md", swedish]]) assert.ok(text.includes(`\`${name}\``) || text.includes(`${name}(`), `${file} names ${name}`);
  for (const text of [skill, swedish]) {
    assert.match(text, /signature/);
    assert.match(text, /ordagrant|word for word/);
    assert.match(text, /gränsvärden|limit values/);
  }
});

test("the template and every example import, publish without errors and evaluate cleanly", () => {
  const seen = { blocks: new Set<string>(), fields: new Set<string>(), columns: new Set<string>(), layouts: new Set<string>() };
  for (const [name, file] of forms) {
    assert.equal((file as { signature?: string }).signature, undefined, `${name}: never signed`);
    const { pkg, verified } = readFormPackage(file);
    assert.equal(verified, false, name);
    for (const form of pkg.forms) {
      const checks = formPublishChecks(form.meta, form.document);
      assert.deepEqual(checks.errors, [], `${name}: no publish errors`);
      assert.deepEqual(checks.warnings, [], `${name}: no publish warnings`);
      for (const deviations of [false, true]) {
        const evaluation = evaluateForm(form.document as FormDocument, sampleFormValues(form.document as FormDocument, { deviations, today: "2026-11-24" }));
        assert.deepEqual(evaluation.warnings, [], `${name}: the formulas evaluate`);
      }
      for (const block of form.document.blocks) seen.blocks.add(block.type);
      for (const block of formLeafBlocks(form.document)) {
        seen.blocks.add(block.type);
        if (block.type === "field") seen.fields.add(block.input);
        if (block.type === "table") { seen.layouts.add(block.layout); block.columns.forEach((column) => seen.columns.add(column.input)); }
      }
      // Sections only at the top level, as SKILL.md asks.
      assert.ok(form.document.blocks.every((block) => block.type === "section"), name);
    }
  }
  for (const option of FORM_SCHEMA_PARTS.leafBlock.options) { const type = String((option.shape.type as z.ZodLiteral<string>).value); assert.ok(seen.blocks.has(type), `an example uses ${type}`); }
  for (const input of FIELD_INPUTS) assert.ok(seen.fields.has(input), `an example has a ${input} field`);
  for (const input of COLUMN_INPUTS) assert.ok(seen.columns.has(input), `an example has a ${input} column`);
  for (const layout of TABLE_LAYOUTS) assert.ok(seen.layouts.has(layout), `an example has a ${layout} table`);
});

test("the examples follow the copyright precaution: no limit values, names or protected material", async () => {
  const rules = await exportRules();
  const NUMBERS = ["low", "high", "warnLow", "warnHigh", "min", "max", "allowedMin", "allowedMax"];
  for (const [name, file] of forms) {
    const walk = (value: unknown, where: string) => {
      if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${where}.${index}`));
      else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) {
        if (NUMBERS.includes(key)) assert.equal(item, null, `${name} ${where}.${key}: no limit value`);
        walk(item, `${where}.${key}`);
      }
    };
    walk(file, "");
  }
  for (const file of FORM_AI_SKILL_FILES) {
    const text = read(file);
    if (rules) {
      assert.ok(!rules.organisationIn(text), `${file}: no organisation or manufacturer`);
      for (const { name, pattern } of [...rules.LEAKS, ...rules.OTHER_NAMES]) assert.doesNotMatch(text, pattern, `${file}: ${name}`);
    }
    assert.doesNotMatch(text, /\bDaniels?\b|@[a-z0-9-]+\.[a-z]{2,}|https?:\/\/(?!json-schema\.org)/i, `${file}: no person, e-mail or web address`);
  }
});

// ---------- the schema checked with an independent JSON Schema 2020-12 reader (the keywords the schema uses) ----------
type Schema = Record<string, unknown>;
const ANNOTATIONS = new Set(["$schema", "$id", "title", "description", "default", "format", "x-skill-version", "$defs"]);
function validate(schema: Schema, value: unknown, defs: Record<string, Schema>, at = "$"): string | null {
  for (const keyword of Object.keys(schema)) if (!ANNOTATIONS.has(keyword) && !["$ref", "type", "properties", "required", "additionalProperties", "enum", "const", "pattern", "minLength", "maxLength", "minItems", "maxItems", "items", "anyOf", "oneOf", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"].includes(keyword)) return `${at}: unknown keyword ${keyword}`;
  if (typeof schema.$ref === "string") { const target = defs[schema.$ref.replace("#/$defs/", "")]; if (!target) return `${at}: missing ${schema.$ref}`; const issue = validate(target, value, defs, at); if (issue) return issue; }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const kind = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    if (!types.some((type) => type === kind || (type === "integer" && Number.isInteger(value)) || (type === "number" && kind === "number"))) return `${at}: expected ${types.join("|")}`;
  }
  if (schema.const !== undefined && value !== schema.const) return `${at}: expected ${String(schema.const)}`;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return `${at}: not in enum`;
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && [...value].length < schema.minLength) return `${at}: too short`;
    if (typeof schema.maxLength === "number" && [...value].length > schema.maxLength) return `${at}: too long`;
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) return `${at}: pattern`;
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) return `${at}: below minimum`;
    if (typeof schema.maximum === "number" && value > schema.maximum) return `${at}: above maximum`;
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) return `${at}: not above exclusiveMinimum`;
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) return `${at}: too few`;
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return `${at}: too many`;
    if (schema.items) for (let index = 0; index < value.length; index++) { const issue = validate(schema.items as Schema, value[index], defs, `${at}[${index}]`); if (issue) return issue; }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    for (const key of (schema.required ?? []) as string[]) if (!(key in value)) return `${at}: missing ${key}`;
    for (const [key, item] of Object.entries(value)) {
      if (properties[key]) { const issue = validate(properties[key], item, defs, `${at}.${key}`); if (issue) return issue; }
      else if (schema.additionalProperties === false) return `${at}: unknown key ${key}`;
    }
  }
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((option) => !validate(option as Schema, value, defs, at))) return `${at}: matches no anyOf`;
  if (Array.isArray(schema.oneOf) && schema.oneOf.filter((option) => !validate(option as Schema, value, defs, at)).length !== 1) return `${at}: does not match exactly one oneOf`;
  return null;
}

test("the JSON Schema accepts every example and refuses what the import refuses", () => {
  const schema = json("references/schema.json") as Schema;
  const defs = schema.$defs as Record<string, Schema>;
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  for (const [name, file] of forms) assert.equal(validate(schema, file, defs), null, name);
  const template = json("assets/mall.json");
  const bad = (change: (file: { forms: { meta: Record<string, unknown>; document: { blocks: { blocks: Record<string, unknown>[] }[] } }[] } & Record<string, unknown>) => void) => { const copy = structuredClone(template); change(copy); return copy; };
  for (const [what, file] of [
    ["an unknown key", bad((file) => { file.forms[0].document.blocks[0].blocks[0].colour = "red"; })],
    ["an unknown block type", bad((file) => { file.forms[0].document.blocks[0].blocks[0].type = "script"; })],
    ["a wrong format", bad((file) => { file.format = "other"; })],
    ["a bad key", bad((file) => { file.forms[0].document.blocks[0].blocks[0].key = "Objekt Namn"; })],
    ["a too long label", bad((file) => { file.forms[0].document.blocks[0].blocks[0].label = "x".repeat(201); })],
    ["a colour that does not exist", bad((file) => { file.forms[0].meta.color = "red"; })],
  ] as const) {
    assert.notEqual(validate(schema, file, defs), null, `the schema refuses ${what}`);
    assert.throws(() => readFormPackage(file), `the import refuses ${what}`);
  }
});

// ---------- the import refuses harmful files with a Swedish message and stores nothing (it throws before the database) ----------
test("the import refuses wrong, unknown, oversized and harmful content with a clear Swedish message", () => {
  const template = () => json("assets/mall.json");
  const firstBlock = (file: ReturnType<typeof template>) => file.forms[0].document.blocks[0].blocks[0];
  const refuses = (file: unknown, message: RegExp) => assert.throws(() => readFormPackage(file), (error: Error) => { assert.match(error.message, message); return true; });
  // The wrong kind of file.
  refuses([1, 2, 3], /inte en formulärfil/);
  refuses("text", /inte en formulärfil/);
  refuses(null, /inte en formulärfil/);
  refuses({ ...template(), format: "something-else" }, /inte en formulärfil/);
  // Unknown fields, anywhere.
  refuses({ ...template(), extra: true }, /fältet ”extra” .*som formatet inte känner till/);
  const unknownBlock = template(); firstBlock(unknownBlock).lable = "Fel"; refuses(unknownBlock, /fältet ”lable” vid formulär 1 › avsnitt 1 › block 1/);
  const unknownMeta = template(); unknownMeta.forms[0].meta.owner = "x"; refuses(unknownMeta, /fältet ”owner” vid formulär 1 › grunduppgifter/);
  const fieldOfOther = template(); firstBlock(fieldOfOther).items = []; refuses(fieldOfOther, /fältet ”items”/);
  // Too many.
  const many = template(); many.forms[0].document.blocks[0].blocks = Array.from({ length: 301 }, (_, index) => ({ id: `f${index}`, type: "field", key: `f${index}`, label: "Fält", input: "text" })); refuses(many, /högst 300/);
  refuses({ ...template(), forms: Array.from({ length: 21 }, () => template().forms[0]) }, /högst 20/);
  const options = template(); Object.assign(firstBlock(options), { input: "choice", options: Array.from({ length: 51 }, (_, index) => `Val ${index}`) }); refuses(options, /högst 50/);
  // Extremely long texts.
  const long = template(); firstBlock(long).label = "x".repeat(201); refuses(long, /högst 200 tecken/);
  const huge = template(); firstBlock(huge).help = "x".repeat(20_000); refuses(huge, /för lång/);
  // Script or HTML in texts.
  for (const text of ["<script>alert(1)</script>", "Klicka <a href=\"x\">här</a>", "<img src=x onerror=alert(1)>", "javascript:alert(1)", "<!-- dold -->", "Text med <b>fet</b> stil", "x\" onmouseover=\"alert(1)"]) {
    const markup = template(); firstBlock(markup).label = text; refuses(markup, /HTML eller skript/);
  }
  const named = template(); named.forms[0].meta.name = "<b>Namn</b>"; refuses(named, /Texten vid formulär 1 › grunduppgifter › name innehåller HTML eller skript/);
  // A formula keeps its comparisons.
  const formula = template();
  formula.forms[0].document.blocks[1].blocks.push({ id: "c1", type: "computed", key: "jamfor", label: "Jämförelse", formula: "OM(OCH(1<2;3>2);\"ja\";\"nej\")" });
  assert.doesNotThrow(() => readFormPackage(formula));
  // Prototype pollution: the keys are refused, and nothing reaches Object.prototype.
  for (const key of ["__proto__", "constructor", "prototype"]) {
    const text = JSON.stringify(template()).replace('"format":', `"${key}":{"polluted":true},"format":`);
    refuses(JSON.parse(text), new RegExp(`otillåtna fältnamnet ”${key}”`));
    const nested = JSON.stringify(template()).replace('"label":"Objekt"', `"label":"Objekt","${key}":{"polluted":true}`);
    refuses(JSON.parse(nested), new RegExp(`otillåtna fältnamnet ”${key}” vid formulär 1 › avsnitt 1 › block 1`));
  }
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  // Too deep.
  let deep: unknown = "x"; for (let index = 0; index < 5000; index++) deep = [deep];
  refuses({ ...template(), forms: deep }, /djupt nästlad/);
  // Duplicate ids, a missing name, values that do not exist.
  const twice = template(); firstBlock(twice).id = "falt-datum"; refuses(twice, /id ”falt-datum” mer än en gång/);
  const nameless = template(); nameless.forms[0].meta.name = ""; refuses(nameless, /saknar namn/);
  const colour = template(); colour.forms[0].meta.color = "red"; refuses(colour, /Färgen ”red” i formulär 1 finns inte/);
  const icon = template(); icon.forms[0].meta.icon = "rocket"; refuses(icon, /Ikonen ”rocket”/);
  const kind = template(); firstBlock(kind).input = "html"; refuses(kind, /kunde inte läsas vid formulär 1 › avsnitt 1 › block 1/);
  const badKey = template(); firstBlock(badKey).key = "1objekt"; refuses(badKey, /Kortnamn får innehålla/);
  // An older category name is still read as its new one.
  const legacy = template(); legacy.forms[0].meta.category = "INSPECTION"; assert.doesNotThrow(() => readFormPackage(legacy));
});

test("the download is a zip with the skill folder and exactly the package's files", async () => {
  const zip = Buffer.from(await formAiSkillZip());
  assert.equal(formAiSkillZipName(), `${FORM_AI_SKILL_NAME}-${FORM_AI_SKILL_VERSION}.zip`);
  const entries = new Map<string, string>();
  let at = 0;
  while (zip.readUInt32LE(at) === 0x04034b50) {
    const method = zip.readUInt16LE(at + 8), size = zip.readUInt32LE(at + 18), nameLength = zip.readUInt16LE(at + 26), extra = zip.readUInt16LE(at + 28);
    const name = zip.subarray(at + 30, at + 30 + nameLength).toString("utf8");
    const data = zip.subarray(at + 30 + nameLength + extra, at + 30 + nameLength + extra + size);
    entries.set(name, (method === 8 ? inflateRawSync(data) : data).toString("utf8"));
    at += 30 + nameLength + extra + size;
  }
  assert.deepEqual([...entries.keys()], FORM_AI_SKILL_FILES.map((file) => `${FORM_AI_SKILL_NAME}/${file}`));
  for (const file of FORM_AI_SKILL_FILES) assert.equal(entries.get(`${FORM_AI_SKILL_NAME}/${file}`)!.replace(/\r\n/g, "\n"), read(file), file);
});
