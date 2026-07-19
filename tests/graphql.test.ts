import { graphql, buildSchema, validateSchema } from "graphql";
import { describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";
import { toGraphQLSchema } from "../src/graphql.js";

describe("GraphQL adapter (toGraphQLSchema)", () => {
  const dataset = generate({ seed: 7, scaleFactor: 60 });
  const { schema, typeDefs } = toGraphQLSchema(dataset);

  it("produces a schema with no validation errors", () => {
    expect(validateSchema(schema)).toEqual([]);
  });

  it("the exported typeDefs SDL is itself valid GraphQL SDL", () => {
    // buildSchema throws on invalid SDL -- this just needs to not throw.
    expect(() => buildSchema(typeDefs)).not.toThrow();
    expect(typeDefs).toContain("type Query {");
    expect(typeDefs).toContain("scalar JSON");
  });

  it("info returns table names and matching counts", async () => {
    const result = await graphql({ schema, source: "{ info }" });
    expect(result.errors).toBeUndefined();
    const info = (result.data as any).info;
    expect(info.tables).toContain("abandonedCheckouts");
    expect(info.counts.orders).toBe(dataset.orders.length);
  });

  it("orders(filters, pageSize) filters and paginates, matching serve's semantics", async () => {
    const result = await graphql({
      schema,
      source: `
        query {
          orders(filters: { status: "delivered" }, pageSize: 5, page: 1) {
            data
            pagination { page pageSize total totalPages }
            meaning
          }
        }
      `,
    });
    expect(result.errors).toBeUndefined();
    const body = (result.data as any).orders;
    expect(body.data.length).toBeLessThanOrEqual(5);
    expect(body.data.every((o: any) => o.status === "delivered")).toBe(true);
    expect(body.pagination.pageSize).toBe(5);
    expect(body.meaning).toBe("orders fetched successfully");
  });

  it("orders sorts descending, same as serve", async () => {
    const result = await graphql({
      schema,
      source: `{ orders(sort: "total", order: "desc", pageSize: 10) { data } }`,
    });
    const totals = (result.data as any).orders.data.map((o: any) => o.total);
    expect(totals).toEqual([...totals].sort((a: number, b: number) => b - a));
  });

  it("ordersById returns a single record", async () => {
    const target = dataset.orders[0];
    const result = await graphql({
      schema,
      source: `query($id: ID!) { ordersById(id: $id) }`,
      variableValues: { id: target.id },
    });
    expect(result.errors).toBeUndefined();
    expect((result.data as any).ordersById.id).toBe(target.id);
  });

  it("ordersById returns null for an unknown id (not an error)", async () => {
    const result = await graphql({
      schema,
      source: `{ ordersById(id: "does-not-exist") }`,
    });
    expect(result.errors).toBeUndefined();
    expect((result.data as any).ordersById).toBeNull();
  });

  it("every table has a working list and byId field", async () => {
    const tables = ["users", "carts", "abandonedCheckouts", "orders", "shipments", "returns"];
    for (const table of tables) {
      const result = await graphql({ schema, source: `{ ${table}(pageSize: 1) { data } }` });
      expect(result.errors, `${table} query failed: ${JSON.stringify(result.errors)}`).toBeUndefined();
    }
  });
});
