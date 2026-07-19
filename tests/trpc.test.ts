import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";
import { toTrpcRouter } from "../src/trpc.js";

const t = initTRPC.create();
const createCaller = t.createCallerFactory;

describe("tRPC adapter (toTrpcRouter)", () => {
  const dataset = generate({ seed: 7, scaleFactor: 60 });
  const router = toTrpcRouter(dataset);
  const caller = createCaller(router)({});

  it("info returns table names (camelCased) and matching counts", async () => {
    const info = await caller.info();
    expect(info.tables).toContain("abandonedCheckouts");
    expect(info.counts.orders).toBe(dataset.orders.length);
  });

  it("orders.list paginates and filters by status, matching serve's semantics", async () => {
    const page = await caller.orders.list({ filters: { status: "delivered" }, pageSize: 5, page: 1 });
    expect(page.data.length).toBeLessThanOrEqual(5);
    expect(page.data.every((o: any) => o.status === "delivered")).toBe(true);
    expect(page.pagination.pageSize).toBe(5);
    expect(page.meaning).toBe("orders fetched successfully");
  });

  it("orders.list sorts descending, same as serve", async () => {
    const page = await caller.orders.list({ sort: "total", order: "desc", pageSize: 10 });
    const totals = page.data.map((o: any) => o.total);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
  });

  it("orders.list with no input returns the default page", async () => {
    const page = await caller.orders.list(undefined);
    expect(page.pagination.pageSize).toBe(25);
    expect(page.data.length).toBeGreaterThan(0);
  });

  it("orders.byId returns a single record with the item meaning", async () => {
    const target = dataset.orders[0];
    const result = await caller.orders.byId({ id: target.id });
    expect(result.data.id).toBe(target.id);
    expect(result.meaning).toBe("order fetched -- purchase confirmed");
  });

  it("orders.byId throws a TRPCError with code NOT_FOUND for an unknown id", async () => {
    await expect(caller.orders.byId({ id: "does-not-exist" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(caller.orders.byId({ id: "does-not-exist" })).rejects.toBeInstanceOf(TRPCError);
  });

  it("abandonedCheckouts sub-router (camelCased from abandoned-checkouts) works", async () => {
    const page = await caller.abandonedCheckouts.list({ pageSize: 3 });
    expect(page.data.length).toBeLessThanOrEqual(3);
  });

  it("every table declared in TABLE_ROUTES has a working sub-router", async () => {
    const tables = ["users", "carts", "abandonedCheckouts", "orders", "shipments", "returns"] as const;
    for (const table of tables) {
      const page = await (caller as any)[table].list({ pageSize: 1 });
      expect(Array.isArray(page.data)).toBe(true);
    }
  });
});
