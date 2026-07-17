import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";
import { generateStores } from "../src/multi-store.js";
import { createMockApiServer } from "../src/serve.js";
import { buildWebhookEvents, replayEvents } from "../src/webhook.js";
import { diffDatasets } from "../src/diff.js";

describe("currency formatting", () => {
  it("every order has a locale-formatted total", () => {
    const dataset = generate({ seed: 1, scaleFactor: 30 });
    for (const order of dataset.orders) {
      expect(order.totalFormatted).toMatch(/[\d,.]/);
      expect(order.totalFormatted.length).toBeGreaterThan(0);
    }
  });

  it("remote-shipping anomaly recomputes totalFormatted to match the new total", () => {
    const dataset = generate({
      seed: 1,
      scaleFactor: 300,
      anomalies: { enabled: true, remoteShippingRate: 1, botCartRate: 0, contradictoryReturnRate: 0 },
    });
    const remoteOrders = dataset.orders.filter((o) => o.anomaly?.type === "remote_surcharge");
    expect(remoteOrders.length).toBeGreaterThan(0);
    for (const order of remoteOrders) {
      const formatted = new Intl.NumberFormat(dataset.config.locale, { style: "currency", currency: order.currency }).format(
        order.total
      );
      expect(order.totalFormatted).toBe(formatted);
    }
  });

  it("every return request has a locale-formatted refund amount", () => {
    const dataset = generate({ seed: 1, scaleFactor: 400, returnRate: 0.3 });
    expect(dataset.returnRequests.length).toBeGreaterThan(0);
    for (const ret of dataset.returnRequests) {
      expect(typeof ret.refundAmountFormatted).toBe("string");
      expect(ret.refundAmountFormatted.length).toBeGreaterThan(0);
    }
  });
});

describe("multi-store generation", () => {
  it("generates N independent stores with distinct data", () => {
    const stores = generateStores({ seed: 1, scaleFactor: 20 }, Date.parse("2026-01-01T00:00:00Z"), 3);
    expect(stores).toHaveLength(3);
    expect(stores[0].storeId).toBe("store-1");
    expect(stores[2].storeId).toBe("store-3");
    const ids = stores.map((s) => s.dataset.users[0].id);
    expect(new Set(ids).size).toBe(3); // all distinct
  });

  it("is deterministic given the same base seed and referenceNow", () => {
    const a = generateStores({ seed: 5, scaleFactor: 20 }, Date.parse("2026-01-01T00:00:00Z"), 2);
    const b = generateStores({ seed: 5, scaleFactor: 20 }, Date.parse("2026-01-01T00:00:00Z"), 2);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("mock REST API server", () => {
  const dataset = generate({ seed: 3, scaleFactor: 60 });
  const app = createMockApiServer(dataset);

  function request(method: string, urlPath: string): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
      const server = app.listen(0, () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        fetch(`http://127.0.0.1:${port}${urlPath}`, { method })
          .then(async (res) => {
            const body = await res.json();
            server.close();
            resolve({ status: res.status, body });
          })
          .catch((err) => {
            server.close();
            reject(err);
          });
      });
    });
  }

  it("GET / lists endpoints and counts", async () => {
    const { status, body } = await request("GET", "/");
    expect(status).toBe(200);
    expect(body.endpoints).toContain("/api/orders");
    expect(body.counts.orders).toBe(dataset.orders.length);
  });

  it("GET /api/orders paginates and filters by status", async () => {
    const { status, body } = await request("GET", "/api/orders?status=delivered&pageSize=5&page=1");
    expect(status).toBe(200);
    expect(body.data.length).toBeLessThanOrEqual(5);
    expect(body.data.every((o: any) => o.status === "delivered")).toBe(true);
    expect(body.pagination.pageSize).toBe(5);
  });

  it("GET /api/orders/:id returns a single record", async () => {
    const target = dataset.orders[0];
    const { status, body } = await request("GET", `/api/orders/${target.id}`);
    expect(status).toBe(200);
    expect(body.id).toBe(target.id);
  });

  it("GET /api/orders/:id returns 404 for an unknown id", async () => {
    const { status, body } = await request("GET", "/api/orders/does-not-exist");
    expect(status).toBe(404);
    expect(body.error).toBeDefined();
  });

  it("GET /api/unknown-table returns 404 with available routes", async () => {
    const { status, body } = await request("GET", "/api/not-a-real-table");
    expect(status).toBe(404);
    expect(body.availableRoutes).toContain("/api/orders");
  });
});

describe("webhook event simulator", () => {
  const referenceNow = Date.parse("2026-01-01T00:00:00Z");
  const events = buildWebhookEvents({ seed: 1, scaleFactor: 50 }, referenceNow);

  it("produces a non-empty, chronologically sorted event list", () => {
    expect(events.length).toBeGreaterThan(0);
    for (let i = 1; i < events.length; i++) {
      expect(Date.parse(events[i].timestamp)).toBeGreaterThanOrEqual(Date.parse(events[i - 1].timestamp));
    }
  });

  it("includes granular shipment lifecycle events", () => {
    const shipmentEventTypes = new Set(events.filter((e) => e.type.startsWith("shipment.")).map((e) => e.type));
    expect(shipmentEventTypes.size).toBeGreaterThan(0);
    expect([...shipmentEventTypes].every((t) => /^shipment\.[a-z_]+$/.test(t))).toBe(true);
  });

  it("replayEvents respects eventTypes filtering and limit, and calls onEvent in order", async () => {
    const seen: string[] = [];
    const total = await replayEvents(
      events,
      { speed: 1_000_000, maxWaitMs: 100, eventTypes: new Set(["order.created"]), limit: 5 },
      (event) => {
        seen.push(event.type);
      }
    );
    expect(total).toBeLessThanOrEqual(5);
    expect(seen.every((t) => t === "order.created")).toBe(true);
  });
});

describe("dataset diffing", () => {
  it("reports zero row-count deltas and no schema drift comparing a dataset to itself", () => {
    const dataset = generate({ seed: 9, scaleFactor: 40 });
    const report = diffDatasets(dataset, dataset);
    expect(Object.values(report.rowCounts).every((r) => r.delta === 0)).toBe(true);
    expect(report.hasSchemaChanges).toBe(false);
  });

  it("does not flag schema drift just because one side sampled zero rows in a table", () => {
    const a = generate({ seed: 1, scaleFactor: 40 });
    const bEmpty = { ...a, returnRequests: [] };
    const report = diffDatasets(a, bEmpty);
    expect(report.schemaChanges.returnRequests.addedFields).toEqual([]);
    expect(report.schemaChanges.returnRequests.removedFields).toEqual([]);
  });

  it("detects genuine schema drift (a field renamed on every row of a table)", () => {
    const a = generate({ seed: 1, scaleFactor: 40 });
    const b = {
      ...a,
      users: a.users.map((u) => {
        const { firstName, ...rest } = u as any;
        return { ...rest, givenName: firstName };
      }),
    };
    const report = diffDatasets(a, b as any);
    expect(report.hasSchemaChanges).toBe(true);
    expect(report.schemaChanges.users.addedFields).toContain("givenName");
    expect(report.schemaChanges.users.removedFields).toContain("firstName");
  });
});
