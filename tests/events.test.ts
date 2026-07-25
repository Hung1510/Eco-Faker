import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";
import { buildEventStream } from "../src/events.js";

describe("event stream", () => {
  it("produces events for a normal generated dataset", () => {
    const dataset = generate({ seed: 1, scaleFactor: 200 });
    const events = buildEventStream(dataset);
    expect(events.length).toBeGreaterThan(0);
  });

  it("is chronologically ordered", () => {
    const dataset = generate({ seed: 2, scaleFactor: 300 });
    const events = buildEventStream(dataset);
    for (let i = 1; i < events.length; i++) {
      expect(Date.parse(events[i].timestamp)).toBeGreaterThanOrEqual(Date.parse(events[i - 1].timestamp));
    }
  });

  it("every eventId is unique", () => {
    const dataset = generate({ seed: 2, scaleFactor: 300 });
    const events = buildEventStream(dataset);
    expect(new Set(events.map((e) => e.eventId)).size).toBe(events.length);
  });

  it("is deterministic -- same dataset in, identical event stream out", () => {
    const dataset = generate({ seed: 2, scaleFactor: 200 });
    const a = buildEventStream(dataset);
    const b = buildEventStream(dataset);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("every event has a non-empty aggregateType and aggregateId", () => {
    const dataset = generate({ seed: 2, scaleFactor: 200 });
    const events = buildEventStream(dataset);
    for (const e of events) {
      expect(e.aggregateType.length).toBeGreaterThan(0);
      expect(e.aggregateId.length).toBeGreaterThan(0);
    }
  });

  describe("real counts match the source dataset, per table", () => {
    it("user.created count equals dataset.users.length", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const events = buildEventStream(dataset);
      expect(events.filter((e) => e.type === "user.created").length).toBe(dataset.users.length);
    });

    it("cart.created count equals dataset.carts.length", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const events = buildEventStream(dataset);
      expect(events.filter((e) => e.type === "cart.created").length).toBe(dataset.carts.length);
    });

    it("cart.item_added count equals the real total line-item count across all carts", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const events = buildEventStream(dataset);
      const realItemCount = dataset.carts.reduce((s, c) => s + c.items.length, 0);
      expect(events.filter((e) => e.type === "cart.item_added").length).toBe(realItemCount);
    });

    it("cart.abandoned count equals the real number of abandoned carts", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const events = buildEventStream(dataset);
      const realAbandoned = dataset.carts.filter((c) => c.status === "abandoned").length;
      expect(events.filter((e) => e.type === "cart.abandoned").length).toBe(realAbandoned);
    });

    it("shipment tracking events match the real total across every shipment's events array", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const events = buildEventStream(dataset);
      const realTrackingEventCount = dataset.shipments.reduce((s, sh) => s + sh.events.length, 0);
      const shipmentEvents = events.filter((e) => e.type.startsWith("shipment."));
      expect(shipmentEvents.length).toBe(realTrackingEventCount);
    });

    it("replenishment.received only fires for orders that actually have a receivedAt", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const events = buildEventStream(dataset);
      const realReceivedCount = dataset.replenishmentOrders.filter((r) => r.receivedAt !== null).length;
      expect(events.filter((e) => e.type === "replenishment.received").length).toBe(realReceivedCount);
      // Every replenishment order gets an "ordered" event regardless.
      expect(events.filter((e) => e.type === "replenishment.ordered").length).toBe(dataset.replenishmentOrders.length);
    });

    it("stockout.resolved only fires for periods that actually have an endedAt", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const events = buildEventStream(dataset);
      const realResolvedCount = dataset.stockoutPeriods.filter((s) => s.endedAt !== null).length;
      expect(events.filter((e) => e.type === "stockout.resolved").length).toBe(realResolvedCount);
    });

    it("product.viewed, search.performed, wishlist.item_added, and product.rated counts match recommendation data exactly", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const events = buildEventStream(dataset);
      expect(events.filter((e) => e.type === "product.viewed").length).toBe(dataset.productViews.length);
      expect(events.filter((e) => e.type === "search.performed").length).toBe(dataset.searchQueries.length);
      expect(events.filter((e) => e.type === "wishlist.item_added").length).toBe(dataset.wishlistItems.length);
      expect(events.filter((e) => e.type === "product.rated").length).toBe(dataset.productRatings.length);
    });
  });

  describe("cart.item_added timestamp interpolation", () => {
    it("every item-added event's timestamp falls within [cart.createdAt, cart.lastActivityDate]", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const events = buildEventStream(dataset);
      for (const cart of dataset.carts) {
        if (cart.items.length === 0) continue;
        const itemEvents = events.filter((e) => e.type === "cart.item_added" && e.aggregateId === cart.id);
        const createdMs = Date.parse(cart.createdAt);
        const lastActivityMs = Date.parse(cart.lastActivityDate);
        for (const e of itemEvents) {
          const ts = Date.parse(e.timestamp);
          expect(ts).toBeGreaterThanOrEqual(createdMs);
          expect(ts).toBeLessThanOrEqual(Math.max(lastActivityMs, createdMs));
        }
      }
    });

    it("item-added events for a single cart are themselves chronologically ordered", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const events = buildEventStream(dataset);
      const multiItemCart = dataset.carts.find((c) => c.items.length > 2);
      expect(multiItemCart).toBeDefined();
      const itemEvents = events
        .filter((e) => e.type === "cart.item_added" && e.aggregateId === multiItemCart!.id)
        .map((e) => Date.parse(e.timestamp));
      expect(itemEvents).toEqual([...itemEvents].sort((a, b) => a - b));
    });

    it("does not crash when a cart's createdAt equals its lastActivityDate (zero-width window)", () => {
      // Construct a minimal degenerate cart directly rather than searching
      // for one that might not exist in any generated dataset.
      const dataset = generate({ seed: 2, scaleFactor: 50 });
      const degenerateCart = {
        ...dataset.carts[0],
        lastActivityDate: dataset.carts[0].createdAt,
        items: dataset.carts[0].items.length > 0 ? dataset.carts[0].items : [{ productId: "x", sku: "x", name: "x", unitPrice: 1, quantity: 1, lineTotal: 1 }],
      };
      const modifiedDataset = { ...dataset, carts: [degenerateCart, ...dataset.carts.slice(1)] };
      expect(() => buildEventStream(modifiedDataset)).not.toThrow();
      const events = buildEventStream(modifiedDataset);
      const itemEvents = events.filter((e) => e.type === "cart.item_added" && e.aggregateId === degenerateCart.id);
      for (const e of itemEvents) {
        expect(e.timestamp).toBe(degenerateCart.createdAt);
      }
    });
  });

  it("handles a dataset with recommendation data and inventory simulation disabled without crashing, and simply omits those event types", () => {
    const dataset = generate({
      seed: 1,
      scaleFactor: 100,
      recommendationData: { enabled: false },
      inventorySimulation: { enabled: false },
    });
    const events = buildEventStream(dataset);
    expect(events.some((e) => e.type === "product.viewed")).toBe(false);
    expect(events.some((e) => e.type === "replenishment.ordered")).toBe(false);
    expect(events.some((e) => e.type === "user.created")).toBe(true);
  });
});
