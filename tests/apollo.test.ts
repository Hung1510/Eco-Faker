import { describe, expect, it } from "vitest";
import { gql } from "@apollo/client";
import { generate } from "../src/generator.js";
import { createEcoFakerApolloClient } from "../src/apollo.js";

const dataset = generate({ seed: 7, scaleFactor: 60 });
const client = createEcoFakerApolloClient(dataset);

describe("Apollo Client adapter (createEcoFakerApolloClient)", () => {
  it("executes a list query with filters/pagination through SchemaLink, no network", async () => {
    const { data, error } = await client.query({
      query: gql`
        query Orders($filters: JSON, $pageSize: Int) {
          orders(filters: $filters, pageSize: $pageSize) {
            data
            pagination {
              total
              pageSize
            }
            meaning
          }
        }
      `,
      variables: { filters: { status: "delivered" }, pageSize: 5 },
    });

    expect(error).toBeUndefined();
    expect(data.orders.data.length).toBeLessThanOrEqual(5);
    expect(data.orders.data.every((o: any) => o.status === "delivered")).toBe(true);
    expect(typeof data.orders.meaning).toBe("string");
  });

  it("executes a byId query and returns the exact matching record", async () => {
    const target = dataset.orders[0];
    const { data } = await client.query({
      query: gql`
        query OrderById($id: ID!) {
          ordersById(id: $id)
        }
      `,
      variables: { id: target.id },
    });
    expect(data.ordersById.id).toBe(target.id);
  });

  it("info reflects real table counts, same as the standalone GraphQL/tRPC adapters", async () => {
    const { data } = await client.query({
      query: gql`
        query {
          info {
            tables
            counts
          }
        }
      `,
    });
    expect(data.info.tables).toContain("supportTickets");
    expect(data.info.counts.orders).toBe(dataset.orders.length);
  });
});
