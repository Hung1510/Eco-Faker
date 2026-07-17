import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "../dist/generator.js";

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

app.get("/api/generate", (req, res) => {
  const overrides = {
    seed: num(req.query.seed, 42),
    scaleFactor: num(req.query.scaleFactor, 150),
    abandonmentRate: num(req.query.abandonmentRate, 0.35),
    delayProbability: num(req.query.delayProbability, 0.15),
    returnRate: num(req.query.returnRate, 0.08),
    multiPackageRate: num(req.query.multiPackageRate, 0.1),
  };

  // Pin the reference time to the top of today so repeated requests with the
  // same sliders (same seed) produce a stable dataset within a browsing
  // session, instead of drifting every millisecond like a live server would.
  const referenceNow = new Date().setUTCHours(0, 0, 0, 0);

  const start = performance.now();
  const dataset = generate(overrides, referenceNow);
  const elapsedMs = performance.now() - start;

  res.json(summarize(dataset, elapsedMs));
});

app.listen(PORT, () => {
  console.log(`eco-faker playground running at http://localhost:${PORT}`);
});
