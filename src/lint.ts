import type { Dataset } from "./types.js";
import { TABLE_ROUTES, type DatasetArrayKey } from "./serve.js";

export type LintSeverity = "error" | "warning";

export interface LintIssue {
  severity: LintSeverity;
  /** Short machine-readable rule id, e.g. "orphaned_foreign_key", "financial_mismatch". */
  rule: string;
  table: DatasetArrayKey;
  recordId?: string;
  message: string;
}

const CENTS_TOLERANCE = 0.01;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Flags duplicate ids within a single table -- a stand-in for a real PRIMARY KEY/UNIQUE constraint. */
function lintDuplicateIds(dataset: Dataset, issues: LintIssue[]): void {
  for (const [, key] of Object.entries(TABLE_ROUTES) as [string, DatasetArrayKey][]) {
    const rows = dataset[key] as unknown as { id: string }[];
    const seen = new Map<string, number>();
    for (const row of rows) seen.set(row.id, (seen.get(row.id) ?? 0) + 1);
    for (const [id, count] of seen) {
      if (count > 1) {
        issues.push({
          severity: "error",
          rule: "duplicate_id",
          table: key,
          recordId: id,
          message: `id "${id}" appears ${count} times in ${key} -- would violate a PRIMARY KEY/UNIQUE constraint.`,
        });
      }
    }
  }
}

/** Flags duplicate user emails -- a common real-world UNIQUE constraint that plain type validation won't catch. */
function lintDuplicateEmails(dataset: Dataset, issues: LintIssue[]): void {
  const seen = new Map<string, string[]>();
  for (const user of dataset.users) {
    const email = user.email.toLowerCase();
    seen.set(email, [...(seen.get(email) ?? []), user.id]);
  }
  for (const [email, ids] of seen) {
    if (ids.length > 1) {
      issues.push({
        severity: "error",
        rule: "duplicate_email",
        table: "users",
        recordId: ids.join(", "),
        message: `email "${email}" is shared by ${ids.length} users (${ids.join(", ")}) -- would violate a UNIQUE constraint.`,
      });
    }
  }
}

/** Flags rows whose foreign key doesn't resolve to a real parent record. */
function lintOrphanedForeignKeys(dataset: Dataset, issues: LintIssue[]): void {
  const userIds = new Set(dataset.users.map((u) => u.id));
  const cartIds = new Set(dataset.carts.map((c) => c.id));
  const orderIds = new Set(dataset.orders.map((o) => o.id));

  const check = (table: DatasetArrayKey, recordId: string, field: string, value: string, validSet: Set<string>) => {
    if (!validSet.has(value)) {
      issues.push({
        severity: "error",
        rule: "orphaned_foreign_key",
        table,
        recordId,
        message: `${table}/${recordId}.${field} = "${value}" does not match any existing record -- would violate a FOREIGN KEY constraint.`,
      });
    }
  };

  for (const cart of dataset.carts) check("carts", cart.id, "userId", cart.userId, userIds);
  for (const checkout of dataset.abandonedCheckouts) {
    check("abandonedCheckouts", checkout.id, "userId", checkout.userId, userIds);
    check("abandonedCheckouts", checkout.id, "cartId", checkout.cartId, cartIds);
  }
  for (const order of dataset.orders) {
    check("orders", order.id, "userId", order.userId, userIds);
    check("orders", order.id, "cartId", order.cartId, cartIds);
  }
  for (const shipment of dataset.shipments) check("shipments", shipment.id, "orderId", shipment.orderId, orderIds);
  for (const ret of dataset.returnRequests) {
    check("returnRequests", ret.id, "userId", ret.userId, userIds);
    check("returnRequests", ret.id, "orderId", ret.orderId, orderIds);
  }
}

/**
 * Flags orders whose totals don't add up -- either a line item's lineTotal
 * doesn't equal unitPrice*quantity, or subtotal/tax/shipping don't sum to
 * total. This is the check that catches `price_inversion` and
 * `inventory_oversell` semantic-fuzz mutations (see `fuzz.ts`): both
 * deliberately leave an order's totals stale after mutating a line item, so
 * running `lint` on a fuzzed dataset is a quick way to see the linter catch
 * exactly the inconsistency the fuzzer introduced.
 */
function lintFinancialConsistency(dataset: Dataset, issues: LintIssue[]): void {
  for (const order of dataset.orders) {
    for (const item of order.items) {
      const expected = round2(item.unitPrice * item.quantity);
      if (Math.abs(expected - item.lineTotal) > CENTS_TOLERANCE) {
        issues.push({
          severity: "error",
          rule: "financial_mismatch",
          table: "orders",
          recordId: order.id,
          message: `line item "${item.name}" (sku ${item.sku}): lineTotal ${item.lineTotal} does not equal unitPrice (${item.unitPrice}) * quantity (${item.quantity}) = ${expected}.`,
        });
      }
    }
    const itemsSum = round2(order.items.reduce((sum, item) => sum + item.lineTotal, 0));
    if (Math.abs(itemsSum - order.subtotal) > CENTS_TOLERANCE) {
      issues.push({
        severity: "error",
        rule: "financial_mismatch",
        table: "orders",
        recordId: order.id,
        message: `subtotal ${order.subtotal} does not equal the sum of line item totals (${itemsSum}).`,
      });
    }
    const expectedTotal = round2(order.subtotal + order.tax + order.shipping);
    if (Math.abs(expectedTotal - order.total) > CENTS_TOLERANCE) {
      issues.push({
        severity: "error",
        rule: "financial_mismatch",
        table: "orders",
        recordId: order.id,
        message: `total ${order.total} does not equal subtotal + tax + shipping (${expectedTotal}).`,
      });
    }
  }
}

/** Flags a return request dated before the order it belongs to -- catches `time_paradox` fuzz mutations. */
function lintTemporalOrdering(dataset: Dataset, issues: LintIssue[]): void {
  const ordersById = new Map(dataset.orders.map((o) => [o.id, o]));
  for (const ret of dataset.returnRequests) {
    const order = ordersById.get(ret.orderId);
    if (!order) continue; // already reported by lintOrphanedForeignKeys
    if (Date.parse(ret.requestedAt) < Date.parse(order.createdAt)) {
      issues.push({
        severity: "error",
        rule: "temporal_paradox",
        table: "returnRequests",
        recordId: ret.id,
        message: `requestedAt (${ret.requestedAt}) is before the order it returns was created (${order.createdAt}).`,
      });
    }
  }
}

/**
 * Offline "pre-flight" data quality gate -- runs entirely in memory against
 * an already-generated (or already-fuzzed) `Dataset`, no database required.
 * Checks referential integrity (foreign keys), uniqueness (ids, emails),
 * and financial consistency (line items summing to totals) -- the same
 * class of thing a real `BEGIN; ...; ROLLBACK;` dry run against Postgres
 * would catch, but without needing a live database to run in CI.
 *
 * For an actual transactional dry run against real SQL and a real Postgres
 * instance, see `lintSqlAgainstDatabase` -- that mode requires the optional
 * `pg` package and a reachable database, and is not exercised by this
 * offline function.
 */
export function lintDataset(dataset: Dataset): LintIssue[] {
  const issues: LintIssue[] = [];
  lintDuplicateIds(dataset, issues);
  lintDuplicateEmails(dataset, issues);
  lintOrphanedForeignKeys(dataset, issues);
  lintFinancialConsistency(dataset, issues);
  lintTemporalOrdering(dataset, issues);
  return issues;
}

export interface SqlLintResult {
  ok: boolean;
  /** The Postgres error message if the transaction failed, if any. */
  error?: string;
}

/** Minimal shape of `pg`'s Client -- avoids depending on @types/pg for an optional codepath. */
interface PgClientLike {
  connect(): Promise<void>;
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
}

/**
 * Runs a generated `.sql` seed file against a real Postgres database inside
 * `BEGIN; ...; ROLLBACK;` -- so it exercises the database's own real
 * FOREIGN KEY/UNIQUE/CHECK constraints (catching anything the offline
 * `lintDataset` checks don't model, like a custom CHECK constraint or a
 * trigger) without ever committing data. Requires the optional `pg`
 * package (`npm install pg`) and a reachable `databaseUrl` -- this
 * function is not exercised by eco-faker's own test suite, since doing so
 * would require a live Postgres instance in CI. The offline `lintDataset`
 * above is the default, dependency-free path; use this when you want to
 * validate against your actual schema's real constraints.
 */
export async function lintSqlAgainstDatabase(sql: string, databaseUrl: string): Promise<SqlLintResult> {
  // Dynamic + loosely-typed import so `pg` stays a fully optional
  // dependency -- most users never need this codepath and shouldn't be
  // forced to install (or type-check against) a Postgres client just to
  // use the rest of eco-faker.
  let pgModule: { Client: new (config: { connectionString: string }) => PgClientLike };
  try {
    pgModule = (await import(/* @vite-ignore */ "pg" as string)) as unknown as {
      Client: new (config: { connectionString: string }) => PgClientLike;
    };
  } catch {
    throw new Error("lintSqlAgainstDatabase requires the optional 'pg' package. Install it with: npm install pg");
  }

  const client = new pgModule.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query(sql);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    } finally {
      // Always roll back -- this is a dry run, never a real insert.
      await client.query("ROLLBACK");
    }
  } finally {
    await client.end();
  }
}
