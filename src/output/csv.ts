import type { Dataset } from "../types.js";
import type { SchemaMapping } from "../introspect/mapper.js";
import { CANONICAL_COLUMNS } from "../introspect/mapper.js";

function flatten(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function tableToCsv(columns: string[], headerColumns: string[], rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const lines = [
    headerColumns.join(","),
    ...rows.map((row) => columns.map((c) => escapeCsv(flatten(row[c]))).join(",")),
  ];
  return lines.join("\n");
}

function headerFor(mapping: SchemaMapping | undefined, table: string, columns: string[]): string[] {
  const tableMapping = mapping?.[table];
  if (!tableMapping) return columns;
  return columns.map((c) => tableMapping.columns[c]?.targetColumn ?? c);
}

/**
 * CSV doesn't have a native concept of multiple tables in one file, so we
 * emit a `-- TABLE: name` marker before each section. Nested arrays/objects
 * (line items, tracking events) are flattened to a JSON string per cell.
 * Row shaping mirrors sql.ts (snake_case canonical columns) so a schema
 * `mapping` renames headers identically across both output formats.
 */
export function toCsv(dataset: Dataset, mapping?: SchemaMapping): string {
  const sections: string[] = [];

  const tables: Array<[string, string[], Record<string, unknown>[]]> = [
    [
      "categories",
      CANONICAL_COLUMNS.categories,
      dataset.categories.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        parent_category_id: c.parentCategoryId,
      })),
    ],
    [
      "brands",
      CANONICAL_COLUMNS.brands,
      dataset.brands.map((b) => ({ id: b.id, name: b.name })),
    ],
    [
      "suppliers",
      CANONICAL_COLUMNS.suppliers,
      dataset.suppliers.map((s) => ({
        id: s.id,
        name: s.name,
        country: s.country,
        lead_time_days: s.leadTimeDays,
      })),
    ],
    [
      "products",
      CANONICAL_COLUMNS.products,
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
    ],
    [
      "users",
      CANONICAL_COLUMNS.users,
      dataset.users.map((u) => ({
        id: u.id,
        first_name: u.firstName,
        last_name: u.lastName,
        email: u.email,
        locale: u.locale,
        created_at: u.createdAt,
        address: u.address,
      })),
    ],
    [
      "carts",
      CANONICAL_COLUMNS.carts,
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
    ],
    [
      "abandoned_checkouts",
      CANONICAL_COLUMNS.abandoned_checkouts,
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
    ],
    [
      "orders",
      CANONICAL_COLUMNS.orders,
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
    ],
    [
      "shipments",
      CANONICAL_COLUMNS.shipments,
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
    ],
    [
      "return_requests",
      CANONICAL_COLUMNS.return_requests,
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
    ],
    [
      "product_views",
      CANONICAL_COLUMNS.product_views,
      dataset.productViews.map((v) => ({
        id: v.id,
        user_id: v.userId,
        product_id: v.productId,
        timestamp: v.timestamp,
        source: v.source,
      })),
    ],
    [
      "search_queries",
      CANONICAL_COLUMNS.search_queries,
      dataset.searchQueries.map((q) => ({
        id: q.id,
        user_id: q.userId,
        query: q.query,
        timestamp: q.timestamp,
        result_count: q.resultCount,
        clicked_product_id: q.clickedProductId,
      })),
    ],
    [
      "wishlist_items",
      CANONICAL_COLUMNS.wishlist_items,
      dataset.wishlistItems.map((w) => ({
        id: w.id,
        user_id: w.userId,
        product_id: w.productId,
        added_at: w.addedAt,
      })),
    ],
    [
      "product_ratings",
      CANONICAL_COLUMNS.product_ratings,
      dataset.productRatings.map((r) => ({
        id: r.id,
        user_id: r.userId,
        product_id: r.productId,
        order_id: r.orderId,
        rating: r.rating,
        review_text: r.reviewText,
        created_at: r.createdAt,
      })),
    ],
    [
      "warehouses",
      CANONICAL_COLUMNS.warehouses,
      dataset.warehouses.map((w) => ({ id: w.id, name: w.name, country: w.country })),
    ],
    [
      "replenishment_orders",
      CANONICAL_COLUMNS.replenishment_orders,
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
    ],
    [
      "stockout_periods",
      CANONICAL_COLUMNS.stockout_periods,
      dataset.stockoutPeriods.map((s) => ({
        id: s.id,
        product_id: s.productId,
        variant_id: s.variantId,
        warehouse_id: s.warehouseId,
        started_at: s.startedAt,
        ended_at: s.endedAt,
        resolved_by_replenishment_id: s.resolvedByReplenishmentId,
      })),
    ],
    [
      "warehouse_transfers",
      CANONICAL_COLUMNS.warehouse_transfers,
      dataset.warehouseTransfers.map((t) => ({
        id: t.id,
        product_id: t.productId,
        from_warehouse_id: t.fromWarehouseId,
        to_warehouse_id: t.toWarehouseId,
        quantity: t.quantity,
        initiated_at: t.initiatedAt,
        completed_at: t.completedAt,
      })),
    ],
  ];

  for (const [name, columns, rows] of tables) {
    sections.push(`-- TABLE: ${name}`);
    sections.push(tableToCsv(columns, headerFor(mapping, name, columns), rows) || "(empty)");
    sections.push("");
  }

  return sections.join("\n");
}
