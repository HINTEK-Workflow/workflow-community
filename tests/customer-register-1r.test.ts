import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { breadcrumbTrail } from "../lib/workflow/navigation";

const text = (file: string) => readFileSync(file, "utf8");

// Kundregistret (2026-10-14, replaces plan 1R's list beside the card): a list page, and each customer its own page.
test("the card is sections, not tabs; its header has Ring, Navigera and Redigera, Ta bort kund stands at its foot, and there are no new project's or quote's buttons", () => {
  const card = text("features/kfid/customer-card.tsx");
  assert.doesNotMatch(card, /Kundkortets flikar/, "no tab bar");
  for (const section of ["contact", "facilities", "projects", "tasks", "quotes"]) assert.match(card, new RegExp(`id="customer-section-${section}"`));
  const start = card.indexOf("<NativeScreen show={[]}><PageHeader title=");
  assert.ok(start > 0, "the customer's page header");
  // Registrets knappar (2026-10-22, punkt 5): Ring, Navigera and Redigera together in the header's actions, top right as
  // on every other page; Ta bort kund at the foot of the page (the plan's N18, 2026-11-01); Ny kund and Papperskorg belong to the list.
  const header = card.slice(start, card.indexOf("</PageHeader>", start));
  // The company's own places (own, 2026-10-24) have no customer actions; opened as a sub-page (samband, 2026-10-26) the card
  // has its way back last.
  assert.match(header, /actions=\{editingCustomer \? undefined : own \? \(way \? <ReturnButton \/> : undefined\) : <>[\s\S]*?<ContactActions[\s\S]*?customer-edit-button[\s\S]*?<ReturnButton \/>/, "Ring, Navigera, Redigera and Ta bort kund in the header");
  assert.doesNotMatch(card, /RegisterHeader/);
  assert.doesNotMatch(card.slice(card.search(/<Panel (?:icon=\{\w+\} )?title="Kontaktuppgifter"/)), /customer-edit-button/, "Redigera is no longer in Kontaktuppgifter");
  // Anläggningar as two panels (2026-10-15 night): PlaceBrowser draws the tree panel and the place panel. Since
  // 2026-10-24 (Hantera anläggningar) Ny adress and the map are in the action card above them – no ⋯ and no QR labels.
  // placeEdit (2026-10-24): the company's own places follow the right to edit the company, a customer's canEdit.
  assert.match(card, /onNewAddress=\{placeEdit && !customer\.deletedAt \? startNewAddress : undefined\}/, "Ny adress stays");
  assert.match(card, /id="customer-section-facilities"[\s\S]*?<FacilitiesHeading own=\{own\} \/>[\s\S]*?placeList\(undefined, \{ map: mapToggle, above: map \}\)/, "the heading across the page, then the browser with the map");
  assert.doesNotMatch(card, /places-menu|EditorMoreMenu|place_labels|QrCode|workOrderHref/, "no ⋯, no QR labels and no Ny arbetsorder här in the register");
  const browser = text("features/workflow/place-browser.tsx");
  assert.match(browser, /<Panel icon=\{ListTree\} title=\{title\} description=\{treeDescription\} className="place-tree-panel">/, "the tree is an ordinary Panel without buttons");
  // Hantera anläggningar (2026-10-24): one action card above the tree and the information card, the shared icon menu.
  assert.match(browser, /<div className="place-explorer-bar">\{bar\}<\/div>[\s\S]*?place-explorer-tree/, "the action card above the tree");
  assert.match(browser, /<IconActionBar title="Hantera anläggningar"/, "the shared light icon menu");
  assert.match(browser, /place-new-top[\s\S]*?place-add-child[\s\S]*?place-edit[\s\S]*?place-show-on-map[\s\S]*?place-status[\s\S]*?place-delete[\s\S]*?places-show-map[\s\S]*?place-tree-open-all[\s\S]*?place-tree-fold-all/, "Ny adress, Nytt objekt | Redigera, Visa på karta, Pausa, Ta bort | the map and Fäll ut/ihop alla last");
  // Every section always open, no fold icon (2026-10-22, an exception to the folded history lists); Anläggningar last.
  for (const title of ["Kontaktuppgifter", "Projekt", "Uppgifter"]) assert.match(card, new RegExp(`<Panel (?:icon=\\{\\w+\\} )?title="${title}" description=`)); // the card's icon (UX-punkt 6) may stand first
  assert.doesNotMatch(card, /collapsible|defaultCollapsed/, "nothing on the customer page folds");
  assert.doesNotMatch(browser, /collapsible/, "Anläggningar does not fold either");
  assert.ok(card.indexOf(`id="customer-section-facilities"`) > card.indexOf(`id="customer-section-quotes"`), "Anläggningar is the last section");
  assert.match(card, /placeList\(undefined, \{ map: mapToggle, above: map \}\)/, "Anläggningar always open");
  // Registret skapar inga jobb (2026-10-22): no Ny arbetsorder här, no QR label and no ⋯ at a place.
  assert.doesNotMatch(browser, /place-new-work-order|taskType=WORK_ORDER|QrCode|qrHref|EditorMoreMenu/, "the place starts nothing and has no ⋯");
  // The information card shows the chosen level and has no buttons of its own on the computer (they are in the action card).
  const desk = browser.slice(browser.indexOf(`return <div data-testid="place-detail" data-place-id={place.id}>\n    <Panel`));
  assert.doesNotMatch(desk.slice(0, desk.indexOf("</Panel>")), /actions=\{/, "no buttons in the information card's header");
  assert.match(desk, /\{overview\}/, "the overview of the chosen level first");
  const placePage = text("features/workflow/place-page.tsx");
  assert.doesNotMatch(placePage, /place_labels|place-new-work-order|place-new-task|taskType=WORK_ORDER|view=new_task/, "the place page starts nothing either");
  assert.match(browser, /<Panel title=\{placeName\(place\)\} description=\{where\}/, "the open place is an ordinary Panel beside it");
  assert.doesNotMatch(browser, /place-children-list"[\s\S]*?place-content-row/, "the objects are listed in the tree only");
  assert.doesNotMatch(card, /customer-new-project/, "no Nytt projekt on the card (2026-10-14)");
  assert.match(card, /summary=\{\{ \.\.\.quotes, canCreate: false \}\}/, "no Ny offert on the card's Offerter");
  // Anläggningar som träd (2026-10-15): one tree that folds out, on the computer and the phone, and no place form page.
  assert.match(card, /<PlaceBrowser places=\{data\.facilities\}/, "the places as one tree that folds out");
  assert.doesNotMatch(card, /pageKey="plats"/, "no page of its own for the place form");
  // The form folds out on the card with no step of its own in the breadcrumbs.
  assert.ok(card.includes("usePageTrail({ customer: (data ? customerTitle(data.customer) : undefined) ?? rememberedCustomerName(customerId), ...(isOwnCompany(data?.customer) ? { ownCompany: true } : {}) }, { customerId, edit: null })"));
  // The page on its way has the read page's shape (2026-10-16, "sidan hoppar när den bygger och laddar innehåll").
  assert.match(card, /if \(!data\) return <CustomerCardSkeleton /, "a skeleton of the page while the card is read");
  assert.match(card, /<FacilitiesHeading \/><PlaceBrowserSkeleton /, "Anläggningar's heading, action card and two panels from the first drawing");
  // Kundsidans rutnät (2026-10-24): one grid in reading order – Kontaktuppgifter, Projekt, Offerter, Uppgifter.
  const order = ["contact", "projects", "quotes", "tasks"].map((name) => card.indexOf(`id="customer-section-${name}" data-section="${name}"`));
  assert.ok(order.every((index, at) => index > 0 && (at === 0 || index > order[at - 1])), `the sections in reading order: ${order}`);
});

test("the register is a list page and a customer opens on its own page, on every display", () => {
  const workspace = text("features/kfid/workspace.tsx");
  assert.match(workspace, /view === "customers" && customerId && overview && user\)\s*content = <CustomerCard/);
  assert.match(text("features/kfid/record-archive.tsx"), /<CustomerListPage/);
  assert.match(text("features/kfid/local-records.tsx"), /<CustomerListPage/);
  const layout = text("features/kfid/customer-register-layout.tsx");
  assert.doesNotMatch(layout, /Byt kund|CustomerRail|grid-cols-\[17rem/, "no list beside the card");
  assert.match(layout, /<PageHeader[\s\S]*?<ListFilterBar/, "the standard header, then the shared toppvisning");
});

test("breadcrumbs end with the customer's name; the old edit address has no step of its own on the card", () => {
  const labels = (trail: ReturnType<typeof breadcrumbTrail>) => trail.map((crumb) => crumb.label);
  // Kunder is a menu button of its own since point 5 (B2), so the trail is Översikt › Kunder › name.
  assert.deepEqual(labels(breadcrumbTrail({ view: "customers", params: { customerId: "c1" }, labels: { customer: "Fastighets AB" } })), ["Översikt", "Kunder", "Fastighets AB"]);
  // The card gives edit: null, so an old address with edit=1 reads like the card itself.
  assert.deepEqual(labels(breadcrumbTrail({ view: "customers", params: { customerId: "c1", edit: null }, labels: { customer: "Fastighets AB" } })), ["Översikt", "Kunder", "Fastighets AB"]);
});

// QR hör till driftronden (2026-10-22): the label sheet is printed from the round and lies under Driftronder; an older
// address from the register leads to the round or explains where the labels are now.
test("QR labels belong to the round, not to the customer register", () => {
  const labels = (trail: ReturnType<typeof breadcrumbTrail>) => trail.map((crumb) => crumb.label);
  assert.deepEqual(labels(breadcrumbTrail({ view: "place_labels", params: { roundId: "r1" } })), ["Översikt", "Driftronder", "QR-etiketter"]);
  assert.deepEqual(labels(breadcrumbTrail({ view: "place_labels", params: { customerId: "c1" }, labels: { customer: "Fastighets AB" } })), ["Översikt", "Driftronder", "QR-etiketter"]);
  const rounds = text("features/workflow/form-rounds.tsx");
  assert.match(rounds, /round-labels/, "the round card has its QR labels");
  const sheet = text("features/workflow/place-labels.tsx");
  assert.match(sheet, /export function PlaceLabels\(\{ roundId \}/, "the sheet is a round's");
  assert.match(sheet, /export function PlaceLabelsMoved/, "an older address is led on or explained");
  assert.match(text("features/kfid/workspace.tsx"), /if \(roundId\) return <PlaceLabels[\s\S]*?<PlaceLabelsMoved/);
  assert.doesNotMatch(text("features/workflow/workflow-task-editor.tsx"), /place_labels/, "no QR labels in Ny arbetsorder");
});

// QR-etiketter från telefonen (2026-10-23): the round's own screen in the app leads to the sheet, which is drawn in
// the app with Skriv ut; the sheet reads only the round and its own places (?labels=), not the customer's card, so a person
// who sees the round but not the customer register still gets it.
test("QR labels from the phone: the round's screen leads to them and the sheet reads only the round's places", () => {
  const rounds = text("features/workflow/form-rounds.tsx");
  assert.match(rounds, /function RoundLabelsRow[\s\S]*?title="QR-etiketter"[\s\S]*?testId="round-labels"/, "a QR-etiketter row at level 1");
  // Förenkling 0.77.0: the round's own screen is the same for everyone – the row with QR-etiketter, the facts, and Ändra rond
  // as a row of its own for someone who may change the round (the edit screen holds only the form's fields).
  assert.match(rounds, /<RoundReadOnly schedule=\{own\} action=\{action\} labels=\{labels\}[^\n]*edit=\{allowed \?/, "the round's own screen, also for a round the person may not change");
  assert.match(rounds, /testId="round-edit"/, "Ändra rond is a row of the round's screen");
  const sheet = text("features/workflow/place-labels.tsx");
  assert.doesNotMatch(sheet, /api\/customer-card/, "the sheet never reads the customer's card");
  assert.match(sheet, /\/api\/form-schedules\?labels=/);
  assert.match(sheet, /if \(native\)[\s\S]*?\{printButton\}/, "Skriv ut in the app");
  assert.match(sheet, /createPortal\(sheet\(true\), document\.body\)/, "the printed copy lies directly in body, outside the app's frame");
  assert.match(text("app/api/form-schedules/route.ts"), /params\.get\("labels"\)[\s\S]*?loadRoundLabelPlaces/);
  const server = text("lib/kfid/rounds-server.ts");
  const loader = server.slice(server.indexOf("export async function loadRoundLabelPlaces"));
  assert.match(loader, /loadScheduleViews\(ctx, today, \{ deviations: false \}\)\)\.find/, "only a round the person may see");
  // The place is the work order's that holds the round now (2026-10-27 kväll).
  assert.match(loader, /organizationId: ctx\.organizationId, customerId: holder\.customerId, isActive: true/, "within the company, the work order's customer");
  assert.match(loader, /select: \{ id: true, parentId: true, name: true, kind: true \}/, "only what a label prints (the marking left the place 2026-10-24)");
});

test("placeSubtree: a place and every place under it, nothing beside it", async () => {
  const { placeSubtree } = await import("../lib/workflow/customer-facility");
  const places = [{ id: "a", parentId: null }, { id: "b", parentId: "a" }, { id: "c", parentId: "b" }, { id: "d", parentId: null }, { id: "e", parentId: "d" }];
  assert.deepEqual(placeSubtree(places, "a").map((place) => place.id), ["a", "b", "c"]);
  assert.deepEqual(placeSubtree(places, "b").map((place) => place.id), ["b", "c"]);
  assert.deepEqual(placeSubtree(places, "x"), []);
});
