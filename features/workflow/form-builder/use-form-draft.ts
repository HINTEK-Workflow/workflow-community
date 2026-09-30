"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { FormDocument, FormIssue } from "@/lib/workflow/form-document";
import { createHistory, emptyEditorDocument, normalizeFormDocument, recordHistory, redoHistory, undoHistory, type EditorDocument, type EditorHistory } from "@/lib/workflow/form-editor";
import type { ConfirmOptions } from "@/features/kfid/confirm";
import { emptyFormMeta, formMetaSchema, type FormMeta } from "@/lib/workflow/form-publish";

export type Snapshot = { meta: FormMeta; document: EditorDocument };
export type TemplateDetail = {
  id: string; status: "DRAFT" | "PUBLISHED" | "UNPUBLISHED"; publishedVersion: number | null; draftRevision: number; hasDraftChanges: boolean; updatedAt: string;
  meta: FormMeta; draft: unknown;
  /** Who publishes the form ("HINTEK" or the company), as the protocol's header shows it. */
  publisher?: string;
  versions: { version: number; name: string; createdAt: string; protocols: number }[];
  events: { id: string; action: string; summary: string; actorName: string; createdAt: string }[];
  latest: { version: number; meta: FormMeta; document: FormDocument } | null;
  /** A company's version of a HINTEK original: which one, from which version, and whether HINTEK has published a newer. */
  base?: { id: string; name: string; version: number | null; latest: number | null; updated: boolean } | null;
};
/** A HINTEK original opened by a company admin; the first change becomes the company's own version (Daniel 2026-09-27). */
export type OriginalBase = { id: string; name: string; version: number };
export type SaveStatus = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: string } | { kind: "error"; message: string } | { kind: "conflict" };

export class HttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Like the shared `api`, but keeps the HTTP status so a conflict (409) can be told apart from other errors. */
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError((data as { error?: string }).error || "Åtgärden misslyckades.", response.status);
  return data as T;
}

// The local recovery copy (decision 3): one per device, written on every change and removed once the server has it.
// Forms hold no customer data. Storage may be missing (private windows), so every access is guarded.
const RECOVERY_KEY = "hintek-form-editor-recovery-v1";
type Recovery = { templateId: string | null; draftRevision: number; snapshot: Snapshot; at: string; base?: OriginalBase | null };
function readRecovery(): Recovery | null {
  try {
    const raw = window.localStorage.getItem(RECOVERY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Recovery;
    return { ...parsed, snapshot: { meta: formMetaSchema.parse(parsed.snapshot.meta), document: normalizeFormDocument(parsed.snapshot.document) } };
  } catch { return null; }
}
function writeRecovery(recovery: Recovery) { try { window.localStorage.setItem(RECOVERY_KEY, JSON.stringify(recovery)); } catch { /* storage unavailable */ } }
function clearRecovery() { try { window.localStorage.removeItem(RECOVERY_KEY); } catch { /* storage unavailable */ } }

const emptySnapshot = (): Snapshot => ({ meta: emptyFormMeta(), document: emptyEditorDocument() });
const AUTOSAVE_MS = 5000;

/**
 * The form being edited: opening (URL form → local recovery copy → ongoing draft → new local draft), undo and redo,
 * saving by hand, autosaving drafts that already exist on the server, and conflicts with another tab. Nothing is
 * written to the server just because the page opened (Daniel 2026-09-26).
 */
export function useFormDraft({ confirm }: { confirm: (options: ConfirmOptions) => Promise<boolean> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [history, setHistory] = useState<EditorHistory<Snapshot>>(() => createHistory(emptySnapshot()));
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [revision, setRevisionState] = useState(0);
  // The revision is also kept in a ref, so a publish right after a save sends the revision that save produced.
  const revisionRef = useRef(0);
  const setRevision = useCallback((value: number) => { revisionRef.current = value; setRevisionState(value); }, []);
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(emptySnapshot()));
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const [loading, setLoading] = useState(true);
  const [recoveredAt, setRecoveredAt] = useState<string | null>(null);
  // A recovery copy made on an older draft than the server's (2026-09-29): never laid over the newer draft by itself.
  const [staleRecovery, setStaleRecovery] = useState<Recovery | null>(null);
  const [error, setError] = useState("");
  const [base, setBase] = useState<OriginalBase | null>(null);
  const snapshot = history.present;
  const snapshotJson = useMemo(() => JSON.stringify(snapshot), [snapshot]);
  const dirty = snapshotJson !== savedJson;

  // Refs so timers, unload and unmount always see the latest values.
  const latest = useRef({ snapshot, templateId, revision, dirty, status, base });
  useEffect(() => { latest.current = { snapshot, templateId, revision, dirty, status, base }; });
  const saving = useRef(false);

  const setUrl = useCallback((id: string | null, original = false) => {
    router.replace(id ? `/?view=forms&${original ? "original" : "form"}=${encodeURIComponent(id)}` : "/?view=forms", { scroll: false });
  }, [router]);

  const reset = useCallback((next: Snapshot, saved: Snapshot) => {
    setHistory(createHistory(next));
    setSavedJson(JSON.stringify(saved));
    setStatus({ kind: "idle" });
    setError("");
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const result = await request<{ template: TemplateDetail }>(`/api/forms/admin?id=${encodeURIComponent(id)}`);
    setDetail(result.template);
    return result.template;
  }, []);

  /**
   * Opens a saved form. A recovered copy is laid over it only when it was made on the draft the server has now: a copy
   * made on an older revision (a release or another tab has changed the draft since) would silently undo those changes
   * when autosaved, so it is kept aside and offered instead. Returns whether the copy was laid over the draft.
   */
  const open = useCallback(async (id: string, recovered?: Snapshot, recoveredRevision?: number) => {
    setLoading(true);
    try {
      const template = await loadDetail(id);
      const stored: Snapshot = { meta: template.meta, document: normalizeFormDocument(template.draft) };
      const current = Boolean(recovered) && (recoveredRevision === undefined || recoveredRevision === template.draftRevision);
      setTemplateId(template.id);
      setBase(null);
      setRevision(template.draftRevision);
      reset(current ? recovered! : stored, stored);
      setRecoveredAt(null);
      setUrl(template.id);
      return current;
    } catch (issue) {
      setError((issue as Error).message);
      return false;
    } finally { setLoading(false); }
  }, [loadDetail, reset, setUrl, setRevision]);

  /**
   * A HINTEK original, opened by a company admin: shown as it is published, nothing saved. The first change is saved as
   * the company's own version; if the company already has one, that is opened instead.
   */
  const openOriginal = useCallback(async (id: string, recovered?: Snapshot) => {
    setLoading(true);
    try {
      const { original } = await request<{ original: { id: string; version: number; meta: FormMeta; document: FormDocument; copyId: string | null } }>(`/api/forms/admin?original=${encodeURIComponent(id)}`);
      if (original.copyId) { setLoading(false); return open(original.copyId); }
      const stored: Snapshot = { meta: formMetaSchema.parse(original.meta), document: normalizeFormDocument(original.document) };
      setTemplateId(null);
      setRevision(0);
      setDetail(null);
      setBase({ id: original.id, name: original.meta.name, version: original.version });
      reset(recovered ?? stored, stored);
      setRecoveredAt(null);
      setUrl(original.id, true);
    } catch (issue) {
      setError((issue as Error).message);
    } finally { setLoading(false); }
  }, [open, reset, setUrl, setRevision]);

  const startNew = useCallback((recovered?: Snapshot) => {
    const empty = emptySnapshot();
    setBase(null);
    setTemplateId(null);
    setRevision(0);
    setDetail(null);
    reset(recovered ?? empty, empty);
    setRecoveredAt(null);
    setUrl(null);
    setLoading(false);
  }, [reset, setUrl, setRevision]);

  // Opening the editor.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const requested = searchParams.get("form");
    const original = searchParams.get("original");
    const recovery = readRecovery();
    void (async () => {
      if (original && recovery?.base?.id !== original) return openOriginal(original);
      if (requested && recovery?.templateId !== requested) return open(requested);
      if (recovery) {
        if (recovery.templateId) {
          if (!(await open(recovery.templateId, recovery.snapshot, recovery.draftRevision))) { setStaleRecovery(recovery); return; }
        } else if (recovery.base) await openOriginal(recovery.base.id, recovery.snapshot);
        else startNew(recovery.snapshot);
        setRecoveredAt(recovery.at);
        return;
      }
      // "Skapa formulär" on the Ny uppgiftstyp card starts a new form; unsaved work above is still restored first.
      if (searchParams.get("new")) return startNew();
      try {
        const resume = await request<{ id: string | null }>("/api/forms/admin?resume=1");
        if (resume.id) return open(resume.id);
      } catch (issue) { setError((issue as Error).message); }
      startNew();
    })();
  }, [open, openOriginal, startNew, searchParams]);

  // ---------- changes, undo and redo ----------
  const change = useCallback((update: (current: Snapshot) => Snapshot, group: string | null = null) => {
    setHistory((current) => recordHistory(current, update(current.present), group));
  }, []);
  const changeDocument = useCallback((update: (document: EditorDocument) => EditorDocument, group: string | null = null) => {
    change((current) => ({ ...current, document: update(current.document) }), group);
  }, [change]);
  const changeMeta = useCallback((patch: Partial<FormMeta>, group: string | null = null) => {
    change((current) => ({ ...current, meta: { ...current.meta, ...patch } }), group);
  }, [change]);
  const undo = useCallback(() => setHistory(undoHistory), []);
  const redo = useCallback(() => setHistory(redoHistory), []);

  // ---------- saving ----------
  const save = useCallback(async ({ autosave = false }: { autosave?: boolean } = {}): Promise<boolean> => {
    const current = latest.current;
    if (saving.current || current.status.kind === "conflict") return false;
    // A new form is saved by hand; an opened HINTEK original becomes the company's version at the first change.
    if (!current.templateId && autosave && !current.base) return false;
    if (!current.snapshot.meta.name.trim()) {
      if (!autosave) setStatus({ kind: "error", message: "Ange formulärets namn under Grunduppgifter innan du sparar." });
      return false;
    }
    saving.current = true;
    setStatus({ kind: "saving" });
    const sent = current.snapshot;
    try {
      if (!current.templateId) {
        const created = await request<{ id: string; draftRevision: number; updatedAt: string }>("/api/forms/admin", { method: "POST", body: JSON.stringify({ action: "create", ...sent.meta, document: sent.document, ...(current.base ? { baseTemplateId: current.base.id } : {}) }) });
        setTemplateId(created.id);
        setBase(null);
        setRevision(created.draftRevision);
        setSavedJson(JSON.stringify(sent));
        setStatus({ kind: "saved", at: created.updatedAt });
        setUrl(created.id);
        clearRecovery();
        await loadDetail(created.id);
        return true;
      }
      const result = await request<{ draftRevision: number; updatedAt: string }>("/api/forms/admin", {
        method: "POST", body: JSON.stringify({ action: "save", id: current.templateId, draftRevision: revisionRef.current, ...sent.meta, document: sent.document, autosave }),
      });
      setRevision(result.draftRevision);
      setSavedJson(JSON.stringify(sent));
      setStatus({ kind: "saved", at: result.updatedAt });
      clearRecovery();
      if (autosave) setDetail((value) => value ? { ...value, hasDraftChanges: true, draftRevision: result.draftRevision } : value);
      else await loadDetail(current.templateId);
      return true;
    } catch (issue) {
      if (issue instanceof HttpError && issue.status === 409) setStatus({ kind: "conflict" });
      else setStatus({ kind: "error", message: (issue as Error).message });
      return false;
    } finally { saving.current = false; }
  }, [loadDetail, setUrl, setRevision]);

  // Autosave (decision 3): only drafts that already exist on the server, 5 s after the latest change, never publishing.
  useEffect(() => {
    if ((!templateId && !base) || !dirty || status.kind === "conflict" || status.kind === "saving") return;
    const timer = window.setTimeout(() => void save({ autosave: true }), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [templateId, base, dirty, snapshotJson, status.kind, save]);

  // The local recovery copy, half a second after the latest change.
  useEffect(() => {
    if (loading || !dirty) return;
    const timer = window.setTimeout(() => writeRecovery({ templateId, draftRevision: revision, snapshot, at: new Date().toISOString(), base }), 500);
    return () => window.clearTimeout(timer);
  }, [loading, dirty, snapshot, templateId, revision, base]);

  // Leaving: save when the tab is hidden and once more when the editor closes. No native "leave page?" box (Daniel
  // 2026-09-26: never the browser's own dialogs); a new, unsaved form survives as the local recovery copy instead.
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === "hidden" && latest.current.dirty && latest.current.templateId) void save({ autosave: true }); };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      const current = latest.current;
      if (current.dirty && current.templateId && current.status.kind !== "conflict")
        void fetch("/api/forms/admin", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", id: current.templateId, draftRevision: revisionRef.current, ...current.snapshot.meta, document: current.snapshot.document, autosave: true }) })
          .then((response) => { if (response.ok) clearRecovery(); }).catch(() => undefined);
    };
  }, [save]);

  /** The kept-aside copy: laid over the draft on request (one undo takes it back), or thrown away. */
  const applyStaleRecovery = useCallback(() => {
    if (!staleRecovery) return;
    change(() => staleRecovery.snapshot);
    setRecoveredAt(staleRecovery.at);
    setStaleRecovery(null);
  }, [change, staleRecovery]);
  const discardStaleRecovery = useCallback(() => { clearRecovery(); setStaleRecovery(null); }, []);

  const discardRecovery = useCallback(async () => {
    clearRecovery();
    setRecoveredAt(null);
    if (templateId) await open(templateId);
    else startNew();
  }, [open, startNew, templateId]);

  /** Leaves the current form; unsaved work on a server draft is saved first, a local draft is confirmed. */
  const leave = useCallback(async () => {
    const current = latest.current;
    if (!current.dirty) return true;
    if (current.templateId && current.status.kind !== "conflict") return save({ autosave: true });
    if (!(await confirm({ title: "Lämna formuläret?", message: "Formuläret är inte sparat än. Om du lämnar det försvinner ändringarna.", confirmLabel: "Lämna utan att spara", cancelLabel: "Stanna kvar", tone: "danger" }))) return false;
    clearRecovery();
    return true;
  }, [confirm, save]);

  const saveAsCopy = useCallback(async () => {
    const current = latest.current.snapshot;
    try {
      const created = await request<{ id: string }>("/api/forms/admin", { method: "POST", body: JSON.stringify({ action: "create", ...current.meta, name: `${current.meta.name || "Formulär"} (kopia)`.slice(0, 120), document: current.document }) });
      clearRecovery();
      await open(created.id);
    } catch (issue) { setStatus({ kind: "error", message: (issue as Error).message }); }
  }, [open]);

  /** Runs a command on the saved form and reads it again (publish, unpublish, restore …). */
  const command = useCallback(async (input: Record<string, unknown>) => {
    const id = latest.current.templateId;
    if (!id) return null;
    const result = await request<Record<string, unknown>>("/api/forms/admin", { method: "POST", body: JSON.stringify({ ...input, id }) });
    if (input.action === "delete") { clearRecovery(); startNew(); return result; }
    await open(id);
    return result;
  }, [open, startNew]);

  /**
   * "Återställ till originalet" (Daniel 2026-09-27): removes the company's version, so the company uses HINTEK's
   * original again, and opens the original. Protocols made from the company's version keep their own copy.
   */
  const resetToOriginal = useCallback(async () => {
    const id = latest.current.templateId;
    const original = detail?.base?.id;
    if (!id || !original) return;
    await request("/api/forms/admin", { method: "POST", body: JSON.stringify({ action: "reset_to_original", id }) });
    clearRecovery();
    await openOriginal(original);
  }, [detail?.base?.id, openOriginal]);

  const issuesFor = useCallback((issues: FormIssue[], blockId: string) => issues.filter((issue) => issue.blockId === blockId), []);

  return {
    snapshot, templateId, revision, detail, dirty, status, loading, error, recoveredAt, staleRecoveryAt: staleRecovery?.at ?? null, applyStaleRecovery, discardStaleRecovery, canUndo: history.past.length > 0, canRedo: history.future.length > 0,
    base, openOriginal, resetToOriginal,
    currentRevision: () => revisionRef.current, open, startNew, change, changeDocument, changeMeta, undo, redo, save, saveAsCopy, discardRecovery, leave, command, issuesFor, setError,
  };
}
export type FormDraft = ReturnType<typeof useFormDraft>;
