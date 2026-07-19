import type { Dataset } from "../types.js";
import { CANONICAL_COLUMNS } from "./mapper.js";

const DATASET_KEY_BY_TABLE: Record<string, keyof Dataset> = {
  categories: "categories",
  brands: "brands",
  suppliers: "suppliers",
  products: "products",
  users: "users",
  carts: "carts",
  abandoned_checkouts: "abandonedCheckouts",
  orders: "orders",
  shipments: "shipments",
  return_requests: "returnRequests",
  product_views: "productViews",
  search_queries: "searchQueries",
  wishlist_items: "wishlistItems",
  product_ratings: "productRatings",
  warehouses: "warehouses",
  replenishment_orders: "replenishmentOrders",
  stockout_periods: "stockoutPeriods",
  warehouse_transfers: "warehouseTransfers",
};

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Arrays/nested objects (line items, tracking events, product variants) serialize as a JSON string, matching the existing CSV output's convention. */
function flatten(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value) || typeof value === "object") return JSON.stringify(value);
  return value;
}

/**
 * Converts every table in a Dataset into flat, snake_case canonical rows
 * -- one array per CANONICAL_COLUMNS key, columns in that exact order.
 * Field mapping is derived generically from the column names themselves
 * (`user_id` -> `userId`) rather than a fourth hand-written per-table
 * mapping alongside the ones already in sql.ts and csv.ts; this is what
 * both benchmark exporters below are built on, and it's the shape any
 * future exporter for this dataset should reuse rather than
 * re-duplicating the field list again.
 */
export function datasetToCanonicalRows(dataset: Dataset): Record<string, Record<string, unknown>[]> {
  const result: Record<string, Record<string, unknown>[]> = {};
  for (const [table, columns] of Object.entries(CANONICAL_COLUMNS)) {
    const datasetKey = DATASET_KEY_BY_TABLE[table];
    if (!datasetKey) continue;
    const rows = dataset[datasetKey] as unknown as Record<string, unknown>[];
    result[table] = rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const col of columns) {
        out[col] = flatten(row[snakeToCamel(col)]);
      }
      return out;
    });
  }
  return result;
}
