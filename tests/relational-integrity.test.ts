import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";

describe("relational integrity", () => {
  const dataset = generate({ seed: 42, scaleFactor: 60, historicalDays: 60 });
  const userIds = new Set(dataset.users.map((u) => u.id));
  const cartIds = new Set(dataset.carts.map((c) => c.id));
  const orderIds = new Set(dataset.orders.map((o) => o.id));

  it("every cart belongs to a real user", () => {
    for (const cart of dataset.carts) {
      expect(userIds.has(cart.userId)).toBe(true);
    }
  });

  it("every order belongs to a real user and a real cart", () => {
    for (const order of dataset.orders) {
      expect(userIds.has(order.userId)).toBe(true);
      expect(cartIds.has(order.cartId)).toBe(true);
    }
  });

  it("every shipment belongs to a real order (no orphaned shipping records)", () => {
    for (const shipment of dataset.shipments) {
      expect(orderIds.has(shipment.orderId)).toBe(true);
    }
  });

  it("every abandoned checkout belongs to a real cart and user", () => {
    for (const checkout of dataset.abandonedCheckouts) {
      expect(cartIds.has(checkout.cartId)).toBe(true);
      expect(userIds.has(checkout.userId)).toBe(true);
    }
  });

  it("every return request belongs to a real order and user", () => {
    for (const ret of dataset.returnRequests) {
      expect(orderIds.has(ret.orderId)).toBe(true);
      expect(userIds.has(ret.userId)).toBe(true);
    }
  });

  it("converted cart items match the resulting order items exactly", () => {
    const cartsById = new Map(dataset.carts.map((c) => [c.id, c]));
    for (const order of dataset.orders) {
      const cart = cartsById.get(order.cartId);
      expect(cart).toBeDefined();
      expect(order.items).toEqual(cart!.items);
    }
  });

  it("a cart never produces both an order and an abandoned checkout", () => {
    const orderCartIds = new Set(dataset.orders.map((o) => o.cartId));
    const abandonedCartIds = new Set(dataset.abandonedCheckouts.map((a) => a.cartId));
    for (const id of orderCartIds) {
      expect(abandonedCartIds.has(id)).toBe(false);
    }
  });

  it("return requests only exist for delivered orders", () => {
    const ordersById = new Map(dataset.orders.map((o) => [o.id, o]));
    for (const ret of dataset.returnRequests) {
      expect(ordersById.get(ret.orderId)?.status).toBe("delivered");
    }
  });
});
