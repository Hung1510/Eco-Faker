// lib/dataset.ts
//
// One in-memory dataset, shared by every Server Component and Route Handler
// in the app. `generate()` is deterministic (fixed seed), so every request
// sees the same 300 customers / 250 products / ~500+ orders.
//
// Next.js's dev server re-executes route/page modules on Fast Refresh, which
// would otherwise silently regenerate a *different* dataset (referenceNow
// shifts) on every save. Stashing it on `globalThis` survives that, the same
// way the well-known Prisma-client-singleton pattern does.

import { generate, type Dataset } from "eco-faker";

declare global {
  // eslint-disable-next-line no-var
  var __ecoFakerDataset: Dataset | undefined;
}

function buildDataset(): Dataset {
  return generate({
    seed: 42,
    scaleFactor: 300,
    catalogSize: 250,
    historicalDays: 90,
    returnRate: 0.12,
  });
}

export const dataset: Dataset = globalThis.__ecoFakerDataset ?? (globalThis.__ecoFakerDataset = buildDataset());
