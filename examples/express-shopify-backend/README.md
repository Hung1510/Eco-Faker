# express-shopify-backend

A companion project for the tutorial in [`TUTORIAL.md`](./TUTORIAL.md): a fake Shopify-style REST backend (products, customers, orders, shipments, returns — with search, filtering, and pagination) built with `eco-faker` + Express.

## Run it

From the repo root (so this workspace links against the local `eco-faker` source, not the published npm package):

```bash
npm install
cd examples/express-shopify-backend
npm run generate   # writes db.json
npm run dev        # starts the API on http://localhost:4001
```

## CI

`npm run ci-smoke-test` boots the server against a freshly generated dataset and asserts a representative endpoint per resource responds correctly. This runs in the repo's `examples` CI job so a breaking change to `generate()`'s output shape fails here, not in someone's local `npm run dev`.
