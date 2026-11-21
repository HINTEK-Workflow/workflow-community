-- CreateEnum
CREATE TYPE "CloudSubscriptionStatus" AS ENUM ('PENDING', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED');

-- CreateEnum
CREATE TYPE "BillingInvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'OVERDUE', 'VOID', 'CREDITED');

-- CreateEnum
CREATE TYPE "CreditPurchaseStatus" AS ENUM ('PENDING', 'PAID', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "CloudSubscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerCustomerId" TEXT,
    "providerSubscriptionId" TEXT,
    "providerPriceId" TEXT,
    "status" "CloudSubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "priceAmountOre" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SEK',
    "pricesIncludeVat" BOOLEAN,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloudSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingInvoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "providerInvoiceId" TEXT,
    "status" "BillingInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotalOre" INTEGER NOT NULL,
    "taxAmountOre" INTEGER NOT NULL,
    "totalAmountOre" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SEK',
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditPurchase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "packageKey" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "subtotalOre" INTEGER NOT NULL,
    "taxAmountOre" INTEGER NOT NULL,
    "totalAmountOre" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SEK',
    "providerCheckoutId" TEXT,
    "providerPaymentIntentId" TEXT,
    "status" "CreditPurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "creditEntryId" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadHash" TEXT,
    "status" "PaymentEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CloudSubscription_providerSubscriptionId_key" ON "CloudSubscription"("providerSubscriptionId");

-- CreateIndex
CREATE INDEX "CloudSubscription_organizationId_status_idx" ON "CloudSubscription"("organizationId", "status");

-- CreateIndex
CREATE INDEX "CloudSubscription_providerCustomerId_idx" ON "CloudSubscription"("providerCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingInvoice_providerInvoiceId_key" ON "BillingInvoice"("providerInvoiceId");

-- CreateIndex
CREATE INDEX "BillingInvoice_organizationId_status_createdAt_idx" ON "BillingInvoice"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "BillingInvoice_subscriptionId_idx" ON "BillingInvoice"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditPurchase_providerCheckoutId_key" ON "CreditPurchase"("providerCheckoutId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditPurchase_providerPaymentIntentId_key" ON "CreditPurchase"("providerPaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditPurchase_creditEntryId_key" ON "CreditPurchase"("creditEntryId");

-- CreateIndex
CREATE INDEX "CreditPurchase_organizationId_status_createdAt_idx" ON "CreditPurchase"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_providerEventId_key" ON "PaymentEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "PaymentEvent_organizationId_createdAt_idx" ON "PaymentEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentEvent_status_createdAt_idx" ON "PaymentEvent"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "CloudSubscription" ADD CONSTRAINT "CloudSubscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "CloudSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditPurchase" ADD CONSTRAINT "CreditPurchase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditPurchase" ADD CONSTRAINT "CreditPurchase_creditEntryId_fkey" FOREIGN KEY ("creditEntryId") REFERENCES "CreditEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
