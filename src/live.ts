import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { Express, Request, Response } from "express";
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

/**
 * Same live feed as `attachLiveFeed` (identical event list, identical
 * cadence), over Server-Sent Events instead of a WebSocket -- for any
 * client/environment that can do a plain HTTP GET but not a WebSocket
 * upgrade: `curl -N`, a browser's built-in `EventSource`, a restrictive
 * corporate proxy or serverless/API-gateway setup that blocks WS
 * upgrades outright but passes through a long-lived HTTP response fine.
 *
 * Registered as a normal Express route (`GET /live/sse`), so -- unlike
 * `attachLiveFeed`, which attaches to the raw `http.Server` returned by
 * `app.listen()` -- this must be called on the `Express` app itself,
 * before `.listen()`. Each connecting client gets its own independent
 * cursor and interval timer (not a single feed shared across every SSE
 * client the way the WebSocket feed shares one broadcast loop across all
 * its clients) -- there's no efficient way to `res.write()` a fan-out to
 * many independent HTTP responses the way `wss.clients` iteration does
 * for WebSocket, and at this mock server's realistic connection counts
 * that isn't worth the added complexity.
 */
export function attachLiveFeedSSE(app: Express, overrides: Partial<EcoFakerConfig>, referenceNow: number, options: LiveFeedOptions = {}): void {
  const intervalMs = options.intervalMs ?? 800;
  const allEvents = buildWebhookEvents(overrides, referenceNow);
  const events: WebhookEvent[] = options.eventTypes ? allEvents.filter((e) => options.eventTypes!.has(e.type)) : allEvents;

  app.get("/live/sse", (req: Request, res: Response) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // tells nginx (if fronting this) not to buffer the stream
    });
    res.write(`data: ${JSON.stringify({ type: "_meta", message: `Connected. Replaying ${events.length} events at ${intervalMs}ms intervals.` })}\n\n`);

    let cursor = 0;
    const timer = setInterval(() => {
      if (events.length === 0) return;
      const event = events[cursor % events.length];
      cursor++;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }, intervalMs);

    req.on("close", () => clearInterval(timer));
  });
}
