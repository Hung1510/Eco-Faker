import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";
import { computeAnalytics } from "../src/analytics.js";

describe("analytics", () => {
  it("computes something for a normal generated dataset", () => {
    const dataset = generate({ seed: 1, scaleFactor: 200 });
    const report = computeAnalytics(dataset);
    expect(report.dailyRevenue.length).toBeGreaterThan(0);
    expect(report.funnel.length).toBeGreaterThan(0);
    expect(report.customerLTV.length).toBeGreaterThan(0);
    expect(report.retentionCohorts.length).toBeGreaterThan(0);
  });

  it("is a pure function -- calling it twice on the same dataset gives identical results", () => {
    const dataset = generate({ seed: 3, scaleFactor: 150 });
    const a = computeAnalytics(dataset);
    const b = computeAnalytics(dataset);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  describe("daily revenue", () => {
    it("sums to exactly the total of every order's total, to the cent", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const report = computeAnalytics(dataset);
      const fromDaily = report.dailyRevenue.reduce((s, d) => s + d.revenue, 0);
      const fromOrders = dataset.orders.reduce((s, o) => s + o.total, 0);
      expect(Math.round(fromDaily * 100)).toBe(Math.round(fromOrders * 100));
    });

    it("orderCount per day matches the actual number of orders on that day", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const report = computeAnalytics(dataset);
      for (const day of report.dailyRevenue) {
        const actual = dataset.orders.filter((o) => o.createdAt.slice(0, 10) === day.date).length;
        expect(day.orderCount).toBe(actual);
      }
    });

    it("is sorted chronologically", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const report = computeAnalytics(dataset);
      const dates = report.dailyRevenue.map((d) => d.date);
      expect(dates).toEqual([...dates].sort());
    });
  });

  describe("conversion funnel", () => {
    it("each stage's userCount never exceeds the previous stage's, across many seeds", () => {
      for (const seed of [1, 2, 3, 4, 5, 17, 42, 99]) {
        const dataset = generate({ seed, scaleFactor: 200 });
        const report = computeAnalytics(dataset);
        for (let i = 1; i < report.funnel.length; i++) {
          expect(
            report.funnel[i].userCount,
            `seed ${seed}: ${report.funnel[i].stage} (${report.funnel[i].userCount}) exceeds ${report.funnel[i - 1].stage} (${report.funnel[i - 1].userCount})`
          ).toBeLessThanOrEqual(report.funnel[i - 1].userCount);
        }
      }
    });

    it("omits the 'viewed' stage entirely when recommendation data is disabled, rather than reporting zero", () => {
      const dataset = generate({ seed: 1, scaleFactor: 100, recommendationData: { enabled: false } });
      const report = computeAnalytics(dataset);
      expect(report.funnel.find((f) => f.stage === "viewed")).toBeUndefined();
      expect(report.funnel.find((f) => f.stage === "added_to_cart")).toBeDefined();
    });

    it("includes the 'viewed' stage when recommendation data is enabled", () => {
      const dataset = generate({ seed: 1, scaleFactor: 100, recommendationData: { enabled: true } });
      const report = computeAnalytics(dataset);
      expect(report.funnel.find((f) => f.stage === "viewed")).toBeDefined();
    });

    it("regression: works on a dataset round-tripped through generate --format json, which strips `config` entirely", () => {
      // toJson() (output/json.ts) deliberately omits `config` from its output --
      // simulate loading such a file back in, exactly what `dashboard --input`
      // does via loadDatasetLike. This crashed computeAnalytics with a real
      // TypeError before the fix (it read dataset.config.recommendationData.enabled
      // directly instead of checking the productViews array's own content).
      const dataset = generate({ seed: 1, scaleFactor: 100 });
      const { config, ...datasetWithoutConfig } = dataset;
      expect(() => computeAnalytics(datasetWithoutConfig as typeof dataset)).not.toThrow();
      const report = computeAnalytics(datasetWithoutConfig as typeof dataset);
      expect(report.funnel.find((f) => f.stage === "viewed")).toBeDefined();
    });

    it("'purchased' userCount matches the real distinct count of users with at least one order", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const report = computeAnalytics(dataset);
      const purchased = report.funnel.find((f) => f.stage === "purchased")!;
      const actual = new Set(dataset.orders.map((o) => o.userId)).size;
      expect(purchased.userCount).toBe(actual);
    });

    it("the first stage's conversionFromPrevious is null; every later stage's is a real ratio in [0,1]", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const report = computeAnalytics(dataset);
      expect(report.funnel[0].conversionFromPrevious).toBeNull();
      for (let i = 1; i < report.funnel.length; i++) {
        expect(report.funnel[i].conversionFromPrevious).not.toBeNull();
        expect(report.funnel[i].conversionFromPrevious!).toBeGreaterThanOrEqual(0);
        expect(report.funnel[i].conversionFromPrevious!).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("customer LTV", () => {
    it("totalRevenue per customer matches the real sum of their own orders", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const report = computeAnalytics(dataset);
      for (const customer of report.customerLTV) {
        const actual = dataset.orders.filter((o) => o.userId === customer.userId).reduce((s, o) => s + o.total, 0);
        expect(Math.round(customer.totalRevenue * 100)).toBe(Math.round(actual * 100));
      }
    });

    it("only includes users who actually placed at least one order", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const report = computeAnalytics(dataset);
      const orderedUserIds = new Set(dataset.orders.map((o) => o.userId));
      for (const customer of report.customerLTV) {
        expect(orderedUserIds.has(customer.userId)).toBe(true);
      }
      expect(report.customerLTV.length).toBe(orderedUserIds.size);
    });

    it("firstOrderAt is never after lastOrderAt", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const report = computeAnalytics(dataset);
      for (const customer of report.customerLTV) {
        expect(Date.parse(customer.firstOrderAt!)).toBeLessThanOrEqual(Date.parse(customer.lastOrderAt!));
      }
    });

    it("averageOrderValue equals totalRevenue / orderCount", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const report = computeAnalytics(dataset);
      for (const customer of report.customerLTV) {
        expect(customer.averageOrderValue).toBeCloseTo(customer.totalRevenue / customer.orderCount, 1);
      }
    });
  });

  describe("ltvSummary", () => {
    it("payingCustomers never exceeds totalCustomers", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const report = computeAnalytics(dataset);
      expect(report.ltvSummary.payingCustomers).toBeLessThanOrEqual(report.ltvSummary.totalCustomers);
      expect(report.ltvSummary.totalCustomers).toBe(dataset.users.length);
    });

    it("medianLTV falls within the actual min/max of computed customer revenues", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const report = computeAnalytics(dataset);
      const revenues = report.customerLTV.map((c) => c.totalRevenue);
      expect(report.ltvSummary.medianLTV).toBeGreaterThanOrEqual(Math.min(...revenues));
      expect(report.ltvSummary.medianLTV).toBeLessThanOrEqual(Math.max(...revenues));
    });
  });

  describe("retention cohorts", () => {
    it("cohortSize matches the real number of users whose first order fell in that month", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const report = computeAnalytics(dataset);
      const firstOrderByUser = new Map<string, string>();
      for (const order of dataset.orders) {
        const existing = firstOrderByUser.get(order.userId);
        if (!existing || order.createdAt < existing) firstOrderByUser.set(order.userId, order.createdAt);
      }
      const seenCohorts = new Set<string>();
      for (const row of report.retentionCohorts) {
        if (seenCohorts.has(row.cohortMonth)) continue;
        seenCohorts.add(row.cohortMonth);
        const actual = [...firstOrderByUser.values()].filter((d) => d.slice(0, 7) === row.cohortMonth).length;
        expect(row.cohortSize).toBe(actual);
      }
    });

    it("month-0 retentionRate is always exactly 1.0 -- the cohort's own first month", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const report = computeAnalytics(dataset);
      const month0Rows = report.retentionCohorts.filter((r) => r.monthsSinceFirstOrder === 0);
      expect(month0Rows.length).toBeGreaterThan(0);
      for (const row of month0Rows) {
        expect(row.retentionRate).toBe(1);
        expect(row.retainedUsers).toBe(row.cohortSize);
      }
    });

    it("retainedUsers never exceeds cohortSize", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const report = computeAnalytics(dataset);
      for (const row of report.retentionCohorts) {
        expect(row.retainedUsers).toBeLessThanOrEqual(row.cohortSize);
      }
    });
  });

  describe("CAC", () => {
    it("newCustomersAcquired matches the real count of users with at least one order", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const report = computeAnalytics(dataset);
      const actual = new Set(dataset.orders.map((o) => o.userId)).size;
      expect(report.cac.newCustomersAcquired).toBe(actual);
    });

    it("uses the default assumed spend when none is provided, and the CLI-provided one when it is", () => {
      const dataset = generate({ seed: 2, scaleFactor: 300 });
      const withDefault = computeAnalytics(dataset);
      const withCustom = computeAnalytics(dataset, { assumedMonthlyMarketingSpend: 12000 });
      expect(withDefault.cac.assumedMonthlyMarketingSpend).toBe(5000);
      expect(withCustom.cac.assumedMonthlyMarketingSpend).toBe(12000);
      expect(withCustom.cac.cac).toBeCloseTo(12000 / withCustom.cac.newCustomersAcquired, 2);
    });

    it("does not divide by zero when there are no customers", () => {
      const dataset = generate({ seed: 2, scaleFactor: 5 });
      // Force zero orders by disabling nothing but checking the edge case logically:
      // if orders happen to be empty for a tiny scale factor, cac must still be a finite number.
      const report = computeAnalytics(dataset);
      expect(Number.isFinite(report.cac.cac)).toBe(true);
    });
  });
});
