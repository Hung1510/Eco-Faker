import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";
import { generateClickHouseDdl } from "../src/output/benchmark/clickhouse.js";
import { datasetToCanonicalRows } from "../src/introspect/canonical-rows.js";

describe("ClickHouse DDL export", () => {
  const dataset = generate({ seed: 1, scaleFactor: 200 });
  const ddl = generateClickHouseDdl(dataset);
  const statements = ddl.split("\n\n");

  it("produces one CREATE TABLE statement per non-empty table", () => {
    const rows = datasetToCanonicalRows(dataset);
    const nonEmptyTables = Object.entries(rows).filter(([, r]) => r.length > 0).length;
    expect(statements.length).toBe(nonEmptyTables);
  });

  it("every statement uses ENGINE = MergeTree() and orders by the table's id column", () => {
    for (const stmt of statements) {
      expect(stmt).toContain("ENGINE = MergeTree()");
      expect(stmt).toMatch(/ORDER BY \(id\);$/);
    }
  });

  it("every statement is a syntactically balanced CREATE TABLE (matching parens, terminating semicolon)", () => {
    for (const stmt of statements) {
      expect(stmt.startsWith("CREATE TABLE IF NOT EXISTS")).toBe(true);
      expect(stmt.trim().endsWith(";")).toBe(true);
      expect((stmt.match(/\(/g) ?? []).length).toBe((stmt.match(/\)/g) ?? []).length);
    }
  });

  it("a numeric column is only typed Int64 if every real value in that column is an integer", () => {
    const rows = datasetToCanonicalRows(dataset);
    for (const [table, tableRows] of Object.entries(rows)) {
      if (tableRows.length === 0) continue;
      const stmt = statements.find((s) => s.startsWith(`CREATE TABLE IF NOT EXISTS ${table}\n`));
      expect(stmt).toBeDefined();
      for (const col of Object.keys(tableRows[0])) {
        const isInt64 = new RegExp(`\\b${col} Int64,`).test(stmt! + ",") || stmt!.includes(`${col} Int64\n`);
        if (!isInt64) continue;
        for (const row of tableRows) {
          const v = row[col];
          if (v !== null && v !== undefined) {
            expect(typeof v === "number" && Number.isInteger(v), `${table}.${col} typed Int64 but has value ${v}`).toBe(true);
          }
        }
      }
    }
  });

  it("a column with any decimal value (e.g. orders.shipping) is typed Float64, not Int64", () => {
    const ordersStmt = statements.find((s) => s.startsWith("CREATE TABLE IF NOT EXISTS orders\n"))!;
    expect(ordersStmt).toMatch(/shipping (Nullable\(Float64\)|Float64)/);
  });

  it("a column that's sometimes null (received_at) is wrapped in Nullable(...)", () => {
    const replenishmentStmt = statements.find((s) => s.startsWith("CREATE TABLE IF NOT EXISTS replenishment_orders\n"))!;
    expect(replenishmentStmt).toMatch(/received_at Nullable\(DateTime64\(3\)\)/);
  });

  it("a *_at column with a real ISO timestamp is typed DateTime64(3)", () => {
    const ordersStmt = statements.find((s) => s.startsWith("CREATE TABLE IF NOT EXISTS orders\n"))!;
    expect(ordersStmt).toMatch(/created_at DateTime64\(3\)/);
  });

  it("does not emit a statement for a table with zero rows", () => {
    const rows = datasetToCanonicalRows(dataset);
    const emptyTables = Object.entries(rows).filter(([, r]) => r.length === 0).map(([t]) => t);
    for (const table of emptyTables) {
      expect(ddl.includes(`CREATE TABLE IF NOT EXISTS ${table}\n`)).toBe(false);
    }
  });
});
