-- Tenant relations, security hardening step 2 (2026-10-08): the follow-ups from 20261009200000_tenant_composite_relations.
--
-- 1. Checks existing rows first. A row that already points into another organization stops the migration with a clear
--    message and the counts – nothing is deleted or rewritten here; such rows must be investigated by a person.
-- 2. Composite foreign keys [x, organizationId] -> [id, organizationId], delete rule unchanged (RESTRICT):
--    AiRunEvent.run, AiMessage.run, AiProposal.proposedByMessage and, in HINTEK's billing (ee/, same schema),
--    BillingOrder.amendsOrder, BillingInvoice.replacesInvoice, BillingNotice.invoice, BillingAdjustment.invoice and
--    BillingAdjustment.purchase.
-- 3. Triggers where a composite key would break SET NULL on the required organizationId: BillingInvoice.subscription,
--    BillingInvoice.order and CloudEntitlement.invoice. RoundReminderDelivery.userId (a delivery log without a relation)
--    gets the same membership check as the OAuth codes. The triggers check only when the link itself changes, so
--    existing rows and the SET NULL cascades are never tripped.
-- Prisma does not manage triggers, so they are not schema drift (same convention as 20260925180000_tenant_hardening).

-- ---------- 1. Pre-check ----------
DO $$
DECLARE
  event_run INT;
  message_run INT;
  proposal_message INT;
  order_amends INT;
  invoice_subscription INT;
  invoice_order INT;
  invoice_replaces INT;
  notice_invoice INT;
  entitlement_invoice INT;
  adjustment_invoice INT;
  adjustment_purchase INT;
  delivery_member INT;
BEGIN
  SELECT count(*) INTO event_run FROM "AiRunEvent" e JOIN "AiRun" r ON r."id" = e."runId" WHERE r."organizationId" <> e."organizationId";
  SELECT count(*) INTO message_run FROM "AiMessage" m JOIN "AiRun" r ON r."id" = m."runId" WHERE r."organizationId" <> m."organizationId";
  SELECT count(*) INTO proposal_message FROM "AiProposal" p JOIN "AiMessage" m ON m."id" = p."proposedByMessageId" WHERE m."organizationId" <> p."organizationId";
  SELECT count(*) INTO order_amends FROM "BillingOrder" o JOIN "BillingOrder" a ON a."id" = o."amendsOrderId" WHERE a."organizationId" <> o."organizationId";
  SELECT count(*) INTO invoice_subscription FROM "BillingInvoice" i JOIN "CloudSubscription" s ON s."id" = i."subscriptionId" WHERE s."organizationId" <> i."organizationId";
  SELECT count(*) INTO invoice_order FROM "BillingInvoice" i JOIN "BillingOrder" o ON o."id" = i."orderId" WHERE o."organizationId" <> i."organizationId";
  SELECT count(*) INTO invoice_replaces FROM "BillingInvoice" i JOIN "BillingInvoice" r ON r."id" = i."replacesInvoiceId" WHERE r."organizationId" <> i."organizationId";
  SELECT count(*) INTO notice_invoice FROM "BillingNotice" n JOIN "BillingInvoice" i ON i."id" = n."invoiceId" WHERE i."organizationId" <> n."organizationId";
  SELECT count(*) INTO entitlement_invoice FROM "CloudEntitlement" e JOIN "BillingInvoice" i ON i."id" = e."invoiceId" WHERE i."organizationId" <> e."organizationId";
  SELECT count(*) INTO adjustment_invoice FROM "BillingAdjustment" a JOIN "BillingInvoice" i ON i."id" = a."invoiceId" WHERE i."organizationId" <> a."organizationId";
  SELECT count(*) INTO adjustment_purchase FROM "BillingAdjustment" a JOIN "CreditPurchase" p ON p."id" = a."purchaseId" WHERE p."organizationId" <> a."organizationId";

  IF event_run + message_run + proposal_message + order_amends + invoice_subscription + invoice_order + invoice_replaces
     + notice_invoice + entitlement_invoice + adjustment_invoice + adjustment_purchase > 0 THEN
    RAISE EXCEPTION 'Tenant relations (step 2): rows point into another organization – nothing was changed. AiRunEvent.run=%, AiMessage.run=%, AiProposal.proposedByMessage=%, BillingOrder.amendsOrder=%, BillingInvoice.subscription=%, BillingInvoice.order=%, BillingInvoice.replacesInvoice=%, BillingNotice.invoice=%, CloudEntitlement.invoice=%, BillingAdjustment.invoice=%, BillingAdjustment.purchase=%. Investigate these rows by hand (see docs/proposals/security-hardening-local-2026-10-08.md).',
      event_run, message_run, proposal_message, order_amends, invoice_subscription, invoice_order, invoice_replaces,
      notice_invoice, entitlement_invoice, adjustment_invoice, adjustment_purchase
      USING ERRCODE = '23503';
  END IF;

  -- Not a cross-tenant link by itself (a person may have left the company since): reported, never a stop.
  SELECT count(*) INTO delivery_member FROM "RoundReminderDelivery" d
    WHERE NOT EXISTS (SELECT 1 FROM "OrganizationMember" m WHERE m."organizationId" = d."organizationId" AND m."userId" = d."userId");
  IF delivery_member > 0 THEN
    RAISE NOTICE 'Tenant relations (step 2): reminder deliveries whose person is no longer a member (kept as they are): RoundReminderDelivery=%.', delivery_member;
  END IF;
END $$;

-- ---------- 2. Composite foreign keys ----------
CREATE UNIQUE INDEX "AiRun_id_organizationId_key" ON "AiRun"("id", "organizationId");
CREATE UNIQUE INDEX "AiMessage_id_organizationId_key" ON "AiMessage"("id", "organizationId");
-- One message per run, as before ("AiMessage_runId_key" stays); Prisma needs the pair unique for the one-to-one relation.
CREATE UNIQUE INDEX "AiMessage_runId_organizationId_key" ON "AiMessage"("runId", "organizationId");
CREATE UNIQUE INDEX "BillingOrder_id_organizationId_key" ON "BillingOrder"("id", "organizationId");
CREATE UNIQUE INDEX "BillingInvoice_id_organizationId_key" ON "BillingInvoice"("id", "organizationId");
CREATE UNIQUE INDEX "BillingInvoice_replacesInvoiceId_organizationId_key" ON "BillingInvoice"("replacesInvoiceId", "organizationId");
CREATE UNIQUE INDEX "CreditPurchase_id_organizationId_key" ON "CreditPurchase"("id", "organizationId");

ALTER TABLE "AiRunEvent" DROP CONSTRAINT "AiRunEvent_runId_fkey";
ALTER TABLE "AiRunEvent" ADD CONSTRAINT "AiRunEvent_runId_organizationId_fkey"
  FOREIGN KEY ("runId", "organizationId") REFERENCES "AiRun"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AiMessage" DROP CONSTRAINT "AiMessage_runId_fkey";
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_runId_organizationId_fkey"
  FOREIGN KEY ("runId", "organizationId") REFERENCES "AiRun"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AiProposal" DROP CONSTRAINT "AiProposal_proposedByMessageId_fkey";
ALTER TABLE "AiProposal" ADD CONSTRAINT "AiProposal_proposedByMessageId_organizationId_fkey"
  FOREIGN KEY ("proposedByMessageId", "organizationId") REFERENCES "AiMessage"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BillingOrder" DROP CONSTRAINT "BillingOrder_amendsOrderId_fkey";
ALTER TABLE "BillingOrder" ADD CONSTRAINT "BillingOrder_amendsOrderId_organizationId_fkey"
  FOREIGN KEY ("amendsOrderId", "organizationId") REFERENCES "BillingOrder"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BillingInvoice" DROP CONSTRAINT "BillingInvoice_replacesInvoiceId_fkey";
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_replacesInvoiceId_organizationId_fkey"
  FOREIGN KEY ("replacesInvoiceId", "organizationId") REFERENCES "BillingInvoice"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BillingNotice" DROP CONSTRAINT "BillingNotice_invoiceId_fkey";
ALTER TABLE "BillingNotice" ADD CONSTRAINT "BillingNotice_invoiceId_organizationId_fkey"
  FOREIGN KEY ("invoiceId", "organizationId") REFERENCES "BillingInvoice"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BillingAdjustment" DROP CONSTRAINT "BillingAdjustment_invoiceId_fkey";
ALTER TABLE "BillingAdjustment" ADD CONSTRAINT "BillingAdjustment_invoiceId_organizationId_fkey"
  FOREIGN KEY ("invoiceId", "organizationId") REFERENCES "BillingInvoice"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BillingAdjustment" DROP CONSTRAINT "BillingAdjustment_purchaseId_fkey";
ALTER TABLE "BillingAdjustment" ADD CONSTRAINT "BillingAdjustment_purchaseId_organizationId_fkey"
  FOREIGN KEY ("purchaseId", "organizationId") REFERENCES "CreditPurchase"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- 3. Triggers ----------
-- An invoice's subscription and order (both SET NULL), checked when the link changes.
CREATE OR REPLACE FUNCTION "workflow_assert_billing_invoice_tenant"() RETURNS trigger AS $$
DECLARE
  moved BOOLEAN := TG_OP = 'INSERT' OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId";
BEGIN
  IF NEW."subscriptionId" IS NOT NULL AND (moved OR NEW."subscriptionId" IS DISTINCT FROM OLD."subscriptionId") AND NOT EXISTS (
    SELECT 1 FROM "CloudSubscription" WHERE "id" = NEW."subscriptionId" AND "organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'Abonnemanget tillhör inte samma organisation.' USING ERRCODE = '23503';
  END IF;
  IF NEW."orderId" IS NOT NULL AND (moved OR NEW."orderId" IS DISTINCT FROM OLD."orderId") AND NOT EXISTS (
    SELECT 1 FROM "BillingOrder" WHERE "id" = NEW."orderId" AND "organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'Beställningen tillhör inte samma organisation.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BillingInvoice_links_tenant" BEFORE INSERT OR UPDATE OF "subscriptionId", "orderId", "organizationId" ON "BillingInvoice"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_billing_invoice_tenant"();

-- An entitlement's invoice (SET NULL), checked when the link changes.
CREATE OR REPLACE FUNCTION "workflow_assert_cloud_entitlement_tenant"() RETURNS trigger AS $$
BEGIN
  IF NEW."invoiceId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."invoiceId" IS DISTINCT FROM OLD."invoiceId" OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId") AND NOT EXISTS (
    SELECT 1 FROM "BillingInvoice" WHERE "id" = NEW."invoiceId" AND "organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'Fakturan tillhör inte samma organisation.' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CloudEntitlement_invoice_tenant" BEFORE INSERT OR UPDATE OF "invoiceId", "organizationId" ON "CloudEntitlement"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_cloud_entitlement_tenant"();

-- A round reminder is delivered to a member of the round's company: the same membership check as OAuth codes and grants
-- (workflow_assert_oauth_member from 20261009200000, generic over "organizationId" and "userId"). The worker only sends
-- to active members, so this never stops a reminder; a later removal of the member does not touch the log.
CREATE TRIGGER "RoundReminderDelivery_member" BEFORE INSERT OR UPDATE OF "organizationId", "userId" ON "RoundReminderDelivery"
  FOR EACH ROW EXECUTE FUNCTION "workflow_assert_oauth_member"();
