-- Integrationsmotorn E3 (2026-10-24, beslut 1 och 6, plan docs/proposals/integrationsmotor-plan-2026-10-24.md):
-- rules as data on a signal – a fixed list of comparisons with hysteresis and duration – that make canonical events for the
-- existing alarm chain, and each rule's current state. Additive: two new tables. All data so far is test data.

CREATE TABLE "MachineSignalRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "value" JSONB,
    "hysteresis" DOUBLE PRECISION,
    "forSeconds" INTEGER NOT NULL DEFAULT 0,
    "outcomeType" TEXT NOT NULL,
    "outcomeCode" TEXT NOT NULL,
    "outcomeSeverity" TEXT NOT NULL,
    "outcomeState" TEXT,
    "outcomeText" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MachineSignalRule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MachineSignalRule_operator_check" CHECK ("operator" IN ('eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'changed', 'stale')),
    CONSTRAINT "MachineSignalRule_outcome_check" CHECK ("outcomeType" IN ('alarm', 'state', 'diagnosis') AND "outcomeSeverity" IN ('info', 'warning', 'fault', 'critical')
      AND ("outcomeState" IS NULL OR "outcomeState" IN ('running', 'stopped')) AND ("outcomeType" <> 'state' OR "outcomeState" IS NOT NULL)
      AND "outcomeCode" ~ '^[!-~]{1,64}$' AND char_length("outcomeText") <= 200),
    CONSTRAINT "MachineSignalRule_numbers_check" CHECK ("forSeconds" BETWEEN 0 AND 86400 AND ("hysteresis" IS NULL OR ("hysteresis" >= 0 AND "hysteresis" < 1e12)))
);
CREATE UNIQUE INDEX "MachineSignalRule_id_organizationId_key" ON "MachineSignalRule"("id", "organizationId");
CREATE INDEX "MachineSignalRule_signalId_idx" ON "MachineSignalRule"("signalId");
CREATE INDEX "MachineSignalRule_organizationId_isActive_idx" ON "MachineSignalRule"("organizationId", "isActive");
ALTER TABLE "MachineSignalRule" ADD CONSTRAINT "MachineSignalRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MachineSignalRule" ADD CONSTRAINT "MachineSignalRule_signalId_organizationId_fkey" FOREIGN KEY ("signalId", "organizationId") REFERENCES "MachineSignal"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MachineRuleState" (
    "ruleId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "activeSince" TIMESTAMP(3),
    "pendingSince" TIMESTAMP(3),
    "lastValue" JSONB,
    "evaluatedAt" TIMESTAMP(3),

    CONSTRAINT "MachineRuleState_pkey" PRIMARY KEY ("ruleId")
);
ALTER TABLE "MachineRuleState" ADD CONSTRAINT "MachineRuleState_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "MachineSignalRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
