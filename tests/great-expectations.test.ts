import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";
import { generateGreatExpectationsSuites } from "../src/output/great-expectations.js";
import { datasetToCanonicalRows } from "../src/introspect/canonical-rows.js";

describe("Great Expectations export", () => {
  const dataset = generate({ seed: 1, scaleFactor: 200 });
  const suites = generateGreatExpectationsSuites(dataset);

  it("produces a suite for every table CANONICAL_COLUMNS knows about", () => {
    const rows = datasetToCanonicalRows(dataset);
    expect(Object.keys(suites).sort()).toEqual(Object.keys(rows).sort());
  });

  it("every suite matches the real Great Expectations JSON shape", () => {
    for (const [table, suite] of Object.entries(suites)) {
      expect(suite.expectation_suite_name).toBe(table);
      expect(suite.data_asset_type).toBe("Dataset");
      expect(suite.meta.great_expectations_version).toBeTypeOf("string");
      expect(Array.isArray(suite.expectations)).toBe(true);
      for (const exp of suite.expectations) {
        expect(exp).toHaveProperty("expectation_type");
        expect(exp).toHaveProperty("kwargs");
        expect(exp).toHaveProperty("meta");
      }
    }
  });

  it("expect_table_columns_to_match_ordered_list lists the real columns actually present, not a hardcoded list", () => {
    const rows = datasetToCanonicalRows(dataset);
    for (const [table, tableRows] of Object.entries(rows)) {
      const columnListExp = suites[table].expectations.find((e) => e.expectation_type === "expect_table_columns_to_match_ordered_list");
      if (tableRows.length === 0) {
        expect(columnListExp).toBeUndefined();
        continue;
      }
      expect(columnListExp?.kwargs.column_list).toEqual(Object.keys(tableRows[0]));
    }
  });

  it("expect_table_row_count_to_be_between's bounds equal the real row count", () => {
    const rows = datasetToCanonicalRows(dataset);
    for (const [table, tableRows] of Object.entries(rows)) {
      const rowCountExp = suites[table].expectations.find((e) => e.expectation_type === "expect_table_row_count_to_be_between");
      expect(rowCountExp?.kwargs.min_value).toBe(tableRows.length);
      expect(rowCountExp?.kwargs.max_value).toBe(tableRows.length);
    }
  });

  it("id columns get exists/not-null/unique/type expectations", () => {
    const orderColumnExpectations = suites.orders.expectations.filter((e) => e.kwargs.column === "id");
    const types = orderColumnExpectations.map((e) => e.expectation_type);
    expect(types).toContain("expect_column_to_exist");
    expect(types).toContain("expect_column_values_to_not_be_null");
    expect(types).toContain("expect_column_values_to_be_unique");
    expect(types).toContain("expect_column_values_to_be_of_type");
  });

  it("regression: a continuous float column (order total) never gets a uniqueness expectation, even if it happens to be unique in this sample", () => {
    // A money/measurement value being unique across a small real sample is
    // a statistical accident, not a business invariant -- unlike an
    // id/sku, nothing prevents two real orders from sharing a total. Use a
    // small dedicated dataset here (the shared 200-scale one above has
    // enough orders that totals start coincidentally colliding, which
    // would make this specific regression untestable against it).
    const small = generate({ seed: 1, scaleFactor: 20 });
    const rows = datasetToCanonicalRows(small).orders;
    const totals = rows.map((r) => r.total);
    const actuallyUniqueInThisSample = new Set(totals).size === totals.length;
    expect(actuallyUniqueInThisSample, "test setup assumption: totals should be unique in this sample for the regression to be meaningful").toBe(true);

    const smallSuites = generateGreatExpectationsSuites(small);
    const totalExpectations = smallSuites.orders.expectations.filter((e) => e.kwargs.column === "total").map((e) => e.expectation_type);
    expect(totalExpectations).not.toContain("expect_column_values_to_be_unique");
    expect(totalExpectations).toContain("expect_column_values_to_be_between");
  });

  it("expect_column_values_to_be_between's bounds are the real observed min/max, not a fabricated round number", () => {
    const rows = datasetToCanonicalRows(dataset).orders;
    const totals = rows.map((r) => r.total as number);
    const betweenExp = suites.orders.expectations.find((e) => e.expectation_type === "expect_column_values_to_be_between" && e.kwargs.column === "total");
    expect(betweenExp?.kwargs.min_value).toBe(Math.min(...totals));
    expect(betweenExp?.kwargs.max_value).toBe(Math.max(...totals));
  });

  it("a genuinely nullable column (support_tickets.resolvedAt for an unresolved ticket) gets no not-null expectation", () => {
    const rows = datasetToCanonicalRows(dataset).support_tickets;
    const hasNullResolvedAt = rows.some((r) => r.resolved_at === null || r.resolved_at === undefined);
    expect(hasNullResolvedAt, "test setup assumption: some ticket should be unresolved for this to be meaningful").toBe(true);

    const resolvedAtExpectations = suites.support_tickets.expectations.filter((e) => e.kwargs.column === "resolved_at").map((e) => e.expectation_type);
    expect(resolvedAtExpectations).not.toContain("expect_column_values_to_not_be_null");
    expect(resolvedAtExpectations).toContain("expect_column_to_exist"); // still documented as a real column, just not asserted non-null
  });

  it("an enum-like string column (order status) gets expect_column_values_to_be_in_set with the real distinct values", () => {
    const rows = datasetToCanonicalRows(dataset).orders;
    const realDistinctStatuses = Array.from(new Set(rows.map((r) => r.status))).sort();
    const inSetExp = suites.orders.expectations.find((e) => e.expectation_type === "expect_column_values_to_be_in_set" && e.kwargs.column === "status");
    expect(inSetExp?.kwargs.value_set).toEqual(realDistinctStatuses);
  });

  it("a near-unique string column (product sku) does NOT get expect_column_values_to_be_in_set", () => {
    const skuExpectations = suites.products.expectations.filter((e) => e.kwargs.column === "sku").map((e) => e.expectation_type);
    expect(skuExpectations).not.toContain("expect_column_values_to_be_in_set");
  });

  it("regression across multiple seeds: every emitted expectation's assertion is actually true of that seed's real data", () => {
    // The real point of this export is that every expectation should
    // PASS if run against the exact dataset it was generated from --
    // check that directly, across several seeds, rather than trusting
    // the generation logic to be self-consistent.
    for (const seed of [1, 2, 3, 4, 5]) {
      const ds = generate({ seed, scaleFactor: 150 });
      const rows = datasetToCanonicalRows(ds);
      const seedSuites = generateGreatExpectationsSuites(ds);
      for (const [table, tableRows] of Object.entries(rows)) {
        if (tableRows.length === 0) continue;
        for (const exp of seedSuites[table].expectations) {
          const column = exp.kwargs.column as string | undefined;
          if (!column) continue;
          const values = tableRows.map((r) => r[column]);
          const nonNull = values.filter((v) => v !== null && v !== undefined);

          if (exp.expectation_type === "expect_column_values_to_not_be_null") {
            expect(nonNull.length, `${table}.${column} not-null asserted but has a null (seed ${seed})`).toBe(values.length);
          }
          if (exp.expectation_type === "expect_column_values_to_be_unique") {
            expect(new Set(nonNull).size, `${table}.${column} uniqueness asserted but has a duplicate (seed ${seed})`).toBe(nonNull.length);
          }
          if (exp.expectation_type === "expect_column_values_to_be_between") {
            const nums = nonNull as number[];
            const { min_value, max_value } = exp.kwargs as { min_value: number; max_value: number };
            for (const n of nums) {
              expect(n, `${table}.${column}=${n} outside asserted [${min_value}, ${max_value}] (seed ${seed})`).toBeGreaterThanOrEqual(min_value);
              expect(n).toBeLessThanOrEqual(max_value);
            }
          }
          if (exp.expectation_type === "expect_column_values_to_be_in_set") {
            const valueSet = new Set(exp.kwargs.value_set as string[]);
            for (const v of nonNull as string[]) {
              expect(valueSet.has(v), `${table}.${column}="${v}" not in asserted value_set (seed ${seed})`).toBe(true);
            }
          }
        }
      }
    }
  });

  it("an empty table (no real rows generated) produces a suite with no column-list/column expectations, not fabricated ones", () => {
    const rows = datasetToCanonicalRows(dataset);
    const emptyTables = Object.entries(rows).filter(([, r]) => r.length === 0).map(([t]) => t);
    for (const table of emptyTables) {
      const columnListExp = suites[table].expectations.find((e) => e.expectation_type === "expect_table_columns_to_match_ordered_list");
      expect(columnListExp).toBeUndefined();
    }
  });
});
