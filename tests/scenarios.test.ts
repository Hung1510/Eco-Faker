import { describe, expect, it } from "vitest";
import { resolveScenario, SCENARIOS } from "../src/scenarios.js";
import { mergeOverrides } from "../src/config.js";
import { generate } from "../src/generator.js";

describe("scenario presets", () => {
  it("resolves a known scenario to its preset config", () => {
    expect(resolveScenario("black-friday")).toBe(SCENARIOS["black-friday"]);
  });

  it("throws a helpful error for an unknown scenario", () => {
    expect(() => resolveScenario("cyber-monday")).toThrow(/Unknown scenario "cyber-monday"/);
  });

  it("every scenario preset produces a valid, generatable config", () => {
    for (const [name, preset] of Object.entries(SCENARIOS)) {
      const dataset = generate({ ...preset, seed: 1, scaleFactor: 30 }, Date.parse("2026-01-01T00:00:00Z"));
      expect(dataset.users.length, `${name} should generate users`).toBe(30);
    }
  });
});

describe("mergeOverrides", () => {
  it("lets later partials win for scalar fields", () => {
    const merged = mergeOverrides({ scaleFactor: 100, abandonmentRate: 0.5 }, { scaleFactor: 200 });
    expect(merged.scaleFactor).toBe(200);
    expect(merged.abandonmentRate).toBe(0.5);
  });

  it("deep-merges the nested anomalies object instead of clobbering it", () => {
    const merged = mergeOverrides(
      { anomalies: { enabled: true, botCartRate: 0.1, remoteShippingRate: 0.2, contradictoryReturnRate: 0.01 } },
      { anomalies: { enabled: false } as any }
    );
    expect(merged.anomalies).toEqual({
      enabled: false,
      botCartRate: 0.1,
      remoteShippingRate: 0.2,
      contradictoryReturnRate: 0.01,
    });
  });

  it("ignores undefined partials", () => {
    const merged = mergeOverrides(undefined, { scaleFactor: 50 }, undefined);
    expect(merged.scaleFactor).toBe(50);
  });

  it("a scenario preset can be overridden by explicit flags, matching CLI precedence", () => {
    const merged = mergeOverrides(resolveScenario("black-friday"), { scaleFactor: 50 });
    expect(merged.scaleFactor).toBe(50); // explicit flag wins
    expect(merged.abandonmentRate).toBe(SCENARIOS["black-friday"].abandonmentRate); // scenario value kept
  });
});
