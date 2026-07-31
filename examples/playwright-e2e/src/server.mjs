// src/server.mjs
//
// SEED and PORT come from the environment so each Playwright worker can run
// its own fully isolated server instance -- same seed always produces the
// same dataset, different workers use different seeds/ports so parallel
// runs never share (or corrupt) each other's state.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express from "express";
import { generate } from "eco-faker";

const __dirname = dirname(fileURLToPath(import.meta.url));
const seed = Number(process.env.SEED ?? 42);
const port = Number(process.env.PORT ?? 3100);

function buildDataset() {
  return generate({
    seed,
    scaleFactor: 50,
    catalogSize: 40,
    historicalDays: 30,
    returnRate: 0.1,
  });
}

// Mutable reference -- /test/reset swaps this back to a pristine, freshly
// generated dataset for the same seed, undoing whatever a test mutated
// (e.g. cancelling an order) without restarting the process.
let dataset = buildDataset();

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "..", "public")));

app.get("/api/products", (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const start = (page - 1) * limit;
  res.json({
    data: dataset.products.slice(start, start + limit),
    pagination: {
      page,
      limit,
      total: dataset.products.length,
      totalPages: Math.max(1, Math.ceil(dataset.products.length / limit)),
    },
  });
});

app.get("/api/orders", (req, res) => {
  const { status } = req.query;
  let orders = dataset.orders;
  if (status) orders = orders.filter((o) => o.status === status);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const start = (page - 1) * limit;
  res.json({
    data: orders.slice(start, start + limit),
    pagination: { page, limit, total: orders.length, totalPages: Math.max(1, Math.ceil(orders.length / limit)) },
  });
});

app.get("/api/orders/:id", (req, res) => {
  const order = dataset.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});

// A real state mutation -- what actually makes this an end-to-end test
// rather than a static read-only page.
app.post("/api/orders/:id/cancel", (req, res) => {
  const order = dataset.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (order.status === "delivered") {
    return res.status(409).json({ error: "Cannot cancel a delivered order" });
  }
  order.status = "cancelled";
  res.json(order);
});

// Restores the pristine, deterministically-generated dataset for this
// worker's seed -- called in `beforeEach` so every test starts from the
// exact same known state, regardless of what a previous test mutated or
// what order tests ran in.
app.post("/test/reset", (_req, res) => {
  dataset = buildDataset();
  res.json({ status: "reset", seed });
});

app.listen(port, () => {
  console.log(`eco-faker demo server (seed=${seed}) listening on http://localhost:${port}`);
});
