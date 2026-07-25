import type { Dataset } from "../../types.js";
import { datasetToCanonicalRows } from "../../introspect/canonical-rows.js";

type ChType = "String" | "Nullable(String)" | "Int64" | "Nullable(Int64)" | "Float64" | "Nullable(Float64)" | "UInt8" | "DateTime64(3)" | "Nullable(DateTime64(3))";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function inferColumnType(columnName: string, values: unknown[]): ChType {
  const nonNull = values.filter((v) => v !== null && v !== undefined);
  const nullable = nonNull.length < values.length;

  if (nonNull.length === 0) {
    // No data to infer from at all -- guess from the column name rather
    // than defaulting to String for what's likely a typed id/date/flag.
    if (columnName === "id" || columnName.endsWith("_id")) return nullable ? "Nullable(String)" : "String";
    if (columnName.endsWith("_at")) return "Nullable(DateTime64(3))";
    return "Nullable(String)";
  }

  const sample = nonNull[0];
  if (typeof sample === "boolean") return "UInt8"; // ClickHouse has no native boolean; UInt8 0/1 is the standard convention
  if (typeof sample === "number") {
    const allInts = nonNull.every((v) => typeof v === "number" && Number.isInteger(v));
    const base = allInts ? "Int64" : "Float64";
    return (nullable ? `Nullable(${base})` : base) as ChType;
  }
  if (typeof sample === "string" && ISO_DATE_RE.test(sample)) {
    return nullable ? "Nullable(DateTime64(3))" : "DateTime64(3)";
  }
  return nullable ? "Nullable(String)" : "String";
}

/**
 * ClickHouse DDL only -- deliberately not a second copy of the row data
 * in a new format. ClickHouse ingests the *existing* CSV output natively
 * (`clickhouse-client --query "INSERT INTO table FORMAT CSVWithNames" <
 * file.csv`), so reserializing every row a third time here would just be
 * duplicated, harder-to-keep-in-sync code for no real benefit -- the gap
 * this closes is the DDL dialect (types, `ENGINE = MergeTree()`, `ORDER
 * BY`), not the data itself.
 */
export function generateClickHouseDdl(dataset: Dataset): string {
  const canonicalRows = datasetToCanonicalRows(dataset);
  const parts: string[] = [];

  for (const [table, rows] of Object.entries(canonicalRows)) {
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    if (columns.length === 0) continue;

    const columnDefs = columns.map((col) => {
      const values = rows.map((r) => r[col]);
      return `    ${col} ${inferColumnType(col, values)}`;
    });

    // `id` is always the first canonical column across every table in this
    // dataset -- a real, checkable invariant (see CANONICAL_COLUMNS), so
    // ordering by it is a legitimate default rather than a guess.
    const orderByColumn = columns[0];

    parts.push(
      `CREATE TABLE IF NOT EXISTS ${table}\n(\n${columnDefs.join(",\n")}\n)\nENGINE = MergeTree()\nORDER BY (${orderByColumn});`
    );
  }

  return parts.join("\n\n");
}
