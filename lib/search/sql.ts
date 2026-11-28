import { Prisma } from "@prisma/client";
import { PLACE_KIND_LABELS, PLACE_MAX_DEPTH } from "@/lib/workflow/customer-facility";
import { canViewTeam, hasWorkflowPermission, readableTaskScope, type WorkflowPermissionProfile, type WorkflowPermissionSubject } from "@/lib/workflow/permissions";
import { ARCHIVE_KIND_LABELS, archiveReadableSubjects } from "@/lib/workflow/report-archive";
import { readableTaskSql } from "@/lib/workflow/task-access";
import { tempPlaceLabel, tempPlaceOf } from "@/lib/workflow/temp-place";
import { swedishDayKey } from "@/lib/swedish-time";
import { INCIDENT_TYPES } from "@/lib/self-inspection/incidents";
import { customerCandidate, deviationCandidate, invoiceBasisCandidate, machineCandidate, personCandidate, placeCandidate, projectCandidate, quoteCandidate, reportCandidate, roundCandidate, taskCandidate } from "./candidates";
import { typoAllowance } from "./normalize";
import { trigramSql } from "./trgm-sql";
import type { ParsedSearch, SearchAlternative, SearchStatusKey } from "./query";
import type { SearchCandidate, SearchType } from "./types";
import { customerTitleSql } from "@/lib/kfid/customer-name";
import { MODULE_OF_SEARCH_TYPE, moduleOn } from "@/lib/workflow/modules";

/**
 * The SQL of Sök in Cloud (2026-10-05), kept apart from the database so it can be checked without one. One
 * bounded query per kind of record, run in parallel by lib/search/server.ts, each inside the company and
 * the person's rights exactly as the page that opens the record:
 *   projects – projects:read; tasks – readableTaskSql (work orders, risk assessments, protocols by their form's area);
 *   customers and places – the right Kunder (beslut 10, 2026-11-01: a person with only a job there gets a limited card, never a search of the register); rounds –
 *   the round's form area, like Driftronder; people – company admins only, like Användare under Inställningar.
 * A record that the person may not see is never read, so neither its title nor the counts can leak.
 *
 * Matching: every query word (or one of its spellings) must occur in the record's folded text (search_fold(), the
 * same folding as lib/search/normalize.ts). Cost: the company's rows of that kind are read through the
 * (organizationId, …) indexes and each is folded and compared once, O(rows × words), with at most FETCH rows sent on
 * for ranking. A second pass allows typing errors in titles and names: with pg_trgm (migration 20261005160000) by
 * word_similarity, otherwise over the most recently changed rows. Measured shapes: a few thousand rows per kind and
 * company is a few milliseconds per query; 50 000 tasks with protocol answers stays well under 200 ms.
 */
/** The customer's heading (2026-11-01, beslut 18) in the search's answers; `cu` is every query's name for the customer. */
const CUSTOMER_TITLE = Prisma.raw(customerTitleSql("cu"));
export const SEARCH_FETCH = 40;
export const SEARCH_FETCH_ONE_TYPE = 80;
const FUZZY_FETCH = 30;
const FALLBACK_FETCH = 300;
// Loose on purpose: the ranking then keeps only words within one or two typing errors.
export const TYPO_SIMILARITY = 0.3;
/** The typing-error pass runs when the whole search gave fewer hits than this (not per kind; quality check F10). */
export const TYPO_PASS_BELOW = 5;

const likeEscape = (value: string) => value.replace(/[\\%_]/g, "\\$&");
const regexEscape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TRUE = Prisma.sql`true`;
const FALSE = Prisma.sql`false`;
const and = (parts: Prisma.Sql[]) => (parts.length ? Prisma.sql`(${Prisma.join(parts, " AND ")})` : TRUE);
const or = (parts: Prisma.Sql[]) => (parts.length ? Prisma.sql`(${Prisma.join(parts, " OR ")})` : FALSE);
const fold = (expression: Prisma.Sql) => Prisma.sql`search_fold(${expression})`;

function alternativeSql(alternative: SearchAlternative, haystack: Prisma.Sql) {
  if (alternative.mode === "infix") return Prisma.sql`${haystack} LIKE ${`%${likeEscape(alternative.text)}%`}`;
  // \m and \M are the start and end of a word in PostgreSQL's regular expressions.
  return Prisma.sql`${haystack} ~ ${`\\m${regexEscape(alternative.text)}${alternative.mode === "word" ? "\\M" : ""}`}`;
}


/** The place's name (placeName() in SQL; the marking moved to the work order 2026-10-24). */
const placeLabelSql = (alias: string) => {
  const a = Prisma.raw(`"${alias}"`);
  return Prisma.sql`${a}.name`;
};
/** Every place's whole way, "Kund › Anläggning › Byggnad › Objekt", for the company's places only. */
const placePathsCte = (organizationId: string) => Prisma.sql`WITH RECURSIVE chain AS (
    SELECT f.id AS leaf, f."parentId" AS parent, 1 AS depth, ${placeLabelSql("f")} AS label
    FROM "CustomerFacility" f WHERE f."organizationId" = ${organizationId}
    UNION ALL
    SELECT c.leaf, p."parentId", c.depth + 1, ${placeLabelSql("p")}
    FROM chain c JOIN "CustomerFacility" p ON p.id = c.parent AND p."organizationId" = ${organizationId}
    WHERE c.depth < ${PLACE_MAX_DEPTH}
  ), paths AS (
    SELECT ch.leaf AS id, concat_ws(' › ', nullif(${Prisma.raw(customerTitleSql("pc"))}, ''), string_agg(ch.label, ' › ' ORDER BY ch.depth DESC)) AS path
    FROM chain ch JOIN "CustomerFacility" lf ON lf.id = ch.leaf JOIN "Customer" pc ON pc.id = lf."customerId"
    GROUP BY ch.leaf, pc.name, pc.company, pc."customerType"
  )`;

/** Every place's whole way for the company, read once per search (or from the short cache in lib/search/server.ts). */
export const placePathsSql = (organizationId: string) => Prisma.sql`${placePathsCte(organizationId)} SELECT id, path FROM paths`;
/** The company's place ways, computed once and handed to every kind's query (quality check 2026-10-05, F10). */
export type PlacePaths = { ids: string[]; paths: string[] };
const givenPathsCte = (given: PlacePaths) => Prisma.sql`WITH paths AS (SELECT * FROM unnest(${given.ids}::text[], ${given.paths}::text[]) AS given(id, path))`;

export type SearchRow = Record<string, unknown>;
type Row = SearchRow;
export type SearchSpec = {
  type: SearchType;
  paths: boolean;
  select: Prisma.Sql;
  from: Prisma.Sql;
  id: Prisma.Sql;
  title: Prisma.Sql;
  updated: Prisma.Sql;
  /** Text to fold while searching (short: names around the record, or a small record's own fields), once per row. */
  light: Prisma.Sql;
  /**
   * The record's own fields and answers, folded when the row is written: the generated column "searchText" from
   * migration 20261005160000, so long protocol answers are never folded while searching.
   */
  stored?: Prisma.Sql;
  where: Prisma.Sql[];
  status: (key: SearchStatusKey) => Prisma.Sql;
  customer?: Prisma.Sql;
  place?: Prisma.Sql;
  map: (row: Row) => SearchCandidate;
};

type Spec = SearchSpec;
function filterSql(spec: Spec, parsed: ParsedSearch): Prisma.Sql[] {
  const parts: Prisma.Sql[] = [];
  if (parsed.filters.status) parts.push(spec.status(parsed.filters.status));
  if (parsed.filters.customer) parts.push(spec.customer ? Prisma.sql`coalesce(${fold(spec.customer)}, '') LIKE ${`%${likeEscape(parsed.filters.customer)}%`}` : FALSE);
  if (parsed.filters.place) parts.push(spec.place ? Prisma.sql`coalesce(${fold(spec.place)}, '') LIKE ${`%${likeEscape(parsed.filters.place)}%`}` : FALSE);
  return parts;
}

/**
 * One kind's query. "match": every word in the folded text, best titles first. "typo": titles that look like a query
 * word (pg_trgm's word <% title, with pg_trgm.word_similarity_threshold set by the caller), or without pg_trgm the
 * most recently changed rows for the ranking to check.
 */
export function buildSearchSql(spec: Spec, parsed: ParsedSearch, organizationId: string, limit: number, mode: "match" | "typo", trigram: boolean | string, places?: PlacePaths): Prisma.Sql {
  const ids = parsed.ids.length ? Prisma.sql`(${spec.id} IN (${Prisma.join(parsed.ids)}))` : FALSE;
  const hasFilter = Boolean(parsed.filters.status || parsed.filters.customer || parsed.filters.place || parsed.filters.types);
  let condition: Prisma.Sql;
  let order: Prisma.Sql;
  let take = limit;
  if (mode === "match") {
    const haystacks = [...(spec.stored ? [spec.stored] : []), Prisma.sql`x.h`];
    const termSql = (term: ParsedSearch["terms"][number]) => or(haystacks.flatMap((haystack) => term.alternatives.map((alternative) => alternativeSql(alternative, haystack))));
    const words = parsed.terms.length ? and(parsed.terms.map(termSql)) : hasFilter ? TRUE : FALSE;
    condition = Prisma.sql`(${ids} OR ${words})`;
    const first = parsed.terms[0]?.text ?? "";
    order = Prisma.sql`${parsed.ids.length ? Prisma.sql`${ids} DESC, ` : Prisma.empty}(${fold(spec.title)} LIKE ${`${likeEscape(parsed.folded)}%`}) DESC, (${fold(spec.title)} LIKE ${`%${likeEscape(first)}%`}) DESC, ${spec.updated} DESC`;
  } else {
    const words = parsed.terms.filter((term) => typoAllowance(term.text.length) > 0 && !/\d/.test(term.text)).map((term) => term.text);
    if (!words.length) {
      condition = FALSE;
      order = Prisma.sql`${spec.updated} DESC`;
    } else if (trigram) {
      // word <% title can use the trigram indexes; the threshold is set for this transaction only.
      // Qualified with pg_trgm's schema when it is known (`trigram` is then its name), so a search path without it works.
      const trgm = trigramSql(trigram);
      const similarity = Prisma.sql`greatest(${Prisma.join(words.map((word) => trgm.wordSimilarity(word, fold(spec.title))))})`;
      condition = or(words.map((word) => trgm.wordSimilar(word, fold(spec.title))));
      order = Prisma.sql`${similarity} DESC, ${spec.updated} DESC`;
      take = FUZZY_FETCH;
    } else {
      // Without pg_trgm the ranking checks the most recently changed rows for typing errors instead.
      condition = TRUE;
      order = Prisma.sql`${spec.updated} DESC`;
      take = FALLBACK_FETCH;
    }
  }
  return Prisma.sql`${spec.paths ? places ? givenPathsCte(places) : placePathsCte(organizationId) : Prisma.empty}
    SELECT ${spec.select}, count(*) OVER()::int AS "searchTotal"
    FROM ${spec.from}
    ${mode === "match" ? Prisma.sql`CROSS JOIN LATERAL (SELECT ${fold(spec.light)} AS h OFFSET 0) x` : Prisma.empty}
    WHERE ${and([...spec.where, ...filterSql(spec, parsed)])} AND ${condition}
    ORDER BY ${order}
    LIMIT ${take}`;
}

/** Who is searching: the company, the person and their rights (the same fields as lib/kfid/server.ts's context). */
export type SearchSqlAccess = { organizationId: string; userId: string; admin: boolean; workflowPermissions: WorkflowPermissionProfile;
  /** Företagets moduler (0.39.0): the search leaves out what the company has turned off; the record itself still opens by its link. */
  disabledModules?: readonly string[] | null };

const text = (value: unknown) => (typeof value === "string" ? value : "");
/** A task's temporary place (data.tempPlace) as searchable text: address, postcode and city. */
const TEMP_PLACE_TEXT = Prisma.sql`t.data->'tempPlace'->>'address', t.data->'tempPlace'->>'postalCode', t.data->'tempPlace'->>'city'`;
const stamp = (value: unknown) => (value instanceof Date ? value : typeof value === "string" ? value : null);

/** The queries this person may run, one per kind of record they may see and the filters allow. */
export function searchSpecs(ctx: SearchSqlAccess, parsed: ParsedSearch): Spec[] {
  const organization = ctx.organizationId;
  const me = ctx.userId;
  const can = (subject: WorkflowPermissionSubject) => ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, subject, "read");
  const inCompany = (type: SearchType) => !MODULE_OF_SEARCH_TYPE[type] || moduleOn(ctx.disabledModules, MODULE_OF_SEARCH_TYPE[type]);
  const wanted = (type: SearchType) => inCompany(type) && (!parsed.filters.types || parsed.filters.types.includes(type));
  const list: Spec[] = [];

  if (wanted("task") && readableTaskScope(can).any) {
    const kinds = parsed.filters.taskKinds;
    // Hör till arbetsorder (Fas 2, Fas 4B): a task is also found by its work order's title – read only for a person who
    // may read work orders, inside the same company (the link's composite key).
    const workOrders = can("work-order");
    list.push({
      type: "task", paths: true,
      select: Prisma.sql`t.id, t.kind, t."formArea", t.title, left(t.description, 500) AS description, t.status, t."assignedToName", t."assignedToUserId", t."createdBy", t."updatedAt", t.data->'details'->>'templateName' AS "templateName", p.name AS "projectName", ${CUSTOMER_TITLE} AS "customerName", pp.path AS "placePath", t.data->'tempPlace' AS "tempPlace", ${workOrders ? Prisma.sql`wo.title` : Prisma.sql`NULL::text`} AS "workOrderTitle"`,
      from: Prisma.sql`"WorkflowTask" t
        LEFT JOIN "Project" p ON p.id = t."projectId" AND p."organizationId" = t."organizationId"
        LEFT JOIN "Customer" cu ON cu.id = t."customerId" AND cu."organizationId" = t."organizationId"
        LEFT JOIN paths pp ON pp.id = t."facilityId"${workOrders ? Prisma.sql`
        LEFT JOIN "WorkflowTask" wo ON wo.id = t."workOrderId" AND wo."organizationId" = t."organizationId" AND wo.kind = 'WORK_ORDER'` : Prisma.empty}`,
      id: Prisma.sql`t.id`, title: Prisma.sql`t.title`, updated: Prisma.sql`t."updatedAt"`,
      // The temporary place (2026-10-08) lives in the task's data and is found like the register place.
      light: Prisma.sql`concat_ws(' ', p.name, cu.name, cu.company, pp.path, ${TEMP_PLACE_TEXT}${workOrders ? Prisma.sql`, wo.title` : Prisma.empty})`,
      // Title, type, assignee, description and a protocol's answers or a work order's notes (never the form's own copy).
      stored: Prisma.sql`t."searchText"`,
      where: [Prisma.sql`t."organizationId" = ${organization}`, readableTaskSql(can, "t"), ...(kinds ? [Prisma.sql`t.kind IN (${Prisma.join(kinds)})`] : [])],
      status: (key) => key === "open" ? Prisma.sql`t.status NOT IN ('COMPLETED', 'CANCELLED')` : key === "done" ? Prisma.sql`t.status = 'COMPLETED'` : key === "cancelled" ? Prisma.sql`t.status = 'CANCELLED'`
        : key === "planned" ? Prisma.sql`t.status = 'PLANNED'` : key === "in_progress" ? Prisma.sql`t.status = 'IN_PROGRESS'` : key === "paused" ? Prisma.sql`t.status = 'PAUSED'` : key === "needs_action" ? Prisma.sql`t.status = 'NEEDS_ACTION'` : FALSE,
      customer: Prisma.sql`concat_ws(' ', cu.name, cu.company)`, place: Prisma.sql`concat_ws(' ', pp.path, ${TEMP_PLACE_TEXT})`,
      map: (row) => taskCandidate({ tempPlace: tempPlaceLabel(tempPlaceOf({ tempPlace: row.tempPlace })), id: text(row.id), kind: text(row.kind), title: text(row.title), description: text(row.description), status: text(row.status), assignedToName: text(row.assignedToName), assignedToUserId: text(row.assignedToUserId) || null, createdBy: text(row.createdBy), updatedAt: stamp(row.updatedAt), templateName: text(row.templateName), projectName: text(row.projectName), customerName: text(row.customerName), placePath: text(row.placePath), workOrderTitle: text(row.workOrderTitle), guaranteed: true }, me),
    });
  }
  // Sparade rapporter (Rapportarkivet, 2026-10-12): the same rule as the archive's own list (listArchive) – the
  // company's reports whose permission area the person may read; the task, project, customer and place are only
  // read for their names, inside the same company.
  const reportSubjects = archiveReadableSubjects(can);
  if (wanted("report") && reportSubjects.length) {
    const kindLabel = Prisma.sql`CASE e.kind ${Prisma.join(Object.entries(ARCHIVE_KIND_LABELS).map(([kind, label]) => Prisma.sql`WHEN ${kind} THEN ${label}`), " ")} ELSE 'Rapport' END`;
    const day = Prisma.sql`(e."createdAt" AT TIME ZONE 'Europe/Stockholm')`;
    const dayText = Prisma.sql`to_char(${day}, 'YYYY-MM-DD') || ' ' || extract(day FROM ${day})::int || ' ' || (ARRAY['januari','februari','mars','april','maj','juni','juli','augusti','september','oktober','november','december'])[extract(month FROM ${day})::int] || ' ' || extract(year FROM ${day})::int`;
    list.push({
      type: "report", paths: true,
      select: Prisma.sql`e.id, e.kind, e.title, e.format, e.filename, e.size, e."createdAt", e."createdById", ${CUSTOMER_TITLE} AS "customerName", p.name AS "projectName", pp.path AS "placePath", u.name AS "createdByName"`,
      from: Prisma.sql`"ReportArchiveEntry" e
        LEFT JOIN "WorkflowTask" t ON t.id = e."taskId" AND t."organizationId" = e."organizationId"
        LEFT JOIN "Project" p ON p.id = coalesce(e."projectId", t."projectId") AND p."organizationId" = e."organizationId"
        LEFT JOIN "Customer" cu ON cu.id = coalesce(t."customerId", p."customerId") AND cu."organizationId" = e."organizationId"
        LEFT JOIN paths pp ON pp.id = t."facilityId"
        LEFT JOIN "User" u ON u.id = e."createdById"`,
      id: Prisma.sql`e.id`, title: Prisma.sql`e.title`, updated: Prisma.sql`e."createdAt"`,
      light: Prisma.sql`concat_ws(' ', e.title, ${kindLabel}, 'rapport', e.format, CASE WHEN e.format = 'XLSX' THEN 'excel xlsx' ELSE 'pdf' END, CASE WHEN e.kind = 'FORM' THEN 'protokoll' END, cu.name, cu.company, p.name, pp.path, ${TEMP_PLACE_TEXT}, u.name, e.filename, ${dayText})`,
      where: [Prisma.sql`e."organizationId" = ${organization}`, Prisma.sql`e.subject IN (${Prisma.join(reportSubjects)})`],
      status: () => FALSE,
      customer: Prisma.sql`concat_ws(' ', cu.name, cu.company)`, place: Prisma.sql`concat_ws(' ', pp.path, ${TEMP_PLACE_TEXT})`,
      map: (row) => reportCandidate({ id: text(row.id), kind: text(row.kind), title: text(row.title), format: text(row.format), filename: text(row.filename), size: Number(row.size) || 0, createdAt: stamp(row.createdAt) ?? "", createdByName: text(row.createdByName), customerName: text(row.customerName), projectName: text(row.projectName), placePath: text(row.placePath), mine: text(row.createdById) === me, guaranteed: true }),
    });
  }
  if (wanted("project") && can("projects")) list.push({
    type: "project", paths: true,
    select: Prisma.sql`pr.id, pr.name, left(pr.description, 500) AS description, pr.client, pr.reference, pr."workSite", pr."contactPerson", pr."responsibleName", pr."responsibleUserId", pr."createdBy", pr."archivedAt", pr."closedAt", pr."updatedAt", ${CUSTOMER_TITLE} AS "customerName", pp.path AS "placePath"`,
    from: Prisma.sql`"Project" pr
      LEFT JOIN "Customer" cu ON cu.id = pr."customerId" AND cu."organizationId" = pr."organizationId"
      LEFT JOIN paths pp ON pp.id = pr."facilityId"`,
    id: Prisma.sql`pr.id`, title: Prisma.sql`pr.name`, updated: Prisma.sql`pr."updatedAt"`,
    light: Prisma.sql`concat_ws(' ', pr.name, pr.reference, pr.client, pr."contactPerson", pr."responsibleName", pr."workSite", cu.name, cu.company, pp.path, pr.description, 'projekt')`,
    where: [Prisma.sql`pr."organizationId" = ${organization}`],
    status: (key) => key === "archived" ? Prisma.sql`pr."archivedAt" IS NOT NULL` : key === "done" ? Prisma.sql`pr."archivedAt" IS NULL AND pr."closedAt" IS NOT NULL`
      : key === "open" || key === "planned" || key === "in_progress" ? Prisma.sql`pr."archivedAt" IS NULL AND pr."closedAt" IS NULL` : FALSE,
    customer: Prisma.sql`concat_ws(' ', cu.name, cu.company, pr.client)`, place: Prisma.sql`concat_ws(' ', pp.path, pr."workSite")`,
    map: (row) => projectCandidate({ id: text(row.id), name: text(row.name), description: text(row.description), client: text(row.client), reference: text(row.reference), workSite: text(row.workSite), contactPerson: text(row.contactPerson), responsibleName: text(row.responsibleName), responsibleUserId: text(row.responsibleUserId) || null, createdBy: text(row.createdBy), archivedAt: stamp(row.archivedAt), closedAt: stamp(row.closedAt), updatedAt: stamp(row.updatedAt), customerName: text(row.customerName), placePath: text(row.placePath), guaranteed: true }, me),
  });
  // Offerter (2026-10-09, steg B): the latest version of each quote, with the right Offerter – like Mina offerter.
  if (wanted("quote") && can("quotes")) list.push({
    type: "quote", paths: true,
    select: Prisma.sql`q.id, q.number, q.version, q.title, left(q.description, 500) AS description, q.status::text AS status, q."validUntil", q."createdById", q."updatedAt", ${CUSTOMER_TITLE} AS "customerName", p.name AS "projectName", pp.path AS "placePath"`,
    from: Prisma.sql`"Quote" q
      LEFT JOIN "Customer" cu ON cu.id = q."customerId" AND cu."organizationId" = q."organizationId"
      LEFT JOIN "Project" p ON p.id = q."projectId" AND p."organizationId" = q."organizationId"
      LEFT JOIN paths pp ON pp.id = q."facilityId"`,
    id: Prisma.sql`q.id`, title: Prisma.sql`q.title`, updated: Prisma.sql`q."updatedAt"`,
    // O-0021 also without the dash ("o0021").
    light: Prisma.sql`concat_ws(' ', q.title, 'O-' || lpad(q.number::text, 4, '0'), 'O' || lpad(q.number::text, 4, '0'), q.number::text, cu.name, cu.company, p.name, pp.path, left(q.description, 500), 'offert')`,
    where: [Prisma.sql`q."organizationId" = ${organization}`, Prisma.sql`q."supersededAt" IS NULL`],
    status: (key) => key === "open" ? Prisma.sql`q.status IN ('DRAFT', 'SENT')` : key === "done" ? Prisma.sql`q.status = 'ACCEPTED'` : key === "archived" ? Prisma.sql`q.status IN ('DECLINED', 'EXPIRED')` : FALSE,
    customer: Prisma.sql`concat_ws(' ', cu.name, cu.company)`, place: Prisma.sql`pp.path`,
    map: (row) => quoteCandidate({ id: text(row.id), number: Number(row.number) || 0, version: Number(row.version) || 1, title: text(row.title), description: text(row.description), status: text(row.status), validUntil: text(row.validUntil), customerName: text(row.customerName), projectName: text(row.projectName), placePath: text(row.placePath), createdBy: text(row.createdById), updatedAt: stamp(row.updatedAt), guaranteed: true }, me),
  });
  // Fakturaunderlag (2026-10-10, simulation 0.6.3): with the right Offerter (the basis's own rule, lib/invoice-basis/server.ts)
  // and only where the job or the project it is made on may be read – like the basis itself.
  if (wanted("invoice_basis") && can("quotes")) list.push({
    type: "invoice_basis", paths: false,
    select: Prisma.sql`b.id, b.number, b.title, b.status::text AS status, b."taskId", b."projectId", b."createdById", b."updatedAt", t.kind AS "taskKind", t.title AS "taskTitle", p.name AS "projectName", ${CUSTOMER_TITLE} AS "customerName"`,
    from: Prisma.sql`"InvoiceBasis" b
      LEFT JOIN "WorkflowTask" t ON t.id = b."taskId" AND t."organizationId" = b."organizationId"
      LEFT JOIN "Project" p ON p.id = b."projectId" AND p."organizationId" = b."organizationId"
      LEFT JOIN "Customer" cu ON cu.id = b."customerId" AND cu."organizationId" = b."organizationId"`,
    id: Prisma.sql`b.id`, title: Prisma.sql`b.title`, updated: Prisma.sql`b."updatedAt"`,
    light: Prisma.sql`concat_ws(' ', b.title, 'F-' || lpad(b.number::text, 4, '0'), 'F' || lpad(b.number::text, 4, '0'), b.number::text, cu.name, cu.company, t.title, p.name, 'fakturaunderlag faktura')`,
    where: [
      Prisma.sql`b."organizationId" = ${organization}`,
      Prisma.sql`(b."taskId" IS NOT NULL OR b."projectId" IS NOT NULL)`,
      Prisma.sql`(b."taskId" IS NULL OR (t.id IS NOT NULL AND ${readableTaskSql(can, "t")}))`,
      can("projects") ? Prisma.sql`true` : Prisma.sql`b."projectId" IS NULL`,
    ],
    status: (key) => key === "open" || key === "draft" ? Prisma.sql`b.status = 'DRAFT'` : key === "done" ? Prisma.sql`b.status = 'INVOICED'` : FALSE,
    customer: Prisma.sql`concat_ws(' ', cu.name, cu.company)`,
    map: (row) => invoiceBasisCandidate({ id: text(row.id), number: Number(row.number) || 0, title: text(row.title), status: text(row.status), taskId: text(row.taskId) || null, taskKind: text(row.taskKind) || null, taskTitle: text(row.taskTitle), projectId: text(row.projectId) || null, projectName: text(row.projectName), customerName: text(row.customerName), createdBy: text(row.createdById), updatedAt: stamp(row.updatedAt), guaranteed: true }, me),
  });
  if (wanted("customer") && can("customers")) list.push({
    type: "customer", paths: false,
    select: Prisma.sql`cu.id, cu.name, cu.company, cu."customerType", cu.address, cu."postalCode", cu.city, cu.email, cu.phone, cu.mobile, left(cu.notes, 500) AS notes, cu."updatedAt"`,
    from: Prisma.sql`"Customer" cu`,
    id: Prisma.sql`cu.id`, title: CUSTOMER_TITLE, updated: Prisma.sql`cu."updatedAt"`,
    light: Prisma.sql`concat_ws(' ', cu.name, cu.company, cu.address, cu."postalCode", cu.city, cu.email, cu.phone, cu.mobile, regexp_replace(cu.phone || ' ' || cu.mobile, '[^0-9]', '', 'g'), cu.notes)`,
    // Eget företag (2026-10-24): the company's own record is no customer to find; its places are found as places.
    where: [Prisma.sql`cu."organizationId" = ${organization}`, Prisma.sql`cu."deletedAt" IS NULL`, Prisma.sql`cu."ownCompany" = false`],
    status: (key) => (key === "open" ? TRUE : FALSE),
    customer: Prisma.sql`concat_ws(' ', cu.name, cu.company)`,
    map: (row) => customerCandidate({ id: text(row.id), name: text(row.name), company: text(row.company), customerType: text(row.customerType), address: text(row.address), postalCode: text(row.postalCode), city: text(row.city), email: text(row.email), phone: text(row.phone), mobile: text(row.mobile), notes: text(row.notes), updatedAt: stamp(row.updatedAt), guaranteed: true }),
  });
  if (wanted("place") && can("customers")) {
    const kindLabel = Prisma.sql`CASE f.kind ${Prisma.join(Object.entries(PLACE_KIND_LABELS).map(([kind, label]) => Prisma.sql`WHEN ${kind} THEN ${label}`), " ")} ELSE '' END`;
    list.push({
      type: "place", paths: true,
      select: Prisma.sql`f.id, f."customerId", f.name, f.kind, left(f.description, 500) AS description, f."isActive", f.address, f.city, f."updatedAt", ${CUSTOMER_TITLE} AS "customerName", coalesce(pa.path, ${CUSTOMER_TITLE}) AS "parentPath"`,
      from: Prisma.sql`"CustomerFacility" f
        JOIN "Customer" cu ON cu.id = f."customerId" AND cu."organizationId" = f."organizationId"
        LEFT JOIN paths pp ON pp.id = f.id
        LEFT JOIN paths pa ON pa.id = f."parentId"`,
      id: Prisma.sql`f.id`, title: Prisma.sql`f.name`, updated: Prisma.sql`f."updatedAt"`,
      light: Prisma.sql`concat_ws(' ', f.name, ${kindLabel}, pp.path, cu.company, f.address, f.city, f.description)`,
      where: [Prisma.sql`f."organizationId" = ${organization}`, Prisma.sql`cu."deletedAt" IS NULL`],
      status: (key) => key === "open" ? Prisma.sql`f."isActive"` : key === "archived" || key === "paused" ? Prisma.sql`NOT f."isActive"` : FALSE,
      customer: Prisma.sql`concat_ws(' ', cu.name, cu.company)`, place: Prisma.sql`pp.path`,
      map: (row) => placeCandidate({ id: text(row.id), customerId: text(row.customerId), name: text(row.name), kind: text(row.kind), description: text(row.description), isActive: Boolean(row.isActive), address: text(row.address), city: text(row.city), updatedAt: stamp(row.updatedAt), customerName: text(row.customerName), parentPath: text(row.parentPath), guaranteed: true }, false),
    });
  }
  const scope = readableTaskScope(can);
  const roundDay = swedishDayKey(new Date());
  if (wanted("round") && (ctx.admin || scope.areas.length)) list.push({
    type: "round", paths: true,
    select: Prisma.sql`s.id, s.title, s.active, s."assignedToName", s."assignedToUserId", s."updatedAt", coalesce(nullif(ft."displayName", ''), ft.name, 'Formuläret finns inte längre') AS "templateName", ${CUSTOMER_TITLE} AS "customerName", pp.path AS "placePath", p.name AS "projectName"`,
    // Where the round is done is its work order's (2026-10-27 kväll): the one that holds it today – its customer, place
    // and project – never what an older round stored of its own.
    from: Prisma.sql`"FormSchedule" s
      LEFT JOIN "FormTemplate" ft ON ft.id = s."templateId" AND (ft."organizationId" IS NULL OR ft."organizationId" = s."organizationId")
      LEFT JOIN LATERAL (SELECT w."customerId", w."facilityId", w."projectId" FROM "WorkflowTask" w
        WHERE w."organizationId" = s."organizationId" AND w.kind = 'WORK_ORDER' AND w."roundScheduleId" = s.id AND w.status <> 'CANCELLED'
          AND (w."roundOccurrence" = ${roundDay} OR (w."roundOccurrence" IS NULL AND w."plannedStartDate" <= ${roundDay} AND w."dueDate" >= ${roundDay}))
        ORDER BY (w.status = 'COMPLETED'), w."plannedStartDate" DESC LIMIT 1) wo ON true
      LEFT JOIN "Customer" cu ON cu.id = wo."customerId" AND cu."organizationId" = s."organizationId"
      LEFT JOIN "Project" p ON p.id = wo."projectId" AND p."organizationId" = s."organizationId"
      LEFT JOIN paths pp ON pp.id = wo."facilityId"`,
    id: Prisma.sql`s.id`, title: Prisma.sql`s.title`, updated: Prisma.sql`s."updatedAt"`,
    light: Prisma.sql`concat_ws(' ', s.title, ft."displayName", ft.name, s."assignedToName", cu.name, cu.company, pp.path, p.name, 'driftrond rond')`,
    // Like Driftronder (lib/kfid/rounds-server.ts): the round's form area decides; a missing form counts as Formulär.
    where: [Prisma.sql`s."organizationId" = ${organization}`, Prisma.sql`s."deletedAt" IS NULL`, ...(ctx.admin ? [] : [Prisma.sql`coalesce(ft."permissionArea", 'forms') IN (${Prisma.join(scope.areas)})`])],
    status: (key) => key === "open" ? Prisma.sql`s.active` : key === "paused" || key === "archived" ? Prisma.sql`NOT s.active` : FALSE,
    customer: Prisma.sql`concat_ws(' ', cu.name, cu.company)`, place: Prisma.sql`pp.path`,
    map: (row) => roundCandidate({ id: text(row.id), title: text(row.title), active: Boolean(row.active), assignedToName: text(row.assignedToName), assignedToUserId: text(row.assignedToUserId) || null, updatedAt: stamp(row.updatedAt), templateName: text(row.templateName), customerName: text(row.customerName), placePath: text(row.placePath), projectName: text(row.projectName), guaranteed: true }, me),
  });
  // Avvikelser (N16, 2026-11-01): the rule of the log itself (deviationReadWhere, lib/self-inspection/incidents.ts) as SQL:
  // admins every entry; others the open types they reported or answer for, and the incidents they reported – all of them with Teamet.
  if (wanted("deviation")) {
    const mineOrResponsible = Prisma.sql`(d."reportedById" = ${me} OR d."responsibleUserId" = ${me})`;
    // Every type but the incidents keeps the log's rule, the company's own types ("OWN:<namn>") too.
    const readable = ctx.admin ? TRUE : Prisma.sql`((d.type NOT IN (${Prisma.join([...INCIDENT_TYPES])}) AND ${mineOrResponsible}) OR (d.type IN (${Prisma.join([...INCIDENT_TYPES])})${canViewTeam(ctx) ? Prisma.empty : Prisma.sql` AND d."reportedById" = ${me}`}))`;
    list.push({
      type: "deviation", paths: false,
      select: Prisma.sql`d.id, d.number, d.type, d.kind, d.title, d.status, d."dueDate", left(d.description, 500) AS description, left(d.action, 500) AS action, d."reportedById", d."responsibleUserId", d."updatedAt"`,
      from: Prisma.sql`"SelfInspectionDeviation" d`,
      id: Prisma.sql`d.id`, title: Prisma.sql`d.title`, updated: Prisma.sql`d."updatedAt"`,
      light: Prisma.sql`concat_ws(' ', d.title, d.number::text, d.description, d.action, d."whatHappened", d.cause, CASE d.type WHEN 'NEAR_MISS' THEN 'tillbud' WHEN 'ACCIDENT' THEN 'olycksfall' WHEN 'RISK_OBSERVATION' THEN 'riskobservation' END, CASE d.kind WHEN 'IMPROVEMENT' THEN 'förbättring' ELSE 'avvikelse' END)`,
      where: [Prisma.sql`d."organizationId" = ${organization}`, readable],
      status: (key) => key === "open" ? Prisma.sql`d.status <> 'DONE'` : key === "done" ? Prisma.sql`d.status = 'DONE'` : key === "in_progress" ? Prisma.sql`d.status = 'IN_PROGRESS'` : FALSE,
      map: (row) => deviationCandidate({ id: text(row.id), number: Number(row.number) || 0, type: text(row.type), kind: text(row.kind), title: text(row.title), status: text(row.status), dueDate: text(row.dueDate), description: text(row.description), action: text(row.action), updatedAt: stamp(row.updatedAt), mine: row.reportedById === me || row.responsibleUserId === me }),
    });
  }
  // Maskiner (N16, 2026-11-01): Underhåll's tree, with its right to read; Sök itself is Cloud only (app/api/search/route.ts).
  if (wanted("machine") && can("maintenance")) list.push({
    type: "machine", paths: false,
    select: Prisma.sql`mp.id, mp.name, mp."partType", mp.marking, left(mp.notes, 500) AS notes, mp."isActive", mp."updatedAt"`,
    from: Prisma.sql`"MachinePart" mp`,
    id: Prisma.sql`mp.id`, title: Prisma.sql`mp.name`, updated: Prisma.sql`mp."updatedAt"`,
    light: Prisma.sql`concat_ws(' ', mp.name, mp."partType", mp.marking, mp.notes, 'maskin')`,
    where: [Prisma.sql`mp."organizationId" = ${organization}`],
    status: (key) => key === "open" ? Prisma.sql`mp."isActive"` : key === "archived" ? Prisma.sql`NOT mp."isActive"` : FALSE,
    map: (row) => machineCandidate({ id: text(row.id), name: text(row.name), partType: text(row.partType), marking: text(row.marking), notes: text(row.notes), isActive: Boolean(row.isActive), updatedAt: stamp(row.updatedAt) }),
  });
  if (wanted("person") && ctx.admin && !parsed.filters.status && !parsed.filters.customer && !parsed.filters.place) list.push({
    type: "person", paths: false,
    select: Prisma.sql`u.id, u.name, u.email, m.role::text AS role, m."updatedAt"`,
    from: Prisma.sql`"OrganizationMember" m JOIN "User" u ON u.id = m."userId"`,
    id: Prisma.sql`u.id`, title: Prisma.sql`coalesce(u.name, u.email)`, updated: Prisma.sql`m."updatedAt"`,
    light: Prisma.sql`concat_ws(' ', u.name, u.email)`,
    where: [Prisma.sql`m."organizationId" = ${organization}`, Prisma.sql`m."isActive"`, Prisma.sql`u."isActive"`],
    status: () => FALSE,
    map: (row) => personCandidate({ id: text(row.id), name: text(row.name), email: text(row.email), role: text(row.role) }),
  });
  return list;
}

/** Sök for one company and person; `expand` asks for more of one kind ("Visa alla"). */
