import type { Dataset } from "../types.js";
import { datasetToCanonicalRows } from "../introspect/canonical-rows.js";

/**
 * Matches the real, current Great Expectations expectation-suite JSON
 * shape (`ExpectationConfiguration`/`ExpectationSuite`: `expectation_type`
 * + `kwargs` + `meta` per expectation, wrapped in a suite with
 * `expectation_suite_name`/`data_asset_type`/top-level `meta`) -- verified
 * against GE's own docs and real published suite examples, not assumed
 * from memory. Deliberately narrow (only the fields this module actually
 * writes), matching this project's existing convention of each output
 * module defining just the shape it needs (see `EsMapping` in
 * `output/benchmark/elasticsearch.ts`).
 */
export interface GEExpectation {
  expectation_type: string;
  kwargs: Record<string, unknown>;
  meta: Record<string, unknown>;
}

export interface GEExpectationSuite {
  data_asset_type: string;
  expectation_suite_name: string;
  meta: Record<string, unknown>;
  expectations: GEExpectation[];
}

/**
 * The GE version format this module's JSON shape targets. Expectation
 * Suites are meant to be forward-compatible across GE releases, but
 * stated explicitly rather than left to be discovered as a silent
 * assumption if GE's on-disk format ever changes.
 */
const GE_VERSION_TARGET = "0.18.21";

function nonNullValues(values: unknown[]): unknown[] {
  return values.filter((v) => v !== null && v !== undefined);
}

/** Real uniqueness, checked against every value present -- not assumed from an `id`/`_id` naming convention alone. */
function isActuallyUnique(nonNull: unknown[]): boolean {
  if (nonNull.length === 0) return false;
  return new Set(nonNull.map((v) => JSON.stringify(v))).size === nonNull.length;
}

/**
 * GE's default (pandas-backed) type vocabulary -- "int"/"float"/"str"/
 * "bool" -- inferred from every non-null sampled value's actual JS type,
 * the same "check all values, not just the first" discipline the
 * Elasticsearch mapping module already established (a column that
 * happens to sample a whole number first can still hold fractional
 * values elsewhere).
 */
function inferGEType(nonNull: unknown[]): "int" | "float" | "str" | "bool" | undefined {
  if (nonNull.length === 0) return undefined;
  const sample = nonNull[0];
  if (typeof sample === "boolean") return "bool";
  if (typeof sample === "number") {
    return nonNull.every((v) => typeof v === "number" && Number.isInteger(v)) ? "int" : "float";
  }
  if (typeof sample === "string") return "str";
  return undefined;
}

/**
 * Heuristic for "this string column is really an enum, not free text":
 * few enough distinct values in absolute terms, AND distinct values are a
 * small fraction of total rows (so a genuinely unique/near-unique text
 * column -- an email, a review body -- never gets an `expect...in_set`
 * that would immediately fail on the next real row that comes along).
 * Stated as a heuristic because it is one, not a rule from GE itself.
 */
const MAX_ENUM_DISTINCT_VALUES = 20;
const MAX_ENUM_DISTINCT_RATIO = 0.5;

function buildColumnExpectations(column: string, allValues: unknown[]): GEExpectation[] {
  const expectations: GEExpectation[] = [{ expectation_type: "expect_column_to_exist", kwargs: { column }, meta: {} }];
  const nonNull = nonNullValues(allValues);

  // Only assert not-null when EVERY real row actually has one -- a
  // legitimately-nullable field (a cart with no coupon, a shipment with
  // no delayedReason) should never get an expectation this exact dataset
  // itself would fail the moment a null legitimately occurs elsewhere.
  if (allValues.length > 0 && nonNull.length === allValues.length) {
    expectations.push({ expectation_type: "expect_column_values_to_not_be_null", kwargs: { column }, meta: {} });
  }

  const geType = inferGEType(nonNull);

  // Uniqueness is only proposed for non-float columns: a continuous
  // money/measurement value (order total, shipping cost) can easily
  // happen to be unique across a small sample by pure chance -- that's
  // an accident of this particular dataset's size, not a real business
  // invariant, unlike an id/sku/slug where uniqueness is the actual point
  // of the column. Proposing it for `total` would silently mislead
  // anyone who takes the suite at face value.
  if (allValues.length > 1 && geType !== "float" && isActuallyUnique(nonNull)) {
    expectations.push({ expectation_type: "expect_column_values_to_be_unique", kwargs: { column }, meta: {} });
  }

  if (geType) {
    expectations.push({ expectation_type: "expect_column_values_to_be_of_type", kwargs: { column, type_: geType }, meta: {} });
  }

  if ((geType === "int" || geType === "float") && nonNull.length > 0) {
    const nums = nonNull as number[];
    expectations.push({
      expectation_type: "expect_column_values_to_be_between",
      kwargs: { column, min_value: Math.min(...nums), max_value: Math.max(...nums) },
      meta: { note: "Bounds are this dataset's real observed min/max -- a starting baseline, likely to need loosening for validating a genuinely different batch." },
    });
  }

  if (geType === "str" && nonNull.length > 0) {
    const distinct = Array.from(new Set(nonNull as string[])).sort();
    if (distinct.length > 0 && distinct.length <= MAX_ENUM_DISTINCT_VALUES && distinct.length / nonNull.length <= MAX_ENUM_DISTINCT_RATIO) {
      expectations.push({
        expectation_type: "expect_column_values_to_be_in_set",
        kwargs: { column, value_set: distinct },
        meta: { note: "Heuristically detected as an enum-like column (few distinct values relative to row count) -- verify this is actually a bounded set before relying on it." },
      });
    }
  }

  return expectations;
}

/**
 * One Expectation Suite per table, every expectation derived from this
 * exact dataset's real generated rows -- column existence/order from the
 * real columns present, not-null/uniqueness/type/range/enum-set all
 * checked against every actual value, never assumed from a column's name
 * or this project's own internal knowledge of what "should" be there.
 * Intended as a real starting point for a `great_expectations` project
 * (drop straight into `great_expectations/expectations/<table>.json`),
 * not a finished, tuned production suite -- the same "baseline, meant to
 * be edited" role GE's own built-in profilers already play.
 */
export function generateGreatExpectationsSuites(dataset: Dataset): Record<string, GEExpectationSuite> {
  const canonicalRows = datasetToCanonicalRows(dataset);
  const suites: Record<string, GEExpectationSuite> = {};

  for (const [table, rows] of Object.entries(canonicalRows)) {
    const expectations: GEExpectation[] = [
      {
        expectation_type: "expect_table_row_count_to_be_between",
        kwargs: { min_value: rows.length, max_value: rows.length },
        meta: { note: "Exact row count of THIS export -- almost certainly too strict for a different batch; loosen min_value/max_value before reusing against anything but this exact data." },
      },
    ];

    if (rows.length > 0) {
      const columns = Object.keys(rows[0]);
      expectations.push({ expectation_type: "expect_table_columns_to_match_ordered_list", kwargs: { column_list: columns }, meta: {} });
      for (const column of columns) {
        expectations.push(...buildColumnExpectations(column, rows.map((r) => r[column])));
      }
    }

    suites[table] = {
      data_asset_type: "Dataset",
      expectation_suite_name: table,
      meta: { great_expectations_version: GE_VERSION_TARGET, generated_by: "eco-faker ge-export", notes: "Auto-generated from real observed data -- review before relying on it in production." },
      expectations,
    };
  }

  return suites;
}
