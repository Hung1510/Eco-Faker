/**
 * Same content as ../config.schema.json, duplicated here as a plain object
 * so config.ts never needs `node:fs` to load it. That's what makes the
 * generator bundleable for browser use (see web-static/). If you edit the
 * validation rules, update BOTH this file and config.schema.json --
 * config.schema.json remains the canonical, tool-readable copy for anyone
 * inspecting the repo without running TypeScript.
 */
export const configSchemaObject = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://github.com/Hung1510/eco-faker/config.schema.json",
  title: "EcoFakerConfig",
  type: "object",
  additionalProperties: false,
  properties: {
    seed: {
      type: "integer",
      description: "Deterministic PRNG seed. Same seed + same config always produces the same dataset.",
      default: 1,
    },
    locale: {
      type: "string",
      description: "Locale used for names, addresses, and currency formatting.",
      enum: ["en-US", "en-GB", "es-ES", "de-DE", "fr-FR", "vi-VN"],
      default: "en-US",
    },
    scaleFactor: {
      type: "integer",
      description: "Number of core Users to generate.",
      minimum: 1,
      default: 100,
    },
    historicalDays: {
      type: "integer",
      description: "Generate data spanning the last X days.",
      minimum: 1,
      default: 90,
    },
    cartsPerUser: {
      type: "object",
      description: "Inclusive min/max number of carts generated per user.",
      additionalProperties: false,
      properties: {
        min: { type: "integer", minimum: 0, default: 1 },
        max: { type: "integer", minimum: 1, default: 4 },
      },
      default: { min: 1, max: 4 },
    },
    itemsPerCart: {
      type: "object",
      additionalProperties: false,
      properties: {
        min: { type: "integer", minimum: 1, default: 1 },
        max: { type: "integer", minimum: 1, default: 6 },
      },
      default: { min: 1, max: 6 },
    },
    abandonmentRate: {
      type: "number",
      description: "Chance a cart turns into an abandoned checkout instead of converting.",
      minimum: 0,
      maximum: 1,
      default: 0.35,
    },
    abandonmentTimeoutHours: {
      type: "number",
      description: "Window (in hours) after last activity during which a cart is considered freshly abandoned.",
      minimum: 3,
      default: 24,
    },
    recoveryEmailRate: {
      type: "number",
      description: "Chance an abandoned checkout received a recovery email.",
      minimum: 0,
      maximum: 1,
      default: 0.6,
    },
    recoveryConversionRate: {
      type: "number",
      description: "Chance a recovery-emailed checkout was eventually recovered (converted after the fact).",
      minimum: 0,
      maximum: 1,
      default: 0.2,
    },
    couponOfferRate: {
      type: "number",
      description: "Chance an abandoned checkout was offered a discount coupon.",
      minimum: 0,
      maximum: 1,
      default: 0.3,
    },
    returnRate: {
      type: "number",
      description: "Chance a delivered order gets a return request.",
      minimum: 0,
      maximum: 1,
      default: 0.08,
    },
    delayProbability: {
      type: "number",
      description: "Chance a shipment hits a Delayed status.",
      minimum: 0,
      maximum: 1,
      default: 0.15,
    },
    maxDelayDays: {
      type: "integer",
      description: "Maximum extra days added if a shipment is delayed.",
      minimum: 1,
      default: 3,
    },
    multiPackageRate: {
      type: "number",
      description: "Chance a converted order ships as 2+ separate packages/tracking numbers.",
      minimum: 0,
      maximum: 1,
      default: 0.1,
    },
    missingAddressRate: {
      type: "number",
      description: "Chance a converted order is missing a shipping address (edge case / data quality gap).",
      minimum: 0,
      maximum: 1,
      default: 0.05,
    },
    taxRate: {
      type: "number",
      description: "Flat tax rate applied to subtotal. Override per-locale if needed.",
      minimum: 0,
      default: 0.08,
    },
    freeShippingThreshold: {
      type: "number",
      description: "Orders with subtotal at or above this amount ship free.",
      minimum: 0,
      default: 75,
    },
    flatShippingCost: {
      type: "number",
      description: "Shipping cost charged when subtotal is below freeShippingThreshold.",
      minimum: 0,
      default: 6.99,
    },
    anomalies: {
      type: "object",
      description:
        "Rare, high-value edge cases injected to stress-test downstream systems (fraud detection, payment gateways, inventory).",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean", description: "Master switch for anomaly injection.", default: true },
        botCartRate: {
          type: "number",
          description: "Chance a cart is flagged as bot-like activity (50+ items, created 2-4am).",
          minimum: 0,
          maximum: 1,
          default: 0.02,
        },
        remoteShippingRate: {
          type: "number",
          description: "Chance an order ships to a remote region (Hawaii/Alaska/Puerto Rico) with a shipping surcharge.",
          minimum: 0,
          maximum: 1,
          default: 0.05,
        },
        contradictoryReturnRate: {
          type: "number",
          description: "Chance a negative-reason return request carries a contradictory high CSAT score.",
          minimum: 0,
          maximum: 1,
          default: 0.01,
        },
      },
      default: { enabled: true, botCartRate: 0.02, remoteShippingRate: 0.05, contradictoryReturnRate: 0.01 },
    },
  },
} as const;
