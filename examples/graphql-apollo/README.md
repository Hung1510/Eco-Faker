# graphql-apollo

A companion project for the tutorial in [`TUTORIAL.md`](./TUTORIAL.md): Apollo Client reading from an in-memory `eco-faker` GraphQL schema via `SchemaLink`, with a one-line environment toggle to a real GraphQL endpoint.

## Run it

From the repo root (so this workspace links against the local `eco-faker` source, not the published npm package):

```bash
npm install
cd examples/graphql-apollo
npm run dev
```

**Note on `preserveSymlinks`:** this example's `vite.config.ts` sets `resolve: { preserveSymlinks: true }`. That's only required because this workspace consumes `eco-faker` via a `file:` link to local source (for testing against current code). A normal `npm install eco-faker` from the npm registry — what `TUTORIAL.md`'s readers will actually do — does not need this; see the tutorial's "Common mistakes" section for why.

**Note on the root `overrides` field:** the repo root's `package.json` has an `overrides` entry pinning `@vitejs/plugin-react`'s `vite` peer to `^8.2.0`, scoped to this workspace only. Without it, npm hoists a single `@vitejs/plugin-react` to the repo root and resolves its `vite` import against whatever `vite` version is hoisted there for other purposes (here, `vitest`'s own `vite@^5` dependency) instead of this workspace's `vite@^8.2.0` — a real npm workspace hoisting quirk when two workspaces need different major versions of a shared transitive dependency, unrelated to eco-faker itself.

## CI

`npm run build && npm run ci-smoke-test` builds the app, then runs the same direct-resolver check documented in `TUTORIAL.md`'s Testing section (querying the schema-backed Apollo Client directly, no browser) to catch schema/resolver regressions fast.
