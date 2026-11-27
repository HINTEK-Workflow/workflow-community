# HINTEK Workflow Form Builder

Version 1.0.0 · writes form files in the format `hintek-workflow-forms`, formatVersion 1. Svenska: se `LASMIG.md`.

This package lets an external AI system – ChatGPT, Claude, Gemini, Copilot or any other – create a complete form that can be imported straight into HINTEK Workflow.

## How to use it

1. **Download** the package in Workflow: Skapa formulär › Skapa med AI, or Ny uppgift › Skapa formulär med extern AI.
2. **Give the files to your AI** together with your description or your document (PDF, Word, Excel or another form). For example: "Create a HINTEK Workflow form following the instructions in this package, based on this protocol."
3. **Import the result.** Save the AI's answer as a `.json` file and choose Importera in the same window in Workflow. The form becomes a draft that you review in Skapa formulär and then publish.

## Different AI systems

- **Agent Skills** (Claude and other systems that read `SKILL.md` skills): upload the zip as a skill, or attach the folder.
- **ChatGPT:** attach the zip or the files `SKILL.md`, `references/format-reference.md`, `references/schema.json` and an example from `assets/`. In a custom GPT or project, add them as knowledge.
- **Gemini, Copilot and others:** attach or paste `SKILL.md`, `references/format-reference.md` and `assets/mall.json`; add `references/schema.json` if the service accepts it.

## Structure

The package follows the open Agent Skills layout (a folder named like the skill with `SKILL.md` and YAML front matter, `references/` and `assets/`), so systems that support skills load it as one, while every file is also plain Markdown or JSON that any chat can read. The schema is standard JSON Schema 2020-12, generated from Workflow's own import validation, so any validator can check a file before it is imported.

| File | Contents |
|---|---|
| `SKILL.md` | The instructions for the AI (English) |
| `references/instruktioner-sv.md` | The same instructions in Swedish |
| `references/format-reference.md` | Every block type and setting |
| `references/schema.json` | The import format as JSON Schema 2020-12 |
| `assets/mall.json` | A minimal template |
| `assets/exempel-*.json` | Complete examples: an inspection, a measurement record and a risk assessment |

## Good to know

- The package holds no keys, passwords or company data, and it sends nothing by itself. You choose which AI you give it to and what you share.
- The AI must not invent limit values or copy protected text from standards or manuals word for word. Limits are set by the technician or the company's values in Workflow.
- Workflow checks the file on import: an error says where it is, and nothing is stored until the whole file has passed.
- The package version follows the form file format. Download it again after Workflow has been updated.

License: free to use for creating forms for HINTEK Workflow.
