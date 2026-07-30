// scripts/ci-smoke-test.mjs
//
// Assumes `npm run build` already ran. Starts `next start`, hits the two
// Route Handlers and the two Server Component pages, and fails loudly if
// anything doesn't come back as expected -- catches "the tutorial's example
// doesn't actually build/boot" before it becomes a broken doc.

import { spawn } from "node:child_process";

const PORT = process.env.PORT || 4778;
const BASE = `http://localhost:${PORT}`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  // detached: true puts `next start` (and the next-server child it spawns)
  // in their own process group, so killing the negative PID below actually
  // terminates the whole tree instead of leaving next-server running and
  // the script hanging forever waiting for stdio to close.
  const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    stdio: "inherit",
    detached: true,
  });

  let failed = false;
  try {
    await wait(2000);

    const checks = [
      ["/products", async (res) => res.status === 200],
      ["/orders", async (res) => res.status === 200],
      ["/api/products?limit=2", async (res) => {
        const body = await res.json();
        return res.status === 200 && Array.isArray(body.data) && body.data.length === 2;
      }],
      ["/api/orders?status=delivered&limit=1", async (res) => {
        const body = await res.json();
        return res.status === 200 && Array.isArray(body.data);
      }],
    ];

    for (const [path, assertion] of checks) {
      const res = await fetch(`${BASE}${path}`);
      const ok = await assertion(res);
      if (!ok) {
        console.error(`FAIL ${path} -> HTTP ${res.status}`);
        failed = true;
      } else {
        console.log(`OK   ${path}`);
      }
    }
  } finally {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill();
    }
  }

  if (failed) {
    console.error("ci-smoke-test: FAILED");
    process.exit(1);
  }
  console.log("ci-smoke-test: all checks passed");
  process.exit(0);
}

main();
