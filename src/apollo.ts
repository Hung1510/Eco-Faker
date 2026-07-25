import { ApolloClient, InMemoryCache, type NormalizedCacheObject } from "@apollo/client";
import { SchemaLink } from "@apollo/client/link/schema";
import type { Dataset } from "./types.js";
import { toGraphQLSchema } from "./graphql.js";

export interface ApolloClientOptions {
  /** Passed straight through to `new InMemoryCache(...)` if you need custom type policies (e.g. per-table `keyFields`). Defaults to a bare `InMemoryCache()`. */
  cache?: InMemoryCache;
  /** Extra context merged into every resolver call (mirrors `SchemaLink`'s own `context` option) -- unused by eco-faker's resolvers today, but there for parity with a real schema you might layer auth/tenant info onto later. */
  context?: SchemaLink.ResolverContext | SchemaLink.ResolverContextFunction;
}

/**
 * Wraps the same executable schema `toGraphQLSchema`/`serve --graphql`
 * already build in a `SchemaLink`, so an `ApolloClient` instance executes
 * queries directly against the in-memory dataset -- no server, no network
 * hop, no mock server to keep in sync. This is the officially-documented
 * SSR/mocking pattern for Apollo Client (`@apollo/client/link/schema`),
 * not a custom transport reimplementing what Apollo already does well.
 *
 * Every field `toGraphQLSchema` exposes works unmodified: `<table>(filters,
 * sort, order, page, pageSize)`, `<table>ById(id)`, and `info`. Records and
 * `filters` are the same `JSON` scalar the standalone GraphQL adapter uses
 * (see its own docs for why), so `useQuery` results come back as plain
 * objects rather than fully-typed per-resource shapes.
 *
 * @example
 * import { generate } from "eco-faker";
 * import { createEcoFakerApolloClient } from "eco-faker/apollo";
 * import { gql, useQuery } from "@apollo/client";
 *
 * const client = createEcoFakerApolloClient(generate({ seed: 1, scenario: "black-friday" }));
 *
 * function OrdersTable() {
 *   const { data } = useQuery(gql`
 *     query { orders(filters: { status: "delivered" }, pageSize: 10) { data pagination { total } meaning } }
 *   `, { client });
 *   // ...
 * }
 */
export function createEcoFakerApolloClient(dataset: Dataset, options: ApolloClientOptions = {}): ApolloClient {
  const { schema } = toGraphQLSchema(dataset);
  return new ApolloClient({
    cache: options.cache ?? new InMemoryCache(),
    link: new SchemaLink({ schema, context: options.context }),
  });
}

export type { NormalizedCacheObject };
