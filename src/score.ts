import { lintDataset, type LintIssue } from "./lint.js";
import { TABLE_ROUTES, type DatasetArrayKey } from "./serve.js";
import type { Dataset } from "./types.js";

export type ScoreDimensionName =
  | "referential_integrity"
  | "financial_consistency"
  | "temporal_plausibility"
  | "distribution_shape"
  | "uniqueness";

export interface ScoreDimension {
  name: ScoreDimensionName;
  /** 0-100, rounded to the nearest integer. */
  score: number;
  detail: string;
}

export interface RealismScore {
  /** 0-100, the unweighted average of the five dimensions below -- stated plainly: this is a simple mean, not a tuned/validated weighting, so treat the overall figure as a rough compass, not a certified grade. */
  overall: number;
  dimensions: ScoreDimension[];
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round0(n: number): number {
  return Math.round(n);
}

function countRecords(dataset: Dataset): number {
  let total = 0;
  for (const key of Object.values(TABLE_ROUTES) as DatasetArrayKey[]) {
    total += (dataset[key] as unknown as unknown[]).length;
  }
  return total;
}

function scoreFromRate(issueCount: number, denominator: number): number {
  if (denominator <= 0) return 100; // nothing to have gone wrong
  if (issueCount <= 0) return 100;
  // Floor, not round: rounding a rate like 100 * (1 - 1/13877) = 99.99...
  // to the nearest integer produces exactly 100 -- indistinguishable from
  // zero real issues, on a dataset with a large enough table that any
  // single violation rounds away. Flooring guarantees any nonzero issue
  // count always registers below 100, caught by a test that introduced
  // exactly one real orphaned FK against ~14k total records and got back
  // a 100 before this fix.
  return clamp(Math.floor(100 * (1 - issueCount / denominator)), 0, 99);
}

/**
 * Four of these five dimensions are `lintDataset`'s own existing rules,
 * reframed as a continuous 0-100 rate instead of a pass/fail list --
 * deliberately not a second, parallel implementation of "is this data
 * internally consistent," since `lintDataset` already is that check and
 * keeping it the single source of truth means the two can't drift apart.
 * `distribution_shape` is the one genuinely new dimension: whether
 * `orders.total` looks like a real retail order-value distribution
 * (long right tail, most orders small, a few large) rather than
 * suspiciously flat or uniform -- something `lintDataset` was never
 * designed to check, since "every individual order's math is right" and
 * "the *distribution* of order values looks real" are different claims.
 */
function scoreReferentialIntegrity(issuesByRule: Map<string, LintIssue[]>, totalRecords: number): ScoreDimension {
  const issues = issuesByRule.get("orphaned_foreign_key") ?? [];
  return {
    name: "referential_integrity",
    score: scoreFromRate(issues.length, totalRecords),
    detail: `${issues.length} orphaned foreign key(s) across ${totalRecords} total records`,
  };
}

function scoreUniqueness(issuesByRule: Map<string, LintIssue[]>, totalRecords: number): ScoreDimension {
  const duplicateIds = issuesByRule.get("duplicate_id") ?? [];
  const duplicateEmails = issuesByRule.get("duplicate_email") ?? [];
  const count = duplicateIds.length + duplicateEmails.length;
  return {
    name: "uniqueness",
    score: scoreFromRate(count, totalRecords),
    detail: `${duplicateIds.length} duplicate id(s), ${duplicateEmails.length} duplicate email group(s) across ${totalRecords} total records`,
  };
}

function scoreFinancialConsistency(issuesByRule: Map<string, LintIssue[]>, dataset: Dataset): ScoreDimension {
  const issues = issuesByRule.get("financial_mismatch") ?? [];
  return {
    name: "financial_consistency",
    score: scoreFromRate(issues.length, dataset.orders.length),
    detail: `${issues.length}/${dataset.orders.length} orders with a financial mismatch`,
  };
}

function scoreTemporalPlausibility(issuesByRule: Map<string, LintIssue[]>, dataset: Dataset): ScoreDimension {
  const issues = issuesByRule.get("temporal_paradox") ?? [];
  const denominator = dataset.returnRequests.length;
  return {
    name: "temporal_plausibility",
    score: scoreFromRate(issues.length, denominator),
    detail:
      denominator > 0
        ? `${issues.length}/${denominator} return requests dated before their own order`
        : "no return requests to check (vacuously consistent)",
  };
}

/** Fisher-Pearson adjusted skewness coefficient (population, not sample-corrected -- fine for a heuristic score, not a statistical inference claim). */
function skewness(values: number[]): number {
  const n = values.length;
  if (n < 3) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);
  if (stddev === 0) return 0;
  const cubedDeviations = values.reduce((a, b) => a + ((b - mean) / stddev) ** 3, 0) / n;
  return cubedDeviations;
}

function coefficientOfVariation(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (mean === 0) return 0;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return Math.sqrt(variance) / mean;
}

/**
 * Heuristic, not ground truth -- stated plainly rather than presented as a
 * validated statistical test. Two sub-checks, averaged: (a) order totals
 * actually vary meaningfully (coefficient of variation, reaching full
 * marks at cv >= 0.5 -- real order values vary a lot; a suspiciously flat
 * distribution scores low here regardless of its skew), and (b) the
 * distribution is right-skewed (skewness > 0 -- many small orders, a few
 * large ones, the shape real retail order-value distributions actually
 * have), not left-skewed or perfectly symmetric.
 */
function scoreDistributionShape(dataset: Dataset): ScoreDimension {
  const totals = dataset.orders.map((o) => o.total);
  if (totals.length < 3) {
    return { name: "distribution_shape", score: 100, detail: "too few orders to assess a distribution shape (vacuously fine)" };
  }
  const cv = coefficientOfVariation(totals);
  const skew = skewness(totals);
  const spreadScore = clamp(100 * (cv / 0.5), 0, 100);
  const skewScore = clamp(50 + skew * 30, 0, 100);
  const overall = round0((spreadScore + skewScore) / 2);
  return {
    name: "distribution_shape",
    score: overall,
    detail: `order-value coefficient of variation ${cv.toFixed(2)}, skewness ${skew.toFixed(2)} (real order-value distributions are typically right-skewed with meaningful spread)`,
  };
}

export function computeRealismScore(dataset: Dataset): RealismScore {
  const issues = lintDataset(dataset);
  const issuesByRule = new Map<string, LintIssue[]>();
  for (const issue of issues) {
    issuesByRule.set(issue.rule, [...(issuesByRule.get(issue.rule) ?? []), issue]);
  }
  const totalRecords = countRecords(dataset);

  const dimensions: ScoreDimension[] = [
    scoreReferentialIntegrity(issuesByRule, totalRecords),
    scoreFinancialConsistency(issuesByRule, dataset),
    scoreTemporalPlausibility(issuesByRule, dataset),
    scoreDistributionShape(dataset),
    scoreUniqueness(issuesByRule, totalRecords),
  ];

  const overall = round0(dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length);
  return { overall, dimensions };
}
