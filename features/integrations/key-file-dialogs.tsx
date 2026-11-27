"use client";
import { useRef, useState } from "react";
import { Download, FileUp, ShieldAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { saveBlob } from "@/lib/download";
import { plural } from "@/lib/plural";
import { KEY_IMPORT_ACTIONS, type KeyFileExportAnswer, type KeyImportPreview, type KeyImportResult } from "@/lib/secrets/key-import-view";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { DialogPage } from "@/features/kfid/dialog-page";
import { DialogActions, Modal } from "@/features/kfid/ui";
import { KeyField, SecretField } from "@/features/kfid/secret-field";
import { StatusPill } from "./status-pill";

type Notify = (text: string, error?: boolean) => void;

/**
 * Nyckelfilerna (2026-11-26): the shared parts of exporting keys to an encrypted file and reading such a file back –
 * the window that shows the file's passphrase once, and the read-in dialog (choose the file, type the passphrase, see what is
 * in it, choose, read in, and then the advice to change keys that may have leaked). Used by the company's own keys under
 * Kopplingar (CompanyKeyFileActions below) and, with ee/, by Central lagring. Names, states and counts only: no value ever
 * reaches the page, and the passphrase is forgotten when its window closes.
 */
export function PassphraseWindow({ shown, onClose, notify, hint, testId = "key-file-passphrase" }: {
  shown: { name: string; passphrase: string } | null; onClose: () => void; notify: Notify; hint: React.ReactNode; testId?: string;
}) {
  return <Modal open={Boolean(shown)} onOpenChange={(open) => { if (!open) onClose(); }} title="Lösenfrasen till filen" size="compact">
    <KeyField id={testId} label="Lösenfras" className="mt-1" hint={hint}>
      <Input id={testId} readOnly value={shown?.passphrase ?? ""} className="min-w-0 flex-1 basis-56 font-mono text-sm" onFocus={(event) => event.currentTarget.select()} data-testid={testId} autoComplete="off" spellCheck={false} />
      <CopyButton value={shown?.passphrase ?? ""} onCopied={() => notify("Lösenfrasen är kopierad.")} onFailed={() => notify("Markera och kopiera lösenfrasen själv.", true)} />
    </KeyField>
    <Button type="button" className="mt-4 w-full" onClick={onClose} data-testid={`${testId}-done`}>Jag har sparat lösenfrasen</Button>
  </Modal>;
}

const STATE_LABEL = { new: "Ny", changed: "Ändrad", same: "Stämmer redan" } as const;
const STATE_TONE = { new: "success", changed: "warning", same: "neutral" } as const;
const FILE_LIMIT = 512 * 1024;

type Step = { kind: "choose" } | { kind: "preview"; preview: KeyImportPreview; chosen: Set<string>; other: boolean } | { kind: "done"; result: KeyImportResult };

/** Läs in nycklar från en fil: one dialog, three steps. `scope` picks the server's actions (the company's, or the installation's). */
export function KeyFileImportDialog({ open, onOpenChange, scope, notify, intro, onImported, testId = "key-import" }: {
  open: boolean; onOpenChange: (open: boolean) => void; scope: keyof typeof KEY_IMPORT_ACTIONS; notify: Notify; intro: React.ReactNode; onImported?: () => void; testId?: string;
}) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const actions = KEY_IMPORT_ACTIONS[scope];
  const close = () => { setFile(null); setPassphrase(""); setStep({ kind: "choose" }); onOpenChange(false); };
  const pick = async (chosen: File | undefined) => {
    if (!chosen) return;
    if (chosen.size > FILE_LIMIT) { notify("Filen är för stor för att vara en nyckelfil från Workflow.", true); return; }
    setFile({ name: chosen.name, text: await chosen.text() });
    setStep({ kind: "choose" });
  };
  const showContent = async () => {
    if (!file || !passphrase.trim()) return;
    setBusy(true);
    try {
      const preview = await api<KeyImportPreview>("/api/integration-keys", { method: "POST", body: JSON.stringify({ action: actions.preview, file: file.text, passphrase }) }, { change: false });
      setStep({ kind: "preview", preview, chosen: new Set(preview.entries.filter((entry) => entry.state !== "same").map((entry) => entry.id)), other: false });
    } catch (cause) { notify((cause as Error).message, true); } finally { setBusy(false); }
  };
  const run = async () => {
    if (!file || step.kind !== "preview") return;
    setBusy(true);
    try {
      const result = await api<KeyImportResult>("/api/integration-keys", { method: "POST", body: JSON.stringify({ action: actions.run, file: file.text, passphrase, entries: [...step.chosen], ...(step.other ? { confirmOtherCompany: true } : {}) }) });
      // The file and the passphrase are let go as soon as the read-in is done.
      setFile(null); setPassphrase("");
      setStep({ kind: "done", result });
      notify(result.message, !result.ok);
      onImported?.();
    } catch (cause) { notify((cause as Error).message, true); } finally { setBusy(false); }
  };
  const toggle = (id: string, on: boolean) => {
    if (step.kind !== "preview") return;
    const chosen = new Set(step.chosen);
    if (on) chosen.add(id); else chosen.delete(id);
    setStep({ ...step, chosen });
  };
  const groups = step.kind === "preview" ? [...new Set(step.preview.entries.map((entry) => entry.group))] : [];
  const otherCompany = step.kind === "preview" && step.preview.company?.match === "other";
  return <DialogPage open={open} onOpenChange={(next) => { if (!next) close(); }} title="Läs in nycklar från en fil" pageKey="las-in-nycklar" size="form" untracked>
    <div className="grid gap-4" data-testid={testId}>
      {step.kind !== "done" ? <>
        <p className="text-sm text-muted-foreground">{intro}</p>
        <KeyField id={`${testId}-file`} label="Fil" hint={file ? file.name : "Den krypterade filen som Workflow gav när du exporterade."}>
          <input ref={picker} id={`${testId}-file`} type="file" accept=".json,application/json,.txt" className="sr-only" onChange={(event) => { void pick(event.target.files?.[0]); event.target.value = ""; }} data-testid={`${testId}-file`} />
          <Button type="button" variant="outline" onClick={() => picker.current?.click()} disabled={busy}><FileUp />{file ? "Välj en annan fil" : "Välj fil"}</Button>
        </KeyField>
        <SecretField id={`${testId}-passphrase`} label="Lösenfras" value={passphrase} onChange={(value) => { setPassphrase(value); if (step.kind === "preview") setStep({ kind: "choose" }); }} stored={false} noManager mono
          hint="Lösenfrasen som visades när filen exporterades. Stora eller små bokstäver, med eller utan bindestreck." testId={`${testId}-passphrase`} />
      </> : null}
      {step.kind === "preview" ? <div className="grid gap-3" data-testid={`${testId}-preview`}>
        {otherCompany ? <div className="grid gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100" data-testid={`${testId}-other-company`}>
          <p className="flex items-start gap-2"><ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>Filen hör till {step.preview.company?.name || "ett annat företag"}{step.preview.company?.organizationNumber ? ` (${step.preview.company.organizationNumber})` : ""}, inte till det här företaget.</span></p>
          <label className="flex items-center gap-2"><Checkbox checked={step.other} onCheckedChange={(value) => setStep({ ...step, other: value === true })} data-testid={`${testId}-confirm-other`} />
            Ja, läs in nycklarna i det här företaget</label>
        </div> : null}
        {groups.map((group) => <fieldset key={group} className="grid gap-1.5">
          <legend className="field-label mb-1 text-xs font-medium">{group}</legend>
          {step.preview.entries.filter((entry) => entry.group === group).map((entry) => <label key={entry.id} className="flex min-w-0 flex-wrap items-center gap-2 text-sm" data-testid={`${testId}-entry`} data-state={entry.state}>
            <Checkbox checked={step.chosen.has(entry.id)} onCheckedChange={(value) => toggle(entry.id, value === true)} aria-label={entry.label} />
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            <StatusPill tone={STATE_TONE[entry.state]}>{STATE_LABEL[entry.state]}</StatusPill>
          </label>)}
        </fieldset>)}
        {step.preview.skipped.length ? <div className="grid gap-1 text-xs text-muted-foreground" data-testid={`${testId}-skipped`}>
          <p className="font-medium text-foreground">Läses inte in</p>
          {step.preview.skipped.map((item) => <p key={item.id}>{item.label}: {item.reason}</p>)}
        </div> : null}
      </div> : null}
      {step.kind === "done" ? <div className="grid gap-3 text-sm" data-testid={`${testId}-result`}>
        <p>{step.result.message}</p>
        {step.result.imported.length ? <div className="grid gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100" data-testid={`${testId}-advice`}>
          <p className="flex items-start gap-2 font-medium"><ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />Efter ett intrång: byt nycklarna</p>
          <ul className="grid gap-1 pl-6">
            {step.result.imported.map((item) => <li key={item.id} className="list-disc">{item.label}: {step.result.advice}</li>)}
          </ul>
        </div> : null}
        {step.result.skipped.length ? <div className="grid gap-1 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Lästes inte in</p>
          {step.result.skipped.map((item) => <p key={item.id}>{item.label}: {item.reason}</p>)}
        </div> : null}
      </div> : null}
      <DialogActions cancel={step.kind === "done" ? null : { onClick: close }}
        primary={step.kind === "done" ? { label: "Klar", onClick: close, testId: `${testId}-close` }
          : step.kind === "preview" ? { label: `Läs in ${plural(step.chosen.size, "nyckel", "nycklar")}`, onClick: () => void run(), busy, busyLabel: "Läser in…", testId: `${testId}-run`, icon: <Upload />,
            disabled: !step.chosen.size || (otherCompany && !step.other), disabledReason: !step.chosen.size ? "Välj minst en nyckel." : otherCompany && !step.other ? "Bekräfta att filen ska läsas in i det här företaget." : null }
          : { label: "Visa innehållet", onClick: () => void showContent(), busy, busyLabel: "Öppnar…", testId: `${testId}-preview-button`,
            disabled: !file || !passphrase.trim(), disabledReason: !file ? "Välj filen först." : !passphrase.trim() ? "Skriv in lösenfrasen." : null }} />
    </div>
  </DialogPage>;
}

/**
 * Exportera nycklar och Läs in nycklar under Kopplingar (2026-11-26): the company's own keys, for the company's admin. The
 * export asks for the password again on the server, downloads the encrypted file and shows its passphrase once; the read-in is
 * the dialog above. The page's main actions, top right (docs/ui-system.md 2).
 */
export function CompanyKeyFileActions({ notify }: { notify: Notify }) {
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<{ name: string; passphrase: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [confirm, confirmElement] = useConfirm();
  const exportKeys = async () => {
    if (!(await confirm({ title: "Exportera företagets nycklar?", confirmLabel: "Exportera",
      message: "Workflow laddar ner en lösenordsskyddad fil med nycklarna under Kopplingar och visar lösenfrasen en gång. Läs in filen i företagets lösenordshanterare (välj JSON med lösenordsskydd) eller spara den på ett säkert ställe, och spara lösenfrasen för sig. Med filen kan nycklarna läsas in igen här." }))) return;
    setBusy(true);
    try {
      const answer = await api<KeyFileExportAnswer>("/api/integration-keys", { method: "POST", body: JSON.stringify({ action: "export_company_keys" }) }, { change: false });
      saveBlob(new Blob([answer.file.text], { type: "application/json" }), answer.file.name);
      setShown({ name: answer.file.name, passphrase: answer.passphrase });
      if (answer.unreadable) notify(`${plural(answer.unreadable, "nyckel", "nycklar")} gick inte att öppna och kom inte med. Lägg in dem igen.`, true);
    } catch (cause) { notify((cause as Error).message, true); } finally { setBusy(false); }
  };
  const closeShown = () => { setShown(null); notify("Filen är nerladdad. Spara lösenfrasen på ett annat ställe än filen."); };
  return <>
    {confirmElement}
    <PassphraseWindow shown={shown} onClose={closeShown} notify={notify} testId="company-keys-passphrase"
      hint={<>Du behöver den för att öppna ”{shown?.name}”, i lösenordshanteraren eller när nycklarna läses in här igen. Den visas inte igen och sparas inte i Workflow.</>} />
    <KeyFileImportDialog open={importing} onOpenChange={setImporting} scope="company" notify={notify} testId="company-keys-import"
      intro="Nycklarna i filen läggs in i det här företaget och ersätter de som finns. Ingenting sparas förrän du har valt vilka." />
    <Button type="button" variant="outline" onClick={() => setImporting(true)} disabled={busy} data-testid="company-keys-import-open"><Upload />Läs in nycklar</Button>
    <Button type="button" variant="outline" onClick={() => void exportKeys()} busy={busy} busyLabel="Exporterar…" data-testid="company-keys-export"><Download />Exportera nycklar</Button>
  </>;
}
