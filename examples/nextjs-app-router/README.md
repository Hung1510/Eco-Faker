# nextjs-app-router

A companion project for the tutorial in [`TUTORIAL.md`](./TUTORIAL.md): products and orders rendered via React Server Components, plus Route Handlers exposing the same data as JSON, backed by `eco-faker`.

## Run it

From the repo root (so this workspace links against the local `eco-faker` source, not the published npm package):

```bash
npm install
cd examples/nextjs-app-router
npm run dev
```

Visit `http://localhost:3000`.

## CI

`npm run build && npm run ci-smoke-test` builds the app for real and boots `next start` against it, asserting the two pages and two API routes respond correctly. This is what catches the bundler-resolution issue documented in the tutorial (Step 2) if it ever regresses.
