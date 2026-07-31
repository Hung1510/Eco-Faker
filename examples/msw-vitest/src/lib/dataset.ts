// src/lib/dataset.ts
import { generate } from "eco-faker";

export const dataset = generate({
  seed: 42,
  scaleFactor: 300,
  catalogSize: 250,
  historicalDays: 90,
  returnRate: 0.12,
});
