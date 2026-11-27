"use client";

import { useRef, type ReactNode } from "react";
import { Menubar } from "radix-ui";
import { Check, Copy, Download, Eraser, FilePlus2, FolderOpen, Play, Redo2, RotateCcw, Square, Trash2, Undo2, Upload, Wrench } from "lucide-react";
import { SPEEDS, type SurfaceSpeed } from "@/lib/machine/simulator/surface/engine";
import { SURFACE_EXAMPLES } from "@/lib/machine/simulator/surface/examples";
import { useActions } from "./actions";
import { useRuntimeSnapshot, useDesktop, useDeskState, usePhone } from "./context";
import { PANEL_IDS, PANELS, PHONE_PANELS } from "./panels";

// PLC-simulatorn, skrivbordet: the menu bar. Arkiv, Redigera, Visa, Kör, Fönster, Hjälp, with the keyboard of a menu (Radix
// Menubar: arrow keys, Esc, type-ahead) and the same functions as the toolbar and the shortcuts.

export type HelpTopic = "about" | "keys" | "st" | "guards";

function Item({ icon, hint, children, onSelect, disabled, testId }: { icon?: ReactNode; hint?: string; children: ReactNode; onSelect: () => void; disabled?: boolean; testId?: string }) {
  return <Menubar.Item className="plc-menu-item" onSelect={onSelect} disabled={disabled} data-testid={testId}><span className="plc-menu-slot">{icon}</span><span>{children}</span>{hint ? <span className="plc-menu-hint">{hint}</span> : null}</Menubar.Item>;
}
function CheckItem({ checked, children, onSelect, testId }: { checked: boolean; children: ReactNode; onSelect: () => void; testId?: string }) {
  return <Menubar.CheckboxItem className="plc-menu-item" checked={checked} onCheckedChange={onSelect} onSelect={(event) => event.preventDefault()} data-testid={testId}><span className="plc-menu-slot">{checked ? <Check aria-hidden="true" /> : null}</span><span>{children}</span></Menubar.CheckboxItem>;
}
function Menu({ label, children, testId }: { label: string; children: ReactNode; testId: string }) {
  return <Menubar.Menu>
    <Menubar.Trigger className="plc-menu-trigger" data-testid={testId}>{label}</Menubar.Trigger>
    <Menubar.Portal>
      <Menubar.Content className="plc-chrome plc-menu-box plc-menu-content" align="start" sideOffset={0} loop>{children}</Menubar.Content>
    </Menubar.Portal>
  </Menubar.Menu>;
}
function Sub({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return <Menubar.Sub>
    <Menubar.SubTrigger className="plc-menu-item"><span className="plc-menu-slot">{icon}</span><span>{label}</span><span className="plc-menu-hint">▸</span></Menubar.SubTrigger>
    <Menubar.Portal><Menubar.SubContent className="plc-chrome plc-menu-box plc-menu-content" sideOffset={0}>{children}</Menubar.SubContent></Menubar.Portal>
  </Menubar.Sub>;
}

export function MenuBar({ onHelp, onClock }: { onHelp: (topic: HelpTopic) => void; onClock: () => void }) {
  const { runtime } = useDesktop();
  const actions = useActions();
  const snapshot = useRuntimeSnapshot();
  const desk = useDeskState();
  const phone = usePhone();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const { engine } = snapshot;
  return <>
    <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" data-testid="plc-surface-import-file" onChange={(event) => { void actions.importFile(event.target.files?.[0]); event.target.value = ""; }} />
    <Menubar.Root className="plc-menubar" data-testid="plc-menubar" aria-label="Meny">
      <Menu label="Arkiv" testId="plc-menu-arkiv">
        <Item icon={<FilePlus2 aria-hidden="true" />} onSelect={() => void actions.newProject()} testId="plc-menu-new">Nytt</Item>
        <Sub label="Öppna exempel" icon={<FolderOpen aria-hidden="true" />}>
          <Menubar.Label className="plc-menu-item plc-help">Industri</Menubar.Label>
          {SURFACE_EXAMPLES.filter((example) => example.group === "industri").map((example) => <Item key={example.id} onSelect={() => actions.openExample(example.id)} testId={`plc-example-${example.id}`}>{example.title}</Item>)}
          <Menubar.Label className="plc-menu-item plc-help">Fastighet</Menubar.Label>
          {SURFACE_EXAMPLES.filter((example) => example.group === "fastighet").map((example) => <Item key={example.id} onSelect={() => actions.openExample(example.id)} testId={`plc-example-${example.id}`}>{example.title}</Item>)}
        </Sub>
        <Menubar.Separator className="plc-menu-separator" />
        <Item icon={<Upload aria-hidden="true" />} onSelect={() => fileRef.current?.click()} testId="plc-menu-import">Importera …</Item>
        <Item icon={<Download aria-hidden="true" />} onSelect={actions.exportFile} testId="plc-menu-export">Exportera</Item>
        <Menubar.Separator className="plc-menu-separator" />
        <Item icon={<Eraser aria-hidden="true" />} onSelect={() => void actions.clear()} testId="plc-menu-clear">Rensa</Item>
      </Menu>
      <Menu label="Redigera" testId="plc-menu-redigera">
        <Item icon={<Undo2 aria-hidden="true" />} hint="Ctrl+Z" onSelect={actions.undo} disabled={!snapshot.canUndo} testId="plc-menu-undo">Ångra</Item>
        <Item icon={<Redo2 aria-hidden="true" />} hint="Ctrl+Y" onSelect={actions.redo} disabled={!snapshot.canRedo} testId="plc-menu-redo">Gör om</Item>
        <Menubar.Separator className="plc-menu-separator" />
        <Item icon={<Copy aria-hidden="true" />} hint="Ctrl+D" onSelect={actions.duplicate} testId="plc-menu-duplicate">Duplicera</Item>
        <Item icon={<Trash2 aria-hidden="true" />} hint="Delete" onSelect={actions.remove} testId="plc-menu-remove">Ta bort</Item>
      </Menu>
      <Menu label="Visa" testId="plc-menu-visa">
        {(phone ? PHONE_PANELS : PANEL_IDS).map((id) => <CheckItem key={id} checked={desk.openPanels.includes(id)} onSelect={() => actions.togglePanel(id)} testId={`plc-menu-show-${id}`}>{PANELS[id].title}</CheckItem>)}
        <Menubar.Separator className="plc-menu-separator" />
        <Item icon={<RotateCcw aria-hidden="true" />} onSelect={actions.resetLayout} testId="plc-menu-reset-layout" disabled={phone}>Återställ layout</Item>
      </Menu>
      <Menu label="Kör" testId="plc-menu-kor">
        <Item icon={engine.run ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />} hint="F5" onSelect={actions.toggleRun} testId="plc-menu-run">{engine.run ? "STOP" : "RUN"}</Item>
        <Item icon={<Wrench aria-hidden="true" />} hint="F7" onSelect={actions.compile} testId="plc-menu-compile">Kompilera och verifiera</Item>
        <Menubar.Separator className="plc-menu-separator" />
        <Sub label="Hastighet">
          {SPEEDS.map((speed) => <CheckItem key={speed} checked={engine.speed === speed} onSelect={() => runtime.setSpeed(speed as SurfaceSpeed)}>{`${speed}×`}</CheckItem>)}
        </Sub>
        <Item onSelect={onClock} testId="plc-menu-clock">Klocka …</Item>
      </Menu>
      <Menu label="Fönster" testId="plc-menu-fonster">
        {(phone ? PHONE_PANELS : PANEL_IDS).map((id, index) => <Item key={id} hint={index < 9 ? `Ctrl+${index + 1}` : undefined} onSelect={() => actions.showPanel(id)} testId={`plc-menu-go-${id}`}>{PANELS[id].title}</Item>)}
        {phone ? null : <>
          <Menubar.Separator className="plc-menu-separator" />
          <Sub label="Eget fönster">
            {PANEL_IDS.map((id) => <Item key={id} onSelect={() => actions.popOut(id)} testId={`plc-menu-popout-${id}`}>{PANELS[id].title}</Item>)}
          </Sub>
        </>}
      </Menu>
      <Menu label="Hjälp" testId="plc-menu-hjalp">
        <Item hint="F1" onSelect={() => actions.openHelp("start")} testId="plc-menu-guide">Guide: kom igång</Item>
        <Item onSelect={() => actions.openHelp("alarms")} testId="plc-menu-help-alarms">Larm och AI</Item>
        <Item onSelect={() => actions.openHelp("api")} testId="plc-menu-help-api">API-koppling och andra system</Item>
        <Item onSelect={() => actions.openHelp("reference")} testId="plc-menu-help-reference">Paneler, Ladder och vanliga fel</Item>
        <Menubar.Separator className="plc-menu-separator" />
        <Item onSelect={() => onHelp("about")} testId="plc-menu-about">Om PLC-simulatorn</Item>
        <Item onSelect={() => onHelp("keys")} testId="plc-menu-keys">Tangenter</Item>
        <Item onSelect={() => onHelp("st")} testId="plc-menu-st-help">Så skriver du ST</Item>
        <Item onSelect={() => onHelp("guards")} testId="plc-menu-guards">Kopplingen till Workflow</Item>
      </Menu>
    </Menubar.Root>
  </>;
}
