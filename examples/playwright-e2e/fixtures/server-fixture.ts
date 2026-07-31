// fixtures/server-fixture.ts
//
// One server instance per Playwright *worker*, not per test or per whole
// run. Each worker gets its own port and its own seed (derived from
// `workerIndex`), so parallel workers never share a server or a dataset --
// no port collisions, no test in worker 2 seeing an order worker 1 just
// cancelled. Within a worker, every test still starts from the exact same
// pristine seeded data because of the `/test/reset` call in `beforeEach`
// (see orders.spec.ts).

import { test as base, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";

const BASE_PORT = 4100;
const BASE_SEED = 1000;

async function waitForServer(url: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

export const test = base.extend<Record<string, never>, { workerBaseURL: string }>({
  workerBaseURL: [
    async ({}, use, workerInfo) => {
      const port = BASE_PORT + workerInfo.workerIndex;
      const seed = BASE_SEED + workerInfo.workerIndex;
      const url = `http://localhost:${port}`;

      const server: ChildProcess = spawn("node", ["src/server.mjs"], {
        env: { ...process.env, PORT: String(port), SEED: String(seed) },
        stdio: "inherit",
      });

      await waitForServer(`${url}/api/products`);

      await use(url);

      server.kill();
    },
    { scope: "worker" },
  ],
});

export { expect };
