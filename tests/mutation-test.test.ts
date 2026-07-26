import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { runMutationTest, buildSeedBodiesFromDataset, type MutationTestOptions } from "../src/mutation-test.js";
import type { OpenApiDocument } from "../src/contract-test.js";

/**
 * A minimal, hand-authored contract -- not eco-faker's own `openapi-export`,
 * which is deliberately read-only (see contract-test.ts's doc comment) and
 * so never declares POST/PATCH at all. This mutation-testing engine
 * targets a real user's own backend, which does declare mutations; this
 * fixture is a small, realistic stand-in for that.
 */
const contract: OpenApiDocument = {
  paths: {
    "/api/orders": {
      get: { responses: { "200": {} } },
      post: {
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } },
        responses: { "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } } },
      },
    },
    "/api/orders/{id}": {
      get: {
        responses: {
          "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } },
          "401": {},
          "404": {},
        },
      },
      patch: {
        responses: {
          "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } },
          "404": {},
          "409": {},
        },
      },
    },
  },
  components: {
    schemas: {
      Order: {
        type: "object",
        properties: {
          id: { type: "string" },
          total: { type: "number" },
          status: { type: "string", enum: ["processing", "shipped", "delivered"] },
        },
      },
    },
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A real, working in-memory backend: idempotency-key dedup, rejects backward status transitions, requires auth, 404s a fabricated id. */
function buildCompliantServer() {
  const orders = new Map<string, { id: string; total: number; status: string }>();
  const idempotencyKeys = new Map<string, string>(); // idempotency key -> order id

  const fetchImpl: typeof fetch = (async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = (init?.headers ?? {}) as Record<string, string>;

    if (url.pathname === "/api/orders" && method === "GET") {
      if (!headers.Authorization) return jsonResponse({ error: "unauthorized" }, 401);
      return jsonResponse({ data: [...orders.values()] });
    }

    if (url.pathname === "/api/orders" && method === "POST") {
      if (!headers.Authorization) return jsonResponse({ error: "unauthorized" }, 401);
      const idemKey = headers["Idempotency-Key"];
      if (idemKey && idempotencyKeys.has(idemKey)) {
        return jsonResponse(orders.get(idempotencyKeys.get(idemKey)!), 200);
      }
      const body = JSON.parse((init!.body as string) ?? "{}");
      const id = randomUUID();
      const record = { id, total: body.total ?? 0, status: "processing" };
      orders.set(id, record);
      if (idemKey) idempotencyKeys.set(idemKey, id);
      return jsonResponse(record, 201);
    }

    const idMatch = url.pathname.match(/^\/api\/orders\/([^/]+)$/);
    if (idMatch && method === "GET") {
      if (!headers.Authorization) return jsonResponse({ error: "unauthorized" }, 401);
      const order = orders.get(idMatch[1]);
      return order ? jsonResponse(order) : jsonResponse({ error: "not found" }, 404);
    }
    if (idMatch && method === "PATCH") {
      const order = orders.get(idMatch[1]);
      if (!order) return jsonResponse({ error: "not found" }, 404);
      const body = JSON.parse((init!.body as string) ?? "{}");
      const statusOrder = ["processing", "shipped", "delivered"];
      if (typeof body.status === "string" && statusOrder.indexOf(body.status) < statusOrder.indexOf(order.status)) {
        return jsonResponse({ error: "invalid transition" }, 409);
      }
      Object.assign(order, body);
      return jsonResponse(order, 200);
    }

    return jsonResponse({ error: "not found" }, 404);
  }) as typeof fetch;

  // Seed one real order at "shipped" so an invalid backward transition (-> processing) can be attempted.
  const seedId = randomUUID();
  orders.set(seedId, { id: seedId, total: 42, status: "shipped" });

  return { fetchImpl };
}

/** The same server, but with each of the three real bugs this engine is meant to catch, one at a time. */
function buildBuggyServer(bug: "no_idempotency" | "allows_backward_transition" | "no_auth_check") {
  const orders = new Map<string, { id: string; total: number; status: string }>();

  const fetchImpl: typeof fetch = (async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = (init?.headers ?? {}) as Record<string, string>;

    if (url.pathname === "/api/orders" && method === "GET") {
      return jsonResponse({ data: [...orders.values()] });
    }

    if (url.pathname === "/api/orders" && method === "POST") {
      // Bug: never checks Idempotency-Key at all -- every POST creates a new resource.
      const body = JSON.parse((init!.body as string) ?? "{}");
      const id = randomUUID();
      const record = { id, total: body.total ?? 0, status: "processing" };
      orders.set(id, record);
      return jsonResponse(record, 201);
    }

    const idMatch = url.pathname.match(/^\/api\/orders\/([^/]+)$/);
    if (idMatch && method === "GET") {
      if (bug !== "no_auth_check" && !headers.Authorization) return jsonResponse({ error: "unauthorized" }, 401);
      const order = orders.get(idMatch[1]);
      return order ? jsonResponse(order) : jsonResponse({ error: "not found" }, 404);
    }
    if (idMatch && method === "PATCH") {
      const order = orders.get(idMatch[1]);
      if (!order) return jsonResponse({ error: "not found" }, 404);
      const body = JSON.parse((init!.body as string) ?? "{}");
      if (bug === "allows_backward_transition") {
        Object.assign(order, body); // Bug: never validates the transition at all.
        return jsonResponse(order, 200);
      }
      const statusOrder = ["processing", "shipped", "delivered"];
      if (typeof body.status === "string" && statusOrder.indexOf(body.status) < statusOrder.indexOf(order.status)) {
        return jsonResponse({ error: "invalid transition" }, 409);
      }
      Object.assign(order, body);
      return jsonResponse(order, 200);
    }

    return jsonResponse({ error: "not found" }, 404);
  }) as typeof fetch;

  const seedId = randomUUID();
  orders.set(seedId, { id: seedId, total: 42, status: "shipped" });

  return { fetchImpl };
}

const baseOptions: Omit<MutationTestOptions, "fetchImpl"> = {
  baseUrl: "http://localhost:4000",
  contract,
  seedBodies: { "/api/orders": { total: 99, status: "processing" } },
  headers: { Authorization: "Bearer testkey" },
};

describe("runMutationTest", () => {
  it("passes every check against a real, correctly-implemented server", async () => {
    const { fetchImpl } = buildCompliantServer();
    const summary = await runMutationTest({ ...baseOptions, fetchImpl });
    expect(summary.failed).toBe(0);
    expect(summary.passed).toBeGreaterThan(0);
    const kinds = new Set(summary.results.map((r) => r.check));
    expect(kinds).toEqual(new Set(["not_found", "unauthorized", "duplicate_submission", "race_condition", "invalid_transition"]));
  });

  it("catches a server with no idempotency-key handling (duplicate_submission)", async () => {
    const { fetchImpl } = buildBuggyServer("no_idempotency");
    const summary = await runMutationTest({ ...baseOptions, fetchImpl });
    const result = summary.results.find((r) => r.check === "duplicate_submission");
    expect(result?.ok).toBe(false);
    expect(result?.detail).toContain("different ids");
  });

  it("catches the same bug under concurrency (race_condition)", async () => {
    const { fetchImpl } = buildBuggyServer("no_idempotency");
    const summary = await runMutationTest({ ...baseOptions, fetchImpl });
    const result = summary.results.find((r) => r.check === "race_condition");
    expect(result?.ok).toBe(false);
    expect(result?.detail).toContain("distinct resources");
  });

  it("catches a server that allows an invalid backward status transition", async () => {
    const { fetchImpl } = buildBuggyServer("allows_backward_transition");
    const summary = await runMutationTest({ ...baseOptions, fetchImpl });
    const result = summary.results.find((r) => r.check === "invalid_transition");
    expect(result?.ok).toBe(false);
    expect(result?.detail).toContain("a backward transition");
  });

  it("catches a server missing the 401 check on a declared-401 operation", async () => {
    const { fetchImpl } = buildBuggyServer("no_auth_check");
    const summary = await runMutationTest({ ...baseOptions, fetchImpl });
    const result = summary.results.find((r) => r.check === "unauthorized");
    expect(result?.ok).toBe(false);
  });

  it("skips duplicate_submission/race_condition with a clear reason when no seed body is supplied", async () => {
    const { fetchImpl } = buildCompliantServer();
    const summary = await runMutationTest({ ...baseOptions, seedBodies: {}, fetchImpl });
    const result = summary.results.find((r) => r.check === "duplicate_submission");
    expect(result?.ok).toBe(false);
    expect(result?.error).toContain("no seed body supplied");
  });

  it("reports a network failure distinctly from a failed assertion", async () => {
    const failingFetch: typeof fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const summary = await runMutationTest({ ...baseOptions, fetchImpl: failingFetch });
    const notFoundResult = summary.results.find((r) => r.check === "not_found");
    expect(notFoundResult?.ok).toBe(false);
    expect(notFoundResult?.error).toContain("ECONNREFUSED");
  });
});

describe("buildSeedBodiesFromDataset", () => {
  it("matches a collection path to a real dataset table by its last path segment, and strips the id", () => {
    const dataset = { orders: [{ id: "abc", total: 42, status: "processing" }] };
    const seedBodies = buildSeedBodiesFromDataset(dataset, contract);
    expect(seedBodies["/api/orders"]).toEqual({ total: 42, status: "processing" });
    expect(seedBodies["/api/orders"]).not.toHaveProperty("id");
  });

  it("leaves out a path with no matching table rather than fabricating one", () => {
    const dataset = { users: [{ id: "u1", name: "test" }] };
    const seedBodies = buildSeedBodiesFromDataset(dataset, contract);
    expect(seedBodies["/api/orders"]).toBeUndefined();
  });
});
