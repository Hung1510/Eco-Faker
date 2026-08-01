# Example Projects

Real, runnable, CI-verified projects in [`examples/`](https://github.com/Hung1510/Eco-Faker/tree/main/examples) — each is a full workspace with its own `TUTORIAL.md` walkthrough, not just a code snippet.

| Project | What it demonstrates |
|---|---|
| [`express-shopify-backend`](https://github.com/Hung1510/Eco-Faker/tree/main/examples/express-shopify-backend) | A hand-rolled Express REST API (search, filtering, pagination) over a generated dataset — the fastest way to unblock frontend work before a real backend exists |
| [`nextjs-app-router`](https://github.com/Hung1510/Eco-Faker/tree/main/examples/nextjs-app-router) | React Server Components reading a dataset directly (no network hop) + Route Handlers exposing the same data as JSON |
| [`graphql-apollo`](https://github.com/Hung1510/Eco-Faker/tree/main/examples/graphql-apollo) | The [GraphQL](/adapters/graphql) + [Apollo Client](/adapters/apollo) adapters together — pagination, filtering, sorting, and switching between the mocked client and a real endpoint |
| [`msw-vitest`](https://github.com/Hung1510/Eco-Faker/tree/main/examples/msw-vitest) | The [MSW adapter](/adapters/msw) + Vitest — shared handlers between component tests and an offline dev-mode browser worker |
| [`playwright-e2e`](https://github.com/Hung1510/Eco-Faker/tree/main/examples/playwright-e2e) | Deterministic, parallel-safe E2E tests — one server + seeded dataset per Playwright worker, reset to pristine state before every test |
| [`react-query`](https://github.com/Hung1510/Eco-Faker/tree/main/examples/react-query) | The [React Query adapter](/adapters/react-query) — pagination, caching (`staleTime`/`isFetching`), optimistic updates, background refetching |
| [`cli-serve-contract-test`](https://github.com/Hung1510/Eco-Faker/tree/main/examples/cli-serve-contract-test) | The core CLI dev loop — `openapi-export` → `serve` → [`test --contract`](/testing/contract-testing) — with a real passing case and two real failing cases (missing auth, contract schema drift) |

## Running an example

Each project links against eco-faker's local source (not the published npm package) via the repo's npm workspaces, so they always test against current code:

```bash
git clone https://github.com/Hung1510/Eco-Faker.git
cd Eco-Faker
npm install
cd examples/<project-name>
# see that project's own README.md / TUTORIAL.md for its specific run command
```

CI runs every example on every push — see [Continuous Integration](/contributing/ci).
