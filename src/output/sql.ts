import type { Dataset } from "../types.js";
import type { SchemaMapping } from "../introspect/mapper.js";
import { CANONICAL_COLUMNS } from "../introspect/mapper.js";

function sqlString(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `'${text.replace(/'/g, "''")}'`;
}

/**
 * `columns` are the canonical keys used to read values off each row.
 * `headerColumns` are the names actually written into the INSERT statement
 * (identical to `columns` unless a schema mapping renamed them) -- lets us
 * target an existing table (e.g. from a Prisma/Drizzle schema) without
 * touching how we read our own generated objects.
 */
function insertStatements(
  table: string,
  columns: string[],
  rows: Record<string, unknown>[],
  headerColumns: string[] = columns
): string[] {
  return rows.map((row) => {
    const values = columns.map((c) => sqlString(row[c])).join(", ");
    return `INSERT INTO ${table} (${headerColumns.join(", ")}) VALUES (${values});`;
  });
}

function headerFor(mapping: SchemaMapping | undefined, table: string, columns: string[]): string[] {
  const tableMapping = mapping?.[table];
  if (!tableMapping) return columns;
  return columns.map((c) => tableMapping.columns[c]?.targetColumn ?? c);
}

function targetTableName(mapping: SchemaMapping | undefined, table: string): string {
  return mapping?.[table]?.targetModel ?? table;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  locale TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL,
  address JSONB
);

CREATE TABLE IF NOT EXISTS carts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL,
  items JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL,
  last_activity_date TIMESTAMP NOT NULL,
  abandonment_timeout_hours NUMERIC NOT NULL,
  currency TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS abandoned_checkouts (
  id TEXT PRIMARY KEY,
  cart_id TEXT NOT NULL REFERENCES carts(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  exit_timestamp TIMESTAMP NOT NULL,
  recovery_email_sent BOOLEAN NOT NULL,
  recovery_email_sent_at TIMESTAMP,
  coupon_code_offered TEXT,
  recovered BOOLEAN NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  cart_id TEXT NOT NULL REFERENCES carts(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  items JSONB NOT NULL,
  subtotal NUMERIC NOT NULL,
  tax NUMERIC NOT NULL,
  shipping NUMERIC NOT NULL,
  total NUMERIC NOT NULL,
  currency TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL,
  shipping_address JSONB,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shipments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  tracking_number TEXT NOT NULL,
  carrier TEXT NOT NULL,
  package_index INTEGER NOT NULL,
  total_packages INTEGER NOT NULL,
  items JSONB NOT NULL,
  status TEXT NOT NULL,
  delayed BOOLEAN NOT NULL,
  events JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS return_requests (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  refund_amount NUMERIC NOT NULL,
  requested_at TIMESTAMP NOT NULL,
  resolved_at TIMESTAMP
);
`.trim();

export function toSql(dataset: Dataset, mapping?: SchemaMapping): string {
  const parts: string[] = mapping ? [] : [SCHEMA, ""];

  const usersCols = CANONICAL_COLUMNS.users;
  parts.push(
    ...insertStatements(
      targetTableName(mapping, "users"),
      usersCols,
      dataset.users.map((u) => ({
        id: u.id,
        first_name: u.firstName,
        last_name: u.lastName,
        email: u.email,
        locale: u.locale,
        created_at: u.createdAt,
        address: u.address,
      })),
      headerFor(mapping, "users", usersCols)
    )
  );

  const cartsCols = CANONICAL_COLUMNS.carts;
  parts.push(
    ...insertStatements(
      targetTableName(mapping, "carts"),
      cartsCols,
      dataset.carts.map((c) => ({
        id: c.id,
        user_id: c.userId,
        status: c.status,
        items: c.items,
        created_at: c.createdAt,
        last_activity_date: c.lastActivityDate,
        abandonment_timeout_hours: c.abandonmentTimeoutHours,
        currency: c.currency,
      })),
      headerFor(mapping, "carts", cartsCols)
    )
  );

  const checkoutsCols = CANONICAL_COLUMNS.abandoned_checkouts;
  parts.push(
    ...insertStatements(
      targetTableName(mapping, "abandoned_checkouts"),
      checkoutsCols,
      dataset.abandonedCheckouts.map((a) => ({
        id: a.id,
        cart_id: a.cartId,
        user_id: a.userId,
        exit_timestamp: a.exitTimestamp,
        recovery_email_sent: a.recoveryEmailSent,
        recovery_email_sent_at: a.recoveryEmailSentAt,
        coupon_code_offered: a.couponCodeOffered,
        recovered: a.recovered,
      })),
      headerFor(mapping, "abandoned_checkouts", checkoutsCols)
    )
  );

  const ordersCols = CANONICAL_COLUMNS.orders;
  parts.push(
    ...insertStatements(
      targetTableName(mapping, "orders"),
      ordersCols,
      dataset.orders.map((o) => ({
        id: o.id,
        cart_id: o.cartId,
        user_id: o.userId,
        items: o.items,
        subtotal: o.subtotal,
        tax: o.tax,
        shipping: o.shipping,
        total: o.total,
        currency: o.currency,
        created_at: o.createdAt,
        shipping_address: o.shippingAddress,
        status: o.status,
      })),
      headerFor(mapping, "orders", ordersCols)
    )
  );

  const shipmentsCols = CANONICAL_COLUMNS.shipments;
  parts.push(
    ...insertStatements(
      targetTableName(mapping, "shipments"),
      shipmentsCols,
      dataset.shipments.map((s) => ({
        id: s.id,
        order_id: s.orderId,
        tracking_number: s.trackingNumber,
        carrier: s.carrier,
        package_index: s.packageIndex,
        total_packages: s.totalPackages,
        items: s.items,
        status: s.status,
        delayed: s.delayed,
        events: s.events,
      })),
      headerFor(mapping, "shipments", shipmentsCols)
    )
  );

  const returnsCols = CANONICAL_COLUMNS.return_requests;
  parts.push(
    ...insertStatements(
      targetTableName(mapping, "return_requests"),
      returnsCols,
      dataset.returnRequests.map((r) => ({
        id: r.id,
        order_id: r.orderId,
        user_id: r.userId,
        reason: r.reason,
        status: r.status,
        refund_amount: r.refundAmount,
        requested_at: r.requestedAt,
        resolved_at: r.resolvedAt,
      })),
      headerFor(mapping, "return_requests", returnsCols)
    )
  );

  return parts.join("\n");
}
