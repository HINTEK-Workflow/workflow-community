/* eslint-disable @next/next/no-img-element -- Private authenticated images must bypass the image optimizer. */
"use client";
import { controlProgress } from "@/lib/workflow/project-progress";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { formatSwedish } from "@/lib/swedish-time";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useConfirm } from "./confirm";
import {
  Plus,
  Save,
  Copy,
  Download,
  Upload,
  FileText,
  Trash2,
  CheckCircle2,
  Sparkles,
  Send,
  History,
  RefreshCw,
  Camera,
  ShieldCheck,
  Zap,
  Paperclip,
  Users,
  ClipboardList,
  ImagePlus,
  Eye,
  FileDown,
  FileSpreadsheet,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  blankControl,
  newRow,
  normalizeControl,
  totals,
  ruleSummary,
  sections,
  sectionKeys,
  visualFields,
  validateForCompletion,
  type ControlData,
} from "@/lib/kfid/model";
import {
  createPortableControlExport,
  MAX_PORTABLE_JSON_BYTES,
  parsePortableControlJson,
  type PortableControlPreview,
} from "@/lib/kfid/portable";
import {
  builtInSuggestions,
  type QuickAction,
} from "@/lib/kfid/preferences";
import { exampleRow, attachmentLabel } from "@/lib/kfid/editor-tools";
import { MeasurementRow, MeasurementHeader } from "./measurement-row";
import {
  useRegisterEditorActions,
  type WorkspaceControlAction,
  type WorkspaceControlActionId,
} from "@/components/workspace-actions";
import { ImageGallery } from "./image-gallery";
import { ReportPreview } from "./report-preview";
import { CustomerPicker } from "./customer-picker";
import { ContextHelp } from "@/features/workflow/context-help";
import { api, action } from "./api";
import { Panel, Field, Modal } from "./ui";
import { EditorHeader } from "@/features/workflow/editor-header";
import { NextSteps } from "@/features/workflow/next-steps";
import { announceTimerChange } from "@/features/workflow/running-timer";
import type { StoppedTimer } from "@/lib/workflow/running-timer";
import type {
  Overview,
  LoadedControl,
  Preferences,
  AttachmentItem,
  CustomerItem,
  ControlItem,
} from "./types";

type LocalLoadedControl = Omit<LoadedControl, "revisions"> & {
  revisions: {
    id: string;
    version: number;
    createdAt: string;
    data: ControlData;
  }[];
};

export type LocalEditorAdapter = {
  fileBased?: boolean;
  customers: CustomerItem[];
  controls: ControlItem[];
  projects: { id: string; name: string; archivedAt?: string | null; closedAt?: string | null; customerId?: string | null; workSite?: string }[];
  loadControl: (id: string) => Promise<LocalLoadedControl>;
  saveControl: (input: {
    id?: string;
    version: number;
    customerId: string | null;
    projectId: string | null;
    data: ControlData;
    status: "DRAFT" | "COMPLETED";
    copy: boolean;
    sourceId?: string;
    includeAttachments?: boolean;
  }) => Promise<LocalLoadedControl>;
  createCustomer: (data: {
    name: string;
    company: string;
    email: string;
    address: string;
    phone: string;
  }) => Promise<CustomerItem>;
  uploadAttachments: (input: {
    controlId: string;
    files: File[];
    section: string;
    rowId: string | null;
  }) => Promise<{ attachments: AttachmentItem[]; errors: string[] }>;
  deleteAttachment: (
    controlId: string,
    attachmentId: string,
  ) => Promise<AttachmentItem[]>;
  clearAttachments: (controlId: string) => Promise<void>;
  refresh: () => Promise<void>;
  /** Timer on a control in the open file (2026-09-27); omitted where the file cannot keep time. */
  timer?: (controlId: string, command: "START" | "PAUSE") => Promise<StoppedTimer[]>;
  timeFor?: (controlId: string) => { totalDurationSec: number; timerRunning: boolean };
  /** The open file's tasks, for "Nästa steg" after the control is completed (read locally, no network). */
  tasks?: { id: string; title: string; status: string; kind: string; dueDate: string; projectId: string | null }[];
};

type Props = {
  user: { email: string; name: string | null } | null;
  controlId?: string;
  initialCustomerId?: string;
  initialProjectId?: string;
  overview: Overview | null;
  preferences: Preferences;
  refresh: () => Promise<void>;
  notify: (text: string, error?: boolean) => void;
  local?: LocalEditorAdapter;
};
const controlHelp: Record<string, string> = {
  iso: "Mätning av isolationsresistans mellan fasledare och skyddsledare (PE) för att påvisa intakt isolering och frånvaro av skador, fukt eller föroreningar.",
  cont: "Mätning av skyddsledarkontinuitet (PE) för att säkerställa obruten förbindelse med låg resistans mellan PE-skena och utsatta delar.",
  volt: "Verifiering av matningsspänning (230/400 Vac) samt eventuell rotationsriktning (höger/vänster) efter avslutade prov.",
  rcd: "Provning av att jordfelsbrytaren löser ut korrekt vid simulerad felström och inom tillåten tid.",
  vis: "Inspektion av installationens utförande: märkning, förskruvningar, infästning och miljö.",
  auto: "Sätter Godkänd automatiskt i varje kontrollrad utifrån gränsvärdena.",
};
export function Editor({
  user,
  controlId,
  initialCustomerId,
  initialProjectId,
  overview,
  preferences,
  refresh,
  notify,
  local,
}: Props) {
  const router = useRouter();
  const [confirmCard, confirmElement] = useConfirm();
  const [data, setData] = useState<ControlData>(blankControl);
  const [id, setId] = useState("");
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState("DRAFT");
  // Cloud: reported time and the caller's own timer from the server; Local reads the open file (2026-09-27).
  const [cloudTime, setCloudTime] = useState({ totalDurationSec: 0, timerRunning: false });
  const [customerPicker, setCustomerPicker] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(initialProjectId ?? null);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [sites, setSites] = useState<{
    id: string;
    name: string;
    isActive: boolean;
    departments: { id: string; name: string; isActive: boolean }[];
  }[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachmentState] = useState<AttachmentItem[]>([]);
  const localObjectUrls = useRef(new Set<string>());
  const setAttachments = useCallback(
    (
      next:
        | AttachmentItem[]
        | ((current: AttachmentItem[]) => AttachmentItem[]),
    ) => {
      setAttachmentState((current) => {
        const resolved = typeof next === "function" ? next(current) : next;
        const keep = new Set(resolved.flatMap((item) => (item.url ? [item.url] : [])));
        for (const item of current) {
          if (item.url && !keep.has(item.url)) {
            URL.revokeObjectURL(item.url);
            localObjectUrls.current.delete(item.url);
          }
        }
        for (const item of resolved) if (item.url) localObjectUrls.current.add(item.url);
        return resolved;
      });
    },
    [],
  );
  useEffect(
    () => () => {
      for (const url of localObjectUrls.current) URL.revokeObjectURL(url);
      localObjectUrls.current.clear();
    },
    [],
  );
  const [history, setHistory] = useState<LoadedControl["revisions"]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [importPreview, setImportPreview] =
    useState<PortableControlPreview | null>(null);
  const [revisionAttachmentSource, setRevisionAttachmentSource] = useState<{
    controlId: string;
    count: number;
  } | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [completionExpanded, setCompletionExpanded] = useState(false);
  const [recipient, setRecipient] = useState(
    overview?.settings?.contactEmail || user?.email || "",
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saveTime, setSaveTime] = useState("");
  const [loadError, setLoadError] = useState("");
  const lock = useRef("");
  const loadedId = useRef<string | null>(null);
  const loadRequest = useRef(0);
  const saving = useRef(false);
  const changeCount = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const target = useRef({ section: "vis", rowId: "" });
  const localMode = Boolean(local);
  const userEmail = user?.email;
  useEffect(() => {
    if (localMode || !userEmail) return;
    void api<{ sites: typeof sites }>("/api/organization-structure")
      .then((result) => setSites(result.sites))
      .catch(() => setSites([]));
  }, [localMode, userEmail]);
  const readOnly = !user || status === "COMPLETED" || (!localMode && locked);
  const canSave = Boolean(user && overview);
  const draftKey = `kfid.v3.draft.${user?.email}.${overview?.organization.id}`;
  const [online, setOnline] = useState(true);
  useEffect(
    () => () => {
      if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) setSaveError(false);
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const loggedIn = Boolean(user),
    canPrint = canSave,
    hasSaved = version > 0;
  const allSuggestions = {
    ...builtInSuggestions,
    ...overview?.globalSuggestions,
    ...overview?.settings?.suggestions,
    ...preferences.fieldSuggestions,
  };
  function suggestionsFor(section: string, field?: string) {
    if (!preferences.autoSuggestEnabled) return [];
    return [
      ...new Set(
        [
          ...(allSuggestions[`${section}.${field}`] ??
            allSuggestions[section] ??
            []),
          ...(allSuggestions.general ?? []),
          ...preferences.suggestions.split("\n"),
        ]
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    ];
  }
  function selectCustomer(c: CustomerItem) {
    setCustomerId(c.id);
    setCustomerName(c.company ? `${c.name} · ${c.company}` : c.name);
    change((d) => ({
      ...d,
      meta: { ...d.meta, client: c.name, addr: c.email },
    }));
    if (!localMode) void refresh();
  }
  function change(fn: (old: ControlData) => ControlData) {
    setSaveError(false);
    changeCount.current++;
    setData(fn);
    setDirty(true);
  }
  const load = useCallback(
    async (nextId: string) => {
      const requestNumber = ++loadRequest.current;
      setLoadError("");
      try {
        const c = local
          ? await local.loadControl(nextId)
          : await api<LoadedControl>(
              `/api/workspace?action=control&id=${encodeURIComponent(nextId)}`,
            );
        if (requestNumber !== loadRequest.current) return;
        loadedId.current = c.id;
        let restored = false;
        let restoredVersion = c.version;
        let restoredCustomerId = c.customerId;
        let restoredProjectId = c.projectId ?? null;
        let restoredSiteId = c.siteId ?? null;
        let restoredDepartmentId = c.departmentId ?? null;
        if (local) {
          setData(normalizeControl(c.data));
        } else {
          try {
            const draft = JSON.parse(localStorage.getItem(draftKey) || "null");
            if (draft?.id === c.id && draft.dirty && c.status !== "COMPLETED") {
              setData(normalizeControl(draft.data));
              restored = true;
              restoredVersion = draft.version;
              restoredCustomerId = draft.customerId;
              restoredProjectId = draft.projectId ?? null;
              restoredSiteId = draft.siteId ?? null;
              restoredDepartmentId = draft.departmentId ?? null;
            } else {
              setData(normalizeControl(c.data));
              if (preferences.autoSave)
                localStorage.setItem(
                  draftKey,
                  JSON.stringify({
                    id: c.id,
                    version: c.version,
                    customerId: c.customerId,
                    projectId: c.projectId ?? null,
                    siteId: c.siteId ?? null,
                    departmentId: c.departmentId ?? null,
                    status: c.status,
                    data: c.data,
                    dirty: false,
                  }),
                );
            }
          } catch {
            setData(normalizeControl(c.data));
          }
        }
        setId(c.id);
        setVersion(restoredVersion);
        setStatus(c.status);
        setCustomerId(restoredCustomerId);
        setProjectId(restoredProjectId);
        setSiteId(restoredSiteId);
        setDepartmentId(restoredDepartmentId);
        setCustomerName(c.data.meta.client);
        setAttachments(c.attachments);
        setHistory(c.revisions);
        setCloudTime({ totalDurationSec: c.totalDurationSec ?? 0, timerRunning: Boolean(c.timerRunning) });
        setRevisionAttachmentSource(null);
        setDirty(restored);
        if (restored)
          notify(
            "Lokala ändringar återställda. Granska och spara, eller öppna senaste serverversionen.",
          );
        setLocked(false);
        if (!local && c.status !== "COMPLETED") {
          try {
            await action({ action: "lock", id: c.id, lockToken: lock.current });
          } catch (e) {
            setLocked(true);
            notify((e as Error).message, true);
          }
        }
      } catch (e) {
        if (requestNumber !== loadRequest.current) return;
        setLoadError((e as Error).message);
      }
    },
    [notify, draftKey, preferences.autoSave, local, setAttachments],
  );
  useEffect(() => {
    if (initialCustomerId && !controlId && canSave)
      void (local
        ? Promise.resolve(
            local.customers.find((customer) => customer.id === initialCustomerId),
          ).then((customer) => {
            if (!customer) throw new Error("Kunden hittades inte lokalt.");
            return customer;
          })
        : api<CustomerItem>(
            `/api/workspace?action=customer&id=${encodeURIComponent(initialCustomerId)}`,
          ))
        .then((c) => {
          setCustomerId(c.id);
          setCustomerName(c.name);
          setData((d) => ({
            ...d,
            meta: { ...d.meta, client: c.name, addr: c.email },
          }));
        })
        .catch((e) => notify(e.message, true));
  }, [initialCustomerId, controlId, canSave, notify, local]);
  // A control in a project follows the project (2026-09-26): the project's customer is locked in and
  // "Projekt / anläggning" is prefilled from the project's name and work site, but stays editable.
  const projectList = useMemo(() => local?.projects ?? overview?.projects ?? [], [local?.projects, overview?.projects]);
  const selectedProject = projectList.find((project) => project.id === projectId);
  const customerLockedByProject = Boolean(selectedProject?.customerId);
  const applyProject = useCallback((next: typeof selectedProject) => {
    if (!next) return;
    const label = [next.name, next.workSite].filter(Boolean).join(" – ");
    // Deferred so it lands after a fresh control's reset.
    void Promise.resolve().then(() => setData((d) => d.meta.proj.trim() ? d : { ...d, meta: { ...d.meta, proj: label } }));
    if (!next.customerId) return;
    void (local
      ? Promise.resolve(local.customers.find((customer) => customer.id === next.customerId))
      : api<CustomerItem>(`/api/workspace?action=customer&id=${encodeURIComponent(next.customerId)}`))
      .then((c) => {
        if (!c) return;
        setCustomerId(c.id);
        setCustomerName(c.company ? `${c.name} · ${c.company}` : c.name);
        setData((d) => ({ ...d, meta: { ...d.meta, client: d.meta.client || c.name, addr: d.meta.addr || c.email } }));
      })
      .catch((e) => notify((e as Error).message, true));
  }, [local, notify]);
  const appliedInitialProject = useRef(false);
  useEffect(() => {
    if (appliedInitialProject.current || !initialProjectId || controlId || !canSave) return;
    const project = projectList.find((item) => item.id === initialProjectId);
    if (!project) return;
    appliedInitialProject.current = true;
    applyProject(project);
  }, [applyProject, canSave, controlId, initialProjectId, projectList]);
  useEffect(() => {
    if (localMode) return;
    const key = `kfid.lock.${user?.email}.${overview?.organization.id}`;
    try {
      lock.current = sessionStorage.getItem(key) || crypto.randomUUID();
      sessionStorage.setItem(key, lock.current);
    } catch {
      lock.current = crypto.randomUUID();
    }
  }, [user?.email, overview?.organization.id, localMode]);
  useEffect(() => {
    if (controlId && loggedIn) {
      if (loadedId.current !== controlId) void load(controlId);
    } else if (!controlId && loggedIn) {
      if (loadedId.current === "__new__") return;
      loadRequest.current++;
      loadedId.current = "__new__";
      setData({
        ...blankControl(),
        meta: { ...blankControl().meta, perf: user?.name || "" },
      });
      setId("");
      setVersion(0);
      setStatus("DRAFT");
      setCustomerId(null);
      setSiteId(null);
      setDepartmentId(null);
      setAttachments([]);
      setHistory([]);
      setRevisionAttachmentSource(null);
      setDirty(false);
      setLocked(false);
      setLoadError("");
      setSaveError(false);
      try {
        if (localMode) return;
        const stored = localStorage.getItem(draftKey);
        if (stored && JSON.parse(stored).dirty !== false) {
          const draft = JSON.parse(stored);
          setData(normalizeControl(draft.data));
          setId(draft.id || "");
          setVersion(draft.version || 0);
          setCustomerId(draft.customerId || null);
          setProjectId(draft.projectId || null);
          if (
            draft.revisionAttachmentSource &&
            typeof draft.revisionAttachmentSource.controlId === "string" &&
            typeof draft.revisionAttachmentSource.count === "number"
          )
            setRevisionAttachmentSource(draft.revisionAttachmentSource);
          setDirty(true);
        }
      } catch {
        /* ignore invalid local draft */
      }
    }
  }, [
    controlId,
    loggedIn,
    load,
    draftKey,
    user?.name,
    localMode,
    setAttachments,
  ]); // stable authorization state
  useEffect(() => {
    if (!loggedIn || !dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    // In-app links: stop the navigation, ask with the in-app card, then continue (the browser's own box is only
    // the last guard when the tab itself is closed or reloaded).
    const navigate = (e: MouseEvent) => {
      const anchor = (e.target as Element).closest("a");
      if (
        anchor &&
        anchor.origin === location.origin &&
        anchor.href !== location.href &&
        !anchor.hasAttribute("download") &&
        anchor.target !== "_blank"
      ) {
        e.preventDefault();
        e.stopPropagation();
        const href = anchor.href;
        void confirmCard({ title: "Lämna kontrollen?", message: "Ändringar som inte har sparats går förlorade.", confirmLabel: "Lämna utan att spara", tone: "danger" }).then((ok) => { if (ok) router.push(href.slice(location.origin.length)); });
      }
    };
    window.addEventListener("beforeunload", handler);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", handler);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty, loggedIn, confirmCard, router]);
  useEffect(() => {
    if (!localMode && user && dirty && preferences.autoSave) {
      try {
        localStorage.setItem(
          draftKey,
          JSON.stringify({
            id,
            version,
            customerId,
            projectId,
            siteId,
            departmentId,
            data,
            status,
            dirty: true,
            revisionAttachmentSource,
          }),
        );
      } catch {
        notify("Webbläsarens lokala lagring är full.", true);
      }
    }
  }, [
    data,
    status,
    id,
    version,
    customerId,
    projectId,
    siteId,
    departmentId,
    dirty,
    user,
    draftKey,
    preferences.autoSave,
    revisionAttachmentSource,
    notify,
    localMode,
  ]);
  useEffect(() => {
    if (localMode || !id || !hasSaved || readOnly) return;
    const interval = setInterval(
      () =>
        void action({ action: "lock", id, lockToken: lock.current }).catch(
          (e) => {
            if (navigator.onLine) {
              setLocked(true);
              notify((e as Error).message, true);
            }
          },
        ),
      30_000,
    );
    const releaseOnExit = () => {
      try {
        navigator.sendBeacon(
          "/api/workspace",
          new Blob(
            [
              JSON.stringify({
                action: "release",
                id,
                lockToken: lock.current,
              }),
            ],
            { type: "application/json" },
          ),
        );
      } catch {}
    };
    window.addEventListener("pagehide", releaseOnExit);
    return () => {
      window.removeEventListener("pagehide", releaseOnExit);
      clearInterval(interval);
      void action({ action: "release", id, lockToken: lock.current }).catch(
        () => {},
      );
    };
  }, [id, hasSaved, readOnly, notify, localMode]);
  async function save(copy = false, complete = false, quiet = false) {
    if (!localMode && !online) {
      notify(
        "Du är offline. Utkastet finns lokalt; anslut till internet för att spara på servern.",
        true,
      );
      return null;
    }
    if (!canSave) {
      notify("Logga in för att spara kontrollen.", true);
      return null;
    }
    if (saving.current) return null;
    saving.current = true;
    setBusy(true);
    const count = changeCount.current;
    try {
      const snapshot = normalizeControl(data);
      if (complete) {
        const completion = validateForCompletion(snapshot, {
          attachmentCount: attachments.length,
        });
        if (!completion.complete) {
          notify(
            `Kontrollen kan inte färdigställas. ${completion.errors[0].message}`,
            true,
          );
          return null;
        }
      }
      const includeAttachments =
        Boolean(revisionAttachmentSource) || (copy && version > 0);
      const duplicatesAttachments = !localMode && includeAttachments;
      const nextId = copy ? crypto.randomUUID() : id || crypto.randomUUID();
      const nextStatus = complete ? "COMPLETED" : "DRAFT";
      const result = local
        ? await local.saveControl({
            id: copy ? undefined : id || undefined,
            version: copy ? 0 : version,
            customerId,
            projectId,
            data: snapshot,
            status: nextStatus,
            copy,
            sourceId: revisionAttachmentSource?.controlId || id || undefined,
            includeAttachments,
          })
        : await action<LoadedControl>({
            action: duplicatesAttachments ? "duplicate" : "save",
            sourceId: revisionAttachmentSource?.controlId || id,
            id: nextId,
            version: duplicatesAttachments || copy ? 0 : version,
            lockToken: lock.current,
            customerId,
            projectId,
            siteId,
            departmentId,
            data: snapshot,
            status: nextStatus,
          });
      loadedId.current = result.id;
      setSaveError(false);
      setId(result.id);
      setVersion(result.version);
      setStatus(result.status);
      if (localMode) setAttachments(result.attachments);
      setLocked(false);
      if (changeCount.current === count) {
        setDirty(false);
        setData(snapshot);
        if (!localMode)
          localStorage.setItem(
            draftKey,
            JSON.stringify({
              id: result.id,
              version: result.version,
              customerId,
              projectId,
              siteId,
              departmentId,
              data: snapshot,
              status: result.status,
              dirty: false,
            }),
          );
      }
      if (duplicatesAttachments) {
        const copied = await api<LoadedControl>(
          `/api/workspace?action=control&id=${result.id}`,
        );
        setAttachments(copied.attachments);
        setHistory(copied.revisions);
      }
      setRevisionAttachmentSource(null);
      setSaveTime(
        formatSwedish(new Date(), { hour: "2-digit", minute: "2-digit" }),
      );
      if (!quiet)
        notify(
          duplicatesAttachments
            ? "Kopia sparad med bilder och dokument."
            : copy
              ? "Kopia sparad."
              : complete
                ? "Kontrollen är färdigställd."
                : "Kontrollen är sparad.",
        );
      await (local?.refresh() ?? refresh());
      if (controlId !== result.id)
        router.replace(`/?view=new&id=${result.id}`, { scroll: false });
      return result.id;
    } catch (e) {
      setSaveError(true);
      notify((e as Error).message, true);
      return null;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  // Every task editor can start time (2026-09-27). An unsaved control is saved first.
  const time = local?.timeFor && id && version ? local.timeFor(id) : localMode ? { totalDurationSec: 0, timerRunning: false } : cloudTime;
  const timerAvailable = !localMode || Boolean(local?.timer);
  async function toggleTimer() {
    const command = time.timerRunning ? "PAUSE" : "START";
    const targetId = id && version ? id : await save(false, false, true);
    if (!targetId) return;
    setBusy(true);
    try {
      const stopped: StoppedTimer[] = local?.timer
        ? await local.timer(targetId, command)
        : (await api<{ stopped?: StoppedTimer[] }>("/api/workflow-time", { method: "POST", body: JSON.stringify({ action: "control_timer", id: targetId, command }) })).stopped ?? [];
      const ownStopped = stopped.filter((entry) => entry.taskId === targetId).reduce((sum, entry) => sum + entry.durationSec, 0);
      setCloudTime((current) => ({ totalDurationSec: current.totalDurationSec + ownStopped, timerRunning: command === "START" }));
      announceTimerChange(stopped);
      notify(command === "START" ? "Tidtagningen har startat." : "Tidtagningen är pausad och tiden sparad.");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (
      localMode ||
      !online ||
      saveError ||
      !preferences.autoSave ||
      !dirty ||
      !canSave ||
      readOnly ||
      !data.meta.proj.trim()
    )
      return;
    const timer = setTimeout(() => void save(false, false, true), 2500);
    return () => clearTimeout(timer);
  });
  async function newControl() {
    if (dirty && !(await confirmCard({ title: "Börja om?", message: "Ändringar som inte har sparats går förlorade.", confirmLabel: "Börja om", tone: "danger" }))) return;
    if (!localMode) localStorage.removeItem(draftKey);
    setData({
      ...blankControl(),
      meta: { ...blankControl().meta, perf: user?.name || "" },
    });
    setId("");
    setVersion(0);
    setStatus("DRAFT");
    setCustomerId(null);
    setSiteId(null);
    setDepartmentId(null);
    setAttachments([]);
    setHistory([]);
    setRevisionAttachmentSource(null);
    setDirty(false);
    setLocked(false);
    router.replace("/?view=new");
  }
  async function report(kind: string, previewOnly = false) {
    if (dirty || !version) {
      notify("Spara ändringarna innan du exporterar.", true);
      return;
    }
    setBusy(true);
    try {
      if (localMode) {
        const template = kind.endsWith("_template");
        const extension = kind.startsWith("pdf")
          ? "pdf"
          : kind.startsWith("xlsx")
            ? "xlsx"
            : "json";
        let bytes: Uint8Array;
        let mimeType: string;
        if (extension === "json") {
          bytes = new TextEncoder().encode(
            JSON.stringify(createPortableControlExport(data), null, 2),
          );
          mimeType = "application/json";
        } else {
          const engine = await import("@/lib/kfid/report-core");
          const identity = {
            company:
              overview?.settings?.companyName ||
              overview?.organization.name ||
              "HINTEK",
            branding: {
              primary: overview?.settings?.reportPrimary,
              accent: overview?.settings?.reportAccent,
              soft: overview?.settings?.reportSoft,
            },
          };
          if (extension === "xlsx") {
            bytes = await engine.createExcelReport(
              data,
              identity,
              template,
              attachments.length,
            );
            mimeType =
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
          } else {
            const [fontResponse, logoResponse, reportFiles] = await Promise.all([
              fetch("/fonts/DejaVuSans.ttf"),
              overview?.settings?.logoPath
                ? fetch("/api/files/logo").catch(() => null)
                : Promise.resolve(null),
              Promise.all(
                (template ? [] : attachments).map(async (item) => {
                  let fileBytes: Uint8Array | undefined;
                  if (item.url && item.mimeType.startsWith("image/")) {
                    const response = await fetch(item.url);
                    if (response.ok) {
                      let blob = await response.blob();
                      if (item.mimeType === "image/webp") {
                        const bitmap = await createImageBitmap(blob);
                        const canvas = document.createElement("canvas");
                        canvas.width = bitmap.width;
                        canvas.height = bitmap.height;
                        canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
                        bitmap.close();
                        blob = await new Promise<Blob>((resolve, reject) =>
                          canvas.toBlob(
                            (converted) =>
                              converted
                                ? resolve(converted)
                                : reject(new Error("Bilden kunde inte konverteras.")),
                            "image/png",
                          ),
                        );
                      }
                      fileBytes = new Uint8Array(await blob.arrayBuffer());
                    }
                  }
                  return {
                    filename: item.filename,
                    mimeType:
                      item.mimeType === "image/webp" ? "image/png" : item.mimeType,
                    section: item.section,
                    rowId: item.rowId,
                    label: attachmentLabel(data, item),
                    bytes: fileBytes,
                  };
                }),
              ),
            ]);
            if (!fontResponse.ok)
              throw new Error("Typsnittet för PDF kunde inte läsas in.");
            const logoBytes =
              logoResponse?.ok
                ? new Uint8Array(await logoResponse.arrayBuffer())
                : undefined;
            bytes = await engine.createPdfReport(
              data,
              { ...identity, logoBytes },
              reportFiles,
              template,
              new Uint8Array(await fontResponse.arrayBuffer()),
            );
            mimeType = "application/pdf";
            await api("/api/reports/local", {
              method: "POST",
              body: JSON.stringify({ kind, requestKey: crypto.randomUUID() }),
            });
          }
        }
        const url = URL.createObjectURL(
          new Blob([bytes as unknown as BlobPart], { type: mimeType }),
        );
        if (previewOnly) setPreview(url);
        else {
          const link = document.createElement("a");
          link.href = url;
          link.download = `KFID-${(data.meta.proj || id).replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")}.${extension}`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1_000);
        }
        await refresh();
        notify(
          previewOnly
            ? "PDF-rapporten har skapats lokalt för förhandsgranskning."
            : `${extension.toUpperCase()}-exporten har skapats lokalt.`,
        );
        return;
      }
      const r = await api<{ url: string }>("/api/reports", {
        method: "POST",
        body: JSON.stringify({ id, kind, requestKey: crypto.randomUUID() }),
      });
      if (previewOnly) setPreview(r.url);
      else {
        const a = document.createElement("a");
        a.href = r.url;
        a.download = "";
        a.click();
      }
      await refresh();
      notify(
        previewOnly
          ? "Rapporten är skapad för förhandsgranskning."
          : "Rapporten är skapad och nedladdningen har startat.",
      );
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function openRevision(
    versionNumber: number,
    includeAttachments: boolean,
  ) {
    if (dirty && !(await confirmCard({ title: "Ersätta osparade ändringar?", message: "Den valda versionen ersätter det du inte har sparat.", confirmLabel: "Ersätt", tone: "danger" }))) return;
    try {
      const sourceId = id;
      const sourceAttachmentCount = attachments.length;
      const revision = local
        ? (
            await local.loadControl(sourceId)
          ).revisions.find((item) => item.version === versionNumber)
        : await api<{ data: ControlData }>(
            `/api/workspace?action=revision&id=${sourceId}&version=${versionNumber}`,
          );
      if (!revision) throw new Error("Versionen hittades inte lokalt.");
      setData(normalizeControl(revision.data));
      setId("");
      setVersion(0);
      setStatus("DRAFT");
      setAttachments([]);
      setHistory([]);
      setRevisionAttachmentSource(
        includeAttachments && sourceAttachmentCount
          ? { controlId: sourceId, count: sourceAttachmentCount }
          : null,
      );
      setDirty(true);
      setLocked(false);
      setHistoryOpen(false);
      notify(
        includeAttachments && sourceAttachmentCount
          ? `Version ${versionNumber} öppnad som nytt utkast. ${sourceAttachmentCount} nuvarande bilagor kopieras när utkastet sparas.`
          : `Version ${versionNumber} öppnad som nytt utkast utan bilagor.`,
      );
    } catch (e) {
      notify((e as Error).message, true);
    }
  }
  async function uploadFiles(files: File[]) {
    if (localMode) {
      if (!id || !version) {
        notify("Spara kontrollen innan du lägger till bilagor.", true);
        return;
      }
      if (dirty) {
        notify("Spara nya kontrollrader innan du kopplar bilder till dem.", true);
        return;
      }
      setBusy(true);
      try {
        const result = await local!.uploadAttachments({
          controlId: id,
          files: files.slice(0, 15),
          section: target.current.section,
          rowId: target.current.rowId || null,
        });
        setAttachments(result.attachments);
        notify(
          `${files.slice(0, 15).length - result.errors.length} filer sparade lokalt.${result.errors.length ? ` ${result.errors.join(" ")}` : ""}`,
          result.errors.length > 0,
        );
      } catch (error) {
        notify((error as Error).message, true);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!id || !version) {
      notify("Spara kontrollen innan du lägger till bilagor.", true);
      return;
    }
    if (dirty) {
      notify("Spara nya kontrollrader innan du kopplar bilder till dem.", true);
      return;
    }
    setBusy(true);
    let added = 0;
    const errors: string[] = [];
    try {
      for (const file of files.slice(0, 15)) {
        try {
          const form = new FormData();
          form.set("file", file);
          form.set("controlId", id);
          form.set("section", target.current.section);
          form.set("rowId", target.current.rowId);
          await api("/api/files", { method: "POST", body: form });
          added++;
        } catch (e) {
          errors.push(`${file.name}: ${(e as Error).message}`);
        }
      }
      const c = await api<LoadedControl>(
        `/api/workspace?action=control&id=${id}`,
      );
      setAttachments(c.attachments);
      notify(
        `${added} filer uppladdade.${errors.length ? " " + errors.join(" ") : ""}`,
        errors.length > 0,
      );
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function clearAttachments() {
    if (!(await confirmCard({ title: "Ta bort alla bilagor?", message: "Alla bilder och dokument tas bort från kontrollen.", confirmLabel: "Ta bort alla", tone: "danger" }))) return;
    setBusy(true);
    try {
      if (localMode) await local!.clearAttachments(id);
      else await api(`/api/files?controlId=${id}`, { method: "DELETE" });
      setAttachments([]);
      notify(
        localMode
          ? "Alla bilagor är borttagna från den lokala arbetsytan."
          : "Alla bilagor borttagna.",
      );
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  function chooseFile(section = "vis", rowId = "") {
    target.current = { section, rowId };
    fileInput.current?.click();
  }
  async function importFile(file: File) {
    try {
      if (file.size > MAX_PORTABLE_JSON_BYTES)
        throw new Error("JSON-filen är för stor. Maximal storlek är 2 MB.");
      setImportPreview(parsePortableControlJson(await file.text()));
    } catch (e) {
      notify(`Importen misslyckades: ${(e as Error).message}`, true);
    }
  }
  async function openHistory() {
    try {
      const control = local
        ? await local.loadControl(id)
        : await api<LoadedControl>(`/api/workspace?action=control&id=${id}`);
      setHistory(control.revisions);
      setHistoryOpen(true);
    } catch (error) {
      notify((error as Error).message, true);
    }
  }
  async function completeControl() {
    if (await confirmCard({ title: "Färdigställa kontrollen?", message: "Den låses för ändringar; du kan senare skapa en kopia med Spara som.", confirmLabel: "Färdigställ" }))
      void save(false, true);
  }
  function runWorkspaceControlAction(actionId: WorkspaceControlActionId) {
    if (actionId === "save") void save();
    else if (actionId === "new") newControl();
    else if (actionId === "copy") void save(true);
    else if (actionId === "notify") setSendOpen(true);
    else if (actionId === "preview") void report("pdf", true);
    else if (actionId === "pdf") void report("pdf");
    else if (actionId === "xlsx") void report("xlsx");
    else if (actionId === "json") void report("json");
    else if (actionId === "import") importInput.current?.click();
    else if (actionId === "pdf_template") void report("pdf_template");
    else if (actionId === "xlsx_template") void report("xlsx_template");
    else if (actionId === "history") void openHistory();
    else if (actionId === "complete") completeControl();
    else if (actionId === "controls") void runQuickAction("controls");
    else if (actionId === "customers") void runQuickAction("customers");
  }
  const latest = (local?.controls ?? overview?.controls ?? [])
    .filter((c) => !c.deletedAt)
    .sort((a, b) =>
      (b.lastOpenedAt || b.updatedAt).localeCompare(
        a.lastOpenedAt || a.updatedAt,
      ),
    )[0];
  async function runQuickAction(command: QuickAction) {
    if (!user) return;
    if (command === "save") await save();
    else if (command === "copy") await save(true);
    else if (command === "new") await newControl();
    else if (command === "pdf") await report("pdf");
    else if (command === "xlsx") await report("xlsx");
    else if (command === "import") importInput.current?.click();
    else if (command === "latest") {
      if (dirty && !(await confirmCard({ title: "Lämna kontrollen?", message: "Ändringar som inte har sparats går förlorade.", confirmLabel: "Lämna utan att spara", tone: "danger" }))) return;
      if (localMode) {
        if (latest) router.push(`/?view=new&id=${latest.id}`);
        else notify("Det finns ingen annan kontroll att öppna.");
        return;
      }
      try {
        const result = await api<{ id: string | null }>(
          `/api/workspace?action=latest&currentId=${id}`,
        );
        if (result.id) router.push(`/?view=new&id=${result.id}`);
        else notify("Det finns ingen annan kontroll att öppna.");
      } catch (e) {
        notify((e as Error).message, true);
      }
    } else if (
      ["controls", "customers", "stats", "settings"].includes(command)
    ) {
      if (!dirty || (await confirmCard({ title: "Lämna kontrollen?", message: "Ändringar som inte har sparats går förlorade.", confirmLabel: "Lämna utan att spara", tone: "danger" })))
        router.push(`/?view=${command}`);
    }
  }
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && user) {
        e.preventDefault();
        void save(e.shiftKey);
      }
    };
    const command = (e: Event) => {
      void runQuickAction((e as CustomEvent<QuickAction>).detail);
    };
    window.addEventListener("keydown", keyboard);
    window.addEventListener("kfid:command", command);
    return () => {
      window.removeEventListener("keydown", keyboard);
      window.removeEventListener("kfid:command", command);
    };
  });
  const counts = totals(data),
    total = counts.reduce((n, s) => n + s.total, 0),
    passed = counts.reduce((n, s) => n + s.ok, 0),
    completion = validateForCompletion(data, {
      attachmentCount: attachments.length,
    });
  const completionError = completion.errors[0]?.message;
  const workspaceControlActions = useMemo<WorkspaceControlAction[]>(
    () => [
      { id: "copy", label: "Spara som", group: "control", disabled: !user || busy },
      { id: "preview", label: "Förhandsgranska", group: "report", disabled: !version || dirty || busy || !canPrint },
      { id: "pdf", label: "PDF", group: "report", disabled: !version || dirty || busy || !canPrint },
      { id: "xlsx", label: "Excel", group: "report", disabled: !version || dirty || busy || !canSave },
      { id: "json", label: "JSON", group: "report", disabled: !version || dirty || busy || !canSave },
      { id: "import", label: "Importera JSON", group: "report", disabled: !user || busy },
      { id: "pdf_template", label: "PDF-mall", group: "report", disabled: !version || dirty || busy || !canPrint },
      { id: "xlsx_template", label: "Excel-mall", group: "report", disabled: !version || dirty || busy || !canSave },
      { id: "history", label: "Historik", group: "status", disabled: !version || !canSave || busy },
      {
        id: "complete",
        label: "Färdigställ",
        group: "status",
        disabled: !version || readOnly || dirty || busy || !completion.complete,
        title: completion.complete ? "Färdigställ och lås kontrollen" : completionError,
      },
      { id: "controls", label: "Mina kontroller", group: "navigate", disabled: !user || busy },
      { id: "customers", label: "Kundregister", group: "navigate", disabled: !user || busy },
    ],
    [busy, canPrint, canSave, completion.complete, completionError, dirty, readOnly, user, version],
  );
  useRegisterEditorActions({
    save: () => void save(),
    newControl,
    canSave: canSave && !readOnly && !loadError,
    canCreate: Boolean(user) && !loadError,
    busy,
    dirty,
    controlActions: workspaceControlActions,
    runControlAction: runWorkspaceControlAction,
  });
  if (loadError)
    return (
      <Panel title="Kunde inte öppna kontrollen">
        <p className="text-destructive">{loadError}</p>
        <Button
          onClick={() => controlId && void load(controlId)}
          className="mt-4"
        >
          Försök igen
        </Button>
      </Panel>
    );
  return (
    <div className="kfid-editor space-y-6">
      {confirmElement}
      {!localMode && !online && (
        <p role="status" className="notice">
          Du är offline. Ändringar lagras på den här enheten när autosparning är
          på. Serverns version kontrolleras när anslutningen återkommer.
        </p>
      )}
      {revisionAttachmentSource && (
        <p role="status" className="notice">
          Historisk version öppnad som nytt utkast. När du sparar kopieras
          kontrollens {revisionAttachmentSource.count} nuvarande bilagor till
          den nya kontrollen.
        </p>
      )}
      {/* Same header and button placement as work orders and risk assessments; the old banner surface is gone (2026-09-25). */}
      <EditorHeader
        className="editor-workflow-header editor-heading"
        // Below desktop, Spara lives in the bottom bar and Spara som in the menu.
        actionsClassName="hidden lg:contents"
        eyebrow="Kontroll före idrifttagning"
        title={version ? data.meta.proj || "Kontroll" : "Ny kontroll"}
        status={status === "COMPLETED" ? "COMPLETED" : "DRAFT"}
        statusLabel={status === "COMPLETED" ? "Färdigställd" : "Utkast"}
        progress={controlProgress(status, completion.progress.percent)}
        facts={[
          { icon: Zap, label: `${total} kontrollpunkter` },
          { icon: ShieldCheck, label: `${passed} godkända`, iconClassName: "text-emerald-600" },
          { icon: Paperclip, label: `${attachments.length} bilagor`, iconClassName: "text-sky-600" },
        ]}
        timer={timerAvailable ? {
          running: time.timerRunning,
          totalDurationSec: time.totalDurationSec,
          onToggle: () => void toggleTimer(),
          disabled: busy || !canSave || (status === "COMPLETED" && !time.timerRunning) || (!time.timerRunning && !(id && version) && (localMode || !data.meta.proj.trim())),
          hint: status === "COMPLETED" ? "En färdigställd kontroll kan inte tidrapporteras." : localMode ? "Spara kontrollen innan tidrapporteringen startas." : "Ange projekt eller anläggning först, så sparas kontrollen när tiden startar.",
        } : undefined}
        detail={<span className="editor-workflow-description">
          {version
            ? `Version ${version}${saveTime ? ` · Sparad ${saveTime}` : ""}`
            : "Från första mätningen till ett samlat protokoll."}
        </span>}
        actions={<>
          {!version && latest && (
            <Button asChild variant="outline">
              <Link href={`/?view=new&id=${latest.id}`}>
                <History />
                Senaste kontrollen
              </Link>
            </Button>
          )}
          <Button
            variant="outline"
            disabled={!user || busy}
            onClick={() => void save(true)}
          >
            <Copy />
            Spara som
          </Button>
        </>}
        primaryAction={<>
          <Button
            className="editor-primary-save"
            disabled={!canSave || readOnly || busy}
            onClick={() => void save()}
          >
            <Save />
            {busy ? "Arbetar…" : dirty ? "Spara ändringar" : "Spara"}
          </Button>
        </>}
      />
      {/* Nästa steg also after a completed control (flödesvåg 2, 2026-09-30); no follow-up work order here, since a
          work order's origin is a task and the control has its own deviations in the protocol. */}
      {status === "COMPLETED" && id && version && user ? <NextSteps task={{ id, kind: "COMMISSIONING_CONTROL", projectId }}
        projectName={selectedProject?.name} localTasks={localMode ? local?.tasks ?? [] : undefined} /> : null}
      <CustomerPicker
        open={customerPicker}
        onOpenChange={setCustomerPicker}
        onSelect={selectCustomer}
        localCustomers={local?.customers}
        onCreateLocal={local?.createCustomer}
      />
      {!user && (
        <div className="notice">
          Förhandsversion: endast det inbjudna testkontot kan fylla i och spara
          kontroller just nu.
        </div>
      )}
      {!localMode && (locked || saveError) && id && (
        <Button
          variant="outline"
          onClick={async () => {
            if (
              !dirty ||
              (await confirmCard({ title: "Hämta serverversionen?", message: "Det lokala utkastet ersätts med den senaste versionen från servern.", confirmLabel: "Ersätt utkastet", tone: "danger" }))
            ) {
              localStorage.removeItem(draftKey);
              void load(id);
            }
          }}
        >
          <RefreshCw />
          Öppna senaste serverversionen
        </Button>
      )}
      {locked && (
        <div className="notice">
          Kontrollen är låst av en annan flik. Läs underlaget, öppna senaste
          versionen eller välj Spara som.
        </div>
      )}
      <Panel
        title="Grunduppgifter"
        description="Projekt, kontaktperson och mätinstrument."
      >
        <fieldset
          disabled={readOnly || busy}
          className="editor-basics grid gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-3"
        >
          {(overview?.projects.length || local?.projects.length) ? (
            <label className="space-y-1 text-xs text-muted-foreground sm:col-span-2 xl:col-span-3">
              Projektkoppling (valfri)
              <select
                className="form-select"
                value={projectId ?? ""}
                // After the first save the project changes only through the project's Koppla/Flytta (history).
                disabled={readOnly || busy || version > 0}
                title={version > 0 ? "Byt projekt via projektets Koppla befintlig uppgift." : undefined}
                onChange={(event) => {
                  setProjectId(event.target.value || null);
                  applyProject(projectList.find((project) => project.id === event.target.value));
                  changeCount.current += 1;
                  setDirty(true);
                }}
              >
                <option value="">Fristående uppgift</option>
                {(local?.projects ?? overview?.projects ?? []).filter((project) => (!project.archivedAt && !project.closedAt) || project.id === projectId).map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          {(
            [
              { key: "proj", label: "Projekt / anläggning" },
              { key: "perf", label: "Utfört av" },
              { key: "date", label: "Datum", type: "date" },
              { key: "client", label: "Kontaktperson" },
              { key: "addr", label: "E-post", type: "email" },
              { key: "ctrl", label: "Kontrollerat av" },
              { key: "instr", label: "Instrument (typ)" },
              { key: "sn", label: "Instrument S/N" },
              { key: "cal", label: "Kalibrering", type: "date" },
            ] as const
          ).map((f) => (
            <div key={f.key} className="min-w-0">
              <div className="flex items-end gap-1">
                <div className="min-w-0 flex-1">
                  <Field
                    id={f.key === "proj" ? "project" : `meta-${f.key}`}
                    label={f.label}
                    required={f.key === "proj"}
                    type={"type" in f ? f.type : "text"}
                    value={String(data.meta[f.key])}
                    suggestions={
                      "type" in f ? undefined : suggestionsFor("meta", f.key)
                    }
                    onChange={(v) =>
                      change((d) => ({ ...d, meta: { ...d.meta, [f.key]: v } }))
                    }
                  />
                </div>
                {f.key === "client" && (
                  <>
                    <Button
                      variant="outline"
                      size="icon"
                      className="customer-link-button h-10 w-10 shrink-0"
                      disabled={!canSave || customerLockedByProject}
                      aria-label="Välj eller skapa kund"
                      title={
                        customerLockedByProject
                          ? `Kopplad kund: ${customerName} (följer projektet)`
                          : customerId
                          ? `Kopplad kund: ${customerName}`
                          : "Välj eller skapa kund"
                      }
                      onClick={() => setCustomerPicker(true)}
                    >
                      <Users />
                    </Button>
                    {customerId && !customerLockedByProject && (
                      <Button
                        variant="outline"
                        size="icon"
                        className="customer-link-button h-10 w-10 shrink-0"
                        aria-label="Ta bort kundkoppling"
                        onClick={() => {
                          setCustomerId(null);
                          setCustomerName("");
                          setDirty(true);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </fieldset>
        {!localMode && sites.length > 0 && (
          <div className="mt-4 grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-muted-foreground">
              Plats (valfri)
              <select aria-label="Plats" className="form-select" value={siteId || ""} disabled={!canSave} onChange={(event) => {
                 setSiteId(event.target.value || null);
                 setDepartmentId(null);
                 changeCount.current += 1;
                 setDirty(true);
              }}>
                <option value="">Ingen plats</option>
                {sites.filter((site) => site.isActive || site.id === siteId).map((site) => <option key={site.id} value={site.id}>{site.name}{!site.isActive && " (pausad)"}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Avdelning (valfri)
              <select aria-label="Avdelning" className="form-select" value={departmentId || ""} disabled={!canSave || !siteId} onChange={(event) => {
                 setDepartmentId(event.target.value || null);
                 changeCount.current += 1;
                 setDirty(true);
              }}>
                <option value="">Ingen avdelning</option>
                {sites.find((site) => site.id === siteId)?.departments.filter((department) => department.isActive || department.id === departmentId).map((department) => <option key={department.id} value={department.id}>{department.name}{!department.isActive && " (pausad)"}</option>)}
              </select>
            </label>
          </div>
        )}
        <div
          className="control-moments mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
          aria-label="Kontrollmoment"
        >
          {[...sectionKeys, "vis" as const].map((k, index) => {
            const label =
              k === "vis" ? "Visuell kontroll" : sections[k].title;
            return (
            <div
              key={k}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 ${data.active[k] ? "border-primary/25 bg-secondary" : "bg-background"}`}
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                <Checkbox
                  checked={data.active[k]}
                  disabled={readOnly}
                  onCheckedChange={(v) =>
                    change((d) => ({
                      ...d,
                      active: { ...d.active, [k]: v === true },
                    }))
                  }
                />
                <span className="text-xs font-medium">{label}</span>
              </label>
              <ContextHelp
                label={label}
                text={controlHelp[k]}
                align={index < 2 ? "left" : "right"}
              />
            </div>
          )})}
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2.5">
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
              <Checkbox
                checked={data.meta.autoOn}
                disabled={readOnly}
                onCheckedChange={(v) =>
                  change((d) =>
                    normalizeControl({
                      ...d,
                      meta: { ...d.meta, autoOn: v === true },
                    }),
                  )
                }
              />
              <span className="text-xs font-medium">Autobedömning</span>
            </label>
            <ContextHelp label="Autobedömning" text={controlHelp.auto} />
          </div>
        </div>
      </Panel>
      {sectionKeys
        .filter((k) => data.active[k])
        .map((k) => (
          <Panel
            key={k}
            collapsible
            title={sections[k].title}
            className="measurement-panel"
            leadingActions={
              <div className="measurement-actions">
                <Button
                  size="icon"
                  variant="outline"
                  className="measurement-action"
                  disabled={readOnly}
                  title={`Lägg till rad – ${data[k].rows.length} rader`}
                  aria-label={`Lägg till rad i ${sections[k].title}`}
                  onClick={() =>
                    change((d) => ({
                      ...d,
                      [k]: {
                        rows: preferences.rowsOnTop
                          ? [newRow(k), ...d[k].rows]
                          : [...d[k].rows, newRow(k)],
                      },
                    }))
                  }
                >
                  <Plus />
                  <span
                    className="measurement-count"
                    aria-label={`${data[k].rows.length} rader`}
                  >
                    {data[k].rows.length}
                  </span>
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  className="measurement-action"
                  disabled={readOnly || busy}
                  title="Lägg till sektionsbild"
                  onClick={() => chooseFile(k)}
                  aria-label={`Lägg till bild för ${sections[k].title}`}
                >
                  <ImagePlus />
                </Button>
                {preferences.showExamples && (
                  <Button
                    size="icon"
                    variant="outline"
                    className="measurement-action"
                    title="Lägg till test-/exempelrad"
                    aria-label={`Lägg till test-/exempelrad i ${sections[k].title}`}
                    disabled={
                      readOnly || data[k].rows.some((r) => r.example === true)
                    }
                    onClick={() =>
                      change((d) =>
                        normalizeControl({
                          ...d,
                          [k]: { rows: [...d[k].rows, exampleRow(k)] },
                        }),
                      )
                    }
                  >
                    <ClipboardList />
                  </Button>
                )}
              </div>
            }
          >
            {!data[k].rows.length && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Inga mätningar ännu. Lägg till din första rad.
              </p>
            )}
            {data[k].rows.some((row) => row.example === true) && (
              <p className="measurement-example mb-2 text-xs text-amber-700">
                Exempeldata i rad{" "}
                {data[k].rows
                  .flatMap((row, i) => (row.example === true ? [i + 1] : []))
                  .join(", ")}{" "}
                – test-/exempelraden räknas inte vid färdigställande. Ersätt
                den med verkliga mätvärden.
              </p>
            )}
            <div className={`measurement-list measurement-${k}`}>
              {!!data[k].rows.length && k !== "rcd" && (
                <MeasurementHeader section={k} />
              )}
              {data[k].rows.map((row, i) => (
                <MeasurementRow
                  key={String(row.uid)}
                  section={k}
                  row={row}
                  index={i}
                  auto={data.meta.autoOn}
                  disabled={readOnly || busy}
                  suggestions={(field) => suggestionsFor(k, field)}
                  onImage={() => chooseFile(k, String(row.uid))}
                  onRemove={() =>
                    change((d) => ({
                      ...d,
                      [k]: { rows: d[k].rows.filter((r) => r.uid !== row.uid) },
                    }))
                  }
                  onChange={(field, value) =>
                    change((d) => ({
                      ...d,
                      [k]: {
                        rows: d[k].rows.map((r) =>
                          r.uid === row.uid ? { ...r, [field]: value } : r,
                        ),
                      },
                    }))
                  }
                />
              ))}
            </div>
          </Panel>
        ))}
      {data.active.vis && (
        <Panel
          collapsible
          title="Visuell kontroll"
          description="Bekräfta de kontrollpunkter som har granskats."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {visualFields.map((f) => (
              <label
                key={f.key}
                className="flex items-center gap-3 py-1.5 text-sm"
              >
                <Checkbox
                  disabled={readOnly}
                  checked={data.vis.checks[f.key] === true}
                  onCheckedChange={(v) =>
                    change((d) => ({
                      ...d,
                      vis: {
                        ...d.vis,
                        checks: { ...d.vis.checks, [f.key]: v === true },
                      },
                    }))
                  }
                />
                {f.label}
              </label>
            ))}
          </div>
        </Panel>
      )}
      <Panel
        title="Bilder och dokument"
        description={
          localMode
            ? local?.fileBased
              ? "Filer bäddas in i arbetsytefilen när den laddas ned. Högst 10 bilder och 5 dokument, max 10 MB per fil."
              : "Filer sparas i undermappen kfid-files. Högst 10 bilder och 5 dokument, max 10 MB per fil."
            : "Högst 10 bilder och 5 dokument. Max 10 MB per fil."
        }
        actions={
          <Button
            type="button"
            variant="outline"
            disabled={readOnly || busy || !version}
            onClick={() => chooseFile()}
          >
            <Upload />
            Lägg till fil
          </Button>
        }
      >
        <input
          ref={fileInput}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,.pdf,.txt,.doc,.docx,.xls,.xlsx"
          className="sr-only"
          aria-label="Ladda upp bilaga"
          onChange={(e) => {
            if (e.target.files?.length)
              void uploadFiles(Array.from(e.target.files));
            e.target.value = "";
          }}
        />
        {attachments.length > 0 && (
          <Button
            variant="ghost"
            className="mb-4 text-destructive"
            disabled={readOnly || busy}
            onClick={() => void clearAttachments()}
          >
            <Trash2 />
            Ta bort alla bilagor
          </Button>
        )}
        {!attachments.length ? (
          <p className="text-sm text-muted-foreground">
            Inga bilagor tillagda.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {attachments.map((a) => (
              <div key={a.id} className="overflow-hidden rounded-lg border">
                {a.mimeType.startsWith("image/") && (
                  <button
                    type="button"
                    className="block w-full"
                    onClick={() => setImage(a.id)}
                    aria-label={`Visa ${a.filename}`}
                  >
                    <img
                      src={a.url || `/api/files/${a.id}`}
                      alt={a.filename}
                      className="h-36 w-full object-cover"
                    />
                  </button>
                )}
                <div className="flex items-start justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <a
                      href={a.url || `/api/files/${a.id}`}
                      download={a.url ? a.filename : undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {a.filename}
                    </a>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {attachmentLabel(data, a)}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Ta bort ${a.filename}`}
                    disabled={readOnly || busy}
                    onClick={async () => {
                      if (!(await confirmCard({ title: "Ta bort bilagan?", message: `${a.filename} tas bort från kontrollen.`, confirmLabel: "Ta bort", tone: "danger" }))) return;
                      try {
                        if (localMode)
                          setAttachments(await local!.deleteAttachment(id, a.id));
                        else {
                          await api(`/api/files/${a.id}`, { method: "DELETE" });
                          setAttachments((items) =>
                            items.filter((x) => x.id !== a.id),
                          );
                        }
                      } catch (e) {
                        notify((e as Error).message, true);
                      }
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel
        title="Sammanfattning"
        description="Granska resultat och skriv avvikelser, åtgärder eller hänvisningar."
        actions={
          <Button
            variant="outline"
            disabled={readOnly}
            onClick={() =>
              change((d) => ({
                ...d,
                vis: { ...d.vis, comment: ruleSummary(d) },
              }))
            }
          >
            <RefreshCw />
            Sammanställ resultat
          </Button>
        }
      >
        <div className="mb-4 flex flex-wrap gap-2">
          {counts.map((c) => (
            <span
              key={c.key}
              className={`rounded-full px-3 py-1 text-xs font-medium ${c.total && c.total === c.ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}
            >
              {c.title}: {c.ok}/{c.total}
            </span>
          ))}
        </div>
        <div className="completion-card mb-5 rounded-xl border bg-muted/30 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Redo att färdigställa</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {completion.progress.completed} av {completion.progress.total}{" "}
                krav uppfyllda
                {!completion.complete && ` · ${completion.errors.length} återstår`}.
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${completion.complete ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}
            >
              {completion.progress.percent}%
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className={`h-full rounded-full ${completion.complete ? "bg-emerald-600" : "bg-amber-500"}`}
              style={{ width: `${completion.progress.percent}%` }}
            />
          </div>
          {(completion.errors.length > 0 || completion.warnings.length > 0) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 -ml-2"
              aria-expanded={completionExpanded}
              onClick={() => setCompletionExpanded((value) => !value)}
            >
              <ChevronDown className={completionExpanded ? "rotate-180" : ""} />
              {completionExpanded ? "Dölj detaljer" : "Visa detaljer"}
            </Button>
          )}
          {completionExpanded && completion.errors.length > 0 && (
            <div className="mt-4 text-sm text-destructive">
              <p className="flex items-center gap-2 font-medium">
                <AlertTriangle className="size-4" />
                Måste kompletteras
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                {completion.errors.slice(0, 6).map((issue) => (
                  <li key={`${issue.code}:${issue.path}`}>{issue.message}</li>
                ))}
              </ul>
              {completion.errors.length > 6 && (
                <p className="mt-2 text-xs">
                  Ytterligare {completion.errors.length - 6} uppgifter saknas.
                </p>
              )}
            </div>
          )}
          {completionExpanded && completion.warnings.length > 0 && (
            <div className="mt-4 text-sm text-amber-800 dark:text-amber-300">
              <p className="font-medium">Bra att kontrollera</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                {completion.warnings.slice(0, 4).map((issue) => (
                  <li key={`${issue.code}:${issue.path}`}>{issue.message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <label htmlFor="summary-comment" className="sr-only">
          Sammanfattning / kommentarer
        </label>
        <textarea
          id="summary-comment"
          className="form-textarea min-h-40"
          value={data.vis.comment}
          disabled={readOnly}
          onChange={(e) =>
            change((d) => ({
              ...d,
              vis: { ...d.vis, comment: e.target.value },
            }))
          }
        />
        <div className="mt-4 hidden flex-wrap items-center justify-between gap-3 border-t pt-4 lg:flex">
          <Button
            type="button"
            variant="outline"
            disabled={!version || !canSave || busy}
            onClick={() => void openHistory()}
          >
            <History />
            Historik
          </Button>
          <Button
            type="button"
            disabled={!version || readOnly || dirty || busy || !completion.complete}
            title={completion.complete ? "Färdigställ och lås kontrollen" : completionError}
            onClick={completeControl}
          >
            <CheckCircle2 />
            Färdigställ
          </Button>
        </div>
        <div className="mobile-action-grid mt-4 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={localMode || !id || dirty || !overview?.aiEnabled}
            title={
              localMode
                ? "AI-granskning kräver en sparad Cloud-kontroll."
                : !id
                  ? "Spara kontrollen innan AI-granskning."
                  : dirty
                    ? "Spara dina senaste ändringar innan AI-granskning."
                    : !overview?.aiEnabled
                      ? "AI-provider är avstängd av servern."
                      : "Granska den sparade kontrollen med HINTEK AI."
            }
          >
            <Sparkles />
            AI-granska kontroll
          </Button>
          <Button variant="outline" disabled>
            <Camera />
            AI-bildtolkning
          </Button>
          <p className="basis-full text-xs leading-5 text-muted-foreground" role="status">
            {localMode
              ? "AI-granskning skickar aldrig Local-filer. Spara en separat kontroll i HINTEK Cloud om funktionen ska användas senare."
              : !id
                ? "Spara kontrollen först. Därefter visas maxkostnaden innan en AI-granskning kan startas."
                : dirty
                  ? "Spara de senaste ändringarna så att AI:n granskar rätt version."
                  : overview?.aiEnabled
                    ? "Maxkostnaden visas och reserveras före start. Minsta slutliga uttag är 5 krediter; outnyttjad reservation återförs automatiskt."
                    : overview?.aiConfigured
                      ? "AI-anslutningen finns på servern men är avstängd. Inga kontrolluppgifter skickas och inga krediter dras."
                      : "AI-kontrollgranskaren och kreditmotorn är förberedda. Servernyckel och providerläge är ännu inte aktiverade, så inga uppgifter skickas och inga krediter dras."}
          </p>
        </div>
      </Panel>
      <Panel
        title="Rapport och hantering"
        description="E-postmottagare och information inför rapport och export."
        className="report-panel"
        collapsible
        defaultCollapsed
        persistentContent={
          <>
            <div className="mb-5 hidden lg:block">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Rapport och export</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={!version || dirty || busy || !canPrint} onClick={() => void report("pdf", true)}><Eye />Förhandsgranska</Button>
                <Button type="button" variant="outline" disabled={!version || dirty || busy || !canPrint} onClick={() => void report("pdf")}><FileDown />PDF</Button>
                <Button type="button" variant="outline" disabled={!version || dirty || busy || !canSave} onClick={() => void report("xlsx")}><FileSpreadsheet />Excel</Button>
                <Button type="button" variant="outline" disabled={!version || dirty || busy || !canSave} onClick={() => void report("json")}><Download />JSON</Button>
                <Button type="button" variant="outline" disabled={!user || busy} onClick={() => importInput.current?.click()}><Upload />Importera JSON</Button>
                <Button type="button" variant="outline" disabled={!version || dirty || busy || !canPrint} onClick={() => void report("pdf_template")}><FileText />PDF-mall</Button>
                <Button type="button" variant="outline" disabled={!version || dirty || busy || !canSave} onClick={() => void report("xlsx_template")}><FileSpreadsheet />Excel-mall</Button>
              </div>
            </div>
            <Field
              id="installer-email"
              label="Elinstallatörens e-post"
              type="email"
              value={recipient}
              onChange={setRecipient}
              disabled={!canSave}
            />
            <Button
              type="button"
              className="report-notify-button mt-3 w-full sm:w-auto"
              disabled={localMode || busy || !canSave || readOnly}
              onClick={() => setSendOpen(true)}
            >
              <Send />
              Spara och meddela
            </Button>
            {(localMode || !canSave || readOnly) && (
              <p role="status" className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
                {localMode
                  ? "Kan inte skicka i lokalt läge eftersom kontrolluppgifter inte överförs till HINTEK. Exportera rapporten och skicka den manuellt."
                  : "Kan inte skicka eftersom kontrollen inte är redigerbar för det här kontot."}
              </p>
            )}
            <input
              type="file"
              accept=".json,application/json"
              ref={importInput}
              className="sr-only"
              aria-label="Importera kontroll"
              onChange={(e) => {
                if (e.target.files?.[0]) void importFile(e.target.files[0]);
                e.target.value = "";
              }}
            />
          </>
        }
      >
        <p className="mb-4 text-xs leading-5 text-muted-foreground">
          {localMode
            ? local?.fileBased
              ? "Rapporter skapas på den här datorn. Ladda ned arbetsytefilen för varaktig lagring."
              : "Rapporter skapas på den här datorn. Spara kontrollen i den lokala mappen före export."
            : "Spara kontrollen före rapport eller export."}
        </p>
        <p className="mt-3 text-xs text-muted-foreground lg:hidden">
          Rapport-, export- och statusåtgärder finns i huvudmenyn.
        </p>
      </Panel>
      <Modal
        open={Boolean(importPreview)}
        onOpenChange={(open) => {
          if (!open) setImportPreview(null);
        }}
        title="Förhandsgranska JSON-import"
      >
        {importPreview && (
          <div className="space-y-5">
            <div className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Projekt</p>
                <p className="mt-1 text-sm font-medium">
                  {importPreview.project || "Projekt saknas"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Källformat</p>
                <p className="mt-1 text-sm font-medium">
                  {importPreview.source}
                  {importPreview.schemaVersion
                    ? ` · schema ${importPreview.schemaVersion}`
                    : ""}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Regelprofil</p>
                <p className="mt-1 text-sm font-medium">
                  {importPreview.ruleVersion || "Saknas i äldre fil"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Mätrader</p>
                <p className="mt-1 text-sm font-medium">
                  {importPreview.rowCount}
                </p>
              </div>
            </div>
            {dirty && (
              <p className="notice" role="status">
                Det nuvarande osparade formuläret ersätts först när du bekräftar
                importen.
              </p>
            )}
            {importPreview.ignored.length > 0 && (
              <div>
                <h3 className="section-title">Fält som inte följer med</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {importPreview.ignored.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <h3 className="section-title">Att kontrollera</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {importPreview.warnings.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setImportPreview(null)}>
                Avbryt
              </Button>
              <Button
                onClick={() => {
                  setData(importPreview.data);
                  setId("");
                  setVersion(0);
                  setStatus("DRAFT");
                  setCustomerId(null);
                  setSiteId(null);
                  setDepartmentId(null);
                  setCustomerName(importPreview.data.meta.client);
                  setAttachments([]);
                  setHistory([]);
                  setRevisionAttachmentSource(null);
                  setDirty(true);
                  setLocked(false);
                  setImportPreview(null);
                  notify(
                    "Kontrollen är importerad som ett nytt utkast. Välj kund och lägg till bilagor separat.",
                  );
                }}
              >
                <Upload />
                Importera som nytt utkast
              </Button>
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        title="Versionshistorik"
      >
        <p className="page-description mb-4">
          Öppna en tidigare version som ett nytt utkast. Originalet och dess
          historik ändras inte. Bilagor är inte versionshistorik och måste
          därför väljas uttryckligen.
        </p>
        <div className="space-y-2">
          {history.map((h) => (
            <div
              key={h.id}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <span className="text-sm">
                Version {h.version} ·{" "}
                {formatSwedish(h.createdAt, { dateStyle: "short", timeStyle: "short" })}
              </span>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void openRevision(h.version, false)}
                >
                  Utan bilagor
                </Button>
                {attachments.length > 0 && (
                  <Button
                    size="sm"
                    onClick={() => void openRevision(h.version, true)}
                  >
                    Med {attachments.length} bilagor
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Modal>
      <Modal
        open={sendOpen}
        onOpenChange={setSendOpen}
        title="Meddela om kontrollen"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const savedId = dirty || !version ? await save() : id;
              if (!savedId) return;
              await api("/api/notify", {
                method: "POST",
                body: JSON.stringify({ id: savedId, email: recipient }),
              });
              setSendOpen(false);
              notify("Meddelandet är skickat.");
              await refresh();
            } catch (err) {
              notify((err as Error).message, true);
            } finally {
              setBusy(false);
            }
          }}
          className="space-y-4"
        >
          <Field
            label="Mottagarens e-post"
            type="email"
            id="notify-email"
            value={recipient}
            onChange={setRecipient}
            required
          />
          <p className="page-description">
            Mottagaren får en länk som kräver inloggning och företagsbehörighet.
            Under testperioden kan endast testkontot öppna länken.
          </p>
          <Button disabled={busy} type="submit">
            <Send />
            Skicka meddelande
          </Button>
        </form>
      </Modal>
      <ImageGallery
        id={image}
        files={attachments}
        data={data}
        onSelect={setImage}
      />
      <ReportPreview url={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
