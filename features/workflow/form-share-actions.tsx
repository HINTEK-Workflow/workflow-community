"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { FileJson, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExportMenu } from "./export-menu";
import { FormAiSkillDialog } from "./form-ai-skill-dialog";
import { api } from "@/features/kfid/api";

type Exportable = { id: string; name: string; status: string; own: boolean; publisher: string };
type Imported = { id: string; name: string; issues?: number };
export type FormImportMessage = { text: string; error?: boolean; imported?: Imported[]; retry?: () => void };
const MAX_FORMS = 20;
/** The largest form file read in the browser; the server reads at most 2 MB. */
export const FORM_FILE_MAX_BYTES = 1_900_000;
const statusText: Record<string, string> = { DRAFT: "Utkast", PUBLISHED: "Publicerad", UNPUBLISHED: "Avpublicerad" };
const count = (value: number) => (value === 1 ? "1 formulär" : `${value} formulär`);

/**
 * Importing a form file (shared by Ny uppgift and Skapa formulär): the file is read as JSON in the browser and checked
 * on the server, which refuses the wrong kind of file, unknown settings, HTML and anything too large, and stores nothing
 * until the whole file has passed. Forms that already exist are skipped first; the admin can then import them as copies
 * on purpose (F18). `duplicates: "copy"` imports them at once.
 */
export function useFormFileImport({ onImported, duplicates = "skip" }: { onImported?: (imported: Imported[]) => void; duplicates?: "skip" | "copy" } = {}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<FormImportMessage | null>(null);
  async function importParsed(parsed: unknown, mode: "skip" | "copy") {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api<{ imported: Imported[]; skipped: { id: string; name: string }[]; verified: boolean; exportedBy: string; warning?: string }>("/api/forms/admin", { method: "POST", body: JSON.stringify({ action: "import", file: parsed, duplicates: mode }) });
      const issues = result.imported.reduce((sum, item) => sum + (item.issues ?? 0), 0);
      const parts = [
        // A signed file from a newer version: the settings this version does not know were removed (2026-11-24).
        result.warning ?? "",
        result.imported.length ? (result.verified
          ? `${count(result.imported.length)} importerades från ${result.exportedBy} (verifierad utgivare). De är utkast: granska och publicera dem i Skapa formulär.`
          : `${count(result.imported.length)} importerades som utkast. Filen är inte signerad av Workflow, så utgivaren ${result.exportedBy} kunde inte verifieras. Granska formuläret innan du publicerar det.`) : "",
        issues ? `${issues === 1 ? "1 sak" : `${issues} saker`} behöver rättas före publicering.` : "",
        result.skipped.length ? `${count(result.skipped.length)} fanns redan och hoppades över: ${result.skipped.map((item) => item.name).join(", ")}.` : "",
      ].filter(Boolean);
      setMessage({ text: parts.join(" ") || "Filen innehöll inga formulär.", imported: result.imported, retry: result.skipped.length ? () => void importParsed(parsed, "copy") : undefined });
      if (result.imported.length) onImported?.(result.imported);
    } catch (issue) { setMessage({ text: (issue as Error).message, error: true }); } finally { setBusy(false); }
  }
  async function importFile(file: File) {
    try {
      if (!/\.json$/i.test(file.name) && file.type !== "application/json") throw new Error("Välj en formulärfil i formatet JSON (.json).");
      if (file.size > FORM_FILE_MAX_BYTES) throw new Error("Filen är för stor för en formulärfil.");
      let parsed: unknown;
      try { parsed = JSON.parse(await file.text()); } catch { throw new Error("Filen är inte en formulärfil från Workflow."); }
      await importParsed(parsed, duplicates);
    } catch (issue) { setMessage({ text: (issue as Error).message, error: true }); }
  }
  return { busy, message, setMessage, importFile };
}

/**
 * Export and import of forms next to Anpassa under Ny uppgift (2026-09-27), so companies can share forms with each
 * other. Export downloads a signed file; import turns a file into drafts in Skapa formulär, to check and publish.
 * "Skapa formulär med extern AI" (2026-11-24) sits beside Importera: it downloads the skill package, and the file the
 * AI writes comes back through the same import.
 */
export function FormShareActions({ onImported }: { onImported?: () => void }) {
  const [forms, setForms] = useState<Exportable[] | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { busy, message, setMessage, importFile } = useFormFileImport({ onImported: () => onImported?.() });

  async function openExport() {
    setForms(null);
    try {
      setForms((await api<{ forms: Exportable[] }>("/api/forms/admin?exportable=1")).forms);
    } catch (issue) { setForms([]); setMessage({ text: (issue as Error).message, error: true }); }
  }
  function download(selected: string[]) {
    if (selected.length > MAX_FORMS) throw new Error(`Välj högst ${MAX_FORMS} formulär åt gången.`);
    // A download link lets the browser save the file with the name the server gives it.
    const link = document.createElement("a");
    link.href = `/api/forms/admin?export=${selected.map(encodeURIComponent).join(",")}`;
    link.download = "";
    document.body.append(link);
    link.click();
    link.remove();
  }

  return <>
    {/* The shared Exportera window (2026-10-01); every form is picked from the start. */}
    <ExportMenu title="Exportera formulär" description="Filen kan importeras av ett annat företag i Workflow och visar er som utgivare. Finns en publicerad version exporteras den, annars utkastet."
      onOpen={() => void openExport()} choices={forms?.map((form) => ({ id: form.id, title: form.name, detail: `Utgivare: ${form.publisher} · ${statusText[form.status] ?? form.status}` })) ?? null} choicesLabel="Formulär" testId="form-export-menu"
      formats={[{ id: "form-file", label: "Formulärfil", icon: FileJson, primary: true, run: ({ selected }) => download(selected) }]} />
    <Button type="button" variant="outline" onClick={() => fileInput.current?.click()} busy={busy} busyLabel="Importerar…"><Upload />Importera</Button>
    <Button type="button" variant="outline" onClick={() => setAiOpen(true)} data-testid="form-ai-skill-open"><Sparkles />Skapa formulär med extern AI</Button>
    <input ref={fileInput} type="file" accept="application/json,.json" hidden data-testid="form-import-input"
      onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ""; }} />
    <FormAiSkillDialog open={aiOpen} onOpenChange={setAiOpen} busy={busy} onImport={() => { setAiOpen(false); fileInput.current?.click(); }} />
    {message ? <p role={message.error ? "alert" : "status"} className={`notice w-full ${message.error ? "text-destructive" : ""}`} data-testid="form-share-message">
      {message.text}{" "}
      {message.imported?.length ? <Link className="font-medium text-primary underline underline-offset-4" href={`/?view=forms&form=${encodeURIComponent(message.imported[0].id)}`}>Öppna i Skapa formulär</Link> : null}
      {message.retry ? <Button type="button" size="sm" variant="outline" className="ml-2" disabled={busy} onClick={message.retry} data-testid="form-import-copies">Importera ändå som kopior</Button> : null}
    </p> : null}
  </>;
}
