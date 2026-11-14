"use client";

import { useSearchParams } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContactActions } from "@/components/contact-actions";
import { ClipboardList, FileText, FolderKanban, Mail, Pencil, ShieldAlert, StickyNote, Trash2, MapPinHouse } from "lucide-react";
import { ListGroup, ListRow, NativeActions, NativeMenuPage } from "@/components/native";
import { contactRows, CUSTOMER_SCREEN_TITLE, withScreen, type ContactRow, type CustomerScreen } from "@/lib/workflow/native-mode";

/**
 * Ett kundkort på nivå 1 (2026-10-09, docs/ui-system.md 9; M2 2026-10-12): the customer's name is the top bar's title,
 * Platser and Jobb are the two big tiles, the contact details are rows that call, write or open the map, then rows for
 * Projekt, Offerter and Särskilda krav –
 * each opens the card's own panel as a screen of its own (`&step=`, features/kfid/customer-card.tsx) – and Redigera kund,
 * which is the register's own edit page. Level 2–3, the tablet and the computer never draw this.
 */
const CONTACT_ICON: Partial<Record<ContactRow["key"], LucideIcon>> = { email: Mail };

export function NativeCustomerMenu({ customer, places, projects, tasks, quotes = null, onEdit, onDelete = null, ownCompany = false }: {
  customer: { name: string; contactName?: string; company?: string | null; address: string; /** Företag or Privatperson. */ typeLabel?: string; phone?: string | null; mobile?: string | null; email?: string | null; notes?: string | null; specialRequirements?: string | null };
  places: number;
  /** Null when the person may not read projects. */
  projects: number | null;
  tasks: number;
  /** The customer's quotes (2026-10-10); null when the person may not read quotes, and in Local. */
  quotes?: number | null;
  onEdit?: (() => void) | null;
  /** Ta bort kund (2026-10-22, punkt 5): beside Redigera kund, as in the page header on the computer; asks first. */
  onDelete?: (() => void) | null;
  /** Eget företag (2026-10-24): the company's own places – no contact rows, it says Företaget. */
  ownCompany?: boolean;
  /** Accepted for the caller's sake but not shown: no Nytt projekt or Ny offert shortcut on the customer page (2026-10-14, as on the computer). */
  newProjectHref?: string | null;
}) {
  const params = useSearchParams();
  const row = (key: CustomerScreen, icon: LucideIcon, extra: { value?: string; subtitle?: string; type?: "customer" | "project" | "control" | "risk" | "quote" } = {}) =>
    <ListRow key={key} type={extra.type ?? "customer"} icon={icon} title={CUSTOMER_SCREEN_TITLE[key]} href={withScreen(params.toString(), key)} testId={`native-row-${key}`} value={extra.value} subtitle={extra.subtitle} />;
  // Phone numbers and the address are the Ring and Navigera rows (2026-10-12); the e-mail stays a row of its own.
  const contact = contactRows(customer).filter((item) => item.key === "email");
  const requirements = customer.specialRequirements?.trim() ?? "";
  const sub = ownCompany ? `Företaget · ${customer.company || ""}`.replace(/ · $/, "") : [customer.typeLabel ? `Kund · ${customer.typeLabel}` : "Kund", customer.contactName ?? ""].filter(Boolean).join(" · ");
  return <NativeMenuPage testId="native-customer"
    tiles={[
      { title: CUSTOMER_SCREEN_TITLE.platser, subtitle: String(places), type: "customer", icon: MapPinHouse, href: withScreen(params.toString(), "platser"), testId: "native-row-platser" },
      { title: CUSTOMER_SCREEN_TITLE.jobb, subtitle: String(tasks), type: "control", icon: ClipboardList, href: withScreen(params.toString(), "jobb"), testId: "native-row-jobb" },
    ]}>
    <p className="min-w-0 break-words px-1 pb-1 pt-1 text-sm leading-5 text-muted-foreground" data-testid="native-customer-type">{sub}</p>
    {ownCompany ? null : <ContactActions native name={customer.name} phone={customer.phone} mobile={customer.mobile} destination={{ address: customer.address }} testId="native-customer-call" />}
    {!ownCompany && (contact.length || customer.notes?.trim()) ? <ListGroup title="Kontakt" testId="native-customer-contact">
      {contact.map((item) => <ListRow key={item.key} type="customer" icon={CONTACT_ICON[item.key] ?? Mail} title={item.value} subtitle={item.label} testId={`native-contact-${item.key}`}
        href={item.href} />)}
      {customer.notes?.trim() ? <ListRow type="customer" icon={StickyNote} title={customer.notes.trim()} subtitle="Anteckningar" wrap /> : null}
    </ListGroup> : null}
    {projects !== null || quotes !== null || requirements ? <ListGroup testId="native-customer-rows">
      {projects !== null ? row("projekt", FolderKanban, { value: String(projects), type: "project" }) : null}
      {quotes !== null ? row("offerter", FileText, { value: String(quotes), type: "quote" }) : null}
      {requirements ? row("krav", ShieldAlert, { subtitle: requirements.split("\n")[0], type: "risk" }) : null}
    </ListGroup> : null}
    {/* One action row without a chevron (audit 2026-10-12); Nytt projekt left the page 2026-10-14 like on the computer. */}
    {onEdit || onDelete ? <NativeActions testId="native-customer-actions">
      {onEdit ? <Button type="button" variant="ghost" onClick={onEdit} data-testid="native-customer-edit"><Pencil />Redigera kund</Button> : null}
      {onDelete ? <Button type="button" variant="ghost" className="text-destructive" onClick={onDelete} data-testid="customer-delete"><Trash2 />Ta bort kund</Button> : null}
    </NativeActions> : null}
  </NativeMenuPage>;
}
