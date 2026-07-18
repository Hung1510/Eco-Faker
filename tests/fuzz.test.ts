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
});
