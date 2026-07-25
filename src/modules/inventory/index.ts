import type { Faker } from "@faker-js/faker";
import type { Rng } from "../../rng.js";
import type {
  Dataset,
  EcoFakerConfig,
  ReplenishmentOrder,
  StockoutPeriod,
  Warehouse,
  WarehouseTransfer,
} from "../../types.js";

export interface InventorySimulationResult {
  warehouses: Warehouse[];
  replenishmentOrders: ReplenishmentOrder[];
  stockoutPeriods: StockoutPeriod[];
  warehouseTransfers: WarehouseTransfer[];
}

const STATUS_WEIGHTS: [ReplenishmentOrder["status"], number][] = [
  ["received", 55],
  ["in_transit", 25],
  ["ordered", 10],
  ["delayed", 10],
];

/**
 * Generates warehouses, replenishment orders, stockout periods, and
 * warehouse transfers as a post-processing pass over the *already
 * complete* dataset -- same architecture as
 * `generateRecommendationData`, and for the same reason: it runs with
 * its own fully decoupled `Faker`/`Rng` instances (a different seed
 * offset than recommendation data uses) so that enabling/disabling this
 * feature, or recommendation data, never shifts the other's output or
 * anything else's. See that module's docstring and ROADMAP.md for why
 * this is a deliberate choice rather than an oversight.
 *
 * Grounded in fields the product catalog already generates rather than
 * inventing a parallel, disconnected concept of "inventory":
 * `ReplenishmentOrder.expectedDeliveryAt` is `orderedAt +
 * supplier.leadTimeDays` (the exact field already on every `Supplier`),
 * and products/variants with a low current `stockLevel` are
 * preferentially given a recent stockout period and/or a pending
 * replenishment order -- a real, checkable correlation between "this
 * product currently shows low stock" and "here's why," rather than two
 * independently random numbers that happen to coexist.
 */
export function generateInventorySimulation(
  faker: Faker,
  rng: Rng,
  config: EcoFakerConfig,
  dataset: Dataset,
  referenceNow: number
): InventorySimulationResult {
  const warehouses: Warehouse[] = [];
  const replenishmentOrders: ReplenishmentOrder[] = [];
  const stockoutPeriods: StockoutPeriod[] = [];
  const warehouseTransfers: WarehouseTransfer[] = [];

  if (!config.inventorySimulation.enabled || dataset.products.length === 0) {
    return { warehouses, replenishmentOrders, stockoutPeriods, warehouseTransfers };
  }

  const warehouseCount = Math.max(2, Math.round(Math.sqrt(config.catalogSize)));
  for (let i = 0; i < warehouseCount; i++) {
    warehouses.push({
      id: faker.string.uuid(),
      name: `${faker.location.city()} Distribution Center`,
      country: faker.location.country(),
    });
  }

  const suppliersById = new Map(dataset.suppliers.map((s) => [s.id, s]));
  const day = 24 * 60 * 60 * 1000;

  for (const product of dataset.products) {
    const supplier = suppliersById.get(product.supplierId);
    if (!supplier) continue;
    const warehouse = rng.pick(warehouses);

    // A product/variant with low current stock is the real-world signal
    // that something in its recent inventory history explains it -- so
    // low stock levels get preferentially assigned a stockout period
    // and/or a pending replenishment, instead of every product getting
    // an independently random inventory history regardless of its
    // current stock.
    const stockLevels = product.variants.length > 0 ? product.variants.map((v) => v.stockLevel) : [rng.int(0, 500)];
    const lowestStock = Math.min(...stockLevels);
    const lowStockBias = lowestStock < 20 ? 0.7 : lowestStock < 100 ? 0.3 : 0.08;

    if (rng.chance(lowStockBias)) {
      const variant = product.variants.length > 0 ? rng.pick(product.variants) : undefined;
      const daysAgo = rng.int(1, 30);
      const startedAt = referenceNow - daysAgo * day;
      const stillOngoing = lowestStock === 0 && rng.chance(0.6);

      const replenishment = buildReplenishmentOrder(
        faker,
        rng,
        product.id,
        supplier.id,
        supplier.leadTimeDays,
        warehouse.id,
        startedAt,
        referenceNow
      );
      replenishmentOrders.push(replenishment);

      const resolved = replenishment.status === "received" && !stillOngoing;
      stockoutPeriods.push({
        id: faker.string.uuid(),
        productId: product.id,
        variantId: variant?.id ?? null,
        warehouseId: warehouse.id,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: resolved && replenishment.receivedAt ? replenishment.receivedAt : null,
        resolvedByReplenishmentId: resolved ? replenishment.id : null,
      });
    } else if (rng.chance(0.15)) {
      // Routine restocking, unrelated to a current shortage -- most
      // replenishment activity in a real warehouse isn't emergency
      // reactive restocking, it's scheduled reordering.
      const daysAgo = rng.int(1, 60);
      const startedAt = referenceNow - daysAgo * day;
      replenishmentOrders.push(
        buildReplenishmentOrder(faker, rng, product.id, supplier.id, supplier.leadTimeDays, warehouse.id, startedAt, referenceNow)
      );
    }

    if (warehouses.length > 1 && rng.chance(0.06)) {
      const fromWarehouse = warehouse;
      const toWarehouse = rng.pick(warehouses.filter((w) => w.id !== fromWarehouse.id));
      const initiatedAt = referenceNow - rng.int(1, 45) * day;
      const inTransit = rng.chance(0.15);
      warehouseTransfers.push({
        id: faker.string.uuid(),
        productId: product.id,
        fromWarehouseId: fromWarehouse.id,
        toWarehouseId: toWarehouse.id,
        quantity: rng.int(5, 200),
        initiatedAt: new Date(initiatedAt).toISOString(),
        completedAt: inTransit ? null : new Date(Math.min(initiatedAt + rng.int(1, 5) * day, referenceNow)).toISOString(),
      });
    }
  }

  return { warehouses, replenishmentOrders, stockoutPeriods, warehouseTransfers };
}

function buildReplenishmentOrder(
  faker: Faker,
  rng: Rng,
  productId: string,
  supplierId: string,
  leadTimeDays: number,
  warehouseId: string,
  orderedAtMs: number,
  referenceNow: number
): ReplenishmentOrder {
  const day = 24 * 60 * 60 * 1000;
  const expectedDeliveryMs = orderedAtMs + leadTimeDays * day;
  let status = rng.weighted(STATUS_WEIGHTS);

  // Internal consistency: a delivery expected in the future can't already
  // be "received," and one expected well in the past is very unlikely to
  // still be merely "ordered" -- nudge the sampled status toward what the
  // dates actually support instead of letting them silently disagree.
  if (expectedDeliveryMs > referenceNow && status === "received") {
    status = "in_transit";
  }
  if (expectedDeliveryMs < referenceNow - 3 * day && status === "ordered") {
    status = rng.chance(0.5) ? "delayed" : "received";
  }

  const receivedAt =
    status === "received"
      ? new Date(Math.min(expectedDeliveryMs + rng.int(-1, 2) * day, referenceNow)).toISOString()
      : null;

  return {
    id: faker.string.uuid(),
    productId,
    supplierId,
    warehouseId,
    quantityOrdered: rng.int(50, 2000),
    orderedAt: new Date(orderedAtMs).toISOString(),
    expectedDeliveryAt: new Date(expectedDeliveryMs).toISOString(),
    receivedAt,
    status,
  };
}
