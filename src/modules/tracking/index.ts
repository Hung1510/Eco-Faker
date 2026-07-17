import type { Faker } from "@faker-js/faker";
import type { Rng } from "../../rng.js";
import type {
  EcoFakerConfig,
  LineItem,
  Order,
  Shipment,
  ShipmentStatus,
  TrackingEvent,
} from "../../types.js";

const CARRIERS = ["UPS", "FedEx", "USPS", "DHL Express"];

function hours(n: number): number {
  return n * 60 * 60 * 1000;
}

/**
 * Builds the *full hypothetical* event timeline for a shipment (as if we
 * fast-forwarded to delivery), then truncates it to whatever should have
 * happened by "now". This is what makes recent orders realistically sit at
 * "In Transit" or "Out for Delivery" instead of every order being either
 * brand new or fully delivered.
 */
function buildEventTimeline(
  rng: Rng,
  config: EcoFakerConfig,
  orderCreatedAt: Date
): { events: TrackingEvent[]; delayed: boolean } {
  const delayed = rng.chance(config.delayProbability);
  const t0 = orderCreatedAt.getTime();

  const labelCreatedAt = t0 + hours(rng.int(1, 6));
  const pickedUpAt = labelCreatedAt + hours(rng.int(6, 24));
  const inTransitAt = pickedUpAt + hours(rng.int(6, 30));

  let cursor = inTransitAt;
  const events: TrackingEvent[] = [
    { status: "Label Created", timestamp: new Date(labelCreatedAt).toISOString(), location: "Origin Facility" },
    { status: "Picked Up", timestamp: new Date(pickedUpAt).toISOString(), location: "Origin Facility" },
    { status: "In Transit", timestamp: new Date(inTransitAt).toISOString(), location: "Regional Hub" },
  ];

  if (delayed) {
    const delayDays = rng.int(1, config.maxDelayDays);
    cursor += hours(rng.int(6, 24));
    events.push({
      status: "Delayed",
      timestamp: new Date(cursor).toISOString(),
      location: "Regional Hub",
    });
    cursor += hours(delayDays * 24);
  } else {
    cursor += hours(rng.int(12, 48));
  }

  const outForDeliveryAt = cursor + hours(rng.int(6, 18));
  const deliveredAt = outForDeliveryAt + hours(rng.int(2, 10));

  events.push(
    { status: "Out for Delivery", timestamp: new Date(outForDeliveryAt).toISOString(), location: "Local Depot" },
    { status: "Delivered", timestamp: new Date(deliveredAt).toISOString(), location: "Destination" }
  );

  return { events, delayed };
}

function truncateToNow(events: TrackingEvent[], now: number): { events: TrackingEvent[]; status: ShipmentStatus } {
  const reached = events.filter((e) => new Date(e.timestamp).getTime() <= now);
  if (reached.length === 0) {
    // Order was placed too recently for even the first scan to have
    // happened yet -- label is generated, nothing tracked so far.
    return { events: [], status: "Label Created" };
  }
  return { events: reached, status: reached[reached.length - 1].status as ShipmentStatus };
}

function splitItemsIntoPackages(rng: Rng, items: LineItem[], packageCount: number): LineItem[][] {
  if (packageCount <= 1 || items.length <= 1) return [items];
  const shuffled = rng.shuffle(items);
  const buckets: LineItem[][] = Array.from({ length: packageCount }, () => []);
  shuffled.forEach((item, i) => buckets[i % packageCount].push(item));
  return buckets.filter((b) => b.length > 0);
}

/**
 * Generates one or more Shipments for an order. Orders missing a shipping
 * address never ship (they sit in "processing" indefinitely) -- that's the
 * intentional edge case, not a bug.
 */
export function generateShipmentsForOrder(
  faker: Faker,
  rng: Rng,
  config: EcoFakerConfig,
  order: Order,
  now: number
): Shipment[] {
  if (!order.shippingAddress) return [];

  const multiPackage = rng.chance(config.multiPackageRate) && order.items.length > 1;
  const packageCount = multiPackage ? rng.int(2, 3) : 1;
  const packages = splitItemsIntoPackages(rng, order.items, packageCount);

  return packages.map((items, index) => {
    const { events: fullTimeline, delayed } = buildEventTimeline(
      rng,
      config,
      new Date(order.createdAt)
    );
    const { events, status } = truncateToNow(fullTimeline, now);

    return {
      id: faker.string.uuid(),
      orderId: order.id,
      trackingNumber: faker.string.alphanumeric({ length: 12, casing: "upper" }),
      carrier: rng.pick(CARRIERS),
      packageIndex: index + 1,
      totalPackages: packages.length,
      items,
      status,
      delayed,
      events,
    };
  });
}

/** Roll up an order's shipments into a single order-level status. */
export function deriveOrderStatus(shipments: Shipment[]): Order["status"] {
  if (shipments.length === 0) return "processing";
  const allDelivered = shipments.every((s) => s.status === "Delivered");
  if (allDelivered) return "delivered";
  const noneScannedYet = shipments.every((s) => s.events.length === 0);
  if (noneScannedYet) return "processing";
  return "shipped";
}
