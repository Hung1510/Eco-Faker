import type { Dataset } from "../../types.js";
import { datasetToCanonicalRows } from "../../introspect/canonical-rows.js";

export type EsFieldType = "keyword" | "text" | "long" | "double" | "boolean" | "date";

export interface EsMapping {
  mappings: { properties: Record<string, { type: EsFieldType }> };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function inferFieldType(columnName: string, values: unknown[]): EsFieldType {
  const nonNull = values.filter((v) => v !== null && v !== undefined);
  if (nonNull.length === 0) {
    // No sample to infer from -- fall back to a column-name heuristic
    // rather than guessing "text" for what's very likely an id/date field.
    if (columnName === "id" || columnName.endsWith("_id")) return "keyword";
    if (columnName.endsWith("_at")) return "date";
    return "keyword";
  }
  const sample = nonNull[0];
  if (typeof sample === "boolean") return "boolean";
  if (typeof sample === "number") {
    // Checked across *every* sampled value, not just the first -- a
    // column that happens to sample a whole number first (shipping cost
    // of exactly $0 or $10, say) can still hold fractional values
    // elsewhere in the same dataset, and mapping it "long" would reject
    // or truncate those on real ingestion.
    const allInts = nonNull.every((v) => typeof v === "number" && Number.isInteger(v));
    return allInts ? "long" : "double";
  }
  if (typeof sample === "string") {
    if (ISO_DATE_RE.test(sample)) return "date";
    // Long/free-text fields (line items, addresses, review text) got
    // JSON-stringified by datasetToCanonicalRows -- keep those as
    // full-text-searchable "text" rather than an exact-match "keyword",
    // since nobody filters a shipping address by exact string equality.
    return sample.length > 256 ? "text" : "keyword";
  }
  return "keyword";
}

/**
 * One ES index mapping per table, with field types inferred from the
 * first non-null value seen for each column across the actual generated
 * rows (not just the first row, in case it happens to have a null in a
 * field that's populated elsewhere -- receivedAt on a "delayed"
 * replenishment order, for instance).
 */
export function generateElasticsearchMappings(dataset: Dataset): Record<string, EsMapping> {
  const canonicalRows = datasetToCanonicalRows(dataset);
  const mappings: Record<string, EsMapping> = {};

  for (const [table, rows] of Object.entries(canonicalRows)) {
    const properties: Record<string, { type: EsFieldType }> = {};
    if (rows.length === 0) {
      mappings[table] = { mappings: { properties } };
      continue;
    }
    const columns = Object.keys(rows[0]);
    for (const col of columns) {
      properties[col] = { type: inferFieldType(col, rows.map((r) => r[col])) };
    }
    mappings[table] = { mappings: { properties } };
  }

  return mappings;
}

/**
 * Real Elasticsearch Bulk API NDJSON: alternating action-metadata line
 * and document line, one pair per row, index name suffixed the same way
 * the mappings are keyed. This is the actual wire format the `_bulk`
 * endpoint (or `POST /_bulk`) expects -- not a stand-in.
 */
export function generateElasticsearchBulkNdjson(dataset: Dataset, indexPrefix = "eco-faker"): Record<string, string> {
  const canonicalRows = datasetToCanonicalRows(dataset);
  const files: Record<string, string> = {};

  for (const [table, rows] of Object.entries(canonicalRows)) {
    if (rows.length === 0) {
      files[table] = "";
      continue;
    }
    const indexName = `${indexPrefix}-${table.replace(/_/g, "-")}`;
    const lines: string[] = [];
    for (const row of rows) {
      lines.push(JSON.stringify({ index: { _index: indexName, _id: row.id } }));
      lines.push(JSON.stringify(row));
    }
    files[table] = lines.join("\n") + "\n";
  }

  return files;
}
