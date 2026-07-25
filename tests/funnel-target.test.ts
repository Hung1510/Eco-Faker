import { describe, expect, it } from "vitest";
import { generateWithTargetFunnel } from "../src/funnel-target.js";
import { computeAnalytics } from "../src/analytics.js";

describe("generateWithTargetFunnel", () => {
  it("converges to within tolerance for a reachable mid-range target", () => {
    const result = generateWithTargetFunnel({ target: 0.5, overrides: { seed: 1, scaleFactor: 300 } });
    expect(result.withinTolerance).toBe(true);
    expect(Math.abs(result.achievedRate - 0.5)).toBeLessThanOrEqual(0.02);
  });

  it("the returned dataset's actual funnel matches the reported achievedRate exactly (not an estimate)", () => {
    const result = generateWithTargetFunnel({ target: 0.4, overrides: { seed: 2, scaleFactor: 300 } });
    const { funnel } = computeAnalytics(result.dataset);
    const viewed = funnel.find((f) => f.stage === "viewed")!.userCount;
    const purchased = funnel.find((f) => f.stage === "purchased")!.userCount;
    expect(result.achievedRate).toBeCloseTo(purchased / viewed, 10);
  });

  it("the calibrated abandonmentRate is actually baked into the returned dataset's config", () => {
    const result = generateWithTargetFunnel({ target: 0.6, overrides: { seed: 3, scaleFactor: 200 } });
    expect(result.dataset.config.abandonmentRate).toBe(result.calibratedAbandonmentRate);
  });

  it("is monotonic and reproducible: a higher target always calibrates to a lower (or equal) abandonmentRate for the same seed", () => {
    const low = generateWithTargetFunnel({ target: 0.2, overrides: { seed: 9, scaleFactor: 300 } });
    const high = generateWithTargetFunnel({ target: 0.8, overrides: { seed: 9, scaleFactor: 300 } });
    expect(high.calibratedAbandonmentRate).toBeLessThanOrEqual(low.calibratedAbandonmentRate);
  });

  it("terminates and reports withinTolerance:false, without throwing, for a target outside the reachable range", () => {
    // abandonmentRate=0 still can't force every single user to purchase (some abandoned checkouts/multi-cart
    // edge cases exist regardless), so a target of 1.0 is unreachable -- must fail honestly, not silently "succeed".
    const result = generateWithTargetFunnel({ target: 1.0, tolerance: 0.001, overrides: { seed: 4, scaleFactor: 150 } });
    expect(result.achievedRate).toBeLessThan(1.0);
    expect(result.withinTolerance).toBe(false);
    expect(result.calibratedAbandonmentRate).toBeLessThan(0.01);
  });

  it("respects a caller-supplied maxIterations cap", () => {
    const result = generateWithTargetFunnel({
      target: 0.37,
      maxIterations: 3,
      overrides: { seed: 5, scaleFactor: 150 },
    });
    expect(result.iterations).toBeLessThanOrEqual(3);
  });

  it("preserves other overrides (scaleFactor, seed, locale) while only calibrating abandonmentRate", () => {
    const result = generateWithTargetFunnel({
      target: 0.45,
      overrides: { seed: 6, scaleFactor: 80, locale: "en-GB" },
    });
    expect(result.dataset.users.length).toBe(80);
    expect(result.dataset.config.locale).toBe("en-GB");
    expect(result.dataset.config.seed).toBe(6);
  });
});
