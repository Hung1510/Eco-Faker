import { Rng } from "./rng.js";
import type { Dataset, FraudTag, Order } from "./types.js";

export type FraudType = FraudTag["fraudType"];

const ALL_FRAUD_TYPES: FraudType[] = [
  "stolen_card",
  "account_farming",
  "reseller_behavior",
  "refund_abuse",
  "friendly_chargeback",
  "coupon_abuse_ring",
];

/** Types that only make sense on an order which already has a linked return -- see pickFraudType. */
const RETURN_LINKED_TYPES: FraudType[] = ["refund_abuse", "friendly_chargeback"];

export interface FraudOptions {
  /** Fraction [0,1] of orders to consider flagging (default: 0.02). Not every considered order ends up flagged -- return-linked types (refund_abuse, friendly_chargeback) only apply to orders that actually have a return, so the realized rate can be slightly lower than requested. */
  fraudRate?: number;
  /** Restrict to a subset of fraud types (default: all six). */
  types?: FraudType[];
  /** Seed for reproducible fraud-tag selection (default: 1). */
  seed?: number;
}

export interface FraudSignalRecord extends FraudTag {
  orderId: string;
  userId: string;
}

export interface FraudResult {
  /** Deep copy of the input dataset with `fraud` tags applied to a subset of orders (and, for account_farming, some users' addresses overwritten to create a real shared-address cluster). The input is never modified. */
  dataset: Dataset;
  signals: FraudSignalRecord[];
}

/**
 * Fraud simulation: unlike anomaly injection (rare edge cases like a bot
 * cart or a remote-shipping surcharge) or semantic fuzzing (deliberately
 * broken, schema-valid-but-impossible data), fraud tags are meant to look
 * like a real fraud-detection system's *output* -- a risk score and a list
 * of evidence signals attached to an order -- while grounding at least
 * some of those signals in an actually-detectable structural pattern in
 * the dataset, not just a label slapped onto random data. Concretely:
 *
 * - `account_farming` really does overwrite several other users' addresses
 *   to exactly match the flagged order's address, so "N accounts share
 *   this address" is something a query against the dataset can actually
 *   find, not just an asserted string.
 * - `reseller_behavior` really does bump a line item's quantity into
 *   implausible-for-retail territory (and correctly recomputes
 *   lineTotal/subtotal/total, unlike `fuzz`'s deliberately-inconsistent
 *   mutations -- the point here is a believable *behavioral* pattern, not
 *   broken data).
 * - `refund_abuse` and `friendly_chargeback` are only ever assigned to
 *   orders that already have a real linked `ReturnRequest` in the
 *   dataset -- a chargeback or refund-abuse pattern without an underlying
 *   return wouldn't be a coherent label.
 * - `stolen_card` and `coupon_abuse_ring` are evidence-label-only (a
 *   "new_account" or "reused_coupon:CODE123" signal string) since this
 *   dataset model doesn't track IP addresses or a coupon field on `Order`
 *   itself -- documented here rather than silently implied to be backed
 *   by a stored field.
 */
export function applyFraudSimulation(dataset: Dataset, options: FraudOptions = {}): FraudResult {
  const fraudRate = options.fraudRate ?? 0.02;
  const types = options.types ?? ALL_FRAUD_TYPES;
  const rng = new Rng(options.seed ?? 1);

  const mutated: Dataset = JSON.parse(JSON.stringify(dataset));
  const signals: FraudSignalRecord[] = [];

  const returnedOrderIds = new Set(mutated.returnRequests.map((r) => r.orderId));
  const usersById = new Map(mutated.users.map((u) => [u.id, u]));
  // Tracks every user id already used as an account_farming source or
  // target in this run -- without this, a later account_farming event can
  // overwrite a user's address that an *earlier* signal already claimed a
  // specific shared-address count for, silently invalidating that earlier
  // signal's evidence. Once a user is farmed, they're farmed once.
  const farmedUserIds = new Set<string>();

  for (const order of mutated.orders) {
    if (rng.float(0, 1, 6) >= fraudRate) continue;

    const fraudType = pickFraudType(types, rng, returnedOrderIds.has(order.id));
    if (!fraudType) continue; // no eligible type for this order (e.g. return-linked types requested, but this order has no return)

    const tag = buildFraudTag(fraudType, order, mutated, usersById, rng, farmedUserIds);
    if (!tag) continue; // e.g. account_farming with no un-farmed users left to use
    order.fraud = tag;
    signals.push({ ...tag, orderId: order.id, userId: order.userId });
  }

  return { dataset: mutated, signals };
}

function pickFraudType(types: FraudType[], rng: Rng, hasReturn: boolean): FraudType | null {
  const eligible = hasReturn ? types : types.filter((t) => !RETURN_LINKED_TYPES.includes(t));
  if (eligible.length === 0) return null;
  return rng.pick(eligible);
}

function buildFraudTag(
  fraudType: FraudType,
  order: Order,
  dataset: Dataset,
  usersById: Map<string, Dataset["users"][number]>,
  rng: Rng,
  farmedUserIds: Set<string>
): FraudTag | null {
  switch (fraudType) {
    case "stolen_card":
      return buildStolenCard(order, usersById, rng);
    case "account_farming":
      return buildAccountFarming(order, dataset, usersById, rng, farmedUserIds);
    case "reseller_behavior":
      return buildResellerBehavior(order, rng);
    case "refund_abuse":
      return buildRefundAbuse(rng);
    case "friendly_chargeback":
      return buildFriendlyChargeback(order, rng);
    case "coupon_abuse_ring":
      return buildCouponAbuseRing(rng);
  }
}

function buildStolenCard(order: Order, usersById: Map<string, Dataset["users"][number]>, rng: Rng): FraudTag {
  const user = usersById.get(order.userId);
  const signals = ["high_value_first_purchase", "billing_shipping_mismatch"];
  // Simulate "brand-new account, immediate high-value purchase" -- shift the
  // order's createdAt to within a few hours of the account's own creation.
  if (user) {
    const accountCreated = Date.parse(user.createdAt);
    const hoursLater = rng.int(1, 6);
    order.createdAt = new Date(accountCreated + hoursLater * 60 * 60 * 1000).toISOString();
    signals.unshift("new_account");
  }
  signals.push("vpn_ip"); // evidence label only -- this dataset model doesn't track IP addresses
  return { fraudType: "stolen_card", riskScore: rng.int(75, 95), signals };
}

function buildAccountFarming(
  order: Order,
  dataset: Dataset,
  usersById: Map<string, Dataset["users"][number]>,
  rng: Rng,
  farmedUserIds: Set<string>
): FraudTag | null {
  const sourceUser = usersById.get(order.userId);
  if (!sourceUser || farmedUserIds.has(order.userId)) return null;

  const candidates = dataset.users.filter((u) => u.id !== order.userId && !farmedUserIds.has(u.id));
  if (candidates.length === 0) return null;

  const farmSize = Math.min(rng.int(2, 4), candidates.length);
  const targets = [...candidates].sort(() => rng.float(-1, 1)).slice(0, farmSize);

  for (const target of targets) {
    target.address = { ...sourceUser.address };
    farmedUserIds.add(target.id);
  }
  farmedUserIds.add(order.userId);

  return {
    fraudType: "account_farming",
    riskScore: rng.int(55, 80),
    signals: [`shared_address_with_${targets.length}_other_accounts`, "new_account"],
  };
}

function buildResellerBehavior(order: Order, rng: Rng): FraudTag {
  if (order.items.length > 0) {
    const item = order.items.reduce((max, i) => (i.lineTotal > max.lineTotal ? i : max), order.items[0]);
    item.quantity = rng.int(50, 300);
    item.lineTotal = Math.round(item.unitPrice * item.quantity * 100) / 100;
    // Recompute order totals correctly -- unlike fuzz's price_inversion/
    // inventory_oversell, the point here is a believable pattern, not
    // deliberately broken financials.
    order.subtotal = Math.round(order.items.reduce((sum, i) => sum + i.lineTotal, 0) * 100) / 100;
    order.total = Math.round((order.subtotal + order.tax + order.shipping) * 100) / 100;
  }
  return {
    fraudType: "reseller_behavior",
    riskScore: rng.int(40, 65),
    signals: ["bulk_single_sku_quantity", "business_email_pattern"],
  };
}

function buildRefundAbuse(rng: Rng): FraudTag {
  return {
    fraudType: "refund_abuse",
    riskScore: rng.int(50, 75),
    signals: ["high_return_rate_for_user", "refund_requested_repeatedly"],
  };
}

function buildFriendlyChargeback(order: Order, rng: Rng): FraudTag {
  return {
    fraudType: "friendly_chargeback",
    riskScore: rng.int(65, 90),
    signals: ["late_dispute_after_delivery", order.status === "delivered" ? "item_received_confirmed" : "dispute_before_delivery"],
  };
}

function buildCouponAbuseRing(rng: Rng): FraudTag {
  const code = `SAVE${rng.int(10, 90)}`;
  return {
    fraudType: "coupon_abuse_ring",
    riskScore: rng.int(45, 70),
    signals: [`reused_coupon:${code}`, "coupon_velocity_spike"],
  };
}

/** Groups fraud signals by type with counts -- the shape the CLI report prints. */
export function summarizeFraudSignals(signals: FraudSignalRecord[]): Record<FraudType, number> {
  const summary: Record<FraudType, number> = {
    stolen_card: 0,
    account_farming: 0,
    reseller_behavior: 0,
    refund_abuse: 0,
    friendly_chargeback: 0,
    coupon_abuse_ring: 0,
  };
  for (const s of signals) summary[s.fraudType]++;
  return summary;
}
