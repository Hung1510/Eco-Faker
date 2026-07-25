import { generate } from "./generator.js";
import { computeAnalytics } from "./analytics.js";
import type { Dataset, EcoFakerConfig } from "./types.js";

export interface FunnelTargetOptions {
  /** Desired overall view -> purchase conversion rate, 0..1. */
  target: number;
  /** Base config -- everything except `abandonmentRate`, which this function calibrates and overwrites. */
  overrides?: Partial<EcoFakerConfig>;
  referenceNow?: number;
  /** Stop searching once the achieved rate is within this of the target (default 0.02, i.e. +/-2 points). */
  tolerance?: number;
  /** Binary-search step cap (default 14 -- more than enough to resolve `abandonmentRate` to within ~0.0001 of its optimum). */
  maxIterations?: number;
}

export interface FunnelTargetResult {
  dataset: Dataset;
  targetRate: number;
  achievedRate: number;
  /** True if `achievedRate` landed within `tolerance` of `targetRate`. */
  withinTolerance: boolean;
  /** The `abandonmentRate` the search converged on -- already baked into `dataset`. */
  calibratedAbandonmentRate: number;
  /** How many `generate()` calls the search took. */
  iterations: number;
}

/**
 * Targets a specific view -> purchase conversion rate by binary-searching
 * `abandonmentRate` across repeated, ordinary `generate()` calls -- never
 * touching the generation loop itself, the same "stay outside core
 * generation" discipline every other post-processing feature in this
 * project follows, just applied to config search instead of a new table.
 *
 * Why `abandonmentRate` specifically, and why only view -> purchase: with
 * `cartsPerUser.min` defaulting to (and realistically always being) >= 1,
 * every user with a product view also gets at least one cart, so the
 * `viewed` and `added_to_cart` funnel stages are already ~100% of each
 * other by construction -- there's no existing knob that makes a user
 * view products without ever starting a cart, and adding one would mean
 * reworking cart creation itself (a core-loop change, not a
 * post-processing one). `abandonmentRate` is what actually moves
 * `checkout_started -> purchased`, so it's the one real lever available
 * for shaping the overall view -> purchase rate without crossing that
 * line. The relationship isn't linear -- a user with multiple carts
 * purchases if *any* one of them converts, so the achieved rate at a
 * given `abandonmentRate` is higher than `1 - abandonmentRate` -- which is
 * exactly why this searches for the right value empirically rather than
 * computing it from a formula.
 *
 * Binary search works because the relationship is monotonic: raising
 * `abandonmentRate` can only lower (or hold flat) the purchase rate,
 * never raise it. If the target is outside what's reachable at
 * `abandonmentRate` in [0, 1] (e.g. a target higher than this dataset's
 * other config ever produces even at `abandonmentRate=0`), the search
 * still terminates at the boundary and reports `withinTolerance: false`
 * with the closest rate actually achieved, rather than silently
 * returning a dataset that doesn't hit the target.
 */
export function generateWithTargetFunnel(options: FunnelTargetOptions): FunnelTargetResult {
  const tolerance = options.tolerance ?? 0.02;
  const maxIterations = options.maxIterations ?? 14;
  const referenceNow = options.referenceNow ?? Date.now();

  let lo = 0;
  let hi = 1;
  let best: { dataset: Dataset; rate: number; abandonmentRate: number } | undefined;
  let iterations = 0;

  for (let i = 0; i < maxIterations; i++) {
    iterations++;
    const abandonmentRate = (lo + hi) / 2;
    const dataset = generate({ ...options.overrides, abandonmentRate }, referenceNow);
    const { funnel } = computeAnalytics(dataset);
    const viewedStage = funnel.find((f) => f.stage === "viewed");
    const purchasedStage = funnel.find((f) => f.stage === "purchased");
    // Falls back to `added_to_cart` as the denominator if recommendationData
    // is disabled (no `viewed` stage exists at all) -- still the correct
    // "everyone who could have purchased" baseline in that case, since
    // added_to_cart is ~100% of users either way.
    const denominator = viewedStage?.userCount ?? funnel.find((f) => f.stage === "added_to_cart")?.userCount ?? 0;
    const rate = denominator > 0 ? (purchasedStage?.userCount ?? 0) / denominator : 0;

    if (!best || Math.abs(rate - options.target) < Math.abs(best.rate - options.target)) {
      best = { dataset, rate, abandonmentRate };
    }
    if (Math.abs(rate - options.target) <= tolerance) break;

    // Monotonic decreasing: higher abandonmentRate -> lower purchase rate.
    if (rate > options.target) lo = abandonmentRate;
    else hi = abandonmentRate;
  }

  return {
    dataset: best!.dataset,
    targetRate: options.target,
    achievedRate: best!.rate,
    withinTolerance: Math.abs(best!.rate - options.target) <= tolerance,
    calibratedAbandonmentRate: best!.abandonmentRate,
    iterations,
  };
}
