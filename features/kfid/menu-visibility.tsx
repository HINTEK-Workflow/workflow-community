"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Segmented } from "@/features/workflow/work-list";
import type { MenuDevice, MenuDeviceChoices } from "@/lib/kfid/preferences";
import { isShortcuttable, MENU_ITEM_GROUPS, menuChoiceOffered, type MenuAccess } from "@/lib/workflow/menu-items";

/**
 * Which menu buttons are shown (2026-09-30): each person chooses; display only, never access. Since 2026-10-21
 * (UX-granskningen C1) chosen in the menu itself – Anpassa menyn at its foot – instead of under Mina inställningar.
 * A page under Verktyg can also be a shortcut directly in the menu. Only the buttons the person may use are offered.
 * Per device since 2026-10-24: one choice for Mer on the phone, one for the computer's and the tablet's menu. Since 2026-11-02
 * that menu has no Användare or Operatörskonton, and its choice Workflow AI decides the floating icon; Mer's rows are as before.
 */
export function MenuVisibilityChoices({ access, device, onDevice, hiddenMenuItems: hidden, menuShortcuts: shortcuts, onChange }: {
  access: MenuAccess | null;
  device: MenuDevice;
  onDevice: (device: MenuDevice) => void;
  hiddenMenuItems: readonly string[];
  menuShortcuts: readonly string[];
  onChange: (choices: MenuDeviceChoices) => void;
}) {
  const groups = MENU_ITEM_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => menuChoiceOffered(item.key, device, access)) })).filter((group) => group.items.length);
  // No frame or heading of its own (2026-10-22): the popup's title Anpassa menyn says it.
  return <div className="space-y-3" data-testid="menu-visibility">
    <Segmented label="Enhet" value={device} onChange={onDevice} testId="menu-visibility-device"
      options={[{ value: "phone", label: "Telefon" }, { value: "desktop", label: "Dator och surfplatta" }]} />
    <p className="text-xs text-muted-foreground">Bocka ur det du inte använder. Det du döljer finns kvar och kan väljas igen. Översikt och Inställningar visas alltid.</p>
    {/* Two columns, a long choice wrapping (2026-10-22: one column was tried and two looked better). */}
    <div className="grid gap-4 sm:grid-cols-2">
      {groups.map((group) => <div key={group.title} className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">{group.title}</p>
        {group.items.map((item) => {
          const visible = !hidden.includes(item.key);
          const supportKey = isShortcuttable(item.key) ? item.key : null;
          const shortcut = Boolean(supportKey && shortcuts.includes(supportKey));
          return <div key={item.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <Checkbox checked={visible} onCheckedChange={(value) => onChange({
                hiddenMenuItems: value === true ? hidden.filter((key) => key !== item.key) : [...hidden, item.key],
                menuShortcuts: value === true ? [...shortcuts] : shortcuts.filter((key) => key !== item.key),
              })} />
              {/* The button's name, and in smaller text what follows it or where it sits (2026-10-22). */}
              <span className="leading-tight"><span className="block">{item.label}</span>
                {item.key === "ai" && device === "desktop" ? <span className="block text-xs text-muted-foreground">Ikonen vid pilarna</span>
                  : "detail" in item ? <span className="block text-xs text-muted-foreground">{item.detail}</span> : null}</span>
            </label>
            {supportKey ? <label className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground" data-testid={`menu-shortcut-choice-${item.key}`}>
              <Checkbox checked={shortcut} disabled={!visible} aria-label={`Visa ${item.label} som genväg i menyn`} onCheckedChange={(value) => onChange({
                hiddenMenuItems: [...hidden],
                menuShortcuts: value === true ? [...shortcuts.filter((key) => key !== supportKey), supportKey] : shortcuts.filter((key) => key !== supportKey),
              })} />
              Genväg
            </label> : null}
          </div>;
        })}
      </div>)}
    </div>
  </div>;
}
