import { generate } from "./generator.js";
import type { Dataset, EcoFakerConfig } from "./types.js";

export interface Store {
  storeId: string;
  dataset: Dataset;
}

/**
 * Generate N independent "stores" in one call -- useful for marketplace or
 * multi-tenant SaaS demo data. Each store gets its own deterministic seed
 * (base seed + store index) so stores are distinct but the whole batch is
 * still fully reproducible from the base config + referenceNow.
 *
 * JSON-only for now: each store's dataset keeps its normal shape (no
 * `storeId` injected into individual records), and the caller distinguishes
 * stores by the wrapping `{ storeId, dataset }` structure. SQL/CSV output
 * would need a `store_id` column threaded through every canonical table to
 * support this properly -- that's a natural follow-up, not yet implemented.
 */
export function generateStores(
  overrides: Partial<EcoFakerConfig> = {},
  referenceNow: number = Date.now(),
  storeCount: number = 1
): Store[] {
  const baseSeed = overrides.seed ?? 1;
  const stores: Store[] = [];

  for (let i = 0; i < storeCount; i++) {
    const dataset = generate({ ...overrides, seed: baseSeed + i }, referenceNow);
    stores.push({ storeId: `store-${i + 1}`, dataset });
  }

  return stores;
}
