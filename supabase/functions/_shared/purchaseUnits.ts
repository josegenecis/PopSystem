export type PurchaseUnit = "un" | "kg" | "g" | "l" | "ml" | "cx" | "pct" | "fd" | "bd" | "dz";

const MASS_OR_VOLUME = new Set<PurchaseUnit>(["kg", "g", "l", "ml"]);

function decimal(value: string) {
  const parsed = Number(String(value || "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function plain(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function measureUnit(value: string): PurchaseUnit {
  return value === "KG" ? "kg" : value === "G" ? "g" : value === "L" ? "l" : "ml";
}

/**
 * Reconciles the model response with strong evidence printed in the item description.
 * The AI remains responsible for ambiguous cases; explicit package counts and weights
 * are deterministic so values such as "OVOS C/30" cannot become 30 dozens.
 */
export function reconcilePurchaseUnits(item: {
  description?: unknown;
  normalized_name?: unknown;
  unit: PurchaseUnit;
  stock_unit: PurchaseUnit;
  conversion_factor: number;
  unit_source?: string;
  unit_confirmed?: boolean;
  inventory_kind?: string;
}) {
  const text = plain(`${item.description || ""} ${item.normalized_name || ""}`);
  const unit = item.unit;
  const original = {
    unit,
    stock_unit: item.stock_unit,
    conversion_factor: Math.max(Number(item.conversion_factor || 1), 0.000001),
    unit_source: item.unit_source || "unknown",
    unit_confirmed: item.unit_confirmed === true,
  };

  // Commercial quantity is already expressed in mass/volume by the invoice.
  // A line with 5 KG means 5 kg in stock, not 5 packages of 5 kg.
  if (MASS_OR_VOLUME.has(unit)) {
    return { ...original, stock_unit: unit, conversion_factor: 1, unit_confirmed: true };
  }

  const contentCount = text.match(/\b(?:C\s*\/|COM)\s*(\d+(?:[.,]\d+)?)\s*(?:UN(?:ID(?:ADES?)?)?)?\b/);
  if (contentCount) {
    const count = decimal(contentCount[1]);
    if (count) {
      return {
        ...original,
        stock_unit: "un" as PurchaseUnit,
        conversion_factor: count,
        unit_source: "inferred",
        unit_confirmed: true,
      };
    }
  }

  const multipack = text.match(/\b(\d+(?:[.,]\d+)?)\s*[X]\s*(\d+(?:[.,]\d+)?)\s*(KG|G|ML|L)\b/);
  if (multipack) {
    const packages = decimal(multipack[1]);
    const size = decimal(multipack[2]);
    if (packages && size) {
      if (item.inventory_kind === "resale_product") {
        return {
          ...original,
          stock_unit: "un" as PurchaseUnit,
          conversion_factor: packages,
          unit_source: "inferred",
          unit_confirmed: true,
        };
      }
      return {
        ...original,
        stock_unit: measureUnit(multipack[3]),
        conversion_factor: packages * size,
        unit_source: "inferred",
        unit_confirmed: true,
      };
    }
  }

  const measure = text.match(/\b(\d+(?:[.,]\d+)?)\s*(KG|G|ML|L)\b/);
  if (measure) {
    const size = decimal(measure[1]);
    if (size) {
      return {
        ...original,
        stock_unit: measureUnit(measure[2]),
        conversion_factor: size,
        unit_source: "inferred",
        unit_confirmed: true,
      };
    }
  }

  if (unit === "dz") {
    return {
      ...original,
      stock_unit: "un" as PurchaseUnit,
      conversion_factor: 12,
      unit_source: "inferred",
      unit_confirmed: true,
    };
  }

  return original;
}
