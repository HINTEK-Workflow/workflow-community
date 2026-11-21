import type { LucideIcon } from "lucide-react";
import { Archive, BadgeCheck, BarChart3, Bell, Building2, Calculator, CalendarClock, ClipboardCheck, ClipboardList, Clock, Cpu, CreditCard, Eye, FilePenLine, FileText, Film, FolderKanban, Gauge, Globe, HardHat, HelpCircle, History, KeyRound, LayoutDashboard, Mail, MapPinHouse, Megaphone, OctagonAlert, Package, PanelsTopLeft, PencilRuler, Plus, Presentation, Receipt, ReceiptText, Repeat, Rocket, Scale, Send, Server, Settings2, ShoppingCart, SlidersHorizontal, Sparkles, Upload, UserCog, Users, Wrench } from "lucide-react";

/**
 * The icon of every page (?view=): one map for the shell (menu, top bar) and Sök, where a page in the result list carries
 * the menu's own symbol (Sök 2026-11-19). Pure, so both read the same.
 */
export const VIEW_ICON = {
  notifications: Bell,
  stats: LayoutDashboard,
  new: ClipboardCheck,
  new_task: Plus,
  workflow_task: ClipboardCheck,
  controls: ClipboardCheck,
  // Arbetsorder (2026-09-26): its own menu group between Mina uppgifter and Nytt projekt.
  work_orders: ClipboardList,
  new_project: FolderKanban,
  projects: FolderKanban,
  // Driftronder (2026-09-28): recurring rounds of any form, next to Planering.
  rounds: Repeat,
  planning: CalendarClock,
  // Planering's other views (2026-11-01): Tidplan, the projects' schedules (plan 1M), and Kapacitet; the menu button is "planning".
  project_planning: CalendarClock,
  capacity: CalendarClock,
  project: FolderKanban,
  tasks: ClipboardCheck,
  time: Clock,
  // Inköp (2026-10-16): Nytt inköp, with Mina inköp and Artiklar behind the fold arrow, above Offert.
  purchase: ShoppingCart,
  purchases: ShoppingCart,
  articles: Package,
  // Offerter (2026-10-09, steg B): Ny offert / Mina offerter, a group of its own after the projects.
  quote: FileText,
  quotes: FileText,
  // Fakturaunderlag (2026-10-28): the company's list of invoice bases, under Offerter.
  invoice_bases: Receipt,
  // Fakturor (2026-11-04): only reached from Fakturaunderlag, and only with the company's setting on.
  customer_invoices: ReceiptText,
  // Register och verktyg (2026-10-09): the supporting pages under one menu choice, with a hub page of its own.
  tools: PencilRuler,
  // The Demo page (2026-11-05): only the demo draws this button and only the demo answers the address.
  demo: Sparkles,
  // Projektsammanställning (2026-10-09): the statistics across the company's projects, under Projekt.
  project_summary: BarChart3,
  // Rapportarkiv (2026-10-07): the PDF and Excel reports a person chose to keep when exporting.
  report_archive: Archive,
  // Kalkylator (2026-10-12): the list of calculators under Verktyg; opened from Verktyg, Mer and the top bar's calculator.
  calculators: Calculator,
  facilities: MapPinHouse,
  // Platser etapp 3 (2026-10-04): a place's page (opened from its QR label) and the label sheet.
  place: MapPinHouse,
  place_labels: MapPinHouse,
  customers: Users,
  // Egenkontroll (2026-10-06): the company's self-inspection programme; every active member reads it.
  self_inspection: BadgeCheck,
  // Avvikelser (2026-10-30): the company's deviation log, a page of its own in the work part of the menu.
  deviations: OctagonAlert,
  // Underhåll (2026-10-30): the machine tree, the store and the maintenance items, beside Driftronder.
  maintenance: Wrench,
  // Tavlor (2026-11-18): the company's boards; Skärmar and Tabeller are tabs of the page.
  boards: Presentation,
  // Instrument (2026-10-07): the company's measuring instruments with calibration, under Kvalitet.
  instruments: Gauge,
  credits: CreditCard,
  help: HelpCircle,
  administration: UserCog,
  // Operatörskonton: a button on Användare (2026-11-02), a row of Mer on the phone; the company's admin in Cloud.
  operator_accounts: HardHat,
  // All keys for API, MCP and external services in one place (2026-09-29): company admins in Cloud.
  integrations: KeyRound,
  // What Workflow AI may read and do (2026-10-01: "sidan går inte att hitta"): a tab under Mitt företag.
  ai_settings: Sparkles,
  // The company's own limit values and their sources (2026-10-06): company admins, Cloud and Local.
  company_values: Scale,
  // How long the company's history is kept, and manual deletion (2026-09-30): company admins in Cloud.
  history_retention: History,
  // Slimmer settings (2026-10-07): Företaget (profile, agreements, logo), Avancerat (API och MCP, Historik och
  // lagring, Administrationshistorik) and Visa som under Installation. Tabs, never menu buttons of their own.
  company: Building2,
  advanced: History,
  view_as: Eye,
  // The installation's e-mail: SMTP, sender and which mail is sent (2026-09-30): the superadmin.
  mail_settings: Mail,
  // Inloggning (2026-10-03): whether Google sign-in is offered; the superadmin.
  login_settings: KeyRound,
  // Utskick (2026-10-03): newsletters and important information, under Installation; the superadmin.
  mailings: Send,
  // Beteendeanalys (2026-10-07): anonymous counts of how Workflow is used, under Installation; the superadmin.
  behavior_analytics: BarChart3,
  // Funktioner (2026-10-07): the company's optional functions on one page, under Inställningar; company admins.
  company_features: SlidersHorizontal,
  // Priser och offert (2026-10-09 natt): the company's prices, quote terms and accounts; a tab under Inställningar.
  quote_settings: Calculator,
  // Tjänster (2026-10-09 natt): SCB, the map, the address lookup and the payment test; under Installation.
  services: Wrench,
  // Servernycklar (2026-10-03): the keys the server runs with, under Installation; the superadmin.
  server_keys: Server,
  // "Skapa formulär" (2026-09-26): Workflow's superadmin and, since 2026-09-27, company admins in Cloud; next to Workflow AI.
  forms: FilePenLine,
  // Import (2026-10-01): files become customers, projects, work orders, planning, control points or attachments.
  // Lives in ee/ next to Workflow AI; Cloud companies only.
  import: Upload,
  // The landing page, edited in place like Skapa formulär (2026-09-30): Workflow's superadmin only.
  landing_editor: PanelsTopLeft,
  // Webb och inlägg (2026-11-20): a page under Mer with the tabs Inlägg and Min webbsida; company admins, a module.
  web_posts: Megaphone,
  // Min webbsida (2026-11-10): the company's own WordPress pages, edited like the landing page; a tab of Webb och inlägg.
  company_website: Globe,
  // Inlägg (2026-11-10): posts for the company's Facebook page and Instagram account; a tab of Webb och inlägg.
  company_posts: Megaphone,
  company_videos: Film,
  // PDF-mallar (2026-11-03): the documents' texts, visibility and order, under Installation; the superadmin.
  pdf_templates: FileText,
  // PLC-apparater (2026-11-06): the simulator's devices, under Installation; the superadmin.
  plc_devices: Cpu,
  customer_companies: Building2,
  product_overview: Building2,
  // Tabs under Installation and Mitt företag (2026-10-02); never menu buttons of their own.
  pricing_admin: CreditCard,
  ai_admin: Sparkles,
  company_settings: Building2,
  // Ställ in Workflow (2026-10-02): the setup guide, opened from the overview or Mina inställningar.
  setup: Rocket,
  settings: Settings2,
} as const satisfies Record<string, LucideIcon>;
export type ViewKey = keyof typeof VIEW_ICON;
