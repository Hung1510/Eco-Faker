import type { Dataset } from "./types.js";

const RESOURCE_SCHEMAS: Record<string, object> = {
  warehouses: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string" },
      country: { type: "string" },
    },
  },
  "replenishment-orders": {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      productId: { type: "string", format: "uuid" },
      supplierId: { type: "string", format: "uuid" },
      warehouseId: { type: "string", format: "uuid" },
      quantityOrdered: { type: "integer" },
      orderedAt: { type: "string", format: "date-time" },
      expectedDeliveryAt: { type: "string", format: "date-time" },
      receivedAt: { type: "string", format: "date-time", nullable: true },
      status: { type: "string", enum: ["ordered", "in_transit", "received", "delayed"] },
    },
  },
  "stockout-periods": {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      productId: { type: "string", format: "uuid" },
      variantId: { type: "string", format: "uuid", nullable: true },
      warehouseId: { type: "string", format: "uuid" },
      startedAt: { type: "string", format: "date-time" },
      endedAt: { type: "string", format: "date-time", nullable: true },
      resolvedByReplenishmentId: { type: "string", format: "uuid", nullable: true },
    },
  },
  "warehouse-transfers": {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      productId: { type: "string", format: "uuid" },
      fromWarehouseId: { type: "string", format: "uuid" },
      toWarehouseId: { type: "string", format: "uuid" },
      quantity: { type: "integer" },
      initiatedAt: { type: "string", format: "date-time" },
      completedAt: { type: "string", format: "date-time", nullable: true },
    },
  },
  "product-views": {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      userId: { type: "string", format: "uuid" },
      productId: { type: "string", format: "uuid" },
      timestamp: { type: "string", format: "date-time" },
      source: { type: "string", enum: ["search", "category_browse", "recommendation", "direct"] },
    },
  },
  "search-queries": {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      userId: { type: "string", format: "uuid" },
      query: { type: "string" },
      timestamp: { type: "string", format: "date-time" },
      resultCount: { type: "integer" },
      clickedProductId: { type: "string", format: "uuid", nullable: true },
    },
  },
  "wishlist-items": {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      userId: { type: "string", format: "uuid" },
      productId: { type: "string", format: "uuid" },
      addedAt: { type: "string", format: "date-time" },
    },
  },
  "product-ratings": {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      userId: { type: "string", format: "uuid" },
      productId: { type: "string", format: "uuid" },
      orderId: { type: "string", format: "uuid" },
      rating: { type: "integer", minimum: 1, maximum: 5 },
      reviewText: { type: "string", nullable: true },
      createdAt: { type: "string", format: "date-time" },
    },
  },
  categories: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string" },
      slug: { type: "string" },
      parentCategoryId: { type: "string", format: "uuid", nullable: true, description: "Null for a top-level department; set for a subcategory." },
    },
  },
  brands: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string" },
    },
  },
  suppliers: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string" },
      country: { type: "string" },
      leadTimeDays: { type: "integer" },
    },
  },
  products: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      sku: { type: "string" },
      name: { type: "string" },
      categoryId: { type: "string", format: "uuid" },
      brandId: { type: "string", format: "uuid" },
      supplierId: { type: "string", format: "uuid" },
      basePrice: { type: "number" },
      currency: { type: "string" },
      variants: { type: "array", items: { $ref: "#/components/schemas/ProductVariant" } },
    },
  },
  users: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      firstName: { type: "string" },
      lastName: { type: "string" },
      email: { type: "string", format: "email" },
      locale: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
      address: { $ref: "#/components/schemas/Address" },
    },
  },
  carts: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      userId: { type: "string", format: "uuid" },
      status: { type: "string", enum: ["active", "abandoned", "converted"] },
      items: { type: "array", items: { $ref: "#/components/schemas/LineItem" } },
      createdAt: { type: "string", format: "date-time" },
      lastActivityDate: { type: "string", format: "date-time" },
      abandonmentTimeoutHours: { type: "number" },
      currency: { type: "string" },
      anomaly: { $ref: "#/components/schemas/AnomalyTag", nullable: true },
    },
  },
  "abandoned-checkouts": {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      cartId: { type: "string", format: "uuid" },
      userId: { type: "string", format: "uuid" },
      exitTimestamp: { type: "string", format: "date-time" },
      recoveryEmailSent: { type: "boolean" },
      recoveryEmailSentAt: { type: "string", format: "date-time", nullable: true },
      couponCodeOffered: { type: "string", nullable: true },
      recovered: { type: "boolean" },
    },
  },
  orders: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      cartId: { type: "string", format: "uuid" },
      userId: { type: "string", format: "uuid" },
      items: { type: "array", items: { $ref: "#/components/schemas/LineItem" } },
      subtotal: { type: "number" },
      tax: { type: "number" },
      shipping: { type: "number" },
      total: { type: "number" },
      totalFormatted: { type: "string" },
      currency: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
      shippingAddress: { $ref: "#/components/schemas/Address", nullable: true },
      status: { type: "string", enum: ["processing", "shipped", "delivered"] },
      anomaly: { $ref: "#/components/schemas/AnomalyTag", nullable: true },
      fraud: { $ref: "#/components/schemas/FraudTag", nullable: true },
    },
  },
  shipments: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      orderId: { type: "string", format: "uuid" },
      trackingNumber: { type: "string" },
      carrier: { type: "string" },
      packageIndex: { type: "integer" },
      totalPackages: { type: "integer" },
      items: { type: "array", items: { $ref: "#/components/schemas/LineItem" } },
      status: {
        type: "string",
        enum: ["Label Created", "Picked Up", "In Transit", "Delayed", "Out for Delivery", "Delivered"],
      },
      delayed: { type: "boolean" },
      events: { type: "array", items: { $ref: "#/components/schemas/TrackingEvent" } },
    },
  },
  returns: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      orderId: { type: "string", format: "uuid" },
      userId: { type: "string", format: "uuid" },
      reason: { type: "string" },
      status: { type: "string", enum: ["pending", "approved", "rejected"] },
      refundAmount: { type: "number" },
      refundAmountFormatted: { type: "string" },
      requestedAt: { type: "string", format: "date-time" },
      resolvedAt: { type: "string", format: "date-time", nullable: true },
      csatScore: { type: "integer", nullable: true },
      anomaly: { $ref: "#/components/schemas/AnomalyTag", nullable: true },
    },
  },
};

const SHARED_SCHEMAS = {
  Address: {
    type: "object",
    properties: {
      line1: { type: "string" },
      line2: { type: "string", nullable: true },
      city: { type: "string" },
      state: { type: "string" },
      postalCode: { type: "string" },
      country: { type: "string" },
    },
  },
  LineItem: {
    type: "object",
    properties: {
      productId: { type: "string", format: "uuid" },
      sku: { type: "string" },
      name: { type: "string" },
      unitPrice: { type: "number" },
      quantity: { type: "integer" },
      lineTotal: { type: "number" },
    },
  },
  TrackingEvent: {
    type: "object",
    properties: {
      status: { type: "string" },
      timestamp: { type: "string", format: "date-time" },
      location: { type: "string" },
    },
  },
  AnomalyTag: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["bot_activity", "remote_surcharge", "contradictory_review"] },
      note: { type: "string" },
    },
  },
  FraudTag: {
    type: "object",
    properties: {
      fraudType: {
        type: "string",
        enum: [
          "stolen_card",
          "account_farming",
          "reseller_behavior",
          "refund_abuse",
          "friendly_chargeback",
          "coupon_abuse_ring",
        ],
      },
      riskScore: { type: "integer", minimum: 0, maximum: 100 },
      signals: { type: "array", items: { type: "string" } },
    },
  },
  Pagination: {
    type: "object",
    properties: {
      page: { type: "integer" },
      pageSize: { type: "integer" },
      total: { type: "integer" },
      totalPages: { type: "integer" },
    },
  },
  ProductVariant: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      sku: { type: "string" },
      attributes: { type: "object", additionalProperties: { type: "string" }, description: "e.g. { storage: '512GB', color: 'Space Gray' } -- shape varies per product." },
      priceDelta: { type: "number" },
      stockLevel: { type: "integer" },
    },
  },
};

const COMMON_PARAMETERS = [
  { name: "page", in: "query", schema: { type: "integer", default: 1 }, description: "1-indexed page number" },
  { name: "pageSize", in: "query", schema: { type: "integer", default: 25, maximum: 500 } },
  { name: "sort", in: "query", schema: { type: "string" }, description: "Field name to sort by" },
  { name: "order", in: "query", schema: { type: "string", enum: ["asc", "desc"] } },
];

/**
 * Build an OpenAPI 3.0 document describing the mock API's actual routes and
 * schemas, so the server is importable into Postman/Insomnia/Swagger UI
 * instead of requiring someone to read the README to find the endpoints.
 * `dataset` is only used to fill in realistic example values.
 */
export function buildOpenApiSpec(dataset: Dataset, port: number): object {
  const paths: Record<string, object> = {};

  for (const route of Object.keys(RESOURCE_SCHEMAS)) {
    const schemaRef = { $ref: `#/components/schemas/${resourceComponentName(route)}` };

    paths[`/api/${route}`] = {
      get: {
        summary: `List ${route}`,
        parameters: [
          ...COMMON_PARAMETERS,
          {
            name: "(any other field)",
            in: "query",
            schema: { type: "string" },
            description: "Any top-level field on the resource can be used as an exact-match filter, e.g. ?status=delivered",
          },
        ],
        responses: {
          "200": {
            description: "Paginated list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: schemaRef },
                    pagination: { $ref: "#/components/schemas/Pagination" },
                  },
                },
              },
            },
          },
          "401": { description: "Missing/invalid API key (only if --api-key is set)" },
          "429": { description: "Simulated rate limit (only with --chaos)" },
          "500": { description: "Simulated server error (only with --chaos)" },
        },
      },
    };

    paths[`/api/${route}/{id}`] = {
      get: {
        summary: `Get a single ${route.replace(/s$/, "")} by id`,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Found", content: { "application/json": { schema: schemaRef } } },
          "404": { description: "Not found" },
          "401": { description: "Missing/invalid API key (only if --api-key is set)" },
        },
      },
    };
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "eco-faker mock API",
      version: "0.1.0",
      description:
        "json-server-style mock REST API backed by a generated eco-faker dataset. Data changes every time the server restarts unless you pin --seed.",
    },
    servers: [{ url: `http://localhost:${port}` }],
    paths,
    components: {
      schemas: {
        ...SHARED_SCHEMAS,
        ...Object.fromEntries(Object.entries(RESOURCE_SCHEMAS).map(([route, schema]) => [resourceComponentName(route), schema])),
      },
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "Only enforced when the server is started with --api-key" },
      },
    },
  };
}

function resourceComponentName(route: string): string {
  return route
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
