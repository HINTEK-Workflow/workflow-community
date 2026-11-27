CREATE TYPE "BillingPaymentMode" AS ENUM ('CARD', 'INVOICE_PREPAID', 'INVOICE_CREDIT');
CREATE TYPE "BillingOrderStatus" AS ENUM ('DRAFT', 'PENDING_PAYMENT', 'OPEN', 'PAID', 'CANCELED', 'REFUNDED');
CREATE TYPE "BillingOrderItemKind" AS ENUM ('CLOUD', 'CREDIT_PACKAGE');
CREATE TYPE "BankPaymentStatus" AS ENUM ('UNALLOCATED', 'PARTIALLY_ALLOCATED', 'ALLOCATED', 'OVERPAYMENT', 'REFUNDED');
CREATE TYPE "CloudEntitlementStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');
CREATE TYPE "CloudEntitlementSource" AS ENUM ('CARD_PAYMENT', 'INVOICE_PREPAID_PAYMENT', 'INVOICE_CREDIT_FINALIZED', 'ADMIN_CORRECTION');
CREATE TYPE "CreditLotOrigin" AS ENUM ('PURCHASE', 'COMPENSATION', 'LEGACY');

ALTER TABLE "CreditLot" ALTER COLUMN "purchaseId" DROP NOT NULL;
ALTER TABLE "CreditLot"
  ADD COLUMN "origin" "CreditLotOrigin" NOT NULL DEFAULT 'PURCHASE',
  ADD COLUMN "sourceKey" TEXT,
  ADD COLUMN "termsVersion" TEXT,
  ADD COLUMN "termsHash" TEXT,
  ADD COLUMN "grantedBy" TEXT,
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "noExpiryReason" TEXT;

CREATE UNIQUE INDEX "CreditLot_sourceKey_key" ON "CreditLot"("sourceKey");
DROP INDEX "CreditLot_walletId_expiresAt_idx";
CREATE INDEX "CreditLot_walletId_expiresAt_createdAt_idx" ON "CreditLot"("walletId", "expiresAt", "createdAt");
CREATE INDEX "CreditLot_walletId_origin_remaining_idx" ON "CreditLot"("walletId", "origin", "remaining");
ALTER TABLE "CreditLot" ADD CONSTRAINT "CreditLot_amount_range"
  CHECK ("credits" > 0 AND "remaining" >= 0 AND "remaining" <= "credits");
ALTER TABLE "CreditLot" ADD CONSTRAINT "CreditLot_origin_source"
  CHECK (
    ("origin" = 'PURCHASE' AND "purchaseId" IS NOT NULL) OR
    ("origin" IN ('COMPENSATION', 'LEGACY') AND "purchaseId" IS NULL)
  );

CREATE TABLE "OrganizationBillingPolicy" (
  "organizationId" TEXT NOT NULL,
  "preferredPaymentMode" "BillingPaymentMode" NOT NULL DEFAULT 'CARD',
  "invoicePrepaidEnabled" BOOLEAN NOT NULL DEFAULT true,
  "invoiceCreditEnabled" BOOLEAN NOT NULL DEFAULT false,
  "invoiceDueDays" INTEGER NOT NULL DEFAULT 10,
  "invoiceCreditLimitOre" INTEGER,
  "creditApprovedBy" TEXT,
  "creditApprovedAt" TIMESTAMP(3),
  "internalComment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganizationBillingPolicy_pkey" PRIMARY KEY ("organizationId"),
  CONSTRAINT "OrganizationBillingPolicy_due_days" CHECK ("invoiceDueDays" BETWEEN 1 AND 365),
  CONSTRAINT "OrganizationBillingPolicy_credit_rule" CHECK (
    NOT "invoiceCreditEnabled" OR
    ("invoiceCreditLimitOre" > 0 AND "creditApprovedBy" IS NOT NULL AND "creditApprovedAt" IS NOT NULL)
  )
);

CREATE TABLE "StripeCustomer" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "providerCustomerId" TEXT NOT NULL,
  "livemode" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StripeCustomer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StripeCustomer_providerCustomerId_key" ON "StripeCustomer"("providerCustomerId");
CREATE UNIQUE INDEX "StripeCustomer_organizationId_livemode_key" ON "StripeCustomer"("organizationId", "livemode");
CREATE INDEX "StripeCustomer_organizationId_idx" ON "StripeCustomer"("organizationId");

CREATE TABLE "BillingOrder" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "paymentMode" "BillingPaymentMode" NOT NULL,
  "status" "BillingOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "currency" TEXT NOT NULL DEFAULT 'SEK',
  "subtotalOre" INTEGER NOT NULL,
  "taxAmountOre" INTEGER NOT NULL,
  "totalAmountOre" INTEGER NOT NULL,
  "termsVersion" TEXT NOT NULL,
  "termsHash" TEXT NOT NULL,
  "privacyVersion" TEXT NOT NULL,
  "privacyHash" TEXT NOT NULL,
  "dpaVersion" TEXT,
  "dpaHash" TEXT,
  "creditTermsVersion" TEXT,
  "creditTermsHash" TEXT,
  "providerCheckoutId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillingOrder_amounts" CHECK (
    "subtotalOre" >= 0 AND "taxAmountOre" >= 0 AND
    "totalAmountOre" = "subtotalOre" + "taxAmountOre"
  ),
  CONSTRAINT "BillingOrder_legal_pairs" CHECK (
    (("dpaVersion" IS NULL) = ("dpaHash" IS NULL)) AND
    (("creditTermsVersion" IS NULL) = ("creditTermsHash" IS NULL))
  )
);
CREATE UNIQUE INDEX "BillingOrder_providerCheckoutId_key" ON "BillingOrder"("providerCheckoutId");
CREATE INDEX "BillingOrder_organizationId_status_createdAt_idx" ON "BillingOrder"("organizationId", "status", "createdAt");

CREATE TABLE "BillingOrderItem" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "kind" "BillingOrderItemKind" NOT NULL,
  "productKey" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "unitAmountOre" INTEGER NOT NULL,
  "subtotalOre" INTEGER NOT NULL,
  "taxAmountOre" INTEGER NOT NULL,
  "totalAmountOre" INTEGER NOT NULL,
  "credits" INTEGER,
  "periodStart" TIMESTAMP(3),
  "periodEnd" TIMESTAMP(3),
  "providerPriceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingOrderItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillingOrderItem_amounts" CHECK (
    "quantity" > 0 AND "unitAmountOre" >= 0 AND "subtotalOre" >= 0 AND
    "taxAmountOre" >= 0 AND "totalAmountOre" = "subtotalOre" + "taxAmountOre"
  ),
  CONSTRAINT "BillingOrderItem_credit_shape" CHECK (
    ("kind" = 'CREDIT_PACKAGE' AND "credits" > 0 AND "periodStart" IS NULL AND "periodEnd" IS NULL) OR
    ("kind" = 'CLOUD' AND "credits" IS NULL AND "periodStart" IS NOT NULL AND "periodEnd" IS NOT NULL AND "periodEnd" > "periodStart")
  )
);
CREATE INDEX "BillingOrderItem_orderId_kind_idx" ON "BillingOrderItem"("orderId", "kind");

ALTER TABLE "BillingInvoice"
  ADD COLUMN "orderId" TEXT,
  ADD COLUMN "providerNumber" TEXT,
  ADD COLUMN "paymentReference" TEXT,
  ADD COLUMN "paymentMode" "BillingPaymentMode",
  ADD COLUMN "invoiceDueDays" INTEGER,
  ADD COLUMN "amountPaidOre" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "finalizedAt" TIMESTAMP(3),
  ADD COLUMN "voidedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "BillingInvoice_orderId_key" ON "BillingInvoice"("orderId");
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_payment_amount"
  CHECK ("amountPaidOre" >= 0 AND "amountPaidOre" <= "totalAmountOre");
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_due_days"
  CHECK ("invoiceDueDays" IS NULL OR "invoiceDueDays" BETWEEN 1 AND 365);

CREATE TABLE "BankPayment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "amountOre" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'SEK',
  "paidAt" TIMESTAMP(3) NOT NULL,
  "reference" TEXT NOT NULL,
  "internalComment" TEXT NOT NULL,
  "verifiedBy" TEXT NOT NULL,
  "status" "BankPaymentStatus" NOT NULL DEFAULT 'UNALLOCATED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BankPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BankPayment_amount_positive" CHECK ("amountOre" > 0)
);
CREATE INDEX "BankPayment_organizationId_status_paidAt_idx" ON "BankPayment"("organizationId", "status", "paidAt");
CREATE INDEX "BankPayment_reference_idx" ON "BankPayment"("reference");

CREATE TABLE "BankPaymentAllocation" (
  "id" TEXT NOT NULL,
  "bankPaymentId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "amountOre" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BankPaymentAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BankPaymentAllocation_amount_positive" CHECK ("amountOre" > 0)
);
CREATE UNIQUE INDEX "BankPaymentAllocation_bankPaymentId_invoiceId_key" ON "BankPaymentAllocation"("bankPaymentId", "invoiceId");
CREATE INDEX "BankPaymentAllocation_invoiceId_idx" ON "BankPaymentAllocation"("invoiceId");

CREATE TABLE "CloudEntitlement" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "invoiceId" TEXT,
  "sourcePaymentEventId" TEXT,
  "sourceKey" TEXT NOT NULL,
  "source" "CloudEntitlementSource" NOT NULL,
  "status" "CloudEntitlementStatus" NOT NULL DEFAULT 'ACTIVE',
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "revokeReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CloudEntitlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CloudEntitlement_period" CHECK ("periodEnd" > "periodStart"),
  CONSTRAINT "CloudEntitlement_revoke_shape" CHECK (
    ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL AND "revokeReason" IS NOT NULL) OR
    ("status" <> 'REVOKED')
  )
);
CREATE UNIQUE INDEX "CloudEntitlement_sourceKey_key" ON "CloudEntitlement"("sourceKey");
CREATE INDEX "CloudEntitlement_organizationId_status_periodEnd_idx" ON "CloudEntitlement"("organizationId", "status", "periodEnd");
CREATE INDEX "CloudEntitlement_invoiceId_idx" ON "CloudEntitlement"("invoiceId");

CREATE TABLE "BillingAuditEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "data" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingAuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BillingAuditEvent_organizationId_createdAt_idx" ON "BillingAuditEvent"("organizationId", "createdAt");
CREATE INDEX "BillingAuditEvent_entityType_entityId_idx" ON "BillingAuditEvent"("entityType", "entityId");

ALTER TABLE "OrganizationBillingPolicy" ADD CONSTRAINT "OrganizationBillingPolicy_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StripeCustomer" ADD CONSTRAINT "StripeCustomer_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingOrder" ADD CONSTRAINT "BillingOrder_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingOrderItem" ADD CONSTRAINT "BillingOrderItem_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "BillingOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "BillingOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BankPayment" ADD CONSTRAINT "BankPayment_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankPaymentAllocation" ADD CONSTRAINT "BankPaymentAllocation_bankPaymentId_fkey"
  FOREIGN KEY ("bankPaymentId") REFERENCES "BankPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankPaymentAllocation" ADD CONSTRAINT "BankPaymentAllocation_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "BillingInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CloudEntitlement" ADD CONSTRAINT "CloudEntitlement_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CloudEntitlement" ADD CONSTRAINT "CloudEntitlement_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "BillingInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CloudEntitlement" ADD CONSTRAINT "CloudEntitlement_sourcePaymentEventId_fkey"
  FOREIGN KEY ("sourcePaymentEventId") REFERENCES "PaymentEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BillingAuditEvent" ADD CONSTRAINT "BillingAuditEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
