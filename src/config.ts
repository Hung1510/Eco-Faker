import { Ajv, type ErrorObject } from "ajv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { EcoFakerConfig } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve to the schema shipped alongside the package (works both from
// src/ under tsx and from dist/ after build, since the schema is copied
// to the package root -- see package.json "files").
function loadSchema(): object {
  const candidates = [
    path.resolve(__dirname, "../config.schema.json"),
    path.resolve(__dirname, "../../config.schema.json"),
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(readFileSync(candidate, "utf-8"));
    } catch {
      // try next candidate
    }
  }
  throw new Error("eco-faker: could not locate config.schema.json");
}

export const DEFAULT_CONFIG: EcoFakerConfig = {
  seed: 1,
  locale: "en-US",
  scaleFactor: 100,
  historicalDays: 90,
  cartsPerUser: { min: 1, max: 4 },
  itemsPerCart: { min: 1, max: 6 },
  abandonmentRate: 0.35,
  abandonmentTimeoutHours: 24,
  recoveryEmailRate: 0.6,
  recoveryConversionRate: 0.2,
  couponOfferRate: 0.3,
  returnRate: 0.08,
  delayProbability: 0.15,
  maxDelayDays: 3,
  multiPackageRate: 0.1,
  missingAddressRate: 0.05,
  taxRate: 0.08,
  freeShippingThreshold: 75,
  flatShippingCost: 6.99,
  anomalies: {
    enabled: true,
    botCartRate: 0.02,
    remoteShippingRate: 0.05,
    contradictoryReturnRate: 0.01,
  },
};

let cachedValidate: ((data: unknown) => boolean) & { errors?: ErrorObject[] | null } = undefined as never;
function getValidator() {
  if (!cachedValidate) {
    const ajv = new Ajv({ useDefaults: false, allErrors: true });
    cachedValidate = ajv.compile(loadSchema());
  }
  return cachedValidate;
}

/**
 * Combine multiple partial config overrides in precedence order (later
 * arguments win), correctly deep-merging the nested `cartsPerUser`,
 * `itemsPerCart`, and `anomalies` objects instead of letting a later
 * partial's nested object silently clobber an earlier one's fields.
 * Used to layer explicit CLI flags on top of a named scenario preset.
 */
export function mergeOverrides(...partials: Array<Partial<EcoFakerConfig> | undefined>): Partial<EcoFakerConfig> {
  const result: Partial<EcoFakerConfig> = {};
  for (const partial of partials) {
    if (!partial) continue;
    const priorCartsPerUser = result.cartsPerUser;
    const priorItemsPerCart = result.itemsPerCart;
    const priorAnomalies = result.anomalies;

    Object.assign(result, partial);

    if (partial.cartsPerUser) result.cartsPerUser = { ...priorCartsPerUser, ...partial.cartsPerUser };
    if (partial.itemsPerCart) result.itemsPerCart = { ...priorItemsPerCart, ...partial.itemsPerCart };
    if (partial.anomalies) {
      result.anomalies = { ...priorAnomalies, ...partial.anomalies } as EcoFakerConfig["anomalies"];
    }
  }
  return result;
}

/**
 * Merge a partial config over the defaults, then validate the *complete*
 * config against config.schema.json. Throws with all violations listed if
 * invalid, instead of failing on the first one.
 */
export function resolveConfig(overrides: Partial<EcoFakerConfig> = {}): EcoFakerConfig {
  const merged: EcoFakerConfig = {
    ...DEFAULT_CONFIG,
    ...overrides,
    cartsPerUser: { ...DEFAULT_CONFIG.cartsPerUser, ...overrides.cartsPerUser },
    itemsPerCart: { ...DEFAULT_CONFIG.itemsPerCart, ...overrides.itemsPerCart },
    anomalies: { ...DEFAULT_CONFIG.anomalies, ...overrides.anomalies },
  };

  const validate = getValidator();
  const valid = validate(merged);
  if (!valid) {
    const details = (validate.errors ?? [])
      .map((e: ErrorObject) => `  - ${e.instancePath || "(root)"} ${e.message}`)
      .join("\n");
    throw new Error(`eco-faker: invalid config:\n${details}`);
  }
  return merged;
}
