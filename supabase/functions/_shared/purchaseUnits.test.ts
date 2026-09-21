import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { reconcilePurchaseUnits } from "./purchaseUnits.ts";

Deno.test("package count becomes units instead of dozens", () => {
  const result = reconcilePurchaseUnits({
    description: "OVOS VERMELHOS C/30",
    unit: "un",
    stock_unit: "dz",
    conversion_factor: 30,
    unit_confirmed: true,
  });
  assertEquals(result.stock_unit, "un");
  assertEquals(result.conversion_factor, 30);
});

Deno.test("package weight becomes the stock conversion", () => {
  const result = reconcilePurchaseUnits({
    description: "FARINHA DE TRIGO PREMIUM 5KG",
    unit: "un",
    stock_unit: "kg",
    conversion_factor: 1,
  });
  assertEquals(result.stock_unit, "kg");
  assertEquals(result.conversion_factor, 5);
  assertEquals(result.unit_confirmed, true);
});

Deno.test("invoice quantity already measured in kg is not multiplied again", () => {
  const result = reconcilePurchaseUnits({
    description: "QUEIJO MUSSARELA 5KG",
    unit: "kg",
    stock_unit: "kg",
    conversion_factor: 5,
  });
  assertEquals(result.stock_unit, "kg");
  assertEquals(result.conversion_factor, 1);
});

Deno.test("resale multipack is counted by sellable units", () => {
  const result = reconcilePurchaseUnits({
    description: "REFRIGERANTE LATA 12X350ML",
    unit: "cx",
    stock_unit: "ml",
    conversion_factor: 4200,
    inventory_kind: "resale_product",
  });
  assertEquals(result.stock_unit, "un");
  assertEquals(result.conversion_factor, 12);
});
