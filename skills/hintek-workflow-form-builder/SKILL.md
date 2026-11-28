---
name: hintek-workflow-form-builder
description: Creates complete, importable HINTEK Workflow form files (JSON, format hintek-workflow-forms) from a customer's description, a PDF, a Word document, an Excel sheet or another form. Use when someone wants a protocol, checklist, inspection, measurement record, risk assessment or any other form for HINTEK Workflow, or asks to convert an existing form into Workflow's import format.
license: Free to use for creating forms for HINTEK Workflow. See README.md.
metadata:
  title: HINTEK Workflow Form Builder
  version: "1.1.0"
  format: hintek-workflow-forms
  format-version: "1"
  languages: "en, sv"
---

# HINTEK Workflow Form Builder

You write a **form file** that the customer imports into HINTEK Workflow (Ny uppgift › Importera, or Skapa formulär › Skapa med AI). The file is plain JSON. Workflow reads it as untrusted data, checks every value and stores the forms as **drafts**, which the customer reviews and publishes in Skapa formulär. Nothing in the file runs as code.

A Swedish version of these instructions is in `references/instruktioner-sv.md`. The two say the same thing.

## Files in this package

| File | What it is | When to read it |
|---|---|---|
| `SKILL.md` | These instructions | Always |
| `references/format-reference.md` | Every block type and every setting, with defaults and rules | Before writing the JSON |
| `references/schema.json` | JSON Schema 2020-12 of the exact import format, generated from Workflow's own validation | To check your output |
| `assets/mall.json` | A minimal, valid template | Start from it |
| `assets/exempel-*.json` | Complete, working examples (inspection, measurement record, risk assessment) | To copy patterns from |

## Steps

1. **Understand the source.** Read the customer's description or document. Find the form's purpose, its parts (sections), every question or measured value, tables, checklists, signatures and what counts as a deviation. If something essential is unclear (for example whether a value is measured or only ticked), ask one short question; otherwise make a reasonable choice and say so afterwards.
2. **Plan the structure.** One section per part of the source. Map each question to a block type with the table under "Choosing blocks". Keep the order of the source.
3. **Write the file.** Start from `assets/mall.json`. Fill in `meta` and `document`. Follow `references/format-reference.md` for every setting you use. Leave out settings you do not need: every setting has a default.
4. **Check the file** with the checklist below. If you can run code, validate it against `references/schema.json` with any JSON Schema 2020-12 validator.
5. **Deliver** one file named after the form, for example `riskbedomning-takarbete.json`, encoded as UTF-8. If you cannot create files, output the complete JSON in a single code block and tell the customer to save it as a `.json` file. Then give a short summary: the sections, anything you assumed, and anything the customer must fill in (such as limits).

## The file

```json
{
  "format": "hintek-workflow-forms",
  "formatVersion": 1,
  "exportedAt": "2026-01-01T00:00:00.000Z",
  "exportedBy": { "name": "Extern AI", "hintek": false },
  "forms": [ { "sourceTemplateId": "ai-…", "sourceVersion": null, "publisherName": "Extern AI", "meta": { … }, "document": { … } } ]
}
```

- `format` and `formatVersion` exactly as above. `exportedAt`: the current time in UTC ISO 8601 with milliseconds and `Z`.
- `exportedBy.name` and `publisherName`: the customer's company name if you know it, otherwise `Extern AI`. `exportedBy.hintek` is always `false`.
- **Never add `signature`.** Only Workflow signs files; a file from you is marked as not verified, which is correct.
- `sourceTemplateId`: `ai-` + a short slug of the name + `-` + six random letters or digits, for example `ai-riskbedomning-takarbete-p3k8m2`. A new form gets a new id. Workflow uses it to recognise a file that was imported before.
- `sourceVersion`: `null`.
- Up to 20 forms per file; normally one.
- `meta.name` is required (max 120 characters). `color`, `icon` and `category` must be one of the listed values in the reference.
- `document.schema` is `2`. `document.blocks` holds **sections only**; every other block goes inside a section's `blocks`.

## Rules that the import enforces

- **No unknown keys.** Use only the keys in the reference, spelled exactly. A misspelt or invented key makes the whole file fail.
- **Plain text only.** No HTML, no Markdown, no tags such as `<b>`, no `javascript:`, no angle brackets around words. Line breaks in long texts are fine.
- **Ids** (`id`): 1–60 characters, unique within the form for sections and blocks, unique within a table for its columns and within a checklist for its points. Use readable ids such as `avsnitt-matning`, `falt-datum`, `kol-uppmatt`.
- **Short names** (`key`): lower case `a–z`, `å`, `ä`, `ö`, digits and `_`, starting with a letter, at most 40 characters, for example `uppmatt_varde`. Unique among the form's blocks; a table's column keys are unique within the table. Formulas, conditions and limits refer to these keys.
- **Lengths**: labels at most 200 characters, help texts 500, text blocks and info cards 5 000, options 120 each and 50 per list, checklist points 300 each and 200 per list, 40 columns per table, 500 fixed rows, 300 blocks per form.
- References must exist: a condition's `key` is a field (`type: "field"`) in the form; `limitKey` and `limitDefault` name a limit in `document.limits`; `deviationTable` names a table; `switchKey` and `requiredIf` name a yes/no field; `distinctFrom` names another signature; `labelFor` names a column in the same table.

## Copyright and limit values – follow strictly

- **Do not copy protected text word for word** from the customer's material (standards, manuals, handbooks, other publishers' forms or tables). Write the questions in your own short words. Referring to a standard by its designation, for example "according to SS-EN 61439", is allowed.
- **Never invent limit values.** Do not write numbers for limits, approved intervals or allowed ranges (`low`, `high`, `warnLow`, `warnHigh`, `min`, `max`, `allowedMin`, `allowedMax`) unless the customer has given you that exact value for their own form. Instead create a limit in `document.limits` with the numbers set to `null` and a `source` such as "Anges av teknikern eller i företagets värden". The technician or the company's limit profile gives the values in Workflow.
- No organisation or manufacturer names in form names, labels or examples, unless the customer explicitly asks for their own company name.
- Do not include pictures, logos or attachments; the file holds text and settings only.

## Language

Write every text the user sees (names, labels, help texts, options, points) in the language of the customer's material; if none is given, in **Swedish**. Keep labels short and concrete, use sentence case, and put guidance in `help` rather than in the label.

## Choosing blocks

| In the source | Block |
|---|---|
| A heading inside a part | `heading` (level 3) |
| An instruction or explanation | `text`, or `note` (Infokort) for longer guidance |
| A short answer, name, place | `field` with `input: "text"` |
| A longer answer, remarks | `field` with `input: "textarea"` |
| A number or measured value | `field` with `input: "number"` and `unit`; a limit through `limitKey` if it is judged |
| A date / date and time | `field` with `input: "date"` / `"datetime"` |
| Yes / No | `field` with `input: "yesno"`; `deviationOn` when one answer is a deviation |
| One or several options | `field` with `input: "choice"`, `options`, `multiple` |
| A list of points judged OK / Not OK / N/A | `checklist` with `mode: "assessment"` |
| A list of tick boxes | `checklist` with `mode: "check"` |
| A grid with rows, or repeated objects | `table` (`layout`: `grid`, `cards` or `rows`; `rowMode`: `fixed` or `free`) |
| A calculated value | `computed` with a `formula` |
| Photos or files | `images` |
| Signature lines | `signature` (one per signer; `role`) |
| A summary of deviations | `summary`, near the end |
| A risk matrix | `matrix` |
| A new PDF page | `pagebreak` between blocks, or `newPage` on a section |

Use `width` (`quarter`, `third`, `half`, `two_thirds`, `three_quarters`, `full`) to put short fields side by side like a paper protocol. Only short fields, computed values, signatures, info cards and matrices can be narrow; everything else is full width.

## Formulas in brief

Excel-like, Swedish function names, `;` between arguments, decimal comma or point. Refer to a field by its key (`uppmatt`), to a whole table column as a list (`matning.uppmatt`), to a cell in the same table row as `[uppmatt]`, and to a form limit as `gräns.<key>`. Functions: `SUMMA`, `MEDEL`, `MIN`, `MAX`, `ANTAL`, `ANTAL.OM`, `OM`, `OCH`, `ELLER`, `INTE`, `AVRUNDA`, `ABS`, `SAMMANFOGA`, `ÄRTOM`, `EDATUM`, `VÄXLA` (English names such as `SUM`, `IF`, `AND` also work). Operators: `+ - * / ^ &` and `= <> < > <= >=`. A yes/no field reads as true/false. Details in the reference.

A row's **Godkänd** (approved) column is `input: "assessment"` with a condition such as `[uppmatt] <= [grans]`, where `grans` is a number column marked with `limitDefault` so the company's value fills it in. Never write the limit's number into the formula.

## Checklist before you deliver

- [ ] Valid JSON (double quotes, no comments, no trailing commas), `format`, `formatVersion: 1`, no `signature`.
- [ ] `meta.name` set; `color`, `icon`, `category` from the allowed lists.
- [ ] `document.schema: 2`; top level contains sections only.
- [ ] Every id unique; every key valid and unique; every reference points at something that exists.
- [ ] Choice fields and choice columns have `options`; `deviationOptions` and `defaultValue` are among them.
- [ ] Fixed tables have `fixedRows`; every table has at least one column; at most one `assessment` column per table.
- [ ] Every formula refers only to existing keys; `[cell]` only inside table columns.
- [ ] No limit numbers you were not given; limits use `null` and a `source`.
- [ ] No HTML, no copied protected text, no organisation or manufacturer names.
- [ ] At least one field to fill in, and a signature if the form is to be signed.

## After import

Workflow imports the file as a draft and says how many things, if any, must be fixed before publishing. The customer opens it in Skapa formulär, checks it in Förhandsgranska, and publishes. If the import refuses the file, the message says where; correct exactly that place and deliver the file again.
