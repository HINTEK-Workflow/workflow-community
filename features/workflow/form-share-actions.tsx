"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Modal } from "@/features/kfid/ui";
import { api } from "@/features/kfid/api";

type Exportable = { id: string; name: string; status: string; own: boolean; publisher: string };
const MAX_FORMS = 20;
const statusText: Record<string, string> = { DRAFT: "Utkast", PUBLISHED: "Publicerad", UNPUBLISHED: "Avpublicerad" };

/**
 * Export and import of forms next to Anpassa under Ny uppgift (Daniel 2026-09-27), so companies can share forms with
 * each other. Export downloads a signed file; import turns a file into drafts in Skapa formulär, to check and publish.
 */
export function FormShareActions({ onImported }: { onImported?: () => void }) {
  const [exportOpen, setExportOpen] = useState(false);
  const [forms, setForms] = useState<Exportable[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean; imported?: { id: string; name: string }[]; retry?: () => void } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function openExport() {
    setExportOpen(true);
    setSelected(new Set());
    try {
      setForms((await api<{ forms: Exportable[] }>("/api/forms/admin?exportable=1")).forms);
    } catch (issue) { setForms([]); setMessage({ text: (issue as Error).message, error: true }); }
  }
  function download() {
    // A download link lets the browser save the file with the name the server gives it.
    const link = document.createElement("a");
    link.href = `/api/forms/admin?export=${[...selected].map(encodeURIComponent).join(",")}`;
    link.download = "";
    document.body.append(link);
    link.click();
    link.remove();
    setExportOpen(false);
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
    <Button type="button" variant="outline" onClick={() => void openExport()}><Download />Exportera</Button>
    <Button type="button" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}><Upload />{busy ? "Importerar…" : "Importera"}</Button>
    <input ref={fileInput} type="file" accept="application/json,.json" hidden data-testid="form-import-input"
      onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ""; }} />
    {message ? <p role={message.error ? "alert" : "status"} className={`notice w-full ${message.error ? "text-destructive" : ""}`} data-testid="form-share-message">
      {message.text}{" "}
      {message.imported?.length ? <Link className="font-medium text-primary underline underline-offset-4" href={`/?view=forms&form=${encodeURIComponent(message.imported[0].id)}`}>Öppna i Skapa formulär</Link> : null}
      {message.retry ? <Button type="button" size="sm" variant="outline" className="ml-2" disabled={busy} onClick={message.retry} data-testid="form-import-copies">Importera ändå som kopior</Button> : null}
    </p> : null}
    <Modal open={exportOpen} onOpenChange={setExportOpen} title="Exportera formulär">
      <p className="mt-2 text-sm text-muted-foreground">Välj formulär att dela. Filen kan importeras av ett annat företag i HINTEK Workflow och visar er som utgivare. Publicerad version exporteras; ett formulär som aldrig publicerats exporteras som utkast.</p>
      {!forms ? <p role="status" className="mt-4 text-sm text-muted-foreground">Hämtar formulär…</p> : forms.length ? (
        <ul className="mt-4 max-h-80 divide-y overflow-y-auto rounded-lg border" aria-label="Formulär att exportera">
          {forms.map((form) => (
            <li key={form.id}>
              <label className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <Checkbox checked={selected.has(form.id)} disabled={!selected.has(form.id) && selected.size >= MAX_FORMS}
                  onCheckedChange={(value) => setSelected((current) => { const next = new Set(current); if (value === true) next.add(form.id); else next.delete(form.id); return next; })} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">{form.name}</span>
                  <span className="block truncate text-xs font-normal text-muted-foreground">Utgivare: {form.publisher} · {statusText[form.status] ?? form.status}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : <p className="mt-4 text-sm text-muted-foreground">Det finns inga formulär att exportera ännu.</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => setExportOpen(false)}>Avbryt</Button>
        <Button type="button" disabled={!selected.size} onClick={download}><Download />Exportera {selected.size ? `(${selected.size})` : ""}</Button>
      </div>
    </Modal>
  </>;
}
