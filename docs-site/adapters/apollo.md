# Apollo Client adapter

```bash
npm install --save-dev @apollo/client rxjs
```

```ts
import { createEcoFakerApolloClient } from "eco-faker/apollo";

const client = createEcoFakerApolloClient(generate({ seed: 1 }));
```

Wraps the [GraphQL adapter](/adapters/graphql)'s schema in Apollo's own `SchemaLink` (the documented SSR/mocking pattern) — no server, no network hop. `client` is a real `ApolloClient` instance; use it with `ApolloProvider`/`useQuery` exactly as you would against a live server.

No Relay adapter — Relay expects `relay-compiler`-generated artifacts, not raw documents, so a hand-rolled Network layer would mislead rather than help.

::: warning Apollo Client v4
Apollo Client v4 moved React bindings to `@apollo/client/react` (not the top-level `@apollo/client` package), and requires `rxjs` as a real, non-optional runtime dependency — install it explicitly even though it isn't imported directly in your own code.
:::

## Example project

See [Testing → Example Projects](/testing/examples) for a full Vite + React example demonstrating pagination, filtering, and sorting via real GraphQL queries against this client, plus a documented pattern for switching between the mocked client and a real GraphQL endpoint via an environment variable.
