#!/usr/bin/env node
/**
 * CI smoke test: generates a dataset with each scenario preset and asserts
 * basic structural invariants (non-empty tables, valid JSON, relational
 * integrity spot-checks). This is deliberately separate from the vitest
 * suite -- it's meant to catch "the build still runs and produces a sane
 * shape" regressions, run against the *compiled* dist/, not the source.
 */
import { generate } from "../dist/generator.js";
import { SCENARIOS } from "../dist/scenarios.js";

let failures = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failures++;
  } else {
    console.log(`ok: ${message}`);
  }
}

function checkDataset(name, dataset) {
  assert(dataset.users.length > 0, `${name}: has users`);
  assert(dataset.carts.length > 0, `${name}: has carts`);
  assert(dataset.orders.length + dataset.abandonedCheckouts.length > 0, `${name}: has orders or abandoned checkouts`);

  const userIds = new Set(dataset.users.map((u) => u.id));
  assert(
    dataset.carts.every((c) => userIds.has(c.userId)),
    `${name}: every cart references a real user`
  );

  const orderIds = new Set(dataset.orders.map((o) => o.id));
  assert(
    dataset.shipments.every((s) => orderIds.has(s.orderId)),
    `${name}: every shipment references a real order`
  );

  assert(
    dataset.orders.every((o) => {
      const sum = Math.round((o.subtotal + o.tax + o.shipping) * 100) / 100;
      return Math.abs(sum - o.total) < 0.01;
    }),
    `${name}: every order balances subtotal + tax + shipping = total`
  );
}

console.log("Running eco-faker smoke test against dist/ ...\n");

checkDataset("default config", generate({ seed: 1, scaleFactor: 100 }, Date.parse("2026-01-01T00:00:00Z")));

for (const scenarioName of Object.keys(SCENARIOS)) {
  const dataset = generate(
    { ...SCENARIOS[scenarioName], seed: 1, scaleFactor: 100 },
    Date.parse("2026-01-01T00:00:00Z")
  );
  checkDataset(`scenario:${scenarioName}`, dataset);
}

console.log(`\n${failures === 0 ? "PASS" : "FAIL"}: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
