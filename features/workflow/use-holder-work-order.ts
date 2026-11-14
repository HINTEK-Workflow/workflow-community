"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/features/kfid/api";
import { announce } from "@/lib/workflow/toast";
import { createSerialRunner, saveOnNewest } from "@/lib/workflow/holder-save";
import type { WorkflowTaskRecord } from "./workflow-task-editor";

/**
 * Arbetsordern som hållare (2026-10-30): a task page shows and edits its work order's Grunduppgifter and
 * Riskbedömning – the same data as on the work order's own page. This hook reads that work order and saves the person's
 * changes to it, a moment after they stop typing (or when they leave the panel). Only the fields the person changed here are
 * sent on top of the newest saved order, so a colleague's Utfört arbete on the work order is never overwritten; a save that
 * met a newer version reads the order again and puts the same changes on it once more. The server checks the person's right
 * to edit work orders, the levels and the rules as for any save of the order (Origin, session, company).
 */
type Member = { id: string; name: string; canRead?: boolean };
type Pending = Partial<Pick<WorkflowTaskRecord, "title" | "description" | "customerId" | "facilityId" | "assignedToUserId" | "assignedToName" | "plannedStartDate" | "dueDate">> & { data?: (data: WorkflowTaskRecord["data"]) => WorkflowTaskRecord["data"] };
export type HolderLocal = { tasks: WorkflowTaskRecord[]; members?: Member[]; save: (task: WorkflowTaskRecord) => Promise<{ id: string; version: number }> };

const SAVE_DELAY_MS = 700;

function applyPending(record: WorkflowTaskRecord, pending: Pending): WorkflowTaskRecord {
  const { data, ...fields } = pending;
  return { ...record, ...fields, ...(data ? { data: data(record.data) } : {}) };
}

export function useHolderWorkOrder({ workOrderId, local, enabled, onSaved }: { workOrderId: string | null; local?: HolderLocal; enabled: boolean; onSaved?: () => void }) {
  const [remote, setRemote] = useState<{ id: string; record: WorkflowTaskRecord; members: Member[] } | null>(null);
  const [readable, setReadable] = useState(true);
  const [pending, setPending] = useState<Pending>({});
  const [saving, setSaving] = useState(false);
  const pendingRef = useRef<Pending>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSavedRef = useRef(onSaved);
  useEffect(() => { onSavedRef.current = onSaved; });
  const id = enabled ? workOrderId : null;

  const read = useCallback(async (orderId: string) => {
    const result = await api<{ tasks: WorkflowTaskRecord[]; members: Member[] }>(`/api/workflow-tasks?id=${encodeURIComponent(orderId)}`);
    const record = result.tasks.find((item) => item.id === orderId && item.kind === "WORK_ORDER");
    if (!record) throw Object.assign(new Error("Arbetsordern hittades inte."), { status: 404 });
    return { id: orderId, record, members: result.members };
  }, []);

  const reload = useCallback(async () => {
    if (!id || local) return;
    try { setRemote(await read(id)); setReadable(true); }
    catch (issue) { const status = (issue as { status?: number }).status; if (status === 403 || status === 404) setReadable(false); }
  }, [id, local, read]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- read once per work order; a later change is read again by reload
  useEffect(() => { void reload(); }, [reload]);

  const saved = local && id ? local.tasks.find((item) => item.id === id && item.kind === "WORK_ORDER") ?? null : remote && remote.id === id ? remote.record : null;
  const record = saved ? applyPending(saved, pending) : null;

  // The newest saved order read here, at once (not at the next render), so a save right after another builds on it.
  const remoteRef = useRef(remote);
  useEffect(() => { remoteRef.current = remote; }, [remote]);
  // One save at a time (användartest 2026-10-31, fel 1): the save a moment after typing and the one Spara starts first
  // sent the same changes from the same version, and the second was refused although the first had saved them.
  const [runSerial] = useState(createSerialRunner);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!id) return;
    await runSerial(async () => {
      // Read once the save before has ended: what it sent is no longer pending, so the same changes are never sent twice.
      const sent = pendingRef.current;
      if (!Object.keys(sent).length) return;
      setSaving(true);
      const send = async (base: WorkflowTaskRecord) => {
        const payload = applyPending(base, sent);
        return local ? local.save(payload) : api<{ id: string; version: number }>("/api/workflow-tasks", { method: "POST", body: JSON.stringify({ action: "save", task: payload, autosave: true }) });
      };
      try {
        const known = local ? local.tasks.find((item) => item.id === id) ?? null : remoteRef.current?.id === id ? remoteRef.current.record : null;
        if (local && !known) throw new Error("Arbetsordern hittades inte.");
        // Someone saved the work order in between: it is read again and the same changes go on the newest version once.
        await saveOnNewest({ known, read: async () => (await read(id)).record, send, retry: !local });
      } catch (issue) {
        announce(`Arbetsordern sparades inte: ${(issue as Error).message}`, true);
        if (pendingRef.current === sent) { pendingRef.current = {}; setPending({}); }
        setSaving(false);
        void reload();
        return;
      }
      // What was typed while the save was under way stays pending.
      if (pendingRef.current === sent) { pendingRef.current = {}; setPending({}); }
      // Saved: reading the order again is not part of the save, so a failed read never says it was not saved.
      if (!local) { try { const fresh = await read(id); remoteRef.current = fresh; setRemote(fresh); } catch { /* the next reload reads it */ } }
      setSaving(false);
      onSavedRef.current?.();
    });
  }, [id, local, read, reload, runSerial]);

  const flushRef = useRef(flush);
  useEffect(() => { flushRef.current = flush; });
  // Leaving the page saves what is left.
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); void flushRef.current(); } }, []);

  /** A change of the work order's shared fields (and, through `data`, its risk step), saved a moment later. */
  const patch = useCallback((next: Pending, { now = false }: { now?: boolean } = {}) => {
    const merged: Pending = { ...pendingRef.current, ...next };
    if (pendingRef.current.data && next.data) { const first = pendingRef.current.data; const second = next.data; merged.data = (data) => second(first(data)); }
    pendingRef.current = merged;
    setPending(merged);
    if (timer.current) clearTimeout(timer.current);
    if (now) void flushRef.current();
    else timer.current = setTimeout(() => { timer.current = null; void flushRef.current(); }, SAVE_DELAY_MS);
  }, []);

  return { record, members: local ? local.members ?? [] : remote?.members ?? [], readable: local ? Boolean(saved) : readable, saving, dirty: Object.keys(pending).length > 0, patch, flush, reload };
}
