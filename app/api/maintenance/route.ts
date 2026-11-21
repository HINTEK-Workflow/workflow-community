import { NextResponse } from "next/server";
import { z } from "zod";
import { body, checkOrigin, context, failure, requireCloudWriteAccess, requireModule } from "@/lib/kfid/server";
import { remove } from "@/lib/kfid/storage";
import { partCost, placeCost } from "@/lib/maintenance/cost-server";
import { createPlace, deletePlace, placesOf, updatePlace } from "@/lib/maintenance/place-server";
import { prisma } from "@/lib/db";
import { partMachineEvents, partMachineKeyFigures } from "@/lib/maintenance/machine-server";
import { parseKeyFigurePeriod } from "@/lib/machine/key-figures-server";
import { maintenanceAccess } from "@/lib/maintenance/model";
import { activateOrder, createPlan, deletePlan, listPlans, partPlansChanged, planningMaintenance, postponeOrder, updatePlan } from "@/lib/maintenance/plan-server";
import {
  callerOf, createItem, createPart, deleteItem, deletePart, getItem, getPart, itemsOfWorkOrder, jobPartCard, listParts, ownerChoices, removeImage, reportFault, setMainImage, updateItem, updatePart,
} from "@/lib/maintenance/server";
import {
  addStoreItem, assignStoreNumber, count, createLocation, deleteLocation, deleteStoreItem, getStore, linkSparePart, orderItem, receive, returnWithdrawal, storeArticleCard, storeLog, storePlaceCard, unlinkSparePart, updateLocation, updateStoreItem, withdraw,
} from "@/lib/maintenance/store-server";

export const dynamic = "force-dynamic";

/**
 * Underhåll (2026-10-30): the two trees, the store and the maintenance items. GET ?part=tree (the places, the equipment and the
 * owners to choose), ?part=detail&id= (one part), ?part=place_cost&id= (a place's sum; all and none too), ?part=store_place&id= and
 * ?part=store_article&id= (the store's cards), ?part=events&id=&page= and ?part=kpi&id=&days= (the machine connection
 * for the part and below), ?part=cost&id=, ?part=store (&q= &low=1), ?part=log&itemId=, ?part=item&id=, ?part=work_order&id=
 * (the items a work order holds), ?part=plans&id= (the part's maintenance plans), ?part=planning&from=&to= (the plans' work orders
 * for Planering → Kalender). POST changes; every call checks the session, the company, the rights (lib/maintenance/),
 * Cloud write access and Origin. Cloud only.
 */
const noStore = { "Cache-Control": "private, no-store" };
const id = z.string().trim().min(1).max(100);

export async function GET(request: Request) {
  try {
    const ctx = await context();
    const caller = callerOf(ctx);
    const url = new URL(request.url);
    const param = (key: string) => id.parse(url.searchParams.get(key) ?? "");
    const json = (value: unknown) => NextResponse.json(value, { headers: noStore });
    switch (url.searchParams.get("part")) {
      case "tree": { const tree = await listParts(caller); return json({ ...tree, places: await placesOf(prisma, caller.organizationId), owners: await ownerChoices(caller), canEdit: maintenanceAccess(caller).edit }); }
      case "detail": return json(await getPart(caller, param("id")));
      case "job_card": return json(await jobPartCard(caller, param("id")));
      case "events": return json(await partMachineEvents(caller, param("id"), Number(url.searchParams.get("page")) || 1));
      case "kpi": return json(await partMachineKeyFigures(caller, param("id"), parseKeyFigurePeriod(url.searchParams.get("days"))));
      case "cost": return json(await partCost(caller, param("id")));
      case "place_cost": return json(await placeCost(caller, param("id")));
      case "store_place": { const place = url.searchParams.get("id"); return json(await storePlaceCard(caller, place ? param("id") : null)); }
      case "store_article": return json(await storeArticleCard(caller, param("id")));
      case "store": return json(await getStore(caller, { q: url.searchParams.get("q") ?? "", low: url.searchParams.get("low") === "1" }));
      case "log": return json(await storeLog(caller, param("itemId")));
      case "item": return json({ item: await getItem(caller, param("id")) });
      case "work_order": return json(await itemsOfWorkOrder(caller, param("id")));
      case "plans": return json(await listPlans(caller, param("id")));
      case "planning": return json(await planningMaintenance(caller, url.searchParams.get("from") ?? "", url.searchParams.get("to") ?? ""));
      default: return NextResponse.json({ error: "Okänd begäran." }, { status: 400 });
    }
  } catch (error) {
    return failure(error);
  }
}

const quantity = z.union([z.string().max(20), z.number()]);
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_place"), place: z.unknown() }),
  z.object({ action: z.literal("update_place"), id, version: z.number().int().min(1), place: z.unknown() }),
  z.object({ action: z.literal("delete_place"), id }),
  z.object({ action: z.literal("create_part"), part: z.unknown() }),
  z.object({ action: z.literal("update_part"), id, version: z.number().int().min(1), part: z.unknown() }),
  z.object({ action: z.literal("delete_part"), id }),
  z.object({ action: z.literal("main_image"), id }),
  z.object({ action: z.literal("delete_image"), id }),
  z.object({ action: z.literal("link_spare"), partId: id, article: z.unknown().optional(), itemId: id.optional(), quantity: quantity.optional() }),
  z.object({ action: z.literal("unlink_spare"), id }),
  z.object({ action: z.literal("create_location"), location: z.unknown() }),
  z.object({ action: z.literal("update_location"), id, location: z.unknown() }),
  z.object({ action: z.literal("delete_location"), id }),
  z.object({ action: z.literal("add_store_item"), article: z.unknown() }),
  z.object({ action: z.literal("update_store_item"), id, minQuantity: quantity.nullable().optional(), item: z.record(z.string(), z.unknown()).optional() }),
  z.object({ action: z.literal("assign_store_number"), id, storeId: id.nullable().optional() }),
  z.object({ action: z.literal("delete_store_item"), id }),
  z.object({ action: z.literal("receive"), move: z.unknown() }),
  z.object({ action: z.literal("count"), move: z.unknown() }),
  z.object({ action: z.literal("withdraw"), move: z.unknown() }),
  z.object({ action: z.literal("return"), id }),
  z.object({ action: z.literal("order"), id, quantity: quantity.optional() }),
  z.object({ action: z.literal("create_item"), item: z.unknown() }),
  z.object({ action: z.literal("update_item"), id, version: z.number().int().min(1), item: z.unknown() }),
  z.object({ action: z.literal("delete_item"), id }),
  z.object({ action: z.literal("report_fault"), report: z.unknown() }),
  z.object({ action: z.literal("create_plan"), plan: z.unknown() }),
  z.object({ action: z.literal("update_plan"), id, version: z.number().int().min(1), plan: z.unknown() }),
  z.object({ action: z.literal("delete_plan"), id }),
  z.object({ action: z.literal("activate_order"), id }),
  z.object({ action: z.literal("postpone_order"), id, day: z.string().trim().max(10) }),
]);

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    await requireCloudWriteAccess(ctx);
    requireModule(ctx, "upkeep");
    const caller = callerOf(ctx);
    const input = requestSchema.parse(await body(request));
    const json = (value: unknown) => NextResponse.json(value);
    switch (input.action) {
      case "create_place": return json(await createPlace(caller, input.place));
      case "update_place": return json(await updatePlace(caller, input.id, input.version, input.place));
      case "delete_place": return json(await deletePlace(caller, input.id));
      case "create_part": return json(await createPart(caller, input.part));
      case "update_part": {
        const saved = await updatePart(caller, input.id, input.version, input.part);
        // Drifttimmar or a pause changed: the part's plans fill again (a failure here never undoes the saved part).
        await partPlansChanged(caller.organizationId, input.id).catch(() => undefined);
        return json(saved);
      }
      case "delete_part": { const { removedFiles } = await deletePart(caller, input.id); for (const file of removedFiles) await remove(file); return json({ ok: true }); }
      case "main_image": return json(await setMainImage(caller, input.id));
      case "delete_image": { await remove(await removeImage(caller, input.id)); return json({ ok: true }); }
      case "link_spare": return json(await linkSparePart(caller, input.partId, { article: input.article, itemId: input.itemId, quantity: input.quantity }));
      case "unlink_spare": return json(await unlinkSparePart(caller, input.id));
      case "create_location": return json(await createLocation(caller, input.location));
      case "update_location": return json(await updateLocation(caller, input.id, input.location));
      case "delete_location": return json(await deleteLocation(caller, input.id));
      case "add_store_item": return json(await addStoreItem(caller, input.article));
      case "update_store_item": return json(await updateStoreItem(caller, input.id, { ...input.item, ...(input.minQuantity === undefined ? {} : { minQuantity: input.minQuantity }) }));
      case "assign_store_number": return json(await assignStoreNumber(caller, input.id, { storeId: input.storeId }));
      case "delete_store_item": return json(await deleteStoreItem(caller, input.id));
      case "receive": return json(await receive(caller, input.move));
      case "count": return json(await count(caller, input.move));
      case "withdraw": return json(await withdraw(caller, input.move));
      case "return": return json(await returnWithdrawal(caller, input.id));
      // The store orders through a purchase: the only part of Underhåll that needs Inköp och artiklar.
      case "order": requireModule(ctx, "purchasing"); return json(await orderItem(caller, input.id, { quantity: input.quantity }));
      case "create_item": return json(await createItem(caller, input.item));
      case "update_item": return json(await updateItem(caller, input.id, input.version, input.item));
      case "delete_item": return json(await deleteItem(caller, input.id));
      case "report_fault": return json(await reportFault(caller, input.report));
      case "create_plan": return json(await createPlan(caller, input.plan));
      case "update_plan": return json(await updatePlan(caller, input.id, input.version, input.plan));
      case "delete_plan": return json(await deletePlan(caller, input.id));
      case "activate_order": return json(await activateOrder(caller, input.id));
      case "postpone_order": return json(await postponeOrder(caller, input.id, input.day));
    }
  } catch (error) {
    return failure(error);
  }
}
