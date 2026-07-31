// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  // Two workers demonstrates real parallelism locally without needing a
  // beefy machine -- each gets its own server instance and seed via the
  // worker-scoped fixture in fixtures/server-fixture.ts.
  workers: 2,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
