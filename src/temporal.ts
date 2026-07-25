import { generate } from "./generator.js";
import { DEFAULT_CONFIG, mergeOverrides } from "./config.js";
import { SCENARIOS } from "./scenarios.js";
import type { Dataset, EcoFakerConfig } from "./types.js";

export interface TemporalSegment {
  /** How many days before referenceNow this segment's *older* edge sits. Must be strictly greater than toDaysAgo. */
  fromDaysAgo: number;
  /** How many days before referenceNow this segment's *newer* edge sits. The last segment in a profile must end at 0 (i.e. run up to referenceNow itself). */
  toDaysAgo: number;
  /** Config overrides applied only within this segment, layered on top of the profile's shared base overrides -- can reference a built-in scenario name via `scenario`, or set fields directly. */
  overrides?: Partial<EcoFakerConfig>;
  /** A built-in scenario name to apply for this segment, e.g. "black-friday" -- layered under `overrides`, which still wins on any field both specify. */
  scenario?: keyof typeof SCENARIOS;
  label?: string;
}

export interface TemporalProfile {
  name: string;
  description?: string;
  /** Ordered oldest-first. Must be contiguous and non-overlapping: segments[i].toDaysAgo === segments[i+1].fromDaysAgo for every adjacent pair, and the last segment must end at toDaysAgo: 0. */
  segments: TemporalSegment[];
}

const day = 24 * 60 * 60 * 1000;

/**
 * A small set of built-in, named temporal profiles -- the same
 * "reusable preset" convenience `SCENARIOS` provides for a single flat
 * config, extended to a sequence of them over calendar time. Each one
 * reuses the existing scenario presets as building blocks rather than
 * inventing new tuning from scratch.
 */
export const TEMPORAL_PROFILES: Record<string, TemporalProfile> = {
  "holiday-arc": {
    name: "holiday-arc",
    description: "70 days of ordinary traffic, a 7-day Black Friday spike, then 13 days of post-holiday returns.",
    segments: [
      { fromDaysAgo: 90, toDaysAgo: 20, scenario: "steady-state", label: "baseline" },
      { fromDaysAgo: 20, toDaysAgo: 13, scenario: "black-friday", label: "bf-spike" },
      { fromDaysAgo: 13, toDaysAgo: 0, scenario: "post-holiday-returns", label: "recovery" },
    ],
  },
  "supply-chain-decline": {
    name: "supply-chain-decline",
    description: "45 days of ordinary traffic, sliding into a 45-day supply-chain crisis that's still ongoing as of referenceNow.",
    segments: [
      { fromDaysAgo: 90, toDaysAgo: 45, scenario: "steady-state", label: "baseline" },
      { fromDaysAgo: 45, toDaysAgo: 0, scenario: "supply-chain-crisis", label: "crisis" },
    ],
  },
  "flash-sale-week": {
    name: "flash-sale-week",
    description: "27 days of ordinary traffic, a single 1-day flash sale spike, then 2 more ordinary days.",
    segments: [
      { fromDaysAgo: 30, toDaysAgo: 3, scenario: "steady-state", label: "baseline" },
      { fromDaysAgo: 3, toDaysAgo: 2, scenario: "flash-sale", label: "flash-sale" },
      { fromDaysAgo: 2, toDaysAgo: 0, scenario: "steady-state", label: "after" },
    ],
  },
};

export function validateTemporalProfile(profile: TemporalProfile): void {
  if (!profile.segments || profile.segments.length === 0) {
    throw new Error(`Temporal profile "${profile.name}" has no segments.`);
  }
  for (const segment of profile.segments) {
    if (segment.fromDaysAgo <= segment.toDaysAgo) {
      throw new Error(
        `Temporal profile "${profile.name}": segment "${segment.label ?? "(unlabeled)"}" has fromDaysAgo (${segment.fromDaysAgo}) <= toDaysAgo (${segment.toDaysAgo}) -- every segment must cover a positive span of days.`
      );
    }
    if (segment.scenario && !(segment.scenario in SCENARIOS)) {
      const valid = Object.keys(SCENARIOS).join(", ");
      throw new Error(
        `Temporal profile "${profile.name}": segment "${segment.label ?? "(unlabeled)"}" references unknown scenario "${segment.scenario}". Valid scenarios: ${valid}`
      );
    }
  }
  for (let i = 0; i < profile.segments.length - 1; i++) {
    const current = profile.segments[i];
    const next = profile.segments[i + 1];
    if (current.toDaysAgo !== next.fromDaysAgo) {
      throw new Error(
        `Temporal profile "${profile.name}": segments must be contiguous with no gaps or overlaps -- segment ${i} ends at ${current.toDaysAgo} days ago but segment ${i + 1} starts at ${next.fromDaysAgo} days ago.`
      );
    }
  }
  const last = profile.segments[profile.segments.length - 1];
  if (last.toDaysAgo !== 0) {
    throw new Error(
      `Temporal profile "${profile.name}": the last segment must end at toDaysAgo: 0 (i.e. run up through referenceNow) -- got ${last.toDaysAgo}.`
    );
  }
}

/**
 * Concatenates every table from N independently-generated datasets into
 * one. Safe by construction: each input dataset was generated with its
 * own distinct seed (no UUID collisions in practice) and is internally
 * referentially consistent on its own (no record ever references
 * anything outside its own dataset) -- concatenation can't introduce a
 * dangling reference that didn't already exist, and `lint` verifies this
 * holds on the actual merged result rather than just assuming it.
 *
 * Two known, deliberate simplifications, not oversights: each segment
 * generates its own independent product catalog and its own independent
 * user pool, rather than sharing one catalog/user base across the whole
 * profile. A real repeat customer shopping in both the "steady" and
 * "spike" portions of a profile isn't modeled -- every segment's users
 * are disjoint from every other segment's. Sharing a catalog or user
 * pool across segments would require restructuring `generate()` to
 * accept pre-built inputs, which is exactly the kind of core-loop change
 * this whole module was designed to avoid (see ROADMAP.md on why: it's
 * what caused three latent bugs to surface elsewhere when the product
 * catalog was integrated into the core loop earlier this project).
 */
export function mergeDatasets(datasets: Dataset[]): Dataset {
  if (datasets.length === 0) {
    throw new Error("mergeDatasets requires at least one dataset.");
  }
  const merged: Dataset = {
    config: datasets[0].config,
    categories: [],
    brands: [],
    suppliers: [],
    products: [],
    users: [],
    carts: [],
    abandonedCheckouts: [],
    orders: [],
    shipments: [],
    returnRequests: [],
    productViews: [],
    searchQueries: [],
    wishlistItems: [],
    productRatings: [],
    warehouses: [],
    replenishmentOrders: [],
    stockoutPeriods: [],
    warehouseTransfers: [],
    supportTickets: [],
    supportMessages: [],
    emailMessages: [],
  };
  for (const dataset of datasets) {
    merged.categories.push(...dataset.categories);
    merged.brands.push(...dataset.brands);
    merged.suppliers.push(...dataset.suppliers);
    merged.products.push(...dataset.products);
    merged.users.push(...dataset.users);
    merged.carts.push(...dataset.carts);
    merged.abandonedCheckouts.push(...dataset.abandonedCheckouts);
    merged.orders.push(...dataset.orders);
    merged.shipments.push(...dataset.shipments);
    merged.returnRequests.push(...dataset.returnRequests);
    merged.productViews.push(...dataset.productViews);
    merged.searchQueries.push(...dataset.searchQueries);
    merged.wishlistItems.push(...dataset.wishlistItems);
    merged.productRatings.push(...dataset.productRatings);
    merged.warehouses.push(...dataset.warehouses);
    merged.replenishmentOrders.push(...dataset.replenishmentOrders);
    merged.stockoutPeriods.push(...dataset.stockoutPeriods);
    merged.warehouseTransfers.push(...dataset.warehouseTransfers);
    merged.supportTickets.push(...dataset.supportTickets);
    merged.supportMessages.push(...dataset.supportMessages);
    merged.emailMessages.push(...dataset.emailMessages);
  }
  return merged;
}

/**
 * Generates a dataset whose config effectively varies over calendar
 * time within a single call -- a quiet baseline, then a demand spike,
 * then a slow recovery, all in one dataset, rather than one flat
 * config for the whole `historicalDays` window.
 *
 * Implemented as N ordinary, fully-normal `generate()` calls (one per
 * segment, each with its own bounded `historicalDays` and shifted
 * `referenceNow` so its timestamps land in the right absolute window),
 * merged together with `mergeDatasets`. Deliberately NOT implemented by
 * modifying the core per-day generation loop to accept a time-varying
 * parameter function -- every segment is exactly the same generate()
 * path already covered by this project's entire existing test suite,
 * so this feature adds zero new risk to anything else `generate()`
 * produces. See `mergeDatasets`'s docstring for the two simplifications
 * that trade-off buys (independent catalogs and user pools per segment).
 */
export function generateWithTemporalProfile(
  baseOverrides: Partial<EcoFakerConfig>,
  profile: TemporalProfile,
  referenceNow: number = Date.now()
): Dataset {
  validateTemporalProfile(profile);
  const baseSeed = baseOverrides.seed ?? DEFAULT_CONFIG.seed;

  const segmentDatasets = profile.segments.map((segment, i) => {
    const segmentDays = segment.fromDaysAgo - segment.toDaysAgo;
    const segmentReferenceNow = referenceNow - segment.toDaysAgo * day;
    const scenarioOverrides = segment.scenario ? SCENARIOS[segment.scenario] : undefined;
    // Precedence here is deliberately the opposite direction from the
    // `--scenario` CLI flag elsewhere in this codebase, where an
    // explicit flag always wins over a scenario preset. Here, a
    // segment's own scenario wins over the profile's shared
    // baseOverrides for any field the scenario sets -- because the
    // entire point of a "spike" segment is that it actually spikes; if
    // a shared base scaleFactor always won, every segment would end up
    // with the same volume and there'd be no arc to see at all. A
    // segment's own explicit `overrides` still wins over everything
    // (both its scenario and the shared base), same as elsewhere.
    const segmentOverrides = mergeOverrides(baseOverrides, scenarioOverrides, segment.overrides, {
      historicalDays: segmentDays,
      seed: baseSeed + i + 1,
    });
    return generate(segmentOverrides, segmentReferenceNow);
  });

  return mergeDatasets(segmentDatasets);
}
