import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Dataset, User } from "./types.js";

export interface JourneyEvent {
  type: string;
  label: string;
  timestamp: string;
  detail?: string;
}

function slug(status: string): string {
  return status.toLowerCase().replace(/\s+/g, "_");
}

/**
 * Assembles one user's full lifecycle -- signup, every cart (and whether it
 * was abandoned), every abandoned-checkout recovery attempt, every order,
 * every shipment tracking event, and every return -- into a single
 * chronologically-ordered timeline. Reuses the same event vocabulary as the
 * webhook simulator (`user.created`, `cart.abandoned`, `shipment.delivered`,
 * etc.) but scoped to one user and enriched with a human-readable `label`
 * for direct rendering, instead of raw record payloads.
 */
export function buildUserJourney(dataset: Dataset, userId: string): JourneyEvent[] {
  const user = dataset.users.find((u) => u.id === userId);
  if (!user) {
    throw new Error(`No user with id "${userId}" in this dataset.`);
  }

  const events: JourneyEvent[] = [
    { type: "user.created", label: "Signed up", timestamp: user.createdAt },
  ];

  for (const cart of dataset.carts.filter((c) => c.userId === userId)) {
    events.push({
      type: "cart.created",
      label: `Cart: added ${cart.items.length} item${cart.items.length === 1 ? "" : "s"}`,
      timestamp: cart.createdAt,
    });
    if (cart.status === "abandoned") {
      events.push({ type: "cart.abandoned", label: "Abandoned cart", timestamp: cart.lastActivityDate });
    }
  }

  for (const checkout of dataset.abandonedCheckouts.filter((c) => c.userId === userId)) {
    events.push({ type: "checkout.abandoned", label: "Checkout abandoned", timestamp: checkout.exitTimestamp });
    if (checkout.recoveryEmailSentAt) {
      events.push({
        type: "checkout.recovery_email_sent",
        label: "Recovery email sent" + (checkout.couponCodeOffered ? ` (${checkout.couponCodeOffered})` : ""),
        timestamp: checkout.recoveryEmailSentAt,
      });
    }
  }

  for (const order of dataset.orders.filter((o) => o.userId === userId)) {
    events.push({
      type: "order.created",
      label: `Converted to order #${order.id.slice(0, 8)}`,
      timestamp: order.createdAt,
      detail: order.totalFormatted,
    });

    const shipments = dataset.shipments.filter((s) => s.orderId === order.id);
    for (const shipment of shipments) {
      for (const trackingEvent of shipment.events) {
        events.push({
          type: `shipment.${slug(trackingEvent.status)}`,
          label:
            shipment.totalPackages > 1
              ? `Package ${shipment.packageIndex}/${shipment.totalPackages}: ${trackingEvent.status}`
              : trackingEvent.status,
          timestamp: trackingEvent.timestamp,
          detail: trackingEvent.location,
        });
      }
    }
  }

  for (const ret of dataset.returnRequests.filter((r) => r.userId === userId)) {
    events.push({ type: "return.requested", label: `Return requested: ${ret.reason}`, timestamp: ret.requestedAt });
    if (ret.resolvedAt) {
      events.push({
        type: `return.${ret.status}`,
        label: `Return ${ret.status}`,
        timestamp: ret.resolvedAt,
        detail: ret.refundAmountFormatted,
      });
    }
  }

  events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return events;
}

/**
 * Picks the user with the richest journey (most events across cart,
 * order, shipment, and return activity) -- the default when `--user` isn't
 * specified, so `visualize` produces an interesting timeline out of the box
 * instead of a near-empty one.
 */
export function pickRichestUserId(dataset: Dataset): string {
  const eventCounts = new Map<string, number>();
  const bump = (userId: string, by = 1) => eventCounts.set(userId, (eventCounts.get(userId) ?? 0) + by);

  for (const cart of dataset.carts) bump(cart.userId);
  for (const checkout of dataset.abandonedCheckouts) bump(checkout.userId);
  for (const order of dataset.orders) bump(order.userId, 2);
  for (const ret of dataset.returnRequests) bump(ret.userId, 2);

  let best: { userId: string; count: number } | undefined;
  for (const [userId, count] of eventCounts) {
    if (!best || count > best.count) best = { userId, count };
  }
  return best?.userId ?? dataset.users[0]?.id ?? "";
}

const EVENT_COLORS: Record<string, string> = {
  "user.created": "#8b5cf6",
  "cart.created": "#38bdf8",
  "cart.abandoned": "#f59e0b",
  "checkout.abandoned": "#f59e0b",
  "checkout.recovery_email_sent": "#38bdf8",
  "order.created": "#22c55e",
  "return.requested": "#ef4444",
};
const DEFAULT_SHIPMENT_COLOR = "#22c55e";
const DEFAULT_RETURN_RESOLUTION_COLOR = "#a3a3a3";

function colorFor(type: string): string {
  if (EVENT_COLORS[type]) return EVENT_COLORS[type];
  if (type.startsWith("shipment.delayed")) return "#ef4444";
  if (type.startsWith("shipment.")) return DEFAULT_SHIPMENT_COLOR;
  if (type.startsWith("return.")) return DEFAULT_RETURN_RESOLUTION_COLOR;
  return "#a3a3a3";
}

let cachedD3Source: string | undefined;

/**
 * Reads eco-faker's own vendored copy of D3 (ISC-licensed, bundled under
 * `assets/`, see `assets/D3_LICENSE`) and inlines it directly into the
 * generated HTML instead of a CDN `<script src>`. A CDN tag would make the
 * "self-contained HTML file" claim false the moment it's opened somewhere
 * without outbound network access (an air-gapped machine, a locked-down
 * CI runner, a corporate proxy that blocks cdnjs) -- inlining the bundle
 * is the actually-honest way to keep this working fully offline.
 */
function loadVendoredD3(): string {
  if (cachedD3Source) return cachedD3Source;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const assetPath = path.join(here, "..", "assets", "d3.v7.min.js");
  cachedD3Source = readFileSync(assetPath, "utf-8");
  return cachedD3Source;
}

/**
 * Renders a self-contained HTML file: a horizontal, time-scaled, animated
 * swimlane of one user's journey, drawn with D3 (vendored and inlined
 * directly into the file -- no CDN, no network access, no build step,
 * opens and works from a plain `file://` URL). Nodes fade in left-to-right
 * in chronological order; hovering a node shows its label, timestamp, and
 * any detail (order total, tracking location, refund amount). Meant to be
 * opened directly in a browser or embedded in a writeup -- it's not part
 * of eco-faker's own served UI.
 */
export function renderJourneyHtml(user: User, events: JourneyEvent[]): string {
  const payload = JSON.stringify(
    events.map((e) => ({ ...e, color: colorFor(e.type), t: Date.parse(e.timestamp) }))
  );
  const userName = `${user.firstName} ${user.lastName}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Customer journey -- ${escapeHtml(userName)}</title>
<script>${loadVendoredD3()}</script>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0;
    background: #0b0d12;
    color: #e5e7eb;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  header { padding: 28px 32px 8px; }
  header h1 { margin: 0 0 4px; font-size: 20px; }
  header p { margin: 0; color: #9ca3af; font-size: 13px; }
  #chart { width: 100%; height: 420px; }
  .event-label {
    font-size: 11px;
    fill: #e5e7eb;
  }
  .event-time {
    font-size: 10px;
    fill: #6b7280;
  }
  .lane-line { stroke: #262b36; stroke-width: 2; }
  .tooltip {
    position: fixed;
    pointer-events: none;
    background: #171a21;
    border: 1px solid #2a2f3a;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 12px;
    opacity: 0;
    transition: opacity 120ms ease;
    max-width: 260px;
  }
  .tooltip strong { display: block; margin-bottom: 2px; }
  .tooltip span { color: #9ca3af; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(userName)}'s journey</h1>
  <p>${events.length} events -- generated by eco-faker</p>
</header>
<div id="chart"></div>
<div class="tooltip" id="tooltip"></div>
<script>
const events = ${payload};
const svg = d3.select("#chart").append("svg").attr("width", "100%").attr("height", 420);
const margin = { top: 60, right: 60, bottom: 60, left: 60 };
const width = Math.max(900, events.length * 140);
svg.attr("viewBox", \`0 0 \${width} 420\`);

const x = d3.scaleTime()
  .domain(d3.extent(events, d => d.t))
  .range([margin.left, width - margin.right]);

const laneY = 210;
svg.append("line")
  .attr("class", "lane-line")
  .attr("x1", margin.left).attr("x2", width - margin.right)
  .attr("y1", laneY).attr("y2", laneY);

const tooltip = d3.select("#tooltip");

const nodes = svg.selectAll("g.event")
  .data(events)
  .enter()
  .append("g")
  .attr("class", "event")
  .attr("transform", d => \`translate(\${x(d.t)}, \${laneY})\`)
  .style("opacity", 0);

nodes.append("circle")
  .attr("r", 7)
  .attr("fill", d => d.color)
  .attr("stroke", "#0b0d12")
  .attr("stroke-width", 2);

nodes.each(function (d, i) {
  const g = d3.select(this);
  // 4-lane alternation (far-above, near-above, near-below, far-below)
  // instead of just above/below -- with events packed close in time,
  // 2 lanes still collide; 4 gives enough vertical spread to stay legible.
  const lane = i % 4;
  const labelY = [-62, -34, 46, 74][lane];
  const timeY = [-48, -20, 60, 88][lane];
  const lineY1 = [-40, -12, 12, 40][lane];
  const lineY2 = lane < 2 ? 0 : 0;
  g.append("text")
    .attr("class", "event-label")
    .attr("text-anchor", "middle")
    .attr("y", labelY)
    .text(d.label.length > 22 ? d.label.slice(0, 21) + "\\u2026" : d.label);
  g.append("text")
    .attr("class", "event-time")
    .attr("text-anchor", "middle")
    .attr("y", timeY)
    .text(new Date(d.t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }));
  g.append("line")
    .attr("x1", 0).attr("x2", 0)
    .attr("y1", lineY1)
    .attr("y2", lineY2)
    .attr("stroke", "#262b36");
});

nodes
  .on("mouseenter", function (event, d) {
    tooltip.style("opacity", 1).html(
      \`<strong>\${d.label}</strong><span>\${new Date(d.t).toLocaleString()}</span>\` +
      (d.detail ? \`<div>\${d.detail}</div>\` : "")
    );
  })
  .on("mousemove", (event) => {
    tooltip.style("left", event.clientX + 16 + "px").style("top", event.clientY + 16 + "px");
  })
  .on("mouseleave", () => tooltip.style("opacity", 0));

nodes.transition()
  .delay((d, i) => i * 180)
  .duration(400)
  .style("opacity", 1);
</script>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}
