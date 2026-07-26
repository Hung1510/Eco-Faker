import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";
import { computeRealismScore } from "../src/score.js";
import { applySemanticFuzzing } from "../src/fuzz.js";
import { lintDataset } from "../src/lint.js";

describe("computeRealismScore", () => {
  it("scores a clean, real generated dataset at 100 across every dimension", () => {
    const dataset = generate({ seed: 5, scaleFactor: 300 });
    expect(lintDataset(dataset)).toEqual([]); // sanity: this dataset really is clean
    const result = computeRealismScore(dataset);
    expect(result.overall).toBe(100);
    for (const dim of result.dimensions) {
      expect(dim.score, `${dim.name} should be 100 on clean data`).toBe(100);
    }
  });

  it("returns exactly these five dimensions, every time", () => {
    const dataset = generate({ seed: 1, scaleFactor: 50 });
    const result = computeRealismScore(dataset);
    expect(result.dimensions.map((d) => d.name).sort()).toEqual([
      "distribution_shape",
      "financial_consistency",
      "referential_integrity",
      "temporal_plausibility",
      "uniqueness",
    ]);
  });

  it("overall is the unweighted mean of the five dimension scores", () => {
    const dataset = generate({ seed: 3, scaleFactor: 100 });
    const result = computeRealismScore(dataset);
    const mean = result.dimensions.reduce((sum, d) => sum + d.score, 0) / result.dimensions.length;
    expect(result.overall).toBe(Math.round(mean));
  });

  it("financial_consistency drops in exact proportion to real fuzz-introduced financial_mismatch lint issues", () => {
    const dataset = generate({ seed: 7, scaleFactor: 300 });
    const { dataset: fuzzed } = applySemanticFuzzing(dataset, { types: ["price_inversion"], intensity: "extreme", fuzzSeed: 1 });
    const issues = lintDataset(fuzzed).filter((i) => i.rule === "financial_mismatch");
    expect(issues.length).toBeGreaterThan(0); // sanity: fuzzing actually introduced real mismatches

    const result = computeRealismScore(fuzzed);
    const financial = result.dimensions.find((d) => d.name === "financial_consistency")!;
    const expectedScore = Math.min(99, Math.floor(100 * (1 - issues.length / fuzzed.orders.length)));
    expect(financial.score).toBe(expectedScore);
    expect(financial.score).toBeLessThan(100);
  });

  it("temporal_plausibility drops in exact proportion to real fuzz-introduced temporal_paradox lint issues", () => {
    const dataset = generate({ seed: 7, scaleFactor: 300 });
    const { dataset: fuzzed } = applySemanticFuzzing(dataset, { types: ["time_paradox"], intensity: "extreme", fuzzSeed: 1 });
    const issues = lintDataset(fuzzed).filter((i) => i.rule === "temporal_paradox");
    expect(issues.length).toBeGreaterThan(0);

    const result = computeRealismScore(fuzzed);
    const temporal = result.dimensions.find((d) => d.name === "temporal_plausibility")!;
    const expectedScore = Math.min(99, Math.floor(100 * (1 - issues.length / fuzzed.returnRequests.length)));
    expect(temporal.score).toBe(expectedScore);
    expect(temporal.score).toBeLessThan(100);
  });

  it("temporal_plausibility is 100 (vacuously) when there are no return requests to check", () => {
    const dataset = generate({ seed: 1, scaleFactor: 300 });
    dataset.returnRequests = [];
    const result = computeRealismScore(dataset);
    const temporal = result.dimensions.find((d) => d.name === "temporal_plausibility")!;
    expect(temporal.score).toBe(100);
    expect(temporal.detail).toContain("no return requests");
  });

  it("distribution_shape scores low on a deliberately flat (zero-variance) order-value distribution", () => {
    const dataset = generate({ seed: 1, scaleFactor: 300 });
    for (const order of dataset.orders) order.total = 100;
    const result = computeRealismScore(dataset);
    const shape = result.dimensions.find((d) => d.name === "distribution_shape")!;
    expect(shape.score).toBeLessThan(50);
  });

  it("distribution_shape scores highly on a real generated dataset's actual order-value spread/skew", () => {
    const dataset = generate({ seed: 2, scaleFactor: 400 });
    const result = computeRealismScore(dataset);
    const shape = result.dimensions.find((d) => d.name === "distribution_shape")!;
    expect(shape.score).toBeGreaterThan(70);
  });

  it("distribution_shape doesn't crash and reports vacuously fine on too few orders to assess", () => {
    const dataset = generate({ seed: 1, scaleFactor: 300 });
    dataset.orders = dataset.orders.slice(0, 2);
    const result = computeRealismScore(dataset);
    const shape = result.dimensions.find((d) => d.name === "distribution_shape")!;
    expect(shape.score).toBe(100);
  });

  it("uniqueness drops when a real duplicate id or email is introduced", () => {
    const dataset = generate({ seed: 1, scaleFactor: 100 });
    const clean = computeRealismScore(dataset);
    expect(clean.dimensions.find((d) => d.name === "uniqueness")!.score).toBe(100);

    dataset.users[1].email = dataset.users[0].email;
    const withDuplicate = computeRealismScore(dataset);
    expect(withDuplicate.dimensions.find((d) => d.name === "uniqueness")!.score).toBeLessThan(100);
  });

  it("referential_integrity drops when a real orphaned foreign key is introduced", () => {
    const dataset = generate({ seed: 1, scaleFactor: 100 });
    dataset.orders[0].userId = "does-not-exist";
    const result = computeRealismScore(dataset);
    expect(result.dimensions.find((d) => d.name === "referential_integrity")!.score).toBeLessThan(100);
  });

  it("never returns a score below 0 or above 100 on any dimension, even on a heavily fuzzed dataset", () => {
    const dataset = generate({ seed: 9, scaleFactor: 400 });
    const { dataset: fuzzed } = applySemanticFuzzing(dataset, { intensity: "extreme", fuzzSeed: 3 });
    const result = computeRealismScore(fuzzed);
    for (const dim of result.dimensions) {
      expect(dim.score).toBeGreaterThanOrEqual(0);
      expect(dim.score).toBeLessThanOrEqual(100);
    }
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(100);
  });
});
