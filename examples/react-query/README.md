# react-query

A companion project for the tutorial in [`TUTORIAL.md`](./TUTORIAL.md): pagination, caching, optimistic updates, and background refetching with TanStack React Query against an `eco-faker` dataset mocked via MSW.

## Run it

From the repo root (so this workspace links against the local `eco-faker` source, not the published npm package):

```bash
npm install
cd examples/react-query
npm run test
npm run dev
```

## Implementation notes specific to this workspace (not the tutorial's main path)

Same three monorepo-only artifacts as `examples/msw-vitest` — none affect a real reader following `TUTORIAL.md`:

1. **`pg` devDependency** — satisfies a dynamic import in this repo's current (unreleased) `lint.js` that Vitest's transform pipeline resolves eagerly.
2. **Explicit `expect.extend()`** in `src/test/setup.ts` instead of `import "@testing-library/jest-dom/vitest"` — works around `vitest` being pinned to a different major version at the repo root than this workspace uses.
3. No `preserveSymlinks` issue here — `eco-faker/react-query` and `eco-faker/msw` don't hit the same optional-peer-resolution problem `eco-faker/apollo` does.

## CI

`npm run ci-smoke-test` runs the full Vitest suite (4 tests: pagination, caching, optimistic update, background refetching).
