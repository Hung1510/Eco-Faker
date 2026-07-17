import { generateRecords } from "./generator.js";
import type { EcoFakerConfig } from "./types.js";

export interface WebhookEvent {
  type: string;
  timestamp: string;
  data: unknown;
}

function slug(status: string): string {
  return status.toLowerCase().replace(/\s+/g, "_");
}

/**
 * Turn a generated dataset into a chronologically-ordered list of webhook
 * events (`order.created`, `cart.abandoned`, `shipment.delivered`, etc.) --
 * exactly the shape a Stripe/Shopify-style webhook consumer expects to
 * receive over time, except compressed from the dataset's `historicalDays`
 * span down to whatever real-time pace `--speed` asks for.
 *
 * Shipment tracking events are the richest source: each entry in a
 * shipment's `events` array becomes its own webhook
 * (`shipment.label_created`, `shipment.picked_up`, ..., `shipment.delayed`,
 * `shipment.delivered`), each with its own real timestamp -- this is what
 * makes the replay feel like a real carrier integration rather than one
 * lump event per shipment.
 */
export function buildWebhookEvents(overrides: Partial<EcoFakerConfig>, referenceNow: number): WebhookEvent[] {
  const events: WebhookEvent[] = [];

  for (const { table, record } of generateRecords(overrides, referenceNow)) {
    switch (table) {
      case "users":
        events.push({ type: "user.created", timestamp: record.createdAt, data: record });
        break;

      case "carts":
        events.push({ type: "cart.created", timestamp: record.createdAt, data: record });
        if (record.status === "abandoned") {
          events.push({ type: "cart.abandoned", timestamp: record.lastActivityDate, data: record });
        }
        break;

      case "abandoned_checkouts":
        events.push({ type: "checkout.abandoned", timestamp: record.exitTimestamp, data: record });
        if (record.recoveryEmailSentAt) {
          events.push({ type: "checkout.recovery_email_sent", timestamp: record.recoveryEmailSentAt, data: record });
        }
        break;

      case "orders":
        events.push({ type: "order.created", timestamp: record.createdAt, data: record });
        break;

      case "shipments":
        for (const trackingEvent of record.events) {
          events.push({
            type: `shipment.${slug(trackingEvent.status)}`,
            timestamp: trackingEvent.timestamp,
            data: {
              shipmentId: record.id,
              orderId: record.orderId,
              trackingNumber: record.trackingNumber,
              carrier: record.carrier,
              event: trackingEvent,
            },
          });
        }
        break;

      case "return_requests":
        events.push({ type: "return.requested", timestamp: record.requestedAt, data: record });
        if (record.resolvedAt) {
          events.push({ type: `return.${record.status}`, timestamp: record.resolvedAt, data: record });
        }
        break;
    }
  }

  events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return events;
}

export interface ReplayOptions {
  /** How much faster than real time to replay. speed=3600 means 1 simulated hour per real second. */
  speed: number;
  /** Cap on the real-world wait between any two consecutive events, in ms (prevents huge historical gaps from stalling the replay). */
  maxWaitMs: number;
  /** Only emit events whose type is in this set (if provided). */
  eventTypes?: Set<string>;
  /** Stop after this many events (if provided). */
  limit?: number;
}

/**
 * Replay a chronological event list at a compressed pace, calling `onEvent`
 * for each one and waiting the (speed-scaled, capped) real-time gap between
 * consecutive events in between. `onEvent` is awaited, so a slow POST
 * naturally throttles the replay instead of racing ahead of the receiver.
 */
export async function replayEvents(
  events: WebhookEvent[],
  options: ReplayOptions,
  onEvent: (event: WebhookEvent, index: number, total: number) => Promise<void> | void
): Promise<number> {
  const filtered = options.eventTypes ? events.filter((e) => options.eventTypes!.has(e.type)) : events;
  const limited = options.limit ? filtered.slice(0, options.limit) : filtered;

  for (let i = 0; i < limited.length; i++) {
    if (i > 0) {
      const deltaMs = Date.parse(limited[i].timestamp) - Date.parse(limited[i - 1].timestamp);
      const waitMs = Math.min(options.maxWaitMs, Math.max(0, deltaMs / options.speed));
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    await onEvent(limited[i], i, limited.length);
  }

  return limited.length;
}
