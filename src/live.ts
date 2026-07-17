import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { buildWebhookEvents, type WebhookEvent } from "./webhook.js";
import type { EcoFakerConfig } from "./types.js";

export interface LiveFeedOptions {
  /** Milliseconds between broadcasts (a steady drip, not simulated real-time pacing -- see webhook.ts for that). */
  intervalMs?: number;
  /** Only broadcast events of these types (default: all). */
  eventTypes?: Set<string>;
}

/**
 * Attach a WebSocket endpoint at `/live` to an existing HTTP server (the one
 * returned by `app.listen(...)`) that broadcasts a steady drip of
 * dataset-derived events to every connected client -- "watch orders roll
 * in" for the interactive playground, or for anyone testing a live-updating
 * UI against the mock API.
 *
 * Reuses the same event list the webhook simulator builds (buildWebhookEvents),
 * so a `shipment.delivered` event here references a shipment that's also
 * reachable via GET /api/shipments/:id on the same dataset -- consistent
 * ids across the REST API and the live feed. When the event list is
 * exhausted it loops back to the start rather than stopping.
 */
export function attachLiveFeed(
  httpServer: HttpServer,
  overrides: Partial<EcoFakerConfig>,
  referenceNow: number,
  options: LiveFeedOptions = {}
): WebSocketServer {
  const intervalMs = options.intervalMs ?? 800;
  const allEvents = buildWebhookEvents(overrides, referenceNow);
  const events: WebhookEvent[] = options.eventTypes ? allEvents.filter((e) => options.eventTypes!.has(e.type)) : allEvents;

  const wss = new WebSocketServer({ server: httpServer, path: "/live" });
  let cursor = 0;

  wss.on("connection", (socket: WebSocket) => {
    socket.send(JSON.stringify({ type: "_meta", message: `Connected. Replaying ${events.length} events at ${intervalMs}ms intervals.` }));
  });

  const timer = setInterval(() => {
    if (events.length === 0 || wss.clients.size === 0) return;

    const event = events[cursor % events.length];
    cursor++;

    const payload = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }, intervalMs);

  wss.on("close", () => clearInterval(timer));

  return wss;
}
