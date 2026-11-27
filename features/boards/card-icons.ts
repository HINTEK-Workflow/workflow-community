import { ChartLine, CircleDot, CircleGauge, Clock, Gauge, Image, ListChecks, Table2, Type, type LucideIcon } from "lucide-react";
import { Activity, BellRing, CalendarDays, Factory, FileSpreadsheet, FileText, LayoutGrid, MessageSquareWarning, TrendingUp, Wrench } from "lucide-react";
import type { CardDefinition } from "@/lib/boards/model";

/** The card types' icons (Lucide, plain line style – the icon rule: basic, few details, clearly the function). */
export const CARD_ICON: Record<CardDefinition["icon"], LucideIcon> = { Gauge, CircleGauge, ChartLine, Table2, CircleDot, ListChecks, Type, Image, Clock,
  FileText, FileSpreadsheet, CalendarDays, Factory, BellRing, Activity, LayoutGrid, Wrench, MessageSquareWarning, TrendingUp };
