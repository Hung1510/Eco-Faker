import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { Dataset } from "./types.js";
import { buildOpenApiSpec } from "./openapi.js";
import { buildPostmanCollection } from "./postman.js";

export type DatasetArrayKey = Exclude<keyof Dataset, "config">;

/** URL-friendly route name -> the Dataset key it reads from. */
export const TABLE_ROUTES: Record<string, DatasetArrayKey> = {
  users: "users",
  carts: "carts",
  "abandoned-checkouts": "abandonedCheckouts",
  orders: "orders",
  shipments: "shipments",
  returns: "returnRequests",
};

const RESERVED_QUERY_KEYS = new Set(["page", "pageSize", "sort", "order"]);

/**
 * Human-readable, e-commerce-flavored descriptions for what a given
 * (table, status code) combination actually means -- so `serve` output
 * reads like "200 -- order fetched successfully" instead of just a bare
 * status code. Surfaced both in the request logger and in the
 * `X-Eco-Faker-Meaning` response header.
 */
const RESOURCE_MEANINGS: Record<DatasetArrayKey, { list: string; item: string }> = {
  users: { list: "user directory fetched successfully", item: "user profile fetched successfully" },
  carts: { list: "cart list fetched successfully", item: "cart fetched successfully" },
  abandonedCheckouts: {
    list: "abandoned checkouts fetched successfully",
    item: "abandoned checkout fetched successfully",
  },
  orders: { list: "orders fetched successfully", item: "order fetched -- purchase confirmed" },
  shipments: { list: "shipments fetched successfully", item: "shipment status fetched successfully" },
  returnRequests: { list: "return requests fetched successfully", item: "return request fetched successfully" },
};

const CHAOS_MEANINGS: Record<number, string> = {
  429: "rate limit hit (simulated chaos)",
  500: "internal server error (simulated chaos)",
};

const GENERIC_MEANINGS: Record<number, string> = {
  401: "missing or invalid API key",
  404: "no matching record found",
};

/** Resolve a plain-English description for a table route + status code. */
<<<<<<< HEAD
export function resolveMeaning(datasetKey: DatasetArrayKey | undefined, hasId: boolean, status: number): string {
=======
function resolveMeaning(datasetKey: DatasetArrayKey | undefined, hasId: boolean, status: number): string {
>>>>>>> 0a7a7f9211714110ff620a1064cf172f506abd51
  if (CHAOS_MEANINGS[status]) return CHAOS_MEANINGS[status];
  if (GENERIC_MEANINGS[status]) return GENERIC_MEANINGS[status];
  if (status >= 200 && status < 300 && datasetKey) {
    const meaning = RESOURCE_MEANINGS[datasetKey];
    return hasId ? meaning.item : meaning.list;
  }
  return status >= 500 ? "unexpected server error" : status >= 400 ? "request could not be completed" : "ok";
}

const ANSI = { green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", dim: "\x1b[2m", reset: "\x1b[0m" };

function colorForStatus(status: number): string {
  if (status >= 500) return ANSI.red;
  if (status >= 400) return ANSI.yellow;
  return ANSI.green;
}

/**
 * Logs one line per /api/* request once it finishes, in the shape:
 *   GET /api/orders/ord_123 200 -- order fetched -- purchase confirmed (14ms)
 * Colored by status bucket (2xx green, 4xx yellow, 5xx red) so `serve --chaos`
 * output is legible at a glance, whether in a terminal or piped to a file.
 */
function requestLogger(datasetKeyForRoute: (routeSegment: string) => DatasetArrayKey | undefined) {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on("finish", () => {
      const elapsed = Date.now() - start;
      const segments = req.path.split("/").filter(Boolean); // ["orders"] or ["orders", "ord_123"]
      const [routeSegment, idSegment] = segments;
      const datasetKey = datasetKeyForRoute(routeSegment ?? "");
      const meaning = resolveMeaning(datasetKey, Boolean(idSegment), res.statusCode);
      const color = colorForStatus(res.statusCode);
      console.log(
        `${ANSI.dim}${req.method}${ANSI.reset} ${req.path} ${color}${res.statusCode}${ANSI.reset} -- ${meaning} ${ANSI.dim}(${elapsed}ms)${ANSI.reset}`,
      );
    });
    next();
  };
}

export interface ChaosOptions {
  /** Chance [0,1] a request gets an injected latency spike instead of responding immediately. */
  latencyRate: number;
  latencyMinMs: number;
  latencyMaxMs: number;
  /** Chance [0,1] a request gets a simulated 500 instead of its real response. */
  errorRate: number;
  /** Chance [0,1] a request gets a simulated 429 rate-limit response. */
  rateLimitRate: number;
}

export const DEFAULT_CHAOS_OPTIONS: ChaosOptions = {
  latencyRate: 0.2,
  latencyMinMs: 300,
  latencyMaxMs: 2000,
  errorRate: 0.05,
  rateLimitRate: 0.05,
};

export interface ServeOptions {
  /** Enable latency spikes / 500s / 429s on every /api/* request. */
  chaos?: Partial<ChaosOptions> | true;
  /** Require `Authorization: Bearer <apiKey>` on every /api/* request. */
  apiKey?: string;
  /** Mount GET /openapi.json describing every route (default: true). */
  openapi?: boolean;
  /** Mount GET /postman.json -- a ready-to-import Postman Collection v2.1 (default: false). */
  postman?: boolean;
  /** Suppress the per-request console log line (default: false -- logging is on). */
  quiet?: boolean;
  /** Port, only used to fill in the OpenAPI `servers` entry -- doesn't bind anything itself. */
  port?: number;
}

function applyFilters(rows: Record<string, unknown>[], query: Request["query"]): Record<string, unknown>[] {
  let result = rows;
  for (const [key, value] of Object.entries(query)) {
    if (RESERVED_QUERY_KEYS.has(key) || value === undefined) continue;
    result = result.filter((row) => String(row[key]) === String(value));
  }
  return result;
}

function applySort(rows: Record<string, unknown>[], query: Request["query"]): Record<string, unknown>[] {
  const sortKey = query.sort as string | undefined;
  if (!sortKey) return rows;
  const direction = query.order === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av === bv) return 0;
    return (av! > bv! ? 1 : -1) * direction;
  });
}

function paginate(rows: Record<string, unknown>[], query: Request["query"]) {
  const page = Math.max(1, parseInt(String(query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(String(query.pageSize ?? "25"), 10) || 25));
  const start = (page - 1) * pageSize;
  const data = rows.slice(start, start + pageSize);
  return {
    data,
    pagination: { page, pageSize, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / pageSize)) },
  };
}

/**
 * Plain-object equivalents of the three functions above, taking a
 * URLSearchParams-like record instead of an Express `Request["query"]` --
 * this is what lets `src/msw.ts` reuse the exact same filter/sort/paginate
 * behavior as the HTTP server without depending on Express types.
 */
export function applyFiltersToRecords(
  rows: Record<string, unknown>[],
  query: Record<string, string | undefined>
): Record<string, unknown>[] {
  return applyFilters(rows, query as unknown as Request["query"]);
}

export function applySortToRecords(
  rows: Record<string, unknown>[],
  query: Record<string, string | undefined>
): Record<string, unknown>[] {
  return applySort(rows, query as unknown as Request["query"]);
}

export function paginateRecords(rows: Record<string, unknown>[], query: Record<string, string | undefined>) {
  return paginate(rows, query as unknown as Request["query"]);
}

/**
 * `Authorization: Bearer <apiKey>` gate. Deliberately simple -- one static
 * key, no scopes/expiry -- this is a mock server, the point is to make
 * frontend code exercise its own 401-handling path, not to model real auth.
 */
function authMiddleware(apiKey: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (header !== `Bearer ${apiKey}`) {
      res.status(401).json({ error: "Missing or invalid Authorization header. Expected: Bearer <api-key>" });
      return;
    }
    next();
  };
}

/**
 * Injects latency spikes, simulated 500s, and simulated 429s -- so a
 * frontend built against this mock API is forced to handle failure modes,
 * not just the happy path. One random roll per request decides the bucket
 * (rate-limit > error > latency > normal), so the three chaos modes are
 * mutually exclusive on any given request.
 */
function chaosMiddleware(options: ChaosOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const roll = Math.random();

    if (roll < options.rateLimitRate) {
      res.status(429).set("Retry-After", "2").json({ error: "Rate limit exceeded (simulated chaos).", retryAfterSeconds: 2 });
      return;
    }
    if (roll < options.rateLimitRate + options.errorRate) {
      res.status(500).json({ error: "Internal server error (simulated chaos)." });
      return;
    }
    if (roll < options.rateLimitRate + options.errorRate + options.latencyRate) {
      const delayMs = options.latencyMinMs + Math.random() * (options.latencyMaxMs - options.latencyMinMs);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    next();
  };
}

/**
 * A json-server-style mock REST API backed by an already-generated Dataset.
 * Every table gets:
 *   GET /api/<table>            -- paginated, filterable by any top-level field, sortable
 *   GET /api/<table>/:id         -- single record by id
 * Query params other than page/pageSize/sort/order are treated as exact-match
 * filters (?status=delivered, ?userId=..., etc.) -- no query language, just
 * enough to build and demo a real frontend against.
 */
export function createMockApiServer(dataset: Dataset, options: ServeOptions = {}): Express {
  const app = express();

  app.get("/", (_req: Request, res: Response) => {
    res.json({
      name: "eco-faker mock API",
      endpoints: Object.keys(TABLE_ROUTES).map((route) => `/api/${route}`),
      counts: Object.fromEntries(Object.entries(TABLE_ROUTES).map(([route, key]) => [route, dataset[key].length])),
      chaos: Boolean(options.chaos),
      auth: Boolean(options.apiKey),
      openapi: options.openapi !== false ? "/openapi.json" : null,
      postman: options.postman ? "/postman.json" : null,
    });
  });

  if (options.openapi !== false) {
    app.get("/openapi.json", (_req: Request, res: Response) => {
      res.json(buildOpenApiSpec(dataset, options.port ?? 4000));
    });
  }

  if (options.postman) {
    app.get("/postman.json", (_req: Request, res: Response) => {
      res.json(buildPostmanCollection({ port: options.port ?? 4000, apiKey: options.apiKey }));
    });
  }

  const apiRouter = express.Router();
  const datasetKeyForRoute = (routeSegment: string): DatasetArrayKey | undefined => TABLE_ROUTES[routeSegment];

  // Attach X-Eco-Faker-Meaning to every /api/* response (including ones
  // short-circuited by auth/chaos below) by wrapping res.json once, up front.
  apiRouter.use((req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      const [routeSegment, idSegment] = req.path.split("/").filter(Boolean);
      const meaning = resolveMeaning(datasetKeyForRoute(routeSegment ?? ""), Boolean(idSegment), res.statusCode);
      res.set("X-Eco-Faker-Meaning", meaning);
      return originalJson(body);
    }) as typeof res.json;
    next();
  });

  if (options.quiet !== true) {
    apiRouter.use(requestLogger(datasetKeyForRoute));
  }

  if (options.apiKey) {
    apiRouter.use(authMiddleware(options.apiKey));
  }
  if (options.chaos) {
    const chaosOptions: ChaosOptions = { ...DEFAULT_CHAOS_OPTIONS, ...(options.chaos === true ? {} : options.chaos) };
    apiRouter.use(chaosMiddleware(chaosOptions));
  }

  for (const [route, datasetKey] of Object.entries(TABLE_ROUTES)) {
    apiRouter.get(`/${route}`, (req: Request, res: Response) => {
      const rows = dataset[datasetKey] as unknown as Record<string, unknown>[];
      const filtered = applySort(applyFilters(rows, req.query), req.query);
      res.json(paginate(filtered, req.query));
    });

    apiRouter.get(`/${route}/:id`, (req: Request, res: Response) => {
      const rows = dataset[datasetKey] as unknown as Record<string, unknown>[];
      const row = rows.find((r) => r.id === req.params.id);
      if (!row) {
        res.status(404).json({ error: `No record in ${route} with id ${req.params.id}` });
        return;
      }
      res.json(row);
    });
  }

  app.use("/api", apiRouter);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Unknown route.", availableRoutes: Object.keys(TABLE_ROUTES).map((r) => `/api/${r}`) });
  });

  return app;
}
