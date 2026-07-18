import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { generate } from "../src/generator.js";
import { toMswHandlers } from "../src/msw.js";

const dataset = generate({ seed: 7, scaleFactor: 60 });
const server = setupServer(...toMswHandlers(dataset));

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers(...toMswHandlers(dataset)));
afterAll(() => server.close());

describe("MSW adapter (toMswHandlers)", () => {
  it("GET /api paginates and lists endpoints, matching serve's / response shape", async () => {
    const res = await fetch("http://localhost/api");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.endpoints).toContain("/api/orders");
    expect(body.counts.orders).toBe(dataset.orders.length);
  });

  it("GET /api/orders paginates and filters by status, same as serve", async () => {
    const res = await fetch("http://localhost/api/orders?status=delivered&pageSize=5&page=1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBeLessThanOrEqual(5);
    expect(body.data.every((o: any) => o.status === "delivered")).toBe(true);
    expect(body.pagination.pageSize).toBe(5);
    expect(res.headers.get("x-eco-faker-meaning")).toBe("orders fetched successfully");
  });

  it("GET /api/orders/:id returns a single record with the item meaning header", async () => {
    const target = dataset.orders[0];
    const res = await fetch(`http://localhost/api/orders/${target.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(target.id);
    expect(res.headers.get("x-eco-faker-meaning")).toBe("order fetched -- purchase confirmed");
  });

  it("GET /api/orders/:id returns 404 with a meaning header for an unknown id", async () => {
    const res = await fetch("http://localhost/api/orders/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.headers.get("x-eco-faker-meaning")).toBe("no matching record found");
  });

  it("GET /api/orders?sort=total&order=desc sorts descending, same as serve", async () => {
    const res = await fetch("http://localhost/api/orders?sort=total&order=desc&pageSize=10");
    const body = await res.json();
    const totals = body.data.map((o: any) => o.total);
    const sorted = [...totals].sort((a, b) => b - a);
    expect(totals).toEqual(sorted);
  });

  it("respects a custom basePath", async () => {
    const customServer = setupServer(...toMswHandlers(dataset, { basePath: "/mock" }));
    customServer.listen({ onUnhandledRequest: "error" });
    try {
      const res = await fetch("http://localhost/mock/users?pageSize=3");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.length).toBeLessThanOrEqual(3);
    } finally {
      customServer.close();
    }
  });
});
