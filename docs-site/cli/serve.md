# serve

A mock REST API ("json-server for e-commerce"):

```bash
my-eco-gen serve --users 300 --scenario black-friday --port 4000
```

```
GET  /                                             endpoint list + row counts
GET  /api/orders?status=delivered&page=2&pageSize=25
GET  /api/orders?sort=total&order=desc
GET  /api/users | /api/carts | /api/abandoned-checkouts | /api/orders | /api/shipments | /api/returns
GET  /openapi.json                                 OpenAPI 3.0 spec
```

Any query param other than `page`/`pageSize`/`sort`/`order` is an exact-match filter.

**Request logging** — plain-English status meanings on every line and as an `X-Eco-Faker-Meaning` response header; `--quiet` disables the console line.

## Chaos mode

```bash
my-eco-gen serve --users 300 --chaos --chaos-error-rate 0.2 --chaos-rate-limit-rate 0.1 --chaos-latency-rate 0.3
```

Simulated 429s/500s/latency spikes on `/api/*` (defaults: 0.05/0.05/0.2); `/` and `/openapi.json` are never affected.

## API-key auth

```bash
my-eco-gen serve --users 300 --api-key my-secret-key
```

Every `/api/*` request without a matching `Authorization: Bearer <key>` header gets a 401.

## Live feeds

**WebSocket:** `--live --live-interval-ms 500` opens `ws://localhost:4000/live`.

**Server-Sent Events:** `--live-sse` opens `GET /live/sse` broadcasting the exact same event feed — for anything that can't do a WebSocket upgrade (`curl -N http://localhost:4000/live/sse`, a browser's built-in `EventSource`, a restrictive proxy/gateway that blocks WS but passes through a long-lived HTTP response fine). Each connecting client gets its own independent cursor, unlike the WebSocket feed's single shared broadcast loop.

## Postman export

```bash
my-eco-gen serve --postman [--postman-output <path>]
```

Writes a v2.1 collection and serves it at `GET /postman.json`.

## GraphQL mount

```bash
my-eco-gen serve --graphql
```

Mounts `POST /graphql` executing queries against the same dataset via the [GraphQL adapter](/adapters/graphql).

## OpenAPI-examples mocking (`serve --openapi-examples`)

```bash
my-eco-gen serve --openapi-examples ./my-api-spec.yaml --port 4000
```

An entirely different mode of `serve`: instead of generating a fake e-commerce dataset, this reads a real OpenAPI 3.x document (local `.json`/`.yaml`/`.yml`, or a live `http(s)://` URL) and serves *its own declared response examples* verbatim — for mocking an API you're designing or consuming, using example payloads you (or its authors) already wrote in the spec. Every dataset-shaping option (`--users`, `--seed`, `--scenario`, ...) is ignored in this mode; `--port`/`--chaos`/`--api-key`/`--quiet` still apply.

For each declared path+method, exactly one example is resolved, in priority order: a response's `example` → the first (alphabetically) entry of its `examples` map → its `schema.example`. A path+method declared in the spec with none of the three gets a real `501` saying so — never a fabricated response. Anything not declared in the spec at all gets a `404`. This is a stateless, single-happy-path mock, not a request-aware state machine — it can't tell "the 200 case" from "the 404 case" for the same operation from the request alone, so it always serves the lowest declared `2xx` (falling back to `default`) regardless of what you send it.

## Related

- [Contract Testing](/testing/contract-testing) — validate a live `serve` instance (or any real API) against its OpenAPI contract
- [Database Tools](/cli/db-tools) — seed a real Postgres database instead of serving in-memory
- [Adapters](/adapters/) — talk to the same dataset without a server at all
