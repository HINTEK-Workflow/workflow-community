import { quoteCustomerDetails } from "@/lib/quotes/customer-details";
import { invoiceBasisLabel, NO_INVOICE_TAX } from "@/lib/invoice-basis/model";
import { pdfDocumentDef } from "@/lib/pdf-templates/catalog";
import { resolvePdfDocument } from "@/lib/pdf-templates/model";
import { allocateInvoiceNumber, BLANK_INVOICE_SETTINGS, buildCredit, buildInvoice, freezeInvoiceTexts, invoiceDetailsSchema, invoicePaymentState, sentToOf, standaloneInvoiceSchema, INVOICE_LIST_FILTERS, INVOICE_PAGE_SIZE, ocrNumber, sellerProblems, startNumberProblem, type InvoiceContent, type InvoiceEventItem, type InvoiceListFilter, type InvoiceListItem, type InvoiceSeller, type InvoiceSettings, type InvoiceSource } from "@/lib/customer-invoice/model";
import { DEMO_ADMIN_ID, DEMO_COMPANY, DEMO_COMPANY_DETAILS } from "./demo-data";
import { createDemoStandaloneBasis, demoInvoiceBasisRecords, demoInvoiceSeeds, DemoInvoiceBasisError, type DemoBasis, type DemoInvoiceContext } from "./demo-invoice-bases";
import { demoFileName, demoPdfResponse, demoReportIdentity, stampDemoPdf } from "./demo-pdf";

/**
 * Fakturor i demon: /api/customer-invoices answered from memory by the same pure rules as the server. Invented company details,
 * nothing leaves the browser and no e-mail is sent. Invoicing is on here, so the flow can be tried. Demofaktura (2026-11-06):
 * the invoice, its preview and the proforma are drawn as PDF in this browser and stamped Demo, and the numbers are the demo's own
 * series ("DEMO-1001"), kept in memory until the page is reloaded.
 */
type DemoInvoice = { id: string; content: InvoiceContent; paidOn: string | null; masked: string; basisId: string | null; creditOfId: string | null; creditId: string | null; correctedBy: string | null; byName: string; events: InvoiceEventItem[] };
type Store = { settings: InvoiceSettings; invoices: DemoInvoice[]; sequence: number; seeded?: boolean };
const stores = new WeakMap<object, Store>();
const SELLER: Omit<InvoiceSeller, "iban" | "bic" | "vatExempt"> = { name: DEMO_COMPANY, organizationNumber: DEMO_COMPANY_DETAILS.organizationNumber, vatNumber: DEMO_COMPANY_DETAILS.vatNumber, fSkatt: DEMO_COMPANY_DETAILS.fSkatt, address: `${DEMO_COMPANY_DETAILS.address}, ${DEMO_COMPANY_DETAILS.postalCode} ${DEMO_COMPANY_DETAILS.city}`, registeredOffice: DEMO_COMPANY_DETAILS.registeredOffice, phone: DEMO_COMPANY_DETAILS.phone, email: DEMO_COMPANY_DETAILS.email, bankgiro: DEMO_COMPANY_DETAILS.bankgiro, plusgiro: DEMO_COMPANY_DETAILS.plusgiro };
const NOT_IN_DEMO = "E-post skickas inte i demon.";
/** The demo's own series: a label that can never be mistaken for a real invoice number. */
export const DEMO_INVOICE_PREFIX = "DEMO-";
/** A number from the demo's series: always "DEMO-" first, whatever prefix the visitor gives under Inställningar. */
function demoNumber(settings: InvoiceSettings) {
  const allocated = allocateInvoiceNumber(settings);
  return allocated.label.startsWith(DEMO_INVOICE_PREFIX) ? allocated : { ...allocated, label: `${DEMO_INVOICE_PREFIX}${allocated.label}` };
}
const fail = (status: number, message: string) => new DemoInvoiceBasisError(status, message);

const storeOf = (db: object) => {
  let store = stores.get(db);
  if (!store) { store = { settings: { ...BLANK_INVOICE_SETTINGS, enabled: true, nextNumber: 1001, paymentDays: 30 }, invoices: [], sequence: 0 }; stores.set(db, store); }
  return store;
};
const sellerOf = (settings: InvoiceSettings): InvoiceSeller => ({ ...SELLER, vatNumber: settings.vatExempt ? "" : SELLER.vatNumber, iban: settings.iban, bic: settings.bic, vatExempt: settings.vatExempt });
const today = (ctx: DemoInvoiceContext) => ctx.now.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
const access = (ctx: DemoInvoiceContext) => ({ read: ctx.admin || ctx.can("invoicing", "read"), edit: ctx.admin || ctx.can("invoicing", "edit") });
const texts = (type: "invoice" | "credit_invoice") => freezeInvoiceTexts(resolvePdfDocument(pdfDocumentDef(type)!, null));
/** The document as the server draws it (lib/customer-invoice/report), from the invented company, stamped Demo. */
async function invoicePdf(content: InvoiceContent, personalNumber: string, filename: string, mode: { preview?: boolean; proforma?: boolean } = {}) {
  const [{ createCustomerInvoicePdf }, { fetchReportFonts }] = await Promise.all([import("@/lib/customer-invoice/report"), import("@/lib/workflow/report-fonts")]);
  const bytes = await createCustomerInvoicePdf({ identity: demoReportIdentity(), fontBytes: await fetchReportFonts(), content, personalNumber, ...mode });
  return demoPdfResponse(await stampDemoPdf(new Uint8Array(bytes)), demoFileName(filename));
}
const fileLabel = (label: string) => label.replace(/[^A-Za-z0-9-]+/g, "-");

function listItem(ctx: DemoInvoiceContext, invoice: DemoInvoice): InvoiceListItem {
  const { content } = invoice;
  return { id: invoice.id, kind: content.kind, number: content.number, label: content.label, title: content.title, buyerName: content.buyer.name, issuedOn: content.issuedOn, dueOn: content.dueOn, toPay: content.toPay, paidOn: invoice.paidOn,
    state: invoicePaymentState({ kind: content.kind, paidOn: invoice.paidOn, dueOn: content.dueOn, credited: Boolean(invoice.creditId) }, today(ctx)) };
}
const lastSentOf = (invoice: DemoInvoice) => invoice.events.find((event) => event.action === "sent");
const logLine = (ctx: DemoInvoiceContext, store: Store, action: string, detail = ""): InvoiceEventItem => ({ id: `demo-invoice-event-${++store.sequence}`, action, detail, actorName: ctx.user.name, createdAt: ctx.now.toISOString() });

function basisOf(ctx: DemoInvoiceContext, id: string): DemoBasis {
  const basis = demoInvoiceBasisRecords(ctx.db).bases.find((item) => item.id === id);
  if (!basis) throw fail(404, "Fakturaunderlaget hittades inte.");
  return basis;
}
function sourceOf(ctx: DemoInvoiceContext, store: Store, basis: DemoBasis): InvoiceSource {
  const customer = ctx.db.customers.find((item) => item.id === basis.customerId);
  const details = quoteCustomerDetails(customer);
  return {
    seller: sellerOf(store.settings), today: today(ctx), texts: texts("invoice"), settings: store.settings,
    buyer: { name: details.name, contactName: details.contactName, address: details.address, customerType: customer?.customerType === "PRIVATE" ? "PRIVATE" : "COMPANY" },
    basis: { label: invoiceBasisLabel(basis.number), title: basis.title, vatPercent: basis.vatPercent, tax: basis.tax ?? NO_INVOICE_TAX, lines: basis.lines },
  };
}

/** The customer's e-mail for a basis, so Skicka starts filled in (kundresa 2026-11-07, M13). */
const customerEmailOf = (ctx: DemoInvoiceContext, basisId: string | null) => {
  const basis = basisId ? demoInvoiceBasisRecords(ctx.db).bases.find((item) => item.id === basisId) : null;
  return (basis?.customerId ? ctx.db.customers.find((item) => item.id === basis.customerId)?.email : "") ?? "";
};

/**
 * Fakturor is not empty when the demo starts (kundresa 2026-11-07, M11): a paid, an unpaid and a credited invoice, issued from bases of
 * their own by the same rules as a visitor's, dated back from today, numbered from the demo's series. Made once per page load.
 */
function ensureInvoices(ctx: DemoInvoiceContext, store: Store) {
  if (store.seeded) return;
  store.seeded = true;
  const day = 86_400_000;
  const dayOf = (daysBack: number) => new Date(ctx.now.getTime() - daysBack * day).toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
  const by = ctx.db.users.find((user) => user.id === DEMO_ADMIN_ID)?.name ?? ctx.user.name;
  const event = (action: string, detail: string, on: string): InvoiceEventItem => ({ id: `demo-invoice-event-${++store.sequence}`, action, detail, actorName: by, createdAt: `${on}T09:00:00.000Z` });
  for (const seed of demoInvoiceSeeds(ctx)) {
    const issuedOn = dayOf(seed.daysBack);
    const allocated = demoNumber(store.settings);
    const built = buildInvoice({ ...sourceOf(ctx, store, seed.basis), today: issuedOn }, invoiceDetailsSchema.parse({ performedFrom: dayOf(seed.daysBack + 3), performedOn: dayOf(seed.daysBack + 1), paymentDays: "30" }), { number: allocated.number, label: allocated.label, reference: allocated.label });
    if (built.problems.length) continue;
    store.settings = { ...store.settings, nextNumber: allocated.nextNumber };
    const email = customerEmailOf(ctx, seed.basis.id);
    const invoice: DemoInvoice = { id: `demo-invoice-${++store.sequence}`, content: built.content, paidOn: null, masked: built.identity?.masked ?? "", basisId: seed.basis.id, creditOfId: null, creditId: null, correctedBy: null, byName: by,
      events: [...(email ? [event("sent", `Till ${email}.`, issuedOn)] : []), event("issued", "", issuedOn)] };
    store.invoices.push(invoice);
    if (seed.state === "paid") { invoice.paidOn = dayOf(seed.daysBack - 20); invoice.events.unshift(event("paid", `Betald ${invoice.paidOn}.`, invoice.paidOn)); }
    if (seed.state === "credited") {
      const creditOn = dayOf(seed.daysBack - 2);
      const creditNumber = demoNumber(store.settings);
      store.settings = { ...store.settings, nextNumber: creditNumber.nextNumber };
      const creditLabel = creditNumber.label;
      const reason = "Kontrollen ingick i serviceavtalet.";
      const credit: DemoInvoice = { id: `demo-invoice-${++store.sequence}`, content: buildCredit(invoice.content, { id: invoice.id, number: creditNumber.number, label: creditLabel, today: creditOn, reason, texts: texts("credit_invoice") }), paidOn: null, masked: invoice.masked, basisId: invoice.basisId, creditOfId: invoice.id, creditId: null, correctedBy: null, byName: by,
        events: [event("issued", `Krediterar ${invoice.content.label}. ${reason}`, creditOn)] };
      store.invoices.push(credit);
      invoice.creditId = credit.id;
      invoice.events.unshift(event("credited", `Kreditfaktura ${creditLabel}. ${reason}`, creditOn));
    }
  }
}

/** /api/customer-invoices in the demo. */
export function demoCustomerInvoices(ctx: DemoInvoiceContext, request: { method: string; url: URL; body: unknown }): unknown {
  const store = storeOf(ctx.db);
  ensureInvoices(ctx, store);
  const right = access(ctx);
  if (request.method === "GET") {
    const params = request.url.searchParams;
    if (params.get("settings") === "1") return { settings: { ...store.settings, issued: store.invoices.length }, connected: "", sellerProblems: sellerProblems(sellerOf(store.settings)), canEdit: ctx.admin };
    if (!store.settings.enabled || !right.read) throw fail(404, "Fakturering är inte påslagen för företaget.");
    if (params.get("state") === "1") return { enabled: true, canEdit: right.edit };
    if (params.get("offer") === "1") return { canTurnOn: false };
    if (params.has("basis")) {
      const basis = basisOf(ctx, params.get("basis")!);
      const invoice = store.invoices.find((item) => item.basisId === basis.id && item.content.kind === "INVOICE");
      return { enabled: true, canIssue: right.edit, invoice: invoice ? { id: invoice.id, label: invoice.content.label, state: listItem(ctx, invoice).state, sentOn: lastSentOf(invoice)?.createdAt.slice(0, 10) ?? null, sentTo: sentToOf(lastSentOf(invoice)?.detail ?? "") } : null, refusal: !invoice && basis.status === "INVOICED" ? "Underlaget är redan markerat som fakturerat utanför Workflow, och blir ingen faktura här." : "" };
    }
    if (params.has("prepare")) {
      const basis = basisOf(ctx, params.get("prepare")!);
      const source = sourceOf(ctx, store, basis);
      return { source, revision: basis.revision, lineVatPercent: basis.vatPercent, connected: "", customerId: basis.customerId ?? null, defaults: { email: ctx.db.customers.find((item) => item.id === basis.customerId)?.email ?? "", performedFrom: "", performedOn: today(ctx), paymentDays: String(store.settings.paymentDays ?? ""), workPlace: source.buyer.address } };
    }
    if (params.has("id")) {
      const invoice = store.invoices.find((item) => item.id === params.get("id"));
      if (!invoice) throw fail(404, "Fakturan hittades inte.");
      if (params.get("format") === "pdf") return invoicePdf(invoice.content, invoice.masked, `${invoice.content.kind === "CREDIT" ? "kreditfaktura" : "faktura"}-${fileLabel(invoice.content.label)}.pdf`);
      const credit = store.invoices.find((item) => item.id === invoice.creditId);
      return { invoice: { ...listItem(ctx, invoice), content: invoice.content, identityMasked: invoice.masked, events: invoice.events, canEdit: right.edit, createdByName: invoice.byName, basisId: invoice.basisId, creditId: invoice.creditId, creditLabel: credit?.content.label ?? "", correctedByBasisId: invoice.correctedBy, buyerEmail: customerEmailOf(ctx, invoice.basisId) } };
    }
    const raw = params.get("status");
    const filter: InvoiceListFilter = (INVOICE_LIST_FILTERS as readonly string[]).includes(raw ?? "") ? raw as InvoiceListFilter : "all";
    const q = (params.get("q") ?? "").toLocaleLowerCase("sv");
    const all = [...store.invoices].reverse().map((invoice) => listItem(ctx, invoice)).filter((item) => !q || `${item.label} ${item.title} ${item.buyerName}`.toLocaleLowerCase("sv").includes(q));
    const fits = (item: InvoiceListItem, wanted: InvoiceListFilter) => wanted === "all" || item.state === wanted;
    const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
    const items = all.filter((item) => fits(item, filter));
    return { items: items.slice((page - 1) * INVOICE_PAGE_SIZE, page * INVOICE_PAGE_SIZE), total: items.length, page, pageSize: INVOICE_PAGE_SIZE, canEdit: right.edit,
      counts: Object.fromEntries(INVOICE_LIST_FILTERS.map((wanted) => [wanted, all.filter((item) => fits(item, wanted)).length])) };
  }

  const input = (request.body ?? {}) as { action?: string; basisId?: string; revision?: number; details?: unknown; id?: string; reason?: string; paidOn?: string; settings?: Partial<InvoiceSettings> };
  if (input.action === "settings") {
    if (!ctx.admin) throw fail(403, "Bara en företagsadministratör kan göra det.");
    const next = { ...store.settings, ...input.settings };
    const problem = startNumberProblem({ nextNumber: store.settings.nextNumber, issued: store.invoices.length }, next.nextNumber);
    if (problem) throw fail(409, problem);
    store.settings = next;
    return { settings: { ...next, issued: store.invoices.length }, connected: "", sellerProblems: sellerProblems(sellerOf(next)), canEdit: true };
  }
  if (!store.settings.enabled) throw fail(404, "Fakturering är inte påslagen för företaget.");
  if (!right.edit) throw fail(403, "Du saknar rätten Fakturera.");
  if (input.action === "standalone") {
    const { customerId, title } = standaloneInvoiceSchema.parse((input as { invoice?: unknown }).invoice);
    if (customerId && !ctx.db.customers.some((item) => item.id === customerId)) throw fail(404, "Kunden hittades inte.");
    return createDemoStandaloneBasis(ctx, { customerId, title });
  }
  // The proforma and the preview are drawn here (no number is taken); an e-mail is only pretended, and nothing leaves the browser.
  if (input.action === "proforma") {
    const email = (input as { email?: string }).email ?? "";
    if (email) return { ok: true, email, notice: `I demon skickas ingen e-post. Proformafakturan hade gått till ${email}.` };
    const { content } = buildInvoice(sourceOf(ctx, store, basisOf(ctx, input.basisId ?? "")), invoiceDetailsSchema.parse(input.details));
    return invoicePdf(content, "", `proforma-${fileLabel(content.basisLabel)}.pdf`, { proforma: true });
  }
  if (input.action === "preview") {
    const built = buildInvoice(sourceOf(ctx, store, basisOf(ctx, input.basisId ?? "")), invoiceDetailsSchema.parse(input.details));
    return invoicePdf(built.content, built.identity?.masked ?? "", "faktura-forhandsgranskning.pdf", { preview: true });
  }
  if (input.action === "issue") {
    const basis = basisOf(ctx, input.basisId ?? "");
    if (basis.status !== "DRAFT") throw fail(409, "Underlaget är redan fakturerat och blir ingen ny faktura.");
    if (basis.revision !== input.revision) throw fail(409, "Underlaget har ändrats sedan du öppnade det. Läs in det igen.");
    const allocated = demoNumber(store.settings);
    const built = buildInvoice(sourceOf(ctx, store, basis), invoiceDetailsSchema.parse(input.details), { number: allocated.number, label: allocated.label, reference: store.settings.useOcr ? ocrNumber(allocated.number) : allocated.label });
    if (built.problems.length) throw fail(422, built.problems.map((problem) => problem.text).join(" "));
    store.settings = { ...store.settings, nextNumber: allocated.nextNumber };
    const invoice: DemoInvoice = { id: `demo-invoice-${++store.sequence}`, content: built.content, paidOn: null, masked: built.identity?.masked ?? "", basisId: basis.id, creditOfId: null, creditId: null, correctedBy: null, byName: ctx.user.name, events: [logLine(ctx, store, "issued")] };
    store.invoices.push(invoice);
    basis.status = "INVOICED";
    basis.invoicedAt = ctx.now.toISOString();
    basis.invoicedByName = ctx.user.name;
    basis.revision += 1;
    return { id: invoice.id, label: allocated.label };
  }
  const invoice = store.invoices.find((item) => item.id === input.id);
  if (!invoice) throw fail(404, "Fakturan hittades inte.");
  if (input.action === "credit") {
    if (invoice.content.kind !== "INVOICE") throw fail(409, "En kreditfaktura kan inte krediteras.");
    if (invoice.creditId) throw fail(409, "Fakturan är redan krediterad.");
    const allocated = demoNumber(store.settings);
    store.settings = { ...store.settings, nextNumber: allocated.nextNumber };
    const reason = (input.reason ?? "").trim();
    const credit: DemoInvoice = { id: `demo-invoice-${++store.sequence}`, content: buildCredit(invoice.content, { id: invoice.id, number: allocated.number, label: allocated.label, today: today(ctx), reason, texts: texts("credit_invoice") }), paidOn: null, masked: invoice.masked, basisId: invoice.basisId, creditOfId: invoice.id, creditId: null, correctedBy: null, byName: ctx.user.name, events: [logLine(ctx, store, "issued", `Krediterar ${invoice.content.label}. ${reason}`)] };
    store.invoices.push(credit);
    invoice.creditId = credit.id;
    invoice.events.unshift(logLine(ctx, store, "credited", `Kreditfaktura ${allocated.label}. ${reason}`));
    return { id: credit.id, label: allocated.label };
  }
  if (input.action === "paid") {
    invoice.paidOn = input.paidOn ?? today(ctx);
    invoice.events.unshift(logLine(ctx, store, "paid", `Betald ${invoice.paidOn}.`));
    return { ok: true };
  }
  if (input.action === "unpaid") {
    invoice.events.unshift(logLine(ctx, store, "unpaid", `Tidigare betald ${invoice.paidOn}.`));
    invoice.paidOn = null;
    return { ok: true };
  }
  if (input.action === "send") {
    const email = (input as { email?: string }).email ?? "";
    invoice.events.unshift(logLine(ctx, store, "sent", `Till ${email}.`));
    return { ok: true, email, notice: `I demon skickas ingen e-post. Fakturan hade gått till ${email}.` };
  }
  throw fail(403, NOT_IN_DEMO);
}
