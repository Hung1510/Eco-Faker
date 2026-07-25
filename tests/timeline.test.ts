import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";

const TRACKING_ORDER = [
  "Label Created",
  "Picked Up",
  "In Transit",
  "Delayed",
  "Out for Delivery",
  "Delivered",
] as const;

describe("timeline realism", () => {
  const dataset = generate({ seed: 7, scaleFactor: 80, historicalDays: 90, delayProbability: 0.4 });

  it("abandoned carts: lastActivityDate is >3h ago and within the abandonment timeout", () => {
    const now = Date.now();
    const threeHoursMs = 3 * 60 * 60 * 1000;
    for (const cart of dataset.carts) {
      if (cart.status !== "abandoned") continue;
      const ageMs = now - new Date(cart.lastActivityDate).getTime();
      expect(ageMs).toBeGreaterThan(threeHoursMs - 1); // allow rounding at the boundary
      expect(ageMs).toBeLessThanOrEqual(cart.abandonmentTimeoutHours * 60 * 60 * 1000 + 1);
    }
  });

  it("cart lastActivityDate is never before createdAt", () => {
    for (const cart of dataset.carts) {
      expect(new Date(cart.lastActivityDate).getTime()).toBeGreaterThanOrEqual(
        new Date(cart.createdAt).getTime()
      );
    }
  });

  it("tracking events for every shipment appear in valid relative order", () => {
    for (const shipment of dataset.shipments) {
      const indices = shipment.events.map((e) => TRACKING_ORDER.indexOf(e.status));
      for (let i = 1; i < indices.length; i++) {
        expect(indices[i]).toBeGreaterThan(indices[i - 1]);
      }
    }
  });

  it("tracking event timestamps strictly increase", () => {
    for (const shipment of dataset.shipments) {
      for (let i = 1; i < shipment.events.length; i++) {
        const prev = new Date(shipment.events[i - 1].timestamp).getTime();
        const curr = new Date(shipment.events[i].timestamp).getTime();
        expect(curr).toBeGreaterThan(prev);
      }
    }
  });

  it('"Out for Delivery" never appears before "Picked Up"', () => {
    for (const shipment of dataset.shipments) {
      const pickedUp = shipment.events.find((e) => e.status === "Picked Up");
      const outForDelivery = shipment.events.find((e) => e.status === "Out for Delivery");
      if (pickedUp && outForDelivery) {
        expect(new Date(outForDelivery.timestamp).getTime()).toBeGreaterThan(
          new Date(pickedUp.timestamp).getTime()
        );
      }
    }
  });

  it("delivered orders have all shipments in Delivered status", () => {
    const shipmentsByOrder = new Map<string, typeof dataset.shipments>();
    for (const s of dataset.shipments) {
      shipmentsByOrder.set(s.orderId, [...(shipmentsByOrder.get(s.orderId) ?? []), s]);
    }
    for (const order of dataset.orders) {
      if (order.status !== "delivered") continue;
      const shipments = shipmentsByOrder.get(order.id) ?? [];
      expect(shipments.length).toBeGreaterThan(0);
      for (const s of shipments) expect(s.status).toBe("Delivered");
    }
  });

  it("no event timestamp is in the future", () => {
    const now = Date.now();
    for (const shipment of dataset.shipments) {
      for (const event of shipment.events) {
        expect(new Date(event.timestamp).getTime()).toBeLessThanOrEqual(now);
      }
    }
  });

  describe("no timestamp anywhere in the dataset is ever in the future (regression)", () => {
    // The above test only ever checked shipment.events -- a narrower
    // scope than its own name promised. That gap is exactly why a real
    // bug (order.createdAt could land up to 30 minutes in the future
    // when a converting cart's lastActivityDate was close to
    // referenceNow -- see modules/order/index.ts) went undetected across
    // many prior rounds of work in this project. This block checks every
    // timestamp field on every table explicitly, with a fixed
    // referenceNow rather than a fresh Date.now() call after generation,
    // so the check is exact rather than merely "probably fine because
    // some time passed since generation."
    const referenceNow = Date.parse("2026-07-19T12:00:00.000Z");
    const fullDataset = generate({ seed: 7, scaleFactor: 300, historicalDays: 90, delayProbability: 0.4 }, referenceNow);

    it("orders.createdAt", () => {
      for (const o of fullDataset.orders) expect(Date.parse(o.createdAt)).toBeLessThanOrEqual(referenceNow);
    });
    it("carts.createdAt and lastActivityDate", () => {
      for (const c of fullDataset.carts) {
        expect(Date.parse(c.createdAt)).toBeLessThanOrEqual(referenceNow);
        expect(Date.parse(c.lastActivityDate)).toBeLessThanOrEqual(referenceNow);
      }
    });
    it("abandonedCheckouts.exitTimestamp and recoveryEmailSentAt", () => {
      for (const c of fullDataset.abandonedCheckouts) {
        expect(Date.parse(c.exitTimestamp)).toBeLessThanOrEqual(referenceNow);
        if (c.recoveryEmailSentAt) expect(Date.parse(c.recoveryEmailSentAt)).toBeLessThanOrEqual(referenceNow);
      }
    });
    it("shipments.events[].timestamp", () => {
      for (const s of fullDataset.shipments) {
        for (const e of s.events) expect(Date.parse(e.timestamp)).toBeLessThanOrEqual(referenceNow);
      }
    });
    it("returnRequests.requestedAt and resolvedAt", () => {
      for (const r of fullDataset.returnRequests) {
        expect(Date.parse(r.requestedAt)).toBeLessThanOrEqual(referenceNow);
        if (r.resolvedAt) expect(Date.parse(r.resolvedAt)).toBeLessThanOrEqual(referenceNow);
      }
    });
    it("users.createdAt", () => {
      for (const u of fullDataset.users) expect(Date.parse(u.createdAt)).toBeLessThanOrEqual(referenceNow);
    });
  });
});
