"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Eraser, Monitor, Smartphone, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formCompletion, initialFormValues, type FormValues } from "@/lib/workflow/form-document";
import type { EditorDocument } from "@/lib/workflow/form-editor";
import { formDisplayName, type FormMeta } from "@/lib/workflow/form-publish";
import { sampleFormValues } from "@/lib/workflow/form-sample";
import { currentPreviewTheme, focusPreviewBlock, FORM_PREVIEW_PATH, PREVIEW_CUSTOMERS, PREVIEW_PROJECTS, type FormPreviewMessage } from "../form-preview-frame";
import { WorkflowTaskEditor } from "../workflow-task-editor";

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string, React.ReactNode][]; onChange: (value: T) => void }) {
  // The editor bar's compact height (2026-09-27): 32 px on a computer, the 44 px touch height below 1024 px.
  return <div className="flex h-8 rounded-[var(--radius-control)] border bg-card p-0.5 max-lg:h-11" role="group" aria-label={label}>
    {options.map(([option, text, icon]) => <Button key={option} type="button" className="h-full min-h-0! rounded-[calc(var(--radius-control)-2px)] px-2.5" variant={value === option ? "secondary" : "ghost"} aria-pressed={value === option} onClick={() => onChange(option)}>{icon}{text}</Button>)}
  </div>;
}

/**
 * Utförandeläge (2026-09-26, sharpened 2026-09-28): the real task editor with the draft – header, project and
 * customer, panels, Bilder och dokument, Rapport och hantering – exactly as the person filling in the protocol gets it,
 * with example answers and the requirements for completion. "Dator" draws the editor on this page; "Mobil" draws it in
 * a frame of a phone's width, since a phone's look depends on the real viewport. Nothing is stored.
 */
export function ExecutionPreview({ document, meta, area, publisher, userName }: { document: EditorDocument; meta: FormMeta; area?: string; publisher?: string; userName?: string }) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [values, setValues] = useState<FormValues>(() => initialFormValues(document));
  // Choosing example answers starts the editor anew with them; typing in the editor only updates the requirements.
  const [generation, setGeneration] = useState(0);
  const [showRequirements, setShowRequirements] = useState(true);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const completion = useMemo(() => formCompletion(document, values), [document, values]);
  const name = formDisplayName(meta);
  const load = (next: FormValues) => { setValues(next); setGeneration((value) => value + 1); };
  const post = (message: FormPreviewMessage) => frame.current?.contentWindow?.postMessage(message, window.location.origin);
  // The phone frame says when it is ready and reports what is typed in it; only its own messages are accepted.
  useEffect(() => {
    const onMessage = (event: MessageEvent<FormPreviewMessage>) => {
      if (event.origin !== window.location.origin || !frame.current || event.source !== frame.current.contentWindow || !event.data || typeof event.data !== "object") return;
      if (event.data.type === "hintek-form-preview-ready") setFrameReady(true);
      else if (event.data.type === "hintek-form-preview-values") setValues(event.data.values);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  // Leaving the phone unmounts its frame; the next one says when it is ready again.
  const chooseDevice = (next: "desktop" | "mobile") => { setDevice(next); setFrameReady(false); };
  useEffect(() => {
    if (device !== "mobile" || !frameReady) return;
    post({ type: "hintek-form-preview-show", document, name, values, area, publisher, userName, theme: currentPreviewTheme() });
  }, [device, frameReady, generation, document, name, area, publisher, userName]); // eslint-disable-line react-hooks/exhaustive-deps -- the answers follow `generation`, not every keystroke
  const focus = (blockId: string) => device === "mobile" ? post({ type: "hintek-form-preview-focus", blockId }) : focusPreviewBlock(window.document, blockId);

  return <div className="space-y-4" data-testid="form-preview">
    <div className="flex flex-wrap items-center gap-2">
      <Segmented label="Skärm" value={device} onChange={chooseDevice} options={[["desktop", "Dator", <Monitor key="d" />], ["mobile", "Mobil", <Smartphone key="m" />]]} />
      <Button type="button" variant="outline" className="h-8 px-2.5" onClick={() => load(sampleFormValues(document))}><Sparkles />Exempeldata</Button>
      <Button type="button" variant="outline" className="h-8 px-2.5" onClick={() => load(sampleFormValues(document, { deviations: true }))}><CircleAlert />Med avvikelser</Button>
      <Button type="button" variant="ghost" className="h-8 px-2.5" onClick={() => load(initialFormValues(document))}><Eraser />Töm</Button>
      <label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={showRequirements} onChange={(event) => setShowRequirements(event.target.checked)} />Visa krav för slutförande</label>
    </div>
    {/* A strip above the editor, not a column beside it, so the editor keeps the page's full width like the real task. */}
    {showRequirements ? <aside aria-label="Krav för slutförande" className="rounded-xl border bg-card px-4 py-3 text-sm">
      <p className="font-semibold">Krav för slutförande <span className="ml-1 text-xs font-normal text-muted-foreground">{completion.ready ? "Allt som krävs är ifyllt." : `${completion.issues.length} kvar · ${completion.percent} % klart`}</span></p>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {completion.requirements.length ? completion.requirements.map((item, index) => <li key={`${item.blockId}-${index}`}>
          <button type="button" className="flex items-center gap-1.5 rounded-md py-0.5 text-left text-xs hover:underline" onClick={() => focus(item.blockId)}>
            {item.met ? <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" /> : <CircleAlert className="size-3.5 shrink-0 text-amber-600" />}<span>{item.message}</span>
          </button>
        </li>) : <li className="text-xs text-muted-foreground">Formuläret har inga obligatoriska delar.</li>}
      </ul>
    </aside> : null}
    {device === "mobile"
      ? <div className="flex justify-center rounded-xl border bg-muted/30 p-3 sm:p-5">
        <div className={cn("w-[390px] max-w-full overflow-hidden rounded-[1.75rem] border-8 border-foreground/80 bg-background")}>
          <iframe ref={frame} title="Förhandsgranskning på mobil" src={FORM_PREVIEW_PATH} className="block h-[760px] w-full" data-testid="form-preview-frame" />
        </div>
      </div>
      : <div data-testid="form-preview-desktop">
        <WorkflowTaskEditor key={generation} kind="FORM" customers={PREVIEW_CUSTOMERS} projects={PREVIEW_PROJECTS} userName={userName} preview={{ document, name, values, area, publisher, onValuesChange: setValues }} />
      </div>}
    <p className="text-xs text-muted-foreground">Förhandsgranskningen sparar ingenting. Exempeldata, exempelkunden och exempelprojektet finns bara här.</p>
  </div>;
}
