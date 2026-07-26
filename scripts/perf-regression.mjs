#!/usr/bin/env node
// Generation-time/memory regression guard -- runs generate() at a fixed
// scale against the *compiled* dist/ output (same convention as
// benchmark.mjs) and fails if either regresses beyond a threshold against
// a stored baseline (perf-baseline.json). Bootstraps the baseline on first
// run rather than failing with nothing to compare against.
//
// Multiple runs, median taken -- a single run's timing is noisy enough
// (GC pauses, JIT warmup, whatever else is happening on the CI runner)
// that comparing one run to one baseline run would produce false
// failures unrelated to any real regression. Memory is measured without
// forcing a GC unless the caller passes --expose-gc to node (checked via
// `typeof global.gc`), so its threshold is deliberately more generous --
// stated plainly, this is a noisier measurement than generation time.

import { fileURLToPath } from "node:url";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, "..", "dist");
const baselinePath = path.join(here, "..", "perf-baseline.json");

const { generate } = await import(path.join(distDir, "generator.js"));

const SCALE_FACTOR = 1000;
const SEED = 1;
const RUNS = 5;
const TIME_REGRESSION_THRESHOLD = 0.35; // 35% slower than baseline fails
const MEMORY_REGRESSION_THRESHOLD = 0.5; // 50% more heap than baseline fails -- more generous, see note above

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const timings = [];
const heapDeltas = [];
let recordCount = 0;

for (let i = 0; i < RUNS; i++) {
  if (typeof global.gc === "function") global.gc();
  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  const dataset = generate({ seed: SEED, scaleFactor: SCALE_FACTOR }, Date.now());
  const generationMs = performance.now() - start;
  const heapAfter = process.memoryUsage().heapUsed;

  timings.push(generationMs);
  heapDeltas.push(Math.max(0, heapAfter - heapBefore));
  recordCount = Object.keys(dataset).filter((k) => Array.isArray(dataset[k])).reduce((sum, k) => sum + dataset[k].length, 0);
}

const medianTimeMs = Math.round(median(timings) * 10) / 10;
const medianHeapBytes = Math.round(median(heapDeltas));

const current = {
  measuredAt: new Date().toISOString(),
  nodeVersion: process.version,
  scaleFactor: SCALE_FACTOR,
  seed: SEED,
  runs: RUNS,
  gcForced: typeof global.gc === "function",
  medianGenerationMs: medianTimeMs,
  medianHeapDeltaBytes: medianHeapBytes,
  recordCount,
};

console.log(`Generated ${recordCount.toLocaleString()} records in a median of ${medianTimeMs}ms across ${RUNS} runs (heap delta: ${(medianHeapBytes / 1024 / 1024).toFixed(1)}MB${current.gcForced ? "" : ", GC not forced -- run with --expose-gc for a cleaner reading"}).`);

const updateBaseline = process.argv.includes("--update-baseline");
const baselineAlreadyExisted = existsSync(baselinePath);

if (!baselineAlreadyExisted || updateBaseline) {
  writeFileSync(baselinePath, JSON.stringify(current, null, 2) + "\n", "utf-8");
  console.log(`${baselineAlreadyExisted ? "Updated" : "Wrote"} baseline to ${baselinePath}.`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf-8"));

const timeRegression = (current.medianGenerationMs - baseline.medianGenerationMs) / baseline.medianGenerationMs;
const memoryRegression =
  baseline.medianHeapDeltaBytes > 0 ? (current.medianHeapDeltaBytes - baseline.medianHeapDeltaBytes) / baseline.medianHeapDeltaBytes : 0;

console.log(`Baseline (${baseline.measuredAt}): ${baseline.medianGenerationMs}ms, ${(baseline.medianHeapDeltaBytes / 1024 / 1024).toFixed(1)}MB.`);
console.log(`Time change: ${(timeRegression * 100).toFixed(1)}%. Memory change: ${(memoryRegression * 100).toFixed(1)}%.`);

let failed = false;
if (timeRegression > TIME_REGRESSION_THRESHOLD) {
  console.error(`FAIL: generation time regressed ${(timeRegression * 100).toFixed(1)}% (threshold: ${TIME_REGRESSION_THRESHOLD * 100}%).`);
  failed = true;
}
if (memoryRegression > MEMORY_REGRESSION_THRESHOLD) {
  console.error(`FAIL: heap delta regressed ${(memoryRegression * 100).toFixed(1)}% (threshold: ${MEMORY_REGRESSION_THRESHOLD * 100}%).`);
  failed = true;
}

if (failed) {
  console.error("\nIf this regression is expected (a real new feature doing more work per call), re-run with --update-baseline to accept it.");
  process.exit(1);
}

console.log("ok: no performance regression beyond threshold.");
