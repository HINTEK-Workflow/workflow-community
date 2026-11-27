// Short Swedish help for every input field of the public tools (2026-10-18, API-12). The catalogue's schemas stay
// as they are (the validation is untouched); this adds a description to each field that has none and replaces the long
// date regex of the JSON Schema with a short hint. "tool.field" wins over "field".
const FIELD_HELP: Record<string, string> = {
  query: "Sökord.", page: "Sidnummer, börjar på 1.", limit: "Högsta antal poster.", filter: "Urval, se verktygets beskrivning.", state: "Läge: ongoing pågående, closed avslutade, archived arkiverade.",
  taskId: "Id för uppgiften eller arbetsordern.", projectId: "Id för projektet.", customerId: "Id för kunden.", placeId: "Id för platsen.", parentId: "Id för platsen den ligger under.",
  facilityId: "Id för anläggningen.", workOrderId: "Id för arbetsordern. Ett utkast kopplas innan arbetet börjar; en kopplad uppgift kan bara flyttas till en annan arbetsorder.", sourceTaskId: "Id för uppgiften arbetsordern följer upp.", activityId: "Id för den planerade aktiviteten.",
  quoteId: "Id för offerten (från list_quotes).", basisId: "Id för fakturaunderlaget (från list_invoice_bases).", articleId: "Id för artikeln (från search_articles).",
  assignedToUserId: "Id för ansvarig person; null tar bort.", responsibleUserId: "Id för ansvarig person; null tar bort.", supplier: "Leverantör, id eller del av namnet.",
  name: "Namn.", title: "Rubrik.", description: "Beskrivning.", text: "Text.", note: "Anteckning.", notes: "Anteckningar.", status: "Status.", reason: "Orsak.", kind: "Slag.", label: "Benämning.", value: "Värde.",
  company: "Företagsnamn.", email: "E-postadress.", phone: "Telefonnummer.", mobile: "Mobilnummer.", address: "Gatuadress.", postalCode: "Postnummer.", city: "Ort.",
  workSite: "Arbetsplats.", reference: "Referens.", stage: "Etapp, en valfri etikett.", marking: "Märkning på plats, till exempel E12.", executionNotes: "Utfört arbete.",
  latitude: "Breddgrad, -90 till 90.", longitude: "Längdgrad, -180 till 180.", estimatedMinutes: "Uppskattad tid i minuter; null tar bort.",
  objectType: "Objekttyp.", criticality: "Arbetsorderns kritikalitet A, B eller C; \"\" tar bort.", manufacturer: "Tillverkare.", model: "Modell.", serialNumber: "Serienummer.", attributes: "Fria tekniska värden (benämning och värde).",
  waitingOn: "Vad en pausad arbetsorder väntar på: MATERIAL, CUSTOMER, SHUTDOWN; \"\" tar bort.", fault: "Felbeskrivning.", cause: "Orsak till felet.", causeNote: "Anteckning om orsaken.",
  rows: "Raderna som läggs till.", quantity: "Antal.", unit: "Enhet.",
  decidedBy: "Vem som beslutade.",
  partId: "Id för maskinen eller delen (från list_maintenance_parts).", days: "Antal dagar bakåt, 1–90.",
  "search_help.query": "Frågan med egna ord, till exempel hur gör jag ett fakturaunderlag.", "list_company_invoice_bases.status": "all, DRAFT (utkast som väntar) eller INVOICED (fakturerat).",
  "list_my_work.filter": "open, active, planned, action, done eller all.", "list_my_work.scope": "mine (egna, standard) eller all (alla som du får läsa).", "list_team_work.filter": "open, late, due_soon, action eller waiting.", "list_quotes.status": "open, all, DRAFT, SENT, ACCEPTED, DECLINED eller EXPIRED.",
  "update_task.status": "PLANNED planerad eller NEEDS_ACTION behöver åtgärdas.", "cancel_task.reason": "Kort orsak, 3–500 tecken.", "report_obstacle.reason": "MATERIAL, CUSTOMER, SHUTDOWN eller OTHER.",
  "report_obstacle.text": "Några ord om hindret, högst 300 tecken.", "add_project_decision.text": "Beslutets text.", "report_time.note": "Anteckning till tiden.", "report_time.timeTypeId": "Tidstypens id (list_time_entries); utan den standardtypen.", "create_invoice_basis.note": "Anteckning på underlaget.",
  "create_invoice_basis.title": "Rubrik på underlaget.", "create_place.kind": "FACILITY anläggning, BUILDING byggnad, SPACE utrymme, OBJECT objekt eller OTHER annat.",
};
const DAY_HINT = "Datum, ÅÅÅÅ-MM-DD.";
const TIME_HINT = "Tidpunkt, ÅÅÅÅ-MM-DDTHH:MM:SSZ.";

type Schema = Record<string, unknown>;

/** Adds the short descriptions and drops the date regexes, in place, through the whole schema. */
export function addFieldHelp(tool: string, schema: Schema) {
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const object = node as Schema;
    if (object.format === "date" || object.format === "date-time") delete object.pattern;
    for (const key of ["anyOf", "oneOf", "allOf"]) if (Array.isArray(object[key])) (object[key] as unknown[]).forEach(visit);
    if (object.items) visit(object.items);
    const properties = object.properties as Record<string, Schema> | undefined;
    if (!properties) return;
    for (const [field, property] of Object.entries(properties)) {
      visit(property);
      if (!property.description) {
        const text = hint(property) ?? FIELD_HELP[`${tool}.${field}`] ?? FIELD_HELP[field];
        if (text) property.description = text;
      }
    }
  };
  visit(schema);
  return schema;
}

/** A date or date-time field (also inside a union with ""): its short hint. */
function hint(property: Schema): string | undefined {
  const formats = [property, ...(Array.isArray(property.anyOf) ? (property.anyOf as Schema[]) : [])].map((part) => part.format);
  if (formats.includes("date-time")) return TIME_HINT;
  if (formats.includes("date")) return DAY_HINT;
  return undefined;
}

/** Fields of the call that the tool's input does not have (top level), for the warning. */
export function unknownFields(known: string[], input: unknown): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  return Object.keys(input).filter((key) => !known.includes(key));
}
export const unknownFieldWarnings = (fields: string[]) => fields.slice(0, 10).map((field) => `Okänt fält ”${field}” ignorerades.`);
