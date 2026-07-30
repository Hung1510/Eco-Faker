// scripts/generate.mjs
//
// Generates one relationally-consistent dataset and writes it to db.json.
// This is a build step, not something you run on every server boot --
// commit db.json (or regenerate it in CI) so every dev/environment
// starts from the exact same fixed seed.

import { writeFileSync } from "node:fs";
import { generate } from "eco-faker";

const dataset = generate({
  seed: 42, // fixed seed -> byte-identical dataset every time you run this
  scaleFactor: 300, // ~300 core users, everything else derived relationally
  catalogSize: 250, // 250 products across the shared catalog
  historicalDays: 90, // 90 days of order/shipment/return history
  returnRate: 0.12,
  abandonmentRate: 0.25,
});

writeFileSync("db.json", JSON.stringify(dataset, null, 2));

console.log(
  `Generated ${dataset.products.length} products, ${dataset.users.length} customers, ` +
    `${dataset.orders.length} orders, ${dataset.shipments.length} shipments, ` +
    `${dataset.returnRequests.length} returns -> db.json`
);
