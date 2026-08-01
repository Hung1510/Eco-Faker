# Adapters

Same dataset, same filter/sort/paginate semantics, no server required — every adapter wraps a `Dataset` for a specific frontend data-fetching library.

| Adapter | Install | Subpath |
|---|---|---|
| [MSW](/adapters/msw) | `msw` | `eco-faker/msw` |
| [tRPC](/adapters/trpc) | `@trpc/server` | `eco-faker/trpc` |
| [GraphQL](/adapters/graphql) | `graphql` | `eco-faker/graphql` |
| [React Query](/adapters/react-query) | `@tanstack/react-query`, `react` | `eco-faker/react-query` |
| [Apollo Client](/adapters/apollo) | `@apollo/client`, `rxjs` | `eco-faker/apollo` |

Each adapter is an optional peer dependency — install only the ones you need. `serve --graphql` also mounts the GraphQL adapter's schema at `POST /graphql` for cases where you do want a real server.

## Real, runnable example projects

See [Testing → Example Projects](/testing/examples) for full, CI-verified example projects using several of these adapters together with Next.js, Vite, Vitest, and Playwright.
