import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";
import { applySemanticFuzzing, summarizeMutations } from "../src/fuzz.js";
import { lintDataset } from "../src/lint.js";

describe("semantic fuzzing", () => {
  it("does not mutate the input dataset -- returns a deep copy", () => {
    const dataset = generate({ seed: 4, scaleFactor: 80 });
    const before = JSON.stringify(dataset);
    applySemanticFuzzing(dataset, { intensity: "extreme", seed: 1 });
    expect(JSON.stringify(dataset)).toBe(before);
  });

  it("is deterministic for a given seed", () => {
    const dataset = generate({ seed: 4, scaleFactor: 80 });
    const a = applySemanticFuzzing(dataset, { intensity: "medium", seed: 42 });
    const b = applySemanticFuzzing(dataset, { intensity: "medium", seed: 42 });
    expect(JSON.stringify(a.mutations)).toBe(JSON.stringify(b.mutations));
    expect(JSON.stringify(a.dataset)).toBe(JSON.stringify(b.dataset));
  });

  it("restricting --types only applies the requested mutation types", () => {
    const dataset = generate({ seed: 4, scaleFactor: 80 });
    const { mutations } = applySemanticFuzzing(dataset, { intensity: "extreme", types: ["price_inversion"], seed: 1 });
    expect(mutations.length).toBeGreaterThan(0);
    expect(mutations.every((m) => m.type === "price_inversion")).toBe(true);
  });

  it("intensity=extreme produces at least as many mutations as intensity=low", () => {
    const dataset = generate({ seed: 4, scaleFactor: 80 });
    const low = applySemanticFuzzing(dataset, { intensity: "low", seed: 1 });
    const extreme = applySemanticFuzzing(dataset, { intensity: "extreme", seed: 1 });
    expect(extreme.mutations.length).toBeGreaterThanOrEqual(low.mutations.length);
  });

  it("address_mismatch produces a shippingAddress whose postalCode belongs to a different order's city/state", () => {
    const dataset = generate({ seed: 9, scaleFactor: 100 });
    const { dataset: mutated, mutations } = applySemanticFuzzing(dataset, {
      intensity: "extreme",
      types: ["address_mismatch"],
      seed: 3,
    });
    expect(mutations.length).toBeGreaterThan(0);
    const m = mutations[0];
    const mutatedOrder = mutated.orders.find((o) => o.id === m.recordId)!;
    expect(mutatedOrder.shippingAddress!.postalCode).toBe(m.after);
    expect(mutatedOrder.shippingAddress!.postalCode).not.toBe(m.before);
  });

  it("price_inversion leaves the order's subtotal/total stale relative to the mutated line item", () => {
    const dataset = generate({ seed: 9, scaleFactor: 100 });
    const { dataset: mutated, mutations } = applySemanticFuzzing(dataset, {
      intensity: "extreme",
      types: ["price_inversion"],
      seed: 3,
    });
    expect(mutations.length).toBeGreaterThan(0);
    const issues = lintDataset(mutated);
    expect(issues.some((i) => i.rule === "financial_mismatch")).toBe(true);
  });

  it("time_paradox produces a return request dated before its order's createdAt", () => {
    const dataset = generate({ seed: 9, scaleFactor: 100 });
    const { dataset: mutated, mutations } = applySemanticFuzzing(dataset, {
      intensity: "extreme",
      types: ["time_paradox"],
      seed: 3,
    });
    expect(mutations.length).toBeGreaterThan(0);
    const issues = lintDataset(mutated);
    expect(issues.some((i) => i.rule === "temporal_paradox")).toBe(true);
  });

  it("inventory_oversell produces an implausibly high per-order line item quantity", () => {
    const dataset = generate({ seed: 9, scaleFactor: 100 });
    const { mutations } = applySemanticFuzzing(dataset, {
      intensity: "extreme",
      types: ["inventory_oversell"],
      seed: 3,
    });
    expect(mutations.length).toBeGreaterThan(0);
    expect(mutations.every((m) => Number(m.after) >= 500)).toBe(true);
  });

  it("summarizeMutations groups counts by type", () => {
    const dataset = generate({ seed: 9, scaleFactor: 100 });
    const { mutations } = applySemanticFuzzing(dataset, { intensity: "medium", seed: 3 });
    const summary = summarizeMutations(mutations);
    const total = Object.values(summary).reduce((a, b) => a + b, 0);
    expect(total).toBe(mutations.length);
  });

  describe("regression: every mutation's claimed 'after' value stays valid against final dataset state", () => {
    // Regression test for a real bug: at "extreme" intensity (8 attempts
    // per type), the same record could be picked as a target more than
    // once by the same mutation type, so a *later* attempt could silently
    // invalidate an *earlier* mutation's recorded claim. This independently
    // re-derives each claim from the final mutated dataset instead of
    // trusting the value the code itself produced -- across many seeds, to
    // catch the collision regardless of which specific seed happens to
    // trigger it.
    const seeds = [1, 2, 3, 4, 5, 17, 42, 99];

    it.each(seeds)("seed=%i: address_mismatch claims match final postalCode", (seed) => {
      const dataset = generate({ seed: 20, scaleFactor: 150 });
      const { dataset: mutated, mutations } = applySemanticFuzzing(dataset, {
        intensity: "extreme",
        types: ["address_mismatch"],
        seed,
      });
      for (const m of mutations) {
        const order = mutated.orders.find((o) => o.id === m.recordId)!;
        expect(order.shippingAddress!.postalCode).toBe(m.after);
      }
    });

    it.each(seeds)("seed=%i: price_inversion claims match final unitPrice", (seed) => {
      const dataset = generate({ seed: 20, scaleFactor: 150 });
      const { dataset: mutated, mutations } = applySemanticFuzzing(dataset, {
        intensity: "extreme",
        types: ["price_inversion"],
        seed,
      });
      for (const m of mutations) {
        const order = mutated.orders.find((o) => o.id === m.recordId)!;
        const itemIndex = Number(m.field.match(/items\[(\d+)\]\.unitPrice/)![1]);
        expect(order.items[itemIndex].unitPrice).toBe(m.after);
      }
    });

    it.each(seeds)("seed=%i: inventory_oversell claims match final quantity", (seed) => {
      const dataset = generate({ seed: 20, scaleFactor: 150 });
      const { dataset: mutated, mutations } = applySemanticFuzzing(dataset, {
        intensity: "extreme",
        types: ["inventory_oversell"],
        seed,
      });
      for (const m of mutations) {
        const order = mutated.orders.find((o) => o.id === m.recordId)!;
        const itemIndex = Number(m.field.match(/items\[(\d+)\]\.quantity/)![1]);
        expect(order.items[itemIndex].quantity).toBe(m.after);
      }
    });

    it.each(seeds)("seed=%i: time_paradox claims match final requestedAt", (seed) => {
      const dataset = generate({ seed: 20, scaleFactor: 150 });
      const { dataset: mutated, mutations } = applySemanticFuzzing(dataset, {
        intensity: "extreme",
        types: ["time_paradox"],
        seed,
      });
      for (const m of mutations) {
        const ret = mutated.returnRequests.find((r) => r.id === m.recordId)!;
        expect(ret.requestedAt).toBe(m.after);
      }
    });

    it("no mutation type ever targets the same record twice in one run", () => {
      const dataset = generate({ seed: 20, scaleFactor: 200 });
      for (const type of ["address_mismatch", "price_inversion", "time_paradox", "inventory_oversell"] as const) {
        const { mutations } = applySemanticFuzzing(dataset, { intensity: "extreme", types: [type], seed: 7 });
        const recordIds = mutations.map((m) => m.recordId);
        expect(new Set(recordIds).size).toBe(recordIds.length);
      }
    });
  });
});
