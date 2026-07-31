// src/lib/apolloClient.ts
//
// Two ApolloClient instances, same interface: one runs queries against an
// in-memory eco-faker dataset via SchemaLink (no server, no network), the
// other talks to a real GraphQL endpoint over HttpLink. Toggle with
// VITE_USE_REAL_API=true once a real backend exists -- every component
// using `useQuery` is unaware of the switch.

import { ApolloClient, InMemoryCache, HttpLink } from "@apollo/client";
import { generate } from "eco-faker";
import { createEcoFakerApolloClient } from "eco-faker/apollo";

function buildFakeClient() {
  const dataset = generate({
    seed: 42,
    scaleFactor: 300,
    catalogSize: 250,
    historicalDays: 90,
    returnRate: 0.12,
  });
  return createEcoFakerApolloClient(dataset);
}

function buildRealClient() {
  return new ApolloClient({
    link: new HttpLink({ uri: import.meta.env.VITE_GRAPHQL_URL ?? "http://localhost:4000/graphql" }),
    cache: new InMemoryCache(),
  });
}

export const client = import.meta.env.VITE_USE_REAL_API === "true" ? buildRealClient() : buildFakeClient();
