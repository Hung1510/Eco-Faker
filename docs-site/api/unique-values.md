# Unique Values

`generate()` guarantees no two users share an email within one call — the same real-collision problem faker-js's own `faker.helpers.unique(...)` and faker-ruby's `Faker::X.unique.method` exist to solve. Naive fake-data generation really does produce duplicates: confirmed directly at `scaleFactor: 5000`, a handful of seeds produced real duplicate emails before this existed.

## `createUniqueTracker<T>()`

```ts
import { createUniqueTracker } from "eco-faker";

const uniqueSku = createUniqueTracker<string>();
const sku = uniqueSku.next(() => faker.string.alphanumeric(8).toUpperCase());
```

Explicitly scoped by construction — you create one, hold onto it for exactly as long as the constraint should apply, and it's garbage afterward — rather than a hidden global registry that could leak state between two unrelated `generate()` calls in a long-running process.

Throws `UniqueRetryLimitExceededError` (not an infinite loop) if a value space turns out to be too small for what's being asked of it.

## Cross-segment collisions (temporal scenarios)

The [temporal scenario engine](/cli/generate#temporal-scenario-engine-temporal)'s segment-merging (`mergeDatasets`) resolves the same kind of collision one level up — two independently-seeded segments producing the same email once merged — with a deterministic `+2`/`+3`-style disambiguator, since a per-segment tracker alone can't see across segments.

## Related

- [`generate`](/cli/generate) — where this guarantee applies by default
