import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";
import { lintDataset } from "../src/lint.js";

describe("inventory simulation", () => {
  it("is enabled by default and produces warehouses, replenishment orders, stockouts, and transfers", () => {
    const dataset = generate({ seed: 1, scaleFactor: 200 });
    expect(dataset.warehouses.length).toBeGreaterThan(0);
    expect(dataset.replenishmentOrders.length).toBeGreaterThan(0);
    expect(dataset.stockoutPeriods.length).toBeGreaterThan(0);
  });

  it("produces nothing when inventorySimulation.enabled is false", () => {
    const dataset = generate({ seed: 1, scaleFactor: 200, inventorySimulation: { enabled: false } });
    expect(dataset.warehouses).toEqual([]);
    expect(dataset.replenishmentOrders).toEqual([]);
    expect(dataset.stockoutPeriods).toEqual([]);
    expect(dataset.warehouseTransfers).toEqual([]);
  });

  it("is deterministic for a given seed", () => {
    const referenceNow = Date.parse("2026-07-18T12:00:00.000Z");
    const a = generate({ seed: 4, scaleFactor: 150 }, referenceNow);
    const b = generate({ seed: 4, scaleFactor: 150 }, referenceNow);
    expect(JSON.stringify(a.warehouses)).toBe(JSON.stringify(b.warehouses));
    expect(JSON.stringify(a.replenishmentOrders)).toBe(JSON.stringify(b.replenishmentOrders));
    expect(JSON.stringify(a.stockoutPeriods)).toBe(JSON.stringify(b.stockoutPeriods));
    expect(JSON.stringify(a.warehouseTransfers)).toBe(JSON.stringify(b.warehouseTransfers));
  });

  it("enabling/disabling inventorySimulation does not change any other table's output, including recommendation data", () => {
    const referenceNow = Date.parse("2026-07-18T12:00:00.000Z");
    const withInv = generate({ seed: 4, scaleFactor: 150, inventorySimulation: { enabled: true } }, referenceNow);
    const withoutInv = generate({ seed: 4, scaleFactor: 150, inventorySimulation: { enabled: false } }, referenceNow);
    expect(JSON.stringify(withInv.users)).toBe(JSON.stringify(withoutInv.users));
    expect(JSON.stringify(withInv.orders)).toBe(JSON.stringify(withoutInv.orders));
    expect(JSON.stringify(withInv.products)).toBe(JSON.stringify(withoutInv.products));
    // The real point: toggling inventory simulation must not shift recommendation
    // data's RNG draws either, since both are independent post-processing passes.
    expect(JSON.stringify(withInv.productViews)).toBe(JSON.stringify(withoutInv.productViews));
    expect(JSON.stringify(withInv.productRatings)).toBe(JSON.stringify(withoutInv.productRatings));
  });

  it("every warehouse-referencing record passes lint's referential checks", () => {
    const dataset = generate({ seed: 2, scaleFactor: 200 });
    expect(lintDataset(dataset)).toEqual([]);
  });

  describe("grounding: replenishment orders are tied to the supplier's real leadTimeDays", () => {
    it("expectedDeliveryAt is always exactly orderedAt + supplier.leadTimeDays", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const suppliersById = new Map(dataset.suppliers.map((s) => [s.id, s]));
      expect(dataset.replenishmentOrders.length).toBeGreaterThan(0);
      for (const order of dataset.replenishmentOrders) {
        const supplier = suppliersById.get(order.supplierId)!;
        const expected = Date.parse(order.orderedAt) + supplier.leadTimeDays * 24 * 60 * 60 * 1000;
        expect(Date.parse(order.expectedDeliveryAt)).toBe(expected);
      }
    });
  });

  describe("internal consistency between status and dates", () => {
    it("a 'received' order always has a non-null receivedAt, and no other status does", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      for (const order of dataset.replenishmentOrders) {
        if (order.status === "received") {
          expect(order.receivedAt).not.toBeNull();
        } else {
          expect(order.receivedAt).toBeNull();
        }
      }
    });

    it("a 'received' order never has an expectedDeliveryAt in the future", () => {
      const referenceNow = Date.parse("2026-07-18T12:00:00.000Z");
      const dataset = generate({ seed: 2, scaleFactor: 300 }, referenceNow);
      for (const order of dataset.replenishmentOrders) {
        if (order.status === "received") {
          expect(Date.parse(order.expectedDeliveryAt)).toBeLessThanOrEqual(referenceNow);
        }
      }
    });

    it("no timestamp is ever after referenceNow", () => {
      const referenceNow = Date.parse("2026-07-18T12:00:00.000Z");
      const dataset = generate({ seed: 2, scaleFactor: 300 }, referenceNow);
      for (const order of dataset.replenishmentOrders) {
        expect(Date.parse(order.orderedAt)).toBeLessThanOrEqual(referenceNow);
        if (order.receivedAt) expect(Date.parse(order.receivedAt)).toBeLessThanOrEqual(referenceNow);
      }
      for (const period of dataset.stockoutPeriods) {
        expect(Date.parse(period.startedAt)).toBeLessThanOrEqual(referenceNow);
        if (period.endedAt) expect(Date.parse(period.endedAt)).toBeLessThanOrEqual(referenceNow);
      }
      for (const transfer of dataset.warehouseTransfers) {
        expect(Date.parse(transfer.initiatedAt)).toBeLessThanOrEqual(referenceNow);
        if (transfer.completedAt) expect(Date.parse(transfer.completedAt)).toBeLessThanOrEqual(referenceNow);
      }
    });
  });

  describe("stockout <-> replenishment consistency", () => {
    it("a stockout resolved by a replenishment order always has a non-null endedAt, and vice versa", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      expect(dataset.stockoutPeriods.length).toBeGreaterThan(0);
      for (const period of dataset.stockoutPeriods) {
        if (period.resolvedByReplenishmentId !== null) {
          expect(period.endedAt).not.toBeNull();
        } else {
          expect(period.endedAt).toBeNull();
        }
      }
    });

    it("resolvedByReplenishmentId always points to a real, received replenishment order for the same product", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const replenishmentById = new Map(dataset.replenishmentOrders.map((r) => [r.id, r]));
      const resolvedStockouts = dataset.stockoutPeriods.filter((s) => s.resolvedByReplenishmentId !== null);
      expect(resolvedStockouts.length).toBeGreaterThan(0);
      for (const period of resolvedStockouts) {
        const order = replenishmentById.get(period.resolvedByReplenishmentId!);
        expect(order).toBeDefined();
        expect(order!.status).toBe("received");
        expect(order!.productId).toBe(period.productId);
      }
    });
  });

  describe("grounding: low-stock products are preferentially given a stockout/replenishment history", () => {
    it("products with a variant stockLevel under 20 are far more likely to have a stockout period than well-stocked products", () => {
      const dataset = generate({ seed: 2, scaleFactor: 400, catalogSize: 300 });
      const stockoutProductIds = new Set(dataset.stockoutPeriods.map((s) => s.productId));

      const lowStock = dataset.products.filter((p) => p.variants.some((v) => v.stockLevel < 20));
      const wellStocked = dataset.products.filter((p) => p.variants.every((v) => v.stockLevel >= 100));
      expect(lowStock.length).toBeGreaterThan(0);
      expect(wellStocked.length).toBeGreaterThan(0);

      const lowStockRate = lowStock.filter((p) => stockoutProductIds.has(p.id)).length / lowStock.length;
      const wellStockedRate = wellStocked.filter((p) => stockoutProductIds.has(p.id)).length / wellStocked.length;
      expect(lowStockRate).toBeGreaterThan(wellStockedRate);
    });
  });

  it("warehouse transfers always move stock between two genuinely different warehouses", () => {
    const dataset = generate({ seed: 2, scaleFactor: 400 });
    expect(dataset.warehouseTransfers.length).toBeGreaterThan(0);
    for (const transfer of dataset.warehouseTransfers) {
      expect(transfer.fromWarehouseId).not.toBe(transfer.toWarehouseId);
    }
  });
});
