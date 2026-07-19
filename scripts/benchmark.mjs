#!/usr/bin/env node
// Measures eco-faker's own generation speed and relational-integrity
// guarantee against the *compiled* dist/ output (not src/), so this
// benchmarks what actually ships, not the TypeScript source. Writes
// benchmark-results.json to the repo root -- CI commits that file back on
// every run, and the README's badges read it live via shields.io's
// dynamic-JSON badge endpoint, so the badges track real numbers instead of
// being hand-typed and going stale.
//
// Deliberately does NOT compare against Faker.js or any other library --
// eco-faker generates relationally-consistent, stateful multi-table
// datasets; Faker.js generates individual fake values. "Records per
// second" isn't a fair apples-to-apples number between those two, and a
// benchmark that implies otherwise would be misleading. This measures
// eco-faker's own performance and its own integrity guarantee, full stop.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { performance } from "node:perf_hooks";

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, "..", "dist");

const { generate } = await import(path.join(distDir, "generator.js"));
const { lintDataset } = await import(path.join(distDir, "lint.js"));

const SCALE_FACTOR = 1000;
const SEED = 1;

const start = performance.now();
const dataset = generate({ seed: SEED, scaleFactor: SCALE_FACTOR }, Date.now());
const generationMs = performance.now() - start;

const totalRecords =
  dataset.categories.length +
  dataset.brands.length +
  dataset.suppliers.length +
  dataset.products.length +
  dataset.users.length +
  dataset.carts.length +
  dataset.abandonedCheckouts.length +
  dataset.orders.length +
  dataset.shipments.length +
  dataset.returnRequests.length +
  dataset.productViews.length +
  dataset.searchQueries.length +
  dataset.wishlistItems.length +
  dataset.productRatings.length +
  dataset.warehouses.length +
  dataset.replenishmentOrders.length +
  dataset.stockoutPeriods.length +
  dataset.warehouseTransfers.length;

const recordsPerSecond = Math.round((totalRecords / generationMs) * 1000);

const lintIssues = lintDataset(dataset);

const results = {
  generatedAt: new Date().toISOString(),
  nodeVersion: process.version,
  scaleFactor: SCALE_FACTOR,
  seed: SEED,
  generationMs: Math.round(generationMs * 10) / 10,
  totalRecords,
  recordsPerSecond,
  recordCounts: {
    categories: dataset.categories.length,
    brands: dataset.brands.length,
    suppliers: dataset.suppliers.length,
    products: dataset.products.length,
    users: dataset.users.length,
    carts: dataset.carts.length,
    abandonedCheckouts: dataset.abandonedCheckouts.length,
    orders: dataset.orders.length,
    shipments: dataset.shipments.length,
    returnRequests: dataset.returnRequests.length,
    productViews: dataset.productViews.length,
    searchQueries: dataset.searchQueries.length,
    wishlistItems: dataset.wishlistItems.length,
    productRatings: dataset.productRatings.length,
    warehouses: dataset.warehouses.length,
    replenishmentOrders: dataset.replenishmentOrders.length,
    stockoutPeriods: dataset.stockoutPeriods.length,
    warehouseTransfers: dataset.warehouseTransfers.length,
  },
  lintIssueCount: lintIssues.length,
  relationalIntegrityPercent: lintIssues.length === 0 ? 100 : Math.round((1 - lintIssues.length / totalRecords) * 1000) / 10,
};

const outputPath = path.join(here, "..", "benchmark-results.json");
writeFileSync(outputPath, JSON.stringify(results, null, 2) + "\n", "utf-8");

console.log(`Generated ${totalRecords.toLocaleString()} records in ${results.generationMs}ms (${recordsPerSecond.toLocaleString()} records/sec).`);
console.log(`Lint: ${lintIssues.length} issue(s) found (${results.relationalIntegrityPercent}% relational integrity).`);
console.log(`Written to ${outputPath}`);

if (lintIssues.length > 0) {
  console.error("\nBenchmark dataset failed its own lint check -- this should never happen on a clean generate(). Failing.");
  process.exit(1);
}
