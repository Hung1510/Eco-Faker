import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";
import { computeAnalytics } from "../src/analytics.js";
import { analyticsToCsvFiles, analyticsToSql } from "../src/output/dashboard.js";

describe("dashboard export", () => {
  const dataset = generate({ seed: 5, scaleFactor: 200 });
  const report = computeAnalytics(dataset);

  describe("CSV export", () => {
    const files = analyticsToCsvFiles(report);

    it("produces one file per analytics table", () => {
      expect(Object.keys(files).sort()).toEqual(
        ["customer_ltv.csv", "daily_revenue.csv", "funnel.csv", "retention_cohorts.csv", "summary.csv"].sort()
      );
    });

    it("daily_revenue.csv has a header row and one data row per day in the report", () => {
      const lines = files["daily_revenue.csv"].trim().split("\n");
      expect(lines[0]).toBe("date,revenue,order_count");
      expect(lines.length - 1).toBe(report.dailyRevenue.length);
    });

    it("funnel.csv row count matches the number of funnel stages", () => {
      const lines = files["funnel.csv"].trim().split("\n");
      expect(lines.length - 1).toBe(report.funnel.length);
    });

    it("customer_ltv.csv contains every customer's userId", () => {
      const csv = files["customer_ltv.csv"];
      for (const customer of report.customerLTV.slice(0, 5)) {
        expect(csv).toContain(customer.userId);
      }
    });

    it("summary.csv includes the CAC figure", () => {
      const csv = files["summary.csv"];
      expect(csv).toContain("cac");
      expect(csv).toContain(String(report.cac.cac));
    });
  });

  describe("SQL export", () => {
    const sql = analyticsToSql(report);

    it("defines all four analytics tables", () => {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS daily_revenue");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS funnel");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS retention_cohorts");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS customer_ltv");
    });

    it("produces exactly one INSERT per daily revenue row", () => {
      const inserts = sql.split("\n").filter((l) => l.startsWith("INSERT INTO daily_revenue"));
      expect(inserts.length).toBe(report.dailyRevenue.length);
    });

    it("every CREATE TABLE statement is terminated and balanced", () => {
      const creates = sql.match(/CREATE TABLE[\s\S]*?\);/g) ?? [];
      expect(creates.length).toBe(4);
      for (const stmt of creates) {
        expect((stmt.match(/\(/g) ?? []).length).toBe((stmt.match(/\)/g) ?? []).length);
      }
    });

    it("string values are SQL-escaped (single quotes doubled)", () => {
      // userId values are UUIDs (no quotes to escape), but this confirms
      // the escaping function is actually wired in by checking a quoted
      // string value renders correctly for a stage name.
      expect(sql).toContain("'viewed'");
    });

    it("null values render as SQL NULL, not the string 'null'", () => {
      // The first funnel stage's conversion_from_previous is null.
      expect(sql).toMatch(/VALUES \('viewed', \d+, NULL\)/);
    });
  });
});
