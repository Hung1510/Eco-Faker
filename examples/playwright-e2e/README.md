# playwright-e2e

A companion project for the tutorial in [`TUTORIAL.md`](./TUTORIAL.md): deterministic, parallel-safe Playwright tests, one server + seeded `eco-faker` dataset per worker, reset to pristine state before every test.

## Run it

From the repo root (so this workspace links against the local `eco-faker` source, not the published npm package):

```bash
npm install
cd examples/playwright-e2e
npx playwright install chromium   # skip if already cached in your environment
npx playwright test
```

**Version note:** `@playwright/test` is pinned to an exact version (`1.56.0`, not `^1.56.0`) here specifically because this sandbox has a pre-cached Chromium browser at a fixed revision; a floating range could resolve to a newer `@playwright/test` expecting a browser revision that isn't cached. Real projects can usually float this range freely and just re-run `npx playwright install` when it drifts — see `TUTORIAL.md`'s "Common mistakes" for the general version of this gotcha.

## CI

`npm run ci-smoke-test` runs the full Playwright suite (4 tests, 2 workers) — the same command as `test:e2e`.
