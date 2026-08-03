# cli-serve-contract-test

A companion project for the tutorial in [`TUTORIAL.md`](./TUTORIAL.md): the core CLI dev loop -- `openapi-export` → `serve` → `test --contract` -- with one real passing scenario and two real failing ones.

## Run it

From the repo root (so this workspace links against the local `eco-faker` source, not the published npm package):

```bash
npm install
cd examples/cli-serve-contract-test
npm run demo
```

This runs all three scenarios in sequence against a real `serve` process and asserts each behaved as documented, printing `EXPECTED:` / `UNEXPECTED:` per scenario and exiting non-zero if reality ever drifts from what `TUTORIAL.md` claims.

## Implementation note

`scripts/run-demo.mjs` resolves the `my-eco-gen` binary directly (`node_modules/.bin/my-eco-gen`) rather than going through `npx my-eco-gen` -- in this monorepo's hoisted `node_modules` layout, `npx`'s local-bin lookup occasionally re-invoked the underlying command, which showed up as a duplicated transcript in the demo's own logging (not a bug in `eco-faker` itself, but worth knowing about if you adapt this pattern elsewhere).

## CI

`npm run ci-smoke-test` is the same command as `npm run demo`.
