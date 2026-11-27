"use client";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { Dialog } from "radix-ui";
import Link from "next/link";
import { X, Inbox, ChevronDown, ChevronUp, Loader2, Minus, Plus, ShieldOff, Trash2, type LucideIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { useFlowHint } from "@/features/workflow/flow-hint-store";
import { foldsTaskPanels, TaskPageFold, useAppForm, useDetailLevel, useNativeMode } from "@/features/workflow/use-detail-level";
import { useFoldMemory } from "@/features/workflow/use-fold-memory";
import { foldIsShut } from "@/lib/workflow/fold-memory";
import { DISCARD_QUESTION, useConfirm } from "./confirm";
import { returnToWork, stepBack, subscribeHistory, useBackClosesFirst } from "@/components/history-nav";
import { useScrollLock } from "@/components/scroll-lock";
import { useReturnTo } from "./use-return-to";
import { PageActionsReset, StandardPage, usePageActionsSlot } from "@/components/page-shell";
import { useRegisterEditorActions } from "@/components/workspace-actions";
import { useUnsavedGuard } from "@/lib/workflow/use-unsaved-guard";
import { NativeLeadPanel } from "@/components/native/screen";
import { AreaIcon, areaIconOf } from "@/components/area-icon";
import { panelAreaColor, type PanelArea } from "@/lib/workflow/panel-area";
import { NativeBar, NativeBarSlotProvider } from "@/components/native/top-bar";
import { deviceClass, type DeviceClass } from "@/lib/workflow/detail-level";
import { dialogPresentation, formPresentation, nativeDialogScreen, POPUP_MAX, shortActionLabel, type DialogSize, type FormPresentation } from "@/lib/workflow/dialog-mode";
import { leaveWithoutAsking, leavingWithoutAsking, registerLeaveGuard } from "@/lib/workflow/leave-guard";
import { onScreenKeyboardOpen } from "@/lib/workflow/keyboard";
import { useBrowserBackGuard } from "@/lib/workflow/use-back-guard";
import { SHOW_CHROME_EVENT } from "@/lib/workflow/shell-events";
import { stepQuantity } from "@/lib/workflow/quantity-step";
import { isTaskCancelled, TASK_CANCELLED_LABEL } from "@/lib/workflow/task-cancel";
import { foldShown, foldWishAfterClick } from "@/lib/workflow/fold-when-ready";
import { listenForTypedChange } from "@/lib/workflow/typed-change";
import { IconButton } from "@/components/ui/icon-button";
/** Whether a click landed on a control of its own inside `container` (a button, link, field or label), which keeps its own action. */
function isOwnControl(target: EventTarget, container: Element) {
  const control = target instanceof Element ? target.closest("button, a, input, select, textarea, label, summary, [role=button], [role=link], [role=checkbox], [role=switch], [role=menuitem], [contenteditable=true]") : null;
  return Boolean(control && control !== container && container.contains(control));
}
/** Whether the click ended a text selection (the person marked a word in the header to copy it), which never folds. */
function endsSelection() {
  return typeof window !== "undefined" && Boolean(window.getSelection()?.toString());
}

/**
 * The area (sidfunktion) the cards on a page belong to (UX-punkt 6, 2026-10-22): the workspace sets it per page;
 * a part of a page in another area may set its own. Every `Panel` under it colours its icon so.
 */
export const PanelAreaContext = createContext<PanelArea>("admin");
export function PanelAreaProvider({ area, children }: { area: PanelArea; children: React.ReactNode }) {
  return <PanelAreaContext.Provider value={area}>{children}</PanelAreaContext.Provider>;
}
/** The icon a card gets when it names none: its area's own (the same as the app's icon square of that type). */
export const panelAreaIcon = (area: PanelArea): LucideIcon => areaIconOf(area);

/**
 * The icon square beside a card's title: the shared `AreaIcon` in its solid tone (the icon standard, 2026-10-24: cards are
 * filled, lists soft), in the card's area colour (`--panel-tone`, set by `Panel`).
 */
export function PanelIcon({ icon, className }: { icon: LucideIcon; className?: string }) {
  return <AreaIcon icon={icon} tone="solid" className={cn("panel-icon", className)} />;
}

export function Panel({
  icon,
  area,
  title,
  description,
  children,
  actions,
  className,
  collapsible = false,
  defaultCollapsed = false,
  leadingActions,
  leadingIcon,
  persistentContent,
  headerClassName,
  openWhen = false,
  keepOpen = false,
  collapsed: controlledCollapsed,
  onCollapsedChange,
  opening = false,
  foldedContent,
  link = false,
  foldKey,
  count,
}: {
  /**
   * Remembers the person's fold on this device (2026-11-02, lib/workflow/fold-memory.ts): a short fixed name, the same
   * wherever this card is drawn, never a customer's or a person's name. An address that opens the card (`openWhen`) still wins.
   */
  foldKey?: string;
  /** The number of things in a list that folds (the fold rule, docs/design-standard.md): shown in the header beside the title. */
  count?: number;
  /**
   * The person asked to open the panel and its content is still being read (`useOpenWhenReady`, 2026-10-24:
   * "innehåll först när det är klart"): the panel stays folded, the arrow shows that it is busy, and it opens in one sweep
   * when the content is ready. A click while busy takes the wish back. Only with `collapsed`/`onCollapsedChange`.
   */
  opening?: boolean;
  /**
   * What a folded panel shows in place of its content (Projekt och uppgifter: the work in focus; open: the whole list).
   * The fold is then "a few or all" instead of "nothing or all"; the arrow and the header behave the same.
   */
  foldedContent?: React.ReactNode;
  /**
   * A card that only leads on, through one link (Ställ in Workflow, Värden och referenser): the whole card is that link.
   * The link carries `stretched-link` (the pattern of the app's tiles). A card with several ways keeps its buttons and
   * does not set this.
   */
  link?: boolean;
  /**
   * The icon left of the title (UX-punkt 6: every card has one). Without it the card shows its area's icon; null only
   * where the header is not a card's top. `leadingActions` (a place's level icon, a file's kind) still wins.
   */
  icon?: LucideIcon | null;
  /** The card's area when it is not the page's (`PanelAreaProvider`): the icon's colour. */
  area?: PanelArea;
  /** Variant (2026-10-16): the fold decided by the page – Anläggningar folds both of its panels with the tree panel's button. */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** On a task page at level 1–2: open like the current step's panel (a work view's choice, 2026-10-08; what you must see to work safely, 2026-11-02). */
  keepOpen?: boolean;
  /** A folded panel opens by itself when this becomes true (content read after the panel was drawn); it never folds by itself. */
  openWhen?: boolean;
  title: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  leadingActions?: React.ReactNode;
  /** An icon of the card's own in place of the area icon (Grunduppgifter: the form's chosen icon and colour); unlike `leadingActions` it holds no controls, so the arrow keeps its plain look. */
  leadingIcon?: React.ReactNode;
  persistentContent?: React.ReactNode;
  headerClassName?: string;
}) {
  // A panel asked for from the start (openWhen already true: Redigera or ?tab= in the address) starts open (2026-10-16).
  // null: nothing has happened on the page yet, so the person's remembered fold and then the card's own start decide.
  const [foldNow, setCollapsed] = useState<boolean | null>(openWhen ? false : null);
  const [foldsAtStart] = useState(defaultCollapsed);
  const foldMemory = useFoldMemory(foldKey);
  const folded = foldIsShut({ now: foldNow, remembered: foldMemory.remembered, start: foldsAtStart });
  const [openedByPerson, setOpenedByPerson] = useState(false);
  // Adjusted while rendering (not in an effect): the change from false to true opens the panel once.
  const [wasOpenWhen, setWasOpenWhen] = useState(openWhen);
  if (openWhen !== wasOpenWhen) {
    setWasOpenWhen(openWhen);
    if (openWhen) setCollapsed(false);
  }
  // On a task page at display level 1 or 2 only the panel of the current step starts open (2026-10-02, level 2 since
  // 2026-10-08). The job and safety are never in a folded panel: the task page shows them above the panels.
  const inTaskPage = useContext(TaskPageFold);
  const foldLow = foldsTaskPanels(useDetailLevel()) && inTaskPage && !keepOpen;
  // Only a collapsible panel can be folded: a panel that takes the place of a folded one in the same spot (a work
  // order opened from a control, 2026-10-02) must never inherit the fold and lose its content.
  // The progress line's current step, when it is done in this panel (2026-10-01).
  const flowHint = useFlowHint(title);
  // Levels 1–2: every panel but the current step's is folded until the person opens it.
  // A panel that has been the current step's stays open when the step moves on (QA 2026-10-10: the RCD panel folded
  // while its row was being filled in), so nothing folds under the person's fingers.
  const [wasCurrent, setWasCurrent] = useState(false);
  if (flowHint && !wasCurrent) setWasCurrent(true);
  // Also there a card the person opened before stays open (the fold memory); nothing else changes at levels 1–2.
  const collapsed = foldLow ? !flowHint && !openedByPerson && !wasCurrent && foldMemory.remembered !== false : collapsible && (controlledCollapsed ?? folded);
  const foldable = collapsible || foldLow;
  // A busy panel (opening) counts as asked for, so its click takes the wish back instead of asking twice.
  // Only the person's own click is remembered: a link that leads to something in the card (guideTo) opens it with a script's
  // click, which is not a choice and is not trusted.
  const toggleFold = (event?: { isTrusted?: boolean }) => {
    const byPerson = event?.isTrusted !== false;
    if (!foldLow && controlledCollapsed !== undefined) { onCollapsedChange?.(!foldWishAfterClick({ asked: !controlledCollapsed || opening, ready: !opening })); return; }
    if (!foldLow) { setCollapsed(!folded); if (byPerson) foldMemory.remember(!folded); return; }
    setOpenedByPerson(collapsed);
    if (!collapsed) setWasCurrent(false);
    if (byPerson) foldMemory.remember(!collapsed);
  };
  const contentId = useId();
  const headingId = useId();
  // The lead panel of a screen at level 1 on a phone (NativeLead): the top bar names the screen, so the heading is for
  // screen readers only and a header with nothing else to show is not drawn (2026-10-09: no double titles).
  const lead = useContext(NativeLeadPanel);
  const bareHeader = lead && !description && !actions && !leadingActions && !flowHint && !collapsible && !foldLow;
  // Korten ser likadana ut (UX-punkt 6): the icon in the area's colour – the page's area unless the card names its own.
  const pageArea = useContext(PanelAreaContext);
  const shownArea = area ?? pageArea;
  const leading = leadingActions ?? leadingIcon ?? (icon === null ? null : <PanelIcon icon={icon ?? panelAreaIcon(shownArea)} />);
  // Rubrikbandet på alla kort (2026-11-21 variant A, everywhere since 2026-11-22: "den grå toppen gör sidorna lättare
  // att navigera"): every card's title row – icon, title and the header's buttons – on the grey `--card-head` with a 1 px line
  // under it, the content on the card's white. One rule here, no page decides; only a header that is not drawn has none.
  const banded = !bareHeader;
  // Folded with nothing under the header: the header is the whole card.
  const shut = collapsed && !persistentContent && foldedContent === undefined;
  return (
    // The panel where the current step is done carries the step's marker (2026-10-01: "jag fattade inte att
    // dessa hörde ihop"): the same ring as the current dot on the progress line, and the step's number and name.
    <section aria-labelledby={headingId} aria-busy={opening || undefined} className={cn("app-panel rounded-lg border bg-card", flowHint && "border-primary/45 ring-4 ring-primary/10", link && "tap-card panel-link", className)} data-flow-current={flowHint ? "" : undefined}
      data-panel-area={shownArea} style={{ "--panel-tone": panelAreaColor(shownArea) } as CSSProperties}>
      {/* The header: the title (Manrope 15 px) and a grey 12 px description on the grey band with a line under it, on every
          card (2026-11-22; before, 2026-10-16, a white header without a line, and from 2026-11-21 the band on the
          settings pages only). A phone's native screen draws the header as its group title instead (app/globals.css).
          Hela kortet klickbart (2026-10-24, extends "a folded panel opens from its header" of 2026-10-16): a foldable
          panel opens AND folds from anywhere on its header – icon, title, description or arrow; buttons, links and fields in
          the header keep doing their own thing, and marking text to copy it never folds. The arrow is the keyboard's and
          the screen reader's way in (a button with aria-expanded and aria-controls); its focus ring is drawn round the
          whole header (app/globals.css, [data-panel-foldable]). */}
      <div
        className={cn("panel-header flex flex-wrap items-center justify-between gap-3 rounded-t-lg px-4 pb-3 pt-3.5", shut && "rounded-b-lg", banded && "card-head", banded && shut && "card-head-shut", foldable && "cursor-pointer", headerClassName, bareHeader && "sr-only")}
        data-native-lead={lead || undefined}
        data-panel-band={banded ? "" : undefined}
        data-panel-fold-header={collapsed ? "" : undefined}
        data-panel-foldable={foldable ? "" : undefined}
        onClick={foldable ? (event) => { if (!isOwnControl(event.target, event.currentTarget) && !endsSelection()) toggleFold(event); } : undefined}
      >
        {/* The heading takes the free room, so the buttons stay to the right of it and a long description wraps under the
            title instead of pushing them onto a row of their own (2026-10-13: "rätta överallt"). */}
        <div className="panel-heading flex min-w-0 flex-1 basis-56 items-center gap-3">
          {leading}
          <div className="min-w-0">
            <h2 id={headingId} className={cn("section-title", lead && "sr-only")}>{title}{count === undefined ? null : <span className="ml-1.5 font-normal tabular-nums text-muted-foreground" data-panel-count="">{count}</span>}</h2>
            {description && (
              <p className="mt-0.5 text-xs leading-[1.4] text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        </div>
        {flowHint ? <div className="panel-flow-hint flex min-w-0 flex-1 basis-72 items-start justify-end gap-2.5 text-right max-sm:justify-start max-sm:text-left" data-testid="flow-current" role="status">
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-primary">Nu: steg {flowHint.number} av {flowHint.total} · {flowHint.step}</span>
            <span className="block text-xs leading-5 text-muted-foreground">{flowHint.hint}</span>
          </span>
          {/* The same marker as the current dot on the line. */}
          <span aria-hidden="true" className="mt-1 block size-[11px] shrink-0 rounded-full border-2 border-primary bg-card ring-4 ring-primary/20 max-sm:order-first" />
        </div> : null}
        <div className="panel-actions flex shrink-0 flex-wrap items-center gap-2">
          {actions}
          {foldable && (
            // Visa/Dölj is not a form control (QA 2026-10-10): a locked page (a finished job's <fieldset disabled>) still
            // lets every panel be opened and read, so the toggle is a role="button" element the fieldset does not disable.
            <span
              role="button"
              tabIndex={0}
              data-slot="button"
              aria-label={persistentContent ? `${collapsed ? "Visa mer om" : "Visa mindre om"} ${title}` : `${collapsed ? "Visa" : "Dölj"} ${title}`}
              className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "panel-fold-toggle cursor-pointer", leadingActions && "measurement-collapse")}
              aria-expanded={!collapsed}
              aria-controls={contentId}
              aria-busy={opening || undefined}
              data-opening={opening ? "" : undefined}
              // The header's handler skips the arrow (isOwnControl), so a click on it folds once.
              onClick={toggleFold}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleFold(event); } }}
            >
              {/* One kind of fold everywhere (2026-10-22: "Pilen känns mer naturlig"): › folded, ⌄ open – also on a
                  panel with an icon, which had ⤢ before. */}
              {opening ? (
                // The content is on its way (useOpenWhenReady): the arrow waits; still with "mindre rörelse".
                <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
              ) : persistentContent ? (
                // With content that is always shown (Rapport och hantering's buttons) the panel is never folded away:
                // the toggle only shows or hides the note under the buttons, so it points down for more and up for
                // less instead of the folded arrow (plan 1A, 2026-10-11).
                collapsed ? <ChevronDown /> : <ChevronUp />
              ) : (
                <ChevronDown className={collapsed ? "-rotate-90" : ""} />
              )}
            </span>
          )}
        </div>
      </div>
      {persistentContent && (
        <div className={cn("panel-persistent-content px-4 pb-4", banded && "pt-4")}>{persistentContent}</div>
      )}
      {foldedContent !== undefined && collapsed ? <div className={cn("panel-content panel-folded-content px-4 pb-4", banded ? "pt-4" : "pt-0")}>{foldedContent}</div> : null}
      <div
        id={contentId}
        hidden={collapsed}
        className={cn("panel-content px-4 pb-4", persistentContent || bareHeader || banded ? "pt-4" : "pt-0", persistentContent && "border-t")}
      >
        {lead ? <NativeLeadPanel.Provider value={false}>{children}</NativeLeadPanel.Provider> : children}
      </div>
    </section>
  );
}
/**
 * Innehåll först när det är klart (2026-10-24): the state of a panel whose content is read when the person opens it
 * (Statistik). `ready` is true once there is something whole to show (the answer, or its error). Pass `collapsed`,
 * `onCollapsedChange` and `opening` to `Panel collapsible`; `asked` starts the reading. Rules: lib/workflow/fold-when-ready.ts.
 */
export function useOpenWhenReady(ready: boolean, foldKey?: string) {
  // With a key the person's fold is remembered (lib/workflow/fold-memory.ts): one they left open is read and opens by itself.
  const memory = useFoldMemory(foldKey);
  const [askedNow, setAsked] = useState<boolean | null>(null);
  const asked = askedNow ?? memory.remembered === false;
  const { open, opening } = foldShown({ asked, ready });
  return { asked, open, opening, collapsed: !open, onCollapsedChange: (collapsed: boolean) => { setAsked(!collapsed); memory.remember(collapsed); } };
}
/** True inside a form popup (Modal size="form"): FormPanel then draws its fields without a frame of its own. */
const FormPopupContext = createContext(false);
/** Whether the component is drawn in a form popup (Modal size="form"): a form may then leave out what only explains. */
export const useFormPopup = () => useContext(FormPopupContext);
/**
 * Fälten fritt (2026-10-14, Anläggningar som mappar): a form inside a list or a panel that is already its frame draws its
 * FormPanels bare, as in a popup – no box in a box.
 */
export function BareFormPanels({ children }: { children: React.ReactNode }) {
  return <FormPopupContext.Provider value={true}>{children}</FormPopupContext.Provider>;
}
/**
 * The fields of a form that opens as a temporary view (Modal size="view", docs/ui-system.md 4): framed as a panel like the
 * pages' forms (Ny kund, Ny arbetsorder) instead of bare on the view, so a form looks the same on a page and in a view
 * (2026-10-11: "Nytt projekt ser ut som ett nakent formulär"). The actions row (DialogActions) stays outside, as
 * the form's last row. On level 1 on a phone the screen is the native grouped list, so nothing is added there.
 */
export function FormPanel({ title, description, icon, children, className, testId }: { title: string; description?: string; /** The card's own icon (as Grunduppgifter's on Nytt inköp); the area's otherwise. */ icon?: LucideIcon; children: React.ReactNode; className?: string; testId?: string }) {
  const native = useNativeMode();
  // In a popup (Modal size="form") the box is the frame: its title is the dialog's, so the fields stand bare (plan 1Q).
  const popup = useContext(FormPopupContext);
  if (native) return <>{children}</>;
  if (popup) return <div className={cn("space-y-5", className)} data-testid={testId}>{children}</div>;
  return <Panel icon={icon} title={title} description={description} className={cn("form-panel", className)}><div className="space-y-5" data-testid={testId}>{children}</div></Panel>;
}
export function Field({
  label,
  value,
  onChange,
  type = "text",
  id,
  required = false,
  disabled = false,
  options,
  optionLabels,
  suggestions,
  className,
  hint,
  help,
  placeholder,
  autoComplete,
  multiline = false,
  code = false,
  rows,
  error,
}: {
  label: string;
  /** With `multiline`: the lines the field shows from the start, when the text is the form's main content (Nyheter's Text). */
  rows?: number;
  /**
   * The field's own problem in words, under it in red (never the browser's own bubble: the form has `noValidate` and checks itself,
   * as the other dialogs do). Marks the field invalid for a screen reader.
   */
  error?: string;
  /** A text of several lines (Anteckningar, Särskilda krav): the same label and help as every other field. */
  multiline?: boolean;
  /** With `multiline`: code or a file format (PLC-apparater, 2026-11-07) – monospace, taller, no spelling check. */
  code?: boolean;
  /** Small text beside the label, e.g. the chosen standard's limits (as in V1, 2026-10-05). */
  hint?: string;
  /** Help text under the field (2026-10-09: text above or under a field, never in front of it). */
  help?: React.ReactNode;
  placeholder?: string;
  autoComplete?: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  id: string;
  required?: boolean;
  disabled?: boolean;
  options?: string[];
  optionLabels?: Record<string, string>;
  suggestions?: string[];
  className?: string;
}) {
  const describedBy = [help ? `${id}-help` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    // content-start: in a row of fields where a neighbour is taller (help under it), the label and the field stay at the
    // top instead of the grid spreading the extra height between them (QA 2026-10-10: Kundtyp and Namn 7 px apart).
    <div className={cn("grid min-w-0 content-start gap-1.5", className)}>
      <Label htmlFor={id} className="field-label flex-wrap text-xs font-medium">
        {label}
        {hint ? <span className="ml-1.5 font-normal text-muted-foreground [overflow-wrap:normal]">{hint}</span> : null}
      </Label>
      {options ? (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-describedby={describedBy} aria-invalid={error ? true : undefined}
          className="form-select"
        >
          {!options.includes(String(value)) && (
            <option value={String(value)}>
              {optionLabels?.[String(value)] || value || "Välj…"}
            </option>
          )}
          {options.map((v) => (
            <option key={v} value={v}>
              {optionLabels?.[v] || v}
            </option>
          ))}
        </select>
      ) : multiline ? (
        <textarea id={id} className={cn("form-textarea", code && "h-64 resize-y overflow-auto font-mono text-xs leading-5")} spellCheck={code ? false : undefined} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder={placeholder}
          aria-describedby={describedBy} aria-invalid={error ? true : undefined} />
      ) : (
        <Input
          id={id}
          type={type}
          step={type === "number" ? "any" : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-describedby={describedBy} aria-invalid={error ? true : undefined}
          className="bg-card"
          list={suggestions?.length ? `${id}-suggestions` : undefined}
        />
      )}
      {help ? <p id={`${id}-help`} className="text-xs leading-5 font-normal text-muted-foreground">{help}</p> : null}
      {error ? <p id={`${id}-error`} className="text-xs leading-5 font-normal text-destructive" data-testid={`${id}-error`}>{error}</p> : null}
      {suggestions?.length ? (
        <datalist id={`${id}-suggestions`}>
          {suggestions.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      ) : null}
    </div>
  );
}
/**
 * A tick box with its text beside it and an optional explanation under (2026-10-09: "texten ligger framför
 * fältet … jag föredrar att texten är över eller under fältet"). It always stands on its own row – never in a row of
 * fields or buttons; fields with their labels above go in the rows after it, the buttons in a row of their own.
 */
export function CheckField({ id, label, description, checked, onChange, disabled = false, testId, className }: {
  id: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  testId?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-start gap-3 text-sm", className)}>
      <Checkbox id={id} className="mt-0.5" checked={checked} disabled={disabled} onCheckedChange={(value) => onChange(value === true)}
        aria-describedby={description ? `${id}-help` : undefined} data-testid={testId} />
      <div className="grid min-w-0 gap-0.5">
        <Label htmlFor={id} className="leading-5 font-medium">{label}</Label>
        {description ? <p id={`${id}-help`} className="leading-5 text-muted-foreground">{description}</p> : null}
      </div>
    </div>
  );
}

/** Phone width (Tailwind's sm breakpoint): below it a dialog that is shown as a view fills the visible area exactly. */
const PHONE_QUERY = "(max-width: 639px)";

/** A touch screen or a narrow window: where the keyboard rules for dialogs apply, and where the bottom bar is. */
const COMPACT_QUERY = "(max-width: 1023px)";

export { onScreenKeyboardOpen };

export type VisibleArea = { height: number; top: number; bottom: number; keyboard: boolean; phone: boolean };

/**
 * The part of the screen a person actually sees on a phone or tablet. iOS does not shrink the page for the keyboard, it
 * only moves and shortens the visual viewport, so a fixed dialog has to follow it (2026-10-09: the dialogs moved
 * about while typing on an iPhone). Events are gathered once per frame and state changes only when a value changes, so
 * the keyboard's animation does not redraw the dialog dozens of times. Null on a computer.
 */
export function useVisibleArea(open: boolean): VisibleArea | null {
  const [area, setArea] = useState<VisibleArea | null>(null);
  useEffect(() => {
    if (!open) return;
    const compact = window.matchMedia(COMPACT_QUERY);
    const phone = window.matchMedia(PHONE_QUERY);
    let frame = 0;
    const read = () => {
      frame = 0;
      if (!compact.matches) { setArea(null); return; }
      const visual = window.visualViewport;
      const height = Math.round(visual?.height ?? window.innerHeight);
      const top = Math.max(0, Math.round(visual?.offsetTop ?? 0));
      const next: VisibleArea = { height, top, bottom: Math.max(0, window.innerHeight - top - height), keyboard: onScreenKeyboardOpen(), phone: phone.matches };
      setArea((prev) => (prev && prev.height === next.height && prev.top === next.top && prev.bottom === next.bottom && prev.keyboard === next.keyboard && prev.phone === next.phone ? prev : next));
    };
    const update = () => { if (!frame) frame = window.requestAnimationFrame(read); };
    read();
    const visual = window.visualViewport;
    visual?.addEventListener("resize", update);
    visual?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    compact.addEventListener("change", update);
    phone.addEventListener("change", update);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      visual?.removeEventListener("resize", update);
      visual?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      compact.removeEventListener("change", update);
      phone.removeEventListener("change", update);
    };
  }, [open]);
  return open ? area : null;
}

/**
 * Keeps a mobile dialog within the area not covered by the on-screen keyboard. `place` says how a box sits while the
 * keyboard is up: "center" (an ordinary dialog, centred in what is visible), "bottom" (a panel from below rests on the
 * keyboard instead of behind it) or "top" (stays where it is). With `fill` (a dialog shown as a view or a page on a
 * phone or tablet) it takes exactly the visible area, so the header and the field being typed in stay in view.
 */
export function useMobileDialogViewport(open: boolean, place: DialogPlace = "center", fill = false): CSSProperties | undefined {
  return dialogViewportStyle(useVisibleArea(open), place, fill);
}

export type DialogPlace = "center" | "bottom" | "top";

/** `ceiling`: a box never higher than the popup ceiling (POPUP_MAX, displays 2 and 3); level 1 keeps its own rule. */
export function dialogViewportStyle(area: VisibleArea | null, place: DialogPlace, fill: boolean, ceiling = false): CSSProperties | undefined {
  if (!area) return undefined;
  // The editors' tool sheet (place "bottom") becomes a page only on a phone; a view fills phone and tablet alike.
  if (fill && (area.phone || place !== "bottom")) return { top: `${area.top}px`, height: `${area.height}px`, maxHeight: `${area.height}px` };
  // A panel from below keeps its own height cap (80–85 %) until the keyboard takes part of the screen.
  if (place === "bottom") return area.keyboard ? { bottom: `${area.bottom}px`, maxHeight: `${Math.max(160, area.height - 12)}px` } : undefined;
  // Never higher than the ceiling (POPUP_MAX: 85 % of the window, as Nytt projekt), less when the keyboard takes room.
  const style: CSSProperties = { maxHeight: `${Math.max(160, ceiling ? Math.min(area.height - 24, Math.round(window.innerHeight * POPUP_MAX.heightShare)) : area.height - 24)}px` };
  if (area.keyboard && place === "center") style.top = `${area.top + area.height / 2}px`;
  return style;
}

/** A view at level 1 on a phone ends above the tab bar (it gives way to the keyboard like the bottom bar). */
function nativeViewStyle(area: VisibleArea | null): CSSProperties | undefined {
  if (!area) return undefined;
  const bar = area.keyboard ? 0 : document.querySelector(".native-tab-bar")?.getBoundingClientRect().height ?? 0;
  const height = Math.max(160, area.height - bar);
  return { top: `${area.top}px`, bottom: "auto", height: `${height}px`, maxHeight: `${height}px` };
}

/**
 * When the keyboard comes up or the visible area changes, the field being typed in is scrolled into view inside the
 * dialog's own scrolling body (never the page behind it), with a little room above and below.
 */
export function useKeepFocusedFieldVisible(scroller: HTMLElement | null, area: VisibleArea | null) {
  useEffect(() => {
    if (!scroller || !area?.keyboard) return;
    const frame = window.requestAnimationFrame(() => {
      const field = document.activeElement;
      if (!(field instanceof HTMLElement) || !scroller.contains(field)) return;
      const box = scroller.getBoundingClientRect();
      const rect = field.getBoundingClientRect();
      const room = 16;
      if (rect.bottom > box.bottom - room) scroller.scrollTop += rect.bottom - box.bottom + room;
      else if (rect.top < box.top + room) scroller.scrollTop -= box.top + room - rect.top;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scroller, area]);
}

/**
 * On a phone or tablet a dialog does not put the cursor in its first field when it opens: iOS would open the keyboard at
 * once, cover half the dialog and move it before the person has read it (2026-10-09). The dialog itself takes the focus
 * (screen readers still start inside it); a tap in a field opens the keyboard as usual. Radix's `onOpenAutoFocus`.
 */
export function focusDialogNotFieldOnTouch(event: Event) {
  if (typeof window === "undefined" || !window.matchMedia(`(pointer: coarse), ${COMPACT_QUERY}`).matches) return;
  event.preventDefault();
  const target = event.currentTarget ?? event.target;
  if (target instanceof HTMLElement) target.focus({ preventScroll: true });
}

export type { DialogSize } from "@/lib/workflow/dialog-mode";

/**
 * Decides how an open dialog is shown (lib/workflow/dialog-mode.ts, 2026-10-09): a small dialog, or a temporary
 * view inside the page when its content is larger than the benchmark on a phone or tablet (or always, for `size="view"`).
 * `scrollRef` goes on the element that scrolls and `contentRef` on the content inside it. Once a view, it stays one
 * until it closes, so it never jumps back and forth while someone types; the keyboard never turns a box into a view.
 */
export function useDialogPage(open: boolean, size: DialogSize = "auto") {
  // Only level 1 on a phone may grow a dialog into a screen (plan 1O, 2026-10-11); everywhere else it stays a box.
  const native = useNativeMode();
  const [scroller, scrollRef] = useState<HTMLElement | null>(null);
  const [content, contentRef] = useState<HTMLElement | null>(null);
  const [grown, setGrown] = useState(false);
  // Adjusted while rendering (not in an effect): a closed dialog starts over as a box the next time.
  if (!open && grown) setGrown(false);
  useEffect(() => {
    if (!open || size !== "auto" || !scroller || typeof ResizeObserver === "undefined") return;
    const check = () => {
      const device = deviceClass(window.innerWidth, window.matchMedia("(pointer: coarse)").matches, window.innerHeight);
      // The content's own height, plus the room the scroll area cut off when it already scrolls.
      const contentHeight = Math.max(content?.scrollHeight ?? 0, scroller.scrollHeight);
      if (dialogPresentation({ size, device, contentHeight, keyboard: onScreenKeyboardOpen(), native }) === "view") setGrown(true);
    };
    const observer = new ResizeObserver(check);
    observer.observe(scroller);
    if (content) observer.observe(content);
    check();
    window.addEventListener("resize", check);
    return () => { observer.disconnect(); window.removeEventListener("resize", check); };
  }, [open, size, scroller, content, native]);
  const [device, setDevice] = useState<DeviceClass>("desktop");
  useEffect(() => {
    if (!open) return;
    const read = () => setDevice(deviceClass(window.innerWidth, window.matchMedia("(pointer: coarse)").matches, window.innerHeight));
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, [open]);
  const view = open && dialogPresentation({ size, device, wasView: grown, native }) === "view";
  // "page" is kept as the attribute value for the editors' tool sheet, whose CSS shows a page on a phone.
  return { page: view, view, scroller, scrollRef, contentRef, mode: view ? "view" : size === "compact" ? "compact" : "box" } as const;
}

/** A dialog's actions (Avbryt and its primary action), so a view can offer them in the bottom bar instead of twice. */
type DialogActionsRegistration = { primary?: { label: string; disabled?: boolean; busy?: boolean; busyLabel?: string; run: () => void } | null; cancel?: { label: string; run: () => void } | null };
const ModalActionsContext = createContext<((actions: DialogActionsRegistration | null) => void) | null>(null);
/**
 * Whether the component is drawn inside an open temporary view (a project, round or quote form). A field that opens its
 * own chooser (Välj plats) reads it and opens a small dialog instead of a second view over the first (docs/ui-system.md
 * 4: never a large view from a large view; plan 1A, 2026-10-11).
 */
const InsideViewContext = createContext(false);
/**
 * Avbryt asks whenever something is changed (2026-10-13): the dialog or page around the buttons answers whether
 * its content may be thrown away (true when nothing changed, otherwise the person's answer to "Kasta ändringarna?").
 */
export const DiscardContext = createContext<(() => Promise<boolean>) | null>(null);
export const useInsideView = () => useContext(InsideViewContext);

/**
 * The row of actions at the foot of a dialog: optional extra buttons, Avbryt and the primary action. In a temporary view
 * on a phone or tablet the same actions are in the bottom bar and this row is hidden (it comes back while the keyboard
 * is up, since the bar then gives way). Avbryt ends the editing without saving; when something is changed it asks first
 * ("Kasta ändringarna?", 2026-10-13) through the DiscardContext of the view or page around it.
 */
export function DialogActions({ cancel, primary, children, className }: {
  cancel?: { label?: string; onClick: () => void } | null;
  primary?: { label: string; onClick?: () => void; disabled?: boolean; busy?: boolean; busyLabel?: string; type?: "button" | "submit"; form?: string; testId?: string; variant?: "default" | "destructive";
    /** An icon before the label (as the button had before it moved into the shared row). */
    icon?: React.ReactNode;
    /** Why the action cannot be used yet (Button disabledReason): it looks inactive, a tap shows the reason as a toast;
        the bottom bar and the level-1 top bar show it inactive and their tap gives the same toast. */
    disabledReason?: string | null; describedBy?: string } | null;
  children?: React.ReactNode;
  className?: string;
}) {
  const register = useContext(ModalActionsContext);
  const mayDiscard = useContext(DiscardContext);
  const runCancel = async () => {
    if (!cancel) return;
    if (mayDiscard && !(await mayDiscard())) return;
    leaveWithoutAsking();
    cancel.onClick();
  };
  // On a page with the standard top (StandardPage) the buttons stand in the header, top right: Avbryt, then the main action.
  const page = usePageActionsSlot();
  // A submit button moved out of its form keeps submitting it through the form attribute (the form gets an id if it has none).
  const markerRef = useRef<HTMLSpanElement | null>(null);
  const generatedId = useId();
  const [enclosingForm, setEnclosingForm] = useState<string | undefined>();
  useEffect(() => {
    if (!page) return;
    const form = markerRef.current?.closest("form");
    if (!form) return;
    if (!form.id) form.id = `form-${generatedId.replace(/:/g, "")}`;
    setEnclosingForm(form.id);
  }, [page, generatedId]);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const primaryLabel = primary?.label ?? "";
  const primaryDisabled = Boolean(primary?.disabled);
  const primaryBlocked = Boolean(primary?.disabledReason);
  const primaryBusy = Boolean(primary?.busy);
  const hasPrimary = Boolean(primary);
  const cancelLabel = cancel ? cancel.label ?? "Avbryt" : "";
  const busyLabel = primary?.busyLabel;
  useEffect(() => {
    if (!register) return;
    register({
      primary: hasPrimary ? { label: primaryLabel, disabled: primaryDisabled || primaryBlocked, busy: primaryBusy, busyLabel, run: () => primaryRef.current?.click() } : null,
      cancel: cancelLabel ? { label: cancelLabel, run: () => cancelRef.current?.click() } : null,
    });
    return () => register(null);
  }, [register, hasPrimary, primaryLabel, primaryDisabled, primaryBlocked, primaryBusy, busyLabel, cancelLabel]);
  const buttons = <>
    {children}
    {cancel ? <Button ref={cancelRef} type="button" variant="outline" onClick={() => void runCancel()} data-dialog-role="cancel">{cancelLabel}</Button> : null}
    {primary ? <Button ref={primaryRef} data-dialog-role="primary" type={primary.type ?? "button"} form={primary.form ?? (page && primary.type === "submit" ? enclosingForm : undefined)} variant={primary.variant ?? "default"} disabled={primaryDisabled || primaryBusy} disabledReason={primary.disabledReason} aria-describedby={primary.describedBy} onClick={primary.onClick} data-testid={primary.testId}>{primary.icon}{primaryBusy && primary.busyLabel ? primary.busyLabel : primaryLabel}</Button> : null}
  </>;
  // The header's slot is there after the first render; until then nothing is drawn, so the row never flashes below.
  if (page) return <><span ref={markerRef} hidden />{page.slot ? createPortal(<div className="dialog-actions contents" data-in-header="" data-testid="dialog-actions">{buttons}</div>, page.slot) : null}</>;
  return <div className={cn("dialog-actions flex flex-wrap justify-end gap-2", className)} data-registered={register ? "" : undefined} data-testid="dialog-actions">{buttons}</div>;
}

/**
 * The shared dialog: short questions, confirmations and simple choices are a small dialog on every device. Larger
 * editing is a page (FormPage) – there is no large temporary view any more (2026-10-11, plan 1O). Level 1 on a
 * phone is the one place with its own look: every dialog but a compact one is a screen with Avbryt and its action in the
 * top bar (docs/ui-system.md 9). A changed screen (or a large dialog, size="view") asks before it is closed any other
 * way than with Avbryt.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  children,
  className,
  size = "auto",
  place = "center",
  nativeScreen,
  nativeBack,
  closeButton = true,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  children: React.ReactNode;
  className?: string;
  /** Level 1, a screen without an action of its own: the top bar's "‹ <nativeBack>" closes it, instead of the round × (M1, 2026-10-12). */
  nativeBack?: string;
  /** "form" is the popup box of plan 1Q (about 520 px, buttons fixed at the foot; callers choose it through FormPage/DialogPage, which follow the display), "compact" is always a small dialog, "view" a screen at level 1. */
  size?: DialogSize;
  /** Where a small dialog stays while the keyboard is up: centred, or at the top (Sök). */
  place?: DialogPlace;
  /**
   * Nivå 1 på mobil: every dialog but a compact one is a screen of its own with Avbryt and its action in the top bar;
   * true makes a compact dialog a screen too (a form, e.g. Ändra tidplan), false keeps a larger one a box.
   */
  nativeScreen?: boolean;
  /** false: no × in the corner, for a box whose only button already closes it (Anpassa menyn, 2026-10-22). */
  closeButton?: boolean;
}) {
  const page = useDialogPage(open, size);
  const { scroller, scrollRef, contentRef } = page;
  // Nivå 1 på mobil (2026-10-10): a dialog with fields is a screen with Avbryt/<action> in the top bar.
  // Display level 1 (the app look) keeps its own rules for boxes; the popup ceiling applies to displays 2 and 3.
  const nativeLook = useNativeMode();
  // Surfplattans appvy (appkänslan, beslutad 2026-11-23): a tablet has room, so a dialog there stays a box in the middle of the
  // screen instead of becoming a screen; the pane beside a list is a phone-wide window and keeps the screen.
  const tabletApp = useAppForm() === "tablet";
  const native = nativeDialogScreen({ native: nativeLook && !tabletApp, size, nativeScreen }) && open;
  // A screen only at level 1 on a phone; everywhere else a dialog, however large (plan 1O: large forms are FormPage).
  const view = native;
  // A large dialog that edits something still asks before it is closed any other way than with Avbryt.
  const guarded = native || size === "view" || size === "form";
  const mode = native ? "view" : page.mode;
  const area = useVisibleArea(open);
  useKeepFocusedFieldVisible(scroller, area);
  const [confirm, confirmElement] = useConfirm();
  const [actions, setActions] = useState<DialogActionsRegistration | null>(null);
  const [dirty, setDirty] = useState(false);
  if (!open && dirty) setDirty(false);
  // Nivå 1 på mobil (2026-10-09 evening, 2026-10-10): a view ends above the tab bar, which stays as it is; its top
  // bar has Avbryt (never asks) and the view's action, or Stäng; a tap on a tab closes it (asking first when changed).
  // The page the view lies over; left out when it only repeats the view's own title (Nytt projekt over Nytt projekt),
  // and at level 1 on a phone, where Stäng is the way out.
  // Changed = something was typed or chosen inside the view since it opened.
  const [body, bodyRef] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!open || !body) return;
    // Deferred like the form page's: a re-render inside the first input event can swallow what was typed.
    return listenForTypedChange(body, () => setDirty(true));
  }, [open, body]);
  // Only a view with something to save (its own primary action) asks: a calculator or a read-only view closes at once.
  const savable = Boolean(actions?.primary);
  const latest = useRef({ guarded, dirty, title, onOpenChange, savable });
  useEffect(() => { latest.current = { guarded, dirty, title, onOpenChange, savable }; });
  /** Stäng, Escape, Hem, Sök: a changed view asks first; Avbryt never does. */
  const requestClose = useCallback(async () => {
    const now = latest.current;
    if (now.guarded && now.dirty && now.savable && !(await confirm({ title: `Stäng ${now.title.toLocaleLowerCase("sv")}?`, message: "Det du har ändrat här sparas inte.", confirmLabel: "Stäng utan att spara", cancelLabel: "Fortsätt redigera", tone: "danger" }))) return false;
    now.onOpenChange(false);
    return true;
  }, [confirm]);
  // A view belongs to the page under it: when the person goes to another page it closes.
  useEffect(() => {
    if (!open || !guarded) return;
    const opened = `${location.pathname}${location.search}`;
    return subscribeHistory((event) => { if (event.kind !== "replace" && event.url !== opened) latest.current.onOpenChange(false); });
  }, [open, guarded]);
  // The bar's leave guard: Hem, a breadcrumb or a back step while a changed view is open asks the same question.
  useEffect(() => {
    if (!open || !guarded || !dirty) return;
    return registerLeaveGuard(requestClose);
  }, [open, guarded, dirty, requestClose]);
  // Bakåt closes the screen before it steps back a page, like the Ny and Mer sheets; the tab bar comes back if it had
  // slid away with the page's scrolling, so the screen never ends above an empty strip.
  const closeFirst = useCallback(() => { void requestClose(); }, [requestClose]);
  useBackClosesFirst(native ? closeFirst : null);
  // A screen at level 1 is not modal (the tab bar stays usable), so Radix does not lock the page: the shared lock does (2026-11-22).
  useScrollLock(native);
  // The screen's own bar's free right side, offered to what it holds (an editor's ⋯; NativeBarSlotProvider below).
  const [barSlot, setBarSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { if (native) window.dispatchEvent(new Event(SHOW_CHROME_EVENT)); }, [native]);
  // Avbryt asks whenever something is changed (2026-10-13, replaces "Avbryt never asks"): Kasta or Fortsätt redigera.
  const mayDiscard = useCallback(async () => {
    const now = latest.current;
    return !(now.dirty && now.savable) || confirm(DISCARD_QUESTION);
  }, [confirm]);
  // The form's own Avbryt (DialogActions) asks through DiscardContext; without one the screen asks here.
  const cancelNow = async () => {
    if (actions?.cancel) { actions.cancel.run(); return; }
    if (!(await mayDiscard())) return;
    leaveWithoutAsking();
    onOpenChange(false);
  };
  // The browser's and the phone's own Bakåt close a screen first, as the top bar's does, and ask when it is changed
  // (2026-10-13: the screen closed and the page under it went back as well).
  useBrowserBackGuard(native, {
    page: false,
    ask: mayDiscard,
    onLeave: () => latest.current.onOpenChange(false),
    // Avbryt (after its own question) or the screen's action stepping back itself: the step goes on, no second question.
    skip: leavingWithoutAsking,
  });
  return (
    <Dialog.Root open={open} modal={!native} onOpenChange={(next) => { if (next) onOpenChange(true); else if (guarded) void requestClose(); else onOpenChange(false); }}>
      <Dialog.Portal>
        <Dialog.Overlay data-dialog-overlay="" className={cn("fixed inset-0 z-40 bg-slate-950/30", native && "workspace-view-overlay")} />
        <Dialog.Content style={native ? nativeViewStyle(area) : dialogViewportStyle(area, place, false, !nativeLook)} data-modal={mode} data-modal-size={size === "form" ? "form" : undefined} data-native-view={native || undefined}
          onInteractOutside={(event) => {
            // Only a click on the dimmed page closes a dialog (2026-11-01): what lies above it – the workspace's toast
            // (Ångra after a removed row, 2026-10-11), a password manager's list and the focus it takes – never does.
            if (!native && !(event.target instanceof Element && event.target.closest("[data-dialog-overlay]"))) { event.preventDefault(); return; }
            if (native && !(event.target instanceof Element && event.target.closest(".native-tab-bar"))) event.preventDefault();
          }} data-keyboard={area?.keyboard || undefined} onOpenAutoFocus={focusDialogNotFieldOnTouch}
          // Popupstorlek (2026-10-13): no popup is wider or higher than Nytt projekt (POPUP_MAX, lib/workflow/dialog-mode.ts):
          // the width is capped here, so a caller's class can make a box narrower but never wider; larger content is a page.
          className={cn("workspace-modal fixed left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border bg-card p-5 shadow-xl",
            nativeLook ? cn("w-[calc(100%-2rem)]", size === "form" ? "max-h-[85dvh] max-w-[32.5rem]" : "max-h-[90dvh] max-w-xl") : "w-[min(calc(100%-2rem),32.5rem)] max-h-[85dvh] max-w-[32.5rem]", className)}>
          {/* A box has Stäng in its corner; a screen at level 1 has the top bar with Avbryt and its action. */}
          {native ? <>
            <NativeBar testId="native-view" className="workspace-modal-header shrink-0"
              heading={<Dialog.Title className="native-top-bar-title" data-testid="native-view-title">{title}</Dialog.Title>}
              left={actions?.primary ? { label: actions.cancel?.label ?? "Avbryt", ariaLabel: "Avbryt utan att spara", onClick: () => void cancelNow() }
                : nativeBack ? { label: nativeBack, ariaLabel: `Tillbaka till ${nativeBack}`, onClick: () => { if (actions?.cancel) actions.cancel.run(); else void requestClose(); } } : null}
              leftKind={!actions?.primary && nativeBack ? "back" : "cancel"}
              // Without an action of its own the screen closes with the same round × as the Ny and Mer sheets (lead, 2026-10-10).
              // The bar's free right side is offered to what the screen holds (an editor's ⋯, NativeBarSlotProvider, 2026-11-18).
              end={actions?.primary || nativeBack ? undefined : <span className="native-top-bar-end"><span ref={setBarSlot} className="native-top-bar-end native-top-bar-slot" data-testid="native-view-slot" />
                <button type="button" className="native-sheet-close" aria-label="Stäng" data-testid="native-view-close"
                  onClick={() => { if (actions?.cancel) actions.cancel.run(); else void requestClose(); }}><X aria-hidden="true" /></button></span>}
              slotRef={setBarSlot}
              right={actions?.primary ? { label: shortActionLabel(actions.primary.label), ariaLabel: actions.primary.label, strong: true, onClick: () => { leaveWithoutAsking(); actions.primary?.run(); },
                busy: actions.primary.busy, busyLabel: actions.primary.busyLabel ? shortActionLabel(actions.primary.busyLabel) : undefined, disabled: actions.primary.disabled } : null} />
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
          </> : <div className="workspace-modal-header relative shrink-0 pr-8">
            <div className="min-w-0">
              <Dialog.Title className="section-title">{title}</Dialog.Title>
            </div>
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
            {closeButton ? <Dialog.Close asChild>
              <IconButton label="Stäng" className="workspace-modal-close absolute -right-3 -top-3">
                <X />
              </IconButton>
            </Dialog.Close> : null}
          </div>}
          {/* pb-1 -mb-1: room for a pressed button (active:translate-y-px) at the bottom, so holding Avbryt never shows a scroll bar (2026-10-30). */}
          <div ref={(element) => { scrollRef(element); bodyRef(element); }} className={cn("workspace-modal-body mt-4 -mb-1 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-px pb-1", native && "native-screen")}>
            <div ref={contentRef} className="workspace-modal-content">
              <PageActionsReset><DiscardContext.Provider value={mayDiscard}><ModalActionsContext.Provider value={setActions}><InsideViewContext.Provider value={view}><FormPopupContext.Provider value={size === "form" && !native}>
                {/* Inside a dialog the page's bar is never offered: only this screen's own (or none, as a box). */}
                <NativeBarSlotProvider el={native ? barSlot : null}>{children}</NativeBarSlotProvider>
              </FormPopupContext.Provider></InsideViewContext.Provider></ModalActionsContext.Provider></DiscardContext.Provider></PageActionsReset>
            </div>
          </div>
          {confirmElement}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}


/**
 * How a form is drawn on this device (plan 1Q, 2026-10-11; lib/workflow/dialog-mode.ts `formPresentation`): the
 * form's `size` and the person's display level decide – a popup, a page of its own or (level 1) a screen. FormPage and
 * DialogPage both follow it, so a callsite only gives its `size`.
 */
export function useFormPresentation(size: DialogSize): FormPresentation {
  const level = useDetailLevel();
  const native = useNativeMode();
  const width = useSyncExternalStore(subscribeWidth, readWidth, () => 1440);
  // Level 1 is the app look (native); a level-1 window that is not the phone's own is drawn like level 2.
  return formPresentation({ level: native ? 1 : level === 1 ? 2 : level, width, size });
}
function subscribeWidth(listener: () => void) {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
}
const readWidth = () => window.innerWidth;

/** What a FormPage hands its form: the two ways out. Both leave without the unsaved-changes question. */
export type FormPageControls = {
  /** Avbryt: exactly one step back (samband, 2026-10-26), or `back` when the form was opened directly. The form's
      own Avbryt (DialogActions) has asked first when something was changed. */
  cancel: () => void;
  /** After a save: back to the page that opened it as a sub-page (`returnTo`), else to `href` (the new record, the list) in
      place of the form, so Bakåt never lands on the filled-in form again; without `href` the same place as Avbryt. */
  done: (href?: string) => void;
};

/** One way out of every form page (samband, 2026-10-26): Avbryt one step back, Spara back to where it was asked for. */
function useFormWay(back: string, close?: () => void): FormPageControls {
  const router = useRouter();
  const way = useReturnTo();
  return {
    cancel: () => { close?.(); if (way) way.cancel(); else stepBack(back, router.push); },
    done: (href) => {
      close?.();
      if (way) way.done();
      else if (href) returnToWork(href, (to) => router.replace(to));
      else stepBack(back, router.push);
    },
  };
}

/**
 * Formulär som popup eller sida (2026-10-11, plan 1O + 1Q, docs/ui-system.md 4): a form has an address of its own
 * (`/?view=new_project`, `…&edit=1`) and the person's display decides how it is drawn, from its `size` alone:
 * - `size="form"` (fits the size of "Lägg till instrument", about 520 x 480 px): a popup over `behind` on display 3 from
 *   768 px, a page on display 2 (and on a narrow phone);
 * - `size="page"` (default, anything larger): a page with the standard top on displays 2 and 3;
 * - display level 1 on a phone: a screen over `behind` (the shared Modal, top bar with Avbryt and the action).
 * The page is drawn by StandardPage (components/page-shell.tsx): overrubrik and H1 on the left, status and facts under,
 * the form's own DialogActions moved into the header's action group top right (Avbryt, then Spara/Skapa), one page width.
 * On a phone and tablet the shell's bottom bar has Spara (it presses the form's own main button, so its checks hold). An
 * untouched page is never "changed": only a person's own typing or choosing counts, and a changed form asks before any
 * other way out (Hem, a link, Bakåt) like the editors do.
 *
 * The page that owns the address gives the breadcrumbs their names (usePageTrail) and the trail follows the address
 * (lib/workflow/navigation.ts). Use it as the early return of the page that owns the address and pass the ordinary page
 * as `behind` (the popup and level 1's screen are drawn over it):
 *
 *   if (editing) return <FormPage title="Redigera projekt" size="form" back={projectHref} behind={page}>
 *     {(form) => <ProjectForm onCancel={form.cancel} onSave={async (input) => { await save(input); form.done(projectHref); }} />}
 *   </FormPage>;
 *
 * `open={false}` draws `behind` alone, so the same element can stay in the tree. Without `behind` a popup or a screen is
 * drawn over an empty page: give it one.
 */
export function FormPage({ open = true, size = "page", title, description, back, behind, testId, meta, actions, children }: {
  open?: boolean;
  /** "form" when the form fits a popup (see above); "page" (default) when it is larger. */
  size?: DialogSize;
  title: string;
  description?: React.ReactNode;
  /** Where Avbryt leads when the page was opened from nowhere known (a direct link): the page above in the trail. */
  back: string;
  /** The ordinary page the form belongs to; the popup and level 1's screen are drawn over it. */
  behind?: React.ReactNode;
  testId?: string;
  /** Status badges and facts under the title (standard top). */
  meta?: React.ReactNode;
  /** Other action buttons in the header, left of Avbryt and the main action. */
  actions?: React.ReactNode;
  children: React.ReactNode | ((form: FormPageControls) => React.ReactNode);
}) {
  const presentation = useFormPresentation(size);
  if (!open) return <>{behind ?? null}</>;
  if (presentation === "screen") return <FormPageScreen title={title} description={description} back={back} behind={behind}>{children}</FormPageScreen>;
  if (presentation === "popup") return <FormPagePopup title={title} back={back} behind={behind} testId={testId}>{children}</FormPagePopup>;
  return <FormPageBody title={title} description={description} back={back} testId={testId} meta={meta} actions={actions}>{children}</FormPageBody>;
}

type FormChildren = React.ReactNode | ((form: FormPageControls) => React.ReactNode);

function FormPageScreen({ title, description, back, behind, children }: { title: string; description?: React.ReactNode; back: string; behind?: React.ReactNode; children: FormChildren }) {
  // After Skapa/Spara the form's address is replaced by the record's (2026-10-13): Bakåt from the new project never lands
  // on the filled-in form again (useFormWay).
  const controls = useFormWay(back);
  // Level 1 keeps its screen: the shared Modal draws the top bar with Avbryt and the form's action.
  return <>{behind ?? null}<Modal size="view" open onOpenChange={(next) => { if (!next) controls.cancel(); }} title={title}>
    {description ? <p className="page-description form-page-description mb-5">{description}</p> : null}
    {typeof children === "function" ? children(controls) : children}
  </Modal></>;
}

/** Display 3: the form as a popup over the page it was opened from (a box of about 520 px, the buttons fixed at its foot). */
function FormPagePopup({ title, back, behind, testId, children }: { title: string; back: string; behind?: React.ReactNode; testId?: string; children: FormChildren }) {
  // The form's own address, read after mounting: the first render can come before the router has written the new address
  // (Nytt projekt opened from the project list, which stays mounted), and then Stäng did nothing (2026-10-23).
  const opened = useRef("");
  useEffect(() => { opened.current = `${location.pathname}${location.search}`; }, []);
  // Stabil sidladdning steg 9 (UX punkt 8): Avbryt closes the box at once and goes back afterwards. Before, the box stood
  // until the server had answered the new address and showed a scrollbar meanwhile (a picture of Nytt projekt).
  const [open, setOpen] = useState(true);
  const controls = useFormWay(back, () => setOpen(false));
  return <>{behind ?? null}<Modal size="form" open={open} title={title}
    // The popup closes when the address changes (a link, a breadcrumb); only a close on the form's own address is Avbryt.
    onOpenChange={(next) => { if (!next && `${location.pathname}${location.search}` === opened.current) controls.cancel(); }}>
    <div data-testid={testId ?? "form-popup"}>
      {typeof children === "function" ? children(controls) : children}
    </div>
  </Modal></>;
}

function FormPageBody({ title, description, back, testId, meta, actions, children }: { title: string; description?: React.ReactNode; back: string; testId?: string; meta?: React.ReactNode; actions?: React.ReactNode; children: FormChildren }) {
  const [confirm, confirmElement] = useConfirm();
  const [root, rootRef] = useState<HTMLElement | null>(null);
  const [dirty, setDirty] = useState(false);
  const [hasPrimary, setHasPrimary] = useState(false);
  // A form page without a button row of its own (Koppla befintlig uppgift: a list with a button per row) still has Avbryt
  // top right (samband, 2026-10-26).
  const [ownButtons, setOwnButtons] = useState(true);
  // Changed = something was typed or chosen on the page; React's own value updates never raise these events.
  useEffect(() => {
    if (!root) return;
    // Deferred: a re-render before the event reaches React would reset the controlled field and swallow the first keystroke.
    const stopListening = listenForTypedChange(root, () => setDirty(true));
    const look = () => {
      setHasPrimary(Boolean(root.querySelector('[data-dialog-role="primary"]')));
      setOwnButtons(Boolean(root.querySelector('[data-dialog-role]:not([data-page-back])')));
    };
    look();
    const observer = new MutationObserver(look);
    observer.observe(root, { childList: true, subtree: true });
    return () => { stopListening(); observer.disconnect(); };
  }, [root]);
  useUnsavedGuard(dirty, confirm);
  // The form's own Avbryt (DialogActions) asks when something is changed (2026-10-13).
  const mayDiscard = useCallback(async () => !dirty || confirm(DISCARD_QUESTION), [dirty, confirm]);
  const controls = useFormWay(back, () => setDirty(false));
  // The bottom bar's Spara presses the form's own main button, so the form's checks and reasons hold.
  // The floating navigation's Avbryt (2026-10-27) presses the form's own Avbryt, so its question about changes holds.
  useRegisterEditorActions({ save: () => root?.querySelector<HTMLButtonElement>('[data-dialog-role="primary"]')?.click(), canSave: hasPrimary, busy: false, dirty,
    cancel: () => root?.querySelector<HTMLButtonElement>('[data-dialog-role="cancel"]')?.click() });
  return <DiscardContext.Provider value={mayDiscard}><StandardPage rootRef={rootRef} testId={testId ?? "form-page"} title={title} description={description} meta={meta}
    actions={ownButtons ? actions : <>{actions}<Button type="button" variant="outline" onClick={controls.cancel} data-dialog-role="cancel" data-page-back="" data-testid="form-page-cancel">Avbryt</Button></>}>
    {confirmElement}
    {typeof children === "function" ? children(controls) : children}
  </StandardPage></DiscardContext.Provider>;
}

/**
 * Utfällbar sektion (2026-10-09): opened and folded again with a click on its row (only the arrow, 2026-10-24). Folding keeps what was
 * typed and shows a one-line summary; removing the information is a separate, clearly named action of the caller.
 */
export function CollapsibleSection({ title, summary, open, onOpenChange, children, actions, testId, className, divided = true }: {
  title: string;
  /** A line between the row and the open content; false where the section's own top line is the card's only one (the key cards' Mer). */
  divided?: boolean;
  /** One short line shown while folded (what was entered), or nothing. */
  summary?: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  /** Shown after the row while open, e.g. "Ta bort …". */
  actions?: React.ReactNode;
  testId?: string;
  className?: string;
}) {
  const contentId = useId();
  return <section className={cn("field-group rounded-md border", className)} data-testid={testId} data-open={open || undefined}>
    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
      {/* Hela raden klickbar, bara pilen (2026-10-24): the whole row is the button that opens and folds, with the
          arrow at its right end (› folded, ⌄ open) – no "Fäll ihop" text. The caller's actions stand after it. */}
      <button type="button" className="collapsible-toggle touch-target flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left" aria-expanded={open} aria-controls={contentId} onClick={() => onOpenChange(!open)} data-testid={testId ? `${testId}-toggle` : undefined}>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-foreground">{title}</span>
          {!open && summary ? <span className="block truncate text-xs text-muted-foreground" data-testid={testId ? `${testId}-summary` : undefined}>{summary}</span> : null}
        </span>
        <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 text-muted-foreground", !open && "-rotate-90")} />
      </button>
      {open && actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
    <div id={contentId} hidden={!open} className={cn("space-y-3 px-3 pb-3", divided ? "border-t pt-3" : "pt-1")}>{children}</div>
  </section>;
}

/**
 * En utfällbar rad i en lista (2026-11-22, standardsidorna): the whole row is the summary – the row's own content and the
 * arrow at its right end (› folded, ⌄ open), as the lists' foldable rows and `AdvancedFold` – and what it opens stands under
 * it, indented to nothing, without a box of its own (no card in a card). For rows whose details are read or changed in place
 * (Agenter: the built-in agents' choices, a run's report); a row that leads to another page is a link with `RowChevron`.
 */
export function FoldRow({ summary, children, open, testId, className }: { summary: React.ReactNode; children: React.ReactNode; open?: boolean; testId?: string; className?: string }) {
  return <details open={open || undefined} className={cn("group", className)} data-testid={testId}>
    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
      <div className="min-w-0 flex-1">{summary}</div>
      <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform -rotate-90 group-open:rotate-0" />
    </summary>
    <div className="mt-2 space-y-3 pb-1">{children}</div>
  </details>;
}

/**
 * An empty state: an icon, a title and a line. `compact` (2026-10-23, the customer page's cards "pussla bättre"): one
 * short row with a small icon instead of a tall block, for a card that stands beside others and should not take room.
 */
export function Empty({
  title,
  description,
  children,
  compact = false,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
  compact?: boolean;
}) {
  if (compact) return (
    <div className="flex items-center gap-2.5 py-0.5" data-empty="compact">
      <span className="shrink-0 rounded-md bg-secondary p-1.5 text-primary" aria-hidden="true">
        <Inbox className="size-4" />
      </span>
      <p className="min-w-0 text-sm leading-5"><span className="font-medium text-foreground">{title}.</span> <span className="text-muted-foreground">{description}</span></p>
      {children}
    </div>
  );
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 px-4 py-10 text-center">
      <span className="rounded-md bg-secondary p-2.5 text-primary">
        <Inbox className="size-5" />
      </span>
      <h3 className="section-title">{title}</h3>
      <p className="page-description max-w-md">{description}</p>
      {children}
    </div>
  );
}
/** Shared footer for paged history and log lists: "Visar X av N" with a button that loads the next page. */
export function ShowMore({ shown, total, busy = false, onMore, testId }: { shown: number; total: number; busy?: boolean; onMore: () => void; testId?: string }) {
  if (shown >= total) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground">
      <span>Visar {shown} av {total}</span>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onMore} data-testid={testId}>
        {busy ? "Hämtar…" : "Visa fler"}
      </Button>
    </div>
  );
}
/** The skeletons live in components/skeleton.tsx (steg 5), so the page template can draw them too. */
export { RowsSkeleton, SkeletonText } from "@/components/skeleton";
export function Status({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold",
        indicatorBadge(status === "COMPLETED" ? "success" : isTaskCancelled(status) ? "neutral" : "warning"),
      )}
    >
      {status === "COMPLETED" ? "Färdigställd" : isTaskCancelled(status) ? TASK_CANCELLED_LABEL : "Utkast"}
    </span>
  );
}

/**
 * Justerare för antal (beslut 13, 2026-10-18): en liten − N + som sökkortet och en rad i en lista använder.
 * Minska vid minimum anropar `onRemove` (raden tas bort, gärna via useUndoRemove så att Ångra erbjuds); utan `onRemove` är
 * minska låst vid minimum. `onDelete` lägger en papperskorg sist (tar bort raden direkt, oavsett antal). `size="field"` är
 * samma höjd som ett fält och en knapp bredvid (36 px, 44 px på touch), med fältets vita yta, och används i artikellistan.
 * `onType` gör antalet till ett fält att skriva i (stora antal; Enter eller att lämna fältet tar det), `unit` står bredvid
 * antalet (st, m, förp) och `decimals` ger decimaltangentbordet. `reserveDelete` håller papperskorgens plats tom så att
 * justeraren är lika bred före och efter att något lagts till (2026-10-26). `parts` ger delarna egna testid där en
 * sida redan har sina. Tryckytan växer till 44 px på touch (globals.css).
 */
export function QuantityStepper({ value, onChange, onRemove, onDelete, onType, min = 1, max, label = "Antal", disabled = false, testId, parts, size = "sm", format, unit, decimals = false, reserveDelete = false, className }: {
  value: number;
  onChange: (value: number) => void;
  onRemove?: () => void;
  onDelete?: () => void;
  /** The antal as typed in the middle (raw text): the page reads it, and the field shows `value` again after. */
  onType?: (text: string) => void;
  min?: number;
  max?: number;
  /** What is counted, for screen readers ("Antal Kabel 3x1,5"). */
  label?: string;
  disabled?: boolean;
  testId?: string;
  parts?: { minus?: string; plus?: string; value?: string; remove?: string; unit?: string };
  size?: "sm" | "field";
  /** How the number is shown (decimal comma): the value itself when not given. */
  format?: (value: number) => string;
  /** The unit beside the antal ("st", "m", "förp"). */
  unit?: string;
  /** The antal may have decimals (2,5 m): the field asks for the decimal keyboard. */
  decimals?: boolean;
  /** Keeps the bin's place when there is no `onDelete`, so the stepper is as wide either way. */
  reserveDelete?: boolean;
  className?: string;
}) {
  const [typing, setTyping] = useState<string | null>(null);
  const step = (delta: 1 | -1) => {
    const result = stepQuantity(value, delta, { min, max, canRemove: Boolean(onRemove) });
    if (result.kind === "set") onChange(Math.round(result.value * 100) / 100);
    else if (result.kind === "remove") onRemove?.();
  };
  const atMin = !onRemove && value <= min;
  const field = size === "field";
  const shownValue = format ? format(value) : String(value);
  const buttonSize = field ? "h-full w-9 touch:w-11" : undefined;
  const commit = () => { if (typing === null) return; const text = typing; setTyping(null); if (text.trim() !== shownValue) onType?.(text); };
  const middle = onType
    ? <input type="text" inputMode={decimals ? "decimal" : "numeric"} enterKeyHint="done" aria-label={unit ? `${label} (${unit})` : label} disabled={disabled}
        className={cn("min-w-0 bg-transparent text-center text-sm font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50", field ? "w-12 rounded-sm" : "w-10 rounded-sm")}
        value={typing ?? shownValue} onFocus={(event) => { setTyping(shownValue); event.currentTarget.select(); }} onChange={(event) => setTyping(event.target.value)} onBlur={commit}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); event.currentTarget.blur(); } else if (event.key === "Escape") { setTyping(null); event.currentTarget.blur(); } }}
        data-testid={parts?.value ?? "quantity-value"} />
    : <output className={cn("text-center text-sm font-semibold tabular-nums", field ? "flex min-w-7 items-center justify-center" : "min-w-8")} aria-live="polite" data-testid={parts?.value ?? "quantity-value"}>{shownValue}</output>;
  return <span role="group" aria-label={label} className={cn(field ? "inline-flex h-9 items-stretch gap-0.5 rounded-[var(--radius-control)] border border-input bg-card touch:h-11 dark:bg-input/30" : "inline-flex items-center gap-1", className)} data-testid={testId ?? "quantity-stepper"}>
    <IconButton label={onRemove && value <= min ? `Ta bort (${label})` : `Minska ${label.toLowerCase()}`} variant={field ? "ghost" : "outline"} size={field ? "default" : "icon-sm"} className={buttonSize} disabled={disabled || atMin} onClick={() => step(-1)} data-testid={parts?.minus ?? "quantity-minus"}><Minus aria-hidden="true" /></IconButton>
    {unit ? <span className="flex items-center gap-1">{middle}<span className="text-xs text-muted-foreground" data-testid={parts?.unit ?? "quantity-unit"}>{unit}</span></span> : middle}
    <IconButton label={`Öka ${label.toLowerCase()}`} variant={field ? "ghost" : "outline"} size={field ? "default" : "icon-sm"} className={buttonSize} disabled={disabled || (max !== undefined && value >= max)} onClick={() => step(1)} data-testid={parts?.plus ?? "quantity-plus"}><Plus aria-hidden="true" /></IconButton>
    {onDelete ? <Button type="button" variant={field ? "ghost" : "outline"} size={field ? "default" : "icon-sm"} className={cn(buttonSize, "text-destructive")} disabled={disabled} aria-label={`Ta bort ${label.toLowerCase()}`} title="Ta bort raden" onClick={onDelete} data-testid={parts?.remove ?? "quantity-remove"}><Trash2 aria-hidden="true" /></Button>
      : reserveDelete ? <span aria-hidden="true" className={field ? "w-9 shrink-0 touch:w-11" : "size-8 shrink-0"} /> : null}
  </span>;
}

/**
 * Behörighetsrutan (beslut 6, 2026-10-18): den enda rutan för en sida personen inte får se – rubrik och en knapp till
 * Översikt. Ingen tyst omdirigering och ingen tom ruta utan rubrik. Står rutan i stället för hela sidan (`page`) är rubriken
 * sidans h1 (analysen 2026-10-24: sidan saknade annars rubrik). API:et vägrar som förut; det här är bara det man ser.
 */
export function NoPermission({ className, page = false }: { className?: string; /** The box is the whole page: its title is the page's h1. */ page?: boolean }) {
  const Heading = page ? "h1" : "h2";
  return <div role="status" className={cn("flex flex-col items-center justify-center gap-3 rounded-lg border bg-card px-4 py-12 text-center", className)} data-testid="no-permission">
    <span className="rounded-md bg-secondary p-2.5 text-primary"><ShieldOff aria-hidden="true" className="size-5" /></span>
    <Heading className="section-title" data-testid="no-permission-title">Du har inte behörighet till den här sidan</Heading>
    <Link href="/?view=stats" className={buttonVariants({ variant: "default" })} data-testid="no-permission-home">Till Översikt</Link>
  </div>;
}

/**
 * A setting that is on or off and saved at once (UX-granskningen C4, 2026-10-22: "brytare med en rad text"): the
 * title, one short line under it and the switch at the right. The whole row is the touch target (44 px high). `reason`
 * says why it cannot be changed now; it replaces the line while the switch is disabled.
 */
export function SwitchRow({ id, title, text, checked, disabled, reason, onCheckedChange, testId }: {
  id: string; title: string; text?: string; checked: boolean; disabled?: boolean; reason?: string | null;
  onCheckedChange: (checked: boolean) => void; testId?: string;
}) {
  const line = disabled && reason ? reason : text;
  return <div className="flex min-h-11 items-center justify-between gap-4 py-2" data-testid={testId ? `row-${testId}` : undefined}>
    <label htmlFor={id} className={cn("min-w-0 cursor-pointer", disabled && "cursor-default")}>
      <span className="block text-sm font-medium">{title}</span>
      {line ? <span className="block text-xs leading-5 text-muted-foreground">{line}</span> : null}
    </label>
    <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} data-testid={testId} />
  </div>;
}

/**
 * Farozon (2026-10-31): what cannot be undone or takes someone's access stands last on an own page, with less weight
 * than Redigera, never in a row's small menu. Red frame and heading; the buttons are outline, red text where it is destructive.
 */
export function DangerZone({ description, children, className, testId }: { description?: React.ReactNode; children: React.ReactNode; className?: string; testId?: string }) {
  return <section aria-label="Farozon" className={cn("rounded-lg border border-destructive/40 p-4", className)} data-testid={testId}>
    <h2 className="text-xs font-semibold uppercase tracking-wide text-destructive">Farozon</h2>
    {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
    <div className="mt-3 flex flex-wrap gap-2">{children}</div>
  </section>;
}
