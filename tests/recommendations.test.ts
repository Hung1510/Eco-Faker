import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";
import { lintDataset } from "../src/lint.js";

describe("recommendation data generation", () => {
  it("is enabled by default and produces all four record types", () => {
    const dataset = generate({ seed: 1, scaleFactor: 150 });
    expect(dataset.productViews.length).toBeGreaterThan(0);
    expect(dataset.searchQueries.length).toBeGreaterThan(0);
    expect(dataset.wishlistItems.length).toBeGreaterThan(0);
    expect(dataset.productRatings.length).toBeGreaterThan(0);
  });

  it("produces nothing when recommendationData.enabled is false", () => {
    const dataset = generate({ seed: 1, scaleFactor: 150, recommendationData: { enabled: false } });
    expect(dataset.productViews).toEqual([]);
    expect(dataset.searchQueries).toEqual([]);
    expect(dataset.wishlistItems).toEqual([]);
    expect(dataset.productRatings).toEqual([]);
  });

  it("is deterministic for a given seed", () => {
    const referenceNow = Date.parse("2026-07-18T12:00:00.000Z");
    const a = generate({ seed: 6, scaleFactor: 100 }, referenceNow);
    const b = generate({ seed: 6, scaleFactor: 100 }, referenceNow);
    expect(JSON.stringify(a.productViews)).toBe(JSON.stringify(b.productViews));
    expect(JSON.stringify(a.searchQueries)).toBe(JSON.stringify(b.searchQueries));
    expect(JSON.stringify(a.wishlistItems)).toBe(JSON.stringify(b.wishlistItems));
    expect(JSON.stringify(a.productRatings)).toBe(JSON.stringify(b.productRatings));
  });

  it("enabling/disabling recommendationData does not change any other table's output (decoupled RNG)", () => {
    const referenceNow = Date.parse("2026-07-18T12:00:00.000Z");
    const withRec = generate({ seed: 6, scaleFactor: 100, recommendationData: { enabled: true } }, referenceNow);
    const withoutRec = generate({ seed: 6, scaleFactor: 100, recommendationData: { enabled: false } }, referenceNow);
    expect(JSON.stringify(withRec.users)).toBe(JSON.stringify(withoutRec.users));
    expect(JSON.stringify(withRec.carts)).toBe(JSON.stringify(withoutRec.carts));
    expect(JSON.stringify(withRec.orders)).toBe(JSON.stringify(withoutRec.orders));
    expect(JSON.stringify(withRec.products)).toBe(JSON.stringify(withoutRec.products));
  });

  it("every productView/searchQuery/wishlistItem/productRating passes lint's referential checks", () => {
    const dataset = generate({ seed: 3, scaleFactor: 200 });
    expect(lintDataset(dataset)).toEqual([]);
  });

  it("no record has a timestamp after referenceNow", () => {
    const referenceNow = Date.parse("2026-07-18T12:00:00.000Z");
    const dataset = generate({ seed: 3, scaleFactor: 200 }, referenceNow);
    for (const v of dataset.productViews) expect(Date.parse(v.timestamp)).toBeLessThanOrEqual(referenceNow);
    for (const q of dataset.searchQueries) expect(Date.parse(q.timestamp)).toBeLessThanOrEqual(referenceNow);
    for (const w of dataset.wishlistItems) expect(Date.parse(w.addedAt)).toBeLessThanOrEqual(referenceNow);
    for (const r of dataset.productRatings) expect(Date.parse(r.createdAt)).toBeLessThanOrEqual(referenceNow);
  });

  describe("behavioral flow: view -> wishlist -> purchase -> review", () => {
    it("every purchased product was viewed before the order that bought it", () => {
      const dataset = generate({ seed: 3, scaleFactor: 200 });
      for (const order of dataset.orders) {
        const orderMs = Date.parse(order.createdAt);
        for (const item of order.items) {
          const priorView = dataset.productViews.find(
            (v) => v.userId === order.userId && v.productId === item.productId && Date.parse(v.timestamp) <= orderMs
          );
          expect(priorView, `no prior view found for order ${order.id} item ${item.productId}`).toBeDefined();
        }
      }
    });

    it("a search-sourced view has a matching search query with clickedProductId set, timestamped before the view", () => {
      const dataset = generate({ seed: 3, scaleFactor: 300 });
      const searchViews = dataset.productViews.filter((v) => v.source === "search");
      expect(searchViews.length).toBeGreaterThan(0);
      for (const view of searchViews) {
        // A user/product pair can have more than one query+view (purchase-path
        // browsing and later noise browsing both touching the same product) --
        // so check that *some* qualifying query precedes this view, rather than
        // grabbing an arbitrary match and asserting on that one specifically.
        const hasQualifyingQuery = dataset.searchQueries.some(
          (q) =>
            q.userId === view.userId &&
            q.clickedProductId === view.productId &&
            Date.parse(q.timestamp) <= Date.parse(view.timestamp)
        );
        expect(hasQualifyingQuery, `no query precedes view ${view.id}`).toBe(true);
      }
    });

    it("ratings only ever exist for delivered orders", () => {
      const dataset = generate({ seed: 3, scaleFactor: 300 });
      const orderById = new Map(dataset.orders.map((o) => [o.id, o]));
      expect(dataset.productRatings.length).toBeGreaterThan(0);
      for (const rating of dataset.productRatings) {
        const order = orderById.get(rating.orderId)!;
        expect(order.status).toBe("delivered");
      }
    });

    it("a rating's createdAt is after the order's own createdAt", () => {
      const dataset = generate({ seed: 3, scaleFactor: 300 });
      const orderById = new Map(dataset.orders.map((o) => [o.id, o]));
      for (const rating of dataset.productRatings) {
        const order = orderById.get(rating.orderId)!;
        expect(Date.parse(rating.createdAt)).toBeGreaterThanOrEqual(Date.parse(order.createdAt));
      }
    });

    it("a rating's productId actually appears among the order's line items (not an unrelated product)", () => {
      const dataset = generate({ seed: 3, scaleFactor: 300 });
      const orderById = new Map(dataset.orders.map((o) => [o.id, o]));
      for (const rating of dataset.productRatings) {
        const order = orderById.get(rating.orderId)!;
        expect(order.items.some((i) => i.productId === rating.productId)).toBe(true);
      }
    });

    it("wishlist items are never for a product the user had already purchased at the time they were wishlisted", () => {
      const dataset = generate({ seed: 3, scaleFactor: 300 });
      expect(dataset.wishlistItems.length).toBeGreaterThan(0);
      for (const item of dataset.wishlistItems) {
        const wishlistedMs = Date.parse(item.addedAt);
        const purchasedBefore = dataset.orders.some(
          (o) =>
            o.userId === item.userId &&
            Date.parse(o.createdAt) <= wishlistedMs &&
            o.items.some((li) => li.productId === item.productId)
        );
        expect(purchasedBefore).toBe(false);
      }
    });

    it("ratings skew positive, matching typical real-world review distributions", () => {
      const dataset = generate({ seed: 3, scaleFactor: 500 });
      const fourOrFive = dataset.productRatings.filter((r) => r.rating >= 4).length;
      expect(fourOrFive / dataset.productRatings.length).toBeGreaterThan(0.6);
    });

    it("every rating value is between 1 and 5", () => {
      const dataset = generate({ seed: 3, scaleFactor: 300 });
      for (const rating of dataset.productRatings) {
        expect(rating.rating).toBeGreaterThanOrEqual(1);
        expect(rating.rating).toBeLessThanOrEqual(5);
      }
    });
  });
});
