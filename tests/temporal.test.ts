import { describe, expect, it } from "vitest";
import { generateWithTemporalProfile, mergeDatasets, validateTemporalProfile, type TemporalProfile } from "../src/temporal.js";
import { generate } from "../src/generator.js";
import { lintDataset } from "../src/lint.js";
import { computeAnalytics } from "../src/analytics.js";

describe("temporal scenario engine", () => {
  describe("validateTemporalProfile", () => {
    it("accepts a valid, contiguous, zero-ending profile", () => {
      const profile: TemporalProfile = {
        name: "ok",
        segments: [
          { fromDaysAgo: 90, toDaysAgo: 30 },
          { fromDaysAgo: 30, toDaysAgo: 0 },
        ],
      };
      expect(() => validateTemporalProfile(profile)).not.toThrow();
    });

    it("rejects an empty segments array", () => {
      expect(() => validateTemporalProfile({ name: "empty", segments: [] })).toThrow(/no segments/);
    });

    it("rejects a segment with fromDaysAgo <= toDaysAgo", () => {
      const profile: TemporalProfile = { name: "bad", segments: [{ fromDaysAgo: 10, toDaysAgo: 10 }] };
      expect(() => validateTemporalProfile(profile)).toThrow(/positive span/);
    });

    it("rejects a gap between segments", () => {
      const profile: TemporalProfile = {
        name: "gap",
        segments: [
          { fromDaysAgo: 90, toDaysAgo: 40 },
          { fromDaysAgo: 30, toDaysAgo: 0 }, // gap: 40 != 30
        ],
      };
      expect(() => validateTemporalProfile(profile)).toThrow(/contiguous/);
    });

    it("rejects overlapping segments", () => {
      const profile: TemporalProfile = {
        name: "overlap",
        segments: [
          { fromDaysAgo: 90, toDaysAgo: 20 },
          { fromDaysAgo: 30, toDaysAgo: 0 }, // overlap: 30 < 20's parent boundary
        ],
      };
      expect(() => validateTemporalProfile(profile)).toThrow(/contiguous/);
    });

    it("rejects a profile whose last segment doesn't end at toDaysAgo: 0", () => {
      const profile: TemporalProfile = { name: "no-end", segments: [{ fromDaysAgo: 30, toDaysAgo: 5 }] };
      expect(() => validateTemporalProfile(profile)).toThrow(/must end at toDaysAgo: 0/);
    });

    it("rejects a segment referencing an unknown scenario", () => {
      const profile: TemporalProfile = {
        name: "bad-scenario",
        segments: [{ fromDaysAgo: 10, toDaysAgo: 0, scenario: "not-a-real-scenario" as any }],
      };
      expect(() => validateTemporalProfile(profile)).toThrow(/unknown scenario/);
    });
  });

  describe("mergeDatasets", () => {
    it("concatenates every table from N datasets into one", () => {
      const a = generate({ seed: 1, scaleFactor: 50 });
      const b = generate({ seed: 2, scaleFactor: 50 });
      const merged = mergeDatasets([a, b]);
      expect(merged.users.length).toBe(a.users.length + b.users.length);
      expect(merged.orders.length).toBe(a.orders.length + b.orders.length);
      expect(merged.products.length).toBe(a.products.length + b.products.length);
      expect(merged.supportTickets.length).toBe(a.supportTickets.length + b.supportTickets.length);
    });

    it("throws on an empty array rather than silently returning something malformed", () => {
      expect(() => mergeDatasets([])).toThrow(/at least one dataset/);
    });

    it("a merged dataset passes lint with zero issues -- no cross-dataset dangling references introduced by concatenation", () => {
      const a = generate({ seed: 3, scaleFactor: 100 });
      const b = generate({ seed: 4, scaleFactor: 100 });
      const merged = mergeDatasets([a, b]);
      expect(lintDataset(merged)).toEqual([]);
    });
  });

  describe("generateWithTemporalProfile", () => {
    const referenceNow = Date.parse("2026-07-19T12:00:00.000Z");
    const profile: TemporalProfile = {
      name: "holiday-arc",
      description: "steady baseline, then a Black Friday spike, then a post-holiday lull",
      segments: [
        { fromDaysAgo: 90, toDaysAgo: 20, scenario: "steady-state", label: "baseline" },
        { fromDaysAgo: 20, toDaysAgo: 13, scenario: "black-friday", label: "bf-spike" },
        { fromDaysAgo: 13, toDaysAgo: 0, scenario: "post-holiday-returns", label: "recovery" },
      ],
    };

    it("produces a real, non-empty merged dataset that passes lint with zero issues", () => {
      const dataset = generateWithTemporalProfile({ seed: 1 }, profile, referenceNow);
      expect(dataset.orders.length).toBeGreaterThan(0);
      expect(lintDataset(dataset)).toEqual([]);
    });

    it("no order timestamp falls outside the full span covered by the profile's segments", () => {
      const dataset = generateWithTemporalProfile({ seed: 1 }, profile, referenceNow);
      const oldestAllowed = referenceNow - 90 * 24 * 60 * 60 * 1000;
      for (const order of dataset.orders) {
        const ts = Date.parse(order.createdAt);
        expect(ts).toBeGreaterThanOrEqual(oldestAllowed);
        expect(ts).toBeLessThanOrEqual(referenceNow);
      }
    });

    it("is deterministic for a given base seed", () => {
      const a = generateWithTemporalProfile({ seed: 6 }, profile, referenceNow);
      const b = generateWithTemporalProfile({ seed: 6 }, profile, referenceNow);
      expect(JSON.stringify(a.orders)).toBe(JSON.stringify(b.orders));
    });

    it("actually produces a visible revenue arc -- the spike segment's daily order volume is meaningfully higher than the baseline segment's", () => {
      const dataset = generateWithTemporalProfile({ seed: 1 }, profile, referenceNow);
      const report = computeAnalytics(dataset);
      const day = 24 * 60 * 60 * 1000;

      const baselineWindowStart = referenceNow - 90 * day;
      const baselineWindowEnd = referenceNow - 20 * day;
      const spikeWindowStart = referenceNow - 20 * day;
      const spikeWindowEnd = referenceNow - 13 * day;

      const baselineDays = report.dailyRevenue.filter((d) => {
        const t = Date.parse(d.date);
        return t >= baselineWindowStart && t < baselineWindowEnd;
      });
      const spikeDays = report.dailyRevenue.filter((d) => {
        const t = Date.parse(d.date);
        return t >= spikeWindowStart && t < spikeWindowEnd;
      });

      expect(baselineDays.length).toBeGreaterThan(0);
      expect(spikeDays.length).toBeGreaterThan(0);

      const avgBaselineOrders = baselineDays.reduce((s, d) => s + d.orderCount, 0) / baselineDays.length;
      const avgSpikeOrders = spikeDays.reduce((s, d) => s + d.orderCount, 0) / spikeDays.length;
      expect(avgSpikeOrders).toBeGreaterThan(avgBaselineOrders * 3);
    });

    it("a segment's explicit overrides win over its scenario's tuning for the same field", () => {
      const customProfile: TemporalProfile = {
        name: "custom-override",
        segments: [{ fromDaysAgo: 10, toDaysAgo: 0, scenario: "black-friday", overrides: { scaleFactor: 42 } }],
      };
      const dataset = generateWithTemporalProfile({ seed: 1 }, customProfile, referenceNow);
      expect(dataset.users.length).toBe(42); // not black-friday's own 2000
    });

    it("the base overrides' seed is used as a starting point, but each segment gets a distinct derived seed (no duplicate content across segments)", () => {
      const twoSegmentProfile: TemporalProfile = {
        name: "two-segments",
        segments: [
          { fromDaysAgo: 20, toDaysAgo: 10, overrides: { scaleFactor: 30 } },
          { fromDaysAgo: 10, toDaysAgo: 0, overrides: { scaleFactor: 30 } },
        ],
      };
      const dataset = generateWithTemporalProfile({ seed: 1 }, twoSegmentProfile, referenceNow);
      const userIds = dataset.users.map((u) => u.id);
      expect(new Set(userIds).size).toBe(userIds.length); // no id collisions across segments
      // If both segments used the identical seed, their first users would
      // be byte-identical (same faker draw sequence from a fresh seed).
      expect(dataset.users[0]).not.toEqual(dataset.users[30]);
    });
  });
});
