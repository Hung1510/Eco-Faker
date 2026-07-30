// src/server.mjs
import { readFileSync } from "node:fs";
import express from "express";
import { paginate, matchesQuery } from "./paginate.js";

const db = JSON.parse(readFileSync(new URL("../db.json", import.meta.url)));

// Build id -> record lookup maps once at boot, not per-request.
const categoryById = new Map(db.categories.map((c) => [c.id, c]));
const brandById = new Map(db.brands.map((b) => [b.id, b]));
const userById = new Map(db.users.map((u) => [u.id, u]));

// Denormalize the fields a product listing page actually needs (category
// name, brand name) once, at boot -- so every request just reads a plain
// object instead of doing three map lookups per row.
const products = db.products.map((p) => ({
  ...p,
  categoryName: categoryById.get(p.categoryId)?.name ?? null,
  brandName: brandById.get(p.brandId)?.name ?? null,
}));

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", generatedAt: db.config.seed !== undefined ? "seed:" + db.config.seed : null });
});

// ---------- Products ----------
app.get("/api/products", (req, res) => {
  const { q, categoryId, brandId, minPrice, maxPrice } = req.query;

  let filtered = products;
  if (q) filtered = filtered.filter((p) => matchesQuery(p, ["name", "sku"], q));
  if (categoryId) filtered = filtered.filter((p) => p.categoryId === categoryId);
  if (brandId) filtered = filtered.filter((p) => p.brandId === brandId);
  if (minPrice) filtered = filtered.filter((p) => p.basePrice >= Number(minPrice));
  if (maxPrice) filtered = filtered.filter((p) => p.basePrice <= Number(maxPrice));

  res.json(paginate(filtered, req, { defaultSort: "name" }));
});

app.get("/api/products/:id", (req, res) => {
  const product = products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found" });
  res.json(product);
});

// ---------- Customers ----------
app.get("/api/customers", (req, res) => {
  const { q } = req.query;
  let filtered = db.users;
  if (q) filtered = filtered.filter((u) => matchesQuery(u, ["firstName", "lastName", "email"], q));

  res.json(paginate(filtered, req, { defaultSort: "createdAt" }));
});

app.get("/api/customers/:id", (req, res) => {
  const customer = userById.get(req.params.id);
  if (!customer) return res.status(404).json({ error: "Customer not found" });
  res.json(customer);
});

// ---------- Orders ----------
app.get("/api/orders", (req, res) => {
  const { status, userId, q } = req.query;
  let filtered = db.orders;
  if (status) filtered = filtered.filter((o) => o.status === status);
  if (userId) filtered = filtered.filter((o) => o.userId === userId);
  if (q) filtered = filtered.filter((o) => matchesQuery(o, ["id", "totalFormatted"], q));

  res.json(paginate(filtered, req, { defaultSort: "-createdAt" }));
});

app.get("/api/orders/:id", (req, res) => {
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});

app.get("/api/orders/:id/shipments", (req, res) => {
  const shipments = db.shipments.filter((s) => s.orderId === req.params.id);
  res.json({ data: shipments });
});

app.get("/api/orders/:id/returns", (req, res) => {
  const returns = db.returnRequests.filter((r) => r.orderId === req.params.id);
  res.json({ data: returns });
});

// ---------- Shipments ----------
app.get("/api/shipments", (req, res) => {
  const { status, carrier } = req.query;
  let filtered = db.shipments;
  if (status) filtered = filtered.filter((s) => s.status === status);
  if (carrier) filtered = filtered.filter((s) => s.carrier === carrier);

  res.json(paginate(filtered, req, { defaultSort: "trackingNumber" }));
});

app.get("/api/shipments/:id", (req, res) => {
  const shipment = db.shipments.find((s) => s.id === req.params.id);
  if (!shipment) return res.status(404).json({ error: "Shipment not found" });
  res.json(shipment);
});

// ---------- Returns ----------
app.get("/api/returns", (req, res) => {
  const { status } = req.query;
  let filtered = db.returnRequests;
  if (status) filtered = filtered.filter((r) => r.status === status);

  res.json(paginate(filtered, req, { defaultSort: "-requestedAt" }));
});

app.get("/api/returns/:id", (req, res) => {
  const ret = db.returnRequests.find((r) => r.id === req.params.id);
  if (!ret) return res.status(404).json({ error: "Return not found" });
  res.json(ret);
});

const port = process.env.PORT || 4001;
app.listen(port, () => {
  console.log(`Fake Shopify backend listening on http://localhost:${port}`);
});
