-- A campaign discount lowers the total: total = subtotal - discount + VAT, for the order and for each order line.
-- Orders without discount (discountAmountOre = 0) keep exactly the previous rule.
ALTER TABLE "BillingOrder" DROP CONSTRAINT "BillingOrder_amounts";
ALTER TABLE "BillingOrder" ADD CONSTRAINT "BillingOrder_amounts" CHECK (
  "subtotalOre" >= 0 AND "taxAmountOre" >= 0 AND
  "totalAmountOre" = "subtotalOre" - "discountAmountOre" + "taxAmountOre"
);
ALTER TABLE "BillingOrderItem" DROP CONSTRAINT "BillingOrderItem_amounts";
ALTER TABLE "BillingOrderItem" ADD CONSTRAINT "BillingOrderItem_amounts" CHECK (
  "quantity" > 0 AND "unitAmountOre" >= 0 AND "subtotalOre" >= 0 AND
  "taxAmountOre" >= 0 AND "totalAmountOre" = "subtotalOre" - "discountAmountOre" + "taxAmountOre"
);
