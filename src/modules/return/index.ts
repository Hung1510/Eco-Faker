import type { Faker } from "@faker-js/faker";
import type { Rng } from "../../rng.js";
import type { EcoFakerConfig, Order, ReturnRequest, ReturnStatus, Shipment } from "../../types.js";

const REASONS = [
  "Item damaged in transit",
  "Wrong item shipped",
  "Item not as described",
  "No longer needed",
  "Found a better price elsewhere",
  "Size or fit issue",
  "Arrived too late",
  "Changed my mind",
];

function latestDeliveryDate(shipments: Shipment[]): Date | null {
  const delivered = shipments
    .map((s) => s.events.find((e) => e.status === "Delivered"))
    .filter((e): e is NonNullable<typeof e> => Boolean(e));
  if (delivered.length === 0) return null;
  return new Date(Math.max(...delivered.map((e) => new Date(e.timestamp).getTime())));
}

/**
 * Only orders that are fully delivered are eligible for a return request.
 * Refund amount is a portion (partial return) or the full order total.
 */
export function maybeGenerateReturnRequest(
  faker: Faker,
  rng: Rng,
  config: EcoFakerConfig,
  order: Order,
  shipments: Shipment[],
  now: number
): ReturnRequest | null {
  if (order.status !== "delivered") return null;
  if (!rng.chance(config.returnRate)) return null;

  const deliveredAt = latestDeliveryDate(shipments);
  if (!deliveredAt) return null;

  const requestedAt = new Date(
    deliveredAt.getTime() + rng.int(1, 21) * 24 * 60 * 60 * 1000 // within 3 weeks
  );
  if (requestedAt.getTime() > now) return null; // hasn't happened "yet"

  const status: ReturnStatus = rng.weighted([
    ["approved", 65],
    ["pending", 20],
    ["rejected", 15],
  ]);

  const partial = rng.chance(0.4);
  const refundAmount = partial
    ? Math.round(order.total * rng.float(0.2, 0.8) * 100) / 100
    : order.total;

  const resolvedAt =
    status === "pending"
      ? null
      : new Date(requestedAt.getTime() + rng.int(1, 7) * 24 * 60 * 60 * 1000).toISOString();

  const finalRefundAmount = status === "rejected" ? 0 : refundAmount;
  const refundAmountFormatted = new Intl.NumberFormat(config.locale, {
    style: "currency",
    currency: order.currency,
  }).format(finalRefundAmount);

  return {
    id: faker.string.uuid(),
    orderId: order.id,
    userId: order.userId,
    reason: rng.pick(REASONS),
    status,
    refundAmount: finalRefundAmount,
    refundAmountFormatted,
    requestedAt: requestedAt.toISOString(),
    resolvedAt: resolvedAt && new Date(resolvedAt).getTime() <= now ? resolvedAt : null,
  };
}
