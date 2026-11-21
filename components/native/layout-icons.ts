import type { LucideIcon } from "lucide-react";
import { AlarmClock, Bell, CalendarClock, CalendarX2, Clock, FolderKanban, Hammer, Home, ListChecks, MapPin, Plus, Repeat, Search, Sparkles, Users, UsersRound, ClipboardList, OctagonAlert } from "lucide-react";
import type { HomeTileKey, TabKey } from "@/lib/workflow/native-layout";

/** The tab bar's icon per button, shared by the real bar and the settings editor's preview (level 1 on a phone). */
export const NATIVE_TAB_ICON: Record<TabKey, LucideIcon> = {
  home: Home, jobs: ClipboardList, new: Plus, time: Clock, ai: Sparkles, search: Search,
  projects: FolderKanban, planning: CalendarClock, rounds: Repeat, customers: Users, notifications: Bell, team: UsersRound, maintenance: Hammer,
};
/** Hem's tiles that have an icon of their own rather than their type's. */
export const NATIVE_HOME_ICON: Partial<Record<HomeTileKey, LucideIcon>> = {
  jobs: ClipboardList, checkin: MapPin, new: Plus, ai: Sparkles, planning: CalendarClock,
  // Dashboard etapp 2 (2026-10-28): Mina avvikelser has Avvikelser's own symbol (2026-11-01).
  next: ListChecks, overdue: AlarmClock, deviations: OctagonAlert,
  absence: CalendarX2, team: UsersRound, maintenance: Hammer,
};
