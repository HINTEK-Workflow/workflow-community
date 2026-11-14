/**
 * Kund och plats i ett jobb (2026-10-08: "krånga inte till det"). A customer in the register has zero, one or
 * several places. In a work order, a task or a project the customer is chosen first and then one of that customer's
 * places:
 * - no places: no place is asked for;
 * - one active place: it is chosen at once;
 * - several: the person picks one (the customer has no default place);
 * - a new customer never keeps a place of the old one.
 * A task in a project takes the project's customer and place; another place of the same customer may be chosen.
 * Shared by Cloud, Local and the demo; the server checks the same links again (assertFacilityLink).
 */
export type CustomerPlaceLike = { id: string; customerId: string; isActive?: boolean };

/** The customer's places that can be newly chosen (paused ones only stay where already linked). */
export function activeCustomerPlaces<T extends CustomerPlaceLike>(places: readonly T[] | null | undefined, customerId: string | null | undefined): T[] {
  if (!customerId) return [];
  return (places ?? []).filter((place) => place.customerId === customerId && place.isActive !== false);
}

/**
 * The place after the customer was chosen or changed: the current one when it belongs to the new customer, else the
 * customer's only active place, else none. `auto: false` keeps the old rule (clear, never choose).
 */
export function placeAfterCustomerChange(places: readonly CustomerPlaceLike[] | null | undefined, customerId: string | null | undefined, currentPlaceId: string | null | undefined, options: { auto?: boolean } = {}): string | null {
  if (!customerId) return null;
  if (currentPlaceId && (places ?? []).some((place) => place.id === currentPlaceId && place.customerId === customerId)) return currentPlaceId;
  if (options.auto === false) return null;
  const active = activeCustomerPlaces(places, customerId);
  return active.length === 1 ? active[0].id : null;
}

/**
 * Logisk ordning (2026-10-26: "plats kan väljas innan kund och då visas en massa platser"): the customer is chosen
 * first – a customer of the register or Eget företag – and only then the place, among that customer's places. Until then
 * the place field is off with this short line. A job that already has a place but no customer (older data) may still clear it.
 */
export function placeNeedsCustomerHint(customerId: string | null | undefined, placeId: string | null | undefined): string {
  return !customerId && !placeId ? "Välj kund först." : "";
}

/** What the place field asks of the person: nothing (no customer or no places), nothing more (one, chosen) or a pick. */
export type PlaceChoice = { kind: "none" } | { kind: "single"; placeId: string } | { kind: "pick"; count: number };
export function placeChoice(places: readonly CustomerPlaceLike[] | null | undefined, customerId: string | null | undefined): PlaceChoice {
  const active = activeCustomerPlaces(places, customerId);
  if (!active.length) return { kind: "none" };
  return active.length === 1 ? { kind: "single", placeId: active[0].id } : { kind: "pick", count: active.length };
}

/** The line under the place field while a customer with several places has none chosen; otherwise nothing. */
export function placeChoiceHint(places: readonly CustomerPlaceLike[] | null | undefined, customerId: string | null | undefined, placeId: string | null | undefined) {
  if (placeId) return "";
  const choice = placeChoice(places, customerId);
  return choice.kind === "pick" ? `Kunden har ${choice.count} platser. Välj den som jobbet gäller.` : "";
}

/**
 * A task in a project (2026-09-26, kept 2026-10-08): the project's customer applies, and its place unless the
 * task already has another place of that same customer. A project without a customer leaves the task's own choice.
 * Without a place from either, the customer's only place is chosen like anywhere else.
 */
export function inheritProjectCustomerPlace(task: { customerId: string | null; facilityId?: string | null }, project: { customerId: string | null; facilityId?: string | null } | null | undefined, places: readonly CustomerPlaceLike[] | null | undefined) {
  if (!project || !project.customerId) return { customerId: task.customerId, facilityId: task.facilityId ?? null };
  const customerId = project.customerId;
  // A place the lists do not know yet (they are read on demand) is kept; the server checks it when the task is saved.
  const otherCustomers = task.facilityId ? (places ?? []).some((place) => place.id === task.facilityId && place.customerId !== customerId) : true;
  const own = task.facilityId && !otherCustomers ? task.facilityId : null;
  return { customerId, facilityId: own ?? project.facilityId ?? placeAfterCustomerChange(places, customerId, null) };
}

/** Where the task's customer and place come from, for the line under the fields ("Kund och plats följer projektet …"). */
export function customerPlaceSource(task: { customerId: string | null; facilityId?: string | null }, project: { name: string; customerId: string | null; facilityId?: string | null } | null | undefined) {
  if (!project?.customerId) return { customer: "", place: "" };
  return {
    customer: `Följer projektet ${project.name}.`,
    place: project.facilityId && task.facilityId === project.facilityId ? `Från projektet ${project.name}. Du kan välja en annan av kundens platser.` : "",
  };
}

/**
 * Whether a protocol's place field ("Projekt / anläggning") still follows the place (MEMORY 2026-10-08: "en handskriven
 * anläggningstext i protokollet ersätts aldrig av ett automatiskt val"): it is empty, or holds what the page filled in
 * by itself – a place's whole way or the project's name (`automatic`). Anything else was typed by hand: the job's only
 * place is still chosen at once (simulation 2026-10-10: a private customer's single place was not chosen), but the text
 * stays – also when the person chooses a place (2026-10-11: the place only helps find the installation).
 */
export function placeFieldFollowsPlace(text: string | null | undefined, automatic: Iterable<string>) {
  const value = (text ?? "").trim();
  if (!value) return true;
  for (const candidate of automatic) if (candidate.trim() === value) return true;
  return false;
}
