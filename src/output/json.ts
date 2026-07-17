import type { Dataset } from "../types.js";

/** Pretty-printed JSON, one top-level object with an array per entity. */
export function toJson(dataset: Dataset, pretty = true): string {
  const { config, ...entities } = dataset;
  return JSON.stringify(entities, null, pretty ? 2 : 0);
}
