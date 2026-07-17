import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";

describe("anomaly injection", () => {
  const dataset = generate({
    seed: 314,
    scaleFactor: 400,
    cartsPerUser: { min: 2, max: 4 },
    anomalies: { enabled: true, botCartRate: 0.3, remoteShippingRate: 0.3, contradictoryReturnRate: 0.5 },
  });

  it("flags bot-activity carts with a large item count and tags them", () => {
    const botCarts = dataset.carts.filter((c) => c.anomaly?.type === "bot_activity");
    expect(botCarts.length).toBeGreaterThan(0);
    for (const cart of botCarts) {
      expect(cart.items.length).toBeGreaterThanOrEqual(50);
    }
  });

  it("never lets a bot-cart timestamp shift break createdAt <= lastActivityDate", () => {
    for (const cart of dataset.carts) {
      expect(new Date(cart.lastActivityDate).getTime()).toBeGreaterThanOrEqual(new Date(cart.createdAt).getTime());
    }
  });

  it("flags remote-shipping orders with a surcharge and a remote state", () => {
    const remoteOrders = dataset.orders.filter((o) => o.anomaly?.type === "remote_surcharge");
    expect(remoteOrders.length).toBeGreaterThan(0);
    for (const order of remoteOrders) {
      expect(["HI", "AK", "PR"]).toContain(order.shippingAddress?.state);
      expect(order.shipping).toBeGreaterThan(0);
    }
  });

  it("remote-shipping orders still balance subtotal + tax + shipping = total", () => {
    for (const order of dataset.orders) {
      const sum = Math.round((order.subtotal + order.tax + order.shipping) * 100) / 100;
      expect(sum).toBeCloseTo(order.total, 2);
    }
  });

  it("flags contradictory returns with a negative reason but a perfect CSAT score", () => {
    const contradictory = dataset.returnRequests.filter((r) => r.anomaly?.type === "contradictory_review");
    for (const r of contradictory) {
      expect(r.csatScore).toBe(5);
      expect(["Item damaged in transit", "Wrong item shipped", "Item not as described", "Size or fit issue"]).toContain(
        r.reason
      );
    }
  });

  it("anomalies.enabled=false disables all injection", () => {
    const clean = generate({
      seed: 314,
      scaleFactor: 400,
      cartsPerUser: { min: 2, max: 4 },
      anomalies: { enabled: false, botCartRate: 1, remoteShippingRate: 1, contradictoryReturnRate: 1 },
    });
    expect(clean.carts.every((c) => !c.anomaly)).toBe(true);
    expect(clean.orders.every((o) => !o.anomaly)).toBe(true);
    expect(clean.returnRequests.every((r) => !r.anomaly)).toBe(true);
  });
});
