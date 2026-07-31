# msw-vitest

A companion project for the tutorial in [`TUTORIAL.md`](./TUTORIAL.md): a React app whose real `fetch()` calls are intercepted by MSW handlers generated from an `eco-faker` dataset, shared between Vitest component tests and an offline dev-mode browser worker.

## Run it

From the repo root (so this workspace links against the local `eco-faker` source, not the published npm package):

```bash
npm install
cd examples/msw-vitest
npm run test
npm run dev
```

## Implementation notes specific to this workspace (not the tutorial's main path)

These three are all artifacts of linking against **local repo source** via `file:../..` and this repo's own monorepo layout. None of them affect a real reader following `TUTORIAL.md`, who installs `eco-faker` from npm.

1. **`pg` devDependency.** This repo's current (unreleased) source has an optional `lintSqlAgainstDatabase` feature that dynamically imports `pg`. Vitest's Vite-based transform pipeline tries to resolve that import eagerly; installing `pg` as an unused devDependency here satisfies it. The published npm package (`eco-faker@0.2.0` at time of writing) doesn't have this code path yet and doesn't need this.
2. **Explicit `expect.extend()` instead of `import "@testing-library/jest-dom/vitest"`.** See `src/test/setup.ts` and `src/test/vitest-matchers.d.ts` — in this monorepo, `vitest` is pinned to a different major version at the repo root (for the root's own test suite) than this workspace uses, and jest-dom's own ambient type augmentation resolves against the wrong (hoisted) copy. Augmenting explicitly against this workspace's own `vitest` import sidesteps it.
3. No `preserveSymlinks` issue was hit here (unlike `graphql-apollo`) — MSW's browser/Node subpaths don't pull in eco-faker's optional adapter imports the way `eco-faker/apollo` does.

## CI

`npm run ci-smoke-test` (an alias for `npm run test`) runs the full Vitest suite — the fastest, cheapest signal of the four examples, since it needs no build step and no server to boot.
