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
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  parent_category_id TEXT REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS brands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  lead_time_days INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  brand_id TEXT NOT NULL REFERENCES brands(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  base_price NUMERIC NOT NULL,
  currency TEXT NOT NULL,
  variants JSONB NOT NULL
);

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

CREATE TABLE IF NOT EXISTS product_views (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  timestamp TIMESTAMP NOT NULL,
  source TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS search_queries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  query TEXT NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  result_count INTEGER NOT NULL,
  clicked_product_id TEXT REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS wishlist_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  added_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS product_ratings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  rating INTEGER NOT NULL,
  review_text TEXT,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS warehouses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS replenishment_orders (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  quantity_ordered INTEGER NOT NULL,
  ordered_at TIMESTAMP NOT NULL,
  expected_delivery_at TIMESTAMP NOT NULL,
  received_at TIMESTAMP,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stockout_periods (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  variant_id TEXT,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  started_at TIMESTAMP NOT NULL,
  ended_at TIMESTAMP,
  resolved_by_replenishment_id TEXT REFERENCES replenishment_orders(id)
);

CREATE TABLE IF NOT EXISTS warehouse_transfers (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  from_warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  to_warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  quantity INTEGER NOT NULL,
  initiated_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP
);
`.trim();

export function toSql(dataset: Dataset, mapping?: SchemaMapping): string {
  const parts: string[] = mapping ? [] : [SCHEMA, ""];

  const categoriesCols = CANONICAL_COLUMNS.categories;
  parts.push(
    ...insertStatements(
      targetTableName(mapping, "categories"),
      categoriesCols,
      dataset.categories.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        parent_category_id: c.parentCategoryId,
      })),
      headerFor(mapping, "categories", categoriesCols)
    )
  );

  const brandsCols = CANONICAL_COLUMNS.brands;
  parts.push(
    ...insertStatements(
      targetTableName(mapping, "brands"),
      brandsCols,
      dataset.brands.map((b) => ({ id: b.id, name: b.name })),
      headerFor(mapping, "brands", brandsCols)
    )
  );

  const suppliersCols = CANONICAL_COLUMNS.suppliers;
  parts.push(
    ...insertStatements(
      targetTableName(mapping, "suppliers"),
      suppliersCols,
      dataset.suppliers.map((s) => ({
        id: s.id,
        name: s.name,
        country: s.country,
        lead_time_days: s.leadTimeDays,
      })),
      headerFor(mapping, "suppliers", suppliersCols)
    )
  );

  const productsCols = CANONICAL_COLUMNS.products;
  parts.push(
    ...insertStatements(
      targetTableName(mapping, "products"),
      productsCols,
      dataset.products.map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        category_id: p.categoryId,
        brand_id: p.brandId,
        supplier_id: p.supplierId,
        base_price: p.basePrice,
        currency: p.currency,
        variants: p.variants,
      })),
      headerFor(mapping, "products", productsCols)
    )
  );

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

  const productViewsCols = CANONICAL_COLUMNS.product_views;
  parts.push(
    ...insertStatements(
      targetTableName(mapping, "product_views"),
      productViewsCols,
      dataset.productViews.map((v) => ({
        id: v.id,
        user_id: v.userId,
        product_id: v.productId,
        timestamp: v.timestamp,
        source: v.source,
      })),
      headerFor(mapping, "product_views", productViewsCols)
    )
  );

  const searchQueriesCols = CANONICAL_COLUMNS.search_queries;
  parts.push(
    ...insertStatements(
      targetTableName(mapping, "search_queries"),
      searchQueriesCols,
      dataset.searchQueries.map((q) => ({
        id: q.id,
        user_id: q.userId,
        query: q.query,
        timestamp: q.timestamp,
        result_count: q.resultCount,
        clicked_product_id: q.clickedProductId,
      })),
      headerFor(mapping, "search_queries", searchQueriesCols)
    )
  );

  const wishlistItemsCols = CANONICAL_COLUMNS.wishlist_items;
  parts.push(
    ...insertStatements(
      targetTableName(mapping, "wishlist_items"),
      wishlistItemsCols,
      dataset.wishlistItems.map((w) => ({
        id: w.id,
        user_id: w.userId,
        product_id: w.productId,
        added_at: w.addedAt,
      })),
      headerFor(mapping, "wishlist_items", wishlistItemsCols)
    )
  );

  const productRatingsCols = CANONICAL_COLUMNS.product_ratings;
  parts.push(
    ...insertStatements(
      targetTableName(mapping, "product_ratings"),
      productRatingsCols,
      dataset.productRatings.map((r) => ({
        id: r.id,
        user_id: r.userId,
        product_id: r.productId,
        order_id: r.orderId,
        rating: r.rating,
        review_text: r.reviewText,
        created_at: r.createdAt,
      })),
      headerFor(mapping, "product_ratings", productRatingsCols)
    )
  );

  const warehousesCols = CANONICAL_COLUMNS.warehouses;
  parts.push(
    ...insertStatements(
      targetTableName(mapping, "warehouses"),
      warehousesCols,
      dataset.warehouses.map((w) => ({ id: w.id, name: w.name, country: w.country })),
      headerFor(mapping, "warehouses", warehousesCols)
    )
  );

  const replenishmentOrdersCols = CANONICAL_COLUMNS.replenishment_orders;
  parts.push(
    ...insertStatements(
      targetTableName(mapping, "replenishment_orders"),
      replenishmentOrdersCols,
      dataset.replenishmentOrders.map((r) => ({
        id: r.id,
        product_id: r.productId,
        supplier_id: r.supplierId,
        warehouse_id: r.warehouseId,
        quantity_ordered: r.quantityOrdered,
        ordered_at: r.orderedAt,
        expected_delivery_at: r.expectedDeliveryAt,
        received_at: r.receivedAt,
        status: r.status,
      })),
      headerFor(mapping, "replenishment_orders", replenishmentOrdersCols)
    )
  );

  const stockoutPeriodsCols = CANONICAL_COLUMNS.stockout_periods;
  parts.push(
    ...insertStatements(
      targetTableName(mapping, "stockout_periods"),
      stockoutPeriodsCols,
      dataset.stockoutPeriods.map((s) => ({
        id: s.id,
        product_id: s.productId,
        variant_id: s.variantId,
        warehouse_id: s.warehouseId,
        started_at: s.startedAt,
        ended_at: s.endedAt,
        resolved_by_replenishment_id: s.resolvedByReplenishmentId,
      })),
      headerFor(mapping, "stockout_periods", stockoutPeriodsCols)
    )
  );

  const warehouseTransfersCols = CANONICAL_COLUMNS.warehouse_transfers;
  parts.push(
    ...insertStatements(
      targetTableName(mapping, "warehouse_transfers"),
      warehouseTransfersCols,
      dataset.warehouseTransfers.map((t) => ({
        id: t.id,
        product_id: t.productId,
        from_warehouse_id: t.fromWarehouseId,
        to_warehouse_id: t.toWarehouseId,
        quantity: t.quantity,
        initiated_at: t.initiatedAt,
        completed_at: t.completedAt,
      })),
      headerFor(mapping, "warehouse_transfers", warehouseTransfersCols)
    )
  );

  return parts.join("\n");
}
