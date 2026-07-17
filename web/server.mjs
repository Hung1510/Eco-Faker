import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "../dist/generator.js";
import { SCENARIOS, resolveScenario } from "../dist/scenarios.js";
import { mergeOverrides } from "../dist/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4173;

app.use(express.static(path.join(__dirname, "public")));

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Aggregate a raw Dataset into the small, chart-ready shape the frontend needs. */
function summarize(dataset, elapsedMs) {
  const cartStatusBreakdown = { active: 0, abandoned: 0, converted: 0 };
  for (const cart of dataset.carts) cartStatusBreakdown[cart.status]++;

  const shipmentStatusBreakdown = {
    "Label Created": 0,
    "Picked Up": 0,
    "In Transit": 0,
    "Out for Delivery": 0,
    Delivered: 0,
  };
  let delayedCount = 0;
  for (const shipment of dataset.shipments) {
    shipmentStatusBreakdown[shipment.status] = (shipmentStatusBreakdown[shipment.status] ?? 0) + 1;
    if (shipment.delayed) delayedCount++;
  }

  const revenueByDay = new Map();
  for (const order of dataset.orders) {
    const day = order.createdAt.slice(0, 10);
    revenueByDay.set(day, (revenueByDay.get(day) ?? 0) + order.total);
  }
  const revenueSeries = [...revenueByDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, revenue]) => ({ date, revenue: Math.round(revenue * 100) / 100 }));

  const anomalyCounts = {
    botCarts: dataset.carts.filter((c) => c.anomaly?.type === "bot_activity").length,
    remoteShippingOrders: dataset.orders.filter((o) => o.anomaly?.type === "remote_surcharge").length,
    contradictoryReturns: dataset.returnRequests.filter((r) => r.anomaly?.type === "contradictory_review").length,
  };

  return {
    counts: {
      users: dataset.users.length,
      carts: dataset.carts.length,
      abandonedCheckouts: dataset.abandonedCheckouts.length,
      orders: dataset.orders.length,
      shipments: dataset.shipments.length,
      returnRequests: dataset.returnRequests.length,
    },
    cartStatusBreakdown,
    shipmentStatusBreakdown,
    delayedCount,
    revenueSeries,
    anomalyCounts,
    elapsedMs: Math.round(elapsedMs * 10) / 10,
  };
}

function buildOverridesFromQuery(query) {
  return {
    seed: num(query.seed, 42),
    scaleFactor: num(query.scaleFactor, 150),
    abandonmentRate: num(query.abandonmentRate, 0.35),
    delayProbability: num(query.delayProbability, 0.15),
    returnRate: num(query.returnRate, 0.08),
    multiPackageRate: num(query.multiPackageRate, 0.1),
  };
}

// Pin the reference time to the top of today so repeated requests with the
// same sliders (same seed) produce a stable dataset within a browsing
// session, instead of drifting every millisecond like a live server would.
function todayReferenceNow() {
  return new Date().setUTCHours(0, 0, 0, 0);
}

app.get("/api/generate", (req, res) => {
  const overrides = buildOverridesFromQuery(req.query);
  const referenceNow = todayReferenceNow();

  const start = performance.now();
  const dataset = generate(overrides, referenceNow);
  const elapsedMs = performance.now() - start;

  res.json(summarize(dataset, elapsedMs));
});

const RFM_SEGMENTS = [
  { name: "Champions", test: (r, f, m) => r >= 3 && f >= 3 && m >= 3 },
  { name: "Loyal", test: (r, f, m) => f >= 3 && m >= 2 },
  { name: "Big Spenders", test: (r, f, m) => m >= 3 },
  { name: "At Risk", test: (r, f, m) => r <= 2 && (f >= 2 || m >= 2) },
  { name: "New / One-time", test: (r, f) => f <= 1 },
  { name: "Hibernating", test: () => true }, // fallback
];

function segmentFor(rScore, fScore, mScore) {
  for (const segment of RFM_SEGMENTS) {
    if (segment.test(rScore, fScore, mScore)) return segment.name;
  }
  return "Hibernating";
}

/** Split values into 4 quartile buckets, returning a scorer: value -> 1..4 (4 = best). */
function quartileScorer(values, higherIsBetter) {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
  const cuts = [q(0.25), q(0.5), q(0.75)];
  return (value) => {
    let bucket = 1;
    if (value > cuts[0]) bucket = 2;
    if (value > cuts[1]) bucket = 3;
    if (value > cuts[2]) bucket = 4;
    return higherIsBetter ? bucket : 5 - bucket;
  };
}

/**
 * Simple, illustrative RFM (Recency / Frequency / Monetary) segmentation --
 * quartile scoring + rule-based labels, not a trained clustering model.
 * Good enough to demonstrate cohort-style analytics on generated data;
 * swap in a real model if you need production-grade segmentation.
 */
function computeRfm(dataset, referenceNow) {
  const byUser = new Map();
  for (const order of dataset.orders) {
    const entry = byUser.get(order.userId) ?? { orders: 0, monetary: 0, lastOrderAt: 0 };
    entry.orders += 1;
    entry.monetary += order.total;
    entry.lastOrderAt = Math.max(entry.lastOrderAt, new Date(order.createdAt).getTime());
    byUser.set(order.userId, entry);
  }

  if (byUser.size === 0) return { segments: {}, topCustomers: [] };

  const recencyDays = [...byUser.values()].map((e) => (referenceNow - e.lastOrderAt) / (1000 * 60 * 60 * 24));
  const frequencies = [...byUser.values()].map((e) => e.orders);
  const monetaryValues = [...byUser.values()].map((e) => e.monetary);

  const scoreRecency = quartileScorer(recencyDays, false); // fewer days since last order = better
  const scoreFrequency = quartileScorer(frequencies, true);
  const scoreMonetary = quartileScorer(monetaryValues, true);

  const usersById = new Map(dataset.users.map((u) => [u.id, u]));
  const rows = [...byUser.entries()].map(([userId, e]) => {
    const recency = (referenceNow - e.lastOrderAt) / (1000 * 60 * 60 * 24);
    const rScore = scoreRecency(recency);
    const fScore = scoreFrequency(e.orders);
    const mScore = scoreMonetary(e.monetary);
    return {
      userId,
      email: usersById.get(userId)?.email ?? "unknown",
      recencyDays: Math.round(recency),
      frequency: e.orders,
      monetary: Math.round(e.monetary * 100) / 100,
      segment: segmentFor(rScore, fScore, mScore),
    };
  });

  const segments = {};
  for (const row of rows) segments[row.segment] = (segments[row.segment] ?? 0) + 1;

  const topCustomers = [...rows].sort((a, b) => b.monetary - a.monetary).slice(0, 10);

  return { segments, topCustomers };
}

app.get("/api/rfm", (req, res) => {
  const overrides = buildOverridesFromQuery(req.query);
  const referenceNow = todayReferenceNow();
  const dataset = generate(overrides, referenceNow);
  res.json(computeRfm(dataset, referenceNow));
});

function keyMetrics(dataset) {
  const cartCount = dataset.carts.length || 1;
  const abandonedCount = dataset.carts.filter((c) => c.status === "abandoned").length;
  const shipmentCount = dataset.shipments.length || 1;
  const delayedCount = dataset.shipments.filter((s) => s.delayed).length;
  const deliveredOrders = dataset.orders.filter((o) => o.status === "delivered").length || 1;
  const avgOrderValue = dataset.orders.length > 0 ? dataset.orders.reduce((sum, o) => sum + o.total, 0) / dataset.orders.length : 0;

  return {
    abandonmentRatePct: Math.round((abandonedCount / cartCount) * 1000) / 10,
    delayedShipmentPct: Math.round((delayedCount / shipmentCount) * 1000) / 10,
    avgOrderValue: Math.round(avgOrderValue * 100) / 100,
    returnRatePct: Math.round((dataset.returnRequests.length / deliveredOrders) * 1000) / 10,
  };
}

app.get("/api/scenarios", (_req, res) => {
  res.json(Object.keys(SCENARIOS));
});

app.get("/api/compare", (req, res) => {
  const scaleFactor = num(req.query.scaleFactor, 150);
  const referenceNow = todayReferenceNow();

  function buildSide(scenarioName) {
    const scenarioOverrides = scenarioName ? resolveScenario(scenarioName) : {};
    const overrides = mergeOverrides(scenarioOverrides, { scaleFactor, seed: 42 });
    const dataset = generate(overrides, referenceNow);
    return {
      scenario: scenarioName || "custom",
      ...keyMetrics(dataset),
      counts: { orders: dataset.orders.length, carts: dataset.carts.length },
    };
  }

  res.json({ a: buildSide(req.query.scenarioA), b: buildSide(req.query.scenarioB) });
});

app.listen(PORT, () => {
  console.log(`eco-faker playground running at http://localhost:${PORT}`);
});
