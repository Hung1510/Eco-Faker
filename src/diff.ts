import { readFileSync } from "node:fs";
import { generate } from "./generator.js";
import type { Cart, Dataset, Order, Shipment } from "./types.js";

interface SnapshotFile {
  meta?: { tool?: string };
  referenceNow: number;
  config: Record<string, unknown>;
}

function looksLikeSnapshot(parsed: unknown): parsed is SnapshotFile {
  const p = parsed as SnapshotFile;
  return typeof p === "object" && p !== null && p.meta?.tool === "my-eco-gen" && typeof p.referenceNow === "number";
}

function looksLikeDataset(parsed: unknown): parsed is Dataset {
  const p = parsed as Dataset;
  return typeof p === "object" && p !== null && Array.isArray(p.users) && Array.isArray(p.orders);
}

/** Load a file that's either a raw `generate --format json` dataset, or a `.snapshot.json` recipe (which gets regenerated). */
export function loadDatasetLike(filePath: string): Dataset {
  const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
  if (looksLikeSnapshot(parsed)) {
    return generate(parsed.config, parsed.referenceNow);
  }
  if (looksLikeDataset(parsed)) {
    return parsed;
  }
  throw new Error(
    `${filePath} doesn't look like a dataset (from \`generate --format json\`) or a snapshot recipe (from \`generate --snapshot\`).`
  );
}

const TABLES = ["users", "carts", "abandonedCheckouts", "orders", "shipments", "returnRequests"] as const;

function fieldSet(rows: Record<string, unknown>[]): Set<string> {
  return new Set(rows.length > 0 ? Object.keys(rows[0]) : []);
}

function countBy<T>(rows: T[], key: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const k = key(row);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

export interface DiffReport {
  rowCounts: Record<string, { a: number; b: number; delta: number }>;
  schemaChanges: Record<string, { addedFields: string[]; removedFields: string[] }>;
  cartStatusDelta: Record<string, { a: number; b: number }>;
  orderStatusDelta: Record<string, { a: number; b: number }>;
  shipmentStatusDelta: Record<string, { a: number; b: number }>;
  hasSchemaChanges: boolean;
}

function mergedKeys(a: Record<string, number>, b: Record<string, number>): Record<string, { a: number; b: number }> {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const result: Record<string, { a: number; b: number }> = {};
  for (const key of keys) result[key] = { a: a[key] ?? 0, b: b[key] ?? 0 };
  return result;
}

/** Compare two datasets structurally: row-count deltas, field-set (schema) drift, and status-distribution shifts. */
export function diffDatasets(a: Dataset, b: Dataset): DiffReport {
  const rowCounts: DiffReport["rowCounts"] = {};
  const schemaChanges: DiffReport["schemaChanges"] = {};
  let hasSchemaChanges = false;

  for (const table of TABLES) {
    const aRows = a[table] as unknown as Record<string, unknown>[];
    const bRows = b[table] as unknown as Record<string, unknown>[];
    rowCounts[table] = { a: aRows.length, b: bRows.length, delta: bRows.length - aRows.length };

    const aFields = fieldSet(aRows);
    const bFields = fieldSet(bRows);
    // If either side sampled zero rows, there's nothing to compare -- an
    // empty array isn't evidence of a missing/added field, just missing
    // data. Only compare field sets when both sides actually have rows.
    const addedFields = aRows.length > 0 && bRows.length > 0 ? [...bFields].filter((f) => !aFields.has(f)) : [];
    const removedFields = aRows.length > 0 && bRows.length > 0 ? [...aFields].filter((f) => !bFields.has(f)) : [];
    schemaChanges[table] = { addedFields, removedFields };
    if (addedFields.length > 0 || removedFields.length > 0) hasSchemaChanges = true;
  }

  const cartStatusDelta = mergedKeys(
    countBy(a.carts as Cart[], (c) => c.status),
    countBy(b.carts as Cart[], (c) => c.status)
  );
  const orderStatusDelta = mergedKeys(
    countBy(a.orders as Order[], (o) => o.status),
    countBy(b.orders as Order[], (o) => o.status)
  );
  const shipmentStatusDelta = mergedKeys(
    countBy(a.shipments as Shipment[], (s) => s.status),
    countBy(b.shipments as Shipment[], (s) => s.status)
  );

  return { rowCounts, schemaChanges, cartStatusDelta, orderStatusDelta, shipmentStatusDelta, hasSchemaChanges };
}

function pctChange(a: number, b: number): string {
  if (a === 0) return b === 0 ? "±0%" : "+∞%";
  const pct = ((b - a) / a) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

/** Render a DiffReport as a human-readable CLI report. */
export function formatDiffReport(report: DiffReport, labelA = "A", labelB = "B"): string {
  const lines: string[] = [];

  lines.push(`Row counts (${labelA} -> ${labelB}):`);
  for (const [table, { a, b, delta }] of Object.entries(report.rowCounts)) {
    lines.push(`  ${table.padEnd(20)} ${String(a).padStart(6)} -> ${String(b).padEnd(6)} (${delta >= 0 ? "+" : ""}${delta}, ${pctChange(a, b)})`);
  }

  lines.push("");
  lines.push("Schema drift (added/removed fields per table):");
  let anyDrift = false;
  for (const [table, { addedFields, removedFields }] of Object.entries(report.schemaChanges)) {
    if (addedFields.length === 0 && removedFields.length === 0) continue;
    anyDrift = true;
    if (addedFields.length > 0) lines.push(`  ${table}: + ${addedFields.join(", ")}`);
    if (removedFields.length > 0) lines.push(`  ${table}: - ${removedFields.join(", ")}`);
  }
  if (!anyDrift) lines.push("  (none)");

  const distributionSection = (title: string, delta: Record<string, { a: number; b: number }>) => {
    lines.push("");
    lines.push(`${title}:`);
    for (const [key, { a, b }] of Object.entries(delta)) {
      lines.push(`  ${key.padEnd(20)} ${String(a).padStart(6)} -> ${String(b).padEnd(6)} (${pctChange(a, b)})`);
    }
  };

  distributionSection("Cart status distribution", report.cartStatusDelta);
  distributionSection("Order status distribution", report.orderStatusDelta);
  distributionSection("Shipment status distribution", report.shipmentStatusDelta);

  return lines.join("\n");
}
