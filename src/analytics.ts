import type { Dataset } from "./types.js";

export interface DailyRevenue {
  date: string; // YYYY-MM-DD
  revenue: number;
  orderCount: number;
}

export interface FunnelStage {
  stage: "viewed" | "added_to_cart" | "checkout_started" | "purchased";
  userCount: number;
  /** Fraction of the *previous* stage's userCount that reached this stage. Null for the first stage. */
  conversionFromPrevious: number | null;
}

export interface RetentionCohort {
  /** YYYY-MM of the cohort's first order. */
  cohortMonth: string;
  cohortSize: number;
  monthsSinceFirstOrder: number;
  retainedUsers: number;
  retentionRate: number;
}

export interface CustomerLTV {
  userId: string;
  totalRevenue: number;
  orderCount: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  averageOrderValue: number;
}

export interface CACSummary {
  newCustomersAcquired: number;
  /**
   * Marketing spend is not a concept this dataset otherwise generates --
   * there's nothing elsewhere to derive it *from*, unlike every other
   * analytics figure here. This is a plain, explicitly-labeled
   * assumption (a CLI-configurable number, defaulting to a plausible
   * per-industry-segment figure), not a synthesized-but-hidden one.
   */
  assumedMonthlyMarketingSpend: number;
  cac: number;
}

export interface AnalyticsReport {
  dailyRevenue: DailyRevenue[];
  funnel: FunnelStage[];
  retentionCohorts: RetentionCohort[];
  customerLTV: CustomerLTV[];
  ltvSummary: {
    averageLTV: number;
    medianLTV: number;
    totalCustomers: number;
    payingCustomers: number;
  };
  cac: CACSummary;
}

export interface AnalyticsOptions {
  /** See CACSummary.assumedMonthlyMarketingSpend. Default: $50 per new customer, a commonly-cited mid-range e-commerce CAC benchmark. */
  assumedMonthlyMarketingSpend?: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function monthsBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
}

function computeDailyRevenue(dataset: Dataset): DailyRevenue[] {
  const byDay = new Map<string, { revenue: number; orderCount: number }>();
  for (const order of dataset.orders) {
    const key = dayKey(order.createdAt);
    const entry = byDay.get(key) ?? { revenue: 0, orderCount: 0 };
    entry.revenue += order.total;
    entry.orderCount += 1;
    byDay.set(key, entry);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, { revenue, orderCount }]) => ({ date, revenue: round2(revenue), orderCount }));
}

/**
 * "viewed" only reflects real distinct-user counts when recommendation
 * data actually exists in this dataset. Deliberately checked via the
 * `productViews` array's own content rather than
 * `dataset.config.recommendationData.enabled` -- `config` is excluded
 * from `generate --format json` output (see output/json.ts), so a
 * dataset loaded back in via `--input` may have no `config` at all.
 * Checking the array directly is correct regardless of how the dataset
 * arrived, and doesn't assume config metadata survived a round trip.
 */
function computeFunnel(dataset: Dataset): FunnelStage[] {
  const stages: { stage: FunnelStage["stage"]; users: Set<string> }[] = [];

  if (dataset.productViews && dataset.productViews.length > 0) {
    stages.push({ stage: "viewed", users: new Set(dataset.productViews.map((v) => v.userId)) });
  }
  stages.push({ stage: "added_to_cart", users: new Set(dataset.carts.map((c) => c.userId)) });
  stages.push({
    stage: "checkout_started",
    users: new Set([
      ...dataset.abandonedCheckouts.map((c) => c.userId),
      ...dataset.orders.map((o) => o.userId),
    ]),
  });
  stages.push({ stage: "purchased", users: new Set(dataset.orders.map((o) => o.userId)) });

  return stages.map((s, i) => ({
    stage: s.stage,
    userCount: s.users.size,
    conversionFromPrevious: i === 0 ? null : stages[i - 1].users.size === 0 ? 0 : round2(s.users.size / stages[i - 1].users.size),
  }));
}

function computeCustomerLTV(dataset: Dataset): CustomerLTV[] {
  const byUser = new Map<string, { revenue: number; orderCount: number; first: string; last: string }>();
  for (const order of dataset.orders) {
    const entry = byUser.get(order.userId);
    if (!entry) {
      byUser.set(order.userId, { revenue: order.total, orderCount: 1, first: order.createdAt, last: order.createdAt });
    } else {
      entry.revenue += order.total;
      entry.orderCount += 1;
      if (order.createdAt < entry.first) entry.first = order.createdAt;
      if (order.createdAt > entry.last) entry.last = order.createdAt;
    }
  }
  return [...byUser.entries()].map(([userId, e]) => ({
    userId,
    totalRevenue: round2(e.revenue),
    orderCount: e.orderCount,
    firstOrderAt: e.first,
    lastOrderAt: e.last,
    averageOrderValue: round2(e.revenue / e.orderCount),
  }));
}

function computeRetentionCohorts(dataset: Dataset): RetentionCohort[] {
  // First order date per user.
  const firstOrderByUser = new Map<string, string>();
  const ordersByUser = new Map<string, string[]>();
  for (const order of dataset.orders) {
    const existing = firstOrderByUser.get(order.userId);
    if (!existing || order.createdAt < existing) firstOrderByUser.set(order.userId, order.createdAt);
    const list = ordersByUser.get(order.userId) ?? [];
    list.push(order.createdAt);
    ordersByUser.set(order.userId, list);
  }

  // Group users into cohorts by the month of their first order.
  const cohortUsers = new Map<string, string[]>();
  for (const [userId, firstOrderAt] of firstOrderByUser) {
    const cohort = monthKey(firstOrderAt);
    const list = cohortUsers.get(cohort) ?? [];
    list.push(userId);
    cohortUsers.set(cohort, list);
  }

  const rows: RetentionCohort[] = [];
  for (const [cohortMonth, users] of [...cohortUsers.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const cohortSize = users.length;
    // How many months of relative retention data we can meaningfully report
    // depends on how much history exists after this cohort's first month.
    const maxMonthsSince = Math.max(
      0,
      ...users.map((u) => monthsBetween(cohortMonth + "-01", ordersByUser.get(u)!.slice(-1)[0]))
    );
    for (let m = 0; m <= maxMonthsSince; m++) {
      const retained = users.filter((u) =>
        ordersByUser.get(u)!.some((orderDate) => monthsBetween(firstOrderByUser.get(u)!, orderDate) === m)
      ).length;
      rows.push({
        cohortMonth,
        cohortSize,
        monthsSinceFirstOrder: m,
        retainedUsers: retained,
        retentionRate: round2(retained / cohortSize),
      });
    }
  }
  return rows;
}

function computeCAC(dataset: Dataset, ltv: CustomerLTV[], assumedMonthlyMarketingSpend: number): CACSummary {
  // "New customers acquired" -- everyone whose first order falls within
  // this dataset's own historical window, i.e. everyone with at least one
  // order (a real, computed count, not an assumption).
  const newCustomersAcquired = ltv.length;
  const cac = newCustomersAcquired === 0 ? 0 : round2(assumedMonthlyMarketingSpend / newCustomersAcquired);
  return { newCustomersAcquired, assumedMonthlyMarketingSpend, cac };
}

export function computeAnalytics(dataset: Dataset, options: AnalyticsOptions = {}): AnalyticsReport {
  const customerLTV = computeCustomerLTV(dataset);
  const revenues = customerLTV.map((c) => c.totalRevenue).sort((a, b) => a - b);
  const averageLTV = revenues.length === 0 ? 0 : round2(revenues.reduce((s, r) => s + r, 0) / revenues.length);
  const medianLTV =
    revenues.length === 0
      ? 0
      : revenues.length % 2 === 1
      ? revenues[(revenues.length - 1) / 2]
      : round2((revenues[revenues.length / 2 - 1] + revenues[revenues.length / 2]) / 2);

  // A flat, clearly-arbitrary default budget assumption -- not scaled by
  // the number of customers acquired, since scaling it that way would
  // make CAC trivially constant regardless of what the dataset actually
  // shows. Override with a real number via --marketing-spend.
  const assumedMonthlyMarketingSpend = options.assumedMonthlyMarketingSpend ?? 5000;

  return {
    dailyRevenue: computeDailyRevenue(dataset),
    funnel: computeFunnel(dataset),
    retentionCohorts: computeRetentionCohorts(dataset),
    customerLTV,
    ltvSummary: {
      averageLTV,
      medianLTV,
      totalCustomers: dataset.users.length,
      payingCustomers: customerLTV.length,
    },
    cac: computeCAC(dataset, customerLTV, assumedMonthlyMarketingSpend),
  };
}
