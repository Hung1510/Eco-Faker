import type { EcoFakerConfig } from "./types.js";

export type ScenarioName =
  | "black-friday"
  | "post-holiday-returns"
  | "flash-sale"
  | "supply-chain-crisis"
  | "steady-state";

/**
 * Named, pre-tuned config bundles for recognizable business scenarios.
 * Each is a *partial* override -- anything not mentioned falls back to
 * DEFAULT_CONFIG (see config.ts), and any explicit CLI flags/overrides the
 * caller passes alongside a scenario still take precedence over the preset.
 */
export const SCENARIOS: Record<ScenarioName, Partial<EcoFakerConfig>> = {
  /**
   * High traffic, high abandonment (overwhelmed checkout flows / decision
   * paralysis from deals), but logistics haven't degraded yet -- shipments
   * are still fast because the delay hasn't caught up with the order spike.
   */
  "black-friday": {
    scaleFactor: 2000,
    historicalDays: 7,
    abandonmentRate: 0.55,
    couponOfferRate: 0.6,
    recoveryEmailRate: 0.75,
    delayProbability: 0.08,
    multiPackageRate: 0.18,
    returnRate: 0.05,
    anomalies: { enabled: true, botCartRate: 0.04, remoteShippingRate: 0.05, contradictoryReturnRate: 0.01 },
  },

  /**
   * Weeks after a peak season: low new-cart activity, but a wave of
   * returns and delayed shipments as carriers work through backlog.
   */
  "post-holiday-returns": {
    scaleFactor: 500,
    historicalDays: 45,
    abandonmentRate: 0.25,
    returnRate: 0.22,
    delayProbability: 0.35,
    maxDelayDays: 6,
    recoveryConversionRate: 0.1,
    anomalies: { enabled: true, botCartRate: 0.01, remoteShippingRate: 0.05, contradictoryReturnRate: 0.03 },
  },

  /**
   * Short, intense burst: very high abandonment (stock races out before
   * checkout completes), tiny historical window, low return rate (people
   * who fought for the item want to keep it).
   */
  "flash-sale": {
    scaleFactor: 3000,
    historicalDays: 2,
    abandonmentRate: 0.7,
    abandonmentTimeoutHours: 6,
    couponOfferRate: 0.1,
    delayProbability: 0.1,
    returnRate: 0.03,
    multiPackageRate: 0.05,
  },

  /**
   * Logistics network under strain: most shipments run late, multi-package
   * splits spike (partial fulfillment from constrained inventory), and
   * returns rise as delayed/damaged goods pile up.
   */
  "supply-chain-crisis": {
    scaleFactor: 800,
    historicalDays: 60,
    delayProbability: 0.5,
    maxDelayDays: 10,
    multiPackageRate: 0.3,
    missingAddressRate: 0.08,
    returnRate: 0.15,
    anomalies: { enabled: true, botCartRate: 0.02, remoteShippingRate: 0.08, contradictoryReturnRate: 0.02 },
  },

  /** Ordinary day-to-day traffic -- effectively DEFAULT_CONFIG, named for symmetry. */
  "steady-state": {
    scaleFactor: 300,
    historicalDays: 90,
  },
};

export function resolveScenario(name: string): Partial<EcoFakerConfig> {
  const scenario = SCENARIOS[name as ScenarioName];
  if (!scenario) {
    const valid = Object.keys(SCENARIOS).join(", ");
    throw new Error(`Unknown scenario "${name}". Valid scenarios: ${valid}`);
  }
  return scenario;
}
