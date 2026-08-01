# GraphQL adapter

```bash
npm install --save-dev graphql
```

```ts
import { generate } from "eco-faker";
import { toGraphQLSchema } from "eco-faker/graphql";

const { schema, typeDefs } = toGraphQLSchema(generate({ seed: 1 }));
```

One `<table>(filters, sort, order, page, pageSize)` + `<table>ById(id)` field per table, plus `info`. Records/filters use a `JSON` scalar. `filters` is exact-match only, applied to a plain object of key/value pairs — the same semantics [`serve`](/cli/serve) and the [MSW adapter](/adapters/msw) use, since all three share one underlying implementation.

`serve --graphql` mounts this same schema at `POST /graphql`, if you want a real server instead of using the schema in-process.

## Used by

The [Apollo Client adapter](/adapters/apollo) wraps this schema in Apollo's `SchemaLink` — see there for a full React example with pagination, filtering, and sorting.
