import { Faker, en, en_GB, es, de, fr, vi } from "@faker-js/faker";
import { Rng } from "./rng.js";
import { resolveConfig } from "./config.js";
import { generateUsers } from "./modules/user/index.js";
import { generateCatalog } from "./modules/catalog/index.js";
import { generateRecommendationData } from "./modules/recommendations/index.js";
import { generateInventorySimulation } from "./modules/inventory/index.js";
import { generateAbandonedCheckout, generateCartsForUser } from "./modules/cart/index.js";
import { convertCartToOrder } from "./modules/order/index.js";
import { deriveOrderStatus, generateShipmentsForOrder } from "./modules/tracking/index.js";
import { maybeGenerateReturnRequest } from "./modules/return/index.js";
import {
  maybeInjectBotCart,
  maybeInjectContradictoryReturn,
  maybeInjectRemoteShipping,
} from "./modules/anomaly/index.js";
import type {
  AbandonedCheckout,
  Brand,
  Cart,
  Category,
  Dataset,
  EcoFakerConfig,
  Order,
  Product,
  ReturnRequest,
  Shipment,
  Supplier,
  User,
} from "./types.js";

function localeToFakerModule(locale: EcoFakerConfig["locale"]) {
  switch (locale) {
    case "en-GB":
      return en_GB;
    case "es-ES":
      return es;
    case "de-DE":
      return de;
    case "fr-FR":
      return fr;
    case "vi-VN":
      return vi;
    default:
      return en;
  }
}

export type StreamRecord =
  | { table: "categories"; record: Category }
  | { table: "brands"; record: Brand }
  | { table: "suppliers"; record: Supplier }
  | { table: "products"; record: Product }
  | { table: "users"; record: User }
  | { table: "carts"; record: Cart }
  | { table: "abandoned_checkouts"; record: AbandonedCheckout }
  | { table: "orders"; record: Order }
  | { table: "shipments"; record: Shipment }
  | { table: "return_requests"; record: ReturnRequest };

/**
 * The single source of truth for the generation pipeline. A plain
 * synchronous generator function, so it works two ways:
 * - `generate()` below drains it fully into in-memory arrays (the normal,
 *   convenient API).
 * - `generateRecords()` is exported directly for streaming callers (the
 *   CLI's `--stream` mode) that want to emit each record the instant it's
 *   produced, without ever holding the full dataset in memory.
 *
 * Deterministic: the same `config` (including `seed`) AND the same
 * `referenceNow` always produce the exact same sequence of records, byte
 * for byte. `referenceNow` defaults to the current wall-clock time, which
 * is why two separate calls -- even with an identical seed -- will differ
 * slightly if real time has passed between them (the "last N days" window
 * shifts). Pass an explicit `referenceNow` (epoch ms) for pinned
 * reproducibility, e.g. in tests, CI fixtures, or replayed snapshots.
 */
export function* generateRecords(
  overrides: Partial<EcoFakerConfig> = {},
  referenceNow: number = Date.now()
): Generator<StreamRecord, EcoFakerConfig, void> {
  const config = resolveConfig(overrides);
  const rng = new Rng(config.seed);
  const faker = new Faker({ locale: localeToFakerModule(config.locale) });
  faker.seed(config.seed);
  const now = referenceNow;

  const users = generateUsers(faker, rng, config, now);
  const catalog = generateCatalog(faker, rng, config);

  for (const category of catalog.categories) yield { table: "categories", record: category };
  for (const brand of catalog.brands) yield { table: "brands", record: brand };
  for (const supplier of catalog.suppliers) yield { table: "suppliers", record: supplier };
  for (const product of catalog.products) yield { table: "products", record: product };

  for (const user of users) {
    yield { table: "users", record: user };

    const carts = generateCartsForUser(faker, rng, config, user, now, catalog.products);

    for (const cart of carts) {
      maybeInjectBotCart(faker, rng, config, cart, catalog.products);
      yield { table: "carts", record: cart };

      if (cart.status === "abandoned") {
        yield { table: "abandoned_checkouts", record: generateAbandonedCheckout(faker, rng, config, cart) };
        continue;
      }
      if (cart.status === "active") {
        continue; // no order, no checkout -- still in progress.
      }

      // status === "converted"
      const order = convertCartToOrder(faker, rng, config, cart, user);
      maybeInjectRemoteShipping(rng, config, order);

      const shipments = generateShipmentsForOrder(faker, rng, config, order, now);
      order.status = deriveOrderStatus(shipments);

      yield { table: "orders", record: order };
      for (const shipment of shipments) yield { table: "shipments", record: shipment };

      const returnRequest = maybeGenerateReturnRequest(faker, rng, config, order, shipments, now);
      if (returnRequest) {
        maybeInjectContradictoryReturn(rng, config, returnRequest);
        yield { table: "return_requests", record: returnRequest };
      }
    }
  }

  return config;
}

/** Convenience wrapper: drains `generateRecords` into a fully-materialized Dataset. */
export function generate(overrides: Partial<EcoFakerConfig> = {}, referenceNow: number = Date.now()): Dataset {
  const dataset: Dataset = {
    config: resolveConfig(overrides),
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
  };

  const iterator = generateRecords(overrides, referenceNow);
  let next = iterator.next();
  while (!next.done) {
    const { table, record } = next.value;
    switch (table) {
      case "categories":
        dataset.categories.push(record);
        break;
      case "brands":
        dataset.brands.push(record);
        break;
      case "suppliers":
        dataset.suppliers.push(record);
        break;
      case "products":
        dataset.products.push(record);
        break;
      case "users":
        dataset.users.push(record);
        break;
      case "carts":
        dataset.carts.push(record);
        break;
      case "abandoned_checkouts":
        dataset.abandonedCheckouts.push(record);
        break;
      case "orders":
        dataset.orders.push(record);
        break;
      case "shipments":
        dataset.shipments.push(record);
        break;
      case "return_requests":
        dataset.returnRequests.push(record);
        break;
    }
    next = iterator.next();
  }
  dataset.config = next.value; // the resolved config, returned by the generator

  // Recommendation data runs as a separate post-processing pass with its
  // own decoupled Faker/Rng instances (offset seed) -- see
  // generateRecommendationData's docstring for why this is a deliberate
  // architecture choice, not an oversight. It never touches the RNG
  // stream the rest of the dataset was generated from, so whether this
  // feature is even enabled has zero effect on every other table's output.
  const recFaker = new Faker({ locale: localeToFakerModule(dataset.config.locale) });
  recFaker.seed(dataset.config.seed ^ 0x5eed5eed);
  const recRng = new Rng(dataset.config.seed ^ 0x5eed5eed);
  const recData = generateRecommendationData(recFaker, recRng, dataset.config, dataset, referenceNow);
  dataset.productViews = recData.productViews;
  dataset.searchQueries = recData.searchQueries;
  dataset.wishlistItems = recData.wishlistItems;
  dataset.productRatings = recData.productRatings;

  // Independent seed offset from recommendation data's -- toggling either
  // feature must never shift the other's output. See
  // generateInventorySimulation's docstring for why.
  const invFaker = new Faker({ locale: localeToFakerModule(dataset.config.locale) });
  invFaker.seed(dataset.config.seed ^ 0x9a7c1a13);
  const invRng = new Rng(dataset.config.seed ^ 0x9a7c1a13);
  const invData = generateInventorySimulation(invFaker, invRng, dataset.config, dataset, referenceNow);
  dataset.warehouses = invData.warehouses;
  dataset.replenishmentOrders = invData.replenishmentOrders;
  dataset.stockoutPeriods = invData.stockoutPeriods;
  dataset.warehouseTransfers = invData.warehouseTransfers;

  return dataset;
}
