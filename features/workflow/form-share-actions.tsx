"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { FileJson, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExportMenu } from "./export-menu";
import { api } from "@/features/kfid/api";

type Exportable = { id: string; name: string; status: string; own: boolean; publisher: string };
const MAX_FORMS = 20;
const statusText: Record<string, string> = { DRAFT: "Utkast", PUBLISHED: "Publicerad", UNPUBLISHED: "Avpublicerad" };

/**
 * Export and import of forms next to Anpassa under Ny uppgift (2026-09-27), so companies can share forms with
 * each other. Export downloads a signed file; import turns a file into drafts in Skapa formulär, to check and publish.
 */
export function FormShareActions({ onImported }: { onImported?: () => void }) {
  const [forms, setForms] = useState<Exportable[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean; imported?: { id: string; name: string }[]; retry?: () => void } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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
  async function importFile(file: File) {
    try {
      if (file.size > 1_900_000) throw new Error("Filen är för stor för en formulärfil.");
      let parsed: unknown;
      try { parsed = JSON.parse(await file.text()); } catch { throw new Error("Filen är inte en formulärfil från HINTEK Workflow."); }
      await importParsed(parsed, "skip");
    } catch (issue) { setMessage({ text: (issue as Error).message, error: true }); }
  }
  // Forms that already exist are skipped first; the admin can then import them as copies on purpose (F18).
  async function importParsed(parsed: unknown, duplicates: "skip" | "copy") {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api<{ imported: { id: string; name: string }[]; skipped: { id: string; name: string }[]; verified: boolean; exportedBy: string }>("/api/forms/admin", { method: "POST", body: JSON.stringify({ action: "import", file: parsed, duplicates }) });
      const count = (value: number) => (value === 1 ? "1 formulär" : `${value} formulär`);
      const parts = [
        result.imported.length ? `${count(result.imported.length)} importerades från ${result.exportedBy}${result.verified ? " (verifierad utgivare)" : " – utgivaren kunde inte verifieras"}. De är utkast: granska och publicera dem i Skapa formulär.` : "",
        result.skipped.length ? `${count(result.skipped.length)} fanns redan och hoppades över: ${result.skipped.map((item) => item.name).join(", ")}.` : "",
      ].filter(Boolean);
      setMessage({ text: parts.join(" ") || "Filen innehöll inga formulär.", imported: result.imported, retry: result.skipped.length ? () => void importParsed(parsed, "copy") : undefined });
      if (result.imported.length) onImported?.();
    } catch (issue) { setMessage({ text: (issue as Error).message, error: true }); } finally { setBusy(false); }
  }

  return <>
    {/* The shared Exportera window (2026-10-01); every form is picked from the start. */}
    <ExportMenu title="Exportera formulär" description="Filen kan importeras av ett annat företag i HINTEK Workflow och visar er som utgivare. Publicerad version exporteras; ett formulär som aldrig publicerats exporteras som utkast."
      onOpen={() => void openExport()} choices={forms?.map((form) => ({ id: form.id, title: form.name, detail: `Utgivare: ${form.publisher} · ${statusText[form.status] ?? form.status}` })) ?? null} choicesLabel="Formulär" testId="form-export-menu"
      formats={[{ id: "form-file", label: "Formulärfil", icon: FileJson, primary: true, run: ({ selected }) => download(selected) }]} />
    <Button type="button" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}><Upload />{busy ? "Importerar…" : "Importera"}</Button>
    <input ref={fileInput} type="file" accept="application/json,.json" hidden data-testid="form-import-input"
      onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ""; }} />
    {message ? <p role={message.error ? "alert" : "status"} className={`notice w-full ${message.error ? "text-destructive" : ""}`} data-testid="form-share-message">
      {message.text}{" "}
      {message.imported?.length ? <Link className="font-medium text-primary underline underline-offset-4" href={`/?view=forms&form=${encodeURIComponent(message.imported[0].id)}`}>Öppna i Skapa formulär</Link> : null}
      {message.retry ? <Button type="button" size="sm" variant="outline" className="ml-2" disabled={busy} onClick={message.retry} data-testid="form-import-copies">Importera ändå som kopior</Button> : null}
    </p> : null}
  </>;
}
