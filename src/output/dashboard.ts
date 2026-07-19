import type { AnalyticsReport } from "../analytics.js";
import { tableToCsv } from "./csv.js";

/**
 * Returns one CSV per analytics table, keyed by filename -- the natural
 * shape for "PowerBI CSV export": PowerBI's Get Data > Text/CSV (and
 * Excel, and Google Sheets) import one file per table directly, there's
 * no PowerBI-specific binary format to target.
 */
export function analyticsToCsvFiles(report: AnalyticsReport): Record<string, string> {
  return {
    "daily_revenue.csv": tableToCsv(
      ["date", "revenue", "order_count"],
      ["date", "revenue", "order_count"],
      report.dailyRevenue.map((d) => ({ date: d.date, revenue: d.revenue, order_count: d.orderCount }))
    ),
    "funnel.csv": tableToCsv(
      ["stage", "user_count", "conversion_from_previous"],
      ["stage", "user_count", "conversion_from_previous"],
      report.funnel.map((f) => ({
        stage: f.stage,
        user_count: f.userCount,
        conversion_from_previous: f.conversionFromPrevious,
      }))
    ),
    "retention_cohorts.csv": tableToCsv(
      ["cohort_month", "cohort_size", "months_since_first_order", "retained_users", "retention_rate"],
      ["cohort_month", "cohort_size", "months_since_first_order", "retained_users", "retention_rate"],
      report.retentionCohorts.map((r) => ({
        cohort_month: r.cohortMonth,
        cohort_size: r.cohortSize,
        months_since_first_order: r.monthsSinceFirstOrder,
        retained_users: r.retainedUsers,
        retention_rate: r.retentionRate,
      }))
    ),
    "customer_ltv.csv": tableToCsv(
      ["user_id", "total_revenue", "order_count", "first_order_at", "last_order_at", "average_order_value"],
      ["user_id", "total_revenue", "order_count", "first_order_at", "last_order_at", "average_order_value"],
      report.customerLTV.map((c) => ({
        user_id: c.userId,
        total_revenue: c.totalRevenue,
        order_count: c.orderCount,
        first_order_at: c.firstOrderAt,
        last_order_at: c.lastOrderAt,
        average_order_value: c.averageOrderValue,
      }))
    ),
    "summary.csv": tableToCsv(
      ["metric", "value"],
      ["metric", "value"],
      [
        { metric: "total_customers", value: report.ltvSummary.totalCustomers },
        { metric: "paying_customers", value: report.ltvSummary.payingCustomers },
        { metric: "average_ltv", value: report.ltvSummary.averageLTV },
        { metric: "median_ltv", value: report.ltvSummary.medianLTV },
        { metric: "new_customers_acquired", value: report.cac.newCustomersAcquired },
        { metric: "assumed_monthly_marketing_spend", value: report.cac.assumedMonthlyMarketingSpend },
        { metric: "cac", value: report.cac.cac },
      ]
    ),
  };
}

/**
 * SQL is what actually seeds Metabase or Superset -- neither tool has a
 * native "seed file" import format of its own; both connect to a real
 * database (Postgres, in this repo's case, matching the rest of the SQL
 * output) and build questions/dashboards against whatever tables exist
 * there. This is that seed.
 */
export function analyticsToSql(report: AnalyticsReport): string {
  const parts: string[] = [];

  parts.push(
    `CREATE TABLE IF NOT EXISTS daily_revenue (\n  date DATE PRIMARY KEY,\n  revenue NUMERIC NOT NULL,\n  order_count INTEGER NOT NULL\n);`
  );
  parts.push(
    `CREATE TABLE IF NOT EXISTS funnel (\n  stage TEXT PRIMARY KEY,\n  user_count INTEGER NOT NULL,\n  conversion_from_previous NUMERIC\n);`
  );
  parts.push(
    `CREATE TABLE IF NOT EXISTS retention_cohorts (\n  cohort_month TEXT NOT NULL,\n  cohort_size INTEGER NOT NULL,\n  months_since_first_order INTEGER NOT NULL,\n  retained_users INTEGER NOT NULL,\n  retention_rate NUMERIC NOT NULL,\n  PRIMARY KEY (cohort_month, months_since_first_order)\n);`
  );
  parts.push(
    `CREATE TABLE IF NOT EXISTS customer_ltv (\n  user_id TEXT PRIMARY KEY,\n  total_revenue NUMERIC NOT NULL,\n  order_count INTEGER NOT NULL,\n  first_order_at TIMESTAMP,\n  last_order_at TIMESTAMP,\n  average_order_value NUMERIC NOT NULL\n);`
  );
  parts.push("");

  const sqlValue = (v: unknown): string => {
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "number") return String(v);
    return `'${String(v).replace(/'/g, "''")}'`;
  };
  const insert = (table: string, columns: string[], rows: unknown[][]): void => {
    if (rows.length === 0) return;
    for (const row of rows) {
      parts.push(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${row.map(sqlValue).join(", ")});`);
    }
    parts.push("");
  };

  insert(
    "daily_revenue",
    ["date", "revenue", "order_count"],
    report.dailyRevenue.map((d) => [d.date, d.revenue, d.orderCount])
  );
  insert(
    "funnel",
    ["stage", "user_count", "conversion_from_previous"],
    report.funnel.map((f) => [f.stage, f.userCount, f.conversionFromPrevious])
  );
  insert(
    "retention_cohorts",
    ["cohort_month", "cohort_size", "months_since_first_order", "retained_users", "retention_rate"],
    report.retentionCohorts.map((r) => [r.cohortMonth, r.cohortSize, r.monthsSinceFirstOrder, r.retainedUsers, r.retentionRate])
  );
  insert(
    "customer_ltv",
    ["user_id", "total_revenue", "order_count", "first_order_at", "last_order_at", "average_order_value"],
    report.customerLTV.map((c) => [c.userId, c.totalRevenue, c.orderCount, c.firstOrderAt, c.lastOrderAt, c.averageOrderValue])
  );

  return parts.join("\n");
}
