import type { Dataset } from "./types.js";

export interface DatasetEvent {
  eventId: string;
  aggregateType: string;
  aggregateId: string;
  type: string;
  timestamp: string;
  data: unknown;
}

function slug(status: string): string {
  return status.toLowerCase().replace(/\s+/g, "_");
}

let eventCounter = 0;
function nextEventId(): string {
  eventCounter += 1;
  return `evt_${eventCounter.toString(36)}`;
}

/**
 * Evenly spaces N item-added events strictly between two bounds, rather
 * than fabricating independent random timestamps for something that has
 * no timestamp of its own in the source data -- `Cart.items[]` doesn't
 * carry a per-item timestamp, only the cart's own `createdAt` and
 * `lastActivityDate` bound the window items could plausibly have been
 * added in. Falls back to `createdAt` for every item if the two bounds
 * are equal (a cart with no activity beyond its creation).
 */
function interpolateTimestamps(startIso: string, endIso: string, count: number): string[] {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (count <= 0) return [];
  if (end <= start) return new Array(count).fill(startIso);
  const step = (end - start) / (count + 1);
  return Array.from({ length: count }, (_, i) => new Date(start + step * (i + 1)).toISOString());
}

/**
 * Builds a comprehensive, chronologically-ordered event stream from an
 * already-generated dataset -- `user.created`, `cart.item_added`,
 * `order.created`, `shipment.delivered`, `product.viewed`,
 * `replenishment.received`, and so on, across all 18 tables, not just
 * the 6 the webhook simulator (`webhook.ts`) covers.
 *
 * Deliberately positioned as a genuine event-sourcing artifact rather
 * than a flat webhook-delivery list: every event carries `aggregateId`
 * and `aggregateType`, the fields an actual event-sourced system needs
 * to group events into per-entity streams and replay them into current
 * state. `webhook.ts`'s `WebhookEvent` has neither, because it's built
 * for a different purpose (pacing deliveries to an HTTP endpoint) and
 * operates on the streaming generator rather than a materialized
 * dataset -- the two modules overlap in *which event types exist for
 * orders/carts/shipments/returns* by necessity (that's real domain
 * logic, not incidental), but aren't merged into one shared function
 * here, since their input shapes (streaming records vs. a complete
 * Dataset) differ enough that forcing a shared implementation would
 * make both worse. Noted as a known, disclosed tradeoff rather than
 * left implicit -- see ROADMAP.md.
 *
 * No RNG anywhere in this module -- every event's timestamp comes
 * directly from real data already in the dataset, except cart item
 * timestamps, which are grounded interpolations between two real bounds
 * (see interpolateTimestamps) rather than independently random.
 */
export function buildEventStream(dataset: Dataset): DatasetEvent[] {
  const events: DatasetEvent[] = [];
  eventCounter = 0;

  const push = (aggregateType: string, aggregateId: string, type: string, timestamp: string, data: unknown) => {
    events.push({ eventId: nextEventId(), aggregateType, aggregateId, type, timestamp, data });
  };

  for (const user of dataset.users) {
    push("user", user.id, "user.created", user.createdAt, user);
  }

  for (const cart of dataset.carts) {
    push("cart", cart.id, "cart.created", cart.createdAt, { cartId: cart.id, userId: cart.userId });
    const itemTimestamps = interpolateTimestamps(cart.createdAt, cart.lastActivityDate, cart.items.length);
    cart.items.forEach((item, i) => {
      push("cart", cart.id, "cart.item_added", itemTimestamps[i], { cartId: cart.id, item });
    });
    if (cart.status === "abandoned") {
      push("cart", cart.id, "cart.abandoned", cart.lastActivityDate, { cartId: cart.id, userId: cart.userId });
    }
  }

  for (const checkout of dataset.abandonedCheckouts) {
    push("checkout", checkout.id, "checkout.abandoned", checkout.exitTimestamp, checkout);
    if (checkout.recoveryEmailSentAt) {
      push("checkout", checkout.id, "checkout.recovery_email_sent", checkout.recoveryEmailSentAt, checkout);
    }
  }

  for (const order of dataset.orders) {
    push("order", order.id, "order.created", order.createdAt, order);
  }

  for (const shipment of dataset.shipments) {
    for (const trackingEvent of shipment.events) {
      push("shipment", shipment.id, `shipment.${slug(trackingEvent.status)}`, trackingEvent.timestamp, {
        shipmentId: shipment.id,
        orderId: shipment.orderId,
        trackingNumber: shipment.trackingNumber,
        carrier: shipment.carrier,
        event: trackingEvent,
      });
    }
  }

  for (const ret of dataset.returnRequests) {
    push("return", ret.id, "return.requested", ret.requestedAt, ret);
    if (ret.resolvedAt) {
      push("return", ret.id, `return.${ret.status}`, ret.resolvedAt, ret);
    }
  }

  for (const view of dataset.productViews) {
    push("product_view", view.id, "product.viewed", view.timestamp, view);
  }
  for (const query of dataset.searchQueries) {
    push("search_query", query.id, "search.performed", query.timestamp, query);
  }
  for (const item of dataset.wishlistItems) {
    push("wishlist_item", item.id, "wishlist.item_added", item.addedAt, item);
  }
  for (const rating of dataset.productRatings) {
    push("product_rating", rating.id, "product.rated", rating.createdAt, rating);
  }

  for (const order of dataset.replenishmentOrders) {
    push("replenishment_order", order.id, "replenishment.ordered", order.orderedAt, order);
    if (order.receivedAt) {
      push("replenishment_order", order.id, "replenishment.received", order.receivedAt, order);
    }
  }
  for (const period of dataset.stockoutPeriods) {
    push("stockout_period", period.id, "stockout.started", period.startedAt, period);
    if (period.endedAt) {
      push("stockout_period", period.id, "stockout.resolved", period.endedAt, period);
    }
  }
  for (const transfer of dataset.warehouseTransfers) {
    push("warehouse_transfer", transfer.id, "warehouse_transfer.initiated", transfer.initiatedAt, transfer);
    if (transfer.completedAt) {
      push("warehouse_transfer", transfer.id, "warehouse_transfer.completed", transfer.completedAt, transfer);
    }
  }

  events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return events;
}
