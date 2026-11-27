# Form file reference – hintek-workflow-forms, formatVersion 1

Package version 1.0.0. The exact, machine-readable rules are in `schema.json` (JSON Schema 2020-12), generated from HINTEK Workflow's own import validation. This page explains every key. Every key except those marked **required** may be left out; the default is then used. No other keys are accepted. Swedish names in parentheses are the words used in Workflow's form builder (Skapa formulär).

## 1. The file

| Key | Type | Meaning |
|---|---|---|
| `format` | `"hintek-workflow-forms"` | **Required.** |
| `formatVersion` | `1` | **Required.** |
| `exportedAt` | text, ISO 8601 UTC, e.g. `2026-01-01T00:00:00.000Z` | **Required.** When the file was made. |
| `exportedBy` | object | **Required.** `name` (1–200 characters): who made the file; `hintek`: always `false`. |
| `forms` | list of 1–20 forms | **Required.** |
| `signature` | – | Never write it. Only Workflow signs its own exports. |

### A form (an item of `forms`)

| Key | Type | Meaning |
|---|---|---|
| `sourceTemplateId` | text, 1–100 | **Required.** A new unique id per form, e.g. `ai-egenkontroll-q4m8t1`. A form with an id imported before is skipped unless the user asks for a copy. |
| `sourceVersion` | `null` or a positive whole number | **Required.** Use `null`. |
| `publisherName` | text, 1–200 | **Required.** The company the form comes from, or `Extern AI`. |
| `meta` | object | **Required.** The basic details (Grunduppgifter), below. |
| `document` | object | **Required.** The form itself, below. |

### `meta` – basic details (Grunduppgifter)

| Key | Type, default | Meaning |
|---|---|---|
| `name` | text ≤ 120 | **Required, not empty.** The form's name (Namn). |
| `displayName` | text ≤ 120, `""` | The name under Ny uppgift if it differs. |
| `description` | text ≤ 500, `""` | Short description under Ny uppgift. |
| `color` | `green` · `blue` · `violet` · `amber` · `rose` · `cyan`, default `green` | The card's colour. |
| `icon` | `file-spreadsheet` · `clipboard-check` · `list-checks` · `gauge` · `zap` · `plug` · `wrench` · `shield-check` · `shield-alert` · `flame` · `thermometer` · `camera` · `building`, default `file-spreadsheet` | The card's icon. |
| `category` | `ELECTRICAL` (Elinstallation) · `POWER` (Elkraft) · `INDUSTRY` (Industri) · `ROUNDS` (Underhåll och driftronder) · `PROPERTY` (Fastigheter) · `SAFETY` (Arbetsmiljö och säkerhet) · `OTHER` (Övrigt), default `OTHER` | Where the form is listed. |
| `allowStandalone` | yes/no, `true` | May be used without a project. |
| `allowInProject` | yes/no, `true` | May be used in a project. At least one of the two must be `true`. |

### `document`

| Key | Type, default | Meaning |
|---|---|---|
| `schema` | `2` | Write `2`. |
| `blocks` | list ≤ 300 | **Required.** Sections (`type: "section"`). Write only sections at the top level. |
| `report` | object | The PDF: `title` (≤ 120, e.g. "Kontrollprotokoll"), `code` (≤ 60, a document code), `taskFacts` (`true`: the task's own facts open the report). |
| `moments` | object | Sections that can be switched on and off (Moment): `label` (≤ 60, default "Moment"), `requireOne` (`true`: at least one must be on), `placement` (`top` or `firstSection`). |
| `task` | object | `layout`: `panel` (Workflow's own panel for project, customer and place) or `inline` (they are fields of the form; then `titleKey` names a text field whose answer becomes the task's title); `requiredMarks` (asterisk at required fields, `true`); `newTitle` (≤ 120, heading of a new protocol, e.g. "Ny kontroll"); `tagline` (≤ 200, the line under it). |
| `limits` | list ≤ 100 of limits | Configurable limits (Gränsvärden), below. |
| `limitObjectKey` | text, `""` | The key of a field that names an object (e.g. a unit) when limits are set per object. Usually empty. |

### A limit (an item of `document.limits`)

A limit names a value the company or technician sets – **without numbers** unless the customer gave them.

| Key | Type, default | Meaning |
|---|---|---|
| `key` | short name | **Required.** Unique among the limits. Referred to as `limitKey`, `limitDefault` and `gräns.<key>`. |
| `label` | text 1–200 | **Required.** What the limit is. |
| `unit` | text ≤ 20, `""` | E.g. `°C`, `MΩ`, `mA`. |
| `low`, `high` | number or `null`, `null` | The alarm range: outside it is a deviation. Leave `null`. |
| `warnLow`, `warnHigh` | number or `null`, `null` | The inner warning range: outside it is a warning only. Leave `null`. |
| `source` | text ≤ 300, `""` | Where the value comes from, e.g. "Anges av teknikern eller i företagets värden". |
| `help` | text ≤ 500, `""` | Guidance. |

## 2. Settings shared by many blocks

| Key | Type, default | Meaning |
|---|---|---|
| `id` | text 1–60 | **Required on every section, block, column and checklist point.** Unique (see SKILL.md). |
| `width` | `quarter` · `third` · `half` · `two_thirds` · `three_quarters` · `full`, default `full` | Width in a 12-column grid. Only short fields (not `textarea`), `computed`, `signature`, `note` and `matrix` can be narrow; others are drawn full width. |
| `visibility` | `{ "task": true, "pdf": true }` | Shown in the task and/or in the PDF. A required block must be shown in the task. |
| `showIf` | `{ "key": "", "op": "eq", "value": "" }` | Conditional display (Villkorad visning): shown only while the field `key` meets the condition. `op`: `eq`, `neq` (equals / not equals `value`), `filled`, `empty`, `gt`, `gte`, `lt`, `lte` (numbers). For a yes/no field compare with `YES`, `NO` or `NA`; for a choice with the option's text. An empty `key` means always shown. A hidden block asks for nothing and is not printed. A section cannot be conditioned on a field inside itself. |

## 3. Section (`type: "section"`, Avsnitt)

| Key | Type, default | Meaning |
|---|---|---|
| `id`, `type` | | **Required.** `type` is `"section"`. |
| `title` | text ≤ 200, `""` | The heading. |
| `description` | text ≤ 1000, `""` | A line under the heading. |
| `blocks` | list ≤ 300 of blocks, `[]` | The blocks of the section, in order. |
| `newPage` | yes/no, `false` | Starts on a new page in the PDF. |
| `optional` | yes/no, `false` | Can be switched on and off in the protocol (a Moment). |
| `defaultOn` | yes/no, `true` | Whether an optional section starts switched on. |
| `pdfStyle` | `standard` · `untitled` · `chapter`, `standard` | With heading, without heading, or as a chapter page. |
| `collapsed` | yes/no, `false` | Folded in the task until opened. |
| `help` | text ≤ 1000, `""` | Explanation behind the section's (i). |
| `taskTitle` | text ≤ 200, `""` | A heading in the task that differs from the PDF's. |
| `showIf` | condition | See 2. |

## 4. Blocks

Every block has `id` and `type`. **Required** keys are marked.

### `heading` (Rubrik)
`text` (**required**, 1–200), `level` (`1`, `2` or `3`; default `2` – use `3` inside a section), `width`, `visibility`, `showIf`.

### `text` (Hjälptext)
`text` (≤ 5000; plain text), `width`, `visibility`, `showIf`.

### `note` (Infokort)
`title` (**required**, 1–200), `text` (≤ 5000), `style` (`folded`: folded until opened; `card`: an open card; `notice`: a notice line; default `folded`), `width`, `visibility`, `showIf`.

### `field` (Fält)

| Key | Type, default | Meaning |
|---|---|---|
| `key` | short name | **Required.** |
| `label` | text 1–200 | **Required.** |
| `input` | `text` (Textfält) · `textarea` (Lång text) · `number` (Tal / Mätvärde) · `date` (Datum) · `datetime` (Datum och tid) · `choice` (Enval / Flerval) · `yesno` (Ja/nej) | **Required.** |
| `required` | yes/no, `false` | Must be filled in before completion. |
| `help` | text ≤ 500 | Guidance under the field. |
| `placeholder` | text ≤ 200 | Grey example text in the empty field. |
| `pdfLabel` | text ≤ 120 | A label of its own in the PDF. |
| `unit` | text ≤ 20 | Number: the unit shown beside the value. |
| `decimals` | 0–6 or `null` | Number: decimals shown. |
| `min`, `max` | number or `null` | Number: the approved interval; outside it is a deviation (marked, never blocking). **Only with values the customer gave.** |
| `allowedMin`, `allowedMax` | number or `null` | Number: hard validation; outside it stops completion. **Only with values the customer gave.** |
| `maxLength` | 1–2000 or `null` | Text: the longest answer. |
| `options` | list of texts (1–120 each, ≤ 50) | Choice: the options. **Required for `choice`.** |
| `multiple` | yes/no, `false` | Choice: several may be chosen (Flerval). |
| `deviationOptions` | list of texts | Choice: options that are deviations; each must be in `options`. |
| `allowNotApplicable` | yes/no, `true` | Yes/no: whether "Ej aktuellt" may be chosen. |
| `deviationOn` | `NONE` · `YES` · `NO`, `NONE` | Yes/no: the answer that is a deviation. |
| `defaultValue` | text, number or `null` | The value a new protocol starts with. Number field: a number; choice: one of `options`; yes/no: `YES`, `NO` or `NA`. |
| `prefill` | `none` · `customer` · `contact` · `email` · `facility` · `project` · `assignee` · `user` · `today` · `inspector` · `instrument` · `instrumentSerial` · `instrumentCalibration`, `none` | Filled in from the task: the customer, contact person, e-mail, facility (place), project, responsible person, the signed-in user, today's date (for a `date` field), the inspector, or the chosen instrument's name, serial number and calibration date. |
| `highlight` | yes/no, `false` | A tinted box in the PDF. |
| `momentSwitch` | yes/no, `false` | Yes/no only: shown among the moments, e.g. "Autobedömning" that switches table conditions on (`mode: "switch"`). |
| `remarks` | yes/no, `false` | A comment and a deviation of one's own on this point. |
| `limitKey` | text, `""` | Number: judged against this limit in `document.limits` (alarm and warning range). |
| `trend` | yes/no, `false` | Number: its history is drawn as a trend. |
| `limitDefault` | text | Number: a limit field – starts with this limit's value (the company's or the facility's). |
| `width`, `visibility`, `showIf` | | See 2. |

### `checklist` (Checklista)

| Key | Type, default | Meaning |
|---|---|---|
| `key`, `label` | | **Required.** |
| `items` | list of `{ "id", "text" }` (text 1–300), 1–200 | **Required.** The points. |
| `mode` | `assessment` · `check`, `assessment` | `assessment`: each point is OK, Ej OK or Ej aktuellt; `check`: tick boxes. Ej OK is a deviation. |
| `required` | yes/no, `true` | Every point must be answered. |
| `photos` | yes/no, `false` | A camera on every point. |
| `deviationTable` | text, `""` | The key of a table where a point that is not OK can be registered as a deficiency (Registrera brist). |
| `help`, `width`, `visibility`, `showIf` | | |

### `table` (Tabell)

| Key | Type, default | Meaning |
|---|---|---|
| `key`, `label` | | **Required.** |
| `columns` | list of 1–40 columns | **Required.** See below. |
| `rowMode` | `free` · `fixed`, `free` | `free`: the user adds rows; `fixed`: rows named by the form. |
| `fixedRows` | list of texts (1–120), ≤ 500 | The row labels when `rowMode` is `fixed` (at least one). |
| `layout` | `grid` · `cards` · `rows`, `grid` | A grid; one card per row (objects with their fields and pictures); or compact measurement rows. |
| `taskLayout` | `same` · `grid` · `cards` · `rows`, `same` | Another layout on screen than in the PDF. |
| `required` | yes/no, `false` | At least one row must be filled in. |
| `itemLabel`, `itemLabelPlural` | text ≤ 60 | The name of one row and of several (e.g. "Risk", "Risker"). |
| `cardTitle` | text ≤ 200 | Heading of each card in the PDF, with column keys in braces: `"{placering} · {typ}"`. Every name in braces must be a column key. |
| `allowExample` | yes/no, `false` | An example row that must be removed before completion. |
| `copyRows` | yes/no, `true` | A Kopiera button on each row. |
| `startEmpty` | yes/no, `false` | A new protocol starts without rows. |
| `emptyTitle` (≤ 200), `emptyAction` (≤ 120), `emptyIcon` (one of the `meta.icon` values, or `""`) | | The empty state's words and icon. |
| `workOrders` | yes/no, `false` | "Skapa arbetsorder" on each row. |
| `help`, `width`, `visibility`, `showIf` | | |

#### A column (an item of `columns`)

| Key | Type, default | Meaning |
|---|---|---|
| `id`, `key`, `label` | | **Required.** Keys unique within the table. |
| `input` | `text` · `textarea` · `number` · `date` · `choice` · `yesno` · `formula` · `images` · `check` (Kryssruta) · `assessment` (Godkänd) · `scale` (Skala) | **Required.** |
| `required` | yes/no, `false` | Must be filled in on every started row. |
| `requiredIf` | text, `""` | Required only while this yes/no field is Ja. |
| `unit`, `decimals`, `min`, `max`, `allowedMin`, `allowedMax` | | As for a field. **No numbers you were not given.** |
| `options` | list of texts | `choice`: the options (required). `scale`: the names of steps 1, 2, 3 … (the value stored is the step number). |
| `deviationOptions` | list of texts | `choice`: options that make the row a deviation. |
| `notFilledOptions` | list of texts | `choice`: options that count as not filled in (e.g. "Ej mätt"). |
| `formula` | text ≤ 1000 | `formula`: the calculation. `assessment`: the condition for approved (true = Godkänd). |
| `passCondition` | yes/no, `false` | `formula`: a false result is a deviation on that row. |
| `mode` | `auto` · `manual` · `switch`, `auto` | `assessment`: decided by the condition, by hand, or by the condition only while the yes/no field `switchKey` is Ja. At most one `assessment` column per table; `auto` and `switch` need a `formula`. |
| `switchKey` | text, `""` | The yes/no field for `mode: "switch"`. |
| `total` | `none` · `sum` · `min` · `max` · `avg`, `none` | A total under the column. |
| `bands` | list ≤ 10 of bands | Levels of a `formula` result (see 5). |
| `defaultValue`, `exampleValue` | text, number, yes/no or `null` | The value of a new row, and of the example row. |
| `suggestions` | list of texts (≤ 100) | Suggestions while typing. |
| `help` (≤ 300), `placeholder` (≤ 200) | | Guidance. |
| `pdf` | `show` · `hide` · `join`, `show` | In the PDF: shown, left out, or joined to the column before (not the first column). |
| `pdfLabel` (≤ 120), `pdfWidth` (positive number or `null`) | | The PDF heading and relative width. |
| `cardLabel` (≤ 120), `cardWidth` (`auto` · `quarter` · `half` · `full`), `group` (≤ 120) | | In cards: an own label, a width, and a named group of fields (e.g. "Före skyddsåtgärd"). |
| `placement` | `body` · `header` · `note` · `hint` · `label`, `body` | Where it is shown on screen: in the card's body, as a badge in its title row, as a note under the row, or – for a `formula` column – beside (`hint`) or instead of (`label`) the label of the column named in `labelFor`. |
| `labelFor` | text | For `hint` and `label`: the key of a `body` column in the same table. |
| `screenWidth` | text ≤ 60, `""` | Measurement rows: a CSS grid track such as `2fr` or `6rem`. Usually empty. |
| `line` | `1` or `2`, `1` | Measurement rows: the line the column sits on. |
| `limitKey`, `trend`, `limitDefault` | | As for a number field. `limitDefault` marks a limit column (e.g. "Gräns") filled from the company's value. |

### `computed` (Formel)
`key`, `label`, `formula` (**required**, 1–1000), `unit`, `passCondition` (a false result is a deviation), `bands`, `limitKey`, `trend`, `help`, `width`, `visibility`, `showIf`.

### `images` (Foto/bilaga)
`key`, `label` (**required**), `accept` (`images` or `files`, default `images`), `minCount` (0–50, default 0: the least number required), `pdfInline` (`true`: printed in the form; `false`: an attachment page each), `help`, `width`, `visibility`, `showIf`.

### `signature` (Signatur)
`key`, `label` (**required**), `required` (default `true`), `role` (`performer` · `reviewer` · `approver` · `other`, default `other`), `statement` (≤ 300, the text beside the tick box), `placeholder` (≤ 120, in the name field), `distinctFrom` (the key of another signature that must be signed by someone else), `help`, `width`, `visibility`, `showIf`. A required signature must be shown in both the task and the PDF.

### `summary` (Sammanfattning)
`label` (default "Sammanfattning / avvikelser"), `help`, `visibility`, `showIf`. Shows approved per moment, deviations with their comment, completeness and attachments. Place it near the end.

### `matrix` (Riskmatris)
`label` (default "Riskmatris 5 × 5"), `size` (2–10, default 5), `xLabel` (default "Sannolikhet"), `yLabel` (default "Konsekvens"), `bands`, `tall` (spans two rows so shorter blocks stack beside it), `width`, `visibility`, `showIf`.

### `pagebreak` (Sidbrytning)
Only `id` and `type`. A new page in the PDF; nothing in the task. Not first, not last and never two in a row.

### `columns` (older layout)
`id`, `type`, `columns` (2–3 lists of blocks). Accepted for older files; the builder turns it into blocks with widths. **Do not write it** – use `width`.

## 5. Bands (levels of a value)
`from` (**required**, number), `label` (≤ 60), `tone` (`neutral` · `success` · `warning` · `danger` · `critical`). A value gets the band with the highest `from` at or below it, e.g. "12 · Hög". Bands are the company's own model (for example of a risk score); if the customer gave none, use clearly named example levels and tell the customer to adjust them.

## 6. Formulas

- A leading `=` is optional. At most 1000 characters and 32 levels of nesting.
- **Names:** a field or computed value by its key (`uppmatt`); a table column as a list of all rows' values (`matning.uppmatt`); inside a table column, a cell of the same row as `[uppmatt]`; a form limit as `gräns.temperatur_max` (empty until the company gives a value; a condition reading it then waits instead of failing).
- **Values:** numbers with `,` or `.` as decimal sign; texts in double quotes `"…"`; `SANT`/`FALSKT` (or `TRUE`/`FALSE`). A yes/no field reads as true (Ja) or false (Nej); a picture column as the number of pictures; a choice as its text.
- **Operators:** `+ - * / ^`, `&` (joins texts), `= <> < > <= >=`. An empty input gives an empty result; division by zero gives an empty result.
- **Functions** (`;` between arguments): `SUMMA`, `MEDEL`, `MIN`, `MAX`, `ANTAL` (count of filled values), `ANTAL.OM(list; value)`, `OM(condition; then; else)`, `OCH`, `ELLER`, `INTE`, `AVRUNDA(value; decimals)`, `ABS`, `SAMMANFOGA(text; …)`, `ÄRTOM(value)`, `EDATUM(date; months)`, `VÄXLA(value; case1; result1; …; otherwise)`. English names work too: `SUM`, `AVERAGE`, `COUNT`, `COUNTIF`, `IF`, `AND`, `OR`, `NOT`, `ROUND`, `CONCAT`, `ISBLANK`, `EDATE`, `SWITCH`.
- No cycles: a formula may not depend on itself through other formulas.
- Conditions (`showIf`) read fields only, never formulas.

Examples: `[sannolikhet] * [konsekvens]`; `MAX(matpunkter.uppmatt)`; `[uppmatt] <= [grans]`; `OM(ÄRTOM([uppmatt]); ""; [uppmatt] - [referens])`; `EDATUM(datum; 12)`.

## 7. What makes a form publishable

Workflow imports a form even when something is left open, but it can be published only when: the name is set; at least one block can be filled in; keys are unique; every choice has options; every reference exists; formulas parse and have no cycles; fixed tables have rows; a table has at most one Godkänd column; required blocks are shown in the task and required signatures in the PDF. A form without a signature gives a warning only.
