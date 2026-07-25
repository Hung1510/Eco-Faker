import { Rng } from "./rng.js";
import type { Address, Dataset, Order } from "./types.js";

export type FuzzMutationType = "address_mismatch" | "price_inversion" | "time_paradox" | "inventory_oversell";

export type FuzzIntensity = "low" | "medium" | "extreme";

/** Roughly how many mutations to attempt per intensity level, per mutation type. */
const INTENSITY_ATTEMPTS: Record<FuzzIntensity, number> = { low: 1, medium: 3, extreme: 8 };

export interface FuzzMutation {
  type: FuzzMutationType;
  table: "orders" | "returnRequests";
  recordId: string;
  field: string;
  before: unknown;
  after: unknown;
  /** Plain-English description of why this mutation is "valid but logically impossible" -- what it's testing for. */
  reason: string;
}

export interface FuzzOptions {
  /** How aggressively to mutate (default: "medium"). Each level attempts more mutations per type. */
  intensity?: FuzzIntensity;
  /** Restrict to a subset of mutation types (default: all four). */
  types?: FuzzMutationType[];
  /** Seed for reproducible mutation selection (default: 1). */
  seed?: number;
}

export interface FuzzResult {
  /** Deep copy of the input dataset with mutations applied -- the input is never modified. */
  dataset: Dataset;
  mutations: FuzzMutation[];
}

const ALL_TYPES: FuzzMutationType[] = ["address_mismatch", "price_inversion", "time_paradox", "inventory_oversell"];

/**
 * Semantic fuzzing: unlike schema/type fuzzing (nulls, wrong types, missing
 * fields), every mutation here produces a record that's still perfectly
 * *valid* against a JSON schema -- the field types, required-ness, and
 * formats are all correct. What's wrong is the *business logic*: an address
 * whose city/state/postal-code don't belong together, a unit price that's
 * absurdly below cost, a return filed before the order that produced it, a
 * per-order quantity no real customer would place. These are exactly the
 * bugs schema validation can't catch, because the schema was never wrong.
 *
 * Each mutation is applied to a deep copy of the dataset and logged with
 * enough detail (table, record id, field, before/after, reason) to drive a
 * report -- or, once wired into a live-contract-testing engine, to assert
 * that a real API rejects or flags the mutated payload.
 */
export function applySemanticFuzzing(dataset: Dataset, options: FuzzOptions = {}): FuzzResult {
  const intensity = options.intensity ?? "medium";
  const types = options.types ?? ALL_TYPES;
  const attempts = INTENSITY_ATTEMPTS[intensity];
  const rng = new Rng(options.seed ?? 1);

  // Deep copy via JSON round-trip -- the dataset is plain JSON-serializable
  // data (no functions/dates-as-objects), so this is safe and simple.
  const mutated: Dataset = JSON.parse(JSON.stringify(dataset));
  const mutations: FuzzMutation[] = [];

  // Per-type "already targeted" sets -- without these, a later attempt of
  // the same mutation type can re-target a record an earlier attempt
  // already mutated, silently invalidating that earlier mutation's
  // recorded `after` value (the actual final field no longer matches what
  // the mutation claims it set). Real bug, caught by a test that
  // independently re-verified a mutation's claim against final dataset
  // state instead of trusting the value the code itself produced -- same
  // class of bug, same fix pattern, as `fraud.ts`'s account_farming.
  const addressMismatchTargets = new Set<string>();
  const priceInversionTargets = new Set<string>();
  const timeParadoxTargets = new Set<string>();
  const inventoryOversellTargets = new Set<string>();

  if (types.includes("address_mismatch")) {
    for (let i = 0; i < attempts; i++) mutateAddressMismatch(mutated, rng, mutations, addressMismatchTargets);
  }
  if (types.includes("price_inversion")) {
    for (let i = 0; i < attempts; i++) mutatePriceInversion(mutated, rng, mutations, priceInversionTargets);
  }
  if (types.includes("time_paradox")) {
    for (let i = 0; i < attempts; i++) mutateTimeParadox(mutated, rng, mutations, timeParadoxTargets);
  }
  if (types.includes("inventory_oversell")) {
    for (let i = 0; i < attempts; i++) mutateInventoryOversell(mutated, rng, mutations, inventoryOversellTargets);
  }

  return { dataset: mutated, mutations };
}

function ordersWithAddress(dataset: Dataset): (Order & { shippingAddress: Address })[] {
  return dataset.orders.filter((o): o is Order & { shippingAddress: Address } => o.shippingAddress !== null);
}

/**
 * Takes the city/state from one real order's address and the postalCode
 * from a *different* real order's address -- both halves are individually
 * valid (they're real generated addresses), but the combination describes
 * a place that doesn't exist. Tests whether anything actually cross-checks
 * postal code against city/state instead of validating each field alone.
 */
function mutateAddressMismatch(
  dataset: Dataset,
  rng: Rng,
  mutations: FuzzMutation[],
  alreadyTargeted: Set<string>
): void {
  const candidates = ordersWithAddress(dataset).filter((o) => !alreadyTargeted.has(o.id));
  if (candidates.length < 2) return;
  const target = rng.pick(candidates);
  const donor = rng.pick(candidates.filter((o) => o.id !== target.id));
  if (target.shippingAddress.postalCode === donor.shippingAddress.postalCode) return;

  const before = { ...target.shippingAddress };
  target.shippingAddress.postalCode = donor.shippingAddress.postalCode;
  alreadyTargeted.add(target.id);

  mutations.push({
    type: "address_mismatch",
    table: "orders",
    recordId: target.id,
    field: "shippingAddress.postalCode",
    before: before.postalCode,
    after: target.shippingAddress.postalCode,
    reason: `Order ships to ${target.shippingAddress.city}, ${target.shippingAddress.state} but the postal code (${target.shippingAddress.postalCode}) actually belongs to ${donor.shippingAddress.city}, ${donor.shippingAddress.state} -- tests whether postal code is cross-checked against city/state instead of validated in isolation.`,
  });
}

/**
 * Drops a line item's unitPrice to a near-zero fraction of its original
 * value *without* recomputing the order's subtotal/total -- so the order
 * ends up internally inconsistent (lineTotal no longer equals
 * unitPrice * quantity, and subtotal no longer sums the line items). Tests
 * whether a receiving system validates financial invariants on ingest, or
 * just trusts the totals it's handed -- exactly the class of bug that lets
 * an "impossible discount" slip through a checkout pipeline.
 */
function mutatePriceInversion(
  dataset: Dataset,
  rng: Rng,
  mutations: FuzzMutation[],
  alreadyTargeted: Set<string>
): void {
  const candidates = dataset.orders.filter((o) => o.items.length > 0 && !alreadyTargeted.has(o.id));
  if (candidates.length === 0) return;
  const target = rng.pick(candidates);
  const itemIndex = rng.int(0, target.items.length - 1);
  const item = target.items[itemIndex];

  const before = item.unitPrice;
  const after = Math.round(before * rng.float(0.01, 0.05, 4) * 100) / 100;
  item.unitPrice = after;
  alreadyTargeted.add(target.id);
  // Deliberately leave item.lineTotal and order.subtotal/total untouched --
  // the mismatch itself is the point of the mutation.

  mutations.push({
    type: "price_inversion",
    table: "orders",
    recordId: target.id,
    // Identify by index, not sku -- the catalog is shared and bounded, so
    // the same product/variant (same sku) can legitimately appear more
    // than once in one order's line items. A sku-based field identifier
    // was ambiguous in that case; index into a specific order's items
    // array at a given moment is not.
    field: `items[${itemIndex}].unitPrice`,
    before,
    after,
    reason: `Line item "${item.name}" unit price dropped from $${before.toFixed(2)} to $${after.toFixed(2)} (a ~${Math.round((1 - after / before) * 100)}% discount) without recomputing lineTotal/subtotal/total -- tests whether financial totals are validated against their line items on ingest, or trusted as-given.`,
  });
}

/**
 * Sets a return request's requestedAt to before the order it's returning
 * was even created. Tests whether temporal ordering between related
 * records is enforced anywhere -- a naive system that only checks each
 * timestamp is a valid ISO date (which this still is) will accept it.
 */
function mutateTimeParadox(
  dataset: Dataset,
  rng: Rng,
  mutations: FuzzMutation[],
  alreadyTargeted: Set<string>
): void {
  const candidates = dataset.returnRequests.filter((r) => !alreadyTargeted.has(r.id));
  if (candidates.length === 0) return;
  const target = rng.pick(candidates);
  const order = dataset.orders.find((o) => o.id === target.orderId);
  if (!order) return;

  const orderCreated = Date.parse(order.createdAt);
  const before = target.requestedAt;
  // Push the return request 1-14 days *before* the order it belongs to.
  const daysBefore = rng.int(1, 14);
  const after = new Date(orderCreated - daysBefore * 24 * 60 * 60 * 1000).toISOString();
  target.requestedAt = after;
  alreadyTargeted.add(target.id);

  mutations.push({
    type: "time_paradox",
    table: "returnRequests",
    recordId: target.id,
    field: "requestedAt",
    before,
    after,
    reason: `Return request for order ${order.id} is now dated ${daysBefore} day(s) before the order itself was created (${order.createdAt}) -- tests whether temporal ordering between related records is enforced, since each timestamp in isolation is still a perfectly valid ISO date.`,
  });
}

/**
 * Sets a line item's quantity to an implausible amount for a single retail
 * order (default 500-999). There's no formal stock ledger in this dataset
 * model, so this doesn't check against a real inventory count -- it tests
 * the more basic question of whether *anything* caps per-order,  per-SKU
 * quantity at a sane retail ceiling, which is usually the first line of
 * defense against inventory-oversell in a real system.
 */
function mutateInventoryOversell(
  dataset: Dataset,
  rng: Rng,
  mutations: FuzzMutation[],
  alreadyTargeted: Set<string>
): void {
  const candidates = dataset.orders.filter((o) => o.items.length > 0 && !alreadyTargeted.has(o.id));
  if (candidates.length === 0) return;
  const target = rng.pick(candidates);
  const itemIndex = rng.int(0, target.items.length - 1);
  const item = target.items[itemIndex];

  const before = item.quantity;
  const after = rng.int(500, 999);
  item.quantity = after;
  item.lineTotal = Math.round(item.unitPrice * after * 100) / 100;
  alreadyTargeted.add(target.id);
  // Deliberately leave order.subtotal/total unchanged -- same "internally
  // inconsistent order" signal as the price-inversion mutation.

  mutations.push({
    type: "inventory_oversell",
    table: "orders",
    recordId: target.id,
    // Index, not sku -- see mutatePriceInversion for why sku isn't a safe identifier here.
    field: `items[${itemIndex}].quantity`,
    before,
    after,
    reason: `Line item "${item.name}" quantity jumped from ${before} to ${after} in a single order -- no real per-order retail purchase looks like this. Tests whether anything caps implausible per-SKU order quantities (the first line of defense against inventory oversell).`,
  });
}

/** Groups mutations by type with counts -- the shape `fuzz`'s CLI report prints. */
export function summarizeMutations(mutations: FuzzMutation[]): Record<FuzzMutationType, number> {
  const summary: Record<FuzzMutationType, number> = {
    address_mismatch: 0,
    price_inversion: 0,
    time_paradox: 0,
    inventory_oversell: 0,
  };
  for (const m of mutations) summary[m.type]++;
  return summary;
}
