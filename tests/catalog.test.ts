import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";
import { lintDataset } from "../src/lint.js";

describe("product catalog generation", () => {
  it("generates the requested number of products via catalogSize", () => {
    const dataset = generate({ seed: 1, scaleFactor: 50, catalogSize: 75 });
    expect(dataset.products.length).toBe(75);
  });

  it("defaults catalogSize to 150", () => {
    const dataset = generate({ seed: 1, scaleFactor: 50 });
    expect(dataset.products.length).toBe(150);
  });

  it("category tree has top-level departments and subcategories with correct parent linkage", () => {
    const dataset = generate({ seed: 1, scaleFactor: 50 });
    const departments = dataset.categories.filter((c) => c.parentCategoryId === null);
    const subcategories = dataset.categories.filter((c) => c.parentCategoryId !== null);
    expect(departments.length).toBeGreaterThan(3);
    expect(subcategories.length).toBeGreaterThan(departments.length);

    const departmentIds = new Set(departments.map((d) => d.id));
    for (const sub of subcategories) {
      expect(departmentIds.has(sub.parentCategoryId!)).toBe(true);
    }
  });

  it("every category has a valid slug derived from its name", () => {
    const dataset = generate({ seed: 1, scaleFactor: 50 });
    for (const category of dataset.categories) {
      expect(category.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("every product references a real category, brand, and supplier", () => {
    const dataset = generate({ seed: 1, scaleFactor: 50 });
    const categoryIds = new Set(dataset.categories.map((c) => c.id));
    const brandIds = new Set(dataset.brands.map((b) => b.id));
    const supplierIds = new Set(dataset.suppliers.map((s) => s.id));

    for (const product of dataset.products) {
      expect(categoryIds.has(product.categoryId)).toBe(true);
      expect(brandIds.has(product.brandId)).toBe(true);
      expect(supplierIds.has(product.supplierId)).toBe(true);
    }
  });

  it("products are only ever assigned to subcategories, never top-level departments", () => {
    const dataset = generate({ seed: 1, scaleFactor: 50 });
    const subcategoryIds = new Set(dataset.categories.filter((c) => c.parentCategoryId !== null).map((c) => c.id));
    for (const product of dataset.products) {
      expect(subcategoryIds.has(product.categoryId)).toBe(true);
    }
  });

  it("product prices fall within a plausible band, not a flat global range", () => {
    const dataset = generate({ seed: 1, scaleFactor: 50, catalogSize: 300 });
    const categoriesById = new Map(dataset.categories.map((c) => [c.id, c.name]));
    const laptops = dataset.products.filter((p) => categoriesById.get(p.categoryId) === "Laptops");
    const puzzles = dataset.products.filter((p) => categoriesById.get(p.categoryId) === "Puzzles");
    // Only assert if the category actually got products in this run (random assignment).
    if (laptops.length > 0) {
      expect(laptops.every((p) => p.basePrice >= 400)).toBe(true);
    }
    if (puzzles.length > 0) {
      expect(puzzles.every((p) => p.basePrice <= 45)).toBe(true);
    }
  });

  it("variant priceDelta is only non-zero when the variant actually has attributes", () => {
    const dataset = generate({ seed: 1, scaleFactor: 50, catalogSize: 200 });
    for (const product of dataset.products) {
      for (const variant of product.variants) {
        if (Object.keys(variant.attributes).length === 0) {
          expect(variant.priceDelta).toBe(0);
        }
      }
    }
  });

  it("is deterministic for a given seed", () => {
    const a = generate({ seed: 5, scaleFactor: 40 });
    const b = generate({ seed: 5, scaleFactor: 40 });
    expect(JSON.stringify(a.products)).toBe(JSON.stringify(b.products));
    expect(JSON.stringify(a.categories)).toBe(JSON.stringify(b.categories));
  });

  describe("carts/orders draw real, shared line items from the catalog", () => {
    it("every cart/order/shipment line item productId resolves to a real product", () => {
      const dataset = generate({ seed: 3, scaleFactor: 200 });
      expect(lintDataset(dataset)).toEqual([]);
    });

    it("the same product is genuinely reused across multiple line items -- not independently faked per line", () => {
      const dataset = generate({ seed: 3, scaleFactor: 300 });
      const usageCounts = new Map<string, number>();
      for (const cart of dataset.carts) {
        for (const item of cart.items) {
          usageCounts.set(item.productId, (usageCounts.get(item.productId) ?? 0) + 1);
        }
      }
      const reusedCount = [...usageCounts.values()].filter((count) => count > 1).length;
      expect(reusedCount).toBeGreaterThan(10);
    });

    it("order line items are copied from the converting cart, so they reference the same real products", () => {
      const dataset = generate({ seed: 3, scaleFactor: 200 });
      for (const order of dataset.orders) {
        const cart = dataset.carts.find((c) => c.id === order.cartId)!;
        expect(order.items.map((i) => i.productId)).toEqual(cart.items.map((i) => i.productId));
      }
    });

    it("a line item's unitPrice matches its product's basePrice (or basePrice + variant priceDelta)", () => {
      const dataset = generate({ seed: 3, scaleFactor: 200 });
      const productsById = new Map(dataset.products.map((p) => [p.id, p]));
      for (const order of dataset.orders) {
        for (const item of order.items) {
          const product = productsById.get(item.productId)!;
          const variant = product.variants.find((v) => v.sku === item.sku);
          const expectedPrice = variant ? product.basePrice + variant.priceDelta : product.basePrice;
          expect(item.unitPrice).toBeCloseTo(Math.round(expectedPrice * 100) / 100, 2);
        }
      }
    });

    it("bot-activity carts also reference real catalog products, not invented ones (regression)", () => {
      // Regression test for a real bug: bot-cart injection used to generate
      // its own ad hoc fake productIds independent of the catalog, which
      // silently produced hundreds of orphaned-foreign-key lint failures on
      // an otherwise completely normal dataset. High botCartRate to force
      // several bot carts into this run.
      const dataset = generate({
        seed: 8,
        scaleFactor: 300,
        anomalies: { enabled: true, botCartRate: 0.15, remoteShippingRate: 0.05, contradictoryReturnRate: 0.01 },
      });
      const botCarts = dataset.carts.filter((c) => c.anomaly?.type === "bot_activity");
      expect(botCarts.length).toBeGreaterThan(0);
      expect(lintDataset(dataset)).toEqual([]);
    });
  });
});
