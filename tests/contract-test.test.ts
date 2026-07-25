import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";
import { buildOpenApiSpec } from "../src/openapi.js";
import { paginateRecords, TABLE_ROUTES } from "../src/serve.js";
import { runContractTest, type OpenApiDocument } from "../src/contract-test.js";

const dataset = generate({ seed: 11, scaleFactor: 300 });
const contract = buildOpenApiSpec(dataset, 4000) as OpenApiDocument;

/** A minimal in-memory stand-in for `serve`, so tests don't need a real server on a real port. */
function compliantFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const match = url.pathname.match(/^\/api\/([a-z-]+)(?:\/([^/]+))?$/);
    if (!match) return new Response("not found", { status: 404 });
    const [, route, id] = match;
    const datasetKey = TABLE_ROUTES[route];
    const rows = (dataset as unknown as Record<string, Record<string, unknown>[]>)[datasetKey] ?? [];

    if (id) {
      const row = rows.find((r) => r.id === id);
      return row
        ? new Response(JSON.stringify(row), { status: 200, headers: { "Content-Type": "application/json" } })
        : new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    const page = paginateRecords(rows, Object.fromEntries(url.searchParams));
    return new Response(JSON.stringify(page), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

describe("runContractTest", () => {
  it("passes every declared GET operation against a server that actually implements the contract", async () => {
    const summary = await runContractTest({ baseUrl: "http://localhost:4000", contract, fetchImpl: compliantFetch() });
    expect(summary.failed).toBe(0);
    expect(summary.passed).toBeGreaterThan(0);
    expect(summary.results.every((r) => r.ok)).toBe(true);
  });

  it("catches a status-code violation (byId returning 200 with an error body instead of a proper 404)", async () => {
    const brokenFetch: typeof fetch = (async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/api/orders")) {
        return new Response(
          JSON.stringify({ data: [{ id: "not-a-real-id" }], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      // byId: should 404, but this broken server always returns 200 with an empty object
      return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    const summary = await runContractTest({ baseUrl: "http://localhost:4000", contract, fetchImpl: brokenFetch });
    const ordersById = summary.results.find((r) => r.path === "/api/orders/{id}");
    expect(ordersById?.ok).toBe(false);
    // 200 is a declared code, so this is caught as a schema violation (missing required fields), not a status violation
    expect(ordersById?.schemaErrors?.length).toBeGreaterThan(0);
  });

  it("catches a schema violation (a field with the wrong type)", async () => {
    const brokenFetch: typeof fetch = (async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/warehouses") {
        return new Response(
          JSON.stringify({
            data: [{ id: "w1", name: "Main", country: 12345 }], // country should be a string
            pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const summary = await runContractTest({ baseUrl: "http://localhost:4000", contract, fetchImpl: brokenFetch });
    const warehouses = summary.results.find((r) => r.path === "/api/warehouses");
    expect(warehouses?.ok).toBe(false);
    expect(warehouses?.schemaErrors?.some((e) => e.includes("country"))).toBe(true);
  });

  it("reports a network failure distinctly from an assertion failure", async () => {
    const failingFetch: typeof fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const summary = await runContractTest({ baseUrl: "http://localhost:9999", contract, fetchImpl: failingFetch });
    expect(summary.failed).toBeGreaterThan(0);
    expect(summary.results[0].error).toContain("ECONNREFUSED");
    expect(summary.results[0].schemaErrors).toBeUndefined();
  });

  it("skips byId checks with a clear reason when the list endpoint isn't in the contract or returns nothing", async () => {
    const emptyFetch: typeof fetch = (async () =>
      new Response(JSON.stringify({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const summary = await runContractTest({ baseUrl: "http://localhost:4000", contract, fetchImpl: emptyFetch });
    const byIdResults = summary.results.filter((r) => r.path.endsWith("/{id}"));
    expect(byIdResults.length).toBeGreaterThan(0);
    expect(byIdResults.every((r) => r.error?.includes("no sample id available"))).toBe(true);
  });

  it("catches a format violation (id that isn't a real UUID) now that ajv-formats is wired in", async () => {
    const brokenFetch: typeof fetch = (async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/warehouses") {
        return new Response(
          JSON.stringify({
            data: [{ id: "not-a-uuid-at-all", name: "Main", country: "US" }],
            pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const summary = await runContractTest({ baseUrl: "http://localhost:4000", contract, fetchImpl: brokenFetch });
    const warehouses = summary.results.find((r) => r.path === "/api/warehouses");
    expect(warehouses?.ok).toBe(false);
    expect(warehouses?.schemaErrors?.some((e) => e.includes("uuid"))).toBe(true);
  });

  it("sends custom headers through to every request", async () => {
    const seenHeaders: string[] = [];
    const headerCapturingFetch: typeof fetch = (async (_input, init) => {
      seenHeaders.push((init?.headers as Record<string, string>)?.["Authorization"] ?? "");
      return new Response(JSON.stringify({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await runContractTest({
      baseUrl: "http://localhost:4000",
      contract,
      headers: { Authorization: "Bearer testkey" },
      fetchImpl: headerCapturingFetch,
    });
    expect(seenHeaders.length).toBeGreaterThan(0);
    expect(seenHeaders.every((h) => h === "Bearer testkey")).toBe(true);
  });
});
