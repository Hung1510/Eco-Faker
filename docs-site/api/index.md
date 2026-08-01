# Library API

```ts
import { generate, serialize } from "eco-faker";

const dataset = generate({ seed: 42, scaleFactor: 200 });
const sql = serialize(dataset, "sql"); // or "json" / "csv"
```

`dataset` already contains relationally-linked `users`, `carts`, `abandonedCheckouts`, `orders`, `shipments`, `returnRequests`, and more.

## Core exports

| Export | What it does |
|---|---|
| `generate(config?, referenceNow?)` | Builds a full in-memory `Dataset` |
| `generateRecords(config?)` | Generator yielding `{ table, record }` one at a time — see [High-volume stream mode](/cli/generate#high-volume-stream-mode) |
| `serialize(dataset, format)` | `"json"` \| `"sql"` \| `"csv"` |
| `createUniqueTracker<T>()` | Scoped, explicit uniqueness guarantee — see [Unique Values](/api/unique-values) |
| `SCENARIOS`, `resolveScenario`, `mergeOverrides` | Scenario preset resolution — see [Scenarios](/api/scenarios) |

## Two entry points

- **`eco-faker`** (`src/index.ts`) — the full public API, Node-only (pulls in `serve.ts`'s Express dependency transitively for some adapters).
- **`eco-faker/browser`** — the browser-safe subset, excluding `serve.ts` and `diff.ts`. Use this when bundling for a browser environment (e.g. `web-static/`'s client-side demos import this directly).

## Related

- [Configuration](/api/configuration) — the full config shape, validated via ajv
- [Scenarios](/api/scenarios) — presets, composition, precedence rules
- [Unique Values](/api/unique-values) — `createUniqueTracker`
- [Adapters](/adapters/) — MSW, tRPC, GraphQL, React Query, Apollo Client wrappers around the same `Dataset`
- [Project Layout](/contributing/project-layout) — the full source map, if you're looking for a specific internal module
