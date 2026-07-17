import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";

describe("financial consistency", () => {
  const dataset = generate({ seed: 99, scaleFactor: 50 });

  it("subtotal + tax + shipping === total for every order", () => {
    for (const order of dataset.orders) {
      const sum = Math.round((order.subtotal + order.tax + order.shipping) * 100) / 100;
      expect(sum).toBeCloseTo(order.total, 2);
    }
  });

  it("subtotal equals the sum of line item totals", () => {
    for (const order of dataset.orders) {
      const expected =
        Math.round(order.items.reduce((sum, item) => sum + item.lineTotal, 0) * 100) / 100;
      expect(order.subtotal).toBeCloseTo(expected, 2);
    }
  });

  it("free shipping applies at/above the configured threshold (excluding remote-shipping anomalies)", () => {
    const config = dataset.config;
    for (const order of dataset.orders) {
      if (order.anomaly?.type === "remote_surcharge") continue;
      if (order.subtotal >= config.freeShippingThreshold) {
        expect(order.shipping).toBe(0);
      } else {
        expect(order.shipping).toBe(config.flatShippingCost);
      }
    }
  });

  it("refund amount never exceeds the order total", () => {
    const ordersById = new Map(dataset.orders.map((o) => [o.id, o]));
    for (const ret of dataset.returnRequests) {
      const order = ordersById.get(ret.orderId)!;
      expect(ret.refundAmount).toBeLessThanOrEqual(order.total + 0.001);
    }
  });
});

describe("determinism", () => {
  it("the same seed, config, and reference time always produce an identical dataset", () => {
    const referenceNow = Date.now();
    const a = generate({ seed: 123, scaleFactor: 30 }, referenceNow);
    const b = generate({ seed: 123, scaleFactor: 30 }, referenceNow);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("different seeds produce different datasets", () => {
    const referenceNow = Date.now();
    const a = generate({ seed: 1, scaleFactor: 30 }, referenceNow);
    const b = generate({ seed: 2, scaleFactor: 30 }, referenceNow);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});

describe("edge cases", () => {
  const dataset = generate({ seed: 55, scaleFactor: 120, missingAddressRate: 0.5, multiPackageRate: 0.5 });

  it("orders with a missing shipping address have zero shipments", () => {
    const shipmentsByOrder = new Map<string, number>();
    for (const s of dataset.shipments) {
      shipmentsByOrder.set(s.orderId, (shipmentsByOrder.get(s.orderId) ?? 0) + 1);
    }
    for (const order of dataset.orders) {
      if (order.shippingAddress === null) {
        expect(shipmentsByOrder.get(order.id) ?? 0).toBe(0);
        expect(order.status).toBe("processing");
      }
    }
  });

  it("multi-package shipments share the same order and total the original item count", () => {
    const itemsByOrder = new Map<string, number>();
    const shipmentsByOrder = new Map<string, typeof dataset.shipments>();
    for (const s of dataset.shipments) {
      shipmentsByOrder.set(s.orderId, [...(shipmentsByOrder.get(s.orderId) ?? []), s]);
    }
    for (const order of dataset.orders) {
      const shipments = shipmentsByOrder.get(order.id) ?? [];
      if (shipments.length <= 1) continue;
      const totalItems = shipments.reduce((sum, s) => sum + s.items.length, 0);
      expect(totalItems).toBe(order.items.length);
      for (const s of shipments) expect(s.totalPackages).toBe(shipments.length);
    }
  });
});
