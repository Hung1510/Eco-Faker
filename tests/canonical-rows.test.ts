import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";
import { datasetToCanonicalRows } from "../src/introspect/canonical-rows.js";
import { CANONICAL_COLUMNS } from "../src/introspect/mapper.js";

describe("datasetToCanonicalRows", () => {
  const dataset = generate({ seed: 1, scaleFactor: 200 });
  const rows = datasetToCanonicalRows(dataset);

  it("returns exactly the tables CANONICAL_COLUMNS defines", () => {
    expect(Object.keys(rows).sort()).toEqual(Object.keys(CANONICAL_COLUMNS).sort());
  });

  it("every row has exactly the columns CANONICAL_COLUMNS declares for that table, in order", () => {
    for (const [table, columns] of Object.entries(CANONICAL_COLUMNS)) {
      if (rows[table].length === 0) continue;
      expect(Object.keys(rows[table][0])).toEqual(columns);
    }
  });

  it("row counts match the real Dataset array lengths", () => {
    expect(rows.orders.length).toBe(dataset.orders.length);
    expect(rows.users.length).toBe(dataset.users.length);
    expect(rows.replenishment_orders.length).toBe(dataset.replenishmentOrders.length);
    expect(rows.product_views.length).toBe(dataset.productViews.length);
  });

  it("snake_case columns correctly resolve back to the real camelCase field values, spot-checked across tables", () => {
    const order = dataset.orders[0];
    const orderRow = rows.orders.find((r) => r.id === order.id)!;
    expect(orderRow.user_id).toBe(order.userId);
    expect(orderRow.cart_id).toBe(order.cartId);
    expect(orderRow.created_at).toBe(order.createdAt);

    const replenishment = dataset.replenishmentOrders[0];
    const replenishmentRow = rows.replenishment_orders.find((r) => r.id === replenishment.id)!;
    expect(replenishmentRow.expected_delivery_at).toBe(replenishment.expectedDeliveryAt);
    expect(replenishmentRow.supplier_id).toBe(replenishment.supplierId);
  });

  it("nested arrays/objects (order line items) serialize as valid JSON strings, not [object Object]", () => {
    const orderRow = rows.orders[0];
    expect(() => JSON.parse(orderRow.items as string)).not.toThrow();
    const parsed = JSON.parse(orderRow.items as string);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("is deterministic -- same dataset in, identical rows out", () => {
    const again = datasetToCanonicalRows(dataset);
    expect(JSON.stringify(again)).toBe(JSON.stringify(rows));
  });

  it("null fields stay null, not the string 'null' or undefined", () => {
    const nullableRow = rows.replenishment_orders.find((r) => r.received_at === null);
    expect(nullableRow).toBeDefined();
    expect(nullableRow!.received_at).toBeNull();
  });
});
