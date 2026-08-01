# React Query adapter

```bash
npm install --save-dev @tanstack/react-query react
```

```ts
import { createEcoFakerQueryHooks } from "eco-faker/react-query";

const hooks = createEcoFakerQueryHooks({ baseUrl: "http://localhost:4000/api" });
// hooks.orders.useList(...), hooks.orders.useById(id)
```

`createEcoFakerQueryHooks({ baseUrl, fetchImpl? })` returns one `useList`/`useById` hook pair per table, targeting whatever's actually mounted at `baseUrl` — a real [`serve`](/cli/serve) instance, or an [MSW-mocked](/adapters/msw) set of routes for a fully offline dev/test setup. Query keys follow `["eco-faker", route, "list" | "byId", ...]`.

Only the read side (`useList`/`useById`) is generated — write paths (mutations) are yours to define against your own API routes, the same way `serve`'s own generated routes are read-only by default.

::: tip Production bundle size
Because this adapter's route-name helper is shared with `serve.ts` (which depends on Express), importing `eco-faker/react-query` into a client bundle can pull in several hundred KB of dead-in-the-browser code. Bundlers generally externalize the unused Node built-ins rather than hard-failing, but confirm your own bundle size before shipping — see the [React Query example project](/testing/examples) for a concrete before/after comparison.
:::

## Example project

See [Testing → Example Projects](/testing/examples) for a full Vite + React project demonstrating pagination, caching (`staleTime`, `isFetching` vs `isLoading`), optimistic updates (`useMutation` + manual cache writes), and background refetching (`refetchInterval`) against this adapter, mocked via MSW.
