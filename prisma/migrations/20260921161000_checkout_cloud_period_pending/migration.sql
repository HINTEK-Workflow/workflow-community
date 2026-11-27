ALTER TABLE "BillingOrderItem"
  DROP CONSTRAINT "BillingOrderItem_credit_shape";

ALTER TABLE "BillingOrderItem"
  ADD CONSTRAINT "BillingOrderItem_credit_shape" CHECK (
    ("kind" = 'CREDIT_PACKAGE' AND "credits" > 0 AND "periodStart" IS NULL AND "periodEnd" IS NULL) OR
    (
      "kind" = 'CLOUD' AND "credits" IS NULL AND
      (
        ("periodStart" IS NULL AND "periodEnd" IS NULL) OR
        ("periodStart" IS NOT NULL AND "periodEnd" IS NOT NULL AND "periodEnd" > "periodStart")
      )
    )
  );
