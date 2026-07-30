// scripts/ci-smoke-test.mjs
//
// Starts the example's Express server against a freshly generated dataset,
// hits a representative endpoint from each resource, and fails loudly (exit
// code 1) if anything doesn't come back as expected. Meant to be run in CI
// right after `npm run generate`, catching "the tutorial's example server
// doesn't actually boot/respond" before it becomes a broken link in the docs.

import { spawn } from "node:child_process";

const PORT = process.env.PORT || 4777;
const BASE = `http://localhost:${PORT}`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`);
  const body = await res.json();
  return { status: res.status, body };
}

async function main() {
  const server = spawn("node", ["src/server.mjs"], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: "inherit",
  });

  let failed = false;
  try {
    await wait(1500);

    const checks = [
      ["/health", (r) => r.status === 200 && r.body.status === "ok"],
      ["/api/products?limit=5", (r) => r.status === 200 && Array.isArray(r.body.data) && r.body.data.length > 0],
      ["/api/customers?limit=5", (r) => r.status === 200 && r.body.pagination.total > 0],
      ["/api/orders?status=delivered&limit=1", (r) => r.status === 200 && Array.isArray(r.body.data)],
      ["/api/shipments?limit=1", (r) => r.status === 200 && Array.isArray(r.body.data)],
      ["/api/returns?limit=1", (r) => r.status === 200 && Array.isArray(r.body.data)],
      ["/api/products/does-not-exist", (r) => r.status === 404],
    ];

    for (const [path, assertion] of checks) {
      const result = await fetchJson(path);
      if (!assertion(result)) {
        console.error(`FAIL ${path} ->`, JSON.stringify(result));
        failed = true;
      } else {
        console.log(`OK   ${path}`);
      }
    }

    // Follow-up check that needs a real id from a previous response:
    // an order's nested /shipments route.
    const orders = await fetchJson("/api/orders?limit=1");
    const orderId = orders.body.data[0]?.id;
    if (orderId) {
      const shipments = await fetchJson(`/api/orders/${orderId}/shipments`);
      if (shipments.status !== 200 || !Array.isArray(shipments.body.data)) {
        console.error("FAIL /api/orders/:id/shipments ->", JSON.stringify(shipments));
        failed = true;
      } else {
        console.log(`OK   /api/orders/${orderId}/shipments`);
      }
    } else {
      console.error("FAIL could not find an order id to test nested shipments route");
      failed = true;
    }
  } finally {
    server.kill();
  }

  if (failed) {
    console.error("ci-smoke-test: FAILED");
    process.exit(1);
  }
  console.log("ci-smoke-test: all checks passed");
}

main();
