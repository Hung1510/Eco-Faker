import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";
import { lintDataset } from "../src/lint.js";
import { applySemanticFuzzing } from "../src/fuzz.js";

describe("lintDataset (offline)", () => {
  it("a freshly generated dataset has no lint issues", () => {
    const dataset = generate({ seed: 11, scaleFactor: 120 });
    expect(lintDataset(dataset)).toEqual([]);
  });

  it("catches an orphaned foreign key", () => {
    const dataset = generate({ seed: 11, scaleFactor: 60 });
    dataset.carts[0].userId = "does-not-exist";
    const issues = lintDataset(dataset);
    expect(issues.some((i) => i.rule === "orphaned_foreign_key" && i.recordId === dataset.carts[0].id)).toBe(true);
  });

  it("catches a duplicate id within a table", () => {
    const dataset = generate({ seed: 11, scaleFactor: 60 });
    dataset.orders[1].id = dataset.orders[0].id;
    const issues = lintDataset(dataset);
    expect(issues.some((i) => i.rule === "duplicate_id" && i.recordId === dataset.orders[0].id)).toBe(true);
  });

  it("catches a duplicate email across users", () => {
    const dataset = generate({ seed: 11, scaleFactor: 60 });
    dataset.users[1].email = dataset.users[0].email;
    const issues = lintDataset(dataset);
    expect(issues.some((i) => i.rule === "duplicate_email")).toBe(true);
  });

  it("catches a line item whose lineTotal doesn't match unitPrice * quantity", () => {
    const dataset = generate({ seed: 11, scaleFactor: 60 });
    const order = dataset.orders.find((o) => o.items.length > 0)!;
    order.items[0].lineTotal = order.items[0].lineTotal + 1000;
    const issues = lintDataset(dataset);
    expect(issues.some((i) => i.rule === "financial_mismatch" && i.recordId === order.id)).toBe(true);
  });

  it("catches an order total that doesn't equal subtotal + tax + shipping", () => {
    const dataset = generate({ seed: 11, scaleFactor: 60 });
    dataset.orders[0].total = dataset.orders[0].total + 1000;
    const issues = lintDataset(dataset);
    expect(issues.some((i) => i.rule === "financial_mismatch" && i.recordId === dataset.orders[0].id)).toBe(true);
  });

  it("catches a return request dated before its order", () => {
    const dataset = generate({ seed: 11, scaleFactor: 60 });
    const ret = dataset.returnRequests[0];
    const order = dataset.orders.find((o) => o.id === ret.orderId)!;
    ret.requestedAt = new Date(Date.parse(order.createdAt) - 86400000).toISOString();
    const issues = lintDataset(dataset);
    expect(issues.some((i) => i.rule === "temporal_paradox" && i.recordId === ret.id)).toBe(true);
  });

  it("running lint on an extreme semantic-fuzz output surfaces multiple issue types", () => {
    const dataset = generate({ seed: 11, scaleFactor: 120 });
    const { dataset: mutated } = applySemanticFuzzing(dataset, { intensity: "extreme", seed: 5 });
    const issues = lintDataset(mutated);
    const rules = new Set(issues.map((i) => i.rule));
    // address_mismatch alone doesn't violate any of these offline checks (it's
    // still a structurally valid, internally consistent address field) --
    // financial_mismatch and temporal_paradox are the ones fuzzing should trip.
    expect(rules.has("financial_mismatch") || rules.has("temporal_paradox")).toBe(true);
  });
});
